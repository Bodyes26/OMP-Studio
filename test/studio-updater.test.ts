import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatVersion } from '../src/lib/utils/version.ts';
import { getNightlyVersion, normalizeBuildId } from '../scripts/nightly-version.mjs';

describe('Formattazione versioni Studio (formatVersion)', () => {
	it('formatta versioni stabili standard', () => {
		assert.equal(formatVersion('1.2.1'), '1.2.1');
		assert.equal(formatVersion('v1.2.1'), '1.2.1');
		assert.equal(formatVersion('1.2.1', { prefix: true }), 'v1.2.1');
	});

	it('abbrevia il build ID per nightly con timestamp lunghi', () => {
		// Timestamp in millisecondi a 13 cifre
		assert.equal(
			formatVersion('0.1.1-nightly.1787753960479'),
			'0.1.1-nightly.960479'
		);
		assert.equal(
			formatVersion('0.1.1-nightly.1787753960479', { prefix: true }),
			'v0.1.1-nightly.960479'
		);

		// Timestamp in secondi a 10 cifre
		assert.equal(
			formatVersion('0.1.1-nightly.1740838123'),
			'0.1.1-nightly.838123'
		);
	});

	it('preserva build ID brevi (<= 6 cifre)', () => {
		assert.equal(formatVersion('1.0.2-nightly.743'), '1.0.2-nightly.743');
		assert.equal(formatVersion('1.0.2-nightly.123456'), '1.0.2-nightly.123456');
	});

	it('supporta modalita compatta per chip e pulsanti compatti', () => {
		assert.equal(
			formatVersion('0.1.1-nightly.1787753960479', { compact: true }),
			'0.1.1-nightly'
		);
		assert.equal(
			formatVersion('0.1.1-nightly.1787753960479', { prefix: true, compact: true }),
			'v0.1.1-nightly'
		);
		assert.equal(
			formatVersion('1.2.1', { prefix: true, compact: true }),
			'v1.2.1'
		);
	});

	it('gestisce valori nulli, vuoti o non validi in modo sicuro', () => {
		assert.equal(formatVersion(null), '');
		assert.equal(formatVersion(undefined), '');
		assert.equal(formatVersion(''), '');
		assert.equal(formatVersion('   '), '');
	});
});

describe('Normalizzazione e monotonicita build-id (normalizeBuildId)', () => {
	it('normalizza date ISO e timestamp github.run_started_at in millisecondi', () => {
		const iso = '2026-09-01T12:00:00.000Z';
		const expectedMs = Date.parse(iso);
		assert.equal(normalizeBuildId(iso), expectedMs);
	});

	it('converte timestamp in secondi (10 cifre) in millisecondi per preservare la monotonicita', () => {
		const seconds = 1740838123;
		const normalized = normalizeBuildId(seconds);
		assert.equal(normalized, 1740838123000);
		// Verifica che sia numericamente superiore a qualsiasi vecchio ID a 10 cifre
		assert.ok(normalized > seconds);
	});

	it('preserva timestamp gia espressi in millisecondi (13 cifre)', () => {
		const ms = 1787753960479;
		assert.equal(normalizeBuildId(ms), ms);
	});

	it('preserva ID sequenziali brevi personalizzati', () => {
		assert.equal(normalizeBuildId(12345), 12345);
		assert.equal(normalizeBuildId('743'), 743);
	});

	it('genera timestamp corrente in millisecondi se non fornito', () => {
		const now = Date.now();
		const id = normalizeBuildId();
		assert.ok(typeof id === 'number');
		assert.ok(id >= now - 1000 && id <= now + 1000);
		assert.ok(String(id).length >= 13);
	});

	it('rifiuta valori non validi, nulli, zero o negativi', () => {
		assert.throws(() => normalizeBuildId('invalid-date'));
		assert.throws(() => normalizeBuildId('0'));
		assert.throws(() => normalizeBuildId('-100'));
		assert.throws(() => normalizeBuildId('12.34'));
	});
});

describe('Generazione versione nightly (getNightlyVersion)', () => {
	it('genera una versione SemVer valida con prerelease nightly', () => {
		const v = getNightlyVersion(12345);
		assert.match(v, /^\d+\.\d+\.\d+-nightly\.12345$/);
	});

	it('usa timestamp in millisecondi come fallback predefinito monotono', () => {
		const v = getNightlyVersion();
		const match = v.match(/^\d+\.\d+\.\d+-nightly\.(\d+)$/);
		assert.ok(match, 'deve corrispondere al pattern nightly');
		const id = match[1];
		assert.ok(id.length >= 13, `id deve essere in millisecondi (13 cifre): ${id}`);
	});

	it('rifiuta build-id non numerici o non positivi', () => {
		assert.throws(() => getNightlyVersion('invalid'));
		assert.throws(() => getNightlyVersion('0'));
		assert.throws(() => getNightlyVersion('-5'));
	});
});
