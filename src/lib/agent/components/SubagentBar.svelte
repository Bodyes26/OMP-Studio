<script lang="ts">
	// Barra riassuntiva dei subagent attivi/completati, sopra il composer.
	// Clic apre il pannello dei subagent.
	import type { AgentProgress } from '../wire';

	let { subagents, onOpen } = $props<{
		subagents: AgentProgress[];
		onOpen: () => void;
	}>();

	const runningCount = $derived(subagents.filter((s: AgentProgress) => s.status === 'running').length);
	const completedCount = $derived(subagents.filter((s: AgentProgress) => s.status === 'completed').length);
	const failedCount = $derived(
		subagents.filter((s: AgentProgress) => s.status === 'failed' || s.status === 'aborted').length
	);
</script>

{#if subagents.length > 0}
	<div class="subagent-bar">
		<button type="button" class="bar-btn" onclick={onOpen}>
			<span class="dot" class:running={runningCount > 0}></span>
			<span class="label">Subagent ({subagents.length})</span>
			<span class="counts">
				{#if runningCount > 0}
					<span class="count-running">{runningCount} in corso</span>
				{/if}
				{#if completedCount > 0}
					<span class="count-done">{completedCount} completati</span>
				{/if}
				{#if failedCount > 0}
					<span class="count-failed">{failedCount} falliti</span>
				{/if}
			</span>
			<span class="arrow">▸</span>
		</button>
	</div>
{/if}

<style>
	.subagent-bar {
		display: flex;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-xs);
		min-width: 0;
	}

	.bar-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 4px var(--space-3);
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		width: 100%;
		text-align: left;
		font-size: inherit;
	}

	.bar-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ink-faint);
	}

	.dot.running {
		background: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.label {
		font-weight: 500;
	}

	.counts {
		display: flex;
		gap: var(--space-2);
		color: var(--ink-faint);
		margin-left: var(--space-1);
	}

	.count-running {
		color: var(--brand);
	}

	.count-failed {
		color: var(--brand-ink);
	}

	.arrow {
		margin-left: auto;
		color: var(--ink-faint);
	}
</style>
