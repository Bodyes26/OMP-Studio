/**
 * Logica pura del riepilogo «corsie occupate da un'altra macchina» (R-MI-18).
 *
 * Perché un file a parte: `link.svelte.ts` tocca Tauri e non si può caricare
 * nei test Node, mentre queste due regole sono quelle che sbagliano davvero —
 * scartare un riepilogo arrivato in ritardo e decidere se una corsia è
 * occupata. Le altre restano nel componente, che le consuma.
 */

export interface LaneActivity {
	projectId: string;
	laneId: string;
	working: boolean;
	peerIds?: string[];
}

export interface LaneActivitySnapshot {
	revision: number;
	lanes: LaneActivity[];
}

export const NO_ACTIVITY: LaneActivitySnapshot = { revision: -1, lanes: [] };

/**
 * Un riepilogo vale solo se è più recente di quello in mano: evento e lettura
 * iniziale possono incrociarsi, e un pacchetto vecchio non deve riportare
 * indietro la vista mostrando una corsia ferma che nel frattempo lavora.
 * Un riepilogo malformato lascia intatto lo stato precedente.
 */
export function mergeActivity(
	current: LaneActivitySnapshot,
	next: LaneActivitySnapshot | null | undefined
): LaneActivitySnapshot {
	if (!next || typeof next.revision !== 'number' || !Array.isArray(next.lanes)) return current;
	if (next.revision < current.revision) return current;
	return { revision: next.revision, lanes: next.lanes };
}

/** La corsia sta lavorando per un'altra macchina. */
export function laneWorkingRemotely(
	snapshot: LaneActivitySnapshot,
	projectId: string,
	laneId: string
): boolean {
	return snapshot.lanes.some(
		(lane) => lane.projectId === projectId && lane.laneId === laneId && lane.working
	);
}

/**
 * La corsia ha una superficie remota aperta, in qualunque stato. Serve alla
 * coda: la sessione può aver ceduto il turno un istante prima che arrivi il
 * nuovo prompt, e avviare un secondo lavoro sopra sarebbe un doppione.
 */
export function laneBusyRemotely(
	snapshot: LaneActivitySnapshot,
	projectId: string,
	laneId: string
): boolean {
	return snapshot.lanes.some(
		(lane) => lane.projectId === projectId && lane.laneId === laneId
	);
}
