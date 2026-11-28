/**
 * R-MI-13 / F19: l'elenco delle macchine dell'indicatore sotto il composer.
 * La regola F18 (l'ultima copia usata, non quella locale) la applica
 * `projectCopies.ts`; qui si prova solo l'ordine e la deduplica dell'elenco.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { machineChoices, type MachineCopy } from '../src/lib/agent/machineChoice.ts';

const mac: MachineCopy = { machineId: 'mac', name: 'MacBook Air', online: true, lastUsed: 100 };
const pc: MachineCopy = { machineId: 'local', name: 'PIE-CN-LTC13', online: true, lastUsed: 200 };

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
