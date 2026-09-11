/**
 * Titolo di una richiesta interattiva (`extension_ui_request`).
 *
 * omp premette `(N selected)` nei round a scelta multipla e aggiunge in coda
 * `(k/N)` nelle sequenze multi-domanda: le due cose convivono e nessuna delle
 * due fa parte della domanda.
 *
 * Vive fuori dai componenti perche' la stessa domanda si mostra in tre
 * superfici — la card della chat, il popover del progetto e la finestra
 * companion — e perche' e' aritmetica su stringhe, verificabile dagli smoke
 * test che girano con il solo type-stripping di Node.
 */

export interface ParsedAskTitle {
	/** `(N selected)` o `k/N` quando il protocollo li dichiara, altrimenti `null`. */
	counter: string | null;
	/** Testo della domanda senza i marcatori di posizione. */
	text: string;
}

export function parseAskTitle(raw: string | null | undefined): ParsedAskTitle {
	const source = raw ?? '';
	let text = source;
	let counter: string | null = null;

	const selectedMatch = text.match(/^\(([^)]+)\)\s*(.*)$/);
	if (selectedMatch) {
		counter = selectedMatch[1].trim();
		text = selectedMatch[2].trim() || source;
	}

	const progMatch = text.match(/\s*\((\d+)\/(\d+)\)\s*$/);
	if (progMatch) {
		text = text.slice(0, progMatch.index).trim();
		counter ??= `${progMatch[1]}/${progMatch[2]}`;
	}

	return { counter, text };
}

/**
 * Pulisce il messaggio di dettaglio di una richiesta UI da artefatti del prompt CLI.
 *
 * Quando omp o una CLI gestisce un prompt interattivo su terminale (es. selezione
 * di "Other / write your own"), `message` puo' contenere l'intero dump delle
 * opzioni formattate per terminale (prefissate da '▮' o '■') e il prompt
 * di chiusura "Enter your response:".
 * Questo testo non e' una nota o un chiarimento della domanda: se mostrato come
 * dettaglio sporca la grafica con blocchi non stilizzati e duplica opzioni e input.
 */
export function sanitizeAskDetail(raw: string | null | undefined): string | null {
	if (!raw) return null;
	let text = raw.trim();
	if (!text) return null;

	// Taglia via il blocco menu CLI se presente (dall'inizio del primo elemento ▮ o ■)
	const menuIndex = text.search(/(?:^|\n)\s*[▮■]/);
	if (menuIndex !== -1) {
		text = text.slice(0, menuIndex).trim();
	}

	// Rimuove prompt terminale residuo tipo "Enter your response:" o "Type your response:"
	text = text.replace(/(?:^|\n)\s*(?:enter|type)\s+(?:your\s+)?response:?\s*$/i, '').trim();

	return text.length > 0 ? text : null;
}

/**
 * Testo con cui una domanda si annuncia fuori dalla chat (notifiche di
 * sistema, popover del progetto, companion).
 *
 * L'ordine non e' arbitrario: nel protocollo la domanda sta in `title` e
 * `message` porta un dettaglio facoltativo. Leggere `message` per primo
 * mostrerebbe la nota al posto della domanda, e trattarlo come obbligatorio
 * (com'era) fa sparire del tutto le domande che non ne hanno una.
 */
export function askQuestionText(
	pending: { title?: string | null; message?: string | null } | null | undefined,
	fallback = 'Richiesta di risposta'
): string {
	if (!pending) return fallback;
	const fromTitle = parseAskTitle(pending.title).text.trim();
	if (fromTitle) return fromTitle;
	const fromMessage = (pending.message ?? '').trim();
	if (fromMessage) {
		const clean = sanitizeAskDetail(fromMessage);
		if (clean) return clean;
	}
	return fallback;
}
