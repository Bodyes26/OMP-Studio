<script lang="ts">
	// Riga di subagent: stato, nome, tool corrente. Il clic apre il cassetto
	// del suo transcript. In sola lettura: il protocollo RPC non espone
	// nessun comando per steerare o terminare un subagent.
	import { agentUiHooks } from '../../ui-context';
	import type { AgentProgress } from '../../wire';
	import { formatDuration } from '../types';

	let { progress } = $props<{ progress: AgentProgress }>();

	const hooks = agentUiHooks();

	const STATUS_GLYPH: Record<string, string> = {
		pending: '○',
		running: '●',
		completed: '✓',
		failed: '✗',
		aborted: '⊘'
	};

	const status = $derived(progress.status ?? 'pending');
	const glyph = $derived(STATUS_GLYPH[status] ?? '○');
	const duration = $derived(formatDuration(progress.durationMs));
	const lastTool = $derived(progress.recentTools?.at(-1)?.tool);
</script>

<button
	type="button"
	class="agent-row"
	class:running={status === 'running'}
	class:failed={status === 'failed' || status === 'aborted'}
	onclick={() => progress.id && hooks.openSubagent(progress.id)}
	title={progress.description ?? progress.assignment ?? progress.task ?? ''}
>
	<span class="glyph">{glyph}</span>
	<span class="name">{progress.id ?? progress.agent ?? 'subagent'}</span>
	<span class="agent">{progress.agent ?? ''}</span>
	<span class="meta">
		{#if progress.lastIntent}{progress.lastIntent}{:else if lastTool}{lastTool}{/if}
	</span>
	<span class="numbers">
		{#if progress.toolCount}{progress.toolCount} tool{/if}
		{#if duration}· {duration}{/if}
	</span>
</button>

<style>
	.agent-row {
		display: grid;
		grid-template-columns: 14px minmax(60px, max-content) minmax(0, max-content) minmax(0, 1fr) max-content;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 2px var(--space-1);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		text-align: left;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.agent-row:hover {
		background: var(--bg-hover);
	}

	.glyph {
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.running .glyph {
		color: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.failed .glyph {
		color: var(--brand-ink);
	}

	.name {
		color: var(--ink);
		font-family: var(--font-mono);
	}

	.agent,
	.numbers {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		white-space: nowrap;
	}

	.meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
</style>
