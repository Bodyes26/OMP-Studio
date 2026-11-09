import { invoke } from '@tauri-apps/api/core';
import { m } from '#lib/paraglide/messages.js';
import { projectStore, normalizeProjectPath, pathKey } from '#lib/stores/projects.svelte.ts';
import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
import { MAIN_LANE_ID, type ProjectId } from '#lib/types/lanes.ts';

export interface ExternalRoute {
	file: string;
	rootIndex: number | null;
	workdir: string;
	rel: string;
}

export interface RootEntry {
	path: string;
	projectId: string;
	isMain: boolean;
}

export type OpenDecision =
	| {
			kind: 'project';
			projectId: string;
			rel: string;
			switchToMain: boolean;
	  }
	| {
			kind: 'external';
			workdir: string;
			rel: string;
	  };

export interface ProjectRootCandidate {
	id: string;
	canonicalProjectPath?: string | null;
	lane: {
		laneId: string;
		workspacePath: string | null;
	};
}

/**
 * Raccoglie le radici dei progetti aperti distinguendo la corsia attiva (worktree)
 * dalla radice canonica (Principale).
 */
export function buildRootEntries(projects: readonly ProjectRootCandidate[]): RootEntry[] {
	const rootEntries: RootEntry[] = [];
	const seenRoots = new Set<string>();

	for (const p of projects) {
		const isWorktree = p.lane.laneId !== MAIN_LANE_ID;
		const candidates: Array<{ path: string; isMain: boolean }> = [];

		// Se la corsia attiva e' un worktree, la sua radice e' secondaria (isMain: false)
		if (p.lane.workspacePath && isWorktree) {
			candidates.push({ path: p.lane.workspacePath, isMain: false });
		}
		// La radice canonica del progetto e' la Principale (isMain: true)
		if (p.canonicalProjectPath) {
			candidates.push({ path: p.canonicalProjectPath, isMain: true });
		} else if (p.lane.workspacePath && !isWorktree) {
			candidates.push({ path: p.lane.workspacePath, isMain: true });
		}

		for (const candidate of candidates) {
			const norm = normalizeProjectPath(candidate.path);
			if (!norm) continue;
			const key = pathKey(norm);
			if (!seenRoots.has(key)) {
				seenRoots.add(key);
				rootEntries.push({ path: norm, projectId: p.id, isMain: candidate.isMain });
			}
		}
	}

	return rootEntries;
}

/**
 * Funzione pura decisionale: determina se aprire il file nel progetto esistente
 * (eventualmente commutando alla corsia Principale se il file risiede nella radice canonica
 * ma la corsia attiva e' un worktree) oppure creare/riutilizzare un progetto esterno.
 */
export function resolveOpenRouteDecision(
	route: ExternalRoute,
	rootEntries: readonly RootEntry[],
	activeLaneIdByProject: (projectId: string) => string | undefined
): OpenDecision | null {
	if (route.rootIndex !== null && rootEntries[route.rootIndex]) {
		const target = rootEntries[route.rootIndex];
		const currentLaneId = activeLaneIdByProject(target.projectId);
		const isWorktreeActive = currentLaneId !== undefined && currentLaneId !== MAIN_LANE_ID;
		// Se il file appartiene alla cartella principale (isMain) ma la corsia attiva e' un worktree,
		// occorre passare alla Principale prima di aprire la scheda per non aprirlo nella cartella worktree.
		const switchToMain = target.isMain && isWorktreeActive;

		return {
			kind: 'project',
			projectId: target.projectId,
			rel: route.rel,
			switchToMain
		};
	}

	if (route.workdir) {
		return {
			kind: 'external',
			workdir: route.workdir,
			rel: route.rel
		};
	}

	return null;
}

class ExternalOpenState {
	notice = $state<string | null>(null);

	clearNotice() {
		this.notice = null;
	}
}

export const externalOpenState = new ExternalOpenState();

/**
 * Ingresso unico per l'apertura di file esterni o percorsi assoluti (EXT-002, EXT-003, EXT-008).
 * Per ogni percorso interroga `external_route` con tutte le radici note di Studio.
 * Se il file appartiene a un progetto aperto lo accoda alle tab di quel progetto;
 * se la corsia attiva e' un worktree e il file e' nella radice canonica, passa alla Principale.
 * Altrimenti crea/riusa un progetto esterno per la sua cartella di lavoro.
 */
export async function openPaths(paths: string[]): Promise<void> {
	if (!paths || paths.length === 0) return;

	const rootEntries = buildRootEntries(projectStore.projects);
	const roots = rootEntries.map((e) => e.path);

	for (const rawPath of paths) {
		const trimmed = rawPath.trim();
		if (!trimmed) continue;
		try {
			const route = await invoke<ExternalRoute>('external_route', {
				path: trimmed,
				roots
			});

			const decision = resolveOpenRouteDecision(
				route,
				rootEntries,
				(id) => projectStore.projects.find((p) => p.id === id)?.lane.laneId
			);

			if (decision?.kind === 'project') {
				if (decision.switchToMain) {
					await laneOrchestrator.switchLane(decision.projectId as ProjectId, MAIN_LANE_ID);
				}
				projectStore.openFile(decision.projectId, decision.rel);
				projectStore.setActive(decision.projectId);
			} else if (decision?.kind === 'external') {
				const id = projectStore.openExternal(decision.workdir);
				if (id) {
					projectStore.openFile(id, decision.rel);
					projectStore.setActive(id);
				}
			}
		} catch (err) {
			const msg = typeof err === 'string' ? err : (err instanceof Error ? err.message : String(err));
			console.warn(`[external-open] Impossibile aprire "${trimmed}":`, msg);
			externalOpenState.notice = m.l10n_state_external_open_failed({ path: trimmed, error: msg });
		}
	}
}
