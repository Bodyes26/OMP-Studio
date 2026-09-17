import type { StudioTask } from '$lib/stores/taskSerialization';

/**
 * Coda di un progetto come la mostra la Companion: dati piatti, nessun
 * riferimento allo store. La vista aggregata deve poter ordinare e contare
 * senza sapere da dove arrivano i progetti.
 */
export interface CompanionQueueGroup {
	projectId: string;
	/** Nome gia' risolto (etichetta se c'e', altrimenti nome del progetto). */
	name: string;
	hue: number;
	tasks: StudioTask[];
	/** Il gate di automazione consente di avviare ora. */
	ready: boolean;
	/** Perche' non si puo' avviare: spiegazione e rimedio insieme. */
	blockReason?: string;
}

/**
 * Ordine delle code nella vista aggregata: prima cio' che parte con un
 * click, perche' e' l'unica riga che fa qualcosa; poi la coda piu' lunga,
 * che e' quella che arretra di piu'. Il nome decide i pari merito, cosi' le
 * righe non ballano fra due aggiornamenti.
 */
export function sortQueueGroups(groups: CompanionQueueGroup[]): CompanionQueueGroup[] {
	return [...groups].sort((left, right) => {
		if (left.ready !== right.ready) return left.ready ? -1 : 1;
		if (left.tasks.length !== right.tasks.length) return right.tasks.length - left.tasks.length;
		return left.name.localeCompare(right.name);
	});
}

/** Task in coda su tutti i progetti della vista. */
export function countQueuedTasks(groups: CompanionQueueGroup[]): number {
	let total = 0;
	for (const group of groups) total += group.tasks.length;
	return total;
}
