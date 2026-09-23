import { normalizeProjectPath } from '$lib/utils/paths';

declare const projectIdBrand: unique symbol;
declare const laneIdBrand: unique symbol;
declare const canonicalProjectPathBrand: unique symbol;
declare const workspacePathBrand: unique symbol;

export type ProjectId = string & { readonly [projectIdBrand]: 'ProjectId' };
export type LaneId = string & { readonly [laneIdBrand]: 'LaneId' };
export type CanonicalProjectPath = string & {
	readonly [canonicalProjectPathBrand]: 'CanonicalProjectPath';
};
export type WorkspacePath = string & { readonly [workspacePathBrand]: 'WorkspacePath' };

export type AgentState = 'idle' | 'working' | 'attention' | 'finished' | 'unknown';
export type AgentSurface = 'terminal' | 'gui';
export type LaneStatus = 'active' | 'review_ready' | 'conflict' | 'integrating' | 'archived';
/**
 * Chi ha creato la corsia. Governa lo slot unico di auto-dispatch (W09):
 * una corsia `manual` sospende l'auto-avvio, una corsia `auto` occupa lo slot
 * finche' non viene archiviata (integrata o rifiutata).
 */
export type LaneOrigin = 'main' | 'manual' | 'auto';

export interface AgentLane {
	projectId: ProjectId;
	laneId: LaneId;
	title: string;
	workspacePath: WorkspacePath | null;
	branch: string | null;
	baseCommit: string | null;
	targetBranch: string | null;
	createdAt: number | null;
	status: LaneStatus;
	origin: LaneOrigin;
	ptyId?: number;
	agentState: AgentState;
	openFiles: string[];
	activeFile: string | null;
	surface: AgentSurface;
}

export type ProjectStack = 'aspnet' | 'dotnet' | 'vite' | 'svelte' | 'node' | 'static';

/**
 * Come il progetto ripristina le dipendenze .NET. `package_reference` riusa la
 * cache globale NuGet senza duplicare nulla nel worktree; `packages_config`
 * copia i binari dentro `packages/` e va segnalato prima del primo restore.
 */
export type RestoreMode = 'none' | 'package_reference' | 'packages_config' | 'mixed';

export interface NativeCacheRecord {
	kind: 'nuget';
	path: string | null;
	available: boolean;
}

export interface ProjectWorktreeProfile {
	projectId: ProjectId;
	canonicalProjectPath: CanonicalProjectPath;
	detectedStacks: ProjectStack[];
	restoreMode: RestoreMode;
	/** Percorsi relativi dei manifesti che hanno determinato lo stack. */
	manifests: string[];
	/** Cartelle rigenerabili: mai copiate, mai collegate con junction. */
	generatedDirectories: string[];
	nativeCaches: NativeCacheRecord[];
	/** File locali non versionati autorizzati dall'utente: solo percorsi. */
	untrackedFileAllowlist: string[];
	/** Candidati gia' sottoposti all'utente: non vengono piu' riproposti. */
	reviewedCandidates: string[];
	detectedAt: number | null;
	confirmedAt: number | null;
}

export interface TaskRunRecord {
	runId: string;
	taskId: string;
	projectId: ProjectId;
	laneId: LaneId;
	/** Titolo della corsia al momento del lancio: la corsia puo' sparire. */
	laneTitle: string;
	/** Distingue nello storico i lanci sul working tree dai lanci in worktree. */
	laneKind: 'main' | 'worktree';
	sessionId: string | null;
	workspacePath: WorkspacePath;
	targetBranch: string | null;
	branch: string | null;
	startedAt: number;
	finishedAt: number | null;
}

export const MAIN_LANE_ID = 'main' as LaneId;

function nonEmpty(value: string, name: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${name} non puo' essere vuoto`);
	return normalized;
}

export function projectId(value: string): ProjectId {
	return nonEmpty(value, 'projectId') as ProjectId;
}

export function laneId(value: string): LaneId {
	return nonEmpty(value, 'laneId') as LaneId;
}

export function canonicalProjectPath(value: string): CanonicalProjectPath {
	const normalized = normalizeProjectPath(value);
	return nonEmpty(normalized, 'canonicalProjectPath') as CanonicalProjectPath;
}

export function workspacePath(value: string): WorkspacePath {
	const normalized = normalizeProjectPath(value);
	return nonEmpty(normalized, 'workspacePath') as WorkspacePath;
}

export function workspacePathFromCanonical(path: CanonicalProjectPath): WorkspacePath {
	return path as string as WorkspacePath;
}

export function createMainLane(
	ownerProjectId: ProjectId,
	canonicalPath: CanonicalProjectPath | null,
	surface: AgentSurface
): AgentLane {
	return {
		projectId: ownerProjectId,
		laneId: MAIN_LANE_ID,
		title: 'Principale',
		workspacePath: canonicalPath ? workspacePathFromCanonical(canonicalPath) : null,
		branch: null,
		baseCommit: null,
		targetBranch: null,
		createdAt: null,
		status: 'active',
		origin: 'main',
		agentState: 'unknown',
		openFiles: [],
		activeFile: null,
		surface
	};
}
