import { invoke } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
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
	laneRecordFromAgentLane,
	parseLaneStoreDocument,
	reconcileProjectLanes,
	serializeLaneStoreDocument,
	type LaneArchiveReason,
	type LaneRecord,
	type WorktreeInfo
} from './lanePersistence';
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

const STORE_FILE = 'lanes.json';
const STORE_KEY = 'laneState';

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
	reconciliationErrors = $state<Record<string, string>>({});

	private initialized = false;
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

		const [pluginStore, rawDocument] = await Promise.all([
			load(STORE_FILE, { autoSave: false }),
			invoke<unknown | null>('lanes_store_read')
		]);
		try {
			if (rawDocument !== null) {
				const parsed = parseLaneStoreDocument(rawDocument);
				if (!parsed) {
					throw new Error('lanes.json usa uno schema non valido o non supportato');
				}
				this.revision = parsed.revision;
				this.lanes = parsed.lanes;
				this.profiles = parsed.profiles;
			}
		} finally {
			// Il plugin salva tutti gli store aperti con `fs::write` all'uscita.
			// Chiuderlo evita che quella scrittura non atomica tocchi lanes.json:
			// il file canonico viene aggiornato solo dall'adapter qui sotto.
			await pluginStore.close();
		}
		this.initialized = true;

		let changed = this.ensureMainLanes();
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
		if (changed) await this.persistMutation();
		this.ready = true;
	}

	private ensureMainLanes(): boolean {
		let changed = false;
		for (const project of projectStore.projects) {
			if (!project.canonicalProjectPath) continue;
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
			throw new Error(`Salvataggio corsie bloccato: ${this.loadError}`);
		}
		if (!this.initialized) throw new Error('Store corsie non inizializzato');
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
		while (this.persistedGeneration < this.mutationGeneration) {
			const targetGeneration = this.mutationGeneration;
			const document = serializeLaneStoreDocument(
				$state.snapshot(this.lanes),
				$state.snapshot(this.profiles),
				this.revision
			);
			let pluginStore: Store | null = null;
			try {
				pluginStore = await load(STORE_FILE, { autoSave: false });
				await pluginStore.set(STORE_KEY, document);
				await invoke('lanes_store_write_atomic', { document });
				await pluginStore.close();
				pluginStore = null;
				this.persistedGeneration = targetGeneration;
				this.saveError = null;
			} catch (error) {
				this.saveError = error instanceof Error ? error.message : String(error);
				throw error;
			} finally {
				if (pluginStore) {
					try {
						await pluginStore.close();
					} catch (error) {
						console.error('Chiusura store corsie fallita:', error);
					}
				}
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
		this.assertWritable();
		const lane = this.lanes.find(
			(candidate) => candidate.projectId === ownerProjectId && candidate.laneId === targetLaneId
		);
		if (!lane) throw new Error(`Corsia non trovata: ${targetLaneId}`);
		Object.assign(lane, patch);
		if (patch.openFiles) lane.openFiles = [...patch.openFiles];
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
			throw new Error('Impossibile creare una corsia su un progetto senza percorso canonico');
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
			recoveredAt: null
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
