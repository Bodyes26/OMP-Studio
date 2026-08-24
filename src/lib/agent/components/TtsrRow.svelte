<script lang="ts">
	// Riga TTSR (Turn-by-Turn System Prompt Rules / Regole di contesto).
	// Mostra le regole richiamate per il turno corrente in monospazio.
	import type { TtsrEntry } from '../session.svelte';

	let { entry }: { entry: TtsrEntry } = $props();
</script>

<div class="ttsr-row">
	<div class="main-line">
		<span class="label">Regole richiamate:</span>
		{#if entry.rules && entry.rules.length > 0}
			<div class="rules-list">
				{#each entry.rules as rule, i (i)}
					<span class="rule-chip">{rule}</span>
				{/each}
			</div>
		{:else}
			<span class="empty">nessuna</span>
		{/if}
	</div>
</div>

<style>
	.ttsr-row {
		width: 100%;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		padding: var(--space-1) 0;
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.main-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		flex-wrap: wrap;
	}

	.label {
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.rules-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		min-width: 0;
	}

	.rule-chip {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: 1px var(--space-1);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		user-select: text;
	}

	.empty {
		color: var(--ink-faint);
		font-style: italic;
	}
</style>
