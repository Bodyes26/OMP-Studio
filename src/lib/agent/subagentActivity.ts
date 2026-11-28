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

export interface SubagentModelInfo {
	/** Id del provider (es. `anthropic`); l'etichetta leggibile la sceglie la vista. */
	providerId?: string;
	model?: string;
	effort?: string;
	fallback: boolean;
	/** Tipo di agente, solo se diverso dal nome gia' mostrato. */
	agentType?: string;
	contextPct?: number;
	contextTokens?: number;
	contextWindow?: number;
	cost?: number;
	retry?: { attempt: number; max: number; error?: string };
}

/**
 * Metadati del modello di un subagente per la riga sotto nome e attivita'.
 * Il selettore di omp e' `provider/modello`: si taglia alla prima barra perche'
 * l'id del modello puo' contenerne altre (es. `openrouter/anthropic/claude-…`).
 */
export function describeSubagentModel(progress: AgentProgress, shownName?: string): SubagentModelInfo {
	const selector = progress.resolvedModel?.trim();
	let providerId: string | undefined;
	let model: string | undefined;
	if (selector) {
		const slash = selector.indexOf('/');
		if (slash > 0) {
			providerId = selector.slice(0, slash);
			model = selector.slice(slash + 1) || undefined;
		} else {
			model = selector;
		}
	}

	const tokens = progress.contextTokens;
	const windowSize = progress.contextWindow;
	const hasContext = typeof tokens === 'number' && typeof windowSize === 'number' && tokens > 0 && windowSize > 0;

	const retry = progress.retryState;
	const agentType = progress.agent?.trim();

	return {
		providerId,
		model,
		effort: progress.resolvedThinkingLevel || undefined,
		fallback: Boolean(selector) && progress.resolvedModelIsFallback === true,
		agentType: agentType && agentType !== shownName ? agentType : undefined,
		contextPct: hasContext ? Math.min(100, Math.round((tokens / windowSize) * 100)) : undefined,
		contextTokens: hasContext ? tokens : undefined,
		contextWindow: hasContext ? windowSize : undefined,
		cost: typeof progress.cost === 'number' && progress.cost > 0 ? progress.cost : undefined,
		retry:
			retry && progress.status === 'running'
				? { attempt: retry.attempt, max: retry.maxAttempts, error: retry.errorMessage }
				: undefined
	};
}

/** Costo compatto: due decimali, sotto il centesimo «<$0.01». */
export function formatSubagentCost(cost: number): string {
	return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
}
