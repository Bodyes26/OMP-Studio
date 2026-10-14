<script lang="ts">
	import type { RemoteProject, Feature } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import AttentionCard from './AttentionCard.svelte';
	import TaskRow from './TaskRow.svelte';

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

<div class="project-card" class:active-card={project.active}>
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
	{#if project.tasks && project.tasks.length > 0}
		<div class="tasks-section">
			<div class="tasks-header">
				<span class="tasks-title">{t('tasksTitle')} ({project.tasks.length})</span>
			</div>
			<div class="tasks-list">
				{#each project.tasks as task (task.id)}
					<TaskRow
						{task}
						{hostId}
						{hostName}
						{hostFeatures}
						projectId={project.id}
						canRunTask={project.canRunTask}
						runBlockReason={project.runBlockReason}
					/>
				{/each}
			</div>
		</div>
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
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.tasks-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
