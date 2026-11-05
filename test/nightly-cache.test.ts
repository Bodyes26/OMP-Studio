import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	canReuseGate,
	CACHE_SCHEMA_VERSION,
	computeFrontendFingerprint,
	computeRustFingerprint,
	getCacheFilePath,
	invalidateGates,
	readNightlyCache,
	writeNightlyCache
} from '../scripts/nightly-cache.mjs';

describe('Cache e Fingerprint delle verifiche Nightly (nightly-cache.mjs)', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), 'omp-test-cache-'));
		const initialized = spawnSync('git', ['init', '-q', testDir], { encoding: 'utf8', windowsHide: true });
		assert.equal(initialized.status, 0, initialized.stderr);
		writeFileSync(join(testDir, '.gitignore'), '/.omp/\n/src/lib/paraglide/\n/src-tauri/target/\n/build/\n');
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	});

	it('rileva modifiche ai sorgenti e file untracked nel fingerprint frontend', () => {
		// Struttura minima di un frontend
		mkdirSync(join(testDir, 'src'), { recursive: true });
		writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
		writeFileSync(join(testDir, 'src', 'App.svelte'), '<main>Hello</main>');

		const fp1 = computeFrontendFingerprint(testDir);

		// Idempotenza
		const fp2 = computeFrontendFingerprint(testDir);
		assert.equal(fp1, fp2);

		// Modifica di un file esistente
		writeFileSync(join(testDir, 'src', 'App.svelte'), '<main>Hello World</main>');
		const fp3 = computeFrontendFingerprint(testDir);
		assert.notEqual(fp1, fp3, 'La modifica di un file sorgente deve cambiare il fingerprint');

		// Aggiunta di un file non tracciato in src/
		writeFileSync(join(testDir, 'src', 'untracked.ts'), 'export const x = 1;');
		const fp4 = computeFrontendFingerprint(testDir);
		assert.notEqual(fp3, fp4, 'Un nuovo file untracked in src/ deve invalidare il fingerprint');
	});

	it('il diario reale non invalida i test, ma una fixture del diario si', () => {
		mkdirSync(join(testDir, 'src'), { recursive: true });
		writeFileSync(join(testDir, 'src', 'index.ts'), 'export const value = 1;');
		const before = computeFrontendFingerprint(testDir);
		mkdirSync(join(testDir, 'docs', 'diario'), { recursive: true });
		writeFileSync(join(testDir, 'docs', 'diario', '2026-11.md'), '# Lavori del progetto\n');
		assert.equal(computeFrontendFingerprint(testDir), before);
		mkdirSync(join(testDir, 'test', 'fixtures'), { recursive: true });
		writeFileSync(join(testDir, 'test', 'fixtures', 'diario.md'), '# Dati sintetici\n');
		assert.notEqual(computeFrontendFingerprint(testDir), before);
	});

	it('ignora l’identificativo della chiamata agente ma invalida variabili sconosciute', () => {
		const oldCall = process.env.PI_TOOL_CALL_ID;
		const oldInput = process.env.NLC_TEST_INPUT;
		try {
			process.env.PI_TOOL_CALL_ID = 'call-a';
			const first = computeFrontendFingerprint(testDir);
			process.env.PI_TOOL_CALL_ID = 'call-b';
			assert.equal(computeFrontendFingerprint(testDir), first);
			process.env.NLC_TEST_INPUT = 'input-cambiato';
			assert.notEqual(computeFrontendFingerprint(testDir), first);
		} finally {
			if (oldCall === undefined) delete process.env.PI_TOOL_CALL_ID;
			else process.env.PI_TOOL_CALL_ID = oldCall;
			if (oldInput === undefined) delete process.env.NLC_TEST_INPUT;
			else process.env.NLC_TEST_INPUT = oldInput;
		}
	});

	it('ignora cartelle generate instabili (paraglide) ed env npm transitorie nel frontend', () => {
		mkdirSync(join(testDir, 'src', 'lib', 'paraglide'), { recursive: true });
		writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
		writeFileSync(join(testDir, 'src', 'index.ts'), 'export const a = 1;');

		const fpBase = computeFrontendFingerprint(testDir);

		// Mutazione di un file in src/lib/paraglide non deve alterare il fingerprint sorgente
		writeFileSync(join(testDir, 'src', 'lib', 'paraglide', 'messages.js'), 'export const m = {};');
		const fpAfterGenerated = computeFrontendFingerprint(testDir);
		assert.equal(fpBase, fpAfterGenerated, 'Gli output generati in paraglide devono essere ignorati');

		// Mutazione di variabili ambiente npm transitorie non deve alterare il fingerprint
		const oldEvent = process.env.npm_lifecycle_event;
		const oldCmd = process.env.npm_command;
		try {
			process.env.npm_lifecycle_event = 'verify:nightly';
			process.env.npm_command = 'run-script';
			const fpWithNpmEnv = computeFrontendFingerprint(testDir);
			assert.equal(fpBase, fpWithNpmEnv, 'Le variabili env transitorie di npm non devono alterare il fingerprint');
		} finally {
			if (oldEvent === undefined) delete process.env.npm_lifecycle_event;
			else process.env.npm_lifecycle_event = oldEvent;
			if (oldCmd === undefined) delete process.env.npm_command;
			else process.env.npm_command = oldCmd;
		}
	});

	it('rileva modifiche a src-tauri, extensions e assets/fonts nel fingerprint Rust', () => {
		mkdirSync(join(testDir, 'src-tauri', 'src'), { recursive: true });
		mkdirSync(join(testDir, 'extensions'), { recursive: true });
		mkdirSync(join(testDir, 'assets', 'fonts'), { recursive: true });

		writeFileSync(join(testDir, 'src-tauri', 'Cargo.toml'), '[package]\nname="test"\nversion="1.0.0"');
		writeFileSync(join(testDir, 'src-tauri', 'src', 'lib.rs'), 'pub fn test() {}');
		writeFileSync(join(testDir, 'extensions', 'studio-docs.ts'), 'export const doc = true;');
		writeFileSync(join(testDir, 'assets', 'fonts', 'font.ttf'), 'fake-ttf-bytes');

		const artifact = join(testDir, 'native-harness.exe');
		writeFileSync(artifact, 'compiled-test-fixture');
		const inputs = { artifacts: [artifact], toolchain: 'rustc fixture-1 / cargo fixture-1 / rustdoc fixture-1' };
		const fp1 = computeRustFingerprint(testDir, inputs);

		// Modifica a una estensione inclusa da Rust (via include_str!)
		writeFileSync(join(testDir, 'extensions', 'studio-docs.ts'), 'export const doc = false;');
		const fp2 = computeRustFingerprint(testDir, inputs);
		assert.notEqual(fp1, fp2, 'Modifica in extensions/ deve invalidare il fingerprint Rust');

		// Modifica al font incluso (via include_bytes!)
		writeFileSync(join(testDir, 'assets', 'fonts', 'font.ttf'), 'modified-font');
		const fp3 = computeRustFingerprint(testDir, inputs);
		assert.notEqual(fp2, fp3, 'Modifica in assets/fonts/ deve invalidare il fingerprint Rust');

		// Ignora file dentro target/
		mkdirSync(join(testDir, 'src-tauri', 'target', 'debug'), { recursive: true });
		writeFileSync(join(testDir, 'src-tauri', 'target', 'debug', 'build.log'), 'cargo log');
		const fp4 = computeRustFingerprint(testDir, inputs);
		assert.equal(fp3, fp4, 'File in src-tauri/target/ devono essere esclusi');
		writeFileSync(artifact, 'different-compiled-tests');
		const changedBinary = computeRustFingerprint(testDir, inputs);
		assert.notEqual(changedBinary, fp4);
		assert.notEqual(computeRustFingerprint(testDir, { ...inputs, toolchain: 'rustc fixture-2' }), changedBinary);
		assert.equal(computeRustFingerprint(testDir), null, 'Senza artefatti preparati da Cargo non si certifica il runtime');
		assert.equal(computeRustFingerprint(testDir, { ...inputs, toolchain: null }), null);
	});

	it('gestisce cache corrotta o mancante in modo fail-closed', () => {
		// Cache mancante
		const cacheEmpty = readNightlyCache(testDir);
		assert.deepEqual(cacheEmpty.gates, {});

		// Cache corrotta (JSON non valido)
		const cachePath = getCacheFilePath(testDir);
		mkdirSync(join(testDir, '.omp', 'cache'), { recursive: true });
		writeFileSync(cachePath, 'INVALID JSON CONTENT {{{', 'utf8');

		const cacheCorrupt = readNightlyCache(testDir);
		assert.deepEqual(cacheCorrupt.gates, {});

		// Cache con schema obsoleto/sconosciuto
		writeFileSync(cachePath, JSON.stringify({ version: 999, gates: { rust: {} } }), 'utf8');
		const cacheUnknown = readNightlyCache(testDir);
		assert.deepEqual(cacheUnknown.gates, {});
		writeFileSync(cachePath, JSON.stringify({ version: CACHE_SCHEMA_VERSION, gates: { rust: { fingerprint: 'non-certificato', passedAt: 'ieri' } } }));
		assert.deepEqual(readNightlyCache(testDir).gates, {});
	});

	it('invalida selettivamente le prove dalla cache in caso di errore o abort', () => {
		const fp = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
		writeNightlyCache(testDir, {
			rust: { fingerprint: fp, details: { totalDurationMs: 1200 } },
			frontend: { fingerprint: fp, details: { durationMs: 800 } }
		});

		let cache = readNightlyCache(testDir);
		assert.equal(cache.gates.rust.fingerprint, fp);
		assert.equal(cache.gates.frontend.fingerprint, fp);

		// Invalida solo rust
		invalidateGates(testDir, ['rust']);
		cache = readNightlyCache(testDir);
		assert.equal(cache.gates.rust, undefined);
		assert.equal(cache.gates.frontend.fingerprint, fp);
	});

	it('salva atomicamente le prove riuscite e consente il riuso con fingerprint identico', () => {
		const fp = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

		const saved = writeNightlyCache(testDir, {
			rust: { fingerprint: fp, details: { compileDurationMs: 500, runtimeDurationMs: 700, totalDurationMs: 1200 } }
		});

		assert.equal(saved, true);

		const cache = readNightlyCache(testDir);
		assert.equal(cache.gates.rust.fingerprint, fp);
		assert.equal(cache.gates.rust.totalDurationMs, 1200);

		assert.equal(canReuseGate('rust', fp, cache), true);
		assert.equal(canReuseGate('rust', 'different-hash', cache), false);
		assert.equal(canReuseGate('frontend', fp, cache), false);
	});
});
