/// <reference types="node" />
/// <reference lib="es2020" />

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	extractLatestAssistantMessage,
	resolveLatestAssistantReference,
	readConversationSnapshot,
	sendConversationToSession,
	setupCompanionConversationHost
} from '../src/lib/companion/hostConversation.ts';
import {
	CompanionConversationError,
	type CompanionConversationSnapshot
} from '../src/lib/companion/conversation.ts';
import type { TranscriptEntry, AssistantEntry, UserEntry } from '../src/lib/agent/session.svelte.ts';
import { SessionRegistry, type AgentSessionLike } from '../src/lib/agent/sessionRegistry.ts';
import { projectStore, type Project } from '../src/lib/stores/projects.svelte.ts';

describe('Companion 2.0 Conversation Backend', () => {
	let previousProjects = projectStore.projects;
	beforeEach(() => { previousProjects = projectStore.projects; });
	afterEach(() => { projectStore.projects = previousProjects; });
	describe('extractLatestAssistantMessage', () => {
		it('extracts complete and concluded assistant message without text truncation (e.g. > 30k chars)', () => {
			const hugeText = 'A'.repeat(45_000);
			const entries: TranscriptEntry[] = [
				{ id: 1, kind: 'user', content: 'Fai il dump completo' } as UserEntry,
				{
					id: 2,
					kind: 'assistant',
					messageTs: 1729000000000,
					stopReason: 'end_turn',
					blocks: [
						{ type: 'thinking', text: 'Pensiero interiore da escludere' },
						{ type: 'text', text: hugeText }
					]
				} as AssistantEntry
			];

			const result = extractLatestAssistantMessage(entries, false, 'idle');
			assert.ok(result);
			assert.equal(result.message.text, hugeText);
			assert.equal(result.message.at, 1729000000000);
		});

		it('excludes partial streams when isStreaming is true', () => {
			const entries: TranscriptEntry[] = [
				{ id: 1, kind: 'user', content: 'Calcola 1+1' } as UserEntry,
				{
					id: 2,
					kind: 'assistant',
					blocks: [{ type: 'text', text: 'Sto calcolando...' }]
				} as AssistantEntry
			];

			const result = extractLatestAssistantMessage(entries, true, 'working');
			assert.equal(result, null, 'Un messaggio in fase di streaming deve essere scartato');
		});

		it('excludes busy session when agentState is working', () => {
			const entries: TranscriptEntry[] = [
				{ id: 1, kind: 'user', content: 'Esegui il test' } as UserEntry,
				{
					id: 2,
					kind: 'assistant',
					blocks: [{ type: 'text', text: 'Eseguo il tool...' }]
				} as AssistantEntry
			];

			const result = extractLatestAssistantMessage(entries, false, 'working');
			assert.equal(result, null, 'Una sessione in stato working non ha ancora concluso il turno');
		});

		it('excludes aborted assistant messages and fails closed without falling back to previous turn', () => {
			const entries: TranscriptEntry[] = [
				// Turno 1 concluso con successo
				{ id: 1, kind: 'user', content: 'Turno 1' } as UserEntry,
				{
					id: 2,
					kind: 'assistant',
					messageTs: 1000,
					stopReason: 'end_turn',
					blocks: [{ type: 'text', text: 'Risposta turno 1' }]
				} as AssistantEntry,
				// Turno 2 interrotto con abort
				{ id: 3, kind: 'user', content: 'Turno 2' } as UserEntry,
				{
					id: 4,
					kind: 'assistant',
					messageTs: 2000,
					stopReason: 'aborted',
					blocks: [{ type: 'text', text: 'Risposta parziale interrotta' }]
				} as AssistantEntry
			];

			const result = extractLatestAssistantMessage(entries, false, 'idle');
			assert.equal(
				result,
				null,
				'Il messaggio abortito non deve essere selezionato e non deve avvenire falso fallback al turno 1'
			);
		});

		it('excludes error assistant messages and fails closed without falling back to previous turn', () => {
			const entries: TranscriptEntry[] = [
				{ id: 1, kind: 'user', content: 'Turno 1' } as UserEntry,
				{
					id: 2,
					kind: 'assistant',
					messageTs: 1000,
					stopReason: 'end_turn',
					blocks: [{ type: 'text', text: 'Risposta turno 1' }]
				} as AssistantEntry,
				{ id: 3, kind: 'user', content: 'Turno 2 con crash' } as UserEntry,
				{
					id: 4,
					kind: 'assistant',
					messageTs: 2000,
					stopReason: 'error',
					blocks: [{ type: 'text', text: 'Errore fatale del modello' }]
				} as AssistantEntry
			];

			const result = extractLatestAssistantMessage(entries, false, 'idle');
			assert.equal(result, null, 'Il messaggio con errore non deve essere selezionato');
		});

		for (const stopReason of ['toolUse', 'tool_use']) {
			it(`does not promote intermediate tool prose to a finished answer (${stopReason})`, () => {
				const entry: AssistantEntry = {
					id: 2, kind: 'assistant', stopReason,
					blocks: [{ type: 'text', text: 'Controllo i file, il risultato non e ancora pronto.' }]
				};
				assert.equal(extractLatestAssistantMessage([entry], false, 'attention'), null);
			});
		}

		it('excludes thinking-only messages without prose text and avoids false fallback', () => {
			const entries: TranscriptEntry[] = [
				{ id: 1, kind: 'user', content: 'Turno 1' } as UserEntry,
				{
					id: 2,
					kind: 'assistant',
					messageTs: 1000,
					stopReason: 'end_turn',
					blocks: [{ type: 'text', text: 'Risposta turno 1' }]
				} as AssistantEntry,
				{ id: 3, kind: 'user', content: 'Turno 2 con solo pensiero' } as UserEntry,
				{
					id: 4,
					kind: 'assistant',
					messageTs: 2000,
					stopReason: 'end_turn',
					blocks: [{ type: 'thinking', text: 'Sto solo pensando...' }]
				} as AssistantEntry
			];

			const result = extractLatestAssistantMessage(entries, false, 'idle');
			assert.equal(result, null, 'Messaggio con solo pensiero non deve essere considerato risposta leggibile');
		});

		it('returns null if latest entry is a user prompt without assistant response', () => {
			const entries: TranscriptEntry[] = [
				{ id: 1, kind: 'user', content: 'Turno 1' } as UserEntry,
				{
					id: 2,
					kind: 'assistant',
					messageTs: 1000,
					stopReason: 'end_turn',
					blocks: [{ type: 'text', text: 'Risposta turno 1' }]
				} as AssistantEntry,
				{ id: 3, kind: 'user', content: 'Turno 2 in attesa' } as UserEntry
			];

			const result = extractLatestAssistantMessage(entries, false, 'idle');
			assert.equal(result, null, 'Se l’ultimo messaggio e’ dell’utente, non c’e’ ancora risposta per questo turno');
		});
	});

	describe('resolveLatestAssistantReference', () => {
		it('keeps the same result pending identity when transcript entries are rebuilt', () => {
			const entry: AssistantEntry = {
				id: 2, kind: 'assistant', messageTs: 1729000000000,
				stopReason: 'end_turn', blocks: [{ type: 'text', text: 'Piano completato' }]
			};
			const first = resolveLatestAssistantReference({ entries: [entry], sessionId: 's1' });
			const rebuilt = resolveLatestAssistantReference({ entries: [{ ...entry, id: 200 }], sessionId: 's1' });
			assert.ok(first && rebuilt);
			assert.equal(rebuilt.messageId, first.messageId);
		});

		it('returns undefined if session is streaming or working', () => {
			const entries: TranscriptEntry[] = [
				{ id: 1, kind: 'user', content: 'Ciao' } as UserEntry,
				{
					id: 10,
					kind: 'assistant',
					blocks: [{ type: 'text', text: 'Parziale' }]
				} as AssistantEntry
			];

			assert.equal(
				resolveLatestAssistantReference({
					entries,
					isStreaming: true,
					agentState: 'working',
					laneId: 'main',
					sessionId: 'sess-1'
				}),
				undefined
			);
		});

		it('returns undefined if session has no sessionId', () => {
			const entries: TranscriptEntry[] = [
				{ id: 1, kind: 'assistant', blocks: [{ type: 'text', text: 'Testo' }] } as AssistantEntry
			];
			assert.equal(
				resolveLatestAssistantReference({
					entries,
					isStreaming: false,
					agentState: 'idle',
					laneId: 'main',
					sessionId: null
				}),
				undefined
			);
		});
	});

	describe('readConversationSnapshot', () => {
		const registry = new SessionRegistry<AgentSessionLike>();

		it('rejects with not_found for non-existent project', async () => {
			projectStore.projects = [];
			await assert.rejects(
				async () => {
					await readConversationSnapshot('non-existent', 'main', registry);
				},
				(err: unknown) => {
					assert.ok(err instanceof CompanionConversationError);
					assert.equal(err.code, 'not_found');
					return true;
				}
			);
		});

		it('flags canSend: false when lane is on terminal surface', async () => {
			projectStore.projects = [
				{
					id: 'p-term',
					name: 'Terminal Project',
					lane: { laneId: 'main', surface: 'terminal', workspacePath: '/tmp/term' }
				} as unknown as Project
			];

			const snapshot = await readConversationSnapshot('p-term', 'main', registry);
			assert.equal(snapshot.canSend, false);
		});

		it('flags canSend: false when session has pendingUi dialog', async () => {
			projectStore.projects = [
				{
					id: 'p-gui',
					name: 'GUI Project',
					lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/gui' }
				} as unknown as Project
			];

			const mockSession = {
				cwd: '/tmp/gui',
				scope: 'main',
				projectKey: 'p-gui',
				sessionKey: 'lane:p-gui:main',
				sessionId: 'sess-pending-ui',
				pendingUi: { kind: 'ask', requestId: 'req-1', message: 'Confermi?' },
				entries: [
					{ id: 1, kind: 'user', content: 'Domanda' },
					{
						id: 2,
						kind: 'assistant',
						stopReason: 'end_turn',
						blocks: [{ type: 'text', text: 'Devo chiederti conferma' }]
					}
				]
			} as unknown as AgentSessionLike;

			registry.setLaneSession('p-gui', 'main', mockSession);

			const snapshot = await readConversationSnapshot('p-gui', 'main', registry);
			assert.equal(snapshot.canSend, false);
			assert.equal(snapshot.entries?.length, 2);
		});

	});

	describe('sendConversationToSession', () => {
		const registry = new SessionRegistry<AgentSessionLike>();

		beforeEach(() => {
			projectStore.projects = [
				{
					id: 'p-send',
					name: 'Send Project',
					lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/send' }
				} as unknown as Project
			];
		});

		it('rejects empty message with failed', async () => {
			await assert.rejects(
				async () => {
					await sendConversationToSession({ projectId: 'p-send', laneId: 'main', sessionId: 'sess-1' }, '   ');
				},
				(err: unknown) => {
					assert.ok(err instanceof CompanionConversationError);
					assert.equal(err.code, 'failed');
					return true;
				}
			);
		});

		it('rejects non-existent project with not_found', async () => {
			await assert.rejects(
				async () => {
					await sendConversationToSession(
						{ projectId: 'unknown-project', laneId: 'main', sessionId: 'sess-1' },
						'procedi pure'
					);
				},
				(err: unknown) => {
					assert.ok(err instanceof CompanionConversationError);
					assert.equal(err.code, 'not_found');
					return true;
				}
			);
		});

		it('fails closed when active session ID does not match target session ID (session_changed)', async () => {
			const mockSession = {
				cwd: '/tmp/send',
				scope: 'main',
				projectKey: 'p-send',
				sessionKey: 'lane:p-send:main',
				sessionId: 'active-session-new',
				isOpen: true,
				prompt: async () => 'sent'
			} as unknown as AgentSessionLike;

			registry.setLaneSession('p-send', 'main', mockSession);

			await assert.rejects(
				async () => {
					await sendConversationToSession(
						{ projectId: 'p-send', laneId: 'main', sessionId: 'old-session-stale' },
						'procedi pure',
						{ registry }
					);
				},
				(err: unknown) => {
					assert.ok(err instanceof CompanionConversationError);
					assert.equal(err.code, 'session_changed');
					return true;
				}
			);
		});

		it('re-checks identity post-await if session is opened and rejects if session changed during open', async () => {
			let openedSessionId = 'rebound-session-different';
			const mockSession = {
				cwd: '/tmp/send',
				scope: 'main',
				projectKey: 'p-send',
				sessionKey: 'lane:p-send:main',
				sessionId: 'session-target',
				isOpen: false,
				open: async () => {
					mockSession.sessionId = openedSessionId;
				},
				prompt: async () => 'sent'
			} as unknown as AgentSessionLike;

			registry.setLaneSession('p-send', 'main', mockSession);

			await assert.rejects(
				async () => {
					await sendConversationToSession(
						{ projectId: 'p-send', laneId: 'main', sessionId: 'session-target' },
						'procedi pure',
						{ registry }
					);
				},
				(err: unknown) => {
					assert.ok(err instanceof CompanionConversationError);
					assert.equal(err.code, 'session_changed');
					return true;
				}
			);
		});

		it('does not cancel a formal question that appeared after the snapshot was read', async () => {
			let delivered = false;
			const session = {
				cwd: '/tmp/send', scope: 'main', projectKey: 'p-send',
				sessionKey: 'lane:p-send:main', sessionId: 'same-session', isOpen: true,
				pendingUi: null,
				prompt: async () => {
					delivered = true;
					session.pendingUi = null;
					return 'sent';
				}
			} as unknown as AgentSessionLike;
			registry.setLaneSession('p-send', 'main', session);
			const snapshot = await readConversationSnapshot('p-send', 'main', registry);
			assert.equal(snapshot.canSend, true);
			const pending = { kind: 'ask', requestId: 'late-question', title: 'Quale ambiente?' };
			session.pendingUi = pending;
			await assert.rejects(
				sendConversationToSession({ projectId: 'p-send', laneId: 'main', sessionId: 'same-session' }, 'procedi pure', { registry }),
				(error: unknown) => error instanceof CompanionConversationError && error.code === 'unavailable'
			);
			assert.equal(delivered, false);
			assert.equal(session.pendingUi, pending);
		});

		it('does not send to an orphaned session when its lane is rebound during open', async () => {
			let delivered = false;
			const oldSession = {
				cwd: '/tmp/send', scope: 'main', projectKey: 'p-send',
				sessionKey: 'lane:p-send:main', sessionId: 'old-session', isOpen: false,
				open: async () => {
					registry.setLaneSession('p-send', 'main', { ...oldSession, sessionId: 'new-session', isOpen: true });
				},
				prompt: async () => { delivered = true; return 'sent'; }
			} as unknown as AgentSessionLike;
			registry.setLaneSession('p-send', 'main', oldSession);
			await assert.rejects(
				sendConversationToSession({ projectId: 'p-send', laneId: 'main', sessionId: 'old-session' }, 'procedi pure', { registry }),
				(error: unknown) => error instanceof CompanionConversationError && error.code === 'session_changed'
			);
			assert.equal(delivered, false);
		});

		it('translates session.prompt returning failed to CompanionConversationError(failed)', async () => {
			const mockSession = {
				cwd: '/tmp/send',
				scope: 'main',
				projectKey: 'p-send',
				sessionKey: 'lane:p-send:main',
				sessionId: 'sess-target',
				isOpen: true,
				prompt: async () => 'failed'
			} as unknown as AgentSessionLike;

			registry.setLaneSession('p-send', 'main', mockSession);

			await assert.rejects(
				async () => {
					await sendConversationToSession(
						{ projectId: 'p-send', laneId: 'main', sessionId: 'sess-target' },
						'ciao',
						{ registry }
					);
				},
				(err: unknown) => {
					assert.ok(err instanceof CompanionConversationError);
					assert.equal(err.code, 'failed');
					return true;
				}
			);
		});

		it('catches session.prompt throw and rethrows as CompanionConversationError(failed)', async () => {
			const mockSession = {
				cwd: '/tmp/send',
				scope: 'main',
				projectKey: 'p-send',
				sessionKey: 'lane:p-send:main',
				sessionId: 'sess-target',
				isOpen: true,
				prompt: async () => {
					throw new Error('Processo omp terminato bruscamente');
				}
			} as unknown as AgentSessionLike;

			registry.setLaneSession('p-send', 'main', mockSession);

			await assert.rejects(
				async () => {
					await sendConversationToSession(
						{ projectId: 'p-send', laneId: 'main', sessionId: 'sess-target' },
						'ciao',
						{ registry }
					);
				},
				(err: unknown) => {
					assert.ok(err instanceof CompanionConversationError);
					assert.equal(err.code, 'failed');
					return true;
				}
			);
		});
	});

	describe('setupCompanionConversationHost & IPC transport', () => {
		const registry = new SessionRegistry<AgentSessionLike>();

		it('correlates load-conversation request and response via correlationId and unregisters on cleanup', async () => {
			projectStore.projects = [
				{
					id: 'p-ipc',
					name: 'IPC Project',
					lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/ipc' }
				} as unknown as Project
			];

			const mockSession = {
				cwd: '/tmp/ipc',
				scope: 'main',
				projectKey: 'p-ipc',
				sessionKey: 'lane:p-ipc:main',
				sessionId: 'sess-ipc-1',
				entries: [
					{ id: 1, kind: 'user', content: 'Stato?' },
					{
						id: 2,
						kind: 'assistant',
						stopReason: 'end_turn',
						blocks: [{ type: 'text', text: 'Tutto in ordine.' }]
					}
				]
			} as unknown as AgentSessionLike;

			registry.setLaneSession('p-ipc', 'main', mockSession);

			const emittedEvents: Array<{ event: string; payload: unknown }> = [];
			const listeners = new Map<string, Array<(event: { payload: unknown }) => void>>();

			const mockEmit = async <T>(event: string, payload: T) => {
				emittedEvents.push({ event, payload });
			};

			const mockListen = async <T>(event: string, handler: (event: { payload: T }) => void) => {
				if (!listeners.has(event)) listeners.set(event, []);
				listeners.get(event)!.push(handler as (event: { payload: unknown }) => void);
				return () => {
					const list = listeners.get(event);
					if (list) {
						const idx = list.indexOf(handler as (event: { payload: unknown }) => void);
						if (idx !== -1) list.splice(idx, 1);
					}
				};
			};

			const cleanup = setupCompanionConversationHost({
				registry,
				emitFn: mockEmit,
				listenFn: mockListen
			});

			// Simula una richiesta arrivata dalla Companion
			const reqHandlers = listeners.get('companion-load-conversation-req');
			assert.ok(reqHandlers && reqHandlers.length > 0);

			await reqHandlers[0]({
				payload: {
					correlationId: 'req-corr-999',
					projectId: 'p-ipc',
					laneId: 'main'
				}
			});

			assert.equal(emittedEvents.length, 1);
			assert.equal(emittedEvents[0].event, 'companion-load-conversation-res');
			const resPayload = emittedEvents[0].payload as {
				correlationId: string;
				snapshot?: CompanionConversationSnapshot;
			};
			assert.equal(resPayload.correlationId, 'req-corr-999');
			assert.ok(resPayload.snapshot);
			assert.equal(resPayload.snapshot.sessionId, 'sess-ipc-1');
			assert.equal(resPayload.snapshot.message?.text, 'Tutto in ordine.');

			// Cleanup rimuove tutti i listener registrati
			cleanup();
			assert.equal(listeners.get('companion-load-conversation-req')?.length, 0);
			assert.equal(listeners.get('companion-send-conversation-req')?.length, 0);
		});

		it('serializes CompanionConversationError properly on failure', async () => {
			projectStore.projects = [];

			const emittedEvents: Array<{ event: string; payload: unknown }> = [];
			const listeners = new Map<string, Array<(event: { payload: unknown }) => void>>();

			const mockEmit = async <T>(event: string, payload: T) => {
				emittedEvents.push({ event, payload });
			};

			const mockListen = async <T>(event: string, handler: (event: { payload: T }) => void) => {
				if (!listeners.has(event)) listeners.set(event, []);
				listeners.get(event)!.push(handler as (event: { payload: unknown }) => void);
				return () => {};
			};

			const cleanup = setupCompanionConversationHost({
				registry,
				emitFn: mockEmit,
				listenFn: mockListen
			});

			const reqHandlers = listeners.get('companion-load-conversation-req');
			assert.ok(reqHandlers && reqHandlers.length > 0);

			await reqHandlers[0]({
				payload: {
					correlationId: 'req-corr-err',
					projectId: 'non-existent',
					laneId: 'main'
				}
			});

			assert.equal(emittedEvents.length, 1);
			const resPayload = emittedEvents[0].payload as {
				correlationId: string;
				error?: { code: string; message: string };
			};
			assert.equal(resPayload.correlationId, 'req-corr-err');
			assert.ok(resPayload.error);
			assert.equal(resPayload.error.code, 'not_found');

			cleanup();
		});
	});
});
