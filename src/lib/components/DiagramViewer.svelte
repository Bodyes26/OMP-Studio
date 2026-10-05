<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { sanitizeSvg } from '$lib/editor/svgSandbox';
	import { normalizeRoutingPath } from '$lib/agent/laneRouting';
	import { IconClose, IconZoomIn, IconZoomOut } from '$lib/icons';
	import { onThemeChange, tokenHex } from '$lib/theme';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';

	let {
		projectPath,
		initialDiagram = null,
		laneId = null,
		projectId = null,
		onClose
	}: {
		projectPath: string;
		initialDiagram?: DiagramPayload | null;
		laneId?: string | null;
		projectId?: string | null;
		onClose?: () => void;
	} = $props();

	interface DiagramPayload {
		id: string;
		title: string;
		mermaid: string;
		cwd: string;
		session_id: string;
		lane_id?: string;
		project_id?: string;
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
				// La sanificazione elimina <foreignObject>: le etichette HTML di
				// Mermaid sparirebbero. Con htmlLabels false sono <text> SVG.
				htmlLabels: false,
				flowchart: { htmlLabels: false },
				// I colori seguono i token del tema attivo. Mermaid li passa a
				// khroma, che non legge oklch() ne' color-mix(): servono gli
				// esadecimali risolti dal tema, non le espressioni dei token.
				themeVariables: {
					background: 'transparent',
					fontFamily:
						'"Inter Variable", "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
					fontSize: '13px',
					primaryColor: tokenHex('--bg-overlay'),
					primaryTextColor: tokenHex('--ink'),
					primaryBorderColor: tokenHex('--brand'),
					lineColor: tokenHex('--ink-faint'),
					secondaryColor: tokenHex('--bg-raised'),
					tertiaryColor: tokenHex('--bg-base')
				}
			});
			const { svg } = await mermaidApi.render('studio-diagram-' + Date.now(), mermaid);
			svgHost.innerHTML = sanitizeSvg(svg);
			// Scala 1 = misura naturale del viewBox: lo zoom lo fa la transform
			// della whiteboard. Senza larghezza e altezza esplicite l'SVG, dentro
			// una tela assoluta senza misura, collassa a 0x0.
			const svgEl = svgHost.querySelector('svg');
			if (svgEl) {
				const box = svgEl.viewBox.baseVal;
				svgEl.removeAttribute('width');
				svgEl.removeAttribute('height');
				svgEl.style.maxWidth = 'none';
				if (box && box.width && box.height) {
					svgEl.style.width = `${box.width}px`;
					svgEl.style.height = `${box.height}px`;
				}
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

	$effect(() => {
		if (initialDiagram && initialDiagram.id !== diagram?.id) {
			diagram = initialDiagram;
			void render(initialDiagram.mermaid);
		}
	});

	onMount(() => {
		let disposed = false;
		if (diagram) {
			void render(diagram.mermaid);
		}
		// I colori sono cotti nell'SVG al momento del render: al cambio di
		// tema il diagramma va ridisegnato con i nuovi esadecimali.
		const offTheme = onThemeChange(() => {
			if (diagram) void render(diagram.mermaid);
		});
		void listen<DiagramPayload>('diagram://new', (event) => {
			const payload = event.payload;
			// Se il diagramma e' destinato a un'altra corsia o progetto, ignoralo
			if (laneId && payload.lane_id && payload.lane_id !== laneId) return;
			if (projectId && payload.project_id && payload.project_id !== projectId) return;

			// Normalizzazione percorsi: verifica appartenenza alla radice di questa corsia
			// senza assumere che i worktree stiano dentro la cartella del progetto.
			if (payload.cwd && projectPath) {
				const active = normalizeRoutingPath(projectPath);
				const from = normalizeRoutingPath(payload.cwd);
				if (from && active && from !== active && !from.startsWith(`${active}/`)) return;
			}
			diagram = payload;
			void render(payload.mermaid);
		}).then((fn) => {
			if (disposed) fn();
			else unlisten = fn;
		});
		return () => {
			disposed = true;
			offTheme();
			unlisten?.();
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="diagram-viewer"
	bind:this={containerEl}
	role="region"
	aria-label={m.diagram_region()}
	onpointerenter={() => (pointerOver = true)}
	onpointerleave={() => (pointerOver = false)}
>
	<!-- Testata fusa da 32 px (D7): c'e' anche senza diagramma, cosi' la
	     chiusura resta raggiungibile e la fascia superiore non salta. -->
	<div class="diagram-toolbar">
		<span class="diagram-title" title={diagram?.title}>{diagram?.title ?? m.diagram_default_title()}</span>
		<span class="toolbar-spacer"></span>
		{#if diagram}
			<Tooltip text={m.viewer_fit_tip_shortcut()} placement="bottom">
				<button type="button" class="ui-button ui-button-ghost" onclick={fitToView}>{m.viewer_fit()}</button>
			</Tooltip>
			<Tooltip text={m.viewer_zoom_out()} placement="bottom">
				<button
					type="button"
					class="icon-btn"
					onclick={() => (scale = clampScale(scale / 1.25))}
					aria-label={m.viewer_zoom_out()}
				><IconZoomOut /></button>
			</Tooltip>
			<span class="zoom-label">{Math.round(scale * 100)}%</span>
			<Tooltip text={m.viewer_zoom_in()} placement="bottom">
				<button
					type="button"
					class="icon-btn"
					onclick={() => (scale = clampScale(scale * 1.25))}
					aria-label={m.viewer_zoom_in()}
				><IconZoomIn /></button>
			</Tooltip>
		{/if}
		<Tooltip text={m.ui_shortcutshelpmodal_chiudi_esc_0e80()} placement="bottom">
			<button
				type="button"
				class="icon-btn"
				onclick={() => onClose?.()}
				aria-label={m.ui_diagramviewer_chiudi_visualizzatore_diagramma_esc_b2eb()}
			><IconClose /></button>
		</Tooltip>
	</div>
	{#if diagram}
		<div
			class="diagram-viewport"
			bind:this={viewportEl}
			onwheel={handleWheel}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			role="application"
			aria-label={m.diagram_canvas_label({ title: diagram.title })}
		>
			<div
				class="diagram-canvas"
				bind:this={svgHost}
				style:transform="translate({panX}px, {panY}px) scale({scale})"
				class:grabbing={dragging}
			></div>
			{#if rendering}
				<div class="render-note">
					<StatusMark status="running" />
					<span>{m.diagram_rendering()}</span>
				</div>
			{/if}
			{#if renderError}
				<div class="render-error" role="alert">{m.ui_diagramviewer_errore_mermaid_d820()} {renderError}</div>
			{/if}
		</div>
	{:else}
		<div class="empty-state">
			<div class="empty-text">{m.ui_diagramviewer_nessun_diagramma_in_questa_sessione_fd81()}</div>
			<div class="empty-hint">
				{m.diagram_empty_hint_before()} <code>studio_diagram</code> {m.diagram_empty_hint_after()}
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

	/* Stessa testata dell'editor e del Task Editor: 32 px sul pozzo, linea sotto. */
	.diagram-toolbar {
		height: 32px;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0 var(--space-1) 0 var(--space-3);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.diagram-title {
		min-width: 0;
		max-width: 40ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
		font-size: var(--text-label);
		font-weight: 500;
	}

	.toolbar-spacer {
		flex: 1;
	}

	.icon-btn {
		width: 28px;
		height: 28px;
		display: inline-grid;
		place-items: center;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 14px;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.zoom-label {
		min-width: 40px;
		text-align: center;
		color: var(--ink-muted);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
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
		font-size: var(--text-body);
	}

	.render-note {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.render-error {
		color: var(--danger);
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
		font-size: var(--text-body);
	}

	.empty-hint {
		color: var(--ink-faint);
		font-size: var(--text-label);
	}

	.empty-hint code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
	}
</style>
