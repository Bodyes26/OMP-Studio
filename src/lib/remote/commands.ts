/**
 * Gestione dei comandi remoti ricevuti dal relay (Gate R44).
 *
 * Riceve RemoteCommandEvent da remoteBridge.onCommand, valida stato, progetto e task,
 * instrada verso promptBus o i gestori esecutivi di Studio, risponde sempre
 * con remoteBridge.commandResult e mostra un avviso locale in-app (non OS).
 */

import type { DeviceInfo, RemoteCommand, RemoteAnswer, CommandError } from '$remote-protocol';
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

export interface RemoteCommandExecutor {
	runTask: (
		projectId: string,
		taskId: string,
		options?: { follow?: boolean }
	) => Promise<RunTaskOutcome | void> | RunTaskOutcome | void;
	waitQuotaReset: (projectId: string, laneId?: string) => Promise<void> | void;
	dismissQuotaBlocked: (projectId: string, laneId?: string) => Promise<void> | void;
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
	reportResult: (commandId: string, ok: boolean, error?: CommandError) => Promise<void>;
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
	const actionLabel =
		kind === 'run_task'
			? 'avviato task'
			: kind === 'respond_ui'
				? 'risposto alla richiesta'
				: kind === 'wait_quota_reset'
					? 'messo in attesa reset quota'
					: 'rimosso blocco quota';

	const noticeText = `Controllo remoto (${device.name}): ${actionLabel} su "${project.name}"`;

	const session =
		sessionRegistry.getLaneSession(project.id, laneId ?? 'main') ??
		sessionRegistry.getMainSession(project.id);
	if (session) {
		session.flashNotice('info', noticeText);
		session.pushNotice('info', noticeText, 'remote');
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
			message: 'Controllo remoto disabilitato su questa macchina'
		});
		return;
	}

	const project = ctx.findProject(command.projectId);
	if (!project) {
		await ctx.reportResult(commandId, false, {
			code: 'not_found',
			message: `Progetto "${command.projectId}" non trovato`
		});
		return;
	}

	switch (command.kind) {
		case 'respond_ui': {
			let handled = false;
			if (ctx.resolvePrompt) {
				handled = await ctx.resolvePrompt({
					projectId: command.projectId,
					requestId: command.requestId,
					laneId: command.laneId,
					answer: command.answer
				});
			}

			if (!handled) {
				await ctx.reportResult(commandId, false, {
					code: 'not_found',
					message: `Richiesta interattiva "${command.requestId}" non trovata o gia' completata`
				});
				return;
			}

			await ctx.reportResult(commandId, true);
			ctx.notify?.(device, project, command.kind, command.laneId);
			break;
		}

		case 'run_task': {
			const task = ctx.findTask(command.taskId);
			if (!task) {
				await ctx.reportResult(commandId, false, {
					code: 'not_found',
					message: `Task "${command.taskId}" non trovato`
				});
				return;
			}
			if (!taskBelongsToProject(task, project)) {
				await ctx.reportResult(commandId, false, {
					code: 'not_found',
					message: `Task "${command.taskId}" non appartiene al progetto "${command.projectId}"`
				});
				return;
			}

			if (task.status !== 'queued') {
				await ctx.reportResult(commandId, false, {
					code: 'rejected',
					message: `Task "${command.taskId}" non e' in coda (stato attuale: ${task.status ?? 'sconosciuto'})`
				});
				return;
			}

			try {
				const outcome = await ctx.executor.runTask(command.projectId, command.taskId, { follow: false });
				if (outcome && typeof outcome === 'object' && 'kind' in outcome) {
					switch (outcome.kind) {
						case 'started':
							await ctx.reportResult(commandId, true);
							ctx.notify?.(device, project, command.kind, null);
							break;
						case 'blocked':
							await ctx.reportResult(commandId, false, {
								code: 'rejected',
								message: outcome.reason || 'Automazione bloccata'
							});
							break;
						case 'needs_confirmation':
							await ctx.reportResult(commandId, false, {
								code: 'rejected',
								message: outcome.message || 'Conferma richiesta sulla macchina'
							});
							break;
						case 'failed':
							await ctx.reportResult(commandId, false, {
								code: 'failed',
								message: outcome.message || 'Spedizione del task fallita'
							});
							break;
					}
				} else {
					await ctx.reportResult(commandId, true);
					ctx.notify?.(device, project, command.kind, null);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await ctx.reportResult(commandId, false, {
					code: 'failed',
					message
				});
			}
			break;
		}

		case 'wait_quota_reset': {
			try {
				await ctx.executor.waitQuotaReset(command.projectId, command.laneId ?? undefined);
				await ctx.reportResult(commandId, true);
				ctx.notify?.(device, project, command.kind, command.laneId);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await ctx.reportResult(commandId, false, {
					code: 'failed',
					message
				});
			}
			break;
		}

		case 'dismiss_quota_blocked': {
			try {
				await ctx.executor.dismissQuotaBlocked(command.projectId, command.laneId ?? undefined);
				await ctx.reportResult(commandId, true);
				ctx.notify?.(device, project, command.kind, command.laneId);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await ctx.reportResult(commandId, false, {
					code: 'failed',
					message
				});
			}
			break;
		}
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
		reportResult: async (commandId, ok, error) => {
			await remoteBridge.commandResult(commandId, ok, error);
		},
		notify: notifyRemoteCommandExecuted
	};

	return remoteBridge.onCommand((event) => {
		void handleRemoteCommand(event, prodContext);
	});
}
