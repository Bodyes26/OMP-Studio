import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDroppedTask, type InFlightTask } from '../src/lib/stores/taskRecovery.ts';
import type { StudioTask } from '../src/lib/stores/taskSerialization.ts';

function task(overrides: Partial<StudioTask> = {}): StudioTask {
	return {
		id: 'task-1',
		projectPath: 'c:/progetti/cai',
		prompt: 'Errore salvataggio economia',
		position: 3,
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		status: 'dispatching',
		...overrides
	};
}

function inFlight(overrides: Partial<InFlightTask> = {}): InFlightTask {
	return { task: task(), sessionId: 'sess-a', ...overrides };
}

describe('Recupero del task in volo', () => {
	it('rimette in coda il task il cui prompt non e mai arrivato a omp', () => {
		const restored = resolveDroppedTask(inFlight(), 'sess-a', new Set(), 1_700_000_500_000);
		assert.ok(restored);
		assert.equal(restored.id, 'task-1');
		assert.equal(restored.status, 'queued');
		assert.equal(restored.position, 0);
		assert.equal(restored.updatedAt, 1_700_000_500_000);
	});

	it('non recupera nulla quando la consegna e stata confermata', () => {
		// Consegna confermata = snapshot cancellato: e il caso del task svolto
		// che la Companion mostrava ancora in coda.
		assert.equal(resolveDroppedTask(undefined, 'sess-a', new Set()), null);
	});

	it('ignora lo snapshot di un altra sessione', () => {
		assert.equal(resolveDroppedTask(inFlight(), 'sess-b', new Set()), null);
	});

	it('accetta lo snapshot quando la sessione morta non ha un id', () => {
		assert.ok(resolveDroppedTask(inFlight(), null, new Set()));
	});

	it('non duplica un task che e ancora in coda', () => {
		assert.equal(resolveDroppedTask(inFlight(), 'sess-a', new Set(['task-1'])), null);
	});

	it('scarta uno snapshot senza prompt ne immagini', () => {
		assert.equal(
			resolveDroppedTask(inFlight({ task: task({ prompt: '   ' }) }), 'sess-a', new Set()),
			null
		);
	});

	it('recupera un task di sole immagini', () => {
		const images = [{ type: 'image' as const, data: 'abcd', mimeType: 'image/png' }];
		const restored = resolveDroppedTask(
			inFlight({ task: task({ prompt: '', images }) }),
			'sess-a',
			new Set()
		);
		assert.ok(restored);
		assert.deepEqual(restored.images, images);
		// Copia, non riferimento: la coda non deve condividere l'array con lo snapshot.
		assert.notEqual(restored.images, images);
	});
});
