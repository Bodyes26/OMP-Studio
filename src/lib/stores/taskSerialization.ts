/**
 * Parsing, validazione e serializzazione pura dello store tasks.json.
 * Separato dallo store reattivo Svelte 5 per consentire test unitari
 * ed esecuzione deterministica senza dipendenze da Tauri o DOM.
 */

import type { ImageContent } from '../agent/wire';

export const AGENT_VIEWS = ['queue', 'sessions', 'rules'] as const;
export type AgentView = (typeof AGENT_VIEWS)[number];

export type StudioTaskStatus = 'queued' | 'dispatching' | 'in_progress' | 'completed' | 'abandoned';

export interface StudioTaskOptions {
	role?: string;
	modelSelector?: string;
	thinkingLevel?: string;
	planMode?: boolean;
	discussionMode?: boolean;
	minimalMode?: boolean;
	researchMode?: boolean;
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
		.map((task) => ({
			...task,
			projectPath: task.projectPath ?? defaultProjectPath ?? '',
			status: task.status === 'dispatching' ? ('queued' as const) : task.status
		}));
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
 * Applica le direttive speciali del task (discussione, piano, minimale, ricerca) al testo del prompt.
 */
export function applyTaskModeDirectives(prompt: string, options?: StudioTaskOptions): string {
	let body = prompt.trim();
	const prefixes: string[] = [];

	if (options?.discussionMode) {
		prefixes.push(
			'[Modalita Discussione: NON modificare codice subito. Analizza il progetto e usa la skill /grill-me o interroga l\'utente con domande mirate per chiarire decisioni, vincoli e architettura prima di procedere.]'
		);
	}
	if (options?.planMode) {
		prefixes.push(
			'[Modalita Piano: formula prima un piano di esecuzione dettagliato passo-passo ed esponilo per approvazione prima di procedere con modifiche.]'
		);
	}
	if (options?.minimalMode) {
		prefixes.push(
			'[Modalita Minimale: applica la soluzione piu pigra, semplice e minimale possibile (/ponytail). Evita astrazioni premature, boilerplate o nuove dipendenze se non indispensabili.]'
		);
	}

	if (prefixes.length > 0) {
		body = `${prefixes.join('\n\n')}\n\n${body}`;
	}

	if (options?.researchMode) {
		const researchDirective =
			'[Direttiva Ricerca Online: Dopo aver analizzato al completo la richiesta e tutto il codice collegato nel progetto, effettua ricerche online approfondite sull\'ambito e sulla richiesta (documentazione, riferimenti, librerie e best practice) prima di procedere con l\'implementazione o le modifiche.]';
		body = body ? `${body}\n\n${researchDirective}` : researchDirective;
	}

	return body;
}
