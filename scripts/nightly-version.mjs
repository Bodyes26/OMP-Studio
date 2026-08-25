#!/usr/bin/env node
// Genera una versione prerelease per la build nightly.
// Il repository resta sulla versione stabile finche' non viene eseguito release.mjs.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
export const write = (rel, text) => writeFileSync(join(ROOT, rel), text);

export const VERSION_FILES = [
	'package.json',
	'src-tauri/tauri.conf.json',
	'src-tauri/Cargo.toml',
	'src-tauri/Cargo.lock'
];

export function getNightlyVersion(buildId = Date.now()) {
	const rawId = String(buildId ?? Date.now());
	if (!/^[1-9]\d*$/.test(rawId)) {
		throw new Error(`build-id numerico non valido: ${buildId}`);
	}
	const stableVersion = JSON.parse(read('package.json')).version;
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stableVersion);
	if (!match) {
		throw new Error(`La versione sorgente deve essere stabile, ricevuta: ${stableVersion}`);
	}
	const [, major, minor, patch] = match;
	return `${major}.${minor}.${Number(patch) + 1}-nightly.${rawId}`;
}

export function computeVersionBumps(version) {
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

	return bumps.map(([rel, pattern, replacement]) => {
		const before = read(rel);
		const after = before.replace(pattern, replacement);
		if (after === before) {
			throw new Error(`Sostituzione della versione nightly non applicabile in ${rel}`);
		}
		return [rel, after];
	});
}

export function applyNightlyVersion(buildId, checkOnly = false) {
	const version = getNightlyVersion(buildId);
	const edits = computeVersionBumps(version);
	if (!checkOnly) {
		for (const [rel, content] of edits) write(rel, content);
	}
	return version;
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
	const args = process.argv.slice(2);
	const checkOnly = args.includes('--check');
	const positional = args.filter((a) => a !== '--check');
	const buildId = positional[0] || String(Date.now());
	try {
		const version = applyNightlyVersion(buildId, checkOnly);
		console.log(version);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
