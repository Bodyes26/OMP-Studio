<!--
  Renderer per il tool `todo`.

  Mostra l'operazione (es. init, update, complete) e il riepilogo dello stato
  dei task nel sommario. Nel corpo visualizza le fasi (senza id sul filo,
  quindi indicizzate per posizione) con l'elenco dei task e i rispettivi
  glifi di stato: pendente (○), in corso (● in brand), completato (✓ in faint),
  abbandonato (barrato) e bloccato (in warn con tooltip del blocker).
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
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
		parts.push(`${stats.completed}/${stats.total} completati`);
		if (stats.inProgress > 0) {
			parts.push(`${stats.inProgress} in corso`);
		}
		if (stats.blocked > 0) {
			parts.push(`${stats.blocked} bloccati`);
		}
		return parts.join(', ');
	});

	const STATUS_GLYPH: Record<TaskItem['status'], string> = {
		pending: '○',
		in_progress: '●',
		completed: '✓',
		abandoned: '―',
		blocked: '⊘'
	};

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
			<div class="phases-container">
				{#each phases as phase, phaseIdx (phaseIdx)}
					<div class="phase-section">
						<div class="phase-header">{phase.name}</div>
						<ul class="task-list">
							{#each phase.tasks as task, taskIdx (taskIdx)}
								<li class="task-row {task.status}">
									<span
										class="glyph"
										class:pulse={task.status === 'in_progress'}
										title={task.status === 'blocked' ? (task.blocker ?? 'Bloccato') : undefined}
									>
										{STATUS_GLYPH[task.status]}
									</span>
									<span
										class="task-text"
										class:strikethrough={task.status === 'abandoned'}
										title={task.blocker ? `Bloccante: ${task.blocker}` : undefined}
									>
										{task.content}
									</span>
								</li>
							{/each}
						</ul>
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
		gap: var(--space-3);
		min-width: 0;
	}

	.phases-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.phase-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.phase-header {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.task-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.task-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-sm);
		line-height: 1.4;
	}

	.glyph {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		width: 14px;
		text-align: center;
		flex-shrink: 0;
	}

	.task-row.in_progress .glyph {
		color: var(--brand);
	}

	.pulse {
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.task-row.completed .glyph {
		color: var(--ink-faint);
	}

	.task-row.completed .task-text {
		color: var(--ink-muted);
	}

	.task-row.blocked .glyph {
		color: var(--warn);
	}

	.task-row.abandoned .glyph {
		color: var(--ink-faint);
	}

	.task-text {
		color: var(--ink);
		overflow-wrap: anywhere;
		user-select: text;
	}

	.strikethrough {
		text-decoration: line-through;
		color: var(--ink-faint);
	}
</style>
