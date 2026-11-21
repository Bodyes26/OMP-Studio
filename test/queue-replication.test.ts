/**
 * R-MI-12 / F19: la coda di un progetto condiviso si replica fra macchine.
 * Vince l'ultima modifica per task, e i task di entrambe le parti restano.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	mergeQueues,
	mergeRemoved,
	parseReplicatedQueue,
	pruneRemoved,
	REMOVED_RETENTION_MS,
	resequence,
	type ReplicableTask
} from '../src/lib/stores/queueReplication.ts';
import { LogicalClock, MAX_OBSERVED_SKEW_MS } from '../src/lib/stores/logicalClock.ts';

type TestTask = ReplicableTask & Record<string, unknown>;

const task = (id: string, over: Partial<TestTask> = {}): TestTask => ({
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

	it('un task cancellato su una macchina non risorge dalla copia dell altra (C1)', () => {
		// Il Mac ha cancellato `a` a 200; il PC ha ancora la versione di 100.
		const onMac = mergeQueues([task('b', { position: 1 })], [task('a'), task('b', { position: 1 })], { a: 200 });
		assert.deepEqual(onMac.tasks.map((t) => t.id), ['b'], 'il Mac non la riadotta');
		assert.deepEqual(onMac.adopted, []);
		const onPc = mergeQueues([task('a'), task('b', { position: 1 })], [task('b', { position: 1 })], { a: 200 });
		assert.deepEqual(onPc.tasks.map((t) => t.id), ['b'], 'il PC la toglie');
		assert.equal(onPc.changed, true, 'e riscrive la propria coda');
	});

	it('un task avviato altrove non torna in coda per essere avviato di nuovo', () => {
		// L'avvio toglie il task dalla coda del detentore: l'altra copia ha
		// ancora la versione «queued» con lo stesso istante.
		const out = mergeQueues([task('a', { status: 'queued' })], [], { a: 101 });
		assert.equal(out.tasks.length, 0);
	});

	it('una modifica successiva alla cancellazione tiene il task', () => {
		const out = mergeQueues([], [task('a', { updatedAt: 300 })], { a: 200 });
		assert.deepEqual(out.tasks.map((t) => t.id), ['a']);
	});

	it('le rimozioni si uniscono tenendo l istante piu recente e scadono', () => {
		assert.deepEqual(mergeRemoved({ a: 100, b: 300 }, { a: 200, b: 100, c: 50 }), { a: 200, b: 300, c: 50 });
		const now = 10 * REMOVED_RETENTION_MS;
		assert.deepEqual(pruneRemoved({ old: now - REMOVED_RETENTION_MS - 1, fresh: now - 1 }, now), { fresh: now - 1 });
	});

	it('legge sia il formato nuovo sia l array di una copia non aggiornata', () => {
		assert.deepEqual(parseReplicatedQueue(JSON.stringify([task('a')])), { tasks: [task('a')], removed: {} });
		const parsed = parseReplicatedQueue(JSON.stringify({ tasks: [task('a')], removed: { b: 5, bad: 'x' } }));
		assert.deepEqual(parsed.removed, { b: 5 });
	});

	it('rinumera le posizioni per evitare collisioni fra macchine', () => {
		const merged = resequence([task('a', { position: 0 }), task('b', { position: 0 })]);
		assert.deepEqual(merged.map((t) => t.position), [0, 1]);
	});

	it('una coda locale in ordine diverso ma con gli stessi oggetti non e riscritta', () => {
		const a = task('a', { position: 1 });
		const b = task('b', { position: 0 });
		assert.equal(mergeQueues([a, b], [b, a]).changed, false);
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

describe('Orologio fra macchine (C2, C3)', () => {
	it('un azione fatta dopo aver visto l altra macchina la supera anche con l orologio indietro', () => {
		let wall = 1_000;
		const pc = new LogicalClock(() => wall);
		// Il Mac e avanti di 5 minuti: la sua modifica porta 301_000.
		pc.observe(301_000);
		assert.ok(pc.now() > 301_000, 'la modifica del PC vince');
		wall = 2_000;
		const first = pc.now();
		assert.ok(pc.now() > first, 'gli istanti emessi crescono sempre');
	});

	it('ignora istanti assurdamente nel futuro', () => {
		const clock = new LogicalClock(() => 1_000);
		clock.observe(1_000 + MAX_OBSERVED_SKEW_MS + 1);
		assert.equal(clock.now(), 1_000);
	});
});
