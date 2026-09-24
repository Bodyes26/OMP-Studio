// Registro unificato delle sessioni agente di OMP Studio.
//
// Governa due famiglie di sessioni indipendenti:
// 1. Corsie di progetto (`scope: 'lane'`), inclusa la corsia `main`, ciascuna
//    legata al proprio workspace e al proprio handoff TUI/GUI;
// 2. Sessioni del Laboratorio prototipi (`scope: 'lab'`), dedicate a un
//    prototipo specifico dentro `proto/<id>` o in archivio bozze.
//
// Ogni sessione possiede client, transcript, input pendenti e abort. Il
// registro sceglie soltanto l'identita' logica: i processi restano isolati
// dagli id PTY/RPC creati dai rispettivi adapter.

import type { AgentSession, AgentSessionConfig } from './session.svelte';
import type { AskFlushStep } from './askAnswers';
import { promptBus } from './promptBus.ts';
import { laneSessionKey } from './sessionKeys';
import { m as msg } from '$lib/paraglide/messages.js';
import { createSubscriber } from 'svelte/reactivity';

export { laneSessionKey, mainSessionKey } from './sessionKeys';

export interface UiResponsePayload {
	projectId: string;
	laneId?: string;
	sessionId?: string;
	requestId?: string;
	response: {
		action: 'select' | 'confirm' | 'wizard' | 'cancel';
		value?: string;
		confirmed?: boolean;
		plan?: AskFlushStep[];
	};
}

export interface AgentSessionLike {
	readonly cwd: string;
	readonly scope: 'lane' | 'main';
	readonly laneId?: string | null;
	readonly projectKey: string;
	readonly sessionKey: string;
	sessionId: string | null;
	observedRevisionId?: string | null;
	pendingUi?: { kind: string; requestId?: string; message?: string } | null;
	isStreaming?: boolean;
	agentState?: string;
	inferredAttention?: { question: string; suggestions: string[] } | null;
	subagents?: Array<{ status?: string; resolvedModel?: string }>;
	model?: { provider?: string; id?: string; name?: string } | null;
	open(resume?: string | null): Promise<void>;
	close(): Promise<void>;
	abort(): Promise<void>;
	applyQueueModes?(): Promise<void>;
	answerSelect?(value: string): Promise<void>;
	answerConfirm?(confirmed: boolean): Promise<void>;
	submitAskWizard?(plan: AskFlushStep[]): Promise<void>;
	cancelPendingUi?(): Promise<void>;
	clearInferredAttention?(): void;
	/** L'esito della consegna interessa solo la coda dei task: qui basta attendere. */
	prompt?(message: string, images?: unknown[], behavior?: unknown): Promise<unknown>;
	pushLaneLanding?(landingId: string): unknown;
}

export type SessionFactory<T extends AgentSessionLike> = (config: AgentSessionConfig) => T;

export class SessionRegistry<T extends AgentSessionLike = AgentSession> {
	private sessions = new Map<string, T>();
	private factory: SessionFactory<T> | null = null;

	// La mappa resta non reattiva: `getOrCreate*` viene chiamato anche dentro
	// i template (Chat), dove scrivere stato Svelte lancerebbe
	// `state_unsafe_mutation`. Le letture si iscrivono invece a un segnale che
	// avanza in un microtask dopo ogni inserimento o rimozione: senza, chi ha
	// letto una sessione ancora assente (la tab di una corsia appena creata)
	// non si accorgeva mai del suo arrivo e restava su "In attesa".
	private notifyMembership: (() => void) | null = null;
	private membershipQueued = false;
	private readonly trackMembership = createSubscriber((update) => {
		this.notifyMembership = update;
		return () => {
			this.notifyMembership = null;
		};
	});

	private membershipChanged(): void {
		if (!this.notifyMembership || this.membershipQueued) return;
		this.membershipQueued = true;
		queueMicrotask(() => {
			this.membershipQueued = false;
			this.notifyMembership?.();
		});
	}

	constructor(factory?: SessionFactory<T>) {
		if (factory) this.factory = factory;
	}

	setFactory(factory: SessionFactory<T>): void {
		this.factory = factory;
	}

	/**
	 * Restituisce la sessione della corsia, creandola se manca. La chiave
	 * logica e il workspace devono restare stabili per tutta la sua vita.
	 */
	getOrCreateLaneSession(project: {
		id: string;
		canonicalProjectPath?: string | null;
		lane: {
			laneId: string;
			workspacePath: string | null;
			kind?: 'git' | 'lab';
			labPrototypeId?: string | null;
		};
	}): T {
		const key = laneSessionKey(project.id, project.lane.laneId);
		const cwd = project.lane.workspacePath ?? '';
		let session = this.sessions.get(key);
		if (session && session.cwd !== cwd) {
			throw new Error(`La sessione ${key} e' gia' legata al workspace ${session.cwd}`);
		}
		if (!session) {
			if (!this.factory) {
				throw new Error('Nessuna factory registrata per creare AgentSession');
			}
			const isLab = project.lane.kind === 'lab';
			session = this.factory({
				cwd,
				scope: project.lane.laneId === 'main' ? 'main' : 'lane',
				laneId: project.lane.laneId,
				projectKey: project.id,
				lab: isLab && project.lane.labPrototypeId ? {
					prototypeId: project.lane.labPrototypeId,
					projectPath: project.canonicalProjectPath ?? null
				} : undefined
			});
			this.sessions.set(key, session);
			this.membershipChanged();
		}
		return session;
	}

	/** Corsia principale: convenience semantica, non una collezione separata. */
	getOrCreateMainSession(project: {
		id: string;
		lane: { workspacePath: string | null };
	}): T {
		return this.getOrCreateLaneSession({
			id: project.id,
			lane: { laneId: 'main', workspacePath: project.lane.workspacePath }
		});
	}

	getLaneSession(projectKey: string, laneId: string): T | undefined {
		this.trackMembership();
		return this.sessions.get(laneSessionKey(projectKey, laneId));
	}

	getMainSession(projectKey: string): T | undefined {
		return this.getLaneSession(projectKey, 'main');
	}

	setLaneSession(projectKey: string, laneId: string, session: T): void {
		this.sessions.set(laneSessionKey(projectKey, laneId), session);
		this.membershipChanged();
	}

	removeLaneSession(projectKey: string, laneId: string): T | undefined {
		const key = laneSessionKey(projectKey, laneId);
		const existing = this.sessions.get(key);
		if (existing) {
			this.sessions.delete(key);
			this.membershipChanged();
		}
		return existing;
	}

	/**
	 * Cerca qualsiasi sessione attiva per il suo OMP sessionId reale.
	 */
	findSessionById(sessionId: string): T | undefined {
		const needle = sessionId.trim().toLowerCase();
		if (!needle) return undefined;
		for (const session of this.getAllSessions()) {
			if (session.sessionId?.toLowerCase() === needle) {
				return session;
			}
		}
		return undefined;
	}

	/**
	 * Cerca qualsiasi sessione per la sua chiave logica (`lane:...` o `lab:...`).
	 */
	findSessionByKey(sessionKey: string): T | undefined {
		this.trackMembership();
		return this.sessions.get(sessionKey.trim().toLowerCase());
	}

	/** Tutte le sessioni attive (corsie e laboratorio). */
	getAllSessions(): T[] {
		this.trackMembership();
		return [...this.sessions.values()];
	}

	getLaneSessions(): T[] {
		return this.getAllSessions().filter((session) => session.scope === 'lane' || session.scope === 'main');
	}

	getMainSessions(): T[] {
		return this.getAllSessions().filter(
			(session) => session.scope === 'main' || session.laneId === 'main'
		);
	}

	/**
	 * Restituisce tutte le sessioni legate a un determinato progetto:
	 * ogni corsia e gli eventuali prototipi attivi.
	 */
	getSessionsForProject(projectKey: string): T[] {
		const needle = projectKey.trim().toLowerCase();
		return this.getAllSessions().filter(
			(session) =>
				session.projectKey.toLowerCase() === needle ||
				session.sessionKey.toLowerCase().startsWith(`lane:${needle}:`)
		);
	}

	/**
	 * Chiude e rimuove tutte le sessioni di un progetto chiuso.
	 */
	async disposeProjectSessions(projectKey: string): Promise<void> {
		const sessions = this.getSessionsForProject(projectKey);
		for (const session of sessions) this.sessions.delete(session.sessionKey);
		if (sessions.length > 0) this.membershipChanged();
		await Promise.allSettled(sessions.map((session) => session.close()));
	}

	/**
	 * Chiude e rimuove una singola sessione.
	 */
	async disposeSession(session: T): Promise<void> {
		if (session.laneId) {
			this.removeLaneSession(session.projectKey, session.laneId);
		}
		await session.close();
	}

	/**
	 * Chiude tutte le sessioni del registro (es. smontaggio app).
	 */
	async clearAll(): Promise<void> {
		const all = this.getAllSessions();
		this.sessions.clear();
		this.membershipChanged();
		await Promise.allSettled(all.map((session) => session.close()));
	}

	/**
	 * Instrada una risposta UI (ask, select, confirm, wizard, cancel) alla sessione corretta.
	 *
	 * Risoluzione rigorosa del target:
	 * 1. Se `requestId` e' noto, tenta la risoluzione atomica diretta via PromptBus,
	 *    oppure cerca la sessione che espone esattamente quel `requestId`;
	 * 2. Se `sessionId` e' noto, cerca per corrispondenza esatta di sessione OMP;
	 * 3. Se `laneId` e' noto, cerca la sessione della corsia indicata;
	 * 4. Se nessun discriminatore e' fornito (payload legacy con solo `projectId`),
	 *    accetta la richiesta ESCLUSIVAMENTE se esiste una sola sessione del progetto
	 *    con pendingUi o inferredAttention (target univoco). Se sono 0 o >1, fallisce
	 *    chiuso per eliminare ambiguità e sovrapposizioni tra agenti concorrenti.
	 */
	async routeUiResponse(payload: UiResponsePayload): Promise<boolean> {
		const { projectId, laneId, sessionId, requestId, response } = payload;

		// 1. Risoluzione rapida tramite PromptBus se requestId e' noto
		if (requestId && promptBus.hasPending(requestId)) {
			const promptReq = promptBus.getRequest(requestId);
			if (promptReq) {
				if (promptReq.projectId.trim().toLowerCase() !== projectId.trim().toLowerCase()) {
					return false;
				}
				if (laneId && (promptReq.laneId ?? 'main').trim().toLowerCase() !== laneId.trim().toLowerCase()) {
					return false;
				}
				if (sessionId && promptReq.sessionId && promptReq.sessionId !== sessionId) {
					return false;
				}
				const handled = await promptBus.resolveRequest(requestId, response, {
					projectId,
					laneId,
					sessionId
				});
				if (handled) return true;
			}
		}

		let target: T | undefined;

		if (requestId) {
			target = this.getAllSessions().find(
				(s) => s.pendingUi?.requestId === requestId
			);
			if (target) {
				if (target.projectKey.trim().toLowerCase() !== projectId.trim().toLowerCase()) {
					return false;
				}
				if (laneId && (target.laneId ?? 'main').trim().toLowerCase() !== laneId.trim().toLowerCase()) {
					return false;
				}
				if (sessionId && target.sessionId && target.sessionId !== sessionId) {
					return false;
				}
			}
		}

		if (!target && sessionId) {
			target = this.findSessionById(sessionId);
			if (target) {
				if (target.projectKey.trim().toLowerCase() !== projectId.trim().toLowerCase()) {
					return false;
				}
				if (laneId && (target.laneId ?? 'main').trim().toLowerCase() !== laneId.trim().toLowerCase()) {
					return false;
				}
			}
		}



		if (!target && laneId) {
			target = this.getLaneSession(projectId, laneId);
		}

		if (!target && !sessionId && !laneId && !requestId) {
			// Payload legacy: verifica se il target e' univoco
			const candidates = this.getSessionsForProject(projectId).filter(
				(s) => s.pendingUi || s.inferredAttention
			);
			if (candidates.length === 1) {
				target = candidates[0];
			} else {
				// Target non univoco (0 o > 1 sessioni con input pendente): fail closed
				return false;
			}
		}

		if (!target) {
			return false;
		}
		// Se c'e' una richiesta formale aperta (ask/select/confirm/wizard),
		// inoltriamo ai responder standard di extension_ui_request.
		if (target.pendingUi) {
			const reqId = target.pendingUi.requestId;
			if (reqId && promptBus.hasPending(reqId)) {
				return await promptBus.resolveRequest(reqId, response, {
					projectId,
					laneId: target.laneId ?? 'main',
					sessionId: target.sessionId ?? undefined
				});
			}
			if (response.action === 'select' && typeof response.value === 'string') {
				await target.answerSelect?.(response.value);
				return true;
			}
			if (response.action === 'confirm' && typeof response.confirmed === 'boolean') {
				await target.answerConfirm?.(response.confirmed);
				return true;
			}
			if (response.action === 'wizard' && response.plan) {
				await target.submitAskWizard?.(response.plan);
				return true;
			}
			if (response.action === 'cancel') {
				await target.cancelPendingUi?.();
				return true;
			}
			return false;
		}

		// Se l'agente attendeva risposta dedotta (inferred_input),
		// inviamo il testo direttamente come nuovo messaggio prompt alla chat.
		if (target.inferredAttention) {
			target.clearInferredAttention?.();
			let text = '';
			if (response.action === 'select' && typeof response.value === 'string') {
				text = response.value;
			} else if (response.action === 'confirm' && typeof response.confirmed === 'boolean') {
				text = response.confirmed ? msg.ui_ts_sessionregistry_si_procedi_d749() : msg.ui_ts_sessionregistry_no_annulla_3400();
			}
			if (text.trim() && target.prompt) {
				await target.prompt(text.trim());
				return true;
			}
		}

		return false;
	}
}
export const sessionRegistry = new SessionRegistry<AgentSession>();
