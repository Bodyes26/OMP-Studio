/**
 * Un messaggio Cursor tiene intro, tool e risposta nello stesso assistant.
 * In diretta la risposta deve finire in una bolla sotto i tool, senza
 * paragrafi vuoti e senza promuovere il solo pensiero a testo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { AgentSession as Session } from '../src/lib/agent/session.svelte.ts';
import type { OmpRpcClient } from '../src/lib/agent/client.ts';
import type { AgentSessionEvent } from '../src/lib/agent/wire.ts';
import type { AssistantEntry, TranscriptEntry } from '../src/lib/agent/session.svelte.ts';

register('./session-svelte-loader.mjs', import.meta.url);
// L'import statico precederebbe la registrazione del compilatore delle rune.
const { AgentSession } = await import('../src/lib/agent/session.svelte.ts');

class FeedClient {
	private handler: ((event: AgentSessionEvent) => void) | null = null;

	onEvent(handler: (event: AgentSessionEvent) => void): () => void {
		this.handler = handler;
		return () => {
			if (this.handler === handler) this.handler = null;
		};
	}

	emit(event: AgentSessionEvent) {
		this.handler?.(event);
	}
}

function openSession(): { session: Session; emit: (event: AgentSessionEvent) => void } {
	const client = new FeedClient();
	const session = new AgentSession({
		cwd: '/tmp/cursor-segment',
		client: client as unknown as OmpRpcClient
	});
	return { session, emit: (event) => client.emit(event) };
}

/** Un frame che non e' un delta svuota il batch, anche se il flush e' rinviato. */
function flush(emit: (event: AgentSessionEvent) => void) {
	emit({ type: 'notice' });
}

function assistants(entries: TranscriptEntry[]): AssistantEntry[] {
	return entries.filter((entry): entry is AssistantEntry => entry.kind === 'assistant');
}

const usage = { input: 3, output: 9, totalTokens: 12 };

describe('messaggio Cursor: testo dopo i tool', () => {
	it('mette la risposta sotto i tool, senza paragrafi vuoti, e il consumo solo sull ultimo pezzo', () => {
		const { session, emit } = openSession();
		emit({ type: 'agent_start' });
		emit({ type: 'message_start', message: { role: 'assistant', timestamp: 10 } });
		emit({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Prima' });
		emit({ type: 'studio_delta', kind: 'thinking', contentIndex: 1, delta: 'cerco' });
		flush(emit);
		emit({
			type: 'tool_execution_start',
			toolCallId: 'call-1',
			toolName: 'read',
			args: { path: 'a.ts' },
			intent: 'Leggo il file'
		});
		emit({ type: 'studio_delta', kind: 'toolcall', contentIndex: 5, delta: '{"path":' });
		flush(emit);
		emit({ type: 'studio_delta', kind: 'text', contentIndex: 4, delta: 'Dop' });
		flush(emit);
		assert.deepEqual(session.entries.map((entry) => entry.kind), ['assistant', 'tool', 'assistant']);
		assert.deepEqual(assistants(session.entries)[1].blocks, [{ type: 'text', text: 'Dop' }]);
		emit({
			type: 'message_update',
			assistantMessageEvent: { type: 'text_end', contentIndex: 4, content: 'Dopo i tool.' }
		});
		emit({
			type: 'message_update',
			assistantMessageEvent: {
				type: 'image_end',
				contentIndex: 6,
				content: 'aaaa',
				mimeType: 'image/png'
			}
		});
		emit({
			type: 'message_end',
			message: {
				role: 'assistant',
				timestamp: 20,
				model: 'composer-2.5',
				provider: 'cursor',
				stopReason: 'stop',
				usage
			}
		});

		const kinds = session.entries.map((entry) => entry.kind);
		assert.deepEqual(kinds, ['assistant', 'tool', 'assistant']);
		const [intro, answer] = assistants(session.entries);
		assert.deepEqual(intro.blocks, [
			{ type: 'text', text: 'Prima' },
			{ type: 'thinking', text: 'cerco' }
		]);
		assert.equal(intro.hasResponseContent, true);
		assert.equal(intro.usage, undefined);
		assert.equal(session.entries[1].kind, 'tool');
		if (session.entries[1].kind === 'tool') assert.equal(session.entries[1].toolName, 'read');
		assert.deepEqual(answer.blocks, [
			{ type: 'text', text: 'Dopo i tool.' },
			{ type: 'image', data: 'aaaa', mimeType: 'image/png' }
		]);
		assert.equal(answer.hasResponseContent, true);
		assert.equal(answer.model, 'composer-2.5');
		assert.equal(answer.provider, 'cursor');
		assert.equal(answer.stopReason, 'stop');
		assert.deepEqual(answer.usage, usage);

		emit({ type: 'message_start', message: { role: 'assistant', timestamp: 30 } });
		emit({ type: 'studio_delta', kind: 'text', contentIndex: 7, delta: 'Secondo messaggio' });
		flush(emit);
		const again = assistants(session.entries).at(-1);
		assert.ok(again);
		assert.notEqual(again.id, answer.id);
		assert.deepEqual(again.blocks, [{ type: 'text', text: 'Secondo messaggio' }]);
		assert.deepEqual(answer.blocks, [
			{ type: 'text', text: 'Dopo i tool.' },
			{ type: 'image', data: 'aaaa', mimeType: 'image/png' }
		]);
	});

	it('non apre bolle vuote fra tool consecutivi e non tratta il solo pensiero come risposta', () => {
		const { session, emit } = openSession();
		emit({ type: 'agent_start' });
		emit({ type: 'message_start', message: { role: 'assistant', timestamp: 1 } });
		emit({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Guardo.' });
		flush(emit);
		emit({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'read', args: {} });
		emit({ type: 'tool_execution_start', toolCallId: 'b', toolName: 'grep', args: {} });
		emit({
			type: 'message_update',
			assistantMessageEvent: { type: 'thinking_end', contentIndex: 9, content: 'solo pensiero' }
		});
		emit({ type: 'tool_execution_start', toolCallId: 'c', toolName: 'bash', args: {} });
		emit({ type: 'studio_delta', kind: 'text', contentIndex: 12, delta: 'Fatto.' });
		flush(emit);
		emit({
			type: 'message_end',
			message: { role: 'assistant', timestamp: 2, stopReason: 'stop', usage }
		});

		assert.deepEqual(
			session.entries.map((entry) => entry.kind),
			['assistant', 'tool', 'tool', 'assistant', 'tool', 'assistant']
		);
		const bubbles = assistants(session.entries);
		assert.equal(bubbles[0].hasResponseContent, true);
		assert.deepEqual(bubbles[1].blocks, [{ type: 'thinking', text: 'solo pensiero' }]);
		assert.equal(bubbles[1].hasResponseContent, false);
		assert.equal(bubbles[1].usage, undefined);
		assert.deepEqual(bubbles[2].blocks, [{ type: 'text', text: 'Fatto.' }]);
		assert.equal(bubbles[2].hasResponseContent, true);
		assert.deepEqual(bubbles[2].usage, usage);
	});
});
