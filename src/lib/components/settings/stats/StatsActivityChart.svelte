<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import {
		formatMetric,
		metricValue,
		type StatsBucket,
		type StatsFormatters,
		type StatsMetric,
		type StatsRange
	} from '#lib/stats/usageStats.ts';

	let {
		buckets,
		metric,
		range,
		f
	}: { buckets: StatsBucket[]; metric: StatsMetric; range: StatsRange; f: StatsFormatters } = $props();

	let hovered = $state<number | null>(null);

	const values = $derived(buckets.map((b) => metricValue(b, metric)));
	const max = $derived(Math.max(...values, 0));
	const peakIndex = $derived(max > 0 ? values.indexOf(max) : -1);
	// Ogni barra occupa uno slot da 10 unita': 7 di barra, 3 di respiro.
	const width = $derived(Math.max(buckets.length, 1) * 10);

	const label = (b: StatsBucket) => (range === '24h' ? f.dayHour(b.start) : f.day(b.start));
	const axisLabel = (b: StatsBucket) => (range === '24h' ? f.hour(b.start) : f.day(b.start));

	const focus = $derived(hovered ?? peakIndex);
	const readout = $derived(
		focus >= 0 && buckets[focus]
			? `${label(buckets[focus])} · ${formatMetric(f, metric, values[focus])}`
			: ''
	);
	const ariaSummary = $derived(
		peakIndex >= 0
			? m.settings_stats_activity_aria({
					peak: formatMetric(f, metric, max),
					when: label(buckets[peakIndex])
				})
			: m.settings_stats_empty_range()
	);
	const ticks = $derived(
		buckets.length > 2 ? [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1] : buckets.map((_, i) => i)
	);
</script>

<figure class="chart" aria-label={ariaSummary}>
	<div class="chart-head">
		<span class="readout tabular" class:peak={hovered === null}>
			{#if readout}
				{#if hovered === null}<span class="readout-tag">{m.settings_stats_peak()}</span>{/if}
				{readout}
			{/if}
		</span>
		<span class="max tabular">{max > 0 ? formatMetric(f, metric, max) : ''}</span>
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		class="bars"
		viewBox={`0 0 ${width} 100`}
		preserveAspectRatio="none"
		aria-hidden="true"
		onmouseleave={() => (hovered = null)}
	>
		<line class="baseline" x1="0" x2={width} y1="100" y2="100" />
		<line class="grid" x1="0" x2={width} y1="0.5" y2="0.5" />
		{#each buckets as b, i (b.start)}
			{@const v = values[i]}
			{@const h = max > 0 ? Math.max((v / max) * 100, v > 0 ? 1.5 : 0) : 0}
			<rect class="hit" x={i * 10} y="0" width="10" height="100" onmouseenter={() => (hovered = i)} />
			<rect class="bar" class:active={focus === i} x={i * 10 + 1.5} y={100 - h} width="7" height={h} />
		{/each}
	</svg>
	<div class="axis tabular" aria-hidden="true">
		{#each ticks as i (i)}
			<span>{buckets[i] ? axisLabel(buckets[i]) : ''}</span>
		{/each}
	</div>
</figure>

<style>
	.chart {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.chart-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
		min-height: 16px;
		font-size: var(--text-meta);
	}

	.readout {
		color: var(--ink);
	}

	.readout.peak {
		color: var(--ink-muted);
	}

	.readout-tag {
		color: var(--ink-faint);
		margin-right: 4px;
	}

	.max {
		color: var(--ink-faint);
	}

	.bars {
		display: block;
		width: 100%;
		height: 120px;
	}

	.baseline {
		stroke: var(--line-strong);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.grid {
		stroke: var(--line);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}

	.hit {
		fill: transparent;
	}

	.bar {
		fill: color-mix(in oklch, var(--brand) 55%, var(--bg-raised));
		pointer-events: none;
		transition: fill var(--dur-fast) var(--ease-out);
	}

	.bar.active {
		fill: var(--brand);
	}

	.axis {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.tabular {
		font-variant-numeric: tabular-nums;
	}
</style>
