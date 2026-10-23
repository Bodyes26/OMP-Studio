import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	markSwitch,
	pendingSwitch,
	registerSnapshot,
	switchSnapshot
} from '../src/lib/switchDissolve.ts';

describe('Dissolvenza mirata: fotografia allo switch', () => {
	it('conserva cio che la regione mostrava al momento dello switch, non dopo', () => {
		let shown = ['a.ts', 'b.ts'];
		const unregister = registerSnapshot('test-region', () => [...shown]);
		markSwitch('lane');
		shown = ['c.ts'];
		assert.deepEqual(switchSnapshot<string[]>('test-region'), ['a.ts', 'b.ts']);
		unregister();
	});

	it('ogni switch apre una nuova epoca e riporta il tipo', () => {
		markSwitch('lane');
		const first = pendingSwitch();
		markSwitch('project');
		const second = pendingSwitch();
		assert.equal(first?.kind, 'lane');
		assert.equal(second?.kind, 'project');
		assert.ok(first && second && second.epoch > first.epoch);
	});

	it('una fotografia che fallisce non blocca le altre e resta senza stato precedente', () => {
		const offBroken = registerSnapshot('test-broken', () => {
			throw new Error('regione smontata');
		});
		const offHealthy = registerSnapshot('test-healthy', () => 42);
		markSwitch('lane');
		assert.equal(switchSnapshot('test-broken'), undefined);
		assert.equal(switchSnapshot('test-healthy'), 42);
		offBroken();
		offHealthy();
	});

	it('la vecchia regione che si smonta non cancella la fotografia della nuova', () => {
		const offOld = registerSnapshot('test-remount', () => 'vecchia');
		const offNew = registerSnapshot('test-remount', () => 'nuova');
		offOld();
		markSwitch('project');
		assert.equal(switchSnapshot('test-remount'), 'nuova');
		offNew();
		markSwitch('project');
		assert.equal(switchSnapshot('test-remount'), undefined);
	});
});
