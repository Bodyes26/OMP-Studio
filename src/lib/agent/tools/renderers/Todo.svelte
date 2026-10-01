<!--
  Renderer per il tool `todo`.

  Nel corpo visualizza le fasi tramite il primitivo TaskRow,
  con indice fase nell'anello, metrica completed/total e dettagli espandibili con
  stato dei singoli task e blocker inline.
-->
<script lang="ts">
	import { flip } from 'svelte/animate';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import TaskRow from '../../components/TaskRow.svelte';
	import { todoPhaseToTaskRow } from '../../taskRow';
	import type { TodoPhase, TodoItem, TodoStatus } from '../../wire';
	import {
		asRecord,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));

	const phases = $derived.by<TodoPhase[]>(() => {
		const rawPhases = recordList(details?.phases);
		if (rawPhases.length > 0) {
			return rawPhases.map((p, idx) => ({
				name: str(p.name) ?? str(p.phase) ?? `Fase ${idx + 1}`,
				tasks: recordList(p.tasks).map((t, tIdx) => ({
					content: str(t.task) ?? str(t.content) ?? `Attivita' ${tIdx + 1}`,
					status: (str(t.status) ?? 'pending') as TodoStatus,
					blocker: str(t.blocker)
				}))
			}));
		}

		const listArg = recordList(args.list);
		if (listArg.length > 0) {
			return listArg.map((p, idx) => ({
				name: str(p.phase) ?? str(p.name) ?? `Fase ${idx + 1}`,
				tasks: recordList(p.items).map((t, tIdx) => ({
					content: str(t.task) ?? str(t.content) ?? (typeof t === 'string' ? t : `Attivita' ${tIdx + 1}`),
					status: 'pending' as TodoStatus
				}))
			}));
		}

		const flatItems = recordList(args.items);
		if (flatItems.length > 0) {
			return [
				{
					name: str(args.phase) ?? 'Attività',
					tasks: flatItems.map((t, tIdx) => ({
						content: str(t.task) ?? str(t.content) ?? (typeof t === 'string' ? t : `Attivita' ${tIdx + 1}`),
						status: 'pending' as TodoStatus
					}))
				}
			];
		}

		return [];
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

<style>
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
		animation: todo-stagger var(--dur-row) var(--ease-reveal) var(--stagger-delay, 0ms) both;
	}

	.phase-item + .phase-item {
		border-top: 1px solid var(--line);
	}

	@keyframes todo-stagger {
		from {
			opacity: 0;
			transform: translateY(2px);
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
