<!--
  StatCard.svelte — Intelligent UI: Scheda metrica / KPI con valore, variazione e trend.
-->
<script lang="ts">
	import { IconArrowUp, IconArrowDown } from '../../icons';

	export interface StatItem {
		label: string;
		value: string | number;
		change?: string | number;
		trend?: 'up' | 'down' | 'neutral';
		tone?: 'success' | 'warn' | 'danger' | 'brand' | 'neutral';
		subtext?: string;
	}

	let {
		label,
		value,
		change,
		trend,
		tone = 'neutral',
		subtext
	}: StatItem = $props();

	const isPositiveTrend = $derived(
		trend === 'up' || (typeof change === 'string' && change.trim().startsWith('+'))
	);
	const isNegativeTrend = $derived(
		trend === 'down' || (typeof change === 'string' && change.trim().startsWith('-'))
	);
</script>

<div class="stat-card tone-{tone}">
	<div class="stat-header">
		<span class="stat-label">{label}</span>
		{#if change}
			<span
				class="stat-change"
				class:up={isPositiveTrend}
				class:down={isNegativeTrend}
			>
				{#if isPositiveTrend}
					<IconArrowUp />
				{:else if isNegativeTrend}
					<IconArrowDown />
				{/if}
				{change}
			</span>
		{/if}
	</div>

	<div class="stat-value">{value}</div>

	{#if subtext}
		<div class="stat-subtext">{subtext}</div>
	{/if}
</div>

<style>
	.stat-card {
		padding: var(--space-3);
		border-radius: var(--radius-lg);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 4px;
		/* min-width: 0 permette alle card di restringersi fluidamente nella griglia senza provocare overflow */
		min-width: 0;
		flex: 1;
		transition: border-color var(--dur-fast) var(--ease-out);
		overflow: hidden;
	}

	.stat-card:hover {
		border-color: var(--line-strong);
	}

	.stat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.stat-label {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		overflow-wrap: anywhere;
	}

	.stat-change {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-overlay);
		color: var(--ink-muted);
		--icon-size: 11px;
	}

	.stat-change.up {
		color: var(--success);
		background: rgba(16, 185, 129, 0.1);
	}

	.stat-change.down {
		color: var(--danger);
		background: rgba(239, 68, 68, 0.1);
	}

	.stat-value {
		font-size: var(--text-2xl, 22px);
		font-weight: 700;
		color: var(--ink);
		letter-spacing: -0.02em;
		line-height: 1.2;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.stat-subtext {
		font-size: 11px;
		color: var(--ink-faint);
		margin-top: 2px;
	}

	/* Tonalità di bordo */
	.tone-success {
		border-left: 3px solid var(--success);
	}
	.tone-warn {
		border-left: 3px solid var(--warn);
	}
	.tone-danger {
		border-left: 3px solid var(--danger);
	}
	.tone-brand {
		border-left: 3px solid var(--brand-ink);
	}

	@container (max-width: 480px) {
		.stat-card {
			padding: 8px 10px;
		}

		.stat-value {
			font-size: var(--text-xl, 18px);
		}
	}
</style>
