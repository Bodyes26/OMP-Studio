/**
 * Rapporto di blocco del trasporto RPC.
 *
 * Il blocco da localizzare: la chat smette di aggiornarsi mentre l'agente
 * lavora e il prompt successivo cade dopo 60 s senza risposta. Il Channel di
 * Tauri consegna i frame solo in ordine di indice: se un frame non arriva mai
 * al WebView, tutti i successivi (risposte comprese) restano in coda per
 * sempre. Il rapporto deve dire quale lato si e' fermato e quale frame manca.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Channel } from '@tauri-apps/api/core';
import { OmpRpcClient } from '../src/lib/agent/client.ts';
import { diagnoseHang, newTally, type BackendDiagnostics, type HangInput } from '../src/lib/agent/hangReport.ts';

let callbacks = new Map<number, (raw: unknown) => void>();
let nextCallbackId = 1;
let channelId = 0;
let backend: BackendDiagnostics | null = null;
let writtenReport: string | null = null;

function backendWith(transport: Partial<BackendDiagnostics['transport']>, tree?: BackendDiagnostics['processTree']): BackendDiagnostics {
	return {
		rpcId: 7,
		pid: 1234,
		childAlive: true,
		killed: false,
		protocol: 2,
		sessionId: 'sessione',
		transport: {
			nowMs: 1_000_000,
			stdoutLines: 10,
			lastStdoutMs: 990_000,
			framesSent: 0,
			tauriFetchPathFrames: 0,
			sendErrors: 0,
			lastSentMs: 990_000,
			stdinWrites: 1,
			lastStdinMs: 900_000,
			stdinWriteSinceMs: null,
			readerExited: false,
			recentFrames: [],
			...transport
		},
		processTree: tree ?? null,
		stderrTail: []
	};
}

function installTauriInternals() {
	callbacks = new Map();
	nextCallbackId = 1;
	writtenReport = null;
	const internals = {
		transformCallback(callback: (raw: unknown) => void): number {
			const id = nextCallbackId++;
			callbacks.set(id, callback);
			return id;
		},
		unregisterCallback(id: number) {
			callbacks.delete(id);
		},
		invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
			if (cmd === 'rpc_open') {
				// `onEvent` e' il Channel costruito dal client: identita' nota per costruzione.
				const channel = args.onEvent as Channel<string>;
				channelId = channel.id;
				return Promise.resolve(7);
			}
			if (cmd === 'rpc_diagnostics') return backend ? Promise.resolve(backend) : Promise.reject(new Error('IPC fermo'));
			if (cmd === 'rpc_write_hang_report') {
				writtenReport = typeof args.report === 'string' ? args.report : null;
				return Promise.resolve('C:/logs/rpc-hang-1.json');
			}
			return Promise.resolve(undefined);
		}
	};
	Object.assign(globalThis, {
		window: {
			setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
			clearTimeout: (id: number) => clearTimeout(id),
			__TAURI_INTERNALS__: internals
		}
	});
}

function deliver(index: number, frame: object) {
	const callback = callbacks.get(channelId);
	assert.ok(callback, 'canale senza callback');
	callback({ index, message: JSON.stringify(frame) });
}

describe('Rapporto di blocco RPC', () => {
	beforeEach(() => installTauriInternals());

	it('un frame perso dal Channel ferma la risposta e il rapporto lo indica', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const client = new OmpRpcClient();
		await client.open('C:/proj', null);
		deliver(0, { type: 'agent_start' });
		deliver(1, { type: 'turn_end' });
		// L'indice 2 non arriva mai: il 3 resta in coda nel Channel.
		deliver(3, { type: 'turn_start' });

		backend = backendWith({
			framesSent: 5,
			tauriFetchPathFrames: 1,
			recentFrames: [
				{ index: 2, atMs: 991_000, bytes: 20_000, kind: 'message_end', tauriFetchPath: true },
				{ index: 3, atMs: 991_100, bytes: 30, kind: 'turn_start', tauriFetchPath: false },
				{ index: 4, atMs: 995_000, bytes: 80, kind: 'response:prompt#s1', tauriFetchPath: false }
			]
		});
		const sent = client.send({ type: 'prompt', message: 'ciao' });
		const outcome = assert.rejects(sent, (error: Error & { code?: string }) => {
			assert.equal(error.code, 'timeout');
			assert.match(error.message, /entro 60s\. Rapporto diagnostico: C:\/logs\/rpc-hang-1\.json/);
			return true;
		});
		// `send` attende `rpc_send` prima di armare l'attesa della risposta.
		await Promise.resolve();
		t.mock.timers.tick(60_000);
		await outcome;

		assert.ok(writtenReport, 'rapporto non scritto');
		const report = JSON.parse(writtenReport);
		assert.equal(report.client.framesReceived, 2);
		assert.match(report.verdict[0], /Channel Tauri fermo: Rust ha spedito 5 frame, il WebView ne ha consegnati 2/);
		assert.match(report.verdict[0], /indice 2, "message_end", 20000 byte, consegnato da Tauri via fetch/);
		assert.ok(report.verdict.some((line: string) => /risposta a "prompt" \(s1\) e’ arrivata a Rust/.test(line)));
	});

	it('se anche il backend non risponde il prompt fallisce comunque', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const client = new OmpRpcClient();
		await client.open('C:/proj', null);
		backend = null;
		const sent = client.send({ type: 'get_state' });
		const outcome = assert.rejects(sent, /Nessuna risposta a "get_state" entro 60s/);
		await Promise.resolve();
		t.mock.timers.tick(60_000);
		await outcome;
		assert.match(JSON.parse(writtenReport ?? '{}').verdict[0], /backend di Studio non ha risposto/);
	});
});

describe('Diagnosi del blocco', () => {
	const base = (backend: BackendDiagnostics | null, received: number): HangInput => ({
		now: 1_000_000,
		commandId: 's9',
		command: 'prompt',
		sentAt: 940_000,
		timeoutMs: 60_000,
		client: { ...newTally(), count: received },
		pending: [],
		backend,
		backendError: backend ? null : 'IPC fermo'
	});

	it('omp muto dall invio del comando e fermo in attesa', () => {
		const verdict = diagnoseHang(
			base(backendWith({ framesSent: 40, lastStdoutMs: 900_000 }, { cpuMsInLast500ms: 0, totalCpuMs: 9000, activeProcesses: 2 }), 40)
		);
		assert.match(verdict[0], /omp muto: nessuna riga su stdout da 100s/);
		assert.ok(verdict.some((line) => /quasi fermo/.test(line)));
		assert.ok(verdict.some((line) => /Processi attivi nell’albero di omp: 2/.test(line)));
	});

	it('omp non legge stdin', () => {
		const verdict = diagnoseHang(base(backendWith({ framesSent: 40, lastStdoutMs: 900_000, stdinWriteSinceMs: 940_000 }), 40));
		assert.match(verdict[0], /omp non legge stdin: una scrittura e’ ferma da 60s/);
	});

	it('omp scrive ma non risponde al comando', () => {
		const verdict = diagnoseHang(base(backendWith({ framesSent: 40, lastStdoutMs: 999_000 }), 40));
		assert.match(verdict[0], /non ha mai risposto a "prompt": il comando e’ fermo dentro omp/);
	});
});
