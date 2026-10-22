import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	remoteChatHistory,
	queueDelta,
	flushDeltasForMessage,
	remoteGetArtifact,
	clearAllWatchersAndDeltas
} from '../src/lib/remote/chat.ts';
import {
	entryToRemoteMessage,
	remoteMessageId,
	truncateDiff,
	truncateTail
} from '../src/lib/remote/chatProjection.ts';
import { abortRemoteLane, sendRemotePrompt, stageRemoteAttachment } from '../src/lib/remote/sessionCommands.ts';
import { projectStore, type Project } from '../src/lib/stores/projects.svelte.ts';
import { laneStore, type LaneRecord } from '../src/lib/stores/lanes.svelte.ts';
import { sessionRegistry } from '../src/lib/agent/sessionRegistry.ts';
import { remoteStore } from '../src/lib/remote/remoteStore.svelte.ts';
import { remoteBridge } from '../src/lib/remote/bridge.ts';
import { RemoteCommandFailure } from '../src/lib/remote/commands.ts';
import type { RemoteChatEvent } from '$remote-protocol';
import type {
	UserEntry,
	AssistantEntry,
	ToolEntry,
	AgentSession
} from '../src/lib/agent/session.svelte.ts';

describe('remote chat history & session commands', () => {
	it('reassembles a binary upload before staging and rejects mixed upload metadata', async (t) => {
		const previousProjects = projectStore.projects;
		const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
		const projectId = 'p-chunked-upload';
		let stagedBytes: Uint8Array | null = null;
		t.after(() => {
			projectStore.projects = previousProjects;
			sessionRegistry.removeLaneSession(projectId, 'main');
			if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
			else Reflect.deleteProperty(globalThis, 'window');
		});
		projectStore.projects = [{
			id: projectId, name: 'Upload', canonicalProjectPath: '/tmp/upload',
			lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/upload' }
		} as unknown as Project];
		sessionRegistry.setLaneSession(projectId, 'main', { sessionKey: 'upload-session' } as unknown as AgentSession);
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {
			__TAURI_INTERNALS__: {
				invoke: async (command: string, body: unknown) => {
					assert.equal(command, 'stage_chat_attachment');
					assert.ok(body instanceof Uint8Array);
					stagedBytes = body;
					return { path: '/staged/payload.bin', name: 'payload.bin', size: body.byteLength };
				}
			}
		} });
		const bytes = Uint8Array.from({ length: 450_124 }, (_, index) => index % 251);
		const first = Buffer.from(bytes.subarray(0, 196_608)).toString('base64');
		const rest = Buffer.from(bytes.subarray(196_608)).toString('base64');
		await stageRemoteAttachment(projectId, null, 'payload.bin', first, 0, 2, 'upload');
		assert.equal(stagedBytes, null, 'an incomplete upload must not reach the filesystem');
		await assert.rejects(
			stageRemoteAttachment(projectId, null, 'other.bin', rest, 1, 2, 'upload'),
			(error: unknown) => error instanceof RemoteCommandFailure && error.code === 'rejected'
		);
		await stageRemoteAttachment(projectId, null, 'payload.bin', first, 0, 2, 'upload');
		await stageRemoteAttachment(projectId, null, 'payload.bin', rest, 1, 2, 'upload');
		assert.deepEqual(stagedBytes, bytes, 'padding and chunk boundaries must preserve every byte');
	});

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

	it('remoteChatHistory: returns thinking and text blocks in order, text joined for legacy', async () => {
		projectStore.projects = [
			{
				id: 'p-rich-history',
				name: 'Rich Project',
				canonicalProjectPath: '/tmp/rich',
				lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/rich' }
			} as unknown as Project
		];

		const mockAssistant: AssistantEntry = {
			id: 10,
			kind: 'assistant',
			blocks: [
				{ type: 'thinking', text: 'Step 1: analyze.' },
				{ type: 'text', text: 'Result is 42.' }
			],
			model: 'claude-3-7-sonnet',
			messageTs: 1729000000000
		};

		sessionRegistry.setLaneSession('p-rich-history', 'main', {
			entries: [mockAssistant]
		} as unknown as AgentSession);

		const page = await remoteChatHistory('p-rich-history', 'main', null, 50);
		assert.equal(page.messages.length, 1);
		const msg = page.messages[0];
		assert.equal(msg.id, 'e_10');
		assert.equal(msg.role, 'assistant');
		assert.equal(msg.text, 'Result is 42.');
		assert.equal(msg.model, 'claude-3-7-sonnet');
		assert.ok(Array.isArray(msg.blocks));
		assert.equal(msg.blocks!.length, 2);
		assert.deepEqual(msg.blocks![0], { type: 'thinking', text: 'Step 1: analyze.' });
		assert.deepEqual(msg.blocks![1], { type: 'text', text: 'Result is 42.' });
	});

	it('entryToRemoteMessage: tool status, diff, output truncation bounds and todo extraction', () => {
		// 1. Tool in corso
		const runningTool: ToolEntry = {
			id: 1,
			kind: 'tool',
			toolCallId: 'call_run_1',
			toolName: 'read',
			args: { path: 'src/lib/app.ts' },
			running: true,
			startedAt: 1000
		};
		const runningMsg = entryToRemoteMessage(runningTool)!;
		assert.equal(runningMsg.role, 'tool');
		assert.equal(runningMsg.tool?.status, 'running');
		assert.equal(runningMsg.tool?.endedAt, null);

		// 2. Tool con errore
		const errorTool: ToolEntry = {
			id: 2,
			kind: 'tool',
			toolCallId: 'call_err_2',
			toolName: 'bash',
			args: { command: 'cargo test' },
			running: false,
			startedAt: 1000,
			endedAt: 2000,
			result: { isError: true, details: { exitCode: 101 }, content: [{ type: 'text', text: 'error line' }] }
		};
		const errorMsg = entryToRemoteMessage(errorTool)!;
		assert.equal(errorMsg.tool?.status, 'error');
		assert.equal(errorMsg.tool?.endedAt, 2000);

		// 3. Troncatura diff (max 300 righe e 24 KB)
		const hugeDiff = Array.from({ length: 350 }, (_, i) => `+line ${i} ${'d'.repeat(80)}`).join('\n');
		const truncatedDiff = truncateDiff(hugeDiff)!;
		assert.ok(truncatedDiff.length <= 24 * 1024 + 10);
		assert.ok(truncatedDiff.split('\n').length <= 302);

		// 4. Troncatura output coda (max 60 righe e 8 KB)
		const hugeOutput = Array.from({ length: 80 }, (_, i) => `output row ${i} ${'o'.repeat(120)}`).join('\n');
		const truncatedOutput = truncateTail(hugeOutput)!;
		assert.ok(truncatedOutput.length <= 8 * 1024);
		assert.ok(truncatedOutput.split('\n').length <= 60);
		assert.ok(truncatedOutput.includes('output row 79'));

		// 5. Esclusivita': diff presente sopprime output per non duplicare
		const editTool: ToolEntry = {
			id: 3,
			kind: 'tool',
			toolCallId: 'call_edit_3',
			toolName: 'edit',
			args: { path: 'a.ts' },
			running: false,
			startedAt: 1000,
			result: {
				details: { diff: '+nuova riga\n' },
				content: [{ type: 'text', text: 'output duplicato' }]
			}
		};
		const editMsg = entryToRemoteMessage(editTool)!;
		assert.equal(editMsg.tool?.diff, '+nuova riga\n');
		assert.equal(editMsg.tool?.output, null);

		// 6. Tool todo: estrazione lista task
		const todoTool: ToolEntry = {
			id: 4,
			kind: 'tool',
			toolCallId: 'call_todo_4',
			toolName: 'todo',
			args: {},
			running: false,
			startedAt: 1000,
			result: {
				details: {
					phases: [
						{
							name: 'Fase 1',
							tasks: [
								{ content: 'Attivita 1', status: 'completed' },
								{ content: 'Attivita 2', status: 'in_progress' }
							]
						}
					]
				}
			}
		};
		const todoMsg = entryToRemoteMessage(todoTool)!;
		assert.deepEqual(todoMsg.tool?.todos, [
			{ text: 'Attivita 1', status: 'completed' },
			{ text: 'Attivita 2', status: 'in_progress' }
		]);
	});

	it('live message ids equal history ids across entries', () => {
		const user: UserEntry = {
			id: 21,
			kind: 'user',
			content: 'Ciao assistente',
			images: [],
			messageTs: 1729000001000
		};
		assert.equal(remoteMessageId(user), 'e_21');
		assert.equal(entryToRemoteMessage(user)!.id, 'e_21');

		const assistant: AssistantEntry = {
			id: 22,
			kind: 'assistant',
			blocks: [{ type: 'text', text: 'Ciao utente' }],
			messageTs: 1729000002000
		};
		// Delta in streaming e messaggio conclusivo condividono lo stesso identico id
		assert.equal(remoteMessageId(assistant), 'e_22');
		assert.equal(entryToRemoteMessage(assistant)!.id, 'e_22');

		const tool: ToolEntry = {
			id: 23,
			kind: 'tool',
			toolCallId: 'call_live_stable_1',
			toolName: 'read',
			args: {},
			running: true,
			startedAt: 1729000003000
		};
		// Tool start, tool end e storico condividono toolCallId
		assert.equal(remoteMessageId(tool), 'call_live_stable_1');
		assert.equal(entryToRemoteMessage(tool)!.id, 'call_live_stable_1');

		const notice = {
			id: 24,
			kind: 'notice' as const,
			level: 'info' as const,
			message: 'Contesto compattato'
		};
		assert.equal(remoteMessageId(notice), 'e_24');
		assert.equal(entryToRemoteMessage(notice)!.id, 'e_24');
	});

	it('entryToRemoteMessage: user text hides the context Studio appends for the model', () => {
		const user: UserEntry = {
			id: 31,
			kind: 'user',
			content: 'Sistema il login\n\n[Source Hints]\nsrc/auth.ts:12 export function login()\n\n[Git Context]\nbranch main',
			images: []
		};
		assert.equal(entryToRemoteMessage(user)!.text, 'Sistema il login');
	});

	it('per-block delta batching order preserves FIFO without mixing blocks', () => {
		const published: { projectId: string; laneId: string; event: RemoteChatEvent }[] = [];
		const origPublish = remoteBridge.publishChatEvent;
		remoteBridge.publishChatEvent = (projectId, laneId, event) => {
			published.push({ projectId, laneId, event });
			return Promise.resolve();
		};

		try {
			clearAllWatchersAndDeltas();
			remoteStore.status.relayFeatures = ['chat_rich'];

			queueDelta('p-order', 'main', 'msg-fifo', 'pensiero A ', 'thinking', 0);
			queueDelta('p-order', 'main', 'msg-fifo', 'pensiero B', 'thinking', 0);
			queueDelta('p-order', 'main', 'msg-fifo', 'risposta 1 ', 'text', 1);
			queueDelta('p-order', 'main', 'msg-fifo', 'risposta 2', 'text', 1);

			flushDeltasForMessage('p-order', 'main', 'msg-fifo');

			assert.equal(published.length, 2);
			const first = published[0].event;
			const second = published[1].event;
			assert.equal(first.kind, 'delta');
			assert.equal(second.kind, 'delta');
			if (first.kind === 'delta' && second.kind === 'delta') {
				// 1. Thinking batch index 0
				assert.equal(first.block, 'thinking');
				assert.equal(first.index, 0);
				assert.equal(first.text, 'pensiero A pensiero B');

				// 2. Text batch index 1
				assert.equal(second.block, 'text');
				assert.equal(second.index, 1);
				assert.equal(second.text, 'risposta 1 risposta 2');
			}
		} finally {
			clearAllWatchersAndDeltas();
			remoteBridge.publishChatEvent = origPublish;
		}
	});
	it('thinking deltas suppressed when relay lacks chat_rich, allowed when present', () => {
		const published: { event: RemoteChatEvent }[] = [];
		const origPublish = remoteBridge.publishChatEvent;
		remoteBridge.publishChatEvent = (_p, _l, event) => {
			published.push({ event });
			return Promise.resolve();
		};
		try {
			clearAllWatchersAndDeltas();

			// 1. Senza chat_rich: thinking soppresso
			remoteStore.status.relayFeatures = [];
			queueDelta('p-gate', 'main', 'msg-gate', 'ragionamento segreto', 'thinking', 0);
			flushDeltasForMessage('p-gate', 'main', 'msg-gate');
			assert.equal(published.length, 0);

			// Testo normale invece passa sempre
			queueDelta('p-gate', 'main', 'msg-gate', 'testo pubblico', 'text', 1);
			flushDeltasForMessage('p-gate', 'main', 'msg-gate');
			assert.equal(published.length, 1);
			const passedEvent = published[0].event;
			assert.equal(passedEvent.kind, 'delta');
			if (passedEvent.kind === 'delta') {
				assert.equal(passedEvent.text, 'testo pubblico');
			}
			published.length = 0;

			// 2. Con chat_rich: thinking inviato
			remoteStore.status.relayFeatures = ['chat_rich'];
			queueDelta('p-gate', 'main', 'msg-gate-2', 'ragionamento visibile', 'thinking', 0);
			flushDeltasForMessage('p-gate', 'main', 'msg-gate-2');
			assert.equal(published.length, 1);
			const richEvent = published[0].event;
			assert.equal(richEvent.kind, 'delta');
			if (richEvent.kind === 'delta') {
				assert.equal(richEvent.block, 'thinking');
				assert.equal(richEvent.text, 'ragionamento visibile');
			}
		} finally {
			clearAllWatchersAndDeltas();
			remoteBridge.publishChatEvent = origPublish;
		}
	});

	describe('anteprime dei tool (artifact)', () => {
		const tool = (over: Partial<ToolEntry> & { toolName: string; args: Record<string, unknown> }): ToolEntry => ({
			id: 900,
			kind: 'tool',
			toolCallId: 'call_art',
			running: false,
			startedAt: 1000,
			endedAt: 1100,
			...over
		});

		it('porta nel messaggio il contenuto di diagrammi, SVG e prototipi, e solo di quelli riusciti', () => {
			const diagram = entryToRemoteMessage(
				tool({ toolName: 'studio_diagram', args: { title: 'Flusso', mermaid: 'graph TD; A-->B' } })
			)!;
			assert.deepEqual(diagram.tool?.artifact, {
				kind: 'mermaid',
				title: 'Flusso',
				bytes: 15,
				content: 'graph TD; A-->B'
			});

			const svg = entryToRemoteMessage(
				tool({ toolName: 'write', args: { path: 'img/logo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' } })
			)!;
			assert.equal(svg.tool?.artifact?.kind, 'svg');
			assert.equal(svg.tool?.artifact?.title, 'logo.svg');

			const html = entryToRemoteMessage(
				tool({ toolName: 'studio_preview', args: { title: 'Card', code: '<div>ciao</div>' } })
			)!;
			assert.equal(html.tool?.artifact?.kind, 'html');

			// Non ha prodotto niente da mostrare: in corso, fallito, o file di altro tipo.
			const running = tool({ toolName: 'studio_diagram', running: true, args: { mermaid: 'graph TD; A-->B' } });
			const failed = tool({
				toolName: 'studio_diagram',
				args: { mermaid: 'graph TD; A-->B' },
				result: { isError: true, content: [] }
			});
			const plain = tool({ toolName: 'write', args: { path: 'src/a.ts', content: 'export {}' } });
			for (const entry of [running, failed, plain]) {
				assert.equal(entryToRemoteMessage(entry)!.tool?.artifact, undefined);
			}
		});

		it('lascia fuori dal messaggio i contenuti grandi e li serve con get_artifact', async () => {
			const big = 'graph TD;\n' + 'A-->B;\n'.repeat(5_000);
			const entry = tool({ toolName: 'studio_diagram', toolCallId: 'call_big', args: { title: 'Grande', mermaid: big } });
			const artifact = entryToRemoteMessage(entry)!.tool!.artifact!;
			assert.equal(artifact.content, null);
			assert.equal(artifact.bytes, big.length);

			projectStore.projects = [
				{
					id: 'p-artifact',
					name: 'Artifact',
					canonicalProjectPath: '/tmp/artifact',
					lane: { laneId: 'main', surface: 'gui', workspacePath: '/tmp/artifact' }
				} as unknown as Project
			];
			sessionRegistry.setLaneSession('p-artifact', 'main', { entries: [entry] } as unknown as AgentSession);
			try {
				const full = await remoteGetArtifact('p-artifact', null, 'call_big');
				assert.equal(full.artifact.content, big);

				await assert.rejects(
					() => remoteGetArtifact('p-artifact', null, 'call_assente'),
					(err: unknown) => err instanceof RemoteCommandFailure && err.code === 'not_found'
				);

				const huge = 'x'.repeat(400 * 1024);
				sessionRegistry.setLaneSession('p-artifact', 'main', {
					entries: [tool({ toolName: 'studio_diagram', toolCallId: 'call_huge', args: { mermaid: huge } })]
				} as unknown as AgentSession);
				await assert.rejects(
					() => remoteGetArtifact('p-artifact', null, 'call_huge'),
					(err: unknown) => err instanceof RemoteCommandFailure && err.code === 'rejected'
				);
			} finally {
				sessionRegistry.removeLaneSession('p-artifact', 'main');
			}
		});
	});
});
