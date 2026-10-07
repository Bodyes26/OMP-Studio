/**
 * Helper e modelli per modalita operative (Fast/Slow), limiti d'uso account
 * e riscaldamento della prompt cache.
 */

import type { CacheWarmingPhase, CacheWarmingOutcome, MessageUsage, ModelInfo, UsageLimitState } from './wire';
import { m } from '$lib/paraglide/messages.js';

export interface CacheWarmingInFlight {
	phase: CacheWarmingPhase;
	provider: string;
	model: string;
	since: number;
}

export interface CacheWarmingLast {
	outcome: CacheWarmingOutcome;
	phase?: CacheWarmingPhase;
	provider?: string;
	model?: string;
	usage?: MessageUsage;
	cost?: number;
	warmingStopReason?: string;
	at: number;
}

/**
 * Formatta un timestamp in forma relativa compatta (es. "adesso", "12s fa", "3m fa", "1h fa").
 */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
	const diffMs = Math.max(0, now - timestamp);
	const sec = Math.round(diffMs / 1000);
	if (sec < 10) return m.chat_v2_composer_modes_cache_time_ago({ time: '<10s' });
	if (sec < 60) return m.chat_v2_composer_modes_cache_time_ago({ time: `${sec}s` });
	const min = Math.floor(sec / 60);
	if (min < 60) return m.chat_v2_composer_modes_cache_time_ago({ time: `${min}m` });
	const hours = Math.floor(min / 60);
	return m.chat_v2_composer_modes_cache_time_ago({ time: `${hours}h` });
}

/**
 * Formatta l'orario di ripristino da secondi epoch secondo il fuso locale dell'utente.
 */
export function formatResetTime(resetsAtSec: number): string {
	if (!Number.isFinite(resetsAtSec) || resetsAtSec <= 0) return '—';
	const d = new Date(resetsAtSec * 1000);
	const now = new Date();
	const isToday =
		d.getDate() === now.getDate() &&
		d.getMonth() === now.getMonth() &&
		d.getFullYear() === now.getFullYear();

	const timeStr = d.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit'
	});

	if (isToday) return timeStr;

	const dateStr = d.toLocaleDateString(undefined, {
		day: '2-digit',
		month: 'short'
	});
	return `${dateStr} ${timeStr}`;
}

/**
 * Il modello attivo ha un livello "priority" che /fast puo' accendere?
 * omp via RPC dice solo `fastModeActive`, che ha senso a modalita' gia' accesa;
 * per nascondere la voce prima serve la sua regola (`isFastModeActive`, omp 18.8):
 * famiglia del provider e livelli dichiarati dal modello. Restano fuori i
 * provider OpenAI-compatibili personalizzati: se li si accende da /fast,
 * `fastModeActive` li fa comparire comunque.
 */
export function modelSupportsFastMode(model: ModelInfo | null | undefined): boolean {
	const provider = model?.provider;
	if (!provider) return false;
	if (provider === 'anthropic') return true;
	if (provider === 'openrouter') {
		const family = model.identity?.class;
		return family === 'openai' || family === 'google';
	}
	// Proxy con protocollo Anthropic: famiglia anthropic, ma priority vale solo sul provider ufficiale.
	if (model.api === 'anthropic-messages') return false;
	if (model.api === 'openai-codex-responses' && model.serviceTiers && model.serviceTiers.length > 0) {
		return model.serviceTiers.includes('priority');
	}
	return provider === 'openai' || provider === 'openai-codex' || provider === 'google' || provider === 'google-vertex';
}

/** Testo breve del limite d'uso per la riga di stato del composer. */
export function usageLimitLabel(limit: UsageLimitState): string {
	const head =
		limit.stage === 'low_priority' && limit.allowanceLeftPercent !== undefined
			? m.chat_v2_composer_status_limit_percent({ percent: limit.allowanceLeftPercent })
			: m.chat_v2_composer_status_limit();
	if (limit.resetsAtSec === undefined) return head;
	return `${head} · ${m.chat_v2_composer_status_resets({ time: formatResetTime(limit.resetsAtSec) })}`;
}

/** Dettaglio del limite d'uso per il tooltip: fase, quota o uso extra, ripristino. */
export function usageLimitDetail(limit: UsageLimitState): string {
	const parts: string[] = [];
	if (limit.stage === 'low_priority') {
		parts.push(m.chat_v2_composer_modes_usage_limit_stage_low_priority());
		if (limit.allowanceLeftPercent !== undefined) {
			parts.push(m.chat_v2_composer_modes_usage_limit_allowance({ percent: limit.allowanceLeftPercent }));
		}
	} else {
		parts.push(m.chat_v2_composer_modes_usage_limit_stage_wrap_up());
		parts.push(
			limit.extraUsage
				? m.chat_v2_composer_modes_usage_limit_extra_yes()
				: m.chat_v2_composer_modes_usage_limit_extra_no()
		);
	}
	if (limit.resetsAtSec !== undefined) {
		parts.push(m.chat_v2_composer_modes_usage_limit_resets_at({ time: formatResetTime(limit.resetsAtSec) }));
	}
	// Il tooltip non va a capo sui `\n`: le parti stanno su una riga separate da un punto.
	return `${m.chat_v2_composer_modes_usage_limit_title()}: ${parts.join(' · ')}`;
}
