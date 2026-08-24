<script lang="ts">
	// Renderer per `yield` (consegna del risultato finale da parte di un subagent).
	//
	// Cosa mostra:
	// - summary: prima riga del testo o dato restituito dal subagent.
	// - body: visualizzazione del risultato completo tramite `OutputBlock` (con
	//   limite di righe ampio, essendo la consegna principale) ed eventuale
	//   blocco JSON `JsonBlock` per i dati strutturati (`result.data`).
	//
	// Comportamento quando `details` e' assente:
	// `yield` non fa affidamento su `details`: il componente estrae il contenuto
	// direttamente da `resultText(result)` e dagli argomenti (`args.result`,
	// `args.data`, `args.error`), garantendo una resa completa in ogni circostanza.

	import JsonBlock from '../parts/JsonBlock.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const resRecord = $derived(asRecord(args.result));
	const dataRecord = $derived(resRecord ? asRecord(resRecord.data) : asRecord(args.data));
	const dataArray = $derived(
		resRecord && Array.isArray(resRecord.data)
			? resRecord.data
			: Array.isArray(args.data)
				? args.data
				: null
	);
	const structuredData = $derived(dataRecord ?? dataArray);

	const errorMessage = $derived(
		str(resRecord?.error) ?? str(args.error) ?? (result?.isError ? resultText(result) : undefined)
	);

	const mainText = $derived.by(() => {
		const text = resultText(result);
		if (text) return text;
		const strRes = str(args.result);
		if (strRes) return strRes;
		const strData = resRecord ? str(resRecord.data) : str(args.data);
		if (strData) return strData;
		const strContent = str(args.content) ?? str(args.text);
		if (strContent) return strContent;
		return '';
	});

	const firstLine = $derived.by(() => {
		if (errorMessage) return `Errore: ${errorMessage.split('\n', 1)[0]}`;
		if (mainText) return mainText.split('\n', 1)[0] ?? '';
		if (structuredData) return '(Dati strutturati)';
		return '(Nessun output)';
	});
</script>

{#if view === 'summary'}
	<span class="summary-line" class:error={!!errorMessage}>
		{#if firstLine}
			<span class="text-preview">{firstLine}</span>
		{/if}
	</span>
{:else}
	<div class="yield-body">
		{#if errorMessage}
			<div class="error-banner">
				<span class="error-label">Errore subagent</span>
				<p class="error-text">{errorMessage}</p>
			</div>
		{/if}

		{#if mainText}
			<OutputBlock text={mainText} label="risultato finale" maxLines={48} />
		{/if}

		{#if structuredData}
			<JsonBlock value={structuredData} label="dati strutturati" />
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

	.summary-line.error .text-preview {
		color: var(--brand);
	}

	.text-preview {
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.yield-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.error-banner {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2);
		background: var(--brand-ink);
		border: 1px solid var(--brand);
		border-radius: var(--radius-sm);
	}

	.error-label {
		font-size: var(--text-xs);
		color: var(--brand);
		font-weight: 500;
	}

	.error-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.4;
		user-select: text;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
