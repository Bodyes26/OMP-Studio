<!--
  Renderer per `yield` (consegna del risultato finale da parte di un subagent).

  Nel corpo mostra il risultato completo tramite OutputBlock (con limite ampio),
  il blocco JSON per i dati strutturati e l'eventuale errore di esecuzione
  con segnalazione semantica mirata (Outcome-Only Color Rule).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import JsonBlock from '../parts/JsonBlock.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

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
</script>

<div class="yield-body">
	{#if errorMessage}
		<div class="error-banner">
			<span class="error-label">{m.ui_yield_errore_subagent_5b6a()}</span>
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

<style>
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
		padding: var(--space-1) var(--space-2);
		border-left: 2px solid var(--danger);
	}

	.error-label {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--danger);
		font-weight: 600;
	}

	.error-text {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.45;
		user-select: text;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
