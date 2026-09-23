/**
 * W04 Contract Test: SessionRegistry multi-corsia e isolamento processi
 *
 * Verifica in modo deterministico:
 * 1. Chiavi strutturate laneSessionKey(projectKey, laneId) -> "lane:<proj>:<lane>".
 * 2. Due corsie dello stesso progetto possiedono istanze AgentSession distinte,
 *    ciascuna vincolata al proprio workspacePath (worktree vs main).
 * 3. Apertura concorrente con rpc_open: processi omp indipendenti con rpcId distinti.
 * 4. Streaming indipendente e isolamento token: emissioni su corsia A non toccano corsia B.
 * 5. Isolamento ABORT (gate R27 W04): interrompere corsia B lascia corsia A in generazione.
 * 6. Isolamento CLOSE: chiudere corsia B non tocca né invalida corsia A né Laboratorio.
 * 7. Handoff trasparente via --resume <sessionId> preservando sessionKey e workspace.
 * 8. Compatibilita retroattiva con scope 'main' e mainSessionKey.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Channel } from '@tauri-apps/api/core';
import { OmpRpcClient } from '../src/lib/agent/client.ts';
import {
	SessionRegistry,
	laneSessionKey,
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
let opens: { resolve: (rpcId: number) => void; channelId: number; cmd: string; cwd: string }[] = [];
let callbacks = new Map<number, (raw: unknown) => void>();
let nextCallbackId = 1;
let channelMessageIndices = new Map<number, number>();

function installTauriInternals() {
	calls = [];
	opens = [];
	callbacks = new Map();
	nextCallbackId = 1;
	channelMessageIndices = new Map();
	let nextId = 1;

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
				const channel = args.onEvent;
				const rawChannelId =
					channel && typeof channel === 'object' && 'id' in channel
						? (channel as { id: number }).id
						: nextId++;
				const cwd = typeof args.cwd === 'string' ? args.cwd : String(args.projectPath ?? '');
				return new Promise<number>((resolve) => {
					opens.push({ resolve, channelId: rawChannelId, cmd, cwd });
				});
			}
			if (cmd === 'rpc_abort' || cmd === 'rpc_send' || cmd === 'rpc_close') {
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

function emit(index: number, line: string) {
	const open = opens[index];
	assert.ok(open, `apertura ${index} inesistente`);
	const callback = callbacks.get(open.channelId);
	assert.ok(callback, `canale ${open.channelId} senza callback`);
	const msgIndex = channelMessageIndices.get(open.channelId) ?? 0;
	channelMessageIndices.set(open.channelId, msgIndex + 1);
	callback({ index: msgIndex, message: line });
}

class MockLaneSession implements AgentSessionLike {
	readonly client = new OmpRpcClient();
	readonly cwd: string;
	readonly scope: 'lane' | 'lab';
	readonly laneId: string | null;
	readonly prototypeId: string | null;
	readonly projectKey: string;
	sessionId: string | null = null;
	isStreaming = false;
	isAborting = false;
	receivedDeltas: string[] = [];

	constructor(opts: {
		cwd: string;
		scope?: 'lane' | 'lab';
		laneId?: string | null;
		prototypeId?: string | null;
		projectKey?: string | null;
	}) {
		this.cwd = opts.cwd;
		this.scope = opts.scope ?? 'lane';
		this.laneId = opts.laneId ?? (this.scope === 'lane' ? 'main' : null);
		this.prototypeId = opts.prototypeId ?? null;
		this.projectKey = opts.projectKey ?? opts.cwd;

		this.client.onEvent((event) => this.reduce(event));
	}

	get sessionKey(): string {
		if (this.scope === 'lab' && this.prototypeId) {
			return labSessionKey(this.projectKey, this.prototypeId);
		}
		return laneSessionKey(this.projectKey, this.laneId ?? 'main');
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

	private reduce(event: AgentSessionEvent) {
		const rec: Record<string, unknown> = event;
		if (event.type === 'message_start') {
			this.isStreaming = true;
			this.isAborting = false;
		} else if (event.type === 'studio_delta') {
			if (!this.isStreaming || this.isAborting) return;
			const delta = typeof rec.delta === 'string' ? rec.delta : '';
			this.receivedDeltas.push(delta);
		}
	}
}

describe('W04 — SessionRegistry multi-corsia e isolamento processi', () => {
	beforeEach(() => {
		installTauriInternals();
	});

	it('1. Genera chiavi strutturate laneSessionKey e preserva retrocompatibilita main', () => {
		assert.equal(laneSessionKey('Project-A', 'Main'), 'lane:project-a:main');
		assert.equal(laneSessionKey('Project-A', 'wt-feat-1'), 'lane:project-a:wt-feat-1');
		assert.equal(mainSessionKey('Project-A'), 'lane:project-a:main');
		assert.equal(labSessionKey('Project-A', 'proto-1'), 'lab:project-a:proto-1');
	});

	it('2. Due corsie dello stesso progetto istanziano sessioni distinte sui rispettivi workspace', () => {
		const registry = new SessionRegistry<MockLaneSession>((cfg) => new MockLaneSession(cfg));
		const projectA = {
			id: 'proj-1',
			lane: { laneId: 'main', workspacePath: 'C:/repos/app' }
		};
		const projectB = {
			id: 'proj-1',
			lane: { laneId: 'wt-feat-auth', workspacePath: 'C:/repos/.omp-wt-app-wt-feat-auth' }
		};

		const mainSession = registry.getOrCreateMainSession(projectA);
		const laneSession = registry.getOrCreateLaneSession(projectB);

		assert.notEqual(mainSession, laneSession);
		assert.equal(mainSession.sessionKey, 'lane:proj-1:main');
		assert.equal(laneSession.sessionKey, 'lane:proj-1:wt-feat-auth');
		assert.equal(mainSession.cwd, 'C:/repos/app');
		assert.equal(laneSession.cwd, 'C:/repos/.omp-wt-app-wt-feat-auth');

		assert.equal(registry.getAllSessions().length, 2);
		assert.equal(registry.getLaneSessions().length, 2);
		assert.equal(registry.getSessionsForProject('proj-1').length, 2);

		assert.equal(registry.findSessionByKey('lane:proj-1:main'), mainSession);
		assert.equal(registry.findSessionByKey('lane:proj-1:wt-feat-auth'), laneSession);
	});

	it('3. Apertura concorrente su workspace distinti con processi omp separati', async () => {
		const registry = new SessionRegistry<MockLaneSession>((cfg) => new MockLaneSession(cfg));
		const lane1 = registry.getOrCreateLaneSession({
			id: 'proj-net',
			lane: { laneId: 'main', workspacePath: 'C:/repos/Portalino' }
		});
		const lane2 = registry.getOrCreateLaneSession({
			id: 'proj-net',
			lane: { laneId: 'wt-flotta', workspacePath: 'C:/repos/.omp-wt-Portalino-wt-flotta' }
		});

		const open1 = lane1.open();
		const open2 = lane2.open();

		assert.equal(opens.length, 2);
		assert.equal(opens[0].cmd, 'rpc_open');
		assert.equal(opens[0].cwd, 'C:/repos/Portalino');
		assert.equal(opens[1].cmd, 'rpc_open');
		assert.equal(opens[1].cwd, 'C:/repos/.omp-wt-Portalino-wt-flotta');

		opens[0].resolve(501);
		opens[1].resolve(502);
		await Promise.all([open1, open2]);

		assert.equal(lane1.client.id, 501);
		assert.equal(lane2.client.id, 502);
	});

	it('4. Streaming simultaneo e isolamento dei token tra due corsie', async () => {
		const registry = new SessionRegistry<MockLaneSession>((cfg) => new MockLaneSession(cfg));
		const lane1 = registry.getOrCreateLaneSession({
			id: 'proj-x',
			lane: { laneId: 'main', workspacePath: 'C:/repos/app' }
		});
		const lane2 = registry.getOrCreateLaneSession({
			id: 'proj-x',
			lane: { laneId: 'lane-b', workspacePath: 'C:/repos/.omp-wt-app-b' }
		});

		const open1 = lane1.open();
		const open2 = lane2.open();
		opens[0].resolve(10);
		opens[1].resolve(20);
		await Promise.all([open1, open2]);

		emit(0, JSON.stringify({ type: 'ready' }));
		emit(1, JSON.stringify({ type: 'ready' }));

		emit(0, JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
		emit(1, JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));

		emit(0, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Output corsia Principale' }));
		emit(1, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Output corsia B' }));

		assert.deepEqual(lane1.receivedDeltas, ['Output corsia Principale']);
		assert.deepEqual(lane2.receivedDeltas, ['Output corsia B']);
	});

	it('5. Gate R27 W04: Interrompere una corsia (abort) non ferma né tocca l altra', async () => {
		const registry = new SessionRegistry<MockLaneSession>((cfg) => new MockLaneSession(cfg));
		const lane1 = registry.getOrCreateLaneSession({
			id: 'proj-x',
			lane: { laneId: 'main', workspacePath: 'C:/repos/app' }
		});
		const lane2 = registry.getOrCreateLaneSession({
			id: 'proj-x',
			lane: { laneId: 'lane-b', workspacePath: 'C:/repos/.omp-wt-app-b' }
		});

		const open1 = lane1.open();
		const open2 = lane2.open();
		opens[0].resolve(100);
		opens[1].resolve(200);
		await Promise.all([open1, open2]);

		emit(0, JSON.stringify({ type: 'ready' }));
		emit(1, JSON.stringify({ type: 'ready' }));

		emit(0, JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
		emit(1, JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));

		emit(0, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Corsia A turno 1' }));
		emit(1, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Corsia B turno 1' }));

		assert.equal(lane1.isStreaming, true);
		assert.equal(lane2.isStreaming, true);

		// Interruzione selettiva su corsia B
		await lane2.abort();

		const abortCalls = calls.filter((c) => c.cmd === 'rpc_abort');
		assert.equal(abortCalls.length, 1);
		assert.equal(abortCalls[0].args.rpcId, 200, 'abort diretto esclusivamente al processo 200');

		assert.equal(lane2.isStreaming, false);
		assert.equal(lane2.isAborting, true);

		// Invariante critica: corsia A continua imperturbata
		assert.equal(lane1.isStreaming, true);
		assert.equal(lane1.isAborting, false);

		emit(0, JSON.stringify({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: ' corsia A turno 2' }));
		assert.deepEqual(lane1.receivedDeltas, ['Corsia A turno 1', ' corsia A turno 2']);
	});

	it('6. Chiudere una corsia libera solo il suo processo e preserva le altre', async () => {
		const registry = new SessionRegistry<MockLaneSession>((cfg) => new MockLaneSession(cfg));
		const lane1 = registry.getOrCreateLaneSession({
			id: 'proj-x',
			lane: { laneId: 'main', workspacePath: 'C:/repos/app' }
		});
		const lane2 = registry.getOrCreateLaneSession({
			id: 'proj-x',
			lane: { laneId: 'lane-b', workspacePath: 'C:/repos/.omp-wt-app-b' }
		});

		const open1 = lane1.open();
		const open2 = lane2.open();
		opens[0].resolve(111);
		opens[1].resolve(222);
		await Promise.all([open1, open2]);

		await registry.disposeSession(lane2);

		const closeCalls = calls.filter((c) => c.cmd === 'rpc_close');
		assert.equal(closeCalls.length, 1);
		assert.equal(closeCalls[0].args.rpcId, 222);

		assert.equal(lane2.client.isOpen, false);
		assert.equal(lane1.client.isOpen, true);
		assert.equal(registry.getLaneSession('proj-x', 'lane-b'), undefined);
		assert.equal(registry.getMainSession('proj-x'), lane1);
	});

	it('7. Handoff transparente: passaggio a GUI o TUI riprende con lo stesso sessionId', async () => {
		const session = new MockLaneSession({
			cwd: 'C:/repos/.omp-wt-app-b',
			scope: 'lane',
			laneId: 'lane-b',
			projectKey: 'proj-x'
		});

		const opening = session.open('session-omp-999');
		assert.equal(calls[0].cmd, 'rpc_open');
		assert.equal(calls[0].args.resume, 'session-omp-999');
		assert.equal(calls[0].args.cwd, 'C:/repos/.omp-wt-app-b');

		opens[0].resolve(333);
		await opening;
		assert.equal(session.client.isOpen, true);
	});
});
