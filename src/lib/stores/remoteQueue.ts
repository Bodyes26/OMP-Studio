/**
 * Coda di un progetto che vive su un'altra macchina (R-MI-06, R-MI-15).
 *
 * La coda vera sta nel `.omp/tasks.json` della macchina che possiede il
 * progetto. Questa finestra ne tiene uno specchio: ciò che l'host pubblica
 * nel suo riepilogo, più le modifiche fatte qui e non ancora confermate
 * (`edits`). Le modifiche viaggiano con `write_queue`, che sull'host fonde per
 * task come la replica fra copie; finché l'host è spento restano qui, salvate,
 * e partono quando torna (R-MI-15).
 *
 * Prima la finestra leggeva e scriveva la coda di un progetto remoto sul
 * proprio disco, nel percorso dell'altra macchina: i task non arrivavano mai.
 */

import type { RemovedTasks, ReplicableTask } from './queueReplication.ts';
import { sortQueue } from './queueReplication.ts';

export interface HostMergeOutcome<T> {
	tasks: T[];
	/** Modifiche locali ancora da confermare dopo la fusione. */
	edits: Set<string>;
}

/**
 * Fonde il riepilogo dell'host nello specchio.
 *
 * - Per un task non modificato qui vale la versione dell'host.
 * - Un task modificato qui resta come qui finché l'host non ne pubblica una
 *   versione almeno altrettanto recente: allora la modifica è arrivata.
 * - Un task che l'host non ha più e che qui non è stato toccato è stato tolto
 *   sull'host (cancellato o avviato): sparisce anche qui.
 * - Un task tolto qui (in `removed`) resta fuori finché l'host non lo toglie.
 */
export function mergeHostQueue<T extends ReplicableTask>(
	local: readonly T[],
	host: readonly T[],
	edits: ReadonlySet<string>,
	removed: RemovedTasks
): HostMergeOutcome<T> {
	const localById = new Map(local.map((task) => [task.id, task]));
	const nextEdits = new Set(edits);
	const result: T[] = [];
	const seen = new Set<string>();
	for (const hostTask of host) {
		seen.add(hostTask.id);
		const removedAt = removed[hostTask.id];
		if (typeof removedAt === 'number' && removedAt >= hostTask.updatedAt) continue;
		const mine = localById.get(hostTask.id);
		if (mine && nextEdits.has(hostTask.id) && mine.updatedAt > hostTask.updatedAt) {
			result.push(mine);
			continue;
		}
		nextEdits.delete(hostTask.id);
		result.push(hostTask);
	}
	for (const task of local) {
		if (!seen.has(task.id) && nextEdits.has(task.id)) result.push(task);
	}
	for (const id of [...nextEdits]) {
		if (!result.some((task) => task.id === id)) nextEdits.delete(id);
	}
	return { tasks: sortQueue(result), edits: nextEdits };
}

/** Ciò che serve della programmazione per la regola di consegna. */
export interface SchedulableTask extends ReplicableTask {
	schedule?: { kind: 'reset' | 'at'; notBefore?: number; missed?: boolean };
}

/**
 * Consegna in ritardo (F12): un task con un orario già passato non deve
 * partire appena arriva sull'host. Lo si segna come `missed`, lo stesso stato
 * dei task scaduti a Studio chiuso: resta in coda e aspetta la scelta
 * dell'utente nel banner. Solo i task modificati qui: gli altri sono già
 * dell'host com'erano.
 */
export function holdOverdueSchedules<T extends SchedulableTask>(
	tasks: readonly T[],
	edits: ReadonlySet<string>,
	now: number
): T[] {
	return tasks.map((task) => {
		const schedule = task.schedule;
		if (!edits.has(task.id) || !schedule || schedule.kind !== 'at' || schedule.missed) return task;
		if (typeof schedule.notBefore !== 'number' || schedule.notBefore > now) return task;
		return { ...task, schedule: { ...schedule, missed: true } };
	});
}

/** Confronto di percorsi scritti dal sistema di un'altra macchina. */
export function samePathLoose(a: string | null | undefined, b: string | null | undefined): boolean {
	const simplify = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
	return Boolean(a && b) && simplify(a!) === simplify(b!);
}
