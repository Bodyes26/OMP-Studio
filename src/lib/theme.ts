/**
 * Ponte fra il tema di `omp` e quello di Studio.
 *
 * Il catalogo e' la copia dei temi builtin di `omp` 17.2.1: sono
 * compilati dentro il binario (`modes/theme/theme.ts` li importa con
 * `with { type: "json" }`), quindi sulla macchina utente non esistono su disco
 * e l'unico modo di conoscere i colori e' averli qui. Include sia il tema
 * builtin sia i temi scuri e chiari del catalogo.
 *
 * Le due superfici ancora e la tinta/croma di accento e attenzione arrivano dal
 * tema. Testo, stati e superfici derivate restano in `app.css`, con una rampa
 * distinta per tema scuro e chiaro per conservare il contrasto del guscio.
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

const PROJECT_COLOR_KEYS = [
	'accent',
	'warning',
	'success',
	'error',
	'syntaxKeyword',
	'syntaxFunction',
	'syntaxString',
	'syntaxNumber',
	'syntaxType',
	'syntaxVariable',
	'mdHeading',
	'mdLink',
	'bashMode',
	'pythonMode'
];
const FALLBACK_PROJECT_HUES = [355, 25, 60, 135, 175, 220, 265, 305];
const projectPaletteCache = new WeakMap<OmpTheme, number[]>();

function hueDistance(left: number, right: number): number {
	const distance = Math.abs(left - right);
	return Math.min(distance, 360 - distance);
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
	isLight: boolean;
}

/** Croma massima dell'accento in DESIGN.md §2.4: oltre, il guscio urlerebbe. */
const BRAND_C_MAX = 0.19;
const WARN_C_MAX = 0.15;

function modeFor(theme: OmpTheme): ThemeMode {
	const page = resolveColor(theme, theme.export.pageBg) ?? '#131313';
	return luminance(page) > 0.5 ? 'light' : 'dark';
}

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
		warnC: Math.min(WARN_C_MAX, warning.c),
		isLight: modeFor(theme) === 'light'
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

/**
 * Colori identitari automatici: estratti dal tema attivo, non da una rampa
 * fissa. I temi quasi monocromatici mantengono la rampa storica per non
 * assegnare lo stesso colore a ogni progetto.
 */
function projectPaletteFor(theme: OmpTheme): number[] {
	const cached = projectPaletteCache.get(theme);
	if (cached) return cached;

	const hues: number[] = [];
	for (const key of PROJECT_COLOR_KEYS) {
		const hex = resolveColor(theme, theme.colors[key]);
		if (!hex) continue;
		const { c, h } = hexToOklch(hex);
		if (c >= 0.04 && hues.every((existing) => hueDistance(existing, h) >= 18)) {
			hues.push(Math.round(h));
		}
	}

	if (hues.length < 2) {
		projectPaletteCache.set(theme, FALLBACK_PROJECT_HUES);
		return FALLBACK_PROJECT_HUES;
	}

	// Le tinte mancanti restano legate agli accenti del tema, senza introdurre
	// una seconda palette estranea quando il tema ne definisce poche.
	const seeds = [...hues];
	const offsets = [32, -32, 64, -64, 96, -96, 128, -128];
	for (let index = 0; hues.length < 8; index++) {
		const candidate = (seeds[index % seeds.length] + offsets[Math.floor(index / seeds.length) % offsets.length] + 360) % 360;
		if (hues.every((existing) => hueDistance(existing, candidate) >= 18)) {
			hues.push(Math.round(candidate));
		}
	}

	projectPaletteCache.set(theme, hues);
	return hues;
}

/** Tinta stabile per un progetto che segue il tema attivo. */
export function automaticProjectHue(theme: OmpTheme, path: string): number {
	const hues = projectPaletteFor(theme);
	let hash = 0;
	for (let index = 0; index < path.length; index++) {
		hash = path.charCodeAt(index) + ((hash << 5) - hash);
	}
	return hues[Math.abs(hash) % hues.length] ?? FALLBACK_PROJECT_HUES[0];
}

export const THEMES: Record<string, OmpTheme> = CATALOG;
export const THEME_NAMES = Object.keys(CATALOG).sort();

export type ThemeMode = 'dark' | 'light';

export interface ThemeGroup {
	mode: ThemeMode;
	label: string;
	names: string[];
}

export const THEME_GROUPS: ThemeGroup[] = [
	{
		mode: 'dark',
		label: 'Temi scuri',
		names: THEME_NAMES.filter((name) => modeFor(THEMES[name]) === 'dark')
	},
	{
		mode: 'light',
		label: 'Temi chiari',
		names: THEME_NAMES.filter((name) => modeFor(THEMES[name]) === 'light')
	}
];
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
	isLight: boolean;
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
		inkFaint: tokenHex('--ink-faint'),
		isLight: currentAnchors.isLight
	};
}



let currentAnchors: ThemeAnchors = {
	bgBase: '#131313',
	bgSunken: '#0c0c0c',
	brandH: 355,
	brandC: 0.19,
	warnH: 75,
	warnC: 0.15,
	isLight: false
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
	root.setProperty('--ink', anchors.isLight ? 'oklch(0.240 0 0)' : 'oklch(0.970 0 0)');
	root.setProperty('--ink-muted', anchors.isLight ? 'oklch(0.400 0 0)' : 'oklch(0.760 0 0)');
	root.setProperty('--ink-faint', anchors.isLight ? 'oklch(0.460 0 0)' : 'oklch(0.655 0 0)');
	root.setProperty('--brand-ink-l', anchors.isLight ? '0.400' : '0.720');
	root.setProperty('--brand-dim-l', anchors.isLight ? '0.880' : '0.440');
	root.setProperty('--warn-l', anchors.isLight ? '0.420' : '0.780');
	root.setProperty('--warn-dim-l', anchors.isLight ? '0.880' : '0.560');
	root.setProperty('--on-brand', anchors.isLight ? 'var(--ink)' : 'var(--bg-sunken)');
	root.setProperty('--on-project', anchors.isLight ? 'var(--ink)' : 'var(--bg-sunken)');
	root.setProperty('--proj-l-ink', anchors.isLight ? '0.430' : '0.780');
	root.setProperty('--proj-l-fill', anchors.isLight ? '0.600' : '0.620');
	root.setProperty('color-scheme', anchors.isLight ? 'light' : 'dark');
	for (const fn of listeners) fn();
}

export { FALLBACK as DEFAULT_THEME };
