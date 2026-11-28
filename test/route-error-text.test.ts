/**
 * S3-link-front-08 / contratto C5: un rifiuto di instradamento arriva alle
 * superfici d'errore come frase con il nome della macchina, non come inglese
 * con l'id di 64 caratteri. Il resto degli errori resta il loro messaggio.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BackendRouteError, routeErrorText, updateLinkedMachines } from '../src/lib/backend/ipc.ts';

describe('Testo degli errori di instradamento (S3-link-front-08)', () => {
	it('nomina la macchina, mai il suo id', () => {
		updateLinkedMachines([{ id: 'm-44b4c0d1e2f3', name: 'MacBook Air', online: false, compatible: true }]);
		const text = routeErrorText(new BackendRouteError('git_upstream_status', 'm-44b4c0d1e2f3', 'machine_unreachable'));
		assert.ok(text.includes('MacBook Air'), `il nome della macchina: ${text}`);
		assert.ok(!text.includes('m-44b4c0d1e2f3'), `l'id non arriva all'utente: ${text}`);
		assert.ok(!text.includes('machine_unreachable'), `il codice interno non arriva all'utente: ${text}`);
	});

	it('distingue la versione incompatibile dal comando che resta locale', () => {
		updateLinkedMachines([{ id: 'pc', name: 'PC', online: true, compatible: false }]);
		const incompatible = routeErrorText(new BackendRouteError('rpc_open', 'pc', 'incompatible_version'));
		const localOnly = routeErrorText(new BackendRouteError('install_studio_update_and_restart', 'pc', 'local_only'));
		assert.notEqual(incompatible, localOnly);
		for (const text of [incompatible, localOnly]) {
			assert.ok(text.includes('PC'), `la macchina e' nominata: ${text}`);
			assert.ok(!text.includes('Backend command'), `nessun testo di trasporto: ${text}`);
		}
	});

	it('un errore qualunque resta il suo messaggio', () => {
		assert.equal(routeErrorText(new Error('git: not a repository')), 'git: not a repository');
		assert.equal(routeErrorText('sessione chiusa'), 'sessione chiusa');
	});
});
