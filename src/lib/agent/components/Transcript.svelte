<script lang="ts">
	// Transcript: itera `entries` con chiavi stabili (`e.id`, contatore monotono
	// assegnato all'inserimento, mai l'indice). Delega il rendering per `kind`.
	//
	// Rendering a finestre: se ci sono piu' di 300 entry mostra le ultime 300
	// e un bottone «Carica precedenti» in cima che ne scopre altre 300.
	import { projectStore } from '../../stores/projects.svelte';
	import type { AgentSession, TranscriptEntry } from '../session.svelte';
	import ToolCard from '../tools/ToolCard.svelte';

	import AssistantText from './AssistantText.svelte';
	import CompactionRow from './CompactionRow.svelte';
	import NoticeRow from './NoticeRow.svelte';
	import RetryRow from './RetryRow.svelte';
	import TtsrRow from './TtsrRow.svelte';
	import UserMessage from './UserMessage.svelte';

	let { session } = $props<{ session: AgentSession }>();
	let transcriptEl = $state<HTMLElement | null>(null);

	const projectName = $derived(
		projectStore.activeProject?.name ?? session.sessionName ?? 'Progetto'
	);

	function applySuggestion(suggestion: string) {
		// Ogni progetto mantiene la propria Chat montata anche quando e'
		// nascosta: una query sul documento prenderebbe il composer della prima
		// scheda, non quello accanto a questo stato vuoto.
		const textarea = transcriptEl
			?.closest('.chat-surface')
			?.querySelector<HTMLTextAreaElement>('.composer-textarea');
		if (!textarea) return;
		textarea.value = suggestion;
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
		textarea.focus();
	}

</script>

<div class="transcript" bind:this={transcriptEl} class:is-empty={session.visibleEntries.length === 0}>
	{#if session.hasEarlier}
		<div class="earlier-bar">
			<button type="button" class="earlier-btn" onclick={() => session.showEarlier()}>
				Carica precedenti ({session.entries.length - session.visibleCount} nascoste)
			</button>
		</div>
	{/if}

	{#if session.visibleEntries.length === 0}
		<div class="empty-state">
			<div class="empty-header">
				<h2 class="project-title">{projectName}</h2>
				<p class="project-desc">
					Spazio di lavoro dell'agente per esplorare il codice, eseguire modifiche e lanciare task.
				</p>
			</div>

			<div class="suggestions">
				<span class="suggestions-label">Suggerimenti per iniziare:</span>
				<div class="suggestions-list">
					<button
						type="button"
						class="suggestion-btn"
						onclick={() => applySuggestion('Spiegami la struttura del progetto')}
					>
						Spiegami la struttura del progetto
					</button>
					<button
						type="button"
						class="suggestion-btn"
						onclick={() => applySuggestion('Trova i punti di ingresso principali del codice')}
					>
						Trova i punti di ingresso principali del codice
					</button>
					<button
						type="button"
						class="suggestion-btn"
						onclick={() => applySuggestion('Mostra lo stato del repository e le modifiche recenti')}
					>
						Mostra lo stato del repository e le modifiche recenti
					</button>
				</div>
			</div>

			<div class="shortcuts-row">
				<span class="shortcut"><kbd>/</kbd> comandi</span>
				<span class="shortcut"><kbd>Invio</kbd> invia</span>
				<span class="shortcut"><kbd>Esc</kbd> interrompi</span>
			</div>
		</div>
	{:else}
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
	{/if}
</div>

<style>
	.transcript {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		min-width: 0;
	}

	.transcript.is-empty {
		flex: 1;
		justify-content: center;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		max-width: 480px;
		margin: 0 auto;
		width: 100%;
		padding: var(--space-4);
		text-align: center;
	}

	.empty-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.project-title {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.project-desc {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.suggestions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
	}

	.suggestions-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-align: left;
	}

	.suggestions-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
	}

	.suggestion-btn {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.suggestion-btn:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.shortcuts-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		padding-top: var(--space-1);
	}

	.shortcut {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.shortcut kbd {
		font-family: var(--font-mono);
		font-size: 10px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px 5px;
		color: var(--ink-muted);
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
