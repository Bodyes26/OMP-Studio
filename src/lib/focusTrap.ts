/**
 * Azione Svelte riutilizzabile per intrappolare il focus della tastiera (Tab / Shift+Tab)
 * e gestire la chiusura su tasto Escape nei dialoghi modali, cassetti (drawer) e popover.
 * Ripristina automaticamente il focus all'elemento precedentemente attivo alla chiusura.
 */

import { traceFocus } from '$lib/focusTracer';

export interface FocusTrapOptions {
	/** Callback invocata quando l'utente preme il tasto Escape all'interno dell'elemento */
	onEscape?: () => void;
	/** Selettore o elemento esplicito su cui posizionare il focus iniziale */
	initialFocus?: string | HTMLElement;
	/** Se ripristinare il focus all'elemento attivo precedente allo smontaggio (default: true) */
	restoreFocus?: boolean;
}

/** Stack globale delle trappole attive per gestire correttamente i dialoghi annidati */
const activeTrapStack: HTMLElement[] = [];

const focusableSelector =
	'button, [href], input, select, textarea, [tabindex]';

export function isElementFocusable(el: HTMLElement): boolean {
	if (el.closest('[inert]')) return false;
	if (el.closest('[aria-hidden="true"]')) return false;

	// Filtro disabilitati
	if (el.matches(':disabled') || el.hasAttribute('disabled')) {
		return false;
	}

	// Filtro input hidden
	if (el instanceof HTMLInputElement && el.type === 'hidden') {
		return false;
	}

	// Filtro tabindex negativo
	const tabAttr = el.getAttribute('tabindex');
	if (tabAttr !== null && parseInt(tabAttr, 10) < 0) return false;
	if (el.tabIndex < 0) return false;

	// Filtro visibilità reale
	const style = window.getComputedStyle(el);
	if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
		return false;
	}
	if (typeof el.checkVisibility === 'function') {
		if (!el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) {
			return false;
		}
	} else if (el.offsetParent === null && el.getClientRects().length === 0) {
		return false;
	}

	return true;
}

export function trapFocus(node: HTMLElement, options?: FocusTrapOptions | (() => void)) {
	let currentOpts: FocusTrapOptions = typeof options === 'function' ? { onEscape: options } : (options ?? {});
	const restore = currentOpts.restoreFocus !== false;
	const previouslyFocused = document.activeElement as HTMLElement | null;
	let initialFocusTimer: number | undefined;

	activeTrapStack.push(node);

	function getFocusables(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(focusableSelector)).filter(isElementFocusable);
	}

	// Focus iniziale: rispetta autofocus -> initialFocus -> primo focusabile -> nodo.
	// Se Studio e' in secondo piano il fuoco non si tocca: un modale che compare
	// da solo (aggiornamento, controllo modelli) riporterebbe la finestra davanti
	// all'applicazione che l'utente sta usando.
	initialFocusTimer = window.setTimeout(() => {
		if (!node.isConnected) return;
		if (activeTrapStack.at(-1) !== node) return;
		if (!document.hasFocus()) return;
		traceFocus('focus-trap-initial', `node=${node.className || node.tagName.toLowerCase()}`);
		if (currentOpts.initialFocus) {
			const target =
				typeof currentOpts.initialFocus === 'string'
					? node.querySelector<HTMLElement>(currentOpts.initialFocus)
					: currentOpts.initialFocus;
			if (target && isElementFocusable(target) && typeof target.focus === 'function') {
				target.focus();
				return;
			}
		}
		const autoEl = node.querySelector<HTMLElement>('[autofocus]');
		if (autoEl && isElementFocusable(autoEl) && typeof autoEl.focus === 'function') {
			autoEl.focus();
			return;
		}
		const focusables = getFocusables();
		if (focusables.length > 0) {
			focusables[0].focus();
		} else {
			// Fallback zero focusabili: focus sul nodo stesso
			if (!node.hasAttribute('tabindex')) {
				node.setAttribute('tabindex', '-1');
			}
			node.focus();
		}
	}, 15);

	function onKeydown(e: KeyboardEvent) {
		// Solo la trappola più in cima allo stack gestisce gli eventi
		if (activeTrapStack.at(-1) !== node) return;

		if (e.key === 'Escape' && currentOpts.onEscape) {
			e.preventDefault();
			e.stopPropagation();
			currentOpts.onEscape();
			return;
		}

		if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;

		const focusables = getFocusables();
		if (focusables.length === 0) {
			e.preventDefault();
			if (document.activeElement !== node) {
				if (!node.hasAttribute('tabindex')) {
					node.setAttribute('tabindex', '-1');
				}
				node.focus();
			}
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
			clearTimeout(initialFocusTimer);

			const isTopmost = activeTrapStack.at(-1) === node;
			const idx = activeTrapStack.lastIndexOf(node);
			if (idx !== -1) {
				activeTrapStack.splice(idx, 1);
			}


			// Ripristino del focus solo se questo era il dialogo proprietario attivo (topmost) e l'elemento non è inerte o nascosto
			if (isTopmost && restore && previouslyFocused && previouslyFocused.isConnected) {
				if (isElementFocusable(previouslyFocused) && typeof previouslyFocused.focus === 'function') {
					try {
						previouslyFocused.focus();
					} catch {
						// Ignora se non più focusabile
					}
				}
			}
		}
	};
}
