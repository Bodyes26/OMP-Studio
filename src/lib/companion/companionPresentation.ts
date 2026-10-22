import type {
	CompanionConversationSnapshot,
	CompanionAssistantReference
} from './conversation';

export type CompanionViewMode = 'answer' | 'question';

export interface ConversationViewState {
	projectId: string;
	laneId: string;
	snapshot: CompanionConversationSnapshot | null;
	expanded: boolean;
	scroll: number;
	questionScroll: number;
	draft: string;
	lastSent: string | null;
	lastRepliedMessageId: string | null;
	sendError: string | null;
	loadError: string | null;
	isLoading: boolean;
	isSending: boolean;
}

export interface SelectionReference {
	projectId: string;
	laneId: string;
	viewMode: CompanionViewMode;
	requestId: string | null;
}

export interface CompanionPresentationState {
	selectedProjectId: string | null;
	selectedLaneId: string;
	selectedRequestId: string | null;
	viewMode: CompanionViewMode;
	previousSelection: SelectionReference | null;
	conversations: Record<string, ConversationViewState>;
	archivedConversations: Record<string, ConversationViewState>;
	parkedOpen: boolean;
}

interface QueueTask {
	id: string;
	status: string;
	prompt?: string;
	createdAt?: number;
	title?: string;
}

export interface GlobalQueueItemState<T extends QueueTask = QueueTask> {
	task: T;
	taskId: string;
	taskTitle: string;
	projectId: string;
	projectName: string;
	projectHue: number;
	order: number;
	statusKey: 'question' | 'busy' | 'unread' | 'idle';
	statusLabel: string;
	canRun: boolean;
	disabledReason?: string;
}

export function conversationKey(projectId: string, laneId = 'main'): string {
	return `${projectId.toLowerCase()}::${laneId.toLowerCase()}`;
}

export function createInitialPresentationState(
	initialProjectId: string | null = null,
	initialLaneId = 'main'
): CompanionPresentationState {
	return {
		selectedProjectId: initialProjectId,
		selectedLaneId: initialLaneId,
		selectedRequestId: null,
		viewMode: 'answer',
		previousSelection: null,
		conversations: {},
		archivedConversations: {},
		parkedOpen: false
	};
}

function createConversationState(projectId: string, laneId: string): ConversationViewState {
	return {
		projectId,
		laneId,
		snapshot: null,
		expanded: true,
		scroll: 0,
		questionScroll: 0,
		draft: '',
		lastSent: null,
		lastRepliedMessageId: null,
		sendError: null,
		loadError: null,
		isLoading: false,
		isSending: false
	};
}

function sessionConversationKey(projectId: string, laneId: string, sessionId: string | null): string {
	return `${conversationKey(projectId, laneId)}::${sessionId ?? ''}`;
}

export function getOrCreateConversation(
	state: CompanionPresentationState,
	projectId: string,
	laneId = 'main'
): ConversationViewState {
	const key = conversationKey(projectId, laneId);
	if (!state.conversations[key]) state.conversations[key] = createConversationState(projectId, laneId);
	// Rileggere restituisce il proxy Svelte, non l'oggetto appena assegnato.
	return state.conversations[key];
}

export function selectProject(
	state: CompanionPresentationState,
	projectId: string,
	laneId = 'main',
	viewMode: CompanionViewMode = 'answer',
	currentScroll = 0
): void {
	// Il cambio esplicito conserva il punto di lettura della vista lasciata.
	if (state.selectedProjectId) {
		const current = getOrCreateConversation(state, state.selectedProjectId, state.selectedLaneId);
		if (state.viewMode === 'question') {
			current.questionScroll = currentScroll;
		} else {
			current.scroll = currentScroll;
		}

		if (
			state.selectedProjectId.toLowerCase() !== projectId.toLowerCase() ||
			state.selectedLaneId.toLowerCase() !== laneId.toLowerCase() ||
			state.viewMode !== viewMode
		) {
			state.previousSelection = {
				projectId: state.selectedProjectId,
				laneId: state.selectedLaneId,
				viewMode: state.viewMode,
				requestId: state.selectedRequestId
			};
		}
	}

	state.selectedProjectId = projectId;
	state.selectedLaneId = laneId;
	state.viewMode = viewMode;
	state.selectedRequestId = null;

	const target = getOrCreateConversation(state, projectId, laneId);
	if (viewMode === 'answer') {
		target.expanded = true;
	}
}

export function returnToPreviousSelection(
	state: CompanionPresentationState,
	currentScroll = 0
): boolean {
	if (!state.previousSelection) return false;
	const prev = state.previousSelection;
	const target = getOrCreateConversation(state, prev.projectId, prev.laneId);
	const expanded = target.expanded;
	selectProject(state, prev.projectId, prev.laneId, prev.viewMode, currentScroll);
	target.expanded = expanded;
	state.selectedRequestId = prev.requestId;
	state.previousSelection = null;
	return true;
}

export function setConversationSnapshot(
	state: CompanionPresentationState,
	snapshot: CompanionConversationSnapshot
): void {
	const key = conversationKey(snapshot.projectId, snapshot.laneId);
	let conv = getOrCreateConversation(state, snapshot.projectId, snapshot.laneId);
	if (conv.snapshot && conv.snapshot.sessionId !== snapshot.sessionId) {
		// La bozza segue la conversazione letta, mai una nuova sessione dello stesso progetto.
		state.archivedConversations[
			sessionConversationKey(snapshot.projectId, snapshot.laneId, conv.snapshot.sessionId)
		] = conv;
		conv = state.archivedConversations[
			sessionConversationKey(snapshot.projectId, snapshot.laneId, snapshot.sessionId)
		] ?? createConversationState(snapshot.projectId, snapshot.laneId);
		state.conversations[key] = conv;
		conv = state.conversations[key];
	}
	if (conv.snapshot?.message?.id !== snapshot.message?.id) conv.scroll = 0;
	conv.snapshot = snapshot;
	conv.loadError = null;
}

export function toggleConversationExpanded(
	state: CompanionPresentationState,
	projectId: string,
	laneId = 'main',
	currentScroll = 0
): boolean {
	const conv = getOrCreateConversation(state, projectId, laneId);
	if (conv.expanded) {
		conv.scroll = currentScroll;
		conv.expanded = false;
	} else {
		conv.expanded = true;
	}
	return conv.expanded;
}

export function setConversationDraft(
	state: CompanionPresentationState,
	projectId: string,
	laneId = 'main',
	draft: string
): void {
	const conv = getOrCreateConversation(state, projectId, laneId);
	conv.draft = draft;
}

export function startSendingReply(
	state: CompanionPresentationState,
	projectId: string,
	laneId = 'main'
): void {
	const conv = getOrCreateConversation(state, projectId, laneId);
	conv.isSending = true;
	conv.sendError = null;
}

export function markReplySent(
	state: CompanionPresentationState,
	projectId: string,
	laneId = 'main',
	text: string,
	repliedMessageId?: string | null,
	repliedSessionId?: string
): void {
	const active = getOrCreateConversation(state, projectId, laneId);
	const conv = repliedSessionId && active.snapshot?.sessionId !== repliedSessionId
		? state.archivedConversations[sessionConversationKey(projectId, laneId, repliedSessionId)]
		: active;
	if (!conv) return;
	conv.isSending = false;
	conv.sendError = null;
	conv.lastSent = text;
	if (conv.draft.trim() === text) conv.draft = '';
	conv.lastRepliedMessageId = repliedMessageId === undefined
		? conv.snapshot?.message?.id ?? null
		: repliedMessageId;
}

export function setSendReplyError(
	state: CompanionPresentationState,
	projectId: string,
	laneId = 'main',
	error: string
): void {
	const conv = getOrCreateConversation(state, projectId, laneId);
	conv.isSending = false;
	conv.sendError = error;
	// Draft remains untouched!
}

export function isProjectUnread(
	state: CompanionPresentationState,
	projectId: string,
	laneId = 'main',
	agentState: string,
	hasAttention: boolean,
	latestAssistant?: CompanionAssistantReference | null
): boolean {
	if (hasAttention || agentState === 'working') return false;

	const active = state.conversations[conversationKey(projectId, laneId)];
	const conv = latestAssistant && active?.snapshot?.sessionId !== latestAssistant.sessionId
		? state.archivedConversations[
			sessionConversationKey(projectId, laneId, latestAssistant.sessionId)
		]
		: active;
	const assistantMessageId =
		latestAssistant?.messageId ?? conv?.snapshot?.message?.id ?? null;

	return Boolean(assistantMessageId && conv?.lastRepliedMessageId !== assistantMessageId);
}

export function getProjectStatusKey(
	hasAttention: boolean,
	agentState: string,
	isUnread: boolean
): 'question' | 'busy' | 'unread' | 'idle' {
	if (hasAttention) return 'question';
	if (agentState === 'working') return 'busy';
	if (isUnread) return 'unread';
	return 'idle';
}

export function buildGlobalQueueItems<T extends QueueTask>(
	projects: Array<{
		id: string;
		name: string;
		label?: string | null;
		hue: number;
		canonicalProjectPath?: string | null;
		lane: { agentState: string };
	}>,
	tasksByProject: Record<string, T[]>,
	runtimesByProject: Record<string, {
		canRunTask?: boolean;
		runBlockReason?: string;
		latestAssistant?: CompanionAssistantReference;
	}>,
	attentionProjectIds: Set<string>,
	unreadProjectIds: Set<string>,
	titleResolver: (task: T) => string,
	labels: {
		question: string;
		busy: string;
		unread: string;
		idle: string;
		reasonAttention: string;
		reasonBusy: string;
		reasonBlockedDefault: string;
	}
): GlobalQueueItemState<T>[] {
	const items: GlobalQueueItemState<T>[] = [];

	for (const project of projects) {
		const path = project.canonicalProjectPath;
		if (!path) continue;

		const tasks = tasksByProject[path] ?? [];
		const queued = tasks.filter((t) => t.status === 'queued');
		if (queued.length === 0) continue;

		const hasAttention = attentionProjectIds.has(project.id.toLowerCase());
		const isWorking = project.lane.agentState === 'working';
		const isUnread = unreadProjectIds.has(project.id.toLowerCase());
		const runtime = runtimesByProject[project.id];

		const statusKey = getProjectStatusKey(hasAttention, project.lane.agentState, isUnread);
		const statusLabel = labels[statusKey];

		let canRun = true;
		let disabledReason: string | undefined;

		if (hasAttention) {
			canRun = false;
			disabledReason = labels.reasonAttention;
		} else if (isWorking) {
			canRun = false;
			disabledReason = labels.reasonBusy;
		} else if (runtime?.canRunTask !== true) {
			canRun = false;
			disabledReason = runtime?.runBlockReason || labels.reasonBlockedDefault;
		}

		for (const task of queued) {
			items.push({
				task,
				taskId: task.id,
				taskTitle: titleResolver(task),
				projectId: project.id,
				projectName: project.label?.trim() || project.name,
				projectHue: project.hue,
				order: task.createdAt ?? 0,
				statusKey,
				statusLabel,
				canRun,
				disabledReason
			});
		}
	}

	// La coda globale e' una vista in ordine di inserimento, non un esecutore.
	items.sort((a, b) => a.order - b.order);
	return items;
}
