/**
 * Visibilita' della modalita' rapida nella riga di stato (src/lib/agent/sessionModes.ts).
 *
 * omp non espone via RPC se il modello regge /fast prima di accenderla: Studio
 * ricalca la sua regola. Qui si provano i confini che decidono se la voce compare.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelSupportsFastMode } from '../src/lib/agent/sessionModes.ts';

describe('modelSupportsFastMode', () => {
	it('accetta i provider con livello priority', () => {
		assert.equal(modelSupportsFastMode({ provider: 'anthropic', api: 'anthropic-messages' }), true);
		assert.equal(modelSupportsFastMode({ provider: 'openai', api: 'openai-responses' }), true);
		assert.equal(modelSupportsFastMode({ provider: 'google-vertex' }), true);
	});

	it('esclude i proxy con protocollo Anthropic e i provider senza livelli', () => {
		assert.equal(modelSupportsFastMode({ provider: 'my-proxy', api: 'anthropic-messages' }), false);
		assert.equal(modelSupportsFastMode({ provider: 'ollama', api: 'openai-completions' }), false);
		assert.equal(modelSupportsFastMode(null), false);
	});

	it('su OpenRouter decide la famiglia del modello', () => {
		assert.equal(modelSupportsFastMode({ provider: 'openrouter', identity: { class: 'openai' } }), true);
		assert.equal(modelSupportsFastMode({ provider: 'openrouter', identity: { class: 'anthropic' } }), false);
	});

	it('Codex rispetta i livelli dichiarati dal modello', () => {
		const codex = { provider: 'openai-codex', api: 'openai-codex-responses' };
		assert.equal(modelSupportsFastMode({ ...codex, serviceTiers: ['default', 'flex'] }), false);
		assert.equal(modelSupportsFastMode({ ...codex, serviceTiers: ['default', 'priority'] }), true);
		assert.equal(modelSupportsFastMode(codex), true);
	});
});
