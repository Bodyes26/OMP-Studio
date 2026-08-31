import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingSessionError } from '../src/lib/agent/resumeErrors.ts';

const ID = '0199a1b2-c3d4-7e8f-9012-3456789abcde';

describe('Errore "sessione da riprendere assente"', () => {
	it('riconosce tutte le forme che omp scrive davvero', () => {
		// Varianti presenti nel binario di omp: con e senza punto finale.
		assert.equal(isMissingSessionError([`Session "${ID}" not found.`], ID), true);
		assert.equal(isMissingSessionError([`Session "${ID}" not found`], ID), true);
		assert.equal(isMissingSessionError([`Session ${ID} not found after update`], ID), true);
		assert.equal(
			isMissingSessionError([`  ERROR   Session   "${ID}"   not   found  `], ID),
			true
		);
		assert.equal(isMissingSessionError([`session "${ID.toUpperCase()}" NOT FOUND`], ID), true);
	});

	it('ignora le righe che parlano di altro', () => {
		assert.equal(isMissingSessionError(['Config file not found'], ID), false);
		assert.equal(isMissingSessionError([`Session "${ID}" resumed`], ID), false);
		assert.equal(isMissingSessionError([`Session "altro-id" not found.`], ID), false);
		assert.equal(isMissingSessionError([], ID), false);
	});

	it('non scatta senza un identificativo richiesto', () => {
		assert.equal(isMissingSessionError([`Session "" not found.`], ''), false);
		assert.equal(isMissingSessionError([`Session "x" not found.`], '   '), false);
	});

	it('trova la riga anche in mezzo ad altro rumore', () => {
		const stderr = [
			'omp 18.0.4',
			'loading providers...',
			`Fatal: Session "${ID}" not found`,
			'exiting'
		];
		assert.equal(isMissingSessionError(stderr, ID), true);
	});
});
