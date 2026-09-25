import { invoke } from '@tauri-apps/api/core';
import { perfSpan } from '$lib/perf';

export interface SessionEntry {
	id: string;
	title: string;
	created_at: number;
	optimistic?: boolean;
	laneKind?: 'main' | 'worktree';
	laneTitle?: string;
}

/**
 * Mappa delle richieste `sessions_list` attualmente in corso per percorso.
 * Unifica chiamate concorrenti (es. SessionList e GitPanel al cambio progetto o al focus)
 * in una singola chiamata IPC Tauri e una sola lettura backend.
 * Nessuna cache duratura: la chiave viene rimossa appena la Promise si conclude
 * per garantire che le richieste successive ricevano dati sempre aggiornati.
 */
const inFlight = new Map<string, Promise<SessionEntry[]>>();

export function fetchSessionsList(projectPath: string): Promise<SessionEntry[]> {
	const existing = inFlight.get(projectPath);
	if (existing) {
		return existing;
	}

	const endSpan = perfSpan('sessions', `load ${projectPath}`);
	const promise = invoke<SessionEntry[]>('sessions_list', { projectPath })
		.then((res) => {
			endSpan('ok');
			return res;
		})
		.catch((err) => {
			endSpan('error');
			throw err;
		})
		.finally(() => {
			inFlight.delete(projectPath);
		});

	inFlight.set(projectPath, promise);
	return promise;
}
