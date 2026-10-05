<script lang="ts">
	interface SliderProps {
		min?: number;
		max?: number;
		step?: number;
		value?: number;
		valueText?: string;
		label?: string;
		ariaLabel?: string;
		ariaLabelledBy?: string;
		ariaDescribedBy?: string;
		disabled?: boolean;
		onChange?: (val: number) => void;
	}

	let {
		min = 0,
		max = 100,
		step = 1,
		value = 0,
		valueText,
		label,
		ariaLabel,
		ariaLabelledBy,
		ariaDescribedBy,
		disabled = false,
		onChange
	}: SliderProps = $props();

	// Traccia da 20 px e cursore da 22 px: il disco sporge dalla traccia invece di
	// esserne contenuto, cosi' si afferra a colpo d'occhio senza bisogno di ombre.
	const TRACK_H = 20;
	const KNOB_HALF = 11;

	let trackEl = $state<HTMLDivElement | null>(null);
	let trackWidth = $state(0);
	let isDragging = $state(false);
	let dragRatio = $state(0);

	const numSteps = $derived(Math.max(1, Math.round((max - min) / (step || 1))));

	const currentRatio = $derived.by(() => {
		if (max <= min) return 0;
		return Math.min(1, Math.max(0, (value - min) / (max - min)));
	});

	const thumbRatio = $derived(isDragging ? dragRatio : currentRatio);
	const usableWidth = $derived(Math.max(1, trackWidth - TRACK_H));

	$effect(() => {
		const el = trackEl;
		if (!el) return;
		trackWidth = el.getBoundingClientRect().width;
		const obs = new ResizeObserver(() => {
			trackWidth = el.getBoundingClientRect().width;
		});
		obs.observe(el);
		return () => obs.disconnect();
	});

	function magnetize(ratio: number): number {
		if (numSteps <= 0) return ratio;
		const seg = 1 / numSteps;
		const idx = Math.round(ratio / seg);
		const center = idx * seg;
		const d = (ratio - center) / seg;
		const pulled = Math.sign(d) * (Math.abs(d) * 2) ** 2.4 * 0.5;
		return Math.min(1, Math.max(0, center + pulled * seg));
	}

	function ratioFromClientX(clientX: number): number {
		if (!trackEl) return 0;
		const rect = trackEl.getBoundingClientRect();
		const knob = rect.height || TRACK_H;
		const usable = Math.max(1, rect.width - knob);
		return Math.min(1, Math.max(0, (clientX - rect.left - knob / 2) / usable));
	}

	function updateFromClientX(clientX: number) {
		if (disabled || !trackEl) return;
		const raw = ratioFromClientX(clientX);
		dragRatio = magnetize(raw);
		const stepIndex = Math.round(raw * numSteps);
		const nextValue = Math.min(max, Math.max(min, min + stepIndex * step));
		if (nextValue !== value) {
			onChange?.(nextValue);
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (disabled) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).focus();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		isDragging = true;
		updateFromClientX(e.clientX);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging || disabled) return;
		updateFromClientX(e.clientX);
	}

	function handlePointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// pointer may have been already released
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (disabled) return;
		let delta = 0;
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
		else if (e.key === 'Home') delta = min - value;
		else if (e.key === 'End') delta = max - value;
		else if (e.key === 'PageUp') delta = step * 2;
		else if (e.key === 'PageDown') delta = -step * 2;
		else return;

		e.preventDefault();
		const nextValue = Math.min(max, Math.max(min, value + delta));
		if (nextValue !== value) {
			onChange?.(nextValue);
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={trackEl}
	role="slider"
	tabindex={disabled ? -1 : 0}
	aria-label={label ?? ariaLabel}
	aria-labelledby={ariaLabelledBy}
	aria-describedby={ariaDescribedBy}
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={value}
	aria-valuetext={valueText ?? String(value)}
	aria-disabled={disabled}
	class="slider-track"
	class:disabled
	class:dragging={isDragging}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
	onkeydown={handleKeydown}
>
	<div class="track-fill" style="--pos: {thumbRatio};"></div>

	{#if numSteps <= 30}
		{#each Array.from({ length: numSteps + 1 }) as _, i (i)}
			{@const stepRatio = i / numSteps}
			{@const gapPx = Math.abs(stepRatio - thumbRatio) * usableWidth}
			<span
				class="tick-dot"
				class:filled={stepRatio <= thumbRatio + 0.001}
				class:covered={gapPx < KNOB_HALF + 1}
				class:near={gapPx < KNOB_HALF * 2.4}
				style="--pos: {stepRatio};"
			></span>
		{/each}
	{/if}

	<div class="slider-thumb" style="--pos: {thumbRatio};"></div>
</div>

<style>
	.slider-track {
		position: relative;
		height: 20px;
		border-radius: var(--radius-full);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		cursor: pointer;
		touch-action: none;
		user-select: none;
		box-sizing: border-box;
	}

	.slider-track.disabled {
		opacity: 0.5;
		cursor: not-allowed;
		pointer-events: none;
	}

	.slider-track:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.track-fill {
		position: absolute;
		inset: -1px auto -1px -1px;
		width: calc(10px + var(--pos) * (100% - 18px));
		border-radius: var(--radius-full);
		background: var(--brand);
		transition: width var(--dur-fast, 120ms) var(--ease-out);
	}

	.slider-track.dragging .track-fill {
		transition: none;
	}

	.tick-dot {
		position: absolute;
		top: 50%;
		left: calc(9px + var(--pos) * (100% - 18px));
		transform: translate(-50%, -50%);
		width: 4px;
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		pointer-events: none;
		transition:
			transform var(--dur-fast, 120ms) var(--ease-out),
			opacity var(--dur-fast, 120ms) var(--ease-out),
			background-color var(--dur-fast, 120ms) var(--ease-out);
	}

	.tick-dot.filled {
		background: color-mix(in srgb, var(--on-brand) 60%, transparent);
	}

	.tick-dot.near {
		transform: translate(-50%, -50%) scale(1.5);
	}

	.tick-dot.covered {
		opacity: 0;
	}

	/* Anello nel colore della superficie che ospita lo slider (--slider-ring):
	   separa il disco dal riempimento senza ombra (Flat-By-Default Rule). */
	.slider-thumb {
		position: absolute;
		top: 50%;
		left: calc(9px + var(--pos) * (100% - 18px));
		transform: translate(-50%, -50%);
		width: 22px;
		height: 22px;
		box-sizing: border-box;
		border-radius: var(--radius-full);
		background: var(--ink);
		border: 2px solid var(--slider-ring, var(--bg-raised));
		pointer-events: none;
		transition:
			left var(--dur-fast, 120ms) var(--ease-out),
			transform var(--dur-fast, 120ms) var(--ease-out);
	}

	.slider-track.dragging .slider-thumb {
		transition: transform var(--dur-fast, 120ms) var(--ease-out);
		transform: translate(-50%, -50%) scale(1.06);
	}
</style>
