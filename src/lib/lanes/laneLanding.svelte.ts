// Servizio reattivo per l'integrazione delle corsie in un clic (Lane Landing).
//
// Governa l'intero ciclo di atterraggio (landing) delle corsie:
// 1. Controllo prerequisiti (conferma conflitti pregressi, stato agente principale).
// 2. Chiusura ordinata o esenzione processi chiamante.
// 3. Invocazione del comando Tauri `worktree_land` (squash deterministico in Rust).
// 4. Gestione degli esiti (integrated, already_integrated, conflicts, queued, awaiting_confirm, nothing, error).
// 5. Creazione e aggiornamento delle card reattive nella chat di Studio.
// 6. Coda persistente con ripresa automatica ogni 15s o quando la sessione principale torna libera.
// 7. Annullamento integrazione via `worktree_undo_land`.
// 8. Gestione richieste bridge HTTP (`lane-bridge://request`).

import { invoke } from '@tauri-apps/api/core';
import { laneStore } from '$lib/stores/lanes.svelte';
import { projectStore, type Project } from '$lib/stores/projects.svelte';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
import type { ProjectId, LaneId } from '$lib/types/lanes';
import type { AgentSession } from '$lib/agent/session.svelte';

export type LandCaller =
	| { kind: 'gui' }
	| { kind: 'agent' | 'terminal'; ownerId: number; callerLaneId: string | null };

export interface LandOptions {
	message?: string;
	caller: LandCaller;
	confirmed?: boolean;
}
export interface ExemptOwner {
	kind: 'agent' | 'terminal';
	ownerId: number;
}


export interface WorktreeErrorPayload {
	code: string;
	message: string;
	detail?: string;
}

export type LandResult =
	| {
			kind: 'integrated';
			commit: string;
			previousTarget: string;
			targetBranch: string;
			laneHead: string;
			files: string[];
			agentText: string;
	  }
	| {
			kind: 'already_integrated';
			commit: string;
			targetBranch: string;
			agentText: string;
	  }
	| {
			kind: 'conflicts';
			files: string[];
			worktreePath: string;
			targetBranch: string;
			agentText: string;
	  }
	| {
			kind: 'queued';
			reason: 'target_overlap' | 'main_busy';
			files: string[];
			agentText: string;
	  }
	| {
			kind: 'awaiting_confirm';
			laneId: string;
			projectId: string;
			agentText: string;
	  }
	| {
			kind: 'nothing';
			targetBranch: string;
			agentText: string;
	  }
	| {
			kind: 'error';
			error: WorktreeErrorPayload;
			agentText: string;
	  };

export interface WorktreeLandOutcomeIntegrated {
	kind: 'integrated';
	commit: string;
	previousTarget: string;
	targetBranch: string;
	laneHead: string;
	files: string[];
}

export interface WorktreeLandOutcomeAlreadyIntegrated {
	kind: 'already_integrated';
	commit: string;
	targetBranch: string;
}

export interface WorktreeLandOutcomeConflicts {
	kind: 'conflicts';
	files: string[];
	worktreePath: string;
	targetBranch: string;
}

export interface WorktreeLandOutcomeQueued {
	kind: 'queued';
	reason: 'target_overlap';
	files: string[];
}

export interface WorktreeLandOutcomeNothing {
	kind: 'nothing';
	targetBranch: string;
}

export type WorktreeLandOutcome =
	| WorktreeLandOutcomeIntegrated
	| WorktreeLandOutcomeAlreadyIntegrated
	| WorktreeLandOutcomeConflicts
	| WorktreeLandOutcomeQueued
	| WorktreeLandOutcomeNothing;

export interface WorktreeUndoLandOutcome {
	targetBranch: string;
	head: string;
	restoredBranch: string;
}

export interface QueuedLaneLanding {
	projectId: string;
	laneId: LaneId;
	message: string;
	reason: 'target_overlap' | 'main_busy';
	files: string[];
	queuedAt: number;
	confirmed?: boolean;
}

export interface LaneLandingRecord {
	id: string; // landingId univoco
	projectId: string;
	laneId: LaneId;
	laneTitle: string;
	targetBranch: string;
	createdAt: number;
	kind:
		| 'integrated'
		| 'already_integrated'
		| 'conflicts'
		| 'queued'
		| 'awaiting_confirm'
		| 'nothing'
		| 'error'
		| 'undone';
	commit?: string;
	previousTarget?: string;
	files?: string[];
	error?: WorktreeErrorPayload;
	isUndoing?: boolean;
	undoError?: string;
	undoDetail?: string;
	restoredBranch?: string;
	message?: string;
	reason?: 'target_overlap' | 'main_busy';
	worktreePath?: string;
}

export interface LaneBridgeRequestPayload {
	requestId: string;
	ownerKind: 'agent' | 'terminal';
	ownerId: number;
	projectId: string | null;
	callerLaneId: string | null;
	cwd: string;
	laneId: string | null;
	message: string;
}

const QUEUE_STORAGE_KEY = 'omp-studio.laneLandingQueue';

function parseWorktreeError(error: unknown): WorktreeErrorPayload {
	if (typeof error === 'object' && error !== null) {
		const rec = error as Record<string, unknown>;
		if (typeof rec.code === 'string' && typeof rec.message === 'string') {
			return {
				code: rec.code,
				message: rec.message,
				detail: typeof rec.detail === 'string' ? rec.detail : undefined
			};
		}
		if (typeof rec.message === 'string') {
			return {
				code: 'error',
				message: rec.message,
				detail: typeof rec.detail === 'string' ? rec.detail : undefined
			};
		}
	}
	const str = error instanceof Error ? error.message : String(error);
	return { code: 'error', message: str };
}

export class LaneLandingService {
	// Mappa reattiva delle operazioni di landing eseguite, visualizzate nelle card chat.
	records = $state<Record<string, LaneLandingRecord>>({});

	// Coda reattiva delle integrazioni in attesa (target_overlap o main_busy).
	queue = $state<QueuedLaneLanding[]>([]);

	// Insieme di corsie che hanno avuto conflitti e necessitano conferma utente.
	private needsConfirmKeys = $state<string[]>([]);

	private timer: number | null = null;
	private isResuming = false;
	private initialized = false;

	init(): void {
		if (this.initialized) return;
		this.initialized = true;
		this.loadQueue();
		this.timer = setInterval(() => {
			void this.processQueue();
		}, 15_000) as unknown as number;
	}

	dispose(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.initialized = false;
	}

	private isLaneNeedingConfirm(projectId: string, laneId: string): boolean {
		const key = `${projectId}:${laneId}`;
		return this.needsConfirmKeys.includes(key);
	}

	private markLaneNeedsConfirm(projectId: string, laneId: string): void {
		const key = `${projectId}:${laneId}`;
		if (!this.needsConfirmKeys.includes(key)) {
			this.needsConfirmKeys = [...this.needsConfirmKeys, key];
		}
	}

	private clearLaneNeedsConfirm(projectId: string, laneId: string): void {
		const key = `${projectId}:${laneId}`;
		this.needsConfirmKeys = this.needsConfirmKeys.filter((k) => k !== key);
	}

	private loadQueue(): void {
		try {
			if (typeof localStorage === 'undefined') return;
			const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					this.queue = parsed;
				}
			}
		} catch (err) {
			console.warn('[laneLanding] Errore caricamento coda da localStorage:', err);
		}
	}

	private saveQueue(): void {
		try {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
		} catch (err) {
			console.warn('[laneLanding] Errore salvataggio coda in localStorage:', err);
		}
	}

	private enqueue(
		item: QueuedLaneLanding,
		project: Project,
		laneTitle: string,
		targetBranch: string
	): LandResult {
		const alreadyQueued = this.queue.some(
			(q) => q.projectId === item.projectId && q.laneId === item.laneId
		);
		this.queue = [
			...this.queue.filter((q) => !(q.projectId === item.projectId && q.laneId === item.laneId)),
			item
		];
		this.saveQueue();

		const agentText =
			item.reason === 'main_busy'
				? "Integrazione messa in coda: l'agente principale e' attualmente occupato. Verra' ripresa automaticamente."
				: `Integrazione messa in coda: rilevate modifiche locali nel branch target sui file: ${item.files.join(', ')}. Verra' ripresa automaticamente.`;

		// La ripresa ritenta ogni 15 s: la card si crea solo al primo accodamento.
		if (!alreadyQueued) {
			this.createCard({
				projectId: item.projectId,
				laneId: item.laneId,
				laneTitle,
				targetBranch,
				kind: 'queued',
				files: item.files,
				reason: item.reason,
				message: item.message
			});
		}

		return {
			kind: 'queued',
			reason: item.reason,
			files: item.files,
			agentText
		};
	}

	removeFromQueue(projectId: string, laneId: string): void {
		const prevLen = this.queue.length;
		this.queue = this.queue.filter(
			(item) => !(item.projectId === projectId && item.laneId === laneId)
		);
		if (this.queue.length !== prevLen) {
			this.saveQueue();
		}
	}

	/**
	 * Riprende l'elaborazione della coda se ci sono elementi in attesa.
	 */
	async processQueue(): Promise<void> {
		if (this.isResuming || this.queue.length === 0) return;
		this.isResuming = true;
		try {
			const items = [...this.queue];
			for (const item of items) {
				const project = projectStore.projects.find((p) => p.id === item.projectId);
				if (!project) continue;

				// Agente principale o della corsia al lavoro: si ritenta al giro dopo.
				if (this.isMainAgentBusy(project)) continue;
				if (sessionRegistry.getLaneSession(project.id, item.laneId)?.isStreaming) continue;

				const result = await this.land(project, item.laneId, {
					message: item.message,
					caller: { kind: 'gui' },
					confirmed: item.confirmed ?? true
				});

				// Rimuovi dalla coda su qualunque esito diverso da queued
				if (result.kind !== 'queued') {
					this.removeFromQueue(item.projectId, item.laneId);
				}
			}
		} finally {
			this.isResuming = false;
		}
	}

	/**
	 * Verifica se la sessione principale del progetto e' in streaming o lavora.
	 */
	isMainAgentBusy(project: Project): boolean {
		const mainSession = sessionRegistry.getMainSession(project.id);
		if (mainSession?.isStreaming) return true;
		const terminalWorking = laneOrchestrator.laneAgentState(project, 'main') === 'working';
		return terminalWorking;
	}

	/**
	 * Cerca la sessione target (GUI) a cui recapitare la card di chat.
	 * Destinazione: sessione GUI principale del progetto se esiste, altrimenti
	 * la sessione GUI attiva del progetto; se nessuna, null.
	 */
	private findTargetSession(projectId: string): AgentSession | null {
		const mainSession = sessionRegistry.getMainSession(projectId);
		if (mainSession) return mainSession as AgentSession;

		const project = projectStore.projects.find((p) => p.id === projectId);
		if (project?.lane.laneId) {
			const laneSession = sessionRegistry.getLaneSession(projectId, project.lane.laneId);
			if (laneSession) return laneSession as AgentSession;
		}

		const all = sessionRegistry.getAllSessions();
		const fallback = all.find((s) => s.projectKey === projectId);
		return (fallback as AgentSession) ?? null;
	}

	/**
	 * Crea un record reattivo e aggiunge la card al transcript della chat target.
	 */
	private createCard(params: {
		projectId: string;
		laneId: LaneId;
		laneTitle: string;
		targetBranch: string;
		kind: LaneLandingRecord['kind'];
		commit?: string;
		previousTarget?: string;
		files?: string[];
		error?: WorktreeErrorPayload;
		reason?: 'target_overlap' | 'main_busy';
		message?: string;
		worktreePath?: string;
	}): string {
		const landingId = crypto.randomUUID();
		const record: LaneLandingRecord = {
			id: landingId,
			projectId: params.projectId,
			laneId: params.laneId,
			laneTitle: params.laneTitle,
			targetBranch: params.targetBranch,
			createdAt: Date.now(),
			kind: params.kind,
			commit: params.commit,
			previousTarget: params.previousTarget,
			files: params.files,
			error: params.error,
			reason: params.reason,
			message: params.message,
			worktreePath: params.worktreePath
		};

		this.records[landingId] = record;

		const session = this.findTargetSession(params.projectId);
		if (session && typeof session.pushLaneLanding === 'function') {
			session.pushLaneLanding(landingId);
		}

		return landingId;
	}

	/**
	 * Pipeline di atterraggio (land) in un clic.
	 */
	async land(project: Project, laneId: LaneId, opts: LandOptions): Promise<LandResult> {
		const lane = laneStore
			.lanesFor(project.id as ProjectId)
			.find((candidate) => candidate.laneId === laneId);

		if (!lane || !lane.workspacePath || lane.kind === 'lab') {
			const errPayload: WorktreeErrorPayload = {
				code: 'lane_not_supported',
				message:
					lane?.kind === 'lab'
						? 'Le corsie Lab non supportano il landing Git.'
						: 'Corsia non trovata o priva di percorso worktree.'
			};
			return {
				kind: 'error',
				error: errPayload,
				agentText: errPayload.message
			};
		}

		const targetBranch = lane.targetBranch ?? 'main';
		const commitMessage = (opts.message?.trim() || lane.title).trim() || `Merge lane ${laneId}`;

		// 1. Controllo conferma conflitti pregressi
		const needsConfirm = this.isLaneNeedingConfirm(project.id, laneId);
		if (needsConfirm && !opts.confirmed && opts.caller.kind !== 'gui') {
			this.createCard({
				projectId: project.id,
				laneId,
				laneTitle: lane.title,
				targetBranch,
				kind: 'awaiting_confirm',
				message: commitMessage
			});

			return {
				kind: 'awaiting_confirm',
				laneId,
				projectId: project.id,
				agentText: 'In attesa di conferma utente, non ritentare.'
			};
		}

		// 2. Controllo agente principale occupato
		const isCallerMain =
			opts.caller.kind !== 'gui' && opts.caller.callerLaneId === 'main';
		if (!isCallerMain && this.isMainAgentBusy(project)) {
			return this.enqueue(
				{
					projectId: project.id,
					laneId,
					message: commitMessage,
					reason: 'main_busy',
					files: [],
					queuedAt: Date.now(),
					confirmed: opts.confirmed
				},
				project,
				lane.title,
				targetBranch
			);
		}

		// 3. Gestione sessione corsia
		let exemptOwners: ExemptOwner[] | undefined;
		if (opts.caller.kind === 'gui') {
			const laneSession = sessionRegistry.getLaneSession(project.id, laneId);
			if (laneSession) {
				if (laneSession.isStreaming) {
					const errPayload: WorktreeErrorPayload = {
						code: 'agent_busy',
						message: "L'agente della corsia sta lavorando."
					};
					return {
						kind: 'error',
						error: errPayload,
						agentText: errPayload.message
					};
				}
				await sessionRegistry.disposeSession(laneSession);
			}
		} else {
			exemptOwners = [{ kind: opts.caller.kind, ownerId: opts.caller.ownerId }];
		}
		// 4. Invocazione del comando Tauri `worktree_land`
		const previousStatus = lane.status;
		if (previousStatus !== 'integrating') {
			await laneStore
				.updateLane(project.id as ProjectId, laneId, { status: 'integrating' })
				.catch(() => undefined);
		}

		let outcome: WorktreeLandOutcome;
		try {
			outcome = await invoke<WorktreeLandOutcome>('worktree_land', {
				args: {
					projectPath: project.canonicalProjectPath,
					worktreePath: lane.workspacePath,
					laneId,
					targetBranch: lane.targetBranch ?? null,
					message: commitMessage,
					exemptOwners
				}
			});
		} catch (error) {
			const parsed = parseWorktreeError(error);
			if (previousStatus !== 'integrating') {
				const revertStatus = previousStatus === 'conflict' ? 'conflict' : 'review_ready';
				await laneStore
					.updateLane(project.id as ProjectId, laneId, { status: revertStatus })
					.catch(() => undefined);
			}

			this.createCard({
				projectId: project.id,
				laneId,
				laneTitle: lane.title,
				targetBranch,
				kind: 'error',
				error: parsed
			});

			const detailStr = parsed.detail ? ` Dettaglio: ${parsed.detail}` : '';
			return {
				kind: 'error',
				error: parsed,
				agentText: `Errore durante l'integrazione: ${parsed.message}.${detailStr}`
			};
		}

		// 5. Gestione degli esiti
		if (outcome.kind === 'integrated') {
			this.clearLaneNeedsConfirm(project.id, laneId);
			this.removeFromQueue(project.id, laneId);

			const isCallerOwnLane =
				opts.caller.kind !== 'gui' && opts.caller.callerLaneId === laneId;
			this.schedulePostLandCleanup(project, laneId, isCallerOwnLane);

			this.createCard({
				projectId: project.id,
				laneId,
				laneTitle: lane.title,
				targetBranch: outcome.targetBranch,
				kind: 'integrated',
				commit: outcome.commit,
				previousTarget: outcome.previousTarget,
				files: outcome.files
			});

			const shortCommit = outcome.commit.slice(0, 7);
			const agentText = `Corsia integrata con successo nel branch ${outcome.targetBranch} (commit ${shortCommit}). File integrati: ${outcome.files.length}.`;

			return {
				kind: 'integrated',
				commit: outcome.commit,
				previousTarget: outcome.previousTarget,
				targetBranch: outcome.targetBranch,
				laneHead: outcome.laneHead,
				files: outcome.files,
				agentText
			};
		}

		if (outcome.kind === 'already_integrated') {
			this.clearLaneNeedsConfirm(project.id, laneId);
			this.removeFromQueue(project.id, laneId);

			const isCallerOwnLane =
				opts.caller.kind !== 'gui' && opts.caller.callerLaneId === laneId;
			this.schedulePostLandCleanup(project, laneId, isCallerOwnLane);

			this.createCard({
				projectId: project.id,
				laneId,
				laneTitle: lane.title,
				targetBranch: outcome.targetBranch,
				kind: 'already_integrated',
				commit: outcome.commit
			});

			const shortCommit = outcome.commit.slice(0, 7);
			const agentText = `La corsia e' gia' integrata nel branch ${outcome.targetBranch} (commit ${shortCommit}).`;

			return {
				kind: 'already_integrated',
				commit: outcome.commit,
				targetBranch: outcome.targetBranch,
				agentText
			};
		}

		if (outcome.kind === 'conflicts') {
			await laneStore
				.updateLane(project.id as ProjectId, laneId, { status: 'conflict' })
				.catch(() => undefined);
			this.markLaneNeedsConfirm(project.id, laneId);
			this.removeFromQueue(project.id, laneId);

			this.createCard({
				projectId: project.id,
				laneId,
				laneTitle: lane.title,
				targetBranch: outcome.targetBranch,
				kind: 'conflicts',
				files: outcome.files,
				worktreePath: outcome.worktreePath
			});

			const fileList = outcome.files.map((f) => `- ${f}`).join('\n');
			const agentText = `Rilevati conflitti durante il merge con il branch target ${outcome.targetBranch}.\nFile in conflitto:\n${fileList}\nWorktree: ${outcome.worktreePath}\nIstruzioni: risolvi i conflitti in quei file, esegui \`git add\` sui file risolti, NON fare commit, poi richiama studio_lane_integrate.`;

			return {
				kind: 'conflicts',
				files: outcome.files,
				worktreePath: outcome.worktreePath,
				targetBranch: outcome.targetBranch,
				agentText
			};
		}

		if (outcome.kind === 'queued') {
			if (previousStatus !== 'integrating') {
				await laneStore
					.updateLane(project.id as ProjectId, laneId, { status: previousStatus })
					.catch(() => undefined);
			}

			return this.enqueue(
				{
					projectId: project.id,
					laneId,
					message: commitMessage,
					reason: 'target_overlap',
					files: outcome.files,
					queuedAt: Date.now(),
					confirmed: opts.confirmed
				},
				project,
				lane.title,
				targetBranch
			);
		}

		// outcome.kind === 'nothing'
		if (previousStatus !== 'integrating') {
			await laneStore
				.updateLane(project.id as ProjectId, laneId, { status: 'review_ready' })
				.catch(() => undefined);
		}
		this.removeFromQueue(project.id, laneId);

		this.createCard({
			projectId: project.id,
			laneId,
			laneTitle: lane.title,
			targetBranch: outcome.targetBranch,
			kind: 'nothing'
		});

		const agentText = `Nessuna modifica da integrare nel branch ${outcome.targetBranch}.`;
		return {
			kind: 'nothing',
			targetBranch: outcome.targetBranch,
			agentText
		};
	}

	/**
	 * Pulizia completa asincrona post-integrazione:
	 * se il chiamante e' l'agente della corsia stessa, attende il termine
	 * dello streaming prima di chiudere la sessione, archiviare e cancellare il branch.
	 */
	private schedulePostLandCleanup(
		project: Project,
		laneId: LaneId,
		isCallerOwnLane: boolean
	): void {
		const doCleanup = async () => {
			try {
				const session = sessionRegistry.getLaneSession(project.id, laneId);
				if (session) {
					await sessionRegistry.disposeSession(session);
				}
				await laneStore.archiveLane(project.id as ProjectId, laneId, 'integrated', {
					stopProcesses: true
				});
				await invoke('worktree_delete_lane_branch', {
					args: {
						projectPath: project.canonicalProjectPath,
						laneId,
						confirm: true
					}
				}).catch(() => undefined);
			} catch (err) {
				console.warn('[laneLanding] Errore pulizia post-integrazione:', err);
			}
		};

		if (!isCallerOwnLane) {
			void doCleanup();
			return;
		}

		// Attesa leggera fine streaming per la sessione della corsia chiamante
		const startMs = Date.now();
		const check = () => {
			const session = sessionRegistry.getLaneSession(project.id, laneId);
			const streaming = session?.isStreaming === true;
			if (!streaming || Date.now() - startMs > 45_000) {
				void doCleanup();
			} else {
				setTimeout(check, 250);
			}
		};
		setTimeout(check, 250);
	}

	/**
	 * Annulla l'integrazione ripristinando il commit precedente del branch target.
	 */
	async undo(landingId: string): Promise<boolean> {
		const record = this.records[landingId];
		if (
			!record ||
			record.kind !== 'integrated' ||
			!record.commit ||
			!record.previousTarget
		) {
			return false;
		}

		const project = projectStore.projects.find((p) => p.id === record.projectId);
		if (!project?.canonicalProjectPath) {
			record.undoError = 'Percorso del progetto non disponibile.';
			return false;
		}

		record.isUndoing = true;
		record.undoError = undefined;
		record.undoDetail = undefined;

		try {
			const outcome = await invoke<WorktreeUndoLandOutcome>('worktree_undo_land', {
				args: {
					projectPath: project.canonicalProjectPath,
					laneId: record.laneId,
					targetBranch: record.targetBranch,
					commit: record.commit,
					previousTarget: record.previousTarget
				}
			});

			record.kind = 'undone';
			record.restoredBranch = outcome.restoredBranch;
			return true;
		} catch (error) {
			const parsed = parseWorktreeError(error);
			record.undoError = parsed.message;
			record.undoDetail = parsed.detail;
			return false;
		} finally {
			record.isUndoing = false;
		}
	}

	/**
	 * Conferma dell'integrazione richiamata dal pulsante della card 'awaiting_confirm'.
	 */
	async confirmLanding(landingId: string): Promise<LandResult | null> {
		const record = this.records[landingId];
		if (!record) return null;

		const project = projectStore.projects.find((p) => p.id === record.projectId);
		if (!project) return null;

		return this.land(project, record.laneId, {
			message: record.message,
			caller: { kind: 'gui' },
			confirmed: true
		});
	}

	/**
	 * Invia un prompt alla corsia per richiedere la risoluzione dei conflitti Git.
	 */
	async askLaneToResolveConflicts(
		projectId: string,
		laneId: LaneId,
		promptText?: string
	): Promise<void> {
		const project = projectStore.projects.find((p) => p.id === projectId);
		if (!project) return;

		await laneOrchestrator.switchLane(project.id as ProjectId, laneId);
		let refreshed = projectStore.projects.find((p) => p.id === project.id);
		if (!refreshed || refreshed.lane.laneId !== laneId) return;

		if (refreshed.lane.surface !== 'gui') {
			await laneOrchestrator.switchSurface(project.id, 'gui');
			refreshed = projectStore.projects.find((p) => p.id === project.id);
		}
		if (
			!refreshed ||
			refreshed.lane.laneId !== laneId ||
			refreshed.lane.surface !== 'gui'
		) {
			return;
		}

		const session = laneOrchestrator.getOrCreateAgentSession(refreshed, refreshed.lane);
		await session.ensureOpen(session.sessionId);

		const targetBranch = refreshed.lane.targetBranch ?? 'main';
		const text =
			promptText ??
			`Nella corsia ci sono conflitti Git non risolti rispetto a ${targetBranch}. Aiutami a risolverli solo in questa corsia: modifica i file in conflitto, esegui \`git add\` sui file risolti, NON fare commit, poi richiama studio_lane_integrate.`;

		await session.prompt(text);
	}

	/**
	 * Gestisce la richiesta proveniente dal bridge HTTP loopback (evento `lane-bridge://request`).
	 * Invia SEMPRE una risposta tramite `lane_bridge_respond`.
	 */
	async handleBridgeRequest(payload: LaneBridgeRequestPayload): Promise<void> {
		try {
			// Il token del bridge viene emesso solo con un projectId: senza,
			// indovinare il progetto rischierebbe di integrare la corsia sbagliata.
			const project = payload.projectId
				? projectStore.projects.find((p) => p.id === payload.projectId)
				: undefined;

			if (!project) {
				await invoke('lane_bridge_respond', {
					requestId: payload.requestId,
					response: {
						ok: false,
						text: 'Progetto non trovato.'
					}
				});
				return;
			}

			// Una sessione senza laneId e' la Principale (stessa convenzione di sessionKey).
			const callerLaneId = payload.callerLaneId ?? 'main';
			let targetLaneId = (payload.laneId as LaneId | null) ?? null;
			if (!targetLaneId) {
				if (callerLaneId !== 'main') {
					targetLaneId = callerLaneId as LaneId;
				} else {
					// Chiamante principale senza laneId
					const openLanes = laneStore
						.lanesFor(project.id as ProjectId)
						.filter((l) => l.laneId !== 'main' && l.status !== 'archived');

					if (openLanes.length === 1) {
						targetLaneId = openLanes[0].laneId;
					} else if (openLanes.length === 0) {
						await invoke('lane_bridge_respond', {
							requestId: payload.requestId,
							response: {
								ok: false,
								text: 'Nessuna corsia aperta da integrare nel progetto.'
							}
						});
						return;
					} else {
						const list = openLanes.map((l) => `- ${l.laneId}: ${l.title}`).join('\n');
						await invoke('lane_bridge_respond', {
							requestId: payload.requestId,
							response: {
								ok: false,
								text: `Specificare la corsia da integrare. Corsie aperte disponibili:\n${list}`,
								details: {
									lanes: openLanes.map((l) => ({ id: l.laneId, title: l.title }))
								}
							}
						});
						return;
					}
				}
			}

			const caller: LandCaller = {
				kind: payload.ownerKind,
				ownerId: payload.ownerId,
				callerLaneId
			};

			const result = await this.land(project, targetLaneId, {
				message: payload.message,
				caller
			});

			// Coda, conferma e conflitti non sono errori del tool: il testo dice
			// all'agente cosa fare (o di non ritentare).
			const ok = result.kind !== 'error';

			await invoke('lane_bridge_respond', {
				requestId: payload.requestId,
				response: {
					ok,
					text: result.agentText,
					details: result
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await invoke('lane_bridge_respond', {
				requestId: payload.requestId,
				response: {
					ok: false,
					text: `Errore imprevisto durante l'integrazione: ${message}`
				}
			}).catch(() => undefined);
		}
	}
}

export const laneLanding = new LaneLandingService();
