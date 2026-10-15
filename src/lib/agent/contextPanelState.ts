import type { ContextReport } from './contextReport';

/** Dati della cache necessari al pannello, senza credenziali o dettagli RPC. */
interface ContextCacheUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cttl?: { ephemeral5m?: number; ephemeral1h?: number };
}

/** Contratto serializzabile del pannello: indipendente da sessioni, DOM e Tauri. */
export interface ContextPanelState {
	model: {
		id?: string;
		name?: string;
		provider?: string;
		contextWindow?: number;
		promptCache?: { short?: number; long?: number };
	} | null;
	contextUsage: { tokens?: number; contextWindow?: number; percent?: number } | null;
	currentContextReport: ContextReport | null;
	contextReportStatus: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
	isReady: boolean;
	isAttached: boolean;
	isStreaming: boolean;
	isCompacting: boolean;
	isContextBusy: boolean;
	sessionId: string | null;
	contextReportVersion: number;
	sessionCost: number | null;
	subagentCost: number;
	promptCacheObservation: {
		at: number;
		provider?: string;
		model?: string;
		usage: ContextCacheUsage;
	} | null;
	promptCacheContextChanged: boolean;
	cacheWarmingInFlight: {
		phase: 'streaming' | 'idle';
		provider: string;
		model: string;
		since: number;
	} | null;
	cacheWarmingLast: {
		outcome: 'hit' | 'miss' | 'error' | 'aborted';
		phase?: 'streaming' | 'idle';
		provider?: string;
		model?: string;
		usage?: ContextCacheUsage;
		cost?: number;
		warmingStopReason?: string;
		at: number;
	} | null;
}

export type RemoteContextSnapshot = ContextPanelState & { cacheWarmingMode: 'off' | 'streaming' | 'idle' };

export type ContextPanelSession = ContextPanelState & {
	availableCommands?: unknown;
	refreshContextReport: (force?: boolean) => Promise<void>;
};
