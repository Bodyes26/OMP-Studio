/**
 * Ponte fra il tema di `omp` e quello di Studio.
 *
 * Il catalogo e' la copia dei temi scuri builtin di `omp` 17.2.1: sono
 * compilati dentro il binario (`modes/theme/theme.ts` li importa con
 * `with { type: "json" }`), quindi sulla macchina utente non esistono su disco
 * e l'unico modo di conoscerne i colori e' averli qui. I 49 temi chiari sono
 * esclusi: il tema chiaro e' bandito da PRODUCT.md.
 *
 * Un tema contribuisce al guscio **sei** valori: le due superfici ancora e la
 * tinta/croma di accento e attenzione. Tutto il resto resta derivato in
 * `app.css`, quindi la rampa di luminanza di DESIGN.md §2.3-2.5 - e i suoi
 * rapporti di contrasto - vale per ogni tema per costruzione.
 *
 * Monaco e xterm non leggono il CSS: vogliono stringhe esadecimali. Invece di
 * duplicare i valori si interroga il CSS stesso (`tokenHex`), cosi' la sorgente
 * unica resta `app.css` anche per i due componenti che dipingono su canvas.
 */

export interface OmpTheme {
	name: string;
	vars?: Record<string, string | number>;
	colors: Record<string, string | number>;
	export: { pageBg: string; cardBg: string; infoBg: string };
}

const modules = import.meta.glob<OmpTheme>('./themes/omp/*.json', { eager: true, import: 'default' });

const CATALOG: Record<string, OmpTheme> = {};
for (const [path, theme] of Object.entries(modules)) {
	CATALOG[path.slice(path.lastIndexOf('/') + 1, -'.json'.length)] = theme;
}

/** Tema di partenza: e' il default di `theme.dark` di `omp`. */
const FALLBACK = 'titanium';

/**
 * I valori in `colors`/`export` possono essere un esadecimale, un indice ANSI
 * 256 (che al guscio non serve) o un alias verso `vars`, con o senza `$`.
 */
function resolveColor(theme: OmpTheme, value: string | number | undefined, depth = 0): string | null {
	if (typeof value !== 'string' || value === '') return null;
	if (value.startsWith('#')) return value;
	if (depth > 8) return null;
	const key = value.startsWith('$') ? value.slice(1) : value;
	return resolveColor(theme, theme.vars?.[key], depth + 1);
}

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminanza relativa WCAG: serve solo a stabilire quale superficie e' il pozzo. */
function luminance(hex: string): number {
	const [r, g, b] = channels(hex).map(srgbToLinear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function channels(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
	return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** sRGB -> OKLCh. Del risultato usiamo solo tinta e croma. */
function hexToOklch(hex: string): { c: number; h: number } {
	const [r, g, b] = channels(hex).map(srgbToLinear);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const hue = (Math.atan2(bb, a) * 180) / Math.PI;
	return { c: Math.hypot(a, bb), h: hue < 0 ? hue + 360 : hue };
}

export interface ThemeAnchors {
	/** Superficie dell'app: la piu' chiara delle due del tema. */
	bgBase: string;
	/** Pozzo di terminale ed editor: la piu' scura. */
	bgSunken: string;
	brandH: number;
	brandC: number;
	warnH: number;
	warnC: number;
}

/** Croma massima dell'accento in DESIGN.md §2.4: oltre, il guscio urlerebbe. */
const BRAND_C_MAX = 0.19;
const WARN_C_MAX = 0.15;

export function anchorsFor(theme: OmpTheme): ThemeAnchors {
	const page = resolveColor(theme, theme.export.pageBg) ?? '#131313';
	const card = resolveColor(theme, theme.export.cardBg) ?? page;
	const [sunken, base] = luminance(card) <= luminance(page) ? [card, page] : [page, card];

	const accent = hexToOklch(resolveColor(theme, theme.colors.accent) ?? '#febc38');
	const warning = hexToOklch(resolveColor(theme, theme.colors.warning) ?? '#e0af68');

	return {
		bgBase: base,
		bgSunken: sunken,
		brandH: Math.round(accent.h),
		// Un tema monocromatico ha un accento quasi grigio: alzarlo alla croma
		// della rampa inventerebbe una saturazione che il tema non ha.
		brandC: Math.min(BRAND_C_MAX, accent.c),
		warnH: Math.round(warning.h),
		warnC: Math.min(WARN_C_MAX, warning.c)
	};
}

/** Anteprima per la lista: tre pastiglie che bastano a riconoscere un tema. */
export function swatchesFor(theme: OmpTheme): { bg: string; accent: string; text: string } {
	return {
		bg: resolveColor(theme, theme.export.pageBg) ?? '#131313',
		accent: resolveColor(theme, theme.colors.accent) ?? '#febc38',
		text: resolveColor(theme, theme.colors.syntaxVariable) ?? resolveColor(theme, theme.colors.muted) ?? '#b1b1b1'
	};
}

export const THEMES: Record<string, OmpTheme> = CATALOG;
export const THEME_NAMES = Object.keys(CATALOG).sort();

let probe: HTMLElement | null = null;
let surface: CanvasRenderingContext2D | null = null;

/**
 * Valore risolto di un token, in esadecimale opaco.
 *
 * Due passaggi, entrambi necessari. Primo: i token del guscio sono `oklch()` e
 * `color-mix()`, e `getComputedStyle` su una proprieta' custom restituirebbe
 * l'espressione, non il colore; assegnarla a `color` di un elemento vero
 * costringe il browser a risolverla. Secondo: il valore risolto resta nello
 * spazio in cui e' stato scritto (Chromium serializza `oklch(...)` tale e
 * quale), mentre xterm e Monaco vogliono esadecimali sRGB; dipingerlo su un
 * canvas 1x1 gia' riempito col pozzo lo converte e appiattisce insieme
 * l'eventuale trasparenza.
 */
export function tokenHex(token: string): string {
	if (!probe) {
		probe = document.createElement('span');
		probe.style.display = 'none';
		document.body.appendChild(probe);
	}
	if (!surface) {
		surface = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	}
	probe.style.color = `var(${token})`;
	const resolved = getComputedStyle(probe).color;
	if (!surface) return '#000000';

	surface.clearRect(0, 0, 1, 1);
	surface.fillStyle = currentAnchors.bgSunken;
	surface.fillRect(0, 0, 1, 1);
	surface.fillStyle = resolved;
	surface.fillRect(0, 0, 1, 1);

	const [r, g, b] = surface.getImageData(0, 0, 1, 1).data;
	return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Colori per i due componenti che dipingono su canvas. */
export interface CanvasColors {
	bgSunken: string;
	bgBase: string;
	bgHover: string;
	line: string;
	lineStrong: string;
	ink: string;
	inkMuted: string;
	inkFaint: string;
}

/**
 * Non e' una costante: cambia col tema, e chi lo usa deve rileggerlo a ogni
 * notifica di `onThemeChange`.
 */
export function canvasColors(): CanvasColors {
	return {
		bgSunken: tokenHex('--bg-sunken'),
		bgBase: tokenHex('--bg-base'),
		bgHover: tokenHex('--bg-hover'),
		line: tokenHex('--line'),
		lineStrong: tokenHex('--line-strong'),
		ink: tokenHex('--ink'),
		inkMuted: tokenHex('--ink-muted'),
		inkFaint: tokenHex('--ink-faint')
	};
}



let currentAnchors: ThemeAnchors = {
	bgBase: '#131313',
	bgSunken: '#0c0c0c',
	brandH: 355,
	brandC: 0.19,
	warnH: 75,
	warnC: 0.15
};

const listeners = new Set<() => void>();

/** Il tema cambia raramente: chi dipinge su canvas si iscrive e ridipinge. */
export function onThemeChange(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function applyAnchors(anchors: ThemeAnchors) {
	currentAnchors = anchors;
	const root = document.documentElement.style;
	root.setProperty('--bg-base', anchors.bgBase);
	root.setProperty('--bg-sunken', anchors.bgSunken);
	root.setProperty('--brand-h', String(anchors.brandH));
	root.setProperty('--brand-c', String(anchors.brandC));
	root.setProperty('--warn-h', String(anchors.warnH));
	root.setProperty('--warn-c', String(anchors.warnC));
	for (const fn of listeners) fn();
}

export { FALLBACK as DEFAULT_THEME };
