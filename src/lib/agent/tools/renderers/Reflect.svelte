<!--
  Renderer per `reflect` (sintesi dalla memoria a lungo termine).

  Nel corpo espanso mostra la tabella KeyValue con i parametri della richiesta
  e il blocco OutputBlock con la risposta di sintesi completa.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const query = $derived(str(args.query) ?? '');
	const context = $derived(str(args.context));
	const text = $derived(resultText(result));
	const details = $derived(asRecord(result?.details));

	const argRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (query) rows.push({ key: 'Domanda', value: query });
		if (context) rows.push({ key: 'Contesto', value: context });
		const bank = str(details?.bank) ?? str(details?.bankId);
		if (bank) rows.push({ key: 'Banca', value: bank });
		return rows;
	});
</script>

<div class="reflect-body">
	{#if argRows.length > 0}
		<KeyValue rows={argRows} />
	{/if}

	{#if text}
		<OutputBlock {text} label="riflessione" />
	{/if}
</div>

<style>
	.reflect-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
