/**
 * S3-link-front-11 / -12: il feed delle macchine non perde avvisi dietro una
 * caduta urgente, e la caduta di una macchina su cui si lavora vive in uno
 * spazio suo (`sticky`) che non ferma la coda.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MachineAlertFeed } from '../src/lib/stores/machineAlertFeed.svelte.ts';
import type { OutcomeSample, PresenceSample } from '../src/lib/stores/machineAlerts.ts';

const mac: PresenceSample = { id: 'mac', name: 'MacBook', online: true };
const pc: PresenceSample = { id: 'pc', name: 'PC', online: true };

const outcome = (over: Partial<OutcomeSample> = {}): OutcomeSample => ({
	machine: 'mac', name: 'MacBook', project: 'omp-studio', advanced: 0,
	merged: false, journalOnly: false, blocked: [], head: 'abc', ...over
});

/** Testi della coda, consumandola: il feed mostra un avviso alla volta. */
function drain(feed: MachineAlertFeed): string[] {
	const texts: string[] = [];
	for (let guard = 0; guard < 20 && feed.current !== null; guard++) {
		texts.push(feed.current.text);
		feed.dismiss();
	}
	return texts;
}

describe('Feed degli avvisi delle macchine (S3-11, S3-12)', () => {
	it('una caduta urgente non fa perdere gli altri avvisi dello stesso campione', () => {
		const feed = new MachineAlertFeed();
		feed.update([mac, pc], []);
		// Nello stesso campione: il PC su cui si lavora cade e arrivano commit.
		feed.update([mac, { ...pc, online: false }], [outcome({ advanced: 2, head: 'b1' })], new Set(['pc']));
		// La caduta sta in `sticky`; i commit sono nella coda e si vedono.
		assert.ok(feed.sticky, 'la caduta ha il suo spazio');
		assert.ok(feed.sticky.text.includes('PC'));
		const queued = drain(feed);
		assert.ok(queued.some((text) => text.includes('2 commit')),
			`i commit non restano dietro la caduta: ${queued.join(' | ')}`);
	});

	it('la caduta fissa non blocca la coda: il commit si legge anche senza chiuderla', () => {
		const feed = new MachineAlertFeed();
		feed.update([mac, pc], []);
		feed.update([mac, { ...pc, online: false }], [], new Set(['pc']));
		assert.ok(feed.sticky);
		feed.update([mac, { ...pc, online: false }], [outcome({ advanced: 1, head: 'b2' })], new Set(['pc']));
		assert.ok(feed.current, 'la coda mostra il commit mentre la caduta resta');
		assert.ok(feed.current.text.includes('1 commit'));
	});

	it('quando la macchina torna, la caduta fissa sparisce da sola', () => {
		const feed = new MachineAlertFeed();
		feed.update([mac, pc], []);
		feed.update([mac, { ...pc, online: false }], [], new Set(['pc']));
		assert.ok(feed.sticky);
		feed.update([mac, pc], [], new Set(['pc']));
		assert.equal(feed.sticky, null, 'la caduta non e\' piu\' vera');
	});

	it('un errore di sincronizzazione esce con la variante errore', () => {
		const feed = new MachineAlertFeed();
		feed.announce('Sincronizzazione non riuscita con PC', 'error');
		assert.equal(feed.current?.tone, 'error');
		feed.announce('Diario unito con PC');
		assert.equal(feed.current?.tone, 'error', 'la coda rispetta l\'ordine');
		feed.dismiss();
		assert.equal(feed.current?.tone, 'info');
	});
});
