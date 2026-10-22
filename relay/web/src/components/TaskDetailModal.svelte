<!--
  TaskDetailModal.svelte — Dettaglio, modifica, riordino e avvio di un task.
  Presentazione dialog Studio / bottom sheet su telefoni: superficie bg-overlay,
  ombra overlay, raggio xl, campi .ui-input e pulsanti .ui-button-*.
-->
<script lang="ts">
	import type { RemoteTask, Feature, RemoteScheduleChoice, CommandError } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { formatCommandError } from '../errors.ts';
	import {
		formatScheduleLabel,
		calculateScheduleEpoch,
		defaultScheduleTime
	} from '../schedule.ts';
	import {
		IconClose,
		IconArrowUp,
		IconArrowDown,
		IconPlay,
		IconPencil,
		IconSchedule,
		IconTrash
	} from '../icons.ts';
	import StatusMark, { type StatusMarkType } from './StatusMark.svelte';

	let {
		task,
		hostId,
		hostName,
		hostFeatures = [],
		projectId,
		taskIndex,
		totalTasks,
		canRun,
		runBlockReason,
		onClose,
		onRun
	} = $props<{
		task: RemoteTask;
		hostId?: string;
		hostName: string;
		hostFeatures?: Feature[];
		projectId?: string;
		taskIndex?: number;
		totalTasks?: number;
		canRun: boolean;
		runBlockReason: string | null;
		onClose: () => void;
		onRun: () => Promise<void>;
	}>();

	let isBusy = $state(false);
	let errorMessage = $state<string | null>(null);

	// Modifica prompt
	let isEditingPrompt = $state(false);
	let editedPrompt = $state('');

	// Modifica programmazione
	let isEditingSchedule = $state(false);
	let scheduleType = $state<'none' | 'reset' | 'at'>('none');
	let atTime = $state(defaultScheduleTime());
	let atDay = $state<'today' | 'tomorrow'>('today');

	// Conferma eliminazione
	let isConfirmingDelete = $state(false);

	const canEdit = $derived(
		Boolean(hostFeatures?.includes('task_edit') && projectId && hostId && task.status === 'queued')
	);

	const canMoveUp = $derived(
		canEdit && typeof taskIndex === 'number' && taskIndex > 0
	);

	const canMoveDown = $derived(
		canEdit &&
			typeof taskIndex === 'number' &&
			typeof totalTasks === 'number' &&
			taskIndex < totalTasks - 1
	);

	const scheduleText = $derived(formatScheduleLabel(task.schedule));

	function toStatusMarkStatus(status: string): StatusMarkType {
		switch (status) {
			case 'running': return 'running';
			case 'completed':
			case 'done': return 'completed';
			case 'failed':
			case 'aborted': return 'failed';
			default: return 'pending';
		}
	}

	function startEditSchedule() {
		if (task.schedule?.kind === 'reset') {
			scheduleType = 'reset';
		} else if (task.schedule?.kind === 'at') {
			scheduleType = 'at';
			if (task.schedule.notBefore) {
				const d = new Date(task.schedule.notBefore);
				atTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
				const isTomorrow = d.getDate() !== new Date().getDate();
				atDay = isTomorrow ? 'tomorrow' : 'today';
			}
		} else {
			scheduleType = 'none';
		}
		isEditingSchedule = true;
	}

	async function handleConfirmRun(): Promise<void> {
		if (isBusy) return;
		isBusy = true;
		errorMessage = null;
		try {
			await onRun();
			onClose();
		} catch (err) {
			errorMessage = formatCommandError(err as unknown as CommandError);
		} finally {
			isBusy = false;
		}
	}

	async function handleSavePrompt(): Promise<void> {
		if (isBusy || !hostId || !projectId) return;
		const trimmed = editedPrompt.trim();
		if (!trimmed) {
			errorMessage = t('promptEmptyError');
			return;
		}
		if (trimmed.length > 20_000) {
			errorMessage = t('promptTooLongError');
			return;
		}

		isBusy = true;
		errorMessage = null;
		try {
			await connection.sendCommand(hostId, {
				kind: 'update_task',
				projectId,
				taskId: task.id,
				prompt: trimmed
			});
			isEditingPrompt = false;
		} catch (err) {
			errorMessage = formatCommandError(err as unknown as CommandError);
		} finally {
			isBusy = false;
		}
	}

	async function handleRemoveSchedule(): Promise<void> {
		if (isBusy || !hostId || !projectId) return;
		isBusy = true;
		errorMessage = null;
		try {
			await connection.sendCommand(hostId, {
				kind: 'update_task',
				projectId,
				taskId: task.id,
				schedule: null
			});
			isEditingSchedule = false;
		} catch (err) {
			errorMessage = formatCommandError(err as unknown as CommandError);
		} finally {
			isBusy = false;
		}
	}

	async function handleSaveSchedule(): Promise<void> {
		if (isBusy || !hostId || !projectId) return;

		let schedule: RemoteScheduleChoice | null = null;
		if (scheduleType === 'reset') {
			schedule = { kind: 'reset' };
		} else if (scheduleType === 'at') {
			const epoch = calculateScheduleEpoch(atTime, atDay);
			if (epoch === null) {
				errorMessage = t('errRejected');
				return;
			}
			if (atDay === 'today' && epoch < Date.now() - 60_000) {
				errorMessage = t('schedulePastError');
				return;
			}
			schedule = { kind: 'at', notBefore: epoch };
		}

		isBusy = true;
		errorMessage = null;
		try {
			await connection.sendCommand(hostId, {
				kind: 'update_task',
				projectId,
				taskId: task.id,
				schedule
			});
			isEditingSchedule = false;
		} catch (err) {
			errorMessage = formatCommandError(err as unknown as CommandError);
		} finally {
			isBusy = false;
		}
	}

	async function handleDelete(): Promise<void> {
		if (isBusy || !hostId || !projectId) return;
		isBusy = true;
		errorMessage = null;
		try {
			await connection.sendCommand(hostId, {
				kind: 'delete_task',
				projectId,
				taskId: task.id
			});
			onClose();
		} catch (err) {
			errorMessage = formatCommandError(err as unknown as CommandError);
			isBusy = false;
		}
	}

	async function handleMove(direction: -1 | 1): Promise<void> {
		if (isBusy || !hostId || !projectId || typeof taskIndex !== 'number') return;
		const targetIndex = taskIndex + direction;
		isBusy = true;
		errorMessage = null;
		try {
			await connection.sendCommand(hostId, {
				kind: 'move_task',
				projectId,
				taskId: task.id,
				toIndex: targetIndex
			});
		} catch (err) {
			errorMessage = formatCommandError(err as unknown as CommandError);
		} finally {
			isBusy = false;
		}
	}
</script>

<div
	class="sheet-backdrop"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
	role="presentation"
>
	<div
		class="sheet-surface rv-lift"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } else { e.stopPropagation(); } }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-labelledby="modal-title"
	>
		<div class="sheet-header">
			<div class="header-main">
				<div class="badge-row">
					<StatusMark status={toStatusMarkStatus(task.status)} />
					<span class="ui-chip">{hostName}</span>
					{#if task.next}
						<span class="next-tag">{t('nextMarker')}</span>
					{/if}
					{#if task.resume}
						<span class="resume-tag">{t('resumeMarker')}</span>
					{/if}
				</div>

				<div class="title-row">
					<h3 id="modal-title" class="sheet-title">{task.title}</h3>

					{#if canEdit}
						<div class="reorder-btns">
							<button
								type="button"
								class="ui-button ui-button-ghost icon-btn"
								disabled={!canMoveUp || isBusy}
								onclick={() => handleMove(-1)}
								aria-label={t('moveUp')}
								title={t('moveUp')}
							>
								<IconArrowUp />
							</button>
							<button
								type="button"
								class="ui-button ui-button-ghost icon-btn"
								disabled={!canMoveDown || isBusy}
								onclick={() => handleMove(1)}
								aria-label={t('moveDown')}
								title={t('moveDown')}
							>
								<IconArrowDown />
							</button>
						</div>
					{/if}
				</div>

				{#if scheduleText}
					<div class="schedule-display">
						<IconSchedule />
						<span>{scheduleText}</span>
					</div>
				{/if}
			</div>

			<button
				type="button"
				class="ui-button ui-button-ghost close-btn"
				onclick={onClose}
				aria-label={t('close')}
			>
				<IconClose />
			</button>
		</div>

		<div class="sheet-body">
			{#if errorMessage}
				<div class="error-banner" role="alert">
					{errorMessage}
				</div>
			{/if}

			<!-- Sezione Prompt -->
			<div class="section-block">
				<div class="section-head">
					<span class="section-label">{t('fullPrompt')}</span>
					{#if canEdit && !isEditingPrompt}
						<button
							type="button"
							class="ui-button ui-button-ghost edit-link-btn"
							onclick={() => {
								editedPrompt = task.prompt;
								isEditingPrompt = true;
							}}
							disabled={isBusy}
						>
							<IconPencil />
							<span>{t('editPrompt')}</span>
						</button>
					{/if}
				</div>

				{#if isEditingPrompt}
					<div class="edit-prompt-area">
						<textarea
							class="ui-input prompt-textarea"
							rows="6"
							bind:value={editedPrompt}
							disabled={isBusy}
						></textarea>
						<div class="action-row-end">
							<button
								type="button"
								class="ui-button ui-button-ghost"
								disabled={isBusy}
								onclick={() => (isEditingPrompt = false)}
							>
								{t('cancel')}
							</button>
							<button
								type="button"
								class="ui-button ui-button-primary"
								disabled={isBusy || !editedPrompt.trim()}
								onclick={handleSavePrompt}
							>
								{isBusy ? t('savingPrompt') : t('savePrompt')}
							</button>
						</div>
					</div>
				{:else}
					<div class="prompt-text-display">
						{task.prompt}
					</div>
				{/if}
			</div>

			<!-- Sezione Programmazione -->
			{#if canEdit}
				<div class="section-block">
					<div class="section-head">
						<span class="section-label">{t('scheduleLabel')}</span>
						{#if !isEditingSchedule}
							<button
								type="button"
								class="ui-button ui-button-ghost edit-link-btn"
								onclick={startEditSchedule}
								disabled={isBusy}
							>
								<IconPencil />
								<span>{t('scheduleChange')}</span>
							</button>
						{/if}
					</div>

					{#if isEditingSchedule}
						<div class="edit-schedule-area">
							<div class="schedule-chips">
								<button
									type="button"
									class="ui-chip"
									aria-pressed={scheduleType === 'none'}
									onclick={() => (scheduleType = 'none')}
									disabled={isBusy}
								>
									{t('scheduleNone')}
								</button>
								<button
									type="button"
									class="ui-chip"
									aria-pressed={scheduleType === 'reset'}
									onclick={() => (scheduleType = 'reset')}
									disabled={isBusy}
								>
									{t('scheduleResetOption')}
								</button>
								<button
									type="button"
									class="ui-chip"
									aria-pressed={scheduleType === 'at'}
									onclick={() => (scheduleType = 'at')}
									disabled={isBusy}
								>
									{t('scheduleAtOption')}
								</button>
							</div>

							{#if scheduleType === 'at'}
								<div class="time-picker-row">
									<div class="time-input-wrap">
										<label class="sub-label" for="detail-time-input">{t('scheduleTime')}</label>
										<input
											id="detail-time-input"
											type="time"
											class="ui-input"
											bind:value={atTime}
											disabled={isBusy}
										/>
									</div>
									<div class="day-toggle-wrap">
										<span class="sub-label">{t('scheduleLabel')}</span>
										<div class="schedule-chips">
											<button
												type="button"
												class="ui-chip"
												aria-pressed={atDay === 'today'}
												onclick={() => (atDay = 'today')}
												disabled={isBusy}
											>
												{t('scheduleToday')}
											</button>
											<button
												type="button"
												class="ui-chip"
												aria-pressed={atDay === 'tomorrow'}
												onclick={() => (atDay = 'tomorrow')}
												disabled={isBusy}
											>
												{t('scheduleTomorrow')}
											</button>
										</div>
									</div>
								</div>
							{/if}

							<div class="action-row-end">
								{#if task.schedule}
									<button
										type="button"
										class="ui-button ui-button-ghost"
										disabled={isBusy}
										onclick={handleRemoveSchedule}
									>
										{t('scheduleRemove')}
									</button>
								{/if}
								<button
									type="button"
									class="ui-button ui-button-ghost"
									disabled={isBusy}
									onclick={() => (isEditingSchedule = false)}
								>
									{t('cancel')}
								</button>
								<button
									type="button"
									class="ui-button ui-button-primary"
									disabled={isBusy}
									onclick={handleSaveSchedule}
								>
									{isBusy ? t('running') : t('scheduleSave')}
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			{#if runBlockReason}
				<div class="block-reason-banner">
					{runBlockReason}
				</div>
			{/if}

			<!-- Sezione Eliminazione -->
			{#if canEdit}
				<div class="delete-section">
					{#if !isConfirmingDelete}
						<button
							type="button"
							class="ui-button ui-button-ghost delete-btn"
							disabled={isBusy}
							onclick={() => (isConfirmingDelete = true)}
						>
							<IconTrash />
							<span>{t('deleteTask')}</span>
						</button>
					{:else}
						<div class="confirm-delete-box">
							<p class="confirm-delete-desc">{t('deleteTaskConfirmDesc')}</p>
							<div class="action-row-end">
								<button
									type="button"
									class="ui-button ui-button-ghost"
									disabled={isBusy}
									onclick={() => (isConfirmingDelete = false)}
								>
									{t('cancel')}
								</button>
								<button
									type="button"
									class="ui-button ui-button-danger"
									disabled={isBusy}
									onclick={handleDelete}
								>
									{isBusy ? t('deletingTask') : t('confirmDelete')}
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div class="sheet-footer">
			<button
				type="button"
				class="ui-button ui-button-secondary"
				onclick={onClose}
				disabled={isBusy}
			>
				{t('close')}
			</button>
			{#if canRun}
				<button
					type="button"
					class="ui-button ui-button-primary"
					disabled={isBusy}
					onclick={handleConfirmRun}
				>
					<IconPlay />
					<span>{t('runOn', { machine: hostName })}</span>
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		z-index: 200;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 0;
	}

	@media (min-width: 600px) {
		.sheet-backdrop {
			align-items: center;
			padding: var(--space-4);
		}
	}

	.sheet-surface {
		width: 100%;
		max-width: 560px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		box-shadow: var(--shadow-overlay);
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		display: flex;
		flex-direction: column;
		max-height: 90vh;
		max-height: 90dvh;
		padding-bottom: env(safe-area-inset-bottom, 0px);
		overflow: hidden;
	}

	@media (min-width: 600px) {
		.sheet-surface {
			border-radius: var(--radius-xl);
		}
	}

	.sheet-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-4) var(--space-4) var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
		gap: var(--space-2);
	}

	.header-main {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}

	.badge-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.next-tag {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-weight: 700;
		color: var(--brand-ink);
	}

	.resume-tag {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-muted);
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.sheet-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.01em;
		word-break: break-word;
	}

	.reorder-btns {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.icon-btn {
		width: 28px;
		height: 28px;
		padding: 0;
		--icon-size: 14px;
	}

	.schedule-display {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: var(--text-meta);
		color: var(--ink-muted);
		--icon-size: 13px;
	}

	.close-btn {
		width: 32px;
		height: 32px;
		--icon-size: 16px;
		flex-shrink: 0;
	}

	.sheet-body {
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		overflow-y: auto;
	}

	.error-banner {
		padding: 8px 12px;
		background: color-mix(in oklab, var(--danger) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--danger) 30%, transparent);
		border-radius: var(--radius-md);
		color: var(--danger);
		font-size: var(--text-caption);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.section-label {
		font-size: var(--text-meta);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.edit-link-btn {
		height: 24px;
		padding: 0 6px;
		font-size: var(--text-meta);
		gap: 4px;
		--icon-size: 11px;
	}

	.prompt-text-display {
		padding: 10px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		font-size: var(--text-chat);
		color: var(--ink);
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.edit-prompt-area {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.prompt-textarea {
		width: 100%;
		min-height: 100px;
		height: auto;
		resize: vertical;
		padding: 8px 10px;
		line-height: 1.45;
		font-size: var(--text-chat);
		border-radius: var(--radius-md);
	}

	.action-row-end {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.edit-schedule-area {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: var(--space-3);
		background: var(--bg-sunken);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
	}

	.schedule-chips {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.time-picker-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		margin-top: 4px;
	}

	.time-input-wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.day-toggle-wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.sub-label {
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}

	.block-reason-banner {
		padding: 8px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-caption);
	}

	.delete-section {
		border-top: 1px solid var(--line);
		padding-top: var(--space-3);
		margin-top: var(--space-2);
	}

	.delete-btn {
		color: var(--danger);
		gap: 6px;
		--icon-size: 14px;
	}

	.confirm-delete-box {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
		background: color-mix(in oklab, var(--danger) 8%, transparent);
		border: 1px solid color-mix(in oklab, var(--danger) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.confirm-delete-desc {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink);
	}

	.sheet-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
	}
</style>
