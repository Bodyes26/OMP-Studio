import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { load, type Store } from '@tauri-apps/plugin-store';
import { debounce } from 'lodash-es';
import { normalizeProjectPath, projectStore } from './projects.svelte';
import { settingsStore, type TaskDefaults } from './settings.svelte';
import type { ImageContent } from '$lib/agent/wire';
import { attachEditorContext } from '$lib/editor/editorContext';
import { createDirectiveSnapshot, type TaskDirectiveSnapshot } from './taskDirectives';
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
	serializeProjectTasksFile,
	pruneOrigins,
	mergeOriginRecords
} from './taskSerialization';
import { QueueHydration, mergeHydratedTasks } from './taskHydration';
import { windowLabel } from './windowBridge';
import { m as msg } from '$lib/paraglide/messages.js';

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
	activeTaskByProject = $state<Record<string, StudioTask>>({});
	private store: Store | null = null;
	private initialized = false;
	private readonly hydration = new QueueHydration();
	/** Ultimo contenuto scritto per progetto: evita riscritture identiche. */
	private readonly lastWritten = new Map<string, string>();
	private unlistenTasksChanged: UnlistenFn | null = null;
	private unlistenOriginsChanged: UnlistenFn | null = null;
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
			// Le code di progetto vivono in `.omp/tasks.json`: qui resta solo il
			// residuo delle versioni che le tenevano nello store globale.
			// Sovrascrivere `tasks` non e' un'opzione: un `$effect` (la
			// Companion) puo' aver gia' idratato una coda mentre questa lettura
			// era in volo, e quei task andrebbero persi senza rilettura
			// possibile, perche' la chiave resta marcata come idratata.
			const legacy = sanitizeLoadedTasks(persisted.tasks ?? []);
			this.tasks = mergeHydratedTasks(this.tasks, legacy);
			this.origins = persisted.origins ?? [];
			this.views = persisted.views ?? {};
		}
		this.initialized = true;

		// Ascolta gli eventi di modifica provenienti da OMP (TUI / Tool) e
		// dalle altre finestre di Studio.
		if (this.isTauri) {
			try {
				this.unlistenTasksChanged = await listen<{ projectPath: string; source?: string }>(
					'project-tasks-changed',
					async (event) => {
						const path = event.payload?.projectPath;
						// `emit` consegna anche al mittente: rileggere il file
						// che si e' appena scritto e' solo un giro di IPC in piu'.
						if (event.payload?.source && event.payload.source === windowLabel) return;
						if (path) {
							await this.reloadProject(path);
						}
					}
				);
			} catch (err) {
				console.warn('Listener project-tasks-changed non registrato:', err);
			}

			try {
				this.unlistenOriginsChanged = await listen<TaskSessionOrigin[]>(
					'studio-task-origins-update',
					(event) => {
						this.absorbOrigins(event.payload ?? []);
					}
				);
			} catch (err) {
				console.warn('Listener storico task non registrato:', err);
			}
		}

		// Le code vivono in `.omp/tasks.json` dentro ogni progetto: vanno lette
		// prima che un qualsiasi salvataggio possa scriverle. `projectStore` e'
		// asincrono, quindi senza attenderlo qui la lista sarebbe ancora vuota
		// e nessuna coda verrebbe idratata.
		await projectStore.init();
		await Promise.all(
			projectStore.projects.filter((project) => project.path).map((project) => this.loadProject(project.path))
		);
	}

	/**
	 * Idratazione idempotente della coda di un progetto: legge il file una
	 * sola volta, condivide il tentativo fra chiamate concorrenti e ritorna
	 * `false` se la lettura non e' riuscita (allora la coda non va scritta).
	 */
	async loadProject(projectPath: string): Promise<boolean> {
		if (!projectPath || !projectPath.trim() || !this.isTauri) return false;
		const key = projectKey(projectPath);
		return this.hydration.ensure(key, () => this.readProject(projectPath, key));
	}

	private async readProject(projectPath: string, key: string): Promise<void> {
		const content = await invoke<string>('project_tasks_read', { projectPath });
		if (content && content.trim()) {
			const fromDisk = parseProjectTasksFile(content, key);
			this.lastWritten.set(key, serializeProjectTasksFile(fromDisk));
			this.tasks = this.mergeProjectTasks(key, fromDisk);
		} else {
			// File assente o vuoto: la memoria e' l'unica copia della coda.
			const inMemory = this.tasks.filter((task) => task.projectPath === key);
			if (inMemory.length > 0) {
				const toWrite = serializeProjectTasksFile(inMemory);
				await invoke('project_tasks_write', { projectPath, content: toWrite });
				this.lastWritten.set(key, toWrite);
			}
		}
		await invoke('project_tasks_watch', { projectPath });
	}

	/**
	 * Il file e' la fonte, ma un task creato mentre la lettura era in volo non
	 * puo' sparire solo perche' il disco ha risposto dopo: resta in coda.
	 */
	private mergeProjectTasks(key: string, fromDisk: StudioTask[]): StudioTask[] {
		const stored = new Set(fromDisk.map((task) => task.id));
		const unsaved = this.tasks.filter((task) => task.projectPath === key && !stored.has(task.id));
		const merged = fromDisk.concat(unsaved);
		merged.forEach((task, index) => task.position = index);
		return this.tasks.filter((task) => task.projectPath !== key).concat(merged);
	}

	/** Rilettura forzata: il file e' cambiato da fuori (TUI, tool, altro omp). */
	async reloadProject(projectPath: string) {
		if (!projectPath || !this.isTauri) return;
		const key = projectKey(projectPath);
		this.hydration.forget(key);
		await this.hydration.ensure(key, async () => {
			const content = await invoke<string>('project_tasks_read', { projectPath });
			const fromDisk = parseProjectTasksFile(content ?? '', key);
			this.lastWritten.set(key, serializeProjectTasksFile(fromDisk));
			this.tasks = this.mergeProjectTasks(key, fromDisk);
		});
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

	async saveProjectImmediate(projectPath: string): Promise<void> {
		if (!projectPath) return;
		const key = projectKey(projectPath);
		const pending = this.pendingProjectSaves.get(key);
		if (pending) {
			clearTimeout(pending);
			this.pendingProjectSaves.delete(key);
		}
		if (!this.isTauri) return;
		// Mai scrivere una coda che non e' stata letta: si sovrascriverebbe il
		// file con lo stato vuoto della memoria. Era questa la perdita delle
		// code alla chiusura di Studio.
		if (!(await this.loadProject(projectPath))) {
			console.error(`Coda non letta da disco: salvataggio annullato per ${projectPath}`);
			return;
		}
		try {
			const content = serializeProjectTasksFile(this.tasksFor(projectPath));
			if (this.lastWritten.get(key) === content) return;
			await invoke('project_tasks_write', { projectPath, content });
			this.lastWritten.set(key, content);
			// Il watcher Rust scarta volutamente l'eco delle scritture Studio
			// per 450 ms. Senza un annuncio esplicito l'altra webview non vede
			// mai questa coda fino a una modifica esterna o al riavvio.
			await emit('project-tasks-changed', { projectPath, source: windowLabel });
		} catch (err) {
			console.error(msg.ui_ts_tasks_errore_salvataggio_immediato_task_per_value1_8f04({ value1: projectPath }), err);
		}
	}

	private saveProject(projectPath: string) {
		if (!projectPath) return;
		const key = projectKey(projectPath);
		clearTimeout(this.pendingProjectSaves.get(key));

		const timer = setTimeout(async () => {
			this.pendingProjectSaves.delete(key);
			await this.saveProjectImmediate(projectPath);
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
		const catalog = settingsStore.taskDirectives;
		const selectedIds = new Set(defaults.selectedDirectiveIds ?? []);
		const directives: TaskDirectiveSnapshot[] = catalog
			.filter((d) => !d.hidden && selectedIds.has(d.id))
			.map(createDirectiveSnapshot);

		const options: StudioTaskOptions = {
			role: defaults.role,
			thinkingLevel: defaults.thinkingLevel,
			includeEditorContext: defaults.includeEditorContext,
			directives: directives.length > 0 ? directives : undefined
		};
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
		// Solo innesco: la lettura resta asincrona e non marca nulla finche'
		// non e' riuscita davvero.
		if (this.initialized && !this.hydration.isHydrated(key)) {
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

	/**
	 * Lavoro ancora da consegnare: include i task in spedizione, che non
	 * hanno ancora una sessione e sparirebbero senza traccia se la chiusura
	 * guardasse solo lo stato 'queued'.
	 */
	pendingCountFor(projectPath: string): number {
		const key = projectKey(projectPath);
		let count = 0;
		for (const task of this.tasks) {
			if (task.projectPath !== key) continue;
			if (task.status === 'queued' || task.status === 'dispatching') count++;
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

	/**
	 * Svuota la coda di un progetto. Le `origins` restano: sono lo storico
	 * delle sessioni gia' lanciate, non task ancora da eseguire.
	 *
	 * Attende l'idratazione prima di svuotare, altrimenti una lettura ancora
	 * in volo rimetterebbe in coda proprio i task appena scartati.
	 */
	async clearProject(projectPath: string): Promise<void> {
		const key = projectKey(projectPath);
		await this.loadProject(projectPath);
		this.tasks = this.tasks.filter((task) => task.projectPath !== key);
		await this.saveProjectImmediate(projectPath);
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
			prompt: task.prompt,
			images: task.images ? [...task.images] : undefined,
			options: task.options ? { ...task.options } : undefined,
			launchedAt: Date.now(),
			modelSelector: task.options?.modelSelector,
			thinkingLevel: task.options?.thinkingLevel || 'auto'
		});
		this.origins = pruneOrigins(this.origins);
		// Memorizza il task attivo per recupero in caso di chiusura accidentale
		this.activeTaskByProject[projectKey(task.projectPath)] = { ...task };
		const path = task.projectPath;
		this.tasks = this.tasks.filter((candidate) => candidate.id !== id);
		this.reindex(path);
		this.saveProject(path);
		this.saveGlobal();
		void emit('studio-task-origins-update', $state.snapshot(this.origins));
	}

	originsFor(projectPath: string): TaskSessionOrigin[] {
		const key = projectKey(projectPath);
		return this.origins.filter((origin) => origin.projectPath === key);
	}

	/** Vedi `mergeOriginRecords`: la sostituzione secca perdeva i lanci locali. */
	private absorbOrigins(incoming: TaskSessionOrigin[]) {
		this.origins = mergeOriginRecords(this.origins, incoming);
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

	setActiveTask(projectPath: string, task: StudioTask | null) {
		const key = projectKey(projectPath);
		if (!task) {
			delete this.activeTaskByProject[key];
		} else {
			this.activeTaskByProject[key] = { ...task };
		}
	}


	/**
	 * Se un progetto viene chiuso mentre l'agente o il terminale stava ancora
	 * lavorando su un task, reinserisce il task in cima alla coda (status 'queued')
	 * e ripristina qualsiasi task rimasto in 'dispatching'.
	 * Salva immediatamente su disco (.omp/tasks.json) per non perdere nulla.
	 */
	async requeueInterruptedTask(projectPath: string, sessionId?: string | null): Promise<StudioTask | null> {
		if (!projectPath) return null;
		const key = projectKey(projectPath);
		// La coda su disco va letta prima di rimetterci dentro il task
		// interrotto: altrimenti il salvataggio finale la cancellerebbe.
		await this.loadProject(projectPath);
		let changed = false;

		// 1. Ripristina lo stato queued per qualsiasi task rimasto in 'dispatching'
		for (const task of this.tasks) {
			if (task.projectPath === key && task.status === 'dispatching') {
				task.status = 'queued';
				task.updatedAt = Date.now();
				changed = true;
			}
		}

		// 2. Cerca il task attivo in memoria o l'ultimo origin con prompt per questo progetto
		const activeTask = this.activeTaskByProject[key];
		let promptToRestore = activeTask?.prompt;
		let imagesToRestore = activeTask?.images;
		let optionsToRestore = activeTask?.options;
		let originalTaskId = activeTask?.id;

		if (!promptToRestore) {
			const origins = this.originsFor(projectPath);
			const origin = sessionId
				? origins.find((o) => o.sessionId === sessionId && Boolean(o.prompt))
				: origins.filter((o) => Boolean(o.prompt)).sort((a, b) => b.launchedAt - a.launchedAt)[0];
			if (origin && origin.prompt) {
				promptToRestore = origin.prompt;
				imagesToRestore = origin.images;
				optionsToRestore = origin.options;
				originalTaskId = origin.taskId;
			}
		}

		let restoredTask: StudioTask | null = null;
		if (promptToRestore && promptToRestore.trim()) {
			const alreadyQueued = this.tasks.some(
				(t) => t.projectPath === key && t.prompt.trim() === promptToRestore!.trim() && t.status === 'queued'
			);
			if (!alreadyQueued) {
				restoredTask = {
					id: originalTaskId || crypto.randomUUID(),
					projectPath: key,
					prompt: promptToRestore,
					images: imagesToRestore ? [...imagesToRestore] : [],
					options: optionsToRestore ? { ...optionsToRestore } : undefined,
					position: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					status: 'queued'
				};
				this.tasks.unshift(restoredTask);
				changed = true;
			}
		}

		delete this.activeTaskByProject[key];

		if (changed) {
			this.reindex(projectPath);
			await this.saveProjectImmediate(projectPath);
			this.saveGlobal();
		}
		return restoredTask;
	}

	private reindex(projectPath: string) {
		this.tasksFor(projectPath).forEach((task, index) => task.position = index);
	}
}

export const taskStore = new TaskStore();
