<script lang="ts">
	// Riga di compattazione della sessione.
	// Se la compattazione e' in corso il pallino e' colorato con `--brand`.
	import type { CompactionEntry } from '../session.svelte';
	import { chatReveal } from '../motion';

	let { entry }: { entry: CompactionEntry } = $props();
</script>

<div class="compaction-row" class:running={entry.running}>
	<div class="main-line">
		<span class="dot"></span>
		<span class="message-stack">
			{#key entry.message}
				<span
					class="message"
					transition:chatReveal={{ duration: 180, blur: 4, distance: 0 }}
				>
					{entry.message}
				</span>
			{/key}
		</span>
	</div>
</div>

<style>
	.compaction-row {
		width: 100%;
		border-top: 1px solid var(--line);
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

	.message-stack {
		display: grid;
		min-width: 0;
		flex: 1;
	}

	.message-stack > :global(*) {
		grid-area: 1 / 1;
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
	}

	.message {
		color: var(--ink-faint);
		user-select: text;
		word-break: break-word;
		display: block;
		transition: color var(--dur-base) var(--ease-out);
	}

	.compaction-row.running .message {
		color: var(--ink-muted);
	}
</style>
