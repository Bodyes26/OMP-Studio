<script lang="ts">
	// Loader compatto a griglia di pixel 3x3 con pattern chevron per indicare lo stato dell'agente.
	//
	// Scelte architetturali e prestazionali:
	// 1. Si anima solo 'opacity' perche e una proprieta compositabile direttamente dalla GPU
	//    tramite thread del compositor, evitando ricalcoli di layout (reflow) e ridisegno (repaint).
	// 2. Il keyframe 'pixel-on' usa steps(6) sui segmenti di transizione per limitare il carico
	//    sul compositor a un numero discreto di frame per ciclo, riducendo l'impatto energetico e
	//    termico specialmente su GPU integrate, evocando al contempo un display digitale a matrice.

	let {
		size = 'md',
		state = 'running'
	}: {
		size?: 'sm' | 'md';
		state?: 'running' | 'idle' | 'error';
	} = $props();

	// Ritardi a chevron precalcolati per la griglia 3x3 in ordine riga-maggiore.
	// Formula: (colonna + |riga - 1|) * 90ms.
	// Distribuzione:
	// [ (0+1)*90, (1+1)*90, (2+1)*90,
	//   (0+0)*90, (1+0)*90, (2+0)*90,
	//   (0+1)*90, (1+1)*90, (2+1)*90 ]
	const CHEVRON_DELAYS = [90, 180, 270, 0, 90, 180, 90, 180, 270] as const;
</script>

<span class="pixel-grid {size} {state}" aria-hidden="true">
	{#each CHEVRON_DELAYS as delay}
		<span
			class="cell"
			style={state === 'running' ? `animation-delay: ${delay}ms;` : undefined}
		></span>
	{/each}
</span>

<style>
	.pixel-grid {
		display: grid;
		grid-template-columns: repeat(3, var(--cell));
		gap: var(--gap);
		flex-shrink: 0;
	}

	.pixel-grid.md {
		--cell: 4px;
		--gap: 1.5px;
	}

	.pixel-grid.sm {
		--cell: 3px;
		--gap: 1px;
	}

	.cell {
		width: var(--cell);
		height: var(--cell);
		border-radius: 50%;
	}

	/* Stato in esecuzione: brand color e animazione d'onda asimmetrica */
	.pixel-grid.running .cell {
		background: var(--brand);
		opacity: 0.18;
		animation: pixel-on 650ms var(--ease-in-out) infinite;
	}

	/* Stato inattivo: tenue e fermo */
	.pixel-grid.idle .cell {
		background: var(--ink-faint);
		opacity: 0.5;
	}

	/* Stato errore: evidenza di fallimento, fermo */
	.pixel-grid.error .cell {
		background: var(--danger);
	}

	/* Rispetto dell'accessibilita: reduced-motion e switch globale data-animations.
	   Congeliamo le celle all'opacita di riposo 0.35 invece di fermarle su un frame casuale. */
	@media (prefers-reduced-motion: reduce) {
		.cell {
			animation: none !important;
			opacity: 0.35 !important;
		}
	}

	:global(:root[data-animations='false']) .cell {
		animation: none !important;
		opacity: 0.35 !important;
	}
</style>
