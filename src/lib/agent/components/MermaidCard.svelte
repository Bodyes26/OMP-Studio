<!--
  MermaidCard.svelte — Card interattiva per diagrammi Mermaid in chat (Design v2).
  Sostituisce il blocco di codice statico con una card ricca:
  - Intestazione con tipo diagramma, titolo, azioni rapide
  - Tasto "Apri nella Whiteboard" per proiettare il diagramma al centro con pan/zoom
  - Lightbox modale per consultazione ingrandita rapida direttamente dalla chat
  - Toggle codice sorgente / anteprima
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { agentUiHooks } from '../ui-context';
	import MermaidDiagram from './MermaidDiagram.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import PanZoom from '$lib/ui/PanZoom.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconExternalLink,
		IconMaximize,
		IconViewCode,
		IconCopy,
		IconCheck,
		IconZoomIn,
		IconZoomOut,
		IconSparkles
	} from '$lib/icons';

	let { text }: { text: string } = $props();

	const hooks = agentUiHooks();

	let mermaidReady = $state(false);
	let mermaidError = $state<string | null>(null);
	let showSource = $state(false);
	let copied = $state(false);
	let lightboxOpen = $state(false);

	// PanZoom per il lightbox modale (gesti touch, pinch, rotella e doppio tocco)
	let panZoom = $state<ReturnType<typeof PanZoom> | null>(null);
	let modalScale = $state(1);
	// Estrazione tipo e titolo dal sorgente Mermaid
	const info = $derived.by(() => {
		const lines = text.trim().split('\n');
		let title = '';
		let type = 'Diagram';

		for (const raw of lines) {
			const line = raw.trim();
			if (!line) continue;
			if (line.startsWith('%%') && line.toLowerCase().includes('title:')) {
				title = line.split(/title:/i)[1]?.trim() || '';
				break;
			}
			if (line.startsWith('title ')) {
				title = line.slice(6).trim();
				break;
			}
			if (line.startsWith('accTitle:')) {
				title = line.slice(9).trim();
				break;
			}
		}

		const firstNonComment = lines.find((l) => !l.trim().startsWith('%%'))?.trim() || '';
		if (/^flowchart|^graph/i.test(firstNonComment)) type = 'Flowchart';
		else if (/^sequenceDiagram/i.test(firstNonComment)) type = 'Sequence';
		else if (/^classDiagram/i.test(firstNonComment)) type = 'Class';
		else if (/^stateDiagram/i.test(firstNonComment)) type = 'State';
		else if (/^erDiagram/i.test(firstNonComment)) type = 'ER';
		else if (/^gantt/i.test(firstNonComment)) type = 'Gantt';
		else if (/^mindmap/i.test(firstNonComment)) type = 'Mindmap';
		else if (/^timeline/i.test(firstNonComment)) type = 'Timeline';

		return {
			type,
			title: title || `${type} ${m.diagram_default_title()}`
		};
	});

	async function handleCopy(e?: MouseEvent) {
		e?.stopPropagation();
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard non accessibile
		}
	}

	function openInWhiteboard(e?: MouseEvent) {
		e?.stopPropagation();
		if (hooks.openDiagram) {
			hooks.openDiagram({
				title: info.title,
				mermaid: text
			});
		}
	}

	function resetModalView() {
		panZoom?.reset();
	}

	$effect(() => {
		if (lightboxOpen) {
			panZoom?.reset();
		}
	});
</script>

<div class="mermaid-card">
	<!-- Testata con titolo, badge e azioni rapide -->
	<div class="card-header">
		<div class="header-left">
			<span class="type-icon"><IconSparkles /></span>
			<span class="type-badge">{info.type}</span>
			<span class="card-title" title={info.title}>{info.title}</span>
		</div>

		<div class="header-actions">
			<Tooltip text={m.diagram_open_whiteboard()} placement="top">
				<button
					type="button"
					class="action-btn highlight"
					onclick={openInWhiteboard}
					aria-label={m.diagram_open_whiteboard()}
				>
					<IconExternalLink />
					<span class="btn-text">{m.diagram_open_whiteboard()}</span>
				</button>
			</Tooltip>

			{#if mermaidReady && !showSource}
				<Tooltip text={m.diagram_lightbox()} placement="top">
					<button
						type="button"
						class="action-btn"
						onclick={() => (lightboxOpen = true)}
						aria-label={m.diagram_lightbox()}
					>
						<IconMaximize />
					</button>
				</Tooltip>
			{/if}

			<Tooltip text={showSource ? m.code_block_show_diagram() : m.code_block_show_code()} placement="top">
				<button
					type="button"
					class="action-btn"
					onclick={() => (showSource = !showSource)}
					aria-label={showSource ? m.code_block_show_diagram() : m.code_block_show_code()}
					aria-pressed={showSource}
				>
					<IconViewCode />
				</button>
			</Tooltip>

			<Tooltip text={m.context_menu_item_copy()} placement="top">
				<button
					type="button"
					class="action-btn"
					onclick={handleCopy}
					aria-label={m.context_menu_item_copy()}
				>
					{#if copied}
						<IconCheck />
					{:else}
						<IconCopy />
					{/if}
				</button>
			</Tooltip>
		</div>
	</div>

	<!-- Corpo: sorgente o visualizzatore -->
	<div class="card-body">
		{#if showSource}
			<pre class="source-pre"><code>{text}</code></pre>
		{:else}
			<div
				class="diagram-stage"
				role="button"
				tabindex="0"
				onclick={() => (lightboxOpen = true)}
				onkeydown={(e) => e.key === 'Enter' && (lightboxOpen = true)}
				title={m.diagram_lightbox()}
			>
				<MermaidDiagram
					source={text}
					bind:ready={mermaidReady}
					bind:error={mermaidError}
				/>
				{#if mermaidReady}
					<div class="stage-hint">
						<span>{m.diagram_lightbox()}</span>
					</div>
				{/if}
			</div>
			{#if mermaidError}
				<div class="error-strip" role="alert">
					{mermaidError}
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Lightbox a schermo intero / modale -->
{#if lightboxOpen}
	<Dialog
		open={true}
		title={info.title}
		onClose={() => (lightboxOpen = false)}
		size="wide"
		flush
		class="mermaid-lightbox-dialog"
	>
		{#snippet actions()}
			<div class="modal-actions">
				<button
					type="button"
					class="ui-button ui-button-ghost modal-btn"
					onclick={() => panZoom?.zoomOut()}
					title={m.viewer_zoom_out()}
					aria-label={m.viewer_zoom_out()}
				>
					<IconZoomOut />
				</button>
				<span class="scale-label">{Math.round(modalScale * 100)}%</span>
				<button
					type="button"
					class="ui-button ui-button-ghost modal-btn"
					onclick={() => panZoom?.zoomIn()}
					title={m.viewer_zoom_in()}
					aria-label={m.viewer_zoom_in()}
				>
					<IconZoomIn />
				</button>
				<button
					type="button"
					class="ui-button ui-button-ghost modal-btn"
					onclick={resetModalView}
					title={m.viewer_fit()}
				>
					{m.viewer_fit()}
				</button>
				<button
					type="button"
					class="ui-button ui-button-ghost modal-btn modal-whiteboard-btn"
					onclick={() => {
						openInWhiteboard();
						lightboxOpen = false;
					}}
					title={m.diagram_open_whiteboard()}
				>
					<IconExternalLink />
					<span class="btn-text">{m.diagram_open_whiteboard()}</span>
				</button>
			</div>
		{/snippet}

		<div class="modal-viewer">
			<PanZoom bind:this={panZoom} bind:scale={modalScale} label={info.title}>
				<div class="modal-diagram-host">
					<MermaidDiagram source={text} />
				</div>
			</PanZoom>
		</div>
	</Dialog>
{/if}

<style>
	.mermaid-card {
		margin: var(--space-3) 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-base);
		overflow: hidden;
		transition: border-color var(--dur-fast) var(--ease-out);
		/* Container query per adattare azioni e testata sulla larghezza chat */
		container-type: inline-size;
	}

	.mermaid-card:hover {
		border-color: var(--line-strong);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 6px 10px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		min-height: 36px;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.type-icon {
		display: inline-grid;
		place-items: center;
		color: var(--brand-ink);
		--icon-size: 13px;
	}

	.type-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 6px;
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}

	.card-title {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 26px;
		padding: 0 7px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
		--icon-size: 13px;
		transition: all var(--dur-fast) var(--ease-out);
	}

	.action-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.action-btn.highlight {
		background: var(--bg-overlay);
		border-color: var(--line);
		color: var(--brand-ink);
		font-weight: 500;
	}

	.action-btn.highlight:hover {
		background: var(--brand);
		color: var(--bg-base);
		border-color: var(--brand);
	}

	.btn-text {
		display: inline-block;
	}

	@media (max-width: 520px) {
		.btn-text {
			display: none;
		}
	}

	.card-body {
		position: relative;
		background: var(--bg-sunken);
	}

	.diagram-stage {
		padding: var(--space-3);
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: 120px;
		cursor: zoom-in;
		position: relative;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	.stage-hint {
		position: absolute;
		bottom: 8px;
		right: 8px;
		padding: 3px 8px;
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		font-size: 11px;
		color: var(--ink-muted);
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--dur-fast) var(--ease-out);
	}

	.diagram-stage:hover .stage-hint {
		opacity: 0.9;
	}

	.source-pre {
		margin: 0;
		padding: var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.5;
		color: var(--ink-muted);
		background: var(--bg-base);
		overflow: auto;
		max-height: 320px;
	}

	.error-strip {
		padding: 6px 10px;
		background: var(--danger-subtle, rgba(255, 80, 80, 0.1));
		border-top: 1px solid var(--danger);
		color: var(--danger);
		font-family: var(--font-mono);
		font-size: 11px;
	}

	/* Modale Lightbox */
	.modal-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.scale-label {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-muted);
		min-width: 42px;
		text-align: center;
	}

	.modal-viewer {
		width: 100%;
		height: 70vh;
		background: var(--bg-sunken);
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.modal-diagram-host {
		padding: var(--space-4);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal-diagram-host :global(.mermaid-host) {
		overflow: visible;
	}

	.modal-diagram-host :global(.mermaid-host svg) {
		max-height: none;
		max-width: none;
	}

	/* Affordance di ingrandimento visibile al tocco senza bisogno di hover */
	@media (hover: none), (pointer: coarse) {
		.stage-hint {
			opacity: 0.85;
		}
	}

	/* Collasso dei pulsanti della testata a sola icona >=40px su schermi touch o contenitore stretto */
	@media (pointer: coarse) {
		.card-header {
			min-height: 44px;
			padding: 4px 8px;
		}

		.action-btn {
			min-height: 40px;
			min-width: 40px;
			padding: 0 8px;
			justify-content: center;
			--icon-size: 16px;
		}

		.action-btn .btn-text {
			display: none;
		}
	}

	@container (max-width: 500px) {
		.card-header {
			min-height: 44px;
			padding: 4px 8px;
		}

		.action-btn {
			min-height: 40px;
			min-width: 40px;
			padding: 0 8px;
			justify-content: center;
			--icon-size: 16px;
		}

		.action-btn .btn-text {
			display: none;
		}
	}

	/* Lightbox: su schermi mobili (<640px) usa 100dvh e safe-area-inset per aggirare notch e barre di sistema iOS */
	@media (max-width: 640px) {
		:global(.dialog-surface.mermaid-lightbox-dialog) {
			position: fixed !important;
			inset: 0 !important;
			width: 100vw !important;
			max-width: 100vw !important;
			height: 100dvh !important;
			height: var(--app-height, 100dvh) !important;
			max-height: none !important;
			border-radius: 0 !important;
			border: none !important;
			padding-top: env(safe-area-inset-top, 0px);
			padding-bottom: env(safe-area-inset-bottom, 0px);
			padding-left: env(safe-area-inset-left, 0px);
			padding-right: env(safe-area-inset-right, 0px);
		}

		:global(.mermaid-lightbox-dialog .dialog-header) {
			padding: 8px 12px;
		}

		:global(.mermaid-lightbox-dialog .dialog-close-btn) {
			min-width: 40px;
			min-height: 40px;
		}

		.modal-viewer {
			height: 100% !important;
			min-height: 0;
			flex: 1;
			padding: 0;
		}

		.modal-actions {
			gap: 4px;
		}

		.modal-actions :global(.modal-btn) {
			min-height: 40px;
			min-width: 40px;
			padding: 0 8px;
		}

		.modal-whiteboard-btn .btn-text {
			display: none;
		}
	}
</style>
