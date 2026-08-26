<script lang="ts">
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

	let trackEl = $state<HTMLDivElement | null>(null);
	let isDragging = $state(false);

	const currentIndex = $derived.by(() => {
		const idx = levelIds.indexOf(value as any);
		return idx >= 0 ? idx : 0;
	});

	const currentLevel = $derived(levels[currentIndex] || levels[0]);
	const progressPercent = $derived((currentIndex / (levels.length - 1)) * 100);

	function updateFromClientX(clientX: number) {
		if (disabled || !trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const targetIndex = Math.round(ratio * (levels.length - 1));
		const next = levelIds[targetIndex];
		if (next && next !== value) {
			onChange?.(next);
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (disabled) return;
		e.preventDefault();
		isDragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
			// ignore
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
		const nextIndex = Math.min(levels.length - 1, Math.max(0, currentIndex + delta));
		const next = levelIds[nextIndex];
		if (next && next !== value) {
			onChange?.(next);
		}
	}

	function handleStepClick(idx: number) {
		if (disabled) return;
		const next = levelIds[idx];
		if (next && next !== value) {
			onChange?.(next);
		}
	}
</script>

<div class="reasoning-slider-box" class:disabled>
	<div class="slider-header">
		<div class="header-left">
			<svg class="brain-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
				<path d="M4.5 9.5a2.5 2.5 0 0 1-2.5-2.5c0-1.2.8-2.2 2-2.4a3 3 0 0 1 5.5-1.1 3 3 0 0 1 4.5 3.5c.9.4 1.5 1.4 1.5 2.5a2.5 2.5 0 0 1-2.5 2.5M8 3.5V14M5.5 14h5" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			<span class="level-title">{currentLevel.label}</span>
			<span class="budget-badge">{currentLevel.budget}</span>
		</div>
		<span class="level-desc">{currentLevel.desc}</span>
	</div>

	<!-- Interactive Slider Track -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={trackEl}
		role="slider"
		tabindex="0"
		aria-label="Reasoning / Thinking Effort"
		aria-valuemin="0"
		aria-valuemax={levels.length - 1}
		aria-valuenow={currentIndex}
		aria-valuetext={currentLevel.label}
		class="slider-track-area"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		onkeydown={handleKeydown}
	>
		<div class="track-bg"></div>
		<div class="track-fill" style="transform: scaleX({progressPercent / 100});"></div>

		<!-- Step Ticks -->
		{#each levels as lvl, i (lvl.id)}
			{@const stepPct = (i / (levels.length - 1)) * 100}
			{@const isPassed = i <= currentIndex}
			{@const isCurrent = i === currentIndex}
			<button
				type="button"
				class="step-tick-btn"
				class:passed={isPassed}
				class:current={isCurrent}
				style="left: {stepPct}%;"
				onclick={(e) => {
					e.stopPropagation();
					handleStepClick(i);
				}}
				title="{lvl.label} ({lvl.budget})"
			>
				<span class="tick-dot"></span>
			</button>
		{/each}

		<!-- Thumb Handle -->
		<div
			class="slider-thumb"
			class:dragging={isDragging}
			style="left: {progressPercent}%;"
		></div>
	</div>

	<!-- Step Labels -->
	<div class="step-labels">
		{#each levels as lvl, i (lvl.id)}
			{@const isCurrent = i === currentIndex}
			<button
				type="button"
				class="step-label-btn"
				class:active={isCurrent}
				onclick={() => handleStepClick(i)}
			>
				{lvl.label}
			</button>
		{/each}
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
		margin-bottom: 8px;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.brain-icon {
		color: var(--brand-ink);
		flex-shrink: 0;
	}

	.level-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.budget-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--brand) 18%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.level-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-family: var(--font-mono);
	}

	.slider-track-area {
		position: relative;
		height: 20px;
		cursor: pointer;
		display: flex;
		align-items: center;
		outline: none;
		touch-action: none;
	}

	.slider-track-area:focus-visible .track-bg {
		outline: 2px solid color-mix(in srgb, var(--brand) 60%, transparent);
		outline-offset: 2px;
	}

	.track-bg {
		position: absolute;
		left: 0;
		right: 0;
		height: 4px;
		background: var(--line-strong);
		border-radius: var(--radius-full);
	}

	.track-fill {
		position: absolute;
		left: 0;
		right: 0;
		height: 4px;
		background: var(--brand);
		border-radius: var(--radius-full);
		transform-origin: left;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.step-tick-btn {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 14px;
		height: 14px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		display: grid;
		place-items: center;
		z-index: 2;
	}

	.tick-dot {
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--ink) 35%, transparent);
		transition: transform var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
	}

	.step-tick-btn.passed .tick-dot {
		background: color-mix(in srgb, var(--brand-ink) 70%, transparent);
	}

	.step-tick-btn.current .tick-dot {
		background: var(--brand-ink);
		transform: scale(1.3);
	}

	.slider-thumb {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 12px;
		height: 12px;
		border-radius: var(--radius-full);
		background: var(--ink);
		border: 2px solid var(--brand);
		z-index: 3;
		pointer-events: none;
		transition: left var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
	}

	.slider-thumb.dragging {
		transform: translate(-50%, -50%) scale(1.25);
	}

	.step-labels {
		display: flex;
		justify-content: space-between;
		margin-top: 2px;
	}

	.step-label-btn {
		background: transparent;
		border: none;
		padding: 2px 0;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink-faint);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out);
		text-align: center;
	}

	.step-label-btn:hover {
		color: var(--ink-muted);
	}

	.step-label-btn.active {
		color: var(--brand-ink);
		font-weight: 600;
	}
</style>
