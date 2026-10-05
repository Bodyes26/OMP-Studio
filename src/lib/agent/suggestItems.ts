/**
 * Logica condivisa della palette `@`/`/` (SuggestPanel) fra i due editor di prompt
 * a badge: il composer della chat e il Task Editor. Qui stanno le parti pure
 * (costruzione delle voci, riconoscimento delle skill, tasti di navigazione);
 * ogni editor tiene il proprio stato e decide cosa fare alla scelta.
 */
import type { AvailableCommand } from './wire';
import type { RankedFileItem } from './fileMention';
import type { SuggestionItem } from './components/SuggestPanel.svelte';

/** Larghezza della palette: deve coincidere con .suggest-panel in SuggestPanel.svelte. */
export const SUGGEST_WIDTH = 440;

/** Comandi che corrispondono alla query, prima i comandi e poi le skill. */
export function commandSuggestions(commands: AvailableCommand[], query: string): SuggestionItem[] {
	const lower = query.toLowerCase();
	const matches = commands.filter(
		(c) =>
			!lower ||
			c.name.toLowerCase().includes(lower) ||
			c.aliases?.some((a) => a.toLowerCase().includes(lower))
	);
	return [
		...matches
			.filter((c) => c.source !== 'skill')
			.map((command): SuggestionItem => ({ kind: 'cmd', command, isSkill: false, hits: [] })),
		...matches
			.filter((c) => c.source === 'skill')
			.map((command): SuggestionItem => ({ kind: 'cmd', command, isSkill: true, hits: [] }))
	];
}

export function fileSuggestions(ranked: RankedFileItem[]): SuggestionItem[] {
	return ranked.map((item) => ({ kind: 'file', item, hits: [] }));
}

/** Vero se `name` (con o senza prefisso `skill:`) e' una skill del catalogo. */
export function isSkillName(commands: AvailableCommand[], name: string): boolean {
	const clean = name.replace(/^skill:/, '');
	const found = commands.find((c) => c.name.toLowerCase() === clean.toLowerCase());
	return found?.source === 'skill' || name.startsWith('skill:');
}

export type SuggestKeyAction =
	| { kind: 'move'; index: number }
	| { kind: 'pick' }
	| { kind: 'dismiss' };

/**
 * Traduce un tasto in un'azione sulla palette aperta (frecce, Invio/Tab, Esc).
 * Restituisce null per i tasti che appartengono all'editor.
 */
export function suggestKeyAction(e: KeyboardEvent, count: number, index: number): SuggestKeyAction | null {
	if (count === 0) return null;
	switch (e.key) {
		case 'ArrowDown':
			e.preventDefault();
			return { kind: 'move', index: (index + 1) % count };
		case 'ArrowUp':
			e.preventDefault();
			return { kind: 'move', index: (index - 1 + count) % count };
		case 'Enter':
		case 'Tab':
			e.preventDefault();
			return { kind: 'pick' };
		case 'Escape':
			e.preventDefault();
			return { kind: 'dismiss' };
		default:
			return null;
	}
}
