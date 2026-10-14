/**
 * Calcolo dell'attesa di riconnessione con jitter casuale.
 * Evita che tutti i dispositivi riconnettano nello stesso istante dopo una caduta di rete.
 */

export const BACKOFF_DELAYS = [0, 500, 1_000, 2_000, 5_000, 10_000] as const;
export const OFFLINE_BANNER_THRESHOLD = 2;

/**
 * Calcola il ritardo in millisecondi in base ai tentativi falliti consecutivi.
 * Tentativo 0: riapertura immediata (0 ms).
 * Tentativi successivi: ritardo crescente fino al tetto di 10 s, con variazione +/-20%.
 */
export function calculateBackoffDelay(attempts: number, randomFn: () => number = Math.random): number {
	const clamped = Math.min(Math.max(0, Math.floor(attempts)), BACKOFF_DELAYS.length - 1);
	const base = BACKOFF_DELAYS[clamped];
	if (base === 0) {
		return 0;
	}
	// Variazione tra 0.8x e 1.2x del ritardo base per distribuire i ricollegamenti
	return Math.round(base * (0.8 + randomFn() * 0.4));
}
