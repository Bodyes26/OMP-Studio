// Risoluzione dei testi localizzati del catalogo comandi con fallback su inglese.
import { getLocale } from '$lib/paraglide/runtime.js';
import type { CommandManifestEntry, CommandText } from './types';

/**
 * Restituisce i testi localizzati della voce del manifesto per la lingua corrente,
 * con fallback trasparente su 'en'.
 */
export function resolveCommandText(entry: CommandManifestEntry, locale?: string): CommandText {
	const current = locale ?? getLocale?.() ?? 'en';
	if (current === 'it' && entry.text.it) {
		return entry.text.it;
	}
	return entry.text.en ?? entry.text.it;
}

/**
 * Verifica se una voce soddisfa una query di ricerca libera (su id, titolo, summary, esempi).
 */
export function matchesCommandSearch(entry: CommandManifestEntry, query: string, locale?: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	if (entry.id.toLowerCase().includes(q) || `/${entry.id}`.toLowerCase().includes(q)) return true;
	const text = resolveCommandText(entry, locale);
	if (text.title.toLowerCase().includes(q)) return true;
	if (text.summary.toLowerCase().includes(q)) return true;
	if (text.whenToUse?.toLowerCase().includes(q)) return true;
	if (text.benefits.some((b) => b.toLowerCase().includes(q))) return true;
	if (text.examples.some((e) => e.command.toLowerCase().includes(q) || e.note.toLowerCase().includes(q))) return true;
	return false;
}
