<!--
  ThinkingMeter.svelte — Indicatore grafico a barre per il livello di ragionamento / thinking.
  5 barre di altezza crescente, fedele a src/lib/agent/components/ThinkingMeter.svelte di Studio.
-->
<script lang="ts">
	let {
		level = 'off',
		off = false
	}: {
		level?: string;
		off?: boolean;
	} = $props();

	const BARS = [1, 2, 3, 4, 5];

	const activeBars = $derived.by(() => {
		if (off || level === 'off') return 0;
		switch (level) {
			case 'minimal':
				return 1;
			case 'low':
				return 2;
			case 'medium':
				return 3;
			case 'high':
				return 4;
			case 'xhigh':
			case 'max':
				return 5;
			default:
				return 0;
		}
	});
</script>

<span class="thinking-meter" aria-hidden="true">
	{#each BARS as barIndex}
		<span
			class="meter-bar"
			class:active={barIndex <= activeBars}
			style="height: {4.5 + barIndex * 1.5}px;"
		></span>
	{/each}
</span>

<style>
	.thinking-meter {
		display: inline-flex;
		align-items: flex-end;
		gap: 2px;
		height: 14px;
		padding-bottom: 1px;
		flex-shrink: 0;
	}

	.meter-bar {
		width: 3px;
		border-radius: var(--radius-full);
		background: var(--line-strong);
		transition:
			background-color var(--dur-base) var(--ease-out),
			height var(--dur-fast) var(--ease-out);
	}

	.meter-bar.active {
		background: var(--brand-ink);
	}
</style>
