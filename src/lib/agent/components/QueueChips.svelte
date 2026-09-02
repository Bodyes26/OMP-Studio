<script lang="ts">
	// Specchio dei messaggi in coda durante lo streaming (sola lettura).
	//
	// La modalita (steer / follow-up) viene trasmessa a omp nell'istante
	// dell'invio e il protocollo RPC non espone comandi per modificare,
	// rimuovere o riordinare un messaggio gia accodato (nessun dequeue/clear_queue).
	import type { QueuedMessage } from '../session.svelte';
	import { stripEditorContext } from '$lib/editor/editorContext';

	let {
		queued,
		serverCount
	} = $props<{
		queued: QueuedMessage[];
		serverCount: number;
	}>();

	function truncate(text: string, max = 60): string {
		const stripped = stripEditorContext(text);
		const clean = (stripped || text).replace(/\s+/g, ' ').trim();
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
				<span
					class="chip-badge"
					class:steer={item.behavior === 'steer'}
					class:follow-up={item.behavior === 'followUp'}
					title="La modalita si scegle all'invio: Invio o Alt+Invio. omp non permette di modificarla ne di annullare il messaggio dopo l'accodamento."
				>
					{item.behavior === 'steer' ? 'Steer' : 'Follow-up'}
				</span>
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

	.chip-badge {
		display: inline-flex;
		align-items: center;
		padding: 1px var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.2;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: calc(var(--radius-sm) - 1px);
		color: var(--ink-faint);
		font-weight: 600;
		user-select: none;
	}

	.chip-badge.steer {
		color: var(--brand-ink);
	}

	.chip-badge.follow-up {
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
