<!--
  Renderer per il tool `fetch`.

  Nel corpo espanso mostra i dettagli della richiesta (URL, metodo, status, dimensione)
  in KeyValue e la risposta completa in OutputBlock.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const url = $derived(str(details?.url) ?? str(args.url) ?? '');
	const method = $derived(str(details?.method) ?? str(args.method) ?? 'GET');
	const status = $derived(num(details?.status));
	const statusText = $derived(str(details?.statusText));
	const text = $derived(resultText(result));

	const charCount = $derived(text.length);

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (url) rows.push({ key: 'URL', value: url });
		if (method) rows.push({ key: 'Metodo', value: method });
		if (status !== undefined) {
			rows.push({
				key: m.ui_goal_stato_89af(),
				value: statusText ? `${status} ${statusText}` : String(status)
			});
		}
		if (charCount > 0) {
			rows.push({ key: 'Dimensione', value: `${i18n.formatNumber(charCount)} caratteri` });
		}
		return rows;
	});
</script>

<div class="fetch-body">
	{#if argsRows.length > 0}
		<KeyValue rows={argsRows} />
	{/if}

	{#if text}
		<OutputBlock {text} label="risposta fetch" />
	{/if}
</div>

<style>
	.fetch-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
