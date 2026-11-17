/**
 * Replica della coda dei task fra macchine (R-MI-12, F19).
 *
 * La coda vive in `.omp/tasks.json` dentro il progetto, ed è gitignored: due
 * copie non la condividono per caso. Qui si decide **cosa scrivere** quando
 * arriva la coda dell'altra macchina, e la regola approvata è «vince l'ultima
 * modifica» per task, con l'orologio di `updatedAt`.
 *
 * Perché per task e non per file: scrivere il file intero dell'altra macchina
 * cancellerebbe i task creati qui nel frattempo. La fusione è per `id`, e
 * ogni task è di tutti — non ha una macchina di appartenenza (F19).
 *
 * Perché `updatedAt` e non `createdAt`: un task modificato solo altrove deve
 * vincere anche se è nato prima. A parità di orologio vince l'ordine
 * alfabetico dell'id, così due macchine che replicano insieme convergono
 * allo stesso risultato invece di scambiarsi le versioni all'infinito.
 */

/** Ciò che serve di un task per fondere due copie della coda. */
export interface ReplicableTask {
	id: string;
	updatedAt: number;
	position: number;
	/** Lo stato: un task avviato altrove non deve tornare «queued» qui. */
	status?: string;
}

export interface MergeOutcome<T extends ReplicableTask> {
	/** Coda fusa, nell'ordine da salvare (per `position`, poi per `createdAt`). */
	tasks: T[];
	/** Vero quando la coda locale deve essere riscritta su disco. */
	changed: boolean;
	/** Quali task sono arrivati dall'altra macchina (per l'annuncio nella UI). */
	adopted: string[];
}

/** Un task è chiuso quando il suo ciclo è finito: non torna in coda né si fonde a ritroso. */
export function isClosedTask(task: ReplicableTask): boolean {
	return task.status === 'done' || task.status === 'failed' || task.status === 'discarded';
}

/**
 * Fonde la coda remota in quella locale.
 *
 * Regole:
 * 1. A parità di id vince `updatedAt` più recente; a parità vince l'id minore
 *    (ordinamento totale, così tutte le macchine convergono).
 * 2. Un task chiuso non torna aperto: se la copia locale è chiusa e la remota
 *    è vecchia, resta chiusa. Il confronto è già coperto dalla regola 1, ma
 *    questo tiene fuori le riaperture da una coda rimasta indietro.
 * 3. I task assenti in locale vengono adottati: sono creazioni dell'altra
 *    macchina.
 */
export function mergeQueues<T extends ReplicableTask>(
	local: readonly T[],
	remote: readonly T[]
): MergeOutcome<T> {
	const byId = new Map<string, T>();
	for (const task of local) byId.set(task.id, task);
	const adopted: string[] = [];
	for (const task of remote) {
		const current = byId.get(task.id);
		if (!current) {
			byId.set(task.id, task);
			adopted.push(task.id);
			continue;
		}
		const winner = newerTask(current, task);
		if (winner === task) byId.set(task.id, task);
	}
	const merged = sortQueue([...byId.values()]);
	const changed =
		merged.length !== local.length ||
		merged.some((task, index) => task !== local[index]);
	return { tasks: merged, changed, adopted };
}

/**
 * Vince la modifica più recente. A parità di orologio resta la copia locale:
 * così due macchine che ricevono la stessa coda nello stesso istante non si
 * scambiano le versioni in eterno. Confrontare l'id non basterebbe — è lo
 * stesso task, quindi l'id è uguale — e scegliere per contenuto creerebbe un
 * ping-pong fra le due copie.
 */
function newerTask<T extends ReplicableTask>(a: T, b: T): T {
	return b.updatedAt > a.updatedAt ? b : a;
}

/** Ordine della coda: `position`, poi gli id per stabilità fra macchine. */
export function sortQueue<T extends ReplicableTask>(tasks: T[]): T[] {
	return [...tasks].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * Rinumera `position` dopo una fusione: due macchine possono aver assegnato
 * la stessa posizione a task diversi, e l'ordine deve restare uno solo.
 */
export function resequence<T extends ReplicableTask>(tasks: readonly T[]): T[] {
	return sortQueue([...tasks]).map((task, index) => ({ ...task, position: index }));
}

/**
 * C'è qualcosa da replicare? Un task con `updatedAt` più recente dell'ultimo
 * invio è una modifica locale da pubblicare; senza questa guardia ogni ciclo
 * rimanderebbe la coda intera.
 */
export function hasPendingChanges(tasks: readonly ReplicableTask[], lastSentAt: number): boolean {
	return tasks.some((task) => task.updatedAt > lastSentAt);
}
