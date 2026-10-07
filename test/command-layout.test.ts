import test from 'node:test';
import assert from 'node:assert/strict';

import type { CommandManifestEntry, ComposerLayout } from '../src/lib/agent/commandCatalog/types.ts';
import {
	defaultLayout,
	isSupported,
	itemsInZone,
	mergeWithOrphans,
	movePin,
	pin,
	resolveLayout,
	suggestedPlacement,
	unpin
} from '../src/lib/agent/commandCatalog/layout.ts';

// Manifesto sintetico per verificare la logica pura in isolamento
const SYNTHETIC_MANIFEST: readonly CommandManifestEntry[] = [
	{
		id: 'ctl.attach',
		origin: 'control',
		category: 'context',
		icon: 'IconAttach',
		control: 'action',
		locked: true,
		supported: [{ zone: 'toolbar', form: 'icon' }],
		defaultPlacement: { zone: 'toolbar', form: 'icon' },
		text: {
			it: {
				title: 'Allegato',
				summary: 'Aggiunge un file',
				benefits: ['Rapido'],
				examples: [{ command: '@file', note: 'Allega file' }]
			},
			en: {
				title: 'Attachment',
				summary: 'Attaches a file',
				benefits: ['Fast'],
				examples: [{ command: '@file', note: 'Attach file' }]
			}
		}
	},
	{
		id: 'ctl.model',
		origin: 'control',
		category: 'models',
		icon: 'IconSparkles',
		control: 'picker',
		locked: true,
		supported: [
			{ zone: 'toolbar', form: 'icon' },
			{ zone: 'toolbar', form: 'chip' }
		],
		defaultPlacement: { zone: 'toolbar', form: 'icon' },
		text: {
			it: {
				title: 'Modello',
				summary: 'Sceglie il modello',
				benefits: ['Flessibile'],
				examples: [{ command: '/model', note: 'Mostra modello' }]
			},
			en: {
				title: 'Model',
				summary: 'Selects model',
				benefits: ['Flexible'],
				examples: [{ command: '/model', note: 'Show model' }]
			}
		}
	},
	{
		id: 'fast',
		origin: 'omp',
		category: 'modes',
		icon: 'IconFast',
		control: 'toggle',
		supported: [
			{ zone: 'statusLine', form: 'chip' },
			{ zone: 'statusLine', form: 'icon' }
		],
		defaultPlacement: { zone: 'statusLine', form: 'chip' },
		text: {
			it: {
				title: 'Fast mode',
				summary: 'Modalita veloce',
				benefits: ['Rapida'],
				examples: [{ command: '/fast', note: 'Toggle fast' }]
			},
			en: {
				title: 'Fast mode',
				summary: 'Fast mode',
				benefits: ['Fast'],
				examples: [{ command: '/fast', note: 'Toggle fast' }]
			}
		}
	},
	{
		id: 'compact',
		origin: 'omp',
		category: 'context',
		icon: 'IconCompact',
		control: 'action',
		supported: [
			{ zone: 'toolbar', form: 'icon' },
			{ zone: 'statusLine', form: 'chip' }
		],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Compatta',
				summary: 'Compatta il contesto',
				benefits: ['Risparmia token'],
				examples: [{ command: '/compact', note: 'Compatta ora' }]
			},
			en: {
				title: 'Compact',
				summary: 'Compacts context',
				benefits: ['Saves tokens'],
				examples: [{ command: '/compact', note: 'Compact now' }]
			}
		}
	},
	{
		id: 'catalog_only',
		origin: 'studio',
		category: 'tools',
		icon: 'IconTools',
		control: 'none',
		supported: [],
		defaultPlacement: null,
		text: {
			it: {
				title: 'Solo catalogo',
				summary: 'Non pinnabile',
				benefits: ['Informativo'],
				examples: [{ command: '/catalog', note: 'Info' }]
			},
			en: {
				title: 'Catalog only',
				summary: 'Not pinnable',
				benefits: ['Informational'],
				examples: [{ command: '/catalog', note: 'Info' }]
			}
		}
	}
];

test('Command Layout — defaultLayout', () => {
	const layout = defaultLayout(SYNTHETIC_MANIFEST);
	assert.strictEqual(layout.version, 1);
	// Solo ctl.attach, ctl.model e fast hanno defaultPlacement
	assert.strictEqual(layout.pinned.length, 3);

	const toolbar = itemsInZone(layout, 'toolbar');
	assert.strictEqual(toolbar.length, 2);
	assert.deepEqual(
		toolbar.map((p) => p.id),
		['ctl.attach', 'ctl.model']
	);
	assert.strictEqual(toolbar[0].order, 0);
	assert.strictEqual(toolbar[1].order, 1);

	const statusLine = itemsInZone(layout, 'statusLine');
	assert.strictEqual(statusLine.length, 1);
	assert.strictEqual(statusLine[0].id, 'fast');
	assert.strictEqual(statusLine[0].order, 0);
	assert.strictEqual(statusLine[0].form, 'chip');
});

test('Command Layout — resolveLayout scarta id sconosciuti e posizioni non supportate', () => {
	const saved: ComposerLayout = {
		version: 1,
		pinned: [
			{ id: 'ctl.attach', zone: 'toolbar', form: 'icon', order: 0 },
			{ id: 'comando_inesistente_xyz', zone: 'toolbar', form: 'icon', order: 1 },
			// fast supporta solo statusLine, non toolbar: deve essere scartato da resolveLayout
			{ id: 'fast', zone: 'toolbar', form: 'icon', order: 2 },
			{ id: 'compact', zone: 'statusLine', form: 'chip', order: 0 }
		]
	};

	// Il salvato originale non deve essere mutato
	const savedClone = JSON.parse(JSON.stringify(saved));
	const resolved = resolveLayout(saved, SYNTHETIC_MANIFEST);
	assert.deepEqual(saved, savedClone, 'Il layout salvato in input non deve essere mutato');

	// ctl.model e' locked ma mancava nel saved: resolveLayout deve reinserirlo
	const resolvedIds = resolved.pinned.map((p) => p.id);
	assert.ok(resolvedIds.includes('ctl.attach'));
	assert.ok(resolvedIds.includes('ctl.model'), 'I controlli locked mancanti devono essere ripristinati');
	assert.ok(resolvedIds.includes('compact'));
	assert.ok(!resolvedIds.includes('comando_inesistente_xyz'), 'Id sconosciuti devono essere esclusi da resolveLayout');
	assert.ok(!resolvedIds.includes('fast'), 'Posizioni non supportate devono essere scartate');

	// I controlli locked rimangono presenti e ordinati
	const toolbar = itemsInZone(resolved, 'toolbar');
	assert.strictEqual(toolbar.find((p) => p.id === 'ctl.attach')?.order, 0);
	assert.strictEqual(toolbar.find((p) => p.id === 'ctl.model')?.order, 1);
});

test('Command Layout — pin e unpin', () => {
	const def = defaultLayout(SYNTHETIC_MANIFEST);

	// Pin di un comando supportato
	const pinned = pin(def, SYNTHETIC_MANIFEST, 'compact', { zone: 'toolbar', form: 'icon' });
	const toolbar = itemsInZone(pinned, 'toolbar');
	assert.strictEqual(toolbar.length, 3);
	assert.strictEqual(toolbar[2].id, 'compact');
	assert.strictEqual(toolbar[2].order, 2);

	// Pin verso posizione NON supportata (ctl.attach supporta solo toolbar icon)
	const invalidPin = pin(pinned, SYNTHETIC_MANIFEST, 'ctl.attach', { zone: 'statusLine', form: 'chip' });
	assert.deepEqual(invalidPin, pinned, 'Pin verso posizione non supportata non deve alterare il layout');

	// Unpin di comando opzionale
	const unpinned = unpin(pinned, SYNTHETIC_MANIFEST, 'compact');
	const toolbarAfter = itemsInZone(unpinned, 'toolbar');
	assert.strictEqual(toolbarAfter.length, 2);
	assert.ok(!toolbarAfter.some((p) => p.id === 'compact'));

	// Unpin di controllo locked: non deve essere rimosso
	const lockedAttempt = unpin(unpinned, SYNTHETIC_MANIFEST, 'ctl.attach');
	assert.deepEqual(lockedAttempt, unpinned, 'Unpin di un controllo locked non deve avere effetto');
});

test('Command Layout — movePin e renumber', () => {
	const def = defaultLayout(SYNTHETIC_MANIFEST);
	// toolbar ha: ctl.attach (0), ctl.model (1)
	// statusLine ha: fast (0)

	// Spostamento dentro la stessa zona: inverti l'ordine
	const reordered = movePin(
		def,
		SYNTHETIC_MANIFEST,
		'ctl.model',
		{ zone: 'toolbar', form: 'icon' },
		0
	);
	const tb = itemsInZone(reordered, 'toolbar');
	assert.strictEqual(tb[0].id, 'ctl.model');
	assert.strictEqual(tb[0].order, 0);
	assert.strictEqual(tb[1].id, 'ctl.attach');
	assert.strictEqual(tb[1].order, 1);

	// Spostamento tra zone con cambio forma se supportato (compact supporta toolbar icon e statusLine chip)
	const withCompact = pin(def, SYNTHETIC_MANIFEST, 'compact', { zone: 'toolbar', form: 'icon' });
	const movedZone = movePin(
		withCompact,
		SYNTHETIC_MANIFEST,
		'compact',
		{ zone: 'statusLine', form: 'chip' },
		0
	);
	const sl = itemsInZone(movedZone, 'statusLine');
	assert.strictEqual(sl.length, 2);
	assert.strictEqual(sl[0].id, 'compact');
	assert.strictEqual(sl[0].order, 0);
	assert.strictEqual(sl[1].id, 'fast');
	assert.strictEqual(sl[1].order, 1);

	// movePin verso posizione non supportata = layout invariato
	const invalidMove = movePin(
		withCompact,
		SYNTHETIC_MANIFEST,
		'ctl.attach',
		{ zone: 'statusLine', form: 'chip' },
		0
	);
	assert.deepEqual(invalidMove, withCompact, 'Move verso posizione non supportata lascia il layout invariato');
});

test('Command Layout — mergeWithOrphans conserva i pin orfani salvati', () => {
	const saved: ComposerLayout = {
		version: 1,
		pinned: [
			{ id: 'ctl.attach', zone: 'toolbar', form: 'icon', order: 0 },
			{ id: 'vecchio_comando_disattivato', zone: 'statusLine', form: 'chip', order: 0 }
		]
	};

	const edited: ComposerLayout = {
		version: 1,
		pinned: [
			{ id: 'ctl.attach', zone: 'toolbar', form: 'icon', order: 0 },
			{ id: 'ctl.model', zone: 'toolbar', form: 'icon', order: 1 }
		]
	};

	const merged = mergeWithOrphans(edited, saved, SYNTHETIC_MANIFEST);
	const ids = merged.pinned.map((p) => p.id);
	assert.ok(ids.includes('ctl.attach'));
	assert.ok(ids.includes('ctl.model'));
	assert.ok(
		ids.includes('vecchio_comando_disattivato'),
		'Il pin orfano del layout salvato deve essere conservato'
	);
	assert.strictEqual(merged.pinned.find((p) => p.id === 'vecchio_comando_disattivato')?.zone, 'statusLine');
});
