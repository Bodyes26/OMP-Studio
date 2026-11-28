import { motionReduced } from './motionState.svelte';
import type { TransitionConfig } from 'svelte/transition';

export interface ChatRevealParams {
	delay?: number;
	duration?: number;
	blur?: number;
	distance?: number;
	x?: number;
}

function pixels(value: string): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function durationToken(style: CSSStyleDeclaration, token: string, fallback: number): number {
	const value = style.getPropertyValue(token).trim();
	const duration = pixels(value) * (value.endsWith('ms') ? 1 : 1000);
	return value && Number.isFinite(duration) ? duration : fallback;
}

/**
 * Unica copia JS della curva di `--ease-reveal` in `app.css`
 * (`cubic-bezier(0.22, 0.61, 0.36, 1)`). Svelte interpola via JS e non legge
 * la curva dal foglio di stile: il token e questa costante devono restare
 * identici, altrimenti transizioni CSS e JS dello stesso ingresso finiscono su
 * curve diverse. `test/reveal-ease.test.ts` confronta le due, cosi' la
 * divergenza si vede come test rosso e non come cambio di ritmo a schermo.
 */
export const REVEAL_EASE_CURVE = [0.22, 0.61, 0.36, 1] as const;

/** Coefficienti del polinomio di una coordinata della cubic-bezier. */
function bezierCoefficients(start: number, end: number): [number, number, number] {
	return [3 * start, 3 * end - 6 * start, 3 * start - 3 * end + 1];
}

const [X1, X2, X3] = bezierCoefficients(REVEAL_EASE_CURVE[0], REVEAL_EASE_CURVE[2]);
const [Y1, Y2, Y3] = bezierCoefficients(REVEAL_EASE_CURVE[1], REVEAL_EASE_CURVE[3]);

function bezier(coefficients: readonly [number, number, number], t: number): number {
	return ((coefficients[2] * t + coefficients[1]) * t + coefficients[0]) * t;
}

/**
 * La curva del token letta sull'asse x, risolta per `t` con Newton: Svelte
 * vuole una funzione `progress → progress`, CSS vuole una parametrica.
 */
export function revealEase(progress: number): number {
	if (progress <= 0 || progress >= 1) return progress;
	let parameter = progress;
	for (let iteration = 0; iteration < 6; iteration++) {
		const x = bezier([X1, X2, X3], parameter);
		const derivative = (3 * X3 * parameter + 2 * X2) * parameter + X1;
		if (derivative === 0) break;
		parameter -= (x - progress) / derivative;
	}
	return bezier([Y1, Y2, Y3], parameter);
}

/** Ingresso/uscita senza piegare il layout: menu, popover e dialoghi. */
export function rvLift(
	node: Element,
	{ delay = 0, duration, blur = 3, distance, x = 0 }: ChatRevealParams = {}
): TransitionConfig {
	const style = getComputedStyle(node);
	const reduced = motionReduced();
	const transform = style.transform === 'none' ? '' : style.transform;
	const filter = style.filter === 'none' ? '' : style.filter;
	const opacity = pixels(style.opacity);
	const y = distance ?? (x !== 0 ? 0 : 8);
	return {
		delay: reduced ? 0 : delay,
		duration: reduced ? 0 : (duration ?? durationToken(
			style,
			style.getPropertyValue('--dur').trim() ? '--dur' : '--dur-slow',
			240
		)),
		easing: revealEase,
		css: (t, u) => `
			opacity: ${t * opacity};
			filter: ${filter} blur(${u * blur}px);
			transform: ${transform} translate3d(${u * x}px, ${u * y}px, 0);
		`
	};
}

/**
 * Reveal unico della chat: dissolve e mette a fuoco il contenuto mentre la sua
 * altezza reale entra nel layout. Cosi' le righe successive scorrono invece di
 * saltare quando arrivano tool, thinking e messaggi di sistema.
 */
export function chatReveal(
	node: Element,
	{
		delay = 0,
		duration,
		blur = 5,
		distance = 3
	}: ChatRevealParams = {}
): TransitionConfig {
	const style = getComputedStyle(node);
	const opacity = pixels(style.opacity) || 1;
	const height = pixels(style.height);
	const paddingTop = pixels(style.paddingTop);
	const paddingBottom = pixels(style.paddingBottom);
	const marginTop = pixels(style.marginTop);
	const marginBottom = pixels(style.marginBottom);
	const borderTopWidth = pixels(style.borderTopWidth);
	const borderBottomWidth = pixels(style.borderBottomWidth);
	const reduced = motionReduced();
	return {
		delay: reduced ? 0 : delay,
		duration: reduced ? 0 : (duration ?? durationToken(style, '--dur-row', 210)),
		easing: revealEase,
		css: (t, u) => `
			overflow: clip;
			height: ${t * height}px;
			min-height: 0;
			padding-top: ${t * paddingTop}px;
			padding-bottom: ${t * paddingBottom}px;
			margin-top: ${t * marginTop}px;
			margin-bottom: ${t * marginBottom}px;
			border-top-width: ${t * borderTopWidth}px;
			border-bottom-width: ${t * borderBottomWidth}px;
			opacity: ${t * opacity};
			filter: blur(${u * blur}px);
			transform: translate3d(0, ${u * distance}px, 0);
		`
	};
}

/**
 * Gemella JS di `.tray-in`/`.tray-out` per i blocchi che il genitore rimuove:
 * piega l'altezza a --dur-tray con blur 6 px, senza corsa verticale. Serve
 * dove l'altezza deve cambiare in modo continuo (sezioni del companion, la cui
 * finestra segue il contenuto fotogramma per fotogramma).
 */
export function trayFold(node: Element, { delay = 0 }: { delay?: number } = {}): TransitionConfig {
	return chatReveal(node, {
		delay,
		blur: 6,
		distance: 0,
		duration: durationToken(getComputedStyle(node), '--dur-tray', 420)
	});
}

export interface BadgeRevealParams {
	delay?: number;
	duration?: number;
	blur?: number;
	scale?: number;
}

/**
 * Reveal orizzontale compatto per badge, pillole e indicatori in linea (es. barra di stato).
 * Espande dolcemente larghezza, padding e opacita' evitando salti bruschi
 * nel layout del pulsante o della barra.
 */
export function badgeReveal(
	node: Element,
	{
		delay = 0,
		duration,
		blur = 3,
		scale = 0.82
	}: BadgeRevealParams = {}
): TransitionConfig {
	const style = getComputedStyle(node);
	const targetWidth = (node as HTMLElement).offsetWidth || (node as HTMLElement).scrollWidth || pixels(style.width);
	const paddingLeft = pixels(style.paddingLeft);
	const paddingRight = pixels(style.paddingRight);
	const marginLeft = pixels(style.marginLeft);
	const marginRight = pixels(style.marginRight);
	const opacity = pixels(style.opacity) || 1;
	const reduced = motionReduced();

	return {
		delay: reduced ? 0 : delay,
		duration: reduced ? 0 : (duration ?? durationToken(style, '--dur-row', 210)),
		easing: revealEase,
		css: (t, u) => `
			overflow: clip;
			max-width: ${t * (targetWidth + 2)}px;
			padding-left: ${t * paddingLeft}px;
			padding-right: ${t * paddingRight}px;
			margin-left: ${t * marginLeft}px;
			margin-right: ${t * marginRight}px;
			opacity: ${t * opacity};
			filter: blur(${u * blur}px);
			transform: scale(${scale + (1 - scale) * t});
			transform-origin: center;
			white-space: nowrap;
		`
	};
}
