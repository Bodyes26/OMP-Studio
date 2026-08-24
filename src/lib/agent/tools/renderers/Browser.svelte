<!--
  Renderer per il tool `browser`.

  Forma attesa di `details`:
  `action` (string), `name` (string), `browser` (string), `url` (string),
  `viewport` ({ width: number, height: number }), `screenshots` (array),
  `result` (string).

  Comportamento quando `details` manca o e' incompleto:
  Legge `action`, `name`, `url` e `code` direttamente da `args`.
  Estrae gli screenshot tramite `resultImages(result)` e il testo del risultato
  tramite `resultText(result)`. Gli screenshot vengono mostrati tramite ImageBlock
  e il clic apre il visualizzatore.
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
	const action = $derived(str(details?.action) ?? str(args.action) ?? 'browser');
	const name = $derived(str(details?.name) ?? str(args.name) ?? 'main');
	const url = $derived(str(details?.url) ?? str(args.url));
	const code = $derived(str(args.code));
	const timeout = $derived(num(args.timeout));

	const viewportObj = $derived(asRecord(details?.viewport) ?? asRecord(args.viewport));
	const viewportLabel = $derived.by(() => {
		if (!viewportObj) return undefined;
		const width = num(viewportObj.width);
		const height = num(viewportObj.height);
		return width !== undefined && height !== undefined ? `${width}x${height}` : undefined;
	});

	const images = $derived(resultImages(result));
	const text = $derived(str(details?.result) ?? resultText(result));

	const targetLabel = $derived(url ?? (name !== 'main' ? `scheda "${name}"` : 'scheda principale'));

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		rows.push({ key: 'Azione', value: action });
		if (name) rows.push({ key: 'Scheda', value: name });
		if (url) rows.push({ key: 'URL', value: url });
		if (viewportLabel) rows.push({ key: 'Viewport', value: viewportLabel });
		if (timeout !== undefined) rows.push({ key: 'Timeout', value: `${timeout}s` });
		return rows;
	});
</script>

{#if view === 'summary'}
	<div class="browser-summary">
		<span class="action-tag">{action}</span>
		<span class="target-text">{targetLabel}</span>
		{#if images.length > 0}
			<CountBadge text={countLabel(images.length, 'screenshot', 'screenshot')} />
		{/if}
	</div>
{:else}
	<div class="browser-body">
		{#if argsRows.length > 0}
			<KeyValue rows={argsRows} />
		{/if}

		{#if code}
			<OutputBlock text={code} label="script eseguito" maxLines={10} />
		{/if}

		{#if text}
			<OutputBlock {text} label="risultato browser" />
		{/if}

		{#if images.length > 0}
			<div class="screenshots-section">
				<ImageBlock {images} />
			</div>
		{/if}
	</div>
{/if}

<style>
	.browser-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.action-tag {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.target-text {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.browser-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.screenshots-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
</style>
