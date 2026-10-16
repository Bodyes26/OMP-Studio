<!--
  MiniMachine.svelte — Card filtro macchina in cima all'Inbox (Variante A).
-->
<script lang="ts">
	import type { HostSummary } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';

	let {
		host,
		active = false,
		workingCount = 0,
		onclick
	}: {
		host?: HostSummary | null;
		isAll?: boolean;
		active?: boolean;
		workingCount?: number;
		onclick: () => void;
	} = $props();

	const isOnline = $derived(host?.online ?? true);
</script>

<button
	type="button"
	class="mini-machine-btn"
	class:is-active={active}
	class:is-offline={!isOnline}
	{onclick}
	title={host?.name ?? t('allMachinesFilter')}
	aria-pressed={active}
>
	<span class="status-indicator" class:online={isOnline} aria-hidden="true"></span>
	<div class="mini-machine-info">
		<div class="mini-machine-name">{host ? host.name : t('allMachinesFilter')}</div>
		{#if !isOnline}
			<div class="mini-machine-sub offline">
				{t('offline')}{workingCount > 0 ? ` (${workingCount})` : ''}
			</div>
		{:else if workingCount > 0}
			<div class="mini-machine-sub">{workingCount} {t('stateWorking')}</div>
		{/if}
	</div>
</button>

<style>
	.mini-machine-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: var(--radius-lg);
		background: var(--bg-base);
		border: 1px solid var(--line);
		text-align: left;
		cursor: pointer;
		min-width: 124px;
		max-width: 200px;
		flex: 0 0 auto;
		transition: all var(--dur-fast, 0.15s) ease;
		color: var(--ink);
		user-select: none;
	}

	.mini-machine-btn:hover {
		border-color: var(--line-active, var(--line));
		background: var(--bg-raised);
	}

	.mini-machine-btn.is-active {
		background: var(--bg-raised);
		border-color: var(--brand);
		box-shadow: 0 0 0 1px var(--brand);
	}

	.status-indicator {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		flex-shrink: 0;
	}

	.status-indicator.online {
		background: var(--color-success, var(--brand));
	}

	.mini-machine-info {
		min-width: 0;
		flex: 1;
	}

	.mini-machine-name {
		font-size: var(--text-caption, 12px);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.2;
	}

	.mini-machine-sub {
		font-size: var(--text-mini, 10px);
		color: var(--color-success, var(--brand));
		font-weight: 500;
		line-height: 1.2;
		margin-top: 1px;
	}

	.mini-machine-sub.offline {
		color: var(--ink-muted);
	}

	.is-offline {
		opacity: 0.75;
	}
</style>
