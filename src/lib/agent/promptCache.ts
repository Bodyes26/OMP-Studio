import type { CacheWarmingLast } from './sessionModes';
import type { AgentMessage, MessageUsage, ModelInfo } from './wire';

/** Osservazione reale dell'ultima risposta assistant utile ai fini della prompt cache. */
export interface PromptCacheObservation {
	at: number;
	provider?: string;
	model?: string;
	usage: MessageUsage;
}

/** Stato stimato di riusabilità della prompt cache per il prossimo invio. */
export type CacheValidity = 'likely-valid' | 'possibly-expired' | 'unknown' | 'context-changed';

/** Codice stabile che motiva la valutazione della prompt cache. */
export type PromptCacheReason =
	| 'no-request'
	| 'no-cache-observed'
	| 'identity-unknown'
	| 'lifetime-unknown'
	| 'within-ttl'
	| 'warmed-within-ttl'
	| 'ttl-elapsed'
	| 'warming-missed'
	| 'context-compacted'
	| 'model-changed';

/** Valutazione pre-invio della prompt cache, basata su dati osservati e TTL nominale conservativo. */
export interface PromptCacheAssessment {
	state: CacheValidity;
	reason: PromptCacheReason;
	lastRequestAt: number | null;
	lastTouchAt: number | null;
	expiresAt: number | null;
	inputTokens: number;
	cachedTokens: number;
	cachedPercent: number | null;
}

export interface AssessPromptCacheParams {
	model?: ModelInfo | null;
	observation?: PromptCacheObservation | null;
	warming?: CacheWarmingLast | null;
	contextChanged?: boolean;
	now?: number;
}

const DEFAULT_EPHEMERAL_5M_SECONDS = 300;
const DEFAULT_EPHEMERAL_1H_SECONDS = 3600;

function nonNegativeTokens(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
	return Math.floor(value);
}


function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}


/**
 * Estrae un'osservazione di prompt cache da un messaggio della sessione.
 * Ritorna `null` per messaggi non-assistant, turni falliti senza token di prompt
 * o messaggi privi di timestamp/usage validi.
 */
export function cacheObservationFromMessage(message: AgentMessage): PromptCacheObservation | null {
	if (!message || message.role !== 'assistant') return null;
	if (message.isError === true || message.stopReason === 'error') return null;
	if (!message.usage || typeof message.usage !== 'object') return null;

	if (
		typeof message.timestamp !== 'number' ||
		!Number.isFinite(message.timestamp) ||
		message.timestamp <= 0
	) {
		return null;
	}
	const rawAt = message.timestamp;

	const input = nonNegativeTokens(message.usage.input);
	const cacheRead = nonNegativeTokens(message.usage.cacheRead);
	const cacheWrite = nonNegativeTokens(message.usage.cacheWrite);
	if (input + cacheRead + cacheWrite <= 0) return null;

	const provider = nonEmptyString(message.provider);
	const model = nonEmptyString(message.model);

	return {
		at: rawAt,
		...(provider ? { provider } : {}),
		...(model ? { model } : {}),
		usage: message.usage
	};
}

/**
 * Ricostruisce dallo storico dei messaggi l'ultima osservazione assistant utile
 * e segnala se il contesto e' stato compattato dopo di essa.
 *
 * In `get_messages_page` (`buildSessionContext` non-transcript), omp emette
 * `compactionSummary` in testa seguito dai messaggi mantenuti (`kept`) anteriori
 * alla compattazione e poi dai messaggi post-compattazione: l'ordine della lista
 * non coincide quindi con la cronologia rispetto al summary. Un assistant
 * mantenuto ha `timestamp <= summary.timestamp` e non deve mai risultare valido;
 * se un summary che precede l'assistant e' privo di timestamp valido, l'ambiguita'
 * viene risolta in modo conservativo marcando `contextChanged: true`.
 */
export function latestPromptCacheObservation(messages: readonly AgentMessage[]): {
	observation: PromptCacheObservation | null;
	contextChanged: boolean;
} {
	let latestObservation: PromptCacheObservation | null = null;
	let latestObsIndex = -1;
	const compactionEntries: { index: number; timestamp: number | null }[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;
		if (
			msg.role === 'compactionSummary' ||
			msg.role === 'branchSummary' ||
			msg.customType === 'compactionSummary' ||
			(typeof msg.summary === 'string' && (!msg.role || msg.role === 'custom'))
		) {
			const ts =
				typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp) && msg.timestamp > 0
					? msg.timestamp
					: null;
			compactionEntries.push({ index: i, timestamp: ts });
			continue;
		}
		const candidate = cacheObservationFromMessage(msg);
		if (candidate && (!latestObservation || candidate.at >= latestObservation.at)) {
			latestObservation = candidate;
			latestObsIndex = i;
		}
	}

	if (!latestObservation) {
		return {
			observation: null,
			contextChanged: compactionEntries.length > 0
		};
	}

	const contextChanged = compactionEntries.some(
		(comp) =>
			comp.index > latestObsIndex ||
			comp.timestamp === null ||
			comp.timestamp >= latestObservation.at
	);

	return {
		observation: latestObservation,
		contextChanged
	};
}

/**
 * Risolve la durata nominale conservativa in millisecondi a partire dai metadati
 * espliciti della risposta (`usage.cttl`) o dal catalogo del modello (`model.promptCache`).
 * Non applica mai TTL predefiniti ai modelli che non dichiarano una durata.
 */
function resolveNominalTtlMs(model: ModelInfo | null | undefined, usage: MessageUsage): number | null {
	const rawShort = model?.promptCache?.short;
	const catalogShort =
		typeof rawShort === 'number' && Number.isFinite(rawShort) && rawShort > 0 ? rawShort : null;
	const rawLong = model?.promptCache?.long;
	const catalogLong =
		typeof rawLong === 'number' && Number.isFinite(rawLong) && rawLong > 0 ? rawLong : null;

	const wrote5m = nonNegativeTokens(usage.cttl?.ephemeral5m) > 0;
	const wrote1h = nonNegativeTokens(usage.cttl?.ephemeral1h) > 0;

	// Se la risposta ha scritto esplicitamente nel tier 5m (anche insieme a blocchi 1h),
	// la stima conservativa usa la scadenza piu' breve (short / 5m).
	if (wrote5m) {
		const seconds = catalogShort ?? DEFAULT_EPHEMERAL_5M_SECONDS;
		return Math.round(seconds * 1000);
	}
	if (wrote1h) {
		const seconds = catalogLong ?? DEFAULT_EPHEMERAL_1H_SECONDS;
		return Math.round(seconds * 1000);
	}

	// Senza cttl esplicito sulla risposta (es. puro cacheRead), usa la durata
	// conservativa dichiarata dal catalogo del modello, se presente.
	if (catalogShort !== null && catalogLong !== null) {
		return Math.round(Math.min(catalogShort, catalogLong) * 1000);
	}
	if (catalogShort !== null) {
		return Math.round(catalogShort * 1000);
	}
	if (catalogLong !== null) {
		return Math.round(catalogLong * 1000);
	}
	return null;
}

function hasModelIdentityChanged(
	model: ModelInfo | null | undefined,
	observation: PromptCacheObservation
): boolean {
	if (!model) return false;
	const activeProvider = nonEmptyString(model.provider);
	const observedProvider = nonEmptyString(observation.provider);
	if (activeProvider && observedProvider && activeProvider !== observedProvider) {
		return true;
	}
	const activeModelId = nonEmptyString(model.id);
	const observedModelId = nonEmptyString(observation.model);
	if (activeModelId && observedModelId && activeModelId !== observedModelId) {
		return true;
	}
	return false;
}

function isMatchingWarmingEvent(
	warming: CacheWarmingLast | null | undefined,
	observation: PromptCacheObservation,
	model: ModelInfo | null | undefined
): warming is CacheWarmingLast {
	if (!warming) return false;
	if (typeof warming.at !== 'number' || !Number.isFinite(warming.at) || warming.at < observation.at) {
		return false;
	}

	const warmProvider = nonEmptyString(warming.provider);
	const warmModel = nonEmptyString(warming.model);
	const observedProvider = nonEmptyString(observation.provider);
	const observedModel = nonEmptyString(observation.model);
	const activeProvider = nonEmptyString(model?.provider);
	const activeModel = nonEmptyString(model?.id);

	// Se l'osservazione o il modello attivo hanno un'identita', il warming deve
	// dichiarare almeno il modello o provider corrispondente e non contraddirli.
	if ((observedProvider || activeProvider) && !warmProvider) return false;
	if ((observedModel || activeModel) && !warmModel) return false;

	if (warmProvider && observedProvider && warmProvider !== observedProvider) return false;
	if (warmProvider && activeProvider && warmProvider !== activeProvider) return false;
	if (warmModel && observedModel && warmModel !== observedModel) return false;
	if (warmModel && activeModel && warmModel !== activeModel) return false;

	return true;
}


/**
 * Valuta lo stato pratico della prompt cache prima del prossimo invio.
 * Mantiene sempre i contatori e l'eta' dell'ultima richiesta osservata anche
 * quando la durata nominale e' sconosciuta o il contesto e' cambiato.
 */
export function assessPromptCache({
	model,
	observation,
	warming,
	contextChanged = false,
	now = Date.now()
}: AssessPromptCacheParams): PromptCacheAssessment {
	if (!observation) {
		return {
			state: 'unknown',
			reason: 'no-request',
			lastRequestAt: null,
			lastTouchAt: null,
			expiresAt: null,
			inputTokens: 0,
			cachedTokens: 0,
			cachedPercent: null
		};
	}

	const uncachedInput = nonNegativeTokens(observation.usage?.input);
	const cachedTokens = nonNegativeTokens(observation.usage?.cacheRead);
	const cacheWrite = nonNegativeTokens(observation.usage?.cacheWrite);
	const inputTokens = uncachedInput + cachedTokens + cacheWrite;
	const cachedPercent = inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : null;
	const lastRequestAt = observation.at;

	if (contextChanged) {
		return {
			state: 'context-changed',
			reason: 'context-compacted',
			lastRequestAt,
			lastTouchAt: lastRequestAt,
			expiresAt: null,
			inputTokens,
			cachedTokens,
			cachedPercent
		};
	}

	if (hasModelIdentityChanged(model, observation)) {
		return {
			state: 'context-changed',
			reason: 'model-changed',
			lastRequestAt,
			lastTouchAt: lastRequestAt,
			expiresAt: null,
			inputTokens,
			cachedTokens,
			cachedPercent
		};
	}

	let lastTouchAt = lastRequestAt;
	let warmed = false;
	const matchedWarming = isMatchingWarmingEvent(warming, observation, model) ? warming : null;

	if (matchedWarming) {
		if (matchedWarming.outcome === 'miss') {
			return {
				state: 'possibly-expired',
				reason: 'warming-missed',
				lastRequestAt,
				lastTouchAt,
				expiresAt: null,
				inputTokens,
				cachedTokens,
				cachedPercent
			};
		}
		if (matchedWarming.outcome === 'hit') {
			const validHit =
				!matchedWarming.usage ||
				(nonNegativeTokens(matchedWarming.usage.cacheRead) > 0 &&
					nonNegativeTokens(matchedWarming.usage.cacheWrite) === 0);
			if (validHit) {
				lastTouchAt = matchedWarming.at;
				warmed = true;
			} else {
				// Un evento marcato `hit` ma con usage che mostra `cacheRead === 0` o `cacheWrite > 0`
				// equivale a un miss effettivo sul prefisso.
				return {
					state: 'possibly-expired',
					reason: 'warming-missed',
					lastRequestAt,
					lastTouchAt,
					expiresAt: null,
					inputTokens,
					cachedTokens,
					cachedPercent
				};
			}
		}
	}

	const wrote5m = nonNegativeTokens(observation.usage?.cttl?.ephemeral5m) > 0;
	const wrote1h = nonNegativeTokens(observation.usage?.cttl?.ephemeral1h) > 0;
	const hasObservedCache = cachedTokens > 0 || cacheWrite > 0 || wrote5m || wrote1h || warmed;
	if (!hasObservedCache) {
		return {
			state: 'unknown',
			reason: 'no-cache-observed',
			lastRequestAt,
			lastTouchAt,
			expiresAt: null,
			inputTokens,
			cachedTokens,
			cachedPercent
		};
	}

	const resolvedProvider =
		nonEmptyString(observation.provider) ?? nonEmptyString(matchedWarming?.provider);
	const resolvedModel =
		nonEmptyString(observation.model) ?? nonEmptyString(matchedWarming?.model);
	const activeProvider = nonEmptyString(model?.provider);
	const activeModel = nonEmptyString(model?.id);
	const hasVerifiedIdentity = Boolean(
		resolvedProvider &&
			resolvedModel &&
			activeProvider &&
			activeModel &&
			resolvedProvider === activeProvider &&
			resolvedModel === activeModel
	);
	if (!hasVerifiedIdentity) {
		return {
			state: 'unknown',
			reason: 'identity-unknown',
			lastRequestAt,
			lastTouchAt,
			expiresAt: null,
			inputTokens,
			cachedTokens,
			cachedPercent
		};
	}
	const ttlMs = resolveNominalTtlMs(model, observation.usage);
	if (ttlMs === null) {
		return {
			state: 'unknown',
			reason: 'lifetime-unknown',
			lastRequestAt,
			lastTouchAt,
			expiresAt: null,
			inputTokens,
			cachedTokens,
			cachedPercent
		};
	}

	const expiresAt = lastTouchAt + ttlMs;
	if (now < expiresAt) {
		return {
			state: 'likely-valid',
			reason: warmed ? 'warmed-within-ttl' : 'within-ttl',
			lastRequestAt,
			lastTouchAt,
			expiresAt,
			inputTokens,
			cachedTokens,
			cachedPercent
		};
	}

	return {
		state: 'possibly-expired',
		reason: 'ttl-elapsed',
		lastRequestAt,
		lastTouchAt,
		expiresAt,
		inputTokens,
		cachedTokens,
		cachedPercent
	};
}
