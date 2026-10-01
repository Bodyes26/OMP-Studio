<script lang="ts">
	// Slider del "thinking effort" in stile pillola: traccia spessa arrotondata,
	// parte piena col colore del tema, pallini di passo senza etichette e pomello
	// tondo. Durante il trascinamento il pomello segue il puntatore ma viene
	// attratto verso il pallino piu' vicino (effetto magnetico), cosi' la
	// selezione resta discreta ma il gesto rimane continuo.
	import { THINKING_LEVELS } from '$lib/stores/modelSettings.svelte';
	import { IconBrain } from '$lib/icons';
	import Slider from '$lib/ui/Slider.svelte';

	let {
		value = 'auto',
		disabled = false,
		onChange
	} = $props<{
		value?: string;
		disabled?: boolean;
		onChange?: (val: string) => void;
	}>();

	const levels = THINKING_LEVELS;
	const levelIds = levels.map((l) => l.id);
	const lastIndex = levels.length - 1;

	const currentIndex = $derived.by(() => {
		const idx = levelIds.indexOf(value as any);
		return idx >= 0 ? idx : 0;
	});

	const currentLevel = $derived(levels[currentIndex] || levels[0]);

	function handleSliderChange(val: number) {
		const next = levelIds[val];
		if (next && next !== value) {
			onChange?.(next);
		}
	}
</script>

<div class="reasoning-slider-box" class:disabled>
	<div class="slider-header">
		<div class="header-left">
			<span class="brain-icon" aria-hidden="true">
				<IconBrain />
			</span>
			<span class="level-chip">{currentLevel.id}</span>
		</div>
		<span class="level-desc">{currentLevel.desc}</span>
	</div>

	<Slider
		min={0}
		max={lastIndex}
		step={1}
		value={currentIndex}
		valueText={currentLevel.id}
		label="Reasoning / Thinking Effort"
		{disabled}
		onChange={handleSliderChange}
	/>
</div>

<style>
	.reasoning-slider-box {
		padding: 10px 12px;
		background: color-mix(in srgb, var(--bg-base) 80%, var(--bg-sunken));
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		user-select: none;
	}

	.reasoning-slider-box.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.slider-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 10px;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.brain-icon {
		--icon-size: 13px;
		color: var(--brand-ink);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.level-chip {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 1px 7px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--brand) 18%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
		letter-spacing: 0.02em;
		line-height: 1.4;
	}

	.level-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-family: var(--font-mono);
		white-space: nowrap;
	}
</style>
