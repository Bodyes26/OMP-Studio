/**
 * Ripristino dell'input in coda nell'editor (src/lib/agent/queueRestore.ts).
 *
 * omp 18.4.4+ e' la sorgente della coda: Studio legge i chip e li rimanda
 * identici a `remove_queued_message`; quando l'utente li ritira (Stop con
 * `abort_and_restore_queue`, modifica di un chip) tornano nell'editor.
 * Qui si provano le decisioni pure su come ricomporli, senza DOM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queueChips, restoreBesideDraft, restoredQueueImages, restoredQueueText } from '../src/lib/agent/queueRestore.ts';
import type { ImageContent, RestoredQueuedMessage } from '../src/lib/agent/wire.ts';

const image = (data: string): ImageContent => ({ type: 'image', data, mimeType: 'image/png' });
const entry = (text: string, images?: ImageContent[]): RestoredQueuedMessage =>
	images ? { text, images } : { text };

describe('queueRestore: chip della coda', () => {
	it('elenca gli steer prima dei follow-up, con il testo verbatim', () => {
		const chips = queueChips({ steering: ['steer A', 'steer B'], followUp: ['follow A'] });
		assert.deepEqual(chips, [
			{ text: 'steer A', queue: 'steering' },
			{ text: 'steer B', queue: 'steering' },
			{ text: 'follow A', queue: 'followUp' }
		]);
	});

	it('coda vuota: nessun chip', () => {
		assert.deepEqual(queueChips({ steering: [], followUp: [] }), []);
	});
});

describe('queueRestore: ripristino accanto alla bozza', () => {
	it('bozza vuota: resta solo il contenuto ritirato', () => {
		assert.equal(restoreBesideDraft('', 'messaggio ritirato'), 'messaggio ritirato');
		assert.equal(restoreBesideDraft('   ', 'messaggio ritirato'), 'messaggio ritirato');
	});

	it('bozza presente: il ritirato segue dopo una riga vuota', () => {
		assert.equal(restoreBesideDraft('bozza nuova', 'ritirato'), 'bozza nuova\n\nritirato');
	});

	it('gli spazi finali della bozza non si accumulano', () => {
		assert.equal(restoreBesideDraft('bozza nuova\n\n', 'ritirato'), 'bozza nuova\n\nritirato');
	});

	it('senza contenuto ritirato la bozza resta intatta', () => {
		assert.equal(restoreBesideDraft('bozza', ''), 'bozza');
	});
});

describe('queueRestore: composizione dei messaggi ritirati', () => {
	it('unisce i testi dal piu\' vecchio separandoli con una riga vuota, saltando i vuoti', () => {
		const entries = [entry('primo'), entry('   '), entry('secondo')];
		assert.equal(restoredQueueText(entries), 'primo\n\nsecondo');
	});

	it('raccoglie le immagini di tutti i messaggi, nell\'ordine dei testi', () => {
		const entries = [entry('primo', [image('a')]), entry('secondo'), entry('terzo', [image('b'), image('c')])];
		assert.deepEqual(
			restoredQueueImages(entries).map((item) => item.data),
			['a', 'b', 'c']
		);
	});

	it('un messaggio di sole immagini non ha testo ma conserva le immagini', () => {
		const entries = [entry('', [image('solo')])];
		assert.equal(restoredQueueText(entries), '');
		assert.deepEqual(
			restoredQueueImages(entries).map((item) => item.data),
			['solo']
		);
	});

	it('senza immagini la lista e\' vuota', () => {
		assert.deepEqual(restoredQueueImages([entry('testo')]), []);
	});
});
