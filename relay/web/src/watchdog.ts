/**
 * Watchdog dell'attesa in ingresso del client PWA (S10-09).
 *
 * Il relay manda un `ping` applicativo ogni 25 s e il client chiude il socket se
 * non arriva nulla entro `HEARTBEAT_TIMEOUT_MS` (70 s). Il conteggio non si puo'
 * fare "a timer che riparte da zero" quando la pagina va in background: il
 * sistema puo' sospendere i timer e trattenere i frame, quindi al ritorno un
 * timer scaduto sembrerebbe inattivita' e chiuderebbe un collegamento sano.
 * Qui il timer e' riarmato sull'orologio di parete e la decisione e' rinviata
 * finche' la pagina non e' di nuovo visibile.
 *
 * Orologio e timer sono iniettabili: i test usano un orologio finto e nessun DOM.
 */

export interface WatchdogClock {
	now(): number;
	/** Come `setTimeout`, ma con un handle numerico (quello di `window`). */
	set(fn: () => void, ms: number): number;
	clear(handle: number): void;
}

export interface WatchdogOptions {
	/** Attesa massima in ingresso prima di considerare morto il collegamento. */
	timeoutMs: number;
	/**
	 * Vero quando la pagina e' nascosta o il sistema puo' aver sospeso i timer.
	 * Consultato al momento dello scatto, non all'armamento: il timer puo'
	 * scattare prima che il gestore di `visibilitychange` abbia aggiornato lo
	 * stato.
	 */
	isSuspended: () => boolean;
	/** L'attesa e' davvero scaduta con la pagina attiva: c'e' da chiudere. */
	onTimeout: () => void;
	clock?: WatchdogClock;
}

const browserClock: WatchdogClock = {
	now: () => Date.now(),
	// `window.setTimeout` torna un intero nel browser; nei test basta il numero.
	set: (fn, ms) => window.setTimeout(fn, ms) as unknown as number,
	clear: (handle) => clearTimeout(handle)
};

export class InboundWatchdog {
	private readonly clock: WatchdogClock;
	private timer: number | null = null;
	/** Ultimo istante con una prova di vita in ingresso (frame o apertura). */
	private lastInboundAt = 0;
	/** La pagina e' andata in background dopo l'ultima prova di vita. */
	private suspended = false;

	constructor(private readonly options: WatchdogOptions) {
		this.clock = options.clock ?? browserClock;
	}

	/** Un frame e' arrivato (o il socket si e' appena aperto): finestra piena. */
	touch(): void {
		this.lastInboundAt = this.clock.now();
		this.suspended = false;
		this.arm(this.options.timeoutMs);
	}

	/** La pagina e' passata in background: l'attesa in ingresso non e' giudicabile. */
	suspend(): void {
		this.suspended = true;
	}

	/**
	 * La pagina e' tornata visibile: da qui l'attesa riparte da zero. Senza
	 * questo, il tempo passato nascosti conterebbe come inattivita'.
	 */
	resume(): void {
		this.touch();
	}

	/** Ferma il timer (socket chiuso): nessuna decisione pendente. */
	stop(): void {
		this.cancel();
		this.suspended = false;
	}

	/** Vero se c'e' un timer armato: usato dai test e dalla diagnostica. */
	get armed(): boolean {
		return this.timer !== null;
	}

	private arm(delayMs: number): void {
		this.cancel();
		this.timer = this.clock.set(() => this.fire(), Math.max(0, delayMs));
	}

	private cancel(): void {
		if (this.timer === null) return;
		this.clock.clear(this.timer);
		this.timer = null;
	}

	private fire(): void {
		this.timer = null;
		if (this.suspended || this.options.isSuspended()) {
			// Liveness non giudicabile: si riarma e si decide al primo controllo
			// con la pagina visibile (`resume` ridara' comunque una finestra piena).
			this.arm(this.options.timeoutMs);
			return;
		}
		const idle = this.clock.now() - this.lastInboundAt;
		if (idle < this.options.timeoutMs) {
			// Il timer e' scattato in anticipo (o `touch` e' arrivato a cavallo):
			// resta solo il tempo che manca davvero.
			this.arm(this.options.timeoutMs - idle);
			return;
		}
		this.options.onTimeout();
	}
}
