<!--
  Renderer per il tool `goal`.

  Forma attesa di `details`:
  La forma di `details` per goal non e' definita in modo rigido; puo' contenere
  `goal` (string), `status` (string), `category` (string), `priority` (string).

  Comportamento quando `details` manca o e' incompleto:
  Mostra l'obiettivo da `args.goal`, `args.description`, `args.objective` o
  `args.text` nel sommario (troncato). Nel corpo mostra il testo completo
  dell'obiettivo in evidenza, la tabella KeyValue con gli altri parametri,
  e l'output testuale in OutputBlock se presente.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

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
		if (status) rows.push({ key: 'Stato', value: status });
		if (category) rows.push({ key: 'Categoria', value: category });
		if (priority) rows.push({ key: 'Priorità', value: priority });
		return rows;
	});
</script>

{#if view === 'summary'}
	<div class="goal-summary">
		<CountBadge text="obiettivo" />
		<span class="goal-text">{goalText || 'Nessun obiettivo specificato'}</span>
	</div>
{:else}
	<div class="goal-body">
		{#if goalText}
			<div class="goal-card">
				<p class="goal-full-text">{goalText}</p>
			</div>
		{/if}

		{#if argsRows.length > 0}
			<KeyValue rows={argsRows} />
		{/if}

		{#if text && text !== goalText}
			<OutputBlock {text} label="risultato goal" />
		{/if}
	</div>
{/if}

<style>
	.goal-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}


	.goal-text {
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.goal-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.goal-card {
		padding: var(--space-2);
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
	}

	.goal-full-text {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
</style>
