/**
 * R-MI-38, R-MI-64: aggiornare Studio sull'altra macchina. Quando proporlo, su
 * quale canale, come si ordinano due versioni, quando chiederlo da soli e
 * quando l'altra macchina puo' installare e riavviare.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	autoUpdateKey,
	channelOf,
	compareStudioVersions,
	machineUpdateState,
	needsUpdate,
	parseStudioVersion,
	peerBehind,
	shouldRequestAutoUpdate,
	waitReasons
} from '../src/lib/backend/peerUpdateRules.ts';

const idle = { workingAgents: 0, pendingQuestions: 0, activeJobs: 0, incomingJobs: 0, unsavedProjects: 0 };

describe('Ordine delle versioni di Studio (R-MI-64, D5)', () => {
	it('legge base e numero di build', () => {
		assert.deepEqual(parseStudioVersion('1.10.1-nightly.1795999999999'), { base: [1, 10, 1], nightly: 1795999999999 });
		assert.deepEqual(parseStudioVersion('v1.10.1'), { base: [1, 10, 1], nightly: null });
		assert.deepEqual(parseStudioVersion('non-una-versione'), { base: null, nightly: null });
	});

	it('ordina per base semver', () => {
		assert.equal(compareStudioVersions('1.10.1', '1.9.9'), 1);
		assert.equal(compareStudioVersions('1.10.0', '1.10.1'), -1);
		assert.equal(compareStudioVersions('2.0.0', '1.99.99'), 1);
		assert.equal(compareStudioVersions('1.10.1', '1.10.1'), 0);
	});

	it('due Nightly della stessa base si ordinano per numero di build', () => {
		assert.equal(compareStudioVersions('1.10.1-nightly.1794865373032', '1.10.1-nightly.1795999999999'), -1);
		assert.equal(compareStudioVersions('1.10.1-nightly.1795999999999', '1.10.1-nightly.1794865373032'), 1);
		assert.equal(compareStudioVersions('1.10.1-nightly.7', '1.10.1-nightly.7'), 0);
	});

	it('a parita di base la stabile viene dopo la Nightly', () => {
		assert.equal(compareStudioVersions('1.10.1', '1.10.1-nightly.999999'), 1);
		assert.equal(compareStudioVersions('1.10.1-nightly.999999', '1.10.1'), -1);
	});

	it('una versione illeggibile non ordina nulla', () => {
		assert.equal(compareStudioVersions('', '1.10.1'), 0);
		assert.equal(compareStudioVersions(null, '1.10.1'), 0);
	});
});

describe('Aggiornamento di un\'altra macchina (R-MI-38, R-MI-64)', () => {
	it('l avviso «diverso da qui» compare solo per una base incompatibile (D5)', () => {
		assert.equal(needsUpdate({ online: true, version: '1.10.0-nightly.1', compatible: false }, '1.10.0-nightly.2'), true);
		assert.equal(needsUpdate({ online: true, version: '1.9.0', compatible: false }, '1.10.0'), true);
		// Due Nightly della stessa base: nessun avviso, e' un aggiornamento.
		assert.equal(needsUpdate({ online: true, version: '1.10.0-nightly.1', compatible: true }, '1.10.0-nightly.2'), false);
		assert.equal(needsUpdate({ online: false, version: '1.9.0', compatible: false }, '1.10.0'), false, 'spenta: non si avvisa');
		assert.equal(needsUpdate({ online: true, version: null, compatible: false }, '1.10.0'), false);
	});

	it('l altra macchina e indietro solo se ha una versione piu vecchia', () => {
		assert.equal(peerBehind({ online: true, version: '1.10.0-nightly.1' }, '1.10.0-nightly.2'), true);
		// Canali diversi non si portano l'uno sull'altro: chi sta sulle Nightly
		// non vede l'altra macchina tornare alla stabile, e viceversa.
		assert.equal(peerBehind({ online: true, version: '1.10.0-nightly.5' }, '1.10.0'), false);
		assert.equal(peerBehind({ online: true, version: '1.10.0' }, '1.10.0-nightly.5'), false);
		assert.equal(peerBehind({ online: true, version: '1.10.0' }, '1.10.1'), true, 'stessa stabile, piu vecchia');
		assert.equal(peerBehind({ online: true, version: '1.10.1-nightly.9' }, '1.10.0'), false, 'piu nuova: niente richieste');
		assert.equal(peerBehind({ online: false, version: '1.0.0' }, '2.0.0'), false);
	});

	it('l aggiornamento si chiede da soli una volta per (macchina, versione di questa)', () => {
		const base = { peer: { id: 'pc', online: true, version: '1.10.0' }, own: '1.10.1', dev: false };
		assert.equal(shouldRequestAutoUpdate({ ...base, asked: new Set() }), true);
		assert.equal(shouldRequestAutoUpdate({
			...base,
			asked: new Set([autoUpdateKey('pc', '1.10.1')])
		}), false, 'gia chiesto in questa esecuzione');
		assert.equal(shouldRequestAutoUpdate({
			...base,
			peer: { id: 'pc', online: true, version: '1.10.2' },
			asked: new Set()
		}), false, 'mai verso una piu nuova');
		assert.equal(shouldRequestAutoUpdate({ ...base, dev: true, asked: new Set() }), false, 'mai da una build di sviluppo');
		assert.equal(shouldRequestAutoUpdate({
			...base,
			peer: { id: 'pc', online: false, version: '1.10.0' },
			asked: new Set()
		}), false);
	});

	it('la riga di ogni macchina nel modale dice stato e versione (R-MI-64)', () => {
		const own = '1.10.1';
		assert.equal(machineUpdateState({ online: true, version: '1.10.1', own }), 'updated');
		assert.equal(machineUpdateState({ online: true, version: '1.10.1-nightly.3', own }), 'outdated');
		assert.equal(machineUpdateState({ online: true, version: '1.10.2', own }), 'updated', 'a una piu nuova non si chiede nulla');
		assert.equal(machineUpdateState({ online: false, version: '1.10.1', own }), 'offline');
		assert.equal(machineUpdateState({ online: true, version: null, own }), 'unknown', 'prima del primo riepilogo');
		assert.equal(machineUpdateState({ online: true, version: '1.10.1', own, phase: 'downloading' }), 'updating');
		assert.equal(machineUpdateState({ online: true, version: '1.10.0', own, phase: 'waiting' }), 'waiting');
		assert.equal(machineUpdateState({ online: true, version: '1.10.0', own, phase: 'failed' }), 'outdated');
	});

	it('una Nightly porta l altra macchina sul canale Nightly', () => {
		assert.equal(channelOf('1.10.1-nightly.1795999999999'), 'nightly');
		assert.equal(channelOf('1.10.1'), 'stable');
	});

	it('installa solo a macchina libera e dice cosa la tiene occupata', () => {
		assert.deepEqual(waitReasons(idle), []);
		assert.deepEqual(waitReasons({ ...idle, workingAgents: 1 }), ['agents']);
		assert.deepEqual(waitReasons({ ...idle, activeJobs: 2 }), ['agents'], 'le automazioni al lavoro contano come agenti');
		assert.deepEqual(
			waitReasons({ workingAgents: 1, pendingQuestions: 1, activeJobs: 0, incomingJobs: 1, unsavedProjects: 3 }),
			['agents', 'questions', 'jobs', 'unsaved']
		);
	});
});
