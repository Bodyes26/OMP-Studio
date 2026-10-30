import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createLaneConfigCommands } from '../src/lib/remote/laneConfigCommands.ts';
import { projectStore, type Project } from '../src/lib/stores/projects.svelte.ts';
import { laneStore, type LaneRecord } from '../src/lib/stores/lanes.svelte.ts';
import { sessionRegistry } from '../src/lib/agent/sessionRegistry.ts';
import { RemoteCommandFailure } from '../src/lib/remote/commands.ts';
import type { AgentSession } from '../src/lib/agent/session.svelte.ts';
import type { RpcCommand } from '../src/lib/agent/wire.ts';
import type { ModelDto } from '../src/lib/stores/modelSettingsHelpers.ts';

describe('remote lane config commands (Gate R44, lane_config)', () => {
	const mockConfig = {
		modelRoles: {
			default: 'anthropic/claude-3-7-sonnet',
			plan: 'anthropic/claude-opus-4:high',
			smol: 'openai/gpt-4o-mini'
		},
		cycleOrder: ['default', 'plan', 'smol'],
		disabledProviders: [],
		fallbackChains: {}
	};

	const mockCatalog: ModelDto[] = [
		{
			id: 'claude-3-7-sonnet',
			name: 'Claude 3.7 Sonnet',
			provider: 'anthropic',
			selector: 'anthropic/claude-3-7-sonnet',
			isCustom: false
		},
		{
			id: 'claude-opus-4',
			name: 'Claude Opus 4',
			provider: 'anthropic',
			selector: 'anthropic/claude-opus-4',
			isCustom: false
		},
		{
			id: 'gpt-4o-mini',
			name: 'GPT-4o Mini',
			provider: 'openai',
			selector: 'openai/gpt-4o-mini',
			isCustom: false
		}
	];

	const knownSelectors = new Set([
		'anthropic/claude-3-7-sonnet',
		'anthropic/claude-opus-4',
		'openai/gpt-4o-mini'
	]);

	const {
		newRemoteSession,
		getRemoteComposerCatalog,
		setRemoteLaneRole,
		setRemoteLaneModel,
		setRemoteLaneThinking
	} = createLaneConfigCommands({
		ensureLoaded: async () => {},
		ensureRoleConfig: async () => {},
		getModelConfig: () => mockConfig,
		getAssignableCatalog: () => mockCatalog,
		getKnownSelectors: () => knownSelectors
	});

	beforeEach(() => {
		projectStore.projects = [
			{
				id: 'p-config',
				name: 'Config Project',
				canonicalProjectPath: '/tmp/config',
				lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/config' }
			} as unknown as Project
		];
		laneStore.lanes = [];
	});

	describe('new_session', () => {
		it('rejects with unsupported when lane is a lab lane', async () => {
			laneStore.lanes = [
				{
					projectId: 'p-config',
					laneId: 'lab-lane',
					kind: 'lab',
					surface: 'gui',
					title: 'Lab Prototype'
				} as unknown as LaneRecord
			];

			await assert.rejects(
				async () => {
					await newRemoteSession('p-config', 'lab-lane');
				},
				(err: unknown) => {
					assert.ok(err instanceof RemoteCommandFailure);
					assert.equal(err.code, 'unsupported');
					return true;
				}
			);
		});

		it('rejects with rejected when agent session is streaming', async () => {
			const mockSession = {
				isOpen: true,
				isStreaming: true,
				backgroundPending: false,
				agentState: 'working',
				newSession: async () => 'sess-1'
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			await assert.rejects(
				async () => {
					await newRemoteSession('p-config', 'main');
				},
				(err: unknown) => {
					assert.ok(err instanceof RemoteCommandFailure);
					assert.equal(err.code, 'rejected');
					return true;
				}
			);
		});

		it('rejects with rejected when agent session has background work pending', async () => {
			const mockSession = {
				isOpen: true,
				isStreaming: false,
				backgroundPending: true,
				agentState: 'background',
				newSession: async () => 'sess-1'
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			await assert.rejects(
				async () => {
					await newRemoteSession('p-config', 'main');
				},
				(err: unknown) => {
					assert.ok(err instanceof RemoteCommandFailure);
					assert.equal(err.code, 'rejected');
					return true;
				}
			);
		});

		it('successfully starts a new session when agent is idle', async () => {
			let newSessionCalled = false;
			const mockSession = {
				isOpen: true,
				isStreaming: false,
				backgroundPending: false,
				agentState: 'idle',
				newSession: async () => {
					newSessionCalled = true;
					return 'sess-new';
				}
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			await newRemoteSession('p-config', 'main');
			assert.equal(newSessionCalled, true);
		});

		for (const state of ['working', 'background', 'attention'] as const) {
			it(`starts a clean conversation after confirmed interruption with stale ${state} status`, async () => {
				let releaseAbort!: () => void;
				const abortFinished = new Promise<void>((resolve) => { releaseAbort = resolve; });
				let sessionId = 'old-session';
				let abortStarted = false;
				const session = {
					isOpen: true,
					isStreaming: state === 'working',
					backgroundPending: state === 'background',
					agentState: state,
					abort: async () => {
						abortStarted = true;
						await abortFinished;
						// Lo stato obsoleto resta occupato anche dopo la risposta all'abort.
					},
					newSession: async () => {
						sessionId = 'new-session';
						return sessionId;
					}
				} as unknown as AgentSession;
				sessionRegistry.setLaneSession('p-config', 'main', session);

				const starting = newRemoteSession('p-config', 'main', true);
				assert.equal(abortStarted, true);
				assert.equal(sessionId, 'old-session');
				releaseAbort();
				await starting;
				assert.equal(sessionId, 'new-session');
			});
		}
	});

	describe('set_lane_role', () => {
		it('applies role model and thinking level via RPC and updates lastPickedRole', async () => {
			const sentCommands: RpcCommand[] = [];
			let refreshed = false;
			const mockSession = {
				isOpen: true,
				model: { provider: 'anthropic', id: 'claude-3-7-sonnet' },
				thinkingLevel: 'low',
				lastPickedRole: 'default',
				client: {
					send: async (cmd: RpcCommand) => {
						sentCommands.push(cmd);
						return undefined;
					}
				},
				refreshState: async () => {
					refreshed = true;
				}
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			await setRemoteLaneRole('p-config', 'main', 'plan');

			assert.equal(sentCommands.length, 2);
			assert.deepEqual(sentCommands[0], {
				type: 'set_model',
				provider: 'anthropic',
				modelId: 'claude-opus-4'
			});
			assert.deepEqual(sentCommands[1], {
				type: 'set_thinking_level',
				level: 'high'
			});
			assert.equal(mockSession.lastPickedRole, 'plan');
			assert.equal(refreshed, true);
		});

		it('rejects with rejected when role is unassigned or unknown', async () => {
			const mockSession = {
				isOpen: true,
				model: null,
				client: { send: async () => undefined },
				refreshState: async () => undefined
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			await assert.rejects(
				async () => {
					await setRemoteLaneRole('p-config', 'main', 'unknown-role');
				},
				(err: unknown) => {
					assert.ok(err instanceof RemoteCommandFailure);
					assert.equal(err.code, 'rejected');
					return true;
				}
			);
		});
	});

	describe('set_lane_model', () => {
		it('applies model when present in assignable catalog', async () => {
			const sentCommands: RpcCommand[] = [];
			let refreshed = false;
			const mockSession = {
				isOpen: true,
				client: {
					send: async (cmd: RpcCommand) => {
						sentCommands.push(cmd);
						return undefined;
					}
				},
				refreshState: async () => {
					refreshed = true;
				}
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			await setRemoteLaneModel('p-config', 'main', 'openai', 'gpt-4o-mini');

			assert.equal(sentCommands.length, 1);
			assert.deepEqual(sentCommands[0], {
				type: 'set_model',
				provider: 'openai',
				modelId: 'gpt-4o-mini'
			});
			assert.equal(refreshed, true);
		});

		it('rejects with rejected when model is not in assignable catalog', async () => {
			const mockSession = {
				isOpen: true,
				client: { send: async () => undefined },
				refreshState: async () => undefined
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			await assert.rejects(
				async () => {
					await setRemoteLaneModel('p-config', 'main', 'unknown-provider', 'unknown-model');
				},
				(err: unknown) => {
					assert.ok(err instanceof RemoteCommandFailure);
					assert.equal(err.code, 'rejected');
					return true;
				}
			);
		});
	});

	describe('set_lane_thinking', () => {
		it('applies thinking level when supported', async () => {
			const sentCommands: RpcCommand[] = [];
			let refreshed = false;
			const mockSession = {
				isOpen: true,
				model: {
					provider: 'anthropic',
					id: 'claude-opus-4',
					thinking: { efforts: ['low', 'medium', 'high'] }
				},
				client: {
					send: async (cmd: RpcCommand) => {
						sentCommands.push(cmd);
						return undefined;
					}
				},
				refreshState: async () => {
					refreshed = true;
				}
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			await setRemoteLaneThinking('p-config', 'main', 'high');

			assert.equal(sentCommands.length, 1);
			assert.deepEqual(sentCommands[0], {
				type: 'set_thinking_level',
				level: 'high'
			});
			assert.equal(refreshed, true);
		});

		it('rejects with rejected when thinking level is not supported by model', async () => {
			const mockSession = {
				isOpen: true,
				model: {
					provider: 'anthropic',
					id: 'claude-opus-4',
					thinking: { efforts: ['low', 'medium'] }
				},
				client: { send: async () => undefined },
				refreshState: async () => undefined
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			await assert.rejects(
				async () => {
					await setRemoteLaneThinking('p-config', 'main', 'xhigh');
				},
				(err: unknown) => {
					assert.ok(err instanceof RemoteCommandFailure);
					assert.equal(err.code, 'rejected');
					return true;
				}
			);
		});
	});

	describe('composer_catalog', () => {
		it('excludes Studio-local commands and exposes skills by bare name', async () => {
			const mockSession = {
				isOpen: true,
				model: {
					provider: 'anthropic',
					id: 'claude-opus-4',
					thinking: { efforts: ['low', 'medium', 'high'] }
				},
				availableCommands: [
					{
						name: 'skill:audit',
						description: 'Audit code quality',
						source: 'skill',
						input: { hint: '[target]' }
					},
					{
						name: 'reviewer',
						description: 'Run reviewer skill',
						source: 'skill'
					},
				]
			} as unknown as AgentSession;
			sessionRegistry.setLaneSession('p-config', 'main', mockSession);

			const catalog = await getRemoteComposerCatalog('p-config', 'main');

			// Studio local commands like /new, /compact, /role, /loop MUST NOT be in catalog
			const cmdNames = catalog.commands.map((c) => c.name);
			assert.equal(cmdNames.includes('new'), false);
			assert.equal(cmdNames.includes('compact'), false);
			assert.equal(cmdNames.includes('role'), false);
			assert.equal(cmdNames.includes('loop'), false);
			assert.equal(cmdNames.includes('guided-goal'), false);

			// Skills must be present by bare name (without skill: prefix)
			const auditSkill = catalog.commands.find((c) => c.name === 'audit');
			assert.ok(auditSkill);
			assert.equal(auditSkill.kind, 'skill');
			assert.equal(auditSkill.description, 'Audit code quality');
			assert.equal(auditSkill.hint, '[target]');

			const reviewerSkill = catalog.commands.find((c) => c.name === 'reviewer');
			assert.ok(reviewerSkill);
			assert.equal(reviewerSkill.kind, 'skill');

			// Models must contain assignable catalog
			assert.ok(catalog.models.length >= 3);
			assert.equal(catalog.models[0].provider, 'anthropic');

			// Roles must contain standard roles with parsed model and thinking
			const defaultRole = catalog.roles.find((r) => r.id === 'default');
			assert.ok(defaultRole);
			assert.equal(defaultRole.model, 'anthropic/claude-3-7-sonnet');
			assert.equal(defaultRole.thinking, null);

			const planRole = catalog.roles.find((r) => r.id === 'plan');
			assert.ok(planRole);
			assert.equal(planRole.model, 'anthropic/claude-opus-4');
			assert.equal(planRole.thinking, 'high');

			// Thinking levels must be supported thinking levels
			assert.deepEqual(catalog.thinkingLevels, ['off', 'low', 'medium', 'high']);
		});
	});
});
