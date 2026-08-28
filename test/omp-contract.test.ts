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
	ompVersioniVerificate: {
		minima: string;
		corrente: string;
	};
	setupVersion: number;
	assetDiRelease: Record<string, string>;
	fileChecksumRelease: string;
	chiaviConfigLette: string[];
	stderrSessioneAssente: string[];
}

describe('Compatibilita automatica del contratto con omp', () => {
	const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as OmpContractFixture;
	const setupSource = readFileSync(SETUP_RS, 'utf8');

	it('la fixture dichiara il setupVersion allineato alla costante Rust CURRENT_SETUP_VERSION', () => {
		const match = setupSource.match(/const\s+CURRENT_SETUP_VERSION:\s*u64\s*=\s*(\d+);/);
		assert.ok(match, 'costante CURRENT_SETUP_VERSION non trovata in setup.rs');
		const rustSetupVersion = parseInt(match[1], 10);
		assert.equal(
			rustSetupVersion,
			fixture.setupVersion,
			`Disallineamento setupVersion: Rust ha ${rustSetupVersion}, fixture dichiara ${fixture.setupVersion}`
		);
	});

	it('i nomi degli asset di release per piattaforma coincidono con la mappa Rust', () => {
		for (const [targetKey, assetName] of Object.entries(fixture.assetDiRelease)) {
			const [os, arch] = targetKey.split('-');
			// Verifica che la funzione release_asset_name_for in setup.rs censisca questo asset
			const pattern = new RegExp(`\\("${os}",\\s*"${arch}"\\)\\s*=>\\s*Some\\("${assetName}"\\)`);
			assert.ok(
				pattern.test(setupSource),
				`Asset ${assetName} per ${targetKey} non censito esattamente in setup.rs`
			);
		}
	});

	it('il file checksum atteso e SHA256SUMS.txt', () => {
		assert.equal(fixture.fileChecksumRelease, 'SHA256SUMS.txt');
		assert.ok(
			setupSource.includes('"SHA256SUMS.txt"'),
			'setup.rs deve cercare specificamente SHA256SUMS.txt'
		);
	});

	it('tutti i pattern di errore stderr sessione assente vengono riconosciuti dal parser', () => {
		const testId = 'test-session-uuid-1234';
		for (const template of fixture.stderrSessioneAssente) {
			const line = template.replace('{id}', testId);
			assert.equal(
				isMissingSessionError([line], testId),
				true,
				`Il parser non riconosce la variante di stderr: "${line}"`
			);
		}
	});
});
