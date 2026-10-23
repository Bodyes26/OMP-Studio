/**
 * Modalita' di `/compact`, specchio di `session/compact-modes.ts` di omp.
 *
 * L'RPC `compact` non porta la modalita': per forzarne una Studio manda a omp
 * la stessa riga che scrive la TUI (`/compact snapcompact`), che omp risolve
 * come comando slash ACP. Senza modalita' vale `compaction.strategy` di omp
 * (snapcompact di default, con ripiego sul riepilogo se il modello e' solo
 * testo): lo stesso comportamento della TUI.
 */

export type CompactMode = 'soft' | 'remote' | 'snapcompact';

export const COMPACT_MODES: readonly CompactMode[] = ['snapcompact', 'soft', 'remote'];

/** Esito di una compattazione: l'RPC `compact` risponde con tutti i campi, il comando slash solo con i token. */
export interface CompactResult {
	summary?: string;
	shortSummary?: string;
	tokensBefore?: number;
	tokensAfter?: number;
	firstKeptEntryId?: string;
}

export type ParsedCompactArgs = { mode?: CompactMode; instructions?: string } | { error: string };

/** Come `parseCompactArgs` di omp: il primo token e' la modalita' solo se la nomina. */
export function parseCompactArgs(args: string): ParsedCompactArgs {
	const trimmed = args.trim();
	if (!trimmed) return {};
	const space = trimmed.search(/\s/);
	const first = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
	const mode = COMPACT_MODES.find((candidate) => candidate === first);
	if (!mode) return { instructions: trimmed };
	const focus = space === -1 ? '' : trimmed.slice(space + 1).trim();
	if (mode === 'snapcompact' && focus) {
		return { error: '/compact snapcompact non accetta istruzioni di focus (archivia senza riepilogo LLM)' };
	}
	return { mode, instructions: focus || undefined };
}

/** La riga che omp interpreta come comando slash. */
export function compactCommandLine(mode: CompactMode, instructions?: string): string {
	return instructions ? `/compact ${mode} ${instructions}` : `/compact ${mode}`;
}

/**
 * La scheda di scelta serve solo quando c'e' davvero da scegliere: modello con
 * input immagine (snapcompact possibile), nessuna modalita' gia' indicata e
 * nessun focus (il focus implica un riepilogo diretto da LLM).
 */
export function needsCompactChoice(parsed: { mode?: CompactMode; instructions?: string }, modelHasImages: boolean): boolean {
	return modelHasImages && !parsed.mode && !parsed.instructions;
}

/** Estrae i token dall'esito testuale `Compaction complete. Tokens: A -> B (saved C).` */
export function parseCompactOutput(text: string): { tokensBefore?: number; tokensAfter?: number; failed?: string } {
	const failed = /Compaction failed:\s*(.+)/.exec(text);
	if (failed) return { failed: failed[1].trim() };
	const tokens = /Tokens:\s*(\d+)\s*->\s*(\d+)/.exec(text);
	if (!tokens) return {};
	return { tokensBefore: Number(tokens[1]), tokensAfter: Number(tokens[2]) };
}
