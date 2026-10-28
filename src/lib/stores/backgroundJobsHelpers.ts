/**
 * Funzioni pure per il gestore dei job di background:
 * - Valutazione della soglia di quota (quotaFloor) per modelli con limiti
 * - Selezione seriale del prossimo job da eseguire secondo la priorita'
 * - Migrazione e sanitizzazione delle impostazioni dei background jobs
 */
import type { QuotaLimit, QuotaReport } from './quota.svelte';
export type { QuotaLimit, QuotaReport };
import { familyLimits, modelFamilyFor, remainingFractionOf } from '../quota/resolve';
import { providersMatch } from '../quota/providers';
import { splitModelSelector } from './modelSettingsHelpers';
export type BackgroundJobId = 'taskTitles' | 'sessionTitles' | 'sessionIndex' | 'gitFetch' | 'updateCheck';

export type JobPauseReason = 'globalOff' | 'disabled' | 'userPaused' | 'quotaFloor' | null;

export const BACKGROUND_JOB_ORDER: readonly BackgroundJobId[] = [
	'taskTitles',
	'sessionTitles',
	'sessionIndex',
	'gitFetch',
	'updateCheck'
] as const;

export interface BackgroundJobSettings {
	enabled: boolean;
	model: string;
}

export interface BackgroundJobsSettings {
	enabled: boolean;
	quotaFloorPct: number;
	jobs: Record<BackgroundJobId, BackgroundJobSettings>;
}

export const DEFAULT_BACKGROUND_JOBS_SETTINGS: BackgroundJobsSettings = {
	enabled: true,
	quotaFloorPct: 30,
	jobs: {
		taskTitles: { enabled: true, model: '' },
		sessionTitles: { enabled: true, model: '' },
		sessionIndex: { enabled: true, model: '' },
		gitFetch: { enabled: true, model: '' },
		updateCheck: { enabled: true, model: '' }
	}
};

export interface QuotaGateInput {
	modelOverride?: string;
	modelRoles?: Record<string, string | undefined> | null;
	knownSelectors?: ReadonlySet<string>;
	catalog?: ReadonlyArray<{ selector: string; provider?: string; id?: string }>;
	reports: readonly QuotaReport[];
	quotaFloorPct: number;
}

export interface QuotaGateResult {
	paused: boolean;
	quota: { provider: string; remainingPct: number } | null;
}

/**
 * Valuta il cancello di quota per i job AI.
 * Risolve il provider del modello scelto (oppure role smol, altrimenti default).
 * Se il provider e' a sottoscrizione (ha limiti dichiarati) e QUALSIASI finestra
 * ha percentuale residua < quotaFloorPct, mette in pausa per 'quotaFloor'.
 * I provider locali o API a consumo (senza limiti nel report) non vengono mai bloccati.
 */
export function evaluateQuotaGate(input: QuotaGateInput): QuotaGateResult {
	const { modelOverride, modelRoles, knownSelectors, catalog, reports, quotaFloorPct } = input;
	const explicit = modelOverride?.trim();
	const full = explicit || modelRoles?.['smol']?.trim() || modelRoles?.['default']?.trim() || '';
	if (!full) {
		return { paused: false, quota: null };
	}

	const { base } = splitModelSelector(full, knownSelectors);
	let provider = '';
	let modelId = '';
	const slash = base.indexOf('/');
	if (slash >= 0) {
		provider = base.slice(0, slash);
		modelId = base.slice(slash + 1);
	} else {
		const cat = catalog?.find((m) => m.selector === base || m.id === base);
		if (cat?.provider) {
			provider = cat.provider;
			modelId = cat.id || base;
		} else {
			modelId = base;
		}
	}

	if (!provider) {
		return { paused: false, quota: null };
	}

	const matchingReports = reports.filter((r) => providersMatch(r.provider, provider));
	if (matchingReports.length === 0) {
		return { paused: false, quota: null };
	}

	const fam = modelFamilyFor(modelId);
	const allLimits: QuotaLimit[] = [];
	for (const r of matchingReports) {
		if (Array.isArray(r.limits) && r.limits.length > 0) {
			allLimits.push(...familyLimits(r.limits, fam));
		}
	}

	// I provider senza limiti (es. API pay-as-you-go o modelli locali) non sono soggetti a gate
	if (allLimits.length === 0) {
		return { paused: false, quota: null };
	}

	let minPct = 100;
	let anyBreached = false;
	for (const limit of allLimits) {
		const frac = remainingFractionOf(limit);
		const pct = Math.round(frac * 100);
		if (pct < minPct) minPct = pct;
		if (pct < quotaFloorPct) {
			anyBreached = true;
		}
	}

	return {
		paused: anyBreached,
		quota: {
			provider: matchingReports[0].provider || provider,
			remainingPct: minPct
		}
	};
}

export interface JobStateForPicker {
	enabled: boolean;
	userPaused: boolean;
	quotaPaused: boolean;
	pendingCount: number;
}

/**
 * Seleziona il prossimo job da eseguire in modo strettamente prioritario:
 * taskTitles > sessionTitles > sessionIndex > gitFetch > updateCheck.
 * Un job in pausa (disabilitato, fermato dall'utente o da quota floor) viene saltato.
 */
export function pickNextJob(
	globalEnabled: boolean,
	allPaused: boolean,
	jobStates: Record<BackgroundJobId, JobStateForPicker>,
	jobOrder: readonly BackgroundJobId[] = BACKGROUND_JOB_ORDER
): BackgroundJobId | null {
	if (!globalEnabled || allPaused) return null;

	for (const id of jobOrder) {
		const state = jobStates[id];
		if (!state) continue;
		if (!state.enabled || state.userPaused || state.quotaPaused) continue;
		if (state.pendingCount > 0) {
			return id;
		}
	}

	return null;
}

/**
 * Parsing e migrazione pura delle impostazioni dei background jobs.
 * Migra taskTitles.autoGenerate=false su taskTitles e sessionTitles.
 * Migra github.autoFetch=false su gitFetch.
 */
export function parseBackgroundJobsSettings(
	rawBgJobs: unknown,
	legacyTaskTitles?: unknown,
	legacyGithub?: unknown,
	defaults: BackgroundJobsSettings = DEFAULT_BACKGROUND_JOBS_SETTINGS
): BackgroundJobsSettings {
	const bgRecord = (rawBgJobs && typeof rawBgJobs === 'object' ? rawBgJobs : {}) as Record<string, unknown>;
	const jobsRecord = (bgRecord.jobs && typeof bgRecord.jobs === 'object' ? bgRecord.jobs : {}) as Record<string, unknown>;

	const legacyTaskRecord = legacyTaskTitles && typeof legacyTaskTitles === 'object' ? (legacyTaskTitles as Record<string, unknown>) : null;
	const legacyGitRecord = legacyGithub && typeof legacyGithub === 'object' ? (legacyGithub as Record<string, unknown>) : null;

	const defaultTaskTitlesEnabled = legacyTaskRecord && 'autoGenerate' in legacyTaskRecord
		? Boolean(legacyTaskRecord.autoGenerate)
		: true;
	const defaultSessionTitlesEnabled = legacyTaskRecord && 'autoGenerate' in legacyTaskRecord
		? Boolean(legacyTaskRecord.autoGenerate)
		: true;
	const defaultGitFetchEnabled = legacyGitRecord && 'autoFetch' in legacyGitRecord
		? Boolean(legacyGitRecord.autoFetch)
		: true;

	const parseJob = (id: BackgroundJobId, defEnabled: boolean): BackgroundJobSettings => {
		const raw = (jobsRecord[id] && typeof jobsRecord[id] === 'object' ? jobsRecord[id] : {}) as Record<string, unknown>;
		return {
			enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defEnabled,
			model: typeof raw.model === 'string' ? raw.model : ''
		};
	};

	const rawFloor = typeof bgRecord.quotaFloorPct === 'number' ? bgRecord.quotaFloorPct : defaults.quotaFloorPct;
	const clampedFloor = Math.max(0, Math.min(100, rawFloor));

	return {
		enabled: typeof bgRecord.enabled === 'boolean' ? bgRecord.enabled : defaults.enabled,
		quotaFloorPct: clampedFloor,
		jobs: {
			taskTitles: parseJob('taskTitles', defaultTaskTitlesEnabled),
			sessionTitles: parseJob('sessionTitles', defaultSessionTitlesEnabled),
			sessionIndex: parseJob('sessionIndex', true),
			gitFetch: parseJob('gitFetch', defaultGitFetchEnabled),
			updateCheck: parseJob('updateCheck', true)
		}
	};
}
