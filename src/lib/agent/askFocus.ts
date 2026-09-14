export interface FocusElementLike {
	tagName: string;
	isContentEditable: boolean;
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
