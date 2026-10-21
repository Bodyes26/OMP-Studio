<!--
  CompareSlider.svelte — Intelligent UI: Slider interattivo di comparazione Prima/Dopo.
-->
<script lang="ts">
	import { IconChevronLeft, IconChevronRight } from '../../icons';

	let {
		before = '',
		after = '',
		labelBefore = 'Prima',
		labelAfter = 'Dopo'
	}: {
		before: string;
		after: string;
		labelBefore?: string;
		labelAfter?: string;
	} = $props();

	let splitPercent = $state(50);
	let isDragging = $state(false);
	let containerEl = $state<HTMLElement>();

	function handlePointerDown(e: PointerEvent) {
		isDragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		updateSplit(e);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging) return;
		updateSplit(e);
	}

	function handlePointerUp() {
		isDragging = false;
	}

	function updateSplit(e: PointerEvent) {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const pct = Math.max(10, Math.min(90, (x / rect.width) * 100));
		splitPercent = pct;
	}
</script>

<div class="compare-card" bind:this={containerEl}>
	<div class="compare-header">
		<span class="badge-before">{labelBefore}</span>
		<span class="compare-title">Confronto</span>
		<span class="badge-after">{labelAfter}</span>
	</div>

	<div class="compare-stage">
		<!-- Pannello Prima -->
		<div class="pane pane-before" style:width="{splitPercent}%">
			<pre class="content-pre">{before}</pre>
		</div>

		<!-- Maniglia del divisore -->
		<div
			class="divider-handle"
			style:left="{splitPercent}%"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			role="slider"
			aria-valuenow={Math.round(splitPercent)}
			aria-label="Regola divisione confronto"
			tabindex="0"
		>
			<div class="handle-pill">
				<IconChevronLeft />
				<IconChevronRight />
			</div>
		</div>

		<!-- Pannello Dopo -->
		<div class="pane pane-after" style:width="{100 - splitPercent}%">
			<pre class="content-pre">{after}</pre>
		</div>
	</div>
</div>

<style>
	.compare-card {
		margin: var(--space-3) 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-base);
		overflow: hidden;
	}

	.compare-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 12px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
	}

	.compare-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink-muted);
	}

	.badge-before,
	.badge-after {
		font-size: 11px;
		font-family: var(--font-mono);
		font-weight: 600;
		padding: 1px 8px;
		border-radius: var(--radius-sm);
	}

	.badge-before {
		background: rgba(239, 68, 68, 0.1);
		color: var(--danger);
		border: 1px solid var(--danger);
	}

	.badge-after {
		background: rgba(16, 185, 129, 0.1);
		color: var(--success);
		border: 1px solid var(--success);
	}

	.compare-stage {
		position: relative;
		display: flex;
		min-height: 160px;
		max-height: 400px;
		background: var(--bg-sunken);
		user-select: text;
	}

	.pane {
		overflow: auto;
		height: 100%;
	}

	.pane-before {
		background: rgba(239, 68, 68, 0.02);
	}

	.pane-after {
		background: rgba(16, 185, 129, 0.02);
	}

	.content-pre {
		margin: 0;
		padding: var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.5;
		color: var(--ink);
		white-space: pre-wrap;
	}

	.divider-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 4px;
		background: var(--line-strong);
		cursor: col-resize;
		transform: translateX(-50%);
		z-index: 10;
		touch-action: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.handle-pill {
		width: 28px;
		height: 28px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
		color: var(--ink);
		--icon-size: 11px;
	}
</style>
