<!--
  Anteprima visiva di un file scritto dal tool `write`: SVG come immagine,
  Mermaid (.mmd, .mermaid) come diagramma.

  L'SVG scritto dall'agente e' contenuto arbitrario: va nell'iframe sandbox di
  SvgPreview. Il diagramma Mermaid e' generato da Mermaid in modalita' strict e
  sanificato, quindi sta inline come nella whiteboard dei diagrammi.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import SvgPreview from '$lib/editor/SvgPreview.svelte';
	import { renderMermaidSvg } from '$lib/mermaidSvg';
	import { onThemeChange } from '$lib/theme';
	import ToolFileHeader from './ToolFileHeader.svelte';

	let {
		path,
		kind,
		content
	}: {
		path: string;
		kind: 'svg' | 'mermaid';
		content: string;
	} = $props();

	const name = $derived(path.split(/[\\/]/).pop() ?? path);

	let mermaidSvg = $state('');
	let mermaidError = $state<string | null>(null);
	// I colori sono cotti nell'SVG al render: al cambio tema si ridisegna.
	let themeEpoch = $state(0);

	$effect(() => onThemeChange(() => themeEpoch++));

	$effect(() => {
		if (kind !== 'mermaid') return;
		const source = content;
		void themeEpoch;
		let stale = false;
		renderMermaidSvg(source).then(
			(svg) => {
				if (stale) return;
				mermaidSvg = svg;
				mermaidError = null;
			},
			(error: unknown) => {
				if (stale) return;
				mermaidSvg = '';
				mermaidError = error instanceof Error ? error.message : String(error);
			}
		);
		return () => {
			stale = true;
		};
	});
</script>

<figure class="write-preview">
	<figcaption><ToolFileHeader {path} /></figcaption>
	{#if kind === 'svg'}
		<div class="svg-frame">
			<SvgPreview {content} title={name} />
		</div>
	{:else if mermaidError}
		<div class="mermaid-error" role="alert">{m.ui_diagramviewer_errore_mermaid_d820()} {mermaidError}</div>
	{:else if mermaidSvg}
		<!-- SVG di Mermaid (securityLevel strict) passato da sanitizeSvg. -->
		<div class="mermaid-host">{@html mermaidSvg}</div>
	{/if}
</figure>

<style>
	.write-preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-2) 0 0;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		min-width: 0;
	}

	/* L'iframe sandbox non puo' misurare il proprio contenuto: altezza fissa,
	   l'SVG si adatta dentro mantenendo le proporzioni. */
	.svg-frame {
		height: 240px;
	}

	.mermaid-host {
		display: flex;
		justify-content: center;
		overflow: auto;
	}

	.mermaid-host :global(svg) {
		display: block;
		max-width: 100%;
		max-height: 360px;
		height: auto;
	}

	.mermaid-error {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
	}
</style>
