/**
 * subagentActivity.ts
 *
 * Descrittori puri per le righe live dei subagenti nel vassoio (Gate R32 - C14).
 * La riga mostra la chiamata in corso da `recentTools`/`lastIntent` e, a fine
 * lavoro, un riepilogo espandibile con esito, chiamate e durata.
 */

import type { AgentProgress } from './wire';

export type SubagentActivityKind = 'tool' | 'intent' | 'result' | 'idle';

export interface SubagentActivity {
	kind: SubagentActivityKind;
	/** Nome del tool in corso o dell'ultima chiamata. */
	tool?: string;
	/** Argomenti sintetici dell'ultima chiamata. */
	args?: string;
	/** Testo da mostrare quando non c'e' un tool diretto (intent o esito). */
	text?: string;
	/** Vero mentre il subagente e' in esecuzione. */
	running: boolean;
}

/**
 * Risolve cosa mostrare nella riga live di un subagente:
 * ultima chiamata da `recentTools`, altrimenti `lastIntent`, altrimenti esito
 * a lavoro finito o stato di attesa.
 */
export function describeSubagentActivity(progress: AgentProgress): SubagentActivity {
	const running = progress.status === 'running';
	const tools = progress.recentTools ?? [];
	const last = tools.length > 0 ? tools[tools.length - 1] : undefined;

	if (last?.tool) {
		return {
			kind: 'tool',
			tool: last.tool,
			args: last.args,
			running
		};
	}

	if (progress.lastIntent) {
		return {
			kind: progress.status === 'completed' ? 'result' : 'intent',
			text: progress.lastIntent,
			running
		};
	}

	const fallback = progress.task ?? progress.assignment ?? progress.description;
	if (fallback) {
		return {
			kind: progress.status === 'completed' ? 'result' : 'intent',
			text: fallback,
			running
		};
	}

	return { kind: 'idle', running };
}

/**
 * Durata compatta per il vassoio (es. "45s", "3:07").
 */
export function formatTrayDuration(ms: number | undefined): string {
	if (ms === undefined || ms === null || Number.isNaN(ms)) return '';
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
