import { describe, expect, it } from 'bun:test';
import type { HostState, HostSummary, RemoteLane, RemoteProject, RemoteTask } from '../../src/protocol.ts';
import {
	decideGroupOpenTarget,
	deferredEntries,
	editTaskCopy,
	groupForProject,
	groupGlyph,
	groupProjects,
	machineOptions,
	mergedLanes,
	mergedTasks,
	proposedMachine,
	reachableCopies,
	runTaskCopy
} from '../src/multiMachine.ts';

function project(patch: Partial<RemoteProject> & { id: string }): RemoteProject {
	return {
		name: patch.id,
		hue: 200,
		active: true,
		lanes: [],
		attention: [],
		tasks: [],
		autoDispatch: false,
		canRunTask: true,
		runBlockReason: null,
		...patch
	};
}

function lane(id: string, state: 'idle' | 'working' | 'attention' = 'idle'): RemoteLane {
	return {
		id,
		title: id,
		kind: 'worktree',
		agent: {
			state,
			surface: null,
			provider: null,
			modelId: null,
			modelLabel: null,
			activity: null,
			headsUp: null
		}
	};
}

function task(patch: Partial<RemoteTask> & { id: string }): RemoteTask {
	return {
		status: 'queued',
		title: patch.id,
		prompt: patch.id,
		position: 0,
		resume: false,
		schedule: null,
		next: false,
		...patch
	};
}

function host(id: string, online: boolean, name = id): HostSummary {
	return {
		id,
		name,
		platform: 'macos',
		appVersion: '1.0.0',
		features: [],
		online,
		pairedAt: 0,
		lastSeenAt: null
	};
}

function state(projects: RemoteProject[], linkMachineId: string | null = null): HostState {
	return { projects, quota: null, linkMachineId };
}

const hosts = [host('h-mac', true, 'Mac'), host('h-pc', false, 'PC')];
const hostStates = {
	'h-mac': {
		state: state(
			[
				project({
					id: 'shared',
					name: 'Shared repo',
					identity: 'origin:acme/widgets',
					lastUsedAt: 500,
					lanes: [lane('main')],
					tasks: [task({ id: 't1', updatedAt: 10, machineId: null })]
				}),
				project({ id: 'only-mac', name: 'Only Mac', lanes: [lane('main')] })
			],
			'mac-machine'
		)
	},
	'h-pc': {
		state: state(
			[
				project({
					id: 'shared-pc',
					name: 'Shared repo',
					identity: 'origin:acme/widgets',
					lastUsedAt: 900,
					lanes: [lane('main', 'attention')],
					tasks: [task({ id: 't1', updatedAt: 20, machineId: 'pc-machine' })]
				})
			],
			'pc-machine'
		)
	}
};

describe('R-REM-17: un elenco solo, un progetto una volta sola', () => {
	it('unisce le copie con la stessa identity e lascia separate quelle senza', () => {
		const groups = groupProjects(hosts, hostStates);
		expect(groups).toHaveLength(2);
		const shared = groups.find((group) => group.identity === 'origin:acme/widgets');
		expect(shared?.copies).toHaveLength(2);
		expect(shared?.isShared).toBe(true);
		const solo = groups.find((group) => group.identity === null);
		expect(solo?.copies).toHaveLength(1);
	});

	it('una richiesta su una copia mette la riga in cima', () => {
		const groups = groupProjects(hosts, hostStates);
		expect(groups[0]?.identity).toBe('origin:acme/widgets');
		expect(groups[0]?.status).toBe('question');
	});

	it('il glifo dice quante macchine e quali sono raggiungibili', () => {
		const groups = groupProjects(hosts, hostStates);
		const shared = groups.find((group) => group.identity === 'origin:acme/widgets')!;
		// Il PC aspetta ma e' spento: la riga mostra in uso la copia del Mac in linea.
		expect(groupGlyph(shared)).toEqual({ kind: 'copies', copies: ['off', 'use'] });
		const solo = groups.find((group) => group.identity === null)!;
		expect(groupGlyph(solo)).toEqual({ kind: 'remote' });
	});

	it('senza identity le copie restano separate anche con lo stesso nome', () => {
		const noIdentity = {
			'h-mac': { state: state([project({ id: 'a', name: 'Same' })]) },
			'h-pc': { state: state([project({ id: 'b', name: 'Same' })]) }
		};
		expect(groupProjects(hosts, noIdentity)).toHaveLength(2);
	});
});

describe('R-REM-18: apertura ed espansione', () => {
	it('apre la copia che aspetta una risposta, non l’ultima usata', () => {
		const both = [host('h-mac', true, 'Mac'), host('h-pc', true, 'PC')];
		const shared = groupProjects(both, hostStates).find((group) => group.isShared)!;
		expect(decideGroupOpenTarget(shared)).toMatchObject({ action: 'chat', hostId: 'h-pc', laneId: 'main' });
	});

	it('una richiesta su una copia spenta non apre una chat irraggiungibile', () => {
		// Il Mac in linea non aspetta nulla ma ha un lavoro in coda: si espande.
		const shared = groupProjects(hosts, hostStates).find((group) => group.isShared)!;
		expect(decideGroupOpenTarget(shared).action).toBe('expand');
	});

	it('espande quando due copie aspettano entrambe (nessuna chat nasconde l’altra)', () => {
		const both = [host('h-mac', true, 'Mac'), host('h-pc', true, 'PC')];
		const base = groupProjects(both, hostStates).find((candidate) => candidate.isShared)!;
		const group = {
			...base,
			copies: base.copies.map((copy) => ({
				...copy,
				project: { ...copy.project, lanes: copy.project.lanes.map((entry) => lane(entry.id, 'attention')) }
			}))
		};
		expect(decideGroupOpenTarget(group)).toEqual({ action: 'expand' });
	});

	it('i rami di tutte le copie stanno insieme con la loro macchina', () => {
		const shared = groupProjects(hosts, hostStates).find((group) => group.isShared)!;
		const lanes = mergedLanes(shared);
		expect(lanes.map((entry) => entry.copy.hostName)).toEqual(['PC', 'Mac']);
	});
});

describe('R-REM-19: coda unica con la macchina del lavoro', () => {
	it('tiene la copia più recente di ogni lavoro', () => {
		const shared = groupProjects(hosts, hostStates).find((group) => group.isShared)!;
		const tasks = mergedTasks(shared);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]!.task.updatedAt).toBe(20);
		expect(tasks[0]!.task.machineId).toBe('pc-machine');
	});

	it('«Avvia» va alla macchina del lavoro, poi all’auto-avvio, poi all’ultima usata', () => {
		const shared = groupProjects(hosts, hostStates).find((group) => group.isShared)!;
		const pcTask = mergedTasks(shared)[0]!.task;
		expect(runTaskCopy(shared, pcTask).hostId).toBe('h-pc');

		const noMachine: RemoteTask = { ...pcTask, machineId: null };
		// Nessuna copia ha l'auto-avvio: vince l'ultima usata, il PC.
		expect(runTaskCopy(shared, noMachine).hostId).toBe('h-pc');

		const withAuto = {
			...shared,
			copies: shared.copies.map((copy) =>
				copy.hostId === 'h-mac' ? { ...copy, project: { ...copy.project, autoDispatch: true } } : copy
			)
		};
		expect(runTaskCopy(withAuto, noMachine).hostId).toBe('h-mac');
	});

	it('modifiche ed eliminazioni preferiscono la macchina del lavoro raggiungibile', () => {
		const shared = groupProjects(hosts, hostStates).find((group) => group.isShared)!;
		const pcTask = mergedTasks(shared)[0]!.task;
		// Il PC è spento: si scrive sulla copia del Mac, la replica porta la modifica.
		expect(editTaskCopy(shared, pcTask).hostId).toBe('h-mac');
	});
});

describe('R-REM-20: macchine proposte per un lavoro nuovo', () => {
	it('propone l’ultima usata raggiungibile', () => {
		const shared = groupProjects(hosts, hostStates).find((group) => group.isShared)!;
		expect(proposedMachine(shared)?.id).toBe('mac-machine');
	});

	it('elenca una voce per macchina con id del collegamento', () => {
		const shared = groupProjects(hosts, hostStates).find((group) => group.isShared)!;
		expect(machineOptions(shared).map((option) => option.id).sort()).toEqual([
			'mac-machine',
			'pc-machine'
		]);
	});

	it('su un progetto di una macchina sola non c’è scelta', () => {
		const solo = groupProjects(hosts, hostStates).find((group) => !group.isShared)!;
		expect(machineOptions(solo)).toHaveLength(1);
	});
});

describe('R-REM-21/R-REM-22: storico e macchina spenta', () => {
	it('interroga solo le copie raggiungibili', () => {
		const shared = groupProjects(hosts, hostStates).find((group) => group.isShared)!;
		expect(reachableCopies(shared).map((copy) => copy.hostId)).toEqual(['h-mac']);
	});

	it('elenca i lavori in attesa con la loro macchina', () => {
		const withDeferred: HostSummary[] = [
			{ ...hosts[0]!, deferred: [{ commandId: 'c1', projectId: 'only-mac', prompt: 'Nightly', createdAt: 1, deviceId: 'd' }] }
		];
		expect(deferredEntries(withDeferred)).toEqual([
			{ hostId: 'h-mac', hostName: 'Mac', commandId: 'c1', projectId: 'only-mac', prompt: 'Nightly', createdAt: 1 }
		]);
	});

	it('trova il gruppo che contiene una copia', () => {
		const group = groupForProject(hosts, hostStates, 'h-pc', 'shared-pc');
		expect(group?.identity).toBe('origin:acme/widgets');
	});
});
