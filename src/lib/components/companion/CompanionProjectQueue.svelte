<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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

	function taskTitle(task: StudioTask): string {
		const line = task.prompt.split(/\r?\n/).find((l) => l.trim())?.trim();
		if (line) return line;
		if (task.images && task.images.length > 0) return m.queue_drawer_title_only_images();
		return m.queue_drawer_title_new_task();
	}

	const visibleTasks = $derived(tasks.slice(0, 3));
	const nextTask = $derived(tasks[0] ?? null);
</script>

{#if tasks.length > 0}
	<section class="project-queue" aria-label={m.companion_queue_aria({ project: projectName })}>
		<div class="section-title">
			<span>{m.companion_queue_title({ count: tasks.length })}</span>
		</div>

		{#each visibleTasks as task (task.id)}
			<div class="queue-row">
				<span class="queue-row-title" title={taskTitle(task)}>{taskTitle(task)}</span>
			</div>
		{/each}

		{#if nextTask}
			<button
				type="button"
				class="run-next-btn"
				disabled={disabled}
				title={disabled ? disabledReason : undefined}
				onclick={() => onRunNext(nextTask.id)}
			>
				{m.companion_run_next()}
			</button>
		{/if}
	</section>
{/if}
