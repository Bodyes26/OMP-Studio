import { IS_MAC } from '#lib/utils/platform.ts';
import { isJumpModifierKey, type KeyboardEventLike } from './shortcutMatch.ts';

/** Quanto tenere il modificatore prima che compaiano i numeri (TPR-042). */
export const JUMP_HINT_DELAY_MS = 800;

/**
 * Numeri sulle tessere mentre si tiene premuto Ctrl (Cmd su Mac). Ctrl si
 * preme per ogni combinazione (Ctrl+C, Ctrl+Tab): qualunque altro tasto,
 * clic, rilascio o perdita del fuoco annulla l'attesa, cosi' i numeri
 * compaiono solo a chi tiene il tasto apposta. Il salto non li aspetta.
 */
class ProjectJumpHints {
	visible = $state(false);
	private timer: number | undefined;

	keydown(e: KeyboardEventLike & { repeat?: boolean }): void {
		if (!isJumpModifierKey(e, IS_MAC)) {
			this.reset();
			return;
		}
		// La ripetizione automatica del tasto tenuto non riavvia l'attesa.
		if (e.repeat || this.timer !== undefined || this.visible) return;
		this.timer = window.setTimeout(() => {
			this.timer = undefined;
			this.visible = true;
		}, JUMP_HINT_DELAY_MS);
	}

	reset(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		this.visible = false;
	}
}

export const projectJumpHints = new ProjectJumpHints();
