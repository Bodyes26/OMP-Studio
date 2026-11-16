import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectStore } from '../src/lib/stores/projects.svelte.ts';
import type { DesktopHostSnapshot } from '../src/lib/backend/host.ts';
import { MAIN_LANE_ID } from '../src/lib/types/lanes.ts';

function snapshot(): DesktopHostSnapshot {
	const lane = {
		projectId: 'host-project',
		laneId: MAIN_LANE_ID,
		title: 'Principale',
		workspacePath: '/Users/other/dev/repo',
		branch: 'main',
		baseCommit: null,
		targetBranch: null,
		createdAt: null,
		status: 'active',
		origin: 'main',
		agentState: 'working',
		openFiles: [],
		activeFile: null,
		surface: 'chat',
		kind: 'git',
		labPrototypeId: null,
		adopted: false
	};
	return {
		version: 1,
		platform: 'macos',
		projectRoot: '/Users/other/dev',
		projects: [{
			id: 'host-project',
			name: 'repo',
			label: null,
			canonicalProjectPath: '/Users/other/dev/repo',
			hue: 200,
			colorMode: 'auto',
			lane,
			layout: { left: 260, center: 0.5, leftSection: 'files', editorOpen: true },
			lastOpened: 10,
			autoDispatch: false,
			taskDefaults: null,
			worktreeResumeChat: true,
			external: false
		}],
		lanes: [],
		tasks: [],
		sessions: [],
		state: {} as DesktopHostSnapshot['state']
	} as DesktopHostSnapshot;
}

describe('Progetti remoti in barra (R-MI-03/MI-04)', () => {
	beforeEach(() => {
		projectStore.projects = [];
		projectStore.activeId = null;
	});

	it('materializza i progetti dell altra macchina con machineId e id dell host', () => {
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', snapshot());
		const remote = projectStore.projects.find((p) => p.machineId === 'mac-1');
		assert.ok(remote);
		assert.equal(remote.hostProjectId, 'host-project');
		assert.equal(remote.canonicalProjectPath, '/Users/other/dev/repo');
		assert.equal(remote.lane.workspacePath, '/Users/other/dev/repo');
		assert.equal(remote.lane.agentState, 'working');
		assert.equal(projectStore.isRemote(remote), true);
		assert.equal(projectStore.localProjects.length, 0);
	});

	it('aggiorna senza duplicare e dimentica la macchina quando sparisce', () => {
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', snapshot());
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', snapshot());
		assert.equal(projectStore.projects.filter((p) => p.machineId === 'mac-1').length, 1);

		projectStore.syncRemoteProjects('pc-1', 'PC', snapshot());
		assert.equal(projectStore.projects.length, 2);

		projectStore.removeRemoteMachine('mac-1');
		assert.deepEqual(projectStore.projects.map((p) => p.machineId), ['pc-1']);
	});

	it('tiene le copie locali separate e fuori dalla persistenza', () => {
		projectStore.projects = [{
			id: 'local-project' as never,
			name: 'locale',
			label: null,
			canonicalProjectPath: '/dev/local' as never,
			hue: 0,
			colorMode: 'auto',
			lane: { ...snapshot().projects[0].lane, projectId: 'local-project' as never },
			layout: { left: 260, center: 0.5, leftSection: 'files', editorOpen: true },
			lastOpened: 0,
			autoDispatch: false,
			taskDefaults: null,
			worktreeResumeChat: true,
			external: false
		}];
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', snapshot());
		assert.equal(projectStore.localProjects.length, 1);
		assert.equal(projectStore.projects.length, 2);
		assert.equal(projectStore.isRemote(projectStore.projects[1]), true);
	});
});
