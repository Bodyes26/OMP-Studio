/**
 * Cosa questa macchina ha aperto nell'editor e in anteprima (IMP-011).
 *
 * Serve alla prova di parità: dal Mac si apre un'anteprima o un file e il PC
 * Windows deve *vedere* che è aperto, senza che nessuno rifaccia l'apertura.
 * Non è l'elenco dei file del progetto (quello lo legge chi guarda, R-MI-06)
 * e non è l'inoltro di porta del server di sviluppo (R-MI-40): qui viaggiano
 * solo percorsi relativi e la superficie centrale mostrata.
 *
 * Il modulo è puro: chi chiama passa le corsie e le superfici, così la stessa
 * regola vale per lo snapshot desktop e per i test.
 */

import type { OpenItemsLane, OpenItemsProject } from '#lib/backend/host.ts';

/** Superficie centrale di una corsia, come la conosce `laneSurfaceStore`. */
export interface OpenItemsSurface {
	surface: 'editor' | 'diagram' | 'preview' | 'browser';
	previewFile: string | null;
}

export interface OpenItemsLaneSource {
	laneId: string;
	title?: string | null;
	openFiles?: string[];
	activeFile?: string | null;
}

export interface OpenItemsInput {
	/** Progetti di questa macchina, nell'ordine della barra. */
	projects: Array<{ id: string }>;
	/** Corsie note del progetto: la Principale può non essere nel registro. */
	lanesForProject: (projectId: string) => OpenItemsLaneSource[];
	/** Corsia mostrata ora, con i tab aggiornati in tempo reale. */
	activeLaneFor?: (projectId: string) => OpenItemsLaneSource | null;
	surfaceFor: (projectId: string, laneId: string) => OpenItemsSurface;
	/** Un progetto senza nulla di aperto non compare nello snapshot. */
	mainLaneTitle: string;
}

function cleanFiles(files: string[] | undefined, activeFile: string | null): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const file of files ?? []) {
		if (typeof file !== 'string' || !file || seen.has(file)) continue;
		seen.add(file);
		result.push(file);
	}
	if (activeFile && !seen.has(activeFile)) result.push(activeFile);
	return result;
}

function laneHasSomething(lane: OpenItemsLane): boolean {
	return lane.openFiles.length > 0 || Boolean(lane.previewFile);
}

/**
 * Costruisce l'elenco delle aperture per macchina. Una corsia compare solo se
 * ha almeno un file aperto o un'anteprima: le corsie ferme sull'editor vuoto
 * non dicono nulla a chi guarda dall'altra macchina.
 */
export function collectOpenItems(input: OpenItemsInput): OpenItemsProject[] {
	const result: OpenItemsProject[] = [];
	for (const project of input.projects) {
		const active = input.activeLaneFor?.(project.id) ?? null;
		const byLane = new Map<string, OpenItemsLane>();
		for (const record of input.lanesForProject(project.id)) {
			if (!record.laneId) continue;
			// La corsia mostrata vince sul registro, che è l'ultimo salvataggio.
			if (active && active.laneId === record.laneId) continue;
			const surface = input.surfaceFor(project.id, record.laneId);
			byLane.set(record.laneId, {
				laneId: record.laneId,
				laneTitle: record.title || (record.laneId === 'main' ? input.mainLaneTitle : record.laneId),
				openFiles: cleanFiles(record.openFiles, record.activeFile ?? null),
				activeFile: record.activeFile ?? null,
				previewFile: surface.surface === 'preview' ? surface.previewFile : null
			});
		}
		if (active) {
			const surface = input.surfaceFor(project.id, active.laneId);
			byLane.set(active.laneId, {
				laneId: active.laneId,
				laneTitle:
					active.title || (active.laneId === 'main' ? input.mainLaneTitle : active.laneId),
				openFiles: cleanFiles(active.openFiles, active.activeFile ?? null),
				activeFile: active.activeFile ?? null,
				previewFile: surface.surface === 'preview' ? surface.previewFile : null
			});
		}
		const lanes = [...byLane.values()].filter(laneHasSomething);
		if (lanes.length > 0) result.push({ projectId: project.id, lanes });
	}
	return result;
}
