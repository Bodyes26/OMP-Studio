/**
 * Funzioni pure per il gestore dei job di background:
 * - Ordinamento di priorita' della coda seriale
 * - Cancello di quota (quotaFloor e riserve per finestra breve/settimanale)
 * - Selezione del prossimo job eseguibile
 * - Parsing e migrazione delle impostazioni (AUT-000, AUT-029–032, AUT-076–080, AUT-090, AUT-093, AUT-094)
 */
import type { QuotaLimit, QuotaReport } from './quota.svelte';
export type { QuotaLimit, QuotaReport };
import { dedupeSharedLimits, familyLimits, modelFamilyFor, remainingFractionOf } from '../quota/resolve';
import { splitModelSelector } from './modelSettingsHelpers';

/**
 * Normalizza alias canonici documentati per il confronto dei provider.
 */
export function canonicalProvider(p?: string): string {
	if (!p) return '';
	const s = p.trim().toLowerCase();
	if (s === 'github-copilot' || s === 'copilot') return 'copilot';
	if (s === 'command-code' || s === 'commandcode') return 'commandcode';
	if (s === 'claude') return 'anthropic';
	if (s === 'codex') return 'openai-codex';
	if (s === 'gemini' || s === 'google-antigravity') return 'google';
	return s;
}
/**
 * Confronta i provider preservando il provider reale ed evitando di fondere
 * provider non intercambiabili (es. google-gemini-cli vs google-antigravity vs google).
 */
export function providersMatchStrict(p1?: string, p2?: string): boolean {
	if (!p1 || !p2) return false;
	return canonicalProvider(p1) === canonicalProvider(p2);
}

export type BackgroundJobId = 'taskTitles' | 'sessionTitles' | 'sessionIndex' | 'gitFetch' | 'updateCheck';

export type JobPauseReason = 'globalOff' | 'disabled' | 'userPaused' | 'quotaFloor' | 'unknown' | 'noUsableAccount' | null;

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
	/** Pavimento legacy di quota (mantenuto per compatibilità con impostazioni esistenti). */
	quotaFloorPct: number;
	/** Riserva minima residua per finestre brevi (<=24h / daily / 5h, default 30%). */
	quotaShortPct: number;
	/** Riserva minima residua per finestre settimanali (default 30%). */
	quotaWeeklyPct: number;
	/** Riserva minima residua per altre finestre (default 30%). */
	quotaOtherPct: number;
	/** Eventuali override specifici per finestra. */
	quotaWindows?: Record<string, number>;
	/** Finestra di quiete per i titoli dei task dopo salvataggio (secondi, default 2s). */
	taskTitleQuietSeconds: number;
	jobs: Record<BackgroundJobId, BackgroundJobSettings>;
}

export const DEFAULT_BACKGROUND_JOBS_SETTINGS: BackgroundJobsSettings = {
	enabled: true,
	quotaFloorPct: 30,
	quotaShortPct: 30,
	quotaWeeklyPct: 30,
	quotaOtherPct: 30,
	quotaWindows: {},
	taskTitleQuietSeconds: 2,
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
	quotaFloorPct?: number;
	quotaShortPct?: number;
	quotaWeeklyPct?: number;
	quotaOtherPct?: number;
	quotaWindows?: Record<string, number>;
}

export interface QuotaGateResult {
	paused: boolean;
	quota: {
		provider: string;
		remainingPct: number;
		window?: string;
		unknown?: boolean;
		usableAccountId?: string;
	} | null;
	reason?: 'quotaFloor' | 'unknown' | 'noUsableAccount' | null;
}

export type WindowCategory = 'short' | 'weekly' | 'other';

/**
 * Classifica la finestra temporale di un limite in "short", "weekly" o "other".
 */
export function categorizeQuotaWindow(limit: QuotaLimit): WindowCategory {
	const ms = limit.window?.durationMs;
	if (typeof ms === 'number' && !Number.isNaN(ms) && ms > 0) {
		if (ms <= 24 * 3600 * 1000) return 'short';
		if (ms <= 7 * 24 * 3600 * 1000) return 'weekly';
		return 'other';
	}
	const id = (limit.window?.id || limit.id || '').toLowerCase();
	const lbl = (limit.label || '').toLowerCase();
	if (
		id.includes('short') ||
		id.includes('5h') ||
		id.includes('day') ||
		id.includes('daily') ||
		lbl.includes('day') ||
		lbl.includes('session')
	) {
		return 'short';
	}
	if (id.includes('week') || id.includes('7d') || lbl.includes('week')) {
		return 'weekly';
	}
	return 'other';
}

/**
 * Valuta il cancello di quota per i job AI (AUT-029/030/031/032/076/077).
 *
 * Semantica:
 * - Risolve provider e famiglia modello (anthropic, google, openai).
 * - Modelli locali (ollama, lmstudio, local, vllm) o pay-as-you-go senza limiti dichiarati
 *   non sono soggetti a blocco quota.
 * - Deduplica gli shared pool (scope.sharedGroup) per ogni account.
 * - Esclude account disabilitati o non autorizzati (metadata.allowed === false o disabled).
 * - Aggregazione multi-account pesata se disponibili capacità fisiche confrontabili,
 *   altrimenti media degli account equivalenti dichiarati (es. 24% + 90% = 57%).
 * - Nessun minimo globale cross-account se la capacità aggregata supera la riserva.
 * - Protezione contro account virtuale cross-expired: deve esistere almeno un account reale
 *   che non abbia finestre critiche esaurite.
 * - Modelli ad abbonamento con report assenti falliscono fail-closed (unknown non assume 100%).
 */
export function evaluateQuotaGate(input: QuotaGateInput): QuotaGateResult {
	const {
		modelOverride,
		modelRoles,
		knownSelectors,
		catalog,
		reports,
		quotaFloorPct = 30,
		quotaShortPct = quotaFloorPct,
		quotaWeeklyPct = quotaFloorPct,
		quotaOtherPct = quotaFloorPct,
		quotaWindows = {}
	} = input;

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

	const pCanonical = canonicalProvider(provider);
	// Provider locali noti: nessun blocco
	if (
		pCanonical === 'ollama' ||
		pCanonical === 'local' ||
		pCanonical === 'lmstudio' ||
		pCanonical === 'llamacpp' ||
		pCanonical === 'vllm' ||
		pCanonical === 'apple'
	) {
		return { paused: false, quota: { provider, remainingPct: 100 } };
	}

	const matchingReports = reports.filter((r) => providersMatchStrict(r.provider, provider));
	const fam = modelFamilyFor(modelId);

	// Provider ad abbonamento senza report: fail-closed (AUT-032 / ACC-15)
	if (matchingReports.length === 0) {
		const isKnownSubscription =
			fam !== null ||
			pCanonical === 'anthropic' ||
			pCanonical === 'openai' ||
			pCanonical === 'openai-codex' ||
			pCanonical === 'google' ||
			pCanonical === 'google-antigravity' ||
			pCanonical === 'google-gemini-cli' ||
			pCanonical === 'github-copilot' ||
			pCanonical === 'factory-droid';
		if (isKnownSubscription) {
			return {
				paused: true,
				quota: { provider, remainingPct: 0, unknown: true },
				reason: 'unknown'
			};
		}
		// Pay-as-you-go o custom API senza limiti dichiarati
		return { paused: false, quota: null };
	}

	const hasAnyLimits = matchingReports.some((r) => r.limits && r.limits.length > 0);
	if (!hasAnyLimits) {
		return { paused: false, quota: null };
	}
	// Filtro account attivi/abilitati e parsing limiti
	interface AccountParsedLimit {
		windowCat: WindowCategory;
		windowId: string;
		remainingPct: number;
		remainingAmount?: number;
		limitAmount?: number;
		isExhausted: boolean;
	}

	interface AccountParsed {
		id: string;
		limits: AccountParsedLimit[];
		isRunnable: boolean;
	}

	const activeAccounts: AccountParsed[] = [];

	for (let i = 0; i < matchingReports.length; i++) {
		const r = matchingReports[i];
		const meta = r.metadata;
		if (meta?.allowed === false || meta?.disabled === true) continue;
		if (typeof meta?.status === 'string' && (meta.status.toLowerCase() === 'disabled' || meta.status.toLowerCase() === 'inactive')) {
			continue;
		}

		const rawLimits = Array.isArray(r.limits) ? r.limits : [];
		if (rawLimits.length === 0) continue;

		// Deduplica shared pool all'interno dell'account e filtra famiglia
		const dedupedLimits = dedupeSharedLimits(familyLimits(rawLimits, fam));
		if (dedupedLimits.length === 0) continue;

		let hasExhausted = false;
		const accountLimits: AccountParsedLimit[] = [];

		for (const limit of dedupedLimits) {
			const windowCat = categorizeQuotaWindow(limit);
			const windowId = limit.window?.id || limit.id || '';
			const frac = remainingFractionOf(limit);
			const remainingPct = Math.round(frac * 100);

			const remAmount = typeof limit.amount?.remaining === 'number' ? limit.amount.remaining : undefined;
			const limAmount = typeof limit.amount?.limit === 'number' && limit.amount.limit > 0 ? limit.amount.limit : undefined;

			const isExhausted = limit.status === 'exhausted' || remainingPct <= 0;
			if (isExhausted) {
				hasExhausted = true;
			}

			accountLimits.push({
				windowCat,
				windowId,
				remainingPct,
				remainingAmount: remAmount,
				limitAmount: limAmount,
				isExhausted
			});
		}

		const accountId = (meta?.accountId as string) || (meta?.email as string) || (meta?.orgId as string) || `account-${i}`;
		activeAccounts.push({
			id: accountId,
			limits: accountLimits,
			isRunnable: !hasExhausted
		});
	}

	if (activeAccounts.length === 0) {
		return {
			paused: true,
			quota: { provider, remainingPct: 0 },
			reason: 'noUsableAccount'
		};
	}

	// AUT-076 / ACC-14: Protezione contro account virtuale cross-expired
	const usableAccount = activeAccounts.find((a) => a.isRunnable);
	if (!usableAccount) {
		return {
			paused: true,
			quota: { provider, remainingPct: 0 },
			reason: 'noUsableAccount'
		};
	}

	// Aggregazione per finestra temporale
	const windowCategories: WindowCategory[] = ['short', 'weekly', 'other'];
	let minAggPct = 100;
	let breachedWindow: { cat: WindowCategory; pct: number } | null = null;

	for (const cat of windowCategories) {
		const reportingAccounts: { remainingPct: number; rem?: number; lim?: number }[] = [];

		for (const acc of activeAccounts) {
			const matchLim = acc.limits.find((l) => l.windowCat === cat);
			if (matchLim) {
				reportingAccounts.push({
					remainingPct: matchLim.remainingPct,
					rem: matchLim.remainingAmount,
					lim: matchLim.limitAmount
				});
			}
		}

		if (reportingAccounts.length === 0) continue;

		// Capacità aggregata:
		// Pesi fisici se disponibili su tutti gli account, altrimenti media aritmetica fra account equivalenti
		const allHavePhysical = reportingAccounts.every(
			(a) => typeof a.rem === 'number' && typeof a.lim === 'number' && (a.lim ?? 0) > 0
		);

		let aggPct: number;
		if (allHavePhysical) {
			const sumRem = reportingAccounts.reduce((acc, a) => acc + (a.rem ?? 0), 0);
			const sumLim = reportingAccounts.reduce((acc, a) => acc + (a.lim ?? 0), 0);
			aggPct = sumLim > 0 ? Math.round((sumRem / sumLim) * 100) : 0;
		} else {
			const sumPct = reportingAccounts.reduce((acc, a) => acc + a.remainingPct, 0);
			aggPct = Math.round(sumPct / reportingAccounts.length);
		}

		aggPct = Math.max(0, Math.min(100, aggPct));
		if (aggPct < minAggPct) {
			minAggPct = aggPct;
		}

		// Soglia applicabile per questa finestra
		const threshold =
			quotaWindows[cat] ??
			(cat === 'short' ? quotaShortPct : cat === 'weekly' ? quotaWeeklyPct : quotaOtherPct);

		if (aggPct < threshold && !breachedWindow) {
			breachedWindow = { cat, pct: aggPct };
		}
	}

	const reportProvider = matchingReports[0]?.provider || provider;
	if (breachedWindow) {
		const q: { provider: string; remainingPct: number; window?: string; usableAccountId?: string } = {
			provider: reportProvider,
			remainingPct: breachedWindow.pct
		};
		if (quotaWindows && Object.keys(quotaWindows).length > 0) {
			q.window = breachedWindow.cat;
		}
		return {
			paused: true,
			quota: q,
			reason: 'quotaFloor'
		};
	}

	return {
		paused: false,
		quota: {
			provider: reportProvider,
			remainingPct: minAggPct
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
 *
 * AUT-090: Le operazioni di manutenzione interna (sessionIndex, gitFetch, updateCheck)
 * NON vengono arrestate dall'interruttore globale (che disabilita solo la titolazione AI).
 * Un job in pausa (disabilitato dall'utente, fermato o da quota floor) viene saltato.
 */
export function pickNextJob(
	globalEnabled: boolean,
	allPaused: boolean,
	jobStates: Record<BackgroundJobId, JobStateForPicker>,
	jobOrder: readonly BackgroundJobId[] = BACKGROUND_JOB_ORDER
): BackgroundJobId | null {
	if (allPaused) return null;

	for (const id of jobOrder) {
		const state = jobStates[id];
		if (!state) continue;

		// AUT-090: sessionIndex, gitFetch, updateCheck sono manutenzione interna
		const isAiTitle = id === 'taskTitles' || id === 'sessionTitles';
		if (isAiTitle && !globalEnabled) continue;

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
 * Mantiene finestre percentuali distinte e finestra di quiete task titoli (AUT-090, AUT-093).
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

	const rawShort = typeof bgRecord.quotaShortPct === 'number' ? bgRecord.quotaShortPct : clampedFloor;
	const rawWeekly = typeof bgRecord.quotaWeeklyPct === 'number' ? bgRecord.quotaWeeklyPct : clampedFloor;
	const rawOther = typeof bgRecord.quotaOtherPct === 'number' ? bgRecord.quotaOtherPct : clampedFloor;

	const rawWindows = (bgRecord.quotaWindows && typeof bgRecord.quotaWindows === 'object' ? bgRecord.quotaWindows : {}) as Record<string, unknown>;
	const parsedWindows: Record<string, number> = {};
	for (const [k, v] of Object.entries(rawWindows)) {
		if (typeof v === 'number' && !Number.isNaN(v)) {
			parsedWindows[k] = Math.max(0, Math.min(100, v));
		}
	}

	const rawQuiet = typeof bgRecord.taskTitleQuietSeconds === 'number' ? bgRecord.taskTitleQuietSeconds : defaults.taskTitleQuietSeconds;
	const clampedQuiet = Math.max(1, Math.min(60, rawQuiet));

	return {
		enabled: typeof bgRecord.enabled === 'boolean' ? bgRecord.enabled : defaults.enabled,
		quotaFloorPct: clampedFloor,
		quotaShortPct: Math.max(0, Math.min(100, rawShort)),
		quotaWeeklyPct: Math.max(0, Math.min(100, rawWeekly)),
		quotaOtherPct: Math.max(0, Math.min(100, rawOther)),
		quotaWindows: parsedWindows,
		taskTitleQuietSeconds: clampedQuiet,
		jobs: {
			taskTitles: parseJob('taskTitles', defaultTaskTitlesEnabled),
			sessionTitles: parseJob('sessionTitles', defaultSessionTitlesEnabled),
			sessionIndex: parseJob('sessionIndex', true),
			gitFetch: parseJob('gitFetch', defaultGitFetchEnabled),
			updateCheck: parseJob('updateCheck', true)
		}
	};
}
