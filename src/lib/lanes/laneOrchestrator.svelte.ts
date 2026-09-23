// Orchestratore centralizzato per lo switch atomico di workspace e gestione corsie.
//
// Invarianti del Gate R27 / PLAN W08:
// 1. Al cambio corsia, si riorientano sincronizzati: radice FileTree, stato GitPanel,
//    modelli/tab Monaco, viewport agente (Terminale o Chat) e superfici contestuali (Diagrammi/Preview).
// 2. Geometria tre colonne invariata (larghezza pannello sinistro, colonna centrale, stato editor).
// 3. I terminali e le sessioni xterm delle corsie in background restano montati e vivi in memoria:
//    nessun restart, nessun crossfade, nessun processo chiuso dallo switch.
// 4. File aperti, file attivo, cursore/scroll e dirty buffer sono confinati per corsia.

import { projectStore, type Project } from '$lib/stores/projects.svelte';
import { laneStore, type LaneArchiveOutcome, type LaneRecord } from '$lib/stores/lanes.svelte';
import { laneRecordFromAgentLane, type LaneArchiveReason } from '$lib/stores/lanePersistence';
import { sessionRegistry, laneSessionKey } from '$lib/agent/sessionRegistry';
import type { AgentSession } from '$lib/agent/session.svelte';
import { taskStore } from '$lib/stores/tasks.svelte';
import type { LaneDispatchSnapshot } from './queueDispatch';
import { applyProfileToLane } from './laneProfile';
import {
	MAIN_LANE_ID,
	type LaneId,
	type LaneOrigin,
	type ProjectId,
	type AgentLane,
	type AgentState,
	type AgentSurface,
	createMainLane
} from '$lib/types/lanes';
import type { TerminalSession } from '$lib/terminal/terminal';

export interface TerminalMetaEntry {
	inputPending: boolean;
	sessionId: string | null;
}

export class LaneOrchestrator {
	terminalMeta = $state<Record<string, TerminalMetaEntry>>({});
	terminalBusy = $state<Record<string, boolean>>({});
	switchingSurface = $state<Record<string, boolean>>({});
	agentErrors = $state<Record<string, string | null>>({});

	// Riferimenti alle sessioni terminale vive per ciascuna corsia (laneSessionKey)
	terminalSessions = new Map<string, TerminalSession>();

	get activeSwitching(): boolean {
		const proj = projectStore.activeProject;
		if (!proj) return false;
		return this.switchingSurface[this.runtimeKey(proj.id, proj.lane.laneId)] === true;
	}

	runtimeKey(projectId: string, laneId: string): string {
		return laneSessionKey(projectId, laneId);
	}

	getTerminalSession(key: string): TerminalSession | undefined {
		return this.terminalSessions.get(key);
	}

	setTerminalSession(key: string, session: TerminalSession | null): void {
		if (session) {
			this.terminalSessions.set(key, session);
		} else {
			this.terminalSessions.delete(key);
		}
	}

	getLaneSession(projectId: string, laneId: string): AgentSession | undefined {
		return sessionRegistry.getLaneSession(projectId, laneId);
	}

	getOrCreateAgentSession(project: Project, lane: AgentLane | LaneRecord): AgentSession {
		return sessionRegistry.getOrCreateLaneSession({
			id: project.id,
			lane: {
				laneId: lane.laneId,
				workspacePath: lane.workspacePath ?? project.canonicalProjectPath
			}
		});
	}

	updateTerminalMeta(
		key: string,
		patch: Partial<TerminalMetaEntry>
	): void {
		const current = this.terminalMeta[key];
		const inputPending = patch.inputPending ?? current?.inputPending ?? false;
		const sessionId = patch.sessionId !== undefined ? patch.sessionId : (current?.sessionId ?? null);
		if (current && current.inputPending === inputPending && current.sessionId === sessionId) return;
		this.terminalMeta[key] = { inputPending, sessionId };
	}

	handleTerminalState(project: Project, laneId: string, state: AgentState): void {
		if (project.lane.laneId === laneId) {
			projectStore.setAgentState(project.id, state);
		}
		void laneStore.updateLane(project.id as ProjectId, laneId as LaneId, { agentState: state }).catch(() => undefined);
		if (project.canonicalProjectPath && (state === 'working' || state === 'attention')) {
			taskStore.confirmTaskDelivered(project.canonicalProjectPath);
		}
	}

	/**
	 * Restituisce le corsie da mantenere montate nel DOM per questo progetto.
	 * Le corsie archiviate vengono escluse, mentre la corsia attiva e' sempre garantita.
	 */
	getMountedLanes(project: Project): Array<AgentLane | LaneRecord> {
		const records = laneStore.lanesFor(project.id as ProjectId);
		const activeRecords = records.filter((l) => l.status !== 'archived');
		if (activeRecords.length === 0) {
			return [project.lane];
		}
		const hasCurrent = activeRecords.some((l) => l.laneId === project.lane.laneId);
		if (!hasCurrent) {
			return [project.lane, ...activeRecords];
		}
		return activeRecords;
	}

	/**
	 * Salva lo stato istantaneo della corsia attiva del progetto verso laneStore.
	 * `agentState` resta fuori: su `project.lane` convive con lo stato aggregato
	 * del progetto (tutte le corsie), e salvarlo qui lo attribuirebbe alla
	 * corsia uscente. Lo stato proprio di ogni corsia lo scrive gia'
	 * `handleTerminalState`, per corsia.
	 */
	async saveLaneSnapshot(project: Project): Promise<void> {
		const existing = laneStore.lanes.find(
			(l) => l.projectId === project.id && l.laneId === project.lane.laneId
		);
		if (existing) {
			await laneStore.updateLane(project.id as ProjectId, project.lane.laneId, {
				openFiles: [...project.lane.openFiles],
				activeFile: project.lane.activeFile,
				surface: project.lane.surface
			});
		} else {
			const session = sessionRegistry.getLaneSession(project.id, project.lane.laneId);
			const record = laneRecordFromAgentLane({
				...project.lane,
				agentState: session?.agentState ?? 'idle'
			});
			await laneStore.upsertLane(record);
		}
	}

	/**
	 * Esegue lo switch atomico dell'intero workspace da una corsia all'altra.
	 * Invarianti del Gate R27 / PLAN W08:
	 * 1. Snapshot immediato e salvataggio di openFiles, activeFile, surface ed agentState della corsia uscente.
	 * 2. Risoluzione coerente del record della corsia target da laneStore.
	 * 3. Assegnazione atomica della nuova corsia su projectStore.
	 * 4. Tutte le superfici (FileTree, GitPanel, Editor/Monaco, Terminali e Chat) si riorientano sincronizzate
	 *    nel medesimo tick reattivo senza layout shift ne' distruzione di processi.
	 */
	async switchLane(projectId: ProjectId, targetLaneId: LaneId): Promise<void> {
		const project = projectStore.projects.find((p) => p.id === projectId);
		if (!project) return;
		if (project.lane.laneId === targetLaneId) return;

		// 1. Lo snapshot della corsia uscente si cattura adesso (gli argomenti si
		//    valutano subito), ma la scrittura di lanes.json non deve ritardare il
		//    cambio: le superfici si riorientano nello stesso tick del clic.
		void this.saveLaneSnapshot(project).catch(() => undefined);

		// 2. Risolvi il record della corsia target
		const projectLanes = laneStore.lanesFor(projectId);
		let targetLane: AgentLane | LaneRecord | undefined = projectLanes.find(
			(l) => l.laneId === targetLaneId && l.status !== 'archived'
		);

		if (!targetLane && targetLaneId === MAIN_LANE_ID) {
			targetLane = createMainLane(
				projectId,
				project.canonicalProjectPath,
				project.lane.surface
			);
		}

		if (!targetLane) return;

		// 3. Riorienta atomicamente il progetto alla nuova corsia
		projectStore.setProjectLane(projectId, targetLane);
	}

	/**
	 * Navigazione ciclica tra corsie attive (es. Ctrl+Alt+Freccia).
	 */
	async cycleLane(projectId: ProjectId, direction: 'next' | 'prev'): Promise<void> {
		const project = projectStore.projects.find((p) => p.id === projectId);
		if (!project) return;

		const projectLanes = laneStore.lanesFor(projectId).filter((l) => l.status !== 'archived');
		if (projectLanes.length <= 1) return;

		const main =
			projectLanes.find((l) => l.laneId === MAIN_LANE_ID) ??
			createMainLane(projectId, project.canonicalProjectPath, project.lane.surface);
		const secondary = projectLanes.filter((l) => l.laneId !== MAIN_LANE_ID);
		const all = [main, ...secondary];

		const currentIdx = all.findIndex((l) => l.laneId === project.lane.laneId);
		const delta = direction === 'next' ? 1 : -1;
		const nextIdx = (currentIdx + delta + all.length) % all.length;
		const target = all[nextIdx];

		await this.switchLane(projectId, target.laneId);
	}

	/**
	 * Record della corsia `Principale`: e' il bersaglio predefinito della coda,
	 * anche quando l'utente sta guardando una corsia secondaria.
	 */
	mainLaneRecord(project: Project): AgentLane | LaneRecord {
		const stored = laneStore
			.lanesFor(project.id as ProjectId)
			.find((lane) => lane.laneId === MAIN_LANE_ID);
		if (stored) return stored;
		if (project.lane.laneId === MAIN_LANE_ID) return project.lane;
		return createMainLane(
			project.id as ProjectId,
			project.canonicalProjectPath,
			project.lane.surface
		);
	}

	laneRecord(project: Project, targetLaneId: string): AgentLane | LaneRecord | undefined {
		if (targetLaneId === MAIN_LANE_ID) return this.mainLaneRecord(project);
		return laneStore
			.lanesFor(project.id as ProjectId)
			.find((lane) => lane.laneId === targetLaneId);
	}

	/**
	 * Una corsia e' occupata quando il suo agente sta lavorando, attende una
	 * risposta o ha una spedizione in corso. Lo stato della corsia attiva si
	 * legge da `projectStore`, che e' la copia aggiornata in tempo reale.
	 */
	laneBusy(project: Project, lane: AgentLane | LaneRecord): boolean {
		const key = this.runtimeKey(project.id, lane.laneId);
		if (this.terminalBusy[key] === true) return true;
		const session = sessionRegistry.getLaneSession(project.id, lane.laneId);
		if (session?.isStreaming || session?.pendingUi) return true;
		const state: AgentState =
			project.lane.laneId === lane.laneId ? project.lane.agentState : lane.agentState;
		if (state === 'working' || state === 'attention') return true;
		return this.terminalMeta[key]?.inputPending === true;
	}

	/**
	 * Fotografia delle corsie per il routing della coda (PLAN W09): include
	 * sempre `Principale`, anche quando il registro non la conosce ancora.
	 */
	laneDispatchSnapshots(project: Project): LaneDispatchSnapshot[] {
		const stored = laneStore.lanesFor(project.id as ProjectId);
		const lanes: Array<AgentLane | LaneRecord> = stored.some(
			(lane) => lane.laneId === MAIN_LANE_ID
		)
			? [...stored]
			: [this.mainLaneRecord(project), ...stored];
		return lanes.map((lane) => {
			const session = sessionRegistry.getLaneSession(project.id, lane.laneId);
			const key = this.runtimeKey(project.id, lane.laneId);
			return {
				laneId: lane.laneId,
				title: lane.title,
				origin: lane.origin,
				status: lane.status,
				busy: this.laneBusy(project, lane),
				liveProcess: Boolean(session?.sessionId) || this.terminalSessions.has(key),
				model: session?.model ? { provider: session.model.provider, id: session.model.id } : null
			};
		});
	}

	/**
	 * Creazione coordinata di una nuova corsia secondaria isolata. Subito dopo
	 * la creazione del worktree Studio vi copia i file locali gia' autorizzati
	 * nel profilo di progetto (PLAN W10): senza consenso registrato non viene
	 * copiato nulla.
	 */
	async createNewLane(
		project: Project,
		options: {
			origin?: LaneOrigin;
			surface?: AgentSurface;
			title?: string;
			activate?: boolean;
		} = {}
	): Promise<LaneRecord> {
		// Salva lo stato dei file della corsia attiva prima della creazione
		await this.saveLaneSnapshot(project).catch(() => undefined);

		const record = await laneStore.createNewLane(project, options);
		try {
			const outcomes = await applyProfileToLane(project, record);
			const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
			if (rejected.length > 0) {
				console.warn('File locali non copiati nella corsia:', rejected);
			}
		} catch (error) {
			// La corsia resta valida: l'utente puo' ripetere la copia dal profilo.
			console.error('Copia dei file locali nella corsia fallita:', error);
		}
		return record;
	}

	/**
	 * Archiviazione di una corsia secondaria. La vista torna a Principale solo
	 * se la corsia e' stata davvero smontata: con processi vivi o cleanup
	 * bloccato l'utente resta dov'e', con l'esito in mano (PLAN W11).
	 */
	async archiveLane(
		projectId: ProjectId,
		targetLaneId: LaneId,
		reason: LaneArchiveReason = 'integrated',
		options: { stopProcesses?: boolean } = {}
	): Promise<LaneArchiveOutcome> {
		return await laneStore.archiveLane(projectId, targetLaneId, reason, options);
	}

	/**
	 * Commuta la superficie di input tra 'terminal' e 'gui' per la corsia attiva.
	 */
	async switchSurface(projectId: string, target: 'terminal' | 'gui'): Promise<void> {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		if (!project || project.lane.surface === target) return;

		const key = this.runtimeKey(project.id, project.lane.laneId);
		if (this.switchingSurface[key]) return;
		this.switchingSurface[key] = true;

		try {
			const currentSessionId =
				this.terminalMeta[key]?.sessionId ??
				this.getLaneSession(project.id, project.lane.laneId)?.sessionId ??
				null;

			if (project.lane.surface === 'gui') {
				const session = this.getLaneSession(project.id, project.lane.laneId);
				if (session) {
					if (session.isStreaming) {
						await session.abort();
					}
					await session.close();
				}
			} else {
				await this.getTerminalSession(key)?.release();
			}

			this.updateTerminalMeta(key, { sessionId: currentSessionId });
			projectStore.setSurface(projectId, target);

			// Aggiorna anche laneStore per persistenza del cambio superficie
			void laneStore
				.updateLane(project.id as ProjectId, project.lane.laneId, { surface: target })
				.catch(() => undefined);

			if (target === 'gui') {
				const session = this.getOrCreateAgentSession(project, project.lane);
				await session.open(currentSessionId);
			}
		} catch (error) {
			this.agentErrors[key] = error instanceof Error ? error.message : String(error);
		} finally {
			this.switchingSurface[key] = false;
		}
	}
}

export const laneOrchestrator = new LaneOrchestrator();
