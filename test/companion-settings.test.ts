import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, parseSettings } from '../src/lib/stores/settings.svelte.ts';

test('parseSettings: la chiusura dello spotlight Companion ha un default sicuro', () => {
	const parsed = parseSettings({});
	assert.equal(parsed.appearance.companionSpotlightDismiss, 'esc-only');
});

test('parseSettings: la chiusura dello spotlight Companion accetta solo valori noti', () => {
	const parsed = parseSettings({
		appearance: { companionSpotlightDismiss: 'esc-and-blur' }
	});
	assert.equal(parsed.appearance.companionSpotlightDismiss, 'esc-and-blur');

	const invalid = parseSettings({
		appearance: { companionSpotlightDismiss: 'click-outside' }
	});
	assert.equal(
		invalid.appearance.companionSpotlightDismiss,
		DEFAULT_SETTINGS.appearance.companionSpotlightDismiss
	);
});
