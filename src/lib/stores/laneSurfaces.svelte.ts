// Store reattivo delle superfici centrali per corsia (Editor, Diagrammi, Anteprime, Browser).
//
// Invarianti del Gate R27 / PLAN W06:
// 1. Lo stato della superficie centrale (quale pannello e' aperto e quali dati mostra)
//    e' correlato e confinato alla singola corsia (`projectId` + `laneId`).
// 2. Un evento generato da un agente in worktree o background non altera la superficie
//    della corsia attiva: si memorizza nella corsia di destinazione e compare
//    istantaneamente quando l'utente vi commuta.
// 3. Target incerto o ambiguo rifiuta il cambio superficie per salvaguardare il lavoro.

import {
	LaneSurfaceManager,
	type LaneCenterSurface,
	type LaneDiagramPayload,
	type LanePreviewPayload,
	type LaneSurfaceState
} from '$lib/agent/laneSurfaces';

export type {
	LaneCenterSurface,
	LaneDiagramPayload,
	LanePreviewPayload,
	LaneSurfaceState
};

export class LaneSurfaceStore extends LaneSurfaceManager {
	protected surfaces = $state<Record<string, LaneSurfaceState>>({});
	protected browserTabCounts = $state<Record<string, number>>({});
}

export const laneSurfaceStore = new LaneSurfaceStore();
