<!--
  Renderer per il tool `generate_image`.

  Forma attesa di `details`:
  `provider` (string), `model` (string), `imageCount` (number),
  `imagePaths` (string[]), `images` (array), `usage` (object).

  Comportamento quando `details` manca o e' incompleto:
  Estrae le immagini prodotte tramite `resultImages(result)`.
  Recupera il prompt da `args.subject`, `args.prompt` o `args.text`.
  Mostra gli altri parametri di generazione in KeyValue e le immagini in ImageBlock.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import ImageBlock from '../parts/ImageBlock.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		countLabel,
		num,
		resultImages,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const prompt = $derived(str(args.subject) ?? str(args.prompt) ?? str(args.text) ?? '');
	const provider = $derived(str(details?.provider) ?? str(args.provider));
	const model = $derived(str(details?.model) ?? str(args.model));
	const style = $derived(str(args.style));
	const aspectRatio = $derived(str(args.aspect_ratio));
	const imageSize = $derived(str(args.image_size));
	const action = $derived(str(args.action));
	const scene = $derived(str(args.scene));
	const composition = $derived(str(args.composition));
	const lighting = $derived(str(args.lighting));

	const images = $derived(resultImages(result));
	const count = $derived(images.length > 0 ? images.length : num(details?.imageCount));
	const countBadgeLabel = $derived(
		count !== undefined && count > 0 ? countLabel(count, 'immagine', 'immagini') : undefined
	);

	const text = $derived(resultText(result));

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (provider) rows.push({ key: 'Provider', value: provider });
		if (model) rows.push({ key: 'Modello', value: model });
		if (style) rows.push({ key: 'Stile', value: style });
		if (aspectRatio) rows.push({ key: 'Proporzioni', value: aspectRatio });
		if (imageSize) rows.push({ key: 'Dimensioni', value: imageSize });
		if (action) rows.push({ key: 'Azione', value: action });
		if (scene) rows.push({ key: 'Scena', value: scene });
		if (composition) rows.push({ key: 'Inquadratura', value: composition });
		if (lighting) rows.push({ key: 'Illuminazione', value: lighting });
		return rows;
	});
</script>

{#if view === 'summary'}
	<div class="image-gen-summary">
		<span class="prompt-text">{prompt || 'Genera immagine'}</span>
		{#if countBadgeLabel}
			<CountBadge text={countBadgeLabel} />
		{/if}
	</div>
{:else}
	<div class="image-gen-body">
		{#if images.length > 0}
			<div class="images-container">
				<ImageBlock {images} />
			</div>
		{/if}

		{#if prompt}
			<OutputBlock text={prompt} label="prompt" />
		{/if}

		{#if argsRows.length > 0}
			<KeyValue rows={argsRows} />
		{/if}

		{#if text && text !== prompt}
			<OutputBlock {text} label="risultato" />
		{/if}
	</div>
{/if}

<style>
	.image-gen-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.prompt-text {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.image-gen-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.images-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
</style>
