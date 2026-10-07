/**
 * Stop a due stadi della chat: il controllo reale usato dal composer
 * (src/lib/agent/twoStepStop.ts), con timer finti.
 *
 * 1. Primo clic: abort (SIGINT lato omp), il pulsante non e' ancora armato.
 * 2. Se l'agente non si ferma entro GRACE_MS il pulsante si arma come «Forza arresto».
 * 3. Armato, il secondo clic chiama forceKill (SIGKILL/taskkill).
 * 4. agent_end prima dell'armamento: non si arma mai; dopo: disarma.
 * 5. Integrazione OmpRpcClient: rpc_abort e rpc_force_kill.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { OmpRpcClient } from '../src/lib/agent/client.ts';
import { TwoStepStop } from '../src/lib/agent/twoStepStop.ts';

interface InvokeCall {
	cmd: string;
	args: Record<string, unknown>;
}

let calls: InvokeCall[] = [];
/** Timer registrati dal client tramite `window.setTimeout`: il test li fa
 *  scadere a comando (`expireTimers`), senza attese reali. */
let clientTimers = new Map<number, () => void>();
let nextClientTimer = 1;

function expireTimers() {
	const pending = [...clientTimers.values()];
	clientTimers.clear();
	for (const callback of pending) callback();
}

/** Timer del client catturati: `expireTimers` li fa scadere a richiesta, cosi'
 *  i comandi che vanno in timeout non fanno attendere il test. */
function installTauriMock() {
	calls = [];
	clientTimers = new Map();
	nextClientTimer = 1;
	const internals = {
		invoke: async (cmd: string, args: Record<string, unknown>) => {
			calls.push({ cmd, args: args || {} });
			if (cmd === 'rpc_open') return 1;
			if (cmd === 'pty_open') return 1;
			// Il rapporto di blocco parte a ogni timeout e interroga il backend:
			// qui non c'e', quindi si respinge e il rapporto prende il ramo muto.
			if (cmd === 'rpc_diagnostics') throw new Error('mock: diagnostica assente');
			return {};
		},
		transformCallback: (fn: (arg: unknown) => void) => fn,
		unregisterCallback: () => {}
	};
	(globalThis as { window?: unknown; __TAURI_INTERNALS__?: unknown }).window = {
		setTimeout: (h: () => void) => {
			const id = nextClientTimer++;
			clientTimers.set(id, h);
			return id;
		},
		clearTimeout: (id: number) => {
			clientTimers.delete(id);
		},
		__TAURI_INTERNALS__: internals
	};
	(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = internals;
}

/** Timer finti: l'attesa si comanda dal test. */
function fakeTimers() {
	const timers = new Map<number, () => void>();
	let next = 1;
	return {
		timers,
		setTimer: (callback: () => void) => {
			const id = next++;
			timers.set(id, callback);
			return id;
		},
		clearTimer: (handle: unknown) => {
			timers.delete(handle as number);
		},
		elapse() {
			const pending = [...timers.values()];
			timers.clear();
			for (const callback of pending) callback();
		}
	};
}

function makeStop() {
	const clock = fakeTimers();
	const counts = { abort: 0, forceKill: 0, changes: [] as boolean[] };
	const stop = new TwoStepStop({
		abort: () => {
			counts.abort++;
		},
		forceKill: () => {
			counts.forceKill++;
		},
		onChange: (armed) => counts.changes.push(armed),
		setTimer: clock.setTimer,
		clearTimer: clock.clearTimer
	});
	return { stop, counts, clock };
}

describe('Stop a due stadi della chat (TwoStepStop)', () => {
	it('primo clic: abort, nessun arresto forzato, non ancora armato', () => {
		const { stop, counts } = makeStop();
		assert.equal(stop.press(), 'abort');
		assert.equal(counts.abort, 1);
		assert.equal(counts.forceKill, 0);
		assert.equal(stop.armed, false);
		assert.equal(stop.waiting, true);
	});

	it("se l'agente non si ferma entro l'attesa il pulsante si arma", () => {
		const { stop, counts, clock } = makeStop();
		stop.press();
		clock.elapse();
		assert.equal(stop.armed, true);
		assert.deepEqual(counts.changes, [true]);
		assert.ok(TwoStepStop.GRACE_MS < 2500, 'si arma prima della rete di sicurezza di 2,5 s della sessione');
	});

	it("armato, il secondo clic forza l'arresto e disarma", () => {
		const { stop, counts, clock } = makeStop();
		stop.press();
		clock.elapse();
		assert.equal(stop.press(), 'force');
		assert.equal(counts.forceKill, 1);
		assert.equal(counts.abort, 1);
		assert.equal(stop.armed, false);
	});

	it("un secondo clic durante l'attesa non uccide il processo e non ripete l'abort", () => {
		const { stop, counts } = makeStop();
		stop.press();
		assert.equal(stop.press(), 'waiting');
		assert.equal(counts.abort, 1);
		assert.equal(counts.forceKill, 0);
	});

	it("agent_end durante l'attesa: non si arma mai", () => {
		const { stop, counts, clock } = makeStop();
		stop.press();
		stop.settle();
		assert.equal(clock.timers.size, 0);
		clock.elapse();
		assert.equal(stop.armed, false);
		assert.deepEqual(counts.changes, []);
		// Il turno successivo riparte dal primo stadio.
		assert.equal(stop.press(), 'abort');
		assert.equal(counts.abort, 2);
	});

	it('agent_end tardivo ad armamento avvenuto: disarma senza forzare', () => {
		const { stop, counts, clock } = makeStop();
		stop.press();
		clock.elapse();
		stop.settle();
		assert.equal(stop.armed, false);
		assert.equal(counts.forceKill, 0);
		assert.deepEqual(counts.changes, [true, false]);
	});
});

describe('Integrazione OmpRpcClient: rpc_abort e rpc_force_kill', () => {
	beforeEach(() => {
		installTauriMock();
	});

	it('client.abort invia rpc_abort su Tauri IPC', async () => {
		const client = new OmpRpcClient();
		(client as unknown as { rpcId: number }).rpcId = 42;

		await client.abort();

		const abortCalls = calls.filter((c) => c.cmd === 'rpc_abort');
		assert.equal(abortCalls.length, 1);
		assert.deepEqual(abortCalls[0].args, { rpcId: 42 });
	});

	it('client.forceKill invia rpc_force_kill su Tauri IPC', async () => {
		const client = new OmpRpcClient();
		(client as unknown as { rpcId: number }).rpcId = 42;

		await client.forceKill();

		const forceKillCalls = calls.filter((c) => c.cmd === 'rpc_force_kill');
		assert.equal(forceKillCalls.length, 1);
		assert.deepEqual(forceKillCalls[0].args, { rpcId: 42 });
	});

	it('client.abortAndRestoreQueue invia abort_bash e abort_and_restore_queue', async () => {
		const client = new OmpRpcClient();
		const internals = client as unknown as { rpcId: number; lastHangReportAt: number };
		internals.rpcId = 42;
		// Il rapporto di blocco ha una sua rete di timer (5 s) e non c'entra
		// con questa prova: lo si disattiva come se ne fosse appena scritto uno.
		internals.lastHangReportAt = Date.now();
		// Il mock non risponde: si fa scadere a comando il timer del comando,
		// senza attese reali, e si verifica anche il ripiego su `abort`.
		const pending = client.abortAndRestoreQueue();
		expireTimers();
		const restored = await pending;
		assert.equal(restored, null);

		const sent = calls
			.filter((call) => call.cmd === 'rpc_send')
			.map((call) => JSON.parse(String(call.args.line)) as { type: string });
		assert.deepEqual(
			sent.map((frame) => frame.type),
			['abort_bash', 'abort_and_restore_queue']
		);
		assert.equal(calls.filter((call) => call.cmd === 'rpc_abort').length, 1);
	});
});
