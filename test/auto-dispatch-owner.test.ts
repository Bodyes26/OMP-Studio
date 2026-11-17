/**
 * R-MI-13 / F20: l'auto-avvio di un progetto condiviso sta acceso su una sola
 * macchina. Due macchine accese sullo stesso progetto avvierebbero lo stesso
 * task due volte; nessuna accesa lascia la coda ferma (nessuno eredita).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	dispatchOwner,
	enableExclusive,
	mayDispatchHere,
	ownerLabel,
	type DispatchCopy
} from '../src/lib/stores/autoDispatchOwner.ts';

const mac = (over: Partial<DispatchCopy> = {}): DispatchCopy => ({
	machineId: 'mac',
	name: 'MacBook Air',
	online: true,
	autoDispatch: false,
	lastUsed: 100,
	...over
});
const pc = (over: Partial<DispatchCopy> = {}): DispatchCopy => ({
	machineId: 'local',
	name: 'PIE-CN-LTC13',
	online: true,
	autoDispatch: false,
	lastUsed: 200,
	...over
});

describe('Chi avvia i task di un progetto condiviso (F20)', () => {
	it('senza nessun interruttore acceso non c e detentore', () => {
		const owner = dispatchOwner([mac(), pc()]);
		assert.equal(owner.machineId, null);
		assert.equal(mayDispatchHere([mac(), pc()], 'local', owner), false);
	});

	it('con l interruttore acceso su una macchina, avvia quella', () => {
		const copies = [mac({ autoDispatch: true }), pc()];
		const owner = dispatchOwner(copies);
		assert.equal(owner.machineId, 'mac');
		assert.equal(mayDispatchHere(copies, 'mac', owner), true);
		assert.equal(mayDispatchHere(copies, 'local', owner), false, 'la coda sull altra resta ferma');
	});

	it('due macchine accese sono un conflitto: vince l ultima usata', () => {
		const copies = [mac({ autoDispatch: true, lastUsed: 100 }), pc({ autoDispatch: true, lastUsed: 300 })];
		const owner = dispatchOwner(copies);
		assert.equal(owner.machineId, 'local');
		assert.equal(owner.conflict, true);
		assert.deepEqual(owner.toDisable, ['mac']);
	});

	it('il detentore spento ferma la coda invece di trasferire il ruolo', () => {
		const copies = [mac({ autoDispatch: true, online: false }), pc()];
		const owner = dispatchOwner(copies);
		assert.equal(owner.machineId, 'mac');
		assert.equal(owner.offline, true);
		assert.equal(mayDispatchHere(copies, 'local', owner), false, 'nessuno eredita il ruolo');
	});
});

describe('Accensione esclusiva (F20)', () => {
	it('accendere su una macchina spegne le altre', () => {
		const copies = [mac({ autoDispatch: true }), pc()];
		const plan = enableExclusive(copies, 'local');
		assert.equal(plan.enable, 'local');
		assert.deepEqual(plan.disable, ['mac']);
	});

	it('accendere dove e gia acceso non scrive nulla', () => {
		const copies = [mac({ autoDispatch: true }), pc()];
		const plan = enableExclusive(copies, 'mac');
		assert.equal(plan.enable, null);
		assert.deepEqual(plan.disable, []);
	});

	it('una macchina senza il progetto non si puo accendere', () => {
		const plan = enableExclusive([mac()], 'pc');
		assert.equal(plan.enable, null);
		assert.deepEqual(plan.disable, []);
	});
});

describe('Etichetta della coda', () => {
	it('progetto su una macchina sola non dice nulla', () => {
		assert.deepEqual(ownerLabel(dispatchOwner([mac({ autoDispatch: true })]), [mac({ autoDispatch: true })], 'mac'), {
			kind: 'single-machine'
		});
	});

	it('senza detentore lo dice', () => {
		const copies = [mac(), pc()];
		assert.deepEqual(ownerLabel(dispatchOwner(copies), copies, 'local'), { kind: 'none' });
	});

	it('detentore locale', () => {
		const copies = [mac(), pc({ autoDispatch: true })];
		assert.deepEqual(ownerLabel(dispatchOwner(copies), copies, 'local'), { kind: 'here' });
	});

	it('detentore altrove, con lo stato del collegamento', () => {
		const copies = [mac({ autoDispatch: true, online: false }), pc()];
		assert.deepEqual(ownerLabel(dispatchOwner(copies), copies, 'local'), {
			kind: 'elsewhere',
			name: 'MacBook Air',
			offline: true
		});
	});
});
