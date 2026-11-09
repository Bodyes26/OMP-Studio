<!--
  Renderer per `reflect` (sintesi dalla memoria a lungo termine).

  Nel corpo espanso mostra la tabella KeyValue con i parametri della richiesta
  e il blocco OutputBlock con la risposta di sintesi completa.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
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
		if (query) rows.push({ key: m.l10n_tools_label_question(), value: query });
		if (context) rows.push({ key: m.l10n_tools_label_context(), value: context });
		const bank = str(details?.bank) ?? str(details?.bankId);
		if (bank) rows.push({ key: m.l10n_tools_label_bank(), value: bank });
		return rows;
	});
</script>

<div class="reflect-body">
	{#if argRows.length > 0}
		<KeyValue rows={argRows} />
	{/if}

	{#if text}
		<OutputBlock {text} label={m.l10n_tools_label_reflection()} />
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
