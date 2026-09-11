#!/usr/bin/env node
/**
 * Runner degli smoke test per OMP Studio.
 * Verifica in modo rapido e deterministico:
 * 1. Normalizzazione dei percorsi di progetto (Windows e POSIX)
 * 2. Validazione, parsing e serializzazione dello store tasks.json
 * 3. Protocollo wire OMP (frame RPC, streaming, deltas, comandi slash)
 * 4. Contratti del Laboratorio prototipi (involucro eventi, revisioni, renderer)
 * 5. Persistenza dei prototipi (proto/<id>, archivio bozze, scritture atomiche)
 * 6. Confinamento Laboratorio (allowlist tool, percorsi reali e protezione symlink)
 * 7. Concorrenza principale e Laboratorio (eventi, input e abort separati)
 * 8. Catalogo dipendenze e compiler Laboratorio (bundle fidato, VFS chiuso, worker)
 * 9. Renderer Chromium gestito e policy di rete (Chromium versionato, loopback CDP, recupero)
 * 10. Strumenti visuali Laboratorio (selezione elementi, annotazioni, viewport, rifiuto riferimenti obsoleti)
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = join(ROOT, 'test', 'smoke.test.ts');
// L'alias `$lib` dei moduli localizzati non esiste per Node: va registrato prima dei test.
const ALIAS_REGISTER = pathToFileURL(join(ROOT, 'test', 'register-alias.mjs')).href;

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
