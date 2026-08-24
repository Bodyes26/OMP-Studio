<script lang="ts">
	// Striscia dei todo sopra il composer.
	//
	// Mostra solo la fase corrente e il conteggio sintetico `3/7`. Il clic
	// espande la lista completa, fase per fase. Cinque stati:
	// `pending` cerchio vuoto, `in_progress` cerchio pieno in `--brand`,
	import type { TodoItem, TodoPhase } from '../wire';

	let { phases } = $props<{ phases: TodoPhase[] }>();

	let expanded = $state(false);

	const allTasks = $derived(phases.flatMap((p: TodoPhase) => p.tasks ?? []));
	const completedCount = $derived(
		allTasks.filter((t: TodoItem) => t.status === 'completed' || t.status === 'abandoned').length
	);
	const totalCount = $derived(allTasks.length);

	// Fase corrente: la prima con almeno un task non completato/abbandonato.
	const currentPhase = $derived(
		phases.find((p: TodoPhase) => (p.tasks ?? []).some((t: TodoItem) => t.status !== 'completed' && t.status !== 'abandoned')) ??
			phases[phases.length - 1]
	);

	const STATUS_GLYPH: Record<string, string> = {
		pending: '○',
		in_progress: '●',
		completed: '✓',
		abandoned: '⊘',
		blocked: '!'
	};
</script>

{#if phases.length > 0 && totalCount > 0}
	<div class="todo-strip" class:expanded>
		<button
			type="button"
			class="strip-header"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			<span class="chevron">{expanded ? '▾' : '▸'}</span>
			<span class="phase-name">{currentPhase?.name ?? 'Todo'}</span>
			<span class="tally">{completedCount}/{totalCount}</span>
		</button>

		{#if expanded}
			<div class="phases-list">
				{#each phases as phase, phaseIdx (phase.id ?? phaseIdx)}
					<div class="phase-group">
						<div class="phase-title">{phase.name}</div>
						<ul class="task-list">
							{#each phase.tasks ?? [] as task, taskIdx (task.id ?? taskIdx)}
								<li
									class="task-row {task.status}"
									title={task.blocker ? `Bloccato: ${task.blocker}` : undefined}
								>
									<span class="status-glyph">{STATUS_GLYPH[task.status] ?? '○'}</span>
									<span class="content">{task.content}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.todo-strip {
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-xs);
		min-width: 0;
	}

	.strip-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 4px var(--space-3);
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		text-align: left;
		width: 100%;
		font-size: inherit;
	}

	.strip-header:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.chevron {
		color: var(--ink-faint);
		font-family: var(--font-mono);
	}

	.phase-name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tally {
		margin-left: auto;
		font-family: var(--font-mono);
		color: var(--ink-faint);
	}

	.phases-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3) var(--space-3);
		max-height: 240px;
		overflow-y: auto;
	}

	.phase-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.phase-title {
		font-weight: 600;
		color: var(--ink-faint);
		letter-spacing: 0.04em;
		font-size: 10px;
		text-transform: uppercase;
	}

	.task-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.task-row {
		display: grid;
		grid-template-columns: 14px 1fr;
		gap: var(--space-1);
		align-items: baseline;
		line-height: 1.4;
		color: var(--ink-muted);
	}

	.status-glyph {
		font-family: var(--font-mono);
		color: var(--ink-faint);
	}

	.task-row.in_progress {
		color: var(--ink);
		font-weight: 500;
	}

	.task-row.in_progress .status-glyph {
		color: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.task-row.completed {
		color: var(--ink-faint);
	}

	.task-row.completed .content {
		text-decoration: line-through;
	}

	.task-row.abandoned {
		color: var(--ink-faint);
		opacity: 0.6;
	}

	.task-row.abandoned .content {
		text-decoration: line-through;
	}

	.task-row.blocked {
		color: var(--warn);
	}

	.task-row.blocked .status-glyph {
		color: var(--warn);
		font-weight: 700;
	}

	.content {
		overflow-wrap: anywhere;
	}
</style>
