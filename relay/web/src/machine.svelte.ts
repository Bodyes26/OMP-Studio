/**
 * Macchina mostrata nella pagina iniziale (Gate R48, R-REM-01): una alla volta.
 * Condivisa fra pagina iniziale, foglio Macchine e notifiche, che portano alla
 * macchina della richiesta; la scelta resta fra un'apertura e l'altra.
 */

const STORAGE_KEY = 'studio-remote-selected-host';

function readSaved(): string {
	try {
		return localStorage.getItem(STORAGE_KEY) ?? '';
	} catch {
		return '';
	}
}

class MachineSelection {
	/** Id scelto dall'utente; vuoto finche' non sceglie, e allora vale la prima macchina online. */
	id = $state(readSaved());

	select(hostId: string): void {
		this.id = hostId;
		try {
			localStorage.setItem(STORAGE_KEY, hostId);
		} catch {
			// Archiviazione non disponibile (navigazione privata): la scelta vale per la sessione.
		}
	}
}

export const machineSelection = new MachineSelection();
