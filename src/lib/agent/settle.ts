/**
 * Fine lavoro «vera» della sessione: yield contro quiete (omp 18.8,
 * `docs/rpc.md` § «Yield vs settled»).
 *
 * `agent_end` dice che l'agente ha chiuso il suo turno (yield). La sessione
 * pero' e' finita solo quando nulla puo' piu' risvegliarla: nessun run vivo,
 * nessuno steer/follow-up in coda, nessun job in background (bash
 * auto-backgrounded, `task` asincroni, `eval`) che consegnera' un risultato e
 * fara' partire un altro turno. Quel momento omp lo annuncia con
 * `session_settled`, lo anticipa in `prompt_result.sessionSettled` e lo
 * riporta in `get_state.isSettled` per chi si attacca a meta'.
 *
 * Studio usa la quiete per tutto cio' che significa «ha finito davvero»:
 * stato `finished` del progetto (annuncio, companion, pallino), avvio
 * automatico della coda dei task. La risposta del turno resta legata al
 * yield: il composer si libera e il piè di turno compare subito.
 *
 * Compatibilita': un omp che non conosce la quiete non manda mai
 * `session_settled` ne' `isSettled`. Finche' nessuno dei due e' stato visto
 * (`aware: false`) lo yield vale anche come quiete, cioe' il comportamento di
 * prima.
 */

import type { AgentSessionEvent, RpcSessionState } from './wire';

export interface SettleState {
	/** omp ha dimostrato di riportare la quiete (`isSettled` o `session_settled` visti). */
	aware: boolean;
	/** Nessun lavoro che possa risvegliare la sessione. */
	settled: boolean;
	/**
	 * Un run e' vivo (da `agent_start` allo yield). Serve a distinguere il
	 * background dalla pausa fra due giri di tool dello stesso run, quando
	 * Studio spegne `isStreaming` su `turn_end`.
	 */
	running: boolean;
}

export const INITIAL_SETTLE: SettleState = { aware: false, settled: true, running: false };

/** Un run e' partito: la sessione non e' piu' quieta. */
export function settleOnAgentStart(state: SettleState): SettleState {
	return { ...state, settled: false, running: true };
}

/**
 * L'agente ha ceduto il turno. Senza supporto alla quiete lo yield e' anche
 * la fine; con il supporto si aspetta `session_settled`.
 */
export function settleOnYield(state: SettleState): SettleState {
	return { ...state, running: false, settled: state.aware ? state.settled : true };
}

export function settleOnSessionSettled(): SettleState {
	return { aware: true, settled: true, running: false };
}

/**
 * `prompt_result` porta la quiete al momento dello yield. Solo `true` conta:
 * `false` per un prompt che non ha mai raggiunto l'agente non sarebbe seguito
 * da nessun `session_settled`, e lascerebbe la sessione «al lavoro» per sempre.
 */
export function settleOnPromptResult(state: SettleState, event: AgentSessionEvent): SettleState {
	if (typeof event.sessionSettled !== 'boolean') return state;
	if (event.sessionSettled) return { aware: true, settled: true, running: false };
	return { ...state, aware: true };
}

/**
 * `get_state` e' lo snapshot autorevole quando porta `isSettled`. Il suo
 * `isStreaming` (del run, non del giro di tool) dice anche se un run e' vivo:
 * serve a chi si attacca a meta' senza aver visto `agent_start`.
 */
export function settleFromState(
	state: SettleState,
	snapshot: Pick<RpcSessionState, 'isSettled' | 'hasPendingAsyncWork' | 'isStreaming'> | null | undefined
): SettleState {
	if (!snapshot || typeof snapshot.isSettled !== 'boolean') return state;
	const running = typeof snapshot.isStreaming === 'boolean' ? snapshot.isStreaming : state.running;
	return { aware: true, settled: snapshot.isSettled, running: snapshot.isSettled ? false : running };
}

/**
 * Un `agent_end` non terminale che aspetta solo un job in background e' a
 * tutti gli effetti un turno concluso: l'agente ha risposto, e a risvegliarlo
 * sara' (forse) il risultato del job. Lo si tratta come yield solo se omp
 * riporta anche la quiete, altrimenti nessuno direbbe a Studio quando il job
 * ha finito e si torna al comportamento precedente (attesa del prossimo
 * `agent_end`).
 */
export function isBackgroundYield(state: SettleState, event: AgentSessionEvent): boolean {
	return state.aware && event.isTerminal === false && event.awaitingAsyncWork === true && event.yielded !== false;
}

/** Il turno e' finito ma omp ha ancora lavoro che puo' risvegliare la sessione. */
export function isBackgroundPending(state: SettleState, streaming: boolean): boolean {
	return state.aware && !state.settled && !state.running && !streaming;
}

/* --------------------------------------------------------- prompt_result */

export interface PromptResultError {
	message: string;
	provider?: string;
	model?: string;
	httpStatus?: number;
	retryable: boolean;
}

/**
 * Errore del provider da un `prompt_result` con `status: "error"`, se il
 * prompt ha raggiunto l'agente. Un prompt fallito prima di arrivarci ha gia'
 * avuto la risposta d'errore legacy, che Studio mostra al rifiuto dell'invio:
 * ripeterlo sarebbe un doppione.
 */
export function promptResultError(event: AgentSessionEvent): PromptResultError | null {
	if (event.type !== 'prompt_result' || event.status !== 'error') return null;
	if (event.agentInvoked !== true) return null;
	// `error` qui e' un oggetto, non la stringa degli eventi `error`/`agent_error`.
	const raw: unknown = (event as Record<string, unknown>).error;
	if (!raw || typeof raw !== 'object') return null;
	const rec = raw as Record<string, unknown>;
	const message = typeof rec.message === 'string' ? rec.message.trim() : '';
	if (!message) return null;
	return {
		message,
		provider: typeof rec.provider === 'string' && rec.provider ? rec.provider : undefined,
		model: typeof rec.model === 'string' && rec.model ? rec.model : undefined,
		httpStatus: typeof rec.httpStatus === 'number' ? rec.httpStatus : undefined,
		retryable: rec.retryable === true
	};
}
