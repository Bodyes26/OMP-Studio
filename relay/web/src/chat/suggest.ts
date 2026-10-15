/**
 * Logica pura per l'autocompletamento di comandi slash e skill nel composer della PWA.
 * Portata da Studio (src/lib/agent/suggestItems.ts), senza dipendenze dalla GUI.
 */

import type { RemoteSlashCommand } from '../../../src/protocol.ts';

export interface CommandSuggestionItem {
	kind: 'cmd';
	command: RemoteSlashCommand;
	isSkill: boolean;
	hits: number[];
}

export type SuggestKeyAction =
	| { kind: 'move'; index: number }
	| { kind: 'pick' }
	| { kind: 'dismiss' };

/**
 * Calcola gli indici dei caratteri corrispondenti alla query nel nome del comando.
 */
function findHits(name: string, query: string): number[] {
	if (!query) return [];
	const lowerName = name.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const idx = lowerName.indexOf(lowerQuery);
	if (idx === -1) return [];
	const hits: number[] = [];
	for (let i = 0; i < lowerQuery.length; i++) {
		hits.push(idx + i);
	}
	return hits;
}

/**
 * Filtra e ordina i comandi e le skill che corrispondono alla query.
 * Prima i comandi regolari, poi le skill.
 */
export function commandSuggestions(commands: RemoteSlashCommand[], rawQuery: string): CommandSuggestionItem[] {
	let clean = rawQuery.trim();
	if (clean.startsWith('/')) {
		clean = clean.slice(1);
	}
	const cleanLower = clean.toLowerCase();
	const isSkillPrefix = cleanLower.startsWith('skill:');
	const isTypingSkillKeyword = !isSkillPrefix && 'skill:'.startsWith(cleanLower) && cleanLower.length >= 2;
	const search = isSkillPrefix ? clean.slice(6) : clean;
	const lower = search.toLowerCase();

	const matches = commands.filter((c) => {
		if (!cleanLower) return true;
		const nameLower = c.name.toLowerCase();
		if (isSkillPrefix) {
			return c.kind === 'skill' && (!lower || nameLower.includes(lower));
		}
		if (c.kind === 'skill' && isTypingSkillKeyword) {
			return true;
		}
		return nameLower.includes(lower);
	});

	const regularCmds = matches
		.filter((c) => c.kind !== 'skill')
		.map((command): CommandSuggestionItem => ({
			kind: 'cmd',
			command,
			isSkill: false,
			hits: findHits(command.name, search)
		}));

	const skillCmds = matches
		.filter((c) => c.kind === 'skill')
		.map((command): CommandSuggestionItem => ({
			kind: 'cmd',
			command,
			isSkill: true,
			hits: findHits(command.name, isSkillPrefix ? search : clean)
		}));

	return [...regularCmds, ...skillCmds];
}
/**
 * Traduce un tasto della tastiera in un'azione sulla tendina aperta.
 * Chiama preventDefault sui tasti catturati.
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

export interface SlashTokenMatch {
	query: string;
	start: number;
	end: number;
}

/**
 * Identifica se alla posizione del cursore e' presente un token che comincia con '/'
 * all'inizio della riga o dopo uno spazio bianco.
 */
export function getCurrentSlashToken(text: string, caretPos: number): SlashTokenMatch | null {
	if (caretPos < 0 || caretPos > text.length) return null;

	// Cerca all'indietro l'inizio della parola
	let start = caretPos;
	while (start > 0 && !/\s/.test(text[start - 1])) {
		start--;
	}

	// Il token deve iniziare con '/'
	if (text[start] !== '/') {
		return null;
	}

	// Non deve essere parte di un URL o percorso preceduto da caratteri non-spazio
	if (start > 0 && !/\s/.test(text[start - 1])) {
		return null;
	}

	// Trova la fine del token (primo spazio o fine testo)
	let end = caretPos;
	while (end < text.length && !/\s/.test(text[end])) {
		end++;
	}

	// Il cursore deve trovarsi tra start e end
	if (caretPos < start || caretPos > end) {
		return null;
	}

	const query = text.slice(start + 1, caretPos);
	return { query, start, end };
}

/**
 * Sostituisce il token slash con il comando scelto e restituisce il nuovo testo e posizione cursore.
 */
export function replaceSlashToken(
	text: string,
	token: { start: number; end: number },
	commandName: string,
	isSkill: boolean
): { nextText: string; nextCaret: number } {
	const prefix = isSkill ? `/skill:${commandName} ` : `/${commandName} `;
	const nextText = text.slice(0, token.start) + prefix + text.slice(token.end);
	const nextCaret = token.start + prefix.length;
	return { nextText, nextCaret };
}
