/**
 * S3-link-front-04: il fast-forward da origin e `copy_sync` prendono la stessa
 * guardia per la stessa cartella. Con la cartella occupata si aspetta la fine
 * del giro delle copie (l'evento che la libera), non un tempo fisso; il tetto
 * resta, perche' l'occupazione puo' essere di un agente o dell'editor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	beginCopyRound,
	copyRoundIdle,
	copyRoundRunning,
	endCopyRound
} from '../src/lib/stores/copyRound.ts';

/** Un giro di microtask: basta per far girare i `.then` gia' risolti. */
async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe('Attesa del giro delle copie (S3-04)', () => {
	it('senza un giro in corso non si aspetta niente', async () => {
		assert.equal(copyRoundRunning(), false);
		let done = false;
		void copyRoundIdle(50).then(() => { done = true; });
		await flush();
		assert.equal(done, true, 'la promessa e gia risolta');
	});

	it('chi aspetta riparte appena il giro finisce', async () => {
		beginCopyRound();
		assert.equal(copyRoundRunning(), true);
		let done = false;
		const waiting = copyRoundIdle(5_000).then(() => { done = true; });
		await flush();
		assert.equal(done, false, 'il giro e ancora in corso');
		endCopyRound();
		await waiting;
		assert.equal(done, true);
		assert.equal(copyRoundRunning(), false);
	});

	it('due giri in corso tengono l attesa finche finisce il secondo', async () => {
		beginCopyRound();
		beginCopyRound();
		let done = false;
		const waiting = copyRoundIdle(5_000).then(() => { done = true; });
		endCopyRound();
		await flush();
		assert.equal(done, false, 'un giro e ancora in corso');
		endCopyRound();
		await waiting;
		assert.equal(done, true);
	});

	it('il tetto sblocca comunque: l occupazione puo essere di un agente', async () => {
		beginCopyRound();
		// Tetto a zero: la promessa si scioglie al timer, senza aspettare un
		// giro che non finira' mai.
		await copyRoundIdle(0);
		assert.equal(copyRoundRunning(), true, 'il giro resta aperto, chi aspetta e ripartito');
		endCopyRound();
		assert.equal(copyRoundRunning(), false);
	});

	it('un giro che finisce subito non lascia conti aperti', () => {
		beginCopyRound();
		endCopyRound();
		endCopyRound();
		assert.equal(copyRoundRunning(), false, 'il conteggio non va sotto zero');
	});
});
