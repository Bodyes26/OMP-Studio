<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconPlay } from '$lib/icons';
	import type { StudioTask } from '$lib/stores/tasks.svelte';
	import { countQueuedTasks, type CompanionQueueGroup } from './companionQueue';

	interface Props {
		groups: CompanionQueueGroup[];
		/** Avvia il primo task del progetto indicato. */
		onRunNext: (projectId: string, taskId: string) => void;
		/** Apre la coda completa del progetto nell'elenco sottostante. */
		onOpenProject: (projectId: string) => void;
	}

	let { groups, onRunNext, onOpenProject }: Props = $props();

	/**
	 * Progetti a vista prima di dichiarare il residuo. La finestra e' alta
	 * 520px: oltre questa soglia il riepilogo mangerebbe il campo di scrittura
	 * e l'elenco dei progetti.
	 */
	const VISIBLE_PROJECTS = 4;

	const ordered = $derived(groups.slice(0, VISIBLE_PROJECTS));
	const hiddenProjects = $derived(Math.max(0, groups.length - VISIBLE_PROJECTS));
	const totalTasks = $derived(countQueuedTasks(groups));
	const blockedCount = $derived(groups.filter((group) => !group.ready).length);

	function taskTitle(task: StudioTask): string {
		const line = task.prompt.split(/\r?\n/).find((l) => l.trim())?.trim();
		if (line) return line;
		if (task.images && task.images.length > 0) return m.queue_drawer_title_only_images();
		return m.queue_drawer_title_new_task();
	}
</script>

<section class="queue-board" aria-label={m.companion_queue_board_aria()}>
	<div class="section-title">
		<IconPlay />
		<span>{m.companion_queue_board_title({ tasks: totalTasks, projects: groups.length })}</span>
	</div>

	<!-- Una riga per progetto: il nome dice dove, il prossimo task dice cosa,
	     il contatore dice quanto resta. Il click avvia quel progetto, non
	     "il primo della lista": con piu' code una sola azione sarebbe ambigua. -->
	<div class="board-rows">
		{#each ordered as group (group.projectId)}
			{@const next = group.tasks[0]}
			{@const title = taskTitle(next)}
			<div class="board-row" class:blocked={!group.ready} style="--proj-hue: {group.hue}">
				<button
					type="button"
					class="board-run"
					disabled={!group.ready}
					title={group.ready ? title : group.blockReason}
					aria-label={group.ready
						? m.companion_queue_board_run({ project: group.name, title })
						: m.companion_run_blocked({ reason: group.blockReason ?? '' })}
					onclick={() => onRunNext(group.projectId, next.id)}
				>
					<span class="p-dot" class:lit={group.ready}></span>
					<span class="board-project">{group.name}</span>
					<span class="board-next">{title}</span>
					<span class="board-play"><IconPlay /></span>
				</button>
				<button
					type="button"
					class="board-count"
					title={m.companion_queue_count({ count: group.tasks.length })}
					aria-label={m.companion_queue_board_open({ project: group.name })}
					onclick={() => onOpenProject(group.projectId)}
				>
					{group.tasks.length}
				</button>
			</div>
		{/each}
	</div>

	{#if hiddenProjects > 0}
		<p class="queue-more">{m.companion_queue_board_more({ count: hiddenProjects })}</p>
	{/if}

	{#if blockedCount > 0}
		<!-- Il motivo per riga vive nel `title`, ma su un bottone disabilitato
		     non lo si interroga: qui resta almeno il conto di cio' che non parte. -->
		<p class="queue-blocked">{m.companion_queue_board_blocked({ count: blockedCount })}</p>
	{/if}
</section>
