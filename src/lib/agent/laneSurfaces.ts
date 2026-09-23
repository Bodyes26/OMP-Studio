// Gestore deterministico delle superfici centrali per corsia (Editor, Diagrammi, Anteprime, Browser).
//
// Invarianti del Gate R27 / PLAN W06:
// 1. Lo stato della superficie centrale (quale pannello e' aperto e quali dati mostra)
//    e' correlato e confinato alla singola corsia (`projectId` + `laneId`).
// 2. Un evento generato da un agente in worktree o background non altera la superficie
//    della corsia attiva: si memorizza nella corsia di destinazione e compare
//    istantaneamente quando l'utente vi commuta.
// 3. Target incerto o ambiguo rifiuta il cambio superficie per salvaguardare il lavoro.

import {
	resolveTargetLane,
	type LaneEventTarget,
	type LaneResolutionContext,
	type LaneResolutionResult
} from './laneRouting.ts';

export type LaneCenterSurface = 'editor' | 'diagram' | 'preview' | 'browser';

export interface LaneDiagramPayload {
	id: string;
	title: string;
	mermaid: string;
	cwd: string;
	session_id: string;
	lane_id?: string;
	project_id?: string;
}

export interface LanePreviewPayload {
	id: string;
	title: string;
	file_path: string;
	cwd: string;
	session_id: string;
	lane_id?: string;
	project_id?: string;
}

export interface LaneSurfaceState {
	surface: LaneCenterSurface;
	diagramPayload: LaneDiagramPayload | null;
	previewFile: string | null;
}

export function surfaceKey(projectId: string, laneId: string): string {
	return `${projectId.trim().toLowerCase()}::${laneId.trim().toLowerCase()}`;
}

export function createDefaultLaneSurface(): LaneSurfaceState {
	return {
		surface: 'editor',
		diagramPayload: null,
		previewFile: null
	};
}

export class LaneSurfaceManager {
	protected surfaces: Record<string, LaneSurfaceState> = {};
	protected browserTabCounts: Record<string, number> = {};

	getLaneSurface(projectId: string, laneId: string): LaneSurfaceState {
		const key = surfaceKey(projectId, laneId);
		return this.surfaces[key] ?? createDefaultLaneSurface();
	}

	setLaneSurface(projectId: string, laneId: string, surface: LaneCenterSurface): void {
		const key = surfaceKey(projectId, laneId);
		const current = this.getLaneSurface(projectId, laneId);
		this.surfaces[key] = {
			...current,
			surface
		};
	}

	setLaneDiagram(projectId: string, laneId: string, payload: LaneDiagramPayload): void {
		const key = surfaceKey(projectId, laneId);
		this.surfaces[key] = {
			surface: 'diagram',
			diagramPayload: payload,
			previewFile: null
		};
	}

	setLanePreview(projectId: string, laneId: string, filePath: string): void {
		const key = surfaceKey(projectId, laneId);
		this.surfaces[key] = {
			surface: 'preview',
			diagramPayload: null,
			previewFile: filePath
		};
	}

	setLaneBrowser(projectId: string, laneId: string): void {
		const key = surfaceKey(projectId, laneId);
		const current = this.getLaneSurface(projectId, laneId);
		this.surfaces[key] = {
			...current,
			surface: 'browser'
		};
	}

	closeLaneSurface(projectId: string, laneId: string): void {
		const key = surfaceKey(projectId, laneId);
		const current = this.getLaneSurface(projectId, laneId);
		this.surfaces[key] = {
			...current,
			surface: 'editor'
		};
	}

	syncBrowserTabCount(
		projectId: string,
		laneId: string,
		tabCount: number,
		isEditorActive: boolean
	): void {
		const key = surfaceKey(projectId, laneId);
		const prevCount = this.browserTabCounts[key] ?? 0;
		this.browserTabCounts[key] = tabCount;

		// Se le tab passano da 0 a > 0 e non c'e' il task editor attivo, apri il browser nella corsia
		if (tabCount > 0 && prevCount === 0 && !isEditorActive) {
			this.setLaneBrowser(projectId, laneId);
		}
	}

	routeDiagramEvent(
		payload: LaneDiagramPayload,
		context: LaneResolutionContext
	): { handled: boolean; targetProjectId?: string; targetLaneId?: string; isAmbiguous?: boolean } {
		const target: LaneEventTarget = {
			projectId: payload.project_id ?? null,
			laneId: payload.lane_id ?? null,
			cwd: payload.cwd || null,
			sessionId: payload.session_id || null
		};

		const resolution: LaneResolutionResult = resolveTargetLane(target, context);
		if (!resolution.matched || !resolution.projectId || !resolution.laneId) {
			return { handled: false, isAmbiguous: resolution.isAmbiguous };
		}

		this.setLaneDiagram(resolution.projectId, resolution.laneId, payload);
		return {
			handled: true,
			targetProjectId: resolution.projectId,
			targetLaneId: resolution.laneId
		};
	}

	routePreviewEvent(
		payload: LanePreviewPayload,
		context: LaneResolutionContext
	): { handled: boolean; targetProjectId?: string; targetLaneId?: string; isAmbiguous?: boolean } {
		const target: LaneEventTarget = {
			projectId: payload.project_id ?? null,
			laneId: payload.lane_id ?? null,
			cwd: payload.cwd || null,
			sessionId: payload.session_id || null
		};

		const resolution: LaneResolutionResult = resolveTargetLane(target, context);
		if (!resolution.matched || !resolution.projectId || !resolution.laneId) {
			return { handled: false, isAmbiguous: resolution.isAmbiguous };
		}

		this.setLanePreview(resolution.projectId, resolution.laneId, payload.file_path);
		return {
			handled: true,
			targetProjectId: resolution.projectId,
			targetLaneId: resolution.laneId
		};
	}
}
