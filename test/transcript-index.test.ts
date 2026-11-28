import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptIndex } from '../src/lib/agent/components/transcriptIndex.ts';
import { HEADS_UP_TOOL } from '../src/lib/agent/turnHeadsUp.ts';
import type { TranscriptEntry } from '../src/lib/agent/session.svelte.ts';

/**
 * Entry minime: l'indice legge solo `kind`, gli id e i campi delle chiamate.
 * Il cast e' l'unico modo di costruire una forma parziale di `TranscriptEntry`
 * — l'unione ha 12 varianti con campi obbligatori che l'indice non tocca.
 */
type Entry = Record<string, unknown> & { kind: TranscriptEntry['kind'] };
const asEntries = (items: readonly Entry[]): TranscriptEntry[] => items as unknown as TranscriptEntry[];

let nextId = 1;
function user(content: string): Entry {
	return { id: nextId++, kind: 'user', content, images: [] };
}
function todo(id: number, tasks: Array<{ content: string; status: string }>, extra: Entry = {}): Entry {
	return {
		id,
		kind: 'tool',
		toolCallId: `todo-${id}`,
		toolName: 'todo',
		args: { op: 'init', list: [{ name: 'Fase', tasks }] },
		running: false,
		startedAt: 1,
		...extra
	};
}
function headsUp(text: string): Entry {
	return {
		id: nextId++,
		kind: 'tool',
		toolCallId: `hu-${nextId}`,
		toolName: HEADS_UP_TOOL,
		args: { text },
		result: { content: [] },
		running: false,
		startedAt: 1
	};
}
function assistant(text: string): Entry {
	return { id: nextId++, kind: 'assistant', blocks: [{ type: 'text', text }] };
}

describe('indice incrementale del transcript (S5-02)', () => {
	it('calcola le tracce todo anche quando la lista nasce fuori dalla finestra visibile', () => {
		const index = new TranscriptIndex();
		const entries: Entry[] = [user('primo'), todo(900, [{ content: 'uno', status: 'in_progress' }])];
		index.todoTraces(asEntries(entries));

		// Mezza storia dopo: la lista e' fuori dalla finestra delle ultime 300
		// entry, ma le righe che si vedono devono continuare a mostrarla.
		for (let i = 0; i < 400; i++) entries.push(assistant(`passo ${i}`));
		const traces = index.todoTraces(asEntries(entries));
		const creation = traces.get(900) ?? [];
		assert.ok(creation.length > 0, 'tracce perse per una lista fuori finestra');
		assert.equal(creation[0].type, 'creation');
	});

	it('aggiorna le tracce quando il risultato di una chiamata arriva sul posto', () => {
		const index = new TranscriptIndex();
		const call = todo(901, [{ content: 'uno', status: 'in_progress' }]);
		const entries: Entry[] = [user('primo'), call];
		const before = index.todoTraces(asEntries(entries)).get(901) ?? [];
		assert.ok(before.some((item) => item.type === 'step' && item.title === 'uno'));

		// La stessa entry cambia sul posto: `result` arriva a fine chiamata e
		// riporta la lista aggiornata. L'indice deve accorgersene senza che
		// l'array delle entry cambi lunghezza.
		const details = {
			op: 'update',
			phases: [
				{
					name: 'Fase',
					tasks: [
						{ id: 'a', content: 'uno', status: 'completed' },
						{ id: 'b', content: 'due', status: 'in_progress' }
					]
				}
			]
		};
		call.result = { content: [], details };
		const after = index.todoTraces(asEntries(entries)).get(901) ?? [];
		assert.ok(after.some((item) => item.type === 'step' && item.title === 'due'), 'la traccia non ha visto il risultato');
		assert.ok(!after.some((item) => item.type === 'step' && item.title === 'uno'), 'la traccia e rimasta quella di prima');
	});

	it('tiene il conto dei turni per la frase studio_headsup', () => {
		const index = new TranscriptIndex();
		const first = user('prima domanda');
		const entries: Entry[] = [first, assistant('risposta'), headsUp('ho deciso da solo'), user('seconda'), headsUp('altra frase')];
		const map = index.headsUpByTurn(asEntries(entries));
		assert.equal(map.get(Number(first.id))?.text, 'ho deciso da solo');
		assert.equal(map.size, 2);

		// Una chiamata senza risultato valido (errore) non produce la frase.
		entries.push({ id: nextId++, kind: 'tool', toolCallId: 'x', toolName: HEADS_UP_TOOL, args: { text: 'ignorata' }, result: { isError: true, content: [] }, running: false, startedAt: 1 });
		const again = index.headsUpByTurn(asEntries(entries));
		assert.equal(again.size, 2);
	});

	it('riparte da capo quando una entry viene tolta dal mezzo della storia', () => {
		const index = new TranscriptIndex();
		const entries: Entry[] = [user('uno'), todo(902, [{ content: 'x', status: 'in_progress' }]), assistant('a'), assistant('b')];
		index.todoTraces(asEntries(entries));
		const tracesBefore = index.todoTraces(asEntries(entries));
		assert.equal(tracesBefore.size, 1);

		// Annullo di un invio o compattazione: la storia si accorcia al centro e
		// l'ultima entry resta la stessa. L'indice non deve restare disallineato.
		entries.splice(1, 1);
		const after = index.todoTraces(asEntries(entries));
		assert.equal(after.size, 0, 'traccia fantasma dopo la rimozione');
	});
});
