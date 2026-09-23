import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { synthesizeProvisionalLaneTitle } from '../src/lib/lanes/laneTitle.ts';

describe('W07 — Titolo provvisorio della corsia', () => {
	it('sintetizza il titolo dal primo prompt solo per i titoli predefiniti Worktree N', () => {
		// Titolo predefinito aggiornato con la prima riga
		const prompt1 = 'Correggi bug nel calcolo IVA\nAltro testo successivo...';
		assert.equal(synthesizeProvisionalLaneTitle('Worktree 1', prompt1), 'Correggi bug nel calcolo IVA');

		// Troncatura a 36 caratteri con ellissi se troppo lungo
		const longPrompt = 'Implementa un nuovo sistema di autenticazione basato su chiavi asimmetriche e certificati X509';
		const synthesized = synthesizeProvisionalLaneTitle('Worktree 2', longPrompt);
		assert.ok(synthesized !== null);
		assert.ok(synthesized.length <= 36);
		assert.ok(synthesized.endsWith('…'));

		// Titolo già personalizzato non viene sovrascritto
		assert.equal(synthesizeProvisionalLaneTitle('Refactoring Auth', prompt1), null);
	});
});
