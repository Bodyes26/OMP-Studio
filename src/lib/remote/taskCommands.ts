/**
 * Gestione dei task da remoto (Gate R44, R5): creare, modificare, programmare,
 * spostare ed eliminare task in coda. `handleRemoteCommand` ha gia' verificato
 * progetto, appartenenza del task e stato in coda.
 */

import type { RemoteScheduleChoice } from '$remote-protocol';
import { RemoteCommandFailure, type RemoteTaskPatch } from './commands';
import { projectStore } from '#lib/stores/projects.svelte.ts';
import { taskStore, type StudioTask, type TaskSchedule } from '#lib/stores/tasks.svelte.ts';
import { buildAtSchedule } from '#lib/quota/scheduleTarget.ts';
import { requestTaskTitle } from '#lib/stores/taskTitles.ts';

const MAX_PROMPT_LENGTH = 20_000;
/** Margine di tolleranza per sfasamento orologio client/host (60 secondi). */
const SKEW_TOLERANCE_MS = 60_000;
/** Limite massimo nel futuro per una programmazione ad orario (365 giorni). */
const MAX_FUTURE_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000;

export interface TaskCommandDeps {
	findProject: (projectId: string) => { id: string; canonicalProjectPath?: string | null } | undefined;
	loadProject: (projectPath: string) => Promise<boolean>;
	createTask: (projectPath: string) => StudioTask;
	taskById: (taskId: string) => StudioTask | undefined;
	tasksFor: (projectPath: string) => StudioTask[];
	updatePrompt: (taskId: string, prompt: string) => void;
	deleteTask: (taskId: string) => void;
	setSchedule: (taskId: string, schedule: TaskSchedule | undefined) => void;
	moveTaskToIndex: (taskId: string, toIndex: number) => void;
	buildResetSchedule: (task: Pick<StudioTask, 'options'>) => TaskSchedule | null;
	requestTaskTitle?: (taskId: string) => void;
	now?: () => number;
}

const defaultDeps: TaskCommandDeps = {
	findProject: (projectId: string) => projectStore.projects.find((p) => p.id === projectId),
	loadProject: (projectPath: string) => taskStore.loadProject(projectPath),
	createTask: (projectPath: string) => taskStore.createTask(projectPath),
	taskById: (taskId: string) => taskStore.taskById(taskId),
	tasksFor: (projectPath: string) => taskStore.tasksFor(projectPath),
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
		throw new RemoteCommandFailure('rejected', 'Prompt non valido: attesa una stringa');
	}
	const trimmed = prompt.trim();
	if (trimmed.length === 0) {
		throw new RemoteCommandFailure('rejected', 'Prompt vuoto: inserisci un testo per il task');
	}
	if (prompt.length > MAX_PROMPT_LENGTH) {
		throw new RemoteCommandFailure(
			'rejected',
			`Prompt troppo lungo (${prompt.length} caratteri, massimo ${MAX_PROMPT_LENGTH})`
		);
	}
	return prompt;
}

function validateAtSchedule(notBefore: unknown, now: number): number {
	if (typeof notBefore !== 'number' || !Number.isFinite(notBefore)) {
		throw new RemoteCommandFailure('rejected', 'Orario programmato non valido: atteso un epoch ms');
	}
	if (notBefore < now - SKEW_TOLERANCE_MS) {
		throw new RemoteCommandFailure('rejected', 'Orario programmato nel passato');
	}
	if (notBefore > now + MAX_FUTURE_SCHEDULE_MS) {
		throw new RemoteCommandFailure('rejected', 'Orario programmato troppo lontano nel futuro');
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
				'Nessun provider di quota configurato per il ruolo o modello di questo task'
			);
		}
		return resolved;
	}

	if (choice.kind === 'at') {
		const validNotBefore = validateAtSchedule(choice.notBefore, currentNow);
		return buildAtSchedule(validNotBefore, currentNow);
	}

	throw new RemoteCommandFailure('rejected', 'Tipo di programmazione non riconosciuto');
}

export function createTaskCommands(customDeps?: Partial<TaskCommandDeps>) {
	const deps: TaskCommandDeps = { ...defaultDeps, ...customDeps };

	return {
		createRemoteTask: async (
			projectId: string,
			prompt: string,
			schedule: RemoteScheduleChoice | null
		): Promise<{ taskId: string }> => {
			const validPrompt = validatePrompt(prompt);
			const currentNow = deps.now ? deps.now() : Date.now();

			if (schedule && schedule.kind === 'at') {
				validateAtSchedule(schedule.notBefore, currentNow);
			}

			const project = deps.findProject(projectId);
			if (!project || !project.canonicalProjectPath) {
				throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
			}

			await deps.loadProject(project.canonicalProjectPath);

			const task = deps.createTask(project.canonicalProjectPath);
			try {
				deps.updatePrompt(task.id, validPrompt);
				deps.requestTaskTitle?.(task.id);

				if (schedule) {
					const resolvedSchedule = resolveSchedule(schedule, task, deps);
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
				throw new RemoteCommandFailure('not_found', `Task "${taskId}" non trovato`);
			}

			if (patch.prompt !== undefined) {
				const validPrompt = validatePrompt(patch.prompt);
				if (validPrompt !== task.prompt) {
					deps.updatePrompt(task.id, validPrompt);
					deps.requestTaskTitle?.(task.id);
				}
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
				throw new RemoteCommandFailure('not_found', `Task "${taskId}" non trovato`);
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
					'Indice di destinazione non valido: atteso un intero'
				);
			}
			const task = deps.taskById(taskId);
			if (!task) {
				throw new RemoteCommandFailure('not_found', `Task "${taskId}" non trovato`);
			}
			deps.moveTaskToIndex(taskId, toIndex);
		}
	};
}

const defaultCommands = createTaskCommands();
export const createRemoteTask = defaultCommands.createRemoteTask;
export const updateRemoteTask = defaultCommands.updateRemoteTask;
export const deleteRemoteTask = defaultCommands.deleteRemoteTask;
export const moveRemoteTask = defaultCommands.moveRemoteTask;
