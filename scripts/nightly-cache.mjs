import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
	realpathSync, renameSync, unlinkSync, writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const CACHE_SCHEMA_VERSION = 2;
export const getCacheFilePath = (root) => join(root, '.omp', 'cache', 'nightly-verification.json');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const emptyCache = () => ({ version: CACHE_SCHEMA_VERSION, gates: {} });
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function environmentSignature() {
	// Solo l'hash viene salvato: niente credenziali o valori privati in chiaro.
	// Il contesto del comando npm non cambia il codice verificato.
	return digest(JSON.stringify(Object.entries(process.env)
		.filter(([key]) => !/^(npm_|EFC_|PI_SESSION_)/i.test(key) &&
			!['INIT_CWD', '_', 'SHLVL', 'PWD', 'OLDPWD', 'PROMPT', 'PI_TOOL_CALL_ID', 'OMP_STUDIO_BRIDGE_TOKEN'].includes(key))
		.sort(([a], [b]) => a.localeCompare(b))));
}

function sourceFiles(root) {
	// Una chiamata per tutti gli input, inclusi untracked e cancellati. Non
	// scansionare build, prototipi e archivi locali ignorati mentre Studio li aggiorna.
	const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
		cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true
	});
	if (result.status !== 0 || result.error) throw new Error('Inventario sorgenti non disponibile');
	const files = new Set(result.stdout.split('\0').filter(Boolean));
	// Le variabili locali di Vite sono input anche se non versionate.
	for (const name of readdirSync(root)) {
		if (name === '.env' || name.startsWith('.env.')) files.add(name);
	}
	return [...files].sort();
}

function fileEntries(root, files) {
	const canonicalRoot = realpathSync(root);
	return files.map((name) => {
		const path = join(root, name);
		let stat;
		try { stat = lstatSync(path); }
		catch (error) { if (error.code === 'ENOENT') return [name, '<deleted>']; throw error; }
		if (stat.isSymbolicLink()) {
			const target = realpathSync(path);
			const rel = relative(canonicalRoot, target);
			if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Input esterno non classificato');
			if (!lstatSync(target).isFile()) throw new Error('Directory collegata non classificata');
			return [name, target, digest(readFileSync(path))];
		}
		if (!stat.isFile()) throw new Error('Submodule o input non classificato');
		return [name, digest(readFileSync(path))];
	});
}

function receipt(root, entries) {
	return digest(JSON.stringify([
		CACHE_SCHEMA_VERSION, realpathSync(root), process.platform, process.arch,
		process.version, process.execArgv, environmentSignature(),
		entries.sort(([a], [b]) => a.localeCompare(b))
	]));
}

export function computeFrontendFingerprint(root) {
	try {
		// La documentazione del progetto (in particolare il diario reale) non
		// e una fixture dei test. Le fixture Markdown sotto test/ restano incluse.
		const inputs = sourceFiles(root).filter((name) => !name.startsWith('docs/') && !/^[^/]+\.md$/i.test(name));
		const entries = fileEntries(root, inputs);
		for (const name of ['.package-lock.json', '.modules.yaml']) {
			const path = join(root, 'node_modules', name);
			entries.push([`installed:${name}`, existsSync(path) ? digest(readFileSync(path)) : '<absent>']);
		}
		return receipt(root, entries);
	} catch {
		return null;
	}
}

export function computeFrontendFingerprintDetails(root) {
	try {
		const inputs = sourceFiles(root).filter((name) => !name.startsWith('docs/') && !/^[^/]+\.md$/i.test(name));
		const entries = fileEntries(root, inputs);
		for (const name of ['.package-lock.json', '.modules.yaml']) {
			const path = join(root, 'node_modules', name);
			entries.push([`installed:${name}`, existsSync(path) ? digest(readFileSync(path)) : '<absent>']);
		}
		const envSig = environmentSignature();
		const rec = receipt(root, entries);
		return { receipt: rec, entries, envSig };
	} catch (e) {
		return { receipt: null, error: e?.message || String(e) };
	}
}

// Cargo prepara SEMPRE gli harness prima del riuso del runtime: risolve
// freshness, include generati, dipendenze e opzioni linker. Solo i .rs non bastano.
export function computeRustFingerprint(root, { artifacts, toolchain } = {}) {
	try {
		if (!Array.isArray(artifacts) || artifacts.length === 0 || !toolchain) return null;
		const inputs = sourceFiles(root).filter((name) =>
			/^(src-tauri|extensions|assets|scripts|\.cargo)\//.test(name) ||
			/^(package\.json|bun\.lock|Cargo\.(toml|lock)|rust-toolchain(?:\.toml)?|\.env(?:\..*)?)$/.test(name));
		const entries = fileEntries(root, inputs);
		entries.push(['toolchain', toolchain]);
		for (const path of [...new Set(artifacts)].sort()) {
			entries.push([`harness:${realpathSync(path)}`, digest(readFileSync(path))]);
		}
		const configDirs = new Set();
		let dir = resolve(root, 'src-tauri');
		while (true) {
			configDirs.add(join(dir, '.cargo'));
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		configDirs.add(resolve(process.env.CARGO_HOME || join(homedir(), '.cargo')));
		for (const folder of [...configDirs].sort()) {
			for (const name of ['config', 'config.toml']) {
				const path = join(folder, name);
				entries.push([`cargo-config:${path}`, existsSync(path) ? digest(readFileSync(path)) : '<absent>']);
			}
		}
		// Una dipendenza path puo leggere dati runtime esterni che Cargo non traccia.
		// In quel caso si esegue la suite completa, senza certificare il riuso.
		for (const name of inputs.filter((file) => /(?:^|\/)Cargo\.toml$/.test(file))) {
			if (/\bpath\s*=/.test(readFileSync(join(root, name), 'utf8'))) return null;
		}
		return receipt(root, entries);
	} catch {
		return null;
	}
}

export function readNightlyCache(root) {
	try {
		const data = JSON.parse(readFileSync(getCacheFilePath(root), 'utf8'));
		if (data?.version !== CACHE_SCHEMA_VERSION || !data.gates || Array.isArray(data.gates) || typeof data.gates !== 'object') return emptyCache();
		for (const entry of Object.values(data.gates)) {
			if (!entry || !validHash(entry.fingerprint) || !Number.isFinite(Date.parse(entry.passedAt))) return emptyCache();
		}
		return data;
	} catch {
		return emptyCache();
	}
}

export function canReuseGate(name, fingerprint, cache) {
	return validHash(fingerprint) && cache?.version === CACHE_SCHEMA_VERSION &&
		cache.gates?.[name]?.fingerprint === fingerprint &&
		Number.isFinite(Date.parse(cache.gates[name].passedAt));
}

function replaceCache(root, data) {
	const path = getCacheFilePath(root);
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
		// Se rename fallisce, conserva la prova precedente senza finestra unlink+rename.
		renameSync(temp, path);
		return true;
	} catch {
		return false;
	} finally {
		try { unlinkSync(temp); } catch {}
	}
}

export function writeNightlyCache(root, successfulGates) {
	const cache = readNightlyCache(root);
	for (const [name, entry] of Object.entries(successfulGates)) {
		if (!validHash(entry?.fingerprint)) continue;
		cache.gates[name] = {
			...(entry.details || {}), fingerprint: entry.fingerprint,
			passedAt: new Date().toISOString()
		};
	}
	return replaceCache(root, cache);
}

export function invalidateGates(root, names) {
	const cache = readNightlyCache(root);
	for (const name of names) delete cache.gates[name];
	if (!replaceCache(root, cache)) {
		try { unlinkSync(getCacheFilePath(root)); }
		catch (error) { if (error.code !== 'ENOENT') throw error; }
	}
}
