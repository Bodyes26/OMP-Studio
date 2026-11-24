/**
 * R-MI-49: stato del chip «Macchine». Il punto di ogni macchina deve dire la
 * stessa cosa del collegamento: in linea, spenta, relay non raggiungibile,
 * versione incompatibile.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	agoParts,
	machineDots,
	machineState,
	machinesChipSummary,
	type MachineStatusInput
} from '../src/lib/stores/machineStatus.ts';

const peer = (over: Partial<MachineStatusInput> = {}): MachineStatusInput => ({
	id: 'mac', name: 'MacBook', online: true, compatible: true, responded: true, offlineReason: null, ...over
});

describe('Stato del chip Macchine (R-MI-49)', () => {
	it('in linea e compatibile e verde', () => {
		assert.equal(machineState(peer()), 'online');
	});

	it('connessa ma senza risposta dell host e in attesa, non verde (D8)', () => {
		// QUIC aperto non significa che l'altra macchina abbia parlato: il
		// punto resta ambra finche' non arriva il primo riepilogo.
		assert.equal(machineState(peer({ responded: false })), 'waiting');
	});

	it('spenta batte la mancanza di risposta', () => {
		assert.equal(machineState(peer({ online: false, responded: false, offlineReason: 'machine' })), 'offline');
	});

	it('in linea ma di un altra versione e incompatibile, non spenta', () => {
		assert.equal(machineState(peer({ compatible: false })), 'incompatible');
	});

	it('spenta con il relay raggiungibile e macchina spenta', () => {
		assert.equal(machineState(peer({ online: false, offlineReason: 'machine' })), 'offline');
	});

	it('spenta perche il relay non risponde si distingue dalla macchina spenta', () => {
		assert.equal(machineState(peer({ online: false, offlineReason: 'relay' })), 'relay');
	});

	it('senza ragione nota resta «spenta»: il relay non e la causa', () => {
		assert.equal(machineState(peer({ online: false, offlineReason: null })), 'offline');
	});

	it('i punti seguono l ordine delle macchine abbinate', () => {
		assert.deepEqual(machineDots([peer(), peer({ id: 'pc', name: 'PC', online: false, offlineReason: 'machine' })]), [
			{ id: 'mac', name: 'MacBook', state: 'online' },
			{ id: 'pc', name: 'PC', state: 'offline' }
		]);
	});

	it('senza macchine abbinate il chip non compare', () => {
		assert.deepEqual(machinesChipSummary([]), { visible: false, dots: [], anyOnline: false, anyRelayDown: false });
	});

	it('una macchina in attesa conta come raggiungibile nel riassunto', () => {
		const summary = machinesChipSummary([peer({ responded: false })]);
		assert.equal(summary.dots[0].state, 'waiting');
		assert.equal(summary.anyOnline, true, 'il chip non dice «tutto spento»');
	});

	it('il riassunto dice se qualcuna risponde e se il relay e giu', () => {
		const summary = machinesChipSummary([
			peer({ id: 'mac', online: false, offlineReason: 'relay' }),
			peer({ id: 'pc', name: 'PC' })
		]);
		assert.equal(summary.visible, true);
		assert.equal(summary.anyOnline, true);
		assert.equal(summary.anyRelayDown, true);
	});

	it('tutte spente: nessuna in linea', () => {
		const summary = machinesChipSummary([peer({ online: false, offlineReason: 'machine' })]);
		assert.equal(summary.anyOnline, false);
		assert.equal(summary.anyRelayDown, false);
	});

	it('il tempo trascorso sceglie l unita piu grande leggibile', () => {
		assert.deepEqual(agoParts(0), { value: 0, unit: 'minute' });
		assert.deepEqual(agoParts(90_000), { value: 1, unit: 'minute' });
		assert.deepEqual(agoParts(60 * 60_000), { value: 1, unit: 'hour' });
		assert.deepEqual(agoParts(23 * 60 * 60_000), { value: 23, unit: 'hour' });
		assert.deepEqual(agoParts(24 * 60 * 60_000), { value: 1, unit: 'day' });
	});
});
