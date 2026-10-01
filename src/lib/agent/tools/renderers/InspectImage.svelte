<!--
  Renderer per `inspect_image`.

  Nel corpo espanso mostra le miniature delle immagini in ImageBlock,
  il percorso del file con ToolFileHeader, la domanda dell'utente
  nel registro voce tramite PromptBlock (Two Voices Rule),
  i metadati del modello in KeyValue e l'analisi testuale in OutputBlock.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import ImageBlock from '../parts/ImageBlock.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PromptBlock from '../parts/PromptBlock.svelte';
	import ToolFileHeader from '../parts/ToolFileHeader.svelte';
	import {
		asRecord,
		resultImages,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

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
		if (model) rows.push({ key: m.ui_companionview_modello_fa78(), value: model });
		if (mimeType) rows.push({ key: 'tipo', value: mimeType });
		if (imagePath && imagePath !== path) rows.push({ key: 'risolto', value: imagePath });
		return rows;
	});

	const isFilePath = $derived(path.includes('/') || path.includes('\\'));
</script>

<div class="inspect-body">
	{#if images.length > 0}
		<ImageBlock {images} />
	{/if}

	{#if isFilePath}
		<ToolFileHeader {path} />
	{/if}

	{#if question}
		<PromptBlock text={question} label="Domanda" />
	{/if}

	{#if metaRows.length > 0}
		<KeyValue rows={metaRows} />
	{/if}

	{#if text}
		<OutputBlock {text} label="analisi" />
	{/if}
</div>

<style>
	.inspect-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
