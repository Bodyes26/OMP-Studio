<script lang="ts">
	// Ripiego per ogni tool senza renderer proprio, compresi gli `mcp__*`.
	// Non e' uno stato rotto: e' la card corretta quando Studio non conosce
	// la forma di quel tool.
	import ImageBlock from './parts/ImageBlock.svelte';
	import JsonBlock from './parts/JsonBlock.svelte';
	import OutputBlock from './parts/OutputBlock.svelte';
	import { resultImages, resultText, type ToolRenderProps } from './types';

	let { args, result }: ToolRenderProps = $props();

	const text = $derived(resultText(result));
	const images = $derived(resultImages(result));
</script>

<div class="generic-body">
	<JsonBlock value={args} />
	{#if result?.details}
		<JsonBlock value={result.details} label="dettagli" />
	{/if}
	{#if text}
		<OutputBlock {text} />
	{/if}
	{#if images.length > 0}
		<ImageBlock {images} />
	{/if}
</div>

<style>
	.generic-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
