/**
 * R-MI-18: la finestra della macchina che possiede il progetto deve sapere
 * che una corsia è occupata da una sessione aperta da un'altra macchina.
 * Senza, la corsia sembrava ferma e la coda poteva avviare un secondo lavoro
 * sopra il primo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	NO_ACTIVITY,
	laneBusyRemotely,
	laneWorkingRemotely,
	mergeActivity,
	type LaneActivitySnapshot
} from '../src/lib/backend/laneActivity.ts';

const working: LaneActivitySnapshot = {
	revision: 2,
	lanes: [{ projectId: 'p1', laneId: 'main', working: true }]
};

describe('Corsie occupate da un altra macchina (R-MI-18)', () => {
	it('una corsia che lavora da fuori risulta occupata', () => {
		assert.equal(laneWorkingRemotely(working, 'p1', 'main'), true);
		assert.equal(laneBusyRemotely(working, 'p1', 'main'), true);
	});

	it('le altre corsie dello stesso progetto restano libere', () => {
		assert.equal(laneWorkingRemotely(working, 'p1', 'wt-1'), false);
		assert.equal(laneBusyRemotely(working, 'p1', 'wt-1'), false);
	});

	it('un altra macchina sullo stesso id non conta', () => {
		assert.equal(laneWorkingRemotely(working, 'p2', 'main'), false);
	});

	it('una superficie aperta ma ferma occupa la corsia per la coda', () => {
		const idleOpen: LaneActivitySnapshot = {
			revision: 3,
			lanes: [{ projectId: 'p1', laneId: 'main', working: false }]
		};
		assert.equal(laneWorkingRemotely(idleOpen, 'p1', 'main'), false);
		assert.equal(
			laneBusyRemotely(idleOpen, 'p1', 'main'),
			true,
			'un prompt puo arrivare da un istante all altro: la coda non deve sovrapporsi'
		);
	});

	it('senza riepilogo la corsia e libera', () => {
		assert.equal(laneWorkingRemotely(NO_ACTIVITY, 'p1', 'main'), false);
		assert.equal(laneBusyRemotely(NO_ACTIVITY, 'p1', 'main'), false);
	});

	it('un riepilogo piu vecchio non riporta indietro la vista', () => {
		const merged = mergeActivity(working, { revision: 1, lanes: [] });
		assert.equal(merged, working, 'un pacchetto vecchio viene ignorato');
		assert.equal(laneWorkingRemotely(merged, 'p1', 'main'), true);
	});

	it('un riepilogo nuovo sostituisce lo stato', () => {
		const merged = mergeActivity(working, { revision: 4, lanes: [] });
		assert.equal(merged.revision, 4);
		assert.equal(laneWorkingRemotely(merged, 'p1', 'main'), false);
	});

	it('un riepilogo malformato lascia lo stato precedente', () => {
		for (const bad of [null, undefined, {} as never, { revision: 5 } as never]) {
			assert.equal(mergeActivity(working, bad), working);
		}
	});

	it('la stessa revisione e accettata, cosi un aggiornamento non si perde', () => {
		const next: LaneActivitySnapshot = { revision: 2, lanes: [{ projectId: 'p1', laneId: 'wt-1', working: true }] };
		assert.deepEqual(mergeActivity(working, next).lanes, next.lanes);
	});
});
