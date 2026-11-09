/**
 * Gestione dei comandi remoti ricevuti dal relay (Gate R44).
 *
 * Riceve RemoteCommandEvent da remoteBridge.onCommand, valida stato, progetto e task,
 * instrada verso promptBus o i gestori esecutivi di Studio, risponde sempre
 * con remoteBridge.commandResult e mostra un avviso locale in-app (non OS).
 */

import type {
	CommandError,
	CommandErrorCode,
	DeviceInfo,
	RemoteAnswer,
	RemoteArtifact,
	RemoteChatPage,
	RemoteCommand,
	RemoteComposerCatalog,
	RemotePromptImage,
	RemoteFolderList,
	RemoteScheduleChoice,
	RemoteSessionPage,
	RemoteTaskOptions,
	RemoteTaskDetail,
	RemoteDispatchAnswer,
	RemoteDispatchOutcome,
	RemoteDispatchDestination
} from '$remote-protocol';
import { remoteBridge, type RemoteCommandEvent } from './bridge';
import { remoteStore } from './remoteStore.svelte';
import { projectStore } from '#lib/stores/projects.svelte.ts';
import { taskStore } from '#lib/stores/tasks.svelte.ts';
import { promptBus } from '#lib/agent/promptBus.ts';
import type { PromptAnswer } from '#lib/agent/askAnswers.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { m } from '#lib/paraglide/messages.js';
import { isAskFormSubmission } from '#lib/agent/askForm.ts';
/** Esito strutturato dell'avvio di un task condiviso tra GUI, Companion e Controllo Remoto. */
export type RunTaskOutcome =
	| { kind: 'started'; laneId?: string }
	| { kind: 'blocked'; reason: string }
	| { kind: 'needs_confirmation'; confirmationId?: string; message?: string }
	| { kind: 'failed'; message: string };

/**
 * Rifiuto di un comando con il suo codice: gli esecutori la lanciano quando
 * l'azione non si puo' fare (`not_found`, `rejected`...). Ogni altro errore
 * arriva al dispositivo come `failed`.
 */
export class RemoteCommandFailure extends Error {
	readonly code: CommandErrorCode;
	constructor(code: CommandErrorCode, message: string) {
		super(message);
		this.name = 'RemoteCommandFailure';
		this.code = code;
	}
}

export interface RemoteTaskPatch {
	prompt?: string;
	schedule?: RemoteScheduleChoice | null;
	options?: RemoteTaskOptions;
	images?: { keep: number[]; add: RemotePromptImage[] };
}

/**
 * Azioni di Studio dietro ai comandi. Le validazioni comuni (controllo remoto
 * acceso, progetto esistente, task del progetto e ancora in coda) le fa
 * `handleRemoteCommand` prima di chiamarle.
 */
export interface RemoteCommandExecutor {
	runTask: (
		projectId: string,
		taskId: string,
		options?: { follow?: boolean; destination?: RemoteDispatchDestination }
	) => Promise<RunTaskOutcome | void> | RunTaskOutcome | void;
	waitQuotaReset: (projectId: string, laneId?: string) => Promise<void> | void;
	dismissQuotaBlocked: (projectId: string, laneId?: string) => Promise<void> | void;
	createTask: (
		projectId: string,
		prompt: string,
		schedule: RemoteScheduleChoice | null,
		options?: RemoteTaskOptions,
		images?: RemotePromptImage[]
	) => Promise<{ taskId: string }>;
	updateTask: (projectId: string, taskId: string, patch: RemoteTaskPatch) => Promise<void>;
	deleteTask: (projectId: string, taskId: string) => Promise<void>;
	moveTask: (projectId: string, taskId: string, toIndex: number) => Promise<void>;
	getTask: (projectId: string, taskId: string) => Promise<RemoteTaskDetail>;
	respondDispatch: (
		projectId: string,
		confirmationId: string,
		answer: RemoteDispatchAnswer
	) => Promise<RemoteDispatchOutcome | undefined>;
	refreshQuota: () => Promise<void>;
	abort: (projectId: string, laneId: string | null) => Promise<void>;
	sendPrompt: (
		projectId: string,
		laneId: string | null,
		text: string,
		whileBusy: 'steer' | 'follow_up',
		images?: RemotePromptImage[],
		attachments?: Array<{ path: string; name: string }>
	) => Promise<void>;
	stageAttachment: (
		projectId: string,
		laneId: string | null,
		fileName: string,
		data: string,
		chunkIndex?: number,
		totalChunks?: number,
		stageId?: string
	) => Promise<{ path: string; name: string; size: number }>;
	refreshContext: (projectId: string, laneId: string | null, force?: boolean) => Promise<{ success: true }>;
	compactContext: (projectId: string, laneId: string | null) => Promise<{ success: true }>;
	getArtifact: (
		projectId: string,
		laneId: string | null,
		messageId: string
	) => Promise<{ artifact: RemoteArtifact }>;
	chatHistory: (
		projectId: string,
		laneId: string | null,
		before: string | null,
		limit: number
	) => Promise<RemoteChatPage>;
	listProjectFolders: () => Promise<RemoteFolderList>;
	/** La cartella va verificata sotto la radice dei progetti: il percorso arriva da un dispositivo. */
	openProject: (path: string) => Promise<{ projectId: string }>;
	createProject: (
		name: string,
		github: { visibility: 'private' | 'public' } | null
	) => Promise<{ projectId: string }>;
	composerCatalog: (projectId: string, laneId: string | null) => Promise<RemoteComposerCatalog>;
	setLaneRole: (projectId: string, laneId: string | null, roleId: string) => Promise<void>;
	setLaneModel: (
		projectId: string,
		laneId: string | null,
		provider: string,
		modelId: string
	) => Promise<void>;
	setLaneThinking: (projectId: string, laneId: string | null, level: string) => Promise<void>;
	listSessions: (
		projectId: string,
		before: string | null,
		limit: number,
		query?: string
	) => Promise<RemoteSessionPage>;
	sessionHistory: (
		projectId: string,
		sessionId: string,
		before: string | null,
		limit: number
	) => Promise<RemoteChatPage>;
	markSessionSeen: (
		projectId: string,
		laneId: string | null,
		sessionId: string,
		completionId: string
	) => Promise<void>;
}

export interface CommandProjectInfo {
	id: string;
	name: string;
	canonicalProjectPath?: string | null;
}

export interface CommandTaskInfo {
	id: string;
	projectPath?: string;
	status?: string;
}

export interface CommandContext {
	isEnabled: () => boolean;
	findProject: (id: string) => CommandProjectInfo | undefined;
	findTask: (id: string) => CommandTaskInfo | undefined;
	executor: RemoteCommandExecutor;
	resolvePrompt?: (params: {
		projectId: string;
		requestId: string;
		laneId: string | null;
		answer: RemoteAnswer;
	}) => Promise<boolean>;
	reportResult: (commandId: string, ok: boolean, error?: CommandError, data?: unknown) => Promise<void>;
	notify?: (
		device: DeviceInfo,
		project: { id: string; name: string },
		kind: RemoteCommand['kind'],
		laneId?: string | null
	) => void;
}

/**
 * Verifica se un task appartiene al progetto del comando confrontando percorsi e identificatori.
 */
export function taskBelongsToProject(
	task: CommandTaskInfo,
	project: CommandProjectInfo
): boolean {
	if (!task.projectPath) return false;
	const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
	const tNorm = normalize(task.projectPath);
	if (tNorm === normalize(project.id)) return true;
	if (project.canonicalProjectPath && tNorm === normalize(project.canonicalProjectPath)) {
		return true;
	}
	return false;
}

// Etichette risolte a ogni uso: la lingua cambia a runtime senza ricaricare la WebView.
const ACTION_LABEL_KEYS: Record<RemoteCommand['kind'], () => string> = {
	respond_ui: () => m.l10n_lab_remote_action_respond_ui(),
	run_task: () => m.l10n_lab_remote_action_run_task(),
	wait_quota_reset: () => m.l10n_lab_remote_action_wait_quota_reset(),
	dismiss_quota_blocked: () => m.l10n_lab_remote_action_dismiss_quota_blocked(),
	create_task: () => m.l10n_lab_remote_action_create_task(),
	update_task: () => m.l10n_lab_remote_action_update_task(),
	delete_task: () => m.l10n_lab_remote_action_delete_task(),
	move_task: () => m.l10n_lab_remote_action_move_task(),
	get_task: () => m.l10n_lab_remote_action_get_task(),
	respond_dispatch: () => m.l10n_lab_remote_action_respond_dispatch(),
	refresh_quota: () => m.l10n_lab_remote_action_refresh_quota(),
	abort: () => m.l10n_lab_remote_action_abort(),
	send_prompt: () => m.l10n_lab_remote_action_send_prompt(),
	chat_history: () => m.l10n_lab_remote_action_chat_history(),
	list_project_folders: () => m.l10n_lab_remote_action_list_project_folders(),
	open_project: () => m.l10n_lab_remote_action_open_project(),
	create_project: () => m.l10n_lab_remote_action_create_project(),
	composer_catalog: () => m.l10n_lab_remote_action_composer_catalog(),
	set_lane_role: () => m.l10n_lab_remote_action_set_lane_role(),
	set_lane_model: () => m.l10n_lab_remote_action_set_lane_model(),
	set_lane_thinking: () => m.l10n_lab_remote_action_set_lane_thinking(),
	stage_attachment: () => m.l10n_lab_remote_action_stage_attachment(),
	refresh_context: () => m.l10n_lab_remote_action_refresh_context(),
	compact_context: () => m.l10n_lab_remote_action_compact_context(),
	list_sessions: () => m.l10n_lab_remote_action_list_sessions(),
	session_history: () => m.l10n_lab_remote_action_session_history(),
	mark_session_seen: () => m.l10n_lab_remote_action_mark_session_seen(),
	get_artifact: () => m.l10n_lab_remote_action_get_artifact()
};

/** Le letture non lasciano traccia: avvisano solo le azioni che cambiano qualcosa. */
const SILENT_KINDS: Partial<Record<RemoteCommand['kind'], true>> = {
	chat_history: true,
	list_project_folders: true,
	composer_catalog: true,
	stage_attachment: true,
	list_sessions: true,
	session_history: true,
	mark_session_seen: true,
	get_artifact: true,
	get_task: true
};
/**
 * Notifica in-app dell'avvenuta esecuzione di un comando remoto, registrata
 * sul transcript della sessione e segnalata sul composer (senza notifiche di sistema).
 */
export function notifyRemoteCommandExecuted(
	device: DeviceInfo,
	project: { id: string; name: string },
	kind: RemoteCommand['kind'],
	laneId?: string | null
): void {
	if (SILENT_KINDS[kind]) return;
	const noticeText = m.l10n_lab_remote_remote_notice({
		device: device.name,
		action: ACTION_LABEL_KEYS[kind](),
		project: project.name
	});

	const session =
		sessionRegistry.getLaneSession(project.id, laneId ?? 'main') ??
		sessionRegistry.getMainSession(project.id);
	if (session) {
		session.flashNotice('info', noticeText);
		session.pushNotice('info', noticeText, 'remote');
	}
}

function toCommandError(err: unknown): CommandError {
	if (err instanceof RemoteCommandFailure) return { code: err.code, message: err.message };
	return { code: 'failed', message: err instanceof Error ? err.message : String(err) };
}

/**
 * Esito dell'avvio per il dispositivo: partito (con il ramo da aprire) o in
 * attesa di una conferma gia' pubblicata nell'istantanea. Un blocco o un
 * errore diventano il rifiuto del comando.
 */
export function toDispatchOutcome(outcome: RunTaskOutcome | void): RemoteDispatchOutcome | undefined {
	if (!outcome) return undefined;
	switch (outcome.kind) {
		case 'started':
			return { status: 'started', laneId: outcome.laneId ?? 'main' };
		case 'needs_confirmation':
			if (!outcome.confirmationId) {
				throw new RemoteCommandFailure('rejected', outcome.message || m.l10n_lab_remote_confirm_required());
			}
			return { status: 'confirm', confirmationId: outcome.confirmationId };
		case 'blocked':
			throw new RemoteCommandFailure('rejected', outcome.reason || m.l10n_lab_remote_automation_blocked());
		case 'failed':
			throw new RemoteCommandFailure('failed', outcome.message || m.l10n_lab_remote_task_dispatch_failed());
	}
}

/**
 * Esegue la logica di gestione di un comando remoto su un contesto iniettabile.
 * Isolata e testabile senza runtime Tauri.
 */
export async function handleRemoteCommand(
	event: RemoteCommandEvent,
	ctx: CommandContext
): Promise<void> {
	const { commandId, device, command } = event;

	if (!ctx.isEnabled()) {
		await ctx.reportResult(commandId, false, {
			code: 'disabled',
			message: m.l10n_lab_remote_remote_disabled()
		});
		return;
	}

	try {
		// Comandi che non riguardano un progetto aperto.
		switch (command.kind) {
			case 'list_project_folders': {
				await ctx.reportResult(commandId, true, undefined, await ctx.executor.listProjectFolders());
				return;
			}
			case 'open_project':
			case 'create_project': {
				const data =
					command.kind === 'open_project'
						? await ctx.executor.openProject(command.path)
						: await ctx.executor.createProject(command.name, command.github);
				await ctx.reportResult(commandId, true, undefined, data);
				const opened = ctx.findProject(data.projectId);
				if (opened) ctx.notify?.(device, opened, command.kind, null);
				return;
			}
			case 'refresh_quota': {
				await ctx.executor.refreshQuota();
				await ctx.reportResult(commandId, true);
				return;
			}
		}

		const project = ctx.findProject(command.projectId);
		if (!project) {
			throw new RemoteCommandFailure(
				'not_found',
				m.l10n_lab_remote_project_not_found({ project: command.projectId })
			);
		}

		// Un task arriva da un dispositivo: deve essere di questo progetto e ancora in coda.
		const queuedTask = (taskId: string): CommandTaskInfo => {
			const task = ctx.findTask(taskId);
			if (!task) {
				throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_task_not_found({ task: taskId }));
			}
			if (!taskBelongsToProject(task, project)) {
				throw new RemoteCommandFailure(
					'not_found',
					m.l10n_lab_remote_task_not_in_project({ task: taskId, project: command.projectId })
				);
			}
			if (task.status !== 'queued') {
				throw new RemoteCommandFailure(
					'rejected',
					m.l10n_lab_remote_task_not_queued({
						task: taskId,
						status: task.status ?? m.l10n_lab_remote_status_unknown()
					})
				);
			}
			return task;
		};

		let data: unknown;
		let laneId: string | null = null;
		switch (command.kind) {
			case 'respond_ui': {
				laneId = command.laneId;
				const handled = ctx.resolvePrompt
					? await ctx.resolvePrompt({
							projectId: command.projectId,
							requestId: command.requestId,
							laneId: command.laneId,
							answer: command.answer
						})
					: false;
				if (!handled) {
					throw new RemoteCommandFailure(
						'not_found',
						m.l10n_lab_remote_interactive_request_not_found({ request: command.requestId })
					);
				}
				break;
			}

			case 'run_task': {
				queuedTask(command.taskId);
				const outcome = await ctx.executor.runTask(command.projectId, command.taskId, {
					follow: false,
					destination: command.destination ?? 'auto'
				});
				data = toDispatchOutcome(outcome);
				break;
			}

			case 'wait_quota_reset':
				laneId = command.laneId;
				await ctx.executor.waitQuotaReset(command.projectId, command.laneId ?? undefined);
				break;

			case 'dismiss_quota_blocked':
				laneId = command.laneId;
				await ctx.executor.dismissQuotaBlocked(command.projectId, command.laneId ?? undefined);
				break;

			case 'create_task': {
				const result = await ctx.executor.createTask(
					command.projectId,
					command.prompt,
					command.schedule,
					command.options,
					command.images
				);
				// Il lavoro e' gia' salvato: se l'avvio viene rifiutato resta in coda.
				if (command.start) {
					const outcome = await ctx.executor.runTask(command.projectId, result.taskId, {
						follow: false,
						destination: command.start.destination
					});
					data = { taskId: result.taskId, dispatch: toDispatchOutcome(outcome) };
				} else {
					data = { taskId: result.taskId };
				}
				break;
			}

			case 'update_task': {
				queuedTask(command.taskId);
				const patch: RemoteTaskPatch = {};
				if (command.prompt !== undefined) patch.prompt = command.prompt;
				if (command.schedule !== undefined) patch.schedule = command.schedule;
				if (command.options !== undefined) patch.options = command.options;
				if (command.images !== undefined) patch.images = command.images;
				await ctx.executor.updateTask(command.projectId, command.taskId, patch);
				break;
			}

			case 'get_task':
				queuedTask(command.taskId);
				data = await ctx.executor.getTask(command.projectId, command.taskId);
				break;

			case 'respond_dispatch':
				data = await ctx.executor.respondDispatch(
					command.projectId,
					command.confirmationId,
					command.answer
				);
				break;

			case 'delete_task':
				queuedTask(command.taskId);
				await ctx.executor.deleteTask(command.projectId, command.taskId);
				break;

			case 'move_task':
				queuedTask(command.taskId);
				await ctx.executor.moveTask(command.projectId, command.taskId, command.toIndex);
				break;

			case 'abort':
				laneId = command.laneId;
				await ctx.executor.abort(command.projectId, command.laneId);
				break;

			case 'send_prompt':
				laneId = command.laneId;
				await ctx.executor.sendPrompt(
					command.projectId,
					command.laneId,
					command.text,
					command.whileBusy,
					command.images,
					command.attachments
				);
				break;

			case 'stage_attachment':
				laneId = command.laneId;
				data = await ctx.executor.stageAttachment(
					command.projectId,
					command.laneId,
					command.fileName,
					command.data,
					command.chunkIndex,
					command.totalChunks,
					command.stageId
				);
				break;

			case 'refresh_context':
				laneId = command.laneId;
				data = await ctx.executor.refreshContext(command.projectId, command.laneId, command.force);
				break;

			case 'compact_context':
				laneId = command.laneId;
				data = await ctx.executor.compactContext(command.projectId, command.laneId);
				break;

			case 'chat_history':
				data = await ctx.executor.chatHistory(
					command.projectId,
					command.laneId,
					command.before,
					command.limit
				);
				break;

			case 'get_artifact':
				laneId = command.laneId;
				data = await ctx.executor.getArtifact(command.projectId, command.laneId, command.messageId);
				break;


			case 'composer_catalog':
				laneId = command.laneId;
				data = await ctx.executor.composerCatalog(command.projectId, command.laneId);
				break;

			case 'set_lane_role':
				laneId = command.laneId;
				await ctx.executor.setLaneRole(command.projectId, command.laneId, command.roleId);
				break;

			case 'set_lane_model':
				laneId = command.laneId;
				await ctx.executor.setLaneModel(
					command.projectId,
					command.laneId,
					command.provider,
					command.modelId
				);
				break;

			case 'set_lane_thinking':
				laneId = command.laneId;
				await ctx.executor.setLaneThinking(command.projectId, command.laneId, command.level);
				break;

			case 'list_sessions':
				data = await ctx.executor.listSessions(
					command.projectId,
					command.before,
					command.limit,
					command.query
				);
				break;

			case 'session_history':
				data = await ctx.executor.sessionHistory(
					command.projectId,
					command.sessionId,
					command.before,
					command.limit
				);
				break;


			case 'mark_session_seen':
				laneId = command.laneId;
				await ctx.executor.markSessionSeen(
					command.projectId,
					command.laneId,
					command.sessionId,
					command.completionId
				);
				data = { success: true };
				break;
		}

		await ctx.reportResult(commandId, true, undefined, data);
		ctx.notify?.(device, project, command.kind, laneId);
	} catch (err) {
		await ctx.reportResult(commandId, false, toCommandError(err));
	}
}

export interface RemoteCommandSetupOptions {
	clearAttentionRequest?: (projectId: string, laneId: string | null) => void;
}

/**
 * Crea il risolutore di richieste interattive per i comandi remoti.
 * Richiede corrispondenza esatta dell'id richiesta, del progetto e della corsia;
 * non applica fallback permissivi verso altre richieste pendenti nel progetto.
 */
export function createRemotePromptResolver(options: RemoteCommandSetupOptions = {}) {
	return async ({
		projectId,
		requestId,
		laneId,
		answer
	}: {
		projectId: string;
		requestId: string;
		laneId: string | null;
		answer: RemoteAnswer;
	}): Promise<boolean> => {
		if (answer.action === 'form' && !isAskFormSubmission(answer.submission)) {
			return false;
		}
		const promptAnswer = answer as unknown as PromptAnswer;
		if (!requestId) return false;
		const pending = promptBus.getRequest(requestId);
		if (!pending || pending.status !== 'pending') return false;

		// Verifica rigorosa che la richiesta appartenga allo stesso progetto
		if (pending.projectId.trim().toLowerCase() !== projectId.trim().toLowerCase()) {
			return false;
		}

		// Verifica rigorosa che la corsia coincida (null/undefined/vuoto corrispondono alla Principale)
		const expectedLane = (pending.laneId ?? 'main').trim().toLowerCase();
		const commandLane = (laneId ?? 'main').trim().toLowerCase();
		if (expectedLane !== commandLane) {
			return false;
		}

		const handled = await promptBus.resolveRequest(requestId, promptAnswer, {
			projectId,
			laneId: laneId ?? undefined
		});
		if (handled) {
			options.clearAttentionRequest?.(projectId, laneId);
			return true;
		}
		return false;
	};
}

/**
 * Registra il listener Tauri globale per i comandi remoti e collega gli store di produzione.
 */
export async function setupRemoteCommands(
	executor: RemoteCommandExecutor,
	options: RemoteCommandSetupOptions = {}
): Promise<UnlistenFn> {
	const prodContext: CommandContext = {
		isEnabled: () => remoteStore.status.enabled,
		findProject: (id) => projectStore.projects.find((p) => p.id === id),
		findTask: (id) => taskStore.taskById(id),
		executor,
		resolvePrompt: createRemotePromptResolver(options),
		reportResult: async (commandId, ok, error, data) => {
			await remoteBridge.commandResult(commandId, ok, error, data);
		},
		notify: notifyRemoteCommandExecuted
	};

	return remoteBridge.onCommand((event) => {
		void handleRemoteCommand(event, prodContext);
	});
}
