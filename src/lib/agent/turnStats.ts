/**
 * Velocita' di generazione di un turno (token al secondo).
 *
 * omp scrive su ogni messaggio assistente `duration` (richiesta intera) e
 * `ttft` (attesa del primo token), in ms. Il tempo di generazione e' la
 * differenza: con il solo `duration` la latenza di rete abbasserebbe i t/s
 * delle risposte brevi. Un turno ha piu' messaggi (uno per giro di tool):
 * si sommano token e tempi, non si fa la media dei rapporti.
 */

export function generationMs(message: { duration?: number; ttft?: number }): number | undefined {
	const { duration, ttft } = message;
	if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return undefined;
	const wait = typeof ttft === 'number' && Number.isFinite(ttft) && ttft > 0 && ttft < duration ? ttft : 0;
	return duration - wait;
}

export class TurnSpeed {
	private tokens = 0;
	private ms = 0;

	add(outputTokens: number | undefined, genMs: number | undefined): void {
		if (!outputTokens || outputTokens <= 0 || !genMs || genMs <= 0) return;
		this.tokens += outputTokens;
		this.ms += genMs;
	}

	/** `undefined` senza campioni: niente t/s inventati per messaggi senza durata. */
	get tokensPerSecond(): number | undefined {
		return this.ms > 0 ? this.tokens / (this.ms / 1000) : undefined;
	}
}

export function formatTokensPerSecond(value: number): string {
	return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}
