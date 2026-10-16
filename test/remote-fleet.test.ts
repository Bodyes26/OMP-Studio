import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	rawMessagesToTranscriptEntries,
	remoteSessionHistory,
	listRemoteSessions
} from '../src/lib/remote/historicalCommands.ts';
import {
	messageUtf8Bytes,
	boundMessageForBudget,
	paginateRemoteMessages,
	sliceWithoutHalfSurrogate
} from '../src/lib/remote/chatPaging.ts';
import { entryToRemoteMessage } from '../src/lib/remote/chatProjection.ts';
import type { RemoteChatMessage } from '$remote-protocol';
import { RemoteCommandFailure } from '../src/lib/remote/commands.ts';

describe('Fleet historical transcript parsing and mapping', () => {
	it('converts raw jsonl message stream into transcript entries preserving usage, stopReason, and tools', () => {
		const rawMessages = [
			{
				role: 'user',
				content: [{ type: 'text', text: 'Analyze this file' }],
				timestamp: 1700000000000
			},
			{
				role: 'assistant',
				model: 'anthropic/claude-3-7-sonnet',
				usage: { inputTokens: 100, outputTokens: 50 },
				stopReason: 'tool_use',
				timestamp: 1700000001000,
				content: [
					{ type: 'thinking', thinking: 'Checking repo...' },
					{ type: 'text', text: 'Let me read the file.' },
					{
						type: 'toolCall',
						id: 'call_read_1',
						name: 'read',
						arguments: { path: 'src/main.rs', i: 'Reading entrypoint' }
					}
				]
			},
			{
				role: 'toolResult',
				toolCallId: 'call_read_1',
				toolName: 'read',
				content: [{ type: 'text', text: 'fn main() {}' }],
				timestamp: 1700000002000
			},
			{
				role: 'assistant',
				model: 'anthropic/claude-3-7-sonnet',
				usage: { inputTokens: 150, outputTokens: 80 },
				stopReason: 'end_turn',
				timestamp: 1700000003000,
				content: [{ type: 'text', text: 'File analyzed successfully.' }]
			}
		];

		const entries = rawMessagesToTranscriptEntries(rawMessages);
		assert.equal(entries.length, 4);

		// Entry 0: UserEntry
		const e0 = entries[0];
		assert.equal(e0.kind, 'user');
		if (e0.kind === 'user') {
			assert.equal(e0.content, 'Analyze this file');
		}

		// Entry 1: AssistantEntry before tool
		const e1 = entries[1];
		assert.equal(e1.kind, 'assistant');
		if (e1.kind === 'assistant') {
			assert.equal(e1.blocks.length, 2);
			assert.equal(e1.model, 'anthropic/claude-3-7-sonnet');
		}

		// Entry 2: ToolEntry
		const e2 = entries[2];
		assert.equal(e2.kind, 'tool');
		if (e2.kind === 'tool') {
			assert.equal(e2.toolCallId, 'call_read_1');
			assert.equal(e2.toolName, 'read');
			assert.equal(e2.intent, 'Reading entrypoint');
			assert.equal(e2.running, false);
			assert.ok(e2.result);
			assert.equal(e2.endedAt, 1700000002000);
		}

		// Entry 3: AssistantEntry final
		const e3 = entries[3];
		assert.equal(e3.kind, 'assistant');
		if (e3.kind === 'assistant') {
			assert.equal(e3.blocks.length, 1);
			assert.equal(e3.usage?.outputTokens, 80);
			assert.equal(e3.stopReason, 'end_turn');
		}
	});

	it('maps compaction entries and system notices properly', () => {
		const rawMessages = [
			{
				role: 'compactionSummary',
				tokensBefore: 100000,
				tokensAfter: 20000,
				shortSummary: 'Cleared history prior to refactor'
			},
			{
				role: 'system',
				content: 'Provider rate limit warning: resetting in 30s'
			}
		];

		const entries = rawMessagesToTranscriptEntries(rawMessages);
		assert.equal(entries.length, 2);

		assert.equal(entries[0].kind, 'compaction');
		if (entries[0].kind === 'compaction') {
			assert.ok(entries[0].message.includes('token'));
		}

		// Proiezione in RemoteChatMessage
		const remote0 = entryToRemoteMessage(entries[0]);
		assert.ok(remote0);
		assert.equal(remote0?.role, 'system');

		const remote2 = entryToRemoteMessage(entries[1]);
		assert.ok(remote2);
		assert.equal(remote2?.role, 'system');
		assert.ok(remote2?.text.includes('Provider rate limit'));
	});

	it('bounds oversized messages to protect frame budget using exact UTF-8 bytes', () => {
		const hugeText = 'A'.repeat(10_000);
		const unicodeText = '🚀'.repeat(2_000); // 4 byte per emoji in UTF-8

		const message: RemoteChatMessage = {
			id: 'm-huge',
			role: 'assistant',
			text: hugeText + unicodeText,
			toolName: null,
			timestamp: 1000,
			imagePreviews: [{ data: 'B'.repeat(5000), mimeType: 'image/png' }]
		};

		const originalBytes = messageUtf8Bytes(message);
		assert.ok(originalBytes > 10_000);

		const bounded = boundMessageForBudget(message, 5_000);
		const boundedBytes = messageUtf8Bytes(bounded);

		assert.ok(boundedBytes <= 5_000);
		// imagePreviews deve essere rimosso per salvare byte
		assert.equal(bounded.imagePreviews, undefined);
		// Il testo deve contenere il marker di troncamento
		assert.ok(bounded.text?.includes('[testo troncato per limite di frame]'));
	});

	it('sliceWithoutHalfSurrogate avoids orphaned high surrogates', () => {
		const emoji = '😀'; // 2 UTF-16 code units: 0xD83D, 0xDE00
		assert.equal(emoji.length, 2);
		// Tagliare a 1 lascerebbe il solo high surrogate 0xD83D
		const safe = sliceWithoutHalfSurrogate(emoji, 1);
		assert.equal(safe, '');
		// Tagliare a 2 mantiene l'emoji intatta
		assert.equal(sliceWithoutHalfSurrogate(emoji, 2), emoji);
	});

	it('paginateRemoteMessages enforces limit and UTF-8 byte boundary', () => {
		const messages: RemoteChatMessage[] = [];
		for (let i = 1; i <= 10; i++) {
			messages.push({
				id: `msg-${i}`,
				role: 'user',
				text: `Message number ${i} with some content.`
			});
		}

		// Pagina limitata a 3 messaggi
		const p1 = paginateRemoteMessages(messages, null, 3);
		assert.equal(p1.messages.length, 3);
		assert.equal(p1.messages[0].id, 'msg-8');
		assert.equal(p1.messages[2].id, 'msg-10');
		assert.equal(p1.before, 'msg-8');

		// Seconda pagina con prima di msg-8
		const p2 = paginateRemoteMessages(messages, 'msg-8', 3);
		assert.equal(p2.messages.length, 3);
		assert.equal(p2.messages[0].id, 'msg-5');
		assert.equal(p2.messages[2].id, 'msg-7');
		assert.equal(p2.before, 'msg-5');
	});

	it('truthfully rejects invalid session ID in remoteSessionHistory', async () => {
		await assert.rejects(
			async () => {
				await remoteSessionHistory('p1', '', null, 50);
			},
			(err: unknown) => {
				assert.ok(err instanceof RemoteCommandFailure);
				assert.equal(err.code, 'not_found');
				return true;
			}
		);
	});

	it('truthfully rejects nonexistent project in listRemoteSessions', async () => {
		await assert.rejects(
			async () => {
				await listRemoteSessions('nonexistent-project-xyz', null, 20);
			},
			(err: unknown) => {
				assert.ok(err instanceof RemoteCommandFailure);
				assert.equal(err.code, 'not_found');
				return true;
			}
		);
	});
});
