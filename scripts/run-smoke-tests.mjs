#!/usr/bin/env node
/**
 * Runner degli smoke test per OMP Studio (Gate NL4 / NLC-002 / NLC-005).
 * Scopre automaticamente tutti i file `test/*.test.ts` ed esegue ciascun file
 * in un processo Node isolato con `--test` e `--test-concurrency=N`,
 * preservando lo shim delle rune Svelte 5 e il loader alias per ogni processo.
 *
 * Opzioni CLI:
 *   --prepared          Omette la preparazione frontend (se gia' eseguita dal preflight)
 *   --concurrency, -c   Numero di test eseguiti in parallelo (default: 4)
 *   --file, -f          Filtra per nome file (es. --file paths.test.ts), ripetibile
 */

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareFrontend } from './prepare-frontend.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = join(ROOT, 'test');

// Shim delle rune Svelte 5 e hook di risoluzione ($remote-protocol e import relativi TypeScript) prima dei test.
const ALIAS_REGISTER = pathToFileURL(join(ROOT, 'test', 'register-alias.mjs')).href;

function parseArgs(argv) {
	let prepared = false;
	let concurrency = 4;
	const targetFiles = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--prepared') {
			prepared = true;
			continue;
		}
		const [option, inline] = arg.split('=', 2);
		if (!['--concurrency', '-c', '--file', '-f'].includes(option)) {
			throw new Error(`Opzione sconosciuta: ${arg}`);
		}
		const value = inline ?? argv[++i];
		if (option === '--concurrency' || option === '-c') {
			if (!/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) {
				throw new Error(`Concorrenza non valida: ${value ?? '(assente)'}`);
			}
			concurrency = Number(value);
		} else {
			if (!value || value !== basename(value)) {
				throw new Error('--file richiede il nome di un file in test/');
			}
			targetFiles.push(value);
		}
	}
	return { prepared, concurrency, targetFiles };
}

async function main() {
	const { prepared, concurrency, targetFiles } = parseArgs(process.argv.slice(2));

	// Il standalone prepara sempre: mtime e sola esistenza non rilevano
	// messaggi eliminati o ripristinati da Git con timestamp precedenti.
	if (!prepared) {
		console.log('Preparazione frontend (Paraglide & SvelteKit sync)...');
		await prepareFrontend(ROOT);
	}

	// 2. Auto-discovery di tutti i file *.test.ts in test/ (escluso eventuale aggregatore dismesso)
	const allTests = readdirSync(TEST_DIR)
		.filter((name) => name.endsWith('.test.ts') && name !== 'smoke.test.ts')
		.sort();

	if (allTests.length === 0) {
		console.error('[FAIL] Nessun file di test trovato in test/');
		process.exit(1);
	}

	// 3. Filtraggio opzionale con --file
	let testsToRun = allTests;
	if (targetFiles.length > 0) {
		for (const req of targetFiles) {
			if (!allTests.includes(req)) {
				console.error(`[FAIL] File di test richiesto non trovato: test/${req}`);
				process.exit(1);
			}
		}
		testsToRun = allTests.filter((name) => targetFiles.includes(name));
	}

	console.log('=== OMP Studio Smoke Tests ===\n');
	console.log(`Esecuzione di ${testsToRun.length} file di test (concorrenza: ${concurrency})...\n`);

	const testPaths = testsToRun.map((name) => join(TEST_DIR, name));
	const testArgs = [
		'--no-warnings',
		'--experimental-strip-types',
		'--import', ALIAS_REGISTER,
		'--test',
		`--test-concurrency=${concurrency}`
	];
	if (!process.env.NODE_TEST_REPORTER) {
		testArgs.push('--test-reporter=spec');
	}
	testArgs.push(...testPaths);

	const child = spawn(process.execPath, testArgs, {
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env, FORCE_COLOR: '1' }
	});

	child.on('error', (err) => {
		console.error('Errore durante l\'avvio dello smoke test:', err);
		process.exit(1);
	});

	child.on('exit', (code) => {
		if (code === 0) {
			console.log('\n[PASS] Tutti gli smoke test selezionati sono superati.');
			process.exit(0);
		} else {
			console.error(`\n[FAIL] Smoke test falliti con codice di uscita ${code}.`);
			process.exit(code ?? 1);
		}
	});
}

main().catch((err) => {
	console.error('Errore fatale nel runner smoke test:', err);
	process.exit(1);
});
