/**
 * motion.ts — Transizioni e animazioni Svelte per Studio Remote (Gate R48).
 *
 * Tutte le funzioni rispettano `prefers-reduced-motion` azzerando la durata.
 * Le curve rispecchiano i token di app.css:
 * - quintOut / expoOut per entrate fluide e naturali;
 * - cubicIn per uscite rapide (~70-75% del tempo di entrata).
 */
import { cubicIn, expoOut, quintOut } from 'svelte/easing';
import { flip } from 'svelte/animate';
import { slide } from 'svelte/transition';
import type { TransitionConfig } from 'svelte/transition';
import type { AnimationConfig } from 'svelte/animate';

type TransitionOpts = { direction?: 'in' | 'out' | 'both' };

const NONE: TransitionConfig = { duration: 0 };

function isReducedMotion(): boolean {
	return typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Velo scuro dietro i fogli: dissolvenza calibrata su entrata/uscita del foglio. */
export function scrim(_node: Element, _params?: unknown, opts?: TransitionOpts): TransitionConfig {
	if (isReducedMotion()) return NONE;
	const isExit = opts?.direction === 'out';
	return {
		duration: isExit ? 180 : 200,
		easing: isExit ? cubicIn : quintOut,
		css: (t) => `opacity: ${t}`
	};
}

/** Foglio che sale dal fondo su mobile e vi ritorna alla chiusura. */
export function bottomSheet(_node: Element, _params?: unknown, opts?: TransitionOpts): TransitionConfig {
	if (isReducedMotion()) return NONE;
	const isExit = opts?.direction === 'out';
	return {
		duration: isExit ? 200 : 320,
		easing: isExit ? cubicIn : expoOut,
		css: (_t, u) => `transform: translate3d(0, ${u * 100}%, 0)`
	};
}

/**
 * Dialogo reattivo: foglio dal fondo su schermi stretti (<640px) e
 * pannello centrato con lieve scala e dissolvenza su schermi desktop (>=640px).
 */
export function responsiveDialog(node: Element, params?: unknown, opts?: TransitionOpts): TransitionConfig {
	if (isReducedMotion()) return NONE;
	const isDesktop = typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(min-width: 640px)').matches;

	if (!isDesktop) {
		return bottomSheet(node, params, opts);
	}

	const isExit = opts?.direction === 'out';
	return {
		duration: isExit ? 150 : 240,
		easing: isExit ? cubicIn : quintOut,
		css: (t, u) => `opacity: ${t}; transform: translate3d(0, ${u * 8}px, 0) scale(${1 - u * 0.03})`
	};
}

/**
 * Chat a schermo intero: scivolamento da destra (push nativo) su mobile (<1024px),
 * dissolvenza morbida su desktop split (>=1024px).
 */
export function chatTransition(_node: Element, _params?: unknown, opts?: TransitionOpts): TransitionConfig {
	if (isReducedMotion()) return NONE;
	const isDesktop = typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(min-width: 1024px)').matches;

	if (isDesktop) {
		const isExit = opts?.direction === 'out';
		return {
			duration: isExit ? 120 : 180,
			easing: isExit ? cubicIn : quintOut,
			css: (t) => `opacity: ${t}`
		};
	}

	const isExit = opts?.direction === 'out';
	return {
		duration: isExit ? 220 : 320,
		easing: isExit ? cubicIn : expoOut,
		css: (_t, u) => `transform: translate3d(${u * 100}%, 0, 0)`
	};
}

/** Espansione e chiusura a fisarmonica con dissolvenza (rami, coda, elenchi). */
export function accordionFold(node: Element, _params?: unknown, opts?: TransitionOpts): TransitionConfig {
	if (isReducedMotion()) return NONE;
	const isExit = opts?.direction === 'out';
	const base = slide(node, {
		duration: isExit ? 180 : 260,
		easing: isExit ? cubicIn : quintOut
	});
	const cssFn = base.css;
	return {
		...base,
		css: (t, u) => `${cssFn ? cssFn(t, u) : ''}opacity: ${t};`
	};
}

/** Avviso che scende dall'alto (banner notice, offline banner). */
export function dropNotice(_node: Element, _params?: unknown, opts?: TransitionOpts): TransitionConfig {
	if (isReducedMotion()) return NONE;
	const isExit = opts?.direction === 'out';
	return {
		duration: isExit ? 160 : 220,
		easing: isExit ? cubicIn : quintOut,
		css: (t, u) => `opacity: ${t}; transform: translate3d(0, ${-u * 10}px, 0)`
	};
}

/** Elemento fluttuante che sale o si espande (toast, vassoio suggerimenti, pulsante scroll). */
export function popFloat(_node: Element, _params?: unknown, opts?: TransitionOpts): TransitionConfig {
	if (isReducedMotion()) return NONE;
	const isExit = opts?.direction === 'out';
	return {
		duration: isExit ? 140 : 200,
		easing: isExit ? cubicIn : quintOut,
		css: (t, u) => `opacity: ${t}; transform: translate3d(0, ${u * 8}px, 0) scale(${1 - u * 0.04})`
	};
}

/** Scorrimento fluido degli elementi di una lista al variare dell'ordine o alla rimozione. */
export function listReorder(node: Element, rects: { from: DOMRect; to: DOMRect }): AnimationConfig {
	if (isReducedMotion()) return { duration: 0 };
	return flip(node, rects, {
		duration: (distance) => Math.min(360, 160 + Math.sqrt(distance) * 8),
		easing: quintOut
	});
}
