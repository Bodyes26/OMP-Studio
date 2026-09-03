import type { QuotaLimit } from '../stores/quota.svelte';

export type ModelFamily = 'anthropic' | 'google' | 'openai' | null;

/**
 * Determina la famiglia di modello secondo Contract C2 (mapping ufficiale OMP).
 * Confronto case-insensitive su stringa nuda; tollera prefisso provider/ residuo
 * prendendo la parte dopo lo slash, e un eventuale suffisso :thinking.
 */
export function modelFamilyFor(modelId?: string): ModelFamily {
	if (!modelId) return null;
	let s = modelId.trim().toLowerCase();

	// Rimuove eventuale suffisso thinking (:thinking o simili)
	if (s.includes(':')) {
		s = s.split(':')[0].trim();
	}

	// Gestione prefisso esplicito openai/ prima di estrarre il nome del modello
	if (s.startsWith('openai/')) {
		return 'openai';
	}

	// Se presente un prefisso provider generico (es. anthropic/claude-opus-5), prendiamo la parte dopo lo slash
	if (s.includes('/')) {
		const parts = s.split('/');
		s = parts[parts.length - 1].trim();
	}

	if (s.startsWith('claude-')) return 'anthropic';
	if (s.startsWith('gemini-') || s.startsWith('gemma-')) return 'google';
	if (s.startsWith('gpt-')) return 'openai';

	return null;
}

/**
 * Normalizza una stringa in una delle tre famiglie riconosciute.
 */
function normalizeFamily(val?: string): ModelFamily {
	if (!val) return null;
	const lower = val.trim().toLowerCase();
	if (lower === 'anthropic' || lower === 'claude') return 'anthropic';
	if (lower === 'google' || lower === 'gemini' || lower === 'gemma') return 'google';
	if (lower === 'openai' || lower === 'gpt') return 'openai';
	return null;
}

/**
 * Determina la famiglia di un limite di quota.
 * Nei provider aggregatori (es. google-antigravity), la famiglia e' il secondo segmento
 * dell'id separato da `:` (es. `google-antigravity:anthropic:default:daily`).
 * In alternativa usa la label come fallback (es. `Usage (Anthropic)` -> `anthropic`).
 */
export function limitFamily(limit: QuotaLimit): ModelFamily {
	if (limit.id) {
		const parts = limit.id.split(':');
		if (parts.length >= 2) {
			const fromSegment = normalizeFamily(parts[1]);
			if (fromSegment) return fromSegment;
		}
	}

	if (limit.label) {
		const lowerLabel = limit.label.toLowerCase();
		if (lowerLabel.includes('anthropic') || lowerLabel.includes('claude')) return 'anthropic';
		if (lowerLabel.includes('google') || lowerLabel.includes('gemini') || lowerLabel.includes('gemma')) return 'google';
		if (lowerLabel.includes('openai') || lowerLabel.includes('gpt')) return 'openai';
	}

	return null;
}

/**
 * Filtra i limiti per famiglia di modello.
 * Se family e' null, oppure nessun limite dichiara una famiglia, oppure il filtro
 * darebbe insieme vuoto, restituisce l'array originale (mai vuoto per colpa del filtro).
 */
export function familyLimits(limits: QuotaLimit[], family: ModelFamily): QuotaLimit[] {
	if (!family || !limits || limits.length === 0) {
		return limits;
	}

	const anyHasFamily = limits.some((l) => limitFamily(l) !== null);
	if (!anyHasFamily) {
		return limits;
	}

	const filtered = limits.filter((l) => limitFamily(l) === family);
	if (filtered.length === 0) {
		return limits;
	}

	return filtered;
}

/**
 * Trova il limite con la finestra piu' breve in base a `window.durationMs`.
 * I limiti senza durationMs valido valgono Infinity; a parita' vince il primo in ordine.
 */
export function shortestWindowLimit(limits: QuotaLimit[]): QuotaLimit | undefined {
	if (!limits || limits.length === 0) return undefined;

	let best: QuotaLimit = limits[0];
	let minDuration = getDuration(best);

	for (let i = 1; i < limits.length; i++) {
		const curr = limits[i];
		const d = getDuration(curr);
		// A parita' vince il primo, quindi confronto strettamente minore (<)
		if (d < minDuration) {
			minDuration = d;
			best = curr;
		}
	}

	return best;
}

function getDuration(limit: QuotaLimit): number {
	const ms = limit.window?.durationMs;
	return typeof ms === 'number' && !Number.isNaN(ms) && ms > 0 ? ms : Infinity;
}

/**
 * Calcola la frazione residua del limite (clamp 0..1).
 * Rispetta la priorita': amount.remainingFraction, altrimenti 1 - amount.usedFraction, altrimenti 1.
 */
export function remainingFractionOf(limit: QuotaLimit): number {
	const amount = limit.amount;
	let frac: number;

	if (typeof amount?.remainingFraction === 'number' && !Number.isNaN(amount.remainingFraction)) {
		frac = amount.remainingFraction;
	} else if (typeof amount?.usedFraction === 'number' && !Number.isNaN(amount.usedFraction)) {
		frac = 1 - amount.usedFraction;
	} else {
		frac = 1;
	}

	return Math.max(0, Math.min(1, frac));
}

/**
 * Calcola l'hash SHA-256 esadecimale delle credenziali (Contract C1).
 * I cinque campi uniti dal separatore NUL (\0):
 * provider, accountId, email, orgId, projectId
 * I campi assenti diventano stringa vuota.
 */
export async function accountPinHash(
	provider: string,
	metadata?: {
		accountId?: string;
		email?: string;
		orgId?: string;
		projectId?: string;
		[key: string]: unknown;
	} | null
): Promise<string> {
	const p = provider ?? '';
	const accountId = typeof metadata?.accountId === 'string' ? metadata.accountId : '';
	const email = typeof metadata?.email === 'string' ? metadata.email : '';
	const orgId = typeof metadata?.orgId === 'string' ? metadata.orgId : '';
	const projectId = typeof metadata?.projectId === 'string' ? metadata.projectId : '';

	const raw = `${p}\u0000${accountId}\u0000${email}\u0000${orgId}\u0000${projectId}`;
	const data = new TextEncoder().encode(raw);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Formatta il countdown al reset in italiano leggibile (es. "tra 4h 15m", "tra 2g 3h", "reset ora").
 */
export function formatResetCountdown(resetsAt: number | undefined, now = Date.now()): string {
	if (!resetsAt) return '';
	const diffMs = resetsAt - now;
	if (diffMs <= 0) return 'reset ora';
	const diffSec = Math.floor(diffMs / 1000);
	if (diffSec < 60) return `tra ${diffSec}s`;
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `tra ${diffMin}m`;
	const diffHours = Math.floor(diffMin / 60);
	const remMin = diffMin % 60;
	if (diffHours < 24) {
		return remMin > 0 ? `tra ${diffHours}h ${remMin}m` : `tra ${diffHours}h`;
	}
	const diffDays = Math.floor(diffHours / 24);
	const remHours = diffHours % 24;
	return remHours > 0 ? `tra ${diffDays}g ${remHours}h` : `tra ${diffDays}g`;
}
