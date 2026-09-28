import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	enqueueFollowUp,
	removeFollowUp,
	takeLastFollowUp,
	takeFollowUpsForTurn,
	type LocalFollowUp
} from '../src/lib/agent/localFollowUpQueue.ts';

const image = { type: 'image' as const, data: 'base64', mimeType: 'image/png' };
const first: LocalFollowUp = { id: 1, text: 'Prima richiesta', images: [image] };
const second: LocalFollowUp = { id: 2, text: 'Seconda richiesta', images: [] };
const third: LocalFollowUp = { id: 3, text: 'Terza richiesta', images: [] };

describe('coda locale dei follow-up', () => {
	it('estrae solo l\'ultimo messaggio per modificarlo, mantenendo le immagini del messaggio', () => {
		const queue = enqueueFollowUp(enqueueFollowUp([first], second), third);
		const popped = takeLastFollowUp(queue);
		assert.deepEqual(popped.toSend, [third]);
		assert.deepEqual(popped.remaining, [first, second]);
		assert.deepEqual(takeLastFollowUp([first]).toSend[0].images, [image]);
		assert.deepEqual(queue, [first, second, third]);
	});

	it('rimuove per id e non per testo, anche con prompt identici', () => {
		const duplicate = { ...second, text: first.text };
		assert.deepEqual(removeFollowUp([first, duplicate], first.id), [duplicate]);
	});

	it('one-at-a-time consegna un messaggio per turno senza perdere i successivi', () => {
		const firstTurn = takeFollowUpsForTurn([first, second, third], 'one-at-a-time', false);
		assert.deepEqual(firstTurn.toSend, [first]);
		assert.deepEqual(firstTurn.remaining, [second, third]);
		const secondTurn = takeFollowUpsForTurn(firstTurn.remaining, 'one-at-a-time', false);
		assert.deepEqual(secondTurn.toSend, [second]);
		assert.deepEqual(secondTurn.remaining, [third]);
	});

	it('all consegna i messaggi distinti e le immagini di ciascuno in ordine', () => {
		const dispatched = takeFollowUpsForTurn([first, second], 'all', false);
		assert.deepEqual(dispatched.toSend, [first, second]);
		assert.deepEqual(dispatched.toSend[0].images, [image]);
		assert.deepEqual(dispatched.toSend[1].images, []);
		assert.deepEqual(dispatched.remaining, []);
	});

	it('dopo Stop la coda resta ferma per entrambi i modi', () => {
		for (const mode of ['all', 'one-at-a-time'] as const) {
			assert.deepEqual(takeFollowUpsForTurn([first, second], mode, true), {
				toSend: [], remaining: [first, second]
			});
		}
	});
});
