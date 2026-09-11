/**
 * Gestione e recupero da blocco quota o fallimento irreversibile del provider.
 *
 * Fornisce logiche pure per:
 * 1. Classificazione a due livelli dell'errore (quota esaurita vs errore provider).
 * 2. Selezione del modello di riserva consigliato («prossimo ruolo sano»).
 * 3. Verifica preventiva dell'esistenza di riserve effettive per un modello attivo.
 */

import type {
	ModelConfigDto,
	ModelDto,
	QuotaSemanticStatus
} from '../stores/modelSettingsHelpers.ts';
import {
	STANDARD_ROLE_METAS,
	splitModelSelector,
	resolveCatalogModel
} from '../stores/modelSettingsHelpers.ts';
import { m as msg } from '$lib/paraglide/messages.js';

export type BlockedQuotaReason = 'quota_exhausted' | 'provider_error';

export interface RecoveryModelOption {
	selector: string;
	provider: string;
	modelId: string;
	modelName: string;
	roleId?: string;
	roleLabel?: string;
	thinking?: string;
	isDifferentProvider: boolean;
	quotaStatus?: QuotaSemanticStatus;
}

export interface BlockedQuotaState {
	id: string;
	reasonKind: BlockedQuotaReason;
	title: string;
	message: string;
	rawError?: string;
	failedProvider?: string;
	failedModelId?: string;
	failedSelector?: string;
	timestamp: number;
	dismissed?: boolean;
	suggestedModel: RecoveryModelOption | null;
	availableRecoveryModels: RecoveryModelOption[];
}

/**
 * Pattern ufficiali dei provider per individuare esaurimento quota e crediti (OpenAI, Anthropic, Gemini, standard HTTP).
 * Riferimento: ricerca/quota-agent-recovery-providers.md
 */
const QUOTA_EXHAUSTION_PATTERNS = [
	// OpenAI
	/\bcredit_balance_exhausted\b/i,
	/\borganization_spend_limit_exceeded\b/i,
	/\bproject_spend_limit_exceeded\b/i,
	/\borganization_usage_limit_exceeded\b/i,
	/\binsufficient_quota\b/i,
	/\bexceeded your current quota\b/i,
	// Anthropic
	/\benforced_spend_limit_reached\b/i,
	/\bmonthly api usage threshold\b/i,
	/\bbilling_error\b/i,
	// Google Gemini / Vertex
	/\bquota_exceeded\b/i,
	/\bRESOURCE_EXHAUSTED\b/i,
	/\bBILLING_DISABLED\b/i,
	/\bdaily quota\b/i,
	// Pattern generici consolidati
	/\bquota exceeded\b/i,
	/\brate limit.*(?:quota|spend|credit|balance)\b/i,
	/\bcrediti esauriti\b/i,
	/\bquota esaurita\b/i
];

/**
 * Classifica il fallimento terminale su due livelli:
 * - 'quota_exhausted': se vi sono evidenze formali di crediti o limiti di spesa terminati.
 * - 'provider_error': per qualunque altro errore bloccante in cui i retry sono terminati senza successo.
 */
export function classifyFailureReason(
	errorText?: string,
	telemetryQuotaStatus?: QuotaSemanticStatus
): { kind: BlockedQuotaReason; title: string; summary: string } {
	const text = errorText || '';

	// Match su telemetria usage (se lo store segna già exhausted) o su pattern formali
	const isTelemetryExhausted = telemetryQuotaStatus === 'exhausted';
	const isTextQuotaMatch = QUOTA_EXHAUSTION_PATTERNS.some((pattern) => pattern.test(text));

	if (isTelemetryExhausted || isTextQuotaMatch) {
		return {
			kind: 'quota_exhausted',
			title: 'Quota o crediti esauriti',
			summary:
				msg.ui_ts_quotarecovery_l_agente_si_e_arrestato_perche_il_7a43()
		};
	}

	return {
		kind: 'provider_error',
		title: 'Richiesta non recuperabile dal provider',
		summary:
			msg.ui_ts_quotarecovery_l_agente_si_e_arrestato_perche_i_3da2()
	};
}

export interface RecommendRecoveryParams {
	failedProvider?: string;
	failedModelId?: string;
	failedSelector?: string;
	config?: ModelConfigDto | null;
	catalog?: ModelDto[];
	knownSelectors?: ReadonlySet<string>;
	checkQuota?: (provider: string, modelId: string) => QuotaSemanticStatus;
}

/**
 * Identifica i modelli sani alternativi e suggerisce il «prossimo ruolo sano».
 * Esamina i ruoli configurati nell'ordine stabilito da cycleOrder (o STANDARD_ROLES).
 * Esclude il modello fallito e i modelli con quota a zero; privilegia un provider differente.
 */
export function recommendRecoveryModel(params: RecommendRecoveryParams): {
	primary: RecoveryModelOption | null;
	all: RecoveryModelOption[];
} {
	const {
		failedProvider = '',
		failedModelId = '',
		failedSelector = '',
		config,
		catalog = [],
		knownSelectors = new Set(),
		checkQuota
	} = params;

	const rolesMap = config?.modelRoles || {};
	const cycleOrder =
		config?.cycleOrder && config.cycleOrder.length > 0
			? config.cycleOrder
			: STANDARD_ROLE_METAS.map((r) => r.id);

	const normalizedFailedSelector = (
		failedSelector || (failedProvider && failedModelId ? `${failedProvider}/${failedModelId}` : failedModelId)
	).toLowerCase();

	const seen = new Set<string>();
	const candidates: RecoveryModelOption[] = [];

	for (const roleId of cycleOrder) {
		const fullSelector = rolesMap[roleId]?.trim();
		if (!fullSelector) continue;

		const { base: rawSelector, thinking } = splitModelSelector(fullSelector, knownSelectors);
		if (!rawSelector) continue;

		const slashIdx = rawSelector.indexOf('/');
		const provider = slashIdx >= 0 ? rawSelector.slice(0, slashIdx) : '';
		const modelId = slashIdx >= 0 ? rawSelector.slice(slashIdx + 1) : rawSelector;
		const fullNorm = rawSelector.toLowerCase();

		// Salta duplicati nella lista dei candidati
		if (seen.has(fullNorm)) continue;
		seen.add(fullNorm);

		// Esclude il modello che è appena fallito
		if (
			fullNorm === normalizedFailedSelector ||
			(failedModelId && modelId.toLowerCase() === failedModelId.toLowerCase())
		) {
			continue;
		}

		// Verifica telemetria quota se disponibile
		const qStatus = checkQuota ? checkQuota(provider, modelId) : undefined;
		if (qStatus === 'exhausted') {
			continue;
		}

		const roleMeta = STANDARD_ROLE_METAS.find((r) => r.id === roleId);
		const modelDto = resolveCatalogModel(catalog, rawSelector);
		const fallbackName = slashIdx >= 0 ? rawSelector.slice(slashIdx + 1) : rawSelector;
		const modelName = modelDto?.name || fallbackName;

		const isDifferentProvider = Boolean(
			provider && failedProvider && provider.toLowerCase() !== failedProvider.toLowerCase()
		);

		candidates.push({
			selector: rawSelector,
			provider,
			modelId,
			modelName,
			roleId,
			roleLabel: roleMeta?.label || roleId,
			thinking: thinking || undefined,
			isDifferentProvider,
			quotaStatus: qStatus
		});
	}

	if (candidates.length === 0) {
		return { primary: null, all: [] };
	}

	// Ordina i candidati: prima quelli con provider differente, poi lo stato di quota più sano
	const sorted = [...candidates].sort((a, b) => {
		if (a.isDifferentProvider !== b.isDifferentProvider) {
			return a.isDifferentProvider ? -1 : 1;
		}
		const rank = (status?: QuotaSemanticStatus) => {
			if (status === 'ok') return 0;
			if (status === 'warn') return 1;
			if (status === 'critical') return 2;
			return 3;
		};
		return rank(a.quotaStatus) - rank(b.quotaStatus);
	});

	return {
		primary: sorted[0] || null,
		all: candidates
	};
}

/**
 * Decisione Q8: Verifica preventiva dell'esistenza di riserve effettive.
 * Determina se il modello attivo corrente è coperto da una catena di fallback configurata.
 */
export function hasEffectiveReserves(
	modelSelector: string | undefined,
	activeRoleId: string | null,
	config: ModelConfigDto | null
): boolean {
	if (!config || !config.fallbackChains) return false;
	const chains = config.fallbackChains;

	// 1. Catena associata al ruolo attivo
	if (activeRoleId && Array.isArray(chains[activeRoleId]) && chains[activeRoleId].length > 0) {
		return true;
	}

	if (!modelSelector) {
		return Array.isArray(chains['default']) && chains['default'].length > 0;
	}

	const slashIdx = modelSelector.indexOf('/');
	const provider = slashIdx >= 0 ? modelSelector.slice(0, slashIdx) : '';

	// 2. Corrispondenza esatta sul selettore del modello
	if (Array.isArray(chains[modelSelector]) && chains[modelSelector].length > 0) {
		return true;
	}

	// 3. Wildcard del provider: "provider/*"
	if (provider) {
		const wildcard = `${provider}/*`;
		if (Array.isArray(chains[wildcard]) && chains[wildcard].length > 0) {
			return true;
		}
	}

	// 4. Catena predefinita
	if (Array.isArray(chains['default']) && chains['default'].length > 0) {
		return true;
	}

	return false;
}
