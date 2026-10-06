<script lang="ts">
	// Slider del thinking: unico controllo per il livello di ragionamento in tutta
	// Studio (Task Editor, Ruoli, popover del composer della chat). Sopra la traccia
	// solo il nome del livello, nell'accento per testo; la descrizione resta nel
	// valore accessibile. Chi lo usa sceglie quali livelli offrire: la chat non ha
	// «Auto», che vale solo per task e ruoli, e ogni superficie toglie gli sforzi
	// che il modello scelto non accetta. Un valore salvato fuori scala si mostra
	// sul livello a cui omp lo riporta, senza riscriverlo: tornando a un modello
	// che lo accetta riappare com'era.
	import { m } from '$lib/paraglide/messages.js';
	import { THINKING_LEVELS } from '$lib/stores/modelSettings.svelte';
	import { clampThinkingLevel } from '$lib/stores/modelSettingsHelpers';
	import Slider from '$lib/ui/Slider.svelte';

	type LevelId = (typeof THINKING_LEVELS)[number]['id'];

	let {
		value = 'auto',
		levels,
		disabled = false,
		onChange
	} = $props<{
		value?: string;
		levels?: readonly LevelId[];
		disabled?: boolean;
		onChange?: (val: string) => void;
	}>();

	const offered = $derived(
		levels ? THINKING_LEVELS.filter((level) => levels.includes(level.id)) : THINKING_LEVELS
	);
	const lastIndex = $derived(offered.length - 1);

	const currentIndex = $derived.by(() => {
		const shown = clampThinkingLevel(
			value,
			offered.map((level) => level.id)
		);
		const idx = offered.findIndex((level) => level.id === shown);
		return idx >= 0 ? idx : 0;
	});

	const currentLevel = $derived(offered[currentIndex] ?? offered[0]);

	function handleSliderChange(val: number) {
		const next = offered[val]?.id;
		if (next && next !== value) {
			onChange?.(next);
		}
	}
</script>

<div class="reasoning-slider" class:disabled>
	<span class="level-name" aria-hidden="true">{currentLevel.label}</span>
	<Slider
		min={0}
		max={lastIndex}
		step={1}
		value={currentIndex}
		valueText={`${currentLevel.label}: ${currentLevel.desc}`}
		label={m.reasoning_slider_label()}
		{disabled}
		onChange={handleSliderChange}
	/>
</div>

<style>
	.reasoning-slider {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		user-select: none;
	}

	.reasoning-slider.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.level-name {
		align-self: center;
		font-size: var(--text-title);
		font-weight: 550;
		line-height: 1.3;
		color: var(--brand-ink);
		font-variant-numeric: tabular-nums;
	}
</style>
