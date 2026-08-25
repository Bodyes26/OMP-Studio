import { load, type Store } from '@tauri-apps/plugin-store';
import { debounce } from 'lodash-es';
import { normalizeProjectPath } from './projects.svelte';
import type { ImageContent } from '$lib/agent/wire';
import { attachEditorContext } from '$lib/editor/editorContext';
export type AgentView = 'queue' | 'sessions';
export type StudioTaskStatus = 'queued' | 'dispatching';

export interface StudioTaskOptions {
	role?: string;
	modelSelector?: string;
	thinkingLevel?: string;
	planMode?: boolean;
	discussionMode?: boolean;
	minimalMode?: boolean;
	includeEditorContext?: boolean;
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

export interface TaskSessionOrigin {
	projectPath: string;
	sessionId: string;
	taskId: string;
	title: string;
	launchedAt: number;
}

/**
 * Formatta il prompt del task applicando le direttive speciali e il contesto editor.
 */
export function formatTaskPrompt(task: StudioTask, projectPath?: string): string {
	let body = task.prompt.trim();
	const prefixes: string[] = [];

	if (task.options?.discussionMode) {
		prefixes.push('[Modalita Discussione: NON modificare codice subito. Analizza il progetto e usa la skill /grill-me o interroga l\'utente con domande mirate per chiarire decisioni, vincoli e architettura prima di procedere.]');
	}
	if (task.options?.planMode) {
		prefixes.push('[Modalita Piano: formula prima un piano di esecuzione dettagliato passo-passo ed esponilo per approvazione prima di procedere con modifiche.]');
	}
	if (task.options?.minimalMode) {
		prefixes.push('[Modalita Minimale: applica la soluzione piu pigra, semplice e minimale possibile (/ponytail). Evita astrazioni premature, boilerplate o nuove dipendenze se non indispensabili.]');
	}

	if (prefixes.length > 0) {
		body = `${prefixes.join('\n\n')}\n\n${body}`;
	}

	if (task.options?.includeEditorContext !== false) {
		body = attachEditorContext(body, projectPath);
	}

	return body;
}

interface PersistedTaskState {
	tasks: StudioTask[];
	origins: TaskSessionOrigin[];
	views: Record<string, AgentView>;
}

function projectKey(path: string): string {
	return normalizeProjectPath(path).toLowerCase();
}

function parsePersistedState(value: unknown): PersistedTaskState | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.tasks) || !Array.isArray(record.origins) || !record.views || typeof record.views !== 'object') {
		return null;
	}

	const tasks = record.tasks.filter((entry): entry is StudioTask => {
		if (!entry || typeof entry !== 'object') return false;
		const task = entry as Record<string, unknown>;
		return typeof task.id === 'string'
			&& typeof task.projectPath === 'string'
			&& typeof task.prompt === 'string'
			&& (task.images === undefined || Array.isArray(task.images))
			&& (task.options === undefined || (typeof task.options === 'object' && task.options !== null))
			&& typeof task.position === 'number'
			&& typeof task.createdAt === 'number'
			&& typeof task.updatedAt === 'number'
			&& (task.status === 'queued' || task.status === 'dispatching');
	});
	const origins = record.origins.filter((entry): entry is TaskSessionOrigin => {
		if (!entry || typeof entry !== 'object') return false;
		const origin = entry as Record<string, unknown>;
		return typeof origin.projectPath === 'string'
			&& typeof origin.sessionId === 'string'
			&& typeof origin.taskId === 'string'
			&& typeof origin.title === 'string'
			&& typeof origin.launchedAt === 'number';
	});
	const views = Object.fromEntries(
		Object.entries(record.views as Record<string, unknown>)
			.filter((entry): entry is [string, AgentView] => entry[1] === 'queue' || entry[1] === 'sessions')
	);
	return { tasks, origins, views };
}


class TaskStore {
	tasks = $state<StudioTask[]>([]);
	origins = $state<TaskSessionOrigin[]>([]);
	views = $state<Record<string, AgentView>>({});
	private store: Store | null = null;
	private initialized = false;

	constructor() {
		void this.init();
	}

	private async init() {
		this.store = await load('tasks.json', { autoSave: false });
		const persisted = parsePersistedState(await this.store.get<unknown>('taskState'));
		if (persisted) {
			this.tasks = (persisted.tasks ?? [])
				.filter((task) => task.prompt.trim() || (task.images && task.images.length > 0))
				.map((task) => ({ ...task, status: 'queued' as const }));
			this.origins = persisted.origins ?? [];
			this.views = persisted.views ?? {};
		}
		this.initialized = true;
	}

	private save = debounce(async () => {
		if (!this.initialized || !this.store) return;
		const state: PersistedTaskState = {
			tasks: $state.snapshot(this.tasks),
			origins: $state.snapshot(this.origins),
			views: $state.snapshot(this.views)
		};
		await this.store.set('taskState', state);
		await this.store.save();
	}, 250);

	createTask(projectPath: string): StudioTask {
		const key = projectKey(projectPath);
		const now = Date.now();
		const task: StudioTask = {
			id: crypto.randomUUID(),
			projectPath: key,
			prompt: '',
			images: [],
			options: {
				role: 'default',
				thinkingLevel: 'auto',
				includeEditorContext: true
			},
			position: this.tasksFor(projectPath).length,
			createdAt: now,
			updatedAt: now,
			status: 'queued'
		};
		this.tasks.push(task);
		this.save();
		return task;
	}

	taskById(id: string | null | undefined): StudioTask | undefined {
		return id ? this.tasks.find((task) => task.id === id) : undefined;
	}

	tasksFor(projectPath: string): StudioTask[] {
		const key = projectKey(projectPath);
		return this.tasks
			.filter((task) => task.projectPath === key)
			.sort((left, right) => left.position - right.position || left.createdAt - right.createdAt);
	}

	updateTask(id: string, prompt: string, images?: ImageContent[], options?: StudioTaskOptions) {
		const task = this.taskById(id);
		if (!task) return;
		task.prompt = prompt;
		if (images !== undefined) {
			task.images = images;
		}
		if (options !== undefined) {
			task.options = options;
		}
		task.updatedAt = Date.now();
		this.save();
	}
	updatePrompt(id: string, prompt: string) {
		this.updateTask(id, prompt);
	}

	deleteTask(id: string) {
		const task = this.taskById(id);
		if (!task) return;
		const path = task.projectPath;
		this.tasks = this.tasks.filter((candidate) => candidate.id !== id);
		this.reindex(path);
		this.save();
	}

	moveTask(id: string, targetId: string) {
		if (id === targetId) return;
		const source = this.taskById(id);
		const target = this.taskById(targetId);
		if (!source || !target || source.projectPath !== target.projectPath) return;
		const ordered = this.tasksFor(source.projectPath);
		const from = ordered.findIndex((task) => task.id === id);
		const to = ordered.findIndex((task) => task.id === targetId);
		if (from < 0 || to < 0) return;
		const [moved] = ordered.splice(from, 1);
		ordered.splice(to, 0, moved);
		ordered.forEach((task, index) => task.position = index);
		this.save();
	}

	moveTaskBy(id: string, offset: -1 | 1) {
		const task = this.taskById(id);
		if (!task) return;
		const ordered = this.tasksFor(task.projectPath);
		const index = ordered.findIndex((candidate) => candidate.id === id);
		const target = ordered[index + offset];
		if (target) this.moveTask(id, target.id);
	}

	markDispatching(id: string) {
		const task = this.taskById(id);
		if (!task) return;
		task.status = 'dispatching';
		this.save();
	}

	rollbackDispatch(id: string) {
		const task = this.taskById(id);
		if (!task) return;
		task.status = 'queued';
		this.save();
	}

	completeDispatch(id: string, sessionId: string) {
		const task = this.taskById(id);
		if (!task) return;
		this.origins = this.origins.filter((origin) =>
			origin.projectPath !== task.projectPath || origin.sessionId !== sessionId
		);
		const title = task.prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Nuovo task';
		this.origins.push({
			projectPath: task.projectPath,
			sessionId,
			taskId: task.id,
			title,
			launchedAt: Date.now()
		});
		const path = task.projectPath;
		this.tasks = this.tasks.filter((candidate) => candidate.id !== id);
		this.reindex(path);
		this.save();
	}

	originsFor(projectPath: string): TaskSessionOrigin[] {
		const key = projectKey(projectPath);
		return this.origins.filter((origin) => origin.projectPath === key);
	}

	isTaskSession(projectPath: string, sessionId: string): boolean {
		const key = projectKey(projectPath);
		return this.origins.some((origin) => origin.projectPath === key && origin.sessionId === sessionId);
	}

	viewFor(projectPath: string): AgentView {
		return this.views[projectKey(projectPath)] ?? 'queue';
	}

	setView(projectPath: string, view: AgentView) {
		this.views[projectKey(projectPath)] = view;
		this.save();
	}

	private reindex(projectPath: string) {
		this.tasksFor(projectPath).forEach((task, index) => task.position = index);
	}
}

export const taskStore = new TaskStore();
