/**
 * Logica pura per la visualizzazione a finestre dello storico messaggi dell'agente.
 *
 * Se il numero totale di entry supera RENDER_WINDOW (300 entry),
 * vengono mostrate le ultime RENDER_WINDOW e un comando permette di
 * caricare le precedenti a blocchi successivi, preservando la viewport.
 */

export const RENDER_WINDOW = 300;

/**
 * Calcola il nuovo visibleCount incrementando a finestre di `step` (default RENDER_WINDOW),
 * con clamp inferiore a RENDER_WINDOW e superiore a `total`.
 */
export function clampVisibleCount(total: number, current: number, step = RENDER_WINDOW): number {
	if (total <= 0) return RENDER_WINDOW;
	const increment = step > 0 ? step : RENDER_WINDOW;
	return Math.min(total, Math.max(RENDER_WINDOW, current + increment));
}

/**
 * Restituisce il sottoinsieme di entry visibili (le ultime `visibleCount` entry).
 */
export function sliceVisibleEntries<T>(entries: readonly T[], visibleCount: number): T[] {
	if (entries.length <= visibleCount) return [...entries];
	return entries.slice(entries.length - visibleCount);
}

/**
 * Indica se ci sono entry precedenti non ancora mostrate nella finestra corrente.
 */
export function hasEarlierEntries(total: number, visibleCount: number): boolean {
	return total > visibleCount;
}

/**
 * Calcola l'adattamento dello scroll (delta) da applicare al contenitore per
 * preservare la viewport quando vengono inseriti nuovi elementi in cima.
 */
export function computeViewportScrollDelta(
	prevScrollHeight: number,
	newScrollHeight: number
): number {
	return Math.max(0, newScrollHeight - prevScrollHeight);
}
