import { describe, expect, it } from 'bun:test';
import type { RemoteSlashCommand } from '../../src/protocol.ts';
import {
	commandSuggestions,
	suggestKeyAction
} from '../src/chat/suggest.ts';

const MOCK_COMMANDS: RemoteSlashCommand[] = [
	{ name: 'compact', kind: 'command', description: 'Compatta il contesto', hint: null },
	{ name: 'export', kind: 'command', description: 'Esporta la chat', hint: '<file>' },
	{ name: 'tree', kind: 'command', description: 'Mostra i file', hint: null },
	{ name: 'impeccable', kind: 'skill', description: 'Linee guida di design', hint: null },
	{ name: 'audit', kind: 'skill', description: 'Audit del codice', hint: null }
];

describe('commandSuggestions', () => {
	it('orders regular commands before skills on empty query', () => {
		const suggestions = commandSuggestions(MOCK_COMMANDS, '');
		expect(suggestions.length).toBe(5);
		expect(suggestions[0].command.name).toBe('compact');
		expect(suggestions[0].isSkill).toBe(false);
		expect(suggestions[1].command.name).toBe('export');
		expect(suggestions[2].command.name).toBe('tree');
		expect(suggestions[3].command.name).toBe('impeccable');
		expect(suggestions[3].isSkill).toBe(true);
		expect(suggestions[4].command.name).toBe('audit');
		expect(suggestions[4].isSkill).toBe(true);
	});

	it('strips leading slash from query', () => {
		const suggestions = commandSuggestions(MOCK_COMMANDS, '/tree');
		expect(suggestions.length).toBe(1);
		expect(suggestions[0].command.name).toBe('tree');
		expect(suggestions[0].hits).toEqual([0, 1, 2, 3]);
	});

	it('filters case-insensitively and returns matching hits', () => {
		const suggestions = commandSuggestions(MOCK_COMMANDS, 'AUD');
		expect(suggestions.length).toBe(1);
		expect(suggestions[0].command.name).toBe('audit');
		expect(suggestions[0].isSkill).toBe(true);
		expect(suggestions[0].hits).toEqual([0, 1, 2]);
	});

	it('filters only skills when query starts with skill: prefix', () => {
		const suggestions = commandSuggestions(MOCK_COMMANDS, 'skill:imp');
		expect(suggestions.length).toBe(1);
		expect(suggestions[0].command.name).toBe('impeccable');
		expect(suggestions[0].isSkill).toBe(true);
		expect(suggestions[0].hits).toEqual([0, 1, 2]);
	});

	it('matches all skills when query is sk or skill prefix', () => {
		const suggestions = commandSuggestions(MOCK_COMMANDS, '/sk');
		expect(suggestions.length).toBe(2);
		expect(suggestions.map((s) => s.command.name)).toEqual(['impeccable', 'audit']);
		expect(suggestions.every((s) => s.isSkill)).toBe(true);
	});

	it('returns commands first when both command and skill match', () => {
		const list: RemoteSlashCommand[] = [
			{ name: 'test-skill', kind: 'skill', description: 'Skill test', hint: null },
			{ name: 'test-cmd', kind: 'command', description: 'Command test', hint: null }
		];
		const suggestions = commandSuggestions(list, 'test');
		expect(suggestions.map((s) => s.command.name)).toEqual(['test-cmd', 'test-skill']);
	});
});

describe('suggestKeyAction', () => {
	function createKeyEvent(key: string): KeyboardEvent {
		let prevented = false;
		return {
			key,
			preventDefault: () => {
				prevented = true;
			},
			get defaultPrevented() {
				return prevented;
			}
		} as unknown as KeyboardEvent;
	}

	it('navigates with ArrowDown wrapping to 0', () => {
		const e = createKeyEvent('ArrowDown');
		const action = suggestKeyAction(e, 3, 2);
		expect(action).toEqual({ kind: 'move', index: 0 });
		expect(e.defaultPrevented).toBe(true);
	});

	it('navigates with ArrowUp wrapping to last item', () => {
		const e = createKeyEvent('ArrowUp');
		const action = suggestKeyAction(e, 3, 0);
		expect(action).toEqual({ kind: 'move', index: 2 });
		expect(e.defaultPrevented).toBe(true);
	});

	it('picks with Enter and Tab', () => {
		const enterEvent = createKeyEvent('Enter');
		expect(suggestKeyAction(enterEvent, 3, 1)).toEqual({ kind: 'pick' });
		expect(enterEvent.defaultPrevented).toBe(true);

		const tabEvent = createKeyEvent('Tab');
		expect(suggestKeyAction(tabEvent, 3, 1)).toEqual({ kind: 'pick' });
		expect(tabEvent.defaultPrevented).toBe(true);
	});

	it('dismisses with Escape', () => {
		const e = createKeyEvent('Escape');
		expect(suggestKeyAction(e, 3, 1)).toEqual({ kind: 'dismiss' });
		expect(e.defaultPrevented).toBe(true);
	});

	it('ignores unhandled keys', () => {
		const e = createKeyEvent('a');
		expect(suggestKeyAction(e, 3, 1)).toBeNull();
		expect(e.defaultPrevented).toBe(false);
	});
});
