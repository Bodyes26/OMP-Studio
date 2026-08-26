<script lang="ts">
	// Output monospazio con troncamento: l'output di un tool puo' essere
	// arbitrariamente lungo e la colonna e' larga ~820px su 1920.
	let {
		text,
		maxLines = 24,
		label = 'output'
	} = $props<{ text: string; maxLines?: number; label?: string }>();

	let expanded = $state(false);

	const lines = $derived(text.split('\n'));
	const hidden = $derived(Math.max(0, lines.length - maxLines));
	const shown = $derived(expanded || hidden === 0 ? text : lines.slice(0, maxLines).join('\n'));
</script>

{#if text}
	<div class="output">
		<pre>{shown}</pre>
		{#if hidden > 0}
			<button type="button" onclick={() => (expanded = !expanded)}>
				{expanded ? `Comprimi ${label}` : `${hidden} righe in più`}
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

	button {
		align-self: flex-start;
		background: transparent;
		border: none;
		padding: 0;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
		font-variant-numeric: tabular-nums;
	}

	button:hover {
		color: var(--ink);
	}
</style>
