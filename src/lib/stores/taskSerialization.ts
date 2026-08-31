/**
 * Parsing, validazione e serializzazione pura dello store tasks.json.
 * Separato dallo store reattivo Svelte 5 per consentire test unitari
 * ed esecuzione deterministica senza dipendenze da Tauri o DOM.
 */

import type { ImageContent } from '../agent/wire';
import {
	type TaskDirectiveSnapshot,
	createDirectiveSnapshot,
	getFactoryDirective,
	applyTaskDirectives,
	isTaskDirectiveSnapshot
} from './taskDirectives.ts';
export const AGENT_VIEWS = ['queue', 'sessions', 'rules'] as const;
export type AgentView = (typeof AGENT_VIEWS)[number];

export type StudioTaskStatus = 'queued' | 'dispatching' | 'in_progress' | 'completed' | 'abandoned';

export interface StudioTaskOptions {
	role?: string;
	modelSelector?: string;
	thinkingLevel?: string;
	includeEditorContext?: boolean;
	directives?: TaskDirectiveSnapshot[];
}

export interface StudioTask {
	id: string;
	projectPath: string;
	prompt: string;
	images?: ImageContent[];
	options?: StudioTaskOptions;
	position: number;
	createdAt: number;
	updatedAt: number;
	status: StudioTaskStatus;
}

export interface ProjectTaskFile {
	version: 1;
	tasks: StudioTask[];
}

export interface TaskSessionOrigin {
	projectPath: string;
	sessionId: string;
	taskId: string;
	title: string;
	launchedAt: number;
	modelSelector?: string;
	thinkingLevel?: string;
}

export interface FrequentTaskModelConfiguration {
	modelSelector: string;
	thinkingLevel: string;
	count: number;
	lastUsedAt: number;
}

export interface PersistedTaskState {
	tasks: StudioTask[];
	origins: TaskSessionOrigin[];
	views: Record<string, AgentView>;
}

export function createDefaultPersistedState(): PersistedTaskState {
	return {
		tasks: [],
		origins: [],
		views: {}
	};
}

/**
 * Valida che un oggetto rispetti lo schema di un StudioTask.
 */
export function isStudioTask(entry: unknown): entry is StudioTask {
	if (!entry || typeof entry !== 'object') return false;
	const task = entry as Record<string, unknown>;
	const validStatuses: StudioTaskStatus[] = ['queued', 'dispatching', 'in_progress', 'completed', 'abandoned'];
	return (
		typeof task.id === 'string' &&
		(task.projectPath === undefined || typeof task.projectPath === 'string') &&
		typeof task.prompt === 'string' &&
		(task.images === undefined || Array.isArray(task.images)) &&
		(task.options === undefined || (typeof task.options === 'object' && task.options !== null)) &&
		typeof task.position === 'number' &&
		typeof task.createdAt === 'number' &&
		typeof task.updatedAt === 'number' &&
		typeof task.status === 'string' &&
		validStatuses.includes(task.status as StudioTaskStatus)
	);
}

/**
 * Valida che un oggetto rispetti lo schema di una TaskSessionOrigin.
 */
export function isTaskSessionOrigin(entry: unknown): entry is TaskSessionOrigin {
	if (!entry || typeof entry !== 'object') return false;
	const origin = entry as Record<string, unknown>;
	return (
		typeof origin.projectPath === 'string' &&
		typeof origin.sessionId === 'string' &&
		typeof origin.taskId === 'string' &&
		typeof origin.title === 'string' &&
		typeof origin.launchedAt === 'number' &&
		(origin.modelSelector === undefined || typeof origin.modelSelector === 'string') &&
		(origin.thinkingLevel === undefined || typeof origin.thinkingLevel === 'string')
	);
}

/**
 * Classifica le coppie modello/thinking lanciate piu' spesso nel progetto.
 * La finestra recente evita che abitudini ormai superate restino dominanti.
 */
export function rankFrequentTaskModelConfigurations(
	origins: TaskSessionOrigin[],
	limit = 4,
	windowSize = 50
): FrequentTaskModelConfiguration[] {
	const recent = origins
		.filter((origin) => Boolean(origin.modelSelector?.trim()))
		.sort((left, right) => right.launchedAt - left.launchedAt)
		.slice(0, windowSize);
	const grouped = new Map<string, FrequentTaskModelConfiguration>();

	for (const origin of recent) {
		const modelSelector = origin.modelSelector!.trim();
		const thinkingLevel = origin.thinkingLevel?.trim() || 'auto';
		const key = `${modelSelector}\0${thinkingLevel}`;
		const existing = grouped.get(key);
		if (existing) {
			existing.count += 1;
			existing.lastUsedAt = Math.max(existing.lastUsedAt, origin.launchedAt);
		} else {
			grouped.set(key, {
				modelSelector,
				thinkingLevel,
				count: 1,
				lastUsedAt: origin.launchedAt
			});
		}
	}

	return [...grouped.values()]
		.sort((left, right) =>
			right.count - left.count ||
			right.lastUsedAt - left.lastUsedAt ||
			left.modelSelector.localeCompare(right.modelSelector) ||
			left.thinkingLevel.localeCompare(right.thinkingLevel)
		)
		.slice(0, limit);
}

/**
 * Valida e deserializza lo stato persistito di tasks.json.
 * Ritorna null se il payload non è un oggetto o non contiene le strutture base richieste.
 */
export function parsePersistedState(value: unknown): PersistedTaskState | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	if (
		!Array.isArray(record.tasks) ||
		!Array.isArray(record.origins) ||
		!record.views ||
		typeof record.views !== 'object'
	) {
		return null;
	}

	const tasks = record.tasks.filter(isStudioTask);
	const origins = record.origins.filter(isTaskSessionOrigin);
	const views = Object.fromEntries(
		Object.entries(record.views as Record<string, unknown>).filter(
			(entry): entry is [string, AgentView] =>
				typeof entry[1] === 'string' && (AGENT_VIEWS as readonly string[]).includes(entry[1])
		)
	);

	return { tasks, origins, views };
}

/**
 * Filtra e normalizza i task caricati:
 * - Scarta task senza testo e senza immagini.
 * - Resetta lo stato a 'queued' per task che erano rimasti 'dispatching'.
 */
export function sanitizeLoadedTasks(tasks: StudioTask[], defaultProjectPath?: string): StudioTask[] {
	return tasks
		.filter((task) => task.prompt.trim() || (task.images && task.images.length > 0))
		.map((task) => {
			let options = task.options ? { ...task.options } : undefined;

			if (options) {
				const rawOptions = options as Record<string, unknown>;
				let directives: TaskDirectiveSnapshot[] = Array.isArray(rawOptions.directives)
					? (rawOptions.directives.filter(isTaskDirectiveSnapshot) as TaskDirectiveSnapshot[])
					: [];

				// Migrazione deterministica dai campi booleani legacy ai factory snapshots
				const seenIds = new Set(directives.map((d) => d.id));
				if (rawOptions.discussionMode === true) {
					const factory = getFactoryDirective('discussion');
					if (factory && !seenIds.has(factory.id)) {
						directives.push(createDirectiveSnapshot(factory));
						seenIds.add(factory.id);
					}
				}
				if (rawOptions.planMode === true) {
					const factory = getFactoryDirective('plan');
					if (factory && !seenIds.has(factory.id)) {
						directives.push(createDirectiveSnapshot(factory));
						seenIds.add(factory.id);
					}
				}
				if (rawOptions.minimalMode === true) {
					const factory = getFactoryDirective('minimal');
					if (factory && !seenIds.has(factory.id)) {
						directives.push(createDirectiveSnapshot(factory));
						seenIds.add(factory.id);
					}
				}
				if (rawOptions.researchMode === true) {
					const factory = getFactoryDirective('research');
					if (factory && !seenIds.has(factory.id)) {
						directives.push(createDirectiveSnapshot(factory));
						seenIds.add(factory.id);
					}
				}

				directives.sort((a, b) => a.order - b.order);
				options = {
					role: typeof options.role === 'string' ? options.role : undefined,
					modelSelector: typeof options.modelSelector === 'string' ? options.modelSelector : undefined,
					thinkingLevel: typeof options.thinkingLevel === 'string' ? options.thinkingLevel : undefined,
					includeEditorContext: options.includeEditorContext !== false,
					directives: directives.length > 0 ? directives : undefined
				};
			}

			return {
				...task,
				options,
				projectPath: task.projectPath ?? defaultProjectPath ?? '',
				status: task.status === 'dispatching' ? ('queued' as const) : task.status
			};
		});
}

/**
 * Parsing e validazione di un file `.omp/tasks.json`.
 */
export function parseProjectTasksFile(raw: string, defaultProjectPath?: string): StudioTask[] {
	if (!raw || !raw.trim()) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		let candidateTasks: unknown[] = [];
		if (Array.isArray(parsed)) {
			candidateTasks = parsed;
		} else if (parsed && typeof parsed === 'object') {
			const record = parsed as Record<string, unknown>;
			if (Array.isArray(record.tasks)) {
				candidateTasks = record.tasks;
			}
		}
		const valid = candidateTasks.filter(isStudioTask);
		return sanitizeLoadedTasks(valid, defaultProjectPath);
	} catch {
		return [];
	}
}

/**
 * Serializzazione per il file `.omp/tasks.json` di un progetto.
 */
export function serializeProjectTasksFile(tasks: StudioTask[]): string {
	const payload: ProjectTaskFile = {
		version: 1,
		tasks: tasks.map((task) => ({
			...task,
			// Assicuriamo che 'dispatching' non venga mai persistito come tale
			status: task.status === 'dispatching' ? 'queued' : task.status
		}))
	};
	return JSON.stringify(payload, null, 2);
}

/**
 * Serializza lo stato per la scrittura in tasks.json globale.
 */
export function serializeTaskState(state: PersistedTaskState): string {
	return JSON.stringify(state, null, 2);
}

/**
 * Applica le direttive del task al testo del prompt delegando ad applyTaskDirectives.
 * Supporta sia gli snapshot moderni `directives` sia il fallback per campi booleani legacy.
 */
export function applyTaskModeDirectives(prompt: string, options?: StudioTaskOptions): string {
	if (!options) return prompt.trim();
	if (options.directives && options.directives.length > 0) {
		return applyTaskDirectives(prompt, options.directives);
	}
	const raw = options as Record<string, unknown>;
	const legacySnapshots: TaskDirectiveSnapshot[] = [];
	if (raw.discussionMode === true) {
		const d = getFactoryDirective('discussion');
		if (d) legacySnapshots.push(createDirectiveSnapshot(d));
	}
	if (raw.planMode === true) {
		const d = getFactoryDirective('plan');
		if (d) legacySnapshots.push(createDirectiveSnapshot(d));
	}
	if (raw.minimalMode === true) {
		const d = getFactoryDirective('minimal');
		if (d) legacySnapshots.push(createDirectiveSnapshot(d));
	}
	if (raw.researchMode === true) {
		const d = getFactoryDirective('research');
		if (d) legacySnapshots.push(createDirectiveSnapshot(d));
	}
	return applyTaskDirectives(prompt, legacySnapshots.length > 0 ? legacySnapshots : undefined);
}
