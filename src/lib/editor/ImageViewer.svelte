<script lang="ts">
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { joinProjectPath } from '$lib/stores/projects.svelte';

	let { projectPath, filePath } = $props<{
		projectPath: string;
		filePath: string;
	}>();

	let scale = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let startX = 0;
	let startY = 0;
	let imgWidth = $state(0);
	let imgHeight = $state(0);

	let fullPath = $derived(joinProjectPath(projectPath, filePath));
	let imgSrc = $derived(convertFileSrc(fullPath));

	function handleImgLoad(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		imgWidth = img.naturalWidth;
		imgHeight = img.naturalHeight;
		resetTransform();
	}

	function resetTransform() {
		scale = 1;
		panX = 0;
		panY = 0;
	}

	function zoomIn() {
		scale = Math.min(scale * 1.25, 10);
	}

	function zoomOut() {
		scale = Math.max(scale / 1.25, 0.1);
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.deltaY < 0) {
			scale = Math.min(scale * 1.1, 10);
		} else {
			scale = Math.max(scale / 1.1, 0.1);
		}
	}

	function handleMouseDown(e: MouseEvent) {
		if (e.button !== 0) return;
		isDragging = true;
		startX = e.clientX - panX;
		startY = e.clientY - panY;
	}

	function handleMouseMove(e: MouseEvent) {
		if (!isDragging) return;
		panX = e.clientX - startX;
		panY = e.clientY - startY;
	}

	function handleMouseUp() {
		isDragging = false;
	}
</script>

<div class="image-viewer-container">
	<div class="image-toolbar">
		<span class="file-name">{filePath.split(/[\\/]/).pop()}</span>
		{#if imgWidth && imgHeight}
			<span class="img-meta">{imgWidth} × {imgHeight} px</span>
		{/if}
		<div class="zoom-controls">
			<button class="tool-btn" onclick={zoomOut} title="Zoom Out (-)">−</button>
			<span class="zoom-level">{Math.round(scale * 100)}%</span>
			<button class="tool-btn" onclick={zoomIn} title="Zoom In (+)">+</button>
			<button class="tool-btn" onclick={resetTransform} title="Reset (100%)">1:1</button>
		</div>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		class="viewport"
		onwheel={handleWheel}
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		onmouseleave={handleMouseUp}
	>
		<div 
			class="image-wrapper"
			style="transform: translate({panX}px, {panY}px) scale({scale}); cursor: {isDragging ? 'grabbing' : 'grab'};"
		>
			<img 
				src={imgSrc} 
				alt={filePath} 
				onload={handleImgLoad} 
				draggable="false"
			/>
		</div>
	</div>
</div>

<style>
	.image-viewer-container {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		user-select: none;
	}

	.image-toolbar {
		height: 36px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		z-index: 5;
	}

	.file-name {
		font-weight: 600;
		color: var(--ink);
	}

	.img-meta {
		font-family: var(--font-mono);
		color: var(--ink-faint);
	}

	.zoom-controls {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.zoom-level {
		font-family: var(--font-mono);
		min-width: 42px;
		text-align: center;
	}

	.tool-btn {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		padding: 2px 8px;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.tool-btn:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.viewport {
		flex: 1;
		width: 100%;
		height: 100%;
		overflow: hidden;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: #121212;
		background-image: 
			linear-gradient(45deg, #1e1e1e 25%, transparent 25%), 
			linear-gradient(-45deg, #1e1e1e 25%, transparent 25%), 
			linear-gradient(45deg, transparent 75%, #1e1e1e 75%), 
			linear-gradient(-45deg, transparent 75%, #1e1e1e 75%);
		background-size: 20px 20px;
		background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
	}

	.image-wrapper {
		display: inline-block;
		transform-origin: center center;
		transition: transform 0.05s ease-out;
	}

	.image-wrapper img {
		max-width: 80vw;
		max-height: 70vh;
		object-fit: contain;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		border-radius: 4px;
	}
</style>
