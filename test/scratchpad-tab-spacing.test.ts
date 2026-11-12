import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

test('Spaziatura tessera Scratchpad e bozze libere (TopBar)', async (t) => {
	const topBarSource = readFileSync(join(ROOT, 'src', 'lib', 'components', 'TopBar.svelte'), 'utf-8');

	await t.test('.tab-dot + .tab-ghost possiede margin-left: var(--space-2)', () => {
		// La tessera dello scratchpad ha il punto di stato (tab-dot) e l'icona
		// del fantasmino (tab-ghost): deve esserci spaziatura per evitare che
		// lo spinner di caricamento o gli anelli di attenzione/finito collidano con l'icona.
		assert.match(
			topBarSource,
			/\.tab-dot\s*\+\s*\.tab-ghost\s*\{[^}]*margin-left:\s*var\(--space-2\);[^}]*\}/s,
			'TopBar.svelte deve impostare margin-left: var(--space-2) sul selettore .tab-dot + .tab-ghost'
		);
	});

	await t.test('.tab-ghost mantiene allineamento flessibile centrato', () => {
		assert.match(
			topBarSource,
			/\.tab-ghost\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*\}/s,
			'TopBar.svelte deve definire .tab-ghost come flexbox centrato'
		);
	});
});
