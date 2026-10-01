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

/* Svelte interpola via JS: risolviamo la stessa curva di --ease-reveal
   sull'asse x, invece di sostituirla con una curva polinomiale simile. */
function revealEase(progress: number): number {
	if (progress <= 0 || progress >= 1) return progress;
	let parameter = progress;
	for (let iteration = 0; iteration < 6; iteration++) {
		const x = ((0.58 * parameter - 0.24) * parameter + 0.66) * parameter;
		const derivative = (1.74 * parameter - 0.48) * parameter + 0.66;
		parameter -= (x - progress) / derivative;
	}
	return ((-0.17 * parameter - 0.66) * parameter + 1.83) * parameter;
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
