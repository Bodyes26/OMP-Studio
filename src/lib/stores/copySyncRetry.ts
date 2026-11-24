/**
 * Nuovi tentativi dei giri di sincronizzazione delle copie (R-MI-57).
 *
 * Regole pure, senza timer ne' finestra: quando un giro fallisce si riprova
 * con attesa crescente, e dopo tre fallimenti di fila si mostra UN avviso con
 * il motivo, che non si ripete finche' il motivo non cambia. Senza questa
 * regola un errore restava solo nel pannello (R-MI-57, «errori da evitare») e
 * un progetto irraggiungibile veniva ritentato a ogni secondo.
 */

/** Attesa dopo il primo fallimento; poi triplica, fino al tetto di 5 minuti. */
export const FIRST_RETRY_MS = 5_000;
export const MAX_RETRY_MS = 5 * 60_000;
/** Fallimenti di fila prima dell'avviso: due possono essere un caso. */
export const ALERT_AFTER_FAILURES = 3;

export interface SyncRetryState {
	/** Fallimenti consecutivi dall'ultimo successo. */
	failures: number;
	/** Istante prima del quale non si ritenta. */
	nextAt: number;
	/** Ultimo motivo visto: un motivo diverso merita un nuovo avviso. */
	lastReason: string | null;
	/** Motivo gia' annunciato: finche' non cambia non si ripete. */
	alertedReason: string | null;
}

export function emptySyncRetry(): SyncRetryState {
	return { failures: 0, nextAt: 0, lastReason: null, alertedReason: null };
}

/** Attesa dopo `failures` fallimenti consecutivi (5 s, 15 s, 45 s... cap 5 min). */
export function syncRetryDelay(failures: number): number {
	if (failures <= 0) return 0;
	const delay = FIRST_RETRY_MS * 3 ** (Math.min(failures, 8) - 1);
	return Math.min(delay, MAX_RETRY_MS);
}

export interface SyncFailureResult {
	state: SyncRetryState;
	/** Testo da mostrare una volta sola, quando il motivo e' nuovo. */
	alertReason: string | null;
}

/** Un giro fallito: pianifica il ritento e decide se l'avviso va mostrato. */
export function recordSyncFailure(
	previous: SyncRetryState,
	reason: string,
	now: number
): SyncFailureResult {
	const failures = previous.failures + 1;
	const state: SyncRetryState = {
		failures,
		nextAt: now + syncRetryDelay(failures),
		lastReason: reason,
		alertedReason: previous.alertedReason
	};
	const alertReason = failures >= ALERT_AFTER_FAILURES && previous.alertedReason !== reason
		? reason
		: null;
	if (alertReason !== null) state.alertedReason = reason;
	return { state, alertReason };
}

/** Un giro riuscito azzera contatore, attesa e memoria dell'avviso. */
export function recordSyncSuccess(): SyncRetryState {
	return emptySyncRetry();
}

/** E' ora di ritentare? `nextAt` si ignora finche' non c'e' un fallimento. */
export function syncDue(state: SyncRetryState, now: number): boolean {
	return state.failures === 0 || now >= state.nextAt;
}
