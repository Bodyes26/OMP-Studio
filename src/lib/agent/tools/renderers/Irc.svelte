<!--
  Renderer per il tool `irc`.

  Forma attesa di `details`:
  `to` (string), `from` (string), `receipts` (array), `waited` (object),
  `inbox` (array), `peers` (array).

  Comportamento quando `details` manca o e' incompleto:
  Mostra il destinatario e il messaggio (troncato) nel sommario. Nel corpo
  mostra la tabella KeyValue con gli argomenti della trasmissione e l'output
  testuale di risposta in OutputBlock.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		bool,
		formatDuration,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const to = $derived(str(args.to) ?? str(args.recipient) ?? str(details?.to) ?? 'tutti');
	const from = $derived(str(args.from) ?? str(details?.from));
	const message = $derived(str(args.message) ?? str(args.text) ?? '');
	const replyTo = $derived(str(args.replyTo));
	const awaitReply = $derived(bool(args.await));
	const timeoutMs = $derived(num(args.timeoutMs));
	const text = $derived(resultText(result));

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		rows.push({ key: 'Destinatario', value: to });
		if (from) rows.push({ key: 'Mittente', value: from });
		if (replyTo) rows.push({ key: 'In risposta a', value: replyTo });
		if (awaitReply !== undefined) {
			rows.push({ key: 'Attesa risposta', value: awaitReply ? 'sì' : 'no' });
		}
		if (timeoutMs !== undefined) {
			const dur = formatDuration(timeoutMs);
			if (dur) rows.push({ key: 'Timeout', value: dur });
		}
		return rows;
	});
</script>

{#if view === 'summary'}
	<div class="irc-summary">
		<CountBadge text={`a ${to}`} />
		{#if message}
			<span class="msg-text">{message}</span>
		{/if}
	</div>
{:else}
	<div class="irc-body">
		{#if message}
			<div class="msg-card">
				<span class="msg-label">Messaggio:</span>
				<p class="msg-full-text">{message}</p>
			</div>
		{/if}

		{#if argsRows.length > 0}
			<KeyValue rows={argsRows} />
		{/if}

		{#if text}
			<OutputBlock {text} label="risposta irc" />
		{/if}
	</div>
{/if}

<style>
	.irc-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.msg-text {
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.irc-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.msg-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
	}

	.msg-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		user-select: none;
	}

	.msg-full-text {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
</style>
