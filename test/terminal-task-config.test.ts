import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeConfigurationMismatch } from '../src/lib/terminal/taskConfiguration.ts';

describe('Configurazione del task sulla superficie terminale', () => {
	const configuration = { modelSelector: 'anthropic/claude-opus-5', thinkingLevel: 'high' };

	it('lascia passare la sessione che usa modello e thinking richiesti', () => {
		assert.equal(
			describeConfigurationMismatch(
				{ modelSelector: 'anthropic/claude-opus-5', thinkingLevel: 'high' },
				configuration
			),
			null
		);
	});

	it('blocca la sessione che usa un altro modello, indicando entrambi', () => {
		const message = describeConfigurationMismatch(
			{ modelSelector: 'openai-codex/gpt-5.6-sol', thinkingLevel: 'high' },
			configuration
		);
		assert.ok(message?.includes('anthropic/claude-opus-5'));
		assert.ok(message?.includes('openai-codex/gpt-5.6-sol'));
	});

	it('blocca il thinking diverso da quello richiesto', () => {
		const message = describeConfigurationMismatch(
			{ modelSelector: 'anthropic/claude-opus-5', thinkingLevel: 'low' },
			configuration
		);
		assert.ok(message?.includes('thinking high'));
		assert.ok(message?.includes('low'));
	});

	it('ignora il thinking quando il task lo lascia in auto', () => {
		assert.equal(
			describeConfigurationMismatch(
				{ modelSelector: 'anthropic/claude-opus-5', thinkingLevel: 'low' },
				{ modelSelector: 'anthropic/claude-opus-5', thinkingLevel: 'auto' }
			),
			null
		);
		assert.equal(
			describeConfigurationMismatch(
				{ modelSelector: 'anthropic/claude-opus-5', thinkingLevel: 'low' },
				{ modelSelector: 'anthropic/claude-opus-5' }
			),
			null
		);
	});

	// Una sessione appena aperta non ha ancora un file JSONL: omp lo scrive col
	// primo messaggio, quindi non pubblica ne' modello ne' thinking. Bloccare
	// qui fermerebbe ogni primo task del terminale.
	it('non blocca quando la sessione non ha ancora pubblicato il modello', () => {
		assert.equal(describeConfigurationMismatch({}, configuration), null);
		assert.equal(
			describeConfigurationMismatch({ modelSelector: null, thinkingLevel: null }, configuration),
			null
		);
	});

	it('non blocca sul thinking quando la sessione pubblica solo il modello', () => {
		assert.equal(
			describeConfigurationMismatch({ modelSelector: 'anthropic/claude-opus-5' }, configuration),
			null
		);
	});
});
