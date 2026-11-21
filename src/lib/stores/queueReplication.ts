/**
 * Replica della coda dei task fra macchine (R-MI-12, F19).
 *
 * La coda vive in `.omp/tasks.json` dentro il progetto, ed è gitignored: due
 * copie non la condividono per caso. Qui si decide **cosa scrivere** quando
 * arriva la coda dell'altra macchina, e la regola approvata è «vince l'ultima
 * modifica» per task, con l'istante di `updatedAt` (emesso da `logicalClock`,
 * così lo sfasamento degli orologi fra le macchine non decide chi vince).
 *
 * Perché per task e non per file: scrivere il file intero dell'altra macchina
 * cancellerebbe i task creati qui nel frattempo. La fusione è per `id`, e
 * ogni task è di tutti — non ha una macchina di appartenenza (F19).
 *
 * Perché le cancellazioni viaggiano a parte: un task tolto dalla coda (perché
 * cancellato o perché avviato) sparisce dal file, e una fusione che sa solo
 * aggiungere lo riprenderebbe dalla copia dell'altra macchina. Il task tornava
 * in coda e l'auto-avvio lo lanciava una seconda volta. Ogni rimozione lascia
 * quindi un segno (`removed`: id e istante) che le altre copie applicano.
 */

/** Ciò che serve di un task per fondere due copie della coda. */
export interface ReplicableTask {
	id: string;
	updatedAt: number;
	position: number;
}

/** Id del task tolto dalla coda → istante della rimozione. */
export type RemovedTasks = Record<string, number>;

/**
 * Per quanto si ricorda una rimozione. Una copia rimasta spenta più a lungo,
 * al ritorno, può riportare in coda un task tolto: è il limite accettato per
 * non far crescere senza fine l'elenco.
 */
export const REMOVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Coda come viaggia fra le macchine. */
export interface ReplicatedQueue<T extends ReplicableTask> {
	tasks: T[];
	removed: RemovedTasks;
}

export interface MergeOutcome<T extends ReplicableTask> {
	/** Coda fusa, nell'ordine da salvare (per `position`, poi per `id`). */
	tasks: T[];
	/** Vero quando la coda locale deve essere riscritta su disco. */
	changed: boolean;
	/** Quali task sono arrivati dall'altra macchina (per l'annuncio nella UI). */
	adopted: string[];
}

/**
 * Fonde la coda remota in quella locale.
 *
 * Regole:
 * 1. Un task rimosso dopo la sua ultima modifica (in `removed`, unione delle
 *    rimozioni note qui e di quelle arrivate) esce dalla coda, da qualunque
 *    lato venga. Una modifica successiva alla rimozione invece lo tiene: vince
 *    l'ultima azione, come per i campi.
 * 2. A parità di id vince `updatedAt` più recente; a parità resta la copia
 *    locale (le due macchine fanno la stessa scelta simmetrica e convergono
 *    al giro successivo, perché nessuna delle due riscrive).
 * 3. I task assenti in locale vengono adottati: sono creazioni dell'altra
 *    macchina.
 */
export function mergeQueues<T extends ReplicableTask>(
	local: readonly T[],
	remote: readonly T[],
	removed: RemovedTasks = {}
): MergeOutcome<T> {
	const isRemoved = (task: T) => {
		const at = removed[task.id];
		return typeof at === 'number' && at >= task.updatedAt;
	};
	const byId = new Map<string, T>();
	for (const task of local) byId.set(task.id, task);
	const adopted: string[] = [];
	for (const task of remote) {
		const current = byId.get(task.id);
		if (!current) {
			if (isRemoved(task)) continue;
			byId.set(task.id, task);
			adopted.push(task.id);
			continue;
		}
		if (task.updatedAt > current.updatedAt) byId.set(task.id, task);
	}
	for (const [id, task] of byId) {
		if (isRemoved(task)) byId.delete(id);
	}
	const merged = sortQueue([...byId.values()]);
	const before = sortQueue([...local]);
	// Il confronto è sugli oggetti: un task resta quello locale finché la
	// copia remota non vince, quindi «stesso oggetto» vuol dire «nulla da scrivere».
	const changed =
		merged.length !== before.length ||
		merged.some((task, index) => task !== before[index]);
	return { tasks: merged, changed, adopted };
}

/** Unione di due elenchi di rimozioni: per ogni id resta l'istante più recente. */
export function mergeRemoved(a: RemovedTasks, b: RemovedTasks): RemovedTasks {
	const result: RemovedTasks = { ...a };
	for (const [id, at] of Object.entries(b)) {
		if (typeof at !== 'number' || !Number.isFinite(at)) continue;
		if (!(id in result) || at > result[id]) result[id] = at;
	}
	return result;
}

/** Toglie le rimozioni più vecchie di `REMOVED_RETENTION_MS`. */
export function pruneRemoved(removed: RemovedTasks, now: number): RemovedTasks {
	const result: RemovedTasks = {};
	for (const [id, at] of Object.entries(removed)) {
		if (now - at <= REMOVED_RETENTION_MS) result[id] = at;
	}
	return result;
}

/**
 * Legge la coda arrivata da un'altra macchina. Accetta anche il formato
 * precedente (solo l'array dei task) di una copia non ancora aggiornata.
 */
export function parseReplicatedQueue<T extends ReplicableTask>(raw: string): ReplicatedQueue<T> {
	const parsed = JSON.parse(raw) as unknown;
	if (Array.isArray(parsed)) return { tasks: parsed as T[], removed: {} };
	if (!parsed || typeof parsed !== 'object') return { tasks: [], removed: {} };
	const record = parsed as { tasks?: unknown; removed?: unknown };
	const tasks = Array.isArray(record.tasks) ? (record.tasks as T[]) : [];
	const removed: RemovedTasks = {};
	if (record.removed && typeof record.removed === 'object') {
		for (const [id, at] of Object.entries(record.removed as Record<string, unknown>)) {
			if (typeof at === 'number' && Number.isFinite(at)) removed[id] = at;
		}
	}
	return { tasks, removed };
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
