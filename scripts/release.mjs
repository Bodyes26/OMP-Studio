#!/usr/bin/env node
// Bump di versione allineato sui quattro file che la contengono + chiusura della
// sezione [Unreleased] del changelog. Non committa e non tagga: stampa i
// comandi git da eseguire, la decisione resta all'utente.
//
//   npm run release -- 0.1.1     bump + chiude [Unreleased] (con validazione preliminare)
//   npm run release -- --notes   stampa le note dell'ultima versione rilasciata
//   npm run release -- --check   valida l'allineamento delle versioni nei 4 file
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const write = (rel, text) => writeFileSync(join(ROOT, rel), text);

export const VERSION_FILES = [
	'package.json',
	'src-tauri/tauri.conf.json',
	'src-tauri/Cargo.toml',
	'src-tauri/Cargo.lock'
];

/** Estrae le versioni correnti dichiarate nei quattro file di configurazione. */
export function getVersions() {
	let pkgVersion = null;
	try {
		pkgVersion = JSON.parse(read('package.json')).version ?? null;
	} catch {}

	let tauriVersion = null;
	try {
		tauriVersion = JSON.parse(read('src-tauri/tauri.conf.json')).version ?? null;
	} catch {}

	let cargoTomlVersion = null;
	try {
		const m = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m);
		cargoTomlVersion = m ? m[1] : null;
	} catch {}

	let cargoLockVersion = null;
	try {
		const m = read('src-tauri/Cargo.lock').match(
			/(?:name = "omp-studio-app"\s*[\r\n]+version = )"([^"]+)"/
		);
		cargoLockVersion = m ? m[1] : null;
	} catch {}

	return {
		'package.json': pkgVersion,
		'src-tauri/tauri.conf.json': tauriVersion,
		'src-tauri/Cargo.toml': cargoTomlVersion,
		'src-tauri/Cargo.lock': cargoLockVersion
	};
}

/**
 * Valida che tutti i 4 file abbiano la stessa versione.
 * Restituisce { ok: boolean, version?: string, versions: Record<string, string|null>, error?: string }.
 */
export function checkVersionAlignment({ silent = false, versions = null } = {}) {
	const resolvedVersions = versions ?? getVersions();
	const entries = Object.entries(resolvedVersions);

	const missing = entries.filter(([, v]) => !v);
	if (missing.length > 0) {
		const msg = `Impossibile determinare la versione nei seguenti file: ${missing.map(([f]) => f).join(', ')}`;
		if (!silent) console.error(`Errore: ${msg}`);
		return { ok: false, error: msg, versions: resolvedVersions };
	}

	const distinct = Array.from(new Set(Object.values(resolvedVersions)));
	if (distinct.length > 1) {
		const details = entries.map(([f, v]) => `  ${f}: ${v ?? '(non trovata)'}`).join('\n');
		const msg = `Disallineamento versioni rilevato tra i file di configurazione:\n${details}`;
		if (!silent) {
			console.error(`Errore: ${msg}`);
			console.error('Tutti i 4 file devono avere esattamente la stessa versione prima di procedere.');
		}
		return { ok: false, error: msg, versions: resolvedVersions, distinct };
	}

	const currentVersion = distinct[0];
	if (!silent) {
		console.log(`Versioni allineate (${currentVersion}):`);
		for (const [f, v] of entries) {
			console.log(`  ${f}: ${v}`);
		}
	}
	return { ok: true, version: currentVersion, versions: resolvedVersions };
}

/** Estrae il corpo di una sezione `## [x.y.z] ...` dal changelog. */
function section(changelog, heading) {
	const lines = changelog.split(/\r?\n/);
	const start = lines.findIndex((l) => l.startsWith(`## [${heading}]`));
	if (start === -1) return null;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => l.startsWith('## '));
	return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

function latestVersion(changelog) {
	const m = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
	return m ? m[1] : null;
}

export function runCli(argv = process.argv.slice(2)) {
	const arg = argv[0];

	if (arg === '--help' || arg === '-h') {
		console.log('Uso: npm run release -- <major.minor.patch> | --notes [versione] | --check');
		process.exit(0);
	}
	if (arg === '--check' || arg === '-c' || arg === '--verify') {
		const result = checkVersionAlignment();
		process.exit(result.ok ? 0 : 1);
	}
	if (arg === '--notes' || arg === '-n') {
		const changelog = read('CHANGELOG.md');
		const version = argv[1] ?? latestVersion(changelog);
		const body = version && section(changelog, version);
		if (!body) {
			console.error(`Nessuna sezione per la versione ${version ?? '(nessuna)'} in CHANGELOG.md`);
			process.exit(1);
		}
		console.log(body);
		process.exit(0);
	}

	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(arg ?? '')) {
		console.error('Uso: npm run release -- <major.minor.patch> | --notes [versione] | --check');
		process.exit(1);
	}
	const version = arg;

// Validazione preliminare fondamentale: i 4 file devono essere allineati prima del bump!
const preCheck = checkVersionAlignment({ silent: false });
if (!preCheck.ok) {
	console.error('Bump interrotto: i 4 file di versione non sono allineati. Risolvere la discrepanza prima di rilasciare.');
	process.exit(1);
}

// Gate pre-release: esegui gli smoke test contro le regressioni critiche
console.log('Esecuzione gate smoke test pre-release...');
const smokeCheck = spawnSync(process.execPath, ['scripts/run-smoke-tests.mjs'], {
	cwd: ROOT,
	stdio: 'inherit'
});
if (smokeCheck.status !== 0) {
	console.error('Bump interrotto: gli smoke test hanno fallito. Risolvere le regressioni prima del rilascio.');
	process.exit(1);
}

const changelog = read('CHANGELOG.md');
if (section(changelog, version) !== null) {
	console.error(`La versione ${version} è già presente in CHANGELOG.md`);
	process.exit(1);
}
const pending = section(changelog, 'Unreleased');
if (!pending) {
	console.error('[Unreleased] è vuota: nulla da rilasciare. Annota prima le modifiche.');
	process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

// I quattro file che devono restare allineati. Le sostituzioni sono ancorate per
// non toccare le versioni delle dipendenze in Cargo.toml / Cargo.lock.
const bumps = [
	['package.json', /("version":\s*)"[^"]+"/, `$1"${version}"`],
	['src-tauri/tauri.conf.json', /("version":\s*)"[^"]+"/, `$1"${version}"`],
	['src-tauri/Cargo.toml', /^(version\s*=\s*)"[^"]+"/m, `$1"${version}"`],
	[
		'src-tauri/Cargo.lock',
		/(name = "omp-studio-app"\s*[\r\n]+version = )"[^"]+"/,
		`$1"${version}"`
	],
	// Tollerante al fine riga: un CHANGELOG in CRLF non deve far fallire la
	// sostituzione in silenzio.
	[
		'CHANGELOG.md',
		/## \[Unreleased\][\s\S]*?(?=\r?\n## \[)/,
		`## [Unreleased]\n\n## [${version}] - ${today}\n\n${pending}`
	]
];

// Prima si valida tutto, poi si scrive: un fallimento a metà lascerebbe le
// versioni disallineate tra i file.
const edits = bumps.map(([rel, pattern, replacement]) => {
	const before = read(rel);
	const after = before.replace(pattern, replacement);
	if (after === before) {
		console.error(`Sostituzione non applicabile in ${rel} (versione assente o già ${version}?)`);
		process.exit(1);
	}
	return [rel, after];
});
for (const [rel, content] of edits) {
	write(rel, content);
	console.log(`  ${rel} -> ${rel === 'CHANGELOG.md' ? `sezione [${version}] - ${today}` : version}`);
}

// Verifica di coerenza finale: controlla che tutti i file siano allineati alla nuova versione
const postCheck = checkVersionAlignment({ silent: true });
if (!postCheck.ok || postCheck.version !== version) {
	console.error(`Errore di coerenza: dopo la scrittura, le versioni non risultano allineate alla versione target ${version}.`);
	process.exit(1);
}

console.log(`
Note di release:
${pending.split('\n').map((l) => `  ${l}`).join('\n')}

Comandi da eseguire:
  { echo v${version}; echo; node scripts/release.mjs --notes; } > .release-notes.md
  git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
  git commit -m "release: v${version}"
  git tag -a v${version} -F .release-notes.md
  git push --follow-tags

Il push del tag avvia .github/workflows/release.yml: la release viene pubblicata
solo dopo la compilazione dell'installer Windows x64 e del DMG universale macOS.`);
}

const isDirectExecution =
	Boolean(process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)));

if (isDirectExecution) {
	runCli();
}
