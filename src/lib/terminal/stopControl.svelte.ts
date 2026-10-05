import type { TerminalSession } from './terminal';

/**
 * Arresto a due tempi del terminale: il primo colpo manda Ctrl+C a omp, un
 * secondo entro `ARM_MS` forza l'arresto del processo. Vive fuori da
 * `Terminal.svelte` perche' il pulsante sta nella testata della colonna e non
 * sopra la viewport (PRODUCT principio 1, D6), mentre il menu contestuale
 * resta nel terminale: entrambi devono vedere lo stesso stato armato.
 */
export class TerminalStopControl {
	static readonly ARM_MS = 2000;

	working = $state(false);
	armed = $state(false);
	#timer: number | undefined;
	readonly #session: () => TerminalSession | null;

	constructor(session: () => TerminalSession | null) {
		this.#session = session;
	}

	/** Lo Stop serve finche' l'agente lavora o il secondo colpo e' in attesa. */
	get visible(): boolean {
		return this.working || this.armed;
	}

	setWorking(working: boolean) {
		this.working = working;
		// A turno concluso il secondo colpo non avrebbe piu' niente da uccidere.
		if (!working) this.disarm();
	}

	press() {
		const session = this.#session();
		if (!this.armed) {
			void session?.interrupt();
			this.armed = true;
			this.#clearTimer();
			this.#timer = window.setTimeout(() => {
				this.#timer = undefined;
				this.armed = false;
			}, TerminalStopControl.ARM_MS);
			return;
		}
		this.disarm();
		void session?.forceKill();
	}

	disarm() {
		this.#clearTimer();
		this.armed = false;
	}

	#clearTimer() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}
}
