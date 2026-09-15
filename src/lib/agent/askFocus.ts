export interface FocusElementLike {
	tagName: string;
	isContentEditable: boolean;
}

/** Selettori di superfici dove l'utente puo' digitare senza passare dal composer. */
const TYPING_SURFACE_SELECTORS =
	'.monaco-editor, .xterm, .ask-card, .task-editor, .viewport-frame';

/**
 * True se l'elemento e' (o sta dentro) una superficie di digitazione esterna al composer.
 * Usa sia il target dell'evento sia `document.activeElement`: Monaco e xterm non sempre
 * espongono la textarea come target del keydown.
 */
export function isTypingSurface(node: EventTarget | null): boolean {
	if (!node || typeof node !== 'object') return false;
	const el = node as HTMLElement & { closest?: (selector: string) => Element | null };
	if (typeof el.tagName === 'string') {
		const tag = el.tagName.toUpperCase();
		if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
	}
	if (el.isContentEditable) return true;
	if (typeof el.closest === 'function' && el.closest(TYPING_SURFACE_SELECTORS)) return true;
	return false;
}

/**
 * Decide se una nuova richiesta interattiva puo' ricevere il focus.
 * La verifica resta separata dal DOM per coprire il confine tra webview e finestra nativa.
 */
export function shouldAutoFocusAskCard(
	visible: boolean,
	documentHasFocus: boolean,
	activeElement: FocusElementLike | null,
	bodyElement: FocusElementLike | null,
	activeInsideCard: boolean
): boolean {
	if (!visible) return false;
	if (!documentHasFocus) return false;

	const typingElsewhere =
		activeElement !== null &&
		activeElement !== bodyElement &&
		!activeInsideCard &&
		(activeElement.tagName === 'INPUT' ||
			activeElement.tagName === 'TEXTAREA' ||
			activeElement.isContentEditable);

	return !typingElsewhere;
}
