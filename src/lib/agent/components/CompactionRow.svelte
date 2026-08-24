<script lang="ts">
	// Riga di compattazione della sessione.
	// Se la compattazione e' in corso il pallino pulsa con `state-pulse`.
	import type { CompactionEntry } from '../session.svelte';

	let { entry }: { entry: CompactionEntry } = $props();
</script>

<div class="compaction-row" class:running={entry.running}>
	<div class="main-line">
		<span class="dot"></span>
		<span class="message">{entry.message}</span>
	</div>
</div>

<style>
	.compaction-row {
		width: 100%;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		padding: var(--space-1) 0;
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.main-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		flex-shrink: 0;
	}

	.compaction-row.running .dot {
		background: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.message {
		color: var(--ink-faint);
		user-select: text;
		word-break: break-word;
	}

	.compaction-row.running .message {
		color: var(--ink-muted);
	}
</style>
