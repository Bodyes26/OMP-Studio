<script lang="ts">
	// Riga di retry: notifica di un tentativo ripetuto del modello o del tool.
	// Riga a tutta larghezza con bordi sottili, coerente con NoticeRow.
	import type { RetryEntry } from '../session.svelte';

	let { entry }: { entry: RetryEntry } = $props();
</script>

<div class="retry-row">
	<div class="main-line">
		<span class="icon">↻</span>
		<span class="message">{entry.message}</span>
	</div>
</div>

<style>
	.retry-row {
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

	.icon {
		color: var(--ink-muted);
		font-size: var(--text-xs);
		flex-shrink: 0;
		line-height: 1;
	}

	.message {
		color: var(--ink-faint);
		user-select: text;
		word-break: break-word;
	}
</style>
