// Motore di schedulazione della rivelazione, senza dipendenze da Svelte.
// La temporizzazione e' iniettabile, cosi' le transizioni sono provate nei test
// (`test/reveal.test.ts`). Il wrapper a rune (`revealScheduler.svelte.ts`)
// specchia questi campi in `$state` per il template.
//
// Due invarianze, entrambe regressioni gia' viste in review:
// - la chiave del blocco attivo: cambiando blocco di testo (stessa entry,
//   nuovo indice) lo stato riparte da zero, altrimenti il secondo blocco
//   resterebbe statico perche' `settled` e' ancora vero dal primo;
// - `done` e' un campo consultato dai callback, mai catturato alla
//   schedulazione: se lo stream finisce con un timer in attesa, il motore
//   assesta comunque invece di restare appeso con `done = false`.

import { parseReveal, computeGhostLines, type RevealResult } from './reveal';

export type RevealEngineMode = 'blur' | 'stream' | 'final';

export interface RevealTimers {
	setTimeout(cb: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	now(): number;
}
const defaultTimers: RevealTimers = {
	setTimeout: (cb, ms) => setTimeout(cb, ms),
	clearTimeout: (handle) => clearTimeout(handle as number),
	now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
};

/** Intervallo tra unita', dimezzato con arretrato > 2. */
export const REVEAL_UNIT_GAP_MS = 140;
/** Attesa dopo l'ultima animazione prima della resa statica (700 blur + 60). */
export const REVEAL_SETTLE_MS = 760;

export class RevealEngine {
	revealedCount = 0;
	settled = true;
	ghostLines: Array<{ width: number }> = [];
	parsed: RevealResult | null = null;
	done = false;
	onChange: (() => void) | null = null;

	#key = '';
	#hasStreamed = false;
	#unitTimer: unknown = null;
	#settleTimer: unknown = null;
	#lastAt = 0;
	#timers: RevealTimers;

	constructor(timers: RevealTimers = defaultTimers) {
		this.#timers = timers;
	}

	get activeKey(): string {
		return this.#key;
	}

	reset(): void {
		this.#clearTimers();
		this.#key = '';
		this.#hasStreamed = false;
		this.revealedCount = 0;
		this.settled = true;
		this.done = false;
		this.parsed = null;
		this.ghostLines = [];
		this.#lastAt = 0;
		this.#notify();
	}

	update(key: string, text: string, streaming: boolean, mode: RevealEngineMode): void {
		if (key !== this.#key) {
			this.reset();
			this.#key = key;
		}
		if (streaming) {
			if (!this.#hasStreamed) {
				this.#hasStreamed = true;
				this.settled = false;
			}
		} else if (!this.#hasStreamed) {
			this.settled = true;
			this.#notify();
			return;
		} else if (this.settled) {
			return;
		}

		if (mode === 'stream') {
			// Resa grezza incrementale senza animazioni: niente timer in sospeso.
			this.#clearTimers();
			this.settled = true;
			this.#notify();
			return;
		}
		if (mode === 'final') {
			this.#clearTimers();
			this.settled = !streaming;
			this.#notify();
			return;
		}

		this.done = !streaming;
		this.parsed = parseReveal(text, this.done);
		this.ghostLines = computeGhostLines(this.parsed.pendingChars(this.revealedCount));
		this.#pump();
		this.#notify();
	}

	dispose(): void {
		this.#clearTimers();
	}

	#pump(): void {
		if (this.settled || !this.parsed) return;
		const parsed = this.parsed;
		if (this.revealedCount < parsed.completeUnits) {
			if (this.#unitTimer !== null) return;
			const backlog = parsed.completeUnits - this.revealedCount;
			const gap = this.revealedCount === 0 ? 0 : REVEAL_UNIT_GAP_MS / (backlog > 2 ? 2 : 1);
			const wait = Math.max(0, this.#lastAt + gap - this.#timers.now());
			this.#unitTimer = this.#timers.setTimeout(() => {
				this.#unitTimer = null;
				this.#lastAt = this.#timers.now();
				this.revealedCount += 1;
				const current = this.parsed;
				if (current) {
					this.ghostLines = computeGhostLines(current.pendingChars(this.revealedCount));
					// Riparte da `done` e `parsed` correnti, non da quelli catturati.
					this.#pump();
				}
				this.#notify();
			}, wait);
		} else if (this.done && this.revealedCount >= parsed.totalUnits) {
			if (this.#settleTimer === null) {
				this.#settleTimer = this.#timers.setTimeout(() => {
					this.#settleTimer = null;
					this.settled = true;
					this.#notify();
				}, REVEAL_SETTLE_MS);
			}
		}
	}

	#clearTimers(): void {
		if (this.#unitTimer !== null) {
			this.#timers.clearTimeout(this.#unitTimer);
			this.#unitTimer = null;
		}
		if (this.#settleTimer !== null) {
			this.#timers.clearTimeout(this.#settleTimer);
			this.#settleTimer = null;
		}
	}

	#notify(): void {
		this.onChange?.();
	}
}
