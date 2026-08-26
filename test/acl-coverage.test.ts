/**
 * L'esistenza di `src-tauri/permissions/` attiva l'ACL sui comandi nativi
 * dell'app: ogni comando registrato in `tauri::generate_handler!` che non
 * compaia in un permesso incluso nella capability viene rifiutato a runtime con
 * "command <nome> not allowed by ACL". Questo test difende esattamente quel
 * contratto, senza dipendere dai file generati dalla build.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAURI = join(ROOT, 'src-tauri');
const PERMISSIONS_DIR = join(TAURI, 'permissions');

/** Comandi registrati nella macro `generate_handler!` di src/lib.rs. */
function comandiRegistrati(): string[] {
	const lib = readFileSync(join(TAURI, 'src', 'lib.rs'), 'utf8');
	const inizio = lib.indexOf('generate_handler![');
	assert.notEqual(inizio, -1, 'macro generate_handler! non trovata in lib.rs');
	const blocco = lib.slice(inizio + 'generate_handler!['.length);
	const fine = blocco.indexOf(']');
	assert.notEqual(fine, -1, 'chiusura della macro generate_handler! non trovata');
	return blocco
		.slice(0, fine)
		.split(',')
		.map((voce) => voce.trim())
		.filter((voce) => /^[a-z_][a-z0-9_]*$/.test(voce));
}

interface Permessi {
	/** identificatore del permesso -> comandi consentiti */
	comandiPerPermesso: Map<string, string[]>;
	/** identificatore del set -> permessi inclusi */
	permessiPerSet: Map<string, string[]>;
}

/** Legge i file TOML dei permessi senza dipendere da un parser esterno. */
function leggiPermessi(): Permessi {
	const comandiPerPermesso = new Map<string, string[]>();
	const permessiPerSet = new Map<string, string[]>();

	for (const file of readdirSync(PERMISSIONS_DIR).filter((f) => f.endsWith('.toml'))) {
		const testo = readFileSync(join(PERMISSIONS_DIR, file), 'utf8');
		// Ogni blocco inizia con [[permission]] o [[set]] e termina al blocco successivo.
		const blocchi = testo.split(/^\[\[(permission|set)\]\]$/m);
		for (let i = 1; i < blocchi.length; i += 2) {
			const tipo = blocchi[i];
			const corpo = blocchi[i + 1] ?? '';
			const identifier = corpo.match(/^identifier\s*=\s*"([^"]+)"/m)?.[1];
			assert.ok(identifier, `blocco [[${tipo}]] senza identifier in ${file}`);
			const lista = corpo.match(
				tipo === 'permission'
					? /commands\.allow\s*=\s*\[([\s\S]*?)\]/
					: /permissions\s*=\s*\[([\s\S]*?)\]/
			);
			const voci = (lista?.[1] ?? '')
				.split(',')
				.map((v) => v.trim().replace(/^"|"$/g, ''))
				.filter(Boolean);
			if (tipo === 'permission') {
				comandiPerPermesso.set(identifier, voci);
			} else {
				permessiPerSet.set(identifier, voci);
			}
		}
	}

	return { comandiPerPermesso, permessiPerSet };
}

/** Espande i riferimenti della capability in comandi effettivamente consentiti. */
function comandiConsentiti(): Set<string> {
	const { comandiPerPermesso, permessiPerSet } = leggiPermessi();
	const capability = JSON.parse(
		readFileSync(join(TAURI, 'capabilities', 'default.json'), 'utf8')
	) as { permissions: string[] };

	const consentiti = new Set<string>();
	const daEspandere = capability.permissions.filter((p) => !p.includes(':'));

	while (daEspandere.length > 0) {
		const riferimento = daEspandere.pop() as string;
		const comandi = comandiPerPermesso.get(riferimento);
		if (comandi) {
			for (const comando of comandi) consentiti.add(comando);
			continue;
		}
		const set = permessiPerSet.get(riferimento);
		assert.ok(set, `la capability referenzia '${riferimento}', che non esiste nei permessi`);
		daEspandere.push(...set);
	}

	return consentiti;
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
