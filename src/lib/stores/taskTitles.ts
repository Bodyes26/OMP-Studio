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
 */

import { invoke } from '@tauri-apps/api/core';
import { settingsStore } from './settings.svelte';
import { taskStore } from './tasks.svelte';
import { windowLabel } from './windowBridge';
import { freshGeneratedTitle, promptHash } from './taskTitle';

/** Pausa di scrittura dopo cui il prompt si considera stabile. */
const SETTLE_MS = 1500;

const settling = new Map<string, ReturnType<typeof setTimeout>>();
const queue: string[] = [];
const queued = new Set<string>();
/**
 * Impronta del prompt per cui il modello non ha dato un titolo usabile: la
 * card resta sull'euristica e non si ritenta finche' il testo non cambia,
 * altrimenti ogni rendering rilancerebbe la stessa chiamata fallita.
 */
const failedFor = new Map<string, string>();
let draining = false;

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
	if (!wantsTitle(taskId)) return;
	clearTimeout(settling.get(taskId));
	settling.set(
		taskId,
		setTimeout(() => {
			settling.delete(taskId);
			if (queued.has(taskId)) return;
			queued.add(taskId);
			queue.push(taskId);
			void drain();
		}, SETTLE_MS)
	);
}

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	try {
		while (queue.length > 0) {
			const taskId = queue.shift()!;
			queued.delete(taskId);
			if (!wantsTitle(taskId)) continue;
			const prompt = taskStore.taskById(taskId)!.prompt;
			const hash = promptHash(prompt);
			let title: string | null = null;
			try {
				title = await invoke<string | null>('generate_task_title', { prompt });
			} catch (err) {
				console.warn('Titolo del task non generato:', err);
			}
			// Il prompt puo' essere cambiato durante la chiamata: quel titolo
			// descriverebbe un testo che non esiste piu'. La modifica ha gia'
			// rimesso il task in attesa di una nuova richiesta.
			const current = taskStore.taskById(taskId);
			if (!current || promptHash(current.prompt) !== hash) continue;
			if (title) taskStore.setTaskTitle(taskId, title, hash);
			else failedFor.set(taskId, hash);
		}
	} finally {
		draining = false;
	}
}
