// Risoluzione della lingua: funzioni pure, senza rune e senza stato.
//
// Vivono fuori dallo store perche' decidono cosa legge l'utente (quale catalogo
// e quale formato di date e numeri) e devono restare verificabili dagli smoke
// test, che girano su Node con il solo type-stripping.

/** Lingue con un catalogo completo di messaggi. */
export type AppLocale = 'en' | 'it';

/** Preferenza persistita: `system` segue le lingue dichiarate dal sistema operativo. */
export type LanguagePreference = 'system' | AppLocale;

const FALLBACK_LOCALE: AppLocale = 'en';
const FALLBACK_ENGLISH_FORMAT_LOCALE = 'en-US';

/**
 * Prima lingua supportata nell'ordine di preferenza dichiarato dal sistema.
 * Le varianti regionali contano come la loro lingua base: `it-CH` resta italiano.
 */
export function resolveAppLocale(languages: readonly string[]): AppLocale {
	for (const language of languages) {
		const base = language.trim().toLowerCase().split('-')[0];
		if (base === 'it') return 'it';
		if (base === 'en') return 'en';
	}
	return FALLBACK_LOCALE;
}

/**
 * Locale per `Intl`: il formato di date e numeri segue la regione dell'utente,
 * non la sola lingua dell'interfaccia. Un utente `en-GB` legge `13/09/2026`
 * anche se il catalogo e' lo stesso di `en-US`.
 */
export function resolveFormatLocale(locale: AppLocale, languages: readonly string[]): string {
	if (locale === 'it') {
		const italian = languages.find((language) => baseLanguage(language) === 'it');
		return canonicalize(italian) ?? 'it-IT';
	}
	const english = languages.find((language) => baseLanguage(language) === 'en');
	return canonicalize(english) ?? FALLBACK_ENGLISH_FORMAT_LOCALE;
}

function baseLanguage(language: string): string {
	return language.trim().toLowerCase().split('-')[0];
}

function canonicalize(language: string | undefined): string | null {
	if (!language) return null;
	try {
		return Intl.getCanonicalLocales(language.trim())[0] ?? null;
	} catch {
		return null;
	}
}
