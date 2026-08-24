<!--
  Renderer per il tool `fetch`.

  Forma attesa di `details`:
  La forma di `details` per fetch non e' garantita sul filo; puo' contenere
  `status` (number), `statusText` (string), `headers` (object), `url` (string),
  `method` (string).

  Comportamento quando `details` manca o e' incompleto:
  Mostra l'URL richiesto in `args.url` e la dimensione del testo risultante
  nel sommario. Nel corpo mostra i dettagli della richiesta in KeyValue e
  la risposta completa in OutputBlock.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		countLabel,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const url = $derived(str(details?.url) ?? str(args.url) ?? '');
	const method = $derived(str(details?.method) ?? str(args.method) ?? 'GET');
	const status = $derived(num(details?.status));
	const statusText = $derived(str(details?.statusText));
	const text = $derived(resultText(result));

	const charCount = $derived(text.length);
	const charLabel = $derived(
		charCount > 0 ? countLabel(charCount, 'carattere', 'caratteri') : undefined
	);

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (url) rows.push({ key: 'URL', value: url });
		if (method) rows.push({ key: 'Metodo', value: method });
		if (status !== undefined) {
			rows.push({
				key: 'Stato',
				value: statusText ? `${status} ${statusText}` : String(status)
			});
		}
		if (charCount > 0) {
			rows.push({ key: 'Dimensione', value: `${charCount.toLocaleString('it-IT')} caratteri` });
		}
		return rows;
	});
</script>

{#if view === 'summary'}
	<div class="fetch-summary">
		<span class="method-tag">{method}</span>
		<span class="url-text">{url || 'fetch'}</span>
		{#if charLabel}
			<CountBadge text={charLabel} muted />
		{/if}
	</div>
{:else}
	<div class="fetch-body">
		{#if argsRows.length > 0}
			<KeyValue rows={argsRows} />
		{/if}

		{#if text}
			<OutputBlock {text} label="risposta fetch" />
		{/if}
	</div>
{/if}

<style>
	.fetch-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.method-tag {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.url-text {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.fetch-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
