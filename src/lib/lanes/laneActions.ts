// Azioni sulle corsie e gestione del ciclo di vita dei prototipi Laboratorio (contratto §7).
// Unica sorgente di verita' per le azioni corsia usate da ProjectPopover e LaneStrip (+ ▾).

import { laneStore } from '$lib/stores/lanes.svelte';
import { projectStore, type Project } from '$lib/stores/projects.svelte';
import { laneOrchestrator } from './laneOrchestrator.svelte';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import { labApi } from '$lib/lab/api';
import type { LabIndexEntry } from '$lib/lab/types';
import { settingsStore } from '$lib/stores/settings.svelte';
import { gitDiffStore } from '$lib/stores/gitDiff.svelte';
import { reviewProjectProfile } from './laneProfile';
import {
	laneId,
	MAIN_LANE_ID,
	projectId,
	workspacePath,
	type LaneId,
	type ProjectId
} from '$lib/types/lanes';
import type { LaneRecord } from '$lib/stores/lanePersistence';
import type { ContextMenuEntry } from '$lib/contextMenu.svelte';
import { IconGitBranch, IconLab, IconTrash } from '$lib/icons';
import { m } from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime.js';
import { message } from '@tauri-apps/plugin-dialog';
import { listClosedLanes, reopenLane, type ClosedLaneEntry } from './laneLifecycle';

export interface ProjectLaneActionsOptions {
	onCreateWorktree?: () => void | Promise<void>;
	onCreatePrototype?: () => void | Promise<void>;
	onReopenLane?: (entry: ClosedLaneEntry) => void | Promise<void>;
	onRequestDelete?: (entry: ClosedLaneEntry) => void | Promise<void>;
	onProfileReview?: (review: unknown) => void;
}

/**
 * Formatta un timestamp in data relativa breve ("adesso", "2m fa", "3h fa", "ieri", "25 set")
 * usando Intl.RelativeTimeFormat e la lingua corrente.
 */
export function formatRelativeDate(timestamp: number): string {
	const locale = getLocale?.() ?? 'it';
	const now = Date.now();
	const diffMs = timestamp - now;
	const diffSec = Math.round(diffMs / 1000);
	const diffMin = Math.round(diffSec / 60);
	const diffHours = Math.round(diffMin / 60);
	const diffDays = Math.round(diffHours / 24);

	try {
		const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
		// `format(0, 'second')` con numeric auto e' "ora"/"now"; con 'minute'
		// diventerebbe "questo minuto", che nessuno scriverebbe.
		if (Math.abs(diffMin) < 1) {
			return rtf.format(0, 'second');
		}
		if (Math.abs(diffHours) < 1) {
			return rtf.format(diffMin, 'minute');
		}
		if (Math.abs(diffDays) < 1) {
			return rtf.format(diffHours, 'hour');
		}
		if (Math.abs(diffDays) < 7) {
			return rtf.format(diffDays, 'day');
		}
		const date = new Date(timestamp);
		return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
	} catch {
		return new Date(timestamp).toLocaleDateString();
	}
}

/**
 * Flusso condiviso di creazione worktree per LaneStrip e ProjectPopover:
 * controlla il profilo tecnico, richiede il consenso una tantum se necessario,
 * altrimenti crea la nuova corsia tramite laneOrchestrator.
 */
export async function startCreateWorktreeFlow(
	project: Project,
	callbacks?: {
		onProfileReview?: (review: unknown) => void;
	}
): Promise<void> {
	try {
		const review = await reviewProjectProfile(project);
		if (review?.needsConsent) {
			callbacks?.onProfileReview?.(review);
			return;
		}
	} catch (err) {
		console.error('Analisi profilo fallita:', err);
	}
	await laneOrchestrator.createNewLane(project);
}

/**
 * Apre una voce di prototipo Lab:
 * - se ownerProjectId e' null, apre o attiva la tessera bozza libera;
 * - altrimenti crea o attiva la corsia Lab corrispondente nel progetto.
 */
export async function openLabEntry(
	ownerProjectId: string | null,
	entry: LabIndexEntry
): Promise<void> {
	if (ownerProjectId === null) {
		// Bozza libera (contratto §7 e §10)
		projectStore.openDraft(entry);
		if (entry.status === 'closed') {
			try {
				await labApi.updateIndex(null, entry.id, { status: 'active' });
			} catch (err) {
				console.warn('Riapertura stato bozza fallita:', err);
			}
		}
		return;
	}

	const project = projectStore.projects.find((p) => p.id === ownerProjectId);
	if (!project) return;

	const targetLaneId = laneId(`lab-${entry.id}`);
	projectStore.setActive(ownerProjectId);

	const existingLane = laneStore
		.lanesFor(ownerProjectId as ProjectId)
		.find((l) => l.laneId === targetLaneId);

	if (existingLane) {
		if (existingLane.status === 'archived' || existingLane.status === 'closed') {
			// Riapertura di un prototipo chiuso
			if (entry.status === 'closed') {
				try {
					await labApi.updateIndex(project.canonicalProjectPath, entry.id, { status: 'active' });
				} catch (err) {
					console.warn('Riapertura stato prototipo nell\'indice fallita:', err);
				}
			}
			await laneStore.updateLane(ownerProjectId as ProjectId, targetLaneId, {
				status: 'active',
				archiveReason: null,
				archivedAt: null,
				closedAt: null,
				title: entry.title
			});
		}
		await laneOrchestrator.switchLane(ownerProjectId as ProjectId, targetLaneId);
		return;
	}

	// Creazione nuovo record corsia Lab di progetto (contratto §7)
	const record: LaneRecord = {
		projectId: ownerProjectId as ProjectId,
		laneId: targetLaneId,
		title: entry.title,
		workspacePath: workspacePath(entry.workspacePath),
		branch: null,
		baseCommit: null,
		headCommit: null,
		targetBranch: null,
		createdAt: Date.now(),
		status: 'active',
		origin: 'manual',
		agentState: 'idle',
		openFiles: [],
		activeFile: null,
		surface: 'gui',
		sessionId: null,
		recoveryState: 'registered',
		archiveReason: null,
		archivedAt: null,
		recoveredAt: null,
		kind: 'lab',
		labPrototypeId: entry.id,
		closedAt: null,
		titleLocked: false
	};

	if (entry.status === 'closed') {
		try {
			await labApi.updateIndex(project.canonicalProjectPath, entry.id, { status: 'active' });
		} catch (err) {
			console.warn('Riapertura stato prototipo nell\'indice fallita:', err);
		}
	}

	await laneStore.upsertLane(record);
	await laneOrchestrator.switchLane(ownerProjectId as ProjectId, targetLaneId);
}

/**
 * Sincronizza il titolo aggiornato per un prototipo Lab con il titolo della corsia
 * o il nome della tessera bozza (contratto §7).
 */
export function syncLabTitle(
	targetProjectId: string,
	targetLaneId: string,
	title: string,
	options?: { titleLocked?: boolean }
): void {
	const project = projectStore.projects.find((p) => p.id === targetProjectId);
	if (project?.labDraft || targetLaneId === MAIN_LANE_ID) {
		projectStore.updateProjectTitle(targetProjectId, title);
	}

	const patch: { title: string; titleLocked?: boolean } = { title };
	if (options?.titleLocked !== undefined) {
		patch.titleLocked = options.titleLocked;
	}

	void laneStore
		.updateLane(targetProjectId as ProjectId, targetLaneId as LaneId, patch)
		.catch(() => undefined);

	if (
		projectStore.activeProject?.id === targetProjectId &&
		projectStore.activeProject?.lane.laneId === targetLaneId
	) {
		projectStore.activeProject.lane.title = title;
		if (options?.titleLocked !== undefined) {
			projectStore.activeProject.lane.titleLocked = options.titleLocked;
		}
	}
}

/**
 * Associa una bozza libera all'indice di un progetto reale aperto (contratto §7):
 * sposta la voce nell'indice del progetto, chiude la tessera bozza e apre il prototipo
 * come corsia Lab del progetto target.
 */
export async function associateDraftToProject(
	draftProject: Project,
	targetProjectPath: string
): Promise<void> {
	if (!draftProject.labDraft?.prototypeId) return;
	const prototypeId = draftProject.labDraft.prototypeId;

	const targetProject = projectStore.projects.find(
		(p) => p.canonicalProjectPath === targetProjectPath
	);
	if (!targetProject) return;

	const updatedEntry = await labApi.associate(prototypeId, targetProjectPath);
	projectStore.closeProject(draftProject.id);
	await openLabEntry(targetProject.id, updatedEntry);
	projectStore.setActive(targetProject.id);
}

/** Segnala un'eliminazione di prototipo fallita: il menu o il popover che l'ha
 *  avviata e' gia' chiuso, quindi serve un avviso che non dipenda da loro. */
export async function reportLabDeleteFailure(error: string): Promise<void> {
	await message(m.lab_delete_failed({ error }), { kind: 'error' }).catch(() => {
		console.error('Eliminazione prototipo fallita:', error);
	});
}

/**
 * Restituisce le azioni corsia mostrate nel popover di progetto e nel menu `+ ▾`
 * della LaneStrip (contratto §7).
 */
export async function projectLaneActions(
	project: Project,
	options?: ProjectLaneActionsOptions
): Promise<ContextMenuEntry[]> {
	const items: ContextMenuEntry[] = [];

	const isGitRepo =
		Boolean(project.canonicalProjectPath) &&
		!project.labDraft &&
		gitDiffStore.forPath(project.lane.workspacePath ?? project.canonicalProjectPath ?? '')
			.isRepo !== false;

	// 1. Nuovo worktree
	items.push({
		kind: 'item',
		label: m.lanestrip_new_worktree(),
		icon: IconGitBranch,
		disabled: !isGitRepo,
		hint: !isGitRepo ? m.lab_lane_new_worktree_disabled_no_git() : undefined,
		run: async () => {
			if (!isGitRepo) return;
			if (options?.onCreateWorktree) {
				await options.onCreateWorktree();
				return;
			}
			await startCreateWorktreeFlow(project, { onProfileReview: options?.onProfileReview });
		}
	});

	// 2. Nuovo prototipo (visibile solo se alpha attiva)
	if (settingsStore.general.labAlphaEnabled && project.canonicalProjectPath) {
		items.push({
			kind: 'item',
			label: m.lanestrip_new_prototype(),
			icon: IconLab,
			run: async () => {
				if (options?.onCreatePrototype) {
					await options.onCreatePrototype();
					return;
				}
				try {
					const entry = await labApi.createPrototype(project.canonicalProjectPath);
					await openLabEntry(project.id, entry);
				} catch (err) {
					console.error('Creazione prototipo Lab fallita:', err);
				}
			}
		});
	}

	// 3. Corsie chiuse (riapertura unificata Git + Lab)
	try {
		const closed = await listClosedLanes(project);
		if (closed.length > 0) {
			items.push({ kind: 'separator' });
			items.push({ kind: 'header', label: m.lanestrip_reopen_header() });

			for (const entry of closed) {
				items.push({
					kind: 'item',
					label: entry.title,
					icon: entry.kind === 'lab' ? IconLab : IconGitBranch,
					detail: formatRelativeDate(entry.closedAt),
					secondaryAction: options?.onRequestDelete
						? {
								label:
									entry.kind === 'lab'
										? m.lanestrip_action_delete_prototype()
										: m.lanestrip_action_delete_worktree(),
								icon: IconTrash,
								run: () => options.onRequestDelete!(entry)
							}
						: undefined,
					run: async () => {
						if (options?.onReopenLane) {
							await options.onReopenLane(entry);
							return;
						}
						await reopenLane(project, entry);
					}
				});
			}
		}
	} catch (err) {
		console.warn('Lettura corsie chiuse fallita per il menu:', err);
	}

	return items;
}
