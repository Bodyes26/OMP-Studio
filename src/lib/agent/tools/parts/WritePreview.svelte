<!--
  Anteprima visiva di un file scritto dal tool `write`: SVG come immagine,
  Mermaid (.mmd, .mermaid) come diagramma.

  L'SVG scritto dall'agente e' contenuto arbitrario: va nell'iframe sandbox di
  SvgPreview. Il diagramma Mermaid lo disegna MermaidDiagram.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import SvgPreview from '#lib/editor/SvgPreview.svelte';
	import MermaidDiagram from '#lib/agent/components/MermaidDiagram.svelte';
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

	let mermaidError = $state<string | null>(null);
</script>

<figure class="write-preview">
	<figcaption><ToolFileHeader {path} /></figcaption>
	{#if kind === 'svg'}
		<div class="svg-frame">
			<SvgPreview {content} title={name} />
		</div>
	{:else}
		<MermaidDiagram source={content} bind:error={mermaidError} />
		{#if mermaidError}
			<div class="mermaid-error" role="alert">{m.ui_diagramviewer_errore_mermaid_d820()} {mermaidError}</div>
		{/if}
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

	.mermaid-error {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
	}
</style>
