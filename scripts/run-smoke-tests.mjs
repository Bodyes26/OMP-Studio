#!/usr/bin/env node
/**
 * Runner degli smoke test per OMP Studio.
 * Verifica in modo rapido e deterministico:
 * 1. Normalizzazione dei percorsi di progetto (Windows e POSIX)
 * 2. Validazione, parsing e serializzazione dello store tasks.json
 * 3. Protocollo wire OMP (frame RPC, streaming, deltas, comandi slash)
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = join(ROOT, 'test', 'smoke.test.ts');

console.log('=== OMP Studio Smoke Tests ===\n');

const child = spawn(
	process.execPath,
	['--no-warnings', '--experimental-strip-types', '--test', TEST_FILE],
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
