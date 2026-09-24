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
import { IconLab, IconPlus } from '$lib/icons';
import { m } from '$lib/paraglide/messages.js';

export interface ProjectLaneActionsOptions {
	onProfileReview?: (review: unknown) => void;
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
		if (existingLane.status === 'archived') {
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
		labPrototypeId: entry.id
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
 * Sincronizza il titolo aggiornato dall'agente Lab con il titolo della corsia
 * o il nome della tessera bozza (contratto §7).
 */
export function syncLabTitle(targetProjectId: string, targetLaneId: string, title: string): void {
	const project = projectStore.projects.find((p) => p.id === targetProjectId);
	if (project?.labDraft || targetLaneId === MAIN_LANE_ID) {
		projectStore.updateProjectTitle(targetProjectId, title);
	}

	void laneStore
		.updateLane(targetProjectId as ProjectId, targetLaneId as LaneId, { title })
		.catch(() => undefined);

	if (
		projectStore.activeProject?.id === targetProjectId &&
		projectStore.activeProject?.lane.laneId === targetLaneId
	) {
		projectStore.activeProject.lane.title = title;
	}
}

/**
 * Chiude ordinatamente una corsia Lab: arresta la sessione, imposta status: 'closed'
 * nell'indice e archivia la corsia (senza git worktree_remove).
 */
export async function closeLabLane(targetProjectId: string, targetLaneId: string): Promise<void> {
	const project = projectStore.projects.find((p) => p.id === targetProjectId);
	const lane = laneStore
		.lanesFor(targetProjectId as ProjectId)
		.find((l) => l.laneId === targetLaneId);
	if (!lane) return;

	const session = sessionRegistry.getLaneSession(targetProjectId, targetLaneId);
	if (session) {
		if (session.isStreaming) {
			await session.abort().catch(() => undefined);
		}
		await session.close().catch(() => undefined);
	}

	if (lane.labPrototypeId && project?.canonicalProjectPath) {
		try {
			await labApi.updateIndex(project.canonicalProjectPath, lane.labPrototypeId, {
				status: 'closed'
			});
		} catch (err) {
			console.warn('Aggiornamento stato chiuso nell\'indice Lab fallito:', err);
		}
	}

	await laneOrchestrator.archiveLane(
		targetProjectId as ProjectId,
		targetLaneId as LaneId,
		'integrated'
	);
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

	// 1. Nuova corsia worktree
	items.push({
		kind: 'item',
		label: m.lab_lane_new_worktree(),
		icon: IconPlus,
		disabled: !isGitRepo,
		hint: !isGitRepo ? m.lab_lane_new_worktree_disabled_no_git() : undefined,
		run: async () => {
			if (!isGitRepo) return;
			try {
				const review = await reviewProjectProfile(project);
				if (review?.needsConsent) {
					options?.onProfileReview?.(review);
					return;
				}
			} catch (err) {
				console.error('Analisi profilo fallita:', err);
			}
			await laneOrchestrator.createNewLane(project);
		}
	});

	// 2. Voci Laboratorio (visibili solo con alpha attiva)
	if (settingsStore.general.labAlphaEnabled && project.canonicalProjectPath) {
		items.push({ kind: 'separator' });
		items.push({
			kind: 'item',
			label: m.lab_lane_new_prototype(),
			icon: IconLab,
			run: async () => {
				try {
					const entry = await labApi.createPrototype(project.canonicalProjectPath);
					await openLabEntry(project.id, entry);
				} catch (err) {
					console.error('Creazione prototipo Lab fallita:', err);
				}
			}
		});

		try {
			const prototypes = await labApi.listIndex(project.canonicalProjectPath);
			if (prototypes.length > 0) {
				items.push({ kind: 'separator' });
				for (const proto of prototypes) {
					const statusLabel =
						proto.status === 'active'
							? m.lab_lane_status_active()
							: m.lab_lane_status_closed();
					items.push({
						kind: 'item',
						label: `${proto.title} (${statusLabel})`,
						icon: IconLab,
						run: async () => {
							await openLabEntry(project.id, proto);
						}
					});
				}
			}
		} catch {
			// Indice non raggiungibile o vuoto: nessuna voce aggiuntiva
		}
	}

	return items;
}
