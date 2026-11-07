// Riconoscimento titoli segnaposto e limiti di denominazione per le corsie.
//
// Le corsie nascono con titoli predefiniti ("Worktree N" per git, "Nuovo prototipo" o
// "New prototype" per lab, secondo la lingua dell'interfaccia alla creazione).
// Al primo prompt smol sintetizza il nome reale, a meno che l'utente non abbia
// gia' assegnato un titolo esplicito (che imposta titleLocked: true).

/** Lunghezza massima consentita per la rinomina manuale del titolo di una corsia. */
export const LANE_TITLE_MAX = 40;

/**
 * Verifica se un titolo corrisponde al segnaposto predefinito non ancora personalizzato.
 * Git: 'Worktree N'
 * Lab: 'Nuovo prototipo' / 'New prototype' (case-insensitive)
 */
export function isPlaceholderLaneTitle(title: string, kind: 'git' | 'lab'): boolean {
	const trimmed = title.trim();
	if (kind === 'git') {
		return /^Worktree\s+\d+$/i.test(trimmed);
	}
	const lower = trimmed.toLowerCase();
	return lower === 'nuovo prototipo' || lower === 'new prototype';
}
