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

/**
 * Riconosce l'errore di modello salvato non piu' disponibile durante la ripresa
 * della sessione dallo stderr di `omp` (omp >= 18.6.3) ed estrae la stringa del
 * modello (`provider/id`).
 *
 * Il testo emesso da omp e': `Could not restore model <provider/id>` (con eventuale
 * prefisso `Error: `, virgolette, o codici ANSI colore).
 */
export function parseUnavailableResumeModel(stderrLines: readonly string[]): string | null {
	for (const rawLine of stderrLines) {
		// Rimuove sequenze di escape ANSI e normalizza gli spazi
		const line = rawLine.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').trim();
		// Cerca il pattern "could not restore model <modello>"
		const match = /(?:could not restore model)\s+["']?([^\s"'\r\n]+)/i.exec(line);
		if (match && match[1]) {
			let model = match[1].trim();
			// Pulisce virgolette e punteggiatura terminale della frase (es. virgola, punto e virgola, chiusura parentesi)
			model = model.replace(/^[/"']+|[/"',;)]+$/g, '');
			// Rimuove l'eventuale punto finale di fine frase (un modelId non termina con punto)
			if (model.endsWith('.')) {
				model = model.slice(0, -1);
			}
			if (model.length > 0) {
				return model;
			}
		}
	}
	return null;
}
