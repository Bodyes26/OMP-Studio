/**
 * IMP-006: il riscontro di un'operazione verso un'altra macchina e' un cenno,
 * non uno stato. La presa in carico del prompt deve sparire quando la
 * destinazione comincia a lavorare (`release`) o, al piu', dopo pochi secondi;
 * gli altri riscontri restano il minuto di sempre. Il difetto corretto era che
 * nessuna sveglia faceva rieseguire il filtro per tempo: la riga restava sopra
 * il composer finche' un'altra operazione non cambiava l'elenco.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MachineFeedbackStore } from '../src/lib/stores/machineFeedback.svelte.ts';

/** Lo stato interno, quello che le viste leggono: `private` vale solo per i tipi. */
function entriesOf(store: MachineFeedbackStore): unknown[] {
	if (!('entries' in store) || !Array.isArray(store.entries)) {
		throw new Error('MachineFeedbackStore non espone lo stato interno');
	}
	return store.entries;
}

describe('Riscontro delle operazioni remote (IMP-006)', () => {
	let store: MachineFeedbackStore;

	beforeEach((t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		store = new MachineFeedbackStore();
	});

	afterEach((t) => {
		t.mock.timers.reset();
	});

	it('la conferma del prompt si consuma da sola dopo pochi secondi', (t) => {
		const id = store.begin({ kind: 'prompt', machineId: 'mac', projectId: 'p1' });
		store.confirm(id);
		assert.equal(store.latestForWork('p1', 'mac')?.phase, 'confirmed');

		t.mock.timers.tick(9_000);
		assert.equal(store.latestForWork('p1', 'mac')?.phase, 'confirmed', 'non scade prima del tempo');

		t.mock.timers.tick(2_000);
		assert.equal(store.latestForWork('p1', 'mac'), null, 'a dieci secondi la riga e sparita senza altre operazioni');
		// Il filtro per tempo da solo non basta: senza la sveglia che toglie la
		// riga dallo stato nessuna vista si accorgerebbe della scadenza.
		assert.equal(entriesOf(store).length, 0, 'la riga scaduta e tolta dallo stato, non solo filtrata');
	});

	it('il riscontro di un altro progetto della stessa macchina non compare sotto il composer (S3-14)', () => {
		// Prima le operazioni `files`/`git` senza progetto comparivano sotto
		// ogni progetto della macchina; ora il produttore passa il suo.
		const mine = store.begin({ kind: 'files', machineId: 'mac', projectId: 'p1' });
		store.confirm(mine);
		const other = store.begin({ kind: 'files', machineId: 'mac', projectId: 'p2' });
		store.confirm(other);
		assert.equal(store.latestForWork('p1', 'mac')?.projectId, 'p1');
		assert.equal(store.latestForWork('p3', 'mac'), null, 'un progetto senza operazioni non mostra quelle degli altri');
	});

	it('le altre conferme restano il minuto di sempre', (t) => {
		const id = store.begin({ kind: 'git', machineId: 'mac' });
		store.confirm(id);

		t.mock.timers.tick(11_000);
		assert.equal(store.latestFor('mac')?.phase, 'confirmed', 'la sync Git non e un cenno di dieci secondi');

		t.mock.timers.tick(50_000);
		assert.equal(store.latestFor('mac'), null);
	});

	it('release toglie la presa in carico e non tocca la sync Git in corso', () => {
		const prompt = store.begin({ kind: 'prompt', machineId: 'mac', projectId: 'p1' });
		const git = store.begin({ kind: 'git', machineId: 'mac', projectId: 'p1' });
		store.confirm(prompt);
		store.confirm(git);

		store.release(prompt);

		assert.equal(store.latestForWork('p1', 'mac')?.kind, 'git', 'resta solo la sync Git');
		assert.equal(store.activeFor('mac').length, 0, 'la presa in carico non e piu in attesa');
	});

	it('settlePrompt ritira la conferma ma lascia in piedi un errore', (t) => {
		const ok = store.begin({ kind: 'prompt', machineId: 'mac', projectId: 'p1' });
		store.confirm(ok);
		assert.equal(store.settlePrompt(ok), 'released', 'la conferma si ritira');
		assert.equal(store.latestForWork('p1', 'mac'), null);

		const bad = store.begin({ kind: 'prompt', machineId: 'mac', projectId: 'p1' });
		store.fail(bad, 'macchina spenta');
		assert.equal(store.settlePrompt(bad), 'done', 'un errore non si ritira come una conferma');
		assert.equal(store.latestForWork('p1', 'mac')?.phase, 'failed');

		const pending = store.begin({ kind: 'prompt', machineId: 'mac', projectId: 'p1' });
		assert.equal(store.settlePrompt(pending), 'waiting', 'una riga non ancora confermata resta da seguire');
	});

	it('release su un id gia consumato non cambia nulla', () => {
		const prompt = store.begin({ kind: 'prompt', machineId: 'mac', projectId: 'p1' });
		store.confirm(prompt);
		store.release(prompt);
		store.release(prompt);
		assert.equal(store.latestForWork('p1', 'mac'), null);
	});

	it('un errore non scade come una conferma', (t) => {
		const id = store.begin({ kind: 'prompt', machineId: 'mac', projectId: 'p1' });
		store.fail(id, 'macchina spenta');

		t.mock.timers.tick(120_000);
		const op = store.latestForWork('p1', 'mac');
		assert.equal(op?.phase, 'failed', 'l errore resta finche non cambia');
		assert.equal(op?.detail, 'macchina spenta');
	});
});
