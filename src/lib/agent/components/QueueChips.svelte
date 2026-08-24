<script lang="ts">
	// Specchio dei messaggi in coda durante lo streaming.
	//
	// Nessun pulsante di cancellazione (X): il protocollo RPC non espone
	// la rimozione di singoli elementi dalla coda. Mostrare un'azione non
	// supportata sarebbe fuorviante.
	import type { QueuedMessage } from '../session.svelte';

	let { queued, serverCount } = $props<{
		queued: QueuedMessage[];
		serverCount: number;
	}>();

	function truncate(text: string, max = 60): string {
		const clean = text.replace(/\s+/g, ' ').trim();
		if (clean.length <= max) return clean;
		return clean.slice(0, max - 3) + '...';
	}
</script>

{#if queued.length > 0 || serverCount > 0}
	<div class="queue-chips" role="status" aria-label="Messaggi in coda">
		{#each queued as item (item.id)}
			<div
				class="chip"
				class:steer={item.behavior === 'steer'}
				class:follow-up={item.behavior === 'followUp'}
				title="omp non espone la cancellazione dalla coda"
			>
				<span class="chip-kind">
					{item.behavior === 'followUp' ? 'follow-up' : 'steer'}
				</span>
				<span class="chip-text">{truncate(item.text)}</span>
			</div>
		{/each}

		{#if serverCount > 0 && serverCount !== queued.length}
			<div
				class="chip server-count"
				title="omp non espone la cancellazione dalla coda"
			>
				<span class="server-label">{serverCount} in coda sul server</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.queue-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border-top: 1px solid var(--line);
		font-size: var(--text-xs);
		line-height: 1.3;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px 6px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		max-width: 380px;
		cursor: default;
		user-select: text;
	}

	.chip-kind {
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.chip.steer .chip-kind {
		color: var(--brand-ink);
	}

	.chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
	}

	.server-count {
		border-style: dashed;
		color: var(--ink-faint);
		background: transparent;
	}

	.server-label {
		font-family: var(--font-mono);
		font-size: 10px;
	}
</style>
