<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconCheck, IconChevronDown, IconLoop } from '$lib/icons';
	import type { TodoTraceItem } from '../todoTrace';

	let { trace } = $props<{ trace: TodoTraceItem }>();
	let open = $state(false);
</script>

{#if trace.type === 'creation'}
	<div class="trace-row">
		<button type="button" class="trace-header" aria-expanded={open} onclick={() => (open = !open)}>
			<span class="trace-symbol">☷</span>
			<span>{m.chat_v2_trace_todo_list({ total: trace.total })}</span>
			<span class="meta">· {m.chat_v2_trace_todo_completed({ count: trace.completed })}</span>
			<span class:expanded={open}><IconChevronDown size={13} /></span>
		</button>
		{#if open}
			<div class="trace-body">
				{#each trace.phases as phase}
					{#if trace.phases.length > 1}<strong>{phase.name}</strong>{/if}
					{#each phase.tasks as task}
						<div class="task-row"><span aria-hidden="true">{task.status === 'completed' ? '✓' : task.status === 'blocked' ? '!' : '○'}</span>{task.content}{#if task.blocker} · {task.blocker}{/if}</div>
					{/each}
				{/each}
			</div>
		{/if}
	</div>
{:else if trace.type === 'phase_header'}
	<div class="trace-row phase" role="status">{trace.phaseName}</div>
{:else if trace.type === 'step'}
	<div class="trace-row step" role="status">
		{#if trace.status === 'completed'}<IconCheck size={13} />{:else if trace.status === 'blocked'}<span class="blocked">!</span>{:else}<IconLoop size={13} />{/if}
		<span class="count">{trace.globalIndex}/{trace.total}</span>
		<span>{trace.title}</span>
		{#if trace.blocker}<span class="meta"> · {trace.blocker}</span>{/if}
	</div>
{:else}
	<div class="trace-row step" role="status"><IconCheck size={13} />{m.chat_v2_trace_todo_done_of_total({ completed: trace.completed, total: trace.total })}</div>
{/if}

<style>
	.trace-row { margin: 4px 0; padding: 3px var(--space-3); font-size: 12px; color: var(--ink-muted); }
	.trace-header { display:flex; align-items:center; gap:var(--space-2); width:100%; text-align:left; color:inherit; font:inherit; border:0; background:none; cursor:pointer; padding:0; }
	.trace-header:hover { color:var(--ink); }
	.trace-symbol { font-size:15px; }
	.meta { color:var(--ink-faint); }
	.expanded { transform:rotate(180deg); }
	.trace-body { border-left:1px solid var(--line); margin:var(--space-2) 0 0 6px; padding:0 var(--space-3); display:grid; gap:4px; }
	.task-row { display:flex; gap:var(--space-2); }
	.phase { font-weight:600; color:var(--ink); }
	.step { display:flex; align-items:center; gap:var(--space-2); }
	.count { font-variant-numeric:tabular-nums; color:var(--ink-faint); }
	.blocked { color:var(--danger); font-weight:700; }
</style>
