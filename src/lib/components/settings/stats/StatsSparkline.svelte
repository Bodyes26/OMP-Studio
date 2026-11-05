<script lang="ts">
	/**
	 * Andamento senza assi sotto un KPI: dice la direzione, non il valore.
	 * Quando cambiano i punti o l'intervallo, esegue un crossfade sobrio
	 * mantenendo la dimensione stabile senza scatti o ricostruzioni brusche.
	 */
	import { fade } from 'svelte/transition';
	import { revealEase } from '#lib/agent/motion.ts';
	import { motionReduced } from '#lib/agent/motionState.svelte.ts';

	let { values }: { values: number[] } = $props();

	const max = $derived(Math.max(...values, 0));
	const points = $derived(
		values.length < 2 || max <= 0
			? ''
			: values
					.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(22 - (v / max) * 20).toFixed(2)}`)
					.join(' ')
	);
</script>

<div class="spark-wrap">
	{#key points}
		<div
			class="spark-layer"
			in:fade={{ duration: motionReduced() ? 0 : 350, easing: revealEase }}
			out:fade={{ duration: motionReduced() ? 0 : 200, easing: revealEase }}
		>
			{#if points}
				<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
					<polygon class="area" points={`0,24 ${points} 100,24`} />
					<polyline class="line" points={points} />
				</svg>
			{:else}
				<div class="spark spark-flat" aria-hidden="true"></div>
			{/if}
		</div>
	{/key}
</div>

<style>
	.spark-wrap {
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		width: 100%;
		height: 24px;
		overflow: hidden;
	}

	.spark-layer {
		grid-area: 1 / 1;
		width: 100%;
		height: 100%;
	}

	.spark {
		display: block;
		width: 100%;
		height: 24px;
		overflow: visible;
	}

	.area {
		fill: color-mix(in srgb, var(--brand) 10%, transparent);
	}

	.line {
		fill: none;
		stroke: var(--brand);
		stroke-width: 1.5;
		stroke-linejoin: round;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}

	.spark-flat {
		border-bottom: 1px solid var(--line);
		height: 23px;
	}
</style>
