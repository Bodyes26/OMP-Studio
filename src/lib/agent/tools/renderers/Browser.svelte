<!--
  Renderer per il tool `browser`.

  Nel corpo espanso mostra i parametri di sessione in KeyValue,
  l'eventuale codice eseguito e l'output in OutputBlock,
  e gli screenshot acquisiti tramite ImageBlock.
-->
<script lang="ts">
	import ImageBlock from '../parts/ImageBlock.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		num,
		resultImages,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

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

	// Gli screenshot presi con `tab.screenshot()` durante lo script finiscono in
	// `details.screenshots`, separati dagli eventuali blocchi immagine del
	// risultato: senza unirli si perdono proprio gli screenshot presi a meta' run.
	const detailScreenshots = $derived.by(() => {
		const raw = details?.screenshots;
		if (!Array.isArray(raw)) return [];
		const out: { data: string; mimeType: string }[] = [];
		for (const entry of raw) {
			if (typeof entry === 'string') {
				out.push({ data: entry, mimeType: 'image/png' });
				continue;
			}
			const rec = asRecord(entry);
			const data = str(rec?.data) ?? str(rec?.base64);
			if (!data) continue;
			out.push({ data, mimeType: str(rec?.mimeType) ?? 'image/png' });
		}
		return out;
	});
	const images = $derived([...resultImages(result), ...detailScreenshots]);
	const text = $derived(str(details?.result) ?? resultText(result));

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

<style>
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
