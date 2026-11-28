/**
 * R-MI-67 (solo implementazione): la versione di omp delle altre macchine si
 * legge al rientro, al cambio di versione di Studio e ogni dieci minuti, con
 * una sola richiesta in volo per macchina. Prima si rileggeva a ogni
 * `link:status`, cioe' ogni ~5 s per macchina (S3-link-front-02).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ompPeersKey,
	PeerVersionCadence,
	PEER_VERSION_REFRESH_MS,
	type VersionPeer
} from '../src/lib/backend/peerVersionCadence.ts';

const peer = (over: Partial<VersionPeer> = {}): VersionPeer => ({
	id: 'mac', online: true, compatible: true, version: '1.10.0', ...over
});

describe('Cadenza di get_omp_version fra le macchine (R-MI-67)', () => {
	it('la chiave cambia per un rientro o per una nuova versione, non per il battito', () => {
		const base = ompPeersKey([peer()]);
		// Latenza, ultima volta, via: nessuno di questi campi e' nella chiave.
		assert.equal(ompPeersKey([{ ...peer(), version: '1.10.0' }]), base);
		assert.notEqual(ompPeersKey([peer({ version: '1.11.0' })]), base, 'nuova versione di Studio');
		assert.notEqual(ompPeersKey([peer({ id: 'pc' })]), base, 'macchina diversa');
		assert.notEqual(ompPeersKey([{ ...peer(), online: false }]), base, 'rientro in linea');
		assert.notEqual(ompPeersKey([{ ...peer(), compatible: false }]), base, 'versione incompatibile');
	});

	it('non rilegge a ogni giro: il primo si, poi serve la chiave cambiata o dieci minuti', () => {
		const cadence = new PeerVersionCadence();
		const peers = [peer()];
		const key = ompPeersKey(peers);
		const t0 = 1_000_000;
		assert.deepEqual(cadence.due(peers, key, t0), ['mac'], 'la prima lettura c e sempre');
		cadence.begin('mac');
		assert.deepEqual(cadence.due(peers, key, t0 + 5_000), [], 'richiesta in volo: niente doppioni');
		cadence.end('mac', t0 + 5_000);
		for (let step = 1; step <= 5; step++) {
			assert.deepEqual(cadence.due(peers, key, t0 + step * 5_000), [], 'i battiti del collegamento non rileggono');
		}
		assert.deepEqual(cadence.due(peers, key, t0 + PEER_VERSION_REFRESH_MS + 10_000), ['mac'], 'il ripiego dei dieci minuti');
	});

	it('un rientro in linea o un cambio di versione fa rileggere subito', () => {
		const cadence = new PeerVersionCadence();
		const t0 = 1_000_000;
		const off = [peer({ online: false })];
		assert.deepEqual(cadence.due(off, ompPeersKey(off), t0), [], 'spenta: niente da leggere');
		const back = [peer()];
		assert.deepEqual(cadence.due(back, ompPeersKey(back), t0 + 1_000), ['mac'], 'rientro');
		cadence.begin('mac');
		cadence.end('mac', t0 + 1_000);
		const updated = [peer({ version: '1.11.0' })];
		assert.deepEqual(cadence.due(updated, ompPeersKey(updated), t0 + 2_000), ['mac'], 'versione di Studio cambiata');
	});

	it('una macchina spenta non resta in attesa di una risposta che non arrivera', () => {
		const cadence = new PeerVersionCadence();
		const t0 = 1_000_000;
		const peers = [peer()];
		const key = ompPeersKey(peers);
		cadence.due(peers, key, t0);
		cadence.begin('mac');
		// La macchina cade mentre la lettura e' in volo: la richiesta fallira'
		// e il negozio chiamera' `end`. Nel frattempo non si riparte.
		const off = [peer({ online: false })];
		assert.deepEqual(cadence.due(off, ompPeersKey(off), t0 + 1_000), []);
		cadence.end('mac', t0 + 1_000);
		const back = [peer()];
		assert.deepEqual(cadence.due(back, ompPeersKey(back), t0 + 60_000), ['mac'], 'al ritorno si rilegge');
	});
});
