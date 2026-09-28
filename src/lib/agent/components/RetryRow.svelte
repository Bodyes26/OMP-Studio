<script lang="ts">
	// Riga di retry: notifica di un tentativo ripetuto del modello o del tool.
	// Linguaggio v2: traccia leggera (12.5px, --ink-muted, icona 14px).
	import type { RetryEntry } from '../session.svelte';
	import { IconRefresh } from '$lib/icons';

	let { entry, fresh = false }: { entry: RetryEntry; fresh?: boolean } = $props();
</script>

<div
	class="retry-row"
	class:rv-blur={fresh}
	style={fresh ? '--dur: 400ms; --blur: 4px;' : undefined}
>
	<div class="main-line">
		<span class="row-icon" aria-hidden="true">
			<IconRefresh />
		</span>
		<span class="message">{entry.message}</span>
	</div>
</div>

<style>
	.retry-row {
		width: 100%;
		padding: 2px 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--ink-muted);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.main-line {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.row-icon {
		--icon-size: 14px;
		width: 14px;
		height: 14px;
		color: var(--ink-muted);
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.message {
		color: var(--ink-muted);
		user-select: text;
		word-break: break-word;
	}
</style>
