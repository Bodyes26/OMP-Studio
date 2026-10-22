<!--
  NewTaskModal.svelte — Creazione di un nuovo task per un progetto.
  Presentazione dialog Studio / bottom sheet su telefoni: superficie bg-overlay,
  ombra overlay, raggio xl, campi .ui-input e pulsanti .ui-button-*.
-->
<script lang="ts">
	import type { RemoteScheduleChoice, CommandError } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { formatCommandError } from '../errors.ts';
	import { calculateScheduleEpoch, defaultScheduleTime } from '../schedule.ts';
	import { IconClose } from '../icons.ts';

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
		aria-labelledby="new-task-title"
	>
		<div class="sheet-header">
			<div class="header-main">
				<div class="badge-row">
					<span class="ui-chip">{hostName}</span>
				</div>
				<h3 id="new-task-title" class="sheet-title">
					{t('newTaskTitle', { project: projectName })}
				</h3>
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

			<div class="form-group">
				<label class="form-label" for="new-task-prompt">{t('fullPrompt')}</label>
				<textarea
					id="new-task-prompt"
					class="ui-input prompt-textarea"
					rows="5"
					placeholder={t('promptPlaceholder')}
					bind:value={prompt}
					disabled={isSubmitting}
				></textarea>
			</div>

			<div class="form-group">
				<span class="form-label">{t('scheduleLabel')}</span>
				<div class="schedule-chips">
					<button
						type="button"
						class="ui-chip"
						aria-pressed={scheduleType === 'none'}
						onclick={() => (scheduleType = 'none')}
						disabled={isSubmitting}
					>
						{t('scheduleNone')}
					</button>
					<button
						type="button"
						class="ui-chip"
						aria-pressed={scheduleType === 'reset'}
						onclick={() => (scheduleType = 'reset')}
						disabled={isSubmitting}
					>
						{t('scheduleResetOption')}
					</button>
					<button
						type="button"
						class="ui-chip"
						aria-pressed={scheduleType === 'at'}
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
								class="ui-input"
								bind:value={atTime}
								disabled={isSubmitting}
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
									disabled={isSubmitting}
								>
									{t('scheduleToday')}
								</button>
								<button
									type="button"
									class="ui-chip"
									aria-pressed={atDay === 'tomorrow'}
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

		<div class="sheet-footer">
			<button
				type="button"
				class="ui-button ui-button-secondary"
				onclick={onClose}
				disabled={isSubmitting}
			>
				{t('cancel')}
			</button>
			<button
				type="button"
				class="ui-button ui-button-primary"
				onclick={handleSubmit}
				disabled={isSubmitting || isPromptEmpty}
			>
				{isSubmitting ? t('creatingTask') : t('createTask')}
			</button>
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
		max-width: 520px;
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
	}

	.sheet-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.01em;
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

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.form-label {
		font-size: var(--text-meta);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.sub-label {
		font-size: var(--text-meta);
		color: var(--ink-faint);
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
		padding: var(--space-3);
		background: var(--bg-sunken);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
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
