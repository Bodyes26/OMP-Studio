/**
 * R-MI-13 / F18-F19: la macchina proposta è l'ultima usata; su un progetto di
 * una sola macchina non c'è scelta; il cambio è ammesso solo a sessione ferma.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	canChangeMachine,
	machineChoices,
	proposedMachine,
	type MachineCopy
} from '../src/lib/agent/machineChoice.ts';

const mac: MachineCopy = { machineId: 'mac', name: 'MacBook Air', online: true, lastUsed: 100 };
const pc: MachineCopy = { machineId: 'local', name: 'PIE-CN-LTC13', online: true, lastUsed: 200 };

describe('Macchina proposta per chat e task (R-MI-13, F18)', () => {
	it('con una sola copia parte li, senza domande', () => {
		assert.equal(proposedMachine([mac]), 'mac');
	});

	it('con piu copie vince l ultima usata, non la locale', () => {
		assert.equal(proposedMachine([mac, pc]), 'local');
		assert.equal(proposedMachine([pc, mac]), 'local', "l'ordine dell'elenco non conta");
	});

	it("se l'ultima usata e spenta si sceglie l'altra raggiungibile", () => {
		const offline: MachineCopy = { ...pc, online: false };
		assert.equal(proposedMachine([mac, offline]), 'mac');
	});

	it('se nessuna e raggiungibile resta l ultima usata, da mostrare come non raggiungibile', () => {
		const a: MachineCopy = { ...mac, online: false, lastUsed: 300 };
		const b: MachineCopy = { ...pc, online: false };
		assert.equal(proposedMachine([b, a]), 'mac');
	});

	it('senza copie non propone nulla', () => {
		assert.equal(proposedMachine([]), null);
	});
});

describe('Elenco delle macchine nell indicatore', () => {
	it('mette la corrente per prima e le altre per ultimo uso', () => {
		const older: MachineCopy = { machineId: 'old', name: 'Vecchio', online: true, lastUsed: 50 };
		const choices = machineChoices([older, mac, pc], 'mac');
		assert.deepEqual(choices.map((c) => c.id), ['mac', 'local', 'old']);
	});

	it('una macchina con piu copie compare una volta sola', () => {
		const worktree: MachineCopy = { ...mac, lastUsed: 400 };
		const choices = machineChoices([mac, worktree, pc], 'local');
		assert.deepEqual(choices.map((c) => c.id), ['local', 'mac']);
	});

	it('porta con se lo stato del collegamento', () => {
		const choices = machineChoices([mac, { ...pc, online: false }], 'mac');
		assert.equal(choices[1].online, false);
	});
});

describe('Cambio di macchina a sessione ferma (F19)', () => {
	const choices = machineChoices([mac, pc], 'local');

	it('a sessione ferma si puo cambiare', () => {
		assert.equal(canChangeMachine('mac', 'local', false, choices), true);
	});

	it('mentre la sessione lavora no', () => {
		assert.equal(canChangeMachine('mac', 'local', true, choices), false);
	});

	it('la macchina corrente resta selezionabile anche mentre lavora', () => {
		assert.equal(
			canChangeMachine('local', 'local', true, choices),
			true,
			'il menu non deve sembrare rotto a meta turno'
		);
	});

	it('una macchina che non ha il progetto non e selezionabile', () => {
		assert.equal(canChangeMachine('sconosciuta', 'local', false, choices), false);
	});
});
