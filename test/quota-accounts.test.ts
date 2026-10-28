import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { reportIndexForHost } from '../src/lib/quota/accountHosts.ts';
import type { QuotaReport } from '../src/lib/stores/quota.svelte.ts';

const reports: QuotaReport[] = [
	{ provider: 'openai-codex', metadata: { email: 'uno@example.com' } },
	{ provider: 'openai-codex', metadata: { email: 'due@example.com' } },
	{ provider: 'anthropic', metadata: { email: 'uno@example.com' } }
];
const hashes = ['pin-codex-uno', 'pin-codex-due', 'pin-anthropic'];

describe('attribuzione degli host agli account di quota', () => {
	it('con due account dello stesso provider vale solo il pin della sessione', () => {
		assert.equal(reportIndexForHost({ provider: 'openai-codex', credential_pin: 'pin-codex-due' }, reports, hashes), 1);
		assert.equal(reportIndexForHost({ provider: 'openai-codex', credential_pin: 'pin-codex-uno' }, reports, hashes), 0);
	});

	it('senza pin, o con un pin sconosciuto, non attribuisce a nessuno dei due account', () => {
		assert.equal(reportIndexForHost({ provider: 'openai-codex' }, reports, hashes), undefined);
		assert.equal(reportIndexForHost({ provider: 'openai', credential_pin: 'pin-rimosso' }, reports, hashes), undefined);
	});

	it('con un solo account il provider basta, anche senza pin', () => {
		assert.equal(reportIndexForHost({ provider: 'anthropic' }, reports, hashes), 2);
		assert.equal(reportIndexForHost({ provider: 'google' }, reports, hashes), undefined);
	});

	it('il pin di un altro provider non sposta l host su quell account', () => {
		assert.equal(reportIndexForHost({ provider: 'openai-codex', credential_pin: 'pin-anthropic' }, reports, hashes), undefined);
	});
});
