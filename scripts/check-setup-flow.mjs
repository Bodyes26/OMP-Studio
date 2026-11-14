#!/usr/bin/env node
/**
 * OMP Studio — Impronta del setup grafico di omp (SET-043, strict).
 *
 * Il setup grafico di Studio replica le scene del wizard nativo di omp: se omp
 * cambia il setup (versione, scene, sorgenti) la copia in Studio puo' diventare
 * silenziosamente obsoleta. Questo gate confronta i sorgenti pubblicati in
 * `@oh-my-pi/pi-tui@<versione omp>` (`package/src/setup/**`) con l'impronta
 * registrata in `scripts/omp-setup-flow.lock.json`.
 *
 * Qualsiasi differenza (versione del setup, scene, hash dei file, file
 * aggiunti/rimossi) termina con codice 1, elenca per file cosa e' cambiato e
 * stampa la procedura: rivedere il setup grafico di Studio contro le scene di
 * omp, aggiornare `docs/requisiti/setup.md`, poi `npm run check:setup-flow --
 * --update` per riscrivere il lock. Un cambio della sola versione di omp con
 * sorgenti identici NON blocca (basta un `--update` facoltativo per allineare
 * il campo versione).
 *
 * Opzioni:
 *   --update        Riscrive il lock con l'impronta corrente
 *   --bin <path>    Percorso del binario omp (o usa OMP_BIN)
 *   --package <ver> Versione del pacchetto npm da leggere (default: quella di omp)
 *   --json          Esito strutturato su stdout
 *   -h, --help      Mostra l'aiuto
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { getOmpVersion, resolveOmpBinary } from './check-commands.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/** File di impronta versionato: la sua storia Git documenta l'evoluzione del setup di omp. */
export const LOCK_FILE = join(ROOT, 'scripts', 'omp-setup-flow.lock.json');

/** Pacchetto npm che pubblica i sorgenti del wizard nativo. */
export const SETUP_PACKAGE = '@oh-my-pi/pi-tui';

/** Prefisso degli entry del tarball che ci interessano (sorgenti, non `dist/`). */
const SETUP_PREFIX = 'package/src/setup/';

/** Schema del lock: cambialo solo se il formato dell'impronta cambia davvero. */
const LOCK_SCHEMA_VERSION = 1;

const FETCH_TIMEOUT_MS = 30000;

function parseArgs(args) {
	const opts = {
		update: false,
		json: false,
		bin: null,
		pkgVersion: null,
		help: false
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--update') {
			opts.update = true;
		} else if (arg === '--json') {
			opts.json = true;
		} else if (arg === '--bin') {
			opts.bin = args[++i];
		} else if (arg.startsWith('--bin=')) {
			opts.bin = arg.slice(6);
		} else if (arg === '--package') {
			opts.pkgVersion = args[++i];
		} else if (arg.startsWith('--package=')) {
			opts.pkgVersion = arg.slice(10);
		} else if (arg === '--help' || arg === '-h') {
			opts.help = true;
		} else {
			console.error(`Opzione sconosciuta: ${arg}`);
			process.exit(1);
		}
	}

	return opts;
}

function printHelp() {
	console.log(`
Uso: node scripts/check-setup-flow.mjs [opzioni]

Confronta i sorgenti del setup nativo di omp (${SETUP_PACKAGE}, src/setup/**)
con l'impronta registrata in scripts/omp-setup-flow.lock.json.

Opzioni:
  --update         Riscrive il lock con l'impronta della versione installata
  --bin <path>     Percorso del binario omp (prevale su OMP_BIN e PATH)
  --package <ver>  Versione del pacchetto npm da leggere (default: versione di omp)
  --json           Stampa l'esito in formato JSON per integrazioni automatiche
  -h, --help       Mostra questo messaggio di aiuto

Variabili d'ambiente:
  OMP_BIN          Percorso alternativo del binario omp
`);
}

/**
 * Estrae la versione semantica da un output tipo `omp/18.20.0`.
 */
export function extractVersion(rawVersion) {
	const match = String(rawVersion || '').match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
	return match ? match[1] : null;
}

/**
 * Scarica il manifest della versione dal registry npm e ne ricava l'URL del tarball.
 * La rete assente e' un errore esplicito: il gate non deve mai passare in silenzio
 * senza aver visto i sorgenti upstream.
 */
async function resolveTarballUrl(pkgVersion) {
	const manifestUrl = `https://registry.npmjs.org/${SETUP_PACKAGE}/${pkgVersion}`;
	let response;
	try {
		response = await fetch(manifestUrl, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
	} catch (err) {
		throw new Error(
			`Impossibile contattare il registry npm per ${SETUP_PACKAGE}@${pkgVersion} (${manifestUrl}): ${err.message}.\n` +
				'Il controllo del setup grafico richiede la rete per leggere i sorgenti upstream di omp: ' +
				'verifica la connessione (o il proxy) e riprova.'
		);
	}

	if (!response.ok) {
		throw new Error(
			`Il registry npm ha risposto ${response.status} per ${SETUP_PACKAGE}@${pkgVersion} (${manifestUrl}).\n` +
				`Verifica che la versione ${pkgVersion} esista in ${SETUP_PACKAGE} (npm view ${SETUP_PACKAGE} versions).`
		);
	}

	const manifest = await response.json();
	const tarball = manifest?.dist?.tarball;
	if (!tarball) {
		throw new Error(
			`Il manifest di ${SETUP_PACKAGE}@${pkgVersion} non espone dist.tarball: impossibile leggere i sorgenti del setup.`
		);
	}
	return tarball;
}

/**
 * Scarica il tarball del pacchetto (Buffer gzip).
 */
async function downloadTarball(tarballUrl) {
	let response;
	try {
		response = await fetch(tarballUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	} catch (err) {
		throw new Error(
			`Download del tarball fallito (${tarballUrl}): ${err.message}.\n` +
				'Il controllo del setup grafico richiede la rete: verifica la connessione e riprova.'
		);
	}
	if (!response.ok) {
		throw new Error(
			`Il registry npm ha risposto ${response.status} scaricando ${tarballUrl}: il tarball non e' disponibile.`
		);
	}
	return Buffer.from(await response.arrayBuffer());
}

/**
 * Legge un archivio tar non compresso. Implementazione minima e senza dipendenze
 * (solo file regolari e header pax/GNU longname) perche' il gate deve funzionare
 * su ogni piattaforma senza strumenti esterni come tar.exe.
 */
export function readTarEntries(buffer) {
	const entries = [];
	let offset = 0;
	let pendingLongName = null;

	while (offset + 512 <= buffer.length) {
		const header = buffer.subarray(offset, offset + 512);
		// Due blocchi di zeri consecutivi chiudono l'archivio
		if (header.every((byte) => byte === 0)) break;

		const nameField = readCString(header, 0, 100);
		const sizeField = readCString(header, 124, 12).trim();
		const size = sizeField ? parseInt(sizeField, 8) : 0;
		const typeflag = String.fromCharCode(header[156] || 0x30);
		const prefix = readCString(header, 345, 155);
		const dataStart = offset + 512;
		const dataEnd = dataStart + size;
		const data = buffer.subarray(dataStart, Math.min(dataEnd, buffer.length));

		if (typeflag === 'L') {
			// GNU longname: il nome reale e' nel blocco dati successivo all'header
			pendingLongName = readCString(data, 0, data.length);
		} else if (typeflag === 'x' || typeflag === 'g') {
			// Header pax esteso: nessun file da leggere
			pendingLongName = pendingLongName ?? null;
		} else {
			const fullName = pendingLongName ?? (prefix ? `${prefix}/${nameField}` : nameField);
			pendingLongName = null;
			if (typeflag === '0' || typeflag === '\0') {
				entries.push({ name: fullName, content: data });
			}
		}

		offset = dataStart + Math.ceil(size / 512) * 512;
	}

	return entries;
}

function readCString(buffer, start, length) {
	const slice = buffer.subarray(start, Math.min(start + length, buffer.length));
	const end = slice.indexOf(0);
	const bytes = end === -1 ? slice : slice.subarray(0, end);
	return Buffer.from(bytes).toString('utf8');
}

/**
 * Scarica ed estrae i sorgenti di `src/setup/**` dalla versione indicata.
 *
 * @returns {Promise<{ files: Map<string, string>, tarballUrl: string }>} mappa percorso relativo -> contenuto UTF-8
 */
export async function fetchSetupSources(pkgVersion) {
	const tarballUrl = await resolveTarballUrl(pkgVersion);
	const tarball = await downloadTarball(tarballUrl);

	let entries;
	try {
		entries = readTarEntries(gunzipSync(tarball));
	} catch (err) {
		throw new Error(`Tarball ${SETUP_PACKAGE}@${pkgVersion} illeggibile: ${err.message}`);
	}

	const files = new Map();
	for (const entry of entries) {
		if (!entry.name.startsWith(SETUP_PREFIX)) continue;
		const relative = entry.name.slice('package/'.length);
		files.set(relative, Buffer.from(entry.content).toString('utf8'));
	}

	if (files.size === 0) {
		throw new Error(
			`Il tarball ${SETUP_PACKAGE}@${pkgVersion} non contiene ${SETUP_PREFIX}**: ` +
				'la struttura upstream del setup e\' cambiata e il controllo va aggiornato.'
		);
	}

	return { files, tarballUrl };
}

/**
 * Estrae l'elenco ordinato delle scene da `ALL_SCENES` in wizard.ts.
 * L'ordine e' significativo: e' l'ordine in cui il wizard nativo le presenta.
 */
export function parseSceneOrder(wizardSource) {
	const block = wizardSource.match(/export const ALL_SCENES\s*=\s*\[([\s\S]*?)\]/);
	if (!block) return [];

	return block[1]
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '')
		.split(',')
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

/**
 * Legge `id` e `minVersion` dal literal della scena esportata dal file indicato.
 */
export function parseSceneDefinition(source, exportName) {
	const startMatch = new RegExp(`export const ${exportName}\\b`).exec(source);
	if (!startMatch) return null;

	// Il literal della scena e' un oggetto: si legge fino alla prima chiusura a colonna 0
	const tail = source.slice(startMatch.index);
	const idMatch = /\bid:\s*["'`]([^"'`]+)["'`]/.exec(tail);
	const minVersionMatch = /\bminVersion:\s*(\d+)/.exec(tail);
	if (!idMatch || !minVersionMatch) return null;

	return {
		id: idMatch[1],
		minVersion: Number(minVersionMatch[1])
	};
}

/**
 * Costruisce l'impronta (senza il campo versione omp) dai sorgenti estratti.
 */
export function buildFingerprint(files) {
	const versionSource = files.get('src/setup/setup-version.ts');
	if (!versionSource) {
		throw new Error('setup-version.ts assente in src/setup/**: impossibile leggere CURRENT_SETUP_VERSION.');
	}
	const versionMatch = /CURRENT_SETUP_VERSION\s*(?::[^=]+)?=\s*(\d+)/.exec(versionSource);
	if (!versionMatch) {
		throw new Error('CURRENT_SETUP_VERSION non trovato in setup-version.ts: struttura upstream cambiata.');
	}

	const wizardSource = files.get('src/setup/wizard.ts');
	if (!wizardSource) {
		throw new Error('wizard.ts assente in src/setup/**: impossibile leggere ALL_SCENES.');
	}

	const sceneExports = parseSceneOrder(wizardSource);
	const sceneFiles = [...files.keys()].filter((path) => path.startsWith('src/setup/scenes/')).sort();

	const scenes = [];
	for (const exportName of sceneExports) {
		let found = null;
		for (const sceneFile of sceneFiles) {
			const definition = parseSceneDefinition(files.get(sceneFile), exportName);
			if (definition) {
				found = { export: exportName, file: sceneFile, ...definition };
				break;
			}
		}
		// Una scena elencata ma illeggibile e' comunque un cambiamento: la registriamo esplicitamente
		scenes.push(found ?? { export: exportName, file: null, id: `<non risolta: ${exportName}>`, minVersion: null });
	}

	const hashes = {};
	for (const path of [...files.keys()].sort()) {
		hashes[path] = createHash('sha256').update(files.get(path), 'utf8').digest('hex');
	}

	return {
		setupVersion: Number(versionMatch[1]),
		scenes,
		files: hashes
	};
}

/**
 * Confronta impronta attesa (lock) e corrente.
 * Il confronto dell'impronta ignora la versione di omp: un aggiornamento di omp
 * che non tocca il setup non deve bloccare la build.
 */
export function compareFingerprints(lock, current) {
	const differences = { setupVersion: null, scenes: [], files: { added: [], removed: [], changed: [] } };

	if (lock.setupVersion !== current.setupVersion) {
		differences.setupVersion = { from: lock.setupVersion ?? null, to: current.setupVersion };
	}

	const lockScenes = Array.isArray(lock.scenes) ? lock.scenes : [];
	const currentScenes = Array.isArray(current.scenes) ? current.scenes : [];
	const lockById = new Map(lockScenes.map((scene) => [scene.id, scene]));
	const currentById = new Map(currentScenes.map((scene) => [scene.id, scene]));

	for (const scene of currentScenes) {
		const previous = lockById.get(scene.id);
		if (!previous) {
			differences.scenes.push({ kind: 'added', id: scene.id, minVersion: scene.minVersion });
		} else if (previous.minVersion !== scene.minVersion) {
			differences.scenes.push({
				kind: 'changed',
				id: scene.id,
				from: previous.minVersion,
				to: scene.minVersion
			});
		}
	}

	for (const scene of lockScenes) {
		if (!currentById.has(scene.id)) {
			differences.scenes.push({ kind: 'removed', id: scene.id, minVersion: scene.minVersion });
		}
	}

	const lockOrder = lockScenes.map((scene) => scene.id).join(' > ');
	const currentOrder = currentScenes.map((scene) => scene.id).join(' > ');
	if (lockOrder !== currentOrder) {
		differences.sceneOrder = { from: lockOrder, to: currentOrder };
	}

	const lockFiles = lock.files && typeof lock.files === 'object' ? lock.files : {};
	for (const [path, hash] of Object.entries(current.files)) {
		if (!Object.hasOwn(lockFiles, path)) {
			differences.files.added.push(path);
		} else if (lockFiles[path] !== hash) {
			differences.files.changed.push({ path, from: lockFiles[path], to: hash });
		}
	}
	for (const path of Object.keys(lockFiles)) {
		if (!Object.hasOwn(current.files, path)) {
			differences.files.removed.push(path);
		}
	}

	const ok =
		differences.setupVersion === null &&
		differences.scenes.length === 0 &&
		!differences.sceneOrder &&
		differences.files.added.length === 0 &&
		differences.files.removed.length === 0 &&
		differences.files.changed.length === 0;

	return { ok, differences };
}

/**
 * Legge il lock; un lock assente o illeggibile e' un errore esplicito
 * (la prima generazione avviene con `--update`).
 */
function readLock(lockFile = LOCK_FILE) {
	if (!existsSync(lockFile)) return null;
	try {
		return JSON.parse(readFileSync(lockFile, 'utf8'));
	} catch (err) {
		throw new Error(`Impronta ${lockFile} illeggibile: ${err.message}`);
	}
}

function serializeLock(ompVersion, pkgVersion, fingerprint) {
	return (
		JSON.stringify(
			{
				schemaVersion: LOCK_SCHEMA_VERSION,
				package: SETUP_PACKAGE,
				ompVersion,
				packageVersion: pkgVersion,
				setupVersion: fingerprint.setupVersion,
				scenes: fingerprint.scenes,
				files: fingerprint.files
			},
			null,
			2
		) + '\n'
	);
}

/**
 * Esegue il confronto completo.
 *
 * @param {object} [options]
 * @param {string} [options.bin] Percorso del binario omp
 * @param {string} [options.pkgVersion] Versione del pacchetto npm da leggere
 * @returns {Promise<object>}
 */
export async function checkSetupFlow(options = {}) {
	const ompBin = resolveOmpBinary(options.bin);
	if (!ompBin) {
		throw new Error(
			"Binario 'omp' non trovato nel sistema.\nVerifica che 'omp' sia nel PATH o in ~/.omp/bin/omp, oppure specifica --bin <path> o la variabile OMP_BIN."
		);
	}

	const rawVersion = getOmpVersion(ompBin);
	const ompVersion = extractVersion(rawVersion);
	if (!ompVersion) {
		throw new Error(
			`Impossibile leggere la versione di omp da '${ompBin} --version' (output: '${rawVersion}').`
		);
	}

	const pkgVersion = options.pkgVersion || ompVersion;
	const { files, tarballUrl } = await fetchSetupSources(pkgVersion);
	const fingerprint = buildFingerprint(files);

	const lock = readLock(options.lockFile);
	if (!lock) {
		return {
			ok: false,
			reason: 'lock-mancante',
			ompBin,
			ompVersion,
			pkgVersion,
			tarballUrl,
			lockedOmpVersion: null,
			fingerprint,
			differences: null
		};
	}

	if (lock.schemaVersion !== LOCK_SCHEMA_VERSION) {
		throw new Error(
			`Impronta con schema ${lock.schemaVersion} non supportato (atteso ${LOCK_SCHEMA_VERSION}): rigenerala con --update.`
		);
	}

	const { ok, differences } = compareFingerprints(lock, fingerprint);

	return {
		ok,
		reason: ok ? 'allineato' : 'differenze',
		ompBin,
		ompVersion,
		lockedOmpVersion: lock.ompVersion ?? null,
		pkgVersion,
		lockedPackageVersion: lock.packageVersion ?? null,
		tarballUrl,
		fingerprint,
		differences,
		versionOnly:
			ok && (lock.ompVersion !== ompVersion || lock.packageVersion !== pkgVersion)
	};
}

function shortHash(hash) {
	return typeof hash === 'string' ? hash.slice(0, 12) : String(hash);
}

function printDifferences(result) {
	const diff = result.differences;

	if (diff.setupVersion) {
		console.error(
			`  Versione del setup (CURRENT_SETUP_VERSION): ${diff.setupVersion.from} -> ${diff.setupVersion.to}`
		);
	}

	if (diff.scenes.length > 0) {
		console.error('\n  Scene del wizard:');
		for (const scene of diff.scenes) {
			if (scene.kind === 'added') {
				console.error(`    + ${scene.id} (minVersion ${scene.minVersion})`);
			} else if (scene.kind === 'removed') {
				console.error(`    - ${scene.id} (minVersion ${scene.minVersion})`);
			} else {
				console.error(`    ~ ${scene.id} (minVersion ${scene.from} -> ${scene.to})`);
			}
		}
	}

	if (diff.sceneOrder) {
		console.error('\n  Ordine delle scene cambiato:');
		console.error(`    prima: ${diff.sceneOrder.from || '(nessuna)'}`);
		console.error(`    ora:   ${diff.sceneOrder.to || '(nessuna)'}`);
	}

	const { added, removed, changed } = diff.files;
	if (added.length + removed.length + changed.length > 0) {
		console.error('\n  File di src/setup/**:');
		for (const path of added) console.error(`    + ${path}`);
		for (const path of removed) console.error(`    - ${path}`);
		for (const entry of changed) {
			console.error(`    ~ ${entry.path} (${shortHash(entry.from)} -> ${shortHash(entry.to)})`);
		}
	}

	console.error(`
Procedura da seguire:
  1. Rivedi il setup grafico di Studio contro le scene di omp qui elencate:
     src/lib/components/setup/ (un passo per ogni scena gestita) e i testi in
     messages/it.json, messages/en.json (chiavi setup2_*).
  2. Aggiorna docs/requisiti/setup.md: requisiti e matrice di copertura per le
     scene nuove, rimosse o con minVersion diversa; annota la nuova versione di omp.
  3. Riscrivi l'impronta con la versione ora installata:
       npm run check:setup-flow -- --update
  4. Rilancia il gate e riprendi la pubblicazione:
       npm run check:setup-flow
Consultare docs/COMMANDS.md § 6 per la procedura completa.`);
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printHelp();
		process.exit(0);
	}

	let result;
	try {
		result = await checkSetupFlow({ bin: opts.bin, pkgVersion: opts.pkgVersion });
	} catch (err) {
		if (opts.json) {
			console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
		} else {
			console.error(`\n[ERRORE] ${err.message}\n`);
		}
		process.exit(1);
	}

	// Lock assente: si genera solo su richiesta esplicita, mai in silenzio
	if (result.reason === 'lock-mancante') {
		if (opts.update) {
			writeFileSync(
				LOCK_FILE,
				serializeLock(result.ompVersion, result.pkgVersion, result.fingerprint),
				'utf8'
			);
			const message = `[PASS] Impronta del setup di omp generata: ${result.fingerprint.scenes.length} scene, ${Object.keys(result.fingerprint.files).length} file (omp ${result.ompVersion}, setup v${result.fingerprint.setupVersion}).`;
			if (opts.json) {
				console.log(JSON.stringify({ ok: true, updated: true, ...result }, null, 2));
			} else {
				console.log(`\n${message}\n`);
			}
			process.exit(0);
		}

		if (opts.json) {
			console.log(JSON.stringify({ ok: false, error: 'Impronta assente', ...result }, null, 2));
		} else {
			console.error('\n=============================================================');
			console.error(' [FAIL] IMPRONTA DEL SETUP DI OMP ASSENTE');
			console.error('=============================================================');
			console.error(`File atteso: ${LOCK_FILE}`);
			console.error(
				'\nGenera l\'impronta iniziale con: npm run check:setup-flow -- --update\n' +
					'Verifica prima che il setup grafico di Studio copra tutte le scene elencate:\n' +
					result.fingerprint.scenes.map((scene) => `  - ${scene.id} (minVersion ${scene.minVersion})`).join('\n')
			);
			console.error('=============================================================\n');
		}
		process.exit(1);
	}

	if (opts.update) {
		writeFileSync(
			LOCK_FILE,
			serializeLock(result.ompVersion, result.pkgVersion, result.fingerprint),
			'utf8'
		);
		if (opts.json) {
			console.log(JSON.stringify({ ...result, updated: true }, null, 2));
		} else {
			console.log(
				`\n[PASS] Impronta del setup di omp aggiornata: ${result.fingerprint.scenes.length} scene, ${Object.keys(result.fingerprint.files).length} file (omp ${result.ompVersion}, setup v${result.fingerprint.setupVersion}).\n`
			);
		}
		process.exit(0);
	}

	if (result.ok) {
		if (opts.json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			const versionNote = result.versionOnly
				? ` Versione omp aggiornata ${result.lockedOmpVersion} -> ${result.ompVersion}: sorgenti del setup identici (allinea il lock con --update quando vuoi).`
				: '';
			console.log(
				`\n[PASS] Setup grafico di omp allineato (omp ${result.ompVersion}, setup v${result.fingerprint.setupVersion}): ${result.fingerprint.scenes.length} scene e ${Object.keys(result.fingerprint.files).length} file di src/setup/** invariati.${versionNote}\n`
			);
		}
		process.exit(0);
	}

	if (opts.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.error('\n=============================================================');
		console.error(' [FAIL] IL SETUP GRAFICO DI OMP E\' CAMBIATO');
		console.error('=============================================================');
		console.error(`Versione omp rilevata: ${result.ompVersion} (${result.ompBin})`);
		console.error(`Pacchetto letto:       ${SETUP_PACKAGE}@${result.pkgVersion}`);
		console.error(`Impronta registrata:   omp ${result.lockedOmpVersion}, setup v${result.fingerprint.setupVersion}`);
		console.error('');
		printDifferences(result);
		console.error('\n=============================================================\n');
	}

	process.exit(1);
}

// Esegui main solo se chiamato direttamente da riga di comando
const isDirectExecution =
	Boolean(process.argv[1]) &&
	fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]).href);

if (isDirectExecution) {
	main().catch((err) => {
		console.error('Errore imprevisto durante il controllo del setup di omp:', err);
		process.exit(1);
	});
}
