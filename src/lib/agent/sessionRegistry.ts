// Registro unificato delle sessioni agente di OMP Studio.
//
// Governa il ciclo di vita concorrente delle sessioni:
// 1. Sessioni principali di progetto (`scope: 'main'`), legate al normale flusso
//    di sviluppo e all'handoff TUI/GUI;
// 2. Sessioni del Laboratorio prototipi (`scope: 'lab'`), dedicate a un prototipo
//    specifico dentro `proto/<id>` o in archivio bozze.
//
// Requisito vincolante (ricerca/laboratorio-prototipi-piano.md §§ 2, 5.3):
// Agente principale e Laboratorio devono poter lavorare simultaneamente nello
// stesso progetto senza mescolare chat, input, tool event, usage e abort, e senza
// che chiudere o interrompere una sessione termini l'altra.

import type { AgentSession, AgentSessionConfig } from './session.svelte';
import type { AskFlushStep } from './askAnswers';
import { m as msg } from '$lib/paraglide/messages.js';

export function mainSessionKey(projectKey: string): string {
	return `main:${projectKey.trim().toLowerCase()}`;
}

export function labSessionKey(projectKey: string, prototypeId: string): string {
	return `lab:${projectKey.trim().toLowerCase()}:${prototypeId.trim().toLowerCase()}`;
}

export interface UiResponsePayload {
	projectId: string;
	sessionId?: string;
	prototypeId?: string;
	response: {
		action: 'select' | 'confirm' | 'wizard' | 'cancel';
		value?: string;
		confirmed?: boolean;
		plan?: AskFlushStep[];
	};
}

export interface AgentSessionLike {
	readonly cwd: string;
	readonly scope: 'main' | 'lab';
	readonly prototypeId: string | null;
	readonly projectKey: string;
	readonly sessionKey: string;
	sessionId: string | null;
	observedRevisionId?: string | null;
	pendingUi?: { kind: string; message?: string } | null;
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
	prompt?(message: string, images?: unknown[], behavior?: unknown): Promise<void>;
}

export type SessionFactory<T extends AgentSessionLike> = (config: AgentSessionConfig) => T;

export class SessionRegistry<T extends AgentSessionLike = AgentSession> {
	private mainSessions = new Map<string, T>();
	private labSessions = new Map<string, T>();
	private factory: SessionFactory<T> | null = null;

	constructor(factory?: SessionFactory<T>) {
		if (factory) this.factory = factory;
	}

	setFactory(factory: SessionFactory<T>): void {
		this.factory = factory;
	}

	/**
	 * Restituisce la sessione principale del progetto, creandola se manca.
	 */
	getOrCreateMainSession(project: { id: string; path: string }): T {
		const key = mainSessionKey(project.id);
		let session = this.mainSessions.get(key);
		if (!session) {
			if (!this.factory) {
				throw new Error('Nessuna factory registrata per creare AgentSession');
			}
			session = this.factory({
				cwd: project.path,
				scope: 'main',
				projectKey: project.id
			});
			this.mainSessions.set(key, session);
		}
		return session;
	}

	getMainSession(projectKey: string): T | undefined {
		return this.mainSessions.get(mainSessionKey(projectKey));
	}

	setMainSession(projectKey: string, session: T): void {
		this.mainSessions.set(mainSessionKey(projectKey), session);
	}

	removeMainSession(projectKey: string): T | undefined {
		const key = mainSessionKey(projectKey);
		const existing = this.mainSessions.get(key);
		if (existing) {
			this.mainSessions.delete(key);
		}
		return existing;
	}

	/**
	 * Restituisce la sessione Laboratorio per un prototipo, creandola se manca.
	 */
	getOrCreateLabSession(
		project: { id?: string; path: string },
		prototypeId: string,
		options?: { observedRevisionId?: string | null }
	): T {
		const effectiveKey = project.id ?? project.path;
		const key = labSessionKey(effectiveKey, prototypeId);
		let session = this.labSessions.get(key);
		if (!session) {
			if (!this.factory) {
				throw new Error('Nessuna factory registrata per creare AgentSession');
			}
			session = this.factory({
				cwd: project.path,
				scope: 'lab',
				prototypeId,
				projectKey: effectiveKey,
				observedRevisionId: options?.observedRevisionId ?? null
			});
			this.labSessions.set(key, session);
		} else if (options?.observedRevisionId !== undefined) {
			session.observedRevisionId = options.observedRevisionId;
		}
		return session;
	}

	getLabSession(projectKey: string, prototypeId: string): T | undefined {
		return this.labSessions.get(labSessionKey(projectKey, prototypeId));
	}

	setLabSession(projectKey: string, prototypeId: string, session: T): void {
		this.labSessions.set(labSessionKey(projectKey, prototypeId), session);
	}

	removeLabSession(projectKey: string, prototypeId: string): T | undefined {
		const key = labSessionKey(projectKey, prototypeId);
		const existing = this.labSessions.get(key);
		if (existing) {
			this.labSessions.delete(key);
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
	 * Cerca qualsiasi sessione per la sua chiave logica (`main:...` o `lab:...`).
	 */
	findSessionByKey(sessionKey: string): T | undefined {
		const needle = sessionKey.trim().toLowerCase();
		if (needle.startsWith('main:')) {
			return this.mainSessions.get(needle);
		}
		if (needle.startsWith('lab:')) {
			return this.labSessions.get(needle);
		}
		return undefined;
	}

	/** Tutte le sessioni attive (principali e laboratorio). */
	getAllSessions(): T[] {
		return [...this.mainSessions.values(), ...this.labSessions.values()];
	}

	getMainSessions(): T[] {
		return [...this.mainSessions.values()];
	}

	getLabSessions(): T[] {
		return [...this.labSessions.values()];
	}

	/**
	 * Restituisce tutte le sessioni legate a un determinato progetto
	 * (la principale piu' eventuali prototipi attivi).
	 */
	getSessionsForProject(projectKey: string): T[] {
		const needle = projectKey.trim().toLowerCase();
		const result: T[] = [];
		const main = this.mainSessions.get(mainSessionKey(projectKey));
		if (main) result.push(main);
		for (const session of this.labSessions.values()) {
			if (
				session.projectKey.toLowerCase() === needle ||
				session.cwd.toLowerCase() === needle
			) {
				result.push(session);
			}
		}
		return result;
	}

	/**
	 * Chiude e rimuove tutte le sessioni di un progetto chiuso.
	 */
	async disposeProjectSessions(projectKey: string): Promise<void> {
		const sessions = this.getSessionsForProject(projectKey);
		const mainKey = mainSessionKey(projectKey);
		this.mainSessions.delete(mainKey);
		for (const [key, session] of this.labSessions.entries()) {
			if (sessions.includes(session)) {
				this.labSessions.delete(key);
			}
		}
		await Promise.allSettled(sessions.map((s) => s.close()));
	}

	/**
	 * Chiude e rimuove una singola sessione.
	 */
	async disposeSession(session: T): Promise<void> {
		if (session.scope === 'lab' && session.prototypeId) {
			this.removeLabSession(session.projectKey, session.prototypeId);
		} else {
			this.removeMainSession(session.projectKey);
		}
		await session.close();
	}

	/**
	 * Chiude tutte le sessioni del registro (es. smontaggio app).
	 */
	async clearAll(): Promise<void> {
		const all = this.getAllSessions();
		this.mainSessions.clear();
		this.labSessions.clear();
		await Promise.allSettled(all.map((s) => s.close()));
	}

	/**
	 * Instrada una risposta UI (ask, select, confirm, wizard, cancel) alla sessione corretta.
	 *
	 * Ordine di correlazione deterministico:
	 * 1. Se `sessionId` e' noto, cerca per corrispondenza esatta di sessione OMP;
	 * 2. Se `prototypeId` e' noto, cerca la sessione Laboratorio specifica;
	 * 3. Altrimenti cerca la sessione principale del progetto con `pendingUi`;
	 * 4. Altrimenti cerca una sessione Laboratorio dello stesso progetto con `pendingUi`.
	 */
	async routeUiResponse(payload: UiResponsePayload): Promise<boolean> {
		const { projectId, sessionId, prototypeId, response } = payload;
		let target: T | undefined;

		if (sessionId) {
			target = this.findSessionById(sessionId);
		}
		if (!target && prototypeId) {
			target = this.getLabSession(projectId, prototypeId);
		}
		if (!target) {
			const main = this.getMainSession(projectId);
			if (main?.pendingUi || main?.inferredAttention) {
				target = main;
			} else {
				const projectSessions = this.getSessionsForProject(projectId);
				target = projectSessions.find((s) => s.pendingUi || s.inferredAttention);
			}
		}

		if (!target) {
			return false;
		}

		// Se c'e' una richiesta formale aperta (ask/select/confirm/wizard),
		// inoltriamo ai responder standard di extension_ui_request.
		if (target.pendingUi) {
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
