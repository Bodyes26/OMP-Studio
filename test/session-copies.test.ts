/**
 * R-MI-12 / F19: lo storico sessioni di un progetto condiviso è un elenco
 * unico, con il badge della macchina su ogni riga.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	mergeSessionCopies,
	needsMachineBadge,
	reachableCopies,
	type SessionCopy
} from '../src/lib/agent/sessionCopies.ts';

const mac: SessionCopy = { machineId: 'mac', name: 'MacBook Air', projectPath: '/Users/other/dev/repo', online: true };
const pc: SessionCopy = { machineId: 'local', name: 'PIE-CN-LTC13', projectPath: 'C:\\Users\\other\\repo', online: true };

describe('Storico sessioni unificato (F19)', () => {
	it('unisce le sessioni delle due macchine in un elenco solo', () => {
		const merged = mergeSessionCopies([
			{ copy: mac, entry: { id: 'a', created_at: 100 } },
			{ copy: pc, entry: { id: 'b', created_at: 200 } }
		]);
		assert.deepEqual(merged.map((m) => m.entry.id), ['b', 'a'], 'dalla piu recente');
	});

	it('ogni riga porta la macchina che la possiede', () => {
		const merged = mergeSessionCopies([{ copy: mac, entry: { id: 'a', created_at: 100 } }]);
		assert.equal(merged[0].machineId, 'mac');
		assert.equal(merged[0].machineName, 'MacBook Air');
	});

	it('lo stesso id su due macchine resta due sessioni', () => {
		const merged = mergeSessionCopies([
			{ copy: mac, entry: { id: 'uguale', created_at: 100 } },
			{ copy: pc, entry: { id: 'uguale', created_at: 100 } }
		]);
		assert.equal(merged.length, 2, 'stesso id su istanze diverse non e la stessa conversazione');
	});

	it('a pari istante l ordine e stabile per macchina e id', () => {
		const merged = mergeSessionCopies([
			{ copy: pc, entry: { id: 'x', created_at: 100 } },
			{ copy: mac, entry: { id: 'y', created_at: 100 } }
		]);
		assert.deepEqual(merged.map((m) => m.entry.id), ['y', 'x'], 'MacBook Air prima di PIE-CN-LTC13');
	});

	it('una copia ripetuta non duplica le righe', () => {
		const merged = mergeSessionCopies([
			{ copy: mac, entry: { id: 'a', created_at: 100 } },
			{ copy: mac, entry: { id: 'a', created_at: 100 } }
		]);
		assert.equal(merged.length, 1);
	});
});

describe('Badge e copie interrogate', () => {
	it('il badge serve solo con piu di una copia', () => {
		assert.equal(needsMachineBadge([mac]), false);
		assert.equal(needsMachineBadge([mac, pc]), true);
	});

	it('le copie spente non si interrogano', () => {
		const offline: SessionCopy = { ...mac, online: false };
		assert.deepEqual(reachableCopies([offline, pc]).map((c) => c.machineId), ['local']);
	});
});
