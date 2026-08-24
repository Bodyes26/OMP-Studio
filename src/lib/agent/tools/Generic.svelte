<script lang="ts">
	// Ripiego per ogni tool senza renderer proprio, compresi gli `mcp__*`.
	// Non e' uno stato rotto: e' la card corretta quando Studio non conosce
	// la forma di quel tool.
	import ImageBlock from './parts/ImageBlock.svelte';
	import JsonBlock from './parts/JsonBlock.svelte';
	import OutputBlock from './parts/OutputBlock.svelte';
	import { resultImages, resultText, type ToolRenderProps } from './types';

	let { args, result, view }: ToolRenderProps = $props();

	const text = $derived(resultText(result));
	const images = $derived(resultImages(result));
	const firstLine = $derived(text.split('\n', 1)[0] ?? '');
</script>

{#if view === 'summary'}
	<span class="one-line">{firstLine}</span>
{:else}
	<JsonBlock value={args} />
	<OutputBlock {text} />
	<ImageBlock {images} />
{/if}

<style>
	.one-line {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}
</style>
