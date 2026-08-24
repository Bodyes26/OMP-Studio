<!--
  Renderer per il tool `write`.

  Mostra il percorso del file scritto nel sommario e la stima o conferma dei
  byte scritti. Nel corpo mostra l'anteprima del contenuto passato al tool,
  troncato di default a 40 righe per non dominare la vista.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import { asRecord, resultText, str, type ToolRenderProps } from '../types';

	let { args, result, view }: ToolRenderProps = $props();

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

{#if view === 'summary'}
	<div class="write-summary">
		{#if filePath}
			<PathChip path={filePath} />
		{/if}
		{#if writtenBytesLabel}
			<CountBadge text={writtenBytesLabel} muted />
		{/if}
	</div>
{:else}
	<div class="write-body">
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
{/if}

<style>
	.write-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.write-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
