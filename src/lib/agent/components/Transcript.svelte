<script lang="ts">
	// Transcript: itera `entries` con chiavi stabili (`e.id`, contatore monotono
	// assegnato all'inserimento, mai l'indice). Delega il rendering per `kind`.
	//
	// Rendering a finestre: se ci sono piu' di 300 entry mostra le ultime 300
	// e un bottone «Carica precedenti» in cima che ne scopre altre 300.
	import type { AgentSession, TranscriptEntry } from '../session.svelte';
	import ToolCard from '../tools/ToolCard.svelte';

	import AssistantText from './AssistantText.svelte';
	import CompactionRow from './CompactionRow.svelte';
	import NoticeRow from './NoticeRow.svelte';
	import RetryRow from './RetryRow.svelte';
	import ThinkingBlock from './ThinkingBlock.svelte';
	import TtsrRow from './TtsrRow.svelte';
	import UserMessage from './UserMessage.svelte';

	let { session } = $props<{ session: AgentSession }>();
</script>

<div class="transcript">
	{#if session.hasEarlier}
		<div class="earlier-bar">
			<button type="button" class="earlier-btn" onclick={() => session.showEarlier()}>
				Carica precedenti ({session.entries.length - session.visibleCount} nascoste)
			</button>
		</div>
	{/if}

	{#each session.visibleEntries as entry (entry.id)}
		{#if entry.kind === 'user'}
			<UserMessage {entry} />
		{:else if entry.kind === 'assistant'}
			<AssistantText {entry} streaming={session.isStreaming} />
		{:else if entry.kind === 'tool'}
			<ToolCard {entry} />
		{:else if entry.kind === 'notice'}
			<NoticeRow {entry} />
		{:else if entry.kind === 'compaction'}
			<CompactionRow {entry} />
		{:else if entry.kind === 'retry'}
			<RetryRow {entry} />
		{:else if entry.kind === 'ttsr'}
			<TtsrRow {entry} />
		{/if}
	{/each}
</div>

<style>
	.transcript {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		min-width: 0;
	}

	.earlier-bar {
		display: flex;
		justify-content: center;
		padding: var(--space-1) 0;
	}

	.earlier-btn {
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 4px var(--space-3);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.earlier-btn:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}
</style>
