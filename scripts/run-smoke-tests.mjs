#!/usr/bin/env node
/**
 * Runner degli smoke test per OMP Studio.
 * Esegue con Node (strip-types) l'aggregatore test/smoke.test.ts, che importa
 * tutti i file test/*.test.ts: percorsi Windows/POSIX, store dei task, protocollo
 * wire omp, chat (ask, reveal, strumenti), corsie (store, routing, integrazione,
 * processi), Laboratorio, updater e i contratti dei comandi nativi.
 * Prima dell'esecuzione verifica che nessun file di test sia rimasto fuori
 * dall'aggregatore.
 */

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = join(ROOT, 'test', 'smoke.test.ts');
// L'alias `$lib` dei moduli localizzati non esiste per Node: va registrato prima dei test.
const ALIAS_REGISTER = pathToFileURL(join(ROOT, 'test', 'register-alias.mjs')).href;

// Ogni file di test va importato dall'aggregatore: un test dimenticato non
// gira mai, nemmeno nel gate, e da' una falsa sensazione di copertura.
const aggregator = readFileSync(TEST_FILE, 'utf8');
const orphanTests = readdirSync(join(ROOT, 'test'))
	.filter((name) => name.endsWith('.test.ts') && name !== 'smoke.test.ts')
	.filter((name) => !aggregator.includes(`'./${name}'`));
if (orphanTests.length > 0) {
	console.error('[FAIL] File di test non importati da test/smoke.test.ts:');
	for (const name of orphanTests) console.error(`  - test/${name}`);
	process.exit(1);
}

console.log('=== OMP Studio Smoke Tests ===\n');

const child = spawn(
	process.execPath,
	['--no-warnings', '--experimental-strip-types', '--import', ALIAS_REGISTER, '--test', TEST_FILE],
	{
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env, FORCE_COLOR: '1' }
	}
);

child.on('error', (err) => {
	console.error('Errore durante l\'avvio dello smoke test:', err);
	process.exit(1);
});

child.on('exit', (code) => {
	if (code === 0) {
		console.log('\n[PASS] Tutti gli smoke test critici sono superati.');
		process.exit(0);
	} else {
		console.error(`\n[FAIL] Smoke test falliti con codice di uscita ${code}.`);
		process.exit(code ?? 1);
	}
});
