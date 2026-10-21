<!--
  MetricGrid.svelte — Intelligent UI: Griglia di metriche e indicatori KPI.
-->
<script lang="ts">
	import StatCard, { type StatItem } from './StatCard.svelte';

	let { items = [] }: { items: StatItem[] } = $props();
</script>

<div class="metric-grid">
	{#each items as item, i (i)}
		<StatCard {...item} />
	{/each}
</div>

<style>
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--space-2);
		margin: var(--space-3) 0;
	}
</style>
