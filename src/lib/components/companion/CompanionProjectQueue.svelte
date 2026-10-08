<script lang="ts">
	// Coda pronta della card. Il titolo si legge e basta: avviare l'agente
	// chiede sempre il pulsante esplicito «Avvia» della riga (Read-Before-Run
	// Rule), sempre a vista, anche senza puntatore sopra.
	import { flip } from 'svelte/animate';
	import { m } from '$lib/paraglide/messages.js';
	import { IconPlay, IconSchedule } from '$lib/icons';
	import { scheduleStore } from '$lib/stores/schedule.svelte';
	import { waitingScheduled } from '$lib/quota/scheduleQueue';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { chatReveal, revealEase } from '$lib/agent/motion';
	import { motionReduced, ROW_EXIT_MS } from '$lib/agent/motionState.svelte';
	import type { StudioTask } from '$lib/stores/tasks.svelte';
	import { taskLabel } from '$lib/stores/taskTitle';

	let {
		projectName,
		tasks,
		onRunNext,
		disabled = false,
		disabledReason
	} = $props<{
		projectName: string;
		tasks: StudioTask[];
		onRunNext: (taskId: string) => void;
		disabled?: boolean;
		disabledReason?: string;
	}>();

	/**
	 * Quante righe restano a vista prima di dichiarare il residuo. Oltre
	 * questa soglia l'elenco non scorre: la card di un progetto fermo non
	 * puo' spingere fuori schermo le card dei progetti che stanno lavorando.
	 */
	const VISIBLE_TASKS = 3;

	function taskTitle(task: StudioTask): string {
		return (
			taskLabel(task) ||
			(task.images && task.images.length > 0 ? m.queue_drawer_title_only_images() : m.queue_drawer_title_new_task())
		);
	}

	const hiddenCount = $derived(Math.max(0, tasks.length - VISIBLE_TASKS));

	// Task programmati: l'orario sta sulla riga al posto dell'accento di
	// «prossimo», e sotto l'elenco una riga dice quando parte il primo.
	const waiting = $derived(
		waitingScheduled(tasks as StudioTask[], (task) => scheduleStore.targetFor(task).state)
	);
	const nextStart = $derived.by(() => {
		let first: number | undefined;
		for (const task of waiting) {
			const at = scheduleStore.targetFor(task).dueAt;
			if (at !== undefined && (first === undefined || at < first)) first = at;
		}
		return first;
	});
</script>

{#if tasks.length > 0}
	<section class="project-queue" aria-label={m.companion_queue_aria({ project: projectName })}>
		<h3 class="section-title">{m.companion_queue_title({ count: tasks.length })}</h3>

		<ol class="queue-rows">
			{#each tasks.slice(0, VISIBLE_TASKS) as task, index (task.id)}
				{@const title = taskTitle(task)}
				{@const label = scheduleStore.labelFor(task)}
				<li
					class="queue-row"
					class:is-next={index === 0 && !(label && !label.ready)}
					transition:chatReveal
					animate:flip={{ duration: motionReduced() ? 0 : ROW_EXIT_MS, easing: revealEase }}
				>
					<span class="queue-row-index">{index + 1}</span>
					<span class="queue-row-title">{title}</span>
					{#if label && !label.ready}
						<span class="queue-row-when" title={label.tooltip}>
							<IconSchedule aria-hidden="true" />{label.when || label.text}
						</span>
					{/if}
					<Tooltip text={m.companion_run_task({ title })} placement="top">
						<button
							type="button"
							class="composer-icon-btn queue-row-run"
							{disabled}
							aria-label={m.companion_run_task({ title })}
							onclick={() => onRunNext(task.id)}
						>
							<IconPlay />
						</button>
					</Tooltip>
				</li>
			{/each}
		</ol>

		{#if hiddenCount > 0}
			<p class="queue-more">{m.companion_queue_more({ count: hiddenCount })}</p>
		{/if}

		{#if waiting.length > 0}
			<p class="queue-more queue-schedule-line">
				<IconSchedule aria-hidden="true" />
				{nextStart !== undefined
					? m.schedule_companion_waiting_line({ count: waiting.length, when: scheduleStore.formatWhen(nextStart) })
					: m.schedule_companion_waiting_line_unknown({ count: waiting.length })}
			</p>
		{/if}

		{#if disabled && disabledReason}
			<!-- Il motivo non puo' vivere in un `title` su elementi disabilitati:
			     la tastiera non li raggiunge e il puntatore non li interroga. -->
			<p class="queue-blocked">{m.companion_run_blocked({ reason: disabledReason })}</p>
		{/if}
	</section>
{/if}
