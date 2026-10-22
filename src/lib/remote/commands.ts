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
	RemoteSessionPage
} from '$remote-protocol';
import { remoteBridge, type RemoteCommandEvent } from './bridge';
import { remoteStore } from './remoteStore.svelte';
import { projectStore } from '$lib/stores/projects.svelte';
import { taskStore } from '$lib/stores/tasks.svelte';
import { promptBus } from '$lib/agent/promptBus';
import type { PromptAnswer } from '$lib/agent/askAnswers';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import type { UnlistenFn } from '@tauri-apps/api/event';
/** Esito strutturato dell'avvio di un task condiviso tra GUI, Companion e Controllo Remoto. */
export type RunTaskOutcome =
	| { kind: 'started' }
	| { kind: 'blocked'; reason: string }
	| { kind: 'needs_confirmation'; message?: string }
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
		options?: { follow?: boolean }
	) => Promise<RunTaskOutcome | void> | RunTaskOutcome | void;
	waitQuotaReset: (projectId: string, laneId?: string) => Promise<void> | void;
	dismissQuotaBlocked: (projectId: string, laneId?: string) => Promise<void> | void;
	createTask: (
		projectId: string,
		prompt: string,
		schedule: RemoteScheduleChoice | null
	) => Promise<{ taskId: string }>;
	updateTask: (projectId: string, taskId: string, patch: RemoteTaskPatch) => Promise<void>;
	deleteTask: (projectId: string, taskId: string) => Promise<void>;
	moveTask: (projectId: string, taskId: string, toIndex: number) => Promise<void>;
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
	newSession: (projectId: string, laneId: string | null, interrupt?: boolean) => Promise<void>;
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
	createLane: (
		projectId: string,
		title: string,
		prompt: string
	) => Promise<{ laneId: string }>;
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

const ACTION_LABELS: Record<RemoteCommand['kind'], string> = {
	respond_ui: 'risposto alla richiesta',
	run_task: 'avviato task',
	wait_quota_reset: 'messo in attesa reset quota',
	dismiss_quota_blocked: 'rimosso blocco quota',
	create_task: 'aggiunto task',
	update_task: 'modificato task',
	delete_task: 'eliminato task',
	move_task: 'spostato task',
	abort: 'interrotto l\'agente',
	send_prompt: 'scritto alla sessione',
	chat_history: 'letto la chat',
	list_project_folders: 'letto le cartelle',
	open_project: 'aperto il progetto',
	create_project: 'creato il progetto',
	new_session: 'avviato una nuova sessione',
	composer_catalog: 'richiesto il catalogo del composer',
	set_lane_role: 'impostato il ruolo',
	set_lane_model: 'impostato il modello',
	set_lane_thinking: 'impostato il livello di ragionamento',
	stage_attachment: 'salvato un allegato',
	refresh_context: 'aggiornato il contesto',
	compact_context: 'compattato il contesto',
	list_sessions: 'richiesto lo storico delle sessioni',
	session_history: 'letto la sessione storica',
	create_lane: 'creato una nuova corsia',
	mark_session_seen: 'aggiornato lo stato di completamento',
	get_artifact: 'aperto un\'anteprima'
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
	get_artifact: true
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
	const noticeText = `Controllo remoto (${device.name}): ${ACTION_LABELS[kind]} su "${project.name}"`;

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
			message: 'Controllo remoto disabilitato su questa macchina'
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
		}

		const project = ctx.findProject(command.projectId);
		if (!project) {
			throw new RemoteCommandFailure('not_found', `Progetto "${command.projectId}" non trovato`);
		}

		// Un task arriva da un dispositivo: deve essere di questo progetto e ancora in coda.
		const queuedTask = (taskId: string): CommandTaskInfo => {
			const task = ctx.findTask(taskId);
			if (!task) throw new RemoteCommandFailure('not_found', `Task "${taskId}" non trovato`);
			if (!taskBelongsToProject(task, project)) {
				throw new RemoteCommandFailure(
					'not_found',
					`Task "${taskId}" non appartiene al progetto "${command.projectId}"`
				);
			}
			if (task.status !== 'queued') {
				throw new RemoteCommandFailure(
					'rejected',
					`Task "${taskId}" non e' in coda (stato attuale: ${task.status ?? 'sconosciuto'})`
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
						`Richiesta interattiva "${command.requestId}" non trovata o gia' completata`
					);
				}
				break;
			}

			case 'run_task': {
				queuedTask(command.taskId);
				const outcome = await ctx.executor.runTask(command.projectId, command.taskId, { follow: false });
				if (outcome && typeof outcome === 'object' && 'kind' in outcome) {
					switch (outcome.kind) {
						case 'started':
							break;
						case 'blocked':
							throw new RemoteCommandFailure('rejected', outcome.reason || 'Automazione bloccata');
						case 'needs_confirmation':
							throw new RemoteCommandFailure(
								'rejected',
								outcome.message || 'Conferma richiesta sulla macchina'
							);
						case 'failed':
							throw new RemoteCommandFailure('failed', outcome.message || 'Spedizione del task fallita');
					}
				}
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

			case 'create_task':
				data = await ctx.executor.createTask(command.projectId, command.prompt, command.schedule);
				break;

			case 'update_task': {
				queuedTask(command.taskId);
				const patch: RemoteTaskPatch = {};
				if (command.prompt !== undefined) patch.prompt = command.prompt;
				if (command.schedule !== undefined) patch.schedule = command.schedule;
				await ctx.executor.updateTask(command.projectId, command.taskId, patch);
				break;
			}

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

			case 'new_session':
				laneId = command.laneId;
				await ctx.executor.newSession(command.projectId, command.laneId, command.interrupt === true);
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

			case 'create_lane':
				data = await ctx.executor.createLane(
					command.projectId,
					command.title,
					command.prompt
				);
				if (
					data &&
					typeof data === 'object' &&
					'laneId' in data &&
					typeof (data as { laneId: string }).laneId === 'string'
				) {
					laneId = (data as { laneId: string }).laneId;
				}
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
