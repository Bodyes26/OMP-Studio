/**
 * Helper e definizioni pure per la gestione dei modelli, provider e autenticazione.
 *
 * Mantiene la logica di merge, filtri di visualizzazione e sanitizzazione isolata
 * da dipendenze runtime SvelteKit / Tauri per consentire test di unità deterministici.
 */

export interface ModelCost {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export interface ModelThinkingInfo {
	mode?: string;
	efforts?: string[];
}

export interface ModelDto {
	id: string;
	name: string;
	provider: string;
	selector: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	thinking?: ModelThinkingInfo;
	input?: string[];
	cost?: ModelCost;
	isCustom: boolean;
}

export interface AuthAccount {
	id: number;
	provider: string;
	credentialType: string;
	identityKey?: string;
	email?: string;
	accountId?: string;
	orgId?: string;
	orgName?: string;
	plan?: string;
	disabledCause?: string;
	hasCredential: boolean;
	createdAt?: number;
	updatedAt?: number;
}

export interface ProviderSummary {
	id: string;
	name: string;
	source: string; // "builtin" | "plugin" | "custom"
	enabled: boolean;
	configured: boolean;
	authOrigin?: string; // "oauth" | "api_key" | "env" | "custom"
	availableModelCount: number;
	accountCount: number;
	hasOauth: boolean;
	isCustom: boolean;
}

/**
 * Unisce i modelli rinfrescati di un singolo provider nel catalogo esistente senza
 * troncare i modelli degli altri provider o corrompere i ruoli/cicli configurati.
 */
export function mergeProviderIntoCatalog(
	currentCatalog: ModelDto[],
	providerId: string,
	refreshedModels: ModelDto[]
): ModelDto[] {
	const otherModels = currentCatalog.filter((m) => m.provider !== providerId);
	return [...otherModels, ...refreshedModels];
}

/**
 * Determina se un account di autenticazione e' attivo (non eliminato dall'utente).
 */
export function isAuthAccountActive(account: AuthAccount): boolean {
	return account.disabledCause !== 'deleted by user';
}

/**
 * Suggerimento della variabile d'ambiente standard per i provider API-Key noti.
 */
export function getProviderEnvVarHint(providerId: string): string | null {
	switch (providerId.toLowerCase()) {
		case 'anthropic': return 'ANTHROPIC_API_KEY';
		case 'openai':
		case 'openai-codex': return 'OPENAI_API_KEY';
		case 'google':
		case 'google-antigravity': return 'GEMINI_API_KEY';
		case 'perplexity': return 'PERPLEXITY_API_KEY';
		case 'groq': return 'GROQ_API_KEY';
		case 'cerebras': return 'CEREBRAS_API_KEY';
		case 'mistral': return 'MISTRAL_API_KEY';
		case 'cohere': return 'COHERE_API_KEY';
		case 'deepseek': return 'DEEPSEEK_API_KEY';
		case 'openrouter': return 'OPENROUTER_API_KEY';
		default: return null;
	}
}

/**
 * Sanitizza il valore di maxDynamic accettando numeri e stringhe numeriche legacy,
 * limitando il valore nell'intervallo [1, 3].
 */
export function sanitizeMaxDynamic(value: unknown, fallback: number = 3): number {
	const num = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
	if (!Number.isFinite(num)) return fallback;
	return Math.min(3, Math.max(1, Math.round(num)));
}

export const THINKING_LEVELS = [
	'auto',
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max'
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Quanto basta di un modello per leggerne gli sforzi: `ModelInfo` di sessione o `ModelDto` di catalogo. */
export interface ThinkingCapableModel {
	reasoning?: boolean;
	thinking?: boolean | string[] | ModelThinkingInfo;
}

/**
 * Livelli di thinking che omp accetta per il modello, in ordine crescente con
 * `off` in testa. Rispecchia `getAvailableThinkingLevels` di omp: senza
 * `reasoning` resta solo `off`, altrimenti valgono gli sforzi dichiarati
 * (`omp models --json` li pubblica come elenco piatto, `get_state` e la cache
 * come `{ mode, efforts }`). `null` se il modello non e' noto o non dichiara
 * sforzi: allora si offre la scala intera e omp riporta il livello al piu' vicino.
 */
export function supportedThinkingLevels(
	model: ThinkingCapableModel | null | undefined
): Exclude<ThinkingLevel, 'auto'>[] | null {
	if (!model) return null;
	if (model.reasoning === false) return ['off'];
	const thinking = model.thinking;
	const efforts = Array.isArray(thinking)
		? thinking
		: thinking && typeof thinking === 'object'
			? thinking.efforts
			: undefined;
	if (!efforts || efforts.length === 0) return null;
	return THINKING_LEVELS.filter(
		(level): level is Exclude<ThinkingLevel, 'auto'> =>
			level === 'off' || (level !== 'auto' && efforts.includes(level))
	);
}

/**
 * Livello che omp usa davvero quando `level` non e' tra quelli offerti: il piu'
 * alto non superiore a quello chiesto, altrimenti il primo sforzo disponibile
 * (stessa regola di omp al cambio di modello). `off` se il modello non ragiona,
 * `null` se non c'e' un corrispondente. `offered` va in ordine crescente.
 */
export function clampThinkingLevel(level: string, offered: readonly string[]): string | null {
	if (offered.includes(level)) return level;
	const rank = (THINKING_LEVELS as readonly string[]).indexOf(level);
	const offRank = THINKING_LEVELS.indexOf('off');
	if (rank <= offRank) return null;
	const efforts = offered.filter((candidate) => (THINKING_LEVELS as readonly string[]).indexOf(candidate) > offRank);
	const below = efforts.filter((candidate) => (THINKING_LEVELS as readonly string[]).indexOf(candidate) <= rank);
	return below.at(-1) ?? efforts[0] ?? (offered.includes('off') ? 'off' : null);
}

/**
 * Separa `provider/model[:livelloThinking]`.
 * `knownSelectors`: insieme opzionale dei selettori esistenti in catalogo (`provider/id`).
 *
 * Regole, nell'ordine:
 * 1. se `selector` intero e' presente in `knownSelectors` -> { base: selector, thinking: null }
 *    (copre `nanogpt/anthropic/claude-opus-4.6:thinking:max`, che e' un id vero)
 * 2. altrimenti, se il segmento dopo l'ULTIMO ':' e' in THINKING_LEVELS -> { base: segmento-precedente, thinking: livello }
 * 3. altrimenti -> { base: selector, thinking: null } (copre `kilo/arcee-ai/trinity-large-preview:free`)
 */
export function splitModelSelector(
	selector: string,
	knownSelectors?: ReadonlySet<string>
): { base: string; thinking: string | null } {
	if (knownSelectors && knownSelectors.has(selector)) {
		return { base: selector, thinking: null };
	}

	const lastColon = selector.lastIndexOf(':');
	if (lastColon !== -1) {
		const candidateThinking = selector.slice(lastColon + 1);
		if ((THINKING_LEVELS as readonly string[]).includes(candidateThinking)) {
			return {
				base: selector.slice(0, lastColon),
				thinking: candidateThinking
			};
		}
	}

	return { base: selector, thinking: null };
}

/**
 * Risolve il `ModelDto` di catalogo a partire da un selettore di ruolo/fallback.
 *
 * Utilizza `splitModelSelector` con l'insieme dei selettori noti per separare l'eventuale
 * suffisso thinking senza troncare i selettori il cui ID contiene due punti.
 * Prova in ordine: match esatto sul selettore intero, poi sul selettore base, poi sull'ID.
 */
export function resolveCatalogModel(
	catalog: ModelDto[],
	rawSelector: string
): ModelDto | undefined {
	if (!rawSelector) return undefined;
	const knownSelectors = new Set(catalog.map((m) => m.selector));
	const { base } = splitModelSelector(rawSelector, knownSelectors);
	return (
		catalog.find((m) => m.selector === rawSelector) ??
		catalog.find((m) => m.selector === base) ??
		catalog.find((m) => m.id === base)
	);
}

/**
 * Selettore di ruolo (`provider/id[:thinking]`) scomposto per `set_model`: il provider
 * e' il primo segmento, l'id tutto il resto (`nanogpt/anthropic/claude` resta intero).
 */
export function parseRoleSelector(
	selector: string,
	knownSelectors?: ReadonlySet<string>
): { provider: string; modelId: string; thinking: string | null } {
	const { base, thinking } = splitModelSelector(selector, knownSelectors);
	const slash = base.indexOf('/');
	return {
		provider: slash >= 0 ? base.slice(0, slash) : '',
		modelId: slash >= 0 ? base.slice(slash + 1) : base,
		thinking
	};
}

function roleUsesModel(
	selector: string,
	model: { provider?: string; id?: string },
	knownSelectors?: ReadonlySet<string>
): boolean {
	const { base } = splitModelSelector(selector, knownSelectors);
	return !!model.id && (base === model.id || base === `${model.provider}/${model.id}`);
}

/**
 * Ruolo attivo di una sessione. omp non espone il ruolo via RPC, quindi Studio lo
 * deduce dal modello. Piu' ruoli possono puntare allo stesso modello (default e plan
 * su Opus con thinking diversi, smol/task/commit sullo stesso Flash): dedurlo solo
 * dal modello mostrava sempre il primo, e il cambio di ruolo sembrava non avvenire.
 * Ordine: il ruolo scelto per ultimo finche' il suo modello e' quello attivo, poi il
 * primo con stesso modello e stesso thinking, poi il primo con lo stesso modello.
 */
export function resolveActiveRole(
	rolesMap: Readonly<Record<string, string>>,
	model: { provider?: string; id?: string } | null | undefined,
	thinkingLevel: string | null | undefined,
	lastPicked: string | null | undefined,
	knownSelectors?: ReadonlySet<string>
): string | null {
	if (!model?.id) return null;
	if (lastPicked && rolesMap[lastPicked] && roleUsesModel(rolesMap[lastPicked], model, knownSelectors)) {
		return lastPicked;
	}
	const sameModel = Object.keys(rolesMap).filter((role) => roleUsesModel(rolesMap[role], model, knownSelectors));
	return (
		sameModel.find((role) => splitModelSelector(rolesMap[role], knownSelectors).thinking === thinkingLevel) ??
		sameModel[0] ??
		null
	);
}

/** Ruolo successivo nel ciclo rapido, saltando i ruoli senza modello assegnato. */
export function nextCycleRole(
	cycleOrder: readonly string[],
	rolesMap: Readonly<Record<string, string>>,
	currentRole: string | null
): string | null {
	const order = cycleOrder.length > 0 ? cycleOrder : Object.keys(rolesMap);
	const configured = order.filter((role) => Boolean(rolesMap[role]));
	if (configured.length === 0) return null;
	const index = currentRole ? configured.indexOf(currentRole) : -1;
	return configured[(index + 1) % configured.length];
}

export interface RoleDefinition {
	id: string;
	label: string;
	abbr: string;
	desc: string;
}

export const STANDARD_ROLE_METAS: readonly RoleDefinition[] = [
	{ id: 'default', label: 'Default / Chat', abbr: 'CH', desc: 'Modello principale per conversazione e attivita generali' },
	{ id: 'plan', label: 'Architectural Plan', abbr: 'PL', desc: 'Modello per pianificazione e analisi architetturale' },
	{ id: 'smol', label: 'Smol (Fast)', abbr: 'SM', desc: 'Modello ultra-rapido per compiti leggeri, esplorazione e scouting' },
	{ id: 'slow', label: 'Slow (Reasoning)', abbr: 'SL', desc: 'Modello per ragionamenti complessi e deduzioni approfondite' },
	{ id: 'vision', label: 'Vision / Images', abbr: 'VI', desc: 'Modello multimodale per ispezione e comprensione immagini' },
	{ id: 'task', label: 'Task Subagents', abbr: 'TS', desc: 'Modello delegato per subagenti ed esecuzioni parallele' },
	{ id: 'commit', label: 'Git Commit', abbr: 'CM', desc: 'Modello per generazione messaggi di commit e changelog' },
	{ id: 'advisor', label: 'Advisor (Reviewer)', abbr: 'AD', desc: 'Modello di revisione e controllo passivo di qualita' }
];

export interface ModelConfigDto {
	modelRoles: Record<string, string>;
	cycleOrder: string[];
	disabledProviders: string[];
	fallbackChains: Record<string, string[]>;
	defaultThinkingLevel?: string;
}

export type QuotaSemanticStatus = 'ok' | 'warn' | 'critical' | 'exhausted' | 'unconfigured' | 'offline';
