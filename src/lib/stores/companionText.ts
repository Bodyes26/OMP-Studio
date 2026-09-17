// Testo dei messaggi per le superfici companion.
//
// La finestra companion mostra la *conclusione* di un messaggio, non il suo
// inizio: quando un agente chiede qualcosa dopo mille parole di ragionamento,
// le prime righe non servono a rispondere. Qui si taglia la testa, sempre a
// confine di riga, e si marca il taglio.

/** Marcatore del taglio: una riga sola, riconoscibile anche nel markdown. */
const ELLIPSIS = '\u2026';

/**
 * Ultimi `maxChars` caratteri di `text`, tagliati a inizio di riga.
 *
 * Il taglio a confine di riga non e' un vezzo: a meta' riga spezzerebbe un
 * elemento di elenco o l'apertura di un blocco di codice, e il lexer del
 * markdown renderebbe un frammento che non esiste nel messaggio originale.
 * Quando la prima riga sopravvissuta e' comunque piu' lunga del tetto, si
 * accetta il taglio netto: meglio una riga incompleta che nessun testo.
 */
export function tailOfText(text: string, maxChars: number): string {
	if (!text) return '';
	if (text.length <= maxChars) return text;

	const cut = text.slice(text.length - maxChars);
	const firstBreak = cut.indexOf('\n');
	const tail = firstBreak >= 0 ? cut.slice(firstBreak + 1) : cut;
	const trimmed = tail.trimStart();
	if (!trimmed) return `${ELLIPSIS}\n${cut.trimStart()}`;
	return `${ELLIPSIS}\n${trimmed}`;
}

/**
 * Eta' in forma breve: la companion la mostra accanto all'estratto, perche'
 * "ha finito" senza "quando" non dice se il risultato e' ancora quello che
 * stavi aspettando.
 */
export function shortAge(at: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}g`;
}

/**
 * Oltre questa eta' un estratto di fine turno non viene piu' mostrato: il
 * lavoro e' da considerare chiuso, e una card che porta ancora il suo
 * riassunto occuperebbe spazio per un'informazione che nessuno sta piu'
 * aspettando.
 */
export const ACTIVITY_FRESH_MS = 3 * 60 * 60 * 1000;

/** Tetto dell'estratto trasmesso alla companion: due righe rese, con margine. */
export const ACTIVITY_MAX_CHARS = 300;

/** Tetto di sicurezza per messaggio nello storico inviato via IPC. */
export const RECENT_MESSAGE_MAX_CHARS = 8 * 1024;

/** Taglio visivo del contesto chat nella card: si legge la coda, non il tema. */
export const CONTEXT_VISIBLE_CHARS = 1500;
