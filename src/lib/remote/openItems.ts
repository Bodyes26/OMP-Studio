/**
 * Apertura, qui, di un file o di un'anteprima che è già aperta su un'altra
 * macchina (IMP-011).
 *
 * Non rifà l'apertura là: sceglie la copia e la corsia giuste e mostra lo
 * stesso elemento in questa finestra. I percorsi sono quelli relativi al
 * progetto, pubblicati dalla macchina che li ha aperti: non si convertono i
 * separatori, perché la lettura passa comunque dal backend di chi possiede
 * il progetto (R-MI-08).
 */

import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
import { laneSurfaceStore } from '#lib/stores/laneSurfaces.svelte.ts';
import { provenance } from '#lib/stores/projectMachines.svelte.ts';
import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
import type { LaneId, ProjectId } from '#lib/types/lanes.ts';
import type { OpenItemsLane } from '#lib/backend/host.ts';

/**
 * Una copia con qualcosa aperto altrove; `lanes` e' gia' filtrato da chi lo
 * mostra. L'anteprima di una copia mostrata qui non si ripete: il server
 * loopback dell'altra macchina non serve questa finestra, quindi di quella
 * copia resta solo la riga dell'anteprima (IMP-011).
 */
export interface ElsewhereOpenItems {
	copy: { project: Project; name: string };
	lanes: OpenItemsLane[];
}

/**
 * Le aperture delle altre copie raggiungibili, la stessa lista per il
 * conteggio dell'anteprima e per il blocco «Gia' aperto» (S3-link-front-28):
 * prima il conteggio includeva file che il blocco non mostrava.
 */
export function elsewhereOpenItems(project: Project): ElsewhereOpenItems[] {
	return provenance(project)
		.copies.filter((copy) => copy.online && !(copy.local && copy.project.id === projectStore.activeId))
		.map((copy) => {
			const lanes = projectStore.remoteOpenItems[copy.project.id] ?? [];
			const visibleHere = copy.project.id === projectStore.activeId;
			return {
				copy,
				lanes: visibleHere
					? lanes
						.filter((lane) => Boolean(lane.previewFile))
						.map((lane) => ({ ...lane, openFiles: [] }))
					: lanes
			};
		})
		.filter((entry) => entry.lanes.length > 0);
}

/** Passa alla copia e alla corsia indicate. */
async function enterLane(project: Project, laneId: string): Promise<void> {
	if (projectStore.activeId !== project.id) projectStore.setActive(project.id);
	if (project.lane.laneId !== laneId) {
		await laneOrchestrator.switchLane(project.id as ProjectId, laneId as LaneId);
	}
}

/** Apre qui il file che è aperto nell'editor di un'altra macchina. */
export async function openRemoteFile(
	project: Project,
	lane: OpenItemsLane,
	filePath: string
): Promise<void> {
	await enterLane(project, lane.laneId);
	projectStore.openFile(project.id, filePath);
}

/**
 * Apre qui l'anteprima che è aperta su un'altra macchina. Il file si legge
 * là (il percorso è relativo al progetto) e la pagina la serve il server di
 * anteprima di questa macchina: nessun URL loopback attraversa il canale.
 */
export async function openRemotePreview(
	project: Project,
	lane: OpenItemsLane,
	filePath: string
): Promise<void> {
	await enterLane(project, lane.laneId);
	laneSurfaceStore.setLanePreview(project.id, lane.laneId, filePath);
}
