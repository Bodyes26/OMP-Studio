/**
 * R-MI-57: un giro fallito si ritenta con attesa crescente, e dopo tre
 * fallimenti di fila l'avviso lo dice UNA volta sola finche' il motivo non
 * cambia. Senza, l'errore restava solo nel pannello e il ritento era a caso.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	emptySyncRetry,
	recordSyncFailure,
	recordSyncSuccess,
	syncDue,
	syncRetryDelay
} from '../src/lib/stores/copySyncRetry.ts';

/** Tre fallimenti di fila a partire dallo stato vuoto. */
function fail(state = emptySyncRetry(), reason = 'machine_unreachable', now = 0) {
	return recordSyncFailure(state, reason, now);
}

describe('Nuovi tentativi dei giri delle copie (R-MI-57)', () => {
	it('l attesa cresce: 5 s, 15 s, 45 s, poi il tetto di 5 minuti', () => {
		assert.equal(syncRetryDelay(0), 0);
		assert.equal(syncRetryDelay(1), 5_000);
		assert.equal(syncRetryDelay(2), 15_000);
		assert.equal(syncRetryDelay(3), 45_000);
		assert.equal(syncRetryDelay(9), 300_000);
	});

	it('pianifica il ritento e non annuncia nulla prima del terzo fallimento', () => {
		const first = fail();
		assert.equal(first.alertReason, null);
		assert.equal(first.state.nextAt, 5_000);
		const second = fail(first.state, 'machine_unreachable', 5_000);
		assert.equal(second.alertReason, null);
		assert.equal(second.state.nextAt, 5_000 + 15_000);
	});

	it('il terzo fallimento produce un solo avviso, con il motivo', () => {
		let state = fail().state;
		state = fail(state, 'machine_unreachable', 5_000).state;
		const third = fail(state, 'machine_unreachable', 20_000);
		assert.equal(third.alertReason, 'machine_unreachable');
		const fourth = fail(third.state, 'machine_unreachable', 65_000);
		assert.equal(fourth.alertReason, null, 'lo stesso motivo non si ripete');
	});

	it('un motivo diverso merita un nuovo avviso', () => {
		let state = fail().state;
		state = fail(state).state;
		state = fail(state).state;
		const changed = fail(state, 'sync already running in another window');
		assert.equal(changed.alertReason, 'sync already running in another window');
	});

	it('il successo azzera contatore, attesa e memoria dell avviso', () => {
		let state = fail().state;
		state = fail(state).state;
		state = fail(state).state;
		const clean = recordSyncSuccess();
		assert.deepEqual(clean, emptySyncRetry());
		assert.equal(syncDue(clean, 0), true, 'senza fallimenti si riprova subito');
	});

	it('il ritento non e dovuto prima dell attesa', () => {
		const first = fail();
		assert.equal(syncDue(first.state, 0), false);
		assert.equal(syncDue(first.state, 5_000), true);
	});
});
