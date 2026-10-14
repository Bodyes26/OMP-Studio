import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildHostState, mapAgentState } from '../src/lib/remote/projection.ts';
import type { BuildHostStateInput, SessionInput } from '../src/lib/remote/projection.ts';
import type { AttentionRequest } from '../src/lib/stores/companion.svelte.ts';
import type { StudioTask } from '../src/lib/stores/tasks.svelte.ts';
import type { QuotaReport } from '../src/lib/stores/quota.svelte.ts';

describe('buildHostState projection', () => {
	it('maps lane order ensuring main is first with kind main', () => {
		const input: BuildHostStateInput = {
			projects: [{ id: 'p1', name: 'Project 1', canonicalProjectPath: '/dev/p1', hue: 120 }],
			lanes: [
				{ projectId: 'p1', laneId: 'feat-1', kind: 'worktree', title: 'Feature 1' },
				{ projectId: 'p1', laneId: 'lab-1', kind: 'lab', title: 'Prototipo' },
				{ projectId: 'p1', laneId: 'main', kind: 'main', title: 'Principale' }
			]
		};

		const state = buildHostState(input);
		assert.equal(state.projects.length, 1);
		const lanes = state.projects[0].lanes;
		assert.equal(lanes.length, 3);
		assert.equal(lanes[0].id, 'main');
		assert.equal(lanes[0].kind, 'main');
		assert.equal(lanes[0].title, 'Principale');
		assert.equal(lanes[1].id, 'feat-1');
		assert.equal(lanes[1].kind, 'worktree');
		assert.equal(lanes[2].id, 'lab-1');
		assert.equal(lanes[2].kind, 'lab');
	});

	it('maps agent states including background and offline', () => {
		assert.equal(mapAgentState(null), 'offline');
		assert.equal(mapAgentState({ isOpen: false }), 'offline');
		assert.equal(mapAgentState({ isOpen: true, exited: true }), 'offline');
		assert.equal(mapAgentState({ isOpen: true, exited: false, backgroundPending: true }), 'background');
		assert.equal(mapAgentState({ isOpen: true, exited: false, agentState: 'attention' }), 'attention');
		assert.equal(mapAgentState({ isOpen: true, exited: false, agentState: 'working' }), 'working');
		assert.equal(mapAgentState({ isOpen: true, exited: false, agentState: 'idle' }), 'idle');
		assert.equal(mapAgentState({ isOpen: true, exited: false, agentState: 'error' }), 'error');
		assert.equal(mapAgentState({ isOpen: true, exited: false, agentState: 'unknown' }), 'idle');
	});

	it('maps attention requests: ask, select, confirm, quotaBlocked', () => {
		const attentionRequests: AttentionRequest[] = [
			{
				projectId: 'p1',
				projectName: 'Project 1',
				projectHue: 120,
				laneId: 'main',
				laneTitle: 'Principale',
				recentMessages: [{ role: 'assistant', text: 'Domanda per te', timestamp: 1000 }],
				pendingUi: {
					kind: 'ask',
					requestId: 'req-ask',
					title: 'Scelta multipla',
					method: 'ask',
					questions: [
						{
							id: 'q1',
							question: 'Quale framework?',
							header: 'Frontend',
							options: [
								{ label: 'Svelte', description: 'Reattivo' },
								{ label: 'React', description: 'Classico' }
							],
							multi: false,
							recommended: 0
						}
					],
					deadline: 50000
				}
			},
			{
				projectId: 'p1',
				projectName: 'Project 1',
				projectHue: 120,
				laneId: 'main',
				recentMessages: [],
				pendingUi: {
					kind: 'quota_blocked',
					requestId: 'req-quota',
					title: 'Quota esaurita',
					method: 'confirm',
					blockedQuota: {
						reasonKind: 'quota_exhausted',
						failedProvider: 'anthropic',
						failedModelId: 'claude-3-7-sonnet'
					}
				}
			},
			{
				projectId: 'p1',
				projectName: 'Project 1',
				projectHue: 120,
				laneId: 'feat-1',
				recentMessages: [],
				pendingUi: {
					kind: 'select',
					requestId: 'req-select',
					title: 'Seleziona opzione',
					method: 'select',
					options: ['Opzione A', 'Opzione B'],
					optionDetails: [{ description: 'Prima' }, { description: 'Seconda' }]
				}
			}
		];

		const input: BuildHostStateInput = {
			projects: [{ id: 'p1', name: 'Project 1' }],
			attentionRequests
		};

		const state = buildHostState(input);
		const attentions = state.projects[0].attention;
		assert.equal(attentions.length, 3);

		// 1. ask
		const askReq = attentions.find((a) => a.requestId === 'req-ask')!;
		assert.equal(askReq.method, 'ask');
		assert.equal(askReq.deadline, 50000);
		assert.equal(askReq.questions.length, 1);
		assert.equal(askReq.questions[0].header, 'Frontend');
		assert.equal(askReq.questions[0].recommended, 0);
		assert.equal(askReq.recentMessages[0].text, 'Domanda per te');

		// 2. quotaBlocked
		const quotaReq = attentions.find((a) => a.requestId === 'req-quota')!;
		assert.ok(quotaReq.quotaBlocked);
		assert.equal(quotaReq.quotaBlocked.reason, 'quota_exhausted');
		assert.equal(quotaReq.quotaBlocked.provider, 'anthropic');
		assert.equal(quotaReq.quotaBlocked.modelId, 'claude-3-7-sonnet');

		// 3. select
		const selectReq = attentions.find((a) => a.requestId === 'req-select')!;
		assert.equal(selectReq.method, 'select');
		assert.equal(selectReq.options.length, 2);
		assert.equal(selectReq.options[0].label, 'Opzione A');
		assert.equal(selectReq.options[0].description, 'Prima');
	});

	it('maps schedules including reset estimates and missed flags', () => {
		const tasks: StudioTask[] = [
			{
				id: 't-at',
				projectPath: '/dev/p1',
				prompt: 'Task programmato at',
				position: 0,
				status: 'queued',
				createdAt: 100,
				updatedAt: 100,
				schedule: { kind: 'at', notBefore: 1234567, setAt: 50, origin: 'user' }
			},
			{
				id: 't-reset',
				projectPath: '/dev/p1',
				prompt: 'Task programmato reset',
				position: 1,
				status: 'queued',
				createdAt: 200,
				updatedAt: 200,
				schedule: { kind: 'reset', provider: 'anthropic', setAt: 50, origin: 'recovery', missed: true }
			}
		];

		const input: BuildHostStateInput = {
			projects: [{ id: 'p1', name: 'Project 1', canonicalProjectPath: '/dev/p1' }],
			tasks,
			resolveScheduleTarget: (t) => {
				if (t.id === 't-reset') return { dueAt: 999999, provider: 'anthropic' };
				return { dueAt: 1234567 };
			}
		};

		const state = buildHostState(input);
		const mappedTasks = state.projects[0].tasks;
		assert.equal(mappedTasks.length, 2);

		const atTask = mappedTasks.find((t) => t.id === 't-at')!;
		assert.equal(atTask.schedule?.kind, 'at');
		assert.equal(atTask.schedule?.notBefore, 1234567);
		assert.equal(atTask.schedule?.missed, false);

		const resetTask = mappedTasks.find((t) => t.id === 't-reset')!;
		assert.equal(resetTask.schedule?.kind, 'reset');
		assert.equal(resetTask.schedule?.notBefore, 999999);
		assert.equal(resetTask.schedule?.provider, 'anthropic');
		assert.equal(resetTask.schedule?.missed, true);
	});

	it('filters out completed and abandoned tasks, keeping only active statuses', () => {
		const tasks: StudioTask[] = [
			{ id: 't1', projectPath: '/dev/p1', prompt: 'Q', position: 0, status: 'queued', createdAt: 1, updatedAt: 1 },
			{ id: 't2', projectPath: '/dev/p1', prompt: 'D', position: 1, status: 'dispatching', createdAt: 2, updatedAt: 2 },
			{ id: 't3', projectPath: '/dev/p1', prompt: 'I', position: 2, status: 'in_progress', createdAt: 3, updatedAt: 3 },
			{ id: 't4', projectPath: '/dev/p1', prompt: 'C', position: 3, status: 'completed', createdAt: 4, updatedAt: 4 },
			{ id: 't5', projectPath: '/dev/p1', prompt: 'A', position: 4, status: 'abandoned', createdAt: 5, updatedAt: 5 }
		];

		const input: BuildHostStateInput = {
			projects: [{ id: 'p1', name: 'Project 1', canonicalProjectPath: '/dev/p1' }],
			tasks
		};

		const state = buildHostState(input);
		const mappedTasks = state.projects[0].tasks;
		assert.equal(mappedTasks.length, 3);
		assert.deepEqual(mappedTasks.map((t) => t.id), ['t1', 't2', 't3']);
	});

	it('truncates prompts exceeding 4000 characters and leaves shorter prompts intact', () => {
		const longPrompt = 'X'.repeat(4500);
		const shortPrompt = 'Short prompt';

		const tasks: StudioTask[] = [
			{ id: 't-long', projectPath: '/dev/p1', prompt: longPrompt, position: 0, status: 'queued', createdAt: 1, updatedAt: 1 },
			{ id: 't-short', projectPath: '/dev/p1', prompt: shortPrompt, position: 1, status: 'queued', createdAt: 2, updatedAt: 2 }
		];

		const input: BuildHostStateInput = {
			projects: [{ id: 'p1', name: 'Project 1', canonicalProjectPath: '/dev/p1' }],
			tasks
		};

		const state = buildHostState(input);
		const mapped = state.projects[0].tasks;
		assert.equal(mapped[0].prompt.length, 4000);
		assert.equal(mapped[1].prompt, 'Short prompt');
	});

	it('maps quota reports to providers and windows with status', () => {
		const quotaReports: QuotaReport[] = [
			{
				provider: 'anthropic',
				limits: [
					{
						id: 'anthropic:5h',
						label: 'Claude 5h',
						window: { resetsAt: 12345 },
						amount: { usedFraction: 0.999 }
					}
				]
			},
			{
				provider: 'openai',
				limits: [
					{
						id: 'openai:rpm',
						label: 'RPM',
						amount: { remainingFraction: 0.25 }
					}
				]
			},
			{
				provider: 'google',
				limits: [
					{
						id: 'google:daily',
						label: 'Daily',
						amount: { usedFraction: 0.1 }
					}
				]
			}
		];

		const input: BuildHostStateInput = {
			projects: [{ id: 'p1', name: 'Project 1' }],
			quotaReports,
			quotaFetchedAt: 77777
		};

		const state = buildHostState(input);
		assert.ok(state.quota);
		assert.equal(state.quota.fetchedAt, 77777);
		assert.equal(state.quota.providers.length, 3);

		const anthropic = state.quota.providers.find((p) => p.provider === 'anthropic')!;
		assert.equal(anthropic.status, 'exhausted');
		assert.equal(anthropic.windows[0].usedFraction, 0.999);
		assert.equal(anthropic.windows[0].resetsAt, 12345);

		const openai = state.quota.providers.find((p) => p.provider === 'openai')!;
		assert.equal(openai.status, 'warning'); // remaining 0.25 -> used 0.75 >= 0.70

		const google = state.quota.providers.find((p) => p.provider === 'google')!;
		assert.equal(google.status, 'ok');
		assert.equal(google.windows[0].usedFraction, 0.1);
	});
	it('projects terminal-surface lane from terminal state without GUI session', () => {
		const input: BuildHostStateInput = {
			projects: [{ id: 'p1', name: 'Project 1' }],
			lanes: [
				{
					projectId: 'p1',
					laneId: 'main',
					kind: 'main',
					title: 'Principale',
					surface: 'terminal',
					agentState: 'working'
				},
				{
					projectId: 'p1',
					laneId: 'wt-term',
					kind: 'worktree',
					title: 'Feature Terminal',
					surface: 'terminal',
					agentState: 'attention'
				},
				{
					projectId: 'p1',
					laneId: 'wt-unknown',
					kind: 'worktree',
					title: 'Feature Unknown',
					surface: 'terminal',
					agentState: 'unknown'
				}
			]
		};

		const state = buildHostState(input);
		const lanes = state.projects[0].lanes;
		assert.equal(lanes.length, 3);

		// main: surface terminal, agentState working
		assert.equal(lanes[0].agent.surface, 'terminal');
		assert.equal(lanes[0].agent.state, 'working');

		// wt-term: surface terminal, agentState attention
		assert.equal(lanes[1].agent.surface, 'terminal');
		assert.equal(lanes[1].agent.state, 'attention');

		// wt-unknown: surface terminal, agentState unknown -> offline
		assert.equal(lanes[2].agent.surface, 'terminal');
		assert.equal(lanes[2].agent.state, 'offline');
	});
});
