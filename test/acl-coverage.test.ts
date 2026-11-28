/**
 * L'esistenza di `src-tauri/permissions/` attiva l'ACL sui comandi nativi
 * dell'app: ogni comando registrato in `tauri::generate_handler!` che non
 * compaia in un permesso incluso nella capability viene rifiutato a runtime con
 * "command <nome> not allowed by ACL". Questo test difende esattamente quel
 * contratto, senza dipendere dai file generati dalla build.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPermissionSets, expandCapabilityPermissions } from './permissions-fixture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAURI = join(ROOT, 'src-tauri');

/**
 * Comandi registrati nella macro `generate_handler!` di src/lib.rs.
 *
 * Tauri prende il nome del comando dall'**ultimo segmento** del percorso
 * (`link::link_configure` -> `link_configure`): il namespace del modulo non
 * entra ne' nella ACL ne' nell'`invoke`. Scartare le voci con percorso invece
 * di ridurle all'ultimo segmento nascondeva proprio i comandi registrati in
 * questo modo, che restavano fuori da ogni permesso e venivano rifiutati a
 * runtime con "Command <nome> not allowed by ACL".
 */
function comandiRegistrati(): string[] {
	const lib = readFileSync(join(TAURI, 'src', 'lib.rs'), 'utf8');
	const inizio = lib.indexOf('generate_handler![');
	assert.notEqual(inizio, -1, 'macro generate_handler! non trovata in lib.rs');
	const blocco = lib.slice(inizio + 'generate_handler!['.length);
	const fine = blocco.indexOf(']');
	assert.notEqual(fine, -1, 'chiusura della macro generate_handler! non trovata');
	const voci = blocco
		.slice(0, fine)
		.split(',')
		.map((voce) => voce.trim())
		.filter(Boolean);
	for (const voce of voci) {
		assert.match(
			voce,
			/^[a-z_][a-z0-9_]*(::[a-z_][a-z0-9_]*)*$/,
			`voce non riconosciuta in generate_handler!: ${voce}`
		);
	}
	return voci.map((voce) => voce.split('::').pop() as string);
}

function comandiConsentiti(): Set<string> {
	return expandCapabilityPermissions(
		readPermissionSets(join(TAURI, 'permissions')),
		join(TAURI, 'capabilities', 'default.json')
	);
}

test('ACL dei comandi nativi', async (t) => {
	await t.test('ogni comando registrato e consentito dalla capability', () => {
		const registrati = comandiRegistrati();
		assert.ok(registrati.length > 0, 'nessun comando estratto da lib.rs');

		const consentiti = comandiConsentiti();
		const mancanti = registrati.filter((comando) => !consentiti.has(comando));
		assert.deepEqual(
			mancanti,
			[],
			`comandi senza permesso ACL (verrebbero rifiutati a runtime): ${mancanti.join(', ')}`
		);
	});

	await t.test('nessun permesso concesso a comandi inesistenti', () => {
		const registrati = new Set(comandiRegistrati());
		const orfani = [...comandiConsentiti()].filter((comando) => !registrati.has(comando));
		assert.deepEqual(
			orfani,
			[],
			`permessi per comandi non registrati in lib.rs: ${orfani.join(', ')}`
		);
	});
});
