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
				{#if typeof taskIndex === 'number'}
					<span class="position-badge">#{taskIndex + 1}</span>
				{/if}
			</div>

			<div class="title-reorder-row">
				<h3 id="modal-title" class="task-title">{task.title}</h3>
				{#if canEdit}
					<div class="reorder-btn-group">
						<button
							type="button"
							class="icon-btn"
							onclick={() => handleMove(-1)}
							disabled={!canMoveUp || isBusy}
							title={t('moveUp')}
							aria-label={t('moveUp')}
						>
							↑
						</button>
						<button
							type="button"
							class="icon-btn"
							onclick={() => handleMove(1)}
							disabled={!canMoveDown || isBusy}
							title={t('moveDown')}
							aria-label={t('moveDown')}
						>
							↓
						</button>
					</div>
				{/if}
			</div>

			{#if scheduleText}
				<div class="schedule-info">{scheduleText}</div>
			{/if}
		</div>

		<div class="modal-body">
			{#if errorMessage}
				<div class="error-banner" role="alert">
					{errorMessage}
				</div>
			{/if}

			<!-- Prompt Section -->
			<div class="section-block">
				<div class="section-header">
					<label class="prompt-label" for="task-prompt-input">{t('fullPrompt')}</label>
					{#if canEdit && !isEditingPrompt}
						<button
							type="button"
							class="link-action-btn"
							onclick={() => {
								editedPrompt = task.prompt;
								isEditingPrompt = true;
							}}
							disabled={isBusy}
						>
							{t('editPrompt')}
						</button>
					{/if}
				</div>

				{#if isEditingPrompt}
					<textarea
						id="task-prompt-input"
						class="prompt-textarea"
						rows="5"
						bind:value={editedPrompt}
						disabled={isBusy}
					></textarea>
					<div class="edit-actions-row">
						<button
							type="button"
							class="btn btn-secondary btn-sm"
							onclick={() => (isEditingPrompt = false)}
							disabled={isBusy}
						>
							{t('cancel')}
						</button>
						<button
							type="button"
							class="btn btn-primary btn-sm"
							onclick={handleSavePrompt}
							disabled={isBusy || editedPrompt.trim().length === 0}
						>
							{isBusy ? t('savingPrompt') : t('savePrompt')}
						</button>
					</div>
				{:else}
					<div id="task-prompt-display" class="prompt-box">
						{task.prompt}
					</div>
				{/if}
			</div>

			<!-- Schedule Section -->
			{#if canEdit}
				<div class="section-block">
					<div class="section-header">
						<span class="prompt-label">{t('scheduleLabel')}</span>
						{#if !isEditingSchedule}
							<button
								type="button"
								class="link-action-btn"
								onclick={startEditSchedule}
								disabled={isBusy}
							>
								{t('scheduleChange')}
							</button>
						{/if}
					</div>

					{#if isEditingSchedule}
						<div class="schedule-editor-box">
							<div class="schedule-options">
								<button
									type="button"
									class="schedule-pill"
									class:active={scheduleType === 'none'}
									onclick={() => (scheduleType = 'none')}
									disabled={isBusy}
								>
									{t('scheduleNone')}
								</button>
								<button
									type="button"
									class="schedule-pill"
									class:active={scheduleType === 'reset'}
									onclick={() => (scheduleType = 'reset')}
									disabled={isBusy}
								>
									{t('scheduleResetOption')}
								</button>
								<button
									type="button"
									class="schedule-pill"
									class:active={scheduleType === 'at'}
									onclick={() => (scheduleType = 'at')}
									disabled={isBusy}
								>
									{t('scheduleAtOption')}
								</button>
							</div>

							{#if scheduleType === 'at'}
								<div class="time-picker-row">
									<div class="time-input-wrap">
										<label class="sub-label" for="edit-schedule-time">{t('scheduleTime')}</label>
										<input
											id="edit-schedule-time"
											type="time"
											class="time-input"
											bind:value={atTime}
											disabled={isBusy}
										/>
									</div>
									<div class="day-toggle-wrap">
										<span class="sub-label">{t('scheduleLabel')}</span>
										<div class="day-pills">
											<button
												type="button"
												class="day-pill"
												class:active={atDay === 'today'}
												onclick={() => (atDay = 'today')}
												disabled={isBusy}
											>
												{t('scheduleToday')}
											</button>
											<button
												type="button"
												class="day-pill"
												class:active={atDay === 'tomorrow'}
												onclick={() => (atDay = 'tomorrow')}
												disabled={isBusy}
											>
												{t('scheduleTomorrow')}
											</button>
										</div>
									</div>
								</div>
							{/if}

							<div class="edit-actions-row">
								<button
									type="button"
									class="btn btn-secondary btn-sm"
									onclick={() => (isEditingSchedule = false)}
									disabled={isBusy}
								>
									{t('cancel')}
								</button>
								{#if task.schedule}
									<button
										type="button"
										class="btn btn-secondary btn-sm"
										onclick={handleRemoveSchedule}
										disabled={isBusy}
									>
										{t('scheduleRemove')}
									</button>
								{/if}
								<button
									type="button"
									class="btn btn-primary btn-sm"
									onclick={handleSaveSchedule}
									disabled={isBusy}
								>
									{t('scheduleSave')}
								</button>
							</div>
						</div>
					{:else}
						<div class="schedule-status-row">
							<span class="schedule-status-text">
								{scheduleText || t('scheduleNone')}
							</span>
							{#if task.schedule}
								<button
									type="button"
									class="btn-remove-schedule"
									onclick={handleRemoveSchedule}
									disabled={isBusy}
								>
									{t('scheduleRemove')}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if runBlockReason}
				<div class="block-reason">
					{runBlockReason}
				</div>
			{/if}

			<!-- Delete Section -->
			{#if canEdit}
				<div class="delete-section">
					{#if isConfirmingDelete}
						<div class="delete-confirm-box">
							<span class="delete-confirm-title">{t('deleteTaskConfirmTitle')}</span>
							<span class="delete-confirm-desc">{t('deleteTaskConfirmDesc')}</span>
							<div class="delete-confirm-actions">
								<button
									type="button"
									class="btn btn-secondary btn-sm"
									onclick={() => (isConfirmingDelete = false)}
									disabled={isBusy}
								>
									{t('cancel')}
								</button>
								<button
									type="button"
									class="btn btn-danger btn-sm"
									onclick={handleDelete}
									disabled={isBusy}
								>
									{isBusy ? t('deletingTask') : t('confirmDelete')}
								</button>
							</div>
						</div>
					{:else}
						<button
							type="button"
							class="btn-delete-trigger"
							onclick={() => (isConfirmingDelete = true)}
							disabled={isBusy}
						>
							{t('deleteTask')}
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<div class="modal-footer">
			<button class="btn btn-secondary" onclick={onClose} disabled={isBusy}>
				{t('close')}
			</button>
			{#if canRun && task.status === 'queued'}
				<button class="btn btn-primary" onclick={handleConfirmRun} disabled={isBusy}>
					{isBusy ? t('running') : t('runOn', { machine: hostName })}
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
		overflow-y: auto;
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
		font-size: 0.72rem;
		padding: 2px 7px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.position-badge {
		font-size: 0.72rem;
		padding: 2px 6px;
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-weight: 600;
	}

	.marker-badge {
		font-size: 0.72rem;
		font-weight: 600;
		padding: 2px 7px;
		background: var(--brand);
		color: var(--on-brand);
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.marker-badge.resume {
		background: var(--warn);
		color: var(--on-brand);
	}

	.title-reorder-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.task-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--ink);
		flex: 1;
	}

	.reorder-btn-group {
		display: flex;
		gap: 4px;
	}

	.icon-btn {
		width: 30px;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: 0.95rem;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.icon-btn:hover:not(:disabled) {
		background: var(--bg-raised);
	}
	.icon-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.schedule-info {
		font-size: 0.8rem;
		color: var(--ink-muted);
	}

	.modal-body {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.error-banner {
		padding: 8px 12px;
		background: var(--danger-bg);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: 0.85rem;
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.prompt-label {
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.link-action-btn {
		background: none;
		border: none;
		color: var(--brand);
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
		padding: 2px 4px;
	}

	.link-action-btn:hover:not(:disabled) {
		text-decoration: underline;
	}

	.prompt-box {
		padding: 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: 0.88rem;
		line-height: 1.45;
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 180px;
		overflow-y: auto;
	}

	.prompt-textarea {
		width: 100%;
		padding: 10px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: inherit;
		font-size: 0.88rem;
		line-height: 1.4;
		resize: vertical;
		box-sizing: border-box;
	}

	.prompt-textarea:focus {
		outline: none;
		border-color: var(--brand);
	}

	.edit-actions-row {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 6px;
	}

	.schedule-status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.schedule-status-text {
		font-size: 0.84rem;
		color: var(--ink);
	}

	.btn-remove-schedule {
		background: none;
		border: none;
		color: var(--danger);
		font-size: 0.76rem;
		cursor: pointer;
		padding: 2px 4px;
	}

	.schedule-editor-box {
		padding: 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.schedule-options {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.schedule-pill {
		padding: 5px 10px;
		font-size: 0.8rem;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.schedule-pill.active {
		background: color-mix(in srgb, var(--brand) 14%, transparent);
		border-color: var(--brand);
		color: var(--ink);
		font-weight: 500;
	}

	.time-picker-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 8px 10px;
		background: var(--bg-base);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.time-input-wrap,
	.day-toggle-wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.sub-label {
		font-size: 0.7rem;
		color: var(--ink-muted);
	}

	.time-input {
		padding: 4px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: inherit;
		font-size: 0.85rem;
	}

	.day-pills {
		display: flex;
		gap: 4px;
	}

	.day-pill {
		padding: 4px 8px;
		font-size: 0.78rem;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.day-pill.active {
		background: color-mix(in srgb, var(--brand) 14%, transparent);
		border-color: var(--brand);
		color: var(--ink);
		font-weight: 500;
	}

	.block-reason {
		padding: 8px 12px;
		background: var(--warn-bg);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		color: var(--warn);
	}

	.delete-section {
		border-top: 1px solid var(--line);
		padding-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.btn-delete-trigger {
		align-self: flex-start;
		background: none;
		border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
		color: var(--danger);
		border-radius: var(--radius-sm);
		padding: 5px 10px;
		font-size: 0.8rem;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.btn-delete-trigger:hover:not(:disabled) {
		background: var(--danger-bg);
	}

	.delete-confirm-box {
		padding: 10px 12px;
		background: var(--danger-bg);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		border-radius: var(--radius-sm);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.delete-confirm-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--danger);
	}

	.delete-confirm-desc {
		font-size: 0.78rem;
		color: var(--ink-muted);
	}
	.delete-confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 4px;
	}
	.btn-sm {
		min-height: 32px;
		padding: 4px 10px;
		font-size: 12px;
	}
</style>
