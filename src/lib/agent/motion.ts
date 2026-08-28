import { quintOut } from 'svelte/easing';
import { prefersReducedMotion } from 'svelte/motion';
import type { TransitionConfig } from 'svelte/transition';
import { settingsStore } from '$lib/stores/settings.svelte';

export interface ChatRevealParams {
	delay?: number;
	duration?: number;
	blur?: number;
	distance?: number;
}

function pixels(value: string): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function durationToken(style: CSSStyleDeclaration): number {
	const duration = pixels(style.getPropertyValue('--dur-slow'));
	return duration > 0 ? duration : 240;
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
	const reduced = prefersReducedMotion.current || !settingsStore.accessibility.animations;
	return {
		delay: reduced ? 0 : delay,
		duration: reduced ? 0 : (duration ?? durationToken(style)),
		easing: quintOut,
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
