import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	classifyFailureReason,
	recommendRecoveryModel,
	hasEffectiveReserves,
	type BlockedQuotaState
} from '../src/lib/agent/quotaRecovery.ts';
import {
	buildAttentionRequest,
	sameAttentionRequest
} from '../src/lib/stores/companionAttention.ts';
import type { ModelConfigDto, ModelDto } from '../src/lib/stores/modelSettingsHelpers.ts';

test('classifyFailureReason riconosce codici ufficiali di quota e crediti', () => {
	// OpenAI
	const resOpenAi = classifyFailureReason('Error 429: credit_balance_exhausted - Prepaid credits depleted');
	assert.equal(resOpenAi.kind, 'quota_exhausted');
	assert.match(resOpenAi.title, /quota/i);

	// Anthropic
	const resAnthropic = classifyFailureReason('rate_limit_error: enforced_spend_limit_reached');
	assert.equal(resAnthropic.kind, 'quota_exhausted');

	// Google
	const resGoogle = classifyFailureReason('RESOURCE_EXHAUSTED: quota_exceeded for metric generate_requests');
	assert.equal(resGoogle.kind, 'quota_exhausted');

	// Telemetria usage
	const resTelemetry = classifyFailureReason('Error communicating with API', 'exhausted');
	assert.equal(resTelemetry.kind, 'quota_exhausted');

	// Errore generico non di quota
	const resGeneric = classifyFailureReason('Connection reset by peer after 5 attempts', 'ok');
	assert.equal(resGeneric.kind, 'provider_error');
	assert.match(resGeneric.title, /provider/i);
});

test('recommendRecoveryModel seleziona il prossimo ruolo sano e privilegia provider differente', () => {
	const config: ModelConfigDto = {
		modelRoles: {
			default: 'anthropic/claude-sonnet-5',
			plan: 'google/gemini-2.5-flash',
			fast: 'openai/gpt-4o-mini',
			slow: 'anthropic/claude-opus-4'
		},
		cycleOrder: ['default', 'plan', 'fast', 'slow'],
		disabledProviders: [],
		fallbackChains: {}
	};

	const catalog: ModelDto[] = [
		{ selector: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic' },
		{ selector: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
		{ selector: 'openai/gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' },
		{ selector: 'anthropic/claude-opus-4', name: 'Claude Opus 4', provider: 'anthropic' }
	];

	// Il modello che ha fallito è anthropic/claude-sonnet-5.
	// Gemini e GPT-4o hanno provider diverso, quindi Gemini (primo in cycleOrder tra i diversi) deve essere il primario.
	const rec = recommendRecoveryModel({
		failedProvider: 'anthropic',
		failedModelId: 'claude-sonnet-5',
		config,
		catalog,
		checkQuota: (prov, _mod) => (prov === 'google' ? 'ok' : 'ok')
	});

	assert.ok(rec.primary);
	assert.equal(rec.primary.selector, 'google/gemini-2.5-flash');
	assert.equal(rec.primary.isDifferentProvider, true);

	// Esclude modelli con quota exhausted
	const recWithExhausted = recommendRecoveryModel({
		failedProvider: 'anthropic',
		failedModelId: 'claude-sonnet-5',
		config,
		catalog,
		checkQuota: (prov, _mod) => (prov === 'google' ? 'exhausted' : 'ok')
	});

	assert.ok(recWithExhausted.primary);
	assert.equal(recWithExhausted.primary.selector, 'openai/gpt-4o-mini');
});

test('hasEffectiveReserves verifica correttamente la copertura delle fallbackChains', () => {
	const configWithChains: ModelConfigDto = {
		modelRoles: {
			default: 'openai/gpt-4o',
			fast: 'openai/gpt-4o-mini'
		},
		cycleOrder: ['default', 'fast'],
		disabledProviders: [],
		fallbackChains: {
			fast: ['anthropic/claude-haiku-3-5'],
			'openai/gpt-4o': ['anthropic/claude-sonnet-5'],
			'google/*': ['openai/gpt-4o']
		}
	};

	// Coperto per ruolo
	assert.equal(hasEffectiveReserves('openai/gpt-4o-mini', 'fast', configWithChains), true);

	// Coperto per selettore esatto
	assert.equal(hasEffectiveReserves('openai/gpt-4o', null, configWithChains), true);

	// Coperto per wildcard provider
	assert.equal(hasEffectiveReserves('google/gemini-pro', null, configWithChains), true);

	// Non coperto (modello custom isolato senza catena)
	assert.equal(hasEffectiveReserves('ollama/llama-3-8b', null, configWithChains), false);
});

test('buildAttentionRequest e sameAttentionRequest gestiscono quota_blocked in modo convergente', () => {
	const bq: BlockedQuotaState = {
		id: 'quota-123',
		reasonKind: 'quota_exhausted',
		title: 'Quota esaurita',
		message: 'Dettaglio quota',
		failedProvider: 'openai',
		failedModelId: 'gpt-4o',
		failedSelector: 'openai/gpt-4o',
		timestamp: 1000,
		suggestedModel: {
			selector: 'anthropic/claude-sonnet-5',
			provider: 'anthropic',
			modelId: 'claude-sonnet-5',
			modelName: 'Claude Sonnet 5',
			isDifferentProvider: true
		},
		availableRecoveryModels: []
	};

	const req = buildAttentionRequest(
		{ id: 'proj-1', name: 'Test Project', hue: 200 },
		{
			blockedQuotaState: bq,
			recentMessages: []
		}
	);

	assert.ok(req);
	assert.equal(req.pendingUi.kind, 'quota_blocked');
	assert.equal(req.pendingUi.blockedQuota?.reasonKind, 'quota_exhausted');
	assert.equal(req.pendingUi.blockedQuota?.suggestedModel?.selector, 'anthropic/claude-sonnet-5');

	// Due istanze equivalenti convergono con sameAttentionRequest
	const req2 = buildAttentionRequest(
		{ id: 'proj-1', name: 'Test Project', hue: 200 },
		{
			blockedQuotaState: { ...bq },
			recentMessages: []
		}
	);

	assert.ok(req2);
	assert.equal(sameAttentionRequest(req, req2), true);

	// Se archiviato (dismissed), non genera alcuna richiesta
	const dismissedReq = buildAttentionRequest(
		{ id: 'proj-1', name: 'Test Project', hue: 200 },
		{
			blockedQuotaState: { ...bq, dismissed: true },
			recentMessages: []
		}
	);
	assert.equal(dismissedReq, null);
});
