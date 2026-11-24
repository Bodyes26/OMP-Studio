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
import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
import type { LaneId, ProjectId } from '#lib/types/lanes.ts';
import type { OpenItemsLane } from '#lib/backend/host.ts';

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
