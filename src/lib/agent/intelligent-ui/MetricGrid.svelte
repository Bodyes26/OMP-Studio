<!--
  MetricGrid.svelte — Intelligent UI: Griglia di metriche e indicatori KPI.
-->
<script lang="ts">
	import StatCard, { type StatItem } from './StatCard.svelte';

	let { items = [] }: { items: StatItem[] } = $props();
</script>

<div class="metric-grid-container">
	<div class="metric-grid">
		{#each items as item, i (i)}
			<StatCard {...item} />
		{/each}
	</div>
</div>

<style>
	.metric-grid-container {
		/* Container query per adattare il numero di colonne alla larghezza della colonna chat */
		container-type: inline-size;
		margin: var(--space-3) 0;
	}

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--space-2);
	}

	/* Sotto 480px collassa a 2 colonne fluide; sotto 300px a 1 colonna per preservare la leggibilita' */
	@container (max-width: 480px) {
		.metric-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 6px;
		}
	}

	@container (max-width: 300px) {
		.metric-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
