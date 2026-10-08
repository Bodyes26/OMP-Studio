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
import {
	MAIN_LANE_ID,
	laneId as toLaneId,
	projectId as toProjectId,
	workspacePath as toWorkspacePath,
	type TaskRunRecord
} from '../types/lanes.ts';
export const AGENT_VIEWS = ['queue', 'sessions', 'rules', 'project'] as const;
export type AgentView = (typeof AGENT_VIEWS)[number];

export type StudioTaskStatus = 'queued' | 'dispatching' | 'in_progress' | 'completed' | 'abandoned';

export interface StudioTaskOptions {
	role?: string;
	modelSelector?: string;
	thinkingLevel?: string;
	includeEditorContext?: boolean;
	directives?: TaskDirectiveSnapshot[];
	prewalk?: boolean;
}

/**
 * Programmazione di un task in coda (Gate R3X-coda-reset). Vive alla radice
 * del task e non in `options`, che `sanitizeLoadedTasks` ricostruisce con una
 * lista fissa di chiavi: in `options` sparirebbe alla prima scrittura della GUI.
 *
 * - `reset`: parte quando la quota del provider del ruolo torna disponibile.
 *   L'orario non si congela: si rilegge `resetsAt` da `omp usage` a ogni giro.
 *   `notBefore` e' il reset letto al momento della scelta e serve solo a
 *   mostrare un orario (marcato «stima») quando i dati di usage mancano.
 * - `at`: non parte prima di `notBefore` (epoch ms).
 *
 * Un task programmato parte da solo anche con l'auto-avvio del progetto
 * spento: la programmazione e' gia' l'azione esplicita dell'utente.
 */
export type TaskScheduleKind = 'reset' | 'at';
export type TaskScheduleOrigin = 'user' | 'recovery';

export interface TaskSchedule {
	kind: TaskScheduleKind;
	/** Provider fissato alla scelta, dal ruolo o dal modello del task. */
	provider?: string;
	/** Finestra che bloccava o che si e' scelta (`anthropic:5h`): informativa. */
	limitId?: string;
	/** `at`: orario scelto. `reset`: reset letto alla scelta, solo indicativo. */
	notBefore?: number;
	origin: TaskScheduleOrigin;
	/** Quando e' stata scelta: distingue i reset passati a Studio chiuso. */
	setAt: number;
	/**
	 * Il momento e' passato mentre Studio era chiuso: il task aspetta una
	 * decisione nel banner («Avvia ora / Lasciali in coda») e non parte da solo.
	 */
	missed?: boolean;
}

/** Voce di ripresa: rilancia `/retry` nella sessione interrotta dal limite. */
export interface TaskResume {
	sessionId: string;
	laneId?: string;
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
	/**
	 * Etichetta sintetica generata dal modello leggero. Vale solo finche'
	 * `titleHash` coincide con l'impronta del prompt: una modifica fatta da
	 * TUI o tool la rende scaduta senza che nessuno debba cancellarla.
	 */
	title?: string;
	titleHash?: string;
	/** Programmazione: vedi `TaskSchedule`. Assente = task normale. */
	schedule?: TaskSchedule;
	/** Presente solo nelle voci di ripresa create da un blocco di quota. */
	resume?: TaskResume;
}

/**
 * Valida la programmazione letta da `tasks.json`, scritta anche da TUI e tool:
 * un valore malformato si scarta, il task resta.
 */
export function normalizeTaskSchedule(value: unknown): TaskSchedule | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const raw = value as Record<string, unknown>;
	if (raw.kind !== 'reset' && raw.kind !== 'at') return undefined;
	const notBefore =
		typeof raw.notBefore === 'number' && Number.isFinite(raw.notBefore) && raw.notBefore > 0
			? raw.notBefore
			: undefined;
	// «Non prima delle» senza orario non dice nulla: meglio un task normale.
	if (raw.kind === 'at' && notBefore === undefined) return undefined;
	const schedule: TaskSchedule = {
		kind: raw.kind,
		origin: raw.origin === 'recovery' ? 'recovery' : 'user',
		setAt: typeof raw.setAt === 'number' && Number.isFinite(raw.setAt) ? raw.setAt : 0
	};
	if (typeof raw.provider === 'string' && raw.provider.trim()) schedule.provider = raw.provider.trim();
	if (typeof raw.limitId === 'string' && raw.limitId.trim()) schedule.limitId = raw.limitId.trim();
	if (notBefore !== undefined) schedule.notBefore = notBefore;
	if (raw.missed === true) schedule.missed = true;
	return schedule;
}

export function normalizeTaskResume(value: unknown): TaskResume | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const raw = value as Record<string, unknown>;
	if (typeof raw.sessionId !== 'string' || !raw.sessionId.trim()) return undefined;
	const resume: TaskResume = { sessionId: raw.sessionId.trim() };
	if (typeof raw.laneId === 'string' && raw.laneId.trim()) resume.laneId = raw.laneId.trim();
	return resume;
}

export interface ProjectTaskFile {
	version: 1;
	tasks: StudioTask[];
}

/**
 * Lo storico machine-local di un lancio (il `TaskRun` del Gate R27): lega il
 * task della coda comune alla corsia che lo ha eseguito, con il workspace e il
 * branch di allora. Serve al badge `WORKTREE` e al filtro dello storico, e
 * resta leggibile anche quando la corsia e' stata archiviata.
 */
export interface TaskSessionOrigin {
	projectPath: string;
	sessionId: string;
	taskId: string;
	title: string;
	prompt?: string;
	images?: ImageContent[];
	options?: StudioTaskOptions;
	launchedAt: number;
	modelSelector?: string;
	thinkingLevel?: string;
	/** Corsia che ha eseguito il task; assente nei lanci precedenti a W09. */
	laneId?: string;
	laneTitle?: string;
	laneKind?: 'main' | 'worktree';
	/** Workspace e branch della corsia al momento del lancio. */
	workspacePath?: string;
	branch?: string;
	targetBranch?: string;
}

export interface FrequentTaskModelConfiguration {
	modelSelector: string;
	thinkingLevel: string;
	count: number;
	lastUsedAt: number;
}

export interface FrequentTaskModel {
	modelSelector: string;
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
		(origin.prompt === undefined || typeof origin.prompt === 'string') &&
		(origin.images === undefined || Array.isArray(origin.images)) &&
		(origin.options === undefined || (typeof origin.options === 'object' && origin.options !== null)) &&
		(origin.modelSelector === undefined || typeof origin.modelSelector === 'string') &&
		(origin.thinkingLevel === undefined || typeof origin.thinkingLevel === 'string') &&
		(origin.laneId === undefined || typeof origin.laneId === 'string') &&
		(origin.laneTitle === undefined || typeof origin.laneTitle === 'string') &&
		(origin.laneKind === undefined || origin.laneKind === 'main' || origin.laneKind === 'worktree') &&
		(origin.workspacePath === undefined || typeof origin.workspacePath === 'string') &&
		(origin.branch === undefined || typeof origin.branch === 'string') &&
		(origin.targetBranch === undefined || typeof origin.targetBranch === 'string')
	);
}

/**
 * Proiezione di un lancio sullo schema `TaskRunRecord` del Gate R27.
 *
 * I lanci precedenti a W09 non conoscono le corsie: valgono come esecuzioni
 * sulla `Principale`, che e' esattamente dove sono avvenuti.
 */
export function taskRunFromOrigin(
	origin: TaskSessionOrigin,
	ownerProjectId: string
): TaskRunRecord {
	const lane = origin.laneId?.trim() || MAIN_LANE_ID;
	const laneKind = origin.laneKind ?? (lane === MAIN_LANE_ID ? 'main' : 'worktree');
	return {
		runId: origin.sessionId,
		taskId: origin.taskId,
		projectId: toProjectId(ownerProjectId),
		laneId: toLaneId(lane),
		laneTitle: origin.laneTitle?.trim() || lane,
		laneKind,
		sessionId: origin.sessionId,
		workspacePath: toWorkspacePath(origin.workspacePath?.trim() || origin.projectPath),
		targetBranch: origin.targetBranch ?? null,
		branch: origin.branch ?? null,
		startedAt: origin.launchedAt,
		finishedAt: null
	};
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
 * Classifica i modelli usati globalmente ignorando il livello di thinking.
 * Il Companion suggerisce un modello, non una configurazione completa: usi
 * dello stesso modello con livelli diversi devono quindi concorrere insieme.
 */
export function rankFrequentTaskModels(
	origins: TaskSessionOrigin[],
	limit = 4,
	windowSize = 50
): FrequentTaskModel[] {
	const recent = origins
		.filter((origin) => Boolean(origin.modelSelector?.trim()))
		.sort((left, right) => right.launchedAt - left.launchedAt)
		.slice(0, windowSize);
	const grouped = new Map<string, FrequentTaskModel>();

	for (const origin of recent) {
		const modelSelector = origin.modelSelector!.trim();
		const existing = grouped.get(modelSelector);
		if (existing) {
			existing.count += 1;
			existing.lastUsedAt = Math.max(existing.lastUsedAt, origin.launchedAt);
		} else {
			grouped.set(modelSelector, {
				modelSelector,
				count: 1,
				lastUsedAt: origin.launchedAt
			});
		}
	}

	return [...grouped.values()]
		.sort((left, right) =>
			right.count - left.count ||
			right.lastUsedAt - left.lastUsedAt ||
			left.modelSelector.localeCompare(right.modelSelector)
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
					directives: directives.length > 0 ? directives : undefined,
					prewalk: rawOptions.prewalk === true ? true : undefined
				};
			}

			const { schedule: rawSchedule, resume: rawResume, ...rest } = task;
			const sanitized: StudioTask = {
				...rest,
				options,
				// Il file e' scritto anche da TUI e tool: un titolo malformato si
				// scarta, il task resta.
				title: typeof task.title === 'string' && task.title.trim() ? task.title.trim() : undefined,
				titleHash: typeof task.titleHash === 'string' ? task.titleHash : undefined,
				projectPath: task.projectPath ?? defaultProjectPath ?? '',
				status: task.status === 'dispatching' ? ('queued' as const) : task.status
			};
			// Programmazione e ripresa: si tengono solo se valide, e una chiave
			// assente resta assente (niente `schedule: undefined` nel record).
			const schedule = normalizeTaskSchedule(rawSchedule);
			if (schedule) sanitized.schedule = schedule;
			const resume = normalizeTaskResume(rawResume);
			if (resume) sanitized.resume = resume;
			return sanitized;
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

/** Tetto di lanci conservati per progetto e di lanci con payload completo. */
const ORIGINS_PER_PROJECT = 50;
const ORIGINS_WITH_PAYLOAD = 3;

/**
 * Le origini sono lo storico dei lanci: danno il titolo alla sessione appena
 * nata e sono l'unica copia del prompt di un task uscito dalla coda. Prompt e
 * immagini pesano quanto il task (uno screenshot vale centinaia di KB) e lo
 * store globale viene riscritto per intero a ogni modifica di coda: oltre i
 * lanci recenti si conserva quindi solo l'identita' del lancio.
 */
export function pruneOrigins(origins: TaskSessionOrigin[]): TaskSessionOrigin[] {
	const byProject = new Map<string, TaskSessionOrigin[]>();
	for (const origin of origins) {
		const bucket = byProject.get(origin.projectPath);
		if (bucket) bucket.push(origin);
		else byProject.set(origin.projectPath, [origin]);
	}

	const kept: TaskSessionOrigin[] = [];
	for (const bucket of byProject.values()) {
		bucket.sort((left, right) => right.launchedAt - left.launchedAt);
		for (const [index, origin] of bucket.slice(0, ORIGINS_PER_PROJECT).entries()) {
			if (index < ORIGINS_WITH_PAYLOAD) {
				kept.push(origin);
				continue;
			}
			kept.push({ ...origin, prompt: undefined, images: undefined, options: undefined });
		}
	}
	return kept;
}

/**
 * Fonde lo storico dei lanci di un'altra finestra con quello locale.
 *
 * L'array arriva completo ma puo' essere piu' vecchio: sostituirlo
 * cancellerebbe il lancio appena registrato in questa finestra, cioe' l'unica
 * copia del prompt di un task che ha lasciato la coda. A parita' di lancio
 * vince la copia piu' recente, e a parita' di istante quella che porta ancora
 * il prompt.
 */
export function mergeOriginRecords(
	local: TaskSessionOrigin[],
	incoming: TaskSessionOrigin[]
): TaskSessionOrigin[] {
	const byKey = new Map<string, TaskSessionOrigin>();
	for (const origin of [...local, ...incoming]) {
		const key = `${origin.projectPath}\u0000${origin.sessionId}`;
		const known = byKey.get(key);
		const wins =
			!known ||
			origin.launchedAt > known.launchedAt ||
			(origin.launchedAt === known.launchedAt && Boolean(origin.prompt) && !known.prompt);
		if (wins) byKey.set(key, origin);
	}
	return pruneOrigins([...byKey.values()]);
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
