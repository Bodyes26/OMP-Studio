<!--
  Diagramma Mermaid inline, condiviso dai blocchi ```mermaid della chat e
  dalle anteprime dei file .mmd scritti dall'agente.

  L'SVG e' generato da Mermaid in modalita' strict e sanificato
  (`renderMermaidSvg`), quindi sta inline come nella whiteboard dei diagrammi.
-->
<script lang="ts">
	import { renderMermaidSvg } from '$lib/mermaidSvg';
	import { onThemeChange } from '$lib/theme';

	let {
		source,
		error = $bindable(null),
		ready = $bindable(false)
	}: {
		source: string;
		error?: string | null;
		ready?: boolean;
	} = $props();

	let svg = $state('');
	// I colori sono cotti nell'SVG al render: al cambio tema si ridisegna.
	let themeEpoch = $state(0);

	$effect(() => onThemeChange(() => themeEpoch++));

	$effect(() => {
		const current = source;
		void themeEpoch;
		let stale = false;
		// Durante lo streaming la sorgente cambia a ogni token ed e' spesso
		// incompleta: si ridisegna solo quando smette di cambiare.
		const timer = setTimeout(() => {
			renderMermaidSvg(current).then(
				(rendered) => {
					if (stale) return;
					svg = rendered;
					error = null;
					ready = true;
				},
				(failure: unknown) => {
					if (stale) return;
					svg = '';
					error = failure instanceof Error ? failure.message : String(failure);
					ready = false;
				}
			);
		}, 250);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	});
</script>

{#if svg}
	<!-- SVG di Mermaid (securityLevel strict) passato da sanitizeSvg. -->
	<div class="mermaid-host">{@html svg}</div>
{/if}

<style>
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
</style>
