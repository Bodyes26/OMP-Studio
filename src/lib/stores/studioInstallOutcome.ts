/**
 * Esito di `install_studio_update_and_restart` letto dal frontend.
 *
 * Il backend restituisce `{ manualCompletionRequired, message }`. Su Windows,
 * macOS e AppImage avvia l'installer e chiude Studio (`manualCompletionRequired`
 * falso): la promessa puo' anche non risolvere mai. Con un pacchetto `.deb`
 * l'installazione passa dal gestore pacchetti del sistema e Studio resta aperto
 * (`manualCompletionRequired` vero).
 */
interface InstallOutcomeRecord {
	manualCompletionRequired?: unknown;
	message?: unknown;
}

function asRecord(outcome: unknown): InstallOutcomeRecord | null {
	return outcome && typeof outcome === 'object' ? (outcome as InstallOutcomeRecord) : null;
}

/**
 * Vero quando Studio resta aperto e l'utente deve completare l'installazione:
 * il pulsante non deve restare per sempre su «Avvio installazione…».
 */
export function installOutcomeKeepsRunning(outcome: unknown): boolean {
	const record = asRecord(outcome);
	if (record && typeof record.manualCompletionRequired === 'boolean') {
		return record.manualCompletionRequired;
	}
	// Formato precedente: una stringa non vuota era il messaggio da mostrare.
	return typeof outcome === 'string' && outcome.trim() !== '';
}

/**
 * Testo da mostrare quando Studio resta aperto. Per il caso noto (.deb) il
 * frontend usa il proprio messaggio tradotto: il backend scrive in italiano.
 * `null` = usare il messaggio predefinito localizzato.
 */
export function installOutcomeNotice(outcome: unknown): string | null {
	if (typeof outcome === 'string') return outcome.trim() || null;
	return null;
}
