<script lang="ts">
	/**
	 * MenuButton unificato per la barra del composer e superfici popover.
	 *
	 * - Ancoraggio top-layer (fixed) tramite anchoredPopover, esce verso l'alto
	 *   a 8px dal trigger con ribaltamento automatico se lo spazio sopra manca.
	 * - Animazione rv-lift con --dur-menu (150ms) e blur 3px.
	 * - Nessun title nativo sul trigger: se presente, adotta il Tooltip accessibile.
	 * - Chiusura con click esterno (in cattura) ed Escape con ripristino del focus.
	 * - Tab non viene intrappolato: esce naturalmente e chiude il menu.
	 * - Frecce e Home/End navigano le voci senza interferire con campi input/ricerca.
	 */
	import type { Snippet } from 'svelte';
	import { anchoredPopover } from '$lib/anchoredPopover';
	import { isElementFocusable } from '$lib/focusTrap';
	import Tooltip from './Tooltip.svelte';

	let {
		open = false,
		title,
		ariaLabel,
		tooltip,
		hasPopup = 'menu',
		contentRole,
		width = '320px',
		align = 'left',
		className = '',
		disabled = false,
		onToggle,
		onClose,
		trigger,
		children
	} = $props<{
		open: boolean;
		title?: string;
		ariaLabel?: string;
		tooltip?: string;
		hasPopup?: 'menu' | 'dialog' | 'listbox' | 'tree' | 'grid';
		contentRole?: string;
		width?: string;
		align?: 'left' | 'right';
		className?: string;
		disabled?: boolean;
		onToggle: () => void;
		onClose: () => void;
		trigger: Snippet;
		children: Snippet;
	}>();

	let triggerBtnEl = $state<HTMLButtonElement | null>(null);
	let popoverEl = $state<HTMLDivElement | null>(null);
	const popoverId = $props.id();
	let focusOnOpen = $state<'first' | 'last' | null>(null);

	const tooltipText = $derived(tooltip || title || '');
	const accessibleName = $derived(ariaLabel || title || tooltipText);

	const popupType = $derived(hasPopup);

	const computedRole = $derived.by(() => {
		if (contentRole) return contentRole;
		if (popupType === 'dialog') return 'dialog';
		if (popupType === 'listbox') return 'region';
		return 'menu';
	});

	function getFocusableElements(container: HTMLElement): HTMLElement[] {
		return Array.from(
			container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')
		).filter(isElementFocusable);
	}

	$effect(() => {
		if (open && popoverEl) {
			const target = focusOnOpen;
			focusOnOpen = null;
			requestAnimationFrame(() => {
				if (!popoverEl) return;
				// Se il contenuto gestisce gia' il focus (es. autoFocus input in ModelPickerList), non sovrascrivere
				if (popoverEl.contains(document.activeElement)) return;
				const focusables = getFocusableElements(popoverEl);
				if (focusables.length === 0) return;
				if (target === 'last') {
					focusables[focusables.length - 1].focus();
				} else if (target === 'first' || popupType === 'menu') {
					focusables[0].focus();
				}
			});
		}
	});

	function handleTriggerKeyDown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
			if (!open) {
				e.preventDefault();
				focusOnOpen = 'first';
				onToggle();
			}
		} else if (e.key === 'ArrowUp') {
			if (!open) {
				e.preventDefault();
				focusOnOpen = 'last';
				onToggle();
			}
		} else if (e.key === 'Escape' && open) {
			e.stopPropagation();
			onClose();
		}
	}

	function handlePopoverKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onClose();
			triggerBtnEl?.focus();
			return;
		}

		if (e.key === 'Tab') {
			// Tab esce naturalmente senza bloccare la tastiera
			requestAnimationFrame(() => {
				if (
					popoverEl &&
					!popoverEl.contains(document.activeElement)
				) {
					onClose();
				}
			});
			return;
		}

		// Non intercettare frecce o Home/End se il focus e' in un campo di testo
		const activeEl = document.activeElement as HTMLElement | null;
		const isTextInput =
			activeEl &&
			(activeEl.tagName === 'INPUT' ||
				activeEl.tagName === 'TEXTAREA' ||
				activeEl.isContentEditable);
		if (isTextInput) {
			return;
		}

		if (!popoverEl || (computedRole !== 'menu' && popupType !== 'listbox')) return;
		const focusables = getFocusableElements(popoverEl).filter(
			(element) => popupType !== 'listbox' || element.getAttribute('role') === 'option'
		);
		if (focusables.length === 0) return;
		const currentIndex = focusables.indexOf(activeEl!);

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			const nextIndex = currentIndex < focusables.length - 1 ? currentIndex + 1 : 0;
			focusables[nextIndex].focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const prevIndex = currentIndex > 0 ? currentIndex - 1 : focusables.length - 1;
			focusables[prevIndex].focus();
		} else if (e.key === 'Home') {
			e.preventDefault();
			focusables[0].focus();
		} else if (e.key === 'End') {
			e.preventDefault();
			focusables[focusables.length - 1].focus();
		}
	}

	function handleFocusOut(e: FocusEvent) {
		const related = e.relatedTarget as Node | null;
		if (!popoverEl?.contains(related) && !triggerBtnEl?.contains(related)) {
			onClose();
		}
	}

	$effect(() => {
		if (!open) return;

		const handlePointerDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (!target) return;
			if (triggerBtnEl?.contains(target) || popoverEl?.contains(target)) {
				return;
			}
			onClose();
		};

		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
		};
	});
</script>

<div class="menu-button-container">
	<Tooltip text={tooltipText} disabled={open || disabled || !tooltipText} placement="top" offset={6}>
		<button
			bind:this={triggerBtnEl}
			type="button"
			class="menu-button {className}"
			class:active={open}
			{disabled}
			aria-expanded={open}
			aria-haspopup={popupType}
			aria-controls={open ? popoverId : undefined}
			aria-label={accessibleName}
			onclick={(e) => {
				e.stopPropagation();
				onToggle();
			}}
			onkeydown={handleTriggerKeyDown}
		>
			{@render trigger()}
		</button>
	</Tooltip>

	{#if open}
		<div
			bind:this={popoverEl}
			id={popoverId}
			class="menu-popover rv-lift"
			class:align-right={align === 'right'}
			style="width: {width};"
			role={computedRole}
			aria-label={computedRole === 'dialog' ? accessibleName : undefined}
			tabindex="-1"
			popover="manual"
			use:anchoredPopover={{
				anchor: triggerBtnEl,
				placement: align === 'right' ? 'top-end' : 'top-start',
				offset: 8,
				motion: true
			}}
			onkeydown={handlePopoverKeyDown}
			onfocusout={handleFocusOut}
		>
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.menu-button-container {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.menu-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 8px;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.menu-button:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.menu-button.active {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.menu-button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	/* Nel top layer (popover="manual") il menu non viene tagliato da nessun overflow
	   antenato. Il posizionamento fixed e il ribaltamento sono governati da anchoredPopover. */
	.menu-popover {
		position: fixed;
		inset: auto;
		margin: 0;
		z-index: var(--z-overlay);
		max-width: calc(100vw - 24px);
		max-height: 380px;
		overflow-x: hidden;
		overflow-y: auto;
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		font-family: var(--font-ui);
		outline: none;
		/* Movimento rapido a token per i menu a comparsa */
		--dur: var(--dur-menu, 150ms);
		--blur: 3px;
	}
</style>
