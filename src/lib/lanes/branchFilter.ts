// Filtro e tipi per i branch mostrati nel menu "Apri branch".
// Il modulo e' puro: nessun import di icone o componenti Svelte,
// per poter essere testato negli unit test di Node.

import type { AgentLane } from '#lib/types/lanes.ts';
import type { LaneRecord } from '#lib/stores/lanePersistence.ts';
import { invoke } from '@tauri-apps/api/core';

export interface WorktreeBranchEntry {
	name: string;
	kind: 'local' | 'remote';
	checkedOutPath: string | null;
	isPrimaryCheckout: boolean;
	managedLaneId: string | null;
}

export interface WorktreeListBranchesOutcome {
	primaryBranch: string;
	branches: WorktreeBranchEntry[];
}

export interface BranchesMenuState {
	loading: boolean;
	error: string | null;
	data: WorktreeListBranchesOutcome | null;
}

/**
 * Filtra i branch visualizzabili nel menu "Apri branch":
 * - esclude HEAD e origin/HEAD
 * - esclude il branch correntemente checked out in Principale
 * - esclude il branch principale (target) del repository (es. main)
 * - esclude branch gia' associati a un'altra corsia Studio aperta
 * - include branch locali disponibili
 * - include branch remoti non ancora tracciati localmente (es. origin/feat-c)
 * - include worktree esterni adottabili in place
 */
export function filterOpenableBranches(
	outcome: WorktreeListBranchesOutcome,
	openLanes: ReadonlyArray<AgentLane | LaneRecord>
): WorktreeBranchEntry[] {
	const openBranches = new Set<string>();
	for (const lane of openLanes) {
		if (lane.status !== 'archived' && lane.status !== 'closed' && lane.branch) {
			openBranches.add(lane.branch);
		}
	}

	const primary = outcome.primaryBranch.trim();
	const primaryRemote = `origin/${primary}`;

	return outcome.branches.filter((b) => {
		if (b.name === 'HEAD' || b.name === 'origin/HEAD' || b.name.endsWith('/HEAD')) {
			return false;
		}
		if (b.isPrimaryCheckout) return false;
		if (b.name === primary || b.name === primaryRemote) return false;
		if (b.managedLaneId) return false;
		const localName =
			b.kind === 'remote' && b.name.startsWith('origin/')
				? b.name.slice('origin/'.length)
				: b.name;
		if (openBranches.has(localName) || openBranches.has(b.name)) return false;
		return true;
	});
}

export async function fetchWorktreeBranches(
	projectPath: string
): Promise<WorktreeListBranchesOutcome> {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
		return { primaryBranch: 'main', branches: [] };
	}
	return await invoke<WorktreeListBranchesOutcome>('worktree_list_branches', {
		args: { projectPath }
	});
}
