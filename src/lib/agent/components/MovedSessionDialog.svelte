<script lang="ts">
	import Dialog from '#lib/ui/Dialog.svelte';
	import { m } from '#lib/paraglide/messages.js';

	let { machine, transcript, onClose, onContinue }: { machine: string; transcript: string; onClose: () => void; onContinue?: () => void } = $props();

	function messagesOf(transcript: string) {
		const rows: { role: string; text: string }[] = [];
		for (const line of transcript.split('\n')) {
			try {
				const record = JSON.parse(line);
				const message = record.type === 'message' ? record.message : null;
				if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
				const content = message.content;
				const text = typeof content === 'string' ? content : Array.isArray(content) ? content
					.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n') : '';
				if (text) rows.push({ role: message.role, text });
			} catch { /* I record incompleti non fanno parte della conversazione. */ }
		}
		return rows;
	}
	const entries = $derived(messagesOf(transcript));
</script>

<Dialog open title={m.session_move_readonly({ machine })} {onClose}>
	{#snippet body()}
		<div class="archive">
			{#each entries as entry}
				<p class:user={entry.role === 'user'}>{entry.text}</p>
			{/each}
		</div>
	{/snippet}
	{#snippet footer()}
		<button type="button" class="ui-button ui-button-ghost" onclick={onClose}>{m.common_cancel()}</button>
		{#if onContinue}<button type="button" class="ui-button ui-button-primary" onclick={onContinue}>{m.session_move_title({ machine })}</button>{/if}
	{/snippet}
</Dialog>

<style>
	.archive { display: flex; flex-direction: column; gap: 1rem; max-height: 55vh; overflow: auto; }
	.archive p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
	.archive p.user { background: var(--bg-raised); padding: 0.75rem; }
</style>
