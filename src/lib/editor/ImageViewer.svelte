<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { m } from '$lib/paraglide/messages.js';

	// Solo la tela: nome, misure e zoom stanno nella barra dell'editor (una
	// sola barra da 32 px, D7). L'editor legge `scale` e `info` e comanda lo
	// zoom con le funzioni esportate.
	let {
		projectPath,
		filePath,
		scale = $bindable(1),
		info = $bindable(null)
	}: {
		projectPath: string;
		filePath: string;
		scale?: number;
		info?: { width: number; height: number; bytes: number } | null;
	} = $props();

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

	const MIN_SCALE = 0.1;
	const MAX_SCALE = 10;

	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let startX = 0;
	let startY = 0;
	let imgSrc = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let byteSize = 0;

	function mimeFor(path: string): string {
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		return MIME_BY_EXT[ext] ?? 'application/octet-stream';
	}

	$effect(() => {
		const project = projectPath;
		const rel = filePath;
		imgSrc = null;
		loadError = null;
		info = null;
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

	function handleImgLoad(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		info = { width: img.naturalWidth, height: img.naturalHeight, bytes: byteSize };
		fit();
	}

	/** Scala 1 = immagine adattata alla tela, centrata. */
	export function fit() {
		scale = 1;
		panX = 0;
		panY = 0;
	}

	export function zoomIn() {
		scale = Math.min(scale * 1.25, MAX_SCALE);
	}

	export function zoomOut() {
		scale = Math.max(scale / 1.25, MIN_SCALE);
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		scale = e.deltaY < 0 ? Math.min(scale * 1.1, MAX_SCALE) : Math.max(scale / 1.1, MIN_SCALE);
	}

	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		isDragging = true;
		startX = e.clientX - panX;
		startY = e.clientY - panY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging) return;
		panX = e.clientX - startX;
		panY = e.clientY - startY;
	}

	function handlePointerUp() {
		isDragging = false;
	}
</script>

{#if loadError}
	<div class="viewport error">
		<div class="error-box" role="alert">
			<div class="error-title">{m.image_viewer_load_error()}</div>
			<div class="error-detail">{loadError}</div>
		</div>
	</div>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="viewport"
		class:dragging={isDragging}
		onwheel={handleWheel}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
	>
		<div class="image-wrapper" style:transform="translate({panX}px, {panY}px) scale({scale})">
			{#if imgSrc}
				<img
					src={imgSrc}
					alt={filePath}
					onload={handleImgLoad}
					onerror={() => (loadError = m.image_viewer_unsupported())}
					draggable="false"
				/>
			{/if}
		</div>
	</div>
{/if}

<style>
	.viewport {
		width: 100%;
		height: 100%;
		overflow: hidden;
		position: relative;
		cursor: grab;
		touch-action: none;
		user-select: none;
		/* Scacchiera di trasparenza: quadri traslucidi sopra il pozzo, cosi'
		   seguono la superficie invece di essere due grigi fissi. */
		--checker: color-mix(in srgb, var(--ink) 5%, transparent);
		background-color: var(--bg-sunken);
		background-image:
			linear-gradient(45deg, var(--checker) 25%, transparent 25%),
			linear-gradient(-45deg, var(--checker) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--checker) 75%),
			linear-gradient(-45deg, transparent 75%, var(--checker) 75%);
		background-size: 20px 20px;
		background-position: 0 0, 0 10px, 10px -10px, -10px 0;
	}

	.viewport.dragging {
		cursor: grabbing;
	}

	.viewport.error {
		display: grid;
		place-items: center;
		cursor: default;
	}

	/* Riquadro di misura nota: l'immagine si adatta alla tela, non alla
	   finestra. Lo zoom dei pulsanti scorre a --dur-fast; il pan segue il
	   puntatore senza ritardo. */
	.image-wrapper {
		position: absolute;
		inset: var(--space-4);
		display: flex;
		align-items: center;
		justify-content: center;
		transform-origin: center center;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.dragging .image-wrapper {
		transition: none;
	}

	.image-wrapper img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.error-box {
		max-width: 420px;
		padding: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-raised);
		text-align: center;
	}

	.error-title {
		color: var(--danger);
		font-size: var(--text-body);
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	.error-detail {
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		word-break: break-word;
		user-select: text;
	}
</style>
