import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TurnSpeed, formatTokensPerSecond, generationMs } from '../src/lib/agent/turnStats.ts';

describe('token al secondo del turno', () => {
	it('il tempo di generazione esclude l attesa del primo token', () => {
		assert.equal(generationMs({ duration: 5000, ttft: 1000 }), 4000);
		assert.equal(generationMs({ duration: 5000 }), 5000);
		assert.equal(generationMs({ duration: 5000, ttft: 9000 }), 5000);
		assert.equal(generationMs({}), undefined);
		assert.equal(generationMs({ duration: 0 }), undefined);
	});

	it('somma token e tempi sul turno invece di mediare i rapporti', () => {
		const speed = new TurnSpeed();
		speed.add(100, 1000); // 100 t/s
		speed.add(300, 6000); // 50 t/s
		assert.equal(speed.tokensPerSecond, 400 / 7);
	});

	it('i messaggi senza durata o senza token non contano e senza campioni non c e valore', () => {
		const speed = new TurnSpeed();
		assert.equal(speed.tokensPerSecond, undefined);
		speed.add(500, undefined);
		speed.add(undefined, 2000);
		speed.add(0, 2000);
		assert.equal(speed.tokensPerSecond, undefined);
	});

	it('formatta con un decimale sotto 100 e intero sopra', () => {
		assert.equal(formatTokensPerSecond(57.14), '57.1');
		assert.equal(formatTokensPerSecond(123.6), '124');
	});
});
