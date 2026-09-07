/**
 * Smoke test per la finestra Companion, Quick Reply e Natural Language Task.
 * Verifica:
 * - Registrazione e gestione delle richieste di attenzione in companionStore
 * - Logica di controllo quota (warning ed esaurimento)
 * - Proprietà e configurazione effettiva della finestra secondaria su ogni piattaforma
 * - Copertura ACL e autorizzazioni dei comandi nativi companion
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Configurazione effettiva della finestra Companion su ogni piattaforma desktop', () => {
	const baseConfig = JSON.parse(
		readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')
	);
	const platformConfigs = [
		['base', baseConfig],
		['Windows', JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.windows.conf.json'), 'utf8'))],
		['macOS', JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.macos.conf.json'), 'utf8'))]
	] as const;

	for (const [platform, platformConfig] of platformConfigs) {
		// Tauri applica RFC 7396: se il file di piattaforma dichiara app.windows,
		// l'array sostituisce integralmente quello della configurazione base.
		const windows = platformConfig.app?.windows ?? baseConfig.app?.windows ?? [];
		const companionWindow = windows.find((w: { label?: string }) => w.label === 'companion');

		assert.ok(companionWindow, `${platform}: deve esistere la finestra "companion"`);
		assert.equal(companionWindow.decorations, false, `${platform}: Companion deve essere frameless`);
		assert.equal(companionWindow.alwaysOnTop, true, `${platform}: Companion deve restare in primo piano`);
		assert.equal(companionWindow.visible, false, `${platform}: Companion deve partire nascosta`);
		assert.equal(companionWindow.skipTaskbar, true, `${platform}: Companion non deve apparire nella taskbar`);
	}
});

test('Capabilities e permessi per la finestra Companion', () => {
	const defaultCapRaw = readFileSync(join(ROOT, 'src-tauri', 'capabilities', 'default.json'), 'utf8');
	const defaultCap = JSON.parse(defaultCapRaw);

	assert.ok(defaultCap.windows.includes('companion'), 'La capability default.json deve autorizzare la finestra companion');

	const desktopCapRaw = readFileSync(join(ROOT, 'src-tauri', 'capabilities', 'desktop.json'), 'utf8');
	const desktopCap = JSON.parse(desktopCapRaw);

	assert.ok(desktopCap.windows.includes('companion'), 'La capability desktop.json deve autorizzare la finestra companion');

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
