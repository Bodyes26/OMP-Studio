import { overwriteGetLocale } from '../src/lib/paraglide/runtime.js';

/**
 * Fissa la lingua dei messaggi per i test che verificano copy localizzata.
 *
 * Senza questo aggancio la lingua dipenderebbe dalla `baseLocale` del catalogo
 * compilato: un test scritto sulle frasi italiane fallirebbe al primo cambio
 * di lingua predefinita, nascondendo il vero soggetto della verifica.
 */
export function useLocale(locale: 'it' | 'en'): void {
	overwriteGetLocale(() => locale);
}
