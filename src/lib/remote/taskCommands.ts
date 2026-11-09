/**
 * Gestione dei task da remoto (Gate R44, R5): creare, modificare, programmare,
 * spostare ed eliminare task in coda. `handleRemoteCommand` ha gia' verificato
 * progetto, appartenenza del task e stato in coda.
 */

import { invoke } from '@tauri-apps/api/core';
import { m } from '#lib/paraglide/messages.js';
import type {
	RemoteScheduleChoice,
	RemoteTaskOptions,
	RemotePromptImage,
	RemoteTaskDetail,
	RemoteTaskImage,
	RemoteTaskSchedule
} from '$remote-protocol';
import { TASK_DETAIL_MAX_BYTES } from '$remote-protocol';
import { RemoteCommandFailure, type RemoteTaskPatch } from './commands';
import { projectStore } from '#lib/stores/projects.svelte.ts';
import { taskStore, type StudioTask, type TaskSchedule } from '#lib/stores/tasks.svelte.ts';
import { buildAtSchedule } from '#lib/quota/scheduleTarget.ts';
import { requestTaskTitle } from '#lib/stores/backgroundJobs.svelte.ts';
import type { DroppedImage } from '#lib/agent/chatDrop.ts';
import type { ImageContent } from '#lib/agent/wire.ts';
import type { StudioTaskOptions } from '#lib/stores/taskSerialization.ts';
import { createDirectiveSnapshot, type TaskDirectiveSnapshot } from '#lib/stores/taskDirectives.ts';
import { settingsStore } from '#lib/stores/settings.svelte.ts';
import { STANDARD_ROLE_METAS } from '#lib/stores/modelSettingsHelpers.ts';
import { roleConfigFromSelector } from '#lib/components/taskRoleConfig.ts';
const MAX_PROMPT_LENGTH = 20_000;
/** Margine di tolleranza per sfasamento orologio client/host (60 secondi). */
const SKEW_TOLERANCE_MS = 60_000;
/** Limite massimo nel futuro per una programmazione ad orario (365 giorni). */
const MAX_FUTURE_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000;

export interface TaskCommandDeps {
	findProject: (projectId: string) => { id: string; canonicalProjectPath?: string | null; taskDefaults?: { role?: string } | null } | undefined;
	loadProject: (projectPath: string) => Promise<boolean>;
	createTask: (projectPath: string) => StudioTask;
	taskById: (taskId: string) => StudioTask | undefined;
	tasksFor: (projectPath: string) => StudioTask[];
	updateTask: (taskId: string, prompt: string, images?: ImageContent[], options?: StudioTaskOptions) => void;
	updatePrompt: (taskId: string, prompt: string) => void;
	deleteTask: (taskId: string) => void;
	setSchedule: (taskId: string, schedule: TaskSchedule | undefined) => void;
	moveTaskToIndex: (taskId: string, toIndex: number) => void;
	buildResetSchedule: (task: Pick<StudioTask, 'options'>) => TaskSchedule | null;
	requestTaskTitle?: (taskId: string) => void;
	/**
	 * Ruoli configurati (`ruolo -> provider/id[:thinking]`) e selettori noti. Li
	 * passa chi crea i comandi: lo store dei modelli trascina il terminale, che
	 * qui non serve.
	 */
	roleModels?: () => Readonly<Record<string, string>>;
	knownSelectors?: () => ReadonlySet<string>;
	/** Orario e provider attuali della programmazione, come nell'istantanea. */
	scheduleTarget?: (task: StudioTask) => { dueAt?: number; provider?: string } | undefined;
	now?: () => number;
}

const defaultDeps: TaskCommandDeps = {
	findProject: (projectId: string) => projectStore.projects.find((p) => p.id === projectId),
	loadProject: (projectPath: string) => taskStore.loadProject(projectPath),
	createTask: (projectPath: string) => taskStore.createTask(projectPath),
	taskById: (taskId: string) => taskStore.taskById(taskId),
	tasksFor: (projectPath: string) => taskStore.tasksFor(projectPath),
	updateTask: (taskId: string, prompt: string, images?: ImageContent[], options?: StudioTaskOptions) =>
		taskStore.updateTask(taskId, prompt, images, options),
	updatePrompt: (taskId: string, prompt: string) => taskStore.updatePrompt(taskId, prompt),
	deleteTask: (taskId: string) => taskStore.deleteTask(taskId),
	setSchedule: (taskId: string, schedule: TaskSchedule | undefined) =>
		taskStore.setSchedule(taskId, schedule),
	moveTaskToIndex: (taskId: string, toIndex: number) => taskStore.moveTaskToIndex(taskId, toIndex),
	buildResetSchedule: () => null,
	requestTaskTitle: (taskId: string) => requestTaskTitle(taskId),
	now: () => Date.now()
};

function validatePrompt(prompt: unknown): string {
	if (typeof prompt !== 'string') {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_prompt_invalid_type());
	}
	const trimmed = prompt.trim();
	if (trimmed.length === 0) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_prompt_empty());
	}
	if (prompt.length > MAX_PROMPT_LENGTH) {
		throw new RemoteCommandFailure(
			'rejected',
			m.l10n_lab_remote_prompt_too_long({
				length: String(prompt.length),
				max: String(MAX_PROMPT_LENGTH)
			})
		);
	}
	return prompt;
}

function validateAtSchedule(notBefore: unknown, now: number): number {
	if (typeof notBefore !== 'number' || !Number.isFinite(notBefore)) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_schedule_invalid());
	}
	if (notBefore < now - SKEW_TOLERANCE_MS) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_schedule_past());
	}
	if (notBefore > now + MAX_FUTURE_SCHEDULE_MS) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_schedule_too_far());
	}
	return notBefore;
}

function resolveSchedule(
	choice: RemoteScheduleChoice | null | undefined,
	task: Pick<StudioTask, 'options'>,
	deps: TaskCommandDeps
): TaskSchedule | undefined {
	if (!choice) return undefined;
	const currentNow = deps.now ? deps.now() : Date.now();

	if (choice.kind === 'reset') {
		const resolved = deps.buildResetSchedule(task);
		if (!resolved) {
			throw new RemoteCommandFailure(
				'rejected',
				m.l10n_lab_remote_quota_provider_missing()
			);
		}
		return resolved;
	}

	if (choice.kind === 'at') {
		const validNotBefore = validateAtSchedule(choice.notBefore, currentNow);
		return buildAtSchedule(validNotBefore, currentNow);
	}

	throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_schedule_kind_unknown());
}

export async function resolvePromptImages(images: RemotePromptImage[]): Promise<ImageContent[]> {
	const result: ImageContent[] = [];
	for (const img of images) {
		if (img.data) {
			result.push({
				type: 'image',
				data: img.data,
				mimeType: img.mimeType || 'image/jpeg'
			});
		} else if (img.path) {
			try {
				const dropped = await invoke<DroppedImage>('chat_attachment_read_image', { path: img.path });
				result.push({
					type: 'image',
					data: dropped.base64,
					mimeType: dropped.mimeType || img.mimeType || 'image/jpeg'
				});
			} catch (err) {
				throw new RemoteCommandFailure(
					'failed',
					m.l10n_lab_remote_attachment_image_read_failed({
						error: err instanceof Error ? err.message : String(err)
					})
				);
			}
		}
	}
	return result;
}

function resolveRoleDefault(project?: { taskDefaults?: { role?: string } | null }): string {
	return project?.taskDefaults?.role || 'default';
}

function resolveRoleConfig(deps: TaskCommandDeps, roleId: string): { model: string; thinking: string } {
	return roleConfigFromSelector(deps.roleModels?.()[roleId] ?? '', deps.knownSelectors?.());
}

/**
 * Applica alle opzioni del task quelle arrivate dal dispositivo, con le stesse
 * regole del TaskEditor: un ruolo nuovo porta il suo modello e ragionamento,
 * `null` torna al valore del ruolo. Prewalk e contesto editor restano.
 */
function validateAndNormalizeOptions(
	deps: TaskCommandDeps,
	options: RemoteTaskOptions,
	defaultRole: string,
	existingOptions?: StudioTaskOptions
): StudioTaskOptions {
	const result: StudioTaskOptions = { ...existingOptions };

	let roleChanged = false;
	if (options.role !== undefined) {
		if (options.role === null) {
			result.role = defaultRole;
			roleChanged = true;
		} else {
			const role = options.role.trim();
			const knownRoles = new Set(STANDARD_ROLE_METAS.map((r) => r.id));
			for (const r of Object.keys(deps.roleModels?.() ?? {})) knownRoles.add(r);
			knownRoles.add('custom');
			if (!knownRoles.has(role)) {
				throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_role_unknown({ role }));
			}
			result.role = role;
			roleChanged = true;
		}
	}

	const effectiveRole = result.role || defaultRole;

	if (roleChanged && options.modelSelector === undefined && effectiveRole !== 'custom') {
		const cfg = resolveRoleConfig(deps, effectiveRole);
		result.modelSelector = cfg.model || undefined;
		result.thinkingLevel = cfg.thinking || undefined;
	}

	if (options.modelSelector !== undefined) {
		if (options.modelSelector === null) {
			const cfg = resolveRoleConfig(deps, effectiveRole);
			result.modelSelector = cfg.model || undefined;
		} else {
			const selector = options.modelSelector.trim();
			const slash = selector.indexOf('/');
			if (slash <= 0 || slash === selector.length - 1) {
				throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_model_selector_invalid({ selector }));
			}
			result.modelSelector = selector;
		}
	}

	if (options.thinkingLevel !== undefined) {
		if (options.thinkingLevel === null) {
			const cfg = resolveRoleConfig(deps, effectiveRole);
			result.thinkingLevel = cfg.thinking || undefined;
		} else {
			result.thinkingLevel = options.thinkingLevel.trim();
		}
	}

	if (options.directiveIds !== undefined) {
		const catalog = settingsStore.taskDirectives || [];
		const snapshots: TaskDirectiveSnapshot[] = [];
		for (const id of options.directiveIds) {
			const found = catalog.find((d) => d.id === id);
			if (!found) {
				throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_directive_not_found({ id }));
			}
			snapshots.push(createDirectiveSnapshot(found));
		}
		result.directives = snapshots.length > 0 ? snapshots : undefined;
	}

	return result;
}
export function createTaskCommands(customDeps?: Partial<TaskCommandDeps>) {
	const deps: TaskCommandDeps = { ...defaultDeps, ...customDeps };

	return {
		getRemoteTask: async (projectId: string, taskId: string): Promise<RemoteTaskDetail> => {
			const task = deps.taskById(taskId);
			if (!task) {
				throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_task_not_found({ task: taskId }));
			}
			const project = deps.findProject(projectId);
			if (!project) {
				throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_project_not_found({ project: projectId }));
			}

			let accumulatedBytes = 0;
			const images: RemoteTaskImage[] = (task.images || []).map((img) => {
				const byteSize = img.data ? img.data.length : 0;
				if (accumulatedBytes + byteSize <= TASK_DETAIL_MAX_BYTES) {
					accumulatedBytes += byteSize;
					return {
						mimeType: img.mimeType || 'image/jpeg',
						data: img.data ?? null
					};
				}
				return {
					mimeType: img.mimeType || 'image/jpeg',
					data: null
				};
			});

			let schedule: RemoteTaskSchedule | null = null;
			if (task.schedule) {
				const target = deps.scheduleTarget?.(task);
				schedule = {
					kind: task.schedule.kind,
					provider: target?.provider ?? task.schedule.provider ?? null,
					notBefore: target?.dueAt ?? task.schedule.notBefore ?? null,
					missed: Boolean(task.schedule.missed)
				};
			}

			return {
				id: task.id,
				prompt: task.prompt,
				role: task.options?.role ?? null,
				modelSelector: task.options?.modelSelector ?? null,
				thinkingLevel: task.options?.thinkingLevel ?? null,
				directives: (task.options?.directives || []).map((d) => ({ id: d.id, name: d.name })),
				images,
				schedule
			};
		},

		createRemoteTask: async (
			projectId: string,
			prompt: string,
			schedule: RemoteScheduleChoice | null,
			options?: RemoteTaskOptions,
			images?: RemotePromptImage[]
		): Promise<{ taskId: string }> => {
			const validPrompt = validatePrompt(prompt);
			const currentNow = deps.now ? deps.now() : Date.now();

			if (schedule && schedule.kind === 'at') {
				validateAtSchedule(schedule.notBefore, currentNow);
			}

			const project = deps.findProject(projectId);
			if (!project || !project.canonicalProjectPath) {
				throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_project_not_found({ project: projectId }));
			}

			await deps.loadProject(project.canonicalProjectPath);

			const resolvedImages = images && images.length > 0 ? await resolvePromptImages(images) : undefined;
			const task = deps.createTask(project.canonicalProjectPath);
			try {
				// Senza opzioni il lavoro tiene le impostazioni predefinite del progetto,
				// gia' scritte da `createTask`.
				if (options || resolvedImages) {
					const studioOptions = options
						? validateAndNormalizeOptions(deps, options, resolveRoleDefault(project), task.options)
						: task.options;
					deps.updateTask(task.id, validPrompt, resolvedImages, studioOptions);
				} else {
					deps.updatePrompt(task.id, validPrompt);
				}
				deps.requestTaskTitle?.(task.id);

				if (schedule) {
					const resolvedSchedule = resolveSchedule(schedule, deps.taskById(task.id) ?? task, deps);
					if (resolvedSchedule) {
						deps.setSchedule(task.id, resolvedSchedule);
					}
				}

				return { taskId: task.id };
			} catch (err) {
				deps.deleteTask(task.id);
				throw err;
			}
		},

		updateRemoteTask: async (
			_projectId: string,
			taskId: string,
			patch: RemoteTaskPatch
		): Promise<void> => {
			const task = deps.taskById(taskId);
			if (!task) {
				throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_task_not_found({ task: taskId }));
			}

			let newPrompt = task.prompt;
			if (patch.prompt !== undefined) {
				newPrompt = validatePrompt(patch.prompt);
			}

			let newImages: ImageContent[] | undefined = task.images;
			if (patch.images !== undefined) {
				const currentImages = task.images || [];
				const keepIndices = patch.images.keep;
				if (!Array.isArray(keepIndices)) {
					throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_keep_invalid());
				}
				for (const idx of keepIndices) {
					if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= currentImages.length) {
						throw new RemoteCommandFailure(
							'rejected',
							`Indice immagine "${idx}" fuori intervallo (totale immagini: ${currentImages.length})`
						);
					}
				}
				const kept = keepIndices.map((i) => currentImages[i]);
				const added = Array.isArray(patch.images.add) ? await resolvePromptImages(patch.images.add) : [];
				newImages = [...kept, ...added];
			}

			let newOptions: StudioTaskOptions | undefined = task.options;
			if (patch.options !== undefined) {
				const project = deps.findProject(_projectId);
				const defaultRole = resolveRoleDefault(project);
				newOptions = validateAndNormalizeOptions(deps, patch.options, defaultRole, task.options);
			}

			// Prima di scrivere: lo store aggiorna il task sul posto.
			const promptChanged = newPrompt !== task.prompt;
			if (patch.images !== undefined || patch.options !== undefined) {
				deps.updateTask(task.id, newPrompt, newImages, newOptions);
			} else if (promptChanged) {
				// Solo il testo: il resto del task resta quello scritto da Studio.
				deps.updatePrompt(task.id, newPrompt);
			}
			if (promptChanged) {
				deps.requestTaskTitle?.(task.id);
			}

			if (patch.schedule !== undefined) {
				if (patch.schedule === null) {
					deps.setSchedule(task.id, undefined);
				} else {
					const resolvedSchedule = resolveSchedule(patch.schedule, task, deps);
					deps.setSchedule(task.id, resolvedSchedule);
				}
			}
		},

		deleteRemoteTask: async (_projectId: string, taskId: string): Promise<void> => {
			const task = deps.taskById(taskId);
			if (!task) {
				throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_task_not_found({ task: taskId }));
			}
			deps.deleteTask(taskId);
		},

		moveRemoteTask: async (
			_projectId: string,
			taskId: string,
			toIndex: number
		): Promise<void> => {
			if (typeof toIndex !== 'number' || !Number.isFinite(toIndex) || !Number.isInteger(toIndex)) {
				throw new RemoteCommandFailure(
					'rejected',
					m.l10n_lab_remote_move_index_invalid()
				);
			}
			const task = deps.taskById(taskId);
			if (!task) {
				throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_task_not_found({ task: taskId }));
			}
			deps.moveTaskToIndex(taskId, toIndex);
		}
	};
}

const defaultCommands = createTaskCommands();
export const getRemoteTask = defaultCommands.getRemoteTask;
export const createRemoteTask = defaultCommands.createRemoteTask;
export const updateRemoteTask = defaultCommands.updateRemoteTask;
export const deleteRemoteTask = defaultCommands.deleteRemoteTask;
export const moveRemoteTask = defaultCommands.moveRemoteTask;
