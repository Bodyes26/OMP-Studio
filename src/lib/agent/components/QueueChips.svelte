<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { stripEditorContext } from '$lib/editor/editorContext';
	import type { QueuedMessage } from '../session.svelte';
	import type { LocalFollowUp } from '../localFollowUpQueue';

	let {
		local,
		queued,
		serverCount,
		paused,
		onEdit,
		onRemove,
		onResume
	} = $props<{
		local: LocalFollowUp[];
		queued: QueuedMessage[];
		serverCount: number;
		paused: boolean;
		onEdit: (id: number) => void;
		onRemove: (id: number) => void;
		onResume: () => void;
	}>();

	function truncate(text: string): string {
		const stripped = stripEditorContext(text);
		const clean = (stripped || text).replace(/\s+/g, ' ').trim();
		return clean.length > 70 ? `${clean.slice(0, 67)}...` : clean;
	}
</script>

<div class="queue-list" role="status" aria-label={m.chat_v2_queue_aria()}>
	{#each local as item (item.id)}
		<div class="queue-row">
			<span class="kind">{m.chat_v2_queue_followup()}</span>
			<span class="message" title={item.text}>{truncate(item.text)}</span>
			{#if item.images.length > 0}
				<span class="images">{m.chat_v2_queue_attachments({ count: item.images.length })}</span>
			{/if}
			<button type="button" onclick={() => onEdit(item.id)}>{m.chat_v2_queue_edit()}</button>
			<button type="button" onclick={() => onRemove(item.id)}>{m.chat_v2_queue_remove()}</button>
		</div>
	{/each}
	{#each queued as item (item.id)}
		<div class="queue-row server">
			<span class="kind">{item.behavior === 'steer' ? m.chat_v2_queue_steer() : m.chat_v2_queue_followup()}</span>
			<span class="message" title={item.text}>{truncate(item.text)}</span>
		</div>
	{/each}
	{#if serverCount > queued.length}
		<p class="server-count">{m.chat_v2_queue_server_count({ count: serverCount })}</p>
	{/if}
	{#if paused && local.length > 0}
		<div class="paused">
			<span>{m.chat_v2_queue_paused()}</span>
			<button type="button" onclick={onResume}>{m.chat_v2_queue_send_now()}</button>
		</div>
	{/if}
</div>

<style>
	.queue-list { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
	.queue-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--bg-base); }
	.queue-row.server { opacity: .7; }
	.kind { flex-shrink: 0; color: var(--brand-ink); font: 600 var(--text-trace) var(--font-mono); }
	.message { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ink); font-size: var(--text-trace); }
	.images, .server-count { color: var(--ink-muted); font-size: var(--text-trace); }
	.images { flex-shrink: 0; }
	.server-count { margin: var(--space-1) var(--space-2); }
	.paused { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); color: var(--ink-muted); font-size: var(--text-trace); padding: var(--space-1) var(--space-2); }
	button { flex-shrink: 0; border: 0; background: transparent; color: var(--brand-ink); font-size: var(--text-trace); cursor: pointer; padding: var(--space-1); border-radius: var(--radius-md); }
	button:hover { background: var(--bg-hover); }
	button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
</style>
