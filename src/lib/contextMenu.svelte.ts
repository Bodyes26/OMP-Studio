/**
 * Gestione globale e centralizzata dei menu contestuali tematizzati.
 *
 * Sostituisce il menu contestuale nativo della WebView con menu coerenti
 * con il design token dell'applicazione, gestendo automaticamente:
 * - Campi di testo / textarea / contenteditable (Annulla, Ripeti, Taglia, Copia, Incolla, Seleziona tutto)
 * - Selezione testo read-only (Copia)
 * - Soppressione nativa sicura su controlli non testuali (checkbox, radio, range, bottoni)
 * - Propagazione pulita per superfici speciali (.monaco-editor, .xterm)
 */
import type { Component } from 'svelte';
import {
	IconUndo,
	IconRedo,
	IconCut,
	IconCopy,
	IconPaste,
	IconSelectAll
} from '$lib/icons';

export interface ContextMenuItem {
	kind: 'item';
	label: string;
	icon?: Component;
	shortcut?: string;
	disabled?: boolean;
	hint?: string;
	danger?: boolean;
	run: () => void | Promise<void>;
}

export interface ContextMenuSeparator {
	kind: 'separator';
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export interface ContextMenuOptions {
	label: string;
	items: ContextMenuEntry[];
	invoker?: HTMLElement;
}

class ContextMenuState {
	#isOpen = $state(false);
	#label = $state('');
	#items = $state<ContextMenuEntry[]>([]);
	#x = $state(0);
	#y = $state(0);
	#invoker = $state<HTMLElement | null>(null);
	#fromKeyboard = $state(false);
	#nonce = $state(0);

	get isOpen() {
		return this.#isOpen;
	}

	get label() {
		return this.#label;
	}

	get items() {
		return this.#items;
	}

	get x() {
		return this.#x;
	}

	get y() {
		return this.#y;
	}

	get invoker() {
		return this.#invoker;
	}

	get fromKeyboard() {
		return this.#fromKeyboard;
	}

	get nonce() {
		return this.#nonce;
	}

	open(event: MouseEvent, options: ContextMenuOptions): void {
		event.preventDefault?.();
		if (!options.items || options.items.length === 0) {
			this.close();
			return;
		}

		const target = event.target as HTMLElement | null;
		const invoker = options.invoker ?? (target instanceof HTMLElement ? target : undefined);

		const isKeyboard =
			(event.clientX === 0 && event.clientY === 0) ||
			(event.button === 0 && event.detail === 0 && event.clientX === 0);

		let x = event.clientX;
		let y = event.clientY;

		if (isKeyboard && invoker) {
			const rect = invoker.getBoundingClientRect();
			x = rect.left;
			y = rect.bottom;
		}

		this.#invoker = invoker ?? null;
		this.#fromKeyboard = isKeyboard;
		this.#x = x;
		this.#y = y;
		this.#label = options.label;
		this.#items = options.items;
		this.#nonce++;
		this.#isOpen = true;
	}

	close(): void {
		if (!this.#isOpen) return;
		this.#isOpen = false;
		this.#items = [];
		this.#label = '';
		this.#invoker = null;
		this.#fromKeyboard = false;
	}
}

export const contextMenu = new ContextMenuState();

const NON_TEXT_INPUT_TYPES: Record<string, true> = {
	checkbox: true,
	radio: true,
	range: true,
	color: true,
	file: true,
	button: true,
	submit: true,
	reset: true,
	image: true,
	hidden: true
};

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

function triggerInputEvents(el: HTMLElement) {
	el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
}

function selectionIntersectsTarget(target: Node): boolean {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
	const text = sel.toString().trim();
	if (!text) return false;

	for (let i = 0; i < sel.rangeCount; i++) {
		const range = sel.getRangeAt(i);
		try {
			if (range.intersectsNode(target)) {
				return true;
			}
		} catch {
			// Ignora errori su nodi scollegati
		}
	}
	return false;
}

function buildTextEntryMenu(target: HTMLElement): ContextMenuEntry[] {
	const isInput = target instanceof HTMLInputElement;
	const isTextArea = target instanceof HTMLTextAreaElement;
	const isPassword = isInput && target.type.toLowerCase() === 'password';
	const isDisabled = (target as HTMLInputElement).disabled || target.getAttribute('aria-disabled') === 'true';
	const isReadOnly = (target as HTMLInputElement).readOnly || target.getAttribute('aria-readonly') === 'true';

	let hasSelection = false;
	let hasContent = false;
	let supportsSelection = false;
	let selectedText = '';

	if (isInput || isTextArea) {
		const field = target as HTMLInputElement | HTMLTextAreaElement;
		hasContent = (field.value?.length ?? 0) > 0;
		try {
			const start = field.selectionStart ?? 0;
			const end = field.selectionEnd ?? 0;
			hasSelection = start !== end;
			supportsSelection = true;
			if (hasSelection) {
				selectedText = field.value.slice(start, end);
			}
		} catch {
			supportsSelection = false;
			hasSelection = false;
		}
	} else if (target.isContentEditable) {
		hasContent = (target.textContent?.length ?? 0) > 0;
		const sel = window.getSelection();
		hasSelection = Boolean(sel && !sel.isCollapsed && sel.toString().length > 0);
		if (hasSelection && sel) {
			selectedText = sel.toString();
		}
	}

	const readonlyHint = 'Campo in sola lettura';
	const disabledHint = 'Campo disabilitato';
	const noSelectionHint = 'Nessun testo selezionato';
	const noContentHint = 'Nessun testo';

	const items: ContextMenuEntry[] = [];

	// Annulla
	items.push({
		kind: 'item',
		label: 'Annulla',
		icon: IconUndo,
		shortcut: `${MOD}Z`,
		disabled: isDisabled || isReadOnly,
		hint: isDisabled ? disabledHint : isReadOnly ? readonlyHint : undefined,
		run: () => {
			if (isDisabled || isReadOnly) return;
			target.focus();
			try {
				document.execCommand('undo');
			} catch {}
		}
	});

	// Ripeti
	items.push({
		kind: 'item',
		label: 'Ripeti',
		icon: IconRedo,
		shortcut: IS_MAC ? '⇧⌘Z' : 'Ctrl+Y',
		disabled: isDisabled || isReadOnly,
		hint: isDisabled ? disabledHint : isReadOnly ? readonlyHint : undefined,
		run: () => {
			if (isDisabled || isReadOnly) return;
			target.focus();
			try {
				document.execCommand('redo');
			} catch {}
		}
	});

	items.push({ kind: 'separator' });

	// Taglia e Copia (omessi per password)
	if (!isPassword) {
		items.push({
			kind: 'item',
			label: 'Taglia',
			icon: IconCut,
			shortcut: `${MOD}X`,
			disabled: isDisabled || isReadOnly || !hasSelection,
			hint: isDisabled
				? disabledHint
				: isReadOnly
					? readonlyHint
					: !hasSelection
						? noSelectionHint
						: undefined,
			run: async () => {
				if (isDisabled || isReadOnly) return;
				target.focus();
				if (isInput || isTextArea) {
					const field = target as HTMLInputElement | HTMLTextAreaElement;
					if (supportsSelection) {
						const start = field.selectionStart ?? 0;
						const end = field.selectionEnd ?? 0;
						if (start !== end) {
							const text = field.value.slice(start, end);
							try {
								await navigator.clipboard.writeText(text);
							} catch {
								try {
									document.execCommand('copy');
								} catch {}
							}
							field.setRangeText('', start, end, 'end');
							triggerInputEvents(field);
						}
					} else {
						try {
							await navigator.clipboard.writeText(field.value);
						} catch {}
						field.value = '';
						triggerInputEvents(field);
					}
				} else if (target.isContentEditable) {
					try {
						document.execCommand('cut');
					} catch {}
				}
			}
		});

		items.push({
			kind: 'item',
			label: 'Copia',
			icon: IconCopy,
			shortcut: `${MOD}C`,
			disabled: isDisabled ? true : !hasSelection,
			hint: isDisabled ? disabledHint : !hasSelection ? noSelectionHint : undefined,
			run: async () => {
				if (selectedText) {
					try {
						await navigator.clipboard.writeText(selectedText);
					} catch {
						try {
							document.execCommand('copy');
						} catch {}
					}
				} else if (target.isContentEditable) {
					try {
						document.execCommand('copy');
					} catch {}
				}
			}
		});
	}

	// Incolla
	items.push({
		kind: 'item',
		label: 'Incolla',
		icon: IconPaste,
		shortcut: `${MOD}V`,
		disabled: isDisabled || isReadOnly,
		hint: isDisabled ? disabledHint : isReadOnly ? readonlyHint : undefined,
		run: async () => {
			if (isDisabled || isReadOnly) return;
			target.focus();
			let text = '';
			try {
				text = await navigator.clipboard.readText();
			} catch {
				try {
					document.execCommand('paste');
				} catch {}
				return;
			}
			if (!text) return;

			if (isInput || isTextArea) {
				const field = target as HTMLInputElement | HTMLTextAreaElement;
				if (supportsSelection) {
					const start = field.selectionStart ?? 0;
					const end = field.selectionEnd ?? 0;
					field.setRangeText(text, start, end, 'end');
				} else {
					field.value = text;
				}
				triggerInputEvents(field);
			} else if (target.isContentEditable) {
				let inserted = false;
				try {
					inserted = document.execCommand('insertText', false, text);
				} catch {}
				if (!inserted) {
					const sel = window.getSelection();
					if (sel && sel.rangeCount > 0) {
						const range = sel.getRangeAt(0);
						range.deleteContents();
						range.insertNode(document.createTextNode(text));
						triggerInputEvents(target);
					}
				}
			}
		}
	});

	items.push({ kind: 'separator' });

	// Seleziona tutto
	items.push({
		kind: 'item',
		label: 'Seleziona tutto',
		icon: IconSelectAll,
		shortcut: `${MOD}A`,
		disabled: isDisabled || !hasContent,
		hint: isDisabled ? disabledHint : !hasContent ? noContentHint : undefined,
		run: () => {
			if (isDisabled) return;
			target.focus();
			if (isInput || isTextArea) {
				(target as HTMLInputElement | HTMLTextAreaElement).select();
			} else if (target.isContentEditable) {
				try {
					document.execCommand('selectAll');
				} catch {
					const sel = window.getSelection();
					if (sel) {
						const range = document.createRange();
						range.selectNodeContents(target);
						sel.removeAllRanges();
						sel.addRange(range);
					}
				}
			}
		}
	});

	return items;
}

export function installContextMenuHandling(): () => void {
	function onContextMenu(event: MouseEvent) {
		const target = event.target as HTMLElement | null;
		if (!target) return;

		// Se il click avviene dentro il menu contestuale aperto, sopprimi senza ricreare
		if (target.closest('.context-menu')) {
			event.preventDefault();
			return;
		}

		// Superfici con gestione autonoma (Monaco Editor, terminale xterm):
		// sopprimi il menu nativo della WebView ma lascia propagare l'evento ai componenti
		if (target.closest('.monaco-editor, .xterm')) {
			event.preventDefault();
			return;
		}

		// Controlli di input / selezione non testuali
		if (target instanceof HTMLInputElement && NON_TEXT_INPUT_TYPES[target.type.toLowerCase()]) {
			event.preventDefault();
			contextMenu.close();
			return;
		}

		// Campi di inserimento testo (input testuali, textarea, contenteditable)
		const isText =
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES[target.type.toLowerCase()]) ||
			target.isContentEditable;

		if (isText) {
			event.preventDefault();
			const items = buildTextEntryMenu(target);
			contextMenu.open(event, {
				label: 'Modifica testo',
				items,
				invoker: target
			});
			return;
		}

		// Selezione testo in sola lettura che interseca effettivamente il target cliccato
		if (selectionIntersectsTarget(target)) {
			const sel = window.getSelection();
			const selectedText = sel ? sel.toString() : '';
			if (selectedText) {
				event.preventDefault();
				contextMenu.open(event, {
					label: 'Testo selezionato',
					items: [
						{
							kind: 'item',
							label: 'Copia',
							icon: IconCopy,
							shortcut: `${MOD}C`,
							run: async () => {
								try {
									await navigator.clipboard.writeText(selectedText);
								} catch {
									try {
										document.execCommand('copy');
									} catch {}
								}
							}
						}
					],
					invoker: target
				});
				return;
			}
		}

		// Per ogni altra area dell'applicazione: sopprimi il menu nativo e chiudi menu aperti.
		// L'evento continua la propagazione così che gestori dedicati (es. FileTree) possano
		// aprire il proprio menu tramite contextMenu.open().
		event.preventDefault();
		contextMenu.close();
	}

	document.addEventListener('contextmenu', onContextMenu, true);
	return () => {
		document.removeEventListener('contextmenu', onContextMenu, true);
	};
}
