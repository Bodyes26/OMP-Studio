import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	assessPromptCache,
	cacheObservationFromMessage,
	latestPromptCacheObservation
} from '../src/lib/agent/promptCache.ts';
import type { AgentMessage, ModelInfo } from '../src/lib/agent/wire.ts';

const ANTHROPIC_MODEL: ModelInfo = {
	id: 'claude-sonnet-4-5',
	provider: 'anthropic',
	promptCache: {
		short: 300,
		long: 3600
	}
};

const OPENAI_MODEL_NO_TTL: ModelInfo = {
	id: 'gpt-5',
	provider: 'openai'
};

describe('promptCache — estrazione e ricostruzione storico', () => {
	it('estrae una osservazione valida da un messaggio assistant completato', () => {
		const msg: AgentMessage = {
			role: 'assistant',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			timestamp: 1_700_000_000_000,
			stopReason: 'stop',
			usage: {
				input: 2_000,
				cacheRead: 18_000,
				cacheWrite: 0,
				output: 400
			}
		};
		const obs = cacheObservationFromMessage(msg);
		assert.deepEqual(obs, {
			at: 1_700_000_000_000,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			usage: msg.usage
		});
	});

	it('ignora messaggi senza timestamp valido, senza usage o con errore', () => {
		const missingTsMsg: AgentMessage = {
			role: 'assistant',
			model: 'gpt-5',
			usage: { input: 1_000, cacheRead: 0, cacheWrite: 0 }
		};
		assert.equal(cacheObservationFromMessage(missingTsMsg), null);

		assert.equal(
			cacheObservationFromMessage({
				role: 'user',
				timestamp: 1_700_000_000_000,
				usage: { input: 1_000 }
			}),
			null
		);
		assert.equal(
			cacheObservationFromMessage({
				role: 'assistant',
				timestamp: 1_700_000_000_000,
				stopReason: 'error',
				usage: { input: 1_000 }
			}),
			null
		);
		assert.equal(
			cacheObservationFromMessage({
				role: 'assistant',
				timestamp: 1_700_000_000_000,
				stopReason: 'aborted',
				usage: { input: 0, cacheRead: 0, cacheWrite: 0 }
			}),
			null
		);
	});

	it('ricostruisce la sessione al resume rilevando compattazioni successive, messaggi kept pre-compattazione e summary senza timestamp', () => {
		const messages: AgentMessage[] = [
			{
				role: 'assistant',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				timestamp: 1_000,
				usage: { input: 500, cacheRead: 1_500, cacheWrite: 0 }
			},
			{
				role: 'compactionSummary',
				summary: 'Prima compattazione',
				timestamp: 1_500
			},
			{
				role: 'assistant',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				timestamp: 2_000,
				usage: { input: 400, cacheRead: 0, cacheWrite: 1_600 }
			},
			{
				role: 'toolResult',
				toolCallId: 'call_1',
				toolName: 'read',
				timestamp: 2_100
			}
		];

		const beforeTrailingCompact = latestPromptCacheObservation(messages);
		assert.equal(beforeTrailingCompact.observation?.at, 2_000);
		assert.equal(beforeTrailingCompact.contextChanged, false);

		const afterTrailingCompact = latestPromptCacheObservation([
			...messages,
			{
				role: 'custom',
				customType: 'compactionSummary',
				summary: 'Seconda compattazione',
				timestamp: 2_500
			},
			{
				role: 'assistant',
				timestamp: 3_000,
				stopReason: 'error',
				usage: { input: 0, cacheRead: 0, cacheWrite: 0 }
			}
		]);
		assert.equal(afterTrailingCompact.observation?.at, 2_000);
		assert.equal(afterTrailingCompact.contextChanged, true);

		// Forma reale di get_messages_page (`buildSessionContext` non-transcript):
		// `compactionSummary` in testa (timestamp 2_500) seguito da un turno kept
		// anteriore alla compattazione (timestamp 2_000 < 2_500).
		const rehydratedWithKeptTurn = latestPromptCacheObservation([
			{
				role: 'compactionSummary',
				summary: 'Summary davanti ai messaggi kept',
				timestamp: 2_500
			},
			{
				role: 'user',
				timestamp: 1_900
			},
			{
				role: 'assistant',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				timestamp: 2_000,
				usage: { input: 300, cacheRead: 1_700, cacheWrite: 0 }
			}
		]);
		assert.equal(rehydratedWithKeptTurn.observation?.at, 2_000);
		assert.equal(rehydratedWithKeptTurn.contextChanged, true);
		assert.equal(
			assessPromptCache({
				model: ANTHROPIC_MODEL,
				observation: rehydratedWithKeptTurn.observation,
				contextChanged: rehydratedWithKeptTurn.contextChanged,
				now: 2_600
			}).state,
			'context-changed'
		);

		// Se il summary precede l'assistant ma non ha timestamp, non assume che
		// l'assistant sia post-compattazione.
		const undatedSummaryBeforeAssistant = latestPromptCacheObservation([
			{
				role: 'compactionSummary',
				summary: 'Summary senza timestamp'
			},
			{
				role: 'assistant',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				timestamp: 2_000,
				usage: { input: 300, cacheRead: 1_700, cacheWrite: 0 }
			}
		]);
		assert.equal(undatedSummaryBeforeAssistant.observation?.at, 2_000);
		assert.equal(undatedSummaryBeforeAssistant.contextChanged, true);
	});
});

describe('promptCache — valutazione TTL, warming e cambi di contesto', () => {
	it('ritorna no-request quando non c\'e\' alcuna osservazione', () => {
		const res = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: null,
			now: 10_000
		});
		assert.deepEqual(res, {
			state: 'unknown',
			reason: 'no-request',
			lastRequestAt: null,
			lastTouchAt: null,
			expiresAt: null,
			inputTokens: 0,
			cachedTokens: 0,
			cachedPercent: null
		});
	});

	it('non inventa un TTL per modelli senza promptCache ne\' cttl ma conserva eta\' e contatori', () => {
		const res = assessPromptCache({
			model: OPENAI_MODEL_NO_TTL,
			observation: {
				at: 100_000,
				provider: 'openai',
				model: 'gpt-5',
				usage: {
					input: 2_500,
					cacheRead: 7_500,
					cacheWrite: 0
				}
			},
			now: 120_000
		});
		assert.equal(res.state, 'unknown');
		assert.equal(res.reason, 'lifetime-unknown');
		assert.equal(res.lastRequestAt, 100_000);
		assert.equal(res.lastTouchAt, 100_000);
		assert.equal(res.expiresAt, null);
		assert.equal(res.inputTokens, 10_000);
		assert.equal(res.cachedTokens, 7_500);
		assert.equal(res.cachedPercent, 75);
	});

	it('ritorna no-cache-observed quando input > 0 ma cacheRead = cacheWrite = cttl = 0, preservando contatori ed eta\'', () => {
		const res = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: {
				at: 100_000,
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				usage: {
					input: 4_000,
					cacheRead: 0,
					cacheWrite: 0
				}
			},
			now: 120_000
		});
		assert.equal(res.state, 'unknown');
		assert.equal(res.reason, 'no-cache-observed');
		assert.equal(res.lastRequestAt, 100_000);
		assert.equal(res.lastTouchAt, 100_000);
		assert.equal(res.expiresAt, null);
		assert.equal(res.inputTokens, 4_000);
		assert.equal(res.cachedTokens, 0);
		assert.equal(res.cachedPercent, 0);
	});

	it('ritorna identity-unknown se provider o model mancano nell\'osservazione, salvo che un warming compatibile fornisca l\'identita\'', () => {
		const obsMissingProvider = {
			at: 1_000_000,
			model: 'claude-sonnet-4-5',
			usage: {
				input: 1_000,
				cacheRead: 9_000,
				cacheWrite: 0
			}
		};

		const unknownIdentity = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obsMissingProvider,
			now: 1_050_000
		});
		assert.equal(unknownIdentity.state, 'unknown');
		assert.equal(unknownIdentity.reason, 'identity-unknown');
		assert.equal(unknownIdentity.expiresAt, null);
		assert.equal(unknownIdentity.inputTokens, 10_000);
		assert.equal(unknownIdentity.cachedTokens, 9_000);
		assert.equal(unknownIdentity.cachedPercent, 90);

		const suppliedByWarming = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obsMissingProvider,
			warming: {
				outcome: 'hit',
				phase: 'idle',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				usage: { input: 0, cacheRead: 10_000, cacheWrite: 0, output: 1 },
				at: 1_100_000
			},
			now: 1_200_000
		});
		assert.equal(suppliedByWarming.state, 'likely-valid');
		assert.equal(suppliedByWarming.reason, 'warmed-within-ttl');
		assert.equal(suppliedByWarming.expiresAt, 1_400_000);
	});

	it('usa il tier conservativo (short) su letture senza cttl o con cttl misti (5m + 1h)', () => {
		const baseObs = {
			at: 1_000_000,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			usage: {
				input: 1_000,
				cacheRead: 6_000,
				cacheWrite: 3_000,
				cttl: {
					ephemeral5m: 1_000,
					ephemeral1h: 2_000
				}
			}
		};

		const validAtBoundaryMinusOne = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: baseObs,
			now: 1_000_000 + 300_000 - 1
		});
		assert.equal(validAtBoundaryMinusOne.state, 'likely-valid');
		assert.equal(validAtBoundaryMinusOne.reason, 'within-ttl');
		assert.equal(validAtBoundaryMinusOne.expiresAt, 1_300_000);
		assert.equal(validAtBoundaryMinusOne.inputTokens, 10_000);
		assert.equal(validAtBoundaryMinusOne.cachedTokens, 6_000);
		assert.equal(validAtBoundaryMinusOne.cachedPercent, 60);

		const expiredAtExactBoundary = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: baseObs,
			now: 1_000_000 + 300_000
		});
		assert.equal(expiredAtExactBoundary.state, 'possibly-expired');
		assert.equal(expiredAtExactBoundary.reason, 'ttl-elapsed');
		assert.equal(expiredAtExactBoundary.expiresAt, 1_300_000);
	});

	it('usa il tier long (1h) quando cttl riporta esclusivamente ephemeral1h', () => {
		const obs1h = {
			at: 1_000_000,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			usage: {
				input: 1_000,
				cacheRead: 0,
				cacheWrite: 9_000,
				cttl: {
					ephemeral1h: 9_000
				}
			}
		};

		const after20Minutes = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obs1h,
			now: 1_000_000 + 20 * 60_000
		});
		assert.equal(after20Minutes.state, 'likely-valid');
		assert.equal(after20Minutes.reason, 'within-ttl');
		assert.equal(after20Minutes.expiresAt, 1_000_000 + 3_600_000);
		assert.equal(after20Minutes.cachedPercent, 0);
	});

	it('invalida la stima dopo compattazione o cambio di modello/provider mantenendo i contatori osservati', () => {
		const obs = {
			at: 1_000_000,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			usage: {
				input: 1_000,
				cacheRead: 9_000,
				cacheWrite: 0
			}
		};

		const compacted = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obs,
			contextChanged: true,
			now: 1_010_000
		});
		assert.equal(compacted.state, 'context-changed');
		assert.equal(compacted.reason, 'context-compacted');
		assert.equal(compacted.expiresAt, null);
		assert.equal(compacted.inputTokens, 10_000);
		assert.equal(compacted.cachedTokens, 9_000);
		assert.equal(compacted.cachedPercent, 90);

		const modelSwitched = assessPromptCache({
			model: { ...ANTHROPIC_MODEL, id: 'claude-opus-4-7' },
			observation: obs,
			now: 1_010_000
		});
		assert.equal(modelSwitched.state, 'context-changed');
		assert.equal(modelSwitched.reason, 'model-changed');
		assert.equal(modelSwitched.expiresAt, null);

		const providerSwitched = assessPromptCache({
			model: { ...ANTHROPIC_MODEL, provider: 'amazon-bedrock' },
			observation: obs,
			now: 1_010_000
		});
		assert.equal(providerSwitched.state, 'context-changed');
		assert.equal(providerSwitched.reason, 'model-changed');
	});

	it('estende la validita\' solo con un warming hit dello stesso modello/provider e non con miss/error/mismatch', () => {
		const obs = {
			at: 1_000_000,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			usage: {
				input: 500,
				cacheRead: 9_500,
				cacheWrite: 0
			}
		};

		const refreshed = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obs,
			warming: {
				outcome: 'hit',
				phase: 'idle',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				usage: { input: 0, cacheRead: 10_000, cacheWrite: 0, output: 1 },
				at: 1_270_000
			},
			now: 1_400_000
		});
		assert.equal(refreshed.state, 'likely-valid');
		assert.equal(refreshed.reason, 'warmed-within-ttl');
		assert.equal(refreshed.lastRequestAt, 1_000_000);
		assert.equal(refreshed.lastTouchAt, 1_270_000);
		assert.equal(refreshed.expiresAt, 1_570_000);

		const missed = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obs,
			warming: {
				outcome: 'miss',
				phase: 'idle',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				at: 1_100_000
			},
			now: 1_150_000
		});
		assert.equal(missed.state, 'possibly-expired');
		assert.equal(missed.reason, 'warming-missed');
		assert.equal(missed.expiresAt, null);

		const errored = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obs,
			warming: {
				outcome: 'error',
				phase: 'idle',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				at: 1_270_000
			},
			now: 1_400_000
		});
		assert.equal(errored.state, 'possibly-expired');
		assert.equal(errored.reason, 'ttl-elapsed');
		assert.equal(errored.lastTouchAt, 1_000_000);

		const mismatchedWarming = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obs,
			warming: {
				outcome: 'hit',
				phase: 'idle',
				provider: 'anthropic',
				model: 'claude-haiku-4-5',
				at: 1_270_000
			},
			now: 1_400_000
		});
		assert.equal(mismatchedWarming.state, 'possibly-expired');
		assert.equal(mismatchedWarming.reason, 'ttl-elapsed');
		assert.equal(mismatchedWarming.lastTouchAt, 1_000_000);

		const aborted = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obs,
			warming: {
				outcome: 'aborted',
				phase: 'streaming',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				at: 1_270_000
			},
			now: 1_400_000
		});
		assert.equal(aborted.state, 'possibly-expired');
		assert.equal(aborted.reason, 'ttl-elapsed');
		assert.equal(aborted.lastTouchAt, 1_000_000);

		const compactedOverridesWarming = assessPromptCache({
			model: ANTHROPIC_MODEL,
			observation: obs,
			contextChanged: true,
			warming: {
				outcome: 'hit',
				phase: 'idle',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				usage: { input: 0, cacheRead: 10_000, cacheWrite: 0, output: 1 },
				at: 1_270_000
			},
			now: 1_280_000
		});
		assert.equal(compactedOverridesWarming.state, 'context-changed');
		assert.equal(compactedOverridesWarming.reason, 'context-compacted');
		assert.equal(compactedOverridesWarming.expiresAt, null);
	});
});
