/**
 * Tema della PWA: le stesse ancore di Studio (`src/lib/theme.ts`,
 * `anchorDeclarations`), ricevute nell'istantanea della macchina. Cosi' il
 * telefono ha i colori di Studio, chiari o scuri, invece di un tema suo.
 */

import type { HostState, HostSummary, RemoteTheme } from '../../src/protocol.ts';

/** Chiave letta da `public/theme-boot.js` prima del primo paint. */
export const THEME_CACHE_KEY = 'omp-remote-theme-css';

/** I colori arrivano dalla rete: niente che possa uscire dal valore CSS. */
const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([0-9a-z.,%/ -]{1,60}\))$/i;

function finite(value: unknown, min: number, max: number): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** `null` se il tema pubblicato non e' utilizzabile. */
export function sanitizeTheme(theme: RemoteTheme | null | undefined): RemoteTheme | null {
	if (!theme || typeof theme !== 'object') return null;
	const brandH = finite(theme.brandH, 0, 360);
	const brandC = finite(theme.brandC, 0, 0.5);
	const warnH = finite(theme.warnH, 0, 360);
	const warnC = finite(theme.warnC, 0, 0.5);
	if (
		typeof theme.bgBase !== 'string' ||
		typeof theme.bgSunken !== 'string' ||
		!COLOR_PATTERN.test(theme.bgBase) ||
		!COLOR_PATTERN.test(theme.bgSunken) ||
		brandH === null ||
		brandC === null ||
		warnH === null ||
		warnC === null
	) {
		return null;
	}
	return { bgBase: theme.bgBase, bgSunken: theme.bgSunken, brandH, brandC, warnH, warnC, isLight: theme.isLight === true };
}

/** Copia di `anchorDeclarations` di Studio: le due vanno tenute uguali. */
export function themeDeclarations(anchors: RemoteTheme): [string, string][] {
	const light = anchors.isLight;
	const successL = light ? '0.420' : '0.740';
	const successC = light ? '0.160' : '0.180';
	const successDimL = light ? '0.880' : '0.520';
	const dangerL = light ? '0.420' : '0.680';
	const dangerC = light ? '0.150' : '0.185';
	const dangerDimL = light ? '0.880' : '0.380';

	return [
		['--bg-base', anchors.bgBase],
		['--bg-sunken', anchors.bgSunken],
		['--brand-h', String(anchors.brandH)],
		['--brand-c', String(anchors.brandC)],
		['--warn-h', String(anchors.warnH)],
		['--warn-c', String(anchors.warnC)],
		['--ink', light ? 'oklch(0.240 0 0)' : 'oklch(0.970 0 0)'],
		['--ink-muted', light ? 'oklch(0.400 0 0)' : 'oklch(0.760 0 0)'],
		['--ink-faint', light ? 'oklch(0.460 0 0)' : 'oklch(0.655 0 0)'],
		['--brand-ink-l', light ? '0.400' : '0.720'],
		['--brand-dim-l', light ? '0.880' : '0.440'],
		['--warn-l', light ? '0.420' : '0.780'],
		['--warn-dim-l', light ? '0.880' : '0.560'],
		['--success-h', '145'],
		['--success-c', successC],
		['--success-l', successL],
		['--success-dim-l', successDimL],
		['--success', `oklch(${successL} ${successC} 145)`],
		['--success-dim', `oklch(${successDimL} calc(${successC} * 0.800) 145)`],
		['--danger-h', '27'],
		['--danger-c', dangerC],
		['--danger-l', dangerL],
		['--danger-dim-l', dangerDimL],
		['--danger', `oklch(${dangerL} ${dangerC} 27)`],
		['--danger-dim', `oklch(${dangerDimL} calc(${dangerC} * 0.800) 27)`],
		['--on-brand', light ? 'var(--ink)' : 'var(--bg-sunken)'],
		['--on-project', light ? 'var(--ink)' : 'var(--bg-sunken)'],
		['--proj-l-ink', light ? '0.430' : '0.780'],
		['--proj-l-fill', light ? '0.600' : '0.620'],
		['color-scheme', light ? 'light' : 'dark']
	];
}

/**
 * Tema da seguire: quello della prima macchina in linea che ne pubblica uno,
 * altrimenti l'ultimo ricevuto da una macchina spenta. Le macchine restano
 * nell'ordine del relay, cosi' la scelta non salta fra un'istantanea e l'altra.
 */
export function pickTheme(
	hosts: HostSummary[],
	states: Record<string, { state: HostState } | undefined>
): RemoteTheme | null {
	let fallback: RemoteTheme | null = null;
	for (const host of hosts) {
		const theme = sanitizeTheme(states[host.id]?.state.theme);
		if (!theme) continue;
		if (host.online) return theme;
		fallback ??= theme;
	}
	return fallback;
}

let applied = '';

/** Scrive le ancore su `:root`; `null` torna al tema del sistema. */
export function applyTheme(theme: RemoteTheme | null): void {
	const root = document.documentElement;
	const declarations = theme ? themeDeclarations(theme) : [];
	const css = declarations.map(([property, value]) => `${property}:${value}`).join(';');
	if (css === applied) return;
	applied = css;

	root.removeAttribute('style');
	for (const [property, value] of declarations) root.style.setProperty(property, value);
	if (theme) root.dataset.theme = theme.isLight ? 'light' : 'dark';
	else delete root.dataset.theme;

	// Barra di stato di iOS e Android nel colore della superficie.
	const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg-base').trim() || meta.content;

	try {
		if (theme) localStorage.setItem(THEME_CACHE_KEY, css);
		else localStorage.removeItem(THEME_CACHE_KEY);
	} catch {
		// Storage non disponibile: si perde solo il pre-paint.
	}
}
