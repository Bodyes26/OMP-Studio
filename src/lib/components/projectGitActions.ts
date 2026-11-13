/**
 * Dati e comandi per il checkout della Principale dal popover progetti.
 *
 * Il popover non inventa un branch "di lavoro": la fonte e' Git stesso.
 * `git_branch_list` da' i branch locali e quello effettivamente checked out;
 * `fetchWorktreeBranches` (lo stesso helper del menu «Apri branch») dice quali
 * sono occupati da un altro worktree, cosi' una voce occupata resta visibile ma
 * non selezionabile. `git_branch_checkout` e' lo stesso comando del pannello
 * Git: nessuno stash o reset automatico.
 */
import { invoke } from '@tauri-apps/api/core';
import { fetchWorktreeBranches, type WorktreeBranchEntry } from '#lib/lanes/branchFilter.ts';
import { notifyGitStatusRefresh } from '#lib/stores/gitDiff.svelte.ts';

/** Voce letta da `git_branch_list`. */
export interface LocalBranch {
	name: string;
	current: boolean;
}

/** Perche' un branch locale non si puo' selezionare. */
export type BranchBlockReason = 'worktree' | 'lane';

export interface BranchChoice {
	name: string;
	current: boolean;
	blocked: BranchBlockReason | null;
	/** Percorso del worktree che tiene occupato il branch. */
	blockedPath: string | null;
}

export interface BranchPlan {
	/** Branch effettivamente checked out secondo Git. */
	current: string;
	branches: BranchChoice[];
}

/** Motivo per cui il cambio branch e' chiuso adesso (TPR-020). */
export type BranchGateReason = 'agent' | 'syncing' | null;

export function branchGateReason(input: {
	agentBusy: boolean;
	syncing: boolean;
	checkoutPending: boolean;
}): BranchGateReason {
	if (input.agentBusy) return 'agent';
	if (input.syncing || input.checkoutPending) return 'syncing';
	return null;
}

/**
 * Fonde i branch locali con l'occupazione dei worktree. Il branch corrente e i
 * branch liberi restano selezionabili; nessun filtro su main o sul branch
 * principale del repository (TPR-019).
 */
export function buildBranchChoices(
	local: readonly LocalBranch[],
	usage: readonly WorktreeBranchEntry[] | null
): BranchChoice[] {
	const byName = new Map<string, WorktreeBranchEntry>();
	for (const entry of usage ?? []) {
		if (entry.kind === 'local') byName.set(entry.name, entry);
	}

	return local.map((branch) => {
		const used = byName.get(branch.name);
		const blocked: BranchBlockReason | null = !used
			? null
			: used.managedLaneId
				? 'lane'
				: used.checkedOutPath && !used.isPrimaryCheckout
					? 'worktree'
					: null;
		return {
			name: branch.name,
			current: branch.current,
			blocked,
			blockedPath: blocked === 'worktree' ? (used?.checkedOutPath ?? null) : null
		};
	});
}

/**
 * Legge branch e occupazione dei worktree insieme. Se manca una lettura, il
 * selettore mostra l'errore: un'occupazione sconosciuta non diventa un branch
 * apparentemente libero.
 */
export async function loadBranchPlan(projectPath: string): Promise<BranchPlan> {
	const [local, usage] = await Promise.all([
		invoke<LocalBranch[]>('git_branch_list', { projectPath }),
		fetchWorktreeBranches(projectPath)
	]);

	const branches = buildBranchChoices(local, usage?.branches ?? null);
	const current = local.find((branch) => branch.current)?.name ?? '';
	return { current, branches };
}

/** Checkout reale del branch scelto, con la stessa notifica del pannello Git. */
export async function checkoutBranch(projectPath: string, name: string): Promise<void> {
	await invoke('git_branch_checkout', { projectPath, name });
	notifyGitStatusRefresh(projectPath);
}
