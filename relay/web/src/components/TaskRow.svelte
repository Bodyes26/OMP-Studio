<!--
  TaskRow.svelte — Riga di un task in coda.
  Linguaggio Studio: StatusMark operativo condiviso, indicatore 'Prossimo'
  in brand-ink, chip di programmazione e pulsante avvia con IconPlay.
-->
<script lang="ts">
	import type { RemoteTask, Feature } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { formatScheduleLabel } from '../schedule.ts';
	import { IconPlay, IconSchedule } from '../icons.ts';
	import StatusMark, { type StatusMarkType } from './StatusMark.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';
	let {
		task,
		hostId,
		hostName,
		hostFeatures,
		projectId,
		taskIndex,
		totalTasks,
		canRunTask,
		runBlockReason
	} = $props<{
		task: RemoteTask;
		hostId: string;
		hostName: string;
		hostFeatures: Feature[];
		projectId: string;
		taskIndex?: number;
		totalTasks?: number;
		canRunTask: boolean;
		runBlockReason: string | null;
	}>();

	let showDetail = $state(false);

	const canRun = $derived(
		hostFeatures.includes('run_task') && canRunTask && task.status === 'queued'
	);

	const scheduleText = $derived(formatScheduleLabel(task.schedule));

	function toStatusMarkStatus(status: string): StatusMarkType {
		switch (status) {
			case 'running':
				return 'running';
			case 'completed':
			case 'done':
				return 'completed';
			case 'failed':
			case 'aborted':
				return 'failed';
			default:
				return 'pending';
		}
	}

	async function handleRunTask(): Promise<void> {
		await connection.sendCommand(hostId, {
			kind: 'run_task',
			projectId,
			taskId: task.id
		});
	}
</script>

<div
	class="task-row"
	role="button"
	tabindex="0"
	onclick={() => (showDetail = true)}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			showDetail = true;
		}
	}}
>
	<div class="task-lead">
		<span class="status-slot" aria-hidden="true">
			<StatusMark status={toStatusMarkStatus(task.status)} />
		</span>

		<div class="task-info">
			<div class="title-line">
				{#if task.next}
					<span class="next-marker">{t('nextMarker')}</span>
				{/if}
				{#if task.resume}
					<span class="resume-marker">{t('resumeMarker')}</span>
				{/if}
				<span class="title-text">{task.title}</span>
			</div>

			<div class="meta-line">
				{#if scheduleText}
					<span class="ui-chip schedule-chip">
						<IconSchedule />
						<span>{scheduleText}</span>
					</span>
				{/if}
				{#if runBlockReason && task.status === 'queued'}
					<span class="block-reason">{runBlockReason}</span>
				{/if}
			</div>
		</div>
	</div>

	<div class="task-action" onclick={(e) => e.stopPropagation()} role="presentation">
		{#if canRun}
			<button
				type="button"
				class="ui-button ui-button-secondary run-btn"
				onclick={() => (showDetail = true)}
				aria-label={t('runOn', { machine: hostName })}
			>
				<IconPlay />
				<span>{t('run')}</span>
			</button>
		{/if}
	</div>
</div>

{#if showDetail}
	<TaskDetailModal
		{task}
		{hostId}
		{hostName}
		{hostFeatures}
		projectId={projectId}
		taskIndex={taskIndex}
		totalTasks={totalTasks}
		canRun={canRun}
		{runBlockReason}
		onClose={() => (showDetail = false)}
		onRun={handleRunTask}
	/>
{/if}

<style>
	.task-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: 10px 12px;
		background: transparent;
		border-bottom: 1px solid var(--line);
		cursor: pointer;
		text-align: left;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.task-row:last-child {
		border-bottom: none;
	}

	.task-row:hover {
		background: var(--bg-hover);
	}

	.task-lead {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		min-width: 0;
		flex: 1;
	}

	.status-slot {
		display: grid;
		place-items: center;
		margin-top: 2px;
		flex-shrink: 0;
	}

	.task-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}

	.title-line {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}

	.next-marker {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-weight: 700;
		color: var(--brand-ink);
		flex-shrink: 0;
	}

	.resume-marker {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.title-text {
		font-size: var(--text-caption);
		color: var(--ink);
		line-height: 1.4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta-line {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.schedule-chip {
		height: 20px;
		padding: 0 6px;
		font-size: var(--text-meta);
		--icon-size: 11px;
	}

	.block-reason {
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}

	.task-action {
		flex-shrink: 0;
	}

	.run-btn {
		height: 28px;
		padding: 0 10px;
		font-size: var(--text-caption);
		gap: 4px;
		--icon-size: 12px;
	}
</style>
