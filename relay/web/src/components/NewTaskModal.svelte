<script lang="ts">
	import type { RemoteScheduleChoice, CommandError } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { formatCommandError } from '../errors.ts';
	import { calculateScheduleEpoch, defaultScheduleTime } from '../schedule.ts';

	let {
		hostId,
		hostName,
		projectId,
		projectName,
		onClose
	} = $props<{
		hostId: string;
		hostName: string;
		projectId: string;
		projectName: string;
		onClose: () => void;
	}>();

	let prompt = $state('');
	let scheduleType = $state<'none' | 'reset' | 'at'>('none');
	let atTime = $state(defaultScheduleTime());
	let atDay = $state<'today' | 'tomorrow'>('today');

	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);

	const isPromptEmpty = $derived(prompt.trim().length === 0);

	async function handleSubmit(): Promise<void> {
		if (isSubmitting) return;
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			errorMessage = t('promptEmptyError');
			return;
		}
		if (trimmedPrompt.length > 20_000) {
			errorMessage = t('promptTooLongError');
			return;
		}

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

		isSubmitting = true;
		errorMessage = null;
		try {
			await connection.sendCommand(hostId, {
				kind: 'create_task',
				projectId,
				prompt: trimmedPrompt,
				schedule
			});
			onClose();
		} catch (err) {
			errorMessage = formatCommandError(err as unknown as CommandError);
		} finally {
			isSubmitting = false;
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
		aria-labelledby="new-task-title"
	>
		<div class="modal-header">
			<div class="badge-row">
				<span class="machine-badge">{hostName}</span>
			</div>
			<h3 id="new-task-title" class="task-title">
				{t('newTaskTitle', { project: projectName })}
			</h3>
		</div>

		<div class="modal-body">
			{#if errorMessage}
				<div class="error-banner" role="alert">
					{errorMessage}
				</div>
			{/if}

			<div class="form-group">
				<label class="form-label" for="new-task-prompt">{t('fullPrompt')}</label>
				<textarea
					id="new-task-prompt"
					class="prompt-textarea"
					rows="5"
					placeholder={t('promptPlaceholder')}
					bind:value={prompt}
					disabled={isSubmitting}
				></textarea>
			</div>

			<div class="form-group">
				<span class="form-label">{t('scheduleLabel')}</span>
				<div class="schedule-options">
					<button
						type="button"
						class="schedule-pill"
						class:active={scheduleType === 'none'}
						onclick={() => (scheduleType = 'none')}
						disabled={isSubmitting}
					>
						{t('scheduleNone')}
					</button>
					<button
						type="button"
						class="schedule-pill"
						class:active={scheduleType === 'reset'}
						onclick={() => (scheduleType = 'reset')}
						disabled={isSubmitting}
					>
						{t('scheduleResetOption')}
					</button>
					<button
						type="button"
						class="schedule-pill"
						class:active={scheduleType === 'at'}
						onclick={() => (scheduleType = 'at')}
						disabled={isSubmitting}
					>
						{t('scheduleAtOption')}
					</button>
				</div>

				{#if scheduleType === 'at'}
					<div class="time-picker-row">
						<div class="time-input-wrap">
							<label class="sub-label" for="schedule-time-input">{t('scheduleTime')}</label>
							<input
								id="schedule-time-input"
								type="time"
								class="time-input"
								bind:value={atTime}
								disabled={isSubmitting}
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
									disabled={isSubmitting}
								>
									{t('scheduleToday')}
								</button>
								<button
									type="button"
									class="day-pill"
									class:active={atDay === 'tomorrow'}
									onclick={() => (atDay = 'tomorrow')}
									disabled={isSubmitting}
								>
									{t('scheduleTomorrow')}
								</button>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<div class="modal-footer">
			<button class="btn btn-secondary" onclick={onClose} disabled={isSubmitting}>
				{t('cancel')}
			</button>
			<button
				class="btn btn-primary"
				onclick={handleSubmit}
				disabled={isSubmitting || isPromptEmpty}
			>
				{isSubmitting ? t('creatingTask') : t('createTask')}
			</button>
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

	.task-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--ink);
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

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.form-label {
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.sub-label {
		font-size: 0.72rem;
		color: var(--ink-muted);
	}

	.prompt-textarea {
		width: 100%;
		padding: 10px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: inherit;
		font-size: 0.9rem;
		line-height: 1.4;
		resize: vertical;
		box-sizing: border-box;
	}

	.prompt-textarea:focus {
		outline: none;
		border-color: var(--brand);
	}

	.schedule-options {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.schedule-pill {
		padding: 6px 12px;
		font-size: 0.82rem;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.schedule-pill:hover:not(:disabled) {
		background: var(--bg-raised);
		color: var(--ink);
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
		gap: 16px;
		margin-top: 6px;
		padding: 10px;
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.time-input-wrap,
	.day-toggle-wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.time-input {
		padding: 5px 8px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: inherit;
		font-size: 0.88rem;
	}

	.day-pills {
		display: flex;
		gap: 4px;
	}

	.day-pill {
		padding: 5px 10px;
		font-size: 0.8rem;
		background: var(--bg-base);
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

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 4px;
	}
</style>
