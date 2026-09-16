<!--
  Renderer per il tool `todo`.

  Mostra l'operazione (es. init, update, complete) e il riepilogo dello stato
  dei task nel sommario. Nel corpo visualizza le fasi tramite il primitivo TaskRow,
  con indice fase nell'anello, metrica completed/total e dettagli espandibili con
  stato dei singoli task e blocker inline.
-->
<script lang="ts">
	import { flip } from 'svelte/animate';
	import { m } from '$lib/paraglide/messages.js';
	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import TaskRow from '../../components/TaskRow.svelte';
	import { todoPhaseToTaskRow } from '../../taskRow';
	import type { TodoStatus } from '../../wire';
	import {
		asRecord,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const op = $derived(str(details?.op) ?? str(args.op) ?? 'todo');

	interface TaskItem {
		content: string;
		status: 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';
		blocker?: string;
	}

	interface PhaseItem {
		name: string;
		tasks: TaskItem[];
	}

	const phases = $derived.by<PhaseItem[]>(() => {
		// Durante `init` il risultato non e' ancora arrivato: le fasi proposte
		// viaggiano in `args.list`, nella stessa forma di `details.phases`.
		const rawPhases = recordList(details?.phases ?? args.list);
		const out: PhaseItem[] = [];
		for (const p of rawPhases) {
			const phaseName = str(p.name) ?? 'Fase';
			const rawTasks = recordList(p.tasks);
			const tasks: TaskItem[] = [];
			for (const t of rawTasks) {
				const content = str(t.content) ?? str(t.text) ?? '';
				const rawStatus = str(t.status) ?? 'pending';
				let status: TaskItem['status'] = 'pending';
				if (
					rawStatus === 'in_progress' ||
					rawStatus === 'completed' ||
					rawStatus === 'abandoned' ||
					rawStatus === 'blocked'
				) {
					status = rawStatus;
				}
				tasks.push({
					content,
					status,
					blocker: str(t.blocker)
				});
			}
			out.push({ name: phaseName, tasks });
		}
		return out;
	});

	const stats = $derived.by(() => {
		let total = 0;
		let inProgress = 0;
		let completed = 0;
		let blocked = 0;
		let abandoned = 0;
		for (const phase of phases) {
			for (const task of phase.tasks) {
				total++;
				if (task.status === 'in_progress') inProgress++;
				else if (task.status === 'completed') completed++;
				else if (task.status === 'blocked') blocked++;
				else if (task.status === 'abandoned') abandoned++;
			}
		}
		return { total, inProgress, completed, blocked, abandoned };
	});

	const summaryStats = $derived.by(() => {
		if (stats.total === 0) return undefined;
		const parts: string[] = [];
		parts.push(`${stats.completed}/${stats.total} ${m.task_row_status_completed().toLowerCase()}`);
		if (stats.inProgress > 0) {
			parts.push(m.ui_task_value1_in_corso_8e50({ value1: stats.inProgress }));
		}
		if (stats.blocked > 0) {
			parts.push(`${stats.blocked} ${m.task_row_status_blocked().toLowerCase()}`);
		}
		return parts.join(', ');
	});

	const phaseModels = $derived(
		phases.map((phase, idx) =>
			todoPhaseToTaskRow(
				{
					id: `phase-${idx}`,
					name: phase.name,
					tasks: phase.tasks.map((t, tIdx) => ({
						id: `task-${idx}-${tIdx}`,
						content: t.content,
						status: t.status as TodoStatus,
						blocker: t.blocker
					}))
				},
				idx
			)
		)
	);

	const textFallback = $derived(resultText(result));
</script>

{#if view === 'summary'}
	<div class="todo-summary">
		<span class="op">{op}</span>
		{#if summaryStats}
			<CountBadge text={summaryStats} />
		{/if}
	</div>
{:else}
	<div class="todo-body">
		{#if phases.length > 0}
			<div class="phases-container" role="list">
				{#each phaseModels as model, idx (model.key)}
					<div
						animate:flip={{ duration: 200 }}
						class="phase-item"
						role="listitem"
						style="--stagger-delay: {idx * 30}ms"
					>
						<TaskRow {model} />
					</div>
				{/each}
			</div>
		{:else if textFallback}
			<OutputBlock text={textFallback} label="risultato todo" />
		{/if}
	</div>
{/if}

<style>
	.todo-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.op {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		font-weight: 500;
	}

	.todo-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.phases-container {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}

	.phase-item {
		animation: todo-stagger 200ms ease-out var(--stagger-delay, 0ms) both;
	}

	.phase-item + .phase-item {
		border-top: 1px solid var(--line);
	}

	@keyframes todo-stagger {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.phase-item {
			animation: none;
		}
	}

	:root[data-animations="false"] .phase-item {
		animation: none;
	}
</style>
