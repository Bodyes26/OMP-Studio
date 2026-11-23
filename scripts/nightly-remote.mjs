// Build Nightly distribuita (R-MI-37): dentro Studio, la macchina da cui si
// lancia `npm run nightly` (coordinatore) fa compilare l'altra piattaforma
// all'altra macchina collegata, allo stesso commit e con lo stesso build-id,
// mentre compila la propria; poi si riprende gli installer e pubblica tutto da
// sola. Passa dal bridge locale di Studio (`/v1/macchine/*`, R-MI-36): fuori
// da Studio le variabili del bridge mancano e la Nightly resta com'era.

import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

/** Piattaforma che il coordinatore chiede all'altra macchina. */
export const OTHER_PLATFORM = { macos: 'windows', windows: 'macos' };

export const WORKER_STAGING = 'staging-nightly-worker';
export const WORKER_MANIFEST = 'worker.json';

export function bridgeFromEnv(env = process.env) {
	const url = env.OMP_STUDIO_BRIDGE_URL;
	const token = env.OMP_STUDIO_BRIDGE_TOKEN;
	return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

/**
 * Il `fetch` di Node chiude la richiesta se le intestazioni non arrivano entro
 * 5 minuti (headersTimeout di undici): `chiedi` aspetta l'utente e `risultato`
 * fino a 10 minuti, quindi fallivano con «fetch failed». Il bridge e' HTTP
 * locale (`lane_bridge.rs`): basta `node:http`, senza scadenza.
 */
export function bridgeFetch(url, init) {
	return new Promise((resolve, reject) => {
		const req = httpRequest(url, { method: init.method, headers: init.headers, signal: init.signal }, (res) => {
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('error', reject);
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				resolve({ status: res.statusCode ?? 0, json: async () => JSON.parse(text) });
			});
		});
		req.on('error', reject);
		req.end(init.body);
	});
}

async function call(bridge, verb, body, signal, fetchImpl = bridgeFetch) {
	const response = await fetchImpl(`${bridge.url}/v1/macchine/${verb}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body ?? {}),
		signal
	});
	const data = await response.json().catch(() => ({}));
	if (!data?.ok) throw new Error(data?.text || `Studio ha rifiutato macchine/${verb} (HTTP ${response.status})`);
	return data;
}

const sleep = (ms, signal) => delay(ms, undefined, { signal });

/**
 * Decide chi compila l'altra piattaforma. Esiti:
 * - `{ mode: 'none' }`: fuori da Studio, coordinatore Linux, nessuna macchina abbinata → come prima (cloud);
 * - `{ mode: 'cloud' }` / `{ mode: 'local' }`: scelte dell'utente nel dialogo di Studio;
 * - `{ mode: 'machine', machine }`: una macchina con la piattaforma giusta supera il controllo di disponibilità.
 * `annulla` nel dialogo interrompe la pubblicazione.
 */
export async function chooseWorker({ bridge, localPlatform, signal, log = console.log, fetchImpl = bridgeFetch, pollMs = 10_000 }) {
	const want = OTHER_PLATFORM[localPlatform];
	if (!bridge || !want) return { mode: 'none', platform: want ?? null };
	const list = async () => (await call(bridge, 'elenco', {}, signal, fetchImpl)).details?.machines ?? [];
	const probe = async (machines) => {
		let blocked = null;
		for (const candidate of machines) {
			if (!candidate.online || candidate.platform !== want) continue;
			try {
				await call(bridge, 'pronta', { macchina: candidate.id, piattaforma: want }, signal, fetchImpl);
				return { machine: candidate, blocked: null };
			} catch (error) {
				signal?.throwIfAborted();
				blocked ??= { machine: candidate, reason: error instanceof Error ? error.message : String(error) };
			}
		}
		return { machine: null, blocked };
	};
	const machines = await list();
	let { machine, blocked } = await probe(machines);
	if (machine) return { mode: 'machine', machine, platform: want };
	if (machines.length === 0) return { mode: 'none', platform: want };
	// Preferisci la macchina in linea la cui verifica è fallita: l'utente
	// deve vedere l'impedimento, non lo stato di un'altra macchina spenta.
	const named = blocked?.machine ?? machines.find((candidate) => candidate.platform === want) ?? machines.find((candidate) => !candidate.online);
	if (blocked) log(`${blocked.machine.name} è in linea, ma non è pronta per la Nightly ${want}: ${blocked.reason}`);
	const answer = await call(bridge, 'chiedi', { macchina: named?.name ?? '', piattaforma: want, locale: localPlatform, motivo: blocked?.reason }, signal, fetchImpl);
	const choice = answer.details?.scelta;
	if (choice === 'cloud') return { mode: 'cloud', platform: want };
	if (choice === 'locale') return { mode: 'local', platform: want };
	if (choice !== 'attendi') throw new Error('Pubblicazione annullata dal dialogo di Studio.');
	let lastStatus;
	for (;;) {
		const status = blocked
			? `In attesa che ${blocked.machine.name} sia pronta per la Nightly ${want} (è in linea): ${blocked.reason}`
			: `In attesa di una macchina ${want} collegata...`;
		if (status !== lastStatus) {
			log(status);
			lastStatus = status;
		}
		await sleep(pollMs, signal);
		({ machine, blocked } = await probe(await list()));
		if (machine) return { mode: 'machine', machine, platform: want };
	}
}

/**
 * Lancia la build dell'altra piattaforma e ne segue il log, con il prefisso
 * della macchina. Il guinzaglio fa fermare il job se questo script muore.
 */
export async function startWorker({ bridge, machine, buildId, commit, signal, write = (line) => process.stdout.write(line), fetchImpl = bridgeFetch, pollMs = 1000 }) {
	// Dipendenze come in CI (`bun install --frozen-lockfile`, nightly.yml): il
	// progetto usa bun.lock, e la cartella di lavoro riusata le tiene calde.
	const command = `bun install --frozen-lockfile && npm run nightly -- --worker --build-id ${buildId}`;
	const started = await call(bridge, 'esegui', {
		macchina: machine.id,
		commit,
		comando: command,
		artefatti: [`${WORKER_STAGING}/*`],
		guinzaglio: true
	}, signal, fetchImpl);
	const job = started.details?.job;
	if (!job) throw new Error('Studio non ha restituito il job della build remota');
	const prefix = `[${machine.name}] `;
	let offset = 0;
	let partial = '';
	let finished = false;
	const done = (async () => {
		for (;;) {
			const status = (await call(bridge, 'stato', { job, offset }, signal, fetchImpl)).details;
			const text = partial + (status.log ?? '');
			const lines = text.split(/\r?\n/);
			partial = lines.pop() ?? '';
			for (const line of lines) write(`${prefix}${line}\n`);
			offset = status.next ?? offset;
			if (['exited', 'failed', 'cancelled'].includes(status.state) && !(status.log ?? '')) {
				if (partial) write(`${prefix}${partial}\n`);
				finished = true;
				return status;
			}
			await sleep(pollMs, signal);
		}
	})();
	return {
		job,
		done,
		get finished() { return finished; },
		cancel: () => call(bridge, 'annulla', { job }, undefined, fetchImpl).catch(() => {}),
		/** Scarica gli installer verificati in `destination` e ne legge il manifest. */
		collect: async (destination) => {
			rmSync(destination, { recursive: true, force: true });
			mkdirSync(destination, { recursive: true });
			const result = await call(bridge, 'risultato', { job, destinazione: destination, attesaSecondi: 600 }, signal, fetchImpl);
			const manifest = readWorkerManifest(destination, result.details?.files ?? []);
			if (manifest.platform !== machine.platform) throw new Error('Piattaforma del worker inattesa');
			for (const installer of manifest.installers) {
				const hash = createHash('sha256');
				for await (const chunk of createReadStream(installer.path)) hash.update(chunk);
				if (hash.digest('hex') !== installer.sha256 || statSync(installer.path).size !== installer.size) {
					throw new Error(`Installer remoto diverso dal manifest: ${installer.name}`);
				}
			}
			return manifest;
		}
	};
}

/**
 * Nightly pubblicata con l'altra macchina: Studio propone «Aggiorna
 * entrambe» (R-MI-38). Una proposta non riuscita non tocca la pubblicazione.
 */
export async function proposeUpdateBoth({ bridge, version, machineIds, fetchImpl = bridgeFetch }) {
	if (!bridge) return;
	await call(bridge, 'aggiorna', { versione: version, macchine: machineIds }, undefined, fetchImpl).catch(() => {});
}

/** Manifest e installer riportati dal worker; il manifest deve esserci. */
export function readWorkerManifest(destination, files) {
	const manifestPath = join(destination, WORKER_MANIFEST);
	if (!files.some((file) => basename(file) === WORKER_MANIFEST)) throw new Error('Manifest remoto mancante');
	if (!existsSync(manifestPath)) throw new Error('La build remota non ha prodotto worker.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	if (!Array.isArray(manifest.installers) || manifest.installers.length === 0) throw new Error('Nessun installer remoto');
	const names = new Set();
	for (const installer of manifest.installers) {
		if (typeof installer.name !== 'string' || !/^[\w.-]+$/u.test(installer.name) ||
			installer.name === '.' || installer.name === '..' || names.has(installer.name) ||
			!files.some((file) => basename(file) === installer.name)) throw new Error('Nome installer remoto non valido');
		names.add(installer.name);
		installer.path = join(destination, installer.name);
		if (!existsSync(installer.path)) throw new Error(`Installer remoto mancante: ${installer.name}`);
	}
	return manifest;
}

/**
 * Unisce gli installer del worker allo staging del coordinatore. Rifiuta
 * versione o commit diversi: `nightly.json` deve descrivere una build sola.
 */
export function mergeWorker({ manifest, version, commit, stagingDir, staged, checksums, sha256Lines }) {
	if (manifest.version !== version) throw new Error(`Versione remota ${manifest.version} diversa da ${version}`);
	if (manifest.commit !== commit) throw new Error(`Commit remoto ${manifest.commit} diverso da ${commit}`);
	const extension = { windows: '.exe', macos: '.dmg' }[manifest.platform];
	if (!extension || !manifest.installers.some(({ name }) => name.includes(version) && name.endsWith(extension)) ||
		manifest.installers.some(({ name }) => !name.includes(version) || (!name.endsWith(extension) && !name.endsWith(`${extension}.sig`)))) {
		throw new Error('Gli artefatti remoti non corrispondono alla piattaforma e versione richieste');
	}
	for (const { name } of manifest.installers) {
		if (Object.hasOwn(checksums, name)) throw new Error(`Installer con lo stesso nome su due piattaforme: ${name}`);
	}
	for (const installer of manifest.installers) {
		const target = join(stagingDir, installer.name);
		copyFileSync(installer.path, target);
		checksums[installer.name] = installer.sha256;
		sha256Lines.push(`${installer.sha256}  ${installer.name}`);
		staged.push({ name: installer.name, path: target, size: installer.size, sha256: installer.sha256 });
	}
}

/** Piattaforme da affidare al workflow cloud dopo la build distribuita. */
export function cloudPlatforms({ all, local, remote }) {
	return all.filter((platform) => {
		if (platform === local) return false;
		if (remote?.platform !== platform) return true;
		// Compilata dall'altra macchina, oppure esclusa per scelta dell'utente.
		return !(remote.mode === 'machine' && remote.ok) && remote.mode !== 'local';
	});
}
