import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	createTaskCommands,
	type TaskCommandDeps
} from '../src/lib/remote/taskCommands.ts';
import { handleRemoteCommand, type CommandContext, type RemoteCommandExecutor } from '../src/lib/remote/commands.ts';
import type { RemoteCommandEvent } from '../src/lib/remote/bridge.ts';
import type { StudioTask, TaskSchedule } from '../src/lib/stores/tasks.svelte.ts';

describe('remote task commands (R5)', () => {
	const dummyDevice = { id: 'dev-1', name: 'iPhone' };

	function createMockTask(overrides?: Partial<StudioTask>): StudioTask {
		return {
			id: 'task-1',
			projectPath: '/test/proj',
			prompt: 'Initial prompt',
			images: [],
			position: 0,
			createdAt: 1000,
			updatedAt: 1000,
			status: 'queued',
			options: { role: 'default' },
			...overrides
		};
	}

	function createMockDeps(overrides?: Partial<TaskCommandDeps>) {
		const tasks = new Map<string, StudioTask>();
		const defaultTask = createMockTask();
		tasks.set(defaultTask.id, defaultTask);

		let deletedId: string | null = null;
		let movedTo: { id: string; toIndex: number } | null = null;
		let requestedTitleId: string | null = null;
		const fixedNow = 1_700_000_000_000;

		const deps: TaskCommandDeps = {
			findProject: (id) =>
				id === 'p1' ? { id: 'p1', canonicalProjectPath: '/test/proj' } : undefined,
			loadProject: async () => true,
			createTask: (projectPath) => {
				const newTask: StudioTask = {
					id: `task-${tasks.size + 1}`,
					projectPath,
					prompt: '',
					images: [],
					position: tasks.size,
					createdAt: fixedNow,
					updatedAt: fixedNow,
					status: 'queued',
					options: { role: 'default' }
				};
				tasks.set(newTask.id, newTask);
				return newTask;
			},
			taskById: (id) => tasks.get(id),
			tasksFor: (projectPath) =>
				Array.from(tasks.values()).filter((t) => t.projectPath === projectPath),
			updatePrompt: (id, prompt) => {
				const t = tasks.get(id);
				if (t) {
					t.prompt = prompt;
					t.updatedAt = fixedNow;
				}
			},
			deleteTask: (id) => {
				deletedId = id;
				tasks.delete(id);
			},
			setSchedule: (id, schedule) => {
				const t = tasks.get(id);
				if (t) {
					if (schedule) t.schedule = { ...schedule };
					else delete t.schedule;
				}
			},
			moveTaskToIndex: (id, toIndex) => {
				movedTo = { id, toIndex };
			},
			buildResetSchedule: (task) => {
				if (task.options?.role === 'no-provider') return null;
				return {
					kind: 'reset',
					provider: 'anthropic',
					origin: 'user',
					setAt: fixedNow
				};
			},
			requestTaskTitle: (id) => {
				requestedTitleId = id;
			},
			now: () => fixedNow,
			...overrides
		};

		return {
			deps,
			commands: createTaskCommands(deps),
			tasks,
			getDeletedId: () => deletedId,
			getMovedTo: () => movedTo,
			getRequestedTitleId: () => requestedTitleId,
			fixedNow
		};
	}

	describe('createRemoteTask', () => {
		it('rejects empty or whitespace-only prompt', async () => {
			const { commands } = createMockDeps();
			await assert.rejects(
				() => commands.createRemoteTask('p1', '   ', null),
				/Prompt vuoto/
			);
		});

		it('rejects prompt exceeding 20000 characters', async () => {
			const { commands } = createMockDeps();
			const longPrompt = 'a'.repeat(20_001);
			await assert.rejects(
				() => commands.createRemoteTask('p1', longPrompt, null),
				/Prompt troppo lungo/
			);
		});

		it('rejects non-string prompt', async () => {
			const { commands } = createMockDeps();
			await assert.rejects(
				() => commands.createRemoteTask('p1', null as unknown as string, null),
				/Prompt non valido/
			);
		});

		it('rejects when project is not found', async () => {
			const { commands } = createMockDeps();
			await assert.rejects(
				() => commands.createRemoteTask('unknown-project', 'Valid prompt', null),
				/Progetto "unknown-project" non trovato/
			);
		});

		it('creates task and updates prompt and requests title', async () => {
			const { commands, tasks, getRequestedTitleId } = createMockDeps();
			const result = await commands.createRemoteTask('p1', 'Implement feature X', null);

			assert.ok(result.taskId);
			const created = tasks.get(result.taskId);
			assert.ok(created);
			assert.equal(created.prompt, 'Implement feature X');
			assert.equal(created.status, 'queued');
			assert.equal(getRequestedTitleId(), result.taskId);
		});

		it('creates task with valid at schedule', async () => {
			const { commands, tasks, fixedNow } = createMockDeps();
			const futureTime = fixedNow + 3600_000;
			const result = await commands.createRemoteTask(
				'p1',
				'Scheduled task',
				{ kind: 'at', notBefore: futureTime }
			);

			const created = tasks.get(result.taskId);
			assert.ok(created);
			assert.equal(created?.schedule?.kind, 'at');
			assert.equal(created?.schedule?.notBefore, futureTime);
		});

		it('rejects at schedule in the past', async () => {
			const { commands, fixedNow } = createMockDeps();
			const pastTime = fixedNow - 120_000;
			await assert.rejects(
				() =>
					commands.createRemoteTask(
						'p1',
						'Past task',
						{ kind: 'at', notBefore: pastTime }
					),
				/nel passato/
			);
		});

		it('rejects at schedule too far in the future', async () => {
			const { commands, fixedNow } = createMockDeps();
			const absurdFuture = fixedNow + 400 * 24 * 3600 * 1000;
			await assert.rejects(
				() =>
					commands.createRemoteTask(
						'p1',
						'Future task',
						{ kind: 'at', notBefore: absurdFuture }
					),
				/troppo lontano nel futuro/
			);
		});

		it('creates task with reset schedule', async () => {
			const { commands, tasks } = createMockDeps();
			const result = await commands.createRemoteTask(
				'p1',
				'Reset task',
				{ kind: 'reset' }
			);

			const created = tasks.get(result.taskId);
			assert.ok(created);
			assert.equal(created?.schedule?.kind, 'reset');
			assert.equal(created?.schedule?.provider, 'anthropic');
		});

		it('rolls back task creation if reset provider resolution fails', async () => {
			const { commands, tasks } = createMockDeps({
				createTask: (projectPath) => {
					const newTask = createMockTask({
						id: 'task-no-provider',
						projectPath,
						options: { role: 'no-provider' }
					});
					tasks.set(newTask.id, newTask);
					return newTask;
				}
			});

			await assert.rejects(
				() =>
					commands.createRemoteTask(
						'p1',
						'Reset task without provider',
						{ kind: 'reset' }
					),
				/Nessun provider di quota configurato/
			);

			assert.equal(tasks.has('task-no-provider'), false);
		});
	});

	describe('updateRemoteTask', () => {
		it('rejects unknown task with not_found', async () => {
			const { commands } = createMockDeps();
			await assert.rejects(
				() => commands.updateRemoteTask('p1', 'nonexistent', { prompt: 'new text' }),
				/non trovato/
			);
		});

		it('rejects empty prompt on update', async () => {
			const { commands } = createMockDeps();
			await assert.rejects(
				() => commands.updateRemoteTask('p1', 'task-1', { prompt: '   ' }),
				/Prompt vuoto/
			);
		});

		it('updates prompt and requests title when prompt changed', async () => {
			const { commands, tasks, getRequestedTitleId } = createMockDeps();
			await commands.updateRemoteTask('p1', 'task-1', { prompt: 'Updated text' });

			const task = tasks.get('task-1');
			assert.equal(task?.prompt, 'Updated text');
			assert.equal(getRequestedTitleId(), 'task-1');
		});

		it('does not re-request title when prompt is unchanged', async () => {
			const { commands, getRequestedTitleId } = createMockDeps();
			await commands.updateRemoteTask('p1', 'task-1', { prompt: 'Initial prompt' });

			assert.equal(getRequestedTitleId(), null);
		});

		it('removes schedule when schedule is null', async () => {
			const { commands, tasks } = createMockDeps();
			const task = tasks.get('task-1')!;
			task.schedule = { kind: 'reset', provider: 'test', origin: 'user', setAt: 1000 };

			await commands.updateRemoteTask('p1', 'task-1', { schedule: null });
		});

		it('updates schedule to at time', async () => {
			const { commands, tasks, fixedNow } = createMockDeps();
			const future = fixedNow + 1800_000;
			await commands.updateRemoteTask(
				'p1',
				'task-1',
				{ schedule: { kind: 'at', notBefore: future } }
			);

			const task = tasks.get('task-1');
			assert.equal(task?.schedule?.kind, 'at');
			assert.equal(task?.schedule?.notBefore, future);
		});
	});

	describe('deleteRemoteTask', () => {
		it('rejects unknown task with not_found', async () => {
			const { commands } = createMockDeps();
			await assert.rejects(
				() => commands.deleteRemoteTask('p1', 'nonexistent'),
				/non trovato/
			);
		});

		it('deletes existing task', async () => {
			const { commands, tasks, getDeletedId } = createMockDeps();
			await commands.deleteRemoteTask('p1', 'task-1');

			assert.equal(getDeletedId(), 'task-1');
			assert.equal(tasks.has('task-1'), false);
		});
	});

	describe('moveRemoteTask', () => {
		it('rejects invalid toIndex (NaN, float, string)', async () => {
			const { commands } = createMockDeps();
			await assert.rejects(
				() => commands.moveRemoteTask('p1', 'task-1', 1.5),
				/Indice di destinazione non valido/
			);
			await assert.rejects(
				() => commands.moveRemoteTask('p1', 'task-1', NaN),
				/Indice di destinazione non valido/
			);
		});

		it('rejects unknown task with not_found', async () => {
			const { commands } = createMockDeps();
			await assert.rejects(
				() => commands.moveRemoteTask('p1', 'nonexistent', 0),
				/non trovato/
			);
		});

		it('calls moveTaskToIndex with target index', async () => {
			const { commands, getMovedTo } = createMockDeps();
			await commands.moveRemoteTask('p1', 'task-1', 2);

			const moved = getMovedTo();
			assert.deepEqual(moved, { id: 'task-1', toIndex: 2 });
		});
	});

	describe('handleRemoteCommand integration for tasks', () => {
		it('handles create_task through handleRemoteCommand', async () => {
			let createdPrompt = '';
			const executor: Partial<RemoteCommandExecutor> = {
				runTask: async () => {},
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {},
				createTask: async (_pId, prompt) => {
					createdPrompt = prompt;
					return { taskId: 't-new' };
				}
			};

			const results: Array<{ commandId: string; ok: boolean; data?: unknown }> = [];
			const ctx: CommandContext = {
				isEnabled: () => true,
				findProject: () => ({ id: 'p1', name: 'Proj 1', canonicalProjectPath: '/dev/p1' }),
				findTask: () => undefined,
				executor: executor as RemoteCommandExecutor,
				reportResult: async (commandId, ok, _err, data) => {
					results.push({ commandId, ok, data });
				}
			};

			const event: RemoteCommandEvent = {
				commandId: 'cmd-create',
				device: dummyDevice,
				command: {
					kind: 'create_task',
					projectId: 'p1',
					prompt: 'New task prompt',
					schedule: null
				}
			};

			await handleRemoteCommand(event, ctx);
			assert.equal(results.length, 1);
			assert.equal(results[0].ok, true);
			assert.equal(createdPrompt, 'New task prompt');
			assert.deepEqual(results[0].data, { taskId: 't-new' });
		});

		it('handles move_task through handleRemoteCommand with queued validation', async () => {
			let movedTask: { id: string; toIndex: number } | null = null;
			const executor: Partial<RemoteCommandExecutor> = {
				runTask: async () => {},
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {},
				moveTask: async (_pId, taskId, toIndex) => {
					movedTask = { id: taskId, toIndex };
				}
			};

			const results: Array<{ commandId: string; ok: boolean }> = [];
			const ctx: CommandContext = {
				isEnabled: () => true,
				findProject: () => ({ id: 'p1', name: 'Proj 1', canonicalProjectPath: '/dev/p1' }),
				findTask: (id) => ({ id, projectPath: '/dev/p1', status: 'queued' }),
				executor: executor as RemoteCommandExecutor,
				reportResult: async (commandId, ok) => {
					results.push({ commandId, ok });
				}
			};

			const event: RemoteCommandEvent = {
				commandId: 'cmd-move',
				device: dummyDevice,
				command: {
					kind: 'move_task',
					projectId: 'p1',
					taskId: 't1',
					toIndex: 2
				}
			};

			await handleRemoteCommand(event, ctx);
			assert.equal(results.length, 1);
			assert.equal(results[0].ok, true);
			assert.deepEqual(movedTask, { id: 't1', toIndex: 2 });
		});

		it('rejects move_task when task is not queued', async () => {
			const executor: Partial<RemoteCommandExecutor> = {
				runTask: async () => {},
				waitQuotaReset: async () => {},
				dismissQuotaBlocked: async () => {}
			};

			const results: Array<{ commandId: string; ok: boolean; error?: { code: string } }> = [];
			const ctx: CommandContext = {
				isEnabled: () => true,
				findProject: () => ({ id: 'p1', name: 'Proj 1', canonicalProjectPath: '/dev/p1' }),
				findTask: (id) => ({ id, projectPath: '/dev/p1', status: 'in_progress' }),
				executor: executor as RemoteCommandExecutor,
				reportResult: async (commandId, ok, error) => {
					results.push({ commandId, ok, error });
				}
			};

			const event: RemoteCommandEvent = {
				commandId: 'cmd-move-not-queued',
				device: dummyDevice,
				command: {
					kind: 'move_task',
					projectId: 'p1',
					taskId: 't1',
					toIndex: 1
				}
			};

			await handleRemoteCommand(event, ctx);
			assert.equal(results.length, 1);
			assert.equal(results[0].ok, false);
			assert.equal(results[0].error?.code, 'rejected');
		});
	});
});
