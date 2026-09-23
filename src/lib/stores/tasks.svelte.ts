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
	mergeOriginRecords,
	taskRunFromOrigin
} from './taskSerialization';
import type { TaskRunRecord } from '$lib/types/lanes';
import { QueueHydration, mergeHydratedTasks, mergeReloadedTasks } from './taskHydration';
import { resolveDroppedTask, type InFlightTask } from './taskRecovery';
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
 * Corsia che esegue un task: viaggia con la spedizione e finisce nel record di
 * lancio, cosi' lo storico distingue `Principale` e worktree anche dopo che la
 * corsia e' stata archiviata.
 */
export interface TaskRunLaneContext {
	laneId: string;
	laneTitle: string;
	laneKind: 'main' | 'worktree';
	workspacePath?: string | null;
	branch?: string | null;
	targetBranch?: string | null;
}

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
	rollbackSeq = $state<Record<string, number>>({});
	/**
	 * Task in volo per progetto: usciti dalla coda, non ancora comparsi in
	 * sessione. Vedi `taskRecovery.ts`: appena omp da' segno di vita
	 * l'entrata sparisce, perche' da quel momento il prompt vive nel
	 * transcript e rimetterlo in coda sarebbe lavoro svolto due volte.
	 */
	private readonly inFlight = new Map<string, InFlightTask>();
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
			projectStore.projects
				.filter((project) => project.canonicalProjectPath)
				.map((project) => this.loadProject(project.canonicalProjectPath!))
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
			this.tasks = mergeReloadedTasks(this.tasks, key, fromDisk);
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
		const project = projectStore.projects.find(
			(p) => p.canonicalProjectPath && projectKey(p.canonicalProjectPath) === key
		);
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
			if (!project.canonicalProjectPath) continue;
			total += counts[projectKey(project.canonicalProjectPath)] ?? 0;
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
		const loaded = await this.loadProject(projectPath);
		if (!loaded) {
			console.error(`Coda non letta da disco: svuotamento annullato per ${projectPath}`);
			return;
		}
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
		this.rollbackSeq[id] = (this.rollbackSeq[id] ?? 0) + 1;
		this.saveProject(task.projectPath);
	}

	/**
	 * Il task ha raggiunto la sua sessione. Il record di lancio conserva anche
	 * la corsia che lo ha eseguito: e' l'unica traccia che resta quando il
	 * worktree viene rimosso dopo l'integrazione.
	 */
	completeDispatch(id: string, sessionId: string, lane?: TaskRunLaneContext) {
		const task = this.taskById(id);
		if (!task) return;
		this.origins = this.origins.filter((origin) =>
			origin.projectPath !== task.projectPath || origin.sessionId !== sessionId
		);
		const title = task.prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Nuovo task';
		const origin: TaskSessionOrigin = {
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
		};
		// I campi di corsia compaiono solo quando la spedizione li conosce: un
		// record senza corsia resta identico a quelli scritti prima di W09.
		if (lane) {
			origin.laneId = lane.laneId;
			origin.laneTitle = lane.laneTitle;
			origin.laneKind = lane.laneKind;
			if (lane.workspacePath) origin.workspacePath = lane.workspacePath;
			if (lane.branch) origin.branch = lane.branch;
			if (lane.targetBranch) origin.targetBranch = lane.targetBranch;
		}
		this.origins.push(origin);
		this.origins = pruneOrigins(this.origins);
		// Lo snapshot vive finche' omp non conferma la consegna: e' l'unica
		// copia del prompt in quella finestra (vedi `restoreDroppedTask`).
		this.inFlight.set(projectKey(task.projectPath), {
			task: { ...task, images: task.images ? [...task.images] : [] },
			sessionId
		});
		const path = task.projectPath;
		this.tasks = this.tasks.filter((candidate) => candidate.id !== id);
		this.reindex(path);
		this.saveProject(path);
		this.saveGlobal();
		void emit('studio-task-origins-update', $state.snapshot(this.origins));
	}

	/** Storico dei lanci di un progetto proiettato sui `TaskRun` del Gate R27. */
	taskRunsFor(projectPath: string): TaskRunRecord[] {
		const key = projectKey(projectPath);
		const owner = projectStore.projects.find(
			(candidate) =>
				candidate.canonicalProjectPath && projectKey(candidate.canonicalProjectPath) === key
		);
		return this.originsFor(projectPath).map((origin) =>
			taskRunFromOrigin(origin, owner?.id ?? key)
		);
	}

	/** Corsia che ha eseguito una sessione, se quella sessione nasce da un task. */
	taskRunFor(projectPath: string, sessionId: string): TaskRunRecord | undefined {
		const key = projectKey(projectPath);
		const origin = this.origins.find(
			(candidate) => candidate.projectPath === key && candidate.sessionId === sessionId
		);
		if (!origin) return undefined;
		const owner = projectStore.projects.find(
			(candidate) =>
				candidate.canonicalProjectPath && projectKey(candidate.canonicalProjectPath) === key
		);
		return taskRunFromOrigin(origin, owner?.id ?? key);
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

	/**
	 * omp ha dato segno di vita per questo progetto: il prompt del task e'
	 * arrivato in sessione, il transcript lo conserva e lo storico lo
	 * riprende. Lo snapshot in volo non serve piu' e deve sparire: e' la
	 * copia che, rimessa in coda, faceva ricomparire come "da fare" un
	 * lavoro gia' svolto.
	 */
	confirmTaskDelivered(projectPath: string) {
		if (!projectPath) return;
		this.inFlight.delete(projectKey(projectPath));
	}

	/**
	 * Chiusura di un progetto o uscita da Studio: un task rimasto in
	 * spedizione non ha ancora una sessione, quindi torna in coda. I task
	 * consegnati restano fuori, perche' vivono nella loro sessione.
	 *
	 * Salva sempre e subito: e' anche l'ultima occasione per svuotare le
	 * scritture ritardate su `.omp/tasks.json`.
	 */
	async resetDispatchingTasks(projectPath: string): Promise<void> {
		if (!projectPath) return;
		const key = projectKey(projectPath);
		// La coda su disco va letta prima di riscriverla: altrimenti il
		// salvataggio finale la sostituirebbe con la memoria parziale.
		await this.loadProject(projectPath);
		for (const task of this.tasks) {
			if (task.projectPath !== key || task.status !== 'dispatching') continue;
			task.status = 'queued';
			task.updatedAt = Date.now();
			this.rollbackSeq[task.id] = (this.rollbackSeq[task.id] ?? 0) + 1;
		}
		this.reindex(projectPath);
		await this.saveProjectImmediate(projectPath);
	}

	/**
	 * Il processo omp e' morto prima di ricevere il prompt: il task e' gia'
	 * uscito dalla coda e il suo testo vive solo nello snapshot in volo.
	 * Rimetterlo in cima alla coda e' l'unico recupero possibile.
	 */
	async restoreDroppedTask(projectPath: string, sessionId?: string | null): Promise<StudioTask | null> {
		if (!projectPath) return null;
		const key = projectKey(projectPath);
		await this.loadProject(projectPath);
		const queuedIds = new Set(
			this.tasks.filter((task) => task.projectPath === key).map((task) => task.id)
		);
		const restored = resolveDroppedTask(this.inFlight.get(key), sessionId, queuedIds);
		if (restored) {
			this.inFlight.delete(key);
			this.tasks.unshift(restored);
			this.rollbackSeq[restored.id] = (this.rollbackSeq[restored.id] ?? 0) + 1;
		}
		await this.resetDispatchingTasks(projectPath);
		return restored;
	}

	private reindex(projectPath: string) {
		this.tasksFor(projectPath).forEach((task, index) => task.position = index);
	}
}

export const taskStore = new TaskStore();
