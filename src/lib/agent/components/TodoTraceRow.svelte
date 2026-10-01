<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { IconChevronDown, IconQueue } from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { Lingering } from '../motionState.svelte';
	import type { TodoTraceItem } from '../todoTrace';

	let { trace } = $props<{ trace: TodoTraceItem }>();
	let open = $state(false);

	const bodyLinger = new Lingering<boolean>();
	$effect(() => {
		bodyLinger.update(open ? true : undefined);
	});
	onDestroy(() => {
		bodyLinger.dispose();
	});
</script>

{#if trace.type === 'creation'}
	<div class="trace-row">
		<button type="button" class="trace-header" aria-expanded={open} onclick={() => (open = !open)}>
			<span class="trace-symbol"><IconQueue aria-hidden="true" /></span>
			<span>{m.chat_v2_trace_todo_list({ total: trace.total })}</span>
			<span class="meta">· {m.chat_v2_trace_todo_completed({ count: trace.completed })}</span>
			<span class="chevron" class:expanded={open} aria-hidden="true"><IconChevronDown /></span>
		</button>
		{#if bodyLinger.shown !== undefined}
			<div class={bodyLinger.leaving ? 'tray-out' : 'tray-in'}>
				<div class="tray-fold-inner">
					<div class="trace-body">
						{#each trace.phases as phase}
							{#if trace.phases.length > 1}<strong>{phase.name}</strong>{/if}
							{#each phase.tasks as task}
								<div class="task-row">
									<StatusMark status={task.status === 'completed' ? 'completed' : task.status === 'blocked' ? 'blocked' : 'pending'} />
									<span>{task.content}{#if task.blocker} · {task.blocker}{/if}</span>
								</div>
							{/each}
						{/each}
					</div>
				</div>
			</div>
		{/if}
	</div>
{:else if trace.type === 'phase_header'}
	<div class="trace-row phase" role="status">{trace.phaseName}</div>
{:else if trace.type === 'step'}
	<!-- Il passo e' storia del racconto: lo stato vivo sta nel vassoio, qui il segno resta fermo. -->
	<div class="trace-row step" role="status">
		<StatusMark status={trace.status === 'completed' ? 'completed' : trace.status === 'blocked' ? 'blocked' : 'running'} active={false} />
		<span class="count">{trace.globalIndex}/{trace.total}</span>
		<span>{trace.title}</span>
		{#if trace.blocker}<span class="meta"> · {trace.blocker}</span>{/if}
	</div>
{:else}
	<div class="trace-row step" role="status"><StatusMark status="completed" />{m.chat_v2_trace_todo_done_of_total({ completed: trace.completed, total: trace.total })}</div>
{/if}

<style>
	.trace-row { margin: var(--space-1) 0; padding: 3px var(--space-3); font-size: var(--text-trace); color: var(--ink-muted); }
	.trace-header { display:flex; align-items:center; gap:var(--space-2); width:100%; text-align:left; color:inherit; font:inherit; border:0; background:none; cursor:pointer; padding:0; }
	.trace-header:hover { color:var(--ink); }
	.trace-symbol { --icon-size: 14px; display:inline-flex; align-items:center; }
	.meta { color:var(--ink-faint); }
	.chevron { --icon-size: 13px; display:inline-flex; align-items:center; justify-content:center; transition:transform var(--dur-fast) var(--ease-out); flex-shrink:0; }
	.chevron.expanded { transform:rotate(180deg); }
	.trace-body { border-left:1px solid var(--line); margin:var(--space-2) 0 0 6px; padding:0 var(--space-3); display:grid; gap:4px; }
	.task-row { display:flex; gap:var(--space-2); align-items:center; }
	.phase { font-weight:600; color:var(--ink); }
	.step { display:flex; align-items:center; gap:var(--space-2); }
	.count { font-variant-numeric:tabular-nums; color:var(--ink-faint); }
</style>
