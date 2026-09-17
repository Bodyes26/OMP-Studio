<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconPlay } from '$lib/icons';
	import type { StudioTask } from '$lib/stores/tasks.svelte';

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
		const line = task.prompt.split(/\r?\n/).find((l) => l.trim())?.trim();
		if (line) return line;
		if (task.images && task.images.length > 0) return m.queue_drawer_title_only_images();
		return m.queue_drawer_title_new_task();
	}

	const hiddenCount = $derived(Math.max(0, tasks.length - VISIBLE_TASKS));
</script>

{#if tasks.length > 0}
	<section class="project-queue" aria-label={m.companion_queue_aria({ project: projectName })}>
		<div class="section-title">
			<span>{m.companion_queue_title({ count: tasks.length })}</span>
		</div>

		<!-- Ogni riga avvia il proprio task: con un solo bottone "Avvia prossimo"
		     accanto a tre righe il legame con quale parte resta implicito. -->
		<div class="queue-rows">
			{#each tasks.slice(0, VISIBLE_TASKS) as task, index (task.id)}
				{@const title = taskTitle(task)}
				<button
					type="button"
					class="queue-row"
					class:is-next={index === 0}
					{disabled}
					aria-label={m.companion_run_task({ title })}
					onclick={() => onRunNext(task.id)}
				>
					<span class="queue-row-index">{index + 1}</span>
					<span class="queue-row-title">{title}</span>
					<span class="queue-row-run"><IconPlay /></span>
				</button>
			{/each}
		</div>

		{#if hiddenCount > 0}
			<p class="queue-more">{m.companion_queue_more({ count: hiddenCount })}</p>
		{/if}

		{#if disabled && disabledReason}
			<!-- Il motivo non puo' vivere in un `title` su elementi disabilitati:
			     la tastiera non li raggiunge e il puntatore non li interroga. -->
			<p class="queue-blocked">{m.companion_run_blocked({ reason: disabledReason })}</p>
		{/if}
	</section>
{/if}
