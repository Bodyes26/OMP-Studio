import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isPlaceholderLaneTitle, LANE_TITLE_MAX } from '../src/lib/lanes/laneTitle.ts';

describe('W07 — Riconoscimento titoli segnaposto e limiti corsia', () => {
	it('riconosce i titoli segnaposto Git predefiniti Worktree N', () => {
		assert.equal(isPlaceholderLaneTitle('Worktree 1', 'git'), true);
		assert.equal(isPlaceholderLaneTitle('worktree 42', 'git'), true);
		assert.equal(isPlaceholderLaneTitle('Worktree   3', 'git'), true);
		assert.equal(isPlaceholderLaneTitle('Refactoring Auth', 'git'), false);
		assert.equal(isPlaceholderLaneTitle('Nuovo prototipo', 'git'), false);
	});

	it('riconosce i titoli segnaposto Lab predefiniti Nuovo prototipo', () => {
		assert.equal(isPlaceholderLaneTitle('Nuovo prototipo', 'lab'), true);
		assert.equal(isPlaceholderLaneTitle('nuovo prototipo', 'lab'), true);
		assert.equal(isPlaceholderLaneTitle('  NUOVO PROTOTIPO  ', 'lab'), true);
		assert.equal(isPlaceholderLaneTitle('ChatAI Reveal', 'lab'), false);
		assert.equal(isPlaceholderLaneTitle('Worktree 1', 'lab'), false);
	});

	it('definisce il limite massimo per la rinomina manuale a 40 caratteri', () => {
		assert.equal(LANE_TITLE_MAX, 40);
	});
});
