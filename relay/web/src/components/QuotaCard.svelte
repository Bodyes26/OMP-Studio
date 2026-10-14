<script lang="ts">
	import type { RemoteQuota } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { formatHHMM } from '../schedule.ts';

	let { quota } = $props<{ quota: RemoteQuota | null }>();
</script>

{#if quota && quota.providers.length > 0}
	<div class="quota-container">
		<h4 class="quota-header">{t('quotaTitle')}</h4>
		<div class="providers-list">
			<!-- Chiavi per posizione: piu' account dello stesso provider ripetono `provider` e Svelte
			     interrompe il rendering su una chiave doppia. -->
			{#each quota.providers as p, idx (idx)}
				<div class="provider-block">
					<div class="provider-head">
						<div class="provider-name-group">
							<span
								class="status-indicator"
								class:status-warn={p.status === 'warning'}
								class:status-danger={p.status === 'exhausted'}
							></span>
							<span class="provider-name">{p.provider}</span>
							{#if p.account}
								<span class="provider-account">{p.account}</span>
							{/if}
						</div>
						{#if p.status === 'exhausted'}
							<span class="provider-status-badge exhausted">{t('quotaExhausted')}</span>
						{:else if p.status === 'warning'}
							<span class="provider-status-badge warning">{t('quotaWarning')}</span>
						{/if}
					</div>

					<div class="windows-list">
						{#each p.windows as win, winIdx (winIdx)}
							<div class="window-row">
								<div class="window-meta">
									<span class="window-label">{win.label}</span>
									{#if win.resetsAt != null}
										<span class="window-reset">
											{t('quotaReset', { time: formatHHMM(win.resetsAt) })}
										</span>
									{/if}
								</div>

								{#if win.usedFraction != null}
									<div class="bar-track">
										<div
											class="bar-fill"
											class:fill-warn={win.usedFraction > 0.8 && win.usedFraction <= 0.95}
											class:fill-danger={win.usedFraction > 0.95}
											style:width="{Math.min(100, Math.max(0, win.usedFraction * 100))}%"
										></div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.quota-container {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.quota-header {
		font-size: 11px;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--ink-faint);
	}

	.providers-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.provider-block {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.provider-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.provider-name-group {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.status-indicator {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
	}
	.status-indicator.status-warn {
		background: var(--warn);
	}
	.status-indicator.status-danger {
		background: var(--danger);
	}

	.provider-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
	}

	.provider-account {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		color: var(--ink-faint);
	}

	.provider-status-badge {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}
	.provider-status-badge.warning {
		background: var(--warn-bg);
		color: var(--warn);
	}
	.provider-status-badge.exhausted {
		background: var(--danger-bg);
		color: var(--danger);
	}

	.windows-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.window-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.window-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
	}

	.window-label {
		color: var(--ink-muted);
	}

	.window-reset {
		color: var(--ink-faint);
		font-size: 11px;
	}

	.bar-track {
		height: 4px;
		background: var(--bg-sunken);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		background: var(--ink);
		border-radius: var(--radius-full);
		transition: width var(--dur-base) ease;
	}
	.bar-fill.fill-warn {
		background: var(--warn);
	}
	.bar-fill.fill-danger {
		background: var(--danger);
	}
</style>
