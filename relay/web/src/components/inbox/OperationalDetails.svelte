<!--
  OperationalDetails.svelte — Dettagli operativi della sessione e coda di progetto.
  Sidebar su desktop largo e bottom sheet su mobile.
  Mostra SOLO: avanzamento/todo, subagent, job in background e CODA DEL PROGETTO
  (distinta dai follow-up) riutilizzando TaskRow per conferme di cancellazione, modifica e avvio.
  Nessuna CPU/RAM, nessuna sezione path/branch.
-->
<script lang="ts">
	import type { RemoteLane, RemoteProject, Feature, RemoteTask } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { connection } from '../../connection.svelte.ts';
	import StateDot from './StateDot.svelte';
	import TaskRow from '../TaskRow.svelte';
	import NewTaskModal from '../NewTaskModal.svelte';
	import { IconClose, IconPlus, IconTerminal } from '../../icons.ts';

	let {
		hostId,
		hostName,
		hostFeatures,
		project,
		lane,
		onClose
	}: {
		hostId: string;
		hostName: string;
		hostFeatures: Feature[];
		project: RemoteProject;
		lane?: RemoteLane;
		onClose?: () => void;
	} = $props();

	let showNewTask = $state(false);

	const host = $derived(connection.hosts.find((h) => h.id === hostId));
	const isOnline = $derived(host?.online ?? false);

	const session = $derived(lane?.session);
	const progress = $derived(session?.progress);
	const subagents = $derived(session?.subagents ?? []);
	const jobs = $derived(session?.jobs ?? []);
	const tasks = $derived(project.tasks ?? []);

	const percent = $derived.by(() => {
		if (!progress || progress.total === 0) return 0;
		return Math.round((progress.done / progress.total) * 100);
	});
</script>

<div class="operational-details">
	<header class="op-header">
		<h2 class="op-title">{t('operationalDetailsTitle')}</h2>
		{#if onClose}
			<button
				type="button"
				class="op-close-btn"
				onclick={onClose}
				aria-label={t('close')}
				title={t('close')}
			>
				<IconClose />
			</button>
		{/if}
	</header>

	<div class="op-body">
		<!-- Avanzamento / Todo -->
		{#if progress && progress.total > 0}
			<section class="op-section">
				<h3 class="section-title">
					<span>{t('progressSectionTitle')}</span>
					<span class="count-badge font-mono">{progress.done}/{progress.total}</span>
				</h3>
				<div class="progress-bar-track" aria-hidden="true">
					<div class="progress-bar-fill" style:width="{percent}%"></div>
				</div>

				{#if progress.items && progress.items.length > 0}
					<ul class="progress-items-list">
						{#each progress.items as item, idx (idx)}
							<li class="progress-item">
								<span
									class="item-status-icon"
									class:done={item.status === 'completed' || item.status === 'done'}
									aria-hidden="true"
								>
									{#if item.status === 'completed' || item.status === 'done'}
										✓
									{:else}
										○
									{/if}
								</span>
								<span
									class="item-text"
									class:done={item.status === 'completed' || item.status === 'done'}
								>
									{item.content}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<!-- Sub-agent -->
		{#if subagents.length > 0}
			<section class="op-section">
				<h3 class="section-title">
					<span>{t('subagentsSectionTitle')}</span>
					<span class="count-badge font-mono">{subagents.length}</span>
				</h3>
				<ul class="subagents-list">
					{#each subagents as agent (agent.id || agent.name)}
						<li class="subagent-card">
							<div class="card-lead">
								<StateDot state={agent.status === 'running' ? 'working' : 'idle'} />
								<span class="subagent-name">{agent.name}</span>
							</div>
							{#if agent.task}
								<div class="subagent-task">{agent.task}</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- Job in background -->
		{#if jobs.length > 0}
			<section class="op-section">
				<h3 class="section-title">
					<span>{t('jobsSectionTitle')}</span>
					<span class="count-badge font-mono">{jobs.length}</span>
				</h3>
				<ul class="jobs-list">
					{#each jobs as job, idx (job.label + idx)}
						<li class="job-card">
							<span class="job-icon" aria-hidden="true"><IconTerminal /></span>
							<span class="job-label font-mono">{job.label}</span>
							{#if job.status}
								<span class="job-status font-mono">{job.status}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- Coda del progetto (distinct from follow-ups) -->
		<section class="op-section">
			<div class="section-header-line">
				<h3 class="section-title">
					<span>{t('projectQueueTitle')}</span>
					<span class="count-badge font-mono">{tasks.length}</span>
				</h3>
				{#if hostFeatures.includes('task_edit') && isOnline}
					<button
						type="button"
						class="btn-new-task"
						onclick={() => (showNewTask = true)}
						title={t('newTask')}
						aria-label={t('newTask')}
					>
						<IconPlus />
						<span>{t('newTask')}</span>
					</button>
				{/if}
			</div>

			{#if tasks.length === 0}
				<div class="empty-queue-hint">
					{t('noQueuedTasks')}
				</div>
			{:else}
				<!-- TaskRow preserva la sicurezza, le conferme e la gestione errori visibile -->
				<div class="tasks-list">
					{#each tasks as task, tIdx (task.id)}
						<TaskRow
							{task}
							{hostId}
							{hostName}
							{hostFeatures}
							projectId={project.id}
							taskIndex={tIdx}
							totalTasks={tasks.length}
							canRunTask={project.canRunTask && isOnline}
							runBlockReason={!isOnline ? t('errHostOffline') : project.runBlockReason}
						/>
					{/each}
				</div>
			{/if}
		</section>
	</div>

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
	.operational-details {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-base);
		overflow: hidden;
	}

	.op-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.op-title {
		font-size: var(--text-label, 13px);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.op-close-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.op-close-btn:hover {
		color: var(--ink);
		background: var(--bg-raised);
	}

	.op-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.op-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.section-header-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-mini, 11px);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
		margin: 0;
	}

	.count-badge {
		font-size: var(--text-mini, 11px);
		font-weight: 500;
		color: var(--ink-faint);
	}

	.btn-new-task {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		font-size: var(--text-mini, 11px);
		cursor: pointer;
	}

	.btn-new-task:hover {
		background: var(--bg-raised);
		color: var(--ink);
	}

	/* Progress bar */
	.progress-bar-track {
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--line);
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		border-radius: var(--radius-full);
		background: var(--color-success, var(--brand));
		transition: width 0.3s ease;
	}

	.progress-items-list {
		list-style: none;
		margin: 4px 0 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.progress-item {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: var(--text-caption, 12px);
		line-height: 1.4;
	}

	.item-status-icon {
		font-size: 11px;
		color: var(--ink-faint);
		flex-shrink: 0;
		margin-top: 1px;
	}

	.item-status-icon.done {
		color: var(--color-success, var(--brand));
		font-weight: 700;
	}

	.item-text {
		color: var(--ink);
	}

	.item-text.done {
		color: var(--ink-muted);
		text-decoration: line-through;
	}

	/* Subagents */
	.subagents-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.subagent-card {
		padding: 8px 10px;
		border-radius: var(--radius-lg);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.card-lead {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.subagent-name {
		font-size: var(--text-caption, 12px);
		font-weight: 600;
		color: var(--ink);
	}

	.subagent-task {
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Jobs */
	.jobs-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.job-card {
		padding: 6px 10px;
		border-radius: var(--radius-lg);
		background: var(--ink);
		color: var(--bg-base);
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-mini, 11px);
	}

	.job-icon {
		color: var(--color-success, var(--brand));
		display: inline-flex;
		align-items: center;
		--icon-size: 13px;
	}

	.job-label {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.job-status {
		color: var(--ink-faint);
		font-size: 10px;
	}

	/* Tasks */
	.empty-queue-hint {
		padding: 16px;
		text-align: center;
		font-size: var(--text-caption, 12px);
		color: var(--ink-muted);
		border: 1px dashed var(--line);
		border-radius: var(--radius-lg);
	}

	.tasks-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2, 8px);
	}
</style>
