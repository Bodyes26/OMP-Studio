// Stop a due stadi della chat: il primo clic chiede a omp di interrompere il
// turno; se l'agente non si ferma entro `GRACE_MS` il pulsante si arma come
// «Forza arresto» e il secondo clic termina il processo.
//
// Diverso dal terminale (src/lib/terminal/stopControl.svelte.ts), che si arma
// subito e si disarma da solo: li' Ctrl+C e' immediato e visibile, qui l'esito
// dell'abort arriva solo con `agent_end`, quindi l'escalation ha senso solo
// quando quel frame tarda. Modulo puro: niente rune, timer iniettabili.

export interface TwoStepStopDeps {
	abort(): unknown;
	forceKill(): unknown;
	/** Notifica il cambio dello stato armato (il componente lo copia in `$state`). */
	onChange?(armed: boolean): void;
	setTimer?(callback: () => void, ms: number): unknown;
	clearTimer?(handle: unknown): void;
}

export type TwoStepStopAction = 'abort' | 'force' | 'waiting';

export class TwoStepStop {
	/** Attesa di `agent_end` dopo l'abort prima di offrire l'arresto forzato. */
	static readonly GRACE_MS = 2000;

	#armed = false;
	#timer: unknown = null;
	readonly #deps: TwoStepStopDeps;
	readonly #graceMs: number;

	constructor(deps: TwoStepStopDeps, graceMs = TwoStepStop.GRACE_MS) {
		this.#deps = deps;
		this.#graceMs = graceMs;
	}

	get armed(): boolean {
		return this.#armed;
	}

	/** Vero tra il primo clic e l'armamento: l'abort e' partito, si aspetta omp. */
	get waiting(): boolean {
		return this.#timer !== null;
	}

	press(): TwoStepStopAction {
		if (this.#armed) {
			this.settle();
			void this.#deps.forceKill();
			return 'force';
		}
		// Un secondo clic durante l'attesa non ripete l'abort e non salta
		// l'attesa: il processo va ucciso solo se l'abort non ha funzionato.
		if (this.#timer !== null) return 'waiting';
		void this.#deps.abort();
		const setTimer = this.#deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
		this.#timer = setTimer(() => {
			this.#timer = null;
			this.#setArmed(true);
		}, this.#graceMs);
		return 'abort';
	}

	/** L'agente si e' fermato (agent_end, processo uscito): niente piu' da forzare. */
	settle(): void {
		if (this.#timer !== null) {
			const clearTimer = this.#deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
			clearTimer(this.#timer);
			this.#timer = null;
		}
		this.#setArmed(false);
	}

	#setArmed(armed: boolean): void {
		if (this.#armed === armed) return;
		this.#armed = armed;
		this.#deps.onChange?.(armed);
	}
}
