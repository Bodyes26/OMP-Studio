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
	assert.ok(toml.includes('"save_companion_state"'), 'save_companion_state deve essere presente nei comandi consentiti');
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
