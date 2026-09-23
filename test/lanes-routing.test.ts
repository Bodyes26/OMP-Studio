/**
 * W05 Contract Test: Routing esatto per Ask, PromptBus, Companion e notifiche
 *
 * Difende le invarianti del Gate R27 / PLAN W05:
 * 1. PromptBus memorizza e isola le richieste per `projectId` e `laneId`.
 * 2. Risoluzione mirata con target filter: mismatch di laneId o sessionId rifiuta la risposta.
 * 3. Due Ask simultanei su corsie distinte dello stesso progetto vengono instradati
 *    ciascuno alla propria corsia senza interferire con l'altra.
 * 4. Payload legacy ambigui (senza laneId/requestId quando piu' corsie attendono risposta)
 *    falliscono chiusi (nessun fallback arbitrario a 'prima sessione' o 'main').
 * 5. Payload legacy con target univoco (una sola corsia del progetto in attesa) convergono con successo.
 * 6. Protezione focus durante digitazione attiva (Monaco, xterm, composer, input, textarea).
 * 7. Convergenza Companion: richieste di attenzione coesistono per corsie differenti
 *    dello stesso progetto e vengono rimosse selettivamente per corsia.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PromptBus, type PromptBusStorage } from '../src/lib/agent/promptBus.ts';
import { SessionRegistry, type AgentSessionLike, type UiResponsePayload } from '../src/lib/agent/sessionRegistry.ts';
import { shouldAutoFocusAskCard, isTypingSurface } from '../src/lib/agent/askFocus.ts';
import {
	buildAttentionRequest,
	sameAttentionRequest,
	upsertAttentionRequest,
	removeAttentionRequest
} from '../src/lib/stores/companionAttention.ts';
import type { AttentionRequest } from '../src/lib/stores/companion.svelte.ts';

function createMockStorage(): PromptBusStorage {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, val: string) => map.set(key, val),
		removeItem: (key: string) => map.delete(key)
	};
}

describe('W05 — Routing esatto PromptBus, SessionRegistry e Companion', () => {
	let storage: PromptBusStorage;
	let bus: PromptBus;

	beforeEach(() => {
		storage = createMockStorage();
		bus = new PromptBus({ storage, autoInit: false });
	});

	describe('1. PromptBus — Isolamento corsie e target filter', () => {
		it('registra e filtra le richieste per projectId e laneId', () => {
			bus.registerRequest({
				requestId: 'req-main',
				projectId: 'proj-portalino',
				laneId: 'main',
				title: 'Domanda corsia principale',
				method: 'select',
				options: ['A', 'B']
			});

			bus.registerRequest({
				requestId: 'req-wt',
				projectId: 'proj-portalino',
				laneId: 'lane-refactor',
				title: 'Domanda corsia secondaria',
				method: 'select',
				options: ['X', 'Y']
			});

			const allProjectPendings = bus.getPendingsForProject('proj-portalino');
			assert.equal(allProjectPendings.length, 2);

			const mainPendings = bus.getPendingsForLane('proj-portalino', 'main');
			assert.equal(mainPendings.length, 1);
			assert.equal(mainPendings[0].requestId, 'req-main');
			assert.equal(mainPendings[0].laneId, 'main');

			const wtPendings = bus.getPendingsForLane('proj-portalino', 'lane-refactor');
			assert.equal(wtPendings.length, 1);
			assert.equal(wtPendings[0].requestId, 'req-wt');
			assert.equal(wtPendings[0].laneId, 'lane-refactor');
		});

		it('risolve solo se il target filter coincide con la corsia e il progetto', async () => {
			let answered = false;
			bus.registerRequest({
				requestId: 'req-1',
				projectId: 'proj-1',
				laneId: 'lane-a',
				title: 'Procedere?',
				method: 'confirm',
				responder: async () => {
					answered = true;
					return true;
				}
			});

			// Mismatch di laneId: deve fallire
			const mismatchLane = await bus.resolveRequest(
				'req-1',
				{ action: 'confirm', confirmed: true },
				{ projectId: 'proj-1', laneId: 'lane-b' }
			);
			assert.equal(mismatchLane, false);
			assert.equal(answered, false);
			assert.equal(bus.hasPending('req-1'), true);

			// Mismatch di projectId: deve fallire
			const mismatchProj = await bus.resolveRequest(
				'req-1',
				{ action: 'confirm', confirmed: true },
				{ projectId: 'proj-altro', laneId: 'lane-a' }
			);
			assert.equal(mismatchProj, false);
			assert.equal(answered, false);

			// Match esatto: deve risolvere con successo
			const ok = await bus.resolveRequest(
				'req-1',
				{ action: 'confirm', confirmed: true },
				{ projectId: 'proj-1', laneId: 'lane-a' }
			);
			assert.equal(ok, true);
			assert.equal(answered, true);
			assert.equal(bus.hasPending('req-1'), false);
		});
	});

	describe('2. SessionRegistry — Instradamento simultaneo e fail-closed su ambiguità', () => {
		interface MockSession extends AgentSessionLike {
			answeredValue?: string;
			answeredConfirmed?: boolean;
		}

		function createMockSession(params: {
			projectKey: string;
			laneId: string;
			sessionId: string;
			pendingReqId?: string;
		}): MockSession {
			const { projectKey, laneId, sessionId, pendingReqId } = params;
			const sessionKey = `lane:${projectKey}:${laneId}`;
			const session: MockSession = {
				cwd: `/work/${projectKey}/${laneId}`,
				scope: laneId === 'main' ? 'main' : 'lane',
				laneId,
				prototypeId: null,
				projectKey,
				sessionKey,
				sessionId,
				pendingUi: pendingReqId
					? { kind: 'ask', requestId: pendingReqId, message: `Domanda su ${laneId}` }
					: null,
				isStreaming: false,
				agentState: pendingReqId ? 'attention' : 'idle',
				inferredAttention: null,
				open: async () => {},
				close: async () => {},
				abort: async () => {},
				answerSelect: async (val: string) => {
					session.answeredValue = val;
					session.pendingUi = null;
					session.agentState = 'idle';
				},
				answerConfirm: async (conf: boolean) => {
					session.answeredConfirmed = conf;
					session.pendingUi = null;
					session.agentState = 'idle';
				},
				cancelPendingUi: async () => {
					session.pendingUi = null;
					session.agentState = 'idle';
				}
			};
			return session;
		}

		it('instrada correttamente due Ask simultanei sulle rispettive corsie tramite laneId', async () => {
			const registry = new SessionRegistry<MockSession>();
			const mainSession = createMockSession({
				projectKey: 'proj-1',
				laneId: 'main',
				sessionId: 'omp-sess-main',
				pendingReqId: 'req-main'
			});
			const wtSession = createMockSession({
				projectKey: 'proj-1',
				laneId: 'lane-wt-1',
				sessionId: 'omp-sess-wt',
				pendingReqId: 'req-wt'
			});

			registry.setLaneSession('proj-1', 'main', mainSession);
			registry.setLaneSession('proj-1', 'lane-wt-1', wtSession);

			// Risposta mirata alla corsia worktree
			const okWt = await registry.routeUiResponse({
				projectId: 'proj-1',
				laneId: 'lane-wt-1',
				response: { action: 'select', value: 'Opzione WT' }
			});
			assert.equal(okWt, true);
			assert.equal(wtSession.answeredValue, 'Opzione WT');
			assert.equal(wtSession.pendingUi, null);

			// La corsia main non deve essere stata toccata
			assert.equal(mainSession.answeredValue, undefined);
			assert.ok(mainSession.pendingUi !== null);

			// Risposta mirata alla corsia principale
			const okMain = await registry.routeUiResponse({
				projectId: 'proj-1',
				laneId: 'main',
				response: { action: 'select', value: 'Opzione Main' }
			});
			assert.equal(okMain, true);
			assert.equal(mainSession.answeredValue, 'Opzione Main');
			assert.equal(mainSession.pendingUi, null);
		});

		it('risolve direttamente tramite requestId senza ambiguita tra corsie', async () => {
			const registry = new SessionRegistry<MockSession>();
			const s1 = createMockSession({
				projectKey: 'proj-1',
				laneId: 'main',
				sessionId: 's-1',
				pendingReqId: 'req-alpha'
			});
			const s2 = createMockSession({
				projectKey: 'proj-1',
				laneId: 'lane-2',
				sessionId: 's-2',
				pendingReqId: 'req-beta'
			});

			registry.setLaneSession('proj-1', 'main', s1);
			registry.setLaneSession('proj-1', 'lane-2', s2);

			const ok = await registry.routeUiResponse({
				projectId: 'proj-1',
				requestId: 'req-beta',
				response: { action: 'select', value: 'Scelta Beta' }
			});

			assert.equal(ok, true);
			assert.equal(s2.answeredValue, 'Scelta Beta');
			assert.equal(s1.answeredValue, undefined);
		});

		it('payload legacy ambiguo (senza laneId/requestId con >1 corsie in attesa) fallisce chiuso', async () => {
			const registry = new SessionRegistry<MockSession>();
			const mainSession = createMockSession({
				projectKey: 'proj-1',
				laneId: 'main',
				sessionId: 's-1',
				pendingReqId: 'req-main'
			});
			const wtSession = createMockSession({
				projectKey: 'proj-1',
				laneId: 'lane-wt',
				sessionId: 's-2',
				pendingReqId: 'req-wt'
			});

			registry.setLaneSession('proj-1', 'main', mainSession);
			registry.setLaneSession('proj-1', 'lane-wt', wtSession);

			// Payload ambiguo: ha solo projectId
			const ambiguousPayload: UiResponsePayload = {
				projectId: 'proj-1',
				response: { action: 'select', value: 'Valore Ambiguo' }
			};

			const routed = await registry.routeUiResponse(ambiguousPayload);

			// DEVE fallire chiuso per non rischiare di rispondere alla corsia sbagliata!
			assert.equal(routed, false);
			assert.equal(mainSession.answeredValue, undefined);
			assert.equal(wtSession.answeredValue, undefined);
			assert.ok(mainSession.pendingUi !== null);
			assert.ok(wtSession.pendingUi !== null);
		});

		it('payload legacy converge se e solo se il target e univoco (esattamente 1 sessione con pendingUi)', async () => {
			const registry = new SessionRegistry<MockSession>();
			const idleSession = createMockSession({
				projectKey: 'proj-1',
				laneId: 'main',
				sessionId: 's-1'
			});
			const onlyWaitingSession = createMockSession({
				projectKey: 'proj-1',
				laneId: 'lane-wt',
				sessionId: 's-2',
				pendingReqId: 'req-only'
			});

			registry.setLaneSession('proj-1', 'main', idleSession);
			registry.setLaneSession('proj-1', 'lane-wt', onlyWaitingSession);

			const legacyPayload: UiResponsePayload = {
				projectId: 'proj-1',
				response: { action: 'confirm', confirmed: true }
			};

			const routed = await registry.routeUiResponse(legacyPayload);
			assert.equal(routed, true);
			assert.equal(onlyWaitingSession.answeredConfirmed, true);
			assert.equal(idleSession.answeredConfirmed, undefined);
		});
	});

	describe('3. Isolamento del focus e non-interruzione della digitazione', () => {
		it('rifiuta autofocus se l\'utente sta digitando in un input o textarea', () => {
			const fakeInput = { tagName: 'INPUT', isContentEditable: false };
			const fakeBody = { tagName: 'BODY', isContentEditable: false };

			const allow = shouldAutoFocusAskCard(true, true, fakeInput, fakeBody, false);
			assert.equal(allow, false, 'Non deve rubare il focus a un input');
		});

		it('rifiuta autofocus se l\'utente sta digitando in un editor (Monaco, xterm, composer)', () => {
			const insideMonaco = {
				tagName: 'DIV',
				isContentEditable: false,
				closest: (sel: string) => (sel.includes('monaco-editor') ? ({} as Element) : null)
			};
			const fakeBody = { tagName: 'BODY', isContentEditable: false };

			const allow = shouldAutoFocusAskCard(true, true, insideMonaco, fakeBody, false);
			assert.equal(allow, false, 'Non deve rubare il focus a Monaco editor');
		});

		it('rifiuta autofocus se la card non e visibile o la finestra non ha il focus', () => {
			const fakeBody = { tagName: 'BODY', isContentEditable: false };
			assert.equal(shouldAutoFocusAskCard(false, true, fakeBody, fakeBody, false), false);
			assert.equal(shouldAutoFocusAskCard(true, false, fakeBody, fakeBody, false), false);
		});

		it('concede autofocus solo se la card e visibile, la finestra ha il focus e non si digita altrove', () => {
			const fakeBody = { tagName: 'BODY', isContentEditable: false };
			assert.equal(shouldAutoFocusAskCard(true, true, fakeBody, fakeBody, false), true);
		});
	});

	describe('4. Convergenza Companion e richieste multi-corsia', () => {
		function createAttention(projectId: string, laneId: string, reqId: string): AttentionRequest {
			return {
				projectId,
				laneId,
				laneTitle: laneId === 'main' ? 'Principale' : laneId,
				projectName: 'Progetto Test',
				projectHue: 200,
				recentMessages: [],
				pendingUi: {
					kind: 'ask',
					requestId: reqId,
					laneId,
					title: `Domanda su ${laneId}`,
					options: ['Si', 'No']
				}
			};
		}

		it('consente a piu richieste dello stesso progetto su corsie differenti di coesistere', () => {
			const reqMain = createAttention('proj-1', 'main', 'req-1');
			const reqLaneA = createAttention('proj-1', 'lane-a', 'req-2');

			let list: AttentionRequest[] = [];
			const next1 = upsertAttentionRequest(list, reqMain);
			assert.ok(next1);
			list = next1;
			assert.equal(list.length, 1);

			const next2 = upsertAttentionRequest(list, reqLaneA);
			assert.ok(next2);
			list = next2;
			assert.equal(list.length, 2);

			// Verifichiamo che entrambi siano presenti e distinti
			assert.equal(list[0].laneId, 'main');
			assert.equal(list[1].laneId, 'lane-a');
		});

		it('rimuove selettivamente solo la richiesta della corsia indicata', () => {
			const reqMain = createAttention('proj-1', 'main', 'req-1');
			const reqLaneA = createAttention('proj-1', 'lane-a', 'req-2');

			const initial = [reqMain, reqLaneA];
			const afterRemoveLaneA = removeAttentionRequest(initial, 'proj-1', 'lane-a');

			assert.ok(afterRemoveLaneA);
			assert.equal(afterRemoveLaneA.length, 1);
			assert.equal(afterRemoveLaneA[0].laneId, 'main');
		});

		it('rimuove tutte le richieste del progetto se laneId non e specificato', () => {
			const reqMain = createAttention('proj-1', 'main', 'req-1');
			const reqLaneA = createAttention('proj-1', 'lane-a', 'req-2');

			const initial = [reqMain, reqLaneA];
			const afterRemoveAll = removeAttentionRequest(initial, 'proj-1');

			assert.ok(afterRemoveAll);
			assert.equal(afterRemoveAll.length, 0);
		});

		it('sameAttentionRequest distingue richieste con laneId diverso', () => {
			const reqMain = createAttention('proj-1', 'main', 'req-1');
			const reqLaneA = createAttention('proj-1', 'lane-a', 'req-1');

			assert.equal(sameAttentionRequest(reqMain, reqLaneA), false);
		});
	});
});
