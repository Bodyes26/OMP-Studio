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

function installTauriMock() {
	calls = [];
	const internals = {
		invoke: async (cmd: string, args: Record<string, unknown>) => {
			calls.push({ cmd, args: args || {} });
			if (cmd === 'rpc_open') return 1;
			if (cmd === 'pty_open') return 1;
			return {};
		},
		transformCallback: (fn: (arg: unknown) => void) => fn,
		unregisterCallback: () => {}
	};
	(globalThis as { window?: unknown; __TAURI_INTERNALS__?: unknown }).window = {
		setTimeout: (h: () => void, ms: number) => setTimeout(h, ms),
		clearTimeout: (id: NodeJS.Timeout) => clearTimeout(id),
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
});
