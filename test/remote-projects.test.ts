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

	/**
	 * Il percorso di un progetto remoto appartiene al sistema della macchina che
	 * lo possiede. Normalizzarlo con `isWindows` di chi guarda lo corrompeva: da
	 * Windows il Mac riceveva `\Users\other\dev\repo` e `omp` falliva con
	 * «No such file or directory», lasciando la chat in caricamento per sempre.
	 */
	it('conserva i percorsi POSIX di un host macOS anche se chi guarda e su Windows', () => {
		projectStore.syncRemoteProjects('mac-1', 'MacBook Air', snapshot());
		const remote = projectStore.projects[0];
		assert.equal(remote.canonicalProjectPath, '/Users/other/dev/repo');
		assert.equal(remote.lane.workspacePath, '/Users/other/dev/repo');
		assert.ok(!String(remote.canonicalProjectPath).includes('\\'));
		assert.ok(!String(remote.lane.workspacePath).includes('\\'));
	});

	it('normalizza invece con la semantica Windows quando l host e Windows', () => {
		const host = snapshot();
		host.platform = 'windows';
		host.projectRoot = 'C:/Users/other/source/repos';
		host.projects[0].canonicalProjectPath = 'C:/Users/other/source/repos/repo';
		host.projects[0].lane.workspacePath = 'C:/Users/other/source/repos/repo';
		projectStore.syncRemoteProjects('pc-1', 'PC ufficio', host);
		const remote = projectStore.projects[0];
		assert.equal(remote.canonicalProjectPath, 'C:\\Users\\other\\source\\repos\\repo');
		assert.equal(remote.lane.workspacePath, 'C:\\Users\\other\\source\\repos\\repo');
	});

	/**
	 * Le corsie di un progetto remoto sono della macchina che lo possiede
	 * (R-MI-06): la tessera le proietta con il proprio id, e le letture sul
	 * worktree di una corsia vanno a quella macchina, non al disco locale.
	 */
	it('proietta le corsie dell host e instrada i loro worktree alla sua macchina', () => {
		const host = snapshot();
		const main = { ...host.projects[0].lane };
		host.lanes = [main, { ...main, laneId: 'wt-1', title: 'Worktree 1', workspacePath: '/Users/other/dev/repo-wt-1', agentState: 'idle' }];
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', host);
		const remote = projectStore.projects[0];
		const lanes = projectStore.remoteLanes[remote.id];
		assert.deepEqual(lanes.map((lane) => [lane.projectId, lane.laneId]), [[remote.id, MAIN_LANE_ID], [remote.id, 'wt-1']]);
		assert.equal(projectStore.machineOfPath('/Users/other/dev/repo-wt-1'), 'mac-1');
		assert.equal(projectStore.machineOfPath('/Users/me/elsewhere'), 'local');
	});

	it('mantiene la corsia scelta dall utente ai riepiloghi successivi, con lo stato della Principale', () => {
		const host = snapshot();
		const main = { ...host.projects[0].lane };
		host.lanes = [main, { ...main, laneId: 'wt-1', title: 'Worktree 1', workspacePath: '/Users/other/dev/repo-wt-1', agentState: 'idle' }];
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', host);
		const remote = projectStore.projects[0];
		projectStore.setProjectLane(remote.id, projectStore.remoteLanes[remote.id][1]);
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', host);
		const after = projectStore.projects[0];
		assert.equal(after.lane.laneId, 'wt-1');
		assert.equal(after.lane.workspacePath, '/Users/other/dev/repo-wt-1');
		assert.equal(after.lane.agentState, 'working');
	});

	it('a macchina irraggiungibile la tessera non resta al lavoro', () => {
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', snapshot());
		assert.equal(projectStore.projects[0].lane.agentState, 'working');
		projectStore.markRemoteMachineOffline('mac-1');
		assert.equal(projectStore.projects[0].lane.agentState, 'unknown');
	});
});
