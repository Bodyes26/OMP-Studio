// Arbitro dell'avvio automatico della coda (Gate R12 / R27).
//
// Il cancello (`automationGate.ts`) dice se un task *potrebbe* partire
// adesso. L'auto-avvio pero' non puo' fidarsi di un istante: lo stato della
// sessione passa per pause brevissime (fine di un giro di tool, attesa di un
// nuovo tentativo, prompt ammesso ma run non ancora partito) che sembrano
// quiete. Prima di questo modulo l'effetto spediva al primo `ready` con un
// `queueMicrotask`, e un solo frame bastava a far partire il task successivo
// con un `new_session` sopra il run vivo.
//
// Regole:
// 1. Stabilita': un candidato parte solo dopo `stableMs` di idoneita'
//    continuata. Ogni volta che il cancello si chiude (il candidato sparisce
//    da `sync`) il conto riparte da zero. Per la GUI conta anche il tempo
//    dall'ultimo evento del ciclo di vita del run (`quietForMs`).
// 2. Ri-verifica: allo scadere si richiede uno snapshot autorevole
//    (`get_state` per la GUI, stato del PTY per la TUI) e si ricontrolla il
//    cancello. Se non e' quieto si riprova dopo `retryMs`, senza spedire.
// 3. Lock per progetto: dalla ri-verifica alla consegna nessun altro
//    candidato dello stesso progetto viene valutato. Il rilascio chiede un
//    nuovo giro (`requestResync`), perche' l'effetto che chiama `sync` non
//    si riaccende da solo se lo stato non e' cambiato.
// 4. Un task la cui consegna fallisce resta fuori per `failureCooldownMs`:
//    rispedirlo in un ciclo stretto riempirebbe la chat di errori.
//
// Modulo puro: orologio e timer sono iniettati, i test li simulano.

export const AUTO_DISPATCH_STABLE_MS = 2_500;
/** La TUI non ha eventi: il titolo deve restare `idle` un po' di piu'. */
export const AUTO_DISPATCH_STABLE_MS_TERMINAL = 3_000;
export const AUTO_DISPATCH_RETRY_MS = 5_000;
export const AUTO_DISPATCH_FAILURE_COOLDOWN_MS = 30_000;

export interface AutoDispatchCandidate {
	projectId: string;
	taskId: string;
	/** Il task va in una corsia worktree nuova (Principale occupata). */
	newLane: boolean;
}

export type AutoDispatchOutcome = 'delivered' | 'failed';

export interface AutoDispatchDeps {
	now(): number;
	setTimer(fn: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
	/** Idoneita' continuata richiesta per questo candidato. */
	stableMs(candidate: AutoDispatchCandidate): number;
	/**
	 * Millisecondi dall'ultimo evento di attivita' del bersaglio, o `null`
	 * quando non esiste un flusso di eventi (TUI, corsia nuova).
	 */
	quietForMs(candidate: AutoDispatchCandidate): number | null;
	/** Il candidato e' ancora quello giusto e il cancello e' ancora aperto (lettura sincrona). */
	stillEligible(candidate: AutoDispatchCandidate): boolean;
	/** Verifica autorevole e asincrona appena prima di spedire. */
	verify(candidate: AutoDispatchCandidate): Promise<boolean>;
	dispatch(candidate: AutoDispatchCandidate): Promise<AutoDispatchOutcome>;
	/** Chiede all'effetto un nuovo giro di `sync`. */
	requestResync(): void;
	retryMs?: number;
	failureCooldownMs?: number;
}

interface PendingEntry {
	candidate: AutoDispatchCandidate;
	readySince: number;
	timer: unknown;
}

function sameCandidate(a: AutoDispatchCandidate, b: AutoDispatchCandidate): boolean {
	return a.projectId === b.projectId && a.taskId === b.taskId && a.newLane === b.newLane;
}

export class AutoDispatchArbiter {
	private readonly pending = new Map<string, PendingEntry>();
	private readonly locked = new Set<string>();
	private readonly cooldownUntil = new Map<string, number>();
	/** Progetti la cui ri-verifica ha appena detto «non fermo»: niente `get_state` a raffica. */
	private readonly verifyHoldUntil = new Map<string, number>();
	private disposed = false;
	private readonly deps: AutoDispatchDeps;

	constructor(deps: AutoDispatchDeps) {
		this.deps = deps;
	}

	/**
	 * Candidati idonei *adesso*, uno per progetto. Chiamato dall'effetto a
	 * ogni cambiamento: non scrive stato reattivo, arma e disarma timer.
	 */
	sync(candidates: readonly AutoDispatchCandidate[]): void {
		if (this.disposed) return;
		const now = this.deps.now();
		const seen = new Set<string>();
		for (const candidate of candidates) {
			if (this.locked.has(candidate.projectId)) {
				seen.add(candidate.projectId);
				continue;
			}
			const hold = this.verifyHoldUntil.get(candidate.projectId);
			if (hold !== undefined) {
				if (now < hold) continue;
				this.verifyHoldUntil.delete(candidate.projectId);
			}
			const until = this.cooldownUntil.get(candidate.taskId);
			if (until !== undefined) {
				if (now < until) continue;
				this.cooldownUntil.delete(candidate.taskId);
			}
			seen.add(candidate.projectId);
			const existing = this.pending.get(candidate.projectId);
			if (existing && sameCandidate(existing.candidate, candidate)) continue;
			if (existing) this.deps.clearTimer(existing.timer);
			this.arm(candidate, now, this.deps.stableMs(candidate));
		}
		for (const [projectId, entry] of this.pending) {
			if (seen.has(projectId)) continue;
			// Il cancello si e' chiuso: la quiete va ricominciata da capo.
			this.deps.clearTimer(entry.timer);
			this.pending.delete(projectId);
		}
	}

	/** Un progetto ha una spedizione automatica in corso (ri-verifica o consegna). */
	isLocked(projectId: string): boolean {
		return this.locked.has(projectId);
	}

	/** Un candidato aspetta che scada il periodo di stabilita'. */
	isPending(projectId: string): boolean {
		return this.pending.has(projectId);
	}

	dispose(): void {
		this.disposed = true;
		for (const entry of this.pending.values()) this.deps.clearTimer(entry.timer);
		this.pending.clear();
	}

	private arm(candidate: AutoDispatchCandidate, readySince: number, delay: number): void {
		const timer = this.deps.setTimer(() => void this.fire(candidate.projectId), Math.max(0, delay));
		this.pending.set(candidate.projectId, { candidate, readySince, timer });
	}

	private async fire(projectId: string): Promise<void> {
		const entry = this.pending.get(projectId);
		if (!entry || this.disposed) return;
		this.pending.delete(projectId);
		const { candidate } = entry;
		if (this.locked.has(projectId)) return;
		if (!this.deps.stillEligible(candidate)) {
			this.deps.requestResync();
			return;
		}

		const stableMs = this.deps.stableMs(candidate);
		const quiet = this.deps.quietForMs(candidate);
		if (quiet !== null && quiet < stableMs) {
			// Il cancello e' rimasto aperto ma l'agente ha emesso eventi: la
			// quiete conta dall'ultimo, non dal primo `ready`.
			this.arm(candidate, entry.readySince, stableMs - quiet);
			return;
		}

		this.locked.add(projectId);
		let resyncAfterMs = 0;
		try {
			const quietNow = await this.deps.verify(candidate);
			if (this.disposed) return;
			if (!quietNow || !this.deps.stillEligible(candidate)) {
				// Lo stato autorevole dice che non e' fermo: nessun invio. Se il
				// cancello locale resta aperto (snapshot uguale) l'effetto non si
				// riaccenderebbe: si riprova piu' tardi.
				resyncAfterMs = this.deps.retryMs ?? AUTO_DISPATCH_RETRY_MS;
				this.verifyHoldUntil.set(projectId, this.deps.now() + resyncAfterMs);
				return;
			}
			const outcome = await this.deps.dispatch(candidate).catch((): AutoDispatchOutcome => 'failed');
			if (outcome === 'failed') {
				const cooldown = this.deps.failureCooldownMs ?? AUTO_DISPATCH_FAILURE_COOLDOWN_MS;
				this.cooldownUntil.set(candidate.taskId, this.deps.now() + cooldown);
				resyncAfterMs = cooldown;
			}
		} finally {
			this.locked.delete(projectId);
			if (!this.disposed) {
				this.deps.requestResync();
				if (resyncAfterMs > 0) this.deps.setTimer(() => this.deps.requestResync(), resyncAfterMs);
			}
		}
	}
}
