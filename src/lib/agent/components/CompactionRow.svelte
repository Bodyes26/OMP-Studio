<script lang="ts">
	// Riga di compattazione della sessione.
	// Se la compattazione e' in corso il pallino pulsa con `--brand`.
	// Se e' disponibile un riassunto dettagliato, permette di espanderlo.
	import type { CompactionEntry } from '../session.svelte';
	import { chatReveal } from '../motion';

	let { entry }: { entry: CompactionEntry } = $props();
	let expanded = $state(false);
</script>

<div class="compaction-row" class:running={entry.running}>
	<div class="main-line">
		<span class="dot" class:pulsing={entry.running}></span>
		<div class="message-stack">
			{#key entry.message}
				<div
					class="message-line"
					transition:chatReveal={{ duration: 180, blur: 4, distance: 0 }}
				>
					<span class="message">{entry.message}</span>
					{#if entry.summary}
						<button
							type="button"
							class="toggle-btn"
							onclick={() => (expanded = !expanded)}
							aria-expanded={expanded}
							title={expanded ? 'Nascondi dettagli riassunto' : 'Mostra dettagli riassunto'}
						>
							{expanded ? 'Nascondi riassunto' : 'Mostra riassunto'}
						</button>
					{/if}
				</div>
			{/key}
		</div>
	</div>

	{#if expanded && entry.summary}
		<div class="summary-card" transition:chatReveal={{ duration: 150, blur: 2, distance: 0 }}>
			<div class="summary-header">Riepilogo del contesto compattato</div>
			<div class="summary-text">{entry.summary}</div>
		</div>
	{/if}
</div>
<style>
	.compaction-row {
		width: 100%;
		border-top: 1px solid var(--line);
		padding: var(--space-2) 0;
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.main-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.message-stack {
		display: grid;
		min-width: 0;
		flex: 1;
	}

	.message-stack > :global(*) {
		grid-area: 1 / 1;
	}

	.message-line {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		min-width: 0;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		flex-shrink: 0;
		transition: background-color var(--dur-base) var(--ease-out);
	}

	.compaction-row.running .dot {
		background: var(--brand);
		animation: pulse-dot 1.2s infinite ease-in-out;
	}

	@keyframes pulse-dot {
		0%, 100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.4;
			transform: scale(1.3);
		}
	}

	.message {
		color: var(--ink-faint);
		user-select: text;
		word-break: break-word;
		transition: color var(--dur-base) var(--ease-out);
	}

	.compaction-row.running .message {
		color: var(--ink-muted);
	}

	.toggle-btn {
		font-size: 10px;
		font-family: inherit;
		color: var(--ink-muted);
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px 6px;
		cursor: pointer;
		transition: all var(--dur-base) var(--ease-out);
	}

	.toggle-btn:hover {
		color: var(--ink);
		border-color: var(--line-strong, var(--line));
		background: var(--surface-3, var(--surface-2));
	}

	.summary-card {
		margin-top: var(--space-2);
		margin-left: calc(6px + var(--space-2));
		padding: var(--space-2) var(--space-3);
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	.summary-header {
		font-weight: 500;
		color: var(--ink-muted);
		margin-bottom: var(--space-1);
		text-transform: uppercase;
		font-size: 9px;
		letter-spacing: 0.05em;
	}

	.summary-text {
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 240px;
		overflow-y: auto;
		line-height: 1.5;
	}
</style>
