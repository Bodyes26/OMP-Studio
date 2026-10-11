import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	buildAccountResetSummaries,
	findResetSummaryForReport,
	isAutoRedeemSessionPrompt,
	selectResetPromptCandidate,
	type ResetAccountRaw
} from '../src/lib/quota/usageResets.ts';
import type { QuotaReport } from '../src/lib/stores/quota.svelte.ts';

const NOW_MS = Date.parse('2026-10-11T12:00:00.000Z');

const FIXTURE_REPORTS: QuotaReport[] = [
	{
		provider: 'openai-codex',
		fetchedAt: NOW_MS - 30_000,
		limits: [
			{
				id: 'openai-codex:primary',
				label: '5 hours',
				window: { id: '5h', label: '5 hours', durationMs: 18_000_000, resetsAt: NOW_MS + 9_000_000 },
				amount: { unit: 'percent', usedFraction: 0.07, remainingFraction: 0.93 },
				status: 'ok'
			},
			{
				id: 'openai-codex:secondary',
				label: '7 days',
				window: { id: '7d', label: '7 days', durationMs: 604_800_000, resetsAt: NOW_MS + 500_000_000 },
				amount: { unit: 'percent', usedFraction: 0.42, remainingFraction: 0.58 },
				status: 'ok'
			}
		],
		resetCredits: {
			availableCount: 1,
			credits: [
				{
					grantedAt: '2026-10-07T22:21:40.669148Z',
					expiresAt: '2026-11-06T22:21:40.669148Z',
					status: 'available'
				}
			]
		},
		metadata: {
			planType: 'plus',
			allowed: true,
			limitReached: false,
			email: 'maurizioactis@gmail.com',
			accountId: 'eb5a878e-dfcf-4b81-9fbd-d3d771ade542',
			orgId: 'eb5a878e-dfcf-4b81-9fbd-d3d771ade542',
			orgName: 'plus'
		}
	},
	{
		provider: 'anthropic',
		fetchedAt: NOW_MS - 15_000,
		limits: [
			{
				id: 'anthropic:5h',
				label: 'Claude 5 Hour',
				window: { id: '5h', label: '5 Hour', durationMs: 18_000_000, resetsAt: NOW_MS + 9_000_000 },
				amount: { unit: 'percent', usedFraction: 0.08, remainingFraction: 0.92 },
				status: 'ok'
			},
			{
				id: 'anthropic:7d',
				label: 'Claude 7 Day',
				window: { id: '7d', label: '7 Day', durationMs: 604_800_000, resetsAt: NOW_MS + 170_000_000 },
				amount: { unit: 'percent', usedFraction: 0.71, remainingFraction: 0.29 },
				status: 'ok'
			}
		],
		metadata: {
			accountId: '3d9aa28c-6e67-4422-a285-9f1cc2855952',
			email: 'maurizioactis@gmail.com',
			orgId: 'e1439e83-398d-42a7-bd4a-b23a6ab67155',
			orgName: "maurizioactis@gmail.com's Organization"
		},
		resetCredits: {
			availableCount: 0,
			redeemableCount: 0,
			eligible: false,
			reason: 'not_at_wall',
			credits: []
		}
	}
];

const FIXTURE_RESET_ACCOUNTS: ResetAccountRaw[] = [
	{
		provider: 'openai-codex',
		credentialId: 5,
		email: 'maurizioactis@gmail.com',
		accountId: 'eb5a878e-dfcf-4b81-9fbd-d3d771ade542',
		orgId: 'eb5a878e-dfcf-4b81-9fbd-d3d771ade542',
		orgName: 'plus',
		availableCount: 1,
		redeemableCount: 1,
		soonestExpiry: '2026-11-06T22:21:40.669148Z',
		credits: [
			{
				id: 'RateLimitResetCredit_d1eaa40d45b48191b99696808a9f0d15',
				title: 'Full reset (Weekly + 5 hr)',
				status: 'available',
				grantedAt: '2026-10-07T22:21:40.669148Z',
				expiresAt: '2026-11-06T22:21:40.669148Z'
			}
		]
	},
	{
		provider: 'anthropic',
		credentialId: 10,
		email: 'maurizioactis@gmail.com',
		accountId: '3d9aa28c-6e67-4422-a285-9f1cc2855952',
		orgId: 'e1439e83-398d-42a7-bd4a-b23a6ab67155',
		orgName: "maurizioactis@gmail.com's Organization",
		availableCount: 0,
		redeemableCount: 0,
		unavailableReason: 'not_at_wall',
		credits: []
	}
];

test('buildAccountResetSummaries unisce report usage e omp usage reset --json per il popover', () => {
	const summaries = buildAccountResetSummaries({
		reports: FIXTURE_REPORTS,
		resetAccounts: FIXTURE_RESET_ACCOUNTS,
		nowMs: NOW_MS
	});

	assert.equal(summaries.length, 2);

	const codex = findResetSummaryForReport(FIXTURE_REPORTS[0], summaries);
	assert.ok(codex);
	assert.equal(codex.provider, 'openai-codex');
	assert.equal(codex.providerLabel, 'Codex');
	assert.equal(codex.credentialId, 5);
	assert.equal(codex.target, 'openai-codex/5');
	assert.equal(codex.bankedCount, 1);
	assert.equal(codex.redeemableCount, 1);
	assert.equal(codex.canRedeemNow, true);
	assert.equal(codex.creditTitle, 'Full reset (Weekly + 5 hr)');
	assert.equal(codex.expiryTier, 'none');
	assert.equal(codex.coveredWindowLabel, '7 days');
	assert.equal(codex.coveredUsedPercent, 42);
	assert.equal(codex.worthSalvaging, true);

	const claude = findResetSummaryForReport(FIXTURE_REPORTS[1], summaries);
	assert.ok(claude);
	assert.equal(claude.provider, 'anthropic');
	assert.equal(claude.target, 'anthropic/10');
	assert.equal(claude.bankedCount, 0);
	assert.equal(claude.canRedeemNow, false);
	assert.equal(claude.unavailableReason, 'not_at_wall');
});

test('selectResetPromptCandidate rileva scadenza imminente, rispetta autoRedeem e applica dismiss', () => {
	const inSixHoursIso = new Date(NOW_MS + 6 * 3_600_000).toISOString();
	const accounts: ResetAccountRaw[] = [
		{
			...FIXTURE_RESET_ACCOUNTS[0],
			soonestExpiry: inSixHoursIso,
			credits: [
				{
					id: 'RateLimitResetCredit_expiring',
					title: 'Full reset (Weekly + 5 hr)',
					status: 'available',
					expiresAt: inSixHoursIso
				}
			]
		}
	];

	// 1. Default autoRedeem = unset -> mode: 'prompt'
	const summariesUnset = buildAccountResetSummaries({
		reports: FIXTURE_REPORTS,
		resetAccounts: accounts,
		nowMs: NOW_MS
	});
	assert.equal(summariesUnset[0].expiryTier, 'imminent');

	const candidateUnset = selectResetPromptCandidate({
		summaries: summariesUnset,
		nowMs: NOW_MS
	});
	assert.ok(candidateUnset);
	assert.equal(candidateUnset.reason, 'expiring');
	assert.equal(candidateUnset.mode, 'prompt');
	assert.equal(candidateUnset.willBeLostWithoutManualRedeem, false);
	assert.equal(candidateUnset.summary.target, 'openai-codex/5');

	// 2. Dismiss dell'episodio lo nasconde
	const afterDismiss = selectResetPromptCandidate({
		summaries: summariesUnset,
		dismissedKeys: new Set([candidateUnset.episodeKey]),
		nowMs: NOW_MS
	});
	assert.equal(afterDismiss, null);

	// 3. autoRedeem = yes -> mode: 'auto_informed' (informa senza doppio prompt)
	const summariesAuto = buildAccountResetSummaries({
		reports: FIXTURE_REPORTS,
		resetAccounts: accounts,
		resetSettings: { 'openai-codex': { autoRedeem: 'yes' } },
		nowMs: NOW_MS
	});
	const candidateAuto = selectResetPromptCandidate({
		summaries: summariesAuto,
		nowMs: NOW_MS
	});
	assert.ok(candidateAuto);
	assert.equal(candidateAuto.mode, 'auto_informed');
	assert.equal(candidateAuto.willBeLostWithoutManualRedeem, false);

	// 4. autoRedeem = no -> segnala che andra' perso senza riscatto manuale
	const summariesNo = buildAccountResetSummaries({
		reports: FIXTURE_REPORTS,
		resetAccounts: accounts,
		resetSettings: { 'openai-codex': { autoRedeem: 'no' } },
		nowMs: NOW_MS
	});
	const candidateNo = selectResetPromptCandidate({
		summaries: summariesNo,
		nowMs: NOW_MS
	});
	assert.ok(candidateNo);
	assert.equal(candidateNo.mode, 'prompt');
	assert.equal(candidateNo.willBeLostWithoutManualRedeem, true);

	// 5. Se la sessione sta gia' mostrando il dialogo nativo di omp, non duplica il prompt
	assert.equal(isAutoRedeemSessionPrompt('Auto-redeem saved Codex rate-limit resets?'), true);
	const suppressed = selectResetPromptCandidate({
		summaries: summariesUnset,
		suppressForSessionPrompt: true,
		nowMs: NOW_MS
	});
	assert.equal(suppressed, null);
});

test('selectResetPromptCandidate propone riscatto su rate limit e verifica copertura Claude Juniper', () => {
	// Caso A: Claude con finestra 5h esaurita e grant Juniper (5h) selezionato dal server
	const claude5hBlocked: QuotaReport = {
		...FIXTURE_REPORTS[1],
		limits: [
			{
				id: 'anthropic:5h',
				label: 'Claude 5 Hour',
				window: { id: '5h', label: '5 Hour', durationMs: 18_000_000, resetsAt: NOW_MS + 14_000_000 },
				amount: { unit: 'percent', usedFraction: 1, remainingFraction: 0 },
				status: 'exhausted'
			},
			{
				id: 'anthropic:7d',
				label: 'Claude 7 Day',
				window: { id: '7d', label: '7 Day', durationMs: 604_800_000, resetsAt: NOW_MS + 170_000_000 },
				amount: { unit: 'percent', usedFraction: 0.5, remainingFraction: 0.5 },
				status: 'ok'
			}
		]
	};
	const claudeResetEligible: ResetAccountRaw = {
		...FIXTURE_RESET_ACCOUNTS[1],
		availableCount: 1,
		redeemableCount: 1,
		nextCreditId: 'grant_juniper_1',
		soonestExpiry: new Date(NOW_MS + 10 * 86_400_000).toISOString(),
		unavailableReason: undefined,
		credits: [
			{
				id: 'grant_juniper_1',
				title: '5-hour session reset',
				program: 'juniper_tide',
				status: 'available',
				usable: true,
				clears: ['anthropic:5h'],
				expiresAt: new Date(NOW_MS + 10 * 86_400_000).toISOString()
			}
		]
	};

	const summaries = buildAccountResetSummaries({
		reports: [claude5hBlocked],
		resetAccounts: [claudeResetEligible],
		nowMs: NOW_MS
	});
	assert.equal(summaries[0].isRateLimited, true);
	assert.equal(summaries[0].canRedeemNow, true);
	assert.equal(summaries[0].expiryTier, 'none');

	const candidate = selectResetPromptCandidate({
		summaries,
		activeProvider: 'anthropic',
		nowMs: NOW_MS
	});
	assert.ok(candidate);
	assert.equal(candidate.reason, 'rate_limited');
	assert.equal(candidate.summary.target, 'anthropic/10');

	// Caso B: se anche la finestra 7d (non coperta da Juniper) e' esaurita, Juniper non sblocca l'account
	const claude7dAlsoBlocked: QuotaReport = {
		...claude5hBlocked,
		limits: [
			claude5hBlocked.limits![0],
			{
				...claude5hBlocked.limits![1],
				amount: { unit: 'percent', usedFraction: 1, remainingFraction: 0 },
				status: 'exhausted'
			}
		]
	};
	const summariesBlocked7d = buildAccountResetSummaries({
		reports: [claude7dAlsoBlocked],
		resetAccounts: [claudeResetEligible],
		nowMs: NOW_MS
	});
	assert.equal(summariesBlocked7d[0].isRateLimited, false);
});
