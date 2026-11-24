/**
 * R-MI-15: la coda di un progetto che vive su un'altra macchina. Lo specchio
 * segue l'host, tiene le modifiche fatte qui finché l'host non le conferma e
 * non fa partire da solo un task consegnato in ritardo (F12).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	DELIVERY_RETRY_BASE_MS,
	DELIVERY_RETRY_MAX_MS,
	deliveryRetryDelay,
	holdOverdueSchedules,
	mergeHostQueue,
	samePathLoose,
	type SchedulableTask
} from '../src/lib/stores/remoteQueue.ts';

const task = (id: string, over: Partial<SchedulableTask> & Record<string, unknown> = {}): SchedulableTask & Record<string, unknown> => ({
	id,
	updatedAt: 100,
	position: 0,
	...over
});

describe('Coda di un progetto remoto (R-MI-15)', () => {
	it('i task scritti qui a macchina spenta restano finché l host non li riceve', () => {
		const written = [task('a', { position: 0, updatedAt: 500 }), task('b', { position: 1, updatedAt: 600 })];
		const out = mergeHostQueue(written, [], new Set(['a', 'b']), {});
		assert.deepEqual(out.tasks.map((t) => t.id), ['a', 'b'], 'nell ordine in cui sono stati scritti');
		assert.deepEqual([...out.edits].sort(), ['a', 'b'], 'ancora in attesa');
	});

	it('quando l host pubblica la versione ricevuta il task non è più in attesa, senza duplicati', () => {
		const mine = task('a', { updatedAt: 500, prompt: 'modificato' });
		const out = mergeHostQueue([mine], [task('a', { updatedAt: 500, prompt: 'modificato' })], new Set(['a']), {});
		assert.equal(out.tasks.length, 1);
		assert.equal(out.edits.size, 0);
	});

	it('una modifica fatta qui non viene coperta da una versione più vecchia dell host', () => {
		const mine = task('a', { updatedAt: 500, prompt: 'nuovo' });
		const out = mergeHostQueue([mine], [task('a', { updatedAt: 100, prompt: 'vecchio' })], new Set(['a']), {});
		assert.equal(out.tasks[0].prompt, 'nuovo');
		assert.ok(out.edits.has('a'));
	});

	it('un task tolto sull host sparisce anche qui se qui non è stato toccato', () => {
		const out = mergeHostQueue([task('a'), task('b', { position: 1 })], [task('b', { position: 1 })], new Set(), {});
		assert.deepEqual(out.tasks.map((t) => t.id), ['b']);
	});

	it('un task cancellato qui resta fuori finché l host non lo toglie', () => {
		const out = mergeHostQueue([], [task('a', { updatedAt: 100 })], new Set(), { a: 200 });
		assert.equal(out.tasks.length, 0);
	});

	it('un orario già passato alla consegna non fa partire il task da solo (F12)', () => {
		const now = 10_000;
		const overdue = task('a', { schedule: { kind: 'at', notBefore: now - 1 } });
		const future = task('b', { schedule: { kind: 'at', notBefore: now + 1 } });
		const untouched = task('c', { schedule: { kind: 'at', notBefore: now - 1 } });
		const held = holdOverdueSchedules([overdue, future, untouched], new Set(['a', 'b']), now);
		assert.equal(held[0].schedule?.missed, true);
		assert.equal(held[1].schedule?.missed, undefined);
		assert.equal(held[2].schedule?.missed, undefined, 'solo i task scritti qui');
	});

	it('una consegna fallita si ritenta con attese crescenti (D7)', () => {
		// Prima era «in attesa di conferma» per sempre: la modifica resta finche'
		// l'host non la vede, ma i tentativi ripartono da soli.
		assert.equal(deliveryRetryDelay(0), DELIVERY_RETRY_BASE_MS);
		assert.equal(deliveryRetryDelay(1), DELIVERY_RETRY_BASE_MS * 2);
		assert.equal(deliveryRetryDelay(2), DELIVERY_RETRY_BASE_MS * 4);
		assert.equal(deliveryRetryDelay(3), DELIVERY_RETRY_BASE_MS * 8);
		assert.equal(deliveryRetryDelay(40), DELIVERY_RETRY_MAX_MS, 'il tetto vale anche dopo molti tentativi');
		assert.ok(deliveryRetryDelay(2) > deliveryRetryDelay(1), 'l attesa cresce');
	});

	it('riconosce lo stesso percorso scritto da Windows o dal Mac', () => {
		assert.equal(samePathLoose('C:\\Users\\Maurizio\\Sito\\', 'c:/users/maurizio/sito'), true);
		assert.equal(samePathLoose('/Users/maurizio/sito', '/Users/maurizio/altro'), false);
	});
});
