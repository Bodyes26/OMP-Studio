// Logica pura per l'inventario, la scadenza e la proposta di riscatto dei reset
// di rate limit salvati (Codex e Claude, omp 18.9.0+).
//
// Mantiene separate le regole di dominio dalla UI Svelte cosi' gli smoke test
// di Node possono verificare su fixture reali sia l'arricchimento dei report
// del popover sia le condizioni di innesco della card di conferma.

import type { QuotaLimit, QuotaReport } from '../stores/quota.svelte';
import { remainingFractionOf } from './resolve';

export type ResetProviderId = 'openai-codex' | 'anthropic';
export type ResetAutoRedeemMode = 'unset' | 'yes' | 'no';
export type ResetExpiryTier = 'none' | 'soon' | 'imminent' | 'expired';
export type ResetPromptReason = 'rate_limited' | 'expiring';

/** Orizzonti ufficiali di omp (`packages/coding-agent/src/session/reset-expiry.ts`). */
export const RESET_EXPIRY_SOON_MS = 7 * 24 * 3_600_000;
export const RESET_EXPIRY_IMMINENT_MS = 24 * 3_600_000;
export const RESET_LAST_CHANCE_MS = 5 * 60_000;
export const SALVAGE_MIN_USED_FRACTION = 0.25;

export type ResetWindow = '5h' | 'weekly' | 'fable';

export type ResetWindowModes = Partial<Record<ResetWindow, ResetAutoRedeemMode>>;

export interface RawResetProviderPolicy {
	autoRedeem?: ResetAutoRedeemMode | boolean;
	autoRedeem5h?: ResetAutoRedeemMode | boolean;
	autoRedeemWeekly?: ResetAutoRedeemMode | boolean;
	autoRedeemFable?: ResetAutoRedeemMode | boolean;
	autoRedeemByWindow?: Partial<Record<ResetWindow, ResetAutoRedeemMode | boolean>>;
	minBlockedMinutes?: number;
	keepCredits?: number;
	salvageHorizonHours?: number;
}

export interface ResetProviderPolicy {
	autoRedeem: ResetAutoRedeemMode;
	autoRedeemByWindow: Record<ResetWindow, ResetAutoRedeemMode>;
	minBlockedMinutes: number;
	keepCredits: number;
	salvageHorizonHours: number;
}

export type ResetSettingsMap = Record<ResetProviderId, ResetProviderPolicy>;

export interface ResetCreditItem {
	id?: string;
	title?: string;
	program?: string;
	status?: string;
	remainingCount?: number;
	usable?: boolean;
	requiresLimit?: boolean;
	clears?: string[];
	blocking?: string[];
	usedFractions?: Record<string, number>;
	grantedAt?: string;
	expiresAt?: string;
}

export interface ResetAccountRaw {
	provider: string;
	credentialId: number;
	email?: string;
	accountId?: string;
	orgId?: string;
	orgName?: string;
	availableCount: number;
	redeemableCount?: number;
	nextCreditId?: string;
	soonestExpiry?: string;
	unavailableReason?: string;
	error?: string;
	credits?: ResetCreditItem[];
}

export interface UsageResetListRaw {
	generatedAt?: number;
	accounts?: ResetAccountRaw[];
	resetSettings?: Partial<Record<string, Partial<RawResetProviderPolicy>>>;
}

export interface AccountResetSummary {
	provider: ResetProviderId;
	providerLabel: 'Codex' | 'Claude';
	credentialId?: number;
	/** Target canonico `<provider>/<credentialId>` per `omp usage reset`. */
	target?: string;
	accountKey: string;
	label: string;
	email?: string;
	accountId?: string;
	orgId?: string;
	orgName?: string;
	bankedCount: number;
	redeemableCount: number;
	soonestExpiry?: string;
	soonestExpiryMs?: number;
	expiryTier: ResetExpiryTier;
	/** Vero quando la finestra coperta ha almeno il 25% di consumo recuperabile. */
	worthSalvaging: boolean;
	coveredWindowLabel?: string;
	coveredUsedPercent?: number;
	/** Vero quando una finestra coperta dal reset e' esaurita e sbloccabile. */
	isRateLimited: boolean;
	exhaustedWindowLabels: string[];
	creditTitle?: string;
	unavailableReason?: string;
	error?: string;
	window?: ResetWindow;
	autoRedeem: ResetAutoRedeemMode;
	autoRedeemByWindow: Record<ResetWindow, ResetAutoRedeemMode>;
	keepCredits: number;
	minBlockedMinutes: number;
	salvageHorizonHours: number;
	/** Vero se il reset e' riscattabile subito e dispone del target `<provider>/<id>`. */
	canRedeemNow: boolean;
}

export interface ResetPromptCandidate {
	episodeKey: string;
	reason: ResetPromptReason;
	summary: AccountResetSummary;
	window?: ResetWindow;
	settingKey: string;
	/**
	 * `prompt`: chiede conferma esplicita all'utente (`autoRedeem` e' `unset` o `no`).
	 * `auto_informed`: `autoRedeem` e' `yes`, quindi informa senza doppio prompt.
	 */
	mode: 'prompt' | 'auto_informed';
	/** Vero se l'auto-riscatto e' 'no' per la finestra del reset: senza azione manuale va perso. */
	willBeLostWithoutManualRedeem: boolean;
}

const DEFAULT_POLICY: ResetProviderPolicy = {
	autoRedeem: 'unset',
	autoRedeemByWindow: {
		'5h': 'unset',
		weekly: 'unset',
		fable: 'unset'
	},
	minBlockedMinutes: 60,
	keepCredits: 0,
	salvageHorizonHours: 12
};

export function normalizeResetProvider(value: string | undefined): ResetProviderId | null {
	if (!value) return null;
	switch (value.trim().toLowerCase()) {
		case 'openai-codex':
		case 'codex':
		case 'openai':
			return 'openai-codex';
		case 'anthropic':
		case 'claude':
			return 'anthropic';
		default:
			return null;
	}
}

export function formatResetProviderLabel(provider: ResetProviderId): 'Codex' | 'Claude' {
	return provider === 'openai-codex' ? 'Codex' : 'Claude';
}

function normalizeAutoRedeemMode(raw: unknown): ResetAutoRedeemMode {
	if (raw === true) return 'yes';
	if (raw === false) return 'no';
	if (typeof raw === 'string') {
		const lower = raw.trim().toLowerCase();
		if (lower === 'yes' || lower === 'true') return 'yes';
		if (lower === 'no' || lower === 'false') return 'no';
	}
	return 'unset';
}

function normalizePolicy(raw?: Partial<RawResetProviderPolicy> | null): ResetProviderPolicy {
	if (!raw || typeof raw !== 'object') {
		return {
			...DEFAULT_POLICY,
			autoRedeemByWindow: { ...DEFAULT_POLICY.autoRedeemByWindow }
		};
	}

	const legacyMode =
		raw.autoRedeem !== undefined ? normalizeAutoRedeemMode(raw.autoRedeem) : undefined;

	const rawByWin = raw.autoRedeemByWindow;
	const mode5h =
		rawByWin?.['5h'] !== undefined
			? normalizeAutoRedeemMode(rawByWin['5h'])
			: raw.autoRedeem5h !== undefined
				? normalizeAutoRedeemMode(raw.autoRedeem5h)
				: (legacyMode ?? 'unset');

	const modeWeekly =
		rawByWin?.weekly !== undefined
			? normalizeAutoRedeemMode(rawByWin.weekly)
			: raw.autoRedeemWeekly !== undefined
				? normalizeAutoRedeemMode(raw.autoRedeemWeekly)
				: (legacyMode ?? 'unset');

	const modeFable =
		rawByWin?.fable !== undefined
			? normalizeAutoRedeemMode(rawByWin.fable)
			: raw.autoRedeemFable !== undefined
				? normalizeAutoRedeemMode(raw.autoRedeemFable)
				: 'unset';

	// Riepilogo derivato: mantiene il valore legacy se le nuove chiavi per finestra
	// non sono specificate, altrimenti 'yes' solo se tutte le finestre sono yes,
	// 'no' solo se tutte sono no, 'unset' se miste.
	const hasPerWindow =
		raw.autoRedeem5h !== undefined ||
		raw.autoRedeemWeekly !== undefined ||
		raw.autoRedeemFable !== undefined ||
		rawByWin !== undefined;

	let autoRedeem: ResetAutoRedeemMode = legacyMode ?? 'unset';
	if (hasPerWindow) {
		if (mode5h === 'yes' && modeWeekly === 'yes' && (modeFable === 'yes' || modeFable === 'unset')) {
			autoRedeem = 'yes';
		} else if (mode5h === 'no' && modeWeekly === 'no' && (modeFable === 'no' || modeFable === 'unset')) {
			autoRedeem = 'no';
		} else {
			autoRedeem = 'unset';
		}
	}

	return {
		autoRedeem,
		autoRedeemByWindow: {
			'5h': mode5h,
			weekly: modeWeekly,
			fable: modeFable
		},
		minBlockedMinutes:
			typeof raw.minBlockedMinutes === 'number' && Number.isFinite(raw.minBlockedMinutes)
				? Math.max(0, raw.minBlockedMinutes)
				: DEFAULT_POLICY.minBlockedMinutes,
		keepCredits:
			typeof raw.keepCredits === 'number' && Number.isFinite(raw.keepCredits)
				? Math.max(0, Math.trunc(raw.keepCredits))
				: DEFAULT_POLICY.keepCredits,
		salvageHorizonHours:
			typeof raw.salvageHorizonHours === 'number' && Number.isFinite(raw.salvageHorizonHours)
				? Math.max(0, raw.salvageHorizonHours)
				: DEFAULT_POLICY.salvageHorizonHours
	};
}

export function normalizeResetSettings(
	raw?: Partial<Record<string, Partial<RawResetProviderPolicy>>> | null
): ResetSettingsMap {
	return {
		'openai-codex': normalizePolicy(raw?.['openai-codex'] ?? raw?.codexResets),
		anthropic: normalizePolicy(raw?.anthropic ?? raw?.claudeResets)
	};
}

/** Classifica una QuotaLimit nella finestra canonica 5h o weekly. */
export function classifyLimitWindow(limit: QuotaLimit | undefined): '5h' | 'weekly' | undefined {
	if (!limit) return undefined;
	const durationMs = limit.window?.durationMs;
	if (durationMs !== undefined && Number.isFinite(durationMs)) {
		if (Math.abs(durationMs - 7 * 24 * 3_600_000) <= 60_000) return 'weekly';
		if (Math.abs(durationMs - 5 * 3_600_000) <= 60_000) return '5h';
	}
	const windowId = (limit.window?.id ?? '').toLowerCase();
	const limitId = limit.id.toLowerCase();
	if (windowId === '7d' || limitId.includes(':7d') || limitId.includes('secondary')) return 'weekly';
	if (windowId === '5h' || limitId.includes(':5h') || limitId.includes('primary')) return '5h';
	const label = (limit.label || '').toLowerCase();
	if (label.includes('7 day') || label.includes('week')) return 'weekly';
	if (label.includes('5 hour') || label.includes('5h')) return '5h';
	return undefined;
}

/**
 * Determina la finestra di rate limit (5h, weekly, fable) a cui si riferisce un credito o un blocco.
 */
export function detectResetWindow(options: {
	provider: ResetProviderId;
	selectedCredit?: ResetCreditItem;
	creditTitle?: string;
	fullestLimit?: QuotaLimit;
	exhaustedLimits?: QuotaLimit[];
	reason?: ResetPromptReason;
}): ResetWindow | undefined {
	const { provider, selectedCredit, creditTitle, fullestLimit, exhaustedLimits, reason } = options;

	// 1. Claude Fable launch grant: identificato da 'anthropic:7d:fable' in clears o fable nel titolo/id
	if (provider === 'anthropic') {
		if (
			selectedCredit?.clears?.includes('anthropic:7d:fable') ||
			/fable/i.test(selectedCredit?.title ?? creditTitle ?? '') ||
			/fable/i.test(selectedCredit?.id ?? '')
		) {
			return 'fable';
		}
		if (selectedCredit?.program === 'juniper_tide') {
			return '5h';
		}
	}

	// 2. Se bloccato da rate limit, comanda la finestra esaurita (weekly outranks 5h)
	if (reason === 'rate_limited' && exhaustedLimits && exhaustedLimits.length > 0) {
		const windows = exhaustedLimits.map(classifyLimitWindow).filter(Boolean);
		if (windows.includes('weekly')) return 'weekly';
		if (windows.includes('5h')) return '5h';
	}

	// 3. Se credito in scadenza o salvataggio, comanda il limite piu' consumato
	if (fullestLimit) {
		const win = classifyLimitWindow(fullestLimit);
		if (win) return win;
	}

	// 4. Copertura esplicita nei clears del credito
	if (selectedCredit?.clears && selectedCredit.clears.length > 0) {
		if (selectedCredit.clears.some((id) => /7d|week/i.test(id))) {
			return 'weekly';
		}
		if (selectedCredit.clears.every((id) => /5h/i.test(id))) {
			return '5h';
		}
	}

	// 5. Titolo descrittivo del credito
	const title = selectedCredit?.title ?? creditTitle ?? '';
	if (/fable/i.test(title)) return 'fable';
	if (/weekly|7[\s-]*day/i.test(title)) return 'weekly';
	if (/5[\s-]*h/i.test(title)) return '5h';

	return undefined;
}

const MODE_RANK: Record<ResetAutoRedeemMode, number> = { no: 0, unset: 1, yes: 2 };

/**
 * Risolve la modalita' di auto-riscatto per una specifica finestra.
 * Se la finestra e' sconosciuta, applica la regola piu' conservativa:
 * la modalita' con rango piu' basso tra 5h e weekly (no < unset < yes).
 */
export function resolveAutoRedeemModeForWindow(
	byWindow: Record<ResetWindow, ResetAutoRedeemMode> | undefined,
	window: ResetWindow | undefined,
	fallbackAutoRedeem: ResetAutoRedeemMode = 'unset'
): ResetAutoRedeemMode {
	if (!byWindow) return fallbackAutoRedeem;
	if (window) {
		return byWindow[window] ?? fallbackAutoRedeem;
	}
	const fiveHour = byWindow['5h'] ?? fallbackAutoRedeem;
	const weekly = byWindow.weekly ?? fallbackAutoRedeem;
	return MODE_RANK[fiveHour] < MODE_RANK[weekly] ? fiveHour : weekly;
}

/** Formatta la chiave di configurazione corretta per la finestra indicata. */
export function formatResetSettingKey(provider: ResetProviderId, window?: ResetWindow): string {
	const prefix = provider === 'openai-codex' ? 'codexResets' : 'claudeResets';
	if (window === '5h') return `${prefix}.autoRedeem5h`;
	if (window === 'weekly') return `${prefix}.autoRedeemWeekly`;
	if (window === 'fable') return `${prefix}.autoRedeemFable`;
	return `${prefix}.autoRedeem5h + ${prefix}.autoRedeemWeekly`;
}

function normStr(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

/**
 * Stessa regola di identita' di `reportMatchesStatus` in omp (`claude-auto-reset.ts`):
 * provider uguale, orgId compatibile, poi accountId oppure email.
 */
export function reportMatchesResetAccount(
	report: QuotaReport,
	account: Pick<ResetAccountRaw, 'provider' | 'orgId' | 'accountId' | 'email'>
): boolean {
	const leftProvider = normalizeResetProvider(report.provider);
	const rightProvider = normalizeResetProvider(account.provider);
	if (!leftProvider || leftProvider !== rightProvider) return false;

	const reportOrgId = normStr(report.metadata?.orgId);
	const accountOrgId = normStr(account.orgId);
	if (reportOrgId && accountOrgId && reportOrgId !== accountOrgId) return false;

	const reportAccountId = normStr(report.metadata?.accountId) ?? normStr(report.metadata?.account_id);
	const statusAccountId = normStr(account.accountId);
	if (reportAccountId && statusAccountId) return reportAccountId === statusAccountId;

	const reportEmail = normStr(report.metadata?.email);
	const statusEmail = normStr(account.email);
	return Boolean(reportEmail && statusEmail && reportEmail === statusEmail);
}

/** Timestamp epoch ms di un credito ancora in saldo, ignorando i crediti gia' consumati. */
export function bankedCreditExpiryMs(credit: ResetCreditItem): number | undefined {
	if (!credit.expiresAt || credit.remainingCount === 0 || credit.status === 'redeemed') {
		return undefined;
	}
	const ms = Date.parse(credit.expiresAt);
	return Number.isFinite(ms) ? ms : undefined;
}

function resolveUsedFractionOfLimit(limit: QuotaLimit): number {
	if (typeof limit.amount?.usedFraction === 'number' && Number.isFinite(limit.amount.usedFraction)) {
		return Math.max(0, Math.min(1, limit.amount.usedFraction));
	}
	return Math.max(0, Math.min(1, 1 - remainingFractionOf(limit)));
}

function isLimitExhausted(limit: QuotaLimit): boolean {
	if (limit.status === 'exhausted') return true;
	return resolveUsedFractionOfLimit(limit) >= 0.999;
}

function coveredLimitsForAccount(
	provider: ResetProviderId,
	limits: QuotaLimit[],
	selectedCredit?: ResetCreditItem
): QuotaLimit[] {
	if (provider === 'anthropic' && selectedCredit?.clears && selectedCredit.clears.length > 0) {
		const clears = new Set(selectedCredit.clears);
		return limits.filter(
			(limit) =>
				clears.has(limit.id) &&
				(selectedCredit.program !== 'juniper_tide' || limit.id === 'anthropic:5h')
		);
	}
	return limits;
}

function classifyExpiryTier(soonestExpiryMs: number | undefined, nowMs: number): ResetExpiryTier {
	if (soonestExpiryMs === undefined) return 'none';
	const remainingMs = soonestExpiryMs - nowMs;
	if (remainingMs <= 0) return 'expired';
	if (remainingMs <= RESET_EXPIRY_IMMINENT_MS) return 'imminent';
	if (remainingMs <= RESET_EXPIRY_SOON_MS) return 'soon';
	return 'none';
}

function selectPrimaryCredit(
	credits: ResetCreditItem[],
	nextCreditId?: string
): ResetCreditItem | undefined {
	if (nextCreditId) {
		const found = credits.find((c) => c.id === nextCreditId);
		if (found) return found;
	}
	return credits.find((c) => c.usable !== false && c.status !== 'redeemed') ?? credits[0];
}

function buildSingleSummary(
	provider: ResetProviderId,
	report: QuotaReport | undefined,
	account: ResetAccountRaw | undefined,
	policy: ResetProviderPolicy,
	nowMs: number,
	fallbackIndex: number
): AccountResetSummary {
	const reportReset = report?.resetCredits as
		| {
				availableCount?: number;
				redeemableCount?: number;
				eligible?: boolean;
				reason?: string;
				nextCreditId?: string;
				credits?: ResetCreditItem[];
		  }
		| undefined;

	const rawAvailable = account?.availableCount ?? reportReset?.availableCount ?? 0;
	const bankedCount = Math.max(0, Math.trunc(rawAvailable));

	const credits: ResetCreditItem[] = account?.credits ?? reportReset?.credits ?? [];
	const nextCreditId = account?.nextCreditId ?? reportReset?.nextCreditId;
	const selectedCredit = selectPrimaryCredit(credits, nextCreditId);

	// Per Claude omp spende solo il grant selezionato dal server (`nextCreditId`),
	// ma se abbiamo solo `omp usage --json` senza listing dettagliato usiamo redeemableCount.
	const rawRedeemable =
		account?.redeemableCount ?? reportReset?.redeemableCount ?? (reportReset?.eligible === false ? 0 : bankedCount);
	const missingClaudePin =
		provider === 'anthropic' &&
		account !== undefined &&
		!account.nextCreditId &&
		rawRedeemable > 0;
	const redeemableCount = missingClaudePin ? 0 : Math.max(0, Math.trunc(rawRedeemable));

	let soonestExpiry: string | undefined;
	let soonestExpiryMs = Number.POSITIVE_INFINITY;
	let latestExpired: string | undefined;
	let latestExpiredMs = Number.NEGATIVE_INFINITY;

	for (const credit of credits) {
		const expMs = bankedCreditExpiryMs(credit);
		if (expMs === undefined) continue;
		if (expMs > nowMs && expMs < soonestExpiryMs) {
			soonestExpiryMs = expMs;
			soonestExpiry = credit.expiresAt;
		} else if (expMs <= nowMs && expMs > latestExpiredMs) {
			latestExpiredMs = expMs;
			latestExpired = credit.expiresAt;
		}
	}
	if (!soonestExpiry && account?.soonestExpiry) {
		const parsed = Date.parse(account.soonestExpiry);
		if (Number.isFinite(parsed)) {
			soonestExpiry = account.soonestExpiry;
			soonestExpiryMs = parsed;
		}
	}
	if (!soonestExpiry && latestExpired) {
		soonestExpiry = latestExpired;
		soonestExpiryMs = latestExpiredMs;
	}
	const resolvedExpiryMs = Number.isFinite(soonestExpiryMs) ? soonestExpiryMs : undefined;
	const expiryTier = bankedCount > 0 ? classifyExpiryTier(resolvedExpiryMs, nowMs) : 'none';

	const limits = report?.limits ?? [];
	const coveredLimits = coveredLimitsForAccount(provider, limits, selectedCredit);

	let fullestLimit: QuotaLimit | undefined;
	let fullestLabel: string | undefined;
	let fullestUsed = 0;
	for (const limit of coveredLimits) {
		const observed = resolveUsedFractionOfLimit(limit);
		const serverFrac = selectedCredit?.usedFractions?.[limit.id];
		const used = Math.max(
			observed,
			typeof serverFrac === 'number' && Number.isFinite(serverFrac) ? serverFrac : 0
		);
		const isWeekly = classifyLimitWindow(limit) === 'weekly';
		const prevIsWeekly = fullestLimit ? classifyLimitWindow(fullestLimit) === 'weekly' : false;
		if (
			!fullestLabel ||
			used > fullestUsed ||
			(used === fullestUsed && isWeekly && !prevIsWeekly)
		) {
			fullestUsed = used;
			fullestLabel = limit.label || limit.window?.label || limit.id;
			fullestLimit = limit;
		}
	}
	if (!fullestLabel && selectedCredit?.usedFractions) {
		for (const [winId, frac] of Object.entries(selectedCredit.usedFractions)) {
			if (typeof frac === 'number' && Number.isFinite(frac) && frac > fullestUsed) {
				fullestUsed = frac;
				fullestLabel = winId;
			}
		}
	}

	const coveredUsedPercent =
		fullestLabel !== undefined ? Math.round(Math.max(0, Math.min(1, fullestUsed)) * 100) : undefined;
	const worthSalvaging = fullestUsed >= SALVAGE_MIN_USED_FRACTION;

	// Finestre coperte effettivamente esaurite. Su Codex `limitReached` marca entrambe
	// le finestre come `exhausted`, quindi verifichiamo `usedFraction >= 0.999`
	// oppure l'assenza di finestre con frazione ma `status === 'exhausted'`.
	const exhaustedCovered = coveredLimits.filter((l) => resolveUsedFractionOfLimit(l) >= 0.999);
	const fallbackExhausted =
		exhaustedCovered.length > 0 ? exhaustedCovered : coveredLimits.filter((l) => isLimitExhausted(l));
	// Per un grant Claude 5h-only (Juniper), una finestra settimanale esaurita non
	// verrebbe sbloccata dal reset: non proporlo come sblocco di rate limit se c'e'
	// un blocco non coperto.
	const hasUncoveredExhausted =
		provider === 'anthropic' &&
		limits.some((l) => isLimitExhausted(l) && !coveredLimits.includes(l));
	const hasBlockingWindows = Boolean(selectedCredit?.blocking && selectedCredit.blocking.length > 0);
	const isRateLimited =
		!hasUncoveredExhausted &&
		!hasBlockingWindows &&
		(fallbackExhausted.length > 0 || Boolean(report?.metadata?.limitReached));

	const exhaustedWindowLabels = fallbackExhausted.map((l) => l.label || l.window?.label || l.id);

	const email = account?.email ?? (typeof report?.metadata?.email === 'string' ? report.metadata.email : undefined);
	const accountId =
		account?.accountId ?? (typeof report?.metadata?.accountId === 'string' ? report.metadata.accountId : undefined);
	const orgId = account?.orgId ?? (typeof report?.metadata?.orgId === 'string' ? report.metadata.orgId : undefined);
	const orgName =
		account?.orgName ?? (typeof report?.metadata?.orgName === 'string' ? report.metadata.orgName : undefined);

	const identity = email ?? accountId ?? `account-${fallbackIndex + 1}`;
	const label = orgName && orgName !== identity ? `${identity} · ${orgName}` : identity;
	const credentialId =
		typeof account?.credentialId === 'number' && Number.isFinite(account.credentialId)
			? account.credentialId
			: undefined;
	const target = credentialId !== undefined ? `${provider}/${credentialId}` : undefined;
	const accountKey = `${provider}:${credentialId ?? accountId ?? email ?? fallbackIndex}`;

	const unavailableReason =
		account?.unavailableReason ??
		reportReset?.reason ??
		(missingClaudePin ? 'no_selected_credit' : undefined) ??
		(bankedCount > 0 && redeemableCount === 0 ? 'not_usable_now' : undefined);

	return {
		provider,
		providerLabel: formatResetProviderLabel(provider),
		credentialId,
		target,
		accountKey,
		label,
		email,
		accountId,
		orgId,
		orgName,
		bankedCount,
		redeemableCount,
		soonestExpiry,
		soonestExpiryMs: resolvedExpiryMs,
		expiryTier,
		worthSalvaging,
		coveredWindowLabel: fullestLabel,
		coveredUsedPercent,
		isRateLimited,
		exhaustedWindowLabels: fallbackExhausted.map((l) => l.label || l.window?.label || l.id),
		creditTitle: selectedCredit?.title,
		unavailableReason,
		error: account?.error,
		window: detectResetWindow({
			provider,
			selectedCredit,
			creditTitle: selectedCredit?.title,
			fullestLimit,
			exhaustedLimits: fallbackExhausted
		}),
		autoRedeem: policy.autoRedeem,
		autoRedeemByWindow: policy.autoRedeemByWindow,
		keepCredits: policy.keepCredits,
		minBlockedMinutes: policy.minBlockedMinutes,
		salvageHorizonHours: policy.salvageHorizonHours,
		canRedeemNow: redeemableCount > 0 && Boolean(target) && !account?.error
	};
}

/**
 * Unisce i report di `omp usage --json` con gli account di `omp usage reset --json`
 * e le politiche `codexResets`/`claudeResets` di `config.yml`.
 */
export function buildAccountResetSummaries(options: {
	reports?: readonly QuotaReport[];
	resetAccounts?: readonly ResetAccountRaw[];
	resetSettings?: Partial<Record<string, Partial<RawResetProviderPolicy>>> | null;
	nowMs?: number;
}): AccountResetSummary[] {
	const reports = options.reports ?? [];
	const resetAccounts = options.resetAccounts ?? [];
	const settings = normalizeResetSettings(options.resetSettings);
	const nowMs = options.nowMs ?? Date.now();

	const matchedAccountIndices = new Set<number>();
	const summaries: AccountResetSummary[] = [];

	for (let i = 0; i < reports.length; i++) {
		const report = reports[i];
		const provider = normalizeResetProvider(report.provider);
		if (!provider) continue;

		let matchedIdx = resetAccounts.findIndex(
			(acc, idx) => !matchedAccountIndices.has(idx) && reportMatchesResetAccount(report, acc)
		);
		// Se il report o l'account non hanno orgId ma condividono email/accountId e c'e' un solo candidato:
		if (matchedIdx === -1) {
			const candidates = resetAccounts
				.map((acc, idx) => ({ acc, idx }))
				.filter(({ acc, idx }) => {
					if (matchedAccountIndices.has(idx)) return false;
					if (normalizeResetProvider(acc.provider) !== provider) return false;
					const repEmail = normStr(report.metadata?.email);
					const accEmail = normStr(acc.email);
					const repId = normStr(report.metadata?.accountId);
					const accId = normStr(acc.accountId);
					return (repId && accId && repId === accId) || (repEmail && accEmail && repEmail === accEmail);
				});
			if (candidates.length === 1) {
				matchedIdx = candidates[0].idx;
			}
		}

		const account = matchedIdx >= 0 ? resetAccounts[matchedIdx] : undefined;
		if (matchedIdx >= 0) matchedAccountIndices.add(matchedIdx);

		const summary = buildSingleSummary(provider, report, account, settings[provider], nowMs, i);
		summaries.push(summary);
	}

	// Aggiunge eventuali account restituiti da `omp usage reset --json` non presenti nei report
	for (let idx = 0; idx < resetAccounts.length; idx++) {
		if (matchedAccountIndices.has(idx)) continue;
		const acc = resetAccounts[idx];
		const provider = normalizeResetProvider(acc.provider);
		if (!provider) continue;
		summaries.push(
			buildSingleSummary(provider, undefined, acc, settings[provider], nowMs, reports.length + idx)
		);
	}

	return summaries;
}

/** Trova il riepilogo reset associato a uno specifico report nel popover. */
export function findResetSummaryForReport(
	report: QuotaReport,
	summaries: readonly AccountResetSummary[]
): AccountResetSummary | undefined {
	const provider = normalizeResetProvider(report.provider);
	if (!provider) return undefined;
	return summaries.find((s) =>
		reportMatchesResetAccount(report, {
			provider: s.provider,
			orgId: s.orgId,
			accountId: s.accountId,
			email: s.email
		})
	);
}

/**
 * Riconosce il prompt `extension_ui_request` che omp invia quando `autoRedeem` e' `unset`,
 * cosi' Studio non mostra una seconda card sovrapposta durante lo stesso episodio.
 */
export function isAutoRedeemSessionPrompt(title: string | undefined | null): boolean {
	if (!title) return false;
	return (
		/auto-redeem saved (?:codex|claude) rate-limit resets/i.test(title) ||
		/(?:spend \d+|spend \w+)?.*saved (?:codex|claude) (?:rate-limit )?resets?/i.test(title) ||
		/saved (?:codex|claude) (?:rate-limit )?resets?/i.test(title)
	);
}

/**
 * Seleziona il candidato prioritario per la card di conferma riscatto:
 * 1. Account bloccato da rate limit (o sessione attiva in blocco quota per quel provider)
 *    con un reset utilizzabile subito;
 * 2. Reset in scadenza imminente (entro 24h o entro `salvageHorizonHours`) su un account
 *    con utilizzo significativo (>= 25% o ultimi 5 minuti).
 *
 * Rispetta `autoRedeem`: se impostato a `yes`, la card entra in modalita' `auto_informed`
 * (informa senza doppio prompt).
 */
export function selectResetPromptCandidate(options: {
	summaries: readonly AccountResetSummary[];
	activeProvider?: string;
	activeAccountEmail?: string;
	activeBlockedProvider?: string;
	dismissedKeys?: ReadonlySet<string>;
	suppressForSessionPrompt?: boolean;
	nowMs?: number;
}): ResetPromptCandidate | null {
	if (options.suppressForSessionPrompt) return null;
	const dismissed = options.dismissedKeys ?? new Set<string>();
	const nowMs = options.nowMs ?? Date.now();
	const activeNorm = normalizeResetProvider(options.activeProvider);
	const blockedNorm = normalizeResetProvider(options.activeBlockedProvider);
	const activeEmail = normStr(options.activeAccountEmail);

	const rankAccount = (s: AccountResetSummary): number => {
		if (activeNorm && s.provider === activeNorm) {
			if (activeEmail && normStr(s.email) === activeEmail) return 0;
			return 1;
		}
		return 2;
	};

	const sorted = [...options.summaries].sort((a, b) => {
		const r = rankAccount(a) - rankAccount(b);
		if (r !== 0) return r;
		return (a.soonestExpiryMs ?? Infinity) - (b.soonestExpiryMs ?? Infinity);
	});

	// 1. Blocco rate limit attivo con reset utilizzabile
	for (const summary of sorted) {
		if (summary.bankedCount <= 0 || summary.redeemableCount <= 0) continue;
		const isLastChance =
			summary.soonestExpiryMs !== undefined &&
			summary.soonestExpiryMs - nowMs > 0 &&
			summary.soonestExpiryMs - nowMs <= RESET_LAST_CHANCE_MS;
		if (!isLastChance && summary.bankedCount <= summary.keepCredits) continue;

		const blockedMatch = summary.isRateLimited || (blockedNorm !== null && summary.provider === blockedNorm);
		if (!blockedMatch) continue;

		const episodeKey = `rate_limited:${summary.accountKey}:${summary.soonestExpiry ?? 'none'}:${summary.bankedCount}`;
		if (dismissed.has(episodeKey)) continue;

		let targetWindow = summary.window;
		if (summary.exhaustedWindowLabels.length > 0) {
			const hasWeekly = summary.exhaustedWindowLabels.some((l) => /7[\s-]*d|week/i.test(l));
			const has5h = summary.exhaustedWindowLabels.some((l) => /5[\s-]*h/i.test(l));
			if (hasWeekly) targetWindow = 'weekly';
			else if (has5h) targetWindow = '5h';
		}
		const effectiveMode = resolveAutoRedeemModeForWindow(
			summary.autoRedeemByWindow,
			targetWindow,
			summary.autoRedeem
		);
		const settingKey = formatResetSettingKey(summary.provider, targetWindow);

		return {
			episodeKey,
			reason: 'rate_limited',
			summary,
			window: targetWindow,
			settingKey,
			mode: effectiveMode === 'yes' ? 'auto_informed' : 'prompt',
			willBeLostWithoutManualRedeem: false
		};
	}

	// 2. Reset in scadenza imminente (salvage)
	for (const summary of sorted) {
		if (summary.bankedCount <= 0 || summary.soonestExpiryMs === undefined) continue;
		const remainingMs = summary.soonestExpiryMs - nowMs;
		if (remainingMs <= 0) continue;

		const horizonMs = Math.max(RESET_EXPIRY_IMMINENT_MS, summary.salvageHorizonHours * 3_600_000);
		if (remainingMs > horizonMs) continue;

		const isLastChance = remainingMs <= RESET_LAST_CHANCE_MS;
		// In omp 18.9.0 il salvage controlla solo gli account con consumo idoneo (>= 25%),
		// salvo gli ultimi 5 minuti prima della scadenza. Per Claude il server deve anche
		// consentire il riscatto o non averlo marcato ineleggibile.
		if (!summary.worthSalvaging && !isLastChance) continue;
		if (summary.provider === 'anthropic' && summary.redeemableCount <= 0 && summary.unavailableReason) {
			continue;
		}

		const episodeKey = `expiring:${summary.accountKey}:${summary.soonestExpiry ?? 'none'}`;
		if (dismissed.has(episodeKey)) continue;

		const window = summary.window;
		const effectiveMode = resolveAutoRedeemModeForWindow(
			summary.autoRedeemByWindow,
			window,
			summary.autoRedeem
		);
		const settingKey = formatResetSettingKey(summary.provider, window);

		return {
			episodeKey,
			reason: 'expiring',
			summary,
			window,
			settingKey,
			mode: effectiveMode === 'yes' ? 'auto_informed' : 'prompt',
			willBeLostWithoutManualRedeem: effectiveMode === 'no'
		};
	}

	return null;
}
