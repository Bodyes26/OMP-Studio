/**
 * Collegamento fra gli store di Studio e `collectOpenItems` (IMP-011).
 *
 * Un solo posto legge il registro delle corsie, la corsia mostrata e le
 * superfici centrali: la proiezione verso le altre macchine e il pannello del
 * progetto devono raccontare la stessa cosa.
 */

import { m } from '#lib/paraglide/messages.js';
import { laneStore } from './lanes.svelte.ts';
import { laneSurfaceStore } from './laneSurfaces.svelte.ts';
import type { ProjectId } from '#lib/types/lanes.ts';
import type { Project } from './projects.svelte.ts';
import type { OpenItemsProject } from '#lib/backend/host.ts';
import { collectOpenItems } from './openItems.ts';

/** Ciò che questa macchina ha aperto, per i progetti indicati. */
export function collectLocalOpenItems(projects: Project[]): OpenItemsProject[] {
	return collectOpenItems({
		projects,
		lanesForProject: (projectId) => {
			const project = projects.find((candidate) => candidate.id === projectId);
			const stored = laneStore.lanesFor(projectId as ProjectId);
			// Senza record nel registro (progetto mai passato dalle corsie) vale
			// la corsia mostrata: è l'unica di cui si sa qualcosa.
			const lanes = stored.length > 0 || !project ? stored : [project.lane];
			return lanes.map((lane) => ({
				laneId: lane.laneId,
				title: lane.title,
				openFiles: lane.openFiles,
				activeFile: lane.activeFile
			}));
		},
		activeLaneFor: (projectId) => {
			const project = projects.find((candidate) => candidate.id === projectId);
			if (!project) return null;
			return {
				laneId: project.lane.laneId,
				title: project.lane.title,
				openFiles: project.lane.openFiles,
				activeFile: project.lane.activeFile
			};
		},
		surfaceFor: (projectId, laneId) => {
			const surface = laneSurfaceStore.getLaneSurface(projectId, laneId);
			return { surface: surface.surface, previewFile: surface.previewFile };
		},
		mainLaneTitle: m.companion_lane_main()
	});
}
