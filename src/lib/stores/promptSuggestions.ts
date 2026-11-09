/**
 * Tipi, costanti di fabbrica e funzioni pure per i Suggerimenti Prompt del Composer.
 *
 * Principi:
 * - I suggerimenti statici sono chip predefinite o personalizzate configurabili nelle Impostazioni.
 * - I 3 preset di fabbrica (Procedi, Spiega, Verifica) sono modificabili, nascondibili e ripristinabili.
 * - Le chip dinamiche vengono generate dal modello alla fine di un turno e mostrate in coda alle statiche.
 * - Il click o scorciatoia Alt+N precompila il composer (non invia).
 */

import { m } from '#lib/paraglide/messages.js';

/** Un messaggio Paraglide senza parametri, invocabile per lingua. */
type LocalizedSuggestionMessage = (inputs?: Record<string, never>, options?: { locale: 'en' | 'it' }) => string;

export type FactorySuggestionKey = 'proceed' | 'explain' | 'verify';

export interface PromptSuggestion {
	id: string;
	factoryKey: FactorySuggestionKey | null;
	label: string; // testo sulla chip, max 28 caratteri
	prompt: string; // testo iniettato nel composer
	order: number; // passo 10
	hidden: boolean;
}

export const MAX_STATIC_CHIPS = 3;
export const MAX_DYNAMIC_CHIPS = 3;

export const FACTORY_SUGGESTIONS: readonly PromptSuggestion[] = [
	{
		id: 'sug_factory_proceed',
		factoryKey: 'proceed',
		// Getter: i preset di fabbrica nascono nella lingua attiva al primo uso;
		// una volta salvati restano il testo dell'utente.
		get label() { return m.l10n_state_suggest_proceed_label(); },
		get prompt() { return m.l10n_state_suggest_proceed_prompt(); },
		order: 10,
		hidden: false
	},
	{
		id: 'sug_factory_explain',
		factoryKey: 'explain',
		get label() { return m.l10n_state_suggest_explain_label(); },
		get prompt() { return m.l10n_state_suggest_explain_prompt(); },
		order: 20,
		hidden: false
	},
	{
		id: 'sug_factory_verify',
		factoryKey: 'verify',
		get label() { return m.l10n_state_suggest_verify_label(); },
		get prompt() { return m.l10n_state_suggest_verify_prompt(); },
		order: 30,
		hidden: false
	}
] as const;

/**
 * Restituisce la definizione originaria di fabbrica per una chiave specificata.
 */
export function getFactorySuggestion(key: FactorySuggestionKey): PromptSuggestion | undefined {
	return FACTORY_SUGGESTIONS.find((s) => s.factoryKey === key);
}

/**
 * Valida un singolo oggetto suggerimento prompt.
 */
export function isPromptSuggestion(value: unknown): value is PromptSuggestion {
	if (!value || typeof value !== 'object') return false;
	const s = value as Record<string, unknown>;
	const validFactoryKey =
		s.factoryKey === null ||
		s.factoryKey === 'proceed' ||
		s.factoryKey === 'explain' ||
		s.factoryKey === 'verify';

	return (
		typeof s.id === 'string' &&
		s.id.trim().length > 0 &&
		validFactoryKey &&
		typeof s.label === 'string' &&
		s.label.trim().length > 0 &&
		typeof s.prompt === 'string' &&
		s.prompt.trim().length > 0 &&
		typeof s.order === 'number' &&
		Number.isFinite(s.order) &&
		typeof s.hidden === 'boolean'
	);
}

/**
 * Sanitizza e normalizza il catalogo dei suggerimenti salvato su disco.
 * Assicura che tutti i preset di fabbrica siano presenti (se mancanti, vengono reinseriti),
 * tronca le etichette a 28 caratteri, deduplica per id e rinormalizza gli order a passo 10.
 */
export function sanitizeSuggestionsCatalog(input: unknown): PromptSuggestion[] {
	const result: PromptSuggestion[] = [];
	const seenIds = new Set<string>();

	if (Array.isArray(input)) {
		for (const item of input) {
			if (!item || typeof item !== 'object') continue;
			const raw = item as Record<string, unknown>;
			const candidate: PromptSuggestion = {
				id: typeof raw.id === 'string' ? raw.id.trim() : '',
				factoryKey:
					raw.factoryKey === 'proceed' || raw.factoryKey === 'explain' || raw.factoryKey === 'verify'
						? raw.factoryKey
						: null,
				label: typeof raw.label === 'string' ? raw.label.trim().slice(0, 28) : '',
				prompt: typeof raw.prompt === 'string' ? raw.prompt.trim() : '',
				order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : (result.length + 1) * 10,
				hidden: raw.hidden === true
			};

			if (isPromptSuggestion(candidate) && !seenIds.has(candidate.id)) {
				seenIds.add(candidate.id);
				result.push(candidate);
			}
		}
	}

	// Assicura che i 3 preset di fabbrica esistano sempre nel catalogo
	for (const factory of FACTORY_SUGGESTIONS) {
		const existing = result.find(
			(s) => s.id === factory.id || (factory.factoryKey && s.factoryKey === factory.factoryKey)
		);
		if (!existing) {
			result.push({ ...factory });
			seenIds.add(factory.id);
		}
	}

	// Ordina e rinormalizza gli order a passo 10
	result.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
	result.forEach((item, index) => {
		item.order = (index + 1) * 10;
	});

	return result;
}

/**
 * Restituisce i suggerimenti visibili (non nascosti), ordinati per order,
 * limitati al numero massimo specificato.
 */
export function visibleSuggestions(
	catalog: PromptSuggestion[],
	limit: number = MAX_STATIC_CHIPS
): PromptSuggestion[] {
	return catalog
		.filter((s) => !s.hidden)
		.sort((a, b) => a.order - b.order)
		.slice(0, limit);
}

/**
 * Normalizza il testo di un suggerimento per confronti e deduplicazione:
 * minuscolo, spazi collassati, rimozione di punteggiatura terminale.
 */
export function normalizeSuggestionText(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.replace(/[.,;:!?…]+$/u, '')
		.trim();
}

/**
 * Etichetta e prompt da mostrare per un suggerimento.
 *
 * Un preset di fabbrica non personalizzato vive nella lingua in cui e' stato
 * salvato: si riconosce confrontando entrambe le varianti, cosi' la chip segue
 * la lingua attiva. Un testo scritto dall'utente resta com'e'.
 */
export function suggestionDisplayText(suggestion: PromptSuggestion): { label: string; prompt: string } {
	const key = suggestion.factoryKey;
	if (!key) return { label: suggestion.label, prompt: suggestion.prompt };

	const messages: Record<FactorySuggestionKey, { label: LocalizedSuggestionMessage; prompt: LocalizedSuggestionMessage }> = {
		proceed: { label: m.l10n_state_suggest_proceed_label, prompt: m.l10n_state_suggest_proceed_prompt },
		explain: { label: m.l10n_state_suggest_explain_label, prompt: m.l10n_state_suggest_explain_prompt },
		verify: { label: m.l10n_state_suggest_verify_label, prompt: m.l10n_state_suggest_verify_prompt }
	};
	const messagesForKey = messages[key];
	const isFactory = (value: string, message: LocalizedSuggestionMessage) =>
		!value || value === message({}, { locale: 'it' }) || value === message({}, { locale: 'en' });
	return {
		label: isFactory(suggestion.label, messagesForKey.label)
			? messagesForKey.label()
			: suggestion.label,
		prompt: isFactory(suggestion.prompt, messagesForKey.prompt)
			? messagesForKey.prompt()
			: suggestion.prompt
	};
}

/** Chip pronta per il rendering nella riga dei suggerimenti del composer. */
export interface SuggestionChipItem {
	id: string;
	label: string;
	prompt: string;
	isDynamic?: boolean;
	/** Numero della scorciatoia Alt+N, assegnato per posizione. */
	shortcutNumber: number;
	title: string;
}

/** Oltre questa lunghezza l'etichetta di una chip dinamica viene troncata. */
const DYNAMIC_LABEL_MAX = 28;

/**
 * Compone la riga di chip mostrata nel composer.
 *
 * Le statiche stanno SEMPRE davanti e le dinamiche si accodano: e' cosi' che
 * nessuna chip gia' a schermo cambia numero quando i suggerimenti generati
 * arrivano qualche secondo dopo la fine del turno. Una dinamica che coincide
 * con una statica gia' mostrata viene scartata, per non offrire due volte la
 * stessa risposta.
 */
export function composeSuggestionChips(
	statics: PromptSuggestion[],
	dynamics: string[],
	maxDynamic: number = MAX_DYNAMIC_CHIPS
): SuggestionChipItem[] {
	const items: SuggestionChipItem[] = [];
	const seen = new Set<string>();
	let shortcut = 1;

	for (const s of statics) {
		const shown = suggestionDisplayText(s);
		seen.add(normalizeSuggestionText(shown.prompt || shown.label));
		items.push({
			id: s.id,
			label: shown.label,
			prompt: shown.prompt,
			isDynamic: false,
			shortcutNumber: shortcut++,
			title: shown.prompt !== shown.label ? shown.prompt : shown.label
		});
	}

	const num = typeof maxDynamic === 'string' ? Number(maxDynamic) : maxDynamic;
	const parsed = typeof num === 'number' && Number.isFinite(num) && num > 0 ? num : MAX_DYNAMIC_CHIPS;
	const limit = Math.max(1, Math.min(MAX_DYNAMIC_CHIPS, parsed));
	let taken = 0;

	for (const raw of dynamics) {
		if (taken >= limit) break;
		const text = raw.trim();
		const norm = normalizeSuggestionText(text);
		if (!norm || seen.has(norm)) continue;
		seen.add(norm);
		taken++;
		items.push({
			id: `dynamic_${taken}_${norm}`,
			label:
				text.length <= DYNAMIC_LABEL_MAX
					? text
					: text.slice(0, DYNAMIC_LABEL_MAX - 3).trim() + '...',
			prompt: text,
			isDynamic: true,
			shortcutNumber: shortcut++,
			title: text
		});
	}

	return items;
}
