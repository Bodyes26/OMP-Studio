/**
 * Formatta un conteggio numerico di token in forma leggibile (es: 1.2k, 1.5M).
 */
export function formatTokens(count?: number): string {
	if (typeof count !== 'number') return '0';
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
	return String(count);
}
