<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { IconChevronDown, IconSubagents } from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { Lingering } from '../motionState.svelte';
	import { agentUiHooks } from '../ui-context';
	import type { ToolEntry } from '../session.svelte';
	import type { AgentProgress } from '../wire';

	let { entry, subagents } = $props<{ entry: ToolEntry; subagents: AgentProgress[] }>();
	const hooks = agentUiHooks();
	let open = $state(false);

	const listLinger = new Lingering<boolean>();
	$effect(() => {
		listLinger.update(open ? true : undefined);
	});
	onDestroy(() => {
		listLinger.dispose();
	});
	const assignments = $derived.by(() => {
		const raw: unknown[] = Array.isArray(entry.args.tasks) ? entry.args.tasks
			: Array.isArray(entry.args.subagents) ? entry.args.subagents
			: entry.args.task ? [entry.args] : [];
		return raw.filter((task): task is Record<string, unknown> => !!task && typeof task === 'object');
	});
	const progress = $derived.by(() => {
		const details = entry.result?.details;
		const result: AgentProgress[] = details && typeof details === 'object' && 'progress' in details && Array.isArray(details.progress)
			? details.progress.filter((p: unknown): p is AgentProgress => !!p && typeof p === 'object')
			: [];
		const direct = subagents.filter((p: AgentProgress) => p.parentToolCallId === entry.toolCallId);
		if (direct.length > 0) return direct.map((p: AgentProgress) => ({ ...result.find((r) => r.id && r.id === p.id), ...p }));
		return result;
	});
	const total = $derived(Math.max(progress.length, assignments.length));
	const done = $derived(progress.filter((p: AgentProgress) => p.status === 'completed' || p.status === 'failed' || p.status === 'aborted').length);
	const live = $derived(progress.length === 0 || progress.some((p: AgentProgress) => p.status === 'running' || p.status === 'pending'));
	const totalCalls = $derived(progress.reduce((n: number, p: AgentProgress) => n + (p.toolCount ?? p.recentTools?.length ?? 0), 0));
	const totalMs = $derived(progress.reduce((n: number, p: AgentProgress) => n + (p.durationMs ?? 0), 0));
	function duration(ms: number | undefined): string {
		if (ms === undefined) return '';
		return `${(ms / 1000).toFixed(1)}s`;
	}
</script>

<div class="agents-trace">
	<button type="button" class="agents-header" aria-expanded={open} onclick={() => (open = !open)}>
		<span class="trace-icon"><IconSubagents aria-hidden="true" /></span>
		{#if live}
			<span>{m.chat_v2_trace_subagents_running({ total })}</span>
			<span class="meta">· {m.chat_v2_trace_subagents_done_of_total({ done, total })}</span>
		{:else}
			<span>{m.chat_v2_trace_subagents_summary({ total })}</span>
			<span class="meta">· {m.chat_v2_tray_subagents_calls({ calls: totalCalls })} · {duration(totalMs)}</span>
		{/if}
		<span class="chevron" class:expanded={open} aria-hidden="true"><IconChevronDown /></span>
	</button>
	{#if listLinger.shown !== undefined}
		<div class={listLinger.leaving ? 'tray-out' : 'tray-in'}>
			<div class="tray-fold-inner">
				<div class="agents-list">
					{#each Array.from({ length: total }) as _, index (index)}
						{@const agent = progress[index]}
						{@const assignment = assignments[index]}
						<div class="agent-row">
							<StatusMark status={agent?.status ? (agent.status === 'completed' ? 'completed' : agent.status === 'running' ? 'running' : agent.status === 'failed' ? 'failed' : agent.status === 'aborted' ? 'aborted' : 'pending') : 'pending'} />
							{#if agent?.id}
								<button type="button" class="agent-name" onclick={() => hooks.openSubagent(agent.id!)}>{agent.agent ?? agent.id}</button>
							{:else}<strong>{agent?.agent ?? (typeof assignment?.agent === 'string' ? assignment.agent : `Subagente ${index + 1}`)}</strong>{/if}
							<span class="agent-task">{agent?.task ?? agent?.description ?? (typeof assignment?.task === 'string' ? assignment.task : '')}</span>
							<span class="meta">{agent?.toolCount ?? agent?.recentTools?.length ?? 0} · {duration(agent?.durationMs)}</span>
						</div>
					{/each}
					{#if entry.result?.isError}<p class="failed">{m.task_row_status_failed()}</p>{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.agents-trace { padding:3px var(--space-3); color:var(--ink-muted); font-size:var(--text-trace); }
	.agents-header { width:100%; display:flex; align-items:center; gap:var(--space-2); background:none; border:0; color:inherit; cursor:pointer; padding:2px 0; font:inherit; text-align:left; }
	.agents-header:hover,.agent-name:hover { color:var(--ink); }
	.trace-icon { --icon-size: 14px; display:inline-flex; align-items:center; }
	.chevron { --icon-size: 13px; display:inline-flex; align-items:center; justify-content:center; transition:transform var(--dur-fast) var(--ease-out); flex-shrink:0; }
	.chevron.expanded { transform:rotate(180deg); }
	.meta { color:var(--ink-faint); font-variant-numeric:tabular-nums; }
	.agents-list { margin:var(--space-2) 0 0 6px; border-left:1px solid var(--line); padding-left:var(--space-3); display:grid; gap:5px; }
	.agent-row { display:flex; gap:var(--space-2); align-items:center; min-width:0; }
	.agent-name { background:none; border:0; color:var(--ink); padding:0; font:inherit; font-weight:600; cursor:pointer; }
	.agent-task { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.agent-row .meta { margin-left:auto; white-space:nowrap; }
	.failed { color:var(--danger); }
</style>
