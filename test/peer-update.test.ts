/**
 * R-MI-38: aggiornare Studio sull'altra macchina. Quando proporlo, su quale
 * canale e quando l'altra macchina puo' installare e riavviare.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { channelOf, needsUpdate, waitReasons } from '../src/lib/backend/peerUpdateRules.ts';

const idle = { workingAgents: 0, pendingQuestions: 0, activeJobs: 0, incomingJobs: 0, unsavedProjects: 0 };

describe('Aggiornamento di un\'altra macchina (R-MI-38)', () => {
	it('lo propone solo per una macchina in linea con un altro Studio', () => {
		assert.equal(needsUpdate({ online: true, version: '1.10.0-nightly.1' }, '1.10.0-nightly.2'), true);
		assert.equal(needsUpdate({ online: true, version: '1.10.0' }, '1.10.0'), false);
		assert.equal(needsUpdate({ online: false, version: '1.9.0' }, '1.10.0'), false, 'spenta: non si puo\' aggiornare');
		assert.equal(needsUpdate({ online: true, version: null }, '1.10.0'), false);
	});

	it('una Nightly porta l\'altra macchina sul canale Nightly', () => {
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
