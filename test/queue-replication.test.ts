/**
 * R-MI-12 / F19: la coda di un progetto condiviso si replica fra macchine.
 * Vince l'ultima modifica per task, e i task di entrambe le parti restano.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	hasPendingChanges,
	isClosedTask,
	mergeQueues,
	resequence,
	type ReplicableTask
} from '../src/lib/stores/queueReplication.ts';

const task = (id: string, over: Partial<ReplicableTask> = {}): ReplicableTask => ({
	id,
	updatedAt: 100,
	position: 0,
	...over
});

describe('Replica della coda (F19)', () => {
	it('adotta i task creati sull altra macchina', () => {
		const out = mergeQueues([task('a')], [task('b', { position: 1 })]);
		assert.deepEqual(out.tasks.map((t) => t.id), ['a', 'b']);
		assert.deepEqual(out.adopted, ['b']);
		assert.equal(out.changed, true);
	});

	it('a parita di id vince la modifica piu recente', () => {
		const out = mergeQueues([task('a', { updatedAt: 100, position: 0 })], [task('a', { updatedAt: 200, position: 5 })]);
		assert.equal(out.tasks[0].position, 5, 'la versione remota e piu recente');
	});

	it('una copia remota vecchia non sovrascrive quella locale', () => {
		const out = mergeQueues([task('a', { updatedAt: 300, position: 9 })], [task('a', { updatedAt: 100 })]);
		assert.equal(out.tasks[0].position, 9);
		assert.equal(out.changed, false, 'nulla da riscrivere');
	});

	it('a parita di orologio resta la copia locale: nessun ping-pong fra le due', () => {
		const left = mergeQueues([task('b', { position: 1 })], [task('b', { position: 2 })]);
		const right = mergeQueues([task('b', { position: 2 })], [task('b', { position: 1 })]);
		assert.equal(left.tasks[0].position, 1, 'chi ha gia la versione non la cambia');
		assert.equal(right.tasks[0].position, 2);
		assert.equal(left.changed, false, 'e non riscrive nulla');
		assert.equal(right.changed, false);
	});

	it('un task avviato altrove non torna in coda con lo stato vecchio', () => {
		const local = task('a', { updatedAt: 200, status: 'running' });
		const remote = task('a', { updatedAt: 100, status: 'queued' });
		assert.equal(mergeQueues([local], [remote]).tasks[0].status, 'running');
	});

	it('riconosce i task chiusi', () => {
		for (const status of ['done', 'failed', 'discarded']) {
			assert.equal(isClosedTask(task('a', { status })), true, status);
		}
		assert.equal(isClosedTask(task('a', { status: 'queued' })), false);
	});

	it('rinumera le posizioni per evitare collisioni fra macchine', () => {
		const merged = resequence([task('a', { position: 0 }), task('b', { position: 0 })]);
		assert.deepEqual(merged.map((t) => t.position), [0, 1]);
	});

	it('segnala modifiche locali solo oltre l ultimo invio', () => {
		assert.equal(hasPendingChanges([task('a', { updatedAt: 100 })], 100), false);
		assert.equal(hasPendingChanges([task('a', { updatedAt: 101 })], 100), true);
	});

	it('una coda identica non viene riscritta', () => {
		const local = [task('a'), task('b', { position: 1 })];
		const out = mergeQueues(local, local);
		assert.equal(out.changed, false);
	});

	it('la macchina scelta per il task sopravvive alla fusione', () => {
		const local = { ...task('a', { updatedAt: 100 }), machineId: 'local' };
		const remote = { ...task('a', { updatedAt: 100 }), machineId: 'mac' };
		// A parità di orologio resta la copia locale: la scelta non oscilla.
		assert.equal(mergeQueues([local], [remote]).tasks[0].machineId, 'local');
	});
});
