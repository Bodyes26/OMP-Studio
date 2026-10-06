<script module lang="ts">
	let lastCloseTimestamp = 0;
	let anyTooltipOpen = false;
</script>

<script lang="ts">
	/**
	 * Tooltip accessibile secondo WCAG 2.1 (SC 1.4.13 Content on Hover or Focus).
	 *
	 * - Ruolo semantico role="tooltip" associato al trigger tramite aria-describedby.
	 * - Si apre su hover dopo un ritardo intenzionale (openDelay, default 300ms) o
	 *   immediatamente se un tooltip adiacente era appena aperto.
	 * - Si chiude istantaneamente alla pressione/click (pointerdown/click) sul controllo
	 *   senza rimanere bloccato a schermo mentre l'utente interagisce.
	 * - Si apre su focus tastiera (focusin con :focus-visible), ma non su click del mouse.
	 * - Si chiude con Escape senza perdere il focus sul trigger.
	 * - Mantiene il tooltip aperto al passaggio del mouse sopra il tooltip stesso.
	 * - Stile basato su token di sistema: --bg-raised, --ink, --radius-md, --z-tooltip.
	 */
	import type { Snippet } from 'svelte';
	import { anchoredPopover, type AnchorPlacement } from '$lib/anchoredPopover';

	let {
		text,
		placement = 'top',
		offset = 6,
		openDelay = 300,
		closeDelay = 80,
		disabled = false,
		id: customId,
		children
	} = $props<{
		text?: string;
		placement?: AnchorPlacement;
		offset?: number;
		openDelay?: number;
		closeDelay?: number;
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
	let openTimer: ReturnType<typeof setTimeout> | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;

	function cancelOpen() {
		if (openTimer) clearTimeout(openTimer);
		openTimer = null;
	}

	function cancelClose() {
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = null;
	}

	function show(immediate = false) {
		cancelClose();
		if (disabled || !text || isDismissed) return;

		if (immediate) {
			cancelOpen();
			isOpen = true;
			anyTooltipOpen = true;
			return;
		}

		if (isOpen) return;

		// Transizione rapida tra tooltip adiacenti (< 250ms dalla chiusura dell'ultimo)
		const isQuickSwitch = anyTooltipOpen || (Date.now() - lastCloseTimestamp < 250);
		const delay = isQuickSwitch ? 60 : openDelay;

		if (delay <= 0) {
			cancelOpen();
			isOpen = true;
			anyTooltipOpen = true;
		} else if (!openTimer) {
			openTimer = setTimeout(() => {
				if (!disabled && text && !isDismissed && (hovered || focused)) {
					isOpen = true;
					anyTooltipOpen = true;
				}
				openTimer = null;
			}, delay);
		}
	}

	function scheduleClose() {
		cancelOpen();
		cancelClose();
		if (hovered || bubbleHovered) return;

		// Se il trigger e' focalizzato da tastiera (:focus-visible), mantieni aperto
		const target = triggerEl?.querySelector<HTMLElement>('button, a, input, [tabindex]') ?? triggerEl;
		if (focused && target?.matches(':focus-visible') && !isDismissed) {
			return;
		}

		closeTimer = setTimeout(() => {
			if (isOpen) {
				isOpen = false;
				anyTooltipOpen = false;
				lastCloseTimestamp = Date.now();
			}
			isDismissed = false;
			focused = false;
			closeTimer = null;
		}, closeDelay);
	}

	function dismiss() {
		cancelOpen();
		cancelClose();
		isDismissed = true;
		if (isOpen) {
			isOpen = false;
			anyTooltipOpen = false;
			lastCloseTimestamp = Date.now();
		}
		bubbleHovered = false;
	}

	function handlePointerEnter() {
		hovered = true;
		show();
	}

	function handlePointerLeave() {
		hovered = false;
		bubbleHovered = false;
		cancelOpen();
		scheduleClose();
	}

	function handleFocusIn(event: FocusEvent) {
		if (isDismissed) return;
		const target = event.target as HTMLElement | null;
		// Apri su focus solo per navigazione tastiera (:focus-visible)
		if (target && !target.matches(':focus-visible')) {
			return;
		}
		focused = true;
		show(true);
	}

	function handleFocusOut(event: FocusEvent) {
		if (triggerEl?.contains(event.relatedTarget as Node | null)) return;
		focused = false;
		scheduleClose();
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !isOpen) return;
		event.preventDefault();
		event.stopPropagation();
		dismiss();
	}

	$effect(() => {
		if (disabled || !text) {
			cancelOpen();
			if (isOpen) {
				isOpen = false;
				anyTooltipOpen = false;
				lastCloseTimestamp = Date.now();
			}
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

	$effect(() => () => {
		cancelOpen();
		cancelClose();
		if (isOpen) {
			anyTooltipOpen = false;
			lastCloseTimestamp = Date.now();
		}
	});
</script>

<div
	class="tooltip-wrapper"
	bind:this={triggerEl}
	role="presentation"
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
	onpointerdown={dismiss}
	onclick={dismiss}
	onfocusin={handleFocusIn}
	onfocusout={handleFocusOut}
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
			onpointerdown={dismiss}
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
