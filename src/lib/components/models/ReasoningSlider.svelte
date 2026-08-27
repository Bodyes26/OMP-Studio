<script lang="ts">
	// Slider del "thinking effort" in stile pillola: traccia spessa arrotondata,
	// parte piena col colore del tema, pallini di passo senza etichette e pomello
	// tondo. Durante il trascinamento il pomello segue il puntatore ma viene
	// attratto verso il pallino piu' vicino (effetto magnetico), cosi' la
	// selezione resta discreta ma il gesto rimane continuo.
	import { THINKING_LEVELS } from '$lib/stores/modelSettings.svelte';

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

	// Geometria: TRACK_H e' anche il diametro dell'area del pomello, KNOB_HALF il
	// raggio effettivo del pomello disegnato. Restano allineati al CSS.
	const TRACK_H = 26;
	const KNOB_HALF = 11;

	let trackEl = $state<HTMLDivElement | null>(null);
	let trackWidth = $state(0);
	let isDragging = $state(false);
	// Rapporto continuo 0..1 gia' magnetizzato: usato solo mentre si trascina.
	let dragRatio = $state(0);

	const currentIndex = $derived.by(() => {
		const idx = levelIds.indexOf(value as any);
		return idx >= 0 ? idx : 0;
	});

	const currentLevel = $derived(levels[currentIndex] || levels[0]);
	// Posizione del pomello: magnetizzata nel drag, agganciata al passo a riposo.
	const thumbRatio = $derived(isDragging ? dragRatio : currentIndex / lastIndex);
	// Corsa utile: la traccia meno il pomello, che non ne esce mai.
	const usableWidth = $derived(Math.max(1, trackWidth - TRACK_H));

	// La larghezza serve per sapere quali pallini finiscono sotto al pomello.
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

	/**
	 * Attrazione verso il passo piu' vicino: lo scostamento normalizzato dal
	 * centro del segmento viene compresso con una potenza > 1, quindi il pomello
	 * "cade" sul pallino e si stacca solo verso il confine del segmento, dove la
	 * funzione resta continua (a |d| = 0.5 la spinta vale esattamente 0.5).
	 */
	function magnetize(ratio: number): number {
		const seg = 1 / lastIndex;
		const idx = Math.round(ratio / seg);
		const center = idx * seg;
		const d = (ratio - center) / seg;
		const pulled = Math.sign(d) * (Math.abs(d) * 2) ** 2.4 * 0.5;
		return Math.min(1, Math.max(0, center + pulled * seg));
	}

	function ratioFromClientX(clientX: number): number {
		if (!trackEl) return 0;
		const rect = trackEl.getBoundingClientRect();
		// Il pomello non esce dalla traccia: l'area utile e' ridotta della sua larghezza.
		const knob = rect.height;
		const usable = Math.max(1, rect.width - knob);
		return Math.min(1, Math.max(0, (clientX - rect.left - knob / 2) / usable));
	}

	function updateFromClientX(clientX: number) {
		if (disabled || !trackEl) return;
		const raw = ratioFromClientX(clientX);
		dragRatio = magnetize(raw);
		const next = levelIds[Math.round(raw * lastIndex)];
		if (next && next !== value) onChange?.(next);
	}

	function handlePointerDown(e: PointerEvent) {
		if (disabled) return;
		e.preventDefault();
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
			// il puntatore puo' essere gia' stato rilasciato dal browser
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (disabled) return;
		let delta = 0;
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = 1;
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -1;
		else if (e.key === 'Home') delta = -levels.length;
		else if (e.key === 'End') delta = levels.length;
		else return;

		e.preventDefault();
		const nextIndex = Math.min(lastIndex, Math.max(0, currentIndex + delta));
		const next = levelIds[nextIndex];
		if (next && next !== value) onChange?.(next);
	}
</script>

<div class="reasoning-slider-box" class:disabled>
	<div class="slider-header">
		<div class="header-left">
			<svg class="brain-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
				<path d="M4.5 9.5a2.5 2.5 0 0 1-2.5-2.5c0-1.2.8-2.2 2-2.4a3 3 0 0 1 5.5-1.1 3 3 0 0 1 4.5 3.5c.9.4 1.5 1.4 1.5 2.5a2.5 2.5 0 0 1-2.5 2.5M8 3.5V14M5.5 14h5" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			<span class="level-chip">{currentLevel.id}</span>
		</div>
		<span class="level-desc">{currentLevel.desc}</span>
	</div>

	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={trackEl}
		role="slider"
		tabindex="0"
		aria-label="Reasoning / Thinking Effort"
		aria-valuemin="0"
		aria-valuemax={lastIndex}
		aria-valuenow={currentIndex}
		aria-valuetext={currentLevel.id}
		class="slider-track"
		class:dragging={isDragging}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		onkeydown={handleKeydown}
	>
		<div class="track-fill" style="--pos: {thumbRatio};"></div>

		{#each levels as lvl, i (lvl.id)}
			{@const stepRatio = i / lastIndex}
			{@const gapPx = Math.abs(stepRatio - thumbRatio) * usableWidth}
			<span
				class="tick-dot"
				class:filled={stepRatio <= thumbRatio + 0.001}
				class:covered={gapPx < KNOB_HALF + 1}
				class:near={gapPx < KNOB_HALF * 2.4}
				style="--pos: {stepRatio};"
			></span>
		{/each}

		<div class="slider-thumb" style="--pos: {thumbRatio};"></div>
	</div>
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
		color: var(--brand-ink);
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

	/* Traccia a pillola: l'altezza definisce anche il diametro del pomello. */
	.slider-track {
		position: relative;
		height: 26px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--ink) 10%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 6%, transparent);
		cursor: pointer;
		outline: none;
		touch-action: none;
	}

	.slider-track:focus-visible {
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--ink) 6%, transparent),
			0 0 0 2px color-mix(in srgb, var(--brand) 55%, transparent);
	}

	/* La parte piena arriva al centro del pomello: mezzo pomello + corsa percorsa. */
	.track-fill {
		position: absolute;
		inset: 0;
		width: calc(13px + var(--pos) * (100% - 26px));
		border-radius: var(--radius-full);
		background: var(--brand);
		transition: width var(--dur-fast) var(--ease-out);
	}

	.slider-track.dragging .track-fill {
		transition: none;
	}

	.tick-dot {
		position: absolute;
		top: 50%;
		left: calc(13px + var(--pos) * (100% - 26px));
		transform: translate(-50%, -50%);
		width: 4px;
		height: 4px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--ink) 28%, transparent);
		z-index: 1;
		pointer-events: none;
		transition:
			transform var(--dur-fast) var(--ease-out),
			opacity var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out);
	}

	.tick-dot.filled {
		background: color-mix(in srgb, var(--on-brand) 65%, transparent);
	}

	/* Feedback del magnetismo: il pallino accanto al pomello si allarga. */
	.tick-dot.near {
		transform: translate(-50%, -50%) scale(1.5);
	}

	/* Il pallino finito sotto al pomello non deve spuntare. */
	.tick-dot.covered {
		opacity: 0;
	}

	.slider-thumb {
		position: absolute;
		top: 50%;
		left: calc(13px + var(--pos) * (100% - 26px));
		transform: translate(-50%, -50%);
		width: 22px;
		height: 22px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, #fff 90%, var(--brand));
		box-shadow:
			0 1px 4px color-mix(in srgb, #000 30%, transparent),
			0 0 0 1px color-mix(in srgb, #000 8%, transparent);
		z-index: 2;
		pointer-events: none;
		transition:
			left var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}

	.slider-track.dragging .slider-thumb {
		transition: transform var(--dur-fast) var(--ease-out);
		transform: translate(-50%, -50%) scale(1.06);
	}
</style>
