import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleRemoteCommand, createRemotePromptResolver, taskBelongsToProject } from '../src/lib/remote/commands.ts';
import type { CommandContext, RemoteCommandExecutor } from '../src/lib/remote/commands.ts';
import type { RemoteCommandEvent } from '../src/lib/remote/bridge.ts';
import type { CommandError } from '$remote-protocol';
import { promptBus } from '../src/lib/agent/promptBus.ts';
import { RemoteStore } from '../src/lib/remote/remoteStore.svelte.ts';
import { remoteBridge } from '../src/lib/remote/bridge.ts';
describe('remote command handling', () => {
	const dummyDevice = { id: 'dev-1', name: 'iPhone' };

	type ContextOverrides = Omit<Partial<CommandContext>, 'executor'> & {
		executor?: Partial<RemoteCommandExecutor>;
	};

	function createContext({ executor: executorOverrides, ...overrides }: ContextOverrides = {}): {
		ctx: CommandContext;
		results: Array<{ commandId: string; ok: boolean; error?: CommandError; data?: unknown }>;
		notifications: Array<{ deviceName: string; projectName: string; kind: string }>;
	} {
		const results: Array<{ commandId: string; ok: boolean; error?: CommandError; data?: unknown }> = [];
		const notifications: Array<{ deviceName: string; projectName: string; kind: string }> = [];
		const unused = async (): Promise<never> => {
			throw new Error('esecutore non previsto dal test');
		};

		const executor: RemoteCommandExecutor = {
			runTask: async () => {},
			waitQuotaReset: async () => {},
			dismissQuotaBlocked: async () => {},
			createTask: unused,
			updateTask: unused,
			deleteTask: unused,
			moveTask: unused,
			abort: unused,
			sendPrompt: unused,
			chatHistory: unused,
			listProjectFolders: unused,
			openProject: unused,
			createProject: unused,
			newSession: unused,
			composerCatalog: unused,
			setLaneRole: unused,
			setLaneModel: unused,
			setLaneThinking: unused,
			stageAttachment: unused,
			refreshContext: unused,
			compactContext: unused,
			listSessions: unused,
			sessionHistory: unused,
			createLane: unused,
			markSessionSeen: unused,
			...executorOverrides
		};

		const ctx: CommandContext = {
			isEnabled: () => true,
			findProject: (id) => (id === 'p1' ? { id: 'p1', name: 'Project 1', canonicalProjectPath: '/dev/p1' } : undefined),
			findTask: (id) => (id === 't1' ? { id: 't1', projectPath: '/dev/p1', status: 'queued' } : undefined),
			executor,
			resolvePrompt: async () => true,
			reportResult: async (commandId, ok, error, data) => {
				results.push({ commandId, ok, error, data });
			},
			notify: (dev, proj, kind) => {
				notifications.push({ deviceName: dev.name, projectName: proj.name, kind });
			},
			...overrides
		};

		return { ctx, results, notifications };
	}

	it('rejects command with disabled when remote control is turned off', async () => {
		const { ctx, results } = createContext({ isEnabled: () => false });
		const event: RemoteCommandEvent = {
			commandId: 'cmd-1',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'disabled');
	});

	it('rejects command with not_found when project is unknown', async () => {
		const { ctx, results } = createContext();
		const event: RemoteCommandEvent = {
			commandId: 'cmd-2',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'unknown-project', taskId: 't1' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'not_found');
	});

	it('rejects run_task with not_found when task is unknown', async () => {
		const { ctx, results } = createContext();
		const event: RemoteCommandEvent = {
			commandId: 'cmd-3',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'p1', taskId: 'unknown-task' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'not_found');
	});

	it('rejects respond_ui with not_found when prompt request is not pending', async () => {
		const { ctx, results } = createContext({ resolvePrompt: async () => false });
		const event: RemoteCommandEvent = {
			commandId: 'cmd-4',
			device: dummyDevice,
			command: {
				kind: 'respond_ui',
				projectId: 'p1',
				laneId: null,
				requestId: 'req-unknown',
				answer: { action: 'confirm', confirmed: true }
			}
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'not_found');
	});

	it('executes run_task successfully and reports ok with notification', async () => {
		let ranTaskId = '';
		const { ctx, results, notifications } = createContext({
			executor: {
				runTask: async (_p, t) => {
					ranTaskId = t;
				},
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {}
			}
		});

		const event: RemoteCommandEvent = {
			commandId: 'cmd-5',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(ranTaskId, 't1');
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, true);
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].deviceName, 'iPhone');
		assert.equal(notifications[0].kind, 'run_task');
	});

	it('handles executor failures and reports failed error code', async () => {
		const { ctx, results } = createContext({
			executor: {
				runTask: async () => {
					throw new Error('Disk full');
				},
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {}
			}
		});

		const event: RemoteCommandEvent = {
			commandId: 'cmd-6',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'failed');
		assert.match(results[0].error?.message ?? '', /Disk full/);
	});

	it('rejects run_task with not_found when task belongs to another project and does not dispatch', async () => {
		let runTaskCalled = false;
		const { ctx, results } = createContext({
			findTask: (id) => (id === 't-other' ? { id: 't-other', projectPath: '/dev/other-project', status: 'queued' } : undefined),
			executor: {
				runTask: async () => {
					runTaskCalled = true;
				},
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {}
			}
		});

		const event: RemoteCommandEvent = {
			commandId: 'cmd-cross',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't-other' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(runTaskCalled, false);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'not_found');
		assert.match(results[0].error?.message ?? '', /non appartiene al progetto/);
	});

	it('rejects run_task with rejected when task is not queued', async () => {
		let runTaskCalled = false;
		const { ctx, results } = createContext({
			findTask: (id) => (id === 't-running' ? { id: 't-running', projectPath: '/dev/p1', status: 'in_progress' } : undefined),
			executor: {
				runTask: async () => {
					runTaskCalled = true;
				},
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {}
			}
		});

		const event: RemoteCommandEvent = {
			commandId: 'cmd-not-queued',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't-running' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(runTaskCalled, false);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'rejected');
		assert.match(results[0].error?.message ?? '', /non e' in coda/);
	});

	it('maps handler outcome blocked to rejected with reason', async () => {
		const { ctx, results } = createContext({
			executor: {
				runTask: async () => ({ kind: 'blocked', reason: 'Principale occupata' }),
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {}
			}
		});

		const event: RemoteCommandEvent = {
			commandId: 'cmd-blocked',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'rejected');
		assert.equal(results[0].error?.message, 'Principale occupata');
	});

	it('maps handler outcome needs_confirmation to rejected with machine confirmation message', async () => {
		const { ctx, results } = createContext({
			executor: {
				runTask: async () => ({ kind: 'needs_confirmation', message: 'Conferma richiesta sulla macchina' }),
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {}
			}
		});

		const event: RemoteCommandEvent = {
			commandId: 'cmd-confirm',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'rejected');
		assert.match(results[0].error?.message ?? '', /macchina/);
	});

	it('maps handler outcome failed to failed error code', async () => {
		const { ctx, results } = createContext({
			executor: {
				runTask: async () => ({ kind: 'failed', message: 'Creazione worktree fallita' }),
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {}
			}
		});

		const event: RemoteCommandEvent = {
			commandId: 'cmd-failed-outcome',
			device: dummyDevice,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		};

		await handleRemoteCommand(event, ctx);
		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'failed');
		assert.equal(results[0].error?.message, 'Creazione worktree fallita');
	});

	it('stale requestId with another single pending prompt reports not_found and leaves other prompt untouched', async () => {
		const reqB = promptBus.registerRequest({
			requestId: 'prompt-B-test',
			projectId: 'p1',
			title: 'Domanda B'
		});
		assert.equal(promptBus.hasPending('prompt-B-test'), true);

		const resolvePrompt = createRemotePromptResolver();
		const { ctx, results } = createContext({ resolvePrompt });

		const event: RemoteCommandEvent = {
			commandId: 'cmd-stale',
			device: dummyDevice,
			command: {
				kind: 'respond_ui',
				projectId: 'p1',
				laneId: null,
				requestId: 'prompt-A-stale',
				answer: { action: 'confirm', confirmed: true }
			}
		};

		await handleRemoteCommand(event, ctx);

		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'not_found');
		assert.equal(promptBus.hasPending('prompt-B-test'), true);
		const promptB = promptBus.getRequest('prompt-B-test');
		assert.equal(promptB?.status, 'pending');

		await promptBus.cancelRequest('prompt-B-test');
	});

	it('respond_ui returns not_found when request exists but belongs to a different lane', async () => {
		const reqMain = promptBus.registerRequest({
			requestId: 'prompt-main-lane',
			projectId: 'p1',
			laneId: 'main',
			title: 'Domanda Principale'
		});

		const resolvePrompt = createRemotePromptResolver();
		const { ctx, results } = createContext({ resolvePrompt });

		// Il comando indica la corsia 'feat-x', mentre la richiesta e' su 'main'
		const event: RemoteCommandEvent = {
			commandId: 'cmd-lane-mismatch',
			device: dummyDevice,
			command: {
				kind: 'respond_ui',
				projectId: 'p1',
				laneId: 'feat-x',
				requestId: 'prompt-main-lane',
				answer: { action: 'confirm', confirmed: true }
			}
		};

		await handleRemoteCommand(event, ctx);

		assert.equal(results.length, 1);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].error?.code, 'not_found');
		assert.equal(promptBus.hasPending('prompt-main-lane'), true);

		await promptBus.cancelRequest('prompt-main-lane');
	});
	it('taskBelongsToProject correctly matches id and canonicalProjectPath across formats', () => {
		const project = { id: 'p1', name: 'Project 1', canonicalProjectPath: '/Users/dev/OMP-Studio' };

		// Corrispondenza per ID
		assert.equal(taskBelongsToProject({ id: 't1', projectPath: 'p1' }, project), true);

		// Corrispondenza per percorso canonico identico
		assert.equal(taskBelongsToProject({ id: 't1', projectPath: '/Users/dev/OMP-Studio' }, project), true);

		// Corrispondenza con trailing slash o maiuscole/minuscole
		assert.equal(taskBelongsToProject({ id: 't1', projectPath: '/users/dev/omp-studio/' }, project), true);

		// Corrispondenza con separatori Windows
		assert.equal(taskBelongsToProject({ id: 't1', projectPath: '\\Users\\dev\\OMP-Studio' }, project), true);

		// Percorso differente
		assert.equal(taskBelongsToProject({ id: 't1', projectPath: '/other/path' }, project), false);

		// Senza percorso
		assert.equal(taskBelongsToProject({ id: 't1' }, project), false);
	});
});

describe('RemoteStore lifecycle', () => {
	it('destroy during init leaves no listener', async () => {
		let unlistenCalled = false;
		const unlistenFn = () => {
			unlistenCalled = true;
		};
		const statusResolvers = Promise.withResolvers<null>();
		const onStatusCalled = Promise.withResolvers<void>();
		const onStatusResolvers = Promise.withResolvers<void>();

		const mockBridge = {
			...remoteBridge,
			status: () => statusResolvers.promise,
			onStatus: () => {
				onStatusCalled.resolve();
				return onStatusResolvers.promise.then(() => unlistenFn);
			}
		};

		const store = new RemoteStore(mockBridge);
		const initPromise = store.init();

		// Risolvi status() affinche' init() arrivi alla registrazione onStatus()
		statusResolvers.resolve(null);
		await onStatusCalled.promise;

		// Distruggi lo store mentre onStatus() e' in volo
		store.destroy();

		// Risolvi onStatus() asincrono
		onStatusResolvers.resolve();
		await initPromise;

		// L'ascoltatore deve essere stato disiscritto immediatamente
		assert.equal(unlistenCalled, true);
	});
});
