<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Riga TTSR (Turn-by-Turn System Prompt Rules / Regole di contesto).
	// Linguaggio v2: traccia leggera (12.5px, --ink-muted, icona 14px).
	import type { TtsrEntry } from '../session.svelte';
	import { IconRule } from '$lib/icons';

	let { entry, fresh = false }: { entry: TtsrEntry; fresh?: boolean } = $props();
</script>

<div
	class="ttsr-row"
	class:rv-blur={fresh}
	style={fresh ? '--dur: 400ms; --blur: 4px;' : undefined}
>
	<div class="main-line">
		<span class="row-icon" aria-hidden="true">
			<IconRule />
		</span>
		<span class="label">Regole di contesto:</span>
		{#if entry.rules && entry.rules.length > 0}
			<div class="rules-list">
				{#each entry.rules as rule, i (i)}
					<span class="rule-chip">{rule}</span>
				{/each}
			</div>
		{:else}
			<span class="empty">{m.ui_ttsrrow_nessuna_c7b1()}</span>
		{/if}
	</div>
</div>

<style>
	.ttsr-row {
		width: 100%;
		padding: 2px 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--ink-muted);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.main-line {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex-wrap: wrap;
	}

	.row-icon {
		--icon-size: 14px;
		width: 14px;
		height: 14px;
		color: var(--ink-faint);
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.label {
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.rules-list {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		min-width: 0;
	}

	.rule-chip {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		user-select: text;
	}

	.empty {
		color: var(--ink-faint);
		font-style: italic;
	}
</style>
