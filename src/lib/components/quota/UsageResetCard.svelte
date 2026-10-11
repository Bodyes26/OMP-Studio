<!--
  UsageResetCard.svelte

  Card dedicata per i reset di rate limit salvati (Codex e Claude, omp 18.9.0+):
  - Quando un reset salvato sta per scadere o l'account e' bloccato da rate limit,
    chiede se usare un reset con conferma esplicita a due passaggi.
  - Quando `autoRedeem: yes` e' attivo, informa l'utente che omp lo riscattera'
    automaticamente senza doppio prompt bloccante.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { IconSparkles, IconWarning, IconClose, IconInfo } from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import type { ResetPromptCandidate } from '$lib/quota/usageResets';

	let {
		candidate,
		now = Date.now(),
		startConfirming = false,
		redeeming = false,
		outcome = null,
		onConfirm,
		onDismiss
	} = $props<{
		candidate: ResetPromptCandidate;
		now?: number;
		startConfirming?: boolean;
		redeeming?: boolean;
		outcome?: { ok: boolean; target: string; message: string } | null;
		onConfirm?: (target: string) => void | Promise<void>;
		onDismiss?: () => void;
	}>();

	let confirming = $state(false);
	let lastEpisodeKey = $state('');

	$effect(() => {
		if (candidate.episodeKey !== lastEpisodeKey) {
			lastEpisodeKey = candidate.episodeKey;
			confirming = Boolean(startConfirming);
		}
	});

	const summary = $derived(candidate.summary);
	const settingKey = $derived(
		summary.provider === 'openai-codex' ? 'codexResets.autoRedeem' : 'claudeResets.autoRedeem'
	);

	const expiryWhen = $derived.by(() => {
		const expMs = summary.soonestExpiryMs;
		if (!expMs) return '';
		const diffMs = expMs - now;
		if (diffMs <= 0) return m.quota_reset_expired();
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return m.quota_reset_in_seconds({ sec: diffSec });
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return m.quota_reset_in_minutes({ min: diffMin });
		const diffHours = Math.floor(diffMin / 60);
		const remMin = diffMin % 60;
		if (diffHours < 24) {
			return m.quota_reset_in_hours({ hours: diffHours, min: remMin });
		}
		const diffDays = Math.floor(diffHours / 24);
		const remHours = diffHours % 24;
		return m.quota_reset_in_days({ days: diffDays, hours: remHours });
	});

	const expiryExact = $derived(
		summary.soonestExpiryMs
			? i18n.formatDate(summary.soonestExpiryMs, { dateStyle: 'short', timeStyle: 'short' })
			: ''
	);

	const windowInfo = $derived(
		summary.coveredWindowLabel && summary.coveredUsedPercent !== undefined
			? m.quota_reset_card_window_used({
					window: summary.coveredWindowLabel,
					pct: summary.coveredUsedPercent
				})
			: ''
	);

	const cardTitle = $derived.by(() => {
		if (candidate.mode === 'auto_informed' && !confirming) {
			return m.quota_reset_card_title_auto({ provider: summary.providerLabel });
		}
		if (candidate.reason === 'rate_limited') {
			return m.quota_reset_card_title_rate_limited({ provider: summary.providerLabel });
		}
		return m.quota_reset_card_title_expiring({
			provider: summary.providerLabel,
			when: expiryWhen || expiryExact
		});
	});

	const cardDescription = $derived.by(() => {
		if (candidate.reason === 'rate_limited') {
			return m.quota_reset_card_desc_rate_limited({
				account: summary.label,
				count: summary.redeemableCount || summary.bankedCount
			});
		}
		return m.quota_reset_card_desc_expiring({
			account: summary.label,
			when: expiryWhen || expiryExact,
			windowInfo
		});
	});
</script>

<div
	class="usage-reset-card"
	class:imminent={candidate.reason === 'expiring' && summary.expiryTier === 'imminent'}
	class:rate-limited={candidate.reason === 'rate_limited'}
	class:auto-informed={candidate.mode === 'auto_informed' && !confirming}
	role="region"
	aria-label={m.quota_reset_card_aria()}
>
	<div class="card-head">
		<span class="card-icon" aria-hidden="true">
			{#if outcome}
				<StatusMark status={outcome.ok ? 'done' : 'failed'} />
			{:else if candidate.mode === 'auto_informed' && !confirming}
				<IconInfo />
			{:else if candidate.reason === 'rate_limited' || summary.expiryTier === 'imminent'}
				<IconWarning />
			{:else}
				<IconSparkles />
			{/if}
		</span>
		<div class="card-title-wrap">
			<strong class="card-title">{cardTitle}</strong>
			{#if summary.target}
				<span class="card-target">{summary.target}</span>
			{/if}
		</div>
		{#if onDismiss}
			<button
				type="button"
				class="dismiss-icon-btn"
				onclick={() => onDismiss?.()}
				aria-label={m.quota_reset_card_action_dismiss()}
			>
				<IconClose aria-hidden="true" />
			</button>
		{/if}
	</div>

	{#if outcome}
		<p class="card-desc outcome-msg" class:outcome-err={!outcome.ok}>
			{outcome.message}
		</p>
	{:else if confirming}
		<p class="card-desc confirm-desc">
			{m.quota_reset_card_confirm_prompt({
				account: summary.label,
				target: summary.target ?? summary.provider
			})}
		</p>
		{#if summary.creditTitle}
			<div class="card-meta">{summary.creditTitle}</div>
		{/if}
		<div class="card-actions">
			<button
				type="button"
				class="ui-button ui-button-primary"
				disabled={redeeming || !summary.target}
				onclick={() => {
					if (summary.target) void onConfirm?.(summary.target);
				}}
			>
				{#if redeeming}
					<StatusMark status="running" active={true} visible={true} />
				{/if}
				{redeeming ? m.quota_reset_card_action_redeeming() : m.quota_reset_card_action_confirm()}
			</button>
			<button
				type="button"
				class="ui-button ui-button-secondary"
				disabled={redeeming}
				onclick={() => {
					if (startConfirming) onDismiss?.();
					else confirming = false;
				}}
			>
				{m.quota_reset_card_action_cancel()}
			</button>
		</div>
	{:else}
		<p class="card-desc">{cardDescription}</p>
		{#if summary.creditTitle || expiryExact}
			<div class="card-meta">
				{#if summary.creditTitle}
					<span>{summary.creditTitle}</span>
				{/if}
				{#if summary.creditTitle && expiryExact}
					<span aria-hidden="true">·</span>
				{/if}
				{#if expiryExact}
					<span title={summary.soonestExpiry}>{expiryExact}</span>
				{/if}
			</div>
		{/if}
		{#if candidate.mode === 'auto_informed'}
			<p class="card-note auto-note">
				{m.quota_reset_card_desc_auto_informed({ setting: settingKey })}
			</p>
		{:else if candidate.willBeLostWithoutManualRedeem}
			<p class="card-note warn-note">
				{m.quota_reset_card_desc_lost_warning()}
			</p>
		{/if}
		<div class="card-actions">
			{#if summary.canRedeemNow}
				<button
					type="button"
					class="ui-button {candidate.mode === 'auto_informed' ? 'ui-button-secondary' : 'ui-button-primary'}"
					disabled={redeeming}
					onclick={() => (confirming = true)}
				>
					{m.quota_reset_card_action_use()}
				</button>
			{/if}
			{#if onDismiss}
				<button
					type="button"
					class="ui-button ui-button-secondary"
					disabled={redeeming}
					onclick={() => onDismiss?.()}
				>
					{m.quota_reset_card_action_dismiss()}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.usage-reset-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-lg);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		color: var(--ink);
		font-family: var(--font-ui);
	}

	.usage-reset-card.rate-limited,
	.usage-reset-card.imminent {
		border-color: color-mix(in oklch, var(--warn) 45%, var(--line-strong));
		background: color-mix(in oklch, var(--warn) 8%, var(--bg-raised));
	}

	.usage-reset-card.auto-informed {
		border-color: var(--line);
		background: var(--bg-sunken);
	}

	.card-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.card-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--warn);
		--icon-size: 15px;
	}

	.usage-reset-card.auto-informed .card-icon {
		color: var(--brand-ink);
	}

	.card-title-wrap {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.card-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		line-height: 1.35;
	}

	.card-target {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.dismiss-icon-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 3px;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		--icon-size: 13px;
	}

	.dismiss-icon-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.card-desc {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.confirm-desc {
		color: var(--ink);
		font-weight: 450;
	}

	.outcome-msg {
		color: var(--ink);
	}

	.outcome-msg.outcome-err {
		color: var(--danger);
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.card-note {
		margin: 0;
		font-size: var(--text-caption);
		line-height: 1.4;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
	}

	.warn-note {
		background: color-mix(in oklch, var(--danger) 12%, transparent);
		color: var(--danger);
	}

	.auto-note {
		background: color-mix(in oklch, var(--brand) 10%, transparent);
		color: var(--ink-muted);
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: 2px;
	}
</style>
