/**
 * Smoke test per la finestra Companion, Quick Reply e Natural Language Task.
 * Verifica:
 * - Proprietà e configurazione effettiva della finestra secondaria su ogni piattaforma
 * - Coerenza degli argomenti WebView2 fra le finestre della stessa applicazione
 * - Copertura ACL e autorizzazioni dei comandi nativi companion
 * - Struttura dati del contratto QuickTaskAiParsed
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	parseQuickTaskLocal,
	mentionStateAt,
	applyMention
} from '../src/lib/companion/quickTaskLocal.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type WindowConfig = {
	label?: string;
	decorations?: boolean;
	alwaysOnTop?: boolean;
	visible?: boolean;
	skipTaskbar?: boolean;
	additionalBrowserArgs?: string;
};

const baseConfig = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));

const platformConfigs = [
	['base', baseConfig],
	['Windows', JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.windows.conf.json'), 'utf8'))],
	['macOS', JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.macos.conf.json'), 'utf8'))]
] as const;

/**
 * Tauri applica RFC 7396: se il file di piattaforma dichiara `app.windows`,
 * l'array sostituisce integralmente quello della configurazione base.
 */
function windowsOf(platformConfig: { app?: { windows?: WindowConfig[] } }): WindowConfig[] {
	return platformConfig.app?.windows ?? baseConfig.app?.windows ?? [];
}

test('Configurazione effettiva della finestra Companion su ogni piattaforma desktop', () => {
	for (const [platform, platformConfig] of platformConfigs) {
		const companionWindow = windowsOf(platformConfig).find((w) => w.label === 'companion');

		assert.ok(companionWindow, `${platform}: deve esistere la finestra "companion"`);
		assert.equal(companionWindow.decorations, false, `${platform}: Companion deve essere frameless`);
		assert.equal(companionWindow.alwaysOnTop, true, `${platform}: Companion deve restare in primo piano`);
		assert.equal(companionWindow.visible, false, `${platform}: Companion deve partire nascosta`);
		assert.equal(companionWindow.skipTaskbar, true, `${platform}: Companion non deve apparire nella taskbar`);
	}
});

test('Argomenti WebView2 identici per tutte le finestre della stessa piattaforma', () => {
	// WebView2 ammette un solo ambiente per cartella dati utente: se una seconda
	// finestra chiede argomenti diversi, la creazione della webview fallisce con
	// ERROR_INVALID_STATE (0x8007139F) e la finestra resta senza webview nativa.
	// Con `additionalBrowserArgs` assente wry aggiunge i propri default, quindi
	// dichiararlo su una sola finestra e' sufficiente a rompere le altre.
	for (const [platform, platformConfig] of platformConfigs) {
		const declared = windowsOf(platformConfig).map((w) => w.additionalBrowserArgs);
		const distinct = new Set(declared.map((args) => args ?? '<default wry>'));

		assert.equal(
			distinct.size,
			1,
			`${platform}: additionalBrowserArgs deve essere identico per tutte le finestre, trovati ${[...distinct].join(' | ')}`
		);
	}
});

test('Capabilities e permessi per la finestra Companion', () => {
	const defaultCap = JSON.parse(
		readFileSync(join(ROOT, 'src-tauri', 'capabilities', 'default.json'), 'utf8')
	);
	assert.ok(
		defaultCap.windows.includes('companion'),
		'La capability default.json deve autorizzare la finestra companion'
	);

	const desktopCap = JSON.parse(
		readFileSync(join(ROOT, 'src-tauri', 'capabilities', 'desktop.json'), 'utf8')
	);
	assert.ok(
		desktopCap.windows.includes('companion'),
		'La capability desktop.json deve autorizzare la finestra companion'
	);

	const toml = readFileSync(join(ROOT, 'src-tauri', 'permissions', 'app-commands.toml'), 'utf8');
	assert.ok(toml.includes('identifier = "allow-companion"'), 'Il permesso allow-companion deve essere definito in app-commands.toml');
	assert.ok(toml.includes('"toggle_companion_window"'), 'toggle_companion_window deve essere presente nei comandi consentiti');
	assert.ok(toml.includes('"hide_companion_window"'), 'hide_companion_window deve essere presente nei comandi consentiti');
	assert.ok(toml.includes('"parse_quick_task_ai"'), 'parse_quick_task_ai deve essere presente nei comandi consentiti');
	assert.ok(toml.includes('"get_companion_state"'), 'get_companion_state deve essere presente nei comandi consentiti');
	assert.ok(toml.includes('"set_companion_pinned"'), 'set_companion_pinned deve essere presente nei comandi consentiti');
});

test('Struttura dati e contratto QuickTaskAiParsed', () => {
	const sampleParsed = {
		projectPath: 'c:/source/repos/contrattiimmobili',
		projectName: 'ContrattiImmobili',
		taskPrompt: 'cambiare colore pulsante nuovo contratto per metterlo soft',
		role: 'smol',
		modelSelector: null,
		directiveIds: ['ponytail'],
		ambiguities: []
	};

	assert.equal(sampleParsed.projectName, 'ContrattiImmobili');
	assert.equal(sampleParsed.role, 'smol');
	assert.deepEqual(sampleParsed.directiveIds, ['ponytail']);
	assert.equal(sampleParsed.ambiguities.length, 0);
});

/**
 * Parser locale del Quick Task: gira interamente nel frontend mentre l'utente
 * digita, senza avviare alcun processo `omp`. Questi test difendono il contratto
 * osservabile (che progetto viene scelto, cosa resta nel prompt, quando serve l'AI).
 */
const PARSE_PROJECTS = [
	{ id: 'p1', name: 'Cruscotto PSR', label: 'Cruscotto PSR', path: 'c:/repos/cruscotto-psr' },
	{ id: 'p2', name: 'GestioneFlotta', label: 'Flotta', path: 'c:/repos/gestioneflotta' },
	{ id: 'p3', name: 'AmbraUno', label: 'AmbraUno', path: 'c:/repos/ambrauno' },
	{ id: 'p4', name: 'AmbraDue', label: 'AmbraDue', path: 'c:/repos/ambradue' }
];

const PARSE_DIRECTIVES = [
	{ id: 'd-piano', name: 'Modalità Piano', tag: 'piano' },
	{ id: 'd-ricerca', name: 'Ricerca Online', tag: 'ricerca' },
	{ id: 'd-old', name: 'Direttiva Ritirata', tag: 'ritirata', hidden: true }
];

const PARSE_INPUT = { projects: PARSE_PROJECTS, directives: PARSE_DIRECTIVES, roles: ['smol', 'default', 'slow', 'plan'] };

test('Parser locale: @progetto risolve il progetto e ripulisce il prompt', () => {
	const res = parseQuickTaskLocal('@cruscotto sistema il bottone', PARSE_INPUT);

	assert.equal(res.projectId, 'p1');
	assert.equal(res.projectPath, 'c:/repos/cruscotto-psr');
	assert.equal(res.taskPrompt, 'sistema il bottone');
	assert.equal(res.needsAi, false, 'con il progetto risolto non serve interpellare il modello');
});

test('Parser locale: testo senza progetto riconoscibile richiede l’AI', () => {
	const res = parseQuickTaskLocal('sistemare il colore del pulsante', PARSE_INPUT);

	assert.equal(res.projectPath, null);
	assert.equal(res.needsAi, true);
	assert.equal(res.taskPrompt, 'sistemare il colore del pulsante', 'il prompt resta integro');
});

test('Parser locale: menzione ambigua non sceglie a caso', () => {
	const res = parseQuickTaskLocal('@ambra aggiorna le dipendenze', PARSE_INPUT);

	assert.equal(res.projectId, null, 'due progetti iniziano per "ambra": nessuna scelta arbitraria');
	assert.equal(res.needsAi, true);
});

test('Parser locale: ruolo riconosciuto rimosso, ruolo inventato lasciato nel prompt', () => {
	const valido = parseQuickTaskLocal('@flotta !smol aggiorna il changelog', PARSE_INPUT);
	assert.equal(valido.role, 'smol');
	assert.equal(valido.taskPrompt, 'aggiorna il changelog');

	const inventato = parseQuickTaskLocal('@flotta !turbo aggiorna il changelog', PARSE_INPUT);
	assert.equal(inventato.role, null);
	assert.ok(
		inventato.taskPrompt.includes('!turbo'),
		'un token non riconosciuto non viene inghiottito silenziosamente'
	);
});

test('Parser locale: direttive multiple in ordine, quelle nascoste mai selezionate', () => {
	const res = parseQuickTaskLocal('@flotta /piano /ricerca rivedi la home', PARSE_INPUT);
	assert.deepEqual(res.directiveIds, ['d-piano', 'd-ricerca']);
	assert.equal(res.taskPrompt, 'rivedi la home');

	const nascosta = parseQuickTaskLocal('@flotta /ritirata rivedi la home', PARSE_INPUT);
	assert.deepEqual(nascosta.directiveIds, [], 'una direttiva nascosta non è selezionabile');
});

test('Parser locale: suggeritore di menzioni durante la digitazione', () => {
	const text = 'sistema @cru';
	const state = mentionStateAt(text, text.length);

	assert.equal(state.kind, 'project');
	assert.equal(state.query, 'cru');

	const applied = applyMention(text, state, 'Cruscotto PSR');
	assert.equal(applied.text, 'sistema @Cruscotto PSR ');
	assert.equal(applied.caret, applied.text.length, 'il cursore resta dopo lo spazio finale');

	const nessuna = mentionStateAt('nessun token qui', 16);
	assert.equal(nessuna.kind, null);
});
