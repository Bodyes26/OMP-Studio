/**
 * Coda locale dei follow-up: la macchina a stati reale usata da
 * `AgentSession` (src/lib/agent/followUpDispatcher.ts), guidata con un host
 * finto che riproduce l'ordine dei frame di omp registrato in
 * test/fixtures/chat-v2/tools-real.ndjson: la risposta al `prompt` arriva
 * prima di `agent_start`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FollowUpDispatcher,
	FOLLOW_UP_START_TIMEOUT_MS,
	type FollowUpDelivery,
	type FollowUpHost
} from '../src/lib/agent/followUpDispatcher.ts';
import { enqueueFollowUp, removeFollowUp, type LocalFollowUp } from '../src/lib/agent/localFollowUpQueue.ts';
import type { QueueMode, StreamingBehavior } from '../src/lib/agent/wire.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const image = { type: 'image' as const, data: 'base64', mimeType: 'image/png' };
const first: LocalFollowUp = { id: 1, text: 'Prima richiesta', images: [image] };
const second: LocalFollowUp = { id: 2, text: 'Seconda richiesta', images: [] };
const third: LocalFollowUp = { id: 3, text: 'Terza richiesta', images: [] };

/** Host che simula omp: `streaming` diventa vero solo con `agent_start`. */
class FakeHost implements FollowUpHost {
	items: LocalFollowUp[];
	modeValue: QueueMode;
	isPaused = false;
	streaming = false;
	pauses: Array<'failed' | 'timeout'> = [];
	sent: Array<{ id: number; forced?: StreamingBehavior; streamingAtSend: boolean }> = [];
	deliveries: FollowUpDelivery[] = [];
	timers = new Map<number, () => void>();
	private nextTimer = 1;

	constructor(items: LocalFollowUp[], mode: QueueMode = 'one-at-a-time') {
		this.items = [...items];
		this.modeValue = mode;
	}

	queue() {
		return this.items;
	}
	mode() {
		return this.modeValue;
	}
	paused() {
		return this.isPaused;
	}
	idle() {
		return !this.streaming;
	}
	async send(item: LocalFollowUp, forced?: StreamingBehavior): Promise<FollowUpDelivery> {
		// Come in AgentSession.prompt: senza `forced` un invio a streaming
		// in corso verrebbe deciso sullo stato vecchio.
		this.sent.push({ id: item.id, forced, streamingAtSend: this.streaming });
		await Promise.resolve();
		return this.deliveries.shift() ?? 'sent';
	}
	remove(id: number) {
		this.items = removeFollowUp(this.items, id);
	}
	pause(reason: 'failed' | 'timeout') {
		this.isPaused = true;
		this.pauses.push(reason);
	}
	setTimer(callback: () => void, _ms: number) {
		const id = this.nextTimer++;
		this.timers.set(id, callback);
		return id;
	}
	clearTimer(handle: unknown) {
		this.timers.delete(handle as number);
	}
	fireTimers() {
		const pending = [...this.timers.values()];
		this.timers.clear();
		for (const callback of pending) callback();
	}
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('coda locale dei follow-up', () => {
	it('rimuove per id e non per testo, anche con prompt identici', () => {
		const duplicate = { ...second, text: first.text };
		const queue = enqueueFollowUp([first], duplicate);
		assert.deepEqual(removeFollowUp(queue, first.id), [duplicate]);
	});

	it('la fixture reale conferma l\'ordine: risposta al prompt prima di agent_start', () => {
		const frames = readFileSync(join(ROOT, 'test/fixtures/chat-v2/tools-real.ndjson'), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { type: string; command?: string });
		const response = frames.findIndex((f) => f.type === 'response' && f.command === 'prompt');
		const start = frames.findIndex((f) => f.type === 'agent_start');
		assert.ok(response !== -1 && start !== -1);
		assert.ok(response < start);
	});

	it('one-at-a-time: dopo un invio riuscito non rilancia finche\' non arriva agent_end', async () => {
		const host = new FakeHost([first, second, third]);
		const dispatcher = new FollowUpDispatcher(host);
		await dispatcher.dispatch();
		assert.deepEqual(host.sent.map((s) => s.id), [1]);
		assert.equal(dispatcher.isAwaitingStart, true);
		// La risposta e' arrivata ma omp non ha ancora emesso agent_start:
		// un secondo giro qui spediva il messaggio come prompt nuovo e falliva.
		await dispatcher.dispatch();
		await flush();
		assert.deepEqual(host.sent.map((s) => s.id), [1]);
		assert.deepEqual(host.pauses, []);

		host.streaming = true;
		dispatcher.onAgentStart();
		assert.equal(dispatcher.isAwaitingStart, false);
		assert.equal(host.timers.size, 0, 'agent_start annulla il timeout');

		host.streaming = false;
		dispatcher.onAgentEnd();
		await flush();
		assert.deepEqual(host.sent.map((s) => s.id), [1, 2]);
		assert.deepEqual(host.items.map((i) => i.id), [3]);
	});

	it('senza agent_start entro il timeout mette in pausa la coda con avviso', async () => {
		const host = new FakeHost([first, second]);
		const dispatcher = new FollowUpDispatcher(host);
		await dispatcher.dispatch();
		assert.equal(host.timers.size, 1);
		host.fireTimers();
		assert.deepEqual(host.pauses, ['timeout']);
		assert.equal(dispatcher.isAwaitingStart, false);
		dispatcher.onAgentEnd();
		await flush();
		assert.deepEqual(host.sent.map((s) => s.id), [1], 'in pausa non parte nulla');
		assert.ok(FOLLOW_UP_START_TIMEOUT_MS >= 5_000);
	});

	it('agent_start arrivato prima della risposta non arma il timeout', async () => {
		const host = new FakeHost([first]);
		const dispatcher = new FollowUpDispatcher(host);
		const realSend = host.send.bind(host);
		host.send = async (item, forced) => {
			const result = realSend(item, forced);
			dispatcher.onAgentStart();
			return result;
		};
		await dispatcher.dispatch();
		assert.equal(dispatcher.isAwaitingStart, false);
		assert.equal(host.timers.size, 0);
	});

	it('all: il primo parte normale, i successivi subito come followUp forzato', async () => {
		const host = new FakeHost([first, second, third], 'all');
		const dispatcher = new FollowUpDispatcher(host);
		await dispatcher.dispatch();
		assert.deepEqual(
			host.sent.map((s) => [s.id, s.forced]),
			[
				[1, undefined],
				[2, 'followUp'],
				[3, 'followUp']
			]
		);
		assert.deepEqual(host.items, []);
		assert.equal(dispatcher.isAwaitingStart, true);
	});

	it('un rifiuto mette in pausa e lascia il messaggio in coda', async () => {
		const host = new FakeHost([first, second]);
		host.deliveries = ['failed'];
		const dispatcher = new FollowUpDispatcher(host);
		await dispatcher.dispatch();
		assert.deepEqual(host.pauses, ['failed']);
		assert.deepEqual(host.items.map((i) => i.id), [1, 2]);
	});

	it('Stop durante un invio: l\'esito vecchio non tocca piu\' la coda', async () => {
		const host = new FakeHost([first, second]);
		const dispatcher = new FollowUpDispatcher(host);
		const pending = dispatcher.dispatch();
		dispatcher.invalidate();
		await pending;
		assert.deepEqual(host.items.map((i) => i.id), [1, 2], 'il messaggio non viene tolto');
		assert.equal(host.timers.size, 0);
		assert.equal(dispatcher.isDispatching, false);
	});

	it('non parte con la coda in pausa o con l\'agente occupato', async () => {
		const host = new FakeHost([first]);
		const dispatcher = new FollowUpDispatcher(host);
		host.isPaused = true;
		await dispatcher.dispatch();
		host.isPaused = false;
		host.streaming = true;
		await dispatcher.dispatch();
		assert.deepEqual(host.sent, []);
	});
});
