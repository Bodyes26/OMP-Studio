import { invoke } from '@tauri-apps/api/core';
import {
	MAIN_LANE_ID,
	type AgentSurface,
	type LaneId,
	type LaneOrigin,
	type ProjectId,
	type ProjectWorktreeProfile,
	laneId,
	workspacePath,
	createMainLane
} from '$lib/types/lanes';
import { projectStore, type Project } from './projects.svelte';
import {
	lanePatchTouchesPersistedFields,
	laneRecordFromAgentLane,
	parseLaneStoreDocument,
	pruneClosedDraftLanes,
	reconcileProjectLanes,
	serializeLaneStoreDocument,
	type LaneArchiveReason,
	type LaneRecord,
	type LaneStoreDiscarded,
	type WorktreeInfo
} from './lanePersistence';
import {
	laneBranchDeleteArgs,
	recoverInterruptedIntegrations,
	worktreeErrorMessage,
	type InterruptedIntegration
} from '$lib/lanes/laneCleanup';
import { m } from '$lib/paraglide/messages.js';
import { labApi } from '$lib/lab/api';
import {
	classifyWorktreeRemovalError,
	laneProcessesFor,
	listLaneProcesses,
	type LaneCleanupDiagnosis,
	type LaneProcessInfo
} from '$lib/lanes/processSupervisor';

/**
 * Esito dell'archiviazione di una corsia. Non e' una formalita': solo
 * `archived` significa che il worktree non e' piu' su disco.
 */
export type LaneArchiveOutcome =
	| { kind: 'archived' }
	| { kind: 'processes-active'; processes: LaneProcessInfo[]; diagnosis: LaneCleanupDiagnosis }
	| { kind: 'cleanup-pending'; diagnosis: LaneCleanupDiagnosis };

type LanePatch = Partial<Omit<LaneRecord, 'projectId' | 'laneId'>>;

function cloneLane(record: LaneRecord): LaneRecord {
	return { ...record, openFiles: [...record.openFiles] };
}

function cloneProfile(profile: ProjectWorktreeProfile): ProjectWorktreeProfile {
	return {
		...profile,
		detectedStacks: [...profile.detectedStacks],
		manifests: [...profile.manifests],
		generatedDirectories: [...profile.generatedDirectories],
		nativeCaches: profile.nativeCaches.map((cache) => ({ ...cache })),
		untrackedFileAllowlist: [...profile.untrackedFileAllowlist],
		reviewedCandidates: [...profile.reviewedCandidates]
	};
}

class LaneStore {
	lanes = $state<LaneRecord[]>([]);
	profiles = $state<ProjectWorktreeProfile[]>([]);
	revision = $state(0);
	ready = $state(false);
	loadError = $state<string | null>(null);
	saveError = $state<string | null>(null);
	/** Record di `lanes.json` scartati al caricamento perche' illeggibili. */
	loadDiscarded = $state<LaneStoreDiscarded | null>(null);
	/** Copia di `lanes.json` salvata prima di riscriverlo senza i record scartati. */
	backupPath = $state<string | null>(null);
	backupError = $state<string | null>(null);
	reconciliationErrors = $state<Record<string, string>>({});

	private initialized = false;
	/**
	 * Vero dopo un caricamento parziale: la prima scrittura deve prima salvare
	 * il file originale, perche' riscriverlo cancella i record scartati.
	 */
	private backupBeforeWrite = false;
	private interruptedIntegrations: InterruptedIntegration[] = [];
	private initPromise: Promise<void> | null = null;
	private mutationGeneration = 0;
	private persistedGeneration = 0;
	private saveLoop: Promise<void> | null = null;

	constructor() {
		void this.init();
	}

	private get isTauri(): boolean {
		return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
	}

	init(): Promise<void> {
		if (!this.initPromise) {
			this.initPromise = this.initialize().catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.error('Caricamento corsie fallito:', error);
				this.loadError = message;
				this.ready = true;
			});
			// Fuori dalla promessa di init: l'archiviazione la attende, e
			// incatenarla qui dentro la farebbe aspettare se stessa.
			void this.initPromise.then(() => this.finishInterruptedIntegrations());
		}
		return this.initPromise;
	}

	private async initialize(): Promise<void> {
		await projectStore.init();
		if (!this.isTauri) {
			this.ensureMainLanes();
			this.initialized = true;
			this.ready = true;
			return;
		}

		// `lanes.json` passa solo dagli adapter atomici di `lanes_store.rs`: il
		// plugin store non va aperto, perche' all'uscita riscrive con `fs::write`
		// ogni store aperto, e la sua `close` sulla risorsa condivisa bloccava
		// l'init (loadError o promessa appesa) e con essa ogni scrittura corsie.
		const rawDocument = await invoke<unknown | null>('lanes_store_read');
		if (rawDocument !== null) {
			const parsed = parseLaneStoreDocument(rawDocument);
			if (!parsed) {
				throw new Error(m.lanes_store_invalid_schema());
			}
			this.revision = parsed.revision;
			this.lanes = parsed.lanes;
			this.profiles = parsed.profiles;
			if (parsed.discarded.lanes > 0 || parsed.discarded.profiles > 0) {
				console.warn('lanes.json: record non validi scartati', parsed.discarded);
				this.loadDiscarded = parsed.discarded;
				this.backupBeforeWrite = true;
			}
		}
		this.initialized = true;

		// Le bozze chiuse nelle versioni precedenti hanno lasciato i loro record.
		// Con i progetti non caricati non si sa quali tessere siano aperte.
		const drafts = projectStore.loadError
			? { lanes: this.lanes, changed: false }
			: pruneClosedDraftLanes(this.lanes, (candidate) =>
					projectStore.projects.some((project) => project.id === candidate)
				);
		if (drafts.changed) this.lanes = drafts.lanes;
		let changed = this.ensureMainLanes() || drafts.changed;
		const projects = projectStore.projects.filter((project) => project.canonicalProjectPath);
		const results = await Promise.allSettled(
			projects.map(async (project) => ({
				projectId: project.id,
				worktrees: await invoke<WorktreeInfo[]>('worktree_list', {
					args: { projectPath: project.canonicalProjectPath }
				})
			}))
		);
		const errors: Record<string, string> = {};
		for (let index = 0; index < results.length; index++) {
			const result = results[index];
			if (result.status === 'rejected') {
				const project = projects[index];
				errors[project.id] =
					result.reason instanceof Error ? result.reason.message : String(result.reason);
				continue;
			}
			const reconciliation = reconcileProjectLanes(
				this.lanes,
				result.value.projectId,
				result.value.worktrees
			);
			if (reconciliation.changed) {
				this.lanes = reconciliation.lanes;
				changed = true;
			}
		}
		this.reconciliationErrors = errors;

		// Riconciliazione corsie Lab: verifica esistenza del workspace su disco (contratto §7)
		if (this.isTauri) {
			const now = Date.now();
			for (const lane of this.lanes) {
				if (lane.kind === 'lab' && lane.status !== 'archived') {
					const exists = lane.workspacePath
						? await labApi.workspaceExists(lane.workspacePath).catch(() => false)
						: false;
					if (!exists) {
						lane.status = 'archived';
						lane.agentState = 'unknown';
						lane.archiveReason = 'workspace_missing';
						lane.archivedAt = now;
						changed = true;
					}
				}
			}
		}

		// Una corsia rimasta in `integrating` (Studio chiuso durante
		// `worktree_land` o pulizia fallita) non lo resta per sempre.
		const recovery = await recoverInterruptedIntegrations(
			this.lanes,
			(ownerProjectId) =>
				projectStore.projects.find((project) => project.id === ownerProjectId)
					?.canonicalProjectPath ?? null,
			(command, args) => invoke(command, args)
		);
		if (recovery.changed) {
			this.lanes = recovery.lanes;
			this.interruptedIntegrations = recovery.integrated;
			changed = true;
		}

		if (changed) await this.persistMutation();
		this.ready = true;
	}

	/**
	 * Chiude le corsie che Git da' per integrate come farebbe la pulizia dopo
	 * un'integrazione riuscita: archiviazione 'integrated' (che rimuove il
	 * worktree) e cancellazione del branch. Se il worktree non si rimuove la
	 * corsia resta `review_ready` in `cleanup_pending`, recuperabile.
	 */
	private async finishInterruptedIntegrations(): Promise<void> {
		const pending = this.interruptedIntegrations;
		this.interruptedIntegrations = [];
		for (const entry of pending) {
			const ownerProjectId = entry.projectId as ProjectId;
			const targetLaneId = entry.laneId as LaneId;
			try {
				const outcome = await this.archiveLane(ownerProjectId, targetLaneId, 'integrated', {
					stopProcesses: true
				});
				if (outcome.kind !== 'archived') continue;
				const project = projectStore.projects.find((p) => p.id === ownerProjectId);
				if (!project?.canonicalProjectPath) continue;
				await invoke(
					'worktree_delete_lane_branch',
					laneBranchDeleteArgs(project.canonicalProjectPath, targetLaneId, false)
				).catch(async (error) => {
					console.warn(
						'Branch di corsia integrata non eliminato:',
						worktreeErrorMessage(error, String(error))
					);
					await this.updateLane(ownerProjectId, targetLaneId, {
						recoveryState: 'cleanup_pending'
					});
				});
			} catch (error) {
				console.warn('Chiusura di una corsia gia integrata fallita:', error);
			}
		}
	}

	private ensureMainLanes(): boolean {
		let changed = false;
		for (const project of projectStore.projects) {
			if (!project.canonicalProjectPath && !project.labDraft) continue;
			const exists = this.lanes.some(
				(lane) => lane.projectId === project.id && lane.laneId === MAIN_LANE_ID
			);
			if (exists) continue;
			const main = laneRecordFromAgentLane(project.lane);
			const firstProjectLane = this.lanes.findIndex((lane) => lane.projectId === project.id);
			if (firstProjectLane === -1) this.lanes.push(main);
			else this.lanes.splice(firstProjectLane, 0, main);
			changed = true;
		}
		return changed;
	}

	private assertWritable(): void {
		if (this.loadError) {
			throw new Error(m.lanes_store_save_blocked({ reason: this.loadError }));
		}
		if (!this.initialized) throw new Error(m.lanes_store_not_ready());
	}

	private persistMutation(): Promise<void> {
		this.assertWritable();
		this.revision += 1;
		this.mutationGeneration += 1;
		if (!this.isTauri) {
			this.persistedGeneration = this.mutationGeneration;
			return Promise.resolve();
		}
		if (!this.saveLoop) {
			const loop = this.drainSaves();
			this.saveLoop = loop;
			void loop
				.finally(() => {
					if (this.saveLoop === loop) this.saveLoop = null;
				})
				.catch(() => undefined);
		}
		return this.saveLoop;
	}

	private async drainSaves(): Promise<void> {
		if (this.backupBeforeWrite) {
			this.backupBeforeWrite = false;
			// La copia va fatta una volta sola e prima della riscrittura: e'
			// l'unico posto in cui i record scartati sopravvivono. Se non
			// riesce si scrive comunque (bloccare tutte le corsie era il
			// difetto da evitare) e l'utente lo vede nell'avviso.
			try {
				this.backupPath = await invoke<string>('lanes_store_backup');
				this.backupError = null;
			} catch (error) {
				this.backupError = error instanceof Error ? error.message : String(error);
				console.error('Copia di lanes.json non riuscita:', error);
			}
		}
		while (this.persistedGeneration < this.mutationGeneration) {
			const targetGeneration = this.mutationGeneration;
			const document = serializeLaneStoreDocument(
				$state.snapshot(this.lanes),
				$state.snapshot(this.profiles),
				this.revision
			);
			try {
				await invoke('lanes_store_write_atomic', { document });
				this.persistedGeneration = targetGeneration;
				this.saveError = null;
			} catch (error) {
				this.saveError = error instanceof Error ? error.message : String(error);
				throw error;
			}
		}
	}

	lanesFor(ownerProjectId: ProjectId): LaneRecord[] {
		return this.lanes.filter((lane) => lane.projectId === ownerProjectId);
	}

	profileFor(ownerProjectId: ProjectId): ProjectWorktreeProfile | undefined {
		return this.profiles.find((profile) => profile.projectId === ownerProjectId);
	}

	async upsertLane(record: LaneRecord): Promise<void> {
		await this.init();
		this.assertWritable();
		const index = this.lanes.findIndex(
			(lane) => lane.projectId === record.projectId && lane.laneId === record.laneId
		);
		const next = cloneLane(record);
		if (index === -1) this.lanes.push(next);
		else this.lanes[index] = next;
		await this.persistMutation();
	}

	async updateLane(ownerProjectId: ProjectId, targetLaneId: LaneId, patch: LanePatch): Promise<void> {
		await this.init();
		// Lo stato dell'agente non e' su disco: riscrivere lanes.json a ogni
		// cambio di stato era solo I/O sprecato, e uno store in sola lettura
		// non deve impedire di aggiornarlo in memoria.
		const persisted = lanePatchTouchesPersistedFields(patch);
		if (persisted) this.assertWritable();
		const lane = this.lanes.find(
			(candidate) => candidate.projectId === ownerProjectId && candidate.laneId === targetLaneId
		);
		if (!lane) throw new Error(m.lane_error_not_found_id({ id: targetLaneId }));
		Object.assign(lane, patch);
		if (patch.openFiles) lane.openFiles = [...patch.openFiles];
		if (!persisted) return;
		await this.persistMutation();
	}

	/**
	 * Toglie dal registro i record di una bozza Lab libera chiusa. La sua
	 * corsia principale vive solo finche' la tessera e' aperta: riaprendola
	 * viene ricreata, mentre lasciarla in lanes.json la accumulava per sempre.
	 */
	async removeDraftLanes(ownerProjectId: ProjectId): Promise<void> {
		await this.init();
		if (this.loadError || !this.initialized) return;
		const pruned = pruneClosedDraftLanes(
			this.lanes,
			(candidate) =>
				candidate !== ownerProjectId ||
				projectStore.projects.some((project) => project.id === ownerProjectId)
		);
		if (!pruned.changed) return;
		this.lanes = pruned.lanes;
		await this.persistMutation();
	}

	async moveLane(
		ownerProjectId: ProjectId,
		targetLaneId: LaneId,
		beforeLaneId: LaneId | null
	): Promise<void> {
		await this.init();
		this.assertWritable();
		if (targetLaneId === MAIN_LANE_ID) return;
		const from = this.lanes.findIndex(
			(lane) => lane.projectId === ownerProjectId && lane.laneId === targetLaneId
		);
		if (from === -1) return;
		const [lane] = this.lanes.splice(from, 1);
		const before = beforeLaneId
			? this.lanes.findIndex(
					(candidate) =>
						candidate.projectId === ownerProjectId && candidate.laneId === beforeLaneId
				)
			: -1;
		if (before !== -1) {
			this.lanes.splice(before, 0, lane);
		} else {
			const last = this.lanes.findLastIndex((candidate) => candidate.projectId === ownerProjectId);
			this.lanes.splice(last + 1, 0, lane);
		}
		await this.persistMutation();
	}

	async upsertProfile(profile: ProjectWorktreeProfile): Promise<void> {
		await this.init();
		this.assertWritable();
		const index = this.profiles.findIndex((candidate) => candidate.projectId === profile.projectId);
		const next = cloneProfile(profile);
		if (index === -1) this.profiles.push(next);
		else this.profiles[index] = next;
		await this.persistMutation();
	}

	/**
	 * Nuova corsia isolata. `origin` distingue la creazione manuale da quella
	 * dell'auto-dispatch: lo slot automatico e' uno solo per progetto e resta
	 * impegnato finche' la corsia non viene archiviata.
	 *
	 * `activate: false` crea la corsia senza portarci dentro il workspace: una
	 * corsia nata per un task di coda in background non deve strappare la vista
	 * all'utente che sta lavorando sulla Principale.
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
		await this.init();
		this.assertWritable();
		if (!project.canonicalProjectPath) {
			throw new Error(m.lane_error_create_without_path());
		}

		// Calcola il prossimo numero disponibile per il titolo provvisorio "Worktree N"
		const existing = this.lanesFor(project.id);
		let maxNum = 0;
		for (const l of existing) {
			const match = l.title.match(/^Worktree\s+(\d+)$/i);
			if (match) {
				const n = parseInt(match[1], 10);
				if (!isNaN(n) && n > maxNum) maxNum = n;
			}
		}
		let nextNum = maxNum + 1;
		let targetLaneId = laneId(`wt-${nextNum}`);
		while (existing.some((l) => l.laneId === targetLaneId)) {
			nextNum += 1;
			targetLaneId = laneId(`wt-${nextNum}`);
		}
		const title = options.title?.trim() || `Worktree ${nextNum}`;

		let wsPath: string;
		let branch: string;
		let baseCommit = 'HEAD';
		let targetBranch = 'main';

		if (this.isTauri) {
			const inspection = await invoke<{
				headCommit?: string | null;
				currentBranch?: string | null;
			}>('worktree_inspect', {
				args: { projectPath: project.canonicalProjectPath }
			});
			baseCommit = inspection.headCommit ?? 'HEAD';
			targetBranch = inspection.currentBranch ?? 'main';

			const info = await invoke<WorktreeInfo>('worktree_create', {
				args: {
					projectPath: project.canonicalProjectPath,
					laneId: targetLaneId,
					baseCommit,
					targetBranch
				}
			});
			wsPath = info.workspacePath;
			branch = info.branch ?? `omp/lane-${targetLaneId}`;
			if (info.baseCommit) baseCommit = info.baseCommit;
			if (info.targetBranch) targetBranch = info.targetBranch;
		} else {
			wsPath = `${project.canonicalProjectPath}/.mock-wt-${targetLaneId}`;
			branch = `omp/lane-${targetLaneId}`;
		}

		const record: LaneRecord = {
			projectId: project.id,
			laneId: targetLaneId,
			title,
			workspacePath: workspacePath(wsPath),
			branch,
			baseCommit,
			targetBranch,
			createdAt: Date.now(),
			status: 'active',
			origin: options.origin ?? 'manual',
			agentState: 'idle',
			openFiles: [],
			activeFile: null,
			surface: options.surface ?? project.lane.surface,
			sessionId: null,
			headCommit: baseCommit,
			recoveryState: 'registered',
			archiveReason: null,
			archivedAt: null,
			recoveredAt: null,
			kind: 'git',
			labPrototypeId: null,
			closedAt: null,
			titleLocked: false
		};

		await this.upsertLane(record);
		if (options.activate !== false) projectStore.setProjectLane(project.id, record);
		return record;
	}

	/**
	 * Archiviazione di una corsia secondaria. `reason` distingue integrazione e
	 * rifiuto: in entrambi i casi lo slot dell'auto-dispatch torna libero.
	 *
	 * La corsia viene archiviata solo quando il worktree e' davvero sparito dal
	 * disco (Gate R27 / PLAN W11):
	 * - processi ancora vivi: nulla viene toccato e l'esito chiede il consenso
	 *   esplicito ad arrestarli (`stopProcesses`);
	 * - rimozione fallita per lock o rifiuto di Git: la corsia resta viva in
	 *   `cleanup_pending`, riprovabile, mai archiviata per finta.
	 */
	async archiveLane(
		ownerProjectId: ProjectId,
		targetLaneId: LaneId,
		reason: LaneArchiveReason = 'integrated',
		options: { stopProcesses?: boolean } = {}
	): Promise<LaneArchiveOutcome> {
		await this.init();
		this.assertWritable();
		if (targetLaneId === MAIN_LANE_ID) return { kind: 'archived' };

		const lane = this.lanes.find(
			(candidate) => candidate.projectId === ownerProjectId && candidate.laneId === targetLaneId
		);
		if (!lane) return { kind: 'archived' };

		const project = projectStore.projects.find((p) => p.id === ownerProjectId);

		if (lane.kind === 'lab') {
			// Le corsie Lab non usano git worktree_remove (contratto §7)
			lane.status = 'archived';
			lane.archivedAt = Date.now();
			lane.archiveReason = reason;
			lane.recoveryState = 'registered';
			await this.persistMutation();

			if (project && project.lane.laneId === targetLaneId) {
				const main = this.lanes.find(
					(l) => l.projectId === ownerProjectId && l.laneId === MAIN_LANE_ID
				);
				projectStore.setProjectLane(
					ownerProjectId,
					main ?? createMainLane(ownerProjectId, project.canonicalProjectPath, project.lane.surface)
				);
			}
			return { kind: 'archived' };
		}
		if (this.isTauri && project?.canonicalProjectPath && lane.workspacePath) {
			try {
				await invoke('worktree_remove', {
					args: {
						projectPath: project.canonicalProjectPath,
						worktreePath: lane.workspacePath,
						stopProcesses: options.stopProcesses === true
					}
				});
			} catch (error) {
				const diagnosis = classifyWorktreeRemovalError(error);
				if (diagnosis.failure === 'processes-active') {
					const processes = await listLaneProcesses()
						.then((list) => laneProcessesFor(list, ownerProjectId, targetLaneId))
						.catch(() => [] as LaneProcessInfo[]);
					return { kind: 'processes-active', processes, diagnosis };
				}
				if (lane.recoveryState !== 'cleanup_pending') {
					lane.recoveryState = 'cleanup_pending';
					await this.persistMutation();
				}
				return { kind: 'cleanup-pending', diagnosis };
			}
		}

		lane.status = 'archived';
		lane.archivedAt = Date.now();
		lane.archiveReason = reason;
		lane.recoveryState = 'registered';
		await this.persistMutation();

		// Se la corsia archiviata era attiva nel progetto, torna a Principale
		if (project && project.lane.laneId === targetLaneId) {
			const main = this.lanes.find(
				(l) => l.projectId === ownerProjectId && l.laneId === MAIN_LANE_ID
			);
			projectStore.setProjectLane(
				ownerProjectId,
				main ?? createMainLane(ownerProjectId, project.canonicalProjectPath, project.lane.surface)
			);
		}
		return { kind: 'archived' };
	}

	async flush(): Promise<void> {
		await this.init();
		await this.saveLoop;
	}
}

export const laneStore = new LaneStore();
export type { LanePatch, LaneRecord };
