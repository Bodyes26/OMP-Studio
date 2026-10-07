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
	let rowEl = $state<HTMLDivElement | null>(null);
	let fadeStart = $state(false);
	let fadeEnd = $state(false);

	$effect(() => {
		if (focusedIndex >= chips.length && chips.length > 0) {
			focusedIndex = 0;
		}
	});

	// Una sola riga a scorrimento: le sfumature dicono da che lato ci sono altre chip.
	function updateFades() {
		if (!rowEl) return;
		const max = rowEl.scrollWidth - rowEl.clientWidth;
		fadeStart = rowEl.scrollLeft > 1;
		fadeEnd = rowEl.scrollLeft < max - 1;
	}

	// La rotella verticale scorre la riga: la barra di scorrimento e' nascosta e
	// senza Shift un mouse non avrebbe modo di raggiungere le chip fuori vista.
	// Listener non passivo: altrimenti preventDefault viene ignorato.
	function handleWheel(event: WheelEvent) {
		if (!rowEl || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
		if (rowEl.scrollWidth <= rowEl.clientWidth) return;
		event.preventDefault();
		rowEl.scrollLeft += event.deltaY;
	}

	$effect(() => {
		const el = rowEl;
		if (!el) return;
		// Rilegge le misure anche quando cambiano le chip, non solo la larghezza.
		void chips;
		updateFades();
		const observer = new ResizeObserver(updateFades);
		observer.observe(el);
		el.addEventListener('wheel', handleWheel, { passive: false });
		return () => {
			observer.disconnect();
			el.removeEventListener('wheel', handleWheel);
		};
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
	<div
		bind:this={rowEl}
		class="suggestion-chips"
		class:fade-start={fadeStart}
		class:fade-end={fadeEnd}
		role="toolbar"
		aria-label="Suggerimenti prompt"
		onscroll={updateFades}
	>
		{#each chips as chip, index (chip.id)}
			<button
				type="button"
				class="ui-chip suggestion-chip"
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
		flex-wrap: nowrap;
		gap: var(--space-2);
		align-items: center;
		/* Il riquadro di scorrimento taglia anche in verticale: il padding lascia
		   spazio all'anello di focus, il margine negativo riallinea il bordo. */
		padding: 3px 3px;
		margin: -3px -3px calc(var(--space-2) - 3px);
		overflow-x: auto;
		scrollbar-width: none;
		font-size: var(--text-xs);
		line-height: 1.3;
		--fade: 32px;
	}

	.suggestion-chips::-webkit-scrollbar {
		display: none;
	}

	/* Solo il canale alfa conta nella maschera: var(--ink) fa da token opaco. */
	.suggestion-chips.fade-end {
		mask-image: linear-gradient(to right, var(--ink) calc(100% - var(--fade)), transparent);
	}

	.suggestion-chips.fade-start {
		mask-image: linear-gradient(to right, transparent, var(--ink) var(--fade));
	}

	.suggestion-chips.fade-start.fade-end {
		mask-image: linear-gradient(
			to right,
			transparent,
			var(--ink) var(--fade),
			var(--ink) calc(100% - var(--fade)),
			transparent
		);
	}

	.suggestion-chip {
		flex-shrink: 0;
	}

	.suggestion-chip:focus-visible {
		outline-offset: 1px;
	}

	.chip-label {
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.key-badge {
		display: inline-flex;
		align-items: center;
		padding: 0 4px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		color: var(--ink-faint);
		line-height: 1.4;
	}

	.suggestion-chip:hover .key-badge {
		color: var(--ink);
		border-color: var(--line-strong);
	}
</style>
