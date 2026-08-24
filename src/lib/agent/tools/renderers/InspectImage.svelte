<script lang="ts">
	// Renderer per `inspect_image`.
	//
	// Cosa mostra:
	// - summary: percorso o etichetta dell'immagine (`args.path`) affiancato
	//   dalla domanda (`args.question`) troncata su una sola riga.
	// - body: miniature delle immagini caricate/restituite (`ImageBlock`), percorso
	//   completo del file se applicabile (`PathChip`), domanda estesa, metadati
	//   del modello (`details.model`, `details.mimeType`, `details.imagePath`)
	//   e blocco monospazio dell'analisi testuale (`OutputBlock`).
	//
	// Comportamento quando `details` e' assente:
	// Il componente legge l'analisi testuale direttamente da `resultText(result)`
	// e i parametri da `args`, omettendo silenziosamente la sezione metadati senza
	// lanciare alcuna eccezione.

	import ImageBlock from '../parts/ImageBlock.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		resultImages,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const path = $derived(str(args.path) ?? '');
	const question = $derived(str(args.question) ?? '');
	const text = $derived(resultText(result));
	const images = $derived(resultImages(result));
	const details = $derived(asRecord(result?.details));

	const model = $derived(str(details?.model));
	const imagePath = $derived(str(details?.imagePath));
	const mimeType = $derived(str(details?.mimeType));

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (model) rows.push({ key: 'modello', value: model });
		if (mimeType) rows.push({ key: 'tipo', value: mimeType });
		if (imagePath && imagePath !== path) rows.push({ key: 'risolto', value: imagePath });
		return rows;
	});

	const isFilePath = $derived(path.includes('/') || path.includes('\\'));
	const firstTextLine = $derived(text.split('\n', 1)[0] ?? '');
</script>

{#if view === 'summary'}
	<span class="summary-line">
		{#if path}
			<span class="img-badge" title={path}>{path}</span>
		{/if}
		{#if question}
			<span class="question-preview">{question}</span>
		{:else if firstTextLine}
			<span class="fallback-preview">{firstTextLine}</span>
		{/if}
	</span>
{:else}
	<div class="inspect-body">
		{#if images.length > 0}
			<ImageBlock {images} />
		{/if}

		{#if isFilePath}
			<div class="path-row">
				<PathChip {path} full />
			</div>
		{/if}

		{#if question}
			<div class="question-section">
				<span class="question-label">Domanda</span>
				<p class="question-text">{question}</p>
			</div>
		{/if}

		{#if metaRows.length > 0}
			<KeyValue rows={metaRows} />
		{/if}

		{#if text}
			<OutputBlock {text} label="analisi" />
		{/if}
	</div>
{/if}

<style>
	.summary-line {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
	}

	.img-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1);
		flex-shrink: 0;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.question-preview {
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.fallback-preview {
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.inspect-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.path-row {
		display: flex;
		align-items: center;
	}

	.question-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.question-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.question-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.4;
		user-select: text;
	}
</style>
