<script lang="ts">
	import { onMount } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { sanitizeSvg } from '$lib/editor/svgSandbox';

	let {
		projectPath,
		onClose
	}: {
		projectPath: string;
		onClose?: () => void;
	} = $props();

	interface DiagramPayload {
		id: string;
		title: string;
		mermaid: string;
		cwd: string;
		session_id: string;
	}

	let diagram = $state<DiagramPayload | null>(null);
	let renderError = $state<string | null>(null);
	let rendering = $state(false);

	// Pan e zoom della whiteboard. Scala 1 = adattata al contenitore.
	let scale = $state(1);
	let panX = $state(0);
	let panY = $state(0);

	let viewportEl = $state<HTMLElement>();
	let svgHost = $state<HTMLElement>();
	let containerEl = $state<HTMLElement>();
	let pointerOver = $state(false);

	let unlisten: UnlistenFn | null = null;

	const MIN_SCALE = 0.2;
	const MAX_SCALE = 4;

	function clampScale(v: number): number {
		return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
	}

	async function render(mermaid: string) {
		if (!svgHost) return;
		rendering = true;
		renderError = null;
		try {
			const mermaidApi = (await import('mermaid')).default;
			mermaidApi.initialize({
				startOnLoad: false,
				securityLevel: 'strict',
				theme: 'base',
				// I colori seguono i token del tema attivo: neutri di sfondo,
				// testo --ink, accento --brand per i nodi chiave.
				themeVariables: {
					background: '#00000000',
					fontFamily:
						'"Inter Variable", "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
					fontSize: '13px',
					primaryColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-overlay').trim() || '#222222',
					primaryTextColor: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#F5F5F5',
					primaryBorderColor: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#D8488C',
					lineColor: getComputedStyle(document.documentElement).getPropertyValue('--ink-faint').trim() || '#909090',
					secondaryColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-raised').trim() || '#191919',
					tertiaryColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#131313'
				}
			});
			const { svg } = await mermaidApi.render('studio-diagram-' + Date.now(), mermaid);
			svgHost.innerHTML = sanitizeSvg(svg);
			// Adatta l'SVG al contenitore: rimuove larghezza fissa e lascia
			// fare lo scaling alla transform della whiteboard.
			const svgEl = svgHost.querySelector('svg');
			if (svgEl) {
				svgEl.removeAttribute('width');
				svgEl.removeAttribute('height');
				svgEl.style.maxWidth = 'none';
			}
			fitToView();
		} catch (e) {
			renderError = e instanceof Error ? e.message : String(e);
			svgHost.innerHTML = '';
		} finally {
			rendering = false;
		}
	}

	function fitToView() {
		if (!viewportEl || !svgHost) return;
		const svgEl = svgHost.querySelector('svg');
		if (!svgEl) return;
		const vbW = svgEl.viewBox.baseVal.width || svgEl.getBoundingClientRect().width;
		const vbH = svgEl.viewBox.baseVal.height || svgEl.getBoundingClientRect().height;
		if (!vbW || !vbH) return;
		const vw = viewportEl.clientWidth;
		const vh = viewportEl.clientHeight;
		scale = clampScale(Math.min(vw / vbW, vh / vbH) * 0.92);
		panX = (vw - vbW * scale) / 2;
		panY = (vh - vbH * scale) / 2;
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		if (!viewportEl) return;
		const rect = viewportEl.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
		const next = clampScale(scale * factor);
		// Zoom centrato sul cursore: il punto sotto il mouse resta fermo.
		panX = mx - ((mx - panX) * next) / scale;
		panY = my - ((my - panY) * next) / scale;
		scale = next;
	}

	let dragging = $state(false);
	let dragStartX = 0;
	let dragStartY = 0;
	let dragStartPanX = 0;
	let dragStartPanY = 0;

	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		dragging = true;
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		dragStartPanX = panX;
		dragStartPanY = panY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragging) return;
		panX = dragStartPanX + (e.clientX - dragStartX);
		panY = dragStartPanY + (e.clientY - dragStartY);
	}

	function handlePointerUp() {
		dragging = false;
	}

	function isTextEntryTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	// Scorciatoia confinata al pannello: senza questi controlli Ctrl+0 ed Esc
	// venivano rubati anche quando l'utente lavorava altrove nell'app (es.
	// nel composer), impedendo lo zoom-reset globale dell'applicazione.
	function handleKeydown(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		const hasFocus = containerEl?.contains(document.activeElement) ?? false;
		if (!hasFocus && !pointerOver) return;
		if (e.key === 'Escape') onClose?.();
		if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			fitToView();
		}
	}

	onMount(() => {
		let disposed = false;
		void listen<DiagramPayload>('diagram://new', (event) => {
			const payload = event.payload;
			// Solo i diagrammi del progetto attivo: una sessione in background
			// non deve rubare la whiteboard della colonna centrale.
			const active = projectPath.replace(/\\/g, '/').toLowerCase();
			const from = (payload.cwd || '').replace(/\\/g, '/').toLowerCase();
			if (active && from && !from.startsWith(active)) return;
			diagram = payload;
			void render(payload.mermaid);
		}).then((fn) => {
			if (disposed) fn();
			else unlisten = fn;
		});
		return () => {
			disposed = true;
			unlisten?.();
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="diagram-viewer"
	bind:this={containerEl}
	role="region"
	aria-label="Visualizzatore diagramma"
	onpointerenter={() => (pointerOver = true)}
	onpointerleave={() => (pointerOver = false)}
>
	{#if diagram}
		<div class="diagram-toolbar">
			<span class="diagram-title" title={diagram.title}>{diagram.title}</span>
			<span class="toolbar-spacer"></span>
			<button class="tool-btn" onclick={fitToView} title="Adatta alla finestra (Ctrl+0)" aria-label="Adatta diagramma alla finestra (Ctrl+0)">Adatta</button>
			<button class="tool-btn" onclick={() => (scale = clampScale(scale * 1.25))} title="Zoom in" aria-label="Ingrandisci diagramma (Zoom in)">+</button>
			<button class="tool-btn" onclick={() => (scale = clampScale(scale / 1.25))} title="Zoom out" aria-label="Riduci diagramma (Zoom out)">&minus;</button>
			<span class="zoom-label">{Math.round(scale * 100)}%</span>
			<button class="tool-btn close" onclick={() => onClose?.()} title="Chiudi (Esc)" aria-label="Chiudi visualizzatore diagramma (Esc)">×</button>
		</div>
		<div
			class="diagram-viewport"
			bind:this={viewportEl}
			onwheel={handleWheel}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			role="application"
			aria-label="Whiteboard diagramma: {diagram.title}"
		>
			<div
				class="diagram-canvas"
				bind:this={svgHost}
				style:transform="translate({panX}px, {panY}px) scale({scale})"
				class:grabbing={dragging}
			></div>
			{#if rendering}
				<div class="render-note">Rendering...</div>
			{/if}
			{#if renderError}
				<div class="render-error">Errore Mermaid: {renderError}</div>
			{/if}
		</div>
	{:else}
		<div class="empty-state">
			<div class="empty-text">Nessun diagramma in questa sessione</div>
			<div class="empty-hint">
				Chiedi all'agente di usare il tool <code>studio_diagram</code> per visualizzare un diagramma qui
			</div>
		</div>
	{/if}
</div>

<style>
	.diagram-viewer {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background: var(--bg-sunken);
	}

	.diagram-toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		background: var(--bg-raised);
		min-height: 30px;
		flex-shrink: 0;
	}

	.diagram-title {
		color: var(--ink);
		font-size: var(--text-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 40ch;
	}

	.toolbar-spacer {
		flex: 1;
	}

	.tool-btn {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.tool-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.tool-btn.close {
		font-size: var(--text-md);
		line-height: 1;
	}

	.zoom-label {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		min-width: 38px;
		text-align: right;
	}

	.diagram-viewport {
		position: relative;
		flex: 1;
		overflow: hidden;
		cursor: grab;
		touch-action: none;
	}

	.diagram-viewport:has(.grabbing) {
		cursor: grabbing;
	}

	.diagram-canvas {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
		will-change: transform;
		user-select: none;
	}

	.diagram-canvas :global(svg) {
		display: block;
	}

	.render-note,
	.render-error {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}

	.render-error {
		color: var(--git-deleted);
		max-width: 60ch;
		text-align: center;
	}

	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		max-width: 65ch;
		margin: 0 auto;
		padding: var(--space-6);
		text-align: center;
	}

	.empty-text {
		color: var(--ink-muted);
		font-size: var(--text-md);
	}

	.empty-hint {
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}

	.empty-hint code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
	}
</style>
