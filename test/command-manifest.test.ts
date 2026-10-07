import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMAND_MANIFEST } from '../src/lib/agent/commandCatalog/manifest/index.ts';
import type { CommandManifestEntry } from '../src/lib/agent/commandCatalog/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const ICONS_FILE = join(ROOT, 'src', 'lib', 'icons.ts');

function getRegisteredIcons(): Set<string> {
	const content = readFileSync(ICONS_FILE, 'utf8');
	const matches = [...content.matchAll(/export\s*\{\s*default\s+as\s+([A-Za-z0-9_]+)\s*\}/g)];
	return new Set(matches.map((m) => m[1]));
}

const ALLOWED_ORIGINS: Record<string, true> = { omp: true, studio: true, control: true };
const LOCKED_CONTROL_IDS: Record<string, true> = {
	'ctl.attach': true,
	'ctl.role': true,
	'ctl.model': true,
	'ctl.thinking': true
};

test('Command Manifest — id unici', () => {
	assert.ok(COMMAND_MANIFEST.length > 0, 'Il manifesto deve contenere almeno una voce');
	const seen = new Set<string>();
	const duplicates: string[] = [];

	for (const entry of COMMAND_MANIFEST) {
		if (seen.has(entry.id)) {
			duplicates.push(entry.id);
		}
		seen.add(entry.id);
	}

	assert.deepEqual(duplicates, [], `Trovati id duplicati nel manifesto: ${duplicates.join(', ')}`);
});

test('Command Manifest — defaultPlacement e supported', () => {
	for (const entry of COMMAND_MANIFEST) {
		if (entry.defaultPlacement) {
			const inSupported = entry.supported.some(
				(p) =>
					p.zone === entry.defaultPlacement?.zone && p.form === entry.defaultPlacement?.form
			);
			assert.ok(
				inSupported,
				`Voce "${entry.id}": defaultPlacement (${JSON.stringify(entry.defaultPlacement)}) non presente in supported (${JSON.stringify(entry.supported)})`
			);
		}
	}
});

test('Command Manifest — testi it ed en completi e non vuoti', () => {
	for (const entry of COMMAND_MANIFEST) {
		assert.ok(entry.text, `Voce "${entry.id}": campo text mancante`);

		for (const locale of ['it', 'en'] as const) {
			const t = entry.text[locale];
			assert.ok(t, `Voce "${entry.id}": traduzione "${locale}" mancante`);

			assert.ok(
				typeof t.title === 'string' && t.title.trim().length > 0,
				`Voce "${entry.id}" [${locale}]: title mancante o vuoto`
			);
			assert.ok(
				typeof t.summary === 'string' && t.summary.trim().length > 0,
				`Voce "${entry.id}" [${locale}]: summary mancante o vuoto`
			);

			assert.ok(
				Array.isArray(t.benefits) && t.benefits.length > 0,
				`Voce "${entry.id}" [${locale}]: benefits deve essere un array non vuoto`
			);
			for (let i = 0; i < t.benefits.length; i++) {
				assert.ok(
					typeof t.benefits[i] === 'string' && t.benefits[i].trim().length > 0,
					`Voce "${entry.id}" [${locale}]: benefit[${i}] vuoto`
				);
			}

			assert.ok(
				Array.isArray(t.examples) && t.examples.length > 0,
				`Voce "${entry.id}" [${locale}]: examples deve essere un array non vuoto`
			);
			for (let i = 0; i < t.examples.length; i++) {
				const ex = t.examples[i];
				assert.ok(
					typeof ex?.command === 'string' && ex.command.trim().length > 0,
					`Voce "${entry.id}" [${locale}]: example[${i}].command mancante o vuoto`
				);
				assert.ok(
					typeof ex?.note === 'string' && ex.note.trim().length > 0,
					`Voce "${entry.id}" [${locale}]: example[${i}].note mancante o vuoto`
				);
			}
		}
	}
});

test('Command Manifest — icone esistenti nel registro src/lib/icons.ts', () => {
	const registeredIcons = getRegisteredIcons();
	assert.ok(registeredIcons.size > 0, 'Il registro delle icone non deve essere vuoto');

	const missingIcons: { id: string; icon: string }[] = [];
	for (const entry of COMMAND_MANIFEST) {
		if (!registeredIcons.has(entry.icon)) {
			missingIcons.push({ id: entry.id, icon: entry.icon });
		}
	}

	assert.deepEqual(
		missingIcons,
		[],
		`Trovate icone nel manifesto non registrate in src/lib/icons.ts: ${JSON.stringify(missingIcons)}`
	);
});

test('Command Manifest — origini consentite e convenzione ctl.*', () => {
	for (const entry of COMMAND_MANIFEST) {
		assert.ok(
			ALLOWED_ORIGINS[entry.origin],
			`Voce "${entry.id}": origin "${entry.origin}" non valida (attese: 'omp', 'studio', 'control')`
		);

		if (entry.origin === 'control') {
			assert.ok(
				entry.id.startsWith('ctl.'),
				`Voce "${entry.id}": origin 'control' richiede id con prefisso 'ctl.'`
			);
		} else {
			assert.ok(
				!entry.id.startsWith('ctl.'),
				`Voce "${entry.id}": prefisso 'ctl.' riservato esclusivamente a origin 'control'`
			);
		}
	}
});

test('Command Manifest — controlli locked circoscritti a attach/role/model/thinking', () => {
	const lockedEntries = COMMAND_MANIFEST.filter((e) => e.locked);
	const lockedIds = new Set(lockedEntries.map((e) => e.id));

	// Solo ed esattamente i quattro controlli essenziali possono essere locked
	assert.deepEqual(
		[...lockedIds].sort(),
		Object.keys(LOCKED_CONTROL_IDS).sort(),
		`I controlli locked devono essere esattamente ${Object.keys(LOCKED_CONTROL_IDS).join(', ')}, trovati: ${[...lockedIds].join(', ')}`
	);

	// Tutti i controlli locked devono avere origin 'control'
	for (const entry of lockedEntries) {
		assert.strictEqual(
			entry.origin,
			'control',
			`Il controllo locked "${entry.id}" deve avere origin 'control'`
		);
	}
});
