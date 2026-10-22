<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconChevronDown, IconExternalLink, IconPlay, IconSchedule } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import type { Project } from '$lib/stores/projects.svelte';
	import { scheduleStore } from '$lib/stores/schedule.svelte';
	import type { StudioTask } from '$lib/stores/taskSerialization';
	import MissedScheduleBanner from '$lib/components/schedule/MissedScheduleBanner.svelte';
	import type {
		CompanionViewMode,
		GlobalQueueItemState
	} from '$lib/companion/companionPresentation';

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
		<section class="rail-section rail-questions">
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
		<section class="rail-section rail-unread">
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
		<section class="rail-section progress-section">
			<h3 class="rail-title">
				<span>{m.companion_rail_working()}</span>
				<span class="rail-count">{working.length}</span>
			</h3>
			<div class="priority-list">
				{#each working as w (w.project.id + ':' + w.laneId)}
					<div class="working-row">
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
				<ol class="global-queue-list">
					{#each globalQueue as item (item.projectId + ':' + item.taskId)}
						{@const schedule = scheduleStore.labelFor(item.task)}
						<li class="global-queue-item" data-queue-project={item.projectId} data-queue-task={item.taskId}>
							<p class="global-queue-title">{item.taskTitle}</p>
							{#if schedule}
								<p class="queue-schedule-line" title={schedule.tooltip}>
									<IconSchedule />
									<span>{schedule.text}{schedule.countdown ? ` · ${schedule.countdown}` : ''}</span>
								</p>
							{/if}
							<div class="global-queue-footer">
								<div class="global-queue-context">
									<button
										type="button"
										class="global-queue-project"
										onclick={() => onSelectProject(item.projectId, 'main', 'answer')}
									>
										{item.projectName}
									</button>
									<span class="queue-context-separator">·</span>
									<span
										class="queue-project-state"
										class:is-question={item.statusKey === 'question'}
									>
										{item.statusLabel}
									</span>
								</div>

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
