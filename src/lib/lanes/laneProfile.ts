// Profilo worktree del progetto e consenso una tantum sui file locali
// (Gate R27 / PLAN W10).
//
// Invarianti:
// 1. Nessun file non versionato viene copiato in una corsia senza un consenso
//    esplicito dell'utente: l'allowlist si applica solo se il profilo e'
//    confermato (`confirmedAt`).
// 2. In `lanes.json` finiscono soltanto percorsi relativi e la data del
//    consenso; il contenuto dei file resta dove sta.
// 3. Un candidato gia' mostrato non viene piu' riproposto, accettato o no:
//    le corsie successive riusano la decisione registrata.

import { invoke } from '@tauri-apps/api/core';
import { laneStore } from '$lib/stores/lanes.svelte';
import type { LaneRecord } from '$lib/stores/lanePersistence';
import type { Project } from '$lib/stores/projects.svelte';
import {
	canonicalProjectPath,
	type AgentLane,
	type ProjectId,
	type ProjectWorktreeProfile
} from '$lib/types/lanes';
import {
	detectStack,
	type StackDetection,
	type UntrackedCandidate,
	type WorktreeProfileScan
} from './stackDetector';

export type AllowlistCopyStatus = 'copied' | 'already_present' | 'source_missing' | 'rejected';

/** Esito per file del comando Rust `worktree_apply_allowlist`. */
export interface AllowlistCopyOutcome {
	relativePath: string;
	status: AllowlistCopyStatus;
	bytes: number;
	reason?: string;
}

export interface ProjectProfileReview {
	profile: ProjectWorktreeProfile;
	detection: StackDetection;
	/** Candidati mai sottoposti all'utente per questo progetto. */
	pendingCandidates: UntrackedCandidate[];
	/** `true` quando serve una decisione prima di creare la corsia. */
	needsConsent: boolean;
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function emptyProfile(project: Project, canonical: string): ProjectWorktreeProfile {
	return {
		projectId: project.id as ProjectId,
		canonicalProjectPath: canonicalProjectPath(canonical),
		detectedStacks: [],
		restoreMode: 'none',
		manifests: [],
		generatedDirectories: [],
		nativeCaches: [],
		untrackedFileAllowlist: [],
		reviewedCandidates: [],
		detectedAt: null,
		confirmedAt: null
	};
}

function mergeUnique(current: readonly string[], addition: readonly string[]): string[] {
	const merged = [...current];
	for (const value of addition) {
		const normalized = value.trim();
		if (normalized && !merged.includes(normalized)) merged.push(normalized);
	}
	return merged;
}

/**
 * Analizza il progetto, aggiorna il profilo tecnico persistito e restituisce i
 * candidati ancora da sottoporre. L'allowlist e il consenso gia' registrati non
 * vengono mai sovrascritti dal rilevamento.
 */
export async function reviewProjectProfile(project: Project): Promise<ProjectProfileReview | null> {
	if (!isTauri() || !project.canonicalProjectPath) return null;

	const scan = await invoke<WorktreeProfileScan>('worktree_profile_scan', {
		args: { projectPath: project.canonicalProjectPath }
	});
	const detection = detectStack(scan);

	const existing = laneStore.profileFor(project.id as ProjectId);
	const base = existing ?? emptyProfile(project, project.canonicalProjectPath);
	const profile: ProjectWorktreeProfile = {
		...base,
		canonicalProjectPath: canonicalProjectPath(project.canonicalProjectPath),
		detectedStacks: detection.stacks,
		restoreMode: detection.restoreMode,
		manifests: detection.manifests,
		generatedDirectories: detection.generatedDirectories,
		nativeCaches: detection.nativeCaches,
		detectedAt: Date.now()
	};
	await laneStore.upsertProfile(profile);

	const pendingCandidates = detection.candidates.filter(
		(candidate) => !profile.reviewedCandidates.includes(candidate.relativePath)
	);
	const needsConsent =
		pendingCandidates.length > 0 || (profile.confirmedAt === null && detection.warnings.length > 0);

	return { profile, detection, pendingCandidates, needsConsent };
}

/**
 * Registra la decisione dell'utente. `reviewed` elenca tutto cio' che gli e'
 * stato mostrato (anche quello che ha rifiutato): da qui in avanti non viene
 * piu' chiesto. `accepted` e' il sottoinsieme che puo' essere copiato.
 */
export async function recordAllowlistDecision(
	project: Project,
	decision: { accepted: readonly string[]; reviewed: readonly string[] }
): Promise<ProjectWorktreeProfile | null> {
	if (!project.canonicalProjectPath) return null;
	const existing =
		laneStore.profileFor(project.id as ProjectId) ??
		emptyProfile(project, project.canonicalProjectPath);
	const accepted = decision.accepted.filter((path) => decision.reviewed.includes(path));
	const profile: ProjectWorktreeProfile = {
		...existing,
		untrackedFileAllowlist: mergeUnique(existing.untrackedFileAllowlist, accepted),
		reviewedCandidates: mergeUnique(
			mergeUnique(existing.reviewedCandidates, decision.reviewed),
			accepted
		),
		confirmedAt: Date.now()
	};
	await laneStore.upsertProfile(profile);
	return profile;
}

/**
 * Copia nel worktree della corsia i soli file dell'allowlist confermata.
 * Senza consenso registrato non parte alcuna copia.
 */
export async function applyProfileToLane(
	project: Project,
	lane: AgentLane | LaneRecord
): Promise<AllowlistCopyOutcome[]> {
	if (!isTauri() || !project.canonicalProjectPath || !lane.workspacePath) return [];
	const profile = laneStore.profileFor(project.id as ProjectId);
	if (!profile || profile.confirmedAt === null || profile.untrackedFileAllowlist.length === 0) {
		return [];
	}
	return await invoke<AllowlistCopyOutcome[]>('worktree_apply_allowlist', {
		args: {
			projectPath: project.canonicalProjectPath,
			worktreePath: lane.workspacePath,
			files: [...profile.untrackedFileAllowlist]
		}
	});
}
