/**
 * test/subagent-model.test.ts
 *
 * Metadati del modello mostrati per ogni subagente (VSUB-001…007): derivati dal
 * `progress` di omp, senza inventare valori quando omp non li ha ancora mandati.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { describeSubagentModel, formatSubagentCost } from '../src/lib/agent/subagentActivity.ts';
import type { AgentProgress } from '../src/lib/agent/wire.ts';

describe('describeSubagentModel', () => {
	it('divide provider e modello alla prima barra', () => {
		const info = describeSubagentModel({ resolvedModel: 'openrouter/anthropic/claude-sonnet-4-5' });
		assert.equal(info.providerId, 'openrouter');
		assert.equal(info.model, 'anthropic/claude-sonnet-4-5');
	});

	it('senza modello risolto non mostra provider, modello ne ripiego', () => {
		const info = describeSubagentModel({ status: 'pending', modelRole: 'task', resolvedModelIsFallback: true });
		assert.equal(info.providerId, undefined);
		assert.equal(info.model, undefined);
		assert.equal(info.fallback, false);
	});

	it('riporta ragionamento, ripiego, contesto e costo', () => {
		const progress: AgentProgress = {
			status: 'running',
			resolvedModel: 'anthropic/claude-sonnet-4-5',
			resolvedThinkingLevel: 'high',
			resolvedModelIsFallback: true,
			contextTokens: 76_000,
			contextWindow: 200_000,
			cost: 0.214
		};
		const info = describeSubagentModel(progress);
		assert.equal(info.effort, 'high');
		assert.equal(info.fallback, true);
		assert.equal(info.contextPct, 38);
		assert.equal(formatSubagentCost(info.cost!), '$0.21');
		assert.equal(formatSubagentCost(0.004), '<$0.01');
	});

	it('nasconde costo e contesto a zero', () => {
		const info = describeSubagentModel({ cost: 0, tokens: 0, contextTokens: 0, contextWindow: 200_000 });
		assert.equal(info.cost, undefined);
		assert.equal(info.contextPct, undefined);
	});

	it('mostra il retry solo mentre il subagente lavora', () => {
		const retryState = { attempt: 2, maxAttempts: 3, errorMessage: '529 overloaded' };
		assert.deepEqual(describeSubagentModel({ status: 'running', retryState }).retry, {
			attempt: 2,
			max: 3,
			error: '529 overloaded'
		});
		assert.equal(describeSubagentModel({ status: 'failed', retryState }).retry, undefined);
	});

	it('mostra il tipo di agente solo se diverso dal nome', () => {
		assert.equal(describeSubagentModel({ id: 'ReviewAuth', agent: 'reviewer' }, 'ReviewAuth').agentType, 'reviewer');
		assert.equal(describeSubagentModel({ id: 'scout', agent: 'scout' }, 'scout').agentType, undefined);
	});
});
