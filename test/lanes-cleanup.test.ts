import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	fetchUnintegratedLoss,
	laneBranchDeleteArgs,
	recoverInterruptedIntegrations,
	resolveStuckIntegration,
	unintegratedLoss,
	worktreeErrorCode,
	worktreeErrorMessage,
	type LaneCommandInvoker
} from '../src/lib/lanes/laneCleanup.ts';
import { landingNeedsUserConfirm } from '../src/lib/lanes/integrationGate.ts';
import {
	laneRecordFromAgentLane,
	lanePatchTouchesPersistedFields,
	pruneClosedDraftLanes
} from '../src/lib/stores/lanePersistence.ts';
import { createMainLane, laneId, projectId, workspacePath } from '../src/lib/types/lanes.ts';

type Call = { command: string; args?: Record<string, unknown> };

/** Mock di `invoke`: registra le chiamate e risponde per nome di comando. */
function mockInvoke(
	responses: Record<string, unknown | ((args?: Record<string, unknown>) => unknown)>
): { invoke: LaneCommandInvoker; calls: Call[] } {
	const calls: Call[] = [];
	const invoke = (async (command: string, args?: Record<string, unknown>) => {
		calls.push({ command, args });
		if (!(command in responses)) throw { code: 'internal', message: `comando ignoto ${command}` };
		const response = responses[command];
		const value = typeof response === 'function' ? (response as (a?: Record<string, unknown>) => unknown)(args) : response;
		if (value instanceof Error) throw value;
		return value;
	}) as LaneCommandInvoker;
	return { invoke, calls };
}

describe('pulizia corsie: errori dei comandi worktree', () => {
	it('mostra il messaggio del backend (GitTooOld) invece del testo di ripiego', () => {
		const error = { code: 'git_too_old', message: 'Git 2.20 e troppo vecchio: serve almeno 2.38' };
		assert.equal(worktreeErrorMessage(error, 'ripiego'), error.message);
		assert.equal(worktreeErrorCode(error), 'git_too_old');
		assert.equal(worktreeErrorMessage('testo', 'ripiego'), 'testo');
		assert.equal(worktreeErrorMessage(null, 'ripiego'), 'ripiego');
		assert.equal(worktreeErrorMessage({ message: '' }, 'ripiego'), 'ripiego');
	});
});

describe('pulizia corsie: commit mai integrati (D1)', () => {
	it('segnala la perdita solo per un branch esistente, non integrato e con commit propri', () => {
		assert.deepEqual(
			unintegratedLoss({ branchExists: true, integrated: false, commits: 3, files: 5 }),
			{ commits: 3, files: 5 }
		);
		assert.equal(unintegratedLoss({ branchExists: true, integrated: false, commits: 0, files: 0 }), null);
		assert.equal(unintegratedLoss({ branchExists: true, integrated: true, commits: 3, files: 5 }), null);
		assert.equal(unintegratedLoss({ branchExists: false, integrated: false, commits: 3, files: 5 }), null);
		assert.equal(unintegratedLoss(null), null);
	});

	it('interroga worktree_lane_unintegrated_summary con gli argomenti avvolti in args', async () => {
		const { invoke, calls } = mockInvoke({
			worktree_lane_unintegrated_summary: { branchExists: true, integrated: false, commits: 2, files: 7 }
		});
		const loss = await fetchUnintegratedLoss(invoke, '/repos/app', 'wt-1');
		assert.deepEqual(loss, { commits: 2, files: 7 });
		assert.deepEqual(calls, [
			{
				command: 'worktree_lane_unintegrated_summary',
				args: { args: { projectPath: '/repos/app', laneId: 'wt-1' } }
			}
		]);
	});

	it('senza riepilogo leggibile non inventa una perdita: decide il backend', async () => {
		const { invoke } = mockInvoke({});
		assert.equal(await fetchUnintegratedLoss(invoke, '/repos/app', 'wt-1'), null);
	});

	it('passa discardUnintegrated solo col consenso esplicito', () => {
		assert.deepEqual(laneBranchDeleteArgs('/repos/app', 'wt-1', false), {
			args: { projectPath: '/repos/app', laneId: 'wt-1', confirm: true }
		});
		assert.deepEqual(laneBranchDeleteArgs('/repos/app', 'wt-1', true), {
			args: { projectPath: '/repos/app', laneId: 'wt-1', confirm: true, discardUnintegrated: true }
		});
	});
});

describe('pulizia corsie: integrazione interrotta', () => {
	it('integrata secondo Git -> integrated; non integrata o errore -> review_ready', async () => {
		const integrated = mockInvoke({
			worktree_lane_integration_state: { branchExists: true, integrated: true }
		});
		assert.equal(await resolveStuckIntegration(integrated.invoke, '/repos/app', 'wt-1'), 'integrated');
		assert.deepEqual(integrated.calls[0], {
			command: 'worktree_lane_integration_state',
			args: { args: { projectPath: '/repos/app', laneId: 'wt-1' } }
		});

		const pending = mockInvoke({
			worktree_lane_integration_state: { branchExists: true, integrated: false }
		});
		assert.equal(await resolveStuckIntegration(pending.invoke, '/repos/app', 'wt-1'), 'review_ready');

		const failing = mockInvoke({});
		assert.equal(await resolveStuckIntegration(failing.invoke, '/repos/app', 'wt-1'), 'review_ready');
		assert.equal(await resolveStuckIntegration(failing.invoke, null, 'wt-1'), 'review_ready');
		assert.equal(failing.calls.length, 1, 'senza progetto non interroga Git');
	});

	it('all avvio nessuna corsia resta in integrating; le integrate vanno chiuse', async () => {
		const lanes = [
			{ projectId: 'p1', laneId: 'main', status: 'active', kind: 'git' as const },
			{ projectId: 'p1', laneId: 'wt-1', status: 'integrating', kind: 'git' as const },
			{ projectId: 'p1', laneId: 'wt-2', status: 'integrating', kind: 'git' as const },
			{ projectId: 'p2', laneId: 'wt-3', status: 'integrating', kind: 'git' as const },
			{ projectId: 'p1', laneId: 'lab-x', status: 'integrating', kind: 'lab' as const }
		];
		const { invoke } = mockInvoke({
			worktree_lane_integration_state: (args) => {
				const laneId = (args?.args as { laneId: string }).laneId;
				if (laneId === 'wt-2') throw new Error('git rotto');
				return { branchExists: true, integrated: laneId === 'wt-1' };
			}
		});
		const result = await recoverInterruptedIntegrations(
			lanes,
			(projectId) => (projectId === 'p1' ? '/repos/app' : null),
			invoke
		);
		assert.equal(result.changed, true);
		assert.deepEqual(
			result.lanes.map((lane) => `${lane.laneId}:${lane.status}`),
			['main:active', 'wt-1:review_ready', 'wt-2:review_ready', 'wt-3:review_ready', 'lab-x:integrating']
		);
		assert.deepEqual(result.integrated, [{ projectId: 'p1', laneId: 'wt-1' }]);

		const untouched = await recoverInterruptedIntegrations([lanes[0]], () => null, invoke);
		assert.equal(untouched.changed, false);
	});
});

describe('integrazione: conferma dopo conflitto', () => {
	it('lo stato conflict persistito chiede conferma anche senza il segno in memoria', () => {
		assert.equal(landingNeedsUserConfirm(false, 'conflict'), true);
		assert.equal(landingNeedsUserConfirm(true, 'review_ready'), true);
		assert.equal(landingNeedsUserConfirm(false, 'review_ready'), false);
	});
});

describe('lanes.json: scritture solo per campi persistiti', () => {
	it('lo stato dell agente non riscrive il file', () => {
		assert.equal(lanePatchTouchesPersistedFields({ agentState: 'working' }), false);
		assert.equal(lanePatchTouchesPersistedFields({ ptyId: 3 }), false);
		assert.equal(lanePatchTouchesPersistedFields({ agentState: 'idle', status: 'closed' }), true);
		assert.equal(lanePatchTouchesPersistedFields({ recoveryState: 'cleanup_pending' }), true);
	});
});

describe('lanes.json: record delle bozze Lab chiuse', () => {
	it('rimuove i record di una bozza la cui tessera non e aperta, lascia i progetti Git', () => {
		const draft = projectId('draft-p-20260101-abc123');
		const draftMain = laneRecordFromAgentLane(
			createMainLane(draft, null, 'gui', {
				kind: 'lab',
				labPrototypeId: 'p-20260101-abc123',
				workspacePath: workspacePath('/lab/p-20260101-abc123')
			})
		);
		const gitMain = laneRecordFromAgentLane(createMainLane(projectId('repo'), null, 'terminal'));
		const gitLane = { ...gitMain, laneId: laneId('wt-1'), origin: 'manual' as const };

		const closed = pruneClosedDraftLanes([gitMain, draftMain, gitLane], () => false);
		assert.equal(closed.changed, true);
		assert.deepEqual(
			closed.lanes.map((lane) => `${lane.projectId}/${lane.laneId}`),
			['repo/main', 'repo/wt-1']
		);

		const open = pruneClosedDraftLanes([gitMain, draftMain], (id) => id === draft);
		assert.equal(open.changed, false);
		assert.equal(open.lanes.length, 2);
	});
});
