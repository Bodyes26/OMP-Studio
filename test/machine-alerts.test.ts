/**
 * R-MI-51: avvisi brevi sugli eventi delle macchine. La regola che conta e'
 * la deduplica: lo stesso evento una volta sola finche' lo stato non cambia,
 * e niente annunci all'avvio per chi era gia' in linea.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	emptyAlertsState,
	reduceMachineAlerts,
	type OutcomeSample,
	type PresenceSample
} from '../src/lib/stores/machineAlerts.ts';

const mac: PresenceSample = { id: 'mac', name: 'MacBook', online: true };
const pc: PresenceSample = { id: 'pc', name: 'PC', online: true };

const outcome = (over: Partial<OutcomeSample> = {}): OutcomeSample => ({
	machine: 'mac', name: 'MacBook', project: 'omp-studio', advanced: 0,
	merged: false, journalOnly: false, blocked: [], head: 'abc', ...over
});

describe('Avvisi delle macchine (R-MI-51)', () => {
	it('all avvio non annuncia chi era gia in linea', () => {
		const first = reduceMachineAlerts(emptyAlertsState(), { machines: [mac, pc], outcomes: [] });
		assert.deepEqual(first.alerts, [], 'nessun avviso per lo stato iniziale');
		const second = reduceMachineAlerts(first.state, { machines: [mac, pc], outcomes: [] });
		assert.deepEqual(second.alerts, [], 'nemmeno al secondo campione, se non cambia nulla');
	});

	it('la macchina che cade e torna produce un avviso per ciascun cambio, non a ogni giro', () => {
		let state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac], outcomes: [] }).state;
		const down = reduceMachineAlerts(state, { machines: [{ ...mac, online: false }], outcomes: [] });
		assert.deepEqual(down.alerts, [{ kind: 'presence', machine: 'mac', name: 'MacBook', online: false }]);
		state = down.state;
		// Tre giri ancora spenta: niente da ripetere.
		for (let i = 0; i < 3; i++) {
			const again = reduceMachineAlerts(state, { machines: [{ ...mac, online: false }], outcomes: [] });
			assert.deepEqual(again.alerts, []);
			state = again.state;
		}
		const up = reduceMachineAlerts(state, { machines: [mac], outcomes: [] });
		assert.deepEqual(up.alerts, [{ kind: 'presence', machine: 'mac', name: 'MacBook', online: true }]);
	});

	it('una macchina appena abbinata non e un ritorno', () => {
		let state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac], outcomes: [] }).state;
		const joined = reduceMachineAlerts(state, { machines: [mac, pc], outcomes: [] });
		assert.deepEqual(joined.alerts, []);
		// Ma se poi si spegne, si annuncia.
		const gone = reduceMachineAlerts(joined.state, { machines: [mac, { ...pc, online: false }], outcomes: [] });
		assert.deepEqual(gone.alerts, [{ kind: 'presence', machine: 'pc', name: 'PC', online: false }]);
	});

	it('N commit arrivati: un avviso per lotto, non a ogni giro', () => {
		let state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac], outcomes: [outcome()] }).state;
		const first = reduceMachineAlerts(state, { machines: [mac], outcomes: [outcome({ advanced: 3, head: 'def' })] });
		assert.deepEqual(first.alerts, [{ kind: 'advanced', machine: 'mac', name: 'MacBook', project: 'omp-studio', count: 3 }]);
		state = first.state;
		const repeat = reduceMachineAlerts(state, { machines: [mac], outcomes: [outcome({ advanced: 3, head: 'def' })] });
		assert.deepEqual(repeat.alerts, [], 'stesso esito, nessun nuovo avviso');
		const second = reduceMachineAlerts(repeat.state, { machines: [mac], outcomes: [outcome({ advanced: 1, head: 'ghi' })] });
		assert.deepEqual(second.alerts, [{ kind: 'advanced', machine: 'mac', name: 'MacBook', project: 'omp-studio', count: 1 }]);
	});

	it('lo stesso conteggio con una cima diversa e un nuovo lotto', () => {
		let state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac], outcomes: [outcome()] }).state;
		state = reduceMachineAlerts(state, { machines: [mac], outcomes: [outcome({ advanced: 2, head: 'b1' })] }).state;
		const again = reduceMachineAlerts(state, { machines: [mac], outcomes: [outcome({ advanced: 2, head: 'b2' })] });
		assert.deepEqual(again.alerts, [{ kind: 'advanced', machine: 'mac', name: 'MacBook', project: 'omp-studio', count: 2 }]);
	});

	it('il diario unito si annuncia una volta, e di nuovo solo se succede ancora', () => {
		let state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac], outcomes: [outcome()] }).state;
		const first = reduceMachineAlerts(state, {
			machines: [mac],
			outcomes: [outcome({ merged: true, journalOnly: true, advanced: 1, head: 'j1' })]
		});
		assert.deepEqual(first.alerts, [
			{ kind: 'advanced', machine: 'mac', name: 'MacBook', project: 'omp-studio', count: 1 },
			{ kind: 'journal', machine: 'mac', name: 'MacBook', project: 'omp-studio' }
		]);
		state = first.state;
		assert.deepEqual(reduceMachineAlerts(state, {
			machines: [mac],
			outcomes: [outcome({ merged: true, journalOnly: true, advanced: 1, head: 'j1' })]
		}).alerts, []);
	});

	it('copie unite senza conflitti: «Copie unite», una volta per lotto (R-MI-61)', () => {
		let state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac], outcomes: [outcome()] }).state;
		const merged = outcome({ merged: true, advanced: 2, head: 'm1' });
		const first = reduceMachineAlerts(state, { machines: [mac], outcomes: [merged] });
		assert.deepEqual(first.alerts, [
			{ kind: 'advanced', machine: 'mac', name: 'MacBook', project: 'omp-studio', count: 2 },
			{ kind: 'merged', machine: 'mac', name: 'MacBook', project: 'omp-studio' }
		], 'nessun «Diario unito»: i file toccati non erano solo del diario');
		state = first.state;
		assert.deepEqual(reduceMachineAlerts(state, { machines: [mac], outcomes: [merged] }).alerts, []);
	});

	it('avanzamento bloccato: motivo e numero una volta, poi solo quando cambia', () => {
		let state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac], outcomes: [outcome()] }).state;
		const blockedOutcome = outcome({ blocked: [{ branch: 'main', reason: 'busy', behind: 2 }] });
		const first = reduceMachineAlerts(state, { machines: [mac], outcomes: [blockedOutcome] });
		assert.deepEqual(first.alerts, [
			{ kind: 'blocked', machine: 'mac', name: 'MacBook', project: 'omp-studio', reason: 'busy', count: 2 }
		]);
		state = first.state;
		assert.deepEqual(reduceMachineAlerts(state, { machines: [mac], outcomes: [blockedOutcome] }).alerts, []);
		const changed = reduceMachineAlerts(state, {
			machines: [mac],
			outcomes: [outcome({ blocked: [{ branch: 'main', reason: 'conflict:src/a.ts', behind: 2 }] })]
		});
		assert.deepEqual(changed.alerts, [
			{ kind: 'blocked', machine: 'mac', name: 'MacBook', project: 'omp-studio', reason: 'conflict:src/a.ts', count: 2 }
		]);
	});

	it('un blocco risolto e poi tornato si annuncia di nuovo', () => {
		const blockedOutcome = outcome({ blocked: [{ branch: 'main', reason: 'busy', behind: 2 }] });
		let state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac], outcomes: [outcome()] }).state;
		state = reduceMachineAlerts(state, { machines: [mac], outcomes: [blockedOutcome] }).state;
		state = reduceMachineAlerts(state, { machines: [mac], outcomes: [outcome()] }).state;
		const back = reduceMachineAlerts(state, { machines: [mac], outcomes: [blockedOutcome] });
		assert.deepEqual(back.alerts, [
			{ kind: 'blocked', machine: 'mac', name: 'MacBook', project: 'omp-studio', reason: 'busy', count: 2 }
		]);
	});

	it('non modifica lo stato passato: chi lo tiene decide quando sostituirlo', () => {
		const state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac], outcomes: [] }).state;
		const snapshot = JSON.stringify(state);
		reduceMachineAlerts(state, { machines: [{ ...mac, online: false }], outcomes: [outcome({ advanced: 1, head: 'z' })] });
		assert.equal(JSON.stringify(state), snapshot);
	});

	it('una macchina revocata sparisce: al ritorno sarebbe una nuova', () => {
		let state = reduceMachineAlerts(emptyAlertsState(), { machines: [mac, pc], outcomes: [] }).state;
		state = reduceMachineAlerts(state, { machines: [mac], outcomes: [] }).state;
		const back = reduceMachineAlerts(state, { machines: [mac, pc], outcomes: [] });
		assert.deepEqual(back.alerts, [], 'non e un ritorno: non c era piu');
	});
});
