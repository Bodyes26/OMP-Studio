<script lang="ts">
	// Specchio dei messaggi in coda durante lo streaming.
	//
	// Consente di commutare il comportamento di accodamento (steer / follow-up)
	// direttamente per ciascun messaggio in coda.
	import type { QueuedMessage } from '../session.svelte';
	import type { StreamingBehavior } from '../wire';

	let {
		queued,
		serverCount,
		onToggleBehavior
	} = $props<{
		queued: QueuedMessage[];
		serverCount: number;
		onToggleBehavior?: (id: number, behavior: StreamingBehavior) => void;
	}>();

	function handleSetBehavior(item: QueuedMessage, behavior: StreamingBehavior) {
		if (item.behavior === behavior) return;
		item.behavior = behavior;
		onToggleBehavior?.(item.id, behavior);
	}

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
			>
				<div class="chip-behavior-switch" role="group" aria-label="Comportamento messaggio in coda">
					<button
						type="button"
						class="chip-behavior-btn"
						class:active={item.behavior === 'steer'}
						onclick={() => handleSetBehavior(item, 'steer')}
						title="Steer: interrompe il turno corrente per inserire il messaggio"
					>
						steer
					</button>
					<button
						type="button"
						class="chip-behavior-btn"
						class:active={item.behavior === 'followUp'}
						onclick={() => handleSetBehavior(item, 'followUp')}
						title="Follow-up: attende la fine del turno e accoda il messaggio"
					>
						follow-up
					</button>
				</div>
				<span class="chip-text" title={item.text}>{truncate(item.text)}</span>
			</div>
		{/each}

		{#if serverCount > 0 && serverCount !== queued.length}
			<div class="chip server-count">
				<span class="server-label">{serverCount} in coda sul server</span>
			</div>
		{/if}

		<span class="queue-limit-note">non cancellabili da omp</span>
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
		padding: 2px 4px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		max-width: 420px;
		user-select: text;
	}

	.chip-behavior-switch {
		display: inline-flex;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px;
		gap: 1px;
		user-select: none;
	}

	.chip-behavior-btn {
		padding: 1px var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-transform: lowercase;
		background: transparent;
		border: none;
		border-radius: calc(var(--radius-sm) - 1px);
		color: var(--ink-faint);
		cursor: pointer;
		line-height: 1.2;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}
	.chip-behavior-btn:hover {
		color: var(--ink);
	}

	.chip-behavior-btn.active {
		background: var(--bg-base);
		color: var(--ink);
		font-weight: 600;
	}

	.chip.steer .chip-behavior-btn.active {
		color: var(--brand-ink);
	}

	.chip.follow-up .chip-behavior-btn.active {
		color: var(--ink);
	}

	.chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
		font-size: var(--text-xs);
		padding-left: 2px;
	}
	.server-count {
		color: var(--ink-faint);
		background: transparent;
	}

	.server-label {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.queue-limit-note {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin-left: auto;
		user-select: none;
	}
</style>
