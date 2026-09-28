<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { StreamAskState } from '../askStream';

	let { state } = $props<{ state: StreamAskState }>();
</script>

<div class="ask-preview" role="status" aria-live="polite" aria-label={m.chat_v2_ask_preparing()}>
	<span class="ask-preview-heading">{m.chat_v2_ask_preparing()}</span>
	{#each state.questions as question, index (index)}
		<div class="ask-preview-question">
			<span class="ask-preview-number">{index + 1}</span>
			{#if question.question}
				<span class:incomplete={!question.textComplete}>{question.question}</span>
			{:else}
				<span class="ask-preview-placeholder" aria-hidden="true"></span>
			{/if}
		</div>
		{#each question.options as option, optionIndex (optionIndex)}
			<div class="ask-preview-option" class:incomplete={!option.complete}>
				<span aria-hidden="true">○</span>
				{#if option.label}{option.label}{:else}<span class="ask-preview-placeholder" aria-hidden="true"></span>{/if}
			</div>
		{/each}
	{/each}
	<!-- Questa anteprima non espone pulsanti: solo extension_ui_request consente di rispondere. -->
</div>

<style>
	.ask-preview { border: 1px solid var(--line-strong); border-radius: var(--radius-md); padding: var(--space-3); background: var(--bg-raised); color: var(--ink); }
	.ask-preview-heading { display: block; margin-bottom: var(--space-2); font-size: 12px; font-weight: 600; color: var(--ink-muted); }
	.ask-preview-question { display: flex; align-items: center; gap: var(--space-2); font-weight: 600; margin-top: var(--space-2); }
	.ask-preview-number { display: inline-grid; place-items: center; min-width: 20px; height: 20px; border-radius: 50%; background: var(--bg-hover); font-size: 11px; }
	.ask-preview-option { display: flex; gap: var(--space-2); margin: 4px 0 0 28px; font-size: 13px; color: var(--ink-muted); }
	.incomplete { opacity: .55; }
	.ask-preview-placeholder { display: inline-block; width: 7rem; height: 11px; border-radius: var(--radius-sm); background: var(--line-strong); opacity: .5; }
</style>
