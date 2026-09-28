// Riconoscimento titoli segnaposto e limiti di denominazione per le corsie.
//
// Le corsie nascono con titoli predefiniti ("Worktree N" per git, "Nuovo prototipo" per lab).
// Al primo prompt smol sintetizza il nome reale, a meno che l'utente non abbia
// gia' assegnato un titolo esplicito (che imposta titleLocked: true).

/** Lunghezza massima consentita per la rinomina manuale del titolo di una corsia. */
export const LANE_TITLE_MAX = 40;

/**
 * Verifica se un titolo corrisponde al segnaposto predefinito non ancora personalizzato.
 * Git: 'Worktree N'
 * Lab: 'Nuovo prototipo' (case-insensitive)
 */
export function isPlaceholderLaneTitle(title: string, kind: 'git' | 'lab'): boolean {
	const trimmed = title.trim();
	if (kind === 'git') {
		return /^Worktree\s+\d+$/i.test(trimmed);
	}
	return trimmed.toLowerCase() === 'nuovo prototipo';
}
