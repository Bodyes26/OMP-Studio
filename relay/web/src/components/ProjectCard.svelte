<script lang="ts">
	import type { RemoteProject, Feature, RemoteLane, RemoteTask } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import AttentionCard from './AttentionCard.svelte';
	import TaskRow from './TaskRow.svelte';
	import NewTaskModal from './NewTaskModal.svelte';
	import LaneChatModal from './LaneChatModal.svelte';
	let {
		project,
		hostId,
		hostName,
		hostFeatures
	} = $props<{
		project: RemoteProject;
		hostId: string;
		hostName: string;
		hostFeatures: Feature[];
	}>();

	let showNewTask = $state(false);
	let activeChatLane = $state<RemoteLane | null>(null);
	function getLaneKindLabel(kind: 'main' | 'worktree' | 'lab'): string {
		if (kind === 'main') return t('laneMain');
		if (kind === 'worktree') return t('laneWorktree');
		return t('laneLab');
	}

	function getAgentStateLabel(state: string): string {
		switch (state) {
			case 'working': return t('stateWorking');
			case 'background': return t('stateBackground');
			case 'attention': return t('stateAttention');
			case 'error': return t('stateError');
			case 'idle': return t('stateIdle');
			default: return t('stateOffline');
		}
	}
</script>

<div class="project-card" id={`project-${project.id}`} class:active-card={project.active}>
	<div class="project-header">
		<div class="title-left">
			<span class="hue-dot" style:background="hsl({project.hue}, 70%, 55%)"></span>
			<h3 class="project-name">{project.name}</h3>
			{#if project.active}
				<span class="active-badge">{t('activeProject')}</span>
			{/if}
		</div>

		{#if project.attention && project.attention.length > 0}
			<span class="attention-count-badge">
				! {project.attention.length}
			</span>
		{/if}
	</div>

	<!-- Corsie (Lanes) -->
	<div class="lanes-list">
		{#each project.lanes as lane (lane.id)}
			<div class="lane-block">
				<div class="lane-header">
					<span class="lane-kind-badge">{getLaneKindLabel(lane.kind)}</span>
					<span class="lane-title">{lane.title}</span>
					<span
						class="agent-state-pill"
						class:state-attention={lane.agent.state === 'attention'}
						class:state-error={lane.agent.state === 'error'}
					>
						{getAgentStateLabel(lane.agent.state)}
					</span>
					{#if hostFeatures.includes('chat')}
						<button
							class="btn-lane-chat"
							onclick={() => (activeChatLane = lane)}
							aria-label={t('openChat')}
							title={t('openChat')}
						>
							💬
						</button>
					{/if}
				</div>

				{#if lane.agent.activity}
					<div class="activity-line">
						<span class="activity-text">{lane.agent.activity.text}</span>
					</div>
				{/if}

				{#if lane.agent.headsUp}
					<div class="heads-up-card">
						<span class="heads-up-icon">⚠</span>
						<span class="heads-up-text">{lane.agent.headsUp}</span>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Richieste di attenzione -->
	{#if project.attention && project.attention.length > 0}
		<div class="attention-section">
			{#each project.attention as att (att.requestId)}
				<AttentionCard
					{hostId}
					{hostName}
					{hostFeatures}
					projectId={project.id}
					attention={att}
				/>
			{/each}
		</div>
	{/if}

	<!-- Coda task -->
	{#if (project.tasks && project.tasks.length > 0) || hostFeatures.includes('task_edit')}
		<div class="tasks-section">
			<div class="tasks-header">
				<span class="tasks-title">{t('tasksTitle')} ({project.tasks?.length ?? 0})</span>
				{#if hostFeatures.includes('task_edit')}
					<button
						type="button"
						class="btn-new-task"
						onclick={() => (showNewTask = true)}
					>
						+ {t('newTask')}
					</button>
				{/if}
			</div>
			{#if project.tasks && project.tasks.length > 0}
				{@const queuedTasks = (project.tasks || []).filter((t: RemoteTask) => t.status === 'queued')}
				<div class="tasks-list">
					{#each project.tasks as task (task.id)}
						{@const queuedIndex = task.status === 'queued' ? queuedTasks.findIndex((t: RemoteTask) => t.id === task.id) : undefined}
						<TaskRow
							{task}
							{hostId}
							{hostName}
							{hostFeatures}
							projectId={project.id}
							taskIndex={queuedIndex}
							totalTasks={queuedTasks.length}
							canRunTask={project.canRunTask}
							runBlockReason={project.runBlockReason}
						/>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if showNewTask}
		<NewTaskModal
			{hostId}
			{hostName}
			projectId={project.id}
			projectName={project.name}
			onClose={() => (showNewTask = false)}
		/>
	{/if}

	{#if activeChatLane}
		<LaneChatModal
			{hostId}
			{hostName}
			{hostFeatures}
			projectId={project.id}
			projectTitle={project.name}
			lane={activeChatLane}
			onClose={() => (activeChatLane = null)}
		/>
	{/if}
</div>

<style>
	.project-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.project-card.active-card {
		border-color: var(--line-strong);
	}

	.project-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.title-left {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.hue-dot {
		width: 10px;
		height: 10px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.project-name {
		font-size: 15px;
		font-weight: 650;
		color: var(--ink);
	}

	.active-badge {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		background: var(--bg-hover);
		color: var(--ink-muted);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.attention-count-badge {
		font-size: 11px;
		font-weight: 700;
		color: var(--warn);
		background: var(--warn-bg);
		padding: 2px 8px;
		border-radius: var(--radius-full);
	}

	.lanes-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.lane-block {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.lane-header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}

	.lane-kind-badge {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.lane-title {
		font-weight: 600;
		color: var(--ink);
		flex: 1;
	}

	.agent-state-pill {
		font-size: 11px;
		color: var(--ink-muted);
	}
	.agent-state-pill.state-attention {
		color: var(--warn);
		font-weight: 600;
	}
	.agent-state-pill.state-error {
		color: var(--danger);
		font-weight: 600;
	}

	.activity-line {
		font-size: 12px;
		color: var(--ink-muted);
		padding-left: 4px;
		border-left: 2px solid var(--line);
	}

	.activity-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: block;
	}

	.heads-up-card {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 6px 10px;
		font-size: 12px;
	}

	.heads-up-icon {
		color: var(--warn);
		font-size: 13px;
	}

	.heads-up-text {
		color: var(--ink);
	}

	.attention-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.tasks-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--line);
		padding-top: 10px;
	}

	.tasks-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.btn-new-task {
		font-size: 0.76rem;
		font-weight: 500;
		padding: 3px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		cursor: pointer;
	}

	.btn-new-task:hover {
		background: var(--bg-raised);
		color: var(--ink);
	}
	.tasks-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.btn-lane-chat {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 4px;
		cursor: pointer;
		padding: 2px 6px;
		font-size: 13px;
		line-height: 1;
		color: var(--ink);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
		margin-left: auto;
	}

	.btn-lane-chat:hover {
		background: var(--line);
	}
</style>
