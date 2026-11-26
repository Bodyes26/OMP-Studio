/**
 * R-MI-68: quando proporre l'allineamento di omp fra due macchine e in che
 * direzione. Sempre verso la versione piu' nuova, una domanda per terna.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareOmpVersions, ompAlignment, ompAskKey, updateFailureObsolete } from '../src/lib/backend/peerUpdateRules.ts';

describe('Allineamento di omp fra le macchine (R-MI-68)', () => {
	it('ordina per semver numerico, non per stringa', () => {
		assert.equal(compareOmpVersions('18.9.0', '18.10.0'), -1);
		assert.equal(compareOmpVersions('19.0.0', '18.99.99'), 1);
		assert.equal(compareOmpVersions('omp 18.18.3', '18.18.3'), 0);
	});

	it('propone di aggiornare la macchina indietro, mai di tornare indietro', () => {
		assert.equal(ompAlignment('18.18.0', '18.20.1'), 'peer');
		assert.equal(ompAlignment('18.20.1', '18.18.0'), 'here');
		assert.equal(ompAlignment('18.20.1', '18.20.1'), null);
	});

	it('non propone nulla senza una versione leggibile', () => {
		assert.equal(ompAlignment(null, '18.20.1'), null);
		assert.equal(ompAlignment('18.20.1', undefined), null);
		assert.equal(ompAlignment('sconosciuta', '18.20.1'), null);
	});

	it('una nuova versione da una delle due parti e\' una domanda nuova', () => {
		const first = ompAskKey('win', '18.18.0', '18.20.1');
		assert.equal(first, ompAskKey('win', '18.18.0', '18.20.1'));
		assert.notEqual(first, ompAskKey('win', '18.18.0', '18.21.0'));
		assert.notEqual(first, ompAskKey('win', '18.19.0', '18.20.1'));
		assert.notEqual(first, ompAskKey('linux', '18.18.0', '18.20.1'));
	});

	it('un aggiornamento di omp fallito non resta scritto se la macchina e si allineata', () => {
		assert.equal(updateFailureObsolete('18.20.1', '18.20.1', compareOmpVersions), true);
		assert.equal(updateFailureObsolete('18.20.1', '18.21.0', compareOmpVersions), true);
		assert.equal(updateFailureObsolete('18.20.1', '18.18.0', compareOmpVersions), false);
		assert.equal(updateFailureObsolete('18.20.1', null, compareOmpVersions), false);
	});
});
