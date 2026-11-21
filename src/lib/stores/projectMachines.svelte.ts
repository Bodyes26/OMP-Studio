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
import { divergenceReasons, divergenceSignature, inUseCopy, type CaseConflict, type CopyMark, type DivergenceReason } from './projectCopies.ts';
import { copySyncStore, type BranchSync } from './copySync.svelte';
import { copyKeyOf, projectLinks } from './projectLinks.svelte.ts';

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
	/** Branch che differiscono solo per maiuscole fra le copie (R-MI-35). */
	caseConflicts: CaseConflict[];
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
	const caseConflicts = local ? copySyncStore.caseConflicts(local.project) : [];
	const states = known.map(({ git }) => ({
		branch: git.branch,
		head: git.headCommit ?? null,
		changedFiles: git.changedFiles ?? (git.hasUncommitted ? 1 : 0)
	}));
	const reasons = divergenceReasons(states, branches, caseConflicts);
	if (reasons.length === 0) return null;
	return { reasons, copies: known, branches, caseConflicts, signature: divergenceSignature(states, branches, caseConflicts) };
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
	for (const conflict of divergence.caseConflicts) {
		lines.push(m.copies_diverged_case({ branch: conflict.branch, other: conflict.other }));
	}
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
	return pending.map((branch) => {
		const values = { branch: branch.name, count: branch.behind };
		switch (branch.reason) {
			case 'dirty': return m.copies_pending_dirty(values);
			case 'busy': return m.copies_pending_busy(values);
			// Un worktree con HEAD staccato: avanzare la branch lo lascerebbe indietro.
			case 'detached': return m.copies_pending_detached(values);
			default: return m.copies_pending_failed({ branch: branch.name, error: branch.reason ?? '' });
		}
	});
}

/** Una copia di un'altra macchina con la stessa storia ma senza origin (R-MI-32). */
export interface LinkCandidate {
	root: string;
	mine: Project;
	other: Project;
}

/**
 * Copie senza origin con lo stesso primo commit di questa, su un'altra
 * macchina, non ancora unite e non già rifiutate: può essere lo stesso
 * progetto o un fork, lo decide l'utente (R-MI-32).
 */
export function linkCandidates(project: Project): LinkCandidate[] {
	const group = projectGroup(project);
	const inGroup = new Set(group.map((copy) => copy.id));
	const result: LinkCandidate[] = [];
	const seen = new Set<string>();
	for (const mine of group) {
		const git = gitOf(mine);
		if (!git?.rootCommit || git.repoSlug) continue;
		const mineMachine = mine.machineId ?? LOCAL_MACHINE;
		for (const other of projectOrder.list) {
			if (inGroup.has(other.id) || seen.has(other.id) || (other.machineId ?? LOCAL_MACHINE) === mineMachine) continue;
			const otherGit = gitOf(other);
			if (!otherGit || otherGit.repoSlug || otherGit.rootCommit !== git.rootCommit) continue;
			if (projectLinks.isRefused(copyKeyOf(mine), copyKeyOf(other))) continue;
			seen.add(other.id);
			result.push({ root: git.rootCommit, mine, other });
		}
	}
	return result;
}

/** Copia senza origin con lo stesso primo commit e una decisione gia' presa. */
export interface DecidedCopy extends LinkCandidate {
	same: boolean;
}

/**
 * Decisioni gia' prese sulle copie di questo progetto, per poterle cambiare
 * dal pannello su qualunque macchina (R-MI-44).
 */
export function decidedCopies(project: Project): DecidedCopy[] {
	const result: DecidedCopy[] = [];
	const seen = new Set<string>();
	for (const mine of projectGroup(project)) {
		const git = gitOf(mine);
		if (!git?.rootCommit || git.repoSlug) continue;
		const mineMachine = mine.machineId ?? LOCAL_MACHINE;
		for (const other of projectOrder.list) {
			if (other.id === mine.id || seen.has(other.id) || (other.machineId ?? LOCAL_MACHINE) === mineMachine) continue;
			const otherGit = gitOf(other);
			if (!otherGit || otherGit.repoSlug || otherGit.rootCommit !== git.rootCommit) continue;
			const decision = projectLinks.decisionFor(copyKeyOf(mine), copyKeyOf(other));
			if (!decision) continue;
			seen.add(other.id);
			result.push({ root: git.rootCommit, mine, other, same: decision.same });
		}
	}
	return result;
}

/** Una copia con l'origin col nome di prima della rinomina su GitHub (R-MI-32). */
export interface OriginUpdate {
	copy: Project;
	slug: string;
}

export function originUpdates(project: Project): OriginUpdate[] {
	const result: OriginUpdate[] = [];
	for (const copy of projectGroup(project)) {
		const slug = gitOf(copy)?.repoSlug?.toLowerCase();
		const current = slug ? projectLinks.canonical[slug] : null;
		if (slug && current && current !== slug) result.push({ copy, slug: current });
	}
	return result;
}
