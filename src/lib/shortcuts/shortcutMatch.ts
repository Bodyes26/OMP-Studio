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

/**
 * Ctrl+Tab (o Cmd+Tab): progetto successivo; con Maiusc il precedente.
 * `null` se l'evento non e' questa combinazione.
 */
export function projectCycleDirection(e: KeyboardEventLike): 1 | -1 | null {
	if (e.altKey || !(e.ctrlKey || e.metaKey) || (e.key !== 'Tab' && e.code !== 'Tab')) return null;
	return e.shiftKey ? -1 : 1;
}

/**
 * Il modificatore del salto al progetto N: Cmd su Mac, dove Ctrl+cifra cambia
 * Scrivania in Mission Control; Ctrl altrove. Alt e' escluso: Alt+cifra
 * appartiene ai suggerimenti del composer, e Ctrl+Alt e' anche AltGr.
 */
function jumpModifierOnly(e: KeyboardEventLike, mac: boolean): boolean {
	if (e.altKey || e.shiftKey) return false;
	return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** Il modificatore del salto premuto da solo: fa comparire i numeri sulle tessere. */
export function isJumpModifierKey(e: KeyboardEventLike, mac: boolean): boolean {
	return jumpModifierOnly(e, mac) && e.key === (mac ? 'Meta' : 'Control');
}

/**
 * Ctrl+1 … Ctrl+9 (Cmd su Mac): la cifra, oppure `null`. Si legge `code`
 * perche' su alcune tastiere (francese) la riga dei numeri senza Maiusc
 * scrive simboli.
 */
export function projectJumpDigit(e: KeyboardEventLike, mac: boolean): number | null {
	if (!jumpModifierOnly(e, mac)) return null;
	const match = /^Digit([1-9])$/.exec(e.code ?? '') ?? /^([1-9])$/.exec(e.key);
	return match ? Number(match[1]) : null;
}

/** Tessera aperta dalla cifra: 1–8 per posizione, 9 l'ultima, come nei browser. */
export function projectJumpIndex(digit: number, count: number): number | null {
	if (count === 0) return null;
	if (digit === 9) return count - 1;
	return digit - 1 < count ? digit - 1 : null;
}

/** Numero mostrato sulla tessera in posizione `index`, o `null` se non ne ha. */
export function projectJumpLabel(index: number, count: number): number | null {
	if (index < 8) return index + 1;
	return index === count - 1 ? 9 : null;
}
