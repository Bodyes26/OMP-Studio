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
