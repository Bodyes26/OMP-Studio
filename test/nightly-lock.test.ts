import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	acquireNightlyLock,
	getLockFilePath,
	isProcessAlive,
	releaseNightlyLock,
	withNightlyLock
} from '../scripts/nightly-lock.mjs';

describe('Lock esclusivo Nightly (nightly-lock.mjs)', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), 'omp-test-lock-'));
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	});

	it('acquisisce il lock esclusivo e lo rilascia correttamente tramite token', async () => {
		const lockPath = getLockFilePath(testDir);
		assert.equal(existsSync(lockPath), false);

		const handle = await acquireNightlyLock(testDir, { timeoutMs: 500 });
		assert.equal(existsSync(lockPath), true);

		const payload = JSON.parse(readFileSync(lockPath, 'utf8'));
		assert.equal(payload.token, handle.token);
		assert.equal(payload.pid, process.pid);

		const released = releaseNightlyLock(handle);
		assert.equal(released, true);
		assert.equal(existsSync(lockPath), false);
	});

	it('blocca acquisizioni concorrenti mentre il processo detentore è attivo', async () => {
		const handle1 = await acquireNightlyLock(testDir, { timeoutMs: 500 });

		// Secondo tentativo con timeout breve: deve fallire
		await assert.rejects(
			async () => {
				await acquireNightlyLock(testDir, { timeoutMs: 150, retryIntervalMs: 50 });
			},
			/Lock Nightly già acquisito/
		);

		releaseNightlyLock(handle1);
	});

	it('non rimuove il lock se il token fornito nel rilascio non coincide', async () => {
		const handle = await acquireNightlyLock(testDir, { timeoutMs: 500 });
		const lockPath = getLockFilePath(testDir);

		// Tentativo di rilascio con token alterato
		const fakeHandle = { ...handle, token: 'mismatched-token-1234' };
		const released = releaseNightlyLock(fakeHandle);

		assert.equal(released, false);
		// Il lock originale deve rimanere intatto
		assert.equal(existsSync(lockPath), true);

		// Rilascio legittimo
		releaseNightlyLock(handle);
		assert.equal(existsSync(lockPath), false);
	});

	it('recupera automaticamente un lock stale con PID inesistente', async () => {
		const lockPath = getLockFilePath(testDir);
		mkdirSync(join(testDir, '.omp', 'cache'), { recursive: true });

		// Scrivi un lock con PID sicuramente non allocato
		let deadPid = 999999;
		while (isProcessAlive(deadPid)) {
			deadPid++;
		}

		writeFileSync(
			lockPath,
			JSON.stringify({
				token: 'stale-token',
				pid: deadPid,
				createdAt: Date.now() - 60000
			}),
			'utf8'
		);

		assert.equal(existsSync(lockPath), true);

		// acquireNightlyLock deve rilevare il PID morto, recuperare il lock e acquisirlo
		const handle = await acquireNightlyLock(testDir, { timeoutMs: 1000 });
		assert.equal(existsSync(lockPath), true);

		const payload = JSON.parse(readFileSync(lockPath, 'utf8'));
		assert.equal(payload.pid, process.pid);
		assert.equal(payload.token, handle.token);

		releaseNightlyLock(handle);
		assert.equal(existsSync(lockPath), false);
	});

	it('non ruba mai il lock se il PID proprietario è vivo, anche a distanza di tempo', async () => {
		const lockPath = getLockFilePath(testDir);
		mkdirSync(join(testDir, '.omp', 'cache'), { recursive: true });

		// Scrivi un lock con PID = process.pid (vivo) e data vecchia (es. 24 ore fa)
		writeFileSync(
			lockPath,
			JSON.stringify({
				token: 'active-token',
				pid: process.pid,
				createdAt: Date.now() - 24 * 60 * 60 * 1000
			}),
			'utf8'
		);

		// Non deve rubare il lock al processo vivo, ma fallire per timeout
		await assert.rejects(
			async () => {
				await acquireNightlyLock(testDir, { timeoutMs: 150, retryIntervalMs: 50 });
			},
			/Lock Nightly già acquisito/
		);

		// Il lock originale deve rimanere intatto
		assert.equal(existsSync(lockPath), true);
		const payload = JSON.parse(readFileSync(lockPath, 'utf8'));
		assert.equal(payload.token, 'active-token');
	});

	it('withNightlyLock esegue la callback e rilascia il lock anche in caso di eccezione', async () => {
		const lockPath = getLockFilePath(testDir);

		await assert.rejects(
			async () => {
				await withNightlyLock(testDir, async () => {
					assert.equal(existsSync(lockPath), true);
					throw new Error('Errore simulato nella callback');
				});
			},
			/Errore simulato nella callback/
		);

		// Il lock deve essere stato rilasciato nel finally
		assert.equal(existsSync(lockPath), false);
	});

	it('due processi recuperano un lock morto senza sovrapporre le sezioni critiche', { timeout: 15000 }, async (t) => {
		const lockPath = getLockFilePath(testDir);
		mkdirSync(join(testDir, '.omp', 'cache'), { recursive: true });
		let deadPid = 999999;
		while (isProcessAlive(deadPid)) deadPid++;
		writeFileSync(lockPath, JSON.stringify({ pid: deadPid, token: 'dead-owner', createdAt: 0 }));
		const moduleUrl = new URL('../scripts/nightly-lock.mjs', import.meta.url).href;
		const code = `
			import { openSync, closeSync, unlinkSync, appendFileSync } from 'node:fs';
			import { join } from 'node:path';
			import { once } from 'node:events';
			import { withNightlyLock } from ${JSON.stringify(moduleUrl)};
			const root = process.argv[1];
			process.send('attempt');
			await withNightlyLock(root, async () => {
				const marker = join(root, 'critical');
				const fd = openSync(marker, 'wx');
				try {
					const released = once(process, 'message');
					process.send('entered');
					await released;
					appendFileSync(join(root, 'completed'), process.argv[2] + '\\n');
				} finally { closeSync(fd); unlinkSync(marker); }
			});
			process.disconnect();
		`;
		const children: ChildProcess[] = [];
		t.after(() => { for (const child of children) if (child.exitCode === null) child.kill(); });
		const attempted = new Set<number>();
		const entered = new Set<ChildProcess>();
		const releaseEntered = () => {
			if (attempted.size !== 2) return;
			for (const child of entered) child.send('release');
			entered.clear();
		};
		const attempts = [1, 2].map((id) => {
			const { promise, resolve, reject } = Promise.withResolvers<void>();
			const child = spawn(process.execPath, ['--input-type=module', '-e', code, testDir, String(id)], {
				stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true
			});
			children.push(child);
			let stderr = '';
			child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
			child.on('message', (message) => {
				if (message === 'attempt') attempted.add(id);
				else if (message === 'entered') entered.add(child);
				releaseEntered();
			});
			child.once('error', reject);
			child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
			return promise;
		});
		await Promise.all(attempts);
		assert.deepEqual(readFileSync(join(testDir, 'completed'), 'utf8').trim().split('\n').sort(), ['1', '2']);
		assert.equal(existsSync(lockPath), false);
	});
});
