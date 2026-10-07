/**
 * Helper e modelli per modalita operative (Fast/Slow), limiti d'uso account,
 * riscaldamento della prompt cache ed esecuzione di obiettivi (Goal).
 */

import type {
	CacheWarmingPhase,
	CacheWarmingOutcome,
	MessageUsage,
	UsageLimitState,
	GoalModeState
} from './wire';
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
 * Sintesi per il tooltip del pulsante unificato delle modalita nel composer.
 */
export function getModesTooltipText(opts: {
	fastModeEnabled: boolean;
	fastModeActive: boolean;
	slowModeEnabled: boolean;
	usageLimit: UsageLimitState | null;
	cacheWarmingInFlight: CacheWarmingInFlight | null;
}): string {
	const { fastModeEnabled, fastModeActive, slowModeEnabled, usageLimit, cacheWarmingInFlight } = opts;

	if (cacheWarmingInFlight) {
		return m.chat_v2_composer_modes_summary_warming();
	}
	if (usageLimit) {
		return m.chat_v2_composer_modes_summary_warning();
	}
	if (fastModeEnabled && fastModeActive) {
		return m.chat_v2_composer_modes_summary_fast();
	}
	if (fastModeEnabled && !fastModeActive) {
		return m.chat_v2_composer_modes_summary_fast_unavailable();
	}
	if (slowModeEnabled) {
		return m.chat_v2_composer_modes_summary_slow();
	}
	return m.chat_v2_composer_modes_summary_neutral();
}
