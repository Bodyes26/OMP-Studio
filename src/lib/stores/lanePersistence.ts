import {
	canonicalProjectPath,
	laneId,
	projectId,
	workspacePath,
	type AgentLane,
	type AgentState,
	type AgentSurface,
	MAIN_LANE_ID,
	type LaneOrigin,
	type LaneStatus,
	type ProjectId,
	type NativeCacheRecord,
	type ProjectStack,
	type ProjectWorktreeProfile,
	type RestoreMode
} from '$lib/types/lanes';
import { m } from '$lib/paraglide/messages.js';

export const LANE_STORE_SCHEMA_VERSION = 1 as const;

/**
 * `cleanup_pending` (PLAN W11): il worktree e' ancora su disco perche' la
 * rimozione e' fallita (lock file di Windows, Git che rifiuta). La corsia
 * resta viva e riprovabile: archiviarla sarebbe una bugia sullo stato reale.
 */
export type LaneRecoveryState = 'registered' | 'recovered' | 'cleanup_pending';
export type LaneArchiveReason = 'worktree_missing' | 'integrated' | 'rejected';

export interface LaneRecord extends AgentLane {
	sessionId: string | null;
	headCommit: string | null;
	recoveryState: LaneRecoveryState;
	archiveReason: LaneArchiveReason | null;
	archivedAt: number | null;
	recoveredAt: number | null;
}

interface StoredLaneV1 {
	projectId: string;
	laneId: string;
	title: string;
	workspacePath: string | null;
	branch: string | null;
	baseCommit: string | null;
	headCommit: string | null;
	targetBranch: string | null;
	createdAt: number | null;
	status: LaneStatus;
	origin: LaneOrigin;
	sessionId: string | null;
	openFiles: string[];
	activeFile: string | null;
	surface: AgentSurface;
	recoveryState: LaneRecoveryState;
	archiveReason: LaneArchiveReason | null;
	archivedAt: number | null;
	recoveredAt: number | null;
}

interface StoredProfileV1 {
	projectId: string;
	canonicalProjectPath: string;
	detectedStacks: ProjectStack[];
	restoreMode: RestoreMode;
	manifests: string[];
	generatedDirectories: string[];
	nativeCaches: NativeCacheRecord[];
	untrackedFileAllowlist: string[];
	reviewedCandidates: string[];
	detectedAt: number | null;
	confirmedAt: number | null;
}

export interface LaneStoreDocument {
	schemaVersion: typeof LANE_STORE_SCHEMA_VERSION;
	revision: number;
	lanes: StoredLaneV1[];
	profiles: StoredProfileV1[];
}

export interface ParsedLaneStore {
	revision: number;
	lanes: LaneRecord[];
	profiles: ProjectWorktreeProfile[];
}

/** DTO restituito dal comando Rust `worktree_list`. */
export interface WorktreeInfo {
	worktreePath: string;
	workspacePath: string;
	commit?: string | null;
	branch?: string | null;
	detached: boolean;
	isCurrent: boolean;
	managedByStudio: boolean;
	laneId?: string | null;
	baseCommit?: string | null;
	targetBranch?: string | null;
	lockedReason?: string | null;
	prunableReason?: string | null;
}

export interface LaneReconciliationResult {
	lanes: LaneRecord[];
	changed: boolean;
}

const LANE_STATUSES: Record<LaneStatus, true> = {
	active: true,
	review_ready: true,
	conflict: true,
	integrating: true,
	archived: true
};
const LANE_ORIGINS: Record<LaneOrigin, true> = { main: true, manual: true, auto: true };
const AGENT_SURFACES: Record<AgentSurface, true> = { terminal: true, gui: true };
const RECOVERY_STATES: Record<LaneRecoveryState, true> = {
	registered: true,
	recovered: true,
	cleanup_pending: true
};
const ARCHIVE_REASONS: Record<LaneArchiveReason, true> = {
	worktree_missing: true,
	integrated: true,
	rejected: true
};
const PROJECT_STACKS: Record<ProjectStack, true> = {
	aspnet: true,
	dotnet: true,
	vite: true,
	svelte: true,
	node: true,
	static: true
};
const RESTORE_MODES: Record<RestoreMode, true> = {
	none: true,
	package_reference: true,
	packages_config: true,
	mixed: true
};

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function nonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized || null;
}

function nullableString(value: unknown): string | null | undefined {
	if (value === null) return null;
	return nonEmptyString(value) ?? undefined;
}

function nullableTimestamp(value: unknown): number | null | undefined {
	if (value === null) return null;
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseStringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const result: string[] = [];
	for (const entry of value) {
		const parsed = nonEmptyString(entry);
		if (!parsed) return null;
		result.push(parsed);
	}
	return result;
}

function parseStoredLane(value: unknown): LaneRecord | null {
	const source = object(value);
	if (!source) return null;
	const rawProjectId = nonEmptyString(source.projectId);
	const rawLaneId = nonEmptyString(source.laneId);
	const title = nonEmptyString(source.title);
	const rawWorkspace = nullableString(source.workspacePath);
	const branch = nullableString(source.branch);
	const baseCommit = nullableString(source.baseCommit);
	const headCommit = nullableString(source.headCommit);
	const targetBranch = nullableString(source.targetBranch);
	const createdAt = nullableTimestamp(source.createdAt);
	const sessionId = nullableString(source.sessionId);
	const activeFile = nullableString(source.activeFile);
	const archivedAt = nullableTimestamp(source.archivedAt);
	const recoveredAt = nullableTimestamp(source.recoveredAt);
	const openFiles = parseStringArray(source.openFiles);
	const status = source.status;
	const surface = source.surface;
	const recoveryState = source.recoveryState;
	const archiveReason = source.archiveReason;
	// `origin` e' arrivato con W09: i registri scritti prima non lo hanno e
	// vanno riletti senza perdere le corsie gia' su disco. Assente significa
	// "creata a mano": una corsia di provenienza ignota non puo' rivendicare
	// lo slot unico dell'auto-dispatch.
	const origin =
		source.origin === undefined || source.origin === null
			? rawLaneId === MAIN_LANE_ID
				? 'main'
				: 'manual'
			: source.origin;

	if (
		!rawProjectId ||
		!rawLaneId ||
		!title ||
		rawWorkspace === undefined ||
		branch === undefined ||
		baseCommit === undefined ||
		headCommit === undefined ||
		targetBranch === undefined ||
		createdAt === undefined ||
		sessionId === undefined ||
		activeFile === undefined ||
		archivedAt === undefined ||
		recoveredAt === undefined ||
		!openFiles ||
		typeof status !== 'string' ||
		!LANE_STATUSES[status as LaneStatus] ||
		typeof surface !== 'string' ||
		!AGENT_SURFACES[surface as AgentSurface] ||
		typeof recoveryState !== 'string' ||
		!RECOVERY_STATES[recoveryState as LaneRecoveryState] ||
		typeof origin !== 'string' ||
		!LANE_ORIGINS[origin as LaneOrigin] ||
		!(
			archiveReason === null ||
			(typeof archiveReason === 'string' && ARCHIVE_REASONS[archiveReason as LaneArchiveReason])
		)
	) {
		return null;
	}

	try {
		return {
			projectId: projectId(rawProjectId),
			laneId: laneId(rawLaneId),
			title,
			workspacePath: rawWorkspace === null ? null : workspacePath(rawWorkspace),
			branch,
			baseCommit,
			headCommit,
			targetBranch,
			createdAt,
			status: status as LaneStatus,
			origin: origin as LaneOrigin,
			sessionId,
			agentState: 'unknown',
			openFiles,
			activeFile,
			surface: surface as AgentSurface,
			recoveryState: recoveryState as LaneRecoveryState,
			archiveReason: archiveReason as LaneArchiveReason | null,
			archivedAt,
			recoveredAt
		};
	} catch {
		return null;
	}
}

/**
 * I campi del profilo tecnico (W10) sono arrivati dopo i primi registri su
 * disco: quando mancano valgono i default neutri (nessun restore rilevato,
 * nessun manifesto, nessun candidato esaminato), senza invalidare il file.
 * Presenti, vengono validati senza sconti.
 */
function parseOptionalStringArray(value: unknown): string[] | null {
	if (value === undefined || value === null) return [];
	return parseStringArray(value);
}

function parseNativeCaches(value: unknown): NativeCacheRecord[] | null {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return null;
	const caches: NativeCacheRecord[] = [];
	for (const entry of value) {
		const source = object(entry);
		if (!source || source.kind !== 'nuget' || typeof source.available !== 'boolean') return null;
		const path = nullableString(source.path);
		if (path === undefined) return null;
		caches.push({ kind: 'nuget', path, available: source.available });
	}
	return caches;
}

function parseStoredProfile(value: unknown): ProjectWorktreeProfile | null {
	const source = object(value);
	if (!source) return null;
	const rawProjectId = nonEmptyString(source.projectId);
	const rawCanonicalPath = nonEmptyString(source.canonicalProjectPath);
	const allowlist = parseStringArray(source.untrackedFileAllowlist);
	const reviewedCandidates = parseOptionalStringArray(source.reviewedCandidates);
	const manifests = parseOptionalStringArray(source.manifests);
	const generatedDirectories = parseOptionalStringArray(source.generatedDirectories);
	const nativeCaches = parseNativeCaches(source.nativeCaches);
	const confirmedAt = nullableTimestamp(source.confirmedAt);
	const detectedAt = source.detectedAt === undefined ? null : nullableTimestamp(source.detectedAt);
	const restoreMode = source.restoreMode === undefined ? 'none' : source.restoreMode;
	if (
		!rawProjectId ||
		!rawCanonicalPath ||
		!allowlist ||
		!reviewedCandidates ||
		!manifests ||
		!generatedDirectories ||
		!nativeCaches ||
		confirmedAt === undefined ||
		detectedAt === undefined ||
		typeof restoreMode !== 'string' ||
		!RESTORE_MODES[restoreMode as RestoreMode] ||
		!Array.isArray(source.detectedStacks) ||
		!source.detectedStacks.every(
			(stack): stack is ProjectStack =>
				typeof stack === 'string' && PROJECT_STACKS[stack as ProjectStack]
		)
	) {
		return null;
	}
	const detectedStacks = [...new Set(source.detectedStacks as ProjectStack[])];
	try {
		return {
			projectId: projectId(rawProjectId),
			canonicalProjectPath: canonicalProjectPath(rawCanonicalPath),
			detectedStacks,
			restoreMode: restoreMode as RestoreMode,
			manifests,
			generatedDirectories,
			nativeCaches,
			untrackedFileAllowlist: allowlist,
			reviewedCandidates,
			detectedAt,
			confirmedAt
		};
	} catch {
		return null;
	}
}

/**
 * Legge esclusivamente la versione corrente. Una migrazione futura dovra'
 * convertire una versione precedente qui e verra' poi riscritta subito come
 * versione corrente: nessun doppio formato resta nel runtime.
 */
export function parseLaneStoreDocument(value: unknown): ParsedLaneStore | null {
	const source = object(value);
	if (!source || source.schemaVersion !== LANE_STORE_SCHEMA_VERSION) return null;
	if (!Number.isInteger(source.revision) || (source.revision as number) < 0) return null;
	if (!Array.isArray(source.lanes) || !Array.isArray(source.profiles)) return null;

	const lanes = source.lanes.map(parseStoredLane);
	const profiles = source.profiles.map(parseStoredProfile);
	if (lanes.some((lane) => lane === null) || profiles.some((profile) => profile === null)) {
		return null;
	}

	const laneKeys = new Set<string>();
	for (const lane of lanes as LaneRecord[]) {
		const key = `${lane.projectId}\u0000${lane.laneId}`;
		if (laneKeys.has(key)) return null;
		laneKeys.add(key);
	}
	const profileKeys = new Set<string>();
	for (const profile of profiles as ProjectWorktreeProfile[]) {
		if (profileKeys.has(profile.projectId)) return null;
		profileKeys.add(profile.projectId);
	}

	return {
		revision: source.revision as number,
		lanes: lanes as LaneRecord[],
		profiles: profiles as ProjectWorktreeProfile[]
	};
}

export function serializeLaneStoreDocument(
	lanes: readonly LaneRecord[],
	profiles: readonly ProjectWorktreeProfile[],
	revision: number
): LaneStoreDocument {
	return {
		schemaVersion: LANE_STORE_SCHEMA_VERSION,
		revision,
		lanes: lanes.map((lane) => ({
			projectId: lane.projectId,
			laneId: lane.laneId,
			title: lane.title,
			workspacePath: lane.workspacePath,
			branch: lane.branch,
			baseCommit: lane.baseCommit,
			headCommit: lane.headCommit,
			targetBranch: lane.targetBranch,
			createdAt: lane.createdAt,
			status: lane.status,
			origin: lane.origin,
			sessionId: lane.sessionId,
			openFiles: [...lane.openFiles],
			activeFile: lane.activeFile,
			surface: lane.surface,
			recoveryState: lane.recoveryState,
			archiveReason: lane.archiveReason,
			archivedAt: lane.archivedAt,
			recoveredAt: lane.recoveredAt
		})),
		profiles: profiles.map((profile) => ({
			projectId: profile.projectId,
			canonicalProjectPath: profile.canonicalProjectPath,
			detectedStacks: [...profile.detectedStacks],
			restoreMode: profile.restoreMode,
			manifests: [...profile.manifests],
			generatedDirectories: [...profile.generatedDirectories],
			nativeCaches: profile.nativeCaches.map((cache) => ({ ...cache })),
			untrackedFileAllowlist: [...profile.untrackedFileAllowlist],
			reviewedCandidates: [...profile.reviewedCandidates],
			detectedAt: profile.detectedAt,
			confirmedAt: profile.confirmedAt
		}))
	};
}

export function laneRecordFromAgentLane(lane: AgentLane, sessionId: string | null = null): LaneRecord {
	return {
		projectId: lane.projectId,
		laneId: lane.laneId,
		title: lane.title,
		workspacePath: lane.workspacePath,
		branch: lane.branch,
		baseCommit: lane.baseCommit,
		headCommit: null,
		targetBranch: lane.targetBranch,
		createdAt: lane.createdAt,
		status: lane.status,
		origin: lane.origin,
		sessionId,
		agentState: lane.agentState,
		openFiles: [...lane.openFiles],
		activeFile: lane.activeFile,
		surface: lane.surface,
		recoveryState: 'registered',
		archiveReason: null,
		archivedAt: null,
		recoveredAt: null
	};
}

function sameGitMetadata(lane: LaneRecord, worktree: WorktreeInfo): boolean {
	return (
		lane.workspacePath === workspacePath(worktree.workspacePath) &&
		lane.branch === (worktree.branch ?? null) &&
		lane.headCommit === (worktree.commit ?? null) &&
		lane.baseCommit === (worktree.baseCommit ?? null) &&
		lane.targetBranch === (worktree.targetBranch ?? null)
	);
}

function applyGitMetadata(lane: LaneRecord, worktree: WorktreeInfo): LaneRecord {
	if (sameGitMetadata(lane, worktree)) return lane;
	return {
		...lane,
		workspacePath: workspacePath(worktree.workspacePath),
		branch: worktree.branch ?? null,
		headCommit: worktree.commit ?? null,
		baseCommit: worktree.baseCommit ?? null,
		targetBranch: worktree.targetBranch ?? null
	};
}

function recoveredTitle(worktree: WorktreeInfo): string {
	return worktree.branch
		? m.lane_recovered_title_branch({ branch: worktree.branch })
		: m.lane_recovered_title_id({ id: worktree.laneId ?? '' });
}

/**
 * Riconcilia un progetto senza side effect. L'ordine dei record esistenti non
 * cambia; le corsie recuperate vengono accodate. Git e' autorevole soltanto per
 * path, branch e commit. Un'assenza prunable equivale a un worktree mancante.
 */
export function reconcileProjectLanes(
	lanes: readonly LaneRecord[],
	ownerProjectId: ProjectId,
	worktrees: readonly WorktreeInfo[],
	now: number = Date.now()
): LaneReconciliationResult {
	const current = worktrees.find((worktree) => worktree.isCurrent && !worktree.prunableReason);
	const managed = new Map<string, WorktreeInfo>();
	for (const worktree of worktrees) {
		if (
			worktree.isCurrent ||
			!worktree.managedByStudio ||
			!worktree.laneId ||
			worktree.prunableReason
		) {
			continue;
		}
		if (!managed.has(worktree.laneId)) managed.set(worktree.laneId, worktree);
	}

	let changed = false;
	const matched = new Set<string>();
	const next = lanes.map((lane) => {
		if (lane.projectId !== ownerProjectId) return lane;
		if (lane.laneId === MAIN_LANE_ID) {
			if (!current) return lane;
			const updated = applyGitMetadata(lane, current);
			if (updated !== lane) changed = true;
			return updated;
		}

		const worktree = managed.get(lane.laneId);
		if (worktree) {
			matched.add(lane.laneId);
			const updated = applyGitMetadata(lane, worktree);
			if (updated !== lane) changed = true;
			return updated;
		}
		if (lane.status === 'archived') return lane;
		changed = true;
		return {
			...lane,
			status: 'archived' as const,
			agentState: 'unknown' as AgentState,
			archiveReason: 'worktree_missing' as const,
			archivedAt: now
		};
	});

	const defaultSurface =
		next.find((lane) => lane.projectId === ownerProjectId && lane.laneId === MAIN_LANE_ID)
			?.surface ?? 'terminal';
	for (const [rawLaneId, worktree] of managed) {
		if (matched.has(rawLaneId)) continue;
		changed = true;
		next.push({
			projectId: ownerProjectId,
			laneId: laneId(rawLaneId),
			title: recoveredTitle(worktree),
			workspacePath: workspacePath(worktree.workspacePath),
			branch: worktree.branch ?? null,
			baseCommit: worktree.baseCommit ?? null,
			headCommit: worktree.commit ?? null,
			targetBranch: worktree.targetBranch ?? null,
			createdAt: null,
			status: 'active',
			// Corsia trovata su disco e non registrata: provenienza ignota,
			// quindi manuale. L'auto-dispatch resta in pausa finche' l'utente
			// non la integra o non la scarta.
			origin: 'manual',
			sessionId: null,
			agentState: 'unknown',
			openFiles: [],
			activeFile: null,
			surface: defaultSurface,
			recoveryState: 'recovered',
			archiveReason: null,
			archivedAt: null,
			recoveredAt: now
		});
	}

	return { lanes: next, changed };
}
