import type { HostState } from '$remote-protocol';
import type { Project } from '#lib/stores/projects.svelte.ts';
import type { StudioTask } from '#lib/stores/taskSerialization.ts';
import type { LaneRecord } from '#lib/stores/lanePersistence.ts';
import type { LinkDecision } from '#lib/stores/linkDecisions.ts';
import { createMainLane, projectId as toProjectId, type CanonicalProjectPath } from '#lib/types/lanes.ts';
import { readPanelGeometries } from '#lib/panelGeometry.ts';

/**
 * Cosa una macchina ha aperto in una corsia (IMP-011): i file nell'editor e
 * l'anteprima. Non è l'elenco dei file del progetto — quello lo legge chi
 * guarda — né un inoltro di porta (R-MI-40).
 */
export interface OpenItemsLane {
	laneId: string;
	/** Titolo della corsia, per dire dove è stato aperto. */
	laneTitle: string;
	openFiles: string[];
	activeFile: string | null;
	previewFile: string | null;
}

/** Ciò che un host ha aperto, per id del progetto sulla macchina che lo possiede. */
export interface OpenItemsProject {
	projectId: string;
	lanes: OpenItemsLane[];
}

/** Solo lo stato della macchina proprietaria, mai le copie osservate da altri host. */
export interface DesktopHostSnapshot {
	version: 1;
	platform: string;
	projectRoot: string;
	projects: Project[];
	lanes: LaneRecord[];
	tasks: StudioTask[];
	sessions: Array<{ projectId: string; laneId: string; rpcId: number | null; sessionId: string | null }>;
	/** Assente nello snapshot ricostruito da uno ridotto, che non porta stato operativo. */
	state?: HostState;
	/**
	 * Ricostruito da uno snapshot ridotto: l'altra macchina ha una versione
	 * incompatibile e manda solo l'elenco dei progetti (R-MI-10).
	 */
	reduced?: true;
	/** Decisioni «stesso progetto / diversi» di questa macchina (R-MI-44). */
	linkDecisions?: LinkDecision[];
	/**
	 * Editor e anteprime aperte su questa macchina (IMP-011). Assente da chi
	 * non lo manda: chi legge non inventa nulla e non mostra la sezione.
	 */
	openItems?: OpenItemsProject[];
}

/** Ciò che manda una macchina con una versione incompatibile (R-MI-10). */
export interface ReducedHostSnapshot {
	version: 1;
	reduced: true;
	platform: string;
	projectRoot: string | null;
	projects: Array<{ id: string; name: string | null; canonicalProjectPath: string | null }>;
}

export function isReducedHostSnapshot(value: unknown): value is ReducedHostSnapshot {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return record.reduced === true && record.version === 1 && Array.isArray(record.projects);
}

/** Tinta neutra per le tessere di cui l'host non ha mandato il colore. */
const REDUCED_HUE = 220;

/**
 * Snapshot completo minimo da uno ridotto: senza corsie, task e sessioni, solo
 * le tessere. Prima lo snapshot dell'host non arrivava affatto a versione
 * diversa e i progetti dell'altra macchina sparivano dalla barra (M1); così
 * restano, e ogni comando verso quella macchina risponde «aggiorna Studio».
 */
export function expandReducedSnapshot(reduced: ReducedHostSnapshot): DesktopHostSnapshot {
	const projects = reduced.projects
		.filter((project) => typeof project.id === 'string' && project.id)
		.map((project): Project => {
			const id = toProjectId(project.id);
			const canonical = (project.canonicalProjectPath ?? null) as CanonicalProjectPath | null;
			return {
				id,
				name: project.name ?? project.id,
				label: null,
				canonicalProjectPath: canonical,
				hue: REDUCED_HUE,
				colorMode: 'auto',
				lane: createMainLane(id, canonical, 'gui'),
				layout: { left: 260, center: 0.5, leftSection: 'files', editorOpen: true, panelGeometry: readPanelGeometries(undefined) },
				lastOpened: 0,
				autoDispatch: false,
				taskDefaults: null,
				worktreeResumeChat: true,
				external: false
			};
		});
	return {
		version: 1,
		platform: reduced.platform,
		projectRoot: reduced.projectRoot ?? '',
		projects,
		lanes: [],
		tasks: [],
		sessions: [],
		reduced: true
	};
}
