/**
 * Lato Studio della Remote multi-macchina (R-REM-17..R-REM-24):
 * chiave di fusione pubblicata, campi macchina dei lavori, comandi riservati
 * alle istanze respinti dal canale del telefono.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	publishedProjectIdentity,
	repositoryIdentityOf
} from '../src/lib/stores/projectCopyIdentity.ts';
import { groupByRepository, identityKey } from '../src/lib/stores/projectIdentity.ts';
import { buildHostState } from '../src/lib/remote/projection.ts';
import type { BuildHostStateInput } from '../src/lib/remote/projection.ts';
import {
	handleRemoteCommand,
	type CommandContext,
	type RemoteCommandExecutor
} from '../src/lib/remote/commands.ts';
import { createTaskCommands, type TaskCommandDeps } from '../src/lib/remote/taskCommands.ts';
import type { RemoteCommandEvent } from '../src/lib/remote/bridge.ts';
import type { StudioTask } from '../src/lib/stores/tasks.svelte.ts';

describe('identita pubblicata delle copie (R-REM-17)', () => {
	it('due copie con lo stesso origin pubblicano la stessa chiave, in minuscolo', () => {
		const mac = { canonicalProjectPath: '/dev/omp', upstream: { repoSlug: 'Bodyes26/OMP-Studio' } };
		const pc = { canonicalProjectPath: 'C:/dev/omp', upstream: { repoSlug: 'bodyes26/omp-studio' } };
		assert.equal(publishedProjectIdentity(mac), 'origin:bodyes26/omp-studio');
		assert.equal(
			publishedProjectIdentity(pc),
			publishedProjectIdentity(mac),
			'il telefono fonde le stesse copie della barra'
		);
		assert.equal(
			identityKey(repositoryIdentityOf(mac)),
			identityKey(repositoryIdentityOf(pc))
		);
	});

	it('la rinomina unisce la copia rimasta col nome di prima (R-MI-32)', () => {
		assert.equal(
			publishedProjectIdentity({
				canonicalProjectPath: '/dev/vecchio',
				upstream: { repoSlug: 'bodyes26/vecchio' },
				canonicalSlug: 'bodyes26/nuovo',
				multiMachine: true
			}),
			'origin:bodyes26/nuovo'
		);
		// Senza il nome attuale resta il suo slug: nessuna fusione inventata.
		assert.equal(
			publishedProjectIdentity({
				canonicalProjectPath: '/dev/vecchio',
				upstream: { repoSlug: 'bodyes26/vecchio' }
			}),
			'origin:bodyes26/vecchio'
		);
	});

	it('senza origin il primo commit si pubblica solo dopo la conferma (R-MI-44)', () => {
		const copy = { canonicalProjectPath: '/dev/locale', upstream: { rootCommit: 'ABC123' } };
		assert.equal(
			publishedProjectIdentity({ ...copy, confirmedRoot: () => false }),
			null,
			'una radice non confermata non unisce nulla'
		);
		assert.equal(
			publishedProjectIdentity({ ...copy, confirmedRoot: () => true }),
			'root:abc123',
			'dopo la conferma la copia porta la chiave'
		);
		// La stessa regola della barra: non confermata resta una tessera a se'.
		const identity = repositoryIdentityOf(copy);
		assert.deepEqual(groupByRepository([identity, { ...identity }]), [[0], [1]]);
	});

	it('una copia senza origine ne primo commit non ha identita', () => {
		assert.equal(
			publishedProjectIdentity({ canonicalProjectPath: '/dev/nessuno', upstream: null }),
			null
		);
		assert.equal(publishedProjectIdentity({ canonicalProjectPath: null }), null);
	});
});

describe('istantanea pubblicata con le macchine (R-REM-19)', () => {
	function build(linkMachineId: string | null): BuildHostStateInput {
		const task: StudioTask = {
			id: 't1',
			projectPath: '/dev/p1',
			prompt: 'fai qualcosa',
			position: 0,
			createdAt: 1,
			updatedAt: 42,
			status: 'queued',
			machineId: 'local'
		};
		return {
			projects: [{
				id: 'p1',
				name: 'Project 1',
				canonicalProjectPath: '/dev/p1',
				identity: 'origin:bodyes26/omp-studio',
				lastUsedAt: 1700
			}],
			tasks: [task],
			linkMachineId
		};
	}

	it('pubblica chiave, ultimo uso e id del collegamento', () => {
		const state = buildHostState(build('mac-id'));
		assert.equal(state.linkMachineId, 'mac-id');
		assert.equal(state.projects[0].identity, 'origin:bodyes26/omp-studio');
		assert.equal(state.projects[0].lastUsedAt, 1700);
		assert.equal(state.projects[0].tasks[0].machineId, 'mac-id');
		assert.equal(state.projects[0].tasks[0].updatedAt, 42);
	});

	it('degrada senza collegamento: nessun id e nessuna macchina sul lavoro', () => {
		const state = buildHostState(build(null));
		assert.equal(state.linkMachineId, null);
		assert.equal(state.projects[0].tasks[0].machineId, null);
		assert.equal(state.projects[0].identity, 'origin:bodyes26/omp-studio', 'la chiave non dipende dal link');
	});

	it('il lavoro di un altra macchina pubblica il suo id, non local', () => {
		const input = build('mac-id');
		input.tasks = [{ ...input.tasks![0], machineId: 'pc-id' }];
		const state = buildHostState(input);
		assert.equal(state.projects[0].tasks[0].machineId, 'pc-id');
	});
});

describe('comandi riservati al collegamento fra computer (R-REM-24)', () => {
	const dummyDevice = { id: 'dev-1', name: 'iPhone' };

	function createContext(channel: 'phone' | 'desktop') {
		const results: Array<{ ok: boolean; error?: { code: string; message: string } }> = [];
		let touched = false;
		const unused = async (): Promise<never> => {
			touched = true;
			throw new Error('il comando riservato non deve arrivare all esecutore');
		};
		const executor = {
			runTask: unused,
			waitQuotaReset: unused,
			dismissQuotaBlocked: unused,
			createTask: unused,
			updateTask: unused,
			deleteTask: unused,
			moveTask: unused,
			getTask: unused,
			respondDispatch: unused,
			refreshQuota: unused,
			abort: unused,
			sendPrompt: unused,
			stageAttachment: unused,
			refreshContext: unused,
			compactContext: unused,
			getArtifact: unused,
			chatHistory: unused,
			listProjectFolders: unused,
			openProject: unused,
			createProject: unused,
			composerCatalog: unused,
			setLaneRole: unused,
			setLaneModel: unused,
			setLaneThinking: unused,
			listSessions: unused,
			sessionHistory: unused,
			markSessionSeen: unused,
			readQueue: unused,
			writeQueue: unused,
			laneAction: unused,
			closeProject: () => { touched = true; },
			setAutoDispatch: () => { touched = true; }
		} as unknown as RemoteCommandExecutor;
		const ctx: CommandContext = {
			isEnabled: () => true,
			findProject: (id) => (id === 'p1' ? { id: 'p1', name: 'Project 1', canonicalProjectPath: '/dev/p1' } : undefined),
			findTask: () => undefined,
			channel,
			executor,
			reportResult: async (_commandId, ok, error) => {
				results.push({ ok, error: error ? { code: error.code, message: error.message } : undefined });
			}
		};
		return { ctx, results, touched: () => touched };
	}

	const peerOnly: Array<RemoteCommandEvent['command']> = [
		{ kind: 'read_queue', projectPath: '/dev/p1' },
		{ kind: 'write_queue', projectPath: '/dev/p1', tasks: '{"tasks":[]}' },
		{ kind: 'lane_action', projectId: 'p1', action: { op: 'archive', laneId: 'l1', reason: 'prova' } },
		{ kind: 'close_project', projectId: 'p1' },
		{ kind: 'set_auto_dispatch', projectId: 'p1', enabled: true }
	];

	for (const command of peerOnly) {
		it(`il telefono rifiuta ${command.kind} senza effetti`, async () => {
			const { ctx, results, touched } = createContext('phone');
			await handleRemoteCommand({ commandId: 'c1', device: dummyDevice, command }, ctx);
			assert.equal(results.length, 1);
			assert.equal(results[0].ok, false);
			assert.equal(results[0].error?.code, 'unsupported');
			assert.equal(touched(), false, 'nessun effetto prima del rifiuto');
		});
	}

	it('il collegamento fra computer accetta gli stessi comandi', async () => {
		const { ctx, results, touched } = createContext('desktop');
		await handleRemoteCommand(
			{ commandId: 'c2', device: dummyDevice, command: { kind: 'set_auto_dispatch', projectId: 'p1', enabled: true } },
			ctx
		);
		assert.equal(touched(), true);
		// Il contesto di prova non ha `notify`: l'esito arriva comunque.
		assert.equal(results[0]?.error, undefined);
	});
});

describe('macchina scelta nei comandi dei lavori (R-REM-19)', () => {
	const now = 1_700_000_000_000;

	function createDeps() {
		const tasks = new Map<string, StudioTask>();
		tasks.set('task-1', {
			id: 'task-1',
			projectPath: '/dev/p1',
			prompt: 'prompt',
			position: 0,
			createdAt: now,
			updatedAt: now,
			status: 'queued'
		});
		const created: StudioTask[] = [];
		const deps: Partial<TaskCommandDeps> = {
			findProject: (id) => (id === 'p1' ? { id: 'p1', canonicalProjectPath: '/dev/p1' } : undefined),
			loadProject: async () => true,
			createTask: (projectPath) => {
				const task: StudioTask = {
					id: `new-${created.length + 1}`,
					projectPath,
					prompt: '',
					position: created.length,
					createdAt: now,
					updatedAt: now,
					status: 'queued'
				};
				tasks.set(task.id, task);
				created.push(task);
				return task;
			},
			taskById: (id) => tasks.get(id),
			tasksFor: (projectPath) => [...tasks.values()].filter((task) => task.projectPath === projectPath),
			updatePrompt: (id, prompt) => {
				const task = tasks.get(id);
				if (task) task.prompt = prompt;
			},
			updateTask: (id, prompt) => {
				const task = tasks.get(id);
				if (task) task.prompt = prompt;
			},
			deleteTask: (id) => tasks.delete(id),
			setTaskMachine: (id, machineId) => {
				const task = tasks.get(id);
				if (!task) return;
				if (machineId) task.machineId = machineId;
				else delete task.machineId;
			},
			setSchedule: () => undefined,
			moveTaskToIndex: () => undefined,
			buildResetSchedule: () => null,
			now: () => now,
			machines: () => ({ selfId: 'mac-id', peers: [{ id: 'pc-id', name: 'PC' }] })
		};
		return { deps, tasks, created };
	}

	it('create_task salva questa macchina come local', async () => {
		const { deps, tasks } = createDeps();
		const commands = createTaskCommands(deps);
		const result = await commands.createRemoteTask('p1', 'ciao', null, { machineId: 'mac-id' });
		assert.equal(tasks.get(result.taskId)?.machineId, 'local');
	});

	it('create_task salva una macchina collegata con il suo id', async () => {
		const { deps, tasks } = createDeps();
		const commands = createTaskCommands(deps);
		const result = await commands.createRemoteTask('p1', 'ciao', null, { machineId: 'pc-id' });
		assert.equal(tasks.get(result.taskId)?.machineId, 'pc-id');
	});

	it('create_task rifiuta una macchina sconosciuta senza lasciare il lavoro', async () => {
		const { deps, tasks, created } = createDeps();
		const commands = createTaskCommands(deps);
		await assert.rejects(
			commands.createRemoteTask('p1', 'ciao', null, { machineId: 'ghost' }),
			(error: { code?: string }) => error.code === 'rejected'
		);
		assert.equal(created.length, 0, 'nessun task creato per un id invalido');
		assert.equal([...tasks.values()].filter((task) => task.prompt === 'ciao').length, 0);
	});

	it('update_task azzera la macchina con null e la cambia con un peer', async () => {
		const { deps, tasks } = createDeps();
		const commands = createTaskCommands(deps);
		await commands.updateRemoteTask('p1', 'task-1', { options: { machineId: 'pc-id' } });
		assert.equal(tasks.get('task-1')?.machineId, 'pc-id');
		await commands.updateRemoteTask('p1', 'task-1', { options: { machineId: null } });
		assert.equal(tasks.get('task-1')?.machineId, undefined);
	});

	it('update_task rifiuta una macchina sconosciuta', async () => {
		const { deps, tasks } = createDeps();
		const commands = createTaskCommands(deps);
		await assert.rejects(
			commands.updateRemoteTask('p1', 'task-1', { options: { machineId: 'ghost' } }),
			(error: { code?: string }) => error.code === 'rejected'
		);
		assert.equal(tasks.get('task-1')?.machineId, undefined);
	});
});

describe('run_task di un lavoro di un altra macchina', () => {
	const dummyDevice = { id: 'dev-1', name: 'iPhone' };

	it('il telefono rifiuta e nomina la macchina giusta, senza avviare', async () => {
		let ran = false;
		const ctx: CommandContext = {
			isEnabled: () => true,
			findProject: () => ({ id: 'p1', name: 'Project 1', canonicalProjectPath: '/dev/p1' }),
			findTask: () => ({ id: 'task-1', projectPath: '/dev/p1', status: 'queued', machineId: 'pc-id' }),
			machineName: () => 'PC',
			executor: {
				runTask: async () => { ran = true; }
			} as unknown as RemoteCommandExecutor,
			reportResult: async (_id, ok, error) => {
				assert.equal(ok, false);
				assert.equal(error?.code, 'rejected');
				assert.match(error?.message ?? '', /PC/);
			}
		};
		await handleRemoteCommand(
			{ commandId: 'c1', device: dummyDevice, command: { kind: 'run_task', projectId: 'p1', taskId: 'task-1' } },
			ctx
		);
		assert.equal(ran, false, 'non deve partire sulla macchina sbagliata');
	});

	it('create_task con start verso un altra macchina non crea e non avvia', async () => {
		let created = false;
		let ran = false;
		const ctx: CommandContext = {
			isEnabled: () => true,
			findProject: () => ({ id: 'p1', name: 'Project 1', canonicalProjectPath: '/dev/p1' }),
			findTask: () => undefined,
			machineName: () => 'PC',
			executor: {
				createTask: async () => { created = true; return { taskId: 'x' }; },
				runTask: async () => { ran = true; }
			} as unknown as RemoteCommandExecutor,
			reportResult: async (_id, ok, error) => {
				assert.equal(ok, false);
				assert.equal(error?.code, 'rejected');
			}
		};
		await handleRemoteCommand({
			commandId: 'c5',
			device: dummyDevice,
			command: {
				kind: 'create_task',
				projectId: 'p1',
				prompt: 'ciao',
				schedule: null,
				options: { machineId: 'pc-id' },
				start: { destination: 'auto' }
			}
		}, ctx);
		assert.equal(created, false, 'il lavoro non deve nascere sulla macchina sbagliata');
		assert.equal(ran, false);
	});

	it('il lavoro senza macchina o con questa macchina parte', async () => {
		let runs = 0;
		const make = (machineId?: string): CommandContext => ({
			isEnabled: () => true,
			findProject: () => ({ id: 'p1', name: 'Project 1', canonicalProjectPath: '/dev/p1' }),
			findTask: () => ({ id: 'task-1', projectPath: '/dev/p1', status: 'queued', machineId }),
			selfMachineId: () => 'mac-id',
			executor: {
				runTask: async () => { runs += 1; }
			} as unknown as RemoteCommandExecutor,
			reportResult: async () => undefined
		});
		await handleRemoteCommand(
			{ commandId: 'c2', device: dummyDevice, command: { kind: 'run_task', projectId: 'p1', taskId: 'task-1' } },
			make(undefined)
		);
		await handleRemoteCommand(
			{ commandId: 'c3', device: dummyDevice, command: { kind: 'run_task', projectId: 'p1', taskId: 'task-1' } },
			make('local')
		);
		await handleRemoteCommand(
			{ commandId: 'c4', device: dummyDevice, command: { kind: 'run_task', projectId: 'p1', taskId: 'task-1' } },
			make('mac-id')
		);
		assert.equal(runs, 3);
	});
});
