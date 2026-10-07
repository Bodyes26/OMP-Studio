<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { stripEditorContext } from '$lib/editor/editorContext';
	import type { QueuedMessage } from '../session.svelte';

	let {
		chips,
		onEdit,
		onRemove,
		onPromote
	} = $props<{
		/** Chip della coda di omp: steer prima, follow-up poi. Testo opaco. */
		chips: QueuedMessage[];
		onEdit: (chip: QueuedMessage) => void;
		onRemove: (chip: QueuedMessage) => void;
		onPromote: (chip: QueuedMessage) => void;
	}>();

	function truncate(text: string): string {
		const stripped = stripEditorContext(text);
		const clean = (stripped || text).replace(/\s+/g, ' ').trim();
		return clean.length > 70 ? `${clean.slice(0, 67)}...` : clean;
	}
</script>

<div class="queue-list" role="status" aria-label={m.chat_v2_queue_aria()}>
	{#each chips as chip, index (index)}
		<div class="queue-row">
			<span class="kind">
				{chip.queue === 'steering' ? m.chat_v2_queue_steer() : m.chat_v2_queue_followup()}
			</span>
			<span class="message" title={chip.text}>{truncate(chip.text)}</span>
			<button type="button" onclick={() => onEdit(chip)}>{m.chat_v2_queue_edit()}</button>
			<button type="button" onclick={() => onRemove(chip)}>{m.chat_v2_queue_remove()}</button>
			{#if chip.queue === 'followUp'}
				<button type="button" onclick={() => onPromote(chip)}>{m.chat_v2_queue_promote()}</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.queue-list { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
	.queue-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--bg-base); }
	.kind { flex-shrink: 0; color: var(--brand-ink); font: 600 var(--text-trace) var(--font-mono); }
	.message { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ink); font-size: var(--text-trace); }
	button { flex-shrink: 0; border: 0; background: transparent; color: var(--brand-ink); font-size: var(--text-trace); cursor: pointer; padding: var(--space-1); border-radius: var(--radius-md); }
	button:hover { background: var(--bg-hover); }
	button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
</style>
