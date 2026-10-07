<!--
  Renderer per il tool `read`.

  Mostra il file letto o la sorgente (URL, artifact) tramite ToolFileHeader,
  i metadati della sorgente e l'anteprima del contenuto letto in OutputBlock.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import ToolFileHeader from '../parts/ToolFileHeader.svelte';
	import {
		asRecord,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const meta = $derived(asRecord(details?.meta));
	const source = $derived(asRecord(meta?.source));

	const sourceType = $derived(str(source?.type) ?? 'path');
	const sourceValue = $derived(str(source?.value) ?? str(args.path) ?? str(args.file) ?? '');
	const isPath = $derived(sourceType === 'path');

	// Il selettore di riga (`:10-50`, `:10+150`, ...) viaggia appiccicato al
	// percorso: se lo si passa cosi' com'e' a Monaco, l'apertura del file fallisce
	// perche' quel percorso non esiste sul disco.
	function splitPathSelector(value: string): { path: string; line: number | null } {
		const idx = value.lastIndexOf(':');
		if (idx <= 1) return { path: value, line: null };
		const selector = value.slice(idx + 1);
		if (!/^(raw|\d)/.test(selector)) return { path: value, line: null };
		const lineMatch = /\d+/.exec(selector);
		return { path: value.slice(0, idx), line: lineMatch ? Number(lineMatch[0]) : null };
	}

	const pathSelector = $derived(isPath ? splitPathSelector(sourceValue) : { path: sourceValue, line: null });

	const totalLines = $derived(num(details?.totalLines));
	const fileSize = $derived(num(details?.fileSize));

	const displayContent = $derived(asRecord(details?.displayContent));
	const contentText = $derived(str(displayContent?.text) ?? resultText(result));

	function formatFileSize(bytes: number | undefined): string | undefined {
		if (bytes === undefined) return undefined;
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	const sizeFormatted = $derived(formatFileSize(fileSize));

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (totalLines !== undefined) {
			rows.push({ key: 'Righe', value: String(totalLines) });
		}
		if (fileSize !== undefined) {
			rows.push({
				key: 'Dimensione',
				value: sizeFormatted ? `${fileSize} byte (${sizeFormatted})` : `${fileSize} byte`
			});
		}
		return rows;
	});
</script>

<div class="read-body">
	{#if isPath && sourceValue}
		<ToolFileHeader
			path={pathSelector.path}
			line={pathSelector.line}
			meta={sizeFormatted || (totalLines !== undefined ? m.chat_lines_count({ count: totalLines }) : undefined)}
		/>
	{:else if sourceValue}
		<div class="source-header">
			<span class="source-label">{sourceType}:</span>
			<span class="source-value">{sourceValue}</span>
		</div>
	{/if}
	{#if metaRows.length > 0}
		<KeyValue rows={metaRows} />
	{/if}
	<OutputBlock text={contentText} label="contenuto file" />
</div>

<style>
	.read-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.source-header {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.source-label {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		text-transform: capitalize;
	}

	.source-value {
		font-family: var(--font-mono);
		color: var(--ink);
		overflow-wrap: anywhere;
	}
</style>
