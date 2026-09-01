<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';

	let { projectPath, filePath } = $props<{
		projectPath: string;
		filePath: string;
	}>();

	// Il protocollo `asset:` di Tauri e' disabilitato di default e il suo scope
	// e' statico, mentre i progetti vivono in cartelle arbitrarie: i byte
	// arrivano dall'IPC come ArrayBuffer e diventano un blob locale. La CSP
	// consente gia' `blob:` in img-src.
	const MIME_BY_EXT: Record<string, string> = {
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		bmp: 'image/bmp',
		ico: 'image/x-icon',
		heic: 'image/heic',
		avif: 'image/avif'
	};

	let scale = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let startX = 0;
	let startY = 0;
	let imgWidth = $state(0);
	let imgHeight = $state(0);
	let imgSrc = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let byteSize = $state(0);

	function mimeFor(path: string): string {
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		return MIME_BY_EXT[ext] ?? 'application/octet-stream';
	}

	$effect(() => {
		const project = projectPath;
		const rel = filePath;
		imgSrc = null;
		loadError = null;
		imgWidth = 0;
		imgHeight = 0;
		byteSize = 0;
		if (!project || !rel) return;

		// L'URL va revocato alla dismissione: un object URL vive quanto il
		// documento, quindi cambiare file senza revocare trattiene i byte.
		let url: string | null = null;
		let cancelled = false;
		void (async () => {
			try {
				const bytes = await invoke<ArrayBuffer>('file_read_bytes', {
					projectPath: project,
					rel
				});
				if (cancelled) return;
				url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(rel) }));
				byteSize = bytes.byteLength;
				imgSrc = url;
			} catch (error) {
				if (!cancelled) loadError = String(error);
			}
		})();

		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	});

	function formatBytes(size: number): string {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	}

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
			<span class="img-meta">{imgWidth} × {imgHeight} px{byteSize ? ` · ${formatBytes(byteSize)}` : ''}</span>
		{/if}
		<div class="zoom-controls">
			<button class="tool-btn" onclick={zoomOut} title="Zoom Out (-)">−</button>
			<span class="zoom-level">{Math.round(scale * 100)}%</span>
			<button class="tool-btn" onclick={zoomIn} title="Zoom In (+)">+</button>
			<button class="tool-btn" onclick={resetTransform} title="Reset (100%)">1:1</button>
		</div>
	</div>

	{#if loadError}
		<div class="viewport error">
			<div class="error-box">
				<div class="error-title">Immagine non caricata</div>
				<div class="error-detail">{loadError}</div>
			</div>
		</div>
	{:else}
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
				{#if imgSrc}
					<img
						src={imgSrc}
						alt={filePath}
						onload={handleImgLoad}
						onerror={() => (loadError = 'Formato non supportato dal renderer della webview.')}
						draggable="false"
					/>
				{/if}
			</div>
		</div>
	{/if}
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

	.viewport.error {
		cursor: default;
	}

	.error-box {
		max-width: 420px;
		padding: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		text-align: center;
	}

	.error-title {
		color: var(--warn);
		font-size: var(--text-md);
		margin-bottom: var(--space-2);
	}

	.error-detail {
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		word-break: break-word;
		user-select: text;
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
		--checker: color-mix(in srgb, var(--ink) 5%, transparent);
		background-color: var(--bg-sunken);
		background-image:
			linear-gradient(45deg, var(--checker) 25%, transparent 25%),
			linear-gradient(-45deg, var(--checker) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--checker) 75%),
			linear-gradient(-45deg, transparent 75%, var(--checker) 75%);
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
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}
</style>
