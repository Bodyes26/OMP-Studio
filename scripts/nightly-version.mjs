#!/usr/bin/env node
// Genera una versione prerelease solo nel checkout temporaneo di GitHub Actions.
// Il repository resta sulla versione stabile finche' non viene eseguito release.mjs.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const write = (rel, text) => writeFileSync(join(ROOT, rel), text);

const buildId = process.argv[2];
const checkOnly = process.argv[3] === '--check';
if (!/^[1-9]\d*$/.test(buildId ?? '')) {
	console.error('Uso: node scripts/nightly-version.mjs <build-id-numerico> [--check]');
	process.exit(1);
}

const stableVersion = JSON.parse(read('package.json')).version;
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stableVersion);
if (!match) {
	console.error(`La versione sorgente deve essere stabile, ricevuta: ${stableVersion}`);
	process.exit(1);
}

const [, major, minor, patch] = match;
const version = `${major}.${minor}.${Number(patch) + 1}-nightly.${buildId}`;
const bumps = [
	['package.json', /("version":\s*)"\d+\.\d+\.\d+"/, `$1"${version}"`],
	['src-tauri/tauri.conf.json', /("version":\s*)"\d+\.\d+\.\d+"/, `$1"${version}"`],
	['src-tauri/Cargo.toml', /^(version\s*=\s*)"\d+\.\d+\.\d+"/m, `$1"${version}"`],
	[
		'src-tauri/Cargo.lock',
		/(name = "omp-studio-app"\s*[\r\n]+version = )"\d+\.\d+\.\d+"/,
		`$1"${version}"`
	]
];

const edits = bumps.map(([rel, pattern, replacement]) => {
	const before = read(rel);
	const after = before.replace(pattern, replacement);
	if (after === before) {
		console.error(`Sostituzione della versione nightly non applicabile in ${rel}`);
		process.exit(1);
	}
	return [rel, after];
});

if (!checkOnly) {
	for (const [rel, content] of edits) write(rel, content);
}
console.log(version);
