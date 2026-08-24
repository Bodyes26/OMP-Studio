<!--
  Renderer per il tool `read`.

  Mostra il file letto o la sorgente (URL, artifact), con conteggio di righe
  e dimensione nel sommario. Nel corpo espanso mostra il contenuto con
  numeri di riga / troncamento e i metadati della sorgente. Se la sorgente
  non e' un file su disco (es. URL remoto o artifact), viene resa come testo
  invece di usare PathChip.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		countLabel,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

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
		if (sourceValue) {
			rows.push({ key: isPath ? 'Percorso' : 'Sorgente', value: sourceValue });
		}
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

{#if view === 'summary'}
	<div class="read-summary">
		{#if isPath && sourceValue}
			<PathChip path={pathSelector.path} line={pathSelector.line} />
		{:else if sourceValue}
			<span class="source-text">{sourceValue}</span>
		{/if}
		{#if totalLines !== undefined}
			<CountBadge text={countLabel(totalLines, 'riga', 'righe')} />
		{/if}
		{#if sizeFormatted}
			<CountBadge text={sizeFormatted} muted />
		{/if}
	</div>
{:else}
	<div class="read-body">
		{#if metaRows.length > 0}
			<KeyValue rows={metaRows} />
		{/if}
		<OutputBlock text={contentText} label="contenuto file" />
	</div>
{/if}

<style>
	.read-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source-text {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.read-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
