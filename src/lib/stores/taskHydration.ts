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

	/** Vero se la coda e' gia' stata letta con successo: nessuna allocazione. */
	isHydrated(key: string): boolean {
		return this.hydrated.has(key);
	}

	/**
	 * Esegue `read` al massimo una volta per chiave; le chiamate concorrenti
	 * condividono lo stesso tentativo. Ritorna `false` se la lettura fallisce,
	 * lasciando la chiave non idratata perche' il prossimo tentativo riprovi.
	 */
	ensure(key: string, read: () => Promise<void>): Promise<boolean> {
		if (this.hydrated.has(key)) return Promise.resolve(true);
		const running = this.pending.get(key);
		if (running) return running;

		const attempt = read()
			.then(() => {
				this.hydrated.add(key);
				return true;
			})
			.catch((err) => {
				console.warn(`Lettura della coda fallita per ${key}:`, err);
				return false;
			})
			.finally(() => {
				this.pending.delete(key);
			});

		this.pending.set(key, attempt);
		return attempt;
	}

	/** La prossima `ensure` rilegge: il file e' cambiato da fuori Studio. */
	forget(key: string): void {
		this.hydrated.delete(key);
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
