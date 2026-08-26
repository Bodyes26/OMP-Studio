/**
 * Azione Svelte riutilizzabile per intrappolare il focus della tastiera (Tab / Shift+Tab)
 * e gestire la chiusura su tasto Escape nei dialoghi modali, cassetti (drawer) e popover.
 * Ripristina automaticamente il focus all'elemento precedentemente attivo alla chiusura.
 */

export interface FocusTrapOptions {
	/** Callback invocata quando l'utente preme il tasto Escape all'interno dell'elemento */
	onEscape?: () => void;
	/** Selettore o elemento esplicito su cui posizionare il focus iniziale */
	initialFocus?: string | HTMLElement;
	/** Se ripristinare il focus all'elemento attivo precedente allo smontaggio (default: true) */
	restoreFocus?: boolean;
}

export function trapFocus(node: HTMLElement, options?: FocusTrapOptions | (() => void)) {
	let currentOpts: FocusTrapOptions = typeof options === 'function' ? { onEscape: options } : (options ?? {});
	const restore = currentOpts.restoreFocus !== false;
	const previouslyFocused = document.activeElement as HTMLElement | null;

	const focusableSelector =
		'button:not([disabled]):not([aria-hidden="true"]), [href], input:not([disabled]):not([type="hidden"]):not([aria-hidden="true"]), select:not([disabled]):not([aria-hidden="true"]), textarea:not([disabled]):not([aria-hidden="true"]), [tabindex]:not([tabindex="-1"]):not([aria-hidden="true"])';

	function getFocusables(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(focusableSelector)).filter(
			(el) => el.offsetParent !== null || el.getClientRects().length > 0 || window.getComputedStyle(el).display !== 'none'
		);
	}

	// Focus iniziale: rispetta autofocus -> initialFocus -> primo focusabile -> nodo
	setTimeout(() => {
		if (!node.isConnected) return;
		if (currentOpts.initialFocus) {
			const target =
				typeof currentOpts.initialFocus === 'string'
					? node.querySelector<HTMLElement>(currentOpts.initialFocus)
					: currentOpts.initialFocus;
			if (target && typeof target.focus === 'function') {
				target.focus();
				return;
			}
		}
		const autoEl = node.querySelector<HTMLElement>('[autofocus]');
		if (autoEl && typeof autoEl.focus === 'function') {
			autoEl.focus();
			return;
		}
		const focusables = getFocusables();
		if (focusables.length > 0) {
			focusables[0].focus();
		} else if (node.hasAttribute('tabindex')) {
			node.focus();
		}
	}, 15);

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && currentOpts.onEscape) {
			e.preventDefault();
			e.stopPropagation();
			currentOpts.onEscape();
			return;
		}

		if (e.key !== 'Tab') return;

		const focusables = getFocusables();
		if (focusables.length === 0) {
			e.preventDefault();
			return;
		}

		const firstEl = focusables[0];
		const lastEl = focusables[focusables.length - 1];

		if (e.shiftKey) {
			if (document.activeElement === firstEl || !node.contains(document.activeElement)) {
				e.preventDefault();
				lastEl.focus();
			}
		} else {
			if (document.activeElement === lastEl || !node.contains(document.activeElement)) {
				e.preventDefault();
				firstEl.focus();
			}
		}
	}

	node.addEventListener('keydown', onKeydown);

	return {
		update(newOptions?: FocusTrapOptions | (() => void)) {
			currentOpts = typeof newOptions === 'function' ? { onEscape: newOptions } : (newOptions ?? {});
		},
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			if (restore && previouslyFocused && typeof previouslyFocused.focus === 'function' && previouslyFocused.isConnected) {
				try {
					previouslyFocused.focus();
				} catch {
					// Ignora se non più focusabile
				}
			}
		}
	};
}
