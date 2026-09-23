/**
 * W11 Contract Test: proprieta' dei processi di corsia e cleanup sicuro.
 *
 * Difende le invarianti del Gate R27 / PLAN W11:
 * 1. I processi sono attribuiti alla corsia che li ha avviati: l'indicatore di
 *    una corsia non conta mai i processi di un'altra.
 * 2. L'arresto di una corsia ha come bersaglio solo cio' che quella corsia
 *    possiede: Principale e le altre corsie restano intatte.
 * 3. Un cleanup rifiutato per processi attivi non archivia nulla.
 * 4. Un cleanup fallito per lock di Windows lascia la corsia recuperabile
 *    (`cleanup_pending`), mai archiviata per finta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	classifyWorktreeRemovalError,
	describeLaneProcess,
	indexLaneProcesses,
	laneProcessKey,
	laneProcessesFor,
	partitionStopScope,
	type LaneProcessInfo
} from '../src/lib/lanes/processSupervisor.ts';
import {
	parseLaneStoreDocument,
	serializeLaneStoreDocument,
	type LaneRecord
} from '../src/lib/stores/lanePersistence.ts';
import {
	laneId,
	projectId,
	workspacePath
} from '../src/lib/types/lanes.ts';

function laneProcess(overrides: Partial<LaneProcessInfo> = {}): LaneProcessInfo {
	return {
		kind: 'terminal',
		ownerId: 1,
		projectId: 'proj-1',
		laneId: 'main',
		workspaceRoot: 'C:/repos/progetto',
		pid: 1234,
		label: 'Terminale',
		startedAtMs: 1_000,
		...overrides
	};
}

function laneRecord(overrides: Partial<LaneRecord> = {}): LaneRecord {
	return {
		projectId: projectId('proj-1'),
		laneId: laneId('wt-1'),
		title: 'Worktree 1',
		workspacePath: workspacePath('C:/repos/.omp-wt-progetto-wt-1'),
		branch: 'omp/lane-wt-1',
		baseCommit: 'abc123',
		targetBranch: 'main',
		createdAt: 10,
		status: 'active',
		origin: 'manual',
		agentState: 'idle',
		openFiles: [],
		activeFile: null,
		surface: 'terminal',
		sessionId: null,
		headCommit: 'abc123',
		recoveryState: 'registered',
		archiveReason: null,
		archivedAt: null,
		recoveredAt: null,
		...overrides
	};
}

describe('W11 - processi di corsia', () => {
	it('attribuisce i processi alla corsia che li ha avviati', () => {
		const processes = [
			laneProcess({ ownerId: 1, laneId: 'main' }),
			laneProcess({ ownerId: 2, laneId: 'wt-1', kind: 'agent', label: 'Agente' }),
			laneProcess({ ownerId: 3, laneId: 'wt-1', pid: 5678 }),
			laneProcess({ ownerId: 4, projectId: 'proj-2', laneId: 'wt-1' })
		];

		const index = indexLaneProcesses(processes);
		assert.equal(index.get(laneProcessKey('proj-1', 'main'))?.length, 1);
		assert.equal(index.get(laneProcessKey('proj-1', 'wt-1'))?.length, 2);
		// Progetti diversi non si sommano mai, nemmeno con lo stesso laneId.
		assert.equal(index.get(laneProcessKey('proj-2', 'wt-1'))?.length, 1);

		assert.deepEqual(
			laneProcessesFor(processes, 'proj-1', 'wt-1').map((process) => process.ownerId),
			[2, 3]
		);
		assert.equal(describeLaneProcess(processes[2]), 'Terminale (PID 5678)');
		assert.equal(describeLaneProcess(laneProcess({ pid: null })), 'Terminale');
	});

	it('limita l arresto alla sola corsia bersaglio', () => {
		const processes = [
			laneProcess({ ownerId: 1, laneId: 'main' }),
			laneProcess({ ownerId: 2, laneId: 'wt-1' }),
			laneProcess({ ownerId: 3, laneId: 'wt-2' }),
			laneProcess({ ownerId: 4, projectId: 'proj-2', laneId: 'wt-1' })
		];

		const { targets, preserved } = partitionStopScope(processes, 'proj-1', 'wt-1');
		assert.deepEqual(
			targets.map((process) => process.ownerId),
			[2]
		);
		// Principale, l'altra corsia e l'altro progetto non vengono toccati.
		assert.deepEqual(
			preserved.map((process) => process.ownerId),
			[1, 3, 4]
		);
	});

	it('distingue processi attivi da ogni altro cleanup bloccato', () => {
		const active = classifyWorktreeRemovalError({
			code: 'processes_active',
			message: 'Il worktree ha processi attivi avviati da Studio e non verra rimosso',
			detail: 'Terminale (PID 4242)'
		});
		assert.equal(active.failure, 'processes-active');
		assert.equal(active.detail, 'Terminale (PID 4242)');

		// Ogni altro errore resta recuperabile, compresi percorso non
		// verificabile e worktree non riconosciuto: nessun falso archived.
		for (const code of [
			'worktree_in_use',
			'worktree_locked',
			'metadata_cleanup_failed',
			'dirty_worktree',
			'invalid_path',
			'unmanaged_worktree',
			'not_git_repository'
		]) {
			assert.equal(
				classifyWorktreeRemovalError({ code, message: 'no' }).failure,
				'cleanup-pending',
				`codice ${code}`
			);
		}

		// Errore non tipizzato: prudenza, la corsia resta viva.
		const raw = classifyWorktreeRemovalError(new Error('crash del backend'));
		assert.equal(raw.failure, 'cleanup-pending');
		assert.equal(raw.message, 'crash del backend');
	});

	it('persiste cleanup_pending come stato recuperabile della corsia', () => {
		const pending = laneRecord({ recoveryState: 'cleanup_pending' });
		const document = serializeLaneStoreDocument([pending], [], 7);
		const parsed = parseLaneStoreDocument(document);
		assert.ok(parsed);
		assert.equal(parsed.lanes[0].recoveryState, 'cleanup_pending');
		// Recuperabile significa non archiviata: nessuna bugia sullo stato reale.
		assert.equal(parsed.lanes[0].status, 'active');
		assert.equal(parsed.lanes[0].archiveReason, null);
		assert.equal(parsed.lanes[0].archivedAt, null);
		assert.equal(
			parsed.lanes[0].workspacePath,
			workspacePath('C:/repos/.omp-wt-progetto-wt-1')
		);
	});
});
