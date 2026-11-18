/**
 * Dove vive un progetto, visto da questa finestra (R-MI-19, R-MI-22, R-MI-23).
 *
 * Tessera, popover, selettore e striscia sopra il composer leggono da qui le
 * stesse copie, con lo stesso nome di macchina e lo stesso stato: se ognuno
 * li ricavasse per conto suo, la tessera direbbe «spento» e il pannello no.
 */

import { m } from '#lib/paraglide/messages.js';
import { LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { projectStore, normalizeProjectPath, type Project } from './projects.svelte';
import { projectOrder } from './projectOrder.svelte';
import { githubStore, type GitUpstreamStatus } from './github.svelte';
import { divergenceReasons, divergenceSignature, inUseCopy, type CopyMark, type DivergenceReason } from './projectCopies.ts';
import { copySyncStore, type BranchSync } from './copySync.svelte';

export interface MachineCopy {
	project: Project;
	machineId: string;
	name: string;
	local: boolean;
	online: boolean;
	inUse: boolean;
	mark: CopyMark;
}

export type ProvenanceKind = 'local' | 'remote' | 'offline' | 'copies';

export interface Provenance {
	kind: ProvenanceKind;
	/** Copie in ordine stabile: questa macchina, poi le altre per nome. */
	copies: MachineCopy[];
	inUse: MachineCopy;
	others: MachineCopy[];
	marks: CopyMark[];
}

export function machineName(machineId: string | undefined): string {
	if (!machineId || machineId === LOCAL_MACHINE) return m.machine_this_computer();
	return linkStore.machineFor(machineId)?.name ?? machineId;
}

function machineOnline(machineId: string | undefined): boolean {
	if (!machineId || machineId === LOCAL_MACHINE) return true;
	return linkStore.machineFor(machineId)?.online ?? false;
}

/** Tutte le copie del progetto, comprese quelle che la barra non mostra. */
export function projectGroup(project: Project): Project[] {
	return [project, ...projectOrder.copiesOf(project)];
}

export function provenance(project: Project): Provenance {
	const group = projectGroup(project);
	// La copia in uso è quella mostrata, se il gruppo lo è, altrimenti
	// l'ultima usata: la stessa regola della tessera (`projectOrder.unified`).
	const used = group.find((p) => p.id === projectStore.activeId) ?? inUseCopy(group) ?? project;
	const copies = group
		.map((copy): MachineCopy => {
			const machineId = copy.machineId ?? LOCAL_MACHINE;
			const online = machineOnline(machineId);
			const inUse = copy.id === used.id;
			return {
				project: copy,
				machineId,
				name: machineName(machineId),
				local: machineId === LOCAL_MACHINE,
				online,
				inUse,
				mark: !online ? 'off' : inUse ? 'use' : 'on'
			};
		})
		.sort((a, b) => Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
	const inUse = copies.find((copy) => copy.inUse) ?? copies[0];
	const kind: ProvenanceKind = copies.length > 1
		? 'copies'
		: inUse.local
			? 'local'
			: inUse.online
				? 'remote'
				: 'offline';
	return {
		kind,
		copies,
		inUse,
		others: copies.filter((copy) => copy !== inUse),
		marks: copies.map((copy) => copy.mark)
	};
}

function gitOf(project: Project): GitUpstreamStatus | null {
	const path = project.canonicalProjectPath;
	if (!path) return null;
	const status = githubStore.upstreamByPath[normalizeProjectPath(path).toLowerCase()];
	return status?.isGit ? status : null;
}

export interface CopyDivergence {
	reasons: DivergenceReason[];
	/** Copie con stato git noto, la prima è quella in uso. */
	copies: Array<{ copy: MachineCopy; git: GitUpstreamStatus }>;
	/** Branch con commit propri su entrambe le copie (R-MI-26). */
	branches: string[];
	signature: string;
}

/**
 * Le copie divergono (R-MI-22, regola F25)? I commit si confrontano dalla
 * copia di questa macchina, l'unica di cui questa finestra legge i commit
 * delle gemelle; le modifiche non committate si contano su ogni copia con lo
 * stato git già letto. Una copia spenta o non ancora interrogata non fa
 * scattare l'avviso, perché non si sa com'è.
 */
export function copyDivergence(project: Project): CopyDivergence | null {
	const view = provenance(project);
	if (view.kind !== 'copies') return null;
	const known = [view.inUse, ...view.others]
		.map((copy) => ({ copy, git: gitOf(copy.project) }))
		.filter((entry): entry is { copy: MachineCopy; git: GitUpstreamStatus } => entry.git !== null);
	const local = view.copies.find((copy) => copy.local);
	const branches = local ? copySyncStore.divergedBranches(local.project) : [];
	const states = known.map(({ git }) => ({
		branch: git.branch,
		head: git.headCommit ?? null,
		changedFiles: git.changedFiles ?? (git.hasUncommitted ? 1 : 0)
	}));
	const reasons = divergenceReasons(states, branches);
	if (reasons.length === 0) return null;
	return { reasons, copies: known, branches, signature: divergenceSignature(states, branches) };
}

/**
 * Branch della copia di questa macchina indietro rispetto a una gemella che
 * aspettano la cartella libera per avanzare (R-MI-27, «da aggiornare»).
 */
export function copyPending(project: Project): BranchSync[] {
	const view = provenance(project);
	if (view.kind !== 'copies') return [];
	const local = view.copies.find((copy) => copy.local);
	return local ? copySyncStore.pendingBranches(local.project) : [];
}

/** Rilegge lo stato git di tutte le copie: la barra lo aggiorna solo per la tessera attiva. */
export function refreshCopiesGit(project: Project, force = false): void {
	for (const copy of projectGroup(project)) {
		const path = copy.canonicalProjectPath;
		if (path && machineOnline(copy.machineId)) void githubStore.loadUpstreamStatus(path, force);
	}
}

/** Righe che spiegano la divergenza, per pannello e striscia (R-MI-22). */
export function divergenceSummary(divergence: CopyDivergence): string[] {
	const lines = divergence.branches.map((branch) => m.copies_diverged_commits({ branch }));
	if (divergence.reasons.includes('uncommitted')) {
		for (const { copy, git } of divergence.copies) {
			const count = git.changedFiles ?? (git.hasUncommitted ? 1 : 0);
			if (count > 0) lines.push(m.copies_diverged_uncommitted({ machine: copy.name, count }));
		}
	}
	return lines;
}

/** Righe «da aggiornare» per il pannello del progetto (R-MI-27). */
export function pendingSummary(pending: readonly BranchSync[]): string[] {
	return pending.map((branch) => branch.reason === 'dirty'
		? m.copies_pending_dirty({ branch: branch.name, count: branch.behind })
		: branch.reason === 'busy'
			? m.copies_pending_busy({ branch: branch.name, count: branch.behind })
			: m.copies_pending_failed({ branch: branch.name, error: branch.reason ?? '' }));
}
