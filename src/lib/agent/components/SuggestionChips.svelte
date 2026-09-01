<script lang="ts">
	// Riga di chip per i suggerimenti di prompt (statici e dinamici).
	//
	// Mostra i preset configurati e i suggerimenti leggeri proposti dal modello
	// alla fine del turno. Cliccare o premere Alt+N precompila il composer.

	import type { SuggestionChipItem } from '$lib/stores/promptSuggestions';

	let {
		chips,
		onSelect
	} = $props<{
		chips: SuggestionChipItem[];
		onSelect: (prompt: string) => void;
	}>();

	let focusedIndex = $state(0);
	let chipElements = $state<(HTMLButtonElement | null)[]>([]);

	$effect(() => {
		if (focusedIndex >= chips.length && chips.length > 0) {
			focusedIndex = 0;
		}
	});

	function handleKeydown(event: KeyboardEvent, index: number) {
		if (chips.length === 0) return;

		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
			event.preventDefault();
			const next = (index + 1) % chips.length;
			focusedIndex = next;
			chipElements[next]?.focus();
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
			event.preventDefault();
			const prev = (index - 1 + chips.length) % chips.length;
			focusedIndex = prev;
			chipElements[prev]?.focus();
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusedIndex = 0;
			chipElements[0]?.focus();
		} else if (event.key === 'End') {
			event.preventDefault();
			const last = chips.length - 1;
			focusedIndex = last;
			chipElements[last]?.focus();
		}
	}
</script>

{#if chips.length > 0}
	<div class="suggestion-chips" role="toolbar" aria-label="Suggerimenti prompt">
		{#each chips as chip, index (chip.id)}
			<button
				type="button"
				class="suggestion-chip"
				class:dynamic={chip.isDynamic}
				bind:this={chipElements[index]}
				tabindex={focusedIndex === index ? 0 : -1}
				onclick={() => onSelect(chip.prompt)}
				onkeydown={(e) => handleKeydown(e, index)}
				title={chip.title}
				aria-label="{chip.label} (Alt+{chip.shortcutNumber})"
			>
				<span class="chip-label">{chip.label}</span>
				<kbd class="key-badge">Alt+{chip.shortcutNumber}</kbd>
			</button>
		{/each}
	</div>
{/if}

<style>
	.suggestion-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border-top: 1px solid var(--line);
		font-size: var(--text-xs);
		line-height: 1.3;
	}

	.suggestion-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-1);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		line-height: 1.2;
		user-select: none;
		transition: background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.suggestion-chip:hover {
		background: var(--bg-hover);
		border-color: var(--line);
		color: var(--ink);
	}

	.suggestion-chip:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.suggestion-chip.dynamic {
		color: var(--ink-muted);
	}

	.suggestion-chip.dynamic:hover {
		color: var(--ink);
	}

	.chip-label {
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.key-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 1px 4px;
		min-width: 14px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
		line-height: 1.2;
		white-space: nowrap;
	}

	.suggestion-chip:hover .key-badge {
		color: var(--ink);
	}
</style>
