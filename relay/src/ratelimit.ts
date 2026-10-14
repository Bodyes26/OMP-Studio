/**
 * Tracciamento dei tentativi di autenticazione falliti.
 * Finestra scorrevole di 15 minuti.
 *
 * Per gli endpoint di abbinamento (codici brevi di 8 caratteri suscettibili a brute-force):
 * massimo 10 fallimenti per client key e massimo 100 fallimenti a livello globale.
 *
 * Per i socket WebSocket (segreti a 256 bit): il controllo credenziali avviene prima;
 * i tentativi non validi contano solo per il limite per-client (10 fallimenti),
 * senza mai bloccare il relay a livello globale per evitare che tentativi anonimi
 * impediscano la riconnessione di macchine o client legittimi.
 */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_CLIENT_FAILURES = 10;
export const MAX_GLOBAL_FAILURES = 100;

export class RateLimiter {
	private readonly clientPairingFailures = new Map<string, number[]>();
	private globalPairingFailures: number[] = [];
	private readonly clientWsFailures = new Map<string, number[]>();

	/** Verifica se la richiesta di abbinamento ha superato la soglia locale o globale. */
	isPairingRateLimited(clientKey: string, now: number): boolean {
		this.prune(now);
		if (this.globalPairingFailures.length >= MAX_GLOBAL_FAILURES) return true;
		const times = this.clientPairingFailures.get(clientKey);
		if (times && times.length >= MAX_CLIENT_FAILURES) return true;
		return false;
	}

	/** Registra un fallimento di abbinamento per il client e nel contatore globale. */
	recordPairingFailure(clientKey: string, now: number): void {
		this.prune(now);
		this.globalPairingFailures.push(now);
		const times = this.clientPairingFailures.get(clientKey) ?? [];
		times.push(now);
		this.clientPairingFailures.set(clientKey, times);
	}

	/**
	 * Verifica se il client ha superato la soglia di fallimenti WebSocket.
	 * Nessun limite globale qui, per non bloccare mai le credenziali valide di altri client.
	 */
	isWsRateLimited(clientKey: string, now: number): boolean {
		this.prune(now);
		const times = this.clientWsFailures.get(clientKey);
		if (times && times.length >= MAX_CLIENT_FAILURES) return true;
		return false;
	}

	/** Registra un fallimento WebSocket esclusivamente per la chiave client specifica. */
	recordWsFailure(clientKey: string, now: number): void {
		this.prune(now);
		const times = this.clientWsFailures.get(clientKey) ?? [];
		times.push(now);
		this.clientWsFailures.set(clientKey, times);
	}


	/** Rimuove i dati storici (utilizzato nei test per isolare i casi). */
	reset(): void {
		this.clientPairingFailures.clear();
		this.globalPairingFailures = [];
		this.clientWsFailures.clear();
	}

	private prune(now: number): void {
		const cutoff = now - RATE_LIMIT_WINDOW_MS;
		this.globalPairingFailures = this.globalPairingFailures.filter((t) => t >= cutoff);
		this.pruneMap(this.clientPairingFailures, cutoff);
		this.pruneMap(this.clientWsFailures, cutoff);
	}

	private pruneMap(map: Map<string, number[]>, cutoff: number): void {
		for (const [key, times] of map.entries()) {
			const filtered = times.filter((t) => t >= cutoff);
			if (filtered.length === 0) {
				map.delete(key);
			} else {
				map.set(key, filtered);
			}
		}
	}
}

/** Estrae la chiave del client dall'header X-Forwarded-For (voce piu' a destra) o dall'IP di connessione. */
export function extractClientKey(req: Request, serverIp?: string | null): string {
	const xff = req.headers.get('x-forwarded-for');
	if (xff) {
		const parts = xff.split(',');
		const rightmost = parts[parts.length - 1]?.trim();
		if (rightmost) return rightmost;
	}
	return serverIp?.trim() || '127.0.0.1';
}
