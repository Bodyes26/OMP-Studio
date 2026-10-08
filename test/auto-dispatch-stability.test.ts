/**
 * Auto-avvio della coda: parte solo a sessione davvero ferma e stabile.
 *
 * Il difetto riportato: con l'auto-avvio acceso i task in coda partivano uno
 * dopo l'altro senza aspettare la fine del precedente, anche mentre l'agente
 * era solo in pausa fra un tool e l'altro. Qui si riproducono le cause con le
 * fixture reali di omp (`fixtures/chat-v2/*.ndjson`) e con sequenze costruite
 * sulle forme di `docs/rpc.md` di omp 18.8:
 *
 * 1. `turn_end` spegne `isStreaming` e riporta `agentState` a `idle` fra un
 *    giro di tool e l'altro: il cancello diceva `ready`;
 * 2. omp risponde a `prompt` all'ammissione, prima di `agent_start`: subito
 *    dopo la consegna la sessione nuova sembrava ferma;
 * 3. tentativi automatici e compattazione che continua il run passano da un
 *    `agent_end` non terminale, con lo stesso buco di (1) per secondi;
 * 4. coda nativa di omp e job in background (quiete non ancora raggiunta);
 * 5. l'effetto spediva al primo frame `ready` con un microtask, senza
 *    periodo di stabilita' ne' ri-verifica.
 *
 * `GuiModel` rispecchia i passaggi di `session.svelte.ts` che decidono i
 * campi del cancello (stesse funzioni pure, stesso ordine). La TUI e'
 * coperta dal parser del titolo e dalle attese di `terminalActivity.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAutomationGate, type GuiGateSnapshot } from '../src/lib/agent/automationGate.ts';
import {
	INITIAL_SETTLE,
	isBackgroundPending,
	isBackgroundYield,
	settleOnAgentStart,
	settleOnPromptResult,
	settleOnSessionSettled,
	settleOnYield,
	type SettleState
} from '../src/lib/agent/settle.ts';
import {
	AWAITING_RUN_TIMEOUT_MS,
	INITIAL_RUN_ACTIVITY,
	awaitingRunExpired,
	isRunActivityEvent,
	quietForMs,
	reduceRunActivity,
	runActivityOnPromptDropped,
	runActivityOnPromptSent,
	verifyQuietSnapshot,
	type RunActivity
} from '../src/lib/agent/runActivity.ts';
import {
	AutoDispatchArbiter,
	type AutoDispatchCandidate,
	type AutoDispatchDeps,
	type AutoDispatchOutcome
} from '../src/lib/lanes/autoDispatchArbiter.ts';
import {
	INITIAL_TERMINAL_HOLD,
	TERMINAL_START_TIMEOUT_MS,
	holdExpired,
	holdOnProgress,
	holdOnTaskWritten,
	holdOnTitleState,
	parseProgressOsc,
	parseTitleState
} from '../src/lib/terminal/terminalActivity.ts';
import type { AgentSessionEvent } from '../src/lib/agent/wire.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): AgentSessionEvent[] {
	return readFileSync(join(ROOT, 'fixtures', 'chat-v2', name), 'utf8')
		.split('\n')
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as AgentSessionEvent);
}

/* ------------------------------------------------------------ modello GUI */

/**
 * I campi del cancello come li calcola `AgentSession`: `isStreaming` spento
 * da `turn_end`, `agentState` da `resolveSettledState`, quiete da
 * `settle.ts`, attivita' del run da `runActivity.ts`.
 */
class GuiModel {
	isStreaming = false;
	isCompacting = false;
	agentState: 'idle' | 'working' = 'idle';
	settle: SettleState = { ...INITIAL_SETTLE };
	activity: RunActivity = { ...INITIAL_RUN_ACTIVITY };
	queued = 0;
	now = 1_000;

	get backgroundPending(): boolean {
		return isBackgroundPending(this.settle, this.isStreaming || this.isCompacting);
	}

	private settled(): 'idle' | 'working' {
		return this.backgroundPending ? 'working' : 'idle';
	}

	promptSent() {
		if (!this.isStreaming) this.activity = runActivityOnPromptSent(this.activity, this.now);
	}

	apply(event: AgentSessionEvent, stepMs = 50) {
		this.now += stepMs;
		this.activity = reduceRunActivity(this.activity, event, this.now);
		switch (event.type) {
			case 'agent_start':
				this.settle = settleOnAgentStart(this.settle);
				this.isStreaming = true;
				this.agentState = 'working';
				return;
			case 'turn_start':
				this.agentState = 'working';
				return;
			case 'turn_end':
				this.isStreaming = false;
				this.isCompacting = false;
				this.agentState = this.settled();
				return;
			case 'agent_end':
				if (event.isTerminal === false && !isBackgroundYield(this.settle, event)) return;
				this.settle = settleOnYield(this.settle);
				this.isStreaming = false;
				this.isCompacting = false;
				this.agentState = this.settled();
				return;
			case 'session_settled':
				this.settle = settleOnSessionSettled();
				if (!this.isStreaming && !this.isCompacting && this.agentState === 'working') this.agentState = this.settled();
				return;
			case 'prompt_result':
				this.settle = settleOnPromptResult(this.settle, event);
				return;
			case 'auto_compaction_start':
				this.isCompacting = true;
				return;
			case 'auto_compaction_end':
				this.isCompacting = false;
				if (!this.isStreaming) this.agentState = this.settled();
				return;
			case 'queue_update': {
				const steering = Array.isArray(event.steering) ? event.steering.length : 0;
				const followUp = Array.isArray(event.followUp) ? event.followUp.length : 0;
				this.queued = steering + followUp;
				return;
			}
			default:
				return;
		}
	}

	/** Il cancello com'era prima della correzione. */
	legacySnapshot(): GuiGateSnapshot {
		return {
			ready: true,
			attached: true,
			streaming: this.isStreaming || (this.agentState === 'working' && !this.backgroundPending),
			compacting: this.isCompacting,
			blockingQuestion: null,
			quotaBlock: null,
			inferencePending: false,
			inferredQuestion: null,
			backgroundWork: this.backgroundPending
		};
	}

	/** Come `AgentSession.automationSnapshot`. */
	snapshot(): GuiGateSnapshot {
		return {
			...this.legacySnapshot(),
			runActive: this.settle.running,
			awaitingRun: this.activity.awaitingRun,
			retrying: this.activity.retrying,
			nativeQueue: this.queued > 0
		};
	}

	gate() {
		return resolveAutomationGate({ surface: 'gui', busy: false, session: this.snapshot() });
	}

	legacyGate() {
		return resolveAutomationGate({ surface: 'gui', busy: false, session: this.legacySnapshot() });
	}
}

function ev(type: string, extra: Record<string, unknown> = {}): AgentSessionEvent {
	return { type, ...extra } as AgentSessionEvent;
}

/* --------------------------------------------------------------- cancello */

describe('auto-avvio: cause della partenza anticipata (GUI)', () => {
	it('fixture reale: il cancello di prima si apriva a ogni turn_end fra un tool e l\'altro', () => {
		const model = new GuiModel();
		let legacyOpenMidRun = 0;
		let openMidRun = 0;
		let runStarted = false;
		let runEnded = false;
		for (const event of fixture('tools-real.ndjson')) {
			model.apply(event);
			if (event.type === 'agent_start') runStarted = true;
			if (event.type === 'agent_end' && event.isTerminal !== false) runEnded = true;
			if (!runStarted || runEnded) continue;
			if (model.legacyGate().autoDispatchReady) legacyOpenMidRun += 1;
			if (model.gate().autoDispatchReady) openMidRun += 1;
		}
		// Quattro `turn_end` seguiti da `turn_start` dentro lo stesso run.
		assert.ok(legacyOpenMidRun >= 4, `atteso il difetto riprodotto, aperture: ${legacyOpenMidRun}`);
		assert.equal(openMidRun, 0, 'il cancello nuovo resta chiuso per tutto il run');
		assert.equal(model.gate().block, 'ready', 'a run concluso la coda puo\' ripartire');
	});

	it('dopo la consegna: prompt ammesso, agent_start non ancora arrivato', () => {
		const model = new GuiModel();
		model.promptSent();
		assert.equal(model.legacyGate().block, 'ready', 'difetto: la sessione nuova sembrava ferma');
		assert.equal(model.gate().block, 'working');
		model.apply(ev('agent_start'));
		assert.equal(model.activity.awaitingRun, false);
		assert.equal(model.gate().block, 'working');
		model.apply(ev('turn_start'));
		model.apply(ev('turn_end'));
		model.apply(ev('agent_end', { isTerminal: true, yielded: true }));
		assert.equal(model.gate().block, 'ready');
	});

	it('comando locale o invio rifiutato: l\'attesa del run si chiude subito', () => {
		const model = new GuiModel();
		model.promptSent();
		model.activity = runActivityOnPromptDropped(model.activity);
		assert.equal(model.gate().block, 'ready');
	});

	it('un prompt_result chiude l\'attesa anche senza agent_start (prompt scartato prima dell\'agente)', () => {
		const model = new GuiModel();
		model.promptSent();
		model.apply(ev('prompt_result', { agentInvoked: true, status: 'aborted', sessionSettled: true }));
		assert.equal(model.activity.awaitingRun, false);
		assert.equal(model.gate().block, 'ready');
	});

	it('rete di sicurezza: l\'attesa del run scade dopo AWAITING_RUN_TIMEOUT_MS', () => {
		const activity = runActivityOnPromptSent({ ...INITIAL_RUN_ACTIVITY }, 10_000);
		assert.equal(awaitingRunExpired(activity, 10_000 + AWAITING_RUN_TIMEOUT_MS - 1), false);
		assert.equal(awaitingRunExpired(activity, 10_000 + AWAITING_RUN_TIMEOUT_MS), true);
	});

	it('nuovo tentativo automatico: agent_end non terminale e attesa del retry non aprono la coda', () => {
		const model = new GuiModel();
		model.apply(ev('agent_start'));
		model.apply(ev('turn_start'));
		model.apply(ev('turn_end'));
		model.apply(ev('agent_end', { isTerminal: false, yielded: false }));
		model.apply(ev('auto_retry_start', { attempt: 1, maxAttempts: 3, delayMs: 4000 }));
		assert.equal(model.legacyGate().block, 'ready', 'difetto: durante il backoff la coda partiva');
		assert.equal(model.gate().block, 'working');
		// Il backoff dura secondi senza eventi.
		model.apply(ev('agent_start'), 4_000);
		model.apply(ev('auto_retry_end', { success: true }));
		model.apply(ev('turn_start'));
		model.apply(ev('turn_end'));
		assert.equal(model.gate().block, 'working');
		model.apply(ev('agent_end', { isTerminal: true, yielded: true }));
		assert.equal(model.gate().block, 'ready');
		assert.equal(model.activity.retrying, false);
	});

	it('compattazione che continua il run: chiusa durante e fra compattazione e ripresa', () => {
		const model = new GuiModel();
		model.apply(ev('agent_start'));
		model.apply(ev('turn_start'));
		model.apply(ev('turn_end'));
		model.apply(ev('agent_end', { isTerminal: false, yielded: false }));
		model.apply(ev('auto_compaction_start', { reason: 'threshold' }));
		assert.equal(model.gate().block, 'working');
		model.apply(ev('auto_compaction_end'), 8_000);
		assert.equal(model.legacyGate().block, 'ready', 'difetto: fra compattazione e ripresa la coda partiva');
		assert.equal(model.gate().block, 'working');
		model.apply(ev('agent_start'));
		model.apply(ev('agent_end', { isTerminal: true, yielded: true }));
		assert.equal(model.gate().block, 'ready');
	});

	it('follow-up nella coda nativa di omp: la sessione ripartira\', la coda di Studio aspetta', () => {
		const model = new GuiModel();
		model.apply(ev('queue_update', { steering: [], followUp: ['e poi aggiorna il README'] }));
		const gate = model.gate();
		assert.equal(gate.block, 'background');
		assert.equal(gate.autoDispatchReady, false);
		model.apply(ev('queue_update', { steering: [], followUp: [] }));
		assert.equal(model.gate().block, 'ready');
	});

	it('omp 18.8, job in background: yield con awaitingAsyncWork, la coda aspetta session_settled', () => {
		const model = new GuiModel();
		model.apply(ev('agent_start'));
		model.apply(ev('turn_start'));
		model.apply(ev('turn_end'));
		model.apply(ev('prompt_result', { agentInvoked: true, status: 'completed', sessionSettled: false }));
		model.apply(ev('agent_end', { isTerminal: false, yielded: true, awaitingAsyncWork: true }));
		assert.equal(model.gate().block, 'background');
		// Il risultato del job sveglia l'agente: un altro run, poi la quiete.
		model.apply(ev('agent_start'), 20_000);
		assert.equal(model.gate().block, 'working');
		model.apply(ev('agent_end', { isTerminal: true, yielded: true }));
		assert.equal(model.gate().autoDispatchReady, false, 'quiete non ancora annunciata');
		model.apply(ev('session_settled'));
		assert.equal(model.gate().block, 'ready');
	});

	it('subagenti in corsa con un omp senza quiete: blocco instradabile come il background', () => {
		const gate = resolveAutomationGate({
			surface: 'gui',
			busy: false,
			session: { ...new GuiModel().snapshot(), subagentsRunning: true }
		});
		assert.equal(gate.block, 'background');
	});

	it('attivita\': solo gli eventi del ciclo di vita del run spostano la quiete', () => {
		assert.equal(isRunActivityEvent('turn_end'), true);
		assert.equal(isRunActivityEvent('tool_execution_update'), true);
		assert.equal(isRunActivityEvent('studio_delta'), true);
		// Un'estensione che aggiorna la riga di stato non tiene ferma la coda.
		assert.equal(isRunActivityEvent('extension_ui_request'), false);
		assert.equal(isRunActivityEvent('notice'), false);
		assert.equal(isRunActivityEvent('available_commands_update'), false);
		let activity: RunActivity = { ...INITIAL_RUN_ACTIVITY, lastActivityAt: 1_000 };
		activity = reduceRunActivity(activity, ev('extension_ui_request', { method: 'setStatus' }), 5_000);
		assert.equal(quietForMs(activity, 5_000), 4_000);
		activity = reduceRunActivity(activity, ev('turn_end'), 5_000);
		assert.equal(quietForMs(activity, 5_000), 0);
	});
});

describe('auto-avvio: ri-verifica su get_state', () => {
	it('quieto solo senza run, compattazione, coda e lavoro in background', () => {
		assert.deepEqual(verifyQuietSnapshot({ isStreaming: false, isCompacting: false, queuedMessageCount: 0, isSettled: true }), { quiet: true });
		assert.deepEqual(verifyQuietSnapshot({ isStreaming: true }), { quiet: false, reason: 'streaming' });
		assert.deepEqual(verifyQuietSnapshot({ isStreaming: false, isCompacting: true }), { quiet: false, reason: 'compacting' });
		assert.deepEqual(verifyQuietSnapshot({ isStreaming: false, queuedMessageCount: 2 }), { quiet: false, reason: 'queue' });
		assert.deepEqual(verifyQuietSnapshot({ isStreaming: false, hasPendingAsyncWork: true }), { quiet: false, reason: 'background' });
		// isSettled copre il run ammesso ma non ancora partito e le continuazioni programmate.
		assert.deepEqual(verifyQuietSnapshot({ isStreaming: false, isSettled: false }), { quiet: false, reason: 'background' });
	});

	it('omp senza quiete: bastano isStreaming, isCompacting e la coda', () => {
		assert.deepEqual(verifyQuietSnapshot({ isStreaming: false, isCompacting: false, queuedMessageCount: 0 }), { quiet: true });
	});

	it('snapshot assente o errore: non quieto', () => {
		assert.equal(verifyQuietSnapshot(null).quiet, false);
	});
});

/* ----------------------------------------------------------------- arbitro */

class FakeClock {
	now = 0;
	private seq = 0;
	private timers = new Map<number, { at: number; fn: () => void }>();

	setTimer = (fn: () => void, ms: number): unknown => {
		const id = ++this.seq;
		this.timers.set(id, { at: this.now + ms, fn });
		return id;
	};

	clearTimer = (handle: unknown): void => {
		this.timers.delete(handle as number);
	};

	get pendingTimers(): number {
		return this.timers.size;
	}

	/** Avanza il tempo eseguendo i timer in ordine e lasciando girare i microtask. */
	async advance(ms: number): Promise<void> {
		const target = this.now + ms;
		for (;;) {
			let nextId: number | null = null;
			let nextAt = Infinity;
			for (const [id, timer] of this.timers) {
				if (timer.at <= target && timer.at < nextAt) {
					nextAt = timer.at;
					nextId = id;
				}
			}
			if (nextId === null) break;
			const timer = this.timers.get(nextId)!;
			this.timers.delete(nextId);
			this.now = timer.at;
			timer.fn();
			await flush();
		}
		this.now = target;
		await flush();
	}
}

async function flush() {
	for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

interface Harness {
	clock: FakeClock;
	arbiter: AutoDispatchArbiter;
	dispatched: AutoDispatchCandidate[];
	verifyCalls: number;
	resyncs: number;
	eligible: Map<string, AutoDispatchCandidate | null>;
	quiet: { value: number | null };
	verifyResult: { value: boolean };
	outcome: { value: AutoDispatchOutcome };
	/** Simula l'effetto: rilegge i candidati idonei e li passa a `sync`. */
	effect(): void;
}

function harness(overrides: Partial<AutoDispatchDeps> = {}): Harness {
	const clock = new FakeClock();
	const h = {
		clock,
		dispatched: [] as AutoDispatchCandidate[],
		verifyCalls: 0,
		resyncs: 0,
		eligible: new Map<string, AutoDispatchCandidate | null>(),
		quiet: { value: null as number | null },
		verifyResult: { value: true },
		outcome: { value: 'delivered' as AutoDispatchOutcome }
	} as Harness;
	h.arbiter = new AutoDispatchArbiter({
		now: () => clock.now,
		setTimer: clock.setTimer,
		clearTimer: clock.clearTimer,
		stableMs: () => 2_500,
		quietForMs: () => h.quiet.value,
		stillEligible: (c) => {
			const current = h.eligible.get(c.projectId);
			return Boolean(current && current.taskId === c.taskId && current.newLane === c.newLane);
		},
		verify: async () => {
			h.verifyCalls += 1;
			return h.verifyResult.value;
		},
		dispatch: async (c) => {
			h.dispatched.push(c);
			return h.outcome.value;
		},
		requestResync: () => {
			h.resyncs += 1;
		},
		retryMs: 5_000,
		failureCooldownMs: 30_000,
		...overrides
	});
	h.effect = () => {
		const list = [...h.eligible.values()].filter((c): c is AutoDispatchCandidate => c !== null);
		h.arbiter.sync(list);
	};
	return h;
}

const TASK_A: AutoDispatchCandidate = { projectId: 'p1', taskId: 'a', newLane: false };

describe('auto-avvio: periodo di stabilita\' e lock', () => {
	it('un `ready` di un istante (fra due giri di tool) non spedisce nulla', async () => {
		const h = harness();
		h.eligible.set('p1', TASK_A);
		h.effect();
		await h.clock.advance(50);
		// turn_start: il cancello si richiude.
		h.eligible.set('p1', null);
		h.effect();
		await h.clock.advance(10_000);
		assert.equal(h.dispatched.length, 0);
		assert.equal(h.verifyCalls, 0);
	});

	it('pause ripetute: il conto riparte da zero a ogni chiusura del cancello', async () => {
		const h = harness();
		for (let i = 0; i < 5; i++) {
			h.eligible.set('p1', TASK_A);
			h.effect();
			await h.clock.advance(2_000);
			h.eligible.set('p1', null);
			h.effect();
			await h.clock.advance(100);
		}
		assert.equal(h.dispatched.length, 0);
	});

	it('idoneita\' continuata: una ri-verifica e una sola spedizione', async () => {
		const h = harness();
		h.eligible.set('p1', TASK_A);
		h.effect();
		await h.clock.advance(2_499);
		assert.equal(h.dispatched.length, 0);
		await h.clock.advance(1);
		assert.equal(h.verifyCalls, 1);
		assert.deepEqual(h.dispatched, [TASK_A]);
	});

	it('eventi del run senza chiusura del cancello: la quiete conta dall\'ultimo evento', async () => {
		const h = harness();
		h.eligible.set('p1', TASK_A);
		h.quiet.value = 1_000;
		h.effect();
		await h.clock.advance(2_500);
		assert.equal(h.dispatched.length, 0, 'ultimo evento 1 s fa: si aspetta ancora');
		h.quiet.value = 2_500;
		await h.clock.advance(1_500);
		assert.equal(h.dispatched.length, 1);
	});

	it('get_state dice «non fermo»: nessun invio, nuovo tentativo dopo retryMs', async () => {
		const h = harness();
		h.eligible.set('p1', TASK_A);
		h.verifyResult.value = false;
		h.effect();
		await h.clock.advance(2_500);
		assert.equal(h.verifyCalls, 1);
		assert.equal(h.dispatched.length, 0);
		// La risincronizzazione immediata non riapre subito la verifica.
		h.effect();
		await h.clock.advance(2_500);
		assert.equal(h.verifyCalls, 1, 'nessun get_state a raffica');
		h.verifyResult.value = true;
		await h.clock.advance(2_500);
		h.effect();
		await h.clock.advance(2_500);
		assert.equal(h.verifyCalls, 2);
		assert.equal(h.dispatched.length, 1);
	});

	it('il cancello si chiude durante la ri-verifica: nessun invio', async () => {
		let release!: (value: boolean) => void;
		const h = harness({
			verify: () =>
				new Promise<boolean>((resolve) => {
					release = resolve;
				})
		});
		h.eligible.set('p1', TASK_A);
		h.effect();
		await h.clock.advance(2_500);
		h.eligible.set('p1', null);
		release(true);
		await flush();
		assert.equal(h.dispatched.length, 0);
	});

	it('lock per progetto: nessun doppio invio mentre la consegna e\' in volo', async () => {
		let finish!: () => void;
		const dispatched: AutoDispatchCandidate[] = [];
		const h = harness({
			dispatch: (c) => {
				dispatched.push(c);
				return new Promise<AutoDispatchOutcome>((resolve) => {
					finish = () => resolve('delivered');
				});
			}
		});
		h.eligible.set('p1', TASK_A);
		h.effect();
		await h.clock.advance(2_500);
		assert.equal(dispatched.length, 1);
		assert.equal(h.arbiter.isLocked('p1'), true);
		// L'effetto rigira mentre handleRunTask e' in corso: stesso task o il successivo.
		h.eligible.set('p1', { projectId: 'p1', taskId: 'b', newLane: false });
		h.effect();
		await h.clock.advance(10_000);
		assert.equal(dispatched.length, 1);
		finish();
		await flush();
		assert.equal(h.arbiter.isLocked('p1'), false);
		assert.ok(h.resyncs >= 1, 'il rilascio chiede un nuovo giro all\'effetto');
	});

	it('consegna fallita: il task resta fuori per il cooldown', async () => {
		const h = harness();
		h.outcome.value = 'failed';
		h.eligible.set('p1', TASK_A);
		h.effect();
		await h.clock.advance(2_500);
		assert.equal(h.dispatched.length, 1);
		h.effect();
		await h.clock.advance(20_000);
		h.effect();
		await h.clock.advance(5_000);
		assert.equal(h.dispatched.length, 1);
		await h.clock.advance(10_000);
		h.effect();
		await h.clock.advance(2_500);
		assert.equal(h.dispatched.length, 2);
	});

	it('progetti diversi non si bloccano a vicenda', async () => {
		const h = harness();
		h.eligible.set('p1', TASK_A);
		h.eligible.set('p2', { projectId: 'p2', taskId: 'x', newLane: false });
		h.effect();
		await h.clock.advance(2_500);
		assert.deepEqual(h.dispatched.map((c) => c.projectId).sort(), ['p1', 'p2']);
	});

	it('dispose: nessun timer residuo', async () => {
		const h = harness();
		h.eligible.set('p1', TASK_A);
		h.effect();
		h.arbiter.dispose();
		assert.equal(h.clock.pendingTimers, 0);
		await h.clock.advance(5_000);
		assert.equal(h.dispatched.length, 0);
	});
});

describe('auto-avvio: scenario completo con la fixture reale', () => {
	it('tre task in coda, un run con quattro giri di tool: parte solo il primo, il secondo dopo la fine', async () => {
		const clock = new FakeClock();
		const model = new GuiModel();
		const queue = ['t1', 't2', 't3'];
		const started: string[] = [];
		const events = fixture('tools-real.ndjson').filter((event) => event.type !== 'ready' && event.type !== 'response');

		const candidate = (): AutoDispatchCandidate | null => {
			const next = queue[0];
			if (!next || !model.gate().autoDispatchReady) return null;
			return { projectId: 'p1', taskId: next, newLane: false };
		};
		const arbiter = new AutoDispatchArbiter({
			now: () => clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			stableMs: () => 2_500,
			quietForMs: () => clock.now - model.activity.lastActivityAt,
			stillEligible: (c) => candidate()?.taskId === c.taskId,
			verify: async () =>
				verifyQuietSnapshot({
					isStreaming: model.settle.running || model.isStreaming,
					isCompacting: model.isCompacting,
					queuedMessageCount: model.queued
				}).quiet,
			dispatch: async (c) => {
				started.push(c.taskId);
				queue.shift();
				model.now = clock.now;
				model.promptSent();
				return 'delivered';
			},
			requestResync: () => effect()
		});
		const effect = () => {
			const c = candidate();
			arbiter.sync(c ? [c] : []);
		};

		effect();
		await clock.advance(2_500);
		assert.deepEqual(started, ['t1']);

		// omp lavora: eventi ogni 150 ms, con pause di 1,2 s fra un giro di tool e l'altro.
		for (const event of events) {
			const gap = event.type === 'turn_start' ? 1_200 : 150;
			await clock.advance(gap);
			model.now = clock.now - 50;
			model.apply(event);
			effect();
		}
		assert.deepEqual(started, ['t1'], 'nessun task parte durante il run');

		await clock.advance(2_400);
		assert.deepEqual(started, ['t1'], 'a fine run serve ancora la quiete continuata');
		await clock.advance(200);
		assert.deepEqual(started, ['t1', 't2']);
		// t2 e' appena stato consegnato: il run non e' ancora partito.
		await clock.advance(30_000 - 1);
		assert.deepEqual(started, ['t1', 't2']);
	});
});

/* -------------------------------------------------------------------- TUI */

describe('auto-avvio nel terminale (titolo OSC e attese)', () => {
	it('titolo di omp: \u03c0 > idle, \u03c0 : working, \u03c0 ! attention', () => {
		assert.equal(parseTitleState('\u03c0 > progetto'), 'idle');
		assert.equal(parseTitleState('\u03c0 : progetto'), 'working');
		assert.equal(parseTitleState('\u03c0 !'), 'attention');
		assert.equal(parseTitleState('bash'), 'unknown');
	});

	it('OSC 9;4: barra attiva, spenta, e gli altri OSC 9 ignorati', () => {
		assert.equal(parseProgressOsc('4;3'), true);
		assert.equal(parseProgressOsc('4;1;40'), true);
		assert.equal(parseProgressOsc('4;0;'), false);
		assert.equal(parseProgressOsc('4;0'), false);
		assert.equal(parseProgressOsc('Notifica di ConEmu'), null);
	});

	it('task appena scritto: il vecchio idle non vale finche\' il titolo non diventa working', () => {
		let hold = holdOnTaskWritten({ ...INITIAL_TERMINAL_HOLD }, 1_000);
		const gate = (agentState: 'idle' | 'working') =>
			resolveAutomationGate({
				surface: 'terminal',
				busy: false,
				inputPending: false,
				agentState,
				awaitingStart: hold.awaitingStart,
				progressActive: hold.progressActive
			});
		assert.equal(
			resolveAutomationGate({ surface: 'terminal', busy: false, inputPending: false, agentState: 'idle' }).block,
			'ready',
			'difetto: senza l\'attesa la coda vedeva idle subito dopo la consegna'
		);
		assert.equal(gate('idle').block, 'working');
		hold = holdOnTitleState(hold, 'idle');
		assert.equal(hold.awaitingStart, true, 'un idle ripetuto non chiude l\'attesa');
		hold = holdOnTitleState(hold, 'working');
		assert.equal(hold.awaitingStart, false);
		assert.equal(gate('working').block, 'working');
		assert.equal(gate('idle').block, 'ready');
	});

	it('l\'attesa scade se il titolo non diventa mai working', () => {
		const hold = holdOnTaskWritten({ ...INITIAL_TERMINAL_HOLD }, 0);
		assert.equal(holdExpired(hold, TERMINAL_START_TIMEOUT_MS - 1), false);
		assert.equal(holdExpired(hold, TERMINAL_START_TIMEOUT_MS), true);
	});

	it('barra OSC 9;4 attiva con titolo idle (compattazione a riposo): non pronto', () => {
		const hold = holdOnProgress({ ...INITIAL_TERMINAL_HOLD }, true);
		const gate = resolveAutomationGate({
			surface: 'terminal',
			busy: false,
			inputPending: false,
			agentState: 'idle',
			progressActive: hold.progressActive
		});
		assert.equal(gate.block, 'working');
	});
});
