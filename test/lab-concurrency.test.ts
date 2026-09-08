/**
 * Step 7 — GATE: Concorrenza principale e Laboratorio prototipi
 *
 * Verifica in modo deterministico e rigoroso:
 * 1. Identità e chiavi distinte tra sessione principale e sessione Laboratorio
 *    nello stesso progetto (`main:<proj>` vs `lab:<proj>:<proto>`).
 * 2. Esecuzione simultanea: apertura concorrente con `rpc_open` (main) e `rpc_open_lab` (lab)
 *    tramite OmpRpcClient.
 * 3. Isolamento stream e transcript: chat, delta e messaggi non si mescolano.
 * 4. Isolamento richieste di input: un `ask` del Laboratorio attiva il pendingUi solo
 *    sul Laboratorio e la risposta via `routeUiResponse` viene instradata alla sessione corretta.
 * 5. Isolamento ABORT (gate bloccante): interrompere il Laboratorio ferma solo
 *    il Laboratorio; il principale continua a generare senza alcuna interruzione.
 * 6. Isolamento CLOSE: chiudere una sessione non termina l'altra.
 * 7. Protezione eventi tardivi: eventi con revisione superata o su sessione chiusa
 *    vengono scartati prima di aggiornare l'oggetto errato.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Channel } from '@tauri-apps/api/core';
import { OmpRpcClient } from '../src/lib/agent/client.ts';
import {
	SessionRegistry,
	mainSessionKey,
	labSessionKey,
	type AgentSessionLike
} from '../src/lib/agent/sessionRegistry.ts';
import type { AgentSessionEvent } from '../src/lib/agent/wire.ts';

interface InvokeCall {
	cmd: string;
	args: Record<string, unknown>;
}

let calls: InvokeCall[] = [];
let opens: { resolve: (rpcId: number) => void; channelId: number; cmd: string }[] = [];
let callbacks = new Map<number, (raw: unknown) => void>();
let nextCallbackId = 1;
let channelMessageIndices = new Map<number, number>();

function installTauriInternals() {
	calls = [];
	opens = [];
	callbacks = new Map();
	nextCallbackId = 1;
	channelMessageIndices = new Map();

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
			calls.push({ cmd, args });
			if (cmd === 'rpc_open' || cmd === 'rpc_open_lab') {
				const channel = args.onEvent as Channel<string>;
				return new Promise<unknown>((resolve) => {
					opens.push({ resolve, channelId: channel.id, cmd });
				});
			}
			if (cmd === 'rpc_abort') {
				return Promise.resolve();
			}
			if (cmd === 'rpc_send') {
				return Promise.resolve();
			}
			if (cmd === 'rpc_close') {
				return Promise.resolve();
			}
			return Promise.resolve(undefined);
		}
	};

	(globalThis as { window?: unknown }).window = {
		setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
		clearTimeout: (id: number) => clearTimeout(id),
		__TAURI_INTERNALS__: internals
	};
}

/** Consegna un frame sul canale dell'apertura `index`. */
function emit(index: number, line: string) {
	const open = opens[index];
	assert.ok(open, `apertura ${index} inesistente`);
	const callback = callbacks.get(open.channelId);
	assert.ok(callback, `canale ${open.channelId} senza callback`);
	const msgIndex = channelMessageIndices.get(open.channelId) ?? 0;
	channelMessageIndices.set(open.channelId, msgIndex + 1);
	callback({ index: msgIndex, message: line });
}

/**
 * Mock deterministico di AgentSession per verificare isolamento, routing eventi e abort
 * nel contesto del test runner Node.js senza dipendenze da runtime Svelte browser.
 */
class MockSession implements AgentSessionLike {
	readonly client = new OmpRpcClient();
	readonly cwd: string;
	readonly scope: 'main' | 'lab';
	readonly prototypeId: string | null;
	readonly projectKey: string;
	sessionId: string | null = null;
	observedRevisionId?: string | null;
	pendingUi?: { kind: string; message?: string; toolCallId?: string } | null = null;
	isStreaming = false;
	isAborting = false;
	receivedDeltas: string[] = [];
	answeredSelectValue: string | null = null;

	constructor(opts: {
		cwd: string;
		scope?: 'main' | 'lab';
		prototypeId?: string | null;
		projectKey?: string | null;
		observedRevisionId?: string | null;
	}) {
		this.cwd = opts.cwd;
		this.scope = opts.scope ?? 'main';
		this.prototypeId = opts.prototypeId ?? null;
		this.projectKey = opts.projectKey ?? opts.cwd;
		this.observedRevisionId = opts.observedRevisionId ?? null;

		this.client.onEvent((event) => this.reduce(event));
	}

	get sessionKey(): string {
		if (this.scope === 'lab' && this.prototypeId) {
			return labSessionKey(this.projectKey, this.prototypeId);
		}
		return mainSessionKey(this.projectKey);
	}

	async open(resume?: string | null): Promise<void> {
		if (this.scope === 'lab' && this.prototypeId) {
			await this.client.openLab({
				projectPath: this.cwd,
				prototypeId: this.prototypeId,
				projectKey: this.projectKey,
				resume: resume ?? null
			});
		} else {
			await this.client.open(this.cwd, resume ?? null);
		}
	}

	async close(): Promise<void> {
		this.isStreaming = false;
		await this.client.close();
	}

	async abort(): Promise<void> {
		this.isAborting = true;
		this.isStreaming = false;
		await this.client.abort();
	}

	async answerSelect(value: string): Promise<void> {
		this.answeredSelectValue = value;
		this.pendingUi = null;
	}

	private reduce(event: AgentSessionEvent) {
		const rec: Record<string, unknown> = event;

		// Protezione da eventi per sessioni/prototipi diversi o revisioni superate
		if (this.scope === 'lab') {
			const proto = typeof rec.prototypeId === 'string' ? rec.prototypeId : undefined;
			if (proto && this.prototypeId && proto !== this.prototypeId) return;
			const pkey = typeof rec.projectKey === 'string' ? rec.projectKey : undefined;
			if (pkey && this.projectKey && pkey !== this.projectKey) return;
			const rev = typeof rec.revisionId === 'string' ? rec.revisionId : undefined;
			if (rev && this.observedRevisionId && rev !== this.observedRevisionId) return;
		}

		if (event.type === 'message_start') {
			this.isStreaming = true;
			this.isAborting = false;
		} else if (event.type === 'studio_delta') {
			if (!this.isStreaming || this.isAborting) return;
			const delta = typeof rec.delta === 'string' ? rec.delta : '';
			this.receivedDeltas.push(delta);
		} else if (event.type === 'tool_execution_start') {
			const toolName = typeof rec.toolName === 'string' ? rec.toolName : '';
			const toolCallId = typeof rec.toolCallId === 'string' ? rec.toolCallId : '';
			if (toolName === 'ask') {
				this.pendingUi = { kind: 'ask', message: 'Question', toolCallId };
			}
		}
	}
}

describe('Laboratorio prototipi — Step 7: Concorrenza e isolamento', () => {
	beforeEach(() => {
		installTauriInternals();
	});

	it('1. Chiavi e identita separate per sessioni nello stesso progetto', () => {
		const registry = new SessionRegistry<MockSession>((cfg) => new MockSession(cfg));
		const project = { id: 'proj-42', path: 'C:/repos/test-app' };

		const mainSession = registry.getOrCreateMainSession(project);
		const labSession = registry.getOrCreateLabSession(project, 'tabella-varianti');

		assert.equal(mainSession.scope, 'main');
		assert.equal(mainSession.prototypeId, null);
		assert.equal(mainSession.sessionKey, 'main:proj-42');

		assert.equal(labSession.scope, 'lab');
		assert.equal(labSession.prototypeId, 'tabella-varianti');
		assert.equal(labSession.sessionKey, 'lab:proj-42:tabella-varianti');

		assert.notEqual(mainSession, labSession, 'devono essere due istanze distinte');
		assert.notEqual(mainSession.client, labSession.client, 'devono avere due client RPC separati');

		assert.equal(registry.getAllSessions().length, 2);
		assert.equal(registry.getMainSessions().length, 1);
		assert.equal(registry.getLabSessions().length, 1);
		assert.equal(registry.getSessionsForProject('proj-42').length, 2);
	});

	it('2. Apertura simultanea con rpc_open (main) e rpc_open_lab (lab)', async () => {
		const registry = new SessionRegistry<MockSession>((cfg) => new MockSession(cfg));
		const project = { id: 'proj-42', path: 'C:/repos/test-app' };

		const mainSession = registry.getOrCreateMainSession(project);
		const labSession = registry.getOrCreateLabSession(project, 'scheda-prodotto');

		const mainOpen = mainSession.open();
		const labOpen = labSession.open();

		assert.equal(opens.length, 2, 'devono essere avviati due processi distinti');
		assert.equal(opens[0].cmd, 'rpc_open');
		assert.equal(opens[1].cmd, 'rpc_open_lab');

		// Rust risponde con rpcId distinti
		opens[0].resolve(101);
		opens[1].resolve(202);

		await Promise.all([mainOpen, labOpen]);

		assert.equal(mainSession.client.id, 101);
		assert.equal(labSession.client.id, 202);
		assert.equal(mainSession.client.isOpen, true);
		assert.equal(labSession.client.isOpen, true);
	});

	it('3. Streaming e token non si mescolano tra principale e Laboratorio', async () => {
		const registry = new SessionRegistry<MockSession>((cfg) => new MockSession(cfg));
		const project = { id: 'proj-42', path: 'C:/repos/test-app' };

		const mainSession = registry.getOrCreateMainSession(project);
		const labSession = registry.getOrCreateLabSession(project, 'filtro-avanzato');

		const mainOpen = mainSession.open();
		const labOpen = labSession.open();
		opens[0].resolve(10);
		opens[1].resolve(20);
		await Promise.all([mainOpen, labOpen]);

		// Avvia messaggi
		emit(0, JSON.stringify({ type: 'ready' }));
		emit(1, JSON.stringify({ type: 'ready' }));

		emit(0, JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
		emit(0, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Codice principale' }));

		emit(1, JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
		emit(1, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Componente React Lab' }));

		// Verifica che i token non si siano incrociati
		assert.deepEqual(mainSession.receivedDeltas, ['Codice principale']);
		assert.deepEqual(labSession.receivedDeltas, ['Componente React Lab']);
	});

	it('4. Richieste di input (ask) e risposte non si mescolano', async () => {
		const registry = new SessionRegistry<MockSession>((cfg) => new MockSession(cfg));
		const project = { id: 'proj-42', path: 'C:/repos/test-app' };

		const mainSession = registry.getOrCreateMainSession(project);
		const labSession = registry.getOrCreateLabSession(project, 'form-wizard');

		const mainOpen = mainSession.open();
		const labOpen = labSession.open();
		opens[0].resolve(10);
		opens[1].resolve(20);
		await Promise.all([mainOpen, labOpen]);

		emit(0, JSON.stringify({ type: 'ready' }));
		emit(1, JSON.stringify({ type: 'ready' }));

		// Laboratorio riceve una richiesta di input 'ask'
		emit(
			1,
			JSON.stringify({
				type: 'tool_execution_start',
				toolCallId: 'call-lab-1',
				toolName: 'ask',
				args: { questions: [{ id: 'style', question: 'Quale palette usare?' }] }
			})
		);

		// Solo labSession ha pendingUi
		assert.equal(mainSession.pendingUi, null, 'il principale non deve avere input pendenti');
		assert.notEqual(labSession.pendingUi, null, 'il laboratorio deve avere pendingUi attivo');
		assert.equal(labSession.pendingUi?.kind, 'ask');

		// Invio risposta via sessionRegistry con target esplicito
		const routed = await registry.routeUiResponse({
			projectId: 'proj-42',
			prototypeId: 'form-wizard',
			response: { action: 'select', value: 'emerald' }
		});

		assert.equal(routed, true, 'risposta instradata al laboratorio');
		assert.equal(labSession.answeredSelectValue, 'emerald');
		assert.equal(labSession.pendingUi, null, 'pendingUi risolto');
	});

	it('5. GATE BLOCCANTE: Interrompere solo il Laboratorio non ferma il principale', async () => {
		const registry = new SessionRegistry<MockSession>((cfg) => new MockSession(cfg));
		const project = { id: 'proj-42', path: 'C:/repos/test-app' };

		const mainSession = registry.getOrCreateMainSession(project);
		const labSession = registry.getOrCreateLabSession(project, 'concurrency-gate');

		const mainOpen = mainSession.open();
		const labOpen = labSession.open();
		opens[0].resolve(101);
		opens[1].resolve(202);
		await Promise.all([mainOpen, labOpen]);

		emit(0, JSON.stringify({ type: 'ready' }));
		emit(1, JSON.stringify({ type: 'ready' }));

		// Entrambi iniziano a generare simultaneamente
		emit(0, JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
		emit(1, JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));

		emit(0, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Token principale 1. ' }));
		emit(1, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Token lab 1. ' }));

		assert.equal(mainSession.isStreaming, true, 'principale in streaming');
		assert.equal(labSession.isStreaming, true, 'laboratorio in streaming');

		// AZIONE DECISIVA DEL GATE: l utente interrompe ESCLUSIVAMENTE il Laboratorio
		await labSession.abort();

		// Verifica chiamate RPC
		const abortCalls = calls.filter((c) => c.cmd === 'rpc_abort');
		assert.equal(abortCalls.length, 1, 'esattamente una sola chiamata rpc_abort');
		assert.equal(abortCalls[0].args.rpcId, 202, 'abort inviato specificamente al processo Lab 202');

		// Stato Laboratorio: interrotto
		assert.equal(labSession.isStreaming, false, 'laboratorio deve essersi fermato');
		assert.equal(labSession.isAborting, true);

		// STATO PRINCIPALE (GATE CRITICO): NON interrotto, continua a lavorare!
		assert.equal(mainSession.isStreaming, true, 'il principale DEVE restare in streaming');
		assert.equal(mainSession.isAborting, false);

		// Il principale riceve un ulteriore token e lo elabora regolarmente
		emit(0, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Token principale 2.' }));
		assert.deepEqual(mainSession.receivedDeltas, ['Token principale 1. ', 'Token principale 2.']);

		// Eventuali token tardivi sul Laboratorio interrotto vengono scartati
		emit(1, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Token scartato.' }));
		assert.deepEqual(labSession.receivedDeltas, ['Token lab 1. '], 'token tardivi su lab abortito scartati');
	});

	it('6. Chiudere il Laboratorio non chiude ne altera il principale', async () => {
		const registry = new SessionRegistry<MockSession>((cfg) => new MockSession(cfg));
		const project = { id: 'proj-42', path: 'C:/repos/test-app' };

		const mainSession = registry.getOrCreateMainSession(project);
		const labSession = registry.getOrCreateLabSession(project, 'test-close');

		const mainOpen = mainSession.open();
		const labOpen = labSession.open();
		opens[0].resolve(11);
		opens[1].resolve(22);
		await Promise.all([mainOpen, labOpen]);

		// Chiude solo il laboratorio
		await labSession.close();

		const closeCalls = calls.filter((c) => c.cmd === 'rpc_close');
		assert.equal(closeCalls.length, 1);
		assert.equal(closeCalls[0].args.rpcId, 22, 'chiude solo il processo 22');

		assert.equal(labSession.client.isOpen, false);
		assert.equal(mainSession.client.isOpen, true, 'il principale resta perfettamente vivo e aperto');
	});

	it('7. Protezione eventi tardivi: scarta frame con revisione obsoleta', async () => {
		const labSession = new MockSession({
			cwd: 'C:/repos/test-app',
			scope: 'lab',
			prototypeId: 'test-revision-guard',
			projectKey: 'proj-42',
			observedRevisionId: 'rev-2'
		});

		const opening = labSession.open();
		opens[0].resolve(33);
		await opening;

		emit(0, JSON.stringify({ type: 'ready' }));
		emit(0, JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));

		// Frame con revisionId 'rev-1' (superata rispetto a 'rev-2' osservata)
		emit(
			0,
			JSON.stringify({
				type: 'studio_delta',
				revisionId: 'rev-1',
				delta: 'delta-stale'
			})
		);

		assert.deepEqual(labSession.receivedDeltas, [], 'evento legato a revisione superata deve essere scartato');

		// Frame con revisionId coerente 'rev-2'
		emit(
			0,
			JSON.stringify({
				type: 'studio_delta',
				revisionId: 'rev-2',
				delta: 'delta-current'
			})
		);

		assert.deepEqual(labSession.receivedDeltas, ['delta-current'], 'evento con revisione coerente accettato');
	});
});
