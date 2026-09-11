import { getTextDirection, overwriteGetLocale } from '$lib/paraglide/runtime.js';
import {
	resolveAppLocale,
	resolveFormatLocale,
	type AppLocale,
	type LanguagePreference
} from './locale';

export type { AppLocale, LanguagePreference };
export { resolveAppLocale, resolveFormatLocale };

function navigatorLanguages(): string[] {
	if (typeof navigator === 'undefined') return [];
	return navigator.languages?.length ? [...navigator.languages] : [navigator.language];
}

/**
 * Lingua attiva dell'interfaccia e formattazione regionale.
 *
 * Paraglide legge la lingua da qui tramite `overwriteGetLocale`: cambiare
 * lingua non ricarica la WebView, quindi sessioni omp, terminali e stream
 * live restano vivi mentre i testi si riscrivono da soli.
 */
class I18nStore {
	preference = $state<LanguagePreference>('system');
	locale = $state<AppLocale>(resolveAppLocale(navigatorLanguages()));
	formatLocale = $state(resolveFormatLocale(this.locale, navigatorLanguages()));
	private initialized = false;

	initialize() {
		if (this.initialized || typeof window === 'undefined') return;
		this.initialized = true;
		window.addEventListener('languagechange', this.handleSystemLanguageChange);
		this.applyDocumentLanguage();
	}

	setPreference(preference: LanguagePreference) {
		if (this.preference === preference) return;
		this.preference = preference;
		this.refresh();
	}

	formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
		return new Intl.DateTimeFormat(this.formatLocale, options).format(asDate(value));
	}

	formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
		return new Intl.NumberFormat(this.formatLocale, options).format(value);
	}

	formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
		return new Intl.RelativeTimeFormat(this.formatLocale, { numeric: 'auto' }).format(value, unit);
	}

	private handleSystemLanguageChange = () => {
		if (this.preference === 'system') this.refresh();
	};

	private refresh() {
		const languages = navigatorLanguages();
		this.locale = this.preference === 'system' ? resolveAppLocale(languages) : this.preference;
		this.formatLocale = resolveFormatLocale(this.locale, languages);
		this.applyDocumentLanguage();
	}

	private applyDocumentLanguage() {
		if (typeof document === 'undefined') return;
		document.documentElement.lang = this.locale;
		document.documentElement.dir = getTextDirection(this.locale);
	}
}

function asDate(value: Date | number | string): Date {
	return value instanceof Date ? value : new Date(value);
}

export const i18n = new I18nStore();

// Paraglide risolve ogni messaggio con la lingua dello store: un solo punto di verita'.
overwriteGetLocale(() => i18n.locale);
