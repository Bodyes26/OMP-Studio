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

/**
 * Risolve il `ModelDto` di catalogo a partire da un selettore di ruolo/fallback
 * (senza suffisso `:thinking`).
 *
 * L'ordine di priorita' e' obbligatorio: prima il match esatto su `selector`
 * (`<provider>/<id>`), poi il match sull'`id` nudo. Molti gateway pubblicano
 * modelli il cui `id` contiene il nome dell'upstream (es. `cloudflare-ai-gateway`
 * espone `anthropic/claude-opus-5`): cercando in un colpo solo `selector || id` si
 * attribuisce il modello al primo gateway presente nel catalogo invece che al
 * provider realmente usato da omp.
 */
export function resolveCatalogModel(
	catalog: ModelDto[],
	rawSelector: string
): ModelDto | undefined {
	const raw = rawSelector.split(':')[0];
	if (!raw) return undefined;
	return catalog.find((m) => m.selector === raw) ?? catalog.find((m) => m.id === raw);
}
