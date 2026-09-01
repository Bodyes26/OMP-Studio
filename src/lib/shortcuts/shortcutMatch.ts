/**
 * Riconoscimento delle scorciatoie da tastiera del guscio Studio.
 * Centralizza i criteri di matching per evitare disallineamenti tra
 * window handler (+page.svelte), terminale xterm e composer.
 */

export interface KeyboardEventLike {
	key: string;
	code?: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

/**
 * Riconosce la combinazione per aprire/chiudere la guida alle scorciatoie:
 * Alt+H, Alt+K, F1 oppure Ctrl+Alt+H / Cmd+Alt+H.
 */
export function isShortcutsHelpKey(e: KeyboardEventLike): boolean {
	const isAltOnly = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
	const keyLower = e.key.toLowerCase();
	const code = e.code;
	return (
		(isAltOnly && (keyLower === 'h' || code === 'KeyH' || keyLower === 'k' || code === 'KeyK')) ||
		e.key === 'F1' ||
		((e.ctrlKey || e.metaKey) && e.altKey && (keyLower === 'h' || code === 'KeyH'))
	);
}

/**
 * Riconosce una combinazione globale riservata al guscio Studio (Ctrl+Alt+... o Cmd+Alt+...).
 */
export function isGlobalShellShortcut(e: KeyboardEventLike): boolean {
	return e.altKey && (e.ctrlKey || e.metaKey);
}
