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

/**
 * Normalizza qualsiasi input di build-id (stringa data ISO, timestamp secondi o ms, numero build).
 * Garantisce la monotonicita' rispetto a vecchi ID in millisecondi (~13 cifre)
 * convertendo i timestamp in secondi (10 cifre) in millisecondi.
 */
export function normalizeBuildId(buildId) {
	if (buildId === undefined || buildId === null || buildId === '') {
		return Date.now();
	}

	const str = String(buildId).trim();

	// Se e' una stringa data ISO (es. "2026-09-01T12:00:00Z" o github.run_started_at)
	if (isNaN(Number(str))) {
		const parsed = Date.parse(str);
		if (!isNaN(parsed) && parsed > 0) {
			return parsed;
		}
		throw new Error(`build-id data non valido: ${buildId}`);
	}

	const num = Number(str);
	if (!Number.isInteger(num) || num <= 0) {
		throw new Error(`build-id numerico non valido: ${buildId}`);
	}

	// Se il timestamp e' espresso in secondi (10 cifre, es. 1740838123),
	// lo convertiamo in millisecondi per preservare l'ordinamento monotono SemVer
	// rispetto a ID precedenti generati in millisecondi (13 cifre).
	if (num >= 1_000_000_000 && num < 100_000_000_000) {
		return num * 1000;
	}

	return num;
}

export function getNightlyVersion(buildId) {
	const normalizedId = normalizeBuildId(buildId);
	const stableVersion = JSON.parse(read('package.json')).version;
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stableVersion);
	if (!match) {
		throw new Error(`La versione sorgente deve essere stabile, ricevuta: ${stableVersion}`);
	}
	const [, major, minor, patch] = match;
	return `${major}.${minor}.${Number(patch) + 1}-nightly.${normalizedId}`;
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
	const printIdOnly = args.includes('--print-id');
	const printVersionOnly = args.includes('--print-version');
	const positional = args.filter(
		(a) => a !== '--check' && a !== '--print-id' && a !== '--print-version'
	);
	const rawInput = positional[0] || undefined;

	try {
		if (printIdOnly) {
			console.log(normalizeBuildId(rawInput));
		} else if (printVersionOnly) {
			console.log(getNightlyVersion(rawInput));
		} else {
			const version = applyNightlyVersion(rawInput, checkOnly);
			console.log(version);
		}
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
