/**
 * L'anteprima «L'agente sta preparando le domande…» deve sparire quando omp
 * apre la richiesta vera: altrimenti, risposto alla scheda, ricompare e resta
 * appesa fino a fine run se `tool_execution_end` non porta lo stesso id.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { OmpRpcClient } from '../src/lib/agent/client.ts';
import type { AgentSessionEvent } from '../src/lib/agent/wire.ts';

register('./session-svelte-loader.mjs', import.meta.url);
const { AgentSession } = await import('../src/lib/agent/session.svelte.ts');

class FeedClient {
	id = 'feed';
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

describe('anteprima della domanda in arrivo', () => {
	it('si chiude quando arriva la richiesta, anche se la tool call non ha id', () => {
		const client = new FeedClient();
		const session = new AgentSession({ cwd: '/tmp/ask-preview', client: client as unknown as OmpRpcClient });
		const emit = (event: AgentSessionEvent) => client.emit(event);
		emit({ type: 'agent_start' });
		emit({ type: 'message_start', message: { role: 'assistant', timestamp: 1 } });
		// Solo delta, senza toolcall_start: l'anteprima nasce con toolCallId null.
		emit({
			type: 'message_update',
			assistantMessageEvent: {
				type: 'toolcall_delta',
				contentIndex: 0,
				delta: '{"questions":[{"question":"Cosa pubblicare","options":[{"label":"A"},{"label":"B"}]}]}',
				toolCall: { name: 'ask' }
			}
		});
		assert.equal(session.streamAsk?.state.questions.length, 1);
		assert.equal(session.streamAsk?.toolCallId, null);

		emit({ type: 'tool_execution_start', toolCallId: 'call-ask', toolName: 'ask', args: {} });
		emit({
			type: 'extension_ui_request',
			id: 'req-1',
			method: 'ask',
			questions: [{ id: 'q1', question: 'Cosa pubblicare', options: [{ label: 'A' }, { label: 'B' }] }]
		});
		assert.ok(session.pendingUi);
		assert.equal(session.streamAsk, null);
	});
});
