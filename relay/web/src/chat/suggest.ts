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
