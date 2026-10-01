<!--
  Renderer per il tool `write`.

  Nel corpo espanso mostra ToolFileHeader con il percorso del file e la dimensione scritta,
  i metadati dell'operazione e l'anteprima del contenuto scritto (troncato a 40 righe).
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import ToolFileHeader from '../parts/ToolFileHeader.svelte';
	import { asRecord, resultText, str, type ToolRenderProps } from '../types';

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const filePath = $derived(
		str(details?.resolvedPath) ?? str(args.path) ?? str(args.file) ?? ''
	);
	const content = $derived(str(args.content) ?? '');
	const textResult = $derived(resultText(result));

	const writtenBytesLabel = $derived.by(() => {
		if (textResult) {
			const match = /(\d+(?:\.\d+)?)\s*(?:bytes?|B|KB|MB)/i.exec(textResult);
			if (match) return match[0];
		}
		if (content) {
			// `Blob` conta i byte senza allocare un buffer copia grande quanto il
			// file ad ogni ricalcolo reattivo, a differenza di `TextEncoder.encode`.
			const byteLen = new Blob([content]).size;
			if (byteLen < 1024) return `${byteLen} B`;
			if (byteLen < 1024 * 1024) return `${(byteLen / 1024).toFixed(1)} KB`;
			return `${(byteLen / (1024 * 1024)).toFixed(1)} MB`;
		}
		return undefined;
	});

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		const resolved = str(details?.resolvedPath);
		const rawPath = str(args.path);
		if (resolved && rawPath && resolved !== rawPath) {
			rows.push({ key: 'Percorso risolto', value: resolved });
		}
		if (writtenBytesLabel) {
			rows.push({ key: 'Dimensione', value: writtenBytesLabel });
		}
		return rows;
	});
</script>

<div class="write-body">
	{#if filePath}
		<ToolFileHeader path={filePath} meta={writtenBytesLabel} />
	{/if}
	{#if metaRows.length > 0}
		<KeyValue rows={metaRows} />
	{/if}
	{#if content}
		<OutputBlock text={content} maxLines={40} label="contenuto" />
	{/if}
	{#if textResult && textResult !== content}
		<OutputBlock text={textResult} label="risultato" />
	{/if}
</div>

<style>
	.write-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
