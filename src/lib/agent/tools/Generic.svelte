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

	// Mentre il tool e' in corso `result` e' assente: senza questa sintesi il
	// sommario resterebbe vuoto proprio nel momento in cui l'utente guarda.
	function previewValue(value: unknown): string {
		if (typeof value === 'string') return value;
		if (value === null || value === undefined) return String(value);
		if (Array.isArray(value)) return `[${value.length}]`;
		if (typeof value === 'object') return '{…}';
		return String(value);
	}

	const argsPreview = $derived(
		Object.entries(args)
			.map(([key, value]) => `${key}: ${previewValue(value)}`)
			.join(', ')
	);

	const summaryLine = $derived(firstLine || argsPreview);
</script>

{#if view === 'summary'}
	<span class="one-line">{summaryLine}</span>
{:else}
	<JsonBlock value={args} />
	<JsonBlock value={result?.details} label="dettagli" />
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
