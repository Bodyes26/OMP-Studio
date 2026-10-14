import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { remoteChatHistory } from '../src/lib/remote/chat.ts';
import { abortRemoteLane, sendRemotePrompt } from '../src/lib/remote/sessionCommands.ts';
import { projectStore, type Project } from '../src/lib/stores/projects.svelte.ts';
import { laneStore, type LaneRecord } from '../src/lib/stores/lanes.svelte.ts';
import { sessionRegistry } from '../src/lib/agent/sessionRegistry.ts';
import { RemoteCommandFailure } from '../src/lib/remote/commands.ts';

describe('remote chat history & session commands', () => {
	it('remoteChatHistory: not found for missing project', async () => {
		await assert.rejects(
			async () => {
				await remoteChatHistory('non-existent-proj', null, null, 50);
			},
			(err: unknown) => {
				assert.ok(err instanceof RemoteCommandFailure);
				assert.equal(err.code, 'not_found');
				return true;
			}
		);
	});

	it('remoteChatHistory: returns empty page when session has no entries', async () => {
		projectStore.projects = [
			{
				id: 'p-test',
				name: 'Test Project',
				canonicalProjectPath: '/tmp/test',
				lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/test' }
			} as unknown as Project
		];

		const page = await remoteChatHistory('p-test', null, null, 50);
		assert.deepEqual(page, { messages: [], before: null });
	});

	it('remoteChatHistory: unsupported for terminal surface', async () => {
		projectStore.projects = [
			{
				id: 'p-term',
				name: 'Terminal Project',
				canonicalProjectPath: '/tmp/term',
				lane: { laneId: 'main', surface: 'terminal', workspacePath: '/tmp/term' }
			} as unknown as Project
		];

		await assert.rejects(
			async () => {
				await remoteChatHistory('p-term', null, null, 50);
			},
			(err: unknown) => {
				assert.ok(err instanceof RemoteCommandFailure);
				assert.equal(err.code, 'unsupported');
				return true;
			}
		);
	});

	it('abortRemoteLane: unsupported on terminal surface', async () => {
		projectStore.projects = [
			{
				id: 'p-term',
				name: 'Terminal Project',
				canonicalProjectPath: '/tmp/term',
				lane: { laneId: 'main', surface: 'terminal', workspacePath: '/tmp/term' }
			} as unknown as Project
		];

		await assert.rejects(
			async () => {
				await abortRemoteLane('p-term', null);
			},
			(err: unknown) => {
				assert.ok(err instanceof RemoteCommandFailure);
				assert.equal(err.code, 'unsupported');
				return true;
			}
		);
	});

	it('sendRemotePrompt: rejects empty or oversized prompt', async () => {
		projectStore.projects = [
			{
				id: 'p-test',
				name: 'Test Project',
				canonicalProjectPath: '/tmp/test',
				lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/test' }
			} as unknown as Project
		];

		await assert.rejects(
			async () => {
				await sendRemotePrompt('p-test', null, '   ', 'steer');
			},
			(err: unknown) => {
				assert.ok(err instanceof RemoteCommandFailure);
				assert.equal(err.code, 'rejected');
				return true;
			}
		);

		await assert.rejects(
			async () => {
				await sendRemotePrompt('p-test', null, 'a'.repeat(20_001), 'steer');
			},
			(err: unknown) => {
				assert.ok(err instanceof RemoteCommandFailure);
				assert.equal(err.code, 'rejected');
				return true;
			}
		);
	});

	it('sendRemotePrompt: unsupported on terminal surface', async () => {
		projectStore.projects = [
			{
				id: 'p-term',
				name: 'Terminal Project',
				canonicalProjectPath: '/tmp/term',
				lane: { laneId: 'main', surface: 'terminal', workspacePath: '/tmp/term' }
			} as unknown as Project
		];

		await assert.rejects(
			async () => {
				await sendRemotePrompt('p-term', null, 'hello', 'steer');
			},
			(err: unknown) => {
				assert.ok(err instanceof RemoteCommandFailure);
				assert.equal(err.code, 'unsupported');
				return true;
			}
		);
	});

	it('canonical resolution: resolves main independently of active project.lane', async () => {
		// Active lane is worktree-1 on terminal, but main is on GUI
		projectStore.projects = [
			{
				id: 'p-multi',
				name: 'Multi Lane Project',
				canonicalProjectPath: '/tmp/multi',
				lane: { laneId: 'worktree-1', surface: 'terminal', workspacePath: '/tmp/worktree-1' }
			} as unknown as Project
		];
		laneStore.lanes = [
			{
				projectId: 'p-multi',
				laneId: 'main',
				surface: 'gui',
				workspacePath: '/tmp/multi',
				kind: 'main'
			} as unknown as LaneRecord
		];

		// Targeting lane 'main' resolves canonically to main (GUI surface), not the active worktree
		const page = await remoteChatHistory('p-multi', 'main', null, 50);
		assert.deepEqual(page, { messages: [], before: null });
	});

	it('sendRemotePrompt: rejects closed lab lane without prototype configuration', async () => {
		projectStore.projects = [
			{
				id: 'p-lab',
				name: 'Lab Project',
				canonicalProjectPath: '/tmp/lab',
				lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/lab' }
			} as unknown as Project
		];

		await assert.rejects(
			async () => {
				await sendRemotePrompt('p-lab', 'lab-closed', 'ciao', 'steer');
			},
			(err: unknown) => {
				assert.ok(err instanceof RemoteCommandFailure);
				assert.ok(err.code === 'not_found' || err.code === 'rejected');
				return true;
			}
		);
	});
});
