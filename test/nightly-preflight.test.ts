import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	checkVersionAlignment,
	verifyNightly
} from '../scripts/verify-nightly.mjs';

import {
	getLockFilePath,
} from '../scripts/nightly-lock.mjs';

import {
	readNightlyCache,
	writeNightlyCache
} from '../scripts/nightly-cache.mjs';

describe('Orchestrazione Preflight Nightly (verify-nightly.mjs)', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), 'omp-test-preflight-'));
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	});

	function setupMatchingVersions(root: string, version = '1.9.0') {
		mkdirSync(join(root, 'src-tauri'), { recursive: true });

		writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'omp-studio-app', version }));
		writeFileSync(
			join(root, 'src-tauri', 'tauri.conf.json'),
			JSON.stringify({ version, identifier: 'com.actisalesin.omp-studio' })
		);
		writeFileSync(
			join(root, 'src-tauri', 'Cargo.toml'),
			`[package]\nname = "omp-studio-app"\nversion = "${version}"\n`
		);
		writeFileSync(
			join(root, 'src-tauri', 'Cargo.lock'),
			`[[package]]\nname = "omp-studio-app"\nversion = "${version}"\n`
		);
	}

	it('valida con successo quattro file con versione perfettamente allineata', () => {
		setupMatchingVersions(testDir, '2.0.1');

		const check = checkVersionAlignment(testDir);
		assert.equal(check.ok, true);
		assert.equal(check.version, '2.0.1');
	});

	it('rileva il disallineamento se anche un solo file ha versione differente', () => {
		setupMatchingVersions(testDir, '2.0.1');
		// Altera package.json
		writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'omp-studio-app', version: '2.0.2' }));

		const check = checkVersionAlignment(testDir);
		assert.equal(check.ok, false);
		assert.match(check.error || '', /Disallineamento versioni rilevato/);
	});

	it('rileva file mancanti tra i quattro file di configurazione della versione', () => {
		setupMatchingVersions(testDir, '2.0.1');
		rmSync(join(testDir, 'src-tauri', 'Cargo.lock'));

		const check = checkVersionAlignment(testDir);
		assert.equal(check.ok, false);
		assert.match(check.error || '', /Impossibile determinare la versione/);
	});

	it('verifyNightly fallisce subito senza eseguire altri gate se le versioni sono disallineate', async () => {
		setupMatchingVersions(testDir, '1.5.0');
		writeFileSync(join(testDir, 'src-tauri', 'Cargo.toml'), '[package]\nname = "omp-studio-app"\nversion = "1.5.1"\n');

		await assert.rejects(
			async () => {
				await verifyNightly({ root: testDir, full: true });
			},
			/Verifica allineamento versioni fallita/
		);
	});


	it('verifyNightly invalida le prove in cache se un gate successivo fallisce', async () => {
		setupMatchingVersions(testDir, '1.0.0');

		// Pre-popola la cache con una prova valida pregressa
		writeNightlyCache(testDir, {
			rust: { fingerprint: 'a'.repeat(64), details: { totalDurationMs: 100 } },
			frontend: { fingerprint: 'b'.repeat(64), details: { durationMs: 150 } }
		});
		assert.equal(readNightlyCache(testDir).gates.rust.fingerprint, 'a'.repeat(64));

		// verifyNightly fallisce perché scripts/check-icons.mjs non esiste
		await assert.rejects(
			async () => {
				await verifyNightly({ root: testDir, full: true, stdio: 'ignore' });
			}
		);
		assert.deepEqual(readNightlyCache(testDir).gates, {});
		assert.equal(existsSync(getLockFilePath(testDir)), false);
	});

	it('un abort precedente all’avvio non crea lock o prove', async () => {
		setupMatchingVersions(testDir);
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(
			() => verifyNightly({ root: testDir, signal: controller.signal }),
			{ name: 'AbortError' }
		);
		assert.equal(existsSync(getLockFilePath(testDir)), false);
		assert.deepEqual(readNightlyCache(testDir).gates, {});
	});
});
