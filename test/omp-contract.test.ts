/**
 * Contratto verso omp da cui dipende Studio: dove una divergenza romperebbe
 * qualcosa in silenzio, il test la deve vedere. Sono contratti veri (non
 * aderenza al testo del sorgente):
 *
 * 1. i messaggi di stderr di «sessione assente» devono restare riconosciuti dal
 *    parser che decide se un `--resume` e' recuperabile — si prova il parser;
 * 2. `setupVersion` della fixture deve coincidere con la costante Rust che
 *    decide se il wizard va riaperto — due linguaggi, quindi si legge la
 *    costante per nome e non la forma della riga;
 * 3. i nomi degli asset di release devono coincidere con la mappa Rust che
 *    compone l'URL di download — si confrontano le coppie (os, arch) -> asset.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isMissingSessionError } from '../src/lib/agent/resumeErrors.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(ROOT, 'test', 'fixtures', 'omp-contract.json');
const SETUP_RS = join(ROOT, 'src-tauri', 'src', 'setup.rs');

interface OmpContractFixture {
	descrizione: string;
	ompVersioniVerificate: { minima: string; corrente: string };
	setupVersion: number;
	assetDiRelease: Record<string, string>;
	fileChecksumRelease: string;
	chiaviConfigLette: string[];
	stderrSessioneAssente: string[];
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as OmpContractFixture;
const setupSource = readFileSync(SETUP_RS, 'utf8');

/** Corpo della funzione `release_asset_name_for`, senza fidarsi della forma delle righe. */
function releaseAssetArms(): Map<string, string> {
	const start = setupSource.indexOf('fn release_asset_name_for');
	assert.notEqual(start, -1, 'setup.rs: release_asset_name_for non trovata');
	// Il corpo finisce alla prima graffa di chiusura a colonna zero che segue
	// l'apertura: le braccia del match sono indentate.
	const open = setupSource.indexOf('{', start);
	const close = setupSource.indexOf('\n}', open);
	assert.ok(open !== -1 && close !== -1, 'setup.rs: corpo di release_asset_name_for non delimitato');
	const body = setupSource.slice(open, close);

	const arms = new Map<string, string>();
	// Ogni braccio: ("os", "arch") => Some("asset")
	for (const match of body.matchAll(/"(\w+)"\s*,\s*"(\w+)"\s*\)\s*=>\s*Some\(\s*"([^"]+)"/g)) {
		arms.set(`${match[1]}-${match[2]}`, match[3]);
	}
	return arms;
}

describe('Compatibilita del contratto con omp', () => {
	it('tutti i pattern di errore stderr di sessione assente restano riconosciuti dal parser', () => {
		const testId = 'test-session-uuid-1234';
		for (const template of fixture.stderrSessioneAssente) {
			const line = template.replace('{id}', testId);
			assert.equal(
				isMissingSessionError([line], testId),
				true,
				`il parser non riconosce piu' la variante di stderr: "${line}"`
			);
		}
	});

	it('la fixture dichiara lo stesso setupVersion della costante Rust', () => {
		const match = /const\s+CURRENT_SETUP_VERSION:\s*u64\s*=\s*(\d+)\s*;/.exec(setupSource);
		assert.ok(match, 'setup.rs: costante CURRENT_SETUP_VERSION non trovata');
		assert.equal(
			Number(match[1]),
			fixture.setupVersion,
			`setupVersion disallineato: Rust ha ${match[1]}, la fixture dichiara ${fixture.setupVersion}`
		);
	});

	it('gli asset di release della fixture coincidono con la mappa Rust, per ogni piattaforma', () => {
		const arms = releaseAssetArms();
		assert.ok(arms.size > 0, 'setup.rs: nessun asset estratto da release_asset_name_for');

		for (const [target, asset] of Object.entries(fixture.assetDiRelease)) {
			assert.equal(
				arms.get(target),
				asset,
				`asset disallineato per ${target}: Rust dice ${arms.get(target) ?? '(nessuno)'}, la fixture ${asset}`
			);
		}
		for (const target of arms.keys()) {
			assert.ok(
				target in fixture.assetDiRelease,
				`Rust pubblica l'asset per ${target}, che la fixture non elenca`
			);
		}
	});

	it('la verifica del download usa il file di checksum dichiarato', () => {
		// Il nome del file di checksum e' l'unico aggancio fra lo script di
		// rilascio e l'aggiornamento dentro Studio: cercarlo nel sorgente e' il
		// controllo piu' diretto disponibile senza compilare Rust.
		assert.ok(
			setupSource.includes(`"${fixture.fileChecksumRelease}"`),
			`setup.rs non cerca il file di checksum ${fixture.fileChecksumRelease}`
		);
	});
});
