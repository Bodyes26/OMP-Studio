<!--
  Renderer per il tool `irc`.

  Nel corpo mostra il messaggio scambiato tramite PromptBlock (Two Voices Rule),
  la tabella KeyValue con gli argomenti della trasmissione e l'output testuale in OutputBlock.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PromptBlock from '../parts/PromptBlock.svelte';
	import {
		asRecord,
		bool,
		formatDuration,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

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
			rows.push({ key: 'Attesa risposta', value: awaitReply ? m.ui_bash_si_ef73() : 'no' });
		}
		if (timeoutMs !== undefined) {
			const dur = formatDuration(timeoutMs);
			if (dur) rows.push({ key: 'Timeout', value: dur });
		}
		return rows;
	});
</script>

<div class="irc-body">
	{#if message}
		<PromptBlock text={message} label={m.ui_irc_messaggio_d997()} />
	{/if}

	{#if argsRows.length > 0}
		<KeyValue rows={argsRows} />
	{/if}

	{#if text}
		<OutputBlock {text} label="risposta irc" />
	{/if}
</div>

<style>
	.irc-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
