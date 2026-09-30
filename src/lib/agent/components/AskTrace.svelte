<script lang="ts">
	// Traccia del tool `ask` nella chat. La scheda interattiva sta sopra il
	// composer (AskCard): qui, finche' la domanda e' aperta, resta solo il
	// richiamo; dopo l'invio, il riepilogo compatto delle risposte.
	import { m } from '$lib/paraglide/messages.js';
	import { IconAsk, IconCheck, IconNote } from '$lib/icons';
	import type { ToolEntry } from '../session.svelte';
	import { parseAskToolCall, summarizeAskAnswer } from '../askResult';

	let { entry } = $props<{ entry: ToolEntry }>();

	const questions = $derived(parseAskToolCall(entry.args, entry.result?.details));
	const answers = $derived(questions.map((q) => ({ q, a: summarizeAskAnswer(q) })));
	const answered = $derived(answers.some(({ a }) => a.kind !== 'none'));
	const waiting = $derived(!entry.result && entry.running);
</script>

{#if waiting}
	<div class="ask-waiting" role="status">
		<IconAsk aria-hidden="true" />
		<span class="who">{questions.length > 1 ? m.chat_v2_ask_pending_many() : m.chat_v2_ask_pending_one()}</span>
		<span class="hint">· {m.chat_v2_ask_pending_hint()}</span>
	</div>
{:else if entry.result?.isError || !answered}
	<div class="ask-closed">
		<IconAsk aria-hidden="true" />
		<span>{m.chat_v2_ask_closed()}</span>
		{#if questions[0]?.question}
			<span class="closed-q" title={questions[0].question}>· {questions[0].question}</span>
		{/if}
	</div>
{:else}
	<div class="ask-sent">
		<div class="sent-head">
			<IconCheck aria-hidden="true" />
			{questions.length === 1 ? m.chat_v2_ask_sent_one() : m.chat_v2_ask_sent_many({ count: questions.length })}
		</div>
		<dl class="sent-list">
			{#each answers as { q, a }, index (q.id + index)}
				<dt title={q.question}>{q.header || q.question}</dt>
				<dd class:decided={a.kind !== 'answered'}>
					{#if a.kind === 'decided'}
						{m.chat_v2_ask_decide_active()}
					{:else if a.kind === 'none'}
						{m.chat_v2_ask_no_answer()}
					{:else}
						{a.labels.join(', ')}
					{/if}
					{#if a.note}
						<span class="sent-note"><IconNote aria-hidden="true" />{a.note}</span>
					{/if}
				</dd>
			{/each}
		</dl>
	</div>
{/if}

<style>
	.ask-waiting,
	.ask-closed {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-size: var(--text-xs);
		--icon-size: 14px;
	}
	.ask-waiting {
		color: var(--warn);
	}
	.ask-waiting .who {
		font-weight: 500;
	}
	.ask-waiting .hint {
		color: color-mix(in oklab, var(--warn) 65%, transparent);
	}
	.ask-closed {
		color: var(--ink-faint);
	}
	.closed-q {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ask-sent {
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--bg-raised) 50%, transparent);
		padding: 10px 14px 12px;
		min-width: 0;
	}
	.sent-head {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 8px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		--icon-size: 14px;
	}
	.sent-list {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 20px;
		row-gap: 6px;
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.45;
	}
	.sent-list dt {
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
	}
	.sent-list dd {
		margin: 0;
		min-width: 0;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.sent-list dd.decided {
		font-style: italic;
		color: var(--ink-muted);
	}
	.sent-note {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin-top: 2px;
		font-size: var(--text-xs);
		font-style: normal;
		color: var(--ink-muted);
		--icon-size: 13px;
	}
	.sent-note :global(svg) {
		margin-top: 2px;
		flex-shrink: 0;
	}
</style>
