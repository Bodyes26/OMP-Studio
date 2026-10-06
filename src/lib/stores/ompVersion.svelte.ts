import { invoke } from '@tauri-apps/api/core';

/**
 * Versione del binario `omp` in uso, condivisa fra barra di stato, modale di
 * aggiornamento e banner della chat vuota. Una sola fonte: dopo un aggiornamento
 * tutte le superfici mostrano la stessa versione.
 */
class OmpVersionStore {
	current = $state<string | null>(null);
	#inflight: Promise<void> | null = null;

	/** Rilegge `omp --version`; le chiamate concorrenti condividono la stessa richiesta. */
	refresh(): Promise<void> {
		this.#inflight ??= invoke<string>('get_omp_version')
			.then((ver) => {
				this.current = ver;
			})
			.catch((e) => {
				console.error('Failed to fetch OMP version', e);
			})
			.finally(() => {
				this.#inflight = null;
			});
		return this.#inflight;
	}

	/** Carica la versione solo se nessuno l'ha ancora letta (finestre secondarie, banner). */
	ensure(): void {
		if (this.current === null) void this.refresh();
	}

	set(version: string): void {
		this.current = version;
	}
}

export const ompVersionStore = new OmpVersionStore();
