<script lang="ts">
	// JSON pieghevole: il ripiego quando non c'e' niente di meglio da dire su
	// un payload. Usato da `Generic` e dai renderer per gli argomenti che non
	// hanno una forma propria.
	let { value, label = 'argomenti' } = $props<{ value: unknown; label?: string }>();

	let open = $state(false);

	const text = $derived.by(() => {
		try {
			return JSON.stringify(value, null, 2) ?? '';
		} catch {
			// Riferimenti circolari non arrivano dal filo, ma un oggetto con un
			// getter che lancia si: meglio una riga onesta che una card rotta.
			return '(payload non serializzabile)';
		}
	});
	const lineCount = $derived(text ? text.split('\n').length : 0);
</script>

{#if text && text !== '{}'}
	<details bind:open>
		<summary>{label} · {lineCount} righe</summary>
		<pre>{text}</pre>
	</details>
{/if}

<style>
	details {
		min-width: 0;
	}

	summary {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary::before {
		content: '▸ ';
	}

	details[open] summary::before {
		content: '▾ ';
	}

	summary:hover {
		color: var(--ink);
	}

	pre {
		margin: var(--space-1) 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
</style>
