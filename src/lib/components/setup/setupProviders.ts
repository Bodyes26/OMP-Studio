/**
 * Tessere in evidenza del passo Provider del setup.
 *
 * Gli `ids` sono quelli veri accettati da `omp login` (verificati con
 * `get_login_providers`: `anthropic`, `openai-codex`, `google-antigravity`,
 * `google-gemini-cli`, `github-copilot`, `cursor`, `opencode-zen`,
 * `opencode-go`, `openrouter`, `xai`, `zai`, `deepseek`, `ollama`). Quando omp
 * espone più id per lo stesso marchio (OpenCode Zen e Go) la tessera tiene una
 * lista in ordine di preferenza e usa il primo che il processo elenca: così la
 * griglia in evidenza non cambia se uno dei due sparisce.
 *
 * Il nome è il marchio e resta com'è in ogni lingua; il piano/abbonamento sotto
 * il nome è testo d'interfaccia e passa da Paraglide.
 *
 * `auth` dice come si collega:
 * - `code`: il browser si apre e il codice si incolla (omp manda `open_url` e
 *   poi `input`).
 * - `browser`: solo il browser, omp attende il callback (a volte con codice
 *   dispositivo mostrato nel messaggio).
 * - `key`: chiede una chiave o un token: in RPC non si può, quindi va nel
 *   mini-terminale `omp login <id>` (SET-040).
 * - `local`: server locale (Ollama): stessa via del terminale, perché omp
 *   chiede comunque un token facoltativo.
 *
 * I provider fuori dall'elenco non hanno una classificazione statica: si prova
 * il login RPC e, se il runtime rifiuta perché vuole input o prompt
 * interattivi, si passa al terminale (vedi `setupLogin.ts`).
 */
import { m } from '#lib/paraglide/messages.js';

export type SetupAuthKind = 'code' | 'browser' | 'key' | 'local';

export interface SetupProviderDef {
	/** Chiave stabile della tessera: identificatore della scena e delle azioni. */
	key: string;
	/** Id accettati da `omp login`, in ordine di preferenza. */
	ids: string[];
	/** Id per `ProviderLogo` (il logo non si copia qui: arriva da providerLogos). */
	logo: string;
	name: string;
	plan: () => string;
	auth: SetupAuthKind;
}

export const FEATURED_PROVIDERS: SetupProviderDef[] = [
	{
		key: 'anthropic',
		ids: ['anthropic'],
		logo: 'anthropic',
		name: 'Anthropic',
		plan: () => m.setup2_prov_plan_anthropic(),
		auth: 'code'
	},
	{
		key: 'openai-codex',
		ids: ['openai-codex'],
		logo: 'openai-codex',
		name: 'ChatGPT',
		plan: () => m.setup2_prov_plan_codex(),
		auth: 'code'
	},
	{
		key: 'google-antigravity',
		ids: ['google-antigravity'],
		logo: 'google-antigravity',
		name: 'Google Antigravity',
		plan: () => m.setup2_prov_plan_google_account(),
		auth: 'browser'
	},
	{
		key: 'google-gemini-cli',
		ids: ['google-gemini-cli'],
		logo: 'google-gemini-cli',
		name: 'Google Gemini CLI',
		plan: () => m.setup2_prov_plan_google_account(),
		auth: 'code'
	},
	{
		key: 'github-copilot',
		ids: ['github-copilot'],
		logo: 'github-copilot',
		name: 'GitHub Copilot',
		plan: () => m.setup2_prov_plan_copilot(),
		auth: 'browser'
	},
	{
		key: 'cursor',
		ids: ['cursor'],
		logo: 'cursor',
		name: 'Cursor',
		plan: () => m.setup2_prov_plan_cursor(),
		auth: 'browser'
	},
	{
		key: 'opencode',
		ids: ['opencode-zen', 'opencode-go'],
		logo: 'opencode-zen',
		name: 'OpenCode',
		plan: () => m.setup2_prov_plan_opencode(),
		auth: 'key'
	},
	{
		key: 'openrouter',
		ids: ['openrouter'],
		logo: 'openrouter',
		name: 'OpenRouter',
		plan: () => m.setup2_prov_plan_api_key(),
		// SET-040: le chiavi si battono in un terminale, non in un campo della
		// GUI. OpenRouter in RPC accetterebbe anche un codice incollato, ma una
		// regola sola per tutti i provider a chiave è più prevedibile.
		auth: 'key'
	},
	{
		key: 'xai',
		ids: ['xai', 'xai-oauth'],
		logo: 'xai',
		name: 'xAI',
		plan: () => m.setup2_prov_plan_api_key(),
		auth: 'key'
	},
	{
		key: 'zai',
		ids: ['zai', 'zai-coding-plan'],
		logo: 'zai',
		name: 'Z.AI',
		plan: () => m.setup2_prov_plan_zai(),
		auth: 'key'
	},
	{
		key: 'deepseek',
		ids: ['deepseek'],
		logo: 'deepseek',
		name: 'DeepSeek',
		plan: () => m.setup2_prov_plan_api_key(),
		auth: 'key'
	},
	{
		key: 'ollama',
		ids: ['ollama'],
		logo: 'ollama',
		name: 'Ollama',
		plan: () => m.setup2_prov_plan_ollama(),
		auth: 'local'
	}
];

/** Nomi dei marchi noti: servono alla riga del perché dei ruoli, dove arriva
 *  solo l'id del provider. Fuori elenco resta l'id, che è comunque leggibile. */
const PROVIDER_LABELS: Record<string, string> = {
	anthropic: 'Anthropic',
	'openai-codex': 'ChatGPT',
	'openai-codex-device': 'ChatGPT',
	'google-antigravity': 'Google Antigravity',
	'google-gemini-cli': 'Google Gemini CLI',
	'github-copilot': 'GitHub Copilot',
	cursor: 'Cursor',
	'opencode-zen': 'OpenCode Zen',
	'opencode-go': 'OpenCode Go',
	openrouter: 'OpenRouter',
	xai: 'xAI',
	'xai-oauth': 'xAI',
	zai: 'Z.AI',
	'zai-coding-plan': 'Z.AI',
	deepseek: 'DeepSeek',
	ollama: 'Ollama',
	mistral: 'Mistral',
	commandcode: 'Command Code',
	kimi: 'Kimi',
	'kimi-code': 'Kimi',
	devin: 'Devin',
	lmstudio: 'LM Studio',
	'lm-studio': 'LM Studio'
};

export function providerLabel(id: string | null | undefined): string {
	if (!id) return '';
	return PROVIDER_LABELS[id] ?? id;
}

export function authLabel(kind: SetupAuthKind): string {
	switch (kind) {
		case 'key':
			return m.setup2_prov_auth_key();
		case 'local':
			return m.setup2_prov_auth_local();
		default:
			return m.setup2_prov_auth_browser();
	}
}

/** Strumenti trovati sul computer (`setup_detect_tools`), per il gruppo in testa. */
export interface DetectedTools {
	claudeCode: boolean;
	codexCli: boolean;
	ollama: boolean;
}

export const NO_DETECTED_TOOLS: DetectedTools = { claudeCode: false, codexCli: false, ollama: false };

/**
 * Provider suggeriti dagli strumenti trovati: chi ha Claude Code, Codex CLI o
 * Ollama installati quasi certamente usa quel provider, quindi va in testa.
 * La chiave è la chiave della tessera.
 */
const DETECTED_BY_KEY: Record<string, keyof DetectedTools> = {
	anthropic: 'claudeCode',
	'openai-codex': 'codexCli',
	ollama: 'ollama'
};

export function detectedToolLabel(def: SetupProviderDef, detected: DetectedTools): string | null {
	const tool = DETECTED_BY_KEY[def.key];
	if (!tool || !detected[tool]) return null;
	switch (tool) {
		case 'claudeCode':
			return m.setup2_prov_detected_claude_code();
		case 'codexCli':
			return m.setup2_prov_detected_codex_cli();
		default:
			return m.setup2_prov_detected_ollama();
	}
}
