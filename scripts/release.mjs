#!/usr/bin/env node
// Bump di versione allineato sui tre file che la contengono + chiusura della
// sezione [Unreleased] del changelog. Non committa e non tagga: stampa i
// comandi git da eseguire, la decisione resta all'utente.
//
//   npm run release -- 0.1.1     bump + chiude [Unreleased]
//   npm run release -- --notes   stampa le note dell'ultima versione rilasciata

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const write = (rel, text) => writeFileSync(join(ROOT, rel), text);

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

const arg = process.argv[2];

if (arg === '--notes' || arg === '-n') {
	const changelog = read('CHANGELOG.md');
	const version = process.argv[3] ?? latestVersion(changelog);
	const body = version && section(changelog, version);
	if (!body) {
		console.error(`Nessuna sezione per la versione ${version ?? '(nessuna)'} in CHANGELOG.md`);
		process.exit(1);
	}
	console.log(body);
	process.exit(0);
}

if (!/^\d+\.\d+\.\d+$/.test(arg ?? '')) {
	console.error('Uso: npm run release -- <major.minor.patch> | --notes [versione]');
	process.exit(1);
}
const version = arg;

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
	['package.json', /("version":\s*)"\d+\.\d+\.\d+"/, `$1"${version}"`],
	['src-tauri/tauri.conf.json', /("version":\s*)"\d+\.\d+\.\d+"/, `$1"${version}"`],
	['src-tauri/Cargo.toml', /^(version\s*=\s*)"\d+\.\d+\.\d+"/m, `$1"${version}"`],
	[
		'src-tauri/Cargo.lock',
		/(name = "omp-studio-app"\s*[\r\n]+version = )"\d+\.\d+\.\d+"/,
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

console.log(`
Note di release:
${pending.split('\n').map((l) => `  ${l}`).join('\n')}

Comandi da eseguire:
  { echo v${version}; echo; node scripts/release.mjs --notes; } > .release-notes.md
  git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
  git commit -m "release: v${version}"
  git tag -a v${version} -F .release-notes.md
  git push --follow-tags
  npx tauri build
  gh release create v${version} "src-tauri/target/release/bundle/nsis/OMP Studio_${version}_x64-setup.exe" --title "v${version}" --notes-file .release-notes.md`);
