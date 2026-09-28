<script lang="ts">
	/**
	 * Indicatore grafico a barre per il livello di reasoning / thinking.
	 * 5 barre di altezza crescente (da 5px a 12px).
	 */
	import type { ThinkingLevel } from '$lib/agent/wire';

	let {
		level = 'off',
		off = false
	} = $props<{
		level?: ThinkingLevel;
		off?: boolean;
	}>();

	const BARS = [1, 2, 3, 4, 5];

	// Mappatura del livello nel numero di barre accese (0..5)
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
	}

	.meter-bar {
		width: 3px;
		border-radius: var(--radius-full);
		background: var(--line-strong);
		transition: background-color var(--dur-base) var(--ease-out),
			height var(--dur-fast) var(--ease-out);
	}

	.meter-bar.active {
		background: var(--brand-ink);
	}
</style>
