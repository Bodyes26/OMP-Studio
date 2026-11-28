import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVEAL_EASE_CURVE, revealEase } from '../src/lib/agent/motion.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * La curva delle transizioni JS (`revealEase`, Svelte non legge il foglio di
 * stile) e quella CSS (`--ease-reveal`) devono essere la stessa: se cambia una
 * sola delle due, ingresso CSS e ingresso JS dello stesso elemento finiscono su
 * ritmi diversi e il difetto si vede solo a schermo, non nei test (S6-09).
 */
describe('curva di rivelazione: token CSS e copia JS (S6-09)', () => {
	const css = readFileSync(join(ROOT, 'src', 'app.css'), 'utf8');

	it('il token --ease-reveal e la costante JS sono identici', () => {
		const match = /--ease-reveal:\s*cubic-bezier\(([^)]+)\)/.exec(css);
		assert.ok(match, 'token --ease-reveal non trovato in app.css');
		const fromCss = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
		assert.deepEqual([...REVEAL_EASE_CURVE], fromCss);
	});

	it('la curva parte da 0, arriva a 1 e resta monotona', () => {
		assert.equal(revealEase(0), 0);
		assert.equal(revealEase(1), 1);
		let previous = -1;
		for (let i = 0; i <= 100; i++) {
			const value = revealEase(i / 100);
			assert.ok(value >= previous - 1e-9, `non monotona a ${i / 100}`);
			assert.ok(value >= -1e-9 && value <= 1 + 1e-9, `fuori da [0,1] a ${i / 100}`);
			previous = value;
		}
	});

	it('e una easing d\'ingresso: accelera prima e rallenta in coda', () => {
		// La curva del token e' "ease-out": a meta' tempo il progresso e' oltre
		// meta'. Se qualcuno la scambiasse con ease-in questo lo direbbe.
		assert.ok(revealEase(0.5) > 0.6);
	});
});
