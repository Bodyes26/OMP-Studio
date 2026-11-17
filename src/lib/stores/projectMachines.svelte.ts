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
	/** Copie confrontate, la prima è quella in uso; solo quelle con stato git noto. */
	copies: Array<{ copy: MachineCopy; git: GitUpstreamStatus }>;
	signature: string;
}

/**
 * Le copie divergono (R-MI-22, Q5)? Si confrontano solo copie con lo stato
 * git già letto: una copia spenta o non ancora interrogata non fa scattare
 * l'avviso, perché non si sa com'è.
 */
export function copyDivergence(project: Project): CopyDivergence | null {
	const view = provenance(project);
	if (view.kind !== 'copies') return null;
	const known = [view.inUse, ...view.others]
		.map((copy) => ({ copy, git: gitOf(copy.project) }))
		.filter((entry): entry is { copy: MachineCopy; git: GitUpstreamStatus } => entry.git !== null);
	if (known.length < 2 || !known[0].copy.inUse) return null;
	const states = known.map(({ git }) => ({
		branch: git.branch,
		head: git.headCommit ?? null,
		changedFiles: git.changedFiles ?? (git.hasUncommitted ? 1 : 0)
	}));
	const reasons = divergenceReasons(states);
	if (reasons.length === 0) return null;
	return { reasons, copies: known, signature: divergenceSignature(states) };
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
	const lines: string[] = [];
	if (divergence.reasons.includes('branch')) {
		for (const { copy, git } of divergence.copies) {
			lines.push(m.copies_diverged_branch({ machine: copy.name, branch: git.branch }));
		}
	} else if (divergence.reasons.includes('commits')) {
		lines.push(m.copies_diverged_commits());
	}
	if (divergence.reasons.includes('uncommitted')) {
		for (const { copy, git } of divergence.copies) {
			const count = git.changedFiles ?? (git.hasUncommitted ? 1 : 0);
			if (count > 0) lines.push(m.copies_diverged_uncommitted({ machine: copy.name, count }));
		}
	}
	return lines;
}
