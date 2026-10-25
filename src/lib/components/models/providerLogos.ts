/**
 * providerLogos.ts
 *
 * Mappatura centralizzata per le identita' grafiche dei provider LLM.
 *
 * Requisiti e policy di matching:
 * - Claude sunburst per Anthropic
 * - Codex per OpenAI / openai-codex (non il knot OpenAI indistinto)
 * - Antigravity per google-antigravity (indipendentemente dalla famiglia del modello veicolato)
 * - Distinzione provider/account rispetto alla famiglia modello
 * - Whitelist esatta di alias/identificativi noti per evitare falsi positivi su custom (es. "anthropic-proxy-mio")
 * - Asset locali offline senza dipendenze remote
 * - Fallback neutro per provider sconosciuti o custom (nessun falso logo commerciale)
 *
 * Provenienza e licenza:
 * Gli asset vettoriali derivano dal set open-source Lobe Icons (licenza MIT, Copyright (c) 2024 LobeHub)
 * e dalle definizioni locali di Tern. Vedi THIRD-PARTY-NOTICES.md per il testo integrale della licenza.
 */

export type KnownProviderId =
	| 'anthropic'
	| 'openai-codex'
	| 'google-antigravity'
	| 'gemini'
	| 'google'
	| 'google-vertex'
	| 'ollama'
	| 'openrouter'
	| 'groq'
	| 'mistral'
	| 'deepseek'
	| 'copilot'
	| 'azure'
	| 'amazon-bedrock'
	| 'meta'
	| 'qwen'
	| 'minimax'
	| 'perplexity'
	| 'together'
	| 'xai'
	| 'cloudflare'
	| 'cerebras'
	| 'cohere'
	| 'fireworks'
	| 'gitlab-duo'
	| 'huggingface';

export type ResolvedProviderId = KnownProviderId | 'custom';

/** Whitelist rigorosa dei provider noti e dei loro alias riconosciuti */
const KNOWN_PROVIDERS = new Map<string, KnownProviderId>([
	// Anthropic
	['anthropic', 'anthropic'],
	['claude', 'anthropic'],

	// OpenAI / Codex (utente richiede esplicitamente logo Codex per OpenAI)
	['openai', 'openai-codex'],
	['openai-codex', 'openai-codex'],
	['openai-codex-device', 'openai-codex'],
	['codex', 'openai-codex'],

	// Google Antigravity
	['google-antigravity', 'google-antigravity'],
	['antigravity', 'google-antigravity'],

	// Google / Gemini / Vertex
	['google-vertex', 'google-vertex'],
	['google-vertex-ai', 'google-vertex'],
	['vertex', 'google-vertex'],
	['gemini', 'gemini'],
	['google-gemini', 'gemini'],
	['google-gemini-cli', 'gemini'],
	['google', 'google'],

	// Ollama
	['ollama', 'ollama'],
	['ollama-cloud', 'ollama'],

	// OpenRouter
	['openrouter', 'openrouter'],

	// Groq
	['groq', 'groq'],

	// Mistral
	['mistral', 'mistral'],
	['mistralai', 'mistral'],

	// DeepSeek
	['deepseek', 'deepseek'],

	// GitHub Copilot
	['copilot', 'copilot'],
	['github-copilot', 'copilot'],
	['github', 'copilot'],

	// Azure
	['azure', 'azure'],
	['azure-openai', 'azure'],

	// Amazon Bedrock
	['amazon-bedrock', 'amazon-bedrock'],
	['bedrock', 'amazon-bedrock'],

	// Meta
	['meta', 'meta'],
	['llama', 'meta'],

	// Qwen
	['qwen', 'qwen'],
	['qwen-portal', 'qwen'],

	// MiniMax
	['minimax', 'minimax'],
	['minimax-code', 'minimax'],

	// Perplexity
	['perplexity', 'perplexity'],

	// Together AI
	['together', 'together'],
	['together-ai', 'together'],

	// xAI
	['xai', 'xai'],
	['xai-oauth', 'xai'],

	// Cloudflare
	['cloudflare', 'cloudflare'],
	['cloudflare-ai-gateway', 'cloudflare'],

	// Cerebras
	['cerebras', 'cerebras'],

	// Cohere
	['cohere', 'cohere'],

	// Fireworks
	['fireworks', 'fireworks'],
	['fireworks-ai', 'fireworks'],

	// GitLab
	['gitlab', 'gitlab-duo'],
	['gitlab-duo', 'gitlab-duo'],

	// Hugging Face
	['huggingface', 'huggingface'],
	['hf', 'huggingface']
]);

/**
 * Normalizza un identificativo provider, prefisso selettore (es. "anthropic/claude-3-5")
 * o limite aggregatore ("google-antigravity:anthropic:default:daily") al suo ProviderId canonico.
 * Non fa match prefisso libero per non attribuire brand falsi a proxy o endpoint custom.
 */
export function normalizeProviderId(raw: string | null | undefined): ResolvedProviderId {
	if (!raw) return 'custom';
	let s = String(raw).trim().toLowerCase();
	if (!s) return 'custom';

	// Selettore completo "provider/modelId" -> isola il provider
	if (s.includes('/')) {
		s = s.split('/')[0].trim();
	}
	// Identificatore aggregatore "provider:family:group:window" -> isola il provider
	if (s.includes(':')) {
		s = s.split(':')[0].trim();
	}

	return KNOWN_PROVIDERS.get(s) ?? 'custom';
}

export { default as ProviderLogo } from './ProviderLogo.svelte';
