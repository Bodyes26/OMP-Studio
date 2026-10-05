/**
 * Titoli delle sessioni generati dal modello leggero.
 *
 * In modalita' RPC omp non titola le sessioni (`PI_NO_TITLE=1`): quelle della
 * chat grafica restavano col solo primo messaggio. Studio genera il titolo con
 * lo stesso comando dei task e lo salva in `session-titles.json`; per la
 * sessione aperta lo consegna anche a omp (`AgentSession.prompt`).
 *
 * Una richiesta alla volta: ogni titolo e' un `omp` effimero, e aprire lo
 * storico di un progetto con decine di sessioni senza titolo non deve
 * lanciarne decine in parallelo.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SessionEntry } from '$lib/agent/sessionsList';
import { settingsStore } from './settings.svelte';
import { windowLabel } from './windowBridge';

interface TitleJob {
	sessionId: string;
	prompt: string;
	onTitle: (title: string) => void;
}

const queue: TitleJob[] = [];
/**
 * Sessioni gia' tentate in questa esecuzione: una sessione per cui il modello
 * non da' un titolo usabile non si ritenta a ogni apertura dello storico.
 */
const attempted = new Set<string>();
let draining = false;

/** Genera e salva il titolo; `null` se il modello non ne da' uno usabile. */
export async function generateSessionTitle(sessionId: string, prompt: string): Promise<string | null> {
	attempted.add(sessionId);
	let title: string | null = null;
	try {
		title = await invoke<string | null>('generate_task_title', { prompt });
	} catch (err) {
		console.warn('Titolo della sessione non generato:', err);
	}
	if (!title) return null;
	try {
		await invoke('session_title_save', { sessionId, title });
	} catch (err) {
		// Il titolo resta valido per la vista corrente; alla prossima apertura
		// la sessione risulta di nuovo senza e viene ritentata.
		console.warn('Titolo della sessione non salvato:', err);
	}
	return title;
}

/**
 * Accoda la generazione dei titoli mancanti dell'elenco. Idempotente: si
 * chiama a ogni caricamento dello storico.
 */
export function backfillSessionTitles(
	entries: readonly SessionEntry[],
	onTitle: (sessionId: string, title: string) => void
): void {
	// La Companion non mostra lo storico: generare anche li' pagherebbe due volte.
	if (windowLabel !== 'main' || !settingsStore.taskTitles.autoGenerate) return;
	for (const entry of entries) {
		if (entry.title || entry.optimistic || !entry.prompt.trim() || attempted.has(entry.id)) continue;
		attempted.add(entry.id);
		queue.push({ sessionId: entry.id, prompt: entry.prompt, onTitle: (title) => onTitle(entry.id, title) });
	}
	void drain();
}

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	try {
		while (queue.length > 0) {
			// Spegnere l'interruttore ferma anche le richieste gia' in coda.
			if (!settingsStore.taskTitles.autoGenerate) {
				for (const job of queue.splice(0)) attempted.delete(job.sessionId);
				break;
			}
			const job = queue.shift()!;
			const title = await generateSessionTitle(job.sessionId, job.prompt);
			if (title) job.onTitle(title);
		}
	} finally {
		draining = false;
	}
}
