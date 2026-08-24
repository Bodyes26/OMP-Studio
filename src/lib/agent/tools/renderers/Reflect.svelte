<script lang="ts">
	// Renderer per `reflect` (sintesi dalla memoria a lungo termine).
	//
	// Cosa mostra:
	// - summary: prima riga del testo di riflessione/sintesi prodotto o la
	//   query originale se il risultato non e' ancora disponibile.
	// - body: tabella `KeyValue` con i parametri della richiesta (`query`,
	//   `context`) e blocco monospazio `OutputBlock` con la risposta di sintesi
	//   completa.
	//
	// Comportamento quando `details` e' assente:
	// Il tool `reflect` opera principalmente restituendo testo: il componente
	// estrae il contenuto direttamente da `resultText(result)` e i parametri
	// da `args`, funzionando in modo completo anche senza alcun campo in `details`.

	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const query = $derived(str(args.query) ?? '');
	const context = $derived(str(args.context));
	const text = $derived(resultText(result));
	const details = $derived(asRecord(result?.details));

	const argRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (query) rows.push({ key: 'domanda', value: query });
		if (context) rows.push({ key: 'contesto', value: context });
		const bank = str(details?.bank) ?? str(details?.bankId);
		if (bank) rows.push({ key: 'banca', value: bank });
		return rows;
	});

	const firstLine = $derived.by(() => {
		if (text) {
			const clean = text.replace(/^Based on recalled memories:\s*/i, '');
			return clean.split('\n', 1)[0] ?? '';
		}
		return query;
	});
</script>

{#if view === 'summary'}
	<span class="summary-line">
		{#if firstLine}
			<span class="text-preview">{firstLine}</span>
		{/if}
	</span>
{:else}
	<div class="reflect-body">
		{#if argRows.length > 0}
			<KeyValue rows={argRows} />
		{/if}

		{#if text}
			<OutputBlock {text} label="riflessione" />
		{/if}
	</div>
{/if}

<style>
	.summary-line {
		display: flex;
		align-items: baseline;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
	}

	.text-preview {
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.reflect-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
