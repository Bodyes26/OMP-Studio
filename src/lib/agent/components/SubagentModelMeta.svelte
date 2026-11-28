<script lang="ts">
	// Riga di metadati di un subagente (provider, modello, ragionamento, ripiego,
	// tipo, retry, contesto, costo). Unica per vassoio, traccia in chat e cassetto
	// cosi' le tre viste non divergono (VSUB-008).
	import { m } from '#lib/paraglide/messages.js';
	import { providerLabel } from '#lib/components/setup/setupProviders.ts';
	import type { AgentProgress } from '../wire';
	import { describeSubagentModel, formatSubagentCost } from '../subagentActivity';

	let {
		progress,
		name,
		class: className = ''
	}: { progress: AgentProgress; name?: string; class?: string } = $props();

	const info = $derived(describeSubagentModel(progress, name));
	const provider = $derived(providerLabel(info.providerId));
	const visible = $derived(
		Boolean(info.model || info.effort || info.agentType || info.retry || info.cost !== undefined) ||
			info.contextPct !== undefined
	);
</script>

{#if visible}
	<span class="sub-meta {className}">
		{#if info.model}
			<span class="item model" title={progress.resolvedModel}>
				{#if provider}<span class="provider">{provider}</span> · {/if}{info.model}
			</span>
		{/if}
		{#if info.effort}
			<span class="item" title={m.subagent_meta_effort_hint()}>{info.effort}</span>
		{/if}
		{#if info.fallback}
			<span class="badge" title={m.subagent_meta_fallback_hint()}>{m.subagent_meta_fallback()}</span>
		{/if}
		{#if info.retry}
			<span class="badge" title={info.retry.error}>
				{m.subagent_meta_retry({ attempt: info.retry.attempt, max: info.retry.max })}
			</span>
		{/if}
		{#if info.agentType}
			<span class="item type">{info.agentType}</span>
		{/if}
		{#if info.contextPct !== undefined}
			<span
				class="item num"
				title={m.subagent_meta_context_hint({
					tokens: (info.contextTokens ?? 0).toLocaleString(),
					window: (info.contextWindow ?? 0).toLocaleString()
				})}
			>
				{m.subagent_meta_context({ pct: info.contextPct })}
			</span>
		{/if}
		{#if info.cost !== undefined}
			<span class="item num">{formatSubagentCost(info.cost)}</span>
		{/if}
	</span>
{/if}

<style>
	.sub-meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		column-gap: 6px;
		row-gap: 2px;
		min-width: 0;
		font-size: var(--text-meta);
		color: var(--ink-faint);
		line-height: 1.4;
	}
	/* Separatore solo fra voci: i badge si distinguono gia' per il riquadro. */
	.item + .item::before {
		content: '·';
		margin-right: 6px;
		color: var(--ink-faint);
	}
	.model {
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.provider {
		font-weight: 600;
	}
	.type {
		font-family: var(--font-mono);
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.badge {
		padding: 0 5px;
		border-radius: var(--radius-sm);
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
	}
</style>
