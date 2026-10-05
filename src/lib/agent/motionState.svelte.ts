import { prefersReducedMotion } from 'svelte/motion';
import { settingsStore } from '$lib/stores/settings.svelte';

/** Durata dell'uscita del vassoio: allineata a --dur-tray in app.css. */
export const TRAY_EXIT_MS = 420;

/** Durata dell'uscita di una riga: allineata a --dur-row in app.css. */
export const ROW_EXIT_MS = 210;

/** Vero quando l'utente ha chiesto meno movimento (sistema o impostazioni di Studio). */
export function motionReduced(): boolean {
	return prefersReducedMotion.current || !settingsStore.accessibility.animations;
}

/**
 * Apertura di una sezione che segue una regola automatica finche' l'utente non
 * la cambia a mano; quando la regola cambia, la scelta manuale si azzera.
 * Il chiamante riporta la regola con `sync()` dentro un `$effect.pre`.
 */
export class AutoOpen {
	#auto = $state(false);
	#manual = $state<boolean | null>(null);

	constructor(auto = false) {
		this.#auto = auto;
	}

	get open(): boolean {
		return this.#manual ?? this.#auto;
	}

	sync(auto: boolean): void {
		if (auto === this.#auto) return;
		this.#auto = auto;
		this.#manual = null;
	}

	toggle(): void {
		this.#manual = !this.open;
	}
}

/**
 * Tiene in vita l'ultimo valore per il tempo dell'animazione d'uscita, cosi' una
 * sezione che sparisce puo' chiudersi invece di scomparire di colpo.
 * Il chiamante riporta il valore corrente con `update()` dentro un `$effect`.
 */
export class Lingering<T> {
	shown = $state<T | undefined>(undefined);
	leaving = $state(false);
	#timer: number | undefined;
	readonly #exitMs: number;

	/** `exitMs` deve coincidere con la durata dell'animazione d'uscita usata dal chiamante. */
	constructor(exitMs = TRAY_EXIT_MS) {
		this.#exitMs = exitMs;
	}

	update(value: T | undefined): void {
		clearTimeout(this.#timer);
		if (value !== undefined) {
			this.shown = value;
			this.leaving = false;
			return;
		}
		if (this.shown === undefined) return;
		if (motionReduced()) {
			this.shown = undefined;
			this.leaving = false;
			return;
		}
		this.leaving = true;
		this.#timer = window.setTimeout(() => {
			this.shown = undefined;
			this.leaving = false;
		}, this.#exitMs);
	}

	dispose(): void {
		clearTimeout(this.#timer);
	}
}
