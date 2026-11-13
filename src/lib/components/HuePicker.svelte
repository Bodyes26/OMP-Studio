<script lang="ts">
	/**
	 * Selettore di tinta per l'identita' di un progetto.
	 *
	 * Il modello dati del progetto conserva **una tinta**, non un colore:
	 * luminosita' e croma arrivano dai token del tema (`--proj-l-fill`,
	 * `--proj-c-fill`). Un selettore RGB, come quello nativo del browser,
	 * promette sedici milioni di colori e ne consegna trecentosessanta: il
	 * pastello scelto tornava saturo perche' della scelta sopravviveva solo la
	 * tinta. Qui si sceglie l'unica cosa che il sistema sa rappresentare, e
	 * ogni colore mostrato e' esattamente il colore che prendera' la tessera.
	 */
	import { projectPaletteFor, THEMES } from '#lib/theme.ts';
	import { themeStore } from '#lib/stores/theme.svelte.ts';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import { IconCheck } from '#lib/icons.ts';
	import { m } from '#lib/paraglide/messages.js';

	let { hue, mode, autoHue, onhue, onauto } = $props<{
		/** Tinta scelta a mano, in gradi. */
		hue: number;
		mode: 'auto' | 'custom';
		/** Tinta che il tema assegnerebbe da solo. */
		autoHue: number;
		onhue: (hue: number) => void;
		onauto: () => void;
	}>();

	let trackEl = $state<HTMLElement | null>(null);
	let dragging = $state(false);

	// Tredici fermate a 30 gradi: l'interpolazione in oklch fra due fermate
	// vicine prende sempre la strada breve, quindi la striscia percorre il
	// cerchio una volta sola e senza salti.
	const STOPS = Array.from({ length: 13 }, (_, index) => index * 30);
	const trackGradient = `linear-gradient(to right in oklch, ${STOPS.map(
		(stop) => `oklch(var(--proj-l-fill) var(--proj-c-fill) ${stop})`
	).join(', ')})`;

	const recommendedHues = $derived(projectPaletteFor(THEMES[themeStore.current]));
	const isPreset = $derived(recommendedHues.includes(hue));

	function chooseRandom() {
		const current = mode === 'auto' ? autoHue : hue;
		const choices = recommendedHues.filter(value => value !== current);
		onhue(choices[Math.floor(Math.random() * choices.length)]);
	}

	function hueFromClientX(clientX: number): number {
		if (!trackEl) return hue;
		const rect = trackEl.getBoundingClientRect();
		const ratio = (clientX - rect.left) / Math.max(1, rect.width);
		return Math.round(Math.min(1, Math.max(0, ratio)) * 359);
	}

	function handlePointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		dragging = true;
		trackEl?.setPointerCapture(event.pointerId);
		onhue(hueFromClientX(event.clientX));
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragging) return;
		onhue(hueFromClientX(event.clientX));
	}

	function handlePointerUp(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		if (trackEl?.hasPointerCapture(event.pointerId)) trackEl.releasePointerCapture(event.pointerId);
	}

	function handleKeydown(event: KeyboardEvent) {
		const step = event.shiftKey ? 15 : 1;
		let next: number | null = null;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = hue - step;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = hue + step;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = 359;
		if (next === null) return;
		event.preventDefault();
		event.stopPropagation();
		onhue(((next % 360) + 360) % 360);
	}
</script>

<div class="hue-picker">
	<div class="row modes">
		<Tooltip text={m.l10n_cmp_hue_auto_theme_title()}>
			<button type="button" class="mode" class:selected={mode === 'auto'} style="--mode-hue: {autoHue}" onclick={onauto} aria-pressed={mode === 'auto'}>
				<span class="mode-dot"></span>
				<span>{m.l10n_cmp_hue_auto_theme_label()}</span>
				{#if mode === 'auto'}<IconCheck aria-hidden="true" style="--icon-size: 12px" />{/if}
			</button>
		</Tooltip>
		<button type="button" class="mode" onclick={chooseRandom}>{m.project_tabs_core_random_color()}</button>
	</div>
	<span class="presets-label">{m.project_tabs_core_recommended_colors()}</span>
	<div class="presets" role="group" aria-label={m.l10n_cmp_hue_presets_aria()}>
		{#each recommendedHues as preset (preset)}
			<Tooltip text={m.l10n_cmp_hue_preset_title({ deg: preset })}>
				<button type="button" class="swatch" class:selected={mode === 'custom' && hue === preset} style="--swatch-hue: {preset}" onclick={() => onhue(preset)} aria-pressed={mode === 'custom' && hue === preset} aria-label={m.l10n_cmp_hue_preset_aria({ deg: preset })}></button>
			</Tooltip>
		{/each}
	</div>

	<div class="row">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="track"
			bind:this={trackEl}
			role="slider"
			tabindex="0"
			aria-label={m.l10n_cmp_hue_slider_aria()}
			aria-valuemin="0"
			aria-valuemax="359"
			aria-valuenow={hue}
			aria-valuetext={m.l10n_cmp_hue_slider_valuetext({ deg: hue })}
			style="background: {trackGradient}"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			onkeydown={handleKeydown}
		>
			<span
				class="thumb"
				class:muted={mode === 'auto'}
				style="--thumb-hue: {mode === 'auto' ? autoHue : hue}; left: {((mode === 'auto' ? autoHue : hue) / 359) * 100}%"
			></span>
		</div>
		<span class="value" class:muted={mode === 'auto'}>
			{mode === 'auto' ? autoHue : hue}°{#if mode === 'custom' && !isPreset}<span class="value-tag">{m.l10n_cmp_hue_custom_tag()}</span>{/if}
		</span>
	</div>
</div>

<style>
	.hue-picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.mode {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		height: 22px;
		padding: 0 var(--space-1);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-faint);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		flex: none;
	}

	.mode:hover,
	.mode.selected {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.mode-dot {
		width: 12px;
		height: 12px;
		border-radius: var(--radius-full);
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--mode-hue));
	}

	.presets-label {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.modes { justify-content: space-between; }

	.presets {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 2px 0 6px;
	}

	.swatch {
		width: 24px;
		height: 24px;
		padding: 0;
		border-radius: var(--radius-full);
		border: 2px solid transparent;
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--swatch-hue));
		cursor: pointer;
		transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.swatch:hover {
		transform: scale(1.2);
	}

	.swatch.selected {
		border-color: var(--ink);
	}

	.track {
		position: relative;
		flex: 1;
		min-width: 0;
		height: 10px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line);
		cursor: pointer;
		touch-action: none;
	}

	.thumb {
		position: absolute;
		top: 50%;
		width: 14px;
		height: 14px;
		margin-left: -7px;
		border-radius: var(--radius-full);
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--thumb-hue));
		border: 2px solid var(--bg-overlay);
		outline: 1px solid var(--ink);
		transform: translateY(-50%);
		pointer-events: none;
	}

	.thumb.muted {
		outline-color: var(--ink-faint);
	}

	.value {
		flex: none;
		min-width: 46px;
		text-align: right;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
	}

	.value.muted {
		color: var(--ink-faint);
	}

	.value-tag {
		display: block;
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}
</style>
