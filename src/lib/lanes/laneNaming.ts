// Gestione denominazione corsie tramite modello smol e rinomina manuale.
//
// Regole architetturali:
// 1. Smol nomina automaticamente la corsia al primo prompt utile se il titolo e' ancora
//    un segnaposto ("Worktree N" o "Nuovo prototipo") e non e' stato bloccato dall'utente.
// 2. La rinomina manuale imposta `titleLocked: true`: nessun automatismo potra' sovrascrivere
//    il titolo scelto esplicitamente.
// 3. I prototipi preesistenti con titolo non bloccato superiore a 24 caratteri vengono
//    sintetizzati una tantum a partire dal summary all'apertura della corsia.

import { invoke } from '@tauri-apps/api/core';
import { projectStore } from '$lib/stores/projects.svelte';
import { laneStore } from '$lib/stores/lanes.svelte';
import { labApi } from '$lib/lab/api';
import { syncLabTitle } from '$lib/lanes/laneActions';
import { MAIN_LANE_ID, type LaneId, type ProjectId } from '$lib/types/lanes';

export { LANE_TITLE_MAX, isPlaceholderLaneTitle } from './laneTitle';
import { LANE_TITLE_MAX, isPlaceholderLaneTitle } from './laneTitle';

/** Set di chiavi in corso di generazione per evitare chiamate concorrenti duplicate. */
const inFlightNaming = new Set<string>();

/** Set di prototipi gia' verificati per il troncamento dei titoli lunghi all'apertura. */
const checkedLongPrototypes = new Set<string>();

/**
 * Genera un nome sintetico tramite modello smol al primo prompt dell'utente
 * se la corsia ha ancora un titolo segnaposto e non e' bloccata.
 * Operazione fire-and-forget; in caso di errore o timeout fallisce silenziosamente.
 */
export function nameLaneFromPrompt(projectId: string, laneId: string, prompt: string): void {
	const text = prompt.trim();
	if (!text) return;

	const project = projectStore.projects.find((p) => p.id === projectId);
	const lane =
		laneStore.lanes.find((l) => l.projectId === projectId && l.laneId === laneId) ??
		(project?.lane.laneId === laneId ? project.lane : null);

	if (!lane) return;
	if (lane.titleLocked) return;

	const isLab = lane.kind === 'lab' || Boolean(project?.labDraft);
	const kind: 'git' | 'lab' = isLab ? 'lab' : 'git';

	// La corsia principale dei repository Git non viene mai rinominata da smol
	if (kind === 'git' && laneId === MAIN_LANE_ID) return;

	if (!isPlaceholderLaneTitle(lane.title, kind)) return;

	const inFlightKey = `${projectId}:${laneId}`;
	if (inFlightNaming.has(inFlightKey)) return;
	inFlightNaming.add(inFlightKey);

	void (async () => {
		try {
			const existingNames = laneStore.lanes
				.filter((l) => l.projectId === projectId && l.laneId !== laneId)
				.map((l) => l.title.trim())
				.filter(Boolean);

			if (isLab) {
				try {
					const labIndex = await labApi.listIndex(project?.canonicalProjectPath ?? null);
					for (const entry of labIndex) {
						const t = entry.title.trim();
						if (t && !existingNames.includes(t)) {
							existingNames.push(t);
						}
					}
				} catch {
					// Fallimento silenzioso nella lettura dell'indice
				}
			}

			const generatedName = await invoke<string | null>('generate_lane_name', {
				kind,
				prompt: text,
				existingNames
			});

			if (!generatedName) return;

			// Controllo di sicurezza: verifica che l'utente non abbia rinominato manualmente nel frattempo
			const currentLane =
				laneStore.lanes.find((l) => l.projectId === projectId && l.laneId === laneId) ??
				(project?.lane.laneId === laneId ? project.lane : null);
			if (currentLane?.titleLocked) return;

			if (kind === 'git') {
				await laneStore.updateLane(projectId as ProjectId, laneId as LaneId, {
					title: generatedName
				});
				if (
					projectStore.activeProject?.id === projectId &&
					projectStore.activeProject.lane.laneId === laneId
				) {
					projectStore.activeProject.lane.title = generatedName;
				}
			} else {
				const prototypeId = lane.labPrototypeId ?? project?.labDraft?.prototypeId;
				if (prototypeId) {
					try {
						await labApi.updateIndex(project?.canonicalProjectPath ?? null, prototypeId, {
							title: generatedName
						});
					} catch (err) {
						console.warn('Aggiornamento titolo indice Lab fallito:', err);
					}
				}
				syncLabTitle(projectId, laneId, generatedName);
			}
		} catch (err) {
			console.warn('Generazione nome corsia fallita:', err);
		} finally {
			inFlightNaming.delete(inFlightKey);
		}
	})();
}

/**
 * Se un prototipo esistente ha un titolo sbloccato che supera 24 caratteri,
 * sintetizza un nuovo nome compatto tramite smol a partire dal summary (o titolo).
 */
export async function nameExistingPrototypeIfLong(
	projectId: string,
	laneId: string
): Promise<void> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	const lane =
		laneStore.lanes.find((l) => l.projectId === projectId && l.laneId === laneId) ??
		(project?.lane.laneId === laneId ? project.lane : null);

	const isLab = lane?.kind === 'lab' || Boolean(project?.labDraft);
	if (!isLab) return;

	const prototypeId = lane?.labPrototypeId ?? project?.labDraft?.prototypeId;
	if (!prototypeId) return;

	const cacheKey = `${projectId}:${prototypeId}`;
	if (checkedLongPrototypes.has(cacheKey)) return;
	checkedLongPrototypes.add(cacheKey);

	if (lane?.titleLocked) return;

	try {
		const index = await labApi.listIndex(project?.canonicalProjectPath ?? null);
		const entry = index.find((e) => e.id === prototypeId);
		if (!entry || entry.titleLocked) return;

		const currentTitle = entry.title?.trim() || lane?.title?.trim() || '';
		if (currentTitle.length <= 24) return;

		const prompt = entry.summary?.trim() || currentTitle;
		if (!prompt) return;

		const existingNames = index
			.filter((e) => e.id !== prototypeId)
			.map((e) => e.title.trim())
			.filter(Boolean);

		const generatedName = await invoke<string | null>('generate_lane_name', {
			kind: 'lab',
			prompt,
			existingNames
		});

		if (generatedName) {
			const freshIndex = await labApi.listIndex(project?.canonicalProjectPath ?? null);
			const freshEntry = freshIndex.find((e) => e.id === prototypeId);
			if (freshEntry?.titleLocked) return;

			await labApi.updateIndex(project?.canonicalProjectPath ?? null, prototypeId, {
				title: generatedName
			});
			syncLabTitle(projectId, laneId, generatedName);
		}
	} catch (err) {
		console.warn('nameExistingPrototypeIfLong fallita:', err);
	}
}

/**
 * Rinomina manualmente una corsia, applica il limite di caratteri e imposta titleLocked: true.
 * Per i prototipi Lab aggiorna anche l'indice e, se bozza libera, il titolo del progetto.
 */
export async function renameLane(
	projectId: ProjectId,
	laneId: LaneId,
	rawTitle: string
): Promise<void> {
	const trimmed = rawTitle.trim();
	if (!trimmed) return;
	const title = trimmed.length > LANE_TITLE_MAX ? trimmed.slice(0, LANE_TITLE_MAX) : trimmed;

	const project = projectStore.projects.find((p) => p.id === projectId);
	const lane =
		laneStore.lanes.find((l) => l.projectId === projectId && l.laneId === laneId) ??
		(project?.lane.laneId === laneId ? project.lane : null);

	const isLab = lane?.kind === 'lab' || Boolean(project?.labDraft);

	// Imposta titleLocked: true su corsia e store
	await laneStore.updateLane(projectId, laneId, {
		title,
		titleLocked: true
	});

	if (
		projectStore.activeProject?.id === projectId &&
		projectStore.activeProject.lane.laneId === laneId
	) {
		projectStore.activeProject.lane.title = title;
		projectStore.activeProject.lane.titleLocked = true;
	}

	if (isLab) {
		const prototypeId = lane?.labPrototypeId ?? project?.labDraft?.prototypeId;
		if (prototypeId) {
			try {
				await labApi.updateIndex(project?.canonicalProjectPath ?? null, prototypeId, {
					title,
					titleLocked: true
				});
			} catch (err) {
				console.warn('Aggiornamento titolo e blocco indice Lab fallito:', err);
			}
		}
		if (project?.labDraft || laneId === MAIN_LANE_ID) {
			projectStore.updateProjectTitle(projectId, title);
		}
	}
}
