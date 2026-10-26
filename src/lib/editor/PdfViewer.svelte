<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { m } from '#lib/paraglide/messages.js';
	import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
	import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
	import StatusMark from '#lib/ui/StatusMark.svelte';

	let { projectPath, filePath }: { projectPath: string; filePath: string } = $props();
	let document = $state<PDFDocumentProxy | null>(null);
	let page = $state(1);
	let zoom = $state(1);
	let host = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let width = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);

	$effect(() => {
		const project = projectPath;
		const rel = filePath;
		document = null;
		page = 1;
		zoom = 1;
		loading = true;
		error = null;
		let cancelled = false;
		let task: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined;
		void (async () => {
			try {
				const [pdf, bytes] = await Promise.all([
					import('pdfjs-dist/legacy/build/pdf.mjs'),
					invoke<ArrayBuffer>('file_read_bytes', { projectPath: project, rel })
				]);
				if (cancelled) return;
				pdf.GlobalWorkerOptions.workerSrc = workerUrl;
				// I font di sistema evitano richieste di risorse esterne al documento.
				task = pdf.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
				const loaded = await task.promise;
				if (!cancelled) document = loaded;
			} catch (cause) {
				if (!cancelled) { error = String(cause); loading = false; }
			}
		})();
		return () => { cancelled = true; void task?.destroy(); };
	});

	$effect(() => {
		if (!host) return;
		const observer = new ResizeObserver(([entry]) => { width = entry.contentRect.width; });
		observer.observe(host);
		return () => observer.disconnect();
	});

	$effect(() => {
		const pdf = document;
		const target = canvas;
		const currentPage = page;
		const availableWidth = width;
		const scale = zoom;
		if (!pdf || !target || availableWidth <= 0) return;
		loading = true;
		error = null;
		let cancelled = false;
		let render: RenderTask | undefined;
		void (async () => {
			try {
				const source = await pdf.getPage(currentPage);
				if (cancelled) return;
				const base = source.getViewport({ scale: 1 });
				const cssScale = Math.max(0.1, (availableWidth - 32) / base.width) * scale;
				const viewport = source.getViewport({ scale: cssScale * window.devicePixelRatio });
				// Ogni render usa una tela separata: un render cancellato non puo'
				// interferire con quello avviato subito dopo da zoom o cambio pagina.
				const buffer = window.document.createElement('canvas');
				buffer.width = Math.ceil(viewport.width);
				buffer.height = Math.ceil(viewport.height);
				render = source.render({ canvas: buffer, viewport });
				await render.promise;
				if (cancelled) return;
				target.width = buffer.width;
				target.height = buffer.height;
				target.style.width = `${base.width * cssScale}px`;
				target.style.height = `${base.height * cssScale}px`;
				target.getContext('2d')!.drawImage(buffer, 0, 0);
			} catch (cause) {
				if (!cancelled) error = String(cause);
			} finally {
				if (!cancelled) loading = false;
			}
		})();
		return () => { cancelled = true; render?.cancel(); };
	});
</script>

<div class="pdf-viewer">
	<div class="pdf-pages" bind:this={host} aria-busy={loading}>
		<canvas bind:this={canvas} hidden={loading || !!error} aria-label={filePath}></canvas>
		{#if error}
			<div class="notice" role="alert">{m.editor_file_load_error()}<span>{error}</span></div>
		{:else if loading}
			<div class="notice" role="status"><StatusMark status="running" />{m.ui_editor_caricamento_in_corso_5dfd()}</div>
		{/if}
	</div>
	{#if document}
		<div class="pdf-controls">
			<button class="ui-button ui-button-ghost" disabled={page <= 1} onclick={() => page--}>{m.pdf_previous_page()}</button>
			<span aria-live="polite">{m.smart_table_page_info({ current: page, total: document.numPages })}</span>
			<button class="ui-button ui-button-ghost" disabled={page >= document.numPages} onclick={() => page++}>{m.pdf_next_page()}</button>
			<button class="ui-button ui-button-ghost" onclick={() => zoom = Math.max(0.25, zoom / 1.25)}>{m.viewer_zoom_out()}</button>
			<button class="ui-button ui-button-ghost" onclick={() => zoom = 1}>{m.viewer_fit()}</button>
			<button class="ui-button ui-button-ghost" onclick={() => zoom = Math.min(4, zoom * 1.25)}>{m.viewer_zoom_in()}</button>
		</div>
	{/if}
</div>

<style>
	.pdf-viewer { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
	.pdf-pages { flex: 1; min-height: 0; overflow: auto; position: relative; background: var(--bg-sunken); }
	canvas { display: block; margin: var(--space-4) auto; }
	canvas[hidden] { display: none; }
	.pdf-controls { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: var(--space-2); border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; }
	.notice { display: flex; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-4); color: var(--ink-muted); }
	.notice[role='alert'] { flex-direction: column; overflow-wrap: anywhere; }
</style>
