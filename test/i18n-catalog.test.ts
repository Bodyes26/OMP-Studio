import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAppLocale, resolveFormatLocale } from '../src/lib/i18n/locale.ts';
import { overwriteGetLocale } from '../src/lib/paraglide/runtime.js';
import { m } from '../src/lib/paraglide/messages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type ComplexVariant = {
	declarations?: string[];
	selectors?: string[];
	match: Record<string, string>;
};
type CatalogEntry = string | ComplexVariant[];
type Catalog = Record<string, CatalogEntry>;

function loadCatalog(locale: 'en' | 'it'): Catalog {
	const raw = JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf8')) as Catalog;
	delete raw.$schema;
	return raw;
}

const enCatalog = loadCatalog('en');
const itCatalog = loadCatalog('it');

/** Segnaposto `{nome}` dichiarati in un messaggio, semplice o con varianti. */
function placeholders(entry: CatalogEntry): string[] {
	const texts =
		typeof entry === 'string' ? [entry] : entry.flatMap((variant) => Object.values(variant.match));
	const found = new Set<string>();
	for (const text of texts) {
		for (const match of text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) found.add(match[1]);
	}
	return [...found].sort();
}

describe('Cataloghi di traduzione it/en', () => {
	it('espone esattamente le stesse chiavi nelle due lingue', () => {
		// Una chiave presente in una sola lingua non rompe la build: l'utente
		// legge in silenzio la stringa dell'altra lingua (o nulla).
		const enKeys = Object.keys(enCatalog).sort();
		const itKeys = Object.keys(itCatalog).sort();
		assert.deepEqual(
			enKeys.filter((key) => !(key in itCatalog)),
			[],
			'chiavi presenti solo in en.json'
		);
		assert.deepEqual(
			itKeys.filter((key) => !(key in enCatalog)),
			[],
			'chiavi presenti solo in it.json'
		);
	});

	it('non contiene messaggi vuoti', () => {
		const empty: string[] = [];
		for (const [locale, catalog] of [
			['en', enCatalog],
			['it', itCatalog]
		] as const) {
			for (const [key, entry] of Object.entries(catalog)) {
				const texts =
					typeof entry === 'string'
						? [entry]
						: entry.flatMap((variant) => Object.values(variant.match));
				if (texts.some((text) => text.trim().length === 0)) empty.push(`${locale}:${key}`);
			}
		}
		assert.deepEqual(empty, []);
	});

	it('usa gli stessi segnaposto nelle due lingue', () => {
		// Un segnaposto perso nella traduzione cancella un dato dalla frase;
		// un segnaposto inventato stampa `undefined` all'utente.
		const mismatched: Array<{ key: string; en: string[]; it: string[] }> = [];
		for (const key of Object.keys(enCatalog)) {
			if (!(key in itCatalog)) continue;
			const enPlaceholders = placeholders(enCatalog[key]);
			const itPlaceholders = placeholders(itCatalog[key]);
			if (enPlaceholders.join(',') !== itPlaceholders.join(',')) {
				mismatched.push({ key, en: enPlaceholders, it: itPlaceholders });
			}
		}
		assert.deepEqual(mismatched, []);
	});

	it('dichiara le stesse varianti plurali nelle due lingue', () => {
		const mismatched: string[] = [];
		for (const [key, entry] of Object.entries(enCatalog)) {
			const other = itCatalog[key];
			const enIsComplex = Array.isArray(entry);
			const itIsComplex = Array.isArray(other);
			if (enIsComplex !== itIsComplex) {
				mismatched.push(`${key}: forma diversa (en complesso=${enIsComplex})`);
				continue;
			}
			if (!enIsComplex || !Array.isArray(other)) continue;
			const enVariants = entry.flatMap((variant) => Object.keys(variant.match)).sort();
			const itVariants = other.flatMap((variant) => Object.keys(variant.match)).sort();
			assert.ok(
				enVariants.includes('countPlural=one') && enVariants.includes('countPlural=other'),
				`${key}: il messaggio plurale deve coprire one e other`
			);
			if (enVariants.join(',') !== itVariants.join(',')) mismatched.push(key);
		}
		assert.deepEqual(mismatched, []);
	});
});

describe('Messaggi compilati Paraglide', () => {
	it('rende ogni messaggio nella lingua attiva senza ricompilare', () => {
		overwriteGetLocale(() => 'it');
		assert.equal(m.common_cancel(), 'Annulla');
		assert.equal(m.settings_language_title(), 'Lingua');

		overwriteGetLocale(() => 'en');
		assert.equal(m.common_cancel(), 'Cancel');
		assert.equal(m.settings_language_title(), 'Language');
	});

	it('interpola i segnaposto e accorda il plurale per lingua', () => {
		overwriteGetLocale(() => 'en');
		assert.equal(m.topbar_queue_count_label({ count: 1 }), '1 task queued');
		assert.equal(m.topbar_queue_count_label({ count: 4 }), '4 tasks queued');
		assert.equal(m.page_statusbar_agent_status_text({ state: 'Running' }), 'Status: Running');

		overwriteGetLocale(() => 'it');
		assert.equal(m.topbar_queue_count_label({ count: 1 }), '1 task in coda');
		assert.equal(m.topbar_queue_count_label({ count: 4 }), '4 task in coda');
		assert.equal(m.page_statusbar_agent_status_text({ state: 'In esecuzione' }), 'Stato: In esecuzione');
	});
});

describe('Risoluzione della lingua di sistema', () => {
	it('sceglie la prima lingua supportata rispettando le varianti regionali', () => {
		assert.equal(resolveAppLocale(['it-CH', 'en-US']), 'it');
		assert.equal(resolveAppLocale(['en-GB', 'it-IT']), 'en');
		assert.equal(resolveAppLocale(['IT']), 'it');
	});

	it('ripiega su inglese quando nessuna lingua di sistema è coperta', () => {
		assert.equal(resolveAppLocale(['de-DE', 'fr-FR']), 'en');
		assert.equal(resolveAppLocale([]), 'en');
	});

	it('mantiene la regione dell’utente per date e numeri', () => {
		assert.equal(resolveFormatLocale('en', ['en-GB', 'it-IT']), 'en-GB');
		assert.equal(resolveFormatLocale('it', ['it-CH']), 'it-CH');
		// Lingua scelta a mano, diversa da quelle di sistema: serve un default sensato.
		assert.equal(resolveFormatLocale('it', ['de-DE']), 'it-IT');
		assert.equal(resolveFormatLocale('en', ['de-DE']), 'en-US');
	});

	it('ignora stringhe di lingua malformate senza sollevare eccezioni', () => {
		assert.equal(resolveFormatLocale('en', ['en_US invalid']), 'en-US');
		assert.equal(resolveAppLocale(['', '  ', 'it']), 'it');
	});
});
