<script lang="ts">
	// Tabella chiave/valore a due colonne. Le righe con valore assente non
	// vengono passate qui: il filtro sta nei renderer, che sanno cosa e'
	// opzionale.
	let { rows } = $props<{ rows: { key: string; value: string }[] }>();
</script>

{#if rows.length > 0}
	<dl>
		{#each rows as row (row.key)}
			<dt>{row.key}</dt>
			<dd>{row.value}</dd>
		{/each}
	</dl>
{/if}

<style>
	dl {
		display: grid;
		grid-template-columns: minmax(80px, max-content) minmax(0, 1fr);
		gap: 2px var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
	}

	dt {
		color: var(--ink-faint);
	}

	dd {
		margin: 0;
		font-family: var(--font-mono);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
		user-select: text;
		font-variant-numeric: tabular-nums;
	}
</style>
