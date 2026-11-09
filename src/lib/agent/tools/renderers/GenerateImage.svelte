<!--
  Renderer per il tool `generate_image`.

  Nel corpo espanso mostra le immagini generate in ImageBlock, i percorsi con PathChip,
  il prompt nel registro voce tramite PromptBlock (Two Voices Rule),
  i parametri tecnici in KeyValue e l'eventuale output testuale.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import ImageBlock from '../parts/ImageBlock.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import PromptBlock from '../parts/PromptBlock.svelte';
	import {
		asRecord,
		resultImages,
		resultText,
		str,
		strList,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

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
	const imagePaths = $derived(strList(details?.imagePaths));

	const text = $derived(resultText(result));

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (provider) rows.push({ key: m.l10n_tools_label_provider(), value: provider });
		if (model) rows.push({ key: m.ui_generateimage_modello_b6ca(), value: model });
		if (style) rows.push({ key: m.l10n_tools_label_style(), value: style });
		if (aspectRatio) rows.push({ key: m.l10n_tools_label_aspect_ratio(), value: aspectRatio });
		if (imageSize) rows.push({ key: m.l10n_tools_label_image_size(), value: imageSize });
		if (action) rows.push({ key: m.l10n_tools_label_action(), value: action });
		if (scene) rows.push({ key: m.l10n_tools_label_scene(), value: scene });
		if (composition) rows.push({ key: m.l10n_tools_label_framing(), value: composition });
		if (lighting) rows.push({ key: m.l10n_tools_label_lighting(), value: lighting });
		return rows;
	});
</script>

<div class="image-gen-body">
	{#if images.length > 0}
		<div class="images-container">
			<ImageBlock {images} />
		</div>
	{/if}

	{#if imagePaths.length > 0}
		<div class="paths-container">
			{#each imagePaths as path (path)}
				<PathChip {path} />
			{/each}
		</div>
	{/if}

	{#if prompt}
		<PromptBlock text={prompt} label={m.l10n_tools_label_generation_prompt()} />
	{/if}

	{#if argsRows.length > 0}
		<KeyValue rows={argsRows} />
	{/if}

	{#if text && text !== prompt}
		<OutputBlock {text} label={m.l10n_tools_label_result()} />
	{/if}
</div>

<style>
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

	.paths-container {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
	}
</style>
