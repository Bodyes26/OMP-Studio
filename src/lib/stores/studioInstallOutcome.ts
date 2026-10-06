/**
 * Esito di `install_studio_update_and_restart` letto dal frontend.
 *
 * Su Windows, macOS e AppImage il comando avvia l'installer e chiude Studio:
 * la promessa risolve (se risolve) a valore vuoto. Con un pacchetto `.deb`
 * l'installazione passa dal gestore pacchetti del sistema e Studio resta
 * aperto: il backend restituisce allora un messaggio da mostrare all'utente.
 * Il formato e' tollerante (stringa, oppure oggetto con `message`) perche'
 * non deve rompersi se il comando si arricchisce di altri campi.
 */
export function installOutcomeNotice(outcome: unknown): string | null {
	if (typeof outcome === 'string') return outcome.trim() || null;
	if (outcome && typeof outcome === 'object') {
		const record = outcome as Record<string, unknown>;
		for (const field of ['message', 'notice', 'detail']) {
			const value = record[field];
			if (typeof value === 'string' && value.trim()) return value.trim();
		}
	}
	return null;
}

/**
 * Vero quando il comando ha risposto con un esito invece di chiudere l'app:
 * il pulsante non deve restare per sempre su «Avvio installazione…».
 */
export function installOutcomeKeepsRunning(outcome: unknown): boolean {
	return outcome !== null && outcome !== undefined && outcome !== '';
}
