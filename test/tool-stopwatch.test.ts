import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed } from '../src/lib/agent/tools/types.ts';

// Contratto dell'etichetta del cronometro (ToolCard, ToolGroup, indicatore di
// attivita): larghezza stabile, tempo troncato, nessun valore illeggibile.
describe('Etichetta del cronometro (formatElapsed)', () => {
	it('mostra i decimi sotto il minuto troncando, non arrotondando', () => {
		assert.equal(formatElapsed(100), '0.1s');
		assert.equal(formatElapsed(1449), '1.4s');
		assert.equal(formatElapsed(1490), '1.4s');
		assert.equal(formatElapsed(12_800), '12.8s');
		assert.equal(formatElapsed(59_999), '59.9s');
	});

	it('non si congela su 0.0s per le chiamate istantanee', () => {
		assert.equal(formatElapsed(1), '0.1s');
		assert.equal(formatElapsed(99), '0.1s');
		assert.equal(formatElapsed(0), '0.0s');
		assert.equal(formatElapsed(-5), '0.0s');
		assert.equal(formatElapsed(Number.NaN), '0.0s');
	});

	it('passa a minuti e secondi con zero di riempimento oltre i 60s', () => {
		assert.equal(formatElapsed(60_000), '1m 00s');
		assert.equal(formatElapsed(64_500), '1m 04s');
		assert.equal(formatElapsed(74_000), '1m 14s');
		assert.equal(formatElapsed(119_999), '1m 59s');
		assert.equal(formatElapsed(3_600_000), '60m 00s');
	});

	it('mantiene la larghezza entro 6 caratteri nell intervallo comune', () => {
		for (const ms of [0, 1, 950, 9_999, 45_600, 59_999, 60_000, 599_000]) {
			assert.ok(
				formatElapsed(ms).length <= 6,
				`formatElapsed(${ms}) = ${formatElapsed(ms)} supera i 6 caratteri`
			);
		}
	});
});
