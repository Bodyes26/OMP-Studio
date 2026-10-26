/**
 * Generazione dei titoli dei task in coda con il modello leggero.
 *
 * Una richiesta alla volta: aprire un progetto con molti task senza titolo
 * non deve lanciare decine di `omp` in parallelo. Ogni richiesta aspetta che
 * il prompt resti fermo per un attimo, cosi' l'editor che salva a ogni tasto
 * non produce una chiamata per carattere.
 *
 * Genera solo la finestra principale: la Companion legge lo stesso
 * `.omp/tasks.json` e riceverebbe il titolo due volte, pagandolo due volte.
 * Lo stato di generazione viene sincronizzato cross-window con `studio-task-titles-generating`
 * cosi' che Companion possa mostrare il placeholder animato fedelmente, con handshake
 * all'apertura (`studio-task-titles-sync-request`).
 */

import { invoke } from '@tauri-apps/api/core';
import { settingsStore } from './settings.svelte';
import { taskStore } from './tasks.svelte';
import { windowLabel, broadcastToWindows, listenFromWindows } from './windowBridge';
import { freshGeneratedTitle, promptHash } from './taskTitle';

/** Pausa di scrittura dopo cui il prompt si considera stabile. */
const SETTLE_MS = 1500;

export const TASK_TITLES_GENERATING_EVENT = 'studio-task-titles-generating';
export const TASK_TITLES_SYNC_REQUEST_EVENT = 'studio-task-titles-sync-request';

const settling = new Map<string, ReturnType<typeof setTimeout>>();
const queue: string[] = [];
const queued = new Set<string>();
let inFlightTaskId: string | null = null;
let inFlightHash: string | null = null;

/**
 * Impronta del prompt per cui il modello non ha dato un titolo usabile: la
 * card resta sull'euristica e non si ritenta finche' il testo non cambia,
 * altrimenti ogni rendering rilancerebbe la stessa chiamata fallita.
 */
const failedFor = new Map<string, string>();
let draining = false;

let generatingIds = $state<string[]>([]);

function syncGeneratingState(): void {
	const current = Array.from(
		new Set([
			...settling.keys(),
			...queued,
			...(inFlightTaskId ? [inFlightTaskId] : [])
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

// Handshake cross-window: la finestra principale risponde alle richieste di stato iniziale
if (windowLabel === 'main') {
	void listenFromWindows(TASK_TITLES_SYNC_REQUEST_EVENT, () => {
		void broadcastToWindows(TASK_TITLES_GENERATING_EVENT, generatingIds);
	});
} else {
	// Se siamo in un'altra finestra (es. Companion), ascoltiamo gli aggiornamenti
	// e chiediamo lo snapshot iniziale alla principale.
	void listenFromWindows<string[]>(TASK_TITLES_GENERATING_EVENT, (remoteIds) => {
		generatingIds = Array.isArray(remoteIds) ? remoteIds : [];
	}).then(() => {
		void broadcastToWindows(TASK_TITLES_SYNC_REQUEST_EVENT, {});
	});
}

/**
 * Indica se il titolo per il task specificato è attualmente in corso di generazione.
 * Ritorna false se il titolo è già pronto, se la generazione è fallita o disabilitata.
 */
export function isTaskTitleGenerating(taskId: string): boolean {
	return generatingIds.includes(taskId);
}

export function getGeneratingTaskTitleIds(): readonly string[] {
	return generatingIds;
}

function wantsTitle(taskId: string): boolean {
	if (windowLabel !== 'main' || !settingsStore.taskTitles.autoGenerate) return false;
	const task = taskStore.taskById(taskId);
	if (!task || task.status !== 'queued' || !task.prompt.trim()) return false;
	return freshGeneratedTitle(task) === null && failedFor.get(taskId) !== promptHash(task.prompt);
}

/**
 * Chiede il titolo di un task se gli manca o e' scaduto. Idempotente: si
 * chiama a ogni salvataggio e a ogni rendering della card.
 */
export function requestTaskTitle(taskId: string): void {
	if (!wantsTitle(taskId)) {
		if (settling.has(taskId) || queued.has(taskId)) {
			clearTimeout(settling.get(taskId));
			settling.delete(taskId);
			queued.delete(taskId);
			syncGeneratingState();
		}
		return;
	}

	const task = taskStore.taskById(taskId);
	if (!task) return;
	const hash = promptHash(task.prompt);

	// Se la generazione per questa esatta impronta del prompt è già in volo,
	// non accodiamo una seconda richiesta identica né lasciamo timeout pendenti.
	if (inFlightTaskId === taskId && inFlightHash === hash) {
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
			if (queued.has(taskId)) {
				syncGeneratingState();
				return;
			}
			if (inFlightTaskId === taskId && inFlightHash === hash) {
				syncGeneratingState();
				return;
			}
			queued.add(taskId);
			queue.push(taskId);
			syncGeneratingState();
			void drain();
		}, SETTLE_MS)
	);
	syncGeneratingState();
}

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	try {
		while (queue.length > 0) {
			const taskId = queue.shift()!;
			queued.delete(taskId);
			if (!wantsTitle(taskId)) {
				syncGeneratingState();
				continue;
			}

			const prompt = taskStore.taskById(taskId)!.prompt;
			const hash = promptHash(prompt);

			inFlightTaskId = taskId;
			inFlightHash = hash;
			syncGeneratingState();

			let title: string | null = null;
			try {
				title = await invoke<string | null>('generate_task_title', { prompt });
			} catch (err) {
				console.warn('Titolo del task non generato:', err);
			}

			inFlightTaskId = null;
			inFlightHash = null;

			// Il prompt puo' essere cambiato durante la chiamata: quel titolo
			// descriverebbe un testo che non esiste piu'. La modifica ha gia'
			// rimesso il task in attesa di una nuova richiesta.
			const current = taskStore.taskById(taskId);
			if (!current || promptHash(current.prompt) !== hash) {
				syncGeneratingState();
				continue;
			}

			// Pulizia da settling per evitare che chiamate concorrenti lascino il placeholder attivo
			clearTimeout(settling.get(taskId));
			settling.delete(taskId);

			if (title) taskStore.setTaskTitle(taskId, title, hash);
			else failedFor.set(taskId, hash);

			syncGeneratingState();
		}
	} finally {
		inFlightTaskId = null;
		inFlightHash = null;
		draining = false;
		syncGeneratingState();
	}
}
