<script lang="ts">
	import type { RemoteTask } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { formatScheduleLabel } from '../schedule.ts';

	let {
		task,
		hostName,
		canRun,
		runBlockReason,
		onClose,
		onRun
	} = $props<{
		task: RemoteTask;
		hostName: string;
		canRun: boolean;
		runBlockReason: string | null;
		onClose: () => void;
		onRun: () => Promise<void>;
	}>();

	let isRunning = $state(false);

	async function handleConfirmRun(): Promise<void> {
		if (isRunning) return;
		isRunning = true;
		try {
			await onRun();
			onClose();
		} finally {
			isRunning = false;
		}
	}

	const scheduleText = $derived(formatScheduleLabel(task.schedule));
</script>

<div
	class="modal-backdrop"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
	role="presentation"
>
	<div
		class="modal-sheet"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-labelledby="modal-title"
	>
		<div class="modal-header">
			<div class="badge-row">
				<span class="machine-badge">{hostName}</span>
				{#if task.next}
					<span class="marker-badge">{t('nextMarker')}</span>
				{/if}
				{#if task.resume}
					<span class="marker-badge resume">{t('resumeMarker')}</span>
				{/if}
			</div>
			<h3 id="modal-title" class="task-title">{task.title}</h3>
			{#if scheduleText}
				<div class="schedule-info">{scheduleText}</div>
			{/if}
		</div>

		<div class="modal-body">
			<label class="prompt-label" for="task-prompt-display">{t('fullPrompt')}</label>
			<div id="task-prompt-display" class="prompt-box">
				{task.prompt}
			</div>

			{#if runBlockReason}
				<div class="block-reason">
					{runBlockReason}
				</div>
			{/if}
		</div>

		<div class="modal-footer">
			<button class="btn btn-secondary" onclick={onClose} disabled={isRunning}>
				{t('cancel')}
			</button>
			{#if canRun && task.status === 'queued'}
				<button class="btn btn-primary" onclick={handleConfirmRun} disabled={isRunning}>
					{isRunning ? t('running') : t('runOn', { machine: hostName })}
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.65);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 200;
	}

	.modal-sheet {
		width: 100%;
		max-width: 520px;
		max-height: 85vh;
		background: var(--bg-base);
		border: 1px solid var(--line-strong);
		border-top-left-radius: var(--radius-lg);
		border-top-right-radius: var(--radius-lg);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		box-shadow: 0 -4px 24px oklch(0 0 0 / 0.5);
	}

	.modal-header {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.badge-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.machine-badge {
		font-size: 11px;
		font-weight: 600;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}

	.marker-badge {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		background: var(--bg-hover);
		color: var(--ink);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.marker-badge.resume {
		color: var(--warn);
		background: var(--warn-bg);
	}

	.task-title {
		font-size: 16px;
		font-weight: 650;
		color: var(--ink);
		line-height: 1.3;
	}

	.schedule-info {
		font-size: 12px;
		color: var(--ink-faint);
		font-family: var(--font-mono);
	}

	.modal-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		overflow-y: auto;
		flex: 1;
	}

	.prompt-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.prompt-box {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 12px;
		font-size: 13px;
		line-height: 1.45;
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 300px;
		overflow-y: auto;
		font-family: var(--font-ui);
	}

	.block-reason {
		font-size: 12px;
		color: var(--warn);
		background: var(--warn-bg);
		padding: 6px 10px;
		border-radius: var(--radius-sm);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 8px;
		border-top: 1px solid var(--line);
	}
</style>
