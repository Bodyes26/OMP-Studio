<!--
  ComposerStatusLine.svelte — Riga di stato monospazio sotto al composer (stile TUI).
  Modello, macchina host e informazioni contestuali.
  Fedele a src/lib/agent/components/ComposerStatusLine.svelte di Studio.
-->
<script lang="ts">
	import { ProviderLogo } from '../../icons.ts';
	let {
		modelLabel = null,
		provider = null,
		machineName = ''
	}: {
		modelLabel?: string | null;
		provider?: string | null;
		machineName?: string;
	} = $props();
</script>

<div class="status-line" role="group">
	{#if machineName}
		<span class="status-entry">
			<span class="status-item">{machineName}</span>
		</span>
	{/if}
	{#if modelLabel}
		<span class="status-entry">
			<span class="status-item model">
				<ProviderLogo provider={provider || modelLabel} size={11} />
				<span>{modelLabel}</span>
			</span>
		</span>
	{/if}
</div>

<style>
	.status-line {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		column-gap: 8px;
		padding: 4px 6px 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		min-width: 0;
		overflow: hidden;
		user-select: none;
	}

	.status-entry {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}

	.status-entry + .status-entry::before {
		content: '·';
		width: 8px;
		margin-right: 8px;
		text-align: center;
		color: var(--line-strong);
	}

	.status-item {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 4px;
		color: inherit;
		font: inherit;
		white-space: nowrap;
	}

	.status-item.model {
		color: var(--ink-muted);
	}
</style>
