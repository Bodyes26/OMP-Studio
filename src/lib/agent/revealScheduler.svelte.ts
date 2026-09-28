// Scheduler a rune per la rivelazione del testo (Gate R32 - C05).
// Guscio reattivo sopra `RevealEngine` (motore puro e provato): specchia i
// campi in `$state` per il template e deriva la modalita' da impostazioni e
// movimento ridotto. La logica di temporizzazione vive nel motore.

import { motionReduced } from './motionState.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { RevealEngine, type RevealEngineMode } from './revealEngine';
import type { RevealResult } from './reveal';
export type RevealMode = RevealEngineMode;

export class RevealScheduler {
	revealedCount = $state(0);
	settled = $state(true);
	ghostLines = $state<Array<{ width: number }>>([]);
	parsed = $state<RevealResult | null>(null);

	#engine = new RevealEngine();

	constructor() {
		this.#engine.onChange = () => {
			this.revealedCount = this.#engine.revealedCount;
			this.settled = this.#engine.settled;
			this.ghostLines = this.#engine.ghostLines;
			this.parsed = this.#engine.parsed;
		};
	}

	get effectiveMode(): RevealMode {
		const configured = settingsStore.general.chatReveal;
		if (configured === 'blur' && motionReduced()) {
			return 'stream';
		}
		return configured;
	}

	update(key: string, text: string, streaming: boolean): void {
		this.#engine.update(key, text, streaming, this.effectiveMode);
		this.revealedCount = this.#engine.revealedCount;
		this.settled = this.#engine.settled;
		this.ghostLines = this.#engine.ghostLines;
		this.parsed = this.#engine.parsed;
	}

	reset(): void {
		this.#engine.reset();
		this.revealedCount = 0;
		this.settled = true;
		this.ghostLines = [];
		this.parsed = null;
	}

	dispose(): void {
		this.#engine.dispose();
	}
}
