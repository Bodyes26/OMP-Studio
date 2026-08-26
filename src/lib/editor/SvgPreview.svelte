<!--
  Componente di rendering sicuro per file SVG.
  Isola completamente il rendering rispetto al WebView privilegiato di Tauri
  utilizzando un iframe con sandbox restrittivo (nessun allow-scripts, nessun allow-same-origin),
  CSP ermetica (default-src 'none') e pre-sanitizzazione con DOMPurify.
-->
<script lang="ts">
	import { buildSandboxedSvgDocument } from './svgSandbox';

	let {
		content,
		title = 'Anteprima SVG'
	}: {
		content: string;
		title?: string;
	} = $props();

	let srcDoc = $derived(buildSandboxedSvgDocument(content));
</script>

<iframe
	class="svg-sandbox-frame"
	sandbox=""
	{title}
	srcdoc={srcDoc}
></iframe>

<style>
	.svg-sandbox-frame {
		width: 100%;
		height: 100%;
		border: none;
		background: transparent;
		display: block;
	}
</style>
