<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { fade } from 'svelte/transition';
	import { trayFold } from '#lib/agent/motion.ts';
	import { splitTaskText } from '#lib/stores/taskTitle.ts';
	import { isTaskTitleGenerating } from '#lib/stores/taskTitles.svelte.ts';
	import { IconChevronDown, IconExternalLink, IconPlay, IconSchedule } from '#lib/icons.ts';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import type { Project } from '#lib/stores/projects.svelte.ts';
	import { scheduleStore } from '#lib/stores/schedule.svelte.ts';
	import type { StudioTask } from '#lib/stores/taskSerialization.ts';
	import MissedScheduleBanner from '#lib/components/schedule/MissedScheduleBanner.svelte';
	import type {
		CompanionViewMode,
		GlobalQueueItemState
	} from '#lib/companion/companionPresentation.ts';

	export interface RailProjectItem {
		project: Project;
		laneId: string;
		name: string;
		requestId?: string;
		hue: number;
		hasDraft?: boolean;
		activityText?: string;
	}

	let {
		selectedProjectId,
		selectedLaneId,
		selectedRequestId,
		viewMode,
		questions = [],
		unread = [],
		working = [],
		globalQueue = [],
		parked = [],
		parkedOpen = false,
		onToggleParked,
		onSelectProject,
		onRunTask
	}: {
		selectedProjectId: string | null;
		selectedLaneId: string;
		selectedRequestId: string | null;
		viewMode: CompanionViewMode;
		questions: RailProjectItem[];
		unread: RailProjectItem[];
		working: RailProjectItem[];
		globalQueue: GlobalQueueItemState<StudioTask>[];
		parked: RailProjectItem[];
		parkedOpen: boolean;
		onToggleParked: () => void;
		onSelectProject: (projectId: string, laneId?: string, mode?: CompanionViewMode, requestId?: string) => void;
		onRunTask: (projectId: string, taskId: string) => void;
	} = $props();

	let collapsedProjects = $state<string[]>([]);
	let expandedTasks = $state<string[]>([]);
	const queueGroups = $derived.by(() => {
		const groups = new Map<string, GlobalQueueItemState<StudioTask>[]>();
		for (const item of globalQueue) {
			const key = item.projectId.toLowerCase();
			const group = groups.get(key);
			if (group) group.push(item);
			else groups.set(key, [item]);
		}
		return [...groups.entries()];
	});
	function toggleProject(key: string) {
		collapsedProjects = collapsedProjects.includes(key)
			? collapsedProjects.filter((id) => id !== key) : [...collapsedProjects, key];
	}
	function toggleTask(key: string) {
		expandedTasks = expandedTasks.includes(key)
			? expandedTasks.filter((id) => id !== key) : [...expandedTasks, key];
	}

	// Un conteggio di progetti, non una seconda coda o un esecutore globale.
	const queueProjectCount = $derived.by(() => {
		const set = new Set<string>();
		for (const item of globalQueue) {
			set.add(item.projectId.toLowerCase());
		}
		return set.size;
	});

</script>

<aside class="priority-rail" aria-label={m.companion_cards_aria()}>
	<!-- 1. Domande -->
	{#if questions.length > 0}
		<section class="rail-section rail-questions" transition:trayFold>
			<h3 class="rail-title">
				<span>{m.companion_rail_questions()}</span>
				<span class="rail-count">{questions.length}</span>
			</h3>
			<div class="priority-list">
				{#each questions as q (q.project.id + ':' + q.laneId + ':' + q.requestId)}
					{@const isCurrent =
						selectedProjectId?.toLowerCase() === q.project.id.toLowerCase() &&
						selectedLaneId.toLowerCase() === q.laneId.toLowerCase() &&
						viewMode === 'question' && selectedRequestId === q.requestId}
					<button
						type="button"
						class="priority-project is-question"
						aria-current={isCurrent}
						transition:trayFold
						onclick={() => onSelectProject(q.project.id, q.laneId, 'question', q.requestId)}
					>
						<span class="p-dot" style="background: var(--warn)"></span>
						<span class="project-choice-name">{q.name}</span>
						<span class="question-label">{m.companion_badge_question()}</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- 2. Da leggere -->
	{#if unread.length > 0}
		<section class="rail-section rail-unread" transition:trayFold>
			<h3 class="rail-title">
				<span>{m.companion_rail_unread()}</span>
				<span class="rail-count">{unread.length}</span>
			</h3>
			<div class="priority-list">
				{#each unread as u (u.project.id + ':' + u.laneId)}
					{@const isCurrent =
						selectedProjectId?.toLowerCase() === u.project.id.toLowerCase() &&
						selectedLaneId.toLowerCase() === u.laneId.toLowerCase() &&
						viewMode === 'answer'}
					<button
						type="button"
						class="priority-project"
						aria-current={isCurrent}
						transition:trayFold
						onclick={() => onSelectProject(u.project.id, u.laneId, 'answer')}
					>
						<span class="p-dot lit" style="--proj-hue: {u.hue}"></span>
						<span class="working-body">
							<span class="working-name">{u.name}</span>
							{#if u.activityText}
								<span class="working-activity" title={u.activityText}>{u.activityText}</span>
							{/if}
						</span>
						{#if u.hasDraft}
							<span class="draft-dot">{m.companion_badge_draft()}</span>
						{/if}
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- 3. Lavori in corso -->
	{#if working.length > 0}
		<section class="rail-section progress-section" transition:trayFold>
			<h3 class="rail-title">
				<span>{m.companion_rail_working()}</span>
				<span class="rail-count">{working.length}</span>
			</h3>
			<div class="priority-list">
				{#each working as w (w.project.id + ':' + w.laneId)}
					<div class="working-row" transition:trayFold>
						<span class="p-dot is-working lit" style="--proj-hue: {w.hue}"></span>
						<div class="working-body">
							<div class="working-name">{w.name}</div>
							{#if w.activityText}
								<p class="working-activity" title={w.activityText}>{w.activityText}</p>
							{/if}
						</div>
						<Tooltip text={m.companion_rail_open_conversation({ project: w.name })} placement="top">
							<button
								type="button"
								class="composer-icon-btn"
								aria-label={m.companion_rail_open_conversation({ project: w.name })}
								onclick={() => onSelectProject(w.project.id, w.laneId, 'answer')}
							>
								<IconExternalLink />
							</button>
						</Tooltip>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- 4. Coda globale -->
	<section class="rail-section global-queue" aria-label={m.companion_rail_global_queue()}>
		<h3 class="rail-title">
			<span>{m.companion_rail_global_queue()}</span>
			<span class="rail-count">{globalQueue.length}</span>
		</h3>
		<p class="global-queue-caption">
			{m.companion_rail_queue_caption({ projects: queueProjectCount })}
		</p>

		<div
			class="global-queue-scroll"
			role="region"
			aria-label={m.companion_rail_global_queue()}
		>
			<MissedScheduleBanner tasks={globalQueue.map((item) => item.task)} compact />
			{#if globalQueue.length > 0}
				<div class="queue-groups">
					{#each queueGroups as [projectKey, items] (projectKey)}
						<div class="queue-project-group" transition:trayFold>
							<button type="button" class="queue-group-heading" aria-expanded={!collapsedProjects.includes(projectKey)} onclick={() => toggleProject(projectKey)}>
								<span class="queue-group-dot" style:background={`hsl(${items[0].projectHue} 45% 48%)`}></span>
								<span>{items[0].projectName}</span>
								{#key items[0].statusKey}
									<span class="queue-project-state" class:is-question={items[0].statusKey === 'question'} in:fade={{ duration: 180 }}>{items[0].statusLabel}</span>
								{/key}
								<span class="rail-count">{items.length}</span>
								<span class:rotated={collapsedProjects.includes(projectKey)} class="parked-chevron"><IconChevronDown /></span>
							</button>
							{#if !collapsedProjects.includes(projectKey)}
							<ol class="global-queue-list queue-group-tasks">
					{#each items as item (item.projectId + ':' + item.taskId)}
						{@const schedule = scheduleStore.labelFor(item.task)}
						{@const text = splitTaskText(item.task)}
						{@const taskKey = item.projectId + ':' + item.taskId}
						<li class="global-queue-item" data-queue-project={item.projectId} data-queue-task={item.taskId} transition:trayFold>
							<button type="button" class="queue-task-preview" aria-expanded={expandedTasks.includes(taskKey)} onclick={() => toggleTask(taskKey)}>
								{#key isTaskTitleGenerating(item.taskId) ? 'generating' : text.headline}
									<strong class="global-queue-title" class:generating={isTaskTitleGenerating(item.taskId)} in:fade={{ duration: 180 }}>{isTaskTitleGenerating(item.taskId) ? m.companion_title_generating() : text.headline || item.taskTitle}</strong>
								{/key}
								<span class="queue-task-body" class:expanded={expandedTasks.includes(taskKey)}>{item.task.prompt}</span>
							</button>
							{#if schedule}
								<p class="queue-schedule-line" title={schedule.tooltip}>
									<IconSchedule />
									<span>{schedule.text}{schedule.countdown ? ` · ${schedule.countdown}` : ''}</span>
								</p>
							{/if}
							<div class="global-queue-footer">
								<Tooltip
									text={item.disabledReason || m.companion_run_task({ title: item.taskTitle })}
									placement="top"
								>
									<button
										type="button"
										class="ui-button ui-button-secondary global-queue-run"
										aria-label={m.companion_run_task({ title: item.taskTitle })}
										disabled={!item.canRun}
										onclick={() => onRunTask(item.projectId, item.taskId)}
									>
										<IconPlay />
										<span>{m.companion_run_action()}</span>
									</button>
								</Tooltip>
							</div>
							{#if !item.canRun && item.disabledReason && item.statusKey !== 'busy' && item.statusKey !== 'question'}
								<p class="queue-blocked">{m.companion_run_blocked({ reason: item.disabledReason })}</p>
							{/if}
						</li>
					{/each}
							</ol>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="global-queue-empty">{m.companion_rail_queue_empty()}</p>
			{/if}
		</div>
	</section>

	<!-- 5. Fermi (SEPARATI e ancorati al fondo) -->
	<section class="rail-section parked-section" aria-label={m.companion_rail_parked_aria()}>
		<button
			type="button"
			class="parked-toggle"
			aria-expanded={parkedOpen}
			onclick={onToggleParked}
		>
			<span class="parked-label">
				{m.companion_rail_parked()} <span class="rail-count">{parked.length}</span>
			</span>
			<span class="parked-chevron" class:rotated={parkedOpen}>
				<IconChevronDown />
			</span>
		</button>

		{#if parkedOpen && parked.length > 0}
			<div class="parked-list">
				{#each parked as p (p.project.id)}
					<div class="priority-project is-parked">
						<span class="p-dot" style="--proj-hue: {p.hue}"></span>
						<span class="project-choice-name">{p.name}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</aside>

<style>
	.queue-group-heading { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; color: var(--ink); padding: 12px 0 4px; text-align: left; font-size: 12px; font-weight: 600; cursor: pointer; }
	.queue-group-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
	.queue-group-tasks { margin-left: 3px; padding-left: 15px; border-left: 1px solid var(--line); }
	.queue-task-preview { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 0; color: var(--ink); cursor: pointer; }
	.queue-task-preview .global-queue-title { display: block; font-weight: 650; }
	.queue-task-body { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ink-muted); font-size: 12px; line-height: 1.5; margin-bottom: 6px; }
	.queue-task-body.expanded { white-space: pre-wrap; overflow-wrap: anywhere; }
	.queue-group-heading:focus-visible, .queue-task-preview:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
	.generating { animation: title-pulse 1.4s ease-in-out infinite; color: var(--ink-muted); }
	@keyframes title-pulse { 50% { opacity: .45; } }
	@media (prefers-reduced-motion: reduce) { .generating { animation: none; } }
	.parked-chevron {
		display: inline-flex;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.parked-chevron.rotated {
		transform: rotate(180deg);
	}

	.global-queue-empty {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		margin: var(--space-2) 0;
		font-style: italic;
	}
</style>
