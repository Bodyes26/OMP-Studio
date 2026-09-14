import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, parseSettings } from '../src/lib/stores/settings.svelte.ts';

test('parseSettings: companion layout defaults to balanced', () => {
	const parsed = parseSettings({});
	assert.equal(parsed.appearance.companionLayout, 'balanced');
	assert.equal(parsed.appearance.companionSpotlightDismiss, 'esc-only');
});

test('parseSettings: companion layout and spotlight dismiss are sanitized', () => {
	const parsed = parseSettings({
		appearance: {
			companionLayout: 'dashboard',
			companionSpotlightDismiss: 'esc-and-blur'
		}
	});
	assert.equal(parsed.appearance.companionLayout, 'dashboard');
	assert.equal(parsed.appearance.companionSpotlightDismiss, 'esc-and-blur');

	const invalid = parseSettings({
		appearance: {
			companionLayout: 'unknown',
			companionSpotlightDismiss: 'click-outside'
		}
	});
	assert.equal(invalid.appearance.companionLayout, DEFAULT_SETTINGS.appearance.companionLayout);
	assert.equal(
		invalid.appearance.companionSpotlightDismiss,
		DEFAULT_SETTINGS.appearance.companionSpotlightDismiss
	);
});
