/**
 * Riconoscimento dell'errore "sessione da riprendere assente" dallo stderr di
 * `omp`.
 *
 * Il protocollo RPC non espone un codice per questo caso: resta solo il testo,
 * e `omp` lo scrive in piu' forme (`Session "id" not found`, con o senza punto
 * finale, con o senza virgolette). Il confronto letterale con una sola di
 * queste forme fallisce in silenzio e l'utente resta con una chat morta invece
 * di vederne partire una nuova.
 */

/** Indizi che la sessione non esiste, nelle lingue in cui `omp` li scrive. */
const NOT_FOUND = /\b(not found|does not exist|no such session|non trovata|inesistente)\b/i;

/**
 * Vero quando lo stderr dice che proprio quella sessione non esiste. Serve sia
 * l'identificativo richiesto sia l'indizio di assenza sulla stessa riga: un
 * errore diverso non deve far ripartire la chat da zero.
 */
export function isMissingSessionError(stderrLines: readonly string[], sessionId: string): boolean {
	const needle = sessionId.trim().toLowerCase();
	if (needle === '') return false;

	return stderrLines.some((line) => {
		const normalized = line.replace(/\s+/g, ' ').toLowerCase();
		return (
			normalized.includes(needle) && normalized.includes('session') && NOT_FOUND.test(normalized)
		);
	});
}
