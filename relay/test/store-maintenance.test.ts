import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { RelayConfig } from '../src/config.ts';
import { SocketHub } from '../src/sockets.ts';
import { COMMAND_LOG_MAX, COMMAND_LOG_PRUNE_EVERY, RelayStore } from '../src/store.ts';

let dir: string;
const open: Array<() => void> = [];

function tempStore(): RelayStore {
	dir = mkdtempSync(join(tmpdir(), 'relay-store-maint-'));
	const store = new RelayStore(dir);
	open.push(() => store.close());
	return store;
}

function mockConfig(dataDir: string): RelayConfig {
	return {
		port: 0,
		hostname: '127.0.0.1',
		adminToken: 'x'.repeat(40),
		authTimeoutMs: 5_000,
		heartbeatMs: 25_000,
		maxDiagSessions: 2,
		dataDir,
		webDir: dataDir,
		version: 'test',
		irohRelay: null
	};
}

/** Righe presenti nella tabella `command_log`. */
function countCommandLog(dataDir: string): number {
	const db = new Database(join(dataDir, 'relay.db'));
	try {
		const row = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM command_log;').get();
		return row?.count ?? 0;
	} finally {
		db.close();
	}
}

afterEach(() => {
	for (const close of open.splice(0)) close();
	if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('Registro comandi (S10-07)', () => {
	test('la potatura non gira a ogni insert ma il tetto viene comunque rispettato', () => {
		const store = tempStore();
		const now = Date.now();

		// Sotto la soglia di potatura la tabella cresce: nessuna DELETE per riga.
		for (let i = 0; i < COMMAND_LOG_PRUNE_EVERY - 1; i++) {
			store.logCommand(now + i, 'dev', 'host', 'run_task', 'ok');
		}
		store.close();
		expect(countCommandLog(dir)).toBe(COMMAND_LOG_PRUNE_EVERY - 1);

		// Oltre `COMMAND_LOG_MAX` righe la tabella resta entro il tetto piu' il
		// blocco non ancora potato.
		const second = new RelayStore(dir);
		open.push(() => second.close());
		for (let i = 0; i < COMMAND_LOG_MAX * 2; i++) {
			second.logCommand(now + i, 'dev', 'host', 'run_task', 'ok');
		}
		second.close();
		const rows = countCommandLog(dir);
		expect(rows).toBeLessThanOrEqual(COMMAND_LOG_MAX + COMMAND_LOG_PRUNE_EVERY);
		expect(rows).toBeGreaterThan(0);
	});

	test('la chiusura pota le righe residue non ancora sfoltite', () => {
		const store = tempStore();
		for (let i = 0; i < COMMAND_LOG_MAX + 5; i++) {
			store.logCommand(Date.now() + i, 'dev', 'host', 'run_task', 'ok');
		}
		store.close();
		expect(countCommandLog(dir)).toBe(COMMAND_LOG_MAX);
	});
});

describe('Chiusura del relay (S10-02)', () => {
	test('SocketHub.stop chiude lo store e regge una seconda chiamata', () => {
		const store = tempStore();
		const hub = new SocketHub(mockConfig(dir), store);

		hub.stop();
		// `listHosts` risponde vuoto solo quando lo store e' stato chiuso.
		expect(store.listHosts()).toEqual([]);
		// `server.stop()` puo' arrivare due volte (SIGTERM piu' chiusura esplicita).
		expect(() => hub.stop()).not.toThrow();
	});
});
