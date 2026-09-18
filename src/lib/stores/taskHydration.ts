import type { StudioTask } from './taskSerialization';

/**
 * Registro di idratazione delle code di progetto.
 *
 * Invariante unica: la coda di un progetto si scrive su disco solo dopo
 * averla letta da disco. Senza questo vincolo un salvataggio che parte prima
 * della lettura (chiusura dell'app, riordino, requeue) serializza la memoria
 * ancora vuota e cancella `.omp/tasks.json` del progetto.
 *
 * Il registro non conosce ne' Tauri ne' i task: riceve la funzione di lettura
 * e si limita a garantire un solo tentativo per chiave alla volta, a non
 * marcare idratata una chiave la cui lettura e' fallita e a permettere una
 * rilettura esplicita quando il file cambia da fuori.
 */
export class QueueHydration {
	private readonly hydrated = new Set<string>();
	private readonly pending = new Map<string, Promise<boolean>>();
	private readonly epochs = new Map<string, number>();

	/** Vero se la coda e' gia' stata letta con successo: nessuna allocazione. */
	isHydrated(key: string): boolean {
		return this.hydrated.has(key);
	}

	/**
	 * Esegue `read` al massimo una volta per chiave; le chiamate concorrenti
	 * condividono lo stesso tentativo. Ritorna `false` se la lettura fallisce,
	 * lasciando la chiave non idratata perche' il prossimo tentativo riprovi.
	 * Se `forget` viene invocata mentre una lettura e' in corso, l'esito obsoleto
	 * viene scartato e il tentativo successivo esegue una nuova lettura.
	 */
	async ensure(key: string, read: () => Promise<void>): Promise<boolean> {
		if (this.hydrated.has(key)) return true;

		const running = this.pending.get(key);
		if (running) {
			const callEpoch = this.epochs.get(key) ?? 0;
			await running;
			if (this.hydrated.has(key) && (this.epochs.get(key) ?? 0) === callEpoch) {
				return true;
			}
		}

		const epoch = this.epochs.get(key) ?? 0;
		let currentAttempt: Promise<boolean> | null = null;
		const execute = async (): Promise<boolean> => {
			try {
				await read();
				if ((this.epochs.get(key) ?? 0) === epoch) {
					this.hydrated.add(key);
				}
				return true;
			} catch (err) {
				console.warn(`Lettura della coda fallita per ${key}:`, err);
				return false;
			} finally {
				if (this.pending.get(key) === currentAttempt) {
					this.pending.delete(key);
				}
			}
		};
		const attempt = execute();
		currentAttempt = attempt;
		this.pending.set(key, attempt);
		return attempt;
	}

	/** La prossima `ensure` rilegge: il file e' cambiato da fuori Studio. */
	forget(key: string): void {
		this.hydrated.delete(key);
		this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
	}
}

/**
 * Unisce il residuo dello store globale con code che possono essere arrivate
 * prima, mentre `tasks.json` era ancora in lettura. Le code gia' idratate
 * vincono: sono la copia piu' recente del file di progetto.
 */
export function mergeHydratedTasks(current: StudioTask[], persisted: StudioTask[]): StudioTask[] {
	if (persisted.length === 0) return current;
	const known = new Set(current.map((task) => task.id));
	return current.concat(persisted.filter((task) => !known.has(task.id)));
}

/**
 * Unisce lo stato su disco letto da reloadProject con i task in memoria.
 *
 * Il disco e' autoritativo: qualsiasi task rimosso esternamente non deve
 * risorgere. Si conservano solo eventuali task in stato `dispatching`, che
 * non risiedono piu' nel file ma sono in volo verso l'agente.
 */
export function mergeReloadedTasks(
	current: StudioTask[],
	projectKey: string,
	fromDisk: StudioTask[]
): StudioTask[] {
	const dispatching = current.filter(
		(task) => task.projectPath === projectKey && task.status === 'dispatching'
	);
	const diskIds = new Set(fromDisk.map((task) => task.id));
	const keptDispatching = dispatching.filter((task) => !diskIds.has(task.id));
	const merged = fromDisk.concat(keptDispatching);
	merged.forEach((task, index) => {
		task.position = index;
	});
	return current.filter((task) => task.projectPath !== projectKey).concat(merged);
}
