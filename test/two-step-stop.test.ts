/**
 * Test di unita' per la macchina a stati del pulsante di interruzione:
 * Two-Step Force Kill Escalation (SIGINT -> SIGKILL).
 *
 * 1. Primo click (soft abort): invia abort / SIGINT e transita nello stato 'armed' per 2.0s.
 * 2. Secondo click entro 2.0s: attiva force kill immediato (SIGKILL/taskkill).
 * 3. Reset naturale: se l'agente termina entro 2.0s, lo stato 'armed' decade automaticamente.
 * 4. Timeout: se l'utente non clicca entro 2.0s, decade tornando allo stato iniziale.
 * 5. Doppio click rapido: esegue l'escalation immediata a force kill.
 * 6. Integrazione OmpRpcClient: rpc_abort e rpc_force_kill.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { OmpRpcClient } from '../src/lib/agent/client.ts';

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

/** Macchina a stati pura del pulsante Stop con supporto clock deterministico */
class TwoStepStopButtonModel {
	public armed = false;
	private timer: NodeJS.Timeout | null = null;
	public abortCalls = 0;
	public forceKillCalls = 0;
	private readonly onAbort: () => void;
	private readonly onForceKill: () => void;
	private readonly scheduler: (cb: () => void, ms: number) => NodeJS.Timeout;
	private readonly cancelScheduler: (t: NodeJS.Timeout | null) => void;

	constructor(
		onAbort: () => void,
		onForceKill: () => void,
		scheduler: (cb: () => void, ms: number) => NodeJS.Timeout = setTimeout,
		cancelScheduler: (t: NodeJS.Timeout | null) => void = clearTimeout
	) {
		this.onAbort = onAbort;
		this.onForceKill = onForceKill;
		this.scheduler = scheduler;
		this.cancelScheduler = cancelScheduler;
	}
	public click() {
		if (!this.armed) {
			// Fase 1: Soft abort e armamento per 2.0 secondi
			this.onAbort();
			this.abortCalls++;
			this.armed = true;
			this.cancelScheduler(this.timer);
			this.timer = this.scheduler(() => {
				this.armed = false;
				this.timer = null;
			}, 2000);
		} else {
			// Fase 2: Secondo click entro 2.0 secondi -> Force Kill
			this.clearArmed();
			this.onForceKill();
			this.forceKillCalls++;
		}
	}

	public onAgentSettled() {
		// Reset Naturale
		this.clearArmed();
	}

	public clearArmed() {
		this.cancelScheduler(this.timer);
		this.timer = null;
		this.armed = false;
	}

	public destroy() {
		this.clearArmed();
	}
}

describe('Two-Step Force Kill Escalation: Macchina a Stati del Pulsante', () => {
	beforeEach(() => {
		installTauriMock();
	});

	it('Stato Iniziale: pulsante non armato, nessun abort inviato', () => {
		let abortCalled = false;
		let killCalled = false;
		const button = new TwoStepStopButtonModel(
			() => { abortCalled = true; },
			() => { killCalled = true; }
		);

		assert.equal(button.armed, false, 'Il pulsante deve partire non armato');
		assert.equal(abortCalled, false);
		assert.equal(killCalled, false);
		button.destroy();
	});

	it('Fase 1 (primo click): invia soft abort e transita in stato armed', () => {
		let abortCalled = false;
		let killCalled = false;
		const button = new TwoStepStopButtonModel(
			() => { abortCalled = true; },
			() => { killCalled = true; }
		);

		button.click();

		assert.equal(abortCalled, true, 'Il primo click deve inviare soft abort');
		assert.equal(killCalled, false, 'Il primo click NON deve invocare force kill');
		assert.equal(button.armed, true, 'Il pulsante deve essere armato dopo il primo click');
		button.destroy();
	});

	it('Fase 2 (secondo click entro 2.0s): invoca force kill immediato (SIGKILL)', () => {
		let abortCount = 0;
		let killCount = 0;
		const button = new TwoStepStopButtonModel(
			() => { abortCount++; },
			() => { killCount++; }
		);

		// Click 1 -> Soft abort
		button.click();
		assert.equal(button.armed, true);
		assert.equal(abortCount, 1);
		assert.equal(killCount, 0);

		// Click 2 (rapido) -> Force Kill
		button.click();
		assert.equal(button.armed, false, 'Dopo il force kill lo stato armed si disarma');
		assert.equal(abortCount, 1, 'Non deve inviare un secondo soft abort');
		assert.equal(killCount, 1, 'Deve invocare force kill');
		button.destroy();
	});

	it('Reset Naturale: se l agente termina entro i 2.0s, lo stato armed decade automaticamente', () => {
		let abortCount = 0;
		let killCount = 0;
		const button = new TwoStepStopButtonModel(
			() => { abortCount++; },
			() => { killCount++; }
		);

		button.click();
		assert.equal(button.armed, true);

		// L'agente risponde al soft abort (es. agent_end o isStreaming = false)
		button.onAgentSettled();
		assert.equal(button.armed, false, 'Lo stato armed deve decadere automaticamente al termine dell agente');
		assert.equal(killCount, 0, 'Nessun force kill deve essere invocato');
		button.destroy();
	});

	it('Scadenza timeout 2.0s: lo stato armed decade tornando allo stato iniziale', () => {
		let abortCount = 0;
		let killCount = 0;
		let scheduledCb: (() => void) | null = null;

		const button = new TwoStepStopButtonModel(
			() => { abortCount++; },
			() => { killCount++; },
			(cb) => {
				scheduledCb = cb;
				return 1 as unknown as NodeJS.Timeout;
			},
			() => {
				scheduledCb = null;
			}
		);

		button.click();
		assert.equal(button.armed, true);

		// Esecuzione deterministica dello scadere dei 2.0s senza attesa reale
		assert.notEqual(scheduledCb, null);
		scheduledCb!();

		assert.equal(button.armed, false, 'Lo stato armed deve decadere dopo 2.0 secondi');
		assert.equal(killCount, 0, 'La sola scadenza del timer non deve forzare il kill');

		// Un nuovo click successivo riparte dalla Fase 1 (nuovo soft abort)
		button.click();
		assert.equal(abortCount, 2, 'Un nuovo click riparte dalla Fase 1');
		assert.equal(button.armed, true);
		button.destroy();
	});

	it('Doppio click rapido abbatte il processo in due step continui', () => {
		let abortCount = 0;
		let killCount = 0;
		const button = new TwoStepStopButtonModel(
			() => { abortCount++; },
			() => { killCount++; }
		);

		// Doppio click veloce simulato
		button.click();
		button.click();

		assert.equal(abortCount, 1);
		assert.equal(killCount, 1);
		assert.equal(button.armed, false);
		button.destroy();
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
