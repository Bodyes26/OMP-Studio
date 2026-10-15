import { describe, expect, it } from 'bun:test';
import type { RemoteChatMessage, RemoteChatPage } from '../../src/protocol.ts';
import {
	applyChatEvent,
	applyChatPage,
	deduceToolCategory,
	groupMessages,
	normalizeMessage,
	parseOmpDiff
} from '../src/chat/merge.ts';

describe('chat message normalization & old host fallback', () => {
	it('deduces categories for known tool names', () => {
		expect(deduceToolCategory('read')).toBe('read');
		expect(deduceToolCategory('grep')).toBe('search');
		expect(deduceToolCategory('bash')).toBe('run');
		expect(deduceToolCategory('edit')).toBe('edit');
		expect(deduceToolCategory('web_search')).toBe('web');
		expect(deduceToolCategory('unknown_custom_tool')).toBe('other');
		expect(deduceToolCategory(null)).toBe('other');
	});

	it('creates synthetic blocks for old assistant message without blocks', () => {
		const raw: RemoteChatMessage = {
			id: 'm1',
			role: 'assistant',
			text: 'Hello world',
			toolName: null,
			timestamp: 1000
		};
		const norm = normalizeMessage(raw);
		expect(norm.blocks).toBeDefined();
		expect(norm.blocks?.length).toBe(1);
		expect(norm.blocks?.[0]).toEqual({ type: 'text', text: 'Hello world' });
	});

	it('creates synthetic tool call for old tool message without tool object', () => {
		const raw: RemoteChatMessage = {
			id: 't1',
			role: 'tool',
			text: 'src/App.svelte',
			toolName: 'read',
			timestamp: 2000
		};
		const norm = normalizeMessage(raw);
		expect(norm.tool).toBeDefined();
		expect(norm.tool?.category).toBe('read');
		expect(norm.tool?.label).toBe('read');
		expect(norm.tool?.detail).toBe('src/App.svelte');
		expect(norm.tool?.status).toBe('ok');
	});
});

describe('chat event merging', () => {
	it('replaces existing message with same id on message event', () => {
		const initial: RemoteChatMessage[] = [
			{ id: '1', role: 'user', text: 'hi', toolName: null, timestamp: 100 },
			{ id: '2', role: 'assistant', text: 'thinking...', toolName: null, timestamp: 101 }
		];

		const updated = applyChatEvent(initial, {
			kind: 'message',
			message: { id: '2', role: 'assistant', text: 'done!', toolName: null, timestamp: 105 }
		});

		expect(updated.length).toBe(2);
		expect(updated[1].text).toBe('done!');
	});

	it('appends message on message event if id is new', () => {
		const initial: RemoteChatMessage[] = [
			{ id: '1', role: 'user', text: 'hi', toolName: null, timestamp: 100 }
		];

		const updated = applyChatEvent(initial, {
			kind: 'message',
			message: { id: '2', role: 'assistant', text: 'hello', toolName: null, timestamp: 101 }
		});

		expect(updated.length).toBe(2);
		expect(updated[1].id).toBe('2');
	});

	it('creates new assistant message when delta arrives for unknown messageId', () => {
		const initial: RemoteChatMessage[] = [];
		const updated = applyChatEvent(initial, {
			kind: 'delta',
			messageId: 'stream-1',
			text: 'First chunk'
		});

		expect(updated.length).toBe(1);
		expect(updated[0].id).toBe('stream-1');
		expect(updated[0].role).toBe('assistant');
		expect(updated[0].text).toBe('First chunk');
		expect(updated[0].blocks).toEqual([{ type: 'text', text: 'First chunk' }]);
	});

	it('appends text deltas to existing assistant message', () => {
		const initial: RemoteChatMessage[] = [
			{
				id: 'm1',
				role: 'assistant',
				text: 'Hello',
				toolName: null,
				timestamp: 100,
				blocks: [{ type: 'text', text: 'Hello' }]
			}
		];

		const step1 = applyChatEvent(initial, {
			kind: 'delta',
			messageId: 'm1',
			text: ' world'
		});

		expect(step1[0].text).toBe('Hello world');
		expect(step1[0].blocks).toEqual([{ type: 'text', text: 'Hello world' }]);
	});

	it('handles thinking and text block deltas with index routing', () => {
		const initial: RemoteChatMessage[] = [];

		// 1. Thinking delta begins
		const step1 = applyChatEvent(initial, {
			kind: 'delta',
			messageId: 'm1',
			block: 'thinking',
			text: 'I need to check',
			index: 0
		});

		expect(step1[0].blocks).toEqual([{ type: 'thinking', text: 'I need to check' }]);
		expect(step1[0].text).toBe('');

		// 2. More thinking on same block
		const step2 = applyChatEvent(step1, {
			kind: 'delta',
			messageId: 'm1',
			block: 'thinking',
			text: ' the files.',
			index: 0
		});

		expect(step2[0].blocks).toEqual([{ type: 'thinking', text: 'I need to check the files.' }]);

		// 3. Text block begins at index 1
		const step3 = applyChatEvent(step2, {
			kind: 'delta',
			messageId: 'm1',
			block: 'text',
			text: 'Here is the result:',
			index: 1
		});

		expect(step3[0].blocks?.length).toBe(2);
		expect(step3[0].blocks?.[0]).toEqual({ type: 'thinking', text: 'I need to check the files.' });
		expect(step3[0].blocks?.[1]).toEqual({ type: 'text', text: 'Here is the result:' });
		expect(step3[0].text).toBe('Here is the result:');
	});
});

describe('history pagination merging', () => {
	it('replaces all messages on replace mode', () => {
		const existing: RemoteChatMessage[] = [
			{ id: '1', role: 'user', text: 'old', toolName: null, timestamp: 10 }
		];
		const page: RemoteChatPage = {
			messages: [{ id: '2', role: 'user', text: 'new', toolName: null, timestamp: 20 }],
			before: 'cursor-1'
		};

		const result = applyChatPage(existing, page, 'replace');
		expect(result.messages.length).toBe(1);
		expect(result.messages[0].id).toBe('2');
		expect(result.before).toBe('cursor-1');
	});

	it('prepends older messages deduplicating by id', () => {
		const existing: RemoteChatMessage[] = [
			{ id: '2', role: 'assistant', text: 'second', toolName: null, timestamp: 20 },
			{ id: '3', role: 'user', text: 'third', toolName: null, timestamp: 30 }
		];
		const olderPage: RemoteChatPage = {
			messages: [
				{ id: '1', role: 'user', text: 'first', toolName: null, timestamp: 10 },
				{ id: '2', role: 'assistant', text: 'second', toolName: null, timestamp: 20 }
			],
			before: null
		};

		const result = applyChatPage(existing, olderPage, 'prepend');
		expect(result.messages.map((m) => m.id)).toEqual(['1', '2', '3']);
		expect(result.before).toBeNull();
	});
});

describe('tool grouping and turn footers', () => {
	it('groups consecutive tool messages and computes tool summary', () => {
		const messages: RemoteChatMessage[] = [
			{ id: 'u1', role: 'user', text: 'Fix bug', toolName: null, timestamp: 1000 },
			{
				id: 't1',
				role: 'tool',
				text: 'grep error',
				toolName: 'grep',
				timestamp: 1100,
				tool: {
					category: 'search',
					label: 'Cerca',
					detail: 'error',
					meta: '1 file',
					intent: null,
					status: 'ok',
					errorReason: null,
					startedAt: 1100,
					endedAt: 1200,
					diffStats: null,
					diff: null,
					output: null,
					todos: null
				}
			},
			{
				id: 't2',
				role: 'tool',
				text: 'edit bug.ts',
				toolName: 'edit',
				timestamp: 1250,
				tool: {
					category: 'edit',
					label: 'Modifica',
					detail: 'bug.ts',
					meta: '2 righe',
					intent: null,
					status: 'ok',
					errorReason: null,
					startedAt: 1250,
					endedAt: 1400,
					diffStats: [3, 1],
					diff: '+1|line\n-2|old',
					output: null,
					todos: null
				}
			},
			{
				id: 'a1',
				role: 'assistant',
				text: 'Bug fixed!',
				toolName: null,
				timestamp: 1500,
				model: 'Claude 3.5'
			}
		];

		const { items, turnFootersByIndex } = groupMessages(messages);

		expect(items.length).toBe(3);
		expect(items[0].kind).toBe('user');
		expect(items[1].kind).toBe('tool-group');
		expect(items[2].kind).toBe('assistant');

		if (items[1].kind === 'tool-group') {
			expect(items[1].summary.totalCalls).toBe(2);
			expect(items[1].summary.counts.search).toBe(1);
			expect(items[1].summary.counts.edit).toBe(1);
			expect(items[1].summary.totalAdd).toBe(3);
			expect(items[1].summary.totalDel).toBe(1);
			expect(items[1].summary.durationMs).toBe(300); // 1400 - 1100
		}

		// Turn footer at index 2 (assistant text item)
		const footer = turnFootersByIndex.get(2);
		expect(footer).toBeDefined();
		expect(footer?.assistantText).toBe('Bug fixed!');
		expect(footer?.toolCallsCount).toBe(2);
		expect(footer?.model).toBe('Claude 3.5');
		expect(footer?.diff).toEqual({ added: 3, removed: 1 });
	});

	it('keeps one group across the empty assistant step that precedes each tool call', () => {
		const tool = (id: string): RemoteChatMessage => ({ id, role: 'tool', text: 'Leggi', toolName: 'read', timestamp: 1 });
		const silent = (id: string): RemoteChatMessage => ({ id, role: 'assistant', text: '', toolName: null, timestamp: 1 });
		const messages: RemoteChatMessage[] = [
			{ id: 'u1', role: 'user', text: 'Controlla', toolName: null, timestamp: 1 },
			silent('a1'),
			tool('t1'),
			silent('a2'),
			tool('t2'),
			{ id: 'a3', role: 'assistant', text: '', toolName: null, timestamp: 1, blocks: [{ type: 'thinking', text: 'ragiono' }] },
			tool('t3'),
			{ id: 'a4', role: 'assistant', text: 'Fatto', toolName: null, timestamp: 2, blocks: [{ type: 'text', text: 'Fatto' }] }
		];

		const { items } = groupMessages(messages);

		expect(items.map((item) => item.kind)).toEqual(['user', 'tool-group', 'assistant']);
		const group = items[1];
		expect(group.kind === 'tool-group' && group.messages.map((m) => m.id)).toEqual(['t1', 't2', 'a3', 't3']);
	});
});

describe('omp diff parser', () => {
	it('parses valid omp diff lines with +/- and counts adds/dels', () => {
		const raw = [' 1|<script>', '-2|  import old from "./old";', '+2|  import newPkg from "./new";', ' 3|</script>'].join('\n');
		const result = parseOmpDiff(raw);

		expect(result.added).toBe(1);
		expect(result.removed).toBe(1);
		expect(result.rows.length).toBe(4);
		expect(result.rows[1]).toEqual({ sign: '-', line: 2, text: '  import old from "./old";' });
		expect(result.rows[2]).toEqual({ sign: '+', line: 2, text: '  import newPkg from "./new";' });
	});
});

describe('duration formatting by language', () => {
	it('formats seconds with comma for italian and dot for english', () => {
		const { formatDurationSecs } = require('../src/chat/merge.ts');
		expect(formatDurationSecs(1400, 'it')).toBe('1,4 s');
		expect(formatDurationSecs(1400, 'en')).toBe('1.4 s');
		expect(formatDurationSecs(2600, 'it')).toBe('2,6 s');
		expect(formatDurationSecs(2600, 'en')).toBe('2.6 s');
		expect(formatDurationSecs(0, 'it')).toBe('0,0 s');
		expect(formatDurationSecs(0, 'en')).toBe('0.0 s');
	});
});
