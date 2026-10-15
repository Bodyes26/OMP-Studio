<!--
  ProjectCard.svelte — Elenco piatto di progetto e corsie (Design Studio).
  Nessuna card annidata: riga intestazione progetto, corsie rientrate con StatusMark,
  heads-up inline in warn, riga ambra compatta per domande pendenti che apre la chat,
  coda task rientrata.
-->
<script lang="ts">
	import type { RemoteProject, Feature, RemoteLane, RemoteAttention } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { navigation } from '../navigation.svelte.ts';
	import { IconPlus, IconWarning, IconChevronRight, IconAsk } from '../icons.ts';
	import StatusMark, { type StatusMarkType } from './StatusMark.svelte';
	import TaskRow from './TaskRow.svelte';
	import NewTaskModal from './NewTaskModal.svelte';

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

	function getLaneKindLabel(kind: 'main' | 'worktree' | 'lab'): string {
		if (kind === 'main') return t('laneMain');
		if (kind === 'worktree') return t('laneWorktree');
		return t('laneLab');
	}

	function toStatusMarkStatus(agentState: string): StatusMarkType {
		switch (agentState) {
			case 'working':
			case 'background':
				return 'running';
			case 'attention':
				return 'attention';
			case 'error':
				return 'failed';
			default:
				return 'pending';
		}
	}

	const initialLetter = $derived(
		(project.name || '').trim().charAt(0).toUpperCase() || 'P'
	);

	function getAttentionForLane(laneId: string): RemoteAttention | null {
		if (!project.attention) return null;
		return project.attention.find((a: RemoteAttention) => a.laneId === laneId || (!a.laneId && laneId === 'main')) || null;
	}
	function isLaneActiveInChat(laneId: string): boolean {
		const c = navigation.chat;
		return Boolean(c && c.hostId === hostId && c.projectId === project.id && c.laneId === laneId);
	}
</script>

<div class="project-group" id={`project-${project.id}`}>
	<!-- Riga intestazione progetto -->
	<div class="project-header-row">
		<div class="header-left">
			<span
				class="project-tile"
				style:--proj-hue="{project.hue}"
				aria-hidden="true"
			>
				{initialLetter}
			</span>

			<h3 class="project-name">{project.name}</h3>

			{#if project.active}
				<span class="active-badge">{t('activeProject')}</span>
			{/if}
		</div>

		<div class="header-right">
			{#if project.attention && project.attention.length > 0}
				<span class="ui-count attention" title="Richieste di attenzione">
					{project.attention.length}
				</span>
			{/if}
			{#if project.tasks && project.tasks.length > 0}
				<span class="ui-count" title="Task in coda">
					{project.tasks.length}
				</span>
			{/if}
		</div>
	</div>

	<!-- Corsie rientrate -->
	<div class="lanes-block">
		{#each project.lanes as lane (lane.id)}
			{@const active = isLaneActiveInChat(lane.id)}
			{@const att = getAttentionForLane(lane.id)}

			<div
				class="lane-row"
				class:ui-selected={active}
				role="button"
				tabindex="0"
				onclick={() => navigation.openChat({ hostId, projectId: project.id, laneId: lane.id })}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						navigation.openChat({ hostId, projectId: project.id, laneId: lane.id });
					}
				}}
			>
				<div class="lane-lead">
					<span class="status-slot" aria-hidden="true">
						<StatusMark status={toStatusMarkStatus(lane.agent.state)} />
					</span>
					<div class="lane-info">
						<div class="lane-title-line">
							<span class="lane-title">{lane.title}</span>
							{#if lane.kind !== 'main'}
								<span class="lane-kind">{getLaneKindLabel(lane.kind)}</span>
							{/if}
						</div>

						{#if lane.agent.activity}
							<div class="activity-line">
								<span class="activity-text text-shimmer">{lane.agent.activity.text}</span>
							</div>
						{/if}
					</div>
				</div>

				<span class="lane-arrow" aria-hidden="true">
					<IconChevronRight />
				</span>
			</div>

			<!-- Heads-up inline (testo in warn, nessuna card gialla) -->
			{#if lane.agent.headsUp}
				<div class="heads-up-inline">
					<span class="heads-up-icon" aria-hidden="true"><IconWarning /></span>
					<span class="heads-up-text">{lane.agent.headsUp}</span>
				</div>
			{/if}

			<!-- Riga ambra compatta per domanda pendente che apre la chat -->
			{#if att}
				<div
					class="lane-attention-row"
					role="button"
					tabindex="0"
					onclick={() => navigation.openChat({ hostId, projectId: project.id, laneId: lane.id })}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							navigation.openChat({ hostId, projectId: project.id, laneId: lane.id });
						}
					}}
				>
					<span class="att-icon" aria-hidden="true"><IconAsk /></span>
					<span class="att-text">
						{att.questions[0]?.question ||
							att.title ||
							att.message ||
							(att.quotaBlocked
								? t(att.quotaBlocked.reason === 'quota_exhausted' ? 'quotaBlockedTitle' : 'providerErrorTitle')
								: t('attentionFallbackTitle'))}
					</span>
					<span class="att-arrow" aria-hidden="true"><IconChevronRight /></span>
				</div>
			{/if}
		{/each}
	</div>

	<!-- Coda task rientrata -->
	{#if (project.tasks && project.tasks.length > 0) || hostFeatures.includes('task_edit')}
		<div class="tasks-block">
			<div class="tasks-header-row">
				<div class="tasks-title-group">
					<span class="tasks-title">{t('tasksTitle')}</span>
					{#if project.tasks && project.tasks.length > 0}
						<span class="ui-count">{project.tasks.length}</span>
					{/if}
				</div>

				{#if hostFeatures.includes('task_edit')}
					<button
						type="button"
						class="ui-button ui-button-ghost new-task-btn"
						onclick={() => (showNewTask = true)}
					>
						<IconPlus />
						<span>{t('newTask')}</span>
					</button>
				{/if}
			</div>

			{#if project.tasks && project.tasks.length > 0}
				<div class="tasks-list">
					{#each project.tasks as task, tIdx (task.id)}
						<TaskRow
							{task}
							{hostId}
							{hostName}
							{hostFeatures}
							projectId={project.id}
							taskIndex={tIdx}
							totalTasks={project.tasks.length}
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
</div>

<style>
	.project-group {
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--line);
		padding-bottom: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.project-group:last-child {
		border-bottom: none;
		padding-bottom: 0;
		margin-bottom: 0;
	}

	/* Riga intestazione progetto: flat, zero box */
	.project-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 6px;
		gap: var(--space-3);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.project-tile {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-sm);
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue));
		color: oklch(var(--proj-l-ink) var(--proj-c-ink) var(--proj-hue));
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-weight: 700;
		line-height: 1;
		flex-shrink: 0;
	}

	.project-name {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.active-badge {
		font-size: var(--text-meta);
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	/* Corsie rientrate */
	.lanes-block {
		display: flex;
		flex-direction: column;
		padding-left: 28px;
		gap: 2px;
	}

	.lane-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 8px;
		border-radius: var(--radius-md);
		background: transparent;
		cursor: pointer;
		text-align: left;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.lane-row:hover {
		background: var(--bg-hover);
	}

	.lane-lead {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 1;
	}

	.status-slot {
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.lane-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.lane-title-line {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}

	.lane-title {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lane-kind {
		font-size: var(--text-meta);
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.activity-line {
		font-size: var(--text-meta);
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lane-arrow {
		color: var(--ink-faint);
		--icon-size: 13px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	/* Heads-up inline: nessun box card giallo */
	.heads-up-inline {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 2px 8px 4px 8px;
		font-size: var(--text-meta);
		color: var(--warn);
		line-height: 1.4;
	}

	.heads-up-icon {
		color: var(--warn);
		--icon-size: 12px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.heads-up-text {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Riga compatta ambra per attenzione pendente che apre la chat */
	.lane-attention-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		background: color-mix(in oklab, var(--warn) 12%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--warn) 28%, transparent);
		border-radius: var(--radius-md);
		cursor: pointer;
		margin: 2px 0;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.lane-attention-row:hover {
		background: color-mix(in oklab, var(--warn) 20%, transparent);
	}

	.att-icon {
		color: var(--warn);
		--icon-size: 13px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.att-text {
		flex: 1;
		font-size: var(--text-caption);
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.att-arrow {
		color: var(--warn);
		--icon-size: 12px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	/* Coda task rientrata */
	.tasks-block {
		display: flex;
		flex-direction: column;
		padding-left: 28px;
		margin-top: 4px;
		gap: 4px;
	}

	.tasks-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 6px;
	}

	.tasks-title-group {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.tasks-title {
		font-size: var(--text-meta);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.new-task-btn {
		height: 24px;
		padding: 0 6px;
		font-size: var(--text-meta);
		gap: 4px;
		--icon-size: 11px;
	}

	.tasks-list {
		display: flex;
		flex-direction: column;
	}
</style>
