/**
 * Mappatura e confronto delle famiglie di provider per quote e consumi.
 * Modulo puro senza dipendenze dal browser o da store reattivi.
 */

const PROVIDER_FAMILY_BY_ID: Record<string, string> = {
	openai: 'openai',
	'openai-codex': 'openai',
	google: 'google',
	'google-antigravity': 'google',
	copilot: 'copilot',
	'github-copilot': 'copilot',
	ollama: 'ollama',
	'ollama-cloud': 'ollama'
};

/**
 * Confronta due identificatori di provider tenendo conto degli alias e
 * delle famiglie equivalenti (es. google-antigravity con google, copilot con github-copilot).
 */
export function providersMatch(left: string | undefined, right: string | undefined): boolean {
	if (!left || !right) return false;
	const first = left.trim().toLowerCase();
	const second = right.trim().toLowerCase();
	return (PROVIDER_FAMILY_BY_ID[first] ?? first) === (PROVIDER_FAMILY_BY_ID[second] ?? second);
}
