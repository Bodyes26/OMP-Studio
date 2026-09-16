<script lang="ts">
	// Riga di subagent integrata con il primitivo TaskRow.
	//
	// Il clic sulla riga espande la disclosure dei dettagli.
	// L'apertura del transcript avviene esplicitamente dal dettaglio tramite hook.
	import { agentUiHooks } from '../../ui-context';
	import type { AgentProgress } from '../../wire';
	import { formatDuration } from '../types';
	import { agentProgressToTaskRow, type TaskRowModel } from '../../taskRow';
	import TaskRow from '../../components/TaskRow.svelte';

	interface Props {
		progress: AgentProgress;
		index?: number;
		class?: string;
	}

	let { progress, index = undefined, class: className = '' }: Props = $props();

	const hooks = agentUiHooks();

	const duration = $derived(formatDuration(progress.durationMs));

	const model = $derived.by<TaskRowModel>(() => {
		const base = agentProgressToTaskRow(progress, index);
		const durationText = duration || undefined;
		const toolCount = progress.toolCount !== undefined ? progress.toolCount : undefined;
		const hasRecentTools = Boolean(progress.recentTools && progress.recentTools.length > 0);
		const hasTranscript = Boolean(progress.id);
		const hasDetails = base.expandable || hasRecentTools || hasTranscript;

		return {
			...base,
			ringNumber: toolCount !== undefined ? toolCount : base.ringNumber,
			metric: durationText,
			expandable: hasDetails,
			details: {
				...base.details,
				model: progress.resolvedModel ?? progress.modelRole ?? progress.agent,
				lastIntent: progress.lastIntent,
				durationMs: progress.durationMs,
				recentTools: progress.recentTools,
				tokens: progress.tokens !== undefined && progress.tokens > 0 ? progress.tokens : undefined,
				cost: progress.cost !== undefined && progress.cost > 0 ? progress.cost : undefined
			}
		};
	});

	function handleOpenTranscript() {
		if (progress.id) {
			hooks.openSubagent(progress.id);
		}
	}
</script>

<TaskRow
	{model}
	class={className}
	onOpenTranscript={progress.id ? handleOpenTranscript : undefined}
>
	{#if progress.recentTools && progress.recentTools.length > 0}
		<div class="agent-recent-tools">
			<span class="tools-heading">Tool:</span>
			<div class="tools-tags">
				{#each progress.recentTools as t}
					<span class="tool-tag">{t.tool}</span>
				{/each}
			</div>
		</div>
	{/if}
</TaskRow>

<style>
	.agent-recent-tools {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		margin-top: var(--space-1);
	}

	.tools-heading {
		color: var(--ink-faint);
		font-weight: 500;
	}

	.tools-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.tool-tag {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}
</style>
