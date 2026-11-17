/**
 * R-MI-21: il selettore elenca una volta sola lo stesso progetto presente su
 * più macchine, nel gruppo giusto. Una voce doppia o nel gruppo sbagliato fa
 * aprire una seconda copia invece di tornare a quella in barra.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPickerEntries, filterPickerEntries, pickerKey, preferredClosedCopy, type PickerCopy } from '../src/lib/stores/pickerEntries.ts';

const copy = (machineId: string, state: 'open' | 'closed', over: Partial<PickerCopy> = {}): PickerCopy => ({
	machineId,
	machineName: machineId === 'local' ? 'Questo computer' : machineId,
	local: machineId === 'local',
	online: true,
	state,
	path: `/${machineId}/sito`,
	...over
});

describe('Elenco unico del selettore (R-MI-21)', () => {
	it('unisce per repository la tessera e la cartella chiusa sull altra macchina', () => {
		const key = pickerKey('Maurizio/Sito', 'sito');
		const entries = buildPickerEntries(
			[{ id: 't1', key, name: 'Sito', label: null, hue: 10, diverged: false, copies: [copy('local', 'open')] }],
			[],
			[{ key: pickerKey('maurizio/sito', 'sito-web'), name: 'sito-web', copy: copy('mac', 'closed') }]
		);
		assert.equal(entries.length, 1);
		assert.equal(entries[0].group, 'window');
		assert.deepEqual(entries[0].copies.map((c) => [c.machineId, c.state]), [['local', 'open'], ['mac', 'closed']]);
	});

	it('un progetto nascosto qui va fra gli aperti altrove, non fra i chiusi', () => {
		const key = pickerKey(null, 'blog');
		const entries = buildPickerEntries(
			[],
			[{ key, name: 'blog', copy: copy('mac', 'open', { projectId: 'mac::b' }) }],
			[{ key, name: 'blog', copy: copy('local', 'closed') }]
		);
		assert.equal(entries[0].group, 'elsewhere');
		assert.equal(entries[0].copies.length, 2);
	});

	it('la stessa macchina non compare due volte', () => {
		const key = pickerKey(null, 'x');
		const entries = buildPickerEntries(
			[{ id: 't', key, name: 'x', label: null, hue: null, diverged: false, copies: [copy('mac', 'open')] }],
			[],
			[{ key, name: 'x', copy: copy('mac', 'closed') }]
		);
		assert.equal(entries[0].copies.length, 1);
		assert.equal(entries[0].copies[0].state, 'open');
	});
	it('il filtro per macchina tiene solo le voci presenti su quella macchina', () => {
		const entries = buildPickerEntries([], [], [
			{ key: 'name:alfa', name: 'alfa', copy: copy('local', 'closed') },
			{ key: 'name:beta', name: 'beta', copy: copy('mac', 'closed') }
		]);
		assert.deepEqual(filterPickerEntries(entries, new Set(['mac']), '').map((e) => e.name), ['beta']);
		assert.deepEqual(filterPickerEntries(entries, new Set(), 'alf').map((e) => e.name), ['alfa']);
	});

	it('il clic sulla riga chiusa apre qui se la cartella c è, altrimenti sulla prima in linea', () => {
		const [entry] = buildPickerEntries([], [], [
			{ key: 'name:a', name: 'a', copy: copy('mac', 'closed') },
			{ key: 'name:a', name: 'a', copy: copy('local', 'closed') }
		]);
		assert.equal(preferredClosedCopy(entry)?.machineId, 'local');
		const [remoteOnly] = buildPickerEntries([], [], [
			{ key: 'name:b', name: 'b', copy: copy('off', 'closed', { online: false }) },
			{ key: 'name:b', name: 'b', copy: copy('mac', 'closed') }
		]);
		assert.equal(preferredClosedCopy(remoteOnly)?.machineId, 'mac');
	});
});
