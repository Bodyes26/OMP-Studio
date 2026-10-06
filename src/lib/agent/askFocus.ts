export interface FocusElementLike {
	tagName: string;
	isContentEditable: boolean;
	closest?: (selector: string) => Element | null;
}

/** Selettori di superfici dove l'utente puo' digitare senza passare dal composer. */
const TYPING_SURFACE_SELECTORS =
	'.monaco-editor, .xterm, .ask-card, .task-editor, .viewport-frame, .chat-composer';
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
			Boolean(activeElement.isContentEditable) ||
			isTypingSurface(activeElement as unknown as EventTarget));

	return !typingElsewhere;
}

/**
 * Composizione IME in corso (giapponese, cinese, accenti con tasti morti):
 * Invio conferma il carattere composto e non deve inviare nulla. `keyCode
 * 229` copre WebView2/Safari, che consegnano il keydown di conferma con
 * `isComposing` gia' falso.
 */
export function isImeComposing(e: { isComposing?: boolean; keyCode?: number }, composing = false): boolean {
	return composing || Boolean(e.isComposing) || e.keyCode === 229;
}

export type AskConfirmKeyAction = 'native' | 'yes' | 'escape' | 'ignore';

/**
 * Tasti della scheda di conferma. Su un pulsante Invio e Spazio restano al
 * pulsante: con il fuoco su «No», Invio rispondeva «Si'» perche' il ramo della
 * conferma veniva prima del controllo sul pulsante.
 */
export function askConfirmKeyAction(key: string, targetInButton: boolean): AskConfirmKeyAction {
	if (targetInButton && (key === 'Enter' || key === ' ')) return 'native';
	if (key === 'Enter') return 'yes';
	if (key === 'Escape') return 'escape';
	return 'ignore';
}
