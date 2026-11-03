import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { waitActivities, describeWait, type WaitContext } from '../src/lib/agent/tools/wait.ts';

describe('Attese: identita, precedenza e stato dei lavori', () => {
	it('unifica il subagente con il suo job e conserva il fallimento nativo contro lo snapshot live', () => {
		const context: WaitContext = { subagents: [{
			id: 'review', jobId: 'job-review', agent: 'Revisione', status: 'running'
		}] };
		const activities = waitActivities({
			jobs: [{ id: 'job-review', status: 'failed', label: 'Revisione UI', errorText: 'Timeout API' }],
			agents: [{ id: 'review', live: false }]
		}, context);
		assert.deepEqual(activities.map(({ id, status, error, progress }) => ({
			id, status, error, linkedId: progress?.id, linkedStatus: progress?.status
		})), [{ id: 'review', status: 'failed', error: 'Timeout API', linkedId: 'review', linkedStatus: 'failed' }]);
		assert.equal(context.subagents![0].status, 'running');
	});

	it('un peer non piu live non diventa un subagente completato o un link al transcript', () => {
		const [peer] = waitActivities({ agents: [{ id: 'external-peer', live: false }] });
		assert.equal(peer.status, 'unknown');
		assert.equal(peer.progress, undefined);
	});

	it('non confonde nomi uguali con identita uguali e lascia il secondo lavoro in corso', () => {
		const activities = waitActivities({ jobs: [
			{ id: 'one', label: 'Build', status: 'completed' },
			{ id: 'two', label: 'Build', status: 'running' }
		] });
		assert.deepEqual(activities.map(({ id, status }) => ({ id, status })), [
			{ id: 'one', status: 'completed' }, { id: 'two', status: 'running' }
		]);
	});

	it('mostra lo scopo del job (omp 18.15+) e ripiega sul comando quando manca', () => {
		const activities = waitActivities({ jobs: [
			{ id: 'build', type: 'bash', intent: 'Compilo il frontend', label: 'npm run build', status: 'running' },
			{ id: 'lint', type: 'bash', label: 'npm run lint', status: 'running' }
		] });
		assert.deepEqual(activities.map((item) => item.label), ['Compilo il frontend', 'npm run lint']);
	});

	it('le attivita nel solo contesto non sono target certi della wait', () => {
		const context: WaitContext = {
			subagents: [{ id: 'unrelated', agent: 'Altro lavoro', status: 'running' }],
			jobs: [{ id: 'old-build', label: 'Build precedente', status: 'completed' }]
		};
		assert.deepEqual(describeWait({ running: true, context }), describeWait({ running: true }));
		assert.deepEqual(describeWait({ running: false, context }), describeWait({ running: false }));
		assert.deepEqual(waitActivities(undefined, context).map((item) => item.observed), [false, false]);
	});
});
