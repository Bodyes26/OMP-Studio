<script lang="ts">
	// Striscia dei todo sopra il composer.
	//
	// Mostra la fase corrente, il reminder eventuale e il conteggio sintetico completati/totali.
	// Il clic espande la lista completa delle fasi come TaskRow unificate.
	import { flip } from 'svelte/animate';
	import { m } from '$lib/paraglide/messages.js';
	import type { TodoItem, TodoPhase } from '../wire';
	import { todoPhaseToTaskRow } from '../taskRow';
	import TaskRow from './TaskRow.svelte';
	import { IconChevronRight, IconLoop } from '$lib/icons';

	let { phases, reminder = null } = $props<{
		phases: TodoPhase[];
		reminder?: { attempt: number; max: number } | null;
	}>();

	let expanded = $state(false);

	const allTasks = $derived(phases.flatMap((p: TodoPhase) => p.tasks ?? []));
	const completedCount = $derived(
		allTasks.filter((t: TodoItem) => t.status === 'completed').length
	);
	const totalCount = $derived(allTasks.length);
	const blockedCount = $derived(allTasks.filter((t: TodoItem) => t.status === 'blocked').length);
	const hasBlocked = $derived(blockedCount > 0);

	// Fase corrente: la prima con almeno un task non completato/abbandonato
	const currentPhase = $derived(
		phases.find((p: TodoPhase) =>
			(p.tasks ?? []).some((t: TodoItem) => t.status !== 'completed' && t.status !== 'abandoned')
		) ?? phases[phases.length - 1]
	);

	const phaseModels = $derived(
		phases.map((phase: TodoPhase, idx: number) => todoPhaseToTaskRow(phase, idx))
	);
</script>

{#if phases.length > 0 && totalCount > 0}
	<div class="todo-strip" class:expanded>
		<!-- Annuncio aggregato per screen reader -->
		<div class="sr-only" aria-live="polite" aria-atomic="true">
			{m.task_row_aggregate_announcement({ completed: completedCount, blocked: blockedCount, total: totalCount })}
		</div>

		<button
			type="button"
			class="strip-header"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			<span class="chevron" class:expanded aria-hidden="true">
				<IconChevronRight size={12} />
			</span>
			<span class="phase-name">{currentPhase?.name ?? 'Todo'}</span>
			{#if hasBlocked}
				<span class="blocked-badge">!</span>
			{/if}
			{#if reminder}
				<span
					class="reminder-badge"
					class:stalled={reminder.attempt >= reminder.max}
					title={`L'agente si e' fermato con dei todo aperti: il sistema lo ha risvegliato ${reminder.attempt} volte su ${reminder.max}`}
				>
					<span class="reminder-icon" aria-hidden="true"><IconLoop size={11} /></span>
					<span class="reminder-text">{reminder.attempt}/{reminder.max}</span>
				</span>
			{/if}
			<span class="tally">{completedCount}/{totalCount}</span>
		</button>

		{#if expanded}
			<div class="phases-list" role="list">
				{#each phaseModels as model, idx (model.key)}
					<div
						animate:flip={{ duration: 200 }}
						class="phase-row-wrap"
						role="listitem"
						style="--stagger-delay: {idx * 30}ms"
					>
						<TaskRow {model} />
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
		padding: var(--space-1) var(--space-3);
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
		--icon-size: 12px;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: 1;
		transition: transform var(--dur-fast) var(--ease-out);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 10px;
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.phase-name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.blocked-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--warn);
		background: transparent;
		line-height: 1.2;
	}

	.reminder-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
		color: var(--ink-muted);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.reminder-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 11px;
		height: 11px;
		flex-shrink: 0;
	}

	.reminder-text {
		font-variant-numeric: tabular-nums;
	}

	.reminder-badge.stalled {
		color: var(--warn);
		border-color: var(--warn);
	}

	.tally {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.phases-list {
		display: flex;
		flex-direction: column;
		max-height: 240px;
		overflow-y: auto;
		padding: 0;
		border-top: 1px solid var(--line);
	}

	.phase-row-wrap {
		animation: strip-stagger 200ms ease-out var(--stagger-delay, 0ms) both;
	}

	.phase-row-wrap + .phase-row-wrap {
		border-top: 1px solid var(--line);
	}

	@keyframes strip-stagger {
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
		.phase-row-wrap {
			animation: none;
		}
	}

	:root[data-animations="false"] .phase-row-wrap {
		animation: none;
	}
</style>
