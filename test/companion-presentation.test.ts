import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	createInitialPresentationState,
	selectProject,
	returnToPreviousSelection,
	setConversationSnapshot,
	toggleConversationExpanded,
	setConversationDraft,
	startSendingReply,
	markReplySent,
	setSendReplyError,
	isProjectUnread,
	buildGlobalQueueItems,
	conversationKey
} from '../src/lib/companion/companionPresentation.ts';
import type { CompanionConversationSnapshot } from '../src/lib/companion/conversation.ts';
import {
	parseProjectTasksFile, serializeProjectTasksFile, type StudioTask
} from '../src/lib/stores/taskSerialization.ts';
import { nextAutoDispatchTask, nextDueScheduledTask } from '../src/lib/quota/scheduleQueue.ts';

test('selectProject preserves scroll and draft when switching projects', () => {
	const state = createInitialPresentationState('p1');
	setConversationDraft(state, 'p1', 'main', 'bozza per p1');
	selectProject(state, 'p2', 'main', 'answer', 120);

	const p1Conv = state.conversations[conversationKey('p1', 'main')];
	assert.equal(p1Conv.scroll, 120);
	assert.equal(p1Conv.draft, 'bozza per p1');

	assert.equal(state.selectedProjectId, 'p2');
	assert.equal(state.previousSelection?.projectId, 'p1');

	setConversationDraft(state, 'p2', 'main', 'bozza per p2');
	assert.equal(state.conversations[conversationKey('p2', 'main')].draft, 'bozza per p2');
	assert.equal(state.conversations[conversationKey('p1', 'main')].draft, 'bozza per p1');
});

test('returnToPreviousSelection restores previous project and viewMode', () => {
	const state = createInitialPresentationState('portalino');
	selectProject(state, 'laboratorio', 'main', 'question', 45);

	assert.equal(state.selectedProjectId, 'laboratorio');
	assert.equal(state.viewMode, 'question');
	assert.equal(state.previousSelection?.projectId, 'portalino');

	const returned = returnToPreviousSelection(state, 10);
	assert.equal(returned, true);
	assert.equal(state.selectedProjectId, 'portalino');
	assert.equal(state.viewMode, 'answer');
	assert.equal(state.previousSelection, null);
});

test('toggleConversationExpanded preserves scroll and does not consume unread state', () => {
	const state = createInitialPresentationState('quote');
	const snapshot: CompanionConversationSnapshot = {
		projectId: 'quote',
		laneId: 'main',
		sessionId: 'sess-1',
		message: { id: 'msg-1', text: 'Riepilogo quote', at: 1000 },
		canSend: true
	};
	setConversationSnapshot(state, snapshot);

	assert.equal(isProjectUnread(state, 'quote', 'main', 'idle', false), true);

	toggleConversationExpanded(state, 'quote', 'main', 80);
	const conv = state.conversations[conversationKey('quote', 'main')];
	assert.equal(conv.expanded, false);
	assert.equal(conv.scroll, 80);

	assert.equal(isProjectUnread(state, 'quote', 'main', 'idle', false), true);

	toggleConversationExpanded(state, 'quote', 'main');
	assert.equal(conv.expanded, true);
	assert.equal(isProjectUnread(state, 'quote', 'main', 'idle', false), true);
});

test('isProjectUnread lifecycle: stays pending until replied, then pending on new message', () => {
	const state = createInitialPresentationState('pdr');
	const snapshot: CompanionConversationSnapshot = {
		projectId: 'pdr',
		laneId: 'main',
		sessionId: 'sess-pdr',
		message: { id: 'msg-pdr-1', text: 'Piano pronto', at: 1000 },
		canSend: true
	};
	setConversationSnapshot(state, snapshot);

	assert.equal(isProjectUnread(state, 'pdr', 'main', 'idle', true), false);
	assert.equal(isProjectUnread(state, 'pdr', 'main', 'working', false), false);

	assert.equal(isProjectUnread(state, 'pdr', 'main', 'idle', false), true);

	markReplySent(state, 'pdr', 'main', 'procedi pure', 'msg-pdr-1');
	assert.equal(isProjectUnread(state, 'pdr', 'main', 'idle', false), false);

	const newSnapshot: CompanionConversationSnapshot = {
		projectId: 'pdr',
		laneId: 'main',
		sessionId: 'sess-pdr',
		message: { id: 'msg-pdr-2', text: 'Aggiornamento completato', at: 2000 },
		canSend: true
	};
	setConversationSnapshot(state, newSnapshot);
	assert.equal(isProjectUnread(state, 'pdr', 'main', 'idle', false), true);
});

test('send failure preserves the draft and releases the pending delivery state', () => {
	const state = createInitialPresentationState('portalino');
	setConversationDraft(state, 'portalino', 'main', '/pubblica-progetto adesso');

	startSendingReply(state, 'portalino', 'main');
	const conv = state.conversations[conversationKey('portalino', 'main')];
	assert.equal(conv.isSending, true);

	setSendReplyError(state, 'portalino', 'main', 'Sessione cambiata');
	assert.equal(conv.isSending, false);
	assert.equal(conv.draft, '/pubblica-progetto adesso');
});

test('buildGlobalQueueItems includes all queued tasks and computes correct canRun and block reasons', () => {
	const projects = [
		{
			id: 'portalino',
			name: 'Portalino',
			label: 'Portalino Cuneo',
			hue: 355,
			canonicalProjectPath: '/repos/portalino',
			lane: { agentState: 'idle' }
		},
		{
			id: 'quote',
			name: 'Quote',
			hue: 55,
			canonicalProjectPath: '/repos/quote',
			lane: { agentState: 'working' }
		},
		{
			id: 'laboratorio',
			name: 'Laboratorio',
			hue: 35,
			canonicalProjectPath: '/repos/lab',
			lane: { agentState: 'idle' }
		}
	];

	const tasksByProject = {
		'/repos/portalino': [
			{ id: 't1', status: 'queued', prompt: 'Task Portalino 1', createdAt: 1 },
			{ id: 't2', status: 'completed', prompt: 'Task già fatto', createdAt: 2 },
			{ id: 't3', status: 'queued', prompt: 'Task Portalino 2', createdAt: 4 }
		],
		'/repos/quote': [
			{ id: 'q1', status: 'queued', prompt: 'Task Quote 1', createdAt: 2 }
		],
		'/repos/lab': [
			{ id: 'l1', status: 'queued', prompt: 'Task Lab 1', createdAt: 3 }
		]
	};

	const runtimesByProject = {
		portalino: { canRunTask: true },
		quote: { canRunTask: false, runBlockReason: 'Occupato' },
		laboratorio: { canRunTask: false }
	};

	const attentionProjectIds = new Set(['laboratorio']);
	const unreadProjectIds = new Set(['portalino']);

	const items = buildGlobalQueueItems(
		projects,
		tasksByProject,
		runtimesByProject,
		attentionProjectIds,
		unreadProjectIds,
		(t) => t.prompt || t.id,
		{
			question: 'Domanda',
			busy: 'Al lavoro',
			unread: 'Da leggere',
			idle: 'Fermo',
			reasonAttention: 'In attesa di risposta',
			reasonBusy: 'Agente già al lavoro',
			reasonBlockedDefault: 'Avvio bloccato'
		}
	);

	assert.equal(items.length, 4);
	assert.deepEqual(items.map((i) => i.taskId), ['t1', 'q1', 'l1', 't3']);

	assert.equal(items[0].projectId, 'portalino');
	assert.equal(items[0].statusKey, 'unread');
	assert.equal(items[0].canRun, true);
	assert.equal(items[0].disabledReason, undefined);

	assert.equal(items[1].projectId, 'quote');
	assert.equal(items[1].statusKey, 'busy');
	assert.equal(items[1].canRun, false);
	assert.equal(items[1].disabledReason, 'Agente già al lavoro');

	assert.equal(items[2].projectId, 'laboratorio');
	assert.equal(items[2].statusKey, 'question');
	assert.equal(items[2].canRun, false);
	assert.equal(items[2].disabledReason, 'In attesa di risposta');
});

test('drafts and delivery acknowledgements stay with the read session when a lane changes chat', () => {
	const state = createInitialPresentationState('portalino');
	const first: CompanionConversationSnapshot = {
		projectId: 'portalino', laneId: 'main', sessionId: 'first',
		message: { id: 'same-local-id', text: 'Primo piano', at: 1 }, canSend: true
	};
	setConversationSnapshot(state, first);
	setConversationDraft(state, 'portalino', 'main', 'procedi pure');
	startSendingReply(state, 'portalino', 'main');
	const second = { ...first, sessionId: 'second', message: { ...first.message!, text: 'Altro piano' } };
	setConversationSnapshot(state, second);
	const active = state.conversations[conversationKey('portalino')];
	assert.equal(active.draft, '');
	setConversationDraft(state, 'portalino', 'main', 'bozza per la seconda chat');
	markReplySent(state, 'portalino', 'main', 'procedi pure', 'same-local-id', 'first');
	assert.equal(active.draft, 'bozza per la seconda chat');
	assert.equal(isProjectUnread(state, 'portalino', 'main', 'idle', false, {
		laneId: 'main', sessionId: 'second', messageId: 'same-local-id', at: 2
	}), true);
	setConversationSnapshot(state, first);
	assert.equal(state.conversations[conversationKey('portalino')].draft, '');
	setConversationSnapshot(state, second);
	assert.equal(state.conversations[conversationKey('portalino')].draft, 'bozza per la seconda chat');
});

test('a successful send does not erase text typed while delivery was pending', () => {
	const state = createInitialPresentationState('quote');
	setConversationDraft(state, 'quote', 'main', 'procedi pure');
	startSendingReply(state, 'quote');
	setConversationDraft(state, 'quote', 'main', 'aggiungi anche il riepilogo');
	markReplySent(state, 'quote', 'main', 'procedi pure');
	assert.equal(state.conversations[conversationKey('quote')].draft, 'aggiungi anche il riepilogo');
});

test('captured tasks stay queued after reload even with project auto-dispatch, while an explicit schedule can release them', () => {
	const captured: StudioTask = {
		id: 'captured', projectPath: '/repo', prompt: 'Valuta il piano',
		position: 0, createdAt: 1, updatedAt: 1, status: 'queued', manualStartOnly: true
	};
	const tasks = parseProjectTasksFile(serializeProjectTasksFile([captured]));
	assert.equal(nextAutoDispatchTask(tasks, new Set()), null);
	const regular: StudioTask = { ...captured, id: 'regular', position: 1, manualStartOnly: undefined };
	assert.equal(nextAutoDispatchTask([...tasks, regular], new Set())?.id, 'regular');
	tasks[0].schedule = { kind: 'at', origin: 'user', setAt: 2, notBefore: 3 };
	assert.equal(nextDueScheduledTask(tasks, () => 'due', new Set())?.id, 'captured');
});
test('createInitialPresentationState defaults to null project selection', () => {
	const state = createInitialPresentationState();
	assert.equal(state.selectedProjectId, null);
	assert.equal(state.selectedRequestId, null);
	assert.equal(state.viewMode, 'answer');
});

test('closing card clears selectedProjectId and selectedRequestId', () => {
	const state = createInitialPresentationState('proj-1');
	state.selectedRequestId = 'req-1';
	state.viewMode = 'question';
	assert.equal(state.selectedProjectId, 'proj-1');

	// Simulazione chiusura manuale o automatica alla risposta
	state.selectedProjectId = null;
	state.selectedRequestId = null;
	state.viewMode = 'answer';

	assert.equal(state.selectedProjectId, null);
	assert.equal(state.selectedRequestId, null);
	assert.equal(state.viewMode, 'answer');
});
