// Modificatori delle scorciatoie del composer (docs/SHORTCUTS.md).
//
// Su Windows e Linux le scorciatoie a lettera usano Alt; Ctrl+Alt resta
// escluso perche' su Windows e' AltGr, che scrive @ € [ ] nei layout europei.
// Su macOS Opzione+lettera scrive caratteri (€ ç ñ ø ...): rubarla
// impediva di scriverli, quindi li' le stesse scorciatoie passano a
// Ctrl+Opzione, che non produce caratteri.

export interface ModifierState {
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

export type ComposerChord = 'letter' | 'command' | null;

/**
 * `letter`: la combinazione delle scorciatoie a lettera (Alt, o Ctrl+Opzione
 * su Mac). `command`: Ctrl/Cmd da solo (Ctrl+P, Ctrl+C).
 */
export function composerChord(e: ModifierState, isMac: boolean): ComposerChord {
	if (e.shiftKey) return null;
	if (isMac) {
		if (e.ctrlKey && e.altKey && !e.metaKey) return 'letter';
	} else if (e.altKey && !e.ctrlKey && !e.metaKey) {
		return 'letter';
	}
	if ((e.ctrlKey || e.metaKey) && !e.altKey) return 'command';
	return null;
}

/** Etichetta del modificatore delle scorciatoie a lettera, nel formato `A+B` della guida. */
export function letterChordLabel(isMac: boolean): string {
	return isMac ? '⌃+⌥' : 'Alt';
}
