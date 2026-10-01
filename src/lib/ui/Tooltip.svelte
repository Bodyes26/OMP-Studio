<script lang="ts">
	/**
	 * Tooltip accessibile secondo WCAG 2.1 (SC 1.4.13 Content on Hover or Focus).
	 *
	 * - Ruolo semantico role="tooltip" associato al trigger tramite aria-describedby.
	 * - Si apre su hover (pointerenter) e su focus tastiera (focusin).
	 * - Si chiude con Escape senza perdere il focus sul trigger.
	 * - Mantiene il tooltip aperto al passaggio del mouse sopra il tooltip stesso.
	 * - Nessun elemento focalizzabile all'interno (non crea trappole di focus).
	 * - Stile basato su token di sistema: --bg-raised, --ink, --radius-md, --z-tooltip.
	 */
	import type { Snippet } from 'svelte';
	import { anchoredPopover, type AnchorPlacement } from '$lib/anchoredPopover';

	let {
		text,
		placement = 'top',
		offset = 6,
		disabled = false,
		id: customId,
		children
	} = $props<{
		text?: string;
		placement?: AnchorPlacement;
		offset?: number;
		disabled?: boolean;
		id?: string;
		children?: Snippet;
	}>();

	const instanceId = $props.id();
	const id = $derived(customId ?? `${instanceId}-tooltip`);
	let isOpen = $state(false);
	let isDismissed = $state(false);
	let focused = $state(false);
	let hovered = $state(false);
	let bubbleHovered = $state(false);
	let triggerEl = $state<HTMLElement | null>(null);
	let closeTimer: ReturnType<typeof setTimeout> | null = null;

	function cancelClose() {
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = null;
	}

	function show() {
		cancelClose();
		if (!disabled && text && !isDismissed) isOpen = true;
	}

	function scheduleClose() {
		cancelClose();
		if (focused || hovered || bubbleHovered) return;
		isDismissed = false;
		closeTimer = setTimeout(() => {
			isOpen = false;
			isDismissed = false;
			closeTimer = null;
		}, 100);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !isOpen) return;
		event.preventDefault();
		event.stopPropagation();
		cancelClose();
		bubbleHovered = false;
		isDismissed = true;
		isOpen = false;
	}

	$effect(() => {
		if (disabled || !text) {
			isOpen = false;
			bubbleHovered = false;
			return;
		}
		if (!isOpen) return;
		// Escape vale anche su hover quando il fuoco e' altrove.
		document.addEventListener('keydown', handleKeyDown, true);
		return () => document.removeEventListener('keydown', handleKeyDown, true);
	});

	$effect(() => {
		if (!triggerEl) return;
		const target = triggerEl.querySelector<HTMLElement>('button, a, input, [tabindex]') ?? triggerEl;
		if (!isOpen || isDismissed || !text || disabled) return;
		const currentId = id;
		const descriptions = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
		if (!descriptions.includes(currentId)) descriptions.push(currentId);
		target.setAttribute('aria-describedby', descriptions.join(' '));
		return () => {
			const remaining = (target.getAttribute('aria-describedby') ?? '')
				.split(/\s+/).filter((token) => token && token !== currentId);
			if (remaining.length) target.setAttribute('aria-describedby', remaining.join(' '));
			else target.removeAttribute('aria-describedby');
		};
	});

	$effect(() => () => cancelClose());
</script>

<div
	class="tooltip-wrapper"
	bind:this={triggerEl}
	role="presentation"
	onpointerenter={() => { hovered = true; show(); }}
	onpointerleave={() => { hovered = false; scheduleClose(); }}
	onfocusin={() => { focused = true; show(); }}
	onfocusout={(event) => {
		if (triggerEl?.contains(event.relatedTarget as Node | null)) return;
		focused = false;
		scheduleClose();
	}}
>
	{@render children?.()}
	{#if isOpen && !isDismissed && text && !disabled}
		<div
			{id}
			class="tooltip-bubble rv-lift"
			role="tooltip"
			popover="manual"
			tabindex="-1"
			use:anchoredPopover={{ anchor: triggerEl, placement, offset, motion: true }}
			onpointerenter={() => { bubbleHovered = true; cancelClose(); }}
			onpointerleave={() => { bubbleHovered = false; scheduleClose(); }}
		>
			{text}
		</div>
	{/if}
</div>

<style>
	.tooltip-wrapper {
		display: inline-flex;
		align-items: center;
		position: relative;
	}

	.tooltip-bubble {
		position: fixed;
		inset: auto;
		margin: 0;
		z-index: var(--z-tooltip);
		padding: 4px 8px;
		background: var(--bg-raised);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		line-height: 1.35;
		max-width: min(320px, calc(100vw - 16px));
		overflow-wrap: anywhere;
		pointer-events: auto;
		user-select: none;
		outline: none;
		--dur: var(--dur-fast, 120ms);
		--blur: 2px;
	}
</style>
