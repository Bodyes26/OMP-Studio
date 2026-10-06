/**
 * Cadenza delle letture di stato GitHub Actions.
 *
 * Il pannello Git si rinfresca ogni 15 s (e a ogni evento dell'agente) per
 * leggere lo stato locale, che costa uno spawn di git. Lo stato della CI invece
 * passa dall'API di GitHub, che ha un limite orario per token: interrogarla allo
 * stesso ritmo consumava la quota senza dare informazioni nuove, perche' una
 * build cambia stato in minuti, non in secondi. Il cancello lascia passare una
 * lettura per progetto e branch al massimo ogni `intervalMs`, salvo le richieste
 * esplicite dell'utente (sync, push, riprova).
 */
export const ACTIONS_POLL_INTERVAL_MS = 60_000;

export class ActionsPollGate {
	private lastAt = new Map<string, number>();
	private readonly intervalMs: number;

	constructor(intervalMs = ACTIONS_POLL_INTERVAL_MS) {
		this.intervalMs = intervalMs;
	}

	/**
	 * Decide se leggere ora e, in caso affermativo, registra la lettura.
	 * La chiave include il branch: dopo un checkout la CI da mostrare e' un'altra
	 * e aspettare il minuto lascerebbe a video quella del branch precedente.
	 */
	tryAcquire(key: string, now: number, force = false): boolean {
		const last = this.lastAt.get(key);
		if (!force && last !== undefined && now - last < this.intervalMs) return false;
		// Anche una lettura che poi fallisce conta: un repository senza remoto
		// GitHub o un token scaduto non devono generare una chiamata ogni 15 s.
		this.lastAt.set(key, now);
		return true;
	}
}
