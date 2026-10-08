/**
 * Segnali di attivita' della TUI di omp per l'avvio automatico della coda.
 *
 * Nel terminale Studio non ha il protocollo RPC: lo stato viene dal titolo
 * che omp scrive con OSC 0/2 (`tui.titleState`, attivo di default). Dal
 * sorgente di omp 18.8 (`modes/controllers/event-controller.ts`):
 *
 * - `\u03c0 :` (working) su `agent_start`;
 * - `\u03c0 >` (idle) solo su un `agent_end` **terminale**, oppure su un
 *   `agent_end` non terminale con `awaitingAsyncWork` (resta solo un job in
 *   background), oppure quando una continuazione programmata non parte;
 * - `\u03c0 !` (attention) quando `ask` o un'approvazione aspettano l'utente,
 *   e di nuovo `:` quando l'ultima risposta arriva.
 *
 * Quindi il titolo **non** va a `idle` fra un tool e l'altro, ne' durante i
 * tentativi automatici o la compattazione che continua il run: la TUI ha gia'
 * la semantica giusta. I buchi sono altri due:
 *
 * 1. dopo che Studio scrive il task nel PTY il titolo resta `idle` finche'
 *    omp non fa partire il run (preflight, eventuale compattazione prima del
 *    prompt): in quella finestra la coda spediva il task successivo, con un
 *    `/new` sopra il prompt appena inviato. Qui diventa `awaitingStart`;
 * 2. un job in background (subagente asincrono, bash in background) porta il
 *    titolo a `idle` anche se potra' risvegliare l'agente. Il titolo non lo
 *    distingue: e' un limite documentato. Se l'utente ha acceso
 *    `terminal.showProgress` in omp, la barra OSC 9;4 copre almeno la
 *    compattazione a riposo, e Studio la legge come lavoro in corso.
 */

export type TerminalTitleState = 'idle' | 'working' | 'attention' | 'unknown';

const TITLE_STATE_REGEX = /^\u03c0 ([>:!])(?: |$)/;

export function parseTitleState(title: string): TerminalTitleState {
	const match = TITLE_STATE_REGEX.exec(title);
	if (!match) return 'unknown';
	return ({ '>': 'idle', ':': 'working', '!': 'attention' } as const)[match[1] as '>' | ':' | '!'];
}

/**
 * Payload di un OSC 9 (senza il `9;` iniziale, come lo passa xterm).
 * `4;<stato>[;<valore>]`: 0 = nessuna barra, 1 = valore, 2 = errore,
 * 3 = indeterminata, 4 = in pausa. Restituisce `null` per gli altri OSC 9
 * (le notifiche di ConEmu/iTerm usano lo stesso numero).
 */
export function parseProgressOsc(data: string): boolean | null {
	const match = /^4;(\d+)(?:;|$)/.exec(data);
	if (!match) return null;
	const state = Number(match[1]);
	return state === 1 || state === 3 || state === 4;
}

export interface TerminalHold {
	/** Task scritto nel PTY, run non ancora partito. */
	awaitingStart: boolean;
	awaitingSince: number | null;
	/** Barra OSC 9;4 attiva. */
	progressActive: boolean;
}

export const INITIAL_TERMINAL_HOLD: TerminalHold = {
	awaitingStart: false,
	awaitingSince: null,
	progressActive: false
};

/**
 * Oltre questo tempo senza che il titolo diventi `working`, l'attesa si
 * considera caduta (il prompt e' stato rifiutato, o la TUI non scrive il
 * titolo). Il cancello torna allo stato del titolo.
 */
export const TERMINAL_START_TIMEOUT_MS = 30_000;

export function holdOnTaskWritten(hold: TerminalHold, now: number): TerminalHold {
	return { ...hold, awaitingStart: true, awaitingSince: now };
}

/** Il titolo e' cambiato: `working` o `attention` dicono che il run e' partito. */
export function holdOnTitleState(hold: TerminalHold, state: TerminalTitleState): TerminalHold {
	if (!hold.awaitingStart) return hold;
	if (state === 'working' || state === 'attention') return { ...hold, awaitingStart: false, awaitingSince: null };
	return hold;
}

export function holdOnProgress(hold: TerminalHold, active: boolean): TerminalHold {
	if (hold.progressActive === active) return hold;
	return { ...hold, progressActive: active };
}

export function holdExpired(hold: TerminalHold, now: number): boolean {
	return hold.awaitingStart && hold.awaitingSince !== null && now - hold.awaitingSince >= TERMINAL_START_TIMEOUT_MS;
}

export function holdReset(): TerminalHold {
	return { ...INITIAL_TERMINAL_HOLD };
}
