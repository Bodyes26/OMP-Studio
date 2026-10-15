<!--
  QuotaCard.svelte — Scheda compatta ed espandibile delle quote modello.
  Linguaggio Studio: barre di avanzamento meter .limit-bar / .limit-fill,
  colori semantici da token (--quota-ok, --warn, --danger), numeri tabulari in mono.
-->
<script lang="ts">
	import type { RemoteQuota } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { formatHHMM } from '../schedule.ts';
	import { IconQuota, IconChevronDown, IconChevronUp } from '../icons.ts';

	let { quota } = $props<{ quota: RemoteQuota | null }>();

	let isExpanded = $state(false);

	const hasWarningOrExhausted = $derived.by(() => {
		if (!quota) return false;
		return quota.providers.some((p: { status: string }) => p.status === 'warning' || p.status === 'exhausted');
	});

	function getTone(usedFraction: number | null, status: string): 'ok' | 'warn' | 'bad' {
		if (status === 'exhausted' || (usedFraction != null && usedFraction >= 1)) return 'bad';
		if (status === 'warning' || (usedFraction != null && usedFraction >= 0.8)) return 'warn';
		return 'ok';
	}
</script>

{#if quota && quota.providers.length > 0}
	<div class="quota-card" class:expanded={isExpanded}>
		<button
			type="button"
			class="quota-toggle"
			onclick={() => (isExpanded = !isExpanded)}
			aria-expanded={isExpanded}
		>
			<div class="toggle-lead">
				<span class="quota-icon" aria-hidden="true"><IconQuota /></span>
				<span class="quota-title">{t('quotaTitle')}</span>
				<span class="sep" aria-hidden="true">·</span>
				<span class="providers-count">
					{quota.providers.length} {quota.providers.length === 1 ? 'provider' : 'provider'}
				</span>
				{#if hasWarningOrExhausted}
					<span class="status-dot-warn" title={t('quotaWarning')}></span>
				{/if}
			</div>

			<span class="chevron" aria-hidden="true">
				{#if isExpanded}
					<IconChevronUp />
				{:else}
					<IconChevronDown />
				{/if}
			</span>
		</button>

		{#if isExpanded}
			<div class="quota-body">
				{#each quota.providers as p, idx (idx)}
					<div class="provider-group">
						<div class="provider-header">
							<div class="provider-id">
								<span class="provider-name">{p.provider}</span>
								{#if p.account}
									<span class="provider-account">{p.account}</span>
								{/if}
							</div>
							{#if p.status === 'exhausted'}
								<span class="status-tag bad">{t('quotaExhausted')}</span>
							{:else if p.status === 'warning'}
								<span class="status-tag warn">{t('quotaWarning')}</span>
							{/if}
						</div>

						<div class="windows-grid">
							{#each p.windows as win, winIdx (winIdx)}
								{@const tone = getTone(win.usedFraction, p.status)}
								{@const remPct = win.usedFraction != null ? Math.max(0, Math.min(100, Math.round((1 - win.usedFraction) * 100))) : null}

								<div class="limit-row" data-tone={tone}>
									<div class="limit-top">
										<span class="limit-label">{win.label || 'Richieste'}</span>
										<div class="limit-readout">
											<span class="status-token">
												{tone === 'bad' ? 'CRIT' : tone === 'warn' ? 'WARN' : 'OK'}
											</span>
											{#if remPct !== null}
												<span class="sep" aria-hidden="true">·</span>
												<span class="pct-val">{remPct}%</span>
											{/if}
										</div>
									</div>

									{#if remPct !== null}
										<div
											class="limit-bar"
											role="meter"
											aria-valuenow={remPct}
											aria-valuemin={0}
											aria-valuemax={100}
											aria-label={win.label}
										>
											<span class="limit-fill" style="width: {remPct}%;"></span>
										</div>
									{/if}

									{#if win.resetsAt}
										<div class="limit-bottom">
											{t('quotaReset', { time: formatHHMM(win.resetsAt) })}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.quota-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.quota-toggle {
		width: 100%;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 10px;
		background: transparent;
		border: none;
		color: var(--ink);
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.quota-toggle:hover {
		background: var(--bg-hover);
	}

	.toggle-lead {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-caption);
	}

	.quota-icon {
		color: var(--ink-muted);
		--icon-size: 13px;
		display: grid;
		place-items: center;
	}

	.quota-title {
		font-weight: 500;
		color: var(--ink);
	}

	.providers-count {
		color: var(--ink-muted);
		font-variant-numeric: tabular-nums;
	}

	.status-dot-warn {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--warn);
		flex-shrink: 0;
	}

	.chevron {
		--icon-size: 13px;
		color: var(--ink-faint);
		display: grid;
		place-items: center;
	}

	.quota-body {
		padding: 12px;
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--bg-sunken);
	}

	.provider-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.provider-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.provider-id {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.provider-name {
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink);
		text-transform: capitalize;
	}

	.provider-account {
		font-size: var(--text-meta);
		color: var(--ink-muted);
		font-family: var(--font-mono);
	}

	.status-tag {
		font-size: var(--text-meta);
		font-weight: 600;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
	}

	.status-tag.warn {
		background: color-mix(in oklab, var(--warn) 15%, transparent);
		color: var(--warn);
	}

	.status-tag.bad {
		background: color-mix(in oklab, var(--danger) 15%, transparent);
		color: var(--danger);
	}

	.windows-grid {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.limit-row {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.limit-row[data-tone='ok'] {
		--row-color: var(--quota-ok, var(--ink-muted));
	}
	.limit-row[data-tone='warn'] {
		--row-color: var(--warn);
	}
	.limit-row[data-tone='bad'] {
		--row-color: var(--danger);
	}

	.limit-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		font-size: var(--text-caption);
	}

	.limit-label {
		color: var(--ink-muted);
		font-size: var(--text-meta);
	}

	.limit-readout {
		display: flex;
		align-items: baseline;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.status-token {
		color: var(--row-color);
		font-weight: 600;
	}

	.sep {
		color: var(--ink-faint);
	}

	.pct-val {
		color: var(--ink);
	}

	.limit-bar {
		position: relative;
		width: 100%;
		height: 4px;
		background: var(--line);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.limit-fill {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		background: var(--row-color);
		border-radius: var(--radius-full);
		transition: width var(--dur-normal) var(--ease-out);
	}

	.limit-bottom {
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}
</style>
