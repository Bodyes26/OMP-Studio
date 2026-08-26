import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { load, type Store } from '@tauri-apps/plugin-store';
import { debounce } from 'lodash-es';
import { normalizeProjectPath, projectStore } from './projects.svelte';
import { settingsStore, type TaskDefaults } from './settings.svelte';
import type { ImageContent } from '$lib/agent/wire';
import { attachEditorContext } from '$lib/editor/editorContext';
import {
	type AgentView,
	type StudioTaskStatus,
	type StudioTaskOptions,
	type StudioTask,
	type TaskSessionOrigin,
	type PersistedTaskState,
	parsePersistedState,
	sanitizeLoadedTasks,
	applyTaskModeDirectives,
	parseProjectTasksFile,
	serializeProjectTasksFile
} from './taskSerialization';

export type {
	AgentView,
	StudioTaskStatus,
	StudioTaskOptions,
	StudioTask,
	TaskSessionOrigin,
	PersistedTaskState
};
export { parsePersistedState, sanitizeLoadedTasks };

/**
 * Formatta il prompt del task applicando le direttive speciali e il contesto editor.
 */
export function formatTaskPrompt(task: StudioTask, projectPath?: string): string {
	let body = applyTaskModeDirectives(task.prompt, task.options);
	if (task.options?.includeEditorContext !== false) {
		body = attachEditorContext(body, projectPath);
	}
	return body;
}

function projectKey(path: string): string {
	return normalizeProjectPath(path).toLowerCase();
}


class TaskStore {
	tasks = $state<StudioTask[]>([]);
	origins = $state<TaskSessionOrigin[]>([]);
	views = $state<Record<string, AgentView>>({});
	private store: Store | null = null;
	private initialized = false;
	private loadedProjects = new Set<string>();
	private unlistenTasksChanged: UnlistenFn | null = null;
	private pendingProjectSaves = new Map<string, ReturnType<typeof setTimeout>>();

	constructor() {
		void this.init();
	}

	private get isTauri(): boolean {
		return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
	}

	private async init() {
		await settingsStore.init();
		this.store = await load('tasks.json', { autoSave: false });
		const persisted = parsePersistedState(await this.store.get<unknown>('taskState'));
		if (persisted) {
			this.tasks = sanitizeLoadedTasks(persisted.tasks ?? []);
			this.origins = persisted.origins ?? [];
			this.views = persisted.views ?? {};
		}
		this.initialized = true;

		// Ascolta gli eventi di modifica provenienti da OMP (TUI / Tool)
		if (this.isTauri) {
			try {
				this.unlistenTasksChanged = await listen<{ projectPath: string }>(
					'project-tasks-changed',
					async (event) => {
						const path = event.payload?.projectPath;
						if (path) {
							await this.reloadProject(path);
						}
					}
				);
			} catch (err) {
				console.warn('Listener project-tasks-changed non registrato:', err);
			}
		}

		// Carica i task per tutti i progetti aperti
		for (const project of projectStore.projects) {
			if (project.path) {
				void this.loadProject(project.path);
			}
		}
	}

	async loadProject(projectPath: string) {
		if (!projectPath || !projectPath.trim() || !this.isTauri) return;
		const key = projectKey(projectPath);
		try {
			const content = await invoke<string>('project_tasks_read', { projectPath });
			if (content && content.trim()) {
				const projectTasks = parseProjectTasksFile(content, key);
				this.tasks = this.tasks.filter((t) => t.projectPath !== key).concat(projectTasks);
			} else {
				// Migrazione automatica se presenti task nel vecchio store globale
				const existing = this.tasksFor(projectPath);
				const toWrite = serializeProjectTasksFile(existing);
				await invoke('project_tasks_write', { projectPath, content: toWrite });
			}
			await invoke('project_tasks_watch', { projectPath });
			this.loadedProjects.add(key);
		} catch (err) {
			console.warn(`Impossibile caricare .omp/tasks.json per ${projectPath}:`, err);
		}
	}

	async reloadProject(projectPath: string) {
		if (!projectPath || !this.isTauri) return;
		const key = projectKey(projectPath);
		try {
			const content = await invoke<string>('project_tasks_read', { projectPath });
			if (content !== undefined) {
				const projectTasks = parseProjectTasksFile(content, key);
				this.tasks = this.tasks.filter((t) => t.projectPath !== key).concat(projectTasks);
			}
		} catch (err) {
			console.warn(`Errore reload task per ${projectPath}:`, err);
		}
	}

	private saveGlobal = debounce(async () => {
		if (!this.initialized || !this.store) return;
		const state: PersistedTaskState = {
			tasks: [], // I task di progetto risiedono in .omp/tasks.json
			origins: $state.snapshot(this.origins),
			views: $state.snapshot(this.views)
		};
		await this.store.set('taskState', state);
		await this.store.save();
	}, 250);

	private saveProject(projectPath: string) {
		if (!projectPath) return;
		const key = projectKey(projectPath);
		clearTimeout(this.pendingProjectSaves.get(key));

		const timer = setTimeout(async () => {
			this.pendingProjectSaves.delete(key);
			if (!this.isTauri) return;
			try {
				const tasks = this.tasksFor(projectPath);
				const content = serializeProjectTasksFile(tasks);
				await invoke('project_tasks_write', { projectPath, content });
			} catch (err) {
				console.error(`Errore salvataggio task per ${projectPath}:`, err);
			}
		}, 150);

		this.pendingProjectSaves.set(key, timer);
	}

	createTask(projectPath: string): StudioTask {
		const key = projectKey(projectPath);
		const now = Date.now();
		// I default del progetto sovrascrivono quelli globali, non li sostituiscono:
		// un progetto puo' scegliere solo il ruolo e lasciare il resto ai default.
		const project = projectStore.projects.find((p) => projectKey(p.path) === key);
		const defaults: TaskDefaults = { ...settingsStore.taskDefaults, ...(project?.taskDefaults ?? {}) };
		const options: StudioTaskOptions = {
			role: defaults.role,
			thinkingLevel: defaults.thinkingLevel,
			includeEditorContext: defaults.includeEditorContext
		};
		// Le modalita' si scrivono solo se attive: un persistito piu' magro
		// e coerente con `formatTaskPrompt`, che le legge come opzionali.
		if (defaults.discussionMode) options.discussionMode = true;
		if (defaults.planMode) options.planMode = true;
		if (defaults.minimalMode) options.minimalMode = true;
		if (defaults.researchMode) options.researchMode = true;

		const task: StudioTask = {
			id: crypto.randomUUID(),
			projectPath: key,
			prompt: '',
			images: [],
			options,
			position: this.tasksFor(projectPath).length,
			createdAt: now,
			updatedAt: now,
			status: 'queued'
		};
		this.tasks.push(task);
		this.saveProject(task.projectPath);
		return task;
	}

	taskById(id: string | null | undefined): StudioTask | undefined {
		return id ? this.tasks.find((task) => task.id === id) : undefined;
	}

	tasksFor(projectPath: string): StudioTask[] {
		const key = projectKey(projectPath);
		if (this.initialized && !this.loadedProjects.has(key)) {
			this.loadedProjects.add(key);
			void this.loadProject(projectPath);
		}
		return this.tasks
			.filter((task) => task.projectPath === key)
			.sort((left, right) => left.position - right.position || left.createdAt - right.createdAt);
	}

	queuedCountFor(projectPath: string): number {
		const key = projectKey(projectPath);
		let count = 0;
		for (const task of this.tasks) {
			if (task.projectPath === key && task.status === 'queued') count++;
		}
		return count;
	}

	/** Una sola passata su tutti i task: usato dalla barra per tutti i badge insieme. */
	get queuedCountByProject(): Record<string, number> {
		const counts: Record<string, number> = {};
		for (const task of this.tasks) {
			if (task.status !== 'queued') continue;
			counts[task.projectPath] = (counts[task.projectPath] ?? 0) + 1;
		}
		return counts;
	}

	/**
	 * Totale mostrato dal chip in barra. Conta solo i progetti aperti, perche'
	 * il chip porta alla vista aggregata, che di progetti chiusi non parla:
	 * un numero senza destinazione sarebbe peggio di nessun numero. La coda di
	 * un progetto chiuso resta su disco e torna visibile riaprendolo.
	 */
	get totalQueued(): number {
		const counts = this.queuedCountByProject;
		let total = 0;
		for (const project of projectStore.projects) {
			if (!project.path) continue;
			total += counts[projectKey(project.path)] ?? 0;
		}
		return total;
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
		this.saveProject(task.projectPath);
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
		this.saveProject(path);
	}

	/** Svuota la coda di un progetto. Le `origins` restano: sono lo storico
	 *  delle sessioni gia' lanciate, non task ancora da eseguire. */
	clearProject(projectPath: string) {
		const key = projectKey(projectPath);
		this.tasks = this.tasks.filter((task) => task.projectPath !== key);
		this.saveProject(projectPath);
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
		this.saveProject(source.projectPath);
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
		this.saveProject(task.projectPath);
	}

	rollbackDispatch(id: string) {
		const task = this.taskById(id);
		if (!task) return;
		task.status = 'queued';
		this.saveProject(task.projectPath);
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
		this.saveProject(path);
		this.saveGlobal();
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
		this.saveGlobal();
	}

	private reindex(projectPath: string) {
		this.tasksFor(projectPath).forEach((task, index) => task.position = index);
	}
}

export const taskStore = new TaskStore();
