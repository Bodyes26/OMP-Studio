<!--
  OutputBlock.svelte — Blocco di output testuale dei comandi (bash/terminale).
  Fedele a src/lib/agent/tools/parts/OutputBlock.svelte di Studio.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';

	let { text = '', maxInitialLines = 15 } = $props<{
		text?: string;
		maxInitialLines?: number;
	}>();

	let expanded = $state(false);

	const isCapped = $derived(text.length >= 20_000);
	const lines = $derived(text ? text.split('\n') : []);
	const hasHidden = $derived(lines.length > maxInitialLines);
	const hiddenCount = $derived(hasHidden ? lines.length - maxInitialLines : 0);
	const shown = $derived.by(() => {
		if (!hasHidden || expanded) return text;
		return lines.slice(0, maxInitialLines).join('\n');
	});
</script>

{#if text}
	<div class="output">
		<pre>{shown}</pre>
		{#if isCapped}
			<div class="output-truncated-note">
				{t('chatOutputTruncated')}
			</div>
		{/if}
		{#if hasHidden}
			<button type="button" onclick={() => (expanded = !expanded)}>
				{expanded
					? t('chatCollapseOutput')
					: t('chatShowMoreLines', { count: hiddenCount })}
			</button>
		{/if}
	</div>
{/if}

<style>
	.output {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	pre {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--ink-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}

	.output-truncated-note {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--warn);
		font-style: italic;
	}

	button {
		align-self: flex-start;
		background: transparent;
		border: none;
		padding: 0;
		color: var(--ink-faint);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		cursor: pointer;
		font-variant-numeric: tabular-nums;
		transition: color var(--dur-fast) var(--ease-out);
	}

	button:hover {
		color: var(--ink);
	}
</style>
