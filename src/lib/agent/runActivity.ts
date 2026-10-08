/**
 * Attivita' del run per l'avvio automatico della coda (GUI).
 *
 * Il cancello della coda leggeva `isStreaming` e `agentState`, che la
 * sessione spegne a ogni `turn_end`: fra un giro di tool e il successivo (e
 * durante l'attesa di un nuovo tentativo o di una compattazione che continua
 * il run) l'agente sembrava `Pronto` per qualche millisecondo o qualche
 * secondo, abbastanza perche' l'auto-avvio spedisse il task successivo con un
 * `new_session` sopra il run vivo. Stessa cosa subito dopo una consegna: omp
 * risponde al comando `prompt` all'*ammissione* del messaggio, prima della
 * preflight e di `agent_start`, e in quella finestra la sessione appena creata
 * risultava ferma.
 *
 * Questo modulo tiene i segnali che mancavano, senza rune ne' Tauri:
 *
 * - `awaitingRun`: un prompt e' stato ammesso ma il run non e' ancora partito;
 * - `retrying`: omp sta aspettando per ritentare la chiamata al modello;
 * - `lastActivityAt`: ultimo evento del ciclo di vita (non le voci di stato
 *   delle estensioni, che possono aggiornarsi a vuoto per sempre), per il
 *   periodo di quiete continuato richiesto prima di spedire.
 *
 * Il run vivo (`agent_start` fino allo yield) e' gia' in `settle.ts`
 * (`SettleState.running`). `verifyQuietSnapshot` e' la ri-verifica finale su
 * `get_state` appena prima dell'invio.
 */

import type { AgentSessionEvent, RpcSessionState } from './wire';

export interface RunActivity {
	/** Prompt ammesso da omp, `agent_start` non ancora visto. */
	awaitingRun: boolean;
	/** Quando e' iniziata l'attesa del run (per la scadenza di sicurezza). */
	awaitingSince: number | null;
	/** `auto_retry_start` senza il suo `auto_retry_end`. */
	retrying: boolean;
	/** Ultimo evento del ciclo di vita del run, in ms epoch. */
	lastActivityAt: number;
}

export const INITIAL_RUN_ACTIVITY: RunActivity = {
	awaitingRun: false,
	awaitingSince: null,
	retrying: false,
	lastActivityAt: 0
};

/**
 * Oltre questo tempo senza `agent_start` l'attesa del run si considera
 * caduta (prompt scartato da un omp che non manda `prompt_result`). La
 * compattazione prima del prompt ha un suo stato e non scade qui.
 */
export const AWAITING_RUN_TIMEOUT_MS = 30_000;

/**
 * Eventi che dicono «l'agente sta facendo qualcosa». Restano fuori di
 * proposito `extension_ui_request` di stato/widget, `notice`, i comandi
 * disponibili e gli aggiornamenti di costo: un'estensione che aggiorna un
 * orologio nella riga di stato non deve tenere ferma la coda per sempre.
 */
const ACTIVITY_EVENTS = new Set<string>([
	'agent_start',
	'agent_end',
	'turn_start',
	'turn_end',
	'message_start',
	'message_update',
	'message_end',
	'tool_execution_start',
	'tool_execution_update',
	'tool_execution_end',
	'tool_stream_update',
	'auto_compaction_start',
	'auto_compaction_end',
	'auto_retry_start',
	'auto_retry_end',
	'retry_fallback_applied',
	'retry_fallback_succeeded',
	'queue_update',
	'prompt_result',
	'session_settled',
	'subagent_lifecycle',
	'subagent_progress',
	'studio_delta'
]);

export function isRunActivityEvent(type: string | undefined): boolean {
	return typeof type === 'string' && ACTIVITY_EVENTS.has(type);
}

/** Studio ha consegnato un prompt a una sessione ferma: il run sta per partire. */
export function runActivityOnPromptSent(state: RunActivity, now: number): RunActivity {
	return { ...state, awaitingRun: true, awaitingSince: now, lastActivityAt: now };
}

/** Il prompt non avviera' nessun run (comando locale, invio rifiutato). */
export function runActivityOnPromptDropped(state: RunActivity): RunActivity {
	if (!state.awaitingRun) return state;
	return { ...state, awaitingRun: false, awaitingSince: null };
}

/** Nuova chat o processo nuovo: nulla di quanto atteso appartiene piu' a questa sessione. */
export function runActivityReset(state: RunActivity, now: number): RunActivity {
	return { awaitingRun: false, awaitingSince: null, retrying: false, lastActivityAt: Math.max(state.lastActivityAt, now) };
}

export function reduceRunActivity(state: RunActivity, event: AgentSessionEvent, now: number): RunActivity {
	const type = event.type;
	let next = state;
	if (isRunActivityEvent(type)) next = { ...next, lastActivityAt: now };
	switch (type) {
		case 'agent_start':
			if (next.awaitingRun) next = { ...next, awaitingRun: false, awaitingSince: null };
			return next;
		case 'auto_retry_start':
			return { ...next, retrying: true };
		case 'auto_retry_end':
			return next.retrying ? { ...next, retrying: false } : next;
		case 'agent_end':
			// Un `agent_end` non terminale e' proprio la pausa prima del nuovo
			// tentativo: il retry resta aperto. Quello terminale chiude tutto.
			if (event.isTerminal === false) return next;
			return next.retrying || next.awaitingRun
				? { ...next, retrying: false, awaitingRun: false, awaitingSince: null }
				: next;
		case 'prompt_result':
			// L'esito del prompt chiude l'attesa: o il run e' partito (e lo yield
			// e' gia' passato), o il prompt non ha mai raggiunto l'agente.
			return next.awaitingRun ? { ...next, awaitingRun: false, awaitingSince: null } : next;
		case 'error':
		case 'agent_error':
		case 'studio_error':
		case 'studio_exit':
			return { ...next, awaitingRun: false, awaitingSince: null, retrying: false };
		default:
			return next;
	}
}

/** L'attesa del run e' scaduta senza che nulla sia partito. */
export function awaitingRunExpired(state: RunActivity, now: number): boolean {
	return state.awaitingRun && state.awaitingSince !== null && now - state.awaitingSince >= AWAITING_RUN_TIMEOUT_MS;
}

/** Da quanto non arriva un evento del ciclo di vita. */
export function quietForMs(state: RunActivity, now: number): number {
	return Math.max(0, now - state.lastActivityAt);
}

/* ------------------------------------------------ ri-verifica su get_state */

export type QuietVerdict =
	| { quiet: true }
	| { quiet: false; reason: 'streaming' | 'compacting' | 'queue' | 'background' };

/**
 * Ultima parola prima di spedire un task: lo snapshot di `get_state`, che e'
 * l'autorita' di omp. `isStreaming` qui e' quello del run (non del giro di
 * tool), `isSettled` (omp 18.8+) copre anche run ammessi ma non ancora
 * partiti, continuazioni programmate, coda e job in background. Con un omp
 * piu' vecchio restano `isStreaming`, `isCompacting` e la coda.
 */
export function verifyQuietSnapshot(
	snapshot: Pick<
		RpcSessionState,
		'isStreaming' | 'isCompacting' | 'isSettled' | 'hasPendingAsyncWork' | 'queuedMessageCount'
	> | null | undefined
): QuietVerdict {
	if (!snapshot) return { quiet: false, reason: 'streaming' };
	if (snapshot.isStreaming === true) return { quiet: false, reason: 'streaming' };
	if (snapshot.isCompacting === true) return { quiet: false, reason: 'compacting' };
	if (typeof snapshot.queuedMessageCount === 'number' && snapshot.queuedMessageCount > 0) {
		return { quiet: false, reason: 'queue' };
	}
	if (snapshot.hasPendingAsyncWork === true || snapshot.isSettled === false) {
		return { quiet: false, reason: 'background' };
	}
	return { quiet: true };
}
