<script lang="ts">
	// Scheda della domanda mentre il modello la sta ancora scrivendo: stessa
	// forma di AskCard, con le parti non ancora arrivate come righe fantasma.
	// Mostra la domanda piu' recente: e' quella che si sta formando.
	import { m } from '$lib/paraglide/messages.js';
	import { IconAsk } from '$lib/icons';
	import type { StreamAskState } from '../askStream';

	let { state } = $props<{ state: StreamAskState }>();

	const multi = $derived(state.questions.length > 1);
	const current = $derived(state.questions[state.questions.length - 1]);
</script>

<div class="ask-stream" role="status" aria-live="polite" aria-label={m.chat_v2_ask_preparing()}>
	<div class="head">
		<span class="icon" aria-hidden="true"><IconAsk /></span>
		<span class="title">{multi ? m.chat_v2_ask_title_multi() : m.chat_v2_ask_title_single()}</span>
		<span class="status text-shimmer">{m.chat_v2_ask_preparing()}</span>
	</div>

	{#if multi}
		<div class="tabs" aria-hidden="true">
			{#each state.questions as question, index (index)}
				{@const cur = index === state.questions.length - 1}
				<span class="tab rv-blur" class:cur>
					<span class="num">{index + 1}</span>
					<span class:text-shimmer={cur && !question.complete}>{question.header || question.question || '…'}</span>
				</span>
			{/each}
			{#if !state.complete}<span class="ghost-line tab-ghost"></span>{/if}
		</div>
	{/if}

	{#if current}
		<div class="body">
			{#if current.header && multi}
				<span class="q-header rv-blur">{current.header}</span>
			{/if}
			{#if current.textComplete && current.question}
				<p class="q-text rv-blur">{current.question}</p>
			{:else}
				<div class="q-ghost">
					<div class="ghost-line" style="width: {Math.min(100, 10 + current.question.length * 1.3)}%"></div>
				</div>
			{/if}

			<div class="options">
				{#each current.options as option, optionIndex (optionIndex)}
					<div class="opt rv-lift" class:incomplete={!option.complete}>
						<span class="box" class:multi={current.multi} aria-hidden="true"></span>
						<span class="opt-body">
							<span class="opt-label">
								{option.label}
								{#if current.recommended === optionIndex && option.complete}
									<span class="rec">{m.chat_v2_ask_recommended()}</span>
								{/if}
							</span>
							{#if option.description}<span class="opt-desc">{option.description}</span>{/if}
						</span>
					</div>
				{/each}
				{#if current.textComplete && !current.optionsComplete}
					<div class="opt-ghost" aria-hidden="true">
						<div class="ghost-line" style="width: 33%"></div>
						<div class="ghost-line" style="width: 75%"></div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
	<!-- Nessun pulsante: si risponde solo quando omp apre la richiesta (AskCard). -->
</div>

<style>
	.ask-stream {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-2xl);
		padding: var(--space-3) var(--space-4);
		min-width: 0;
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		font-size: var(--text-xs);
	}
	.icon {
		display: inline-flex;
		color: var(--ink-muted);
		--icon-size: 16px;
	}
	.title {
		font-weight: 500;
		color: var(--ink);
	}
	.status {
		margin-left: auto;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin-left: calc(-1 * var(--space-1));
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: var(--radius-md);
		padding: 4px 10px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		max-width: 180px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tab.cur {
		background: var(--ink);
		color: var(--bg-base);
	}
	.num {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		opacity: 0.6;
	}
	.tab-ghost {
		width: 3rem;
		margin-left: 4px;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.q-header {
		margin-bottom: calc(-1 * var(--space-2));
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink-faint);
	}
	.q-text {
		margin: 0;
		font-size: var(--text-chat);
		font-weight: 500;
		line-height: 1.45;
		color: var(--ink);
	}
	.q-ghost {
		padding: 10px 0;
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.opt {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 9px 12px;
	}
	.opt.incomplete {
		opacity: 0.6;
	}
	.box {
		width: 16px;
		height: 16px;
		margin-top: 2px;
		flex-shrink: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-full);
	}
	.box.multi {
		border-radius: var(--radius-sm);
	}
	.opt-body {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.opt-label {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}
	.rec {
		background: color-mix(in oklab, var(--success) 14%, transparent);
		color: var(--success);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--success) 25%, transparent);
		border-radius: var(--radius-md);
		padding: 0 6px;
		font-size: var(--text-caption);
		line-height: 18px;
	}
	.opt-desc {
		margin-top: 2px;
		font-size: var(--text-xs);
		line-height: 1.45;
		color: var(--ink-muted);
	}
	.opt-ghost {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border: 1px dashed var(--line);
		border-radius: var(--radius-md);
		padding: 12px;
	}
</style>
