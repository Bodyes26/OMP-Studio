<script lang="ts">
	import type { RemoteTask, Feature } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { formatScheduleLabel } from '../schedule.ts';
	import TaskDetailModal from './TaskDetailModal.svelte';

	let {
		task,
		hostId,
		hostName,
		hostFeatures,
		projectId,
		canRunTask,
		runBlockReason
	} = $props<{
		task: RemoteTask;
		hostId: string;
		hostName: string;
		hostFeatures: Feature[];
		projectId: string;
		canRunTask: boolean;
		runBlockReason: string | null;
	}>();

	let showDetail = $state(false);

	const canRun = $derived(
		hostFeatures.includes('run_task') && canRunTask && task.status === 'queued'
	);

	const scheduleText = $derived(formatScheduleLabel(task.schedule));

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
	<div class="task-info">
		<div class="title-line">
			{#if task.next}
				<span class="marker next">{t('nextMarker')}</span>
			{/if}
			{#if task.resume}
				<span class="marker resume">{t('resumeMarker')}</span>
			{/if}
			<span class="title-text">{task.title}</span>
		</div>

		<div class="meta-line">
			<span class="status-badge status-{task.status}">{task.status}</span>
			{#if scheduleText}
				<span class="schedule-badge">{scheduleText}</span>
			{/if}
			{#if runBlockReason && task.status === 'queued'}
				<span class="block-reason-badge">{runBlockReason}</span>
			{/if}
		</div>
	</div>

	<div class="task-action" onclick={(e) => e.stopPropagation()} role="presentation">
		{#if canRun}
			<button
				class="btn btn-secondary run-btn"
				onclick={() => (showDetail = true)}
				aria-label={t('runOn', { machine: hostName })}
			>
				{t('run')}
			</button>
		{/if}
	</div>
</div>

{#if showDetail}
	<TaskDetailModal
		{task}
		{hostName}
		{canRun}
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
		gap: 12px;
		padding: 10px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--dur-fast);
	}

	.task-row:hover {
		background: var(--bg-hover);
	}

	.task-info {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1;
		min-width: 0;
	}

	.title-line {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.marker {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
	}
	.marker.next {
		background: var(--bg-active);
		color: var(--ink);
	}
	.marker.resume {
		background: var(--warn-bg);
		color: var(--warn);
	}

	.title-text {
		font-size: 13px;
		font-weight: 550;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta-line {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
	}

	.status-badge {
		color: var(--ink-faint);
	}

	.schedule-badge {
		color: var(--ink-muted);
		font-family: var(--font-mono);
	}

	.block-reason-badge {
		color: var(--warn);
	}

	.run-btn {
		min-height: 32px;
		padding: 4px 10px;
		font-size: 12px;
	}
</style>
