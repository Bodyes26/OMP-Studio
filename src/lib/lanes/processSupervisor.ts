// Supervisione dei processi runtime di corsia (Gate R27 / PLAN W11).
//
// Non c'e' un supervisore separato: il registro vive nel backend, accanto ai
// Job Object che gia' confinano gli alberi di processi di PTY e RPC. Qui
// stanno la lettura di quel registro e le decisioni pure che ne derivano,
// verificabili dagli smoke test con il solo type-stripping di Node.
//
// Invarianti difese qui:
// 1. Studio ferma solo i processi che ha avviato e solo per la corsia
//    indicata: Principale e le altre corsie non vengono mai toccate.
// 2. La rimozione di un worktree con processi vivi e' rifiutata; l'unica via
//    e' la scelta esplicita "Arresta processi e rimuovi".
// 3. Un cleanup fallito (lock file di Windows, Git che rifiuta) non produce
//    mai una corsia archiviata per finta: resta recuperabile.

import { invoke } from '@tauri-apps/api/core';

export type LaneProcessKind = 'terminal' | 'agent';

/** Voce del registro nativo: un albero di processi posseduto da una corsia. */
export interface LaneProcessInfo {
	kind: LaneProcessKind;
	/** Id della sessione PTY o RPC che ha avviato l'albero. */
	ownerId: number;
	projectId: string;
	laneId: string;
	workspaceRoot: string;
	pid: number | null;
	label: string;
	startedAtMs: number;
}

export interface LaneProcessStopReport {
	stopped: LaneProcessInfo[];
	remaining: LaneProcessInfo[];
}

/**
 * Esito di una rimozione di worktree fallita.
 * - `processes-active`: ci sono processi vivi, serve il consenso esplicito.
 * - `cleanup-pending`: il worktree e' ancora considerato presente (lock,
 *   permessi, Git che rifiuta o stato non verificabile): la corsia resta
 *   recuperabile e riprovabile.
 *
 * Non esiste un esito "gia' sparito" ricavato da un errore: un codice
 * `invalid_path` puo' riferirsi anche alla radice del progetto. Archiviare in
 * base a quell'ambiguita' produrrebbe esattamente il falso `archived` vietato
 * da W11. Solo il successo di `worktree_remove` autorizza l'archiviazione.
 */
export type LaneCleanupFailure = 'processes-active' | 'cleanup-pending';

export interface LaneCleanupDiagnosis {
	failure: LaneCleanupFailure;
	message: string;
	detail: string | null;
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function laneProcessKey(projectId: string, laneId: string): string {
	return `${projectId}::${laneId}`;
}

/** Indice per corsia, usato dall'indicatore discreto sulla tab. */
export function indexLaneProcesses(
	processes: readonly LaneProcessInfo[]
): Map<string, LaneProcessInfo[]> {
	const index = new Map<string, LaneProcessInfo[]>();
	for (const process of processes) {
		const key = laneProcessKey(process.projectId, process.laneId);
		const bucket = index.get(key);
		if (bucket) bucket.push(process);
		else index.set(key, [process]);
	}
	return index;
}

export function laneProcessesFor(
	processes: readonly LaneProcessInfo[],
	projectId: string,
	laneId: string
): LaneProcessInfo[] {
	return processes.filter(
		(process) => process.projectId === projectId && process.laneId === laneId
	);
}

/**
 * Perimetro di un arresto di corsia: cosa viene fermato e cosa resta intatto.
 * Il confine e' l'identita' registrata, mai il nome del processo.
 */
export function partitionStopScope(
	processes: readonly LaneProcessInfo[],
	projectId: string,
	laneId: string
): { targets: LaneProcessInfo[]; preserved: LaneProcessInfo[] } {
	const targets: LaneProcessInfo[] = [];
	const preserved: LaneProcessInfo[] = [];
	for (const process of processes) {
		if (process.projectId === projectId && process.laneId === laneId) targets.push(process);
		else preserved.push(process);
	}
	return { targets, preserved };
}

/** Descrizione compatta per dialoghi e tooltip: "Terminale (PID 1234)". */
export function describeLaneProcess(process: LaneProcessInfo): string {
	return process.pid === null ? process.label : `${process.label} (PID ${process.pid})`;
}

function errorField(error: unknown, field: 'code' | 'message' | 'detail'): string | null {
	if (typeof error !== 'object' || error === null) return null;
	const value = (error as Record<string, unknown>)[field];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Traduce l'errore nativo di `worktree_remove` in una decisione di stato della
 * corsia. Ogni errore lascia la corsia viva: una corsia archiviata mentre il
 * worktree e' ancora su disco, o mentre non e' stato possibile verificarlo,
 * sarebbe una bugia.
 */
export function classifyWorktreeRemovalError(error: unknown): LaneCleanupDiagnosis {
	const code = errorField(error, 'code');
	const message =
		errorField(error, 'message') ??
		(error instanceof Error ? error.message : typeof error === 'string' ? error : 'Rimozione del worktree fallita');
	const detail = errorField(error, 'detail');

	const failure: LaneCleanupFailure =
		code === 'processes_active' ? 'processes-active' : 'cleanup-pending';
	return { failure, message, detail };
}

/** Registro nativo dei processi vivi. Fuori da Tauri non c'e' nulla da vedere. */
export async function listLaneProcesses(): Promise<LaneProcessInfo[]> {
	if (!isTauri()) return [];
	return await invoke<LaneProcessInfo[]>('lane_processes_list');
}

/**
 * Arresta i processi della sola corsia indicata e attende l'uscita dell'intero
 * albero. `remaining` non vuoto significa cleanup ancora bloccato.
 */
export async function stopLaneProcesses(
	projectId: string,
	laneId: string
): Promise<LaneProcessStopReport> {
	if (!isTauri()) return { stopped: [], remaining: [] };
	return await invoke<LaneProcessStopReport>('lane_processes_stop', { projectId, laneId });
}
