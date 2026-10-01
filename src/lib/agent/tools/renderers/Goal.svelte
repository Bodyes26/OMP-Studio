<!--
  Renderer per il tool `goal`.

  Nel corpo espanso mostra l'obiettivo nel registro voce tramite PromptBlock (Two Voices Rule),
  la tabella KeyValue con gli altri parametri e l'eventuale output testuale.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PromptBlock from '../parts/PromptBlock.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const goalText = $derived(
		str(args.goal) ??
			str(args.description) ??
			str(args.objective) ??
			str(args.text) ??
			str(details?.goal) ??
			''
	);
	const status = $derived(str(args.status) ?? str(details?.status));
	const category = $derived(str(args.category) ?? str(details?.category));
	const priority = $derived(str(args.priority) ?? str(details?.priority));
	const text = $derived(resultText(result));

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (status) rows.push({ key: m.ui_goal_stato_89af(), value: status });
		if (category) rows.push({ key: 'Categoria', value: category });
		if (priority) rows.push({ key: m.ui_goal_priorita_e480(), value: priority });
		return rows;
	});
</script>

<div class="goal-body">
	{#if goalText}
		<PromptBlock text={goalText} label="Obiettivo" />
	{/if}

	{#if argsRows.length > 0}
		<KeyValue rows={argsRows} />
	{/if}

	{#if text && text !== goalText}
		<OutputBlock {text} label="risultato goal" />
	{/if}
</div>

<style>
	.goal-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
