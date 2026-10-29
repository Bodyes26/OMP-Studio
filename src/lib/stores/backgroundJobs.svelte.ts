/**
 * Gestore unificato dei job di background per OMP Studio.
 *
 * Una sola coda seriale per tutta l'applicazione:
 * - Priorita' rigorosa: taskTitles > sessionTitles > sessionIndex > gitFetch > updateCheck
 * - Interruttore globale e controlli per-job nelle impostazioni
 * - Cancello di quota (quotaFloor) per modelli a sottoscrizione con finestre limitate
 * - Annullamento puntuale dell'operazione corrente (Rust subprocess kill per AI)
 * - Esecuzione solo nella finestra principale; la Companion riceve viste inerti
 *   e sincronizza via eventi lo stato dei task per mostrare il placeholder.
 */

import { invoke } from '@tauri-apps/api/core';
import { untrack } from 'svelte';
import { settingsStore, type BackgroundJobId } from './settings.svelte';
import { taskStore } from './tasks.svelte';
import { projectStore } from './projects.svelte';
import { githubStore } from './github.svelte';
import { studioUpdaterStore } from './studioUpdater.svelte';
import { ompVersionStore } from './ompVersion.svelte';
import { quotaStore } from './quota.svelte';
import { windowLabel, broadcastToWindows, listenFromWindows } from './windowBridge';
import { freshGeneratedTitle, promptHash } from './taskTitle';
import { normalizeProjectPath } from '../utils/paths';
import {
	BACKGROUND_JOB_ORDER,
	evaluateQuotaGate,
	pickNextJob,
	type JobPauseReason,
	type JobStateForPicker,
	type QuotaGateResult
} from './backgroundJobsHelpers';

export type { BackgroundJobId, JobPauseReason };

export interface BackgroundJobView {
	id: BackgroundJobId;
	usesAi: boolean;
	enabled: boolean;
	pending: number;
	running: { label: string; startedAt: number } | null;
	lastRun: { at: number; ok: boolean; detail?: string } | null;
	paused: JobPauseReason;
	quota: { provider: string; remainingPct: number } | null;
}

export interface SessionIndexStats {
	scanned: number;
	updated: number;
	removed: number;
	durationMs: number;
}

export interface UntitledSession {
	sessionId: string;
	prompt: string;
}

export const TASK_TITLES_GENERATING_EVENT = 'studio-task-titles-generating';
export const TASK_TITLES_SYNC_REQUEST_EVENT = 'studio-task-titles-sync-request';

function getTaskQuietDelayMs(): number {
	const sec = settingsStore.backgroundJobs.taskTitleQuietSeconds ?? 2;
	return Math.max(1, Math.min(60, sec)) * 1000;
}
const TICK_MS = 60_000;
const SESSION_INDEX_MIN_INTERVAL_MS = 60_000;
const GIT_FETCH_MIN_INTERVAL_MS = 5 * 60_000;
const UPDATE_CHECK_MIN_INTERVAL_MS = 6 * 3600 * 1000;

// === Stato dei taskTitles ===
type TimerHandle = ReturnType<typeof setTimeout>;
const settling = new Map<string, TimerHandle>();
const taskTitlesQueue: string[] = [];
const taskTitlesQueued = new Set<string>();
const failedFor = new Map<string, string>();
const cancelledFor = new Map<string, string>();
let runningTask = $state<{ taskId: string; hash: string } | null>(null);
let generatingIds = $state<string[]>([]);

// === Stato delle sessionTitles ===
interface SessionTitleJobItem {
	sessionId: string;
	prompt: string;
	priority?: boolean;
	onTitle?: (title: string) => void;
	resolve: (title: string | null) => void;
}
const sessionTitlesQueue: SessionTitleJobItem[] = [];
const sessionTitleQueuedIds = new Set<string>();
const failedSessionFor = new Map<string, string>();
const cancelledSessionFor = new Map<string, string>();
let runningSession = $state<{ sessionId: string; prompt: string } | null>(null);

// === Stato di sessionIndex ===
let sessionIndexPending = $state(false);
let lastSessionIndexAt = 0;

// === Stato di gitFetch ===
const gitFetchQueue: string[] = [];
const gitFetchQueued = new Set<string>();
const lastProjectFetchAt = new Map<string, number>();
let runningGitFetchPath = $state<string | null>(null);

// === Stato di updateCheck ===
let updateCheckPending = $state(false);
let lastUpdateCheckAt = 0;
let checkOmpUpdateHook: (() => Promise<void>) | null = null;
let modelConfigGetter: (() => {
	modelRoles?: Record<string, string | undefined> | null;
	knownSelectors?: ReadonlySet<string>;
	catalog?: ReadonlyArray<{ selector: string; provider?: string; id?: string }>;
}) | null = null;


// === Stato globale di esecuzione e pausa sessione ===
let allPaused = $state(false);
const userPaused = $state(new Set<BackgroundJobId>());

let runningJobId = $state<BackgroundJobId | null>(null);
let runningState = $state<{ label: string; startedAt: number } | null>(null);
let isDraining = false;
let currentCancelFn: (() => void) | null = null;
let currentJobId: string | null = null;

// Ultimi esiti
const lastRun = $state<Record<BackgroundJobId, { at: number; ok: boolean; detail?: string } | null>>({
	taskTitles: null,
	sessionTitles: null,
	sessionIndex: null,
	gitFetch: null,
	updateCheck: null
});

// Listener e timer
let tickIntervalId: ReturnType<typeof setInterval> | null = null;
let effectRootCleanup: (() => void) | null = null;
let teardownListeners: (() => void) | null = null;
let isInitialized = false;

// === Sincronizzazione ID generazione task per Companion ===
function syncGeneratingState(): void {
	const current = Array.from(
		new Set([
			...settling.keys(),
			...taskTitlesQueued,
			...(runningTask ? [runningTask.taskId] : [])
		])
	);
	const changed =
		current.length !== generatingIds.length ||
		current.some((id, idx) => id !== generatingIds[idx]);
	if (changed) {
		generatingIds = current;
		if (windowLabel === 'main') {
			void broadcastToWindows(TASK_TITLES_GENERATING_EVENT, current);
		}
	}
}

if (windowLabel === 'main') {
	void listenFromWindows(TASK_TITLES_SYNC_REQUEST_EVENT, () => {
		void broadcastToWindows(TASK_TITLES_GENERATING_EVENT, generatingIds);
	});
} else {
	void listenFromWindows<string[]>(TASK_TITLES_GENERATING_EVENT, (remoteIds) => {
		generatingIds = Array.isArray(remoteIds) ? remoteIds : [];
	}).then(() => {
		void broadcastToWindows(TASK_TITLES_SYNC_REQUEST_EVENT, {});
	});
}

export function isTaskTitleGenerating(taskId: string): boolean {
	return generatingIds.includes(taskId);
}

export function getGeneratingTaskTitleIds(): readonly string[] {
	return generatingIds;
}

// === Regole e trigger per taskTitles ===
function wantsTaskTitle(taskId: string): boolean {
	if (windowLabel !== 'main') return false;
	if (!settingsStore.backgroundJobs.enabled || !settingsStore.backgroundJobs.jobs.taskTitles.enabled) return false;
	const task = taskStore.taskById(taskId);
	if (!task || task.status !== 'queued' || !task.prompt.trim()) return false;
	// AUT-093: preserva manuali - se il task ha già un titolo manuale (titleHash === 'manual' o !titleHash con title presente), non rigenerare
	if (task.title && (!task.titleHash || task.titleHash === 'manual')) {
		return false;
	}
	const hash = promptHash(task.prompt);
	return (
		freshGeneratedTitle(task) === null &&
		failedFor.get(taskId) !== hash &&
		cancelledFor.get(taskId) !== hash
	);
}

export function requestTaskTitle(taskId: string): void {
	if (windowLabel !== 'main') return;
	if (!wantsTaskTitle(taskId)) {
		if (settling.has(taskId) || taskTitlesQueued.has(taskId)) {
			clearTimeout(settling.get(taskId));
			settling.delete(taskId);
			taskTitlesQueued.delete(taskId);
			const idx = taskTitlesQueue.indexOf(taskId);
			if (idx >= 0) taskTitlesQueue.splice(idx, 1);
			syncGeneratingState();
		}
		return;
	}

	const task = taskStore.taskById(taskId);
	if (!task) return;
	const hash = promptHash(task.prompt);

	if (runningTask?.taskId === taskId && runningTask.hash === hash) {
		if (settling.has(taskId)) {
			clearTimeout(settling.get(taskId));
			settling.delete(taskId);
			syncGeneratingState();
		}
		return;
	}

	clearTimeout(settling.get(taskId));
	settling.set(
		taskId,
		setTimeout(() => {
			settling.delete(taskId);
			if (taskTitlesQueued.has(taskId) || (runningTask?.taskId === taskId && runningTask.hash === hash)) {
				syncGeneratingState();
				return;
			}
			taskTitlesQueued.add(taskId);
			taskTitlesQueue.push(taskId);
			syncGeneratingState();
			void drain();
		}, getTaskQuietDelayMs())
	);
	syncGeneratingState();
}

function sweepUntitledTasks(): void {
	if (windowLabel !== 'main') return;
	for (const task of taskStore.tasks) {
		if (settling.has(task.id) || taskTitlesQueued.has(task.id) || runningTask?.taskId === task.id) continue;
		if (wantsTaskTitle(task.id)) requestTaskTitle(task.id);
	}
}

// === Regole e trigger per sessionTitles ===

export function requestSessionTitle(
	sessionId: string,
	prompt: string,
	options?: { topPriority?: boolean }
): Promise<string | null> {
	if (windowLabel !== 'main' || !prompt.trim()) {
		return Promise.resolve(null);
	}
	const hash = promptHash(prompt);
	if (failedSessionFor.get(sessionId) === hash || cancelledSessionFor.get(sessionId) === hash) {
		return Promise.resolve(null);
	}

	const { promise, resolve } = Promise.withResolvers<string | null>();
	const item: SessionTitleJobItem = {
		sessionId,
		prompt,
		priority: options?.topPriority ?? false,
		resolve
	};
	if (options?.topPriority) {
		sessionTitlesQueue.unshift(item);
	} else {
		sessionTitlesQueue.push(item);
	}
	sessionTitleQueuedIds.add(sessionId);
	void drain();
	return promise;
}

export function generateSessionTitle(sessionId: string, prompt: string): Promise<string | null> {
	return requestSessionTitle(sessionId, prompt, { topPriority: true });
}

/**
 * Rileva se una sessione è un'esecuzione di automazione già titolata con regola/data (AUT-094).
 */
export function isSessionAutomationTitled(entry: { sessionId: string; prompt?: string }): boolean {
	const id = entry.sessionId.toLowerCase();
	if (id.startsWith('auto-') || id.startsWith('automation-') || id.includes('_automation_')) {
		return true;
	}
	const p = (entry.prompt || '').trim();
	if (p.startsWith('[Automazione:') || p.startsWith('[Automation:') || p.startsWith('Automazione:')) {
		return true;
	}
	return false;
}

/**
 * Conteggio delle sessioni prive di titolo nella cronologia per anteprima backfill manuale (AUT-094).
 */
export async function getMissingSessionTitlesCount(): Promise<number> {
	if (windowLabel !== 'main') return 0;
	try {
		const untitled = await invoke<UntitledSession[]>('session_index_untitled', { limit: 500 });
		if (!Array.isArray(untitled)) return 0;
		return untitled.filter((e) => e.sessionId && e.prompt?.trim() && !isSessionAutomationTitled(e)).length;
	} catch {
		return 0;
	}
}

/**
 * Anteprima del backfill manuale dei titoli mancanti con verifica cancello di quota.
 */
export async function previewSessionTitlesBackfill(): Promise<{
	count: number;
	quotaGate: QuotaGateResult;
}> {
	const count = await getMissingSessionTitlesCount();
	const quotaGate = getQuotaGate('sessionTitles');
	return { count, quotaGate };
}

/**
 * Avvia il recupero manuale dei titoli mancanti nella cronologia (AUT-094).
 * Nessun sweep automatico: l'utente avvia e controlla l'operazione.
 */
export async function startSessionTitlesBackfill(): Promise<{ queued: number }> {
	if (windowLabel !== 'main') return { queued: 0 };
	try {
		const untitled = await invoke<UntitledSession[]>('session_index_untitled', { limit: 500 });
		if (!Array.isArray(untitled)) return { queued: 0 };
		let queued = 0;
		for (const entry of untitled) {
			if (!entry.sessionId || !entry.prompt?.trim() || isSessionAutomationTitled(entry)) continue;
			const hash = promptHash(entry.prompt);
			if (
				failedSessionFor.get(entry.sessionId) === hash ||
				cancelledSessionFor.get(entry.sessionId) === hash ||
				sessionTitleQueuedIds.has(entry.sessionId) ||
				runningSession?.sessionId === entry.sessionId
			) {
				continue;
			}
			sessionTitleQueuedIds.add(entry.sessionId);
			sessionTitlesQueue.push({
				sessionId: entry.sessionId,
				prompt: entry.prompt,
				resolve: () => {}
			});
			queued++;
		}
		if (queued > 0) void drain();
		return { queued };
	} catch {
		return { queued: 0 };
	}
}

async function scanUntitledSessions(): Promise<void> {
	void startSessionTitlesBackfill();
}

// === Regole e trigger per gitFetch ===
function getOpenCanonicalPaths(): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	for (const p of projectStore.projects) {
		if (!p.labDraft && p.canonicalProjectPath) {
			const norm = normalizeProjectPath(p.canonicalProjectPath).toLowerCase();
			if (!seen.has(norm)) {
				seen.add(norm);
				paths.push(p.canonicalProjectPath);
			}
		}
	}
	return paths;
}

function enqueueGitFetch(force = false): void {
	if (windowLabel !== 'main') return;
	const targets = getOpenCanonicalPaths();
	const now = Date.now();
	for (const path of targets) {
		const key = normalizeProjectPath(path).toLowerCase();
		if (!force && now - (lastProjectFetchAt.get(key) ?? 0) < GIT_FETCH_MIN_INTERVAL_MS) {
			continue;
		}
		if (!gitFetchQueued.has(key) && runningGitFetchPath !== key) {
			gitFetchQueued.add(key);
			gitFetchQueue.push(path);
		}
	}
	if (gitFetchQueue.length > 0) void drain();
}

// === Regole e trigger per sessionIndex e updateCheck ===
function enqueueSessionIndex(force = false): void {
	if (windowLabel !== 'main') return;
	const now = Date.now();
	if (!force && now - lastSessionIndexAt < SESSION_INDEX_MIN_INTERVAL_MS) return;
	sessionIndexPending = true;
	void drain();
}

function enqueueUpdateCheck(force = false): void {
	if (windowLabel !== 'main') return;
	const now = Date.now();
	if (!force && now - lastUpdateCheckAt < UPDATE_CHECK_MIN_INTERVAL_MS) return;
	updateCheckPending = true;
	void drain();
}

async function checkOmpUpdateSilently(): Promise<void> {
	if (checkOmpUpdateHook) {
		await checkOmpUpdateHook();
		return;
	}
	try {
		const res = await invoke<{
			has_update: boolean;
			current_version?: string;
			latest_version?: string;
		}>('check_omp_update');
		if (res.current_version && res.current_version !== 'unknown') {
			ompVersionStore.set(res.current_version);
		}
	} catch {
		// Non bloccante
	}
}

// === Calcolo quota gate per i job AI ===
function getQuotaGate(jobId: BackgroundJobId): QuotaGateResult {
	if (jobId !== 'taskTitles' && jobId !== 'sessionTitles') {
		return { paused: false, quota: null };
	}
	const cfg = modelConfigGetter?.();
	const bg = settingsStore.backgroundJobs;
	return evaluateQuotaGate({
		modelOverride: bg.jobs[jobId]?.model,
		modelRoles: cfg?.modelRoles,
		knownSelectors: cfg?.knownSelectors,
		catalog: cfg?.catalog,
		reports: quotaStore.reports,
		quotaFloorPct: bg.quotaFloorPct ?? 30,
		quotaShortPct: bg.quotaShortPct ?? bg.quotaFloorPct ?? 30,
		quotaWeeklyPct: bg.quotaWeeklyPct ?? bg.quotaFloorPct ?? 30,
		quotaOtherPct: bg.quotaOtherPct ?? bg.quotaFloorPct ?? 30,
		quotaWindows: bg.quotaWindows
	});
}

// === Esecutore dei singoli job ===
async function executeTaskTitles(): Promise<boolean> {
	const taskId = taskTitlesQueue[0];
	if (!taskId) return true;

	if (!wantsTaskTitle(taskId)) {
		taskTitlesQueue.shift();
		taskTitlesQueued.delete(taskId);
		syncGeneratingState();
		return true;
	}

	const task = taskStore.taskById(taskId);
	if (!task) {
		taskTitlesQueue.shift();
		taskTitlesQueued.delete(taskId);
		syncGeneratingState();
		return true;
	}
	const prompt = task.prompt;
	const hash = promptHash(prompt);

	// AUT-041: acquisizione slot globale prima di dequeue e markrunning
	const claimId = `task_title_${taskId}`;
	let claimed = false;
	try {
		claimed = await invoke<boolean>('automations_title_claim', { id: claimId });
	} catch {
		claimed = true;
	}
	if (!claimed) {
		// Cap generale o precedenza interattiva / automazione personale: resta in attesa senza markrunning o failedFor
		return false;
	}

	taskTitlesQueue.shift();
	taskTitlesQueued.delete(taskId);

	runningTask = { taskId, hash };
	runningJobId = 'taskTitles';
	runningState = {
		label: prompt.trim().slice(0, 36) || taskId,
		startedAt: Date.now()
	};
	syncGeneratingState();

	const jobModel = settingsStore.backgroundJobs.jobs.taskTitles.model.trim();
	const modelSelector = jobModel || undefined;
	const jobId = `task_title_${taskId}_${Date.now()}`;
	currentJobId = jobId;
	currentCancelFn = () => {
		void invoke('background_job_cancel', { jobId });
	};

	let title: string | null = null;
	let wasCancelled = false;
	try {
		title = await invoke<string | null>('generate_task_title', {
			prompt,
			model: modelSelector || null,
			jobId
		});
	} catch (err) {
		if (String(err).toLowerCase().includes('cancel')) {
			wasCancelled = true;
		} else {
			console.warn('Titolo del task non generato:', err);
		}
	} finally {
		currentJobId = null;
		currentCancelFn = null;
		try {
			await invoke('automations_title_release', { id: claimId });
		} catch {
			// rilascio non bloccante
		}
	}

	runningTask = null;
	runningJobId = null;
	runningState = null;

	const current = taskStore.taskById(taskId);
	if (!current || promptHash(current.prompt) !== hash) {
		syncGeneratingState();
		return true;
	}

	clearTimeout(settling.get(taskId));
	settling.delete(taskId);

	if (wasCancelled) {
		cancelledFor.set(taskId, hash);
		lastRun.taskTitles = { at: Date.now(), ok: false, detail: 'cancelled' };
	} else if (title) {
		taskStore.setTaskTitle(taskId, title, hash);
		lastRun.taskTitles = { at: Date.now(), ok: true };
	} else {
		failedFor.set(taskId, hash);
		lastRun.taskTitles = { at: Date.now(), ok: false, detail: 'no title' };
	}
	syncGeneratingState();
	return true;
}

async function executeSessionTitles(): Promise<boolean> {
	const item = sessionTitlesQueue[0];
	if (!item) return true;

	const prompt = item.prompt;
	const hash = promptHash(prompt);

	// AUT-041: acquisizione slot globale prima di dequeue e markrunning
	const claimId = `session_title_${item.sessionId}`;
	let claimed = false;
	try {
		claimed = await invoke<boolean>('automations_title_claim', { id: claimId });
	} catch {
		claimed = true;
	}
	if (!claimed) {
		return false;
	}

	sessionTitlesQueue.shift();
	sessionTitleQueuedIds.delete(item.sessionId);

	runningSession = { sessionId: item.sessionId, prompt };
	runningJobId = 'sessionTitles';
	runningState = {
		label: prompt.trim().slice(0, 36) || item.sessionId,
		startedAt: Date.now()
	};

	const jobModel = settingsStore.backgroundJobs.jobs.sessionTitles.model.trim();
	const modelSelector = jobModel || undefined;
	const jobId = `session_title_${item.sessionId}_${Date.now()}`;
	currentJobId = jobId;
	currentCancelFn = () => {
		void invoke('background_job_cancel', { jobId });
	};

	let title: string | null = null;
	let wasCancelled = false;
	try {
		title = await invoke<string | null>('generate_task_title', {
			prompt,
			model: modelSelector || null,
			jobId
		});
	} catch (err) {
		if (String(err).toLowerCase().includes('cancel')) {
			wasCancelled = true;
		} else {
			console.warn('Titolo della sessione non generato:', err);
		}
	} finally {
		currentJobId = null;
		currentCancelFn = null;
		try {
			await invoke('automations_title_release', { id: claimId });
		} catch {
			// rilascio non bloccante
		}
	}

	runningSession = null;
	runningJobId = null;
	runningState = null;

	if (wasCancelled) {
		cancelledSessionFor.set(item.sessionId, hash);
		lastRun.sessionTitles = { at: Date.now(), ok: false, detail: 'cancelled' };
		item.resolve(null);
	} else if (title) {
		try {
			await invoke('session_title_save', { sessionId: item.sessionId, title });
		} catch (err) {
			console.warn('Titolo della sessione non salvato:', err);
		}
		item.onTitle?.(title);
		item.resolve(title);
		window.dispatchEvent(new CustomEvent('studio-sessions-refresh', { detail: {} }));
		lastRun.sessionTitles = { at: Date.now(), ok: true };
	} else {
		failedSessionFor.set(item.sessionId, hash);
		lastRun.sessionTitles = { at: Date.now(), ok: false, detail: 'no title' };
		item.resolve(null);
	}
	return true;
}


async function executeSessionIndex(): Promise<void> {
	sessionIndexPending = false;
	runningJobId = 'sessionIndex';
	runningState = { label: 'Indice sessioni', startedAt: Date.now() };

	try {
		const stats = await invoke<SessionIndexStats>('session_index_refresh');
		lastSessionIndexAt = Date.now();
		lastRun.sessionIndex = {
			at: Date.now(),
			ok: true,
			detail: stats ? `${stats.scanned} letti, ${stats.updated} agg.` : undefined
		};
		// AUT-094: nessun sweep automatico dello storico durante l'aggiornamento dell'indice
	} catch (err) {
		lastSessionIndexAt = Date.now();
		lastRun.sessionIndex = { at: Date.now(), ok: false, detail: String(err) };
	} finally {
		runningJobId = null;
		runningState = null;
	}
}

async function executeGitFetch(): Promise<void> {
	const path = gitFetchQueue.shift();
	if (!path) return;
	const key = normalizeProjectPath(path).toLowerCase();
	gitFetchQueued.delete(key);
	runningGitFetchPath = key;

	const project = projectStore.projects.find(
		(p) =>
			p.canonicalProjectPath &&
			normalizeProjectPath(p.canonicalProjectPath).toLowerCase() === key
	);
	const label = project?.name || path;

	runningJobId = 'gitFetch';
	runningState = { label, startedAt: Date.now() };
	lastProjectFetchAt.set(key, Date.now());

	try {
		await githubStore.checkRemote(path, true);
		lastRun.gitFetch = { at: Date.now(), ok: true };
	} catch (err) {
		lastRun.gitFetch = { at: Date.now(), ok: false, detail: String(err) };
	} finally {
		runningGitFetchPath = null;
		runningJobId = null;
		runningState = null;
	}
}

async function executeUpdateCheck(): Promise<void> {
	updateCheckPending = false;
	runningJobId = 'updateCheck';
	runningState = { label: 'Verifica aggiornamenti', startedAt: Date.now() };

	try {
		await studioUpdaterStore.checkUpdate(false);
		await checkOmpUpdateSilently();
		lastUpdateCheckAt = Date.now();
		lastRun.updateCheck = { at: Date.now(), ok: true };
	} catch (err) {
		lastUpdateCheckAt = Date.now();
		lastRun.updateCheck = { at: Date.now(), ok: false, detail: String(err) };
	} finally {
		runningJobId = null;
		runningState = null;
	}
}

// === Coda seriale ===
async function drain(): Promise<void> {
	if (isDraining || windowLabel !== 'main') return;
	isDraining = true;

	try {
		let aiSlotBlocked = false;
		while (true) {
			// AUT-090: sessionIndex, gitFetch, updateCheck continuano anche se enabled=false
			if (allPaused) break;

			const taskGate = getQuotaGate('taskTitles');
			const sessionGate = getQuotaGate('sessionTitles');
			const jobStates: Record<BackgroundJobId, JobStateForPicker> = {
				taskTitles: {
					enabled: settingsStore.backgroundJobs.jobs.taskTitles.enabled && !aiSlotBlocked,
					userPaused: userPaused.has('taskTitles'),
					quotaPaused: taskGate.paused,
					pendingCount: taskTitlesQueue.length
				},
				sessionTitles: {
					enabled: settingsStore.backgroundJobs.jobs.sessionTitles.enabled && !aiSlotBlocked,
					userPaused: userPaused.has('sessionTitles'),
					quotaPaused: sessionGate.paused,
					pendingCount: sessionTitlesQueue.length
				},
				sessionIndex: {
					enabled: settingsStore.backgroundJobs.jobs.sessionIndex.enabled,
					userPaused: userPaused.has('sessionIndex'),
					quotaPaused: false,
					pendingCount: sessionIndexPending ? 1 : 0
				},
				gitFetch: {
					enabled: settingsStore.backgroundJobs.jobs.gitFetch.enabled,
					userPaused: userPaused.has('gitFetch'),
					quotaPaused: false,
					pendingCount: gitFetchQueue.length
				},
				updateCheck: {
					enabled: settingsStore.backgroundJobs.jobs.updateCheck.enabled,
					userPaused: userPaused.has('updateCheck'),
					quotaPaused: false,
					pendingCount: updateCheckPending ? 1 : 0
				}
			};

			const nextJob = pickNextJob(
				settingsStore.backgroundJobs.enabled,
				allPaused,
				jobStates
			);

			if (!nextJob) break;

			switch (nextJob) {
				case 'taskTitles': {
					const ok = await executeTaskTitles();
					if (!ok) {
						aiSlotBlocked = true;
					}
					break;
				}
				case 'sessionTitles': {
					const ok = await executeSessionTitles();
					if (!ok) {
						aiSlotBlocked = true;
					}
					break;
				}
				case 'sessionIndex':
					await executeSessionIndex();
					break;
				case 'gitFetch':
					await executeGitFetch();
					break;
				case 'updateCheck':
					await executeUpdateCheck();
					break;
			}
		}
	} finally {
		isDraining = false;
	}
}

// === Vista e contratti esportati ===
function computeView(id: BackgroundJobId): BackgroundJobView {
	const usesAi = id === 'taskTitles' || id === 'sessionTitles';
	const enabled = settingsStore.backgroundJobs.jobs[id]?.enabled ?? true;
	const isUserPaused = allPaused || userPaused.has(id);
	const gate = usesAi ? getQuotaGate(id) : { paused: false, quota: null };

	let pausedReason: JobPauseReason = null;
	if (usesAi && !settingsStore.backgroundJobs.enabled) {
		pausedReason = 'globalOff';
	} else if (!enabled) {
		pausedReason = 'disabled';
	} else if (isUserPaused) {
		pausedReason = 'userPaused';
	} else if (usesAi && gate.paused) {
		pausedReason = gate.reason === 'unknown' ? 'unknown' : gate.reason === 'noUsableAccount' ? 'noUsableAccount' : 'quotaFloor';
	}

	let pending = 0;
	if (id === 'taskTitles') pending = settling.size + taskTitlesQueue.length;
	else if (id === 'sessionTitles') pending = sessionTitlesQueue.length;
	else if (id === 'sessionIndex') pending = sessionIndexPending ? 1 : 0;
	else if (id === 'gitFetch') pending = gitFetchQueue.length;
	else if (id === 'updateCheck') pending = updateCheckPending ? 1 : 0;

	return {
		id,
		usesAi,
		enabled,
		pending,
		running: runningJobId === id ? runningState : null,
		lastRun: lastRun[id],
		paused: pausedReason,
		quota: gate.quota
	};
}

const INERT_VIEWS: BackgroundJobView[] = BACKGROUND_JOB_ORDER.map((id: BackgroundJobId) => ({
	id,
	usesAi: id === 'taskTitles' || id === 'sessionTitles',
	enabled: false,
	pending: 0,
	running: null,
	lastRun: null,
	paused: null,
	quota: null
}));

export const backgroundJobs = {
	get views(): BackgroundJobView[] {
		if (windowLabel !== 'main') return INERT_VIEWS;
		return BACKGROUND_JOB_ORDER.map(computeView);
	},

	get activeCount(): number {
		if (windowLabel !== 'main') return 0;
		const views = this.views;
		const isRunning = runningState !== null ? 1 : 0;
		return isRunning + views.reduce((sum, v) => sum + v.pending, 0);
	},

	get running(): BackgroundJobView | null {
		if (windowLabel !== 'main' || !runningJobId) return null;
		return this.views.find((v) => v.id === runningJobId) ?? null;
	},

	cancelCurrent(): void {
		if (windowLabel !== 'main') return;
		if (currentCancelFn) {
			currentCancelFn();
		}
	},

	pauseJob(id: BackgroundJobId): void {
		if (windowLabel !== 'main') return;
		userPaused.add(id);
		if (runningJobId === id) {
			this.cancelCurrent();
		}
		if (id === 'taskTitles') {
			for (const timer of settling.values()) clearTimeout(timer);
			settling.clear();
			taskTitlesQueue.length = 0;
			taskTitlesQueued.clear();
			syncGeneratingState();
		} else if (id === 'sessionTitles') {
			for (const item of sessionTitlesQueue.splice(0)) item.resolve(null);
			sessionTitleQueuedIds.clear();
		} else if (id === 'sessionIndex') {
			sessionIndexPending = false;
		} else if (id === 'gitFetch') {
			gitFetchQueue.length = 0;
			gitFetchQueued.clear();
		} else if (id === 'updateCheck') {
			updateCheckPending = false;
		}
	},

	resumeJob(id: BackgroundJobId): void {
		if (windowLabel !== 'main') return;
		userPaused.delete(id);
		if (id === 'taskTitles') {
			cancelledFor.clear();
			sweepUntitledTasks();
		} else if (id === 'sessionTitles') {
			cancelledSessionFor.clear();
			void drain();
			enqueueSessionIndex(true);
		} else if (id === 'gitFetch') {
			enqueueGitFetch(false);
		} else if (id === 'updateCheck') {
			enqueueUpdateCheck(false);
		}
		void drain();
	},

	pauseAll(): void {
		if (windowLabel !== 'main') return;
		allPaused = true;
		this.cancelCurrent();
		for (const id of BACKGROUND_JOB_ORDER) {
			this.pauseJob(id);
		}
	},

	resumeAll(): void {
		if (windowLabel !== 'main') return;
		allPaused = false;
		userPaused.clear();
		cancelledFor.clear();
		cancelledSessionFor.clear();
		sweepUntitledTasks();
		enqueueSessionIndex(false);
		enqueueGitFetch(false);
		enqueueUpdateCheck(false);
		void drain();
	},

	get allPaused(): boolean {
		return allPaused;
	},

	runNow(id: BackgroundJobId): void {
		if (windowLabel !== 'main') return;
		switch (id) {
			case 'taskTitles':
				sweepUntitledTasks();
				void drain();
				break;
			case 'sessionTitles':
				void startSessionTitlesBackfill();
				break;
			case 'sessionIndex':
				enqueueSessionIndex(true);
				break;
			case 'gitFetch':
				enqueueGitFetch(true);
				break;
			case 'updateCheck':
				enqueueUpdateCheck(true);
				break;
		}
	},

	init(options?: {
		checkOmpUpdate?: () => Promise<void>;
		getModelConfig?: () => {
			modelRoles?: Record<string, string | undefined> | null;
			knownSelectors?: ReadonlySet<string>;
			catalog?: ReadonlyArray<{ selector: string; provider?: string; id?: string }>;
		};
	}): void {
		if (windowLabel !== 'main' || isInitialized) return;
		isInitialized = true;
		if (options?.checkOmpUpdate) {
			checkOmpUpdateHook = options.checkOmpUpdate;
		}
		if (options?.getModelConfig) {
			modelConfigGetter = options.getModelConfig;
		}
		// Osservatore reattivo sui task in arrivo (creati da companion o modificati in coda)
		if (typeof window !== 'undefined') {
			$effect.root(() => {
				$effect(() => {
					void settingsStore.backgroundJobs.enabled;
					void settingsStore.backgroundJobs.jobs.taskTitles.enabled;
					for (const task of taskStore.tasks) {
						void [task.id, task.status, task.prompt, task.title, task.titleHash];
					}
					untrack(sweepUntitledTasks);
				});
				return () => {};
			});

			const handleFocus = () => {
				enqueueGitFetch(false);
				sweepUntitledTasks();
				void drain();
			};

			const handleHistoryOpened = () => {
				enqueueSessionIndex(true);
			};

			window.addEventListener('focus', handleFocus);
			window.addEventListener('studio-history-opened', handleHistoryOpened);

			let unlistenAutomations: (() => void) | null = null;
			try {
				void import('@tauri-apps/api/event').then(({ listen }) => {
					void listen('automations://changed', () => {
						void drain();
					}).then((u) => {
						unlistenAutomations = u;
					});
				});
			} catch {
				// non-tauri
			}

			teardownListeners = () => {
				window.removeEventListener('focus', handleFocus);
				window.removeEventListener('studio-history-opened', handleHistoryOpened);
				unlistenAutomations?.();
			};
		}

		// Tick periodico da 60 secondi per compiti di manutenzione (AUT-094: nessun sweep automatico sessioni storiche)
		tickIntervalId = setInterval(() => {
			sweepUntitledTasks();
			enqueueSessionIndex(false);
			enqueueGitFetch(false);
			enqueueUpdateCheck(false);
			void drain();
		}, TICK_MS);

		// All'avvio accoda i controlli iniziali (AUT-094: nessun sweep automatico sessioni)
		enqueueUpdateCheck(false);
		enqueueSessionIndex(false);
		enqueueGitFetch(false);
		sweepUntitledTasks();
		void drain();
	},

	destroy(): void {
		if (tickIntervalId) {
			clearInterval(tickIntervalId);
			tickIntervalId = null;
		}
		if (effectRootCleanup) {
			effectRootCleanup();
			effectRootCleanup = null;
		}
		if (teardownListeners) {
			teardownListeners();
			teardownListeners = null;
		}
		for (const timer of settling.values()) clearTimeout(timer);
		settling.clear();
		isInitialized = false;
	}
};
