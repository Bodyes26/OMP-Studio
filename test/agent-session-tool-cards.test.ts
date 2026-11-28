/**
 * Card dei tool vive e finestra disegnata (S4-09, S4-17).
 *
 * `toolEntries` teneva ogni card del run fino alla ricostruzione successiva, e
 * `refreshWaitContexts` (a ogni progresso di subagente) le scandiva tutte: con
 * 5.000 card erano 1,2 ms per frame. Due fatti da difendere:
 *
 * - una card chiusa esce subito dall'indice delle vive, quindi un
 *   `tool_execution_update` in ritardo non la riscrive;
 * - `visibleEntries` e' un `$derived`: la stessa istanza finche' non cambia la
 *   finestra.
 *
 * Il tempo e' controllato: niente attese vere, si attende la condizione.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { OmpRpcClient } from '../src/lib/agent/client.ts';
import type { AgentSessionEvent } from '../src/lib/agent/wire.ts';

register('./session-svelte-loader.mjs', import.meta.url);
// L'import statico precederebbe la registrazione del compilatore delle rune.
const { AgentSession } = await import('../src/lib/agent/session.svelte.ts');

Object.assign(globalThis, {
	window: (globalThis as { window?: unknown }).window ?? globalThis,
	dispatchEvent: (globalThis as { dispatchEvent?: unknown }).dispatchEvent ?? (() => true)
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function until(predicate: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await flush();
	}
	assert.ok(predicate(), label);
}

class FakeClient {
	handler: ((event: AgentSessionEvent) => void) | null = null;
	epoch = 1;
	id = 7;
	isOpen = true;

	onEvent(handler: (event: AgentSessionEvent) => void): () => void {
		this.handler = handler;
		return () => {
			if (this.handler === handler) this.handler = null;
		};
	}
	emit(event: AgentSessionEvent) {
		this.handler?.(event);
	}
	async send<T>(command: { type: string }): Promise<T> {
		if (command.type === 'get_state') return { sessionId: 'S', isStreaming: false } as T;
		if (command.type === 'get_messages_page') return { messages: [] } as T;
		return {} as T;
	}
	async respondUi() {}
	async abortAndRestoreQueue() {
		return null;
	}
	async abort() {}
	async close() {}
	markExited() {}
}

type Session = InstanceType<typeof AgentSession>;

async function openSession(cwd: string): Promise<{ session: Session; client: FakeClient }> {
	const client = new FakeClient();
	const session = new AgentSession({ cwd, client: client as unknown as OmpRpcClient });
	client.emit({ type: 'ready' });
	await until(() => session.isAttached, 'la sessione deve insediarsi');
	return { session, client };
}

function toolCard(session: Session, toolCallId: string) {
	return session.entries.find(
		(entry) => entry.kind === 'tool' && (entry as { toolCallId: string }).toolCallId === toolCallId
	) as { running: boolean; result?: { content?: unknown } } | undefined;
}

describe('Card dei tool (S4-09)', () => {
	it('una card finita esce dall indice delle vive: un update in ritardo non la riscrive', async () => {
		const { session, client } = await openSession('/tmp/card-potata');
		client.emit({ type: 'agent_start' });
		client.emit({ type: 'turn_start' });
		client.emit({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } });
		client.emit({
			type: 'tool_execution_end',
			toolCallId: 't1',
			toolName: 'bash',
			result: { content: [{ type: 'text', text: 'fatto' }] }
		});
		const closed = toolCard(session, 't1');
		assert.ok(closed);
		assert.equal(closed.running, false);
		const closedResult = JSON.stringify(closed.result);
		// Un progresso arrivato dopo la fine non riapre ne' riscrive la card.
		client.emit({
			type: 'tool_execution_update',
			toolCallId: 't1',
			toolName: 'bash',
			partialResult: { content: [{ type: 'text', text: 'in ritardo' }] }
		});
		const after = toolCard(session, 't1');
		assert.equal(JSON.stringify(after?.result), closedResult);
		assert.equal(after?.running, false);
	});

	it('il contesto di una card wait viva segue i subagenti, quella conclusa resta congelata', async () => {
		const { session, client } = await openSession('/tmp/card-wait');
		client.emit({ type: 'agent_start' });
		client.emit({ type: 'turn_start' });
		// Il subagente e' gia' vivo quando la card si apre: il contesto e' la
		// fotografia di chi l'attesa riguarda, e i progressi successivi
		// aggiornano quelle identita' (mai ne aggiungono di nuove: chi arriva
		// dopo non e' qualcosa che questa attesa stava aspettando).
		client.emit({
			type: 'subagent_progress',
			payload: {
				id: 'sub-1',
				index: 0,
				description: 'esploratore',
				status: 'started',
				progress: { id: 'sub-1', name: 'esploratore', status: 'running', recentTools: [] }
			}
		} as never);
		client.emit({ type: 'tool_execution_start', toolCallId: 'w1', toolName: 'wait', args: {} });
		await flush();
		const live = session.entries.find(
			(entry) => entry.kind === 'tool' && (entry as { toolCallId?: string }).toolCallId === 'w1'
		) as
			| { waitContext?: { subagents?: { id: string; recentTools?: { name: string }[] }[] } }
			| undefined;
		assert.ok(live?.waitContext, 'la card wait deve avere un contesto');
		assert.deepEqual(live.waitContext.subagents?.map((sub) => sub.id), ['sub-1']);

		// Un progresso del subagente gia' atteso aggiorna la card viva.
		client.emit({
			type: 'subagent_progress',
			payload: {
				id: 'sub-1',
				index: 0,
				status: 'started',
				progress: { id: 'sub-1', name: 'esploratore', status: 'running', recentTools: [{ name: 'grep' }] }
			}
		} as never);
		await flush();
		assert.deepEqual(live.waitContext.subagents?.[0]?.recentTools?.map((tool) => tool.name), ['grep']);

		// Chiusa la card, il contesto non cambia piu'.
		client.emit({ type: 'tool_execution_end', toolCallId: 'w1', toolName: 'wait', result: { content: [] } });
		const frozen = JSON.stringify(live.waitContext);
		client.emit({
			type: 'subagent_progress',
			payload: {
				id: 'sub-1',
				index: 0,
				status: 'started',
				progress: { id: 'sub-1', name: 'esploratore', status: 'running', recentTools: [{ name: 'read' }] }
			}
		} as never);
		client.emit({
			type: 'subagent_progress',
			payload: {
				id: 'sub-2',
				index: 1,
				status: 'started',
				progress: { id: 'sub-2', name: 'altro', status: 'running', recentTools: [] }
			}
		} as never);
		await flush();
		assert.equal(JSON.stringify(live.waitContext), frozen, 'la card conclusa non si aggiorna piu\u2019');
	});
});

describe('Finestra disegnata (S4-17)', () => {
	it('mostra solo l ultima finestra dello storico e il prompt seminato in fondo', async () => {
		const { session, client } = await openSession('/tmp/vista-finestra');
		client.emit({ type: 'agent_start' });
		client.emit({ type: 'turn_start' });
		for (let index = 0; index < 5; index++) {
			client.emit({ type: 'message_start', message: { role: 'assistant', timestamp: index + 1 } });
			client.emit({
				type: 'message_update',
				assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: `risposta ${index}` }
			});
			client.emit({ type: 'message_end', message: { role: 'assistant', timestamp: index + 1 } });
		}
		await flush();
		assert.equal(session.visibleEntries.length, 5);
		// La finestra e' un taglio dal fondo: abbassandola si vedono le ultime.
		session.visibleCount = 2;
		const texts = session.visibleEntries.map((entry) =>
			(entry as { blocks?: { text: string }[] }).blocks?.map((block) => block.text).join('') ?? ''
		);
		assert.deepEqual(texts, ['risposta 3', 'risposta 4']);
		// Il prompt seminato non e' nella storia di omp: si disegna in fondo.
		session.seedPrompt('nuovo task');
		const seeded = session.visibleEntries;
		assert.equal(seeded[seeded.length - 1].kind, 'user');
		assert.equal((seeded[seeded.length - 1] as { content: string }).content, 'nuovo task');
	});
});
