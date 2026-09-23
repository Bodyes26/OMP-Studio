import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	canonicalProjectPath,
	createMainLane,
	laneId,
	projectId,
	workspacePath,
	type ProjectId
} from '../src/lib/types/lanes.ts';
import {
	laneRecordFromAgentLane,
	parseLaneStoreDocument,
	reconcileProjectLanes,
	serializeLaneStoreDocument,
	type LaneRecord,
	type WorktreeInfo
} from '../src/lib/stores/lanePersistence.ts';

const PROJECT_ID = projectId('project-1');

function secondaryLane(id: string, path: string): LaneRecord {
	return {
		projectId: PROJECT_ID,
		laneId: laneId(id),
		title: `Corsia ${id}`,
		workspacePath: workspacePath(path),
		branch: `omp/lane-${id}`,
		baseCommit: 'base-old',
		headCommit: 'head-old',
		targetBranch: 'main',
		createdAt: 100,
		status: 'review_ready',
		origin: 'manual',
		sessionId: `session-${id}`,
		agentState: 'working',
		openFiles: ['src/file.ts'],
		activeFile: 'src/file.ts',
		surface: 'gui',
		recoveryState: 'registered',
		archiveReason: null,
		archivedAt: null,
		recoveredAt: null
	};
}

function worktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
	return {
		worktreePath: '/repos/.omp-wt-app-lane-a',
		workspacePath: '/repos/.omp-wt-app-lane-a',
		commit: 'head-new',
		branch: 'omp/lane-lane-a',
		detached: false,
		isCurrent: false,
		managedByStudio: true,
		laneId: 'lane-a',
		baseCommit: 'base-new',
		targetBranch: 'develop',
		lockedReason: null,
		prunableReason: null,
		...overrides
	};
}

function mainLane(ownerProjectId: ProjectId = PROJECT_ID): LaneRecord {
	return laneRecordFromAgentLane(
		createMainLane(ownerProjectId, canonicalProjectPath('/repos/app'), 'terminal')
	);
}

describe('lanes.json: parser versionato', () => {
	it('preserva ordine, stato, workspace, sessione e profilo nel round-trip', () => {
		const lanes = [mainLane(), secondaryLane('lane-a', '/repos/old-a'), secondaryLane('lane-b', '/repos/old-b')];
		const profiles = [
			{
				projectId: PROJECT_ID,
				canonicalProjectPath: canonicalProjectPath('/repos/app'),
				detectedStacks: ['dotnet', 'node'] as const,
				restoreMode: 'package_reference' as const,
				manifests: ['Api/Api.csproj', 'package.json'],
				generatedDirectories: ['Api/bin', 'node_modules'],
				nativeCaches: [{ kind: 'nuget' as const, path: '/home/tizio/.nuget/packages', available: true }],
				untrackedFileAllowlist: ['Parametri.ini'],
				reviewedCandidates: ['Parametri.ini', '.env.local'],
				detectedAt: 120,
				confirmedAt: 123
			}
		];
		const document = serializeLaneStoreDocument(lanes, profiles, 7);
		const parsed = parseLaneStoreDocument(document);

		assert.ok(parsed);
		assert.equal(parsed.revision, 7);
		assert.deepEqual(parsed.lanes.map((lane) => lane.laneId), ['main', 'lane-a', 'lane-b']);
		assert.equal(parsed.lanes[1].status, 'review_ready');
		assert.equal(parsed.lanes[1].workspacePath, workspacePath('/repos/old-a'));
		assert.equal(parsed.lanes[1].sessionId, 'session-lane-a');
		assert.equal(parsed.lanes[1].agentState, 'unknown');
		assert.deepEqual(parsed.profiles[0].untrackedFileAllowlist, ['Parametri.ini']);
		assert.deepEqual(parsed.profiles[0].reviewedCandidates, ['Parametri.ini', '.env.local']);
		assert.equal(parsed.profiles[0].restoreMode, 'package_reference');
		assert.deepEqual(parsed.profiles[0].nativeCaches, [
			{ kind: 'nuget', path: '/home/tizio/.nuget/packages', available: true }
		]);
	});

	it('rilegge un profilo scritto prima del rilevamento stack con default neutri', () => {
		const document = serializeLaneStoreDocument([mainLane()], [], 3);
		const legacy = {
			...document,
			profiles: [
				{
					projectId: PROJECT_ID,
					canonicalProjectPath: '/repos/app',
					detectedStacks: ['aspnet'],
					untrackedFileAllowlist: ['Parametri.ini'],
					confirmedAt: 99
				}
			]
		};
		const parsed = parseLaneStoreDocument(legacy);

		assert.ok(parsed);
		assert.equal(parsed.profiles[0].restoreMode, 'none');
		assert.deepEqual(parsed.profiles[0].manifests, []);
		assert.deepEqual(parsed.profiles[0].reviewedCandidates, []);
		assert.equal(parsed.profiles[0].detectedAt, null);
		assert.equal(parsed.profiles[0].confirmedAt, 99);
	});

	it('rifiuta versioni future, record corrotti e identita duplicate senza migrazioni implicite', () => {
		const document = serializeLaneStoreDocument([mainLane()], [], 1);
		assert.equal(parseLaneStoreDocument({ ...document, schemaVersion: 2 }), null);
		assert.equal(
			parseLaneStoreDocument({ ...document, lanes: [{ ...document.lanes[0], status: 'missing' }] }),
			null
		);
		assert.equal(
			parseLaneStoreDocument({ ...document, lanes: [document.lanes[0], document.lanes[0]] }),
			null
		);
	});
});

describe('riconciliazione crash-safe con Git', () => {
	it('mantiene l ordine e archivia con causa un record il cui worktree e assente', () => {
		const main = mainLane();
		const stale = secondaryLane('lane-a', '/repos/stale');
		const other = secondaryLane('lane-b', '/repos/live');
		const result = reconcileProjectLanes(
			[main, stale, other],
			PROJECT_ID,
			[
				worktree({
					isCurrent: true,
					managedByStudio: false,
					laneId: null,
					workspacePath: '/repos/app',
					branch: 'main'
				}),
				worktree({ laneId: 'lane-b', workspacePath: '/repos/live' })
			],
			999
		);

		assert.deepEqual(result.lanes.map((lane) => lane.laneId), ['main', 'lane-a', 'lane-b']);
		assert.equal(result.lanes[1].status, 'archived');
		assert.equal(result.lanes[1].archiveReason, 'worktree_missing');
		assert.equal(result.lanes[1].archivedAt, 999);
		assert.equal(result.lanes[1].workspacePath, workspacePath('/repos/stale'));
	});

	it('recupera un worktree Studio orfano senza eliminare i record esistenti', () => {
		const known = secondaryLane('lane-a', '/repos/known');
		const result = reconcileProjectLanes(
			[mainLane(), known],
			PROJECT_ID,
			[
				worktree({
					isCurrent: true,
					managedByStudio: false,
					laneId: null,
					workspacePath: '/repos/app',
					branch: 'main'
				}),
				worktree({ laneId: 'lane-a', workspacePath: '/repos/known' }),
				worktree({
					laneId: 'lane-orphan',
					workspacePath: '/repos/recovered',
					branch: 'omp/lane-lane-orphan'
				})
			],
			500
		);

		assert.equal(result.lanes.length, 3);
		const recovered = result.lanes[2];
		assert.equal(recovered.laneId, 'lane-orphan');
		assert.equal(recovered.recoveryState, 'recovered');
		assert.equal(recovered.status, 'active');
		assert.equal(recovered.sessionId, null);
		assert.equal(recovered.workspacePath, workspacePath('/repos/recovered'));
		assert.equal(recovered.recoveredAt, 500);
	});

	it('fa prevalere Git per path, branch, HEAD, base e target', () => {
		const result = reconcileProjectLanes(
			[mainLane(), secondaryLane('lane-a', '/repos/stored')],
			PROJECT_ID,
			[worktree({ workspacePath: '/repos/from-git' })],
			1000
		);
		const lane = result.lanes[1];
		assert.equal(lane.workspacePath, workspacePath('/repos/from-git'));
		assert.equal(lane.branch, 'omp/lane-lane-a');
		assert.equal(lane.headCommit, 'head-new');
		assert.equal(lane.baseCommit, 'base-new');
		assert.equal(lane.targetBranch, 'develop');
	});

	it('tratta un record Git prunable come worktree mancante', () => {
		const result = reconcileProjectLanes(
			[mainLane(), secondaryLane('lane-a', '/repos/stale')],
			PROJECT_ID,
			[worktree({ prunableReason: 'gitdir file points to non-existent location' })],
			321
		);
		assert.equal(result.lanes[1].status, 'archived');
		assert.equal(result.lanes[1].archiveReason, 'worktree_missing');
	});
});
