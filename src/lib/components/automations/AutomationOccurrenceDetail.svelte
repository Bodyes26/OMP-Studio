<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { t, formatDateTime, formatDuration } from '#lib/automations/i18n.ts';
	import type { AutomationOccurrence, AutomationExecution, ResolvedAutomationTarget } from '#lib/automations/types.ts';
	import AutomationOutputViewer from './AutomationOutputViewer.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import {
		IconPlay,
		IconStop,
		IconCheck,
		IconWarning,
		IconClose,
		IconRefresh,
		IconExternalLink,
		IconFileText,
		IconFolder,
		IconAsk,
		IconSchedule
	} from '#lib/icons.ts';

	interface Props {
		occurrence: AutomationOccurrence;
		onClose?: () => void;
		onOpenSession?: (sessionId: string) => void;
	}

	let { occurrence, onClose, onOpenSession }: Props = $props();

	let selectedExecutionId = $state<string | null>(null);
	let showExtendModal = $state(false);
	let extendMinutes = $state(30);
	let isExtending = $state(false);
	let extendError = $state<string | null>(null);

	// Select first execution by default if available
	$effect(() => {
		if (occurrence.executions.length > 0 && !selectedExecutionId) {
			selectedExecutionId = occurrence.executions[0].id;
		}
	});

	const selectedExecution = $derived(
		occurrence.executions.find((e) => e.id === selectedExecutionId) || occurrence.executions[0] || null
	);

	const failedTargets = $derived(
		occurrence.executions
			.filter((e) => e.state === 'error' || e.state === 'timeout' || e.state === 'skipped')
			.flatMap((e) => e.targets.map((t) => t.path))
	);

	const hasFailedOrSkipped = $derived(failedTargets.length > 0);

	// AUT-044: scadenza reale attesa umana solo da execution.humanDeadline (senza fallback su occurrence.deadline o startedAt)
	const deadlineMs = $derived((selectedExecution as any)?.humanDeadline ?? null);
	const remainingWaitMinutes = $derived(
		deadlineMs ? Math.max(0, Math.round((deadlineMs - Date.now()) / 60000)) : 0
	);

	const unknownTargets = $derived(
		occurrence.executions
			.filter((e) => e.state === 'unknown')
			.flatMap((e) => e.targets.map((t) => t.path))
	);
	let showVerifyUnknownModal = $state(false);
	let showRetryUnknownModal = $state(false);
	let isVerifyingUnknown = $state(false);
	let isRetryingUnknown = $state(false);

	async function handleVerifyUnknown() {
		isVerifyingUnknown = true;
		try {
			await automationsStore.acknowledge(occurrence.id, true);
			showVerifyUnknownModal = false;
		} catch (err) {
			console.error('Failed to verify unknown outcome:', err);
		} finally {
			isVerifyingUnknown = false;
		}
	}

	async function handleRetryUnknown() {
		if (unknownTargets.length === 0) return;
		isRetryingUnknown = true;
		try {
			await automationsStore.runNow(occurrence.automationId, unknownTargets);
			showRetryUnknownModal = false;
		} catch (err) {
			console.error('Failed to retry unknown targets:', err);
		} finally {
			isRetryingUnknown = false;
		}
	}

	function handleScriptReview() {
		const drafts = automationsStore.snapshot?.drafts || [];
		const draft = drafts.find((d) => d.definition.id === occurrence.automationId);
		if (draft) {
			automationsStore.openReview(draft.id).catch(() => {
				const def =
					automationsStore.snapshot?.definitions.find((d) => d.id === occurrence.automationId) ||
					occurrence.definition;
				if (def) automationsStore.edit(def);
			});
		} else {
			const def =
				automationsStore.snapshot?.definitions.find((d) => d.id === occurrence.automationId) ||
				occurrence.definition;
			if (def) automationsStore.edit(def);
		}
	}

	// Stop disponibile non solo per running ma anche per needsInput e per qualsiasi esecuzione attiva (AUT-044, AUT-068)
	const canStop = $derived(
		occurrence.state === 'running' ||
			occurrence.state === 'needsInput' ||
			occurrence.executions.some((e) => e.state === 'running' || e.state === 'needsInput')
	);

	// AUT-102: domande, revisioni ed esiti ignoti non possono essere risolti da un semplice ack
	const hasUnresolved = $derived(
		occurrence.requiresReview ||
			occurrence.state === 'unknown' ||
			occurrence.state === 'needsInput' ||
			occurrence.executions.some((e) => e.state === 'needsInput')
	);

	const canAcknowledge = $derived(
		!occurrence.acknowledged &&
			!hasUnresolved &&
			(occurrence.state === 'completed' ||
				occurrence.state === 'error' ||
				occurrence.state === 'timeout' ||
				occurrence.state === 'interrupted' ||
				occurrence.state === 'skipped')
	);

	function formatElapsedDuration(start: number | null, end: number | null): string {
		if (!start) return '—';
		const finish = end || Date.now();
		const diffMs = Math.max(0, finish - start);
		const sec = Math.floor(diffMs / 1000);
		if (sec < 60) return `${sec}s`;
		const min = Math.floor(sec / 60);
		const remSec = sec % 60;
		return `${min}m ${remSec}s`;
	}

	async function handleAcknowledge() {
		try {
			await automationsStore.acknowledge(occurrence.id);
		} catch (err) {
			console.error('Failed to acknowledge occurrence:', err);
		}
	}

	async function handleCancel() {
		try {
			await automationsStore.cancel(occurrence.id);
		} catch (err) {
			console.error('Failed to cancel occurrence:', err);
		}
	}

	async function handleSelectiveRetry() {
		if (failedTargets.length === 0) return;
		try {
			await automationsStore.runNow(occurrence.automationId, failedTargets);
		} catch (err) {
			console.error('Failed to run selective retry:', err);
		}
	}

	async function handleExtendWait(minutes: number) {
		if (minutes <= 0) return;
		isExtending = true;
		extendError = null;
		try {
			if (typeof (automationsStore as any).extendWait === 'function') {
				await (automationsStore as any).extendWait(occurrence.id, selectedExecution?.id, minutes);
			} else {
				await invoke('automations_extend_wait', {
					runId: occurrence.id,
					executionId: selectedExecution?.id ?? null,
					minutes
				});
				await automationsStore.refresh();
			}
			showExtendModal = false;
		} catch (err) {
			extendError = err instanceof Error ? err.message : String(err);
		} finally {
			isExtending = false;
		}
	}
</script>

<div class="occurrence-detail">
	<!-- Intestazione occorrenza -->
	<div class="occurrence-header">
		<div class="header-main">
			<div class="status-row">
				<span class="status-pill status-{occurrence.state}">
					{t(`exec_${occurrence.state}` as any) || occurrence.state}
				</span>
				{#if occurrence.acknowledged}
					<span class="status-pill acknowledged">
						<IconCheck />
						<span>{t('occ_acknowledged')}</span>
					</span>
				{/if}
				{#if occurrence.requiresReview}
					<span class="status-pill warn">
						<IconWarning />
						<span>{t('occ_script_review_badge')}</span>
					</span>
				{/if}
			</div>
			<h3 class="occurrence-title">{occurrence.name || t('occ_title', { id: occurrence.id.slice(0, 8) })}</h3>
			<div class="occurrence-meta text-xs">
				<span>{t('occ_scheduled_at', { time: formatDateTime(occurrence.scheduledAt) })}</span>
				<span class="bullet">·</span>
				<span>Rev. {occurrence.revision}</span>
			</div>
		</div>

		<div class="header-actions">
			{#if canStop}
				<button
					type="button"
					class="ui-button ui-button-danger text-xs"
					onclick={handleCancel}
					title={t('popover_action_stop')}
				>
					<IconStop />
					<span>{t('popover_action_stop')}</span>
				</button>
			{/if}

			{#if occurrence.requiresReview}
				<button
					type="button"
					class="ui-button ui-button-secondary text-xs"
					onclick={handleScriptReview}
				>
					<IconWarning />
					<span>{t('occ_btn_review_script')}</span>
				</button>
			{/if}

			{#if canAcknowledge}
				<button
					type="button"
					class="ui-button ui-button-secondary text-xs"
					onclick={handleAcknowledge}
				>
					<IconCheck />
					<span>{t('occ_btn_acknowledge')}</span>
				</button>
			{/if}

			{#if hasFailedOrSkipped && !canStop}
				<button
					type="button"
					class="ui-button ui-button-secondary text-xs"
					onclick={handleSelectiveRetry}
					title="Riesegue solo i destinatari falliti o saltati ({failedTargets.length})"
				>
					<IconRefresh />
					<span>{t('occ_btn_retry_selective')}</span>
				</button>
			{/if}

			{#if onClose}
				<button
					type="button"
					class="ui-button ui-button-ghost icon-only-btn"
					onclick={onClose}
					aria-label={t('btn_close')}
				>
					<IconClose />
				</button>
			{/if}
		</div>
	</div>

	<!-- Motivi di attivazione (Reasons) -->
	{#if occurrence.reasons && occurrence.reasons.length > 0}
		<div class="section-box">
			<span class="section-label">{t('occ_reasons')}</span>
			<div class="reasons-list">
				{#each occurrence.reasons as reason}
					<div class="reason-tag">
						<span class="reason-kind">{t(`trigger_${reason.kind}` as any) || reason.kind}</span>
						{#if reason.branch}
							<span class="reason-detail font-mono">branch: {reason.branch}</span>
						{/if}
						{#if reason.commit}
							<span class="reason-detail font-mono">commit: {reason.commit.slice(0, 7)}</span>
						{/if}
						{#if reason.paths && reason.paths.length > 0}
							<span class="reason-detail">{t('occ_files_modified', { count: reason.paths.length })}</span>
						{/if}
						{#if reason.detail}
							<span class="reason-detail">{reason.detail}</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Lista delle esecuzioni per destinatario -->
	<div class="section-box">
		<span class="section-label">{t('occ_targets', { count: occurrence.executions.length })}</span>
		<div class="executions-grid">
			{#each occurrence.executions as exec}
				{@const target = exec.targets[0]}
				<button
					type="button"
					class="execution-card"
					class:selected={selectedExecutionId === exec.id}
					onclick={() => { selectedExecutionId = exec.id; }}
				>
					<div class="exec-card-top">
						<span class="status-indicator status-{exec.state}"></span>
						<span class="exec-target-name font-medium">{target?.name || target?.path || t('occ_target_default')}</span>
						<span class="exec-state-text text-xs">{t(`exec_${exec.state}` as any) || exec.state}</span>
					</div>
					<div class="exec-card-meta text-xs">
						<span>{formatElapsedDuration(exec.startedAt, exec.finishedAt)}</span>
						{#if exec.exitCode !== null}
							<span class="bullet">·</span>
							<span class="font-mono" class:text-danger={exec.exitCode !== 0}>
								exit {exec.exitCode}
							</span>
						{/if}
						{#if exec.model}
							<span class="bullet">·</span>
							<span class="font-mono">{exec.model}</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Dettaglio esecuzione selezionata -->
	{#if selectedExecution}
		<div class="execution-detail-panel">
			<div class="exec-detail-header">
				<div class="exec-meta-grid text-xs">
					<div class="meta-item">
						<span class="meta-label">{t('occ_target_label')}</span>
						<span class="meta-val font-mono">{selectedExecution.targets.map(t => t.path).join(', ')}</span>
					</div>
					<div class="meta-item">
						<span class="meta-label">{t('occ_start_label')}</span>
						<span class="meta-val">{formatDateTime(selectedExecution.startedAt || 0)}</span>
					</div>
					<div class="meta-item">
						<span class="meta-label">{t('occ_duration_label')}</span>
						<span class="meta-val font-mono">{formatElapsedDuration(selectedExecution.startedAt, selectedExecution.finishedAt)}</span>
					</div>
					{#if selectedExecution.exitCode !== null}
						<div class="meta-item">
							<span class="meta-label">{t('occ_exit_code_label')}</span>
							<span class="meta-val font-mono font-bold" class:text-danger={selectedExecution.exitCode !== 0}>
								{selectedExecution.exitCode}
							</span>
						</div>
					{/if}
					{#if selectedExecution.model}
						<div class="meta-item">
							<span class="meta-label">{t('occ_model_label')}</span>
							<span class="meta-val font-mono">{selectedExecution.model}</span>
						</div>
					{/if}
					{#if selectedExecution.reason}
						<div class="meta-item full">
							<span class="meta-label">{t('occ_reason_status_label')}</span>
							<span class="meta-val">{selectedExecution.reason}</span>
						</div>
					{/if}
				</div>

				<!-- Link sessione disponibile per esecuzioni con sessionId (sia terminati che in attesa) -->
				{#if selectedExecution.sessionId && onOpenSession}
					<div class="session-open-bar">
						<button
							type="button"
							class="ui-button ui-button-secondary text-xs"
							onclick={() => onOpenSession?.(selectedExecution.sessionId!)}
							title={t('occ_btn_open_session')}
						>
							<IconExternalLink />
							<span>{t('occ_btn_open_session')}</span>
						</button>
					</div>
				{/if}
			</div>

			<!-- Richiesta di risposta (needsInput) con deadline e proroga esplicita AUT-044 -->
			{#if selectedExecution.state === 'needsInput'}
				<div class="needs-input-banner" role="alert">
					<div class="input-header">
						<IconAsk />
						<span class="font-semibold">{t('occ_question_label')}</span>
					</div>
					{#if selectedExecution.question}
						<p class="question-text">{selectedExecution.question}</p>
					{/if}
					<div class="deadline-row text-xs">
						<IconSchedule />
						{#if deadlineMs !== null}
							<span>
								{t('occ_deadline_label')} {formatDateTime(deadlineMs)}
								({remainingWaitMinutes > 0 ? t('occ_deadline_remaining', { minutes: remainingWaitMinutes }) : t('occ_deadline_expired')})
							</span>
						{:else}
							<span>{t('occ_deadline_label')} {t('occ_deadline_none')}</span>
						{/if}
						<button
							type="button"
							class="ui-button ui-button-secondary text-xs"
							onclick={() => { showExtendModal = true; }}
						>
							<IconSchedule />
							<span>{t('occ_btn_extend_wait')}</span>
						</button>
					</div>
					<div class="input-actions">
						{#if selectedExecution.sessionId && onOpenSession}
							<button
								type="button"
								class="ui-button ui-button-primary text-xs"
								onclick={() => onOpenSession?.(selectedExecution.sessionId!)}
							>
								<IconExternalLink />
								<span>{t('occ_btn_open_session')}</span>
							</button>
						{/if}
						<button
							type="button"
							class="ui-button ui-button-danger text-xs"
							onclick={handleCancel}
						>
							<IconStop />
							<span>{t('popover_action_stop')}</span>
						</button>
					</div>
				</div>
			{/if}
			<!-- Workflow esito non verificato (unknown) AUT-046, AUT-070, AUT-102 -->
			{#if occurrence.state === 'unknown' || selectedExecution.state === 'unknown'}
				<div class="unknown-outcome-banner" role="alert">
					<div class="input-header">
						<IconWarning />
						<span class="font-semibold">{t('occ_unknown_warning_title')}</span>
					</div>
					<p class="question-text">{t('occ_unknown_warning_desc')}</p>
					<div class="input-actions">
						<button
							type="button"
							class="ui-button ui-button-secondary text-xs"
							onclick={() => { showVerifyUnknownModal = true; }}
						>
							<IconCheck />
							<span>{t('occ_unknown_verify_btn')}</span>
						</button>
						{#if unknownTargets.length > 0}
							<button
								type="button"
								class="ui-button ui-button-primary text-xs"
								onclick={() => { showRetryUnknownModal = true; }}
							>
								<IconRefresh />
								<span>{t('occ_unknown_retry_btn')}</span>
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Risultato AI (se presente) -->
			{#if selectedExecution.result}
				<div class="ai-result-box">
					<div class="result-header-row">
						<span class="result-label">{t('occ_ai_result_label')}</span>
						{#if selectedExecution.sessionId && onOpenSession}
							<button
								type="button"
								class="ui-button ui-button-ghost text-xs session-inline-btn"
								onclick={() => onOpenSession?.(selectedExecution.sessionId!)}
							>
								<IconExternalLink />
								<span>{t('occ_btn_open_session')}</span>
							</button>
						{/if}
					</div>
					<div class="result-text">{selectedExecution.result}</div>
				</div>
			{/if}

			<!-- Output comandi paginato -->
			<AutomationOutputViewer
				executionId={selectedExecution.id}
				outputTruncated={selectedExecution.outputTruncated}
				isRunning={selectedExecution.state === 'running'}
			/>
		</div>
	{/if}
</div>

<!-- Modal Proroga Attesa (AUT-044) -->
{#if showExtendModal}
	<Dialog
		title={t('occ_extend_wait_title')}
		onClose={() => { showExtendModal = false; }}
	>
		<div class="extend-modal-body">
			<p class="dialog-subtitle text-xs" style="margin: -6px 0 12px; color: var(--ink-muted);">
				{t('occ_extend_wait_message')}
			</p>
			{#if extendError}
				<div class="error-banner" style="margin-bottom: 10px; color: var(--danger);">
					<IconWarning /> <span>{extendError}</span>
				</div>
			{/if}
			<div class="preset-buttons">
				<button type="button" class="ui-button ui-button-secondary text-xs" onclick={() => { extendMinutes = 15; }}>+15m</button>
				<button type="button" class="ui-button ui-button-secondary text-xs" onclick={() => { extendMinutes = 30; }}>+30m</button>
				<button type="button" class="ui-button ui-button-secondary text-xs" onclick={() => { extendMinutes = 60; }}>+60m</button>
			</div>
			<div class="field-row" style="margin-top: 10px; display: flex; align-items: center; justify-content: space-between;">
				<label for="ext-mins" class="field-label-text text-xs" style="color: var(--ink);">{t('occ_extend_minutes_label')}</label>
				<input id="ext-mins" type="number" min="1" max="720" class="ui-input text-xs font-mono" style="width: 80px;" bind:value={extendMinutes} />
			</div>
			<div class="modal-footer" style="margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px;">
				<button type="button" class="ui-button ui-button-secondary text-xs" onclick={() => { showExtendModal = false; }}>{t('btn_cancel')}</button>
				<button type="button" class="ui-button ui-button-primary text-xs" onclick={() => void handleExtendWait(extendMinutes)} disabled={isExtending || extendMinutes <= 0}>
					<IconCheck />
					<span>{t('occ_extend_confirm_btn')}</span>
				</button>
			</div>
		</div>
	</Dialog>
{/if}
{#if showVerifyUnknownModal}
	<ConfirmDialog
		title={t('occ_unknown_verify_confirm_title')}
		message={t('occ_unknown_verify_confirm_msg')}
		confirmLabel={t('occ_unknown_verify_btn')}
		cancelLabel={t('btn_cancel')}
		tone="primary"
		onConfirm={handleVerifyUnknown}
		onCancel={() => { showVerifyUnknownModal = false; }}
	/>
{/if}

{#if showRetryUnknownModal}
	<ConfirmDialog
		title={t('occ_unknown_retry_confirm_title')}
		message={t('occ_unknown_retry_confirm_msg', { count: unknownTargets.length })}
		confirmLabel={t('occ_unknown_retry_btn')}
		cancelLabel={t('btn_cancel')}
		tone="primary"
		onConfirm={handleRetryUnknown}
		onCancel={() => { showRetryUnknownModal = false; }}
	/>
{/if}

<style>
	.occurrence-detail {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px;
		background: var(--bg-raised);
		border-radius: var(--radius-lg);
		border: 1px solid var(--line);
	}

	.occurrence-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--line);
	}

	.status-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		font-size: 11px;
		font-weight: 600;
		border-radius: var(--radius-full);
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.status-pill.status-completed {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--success);
	}

	.status-pill.status-running {
		background: color-mix(in srgb, var(--brand) 18%, transparent);
		color: var(--brand-ink);
	}

	.status-pill.status-error,
	.status-pill.status-timeout {
		background: color-mix(in srgb, var(--danger) 15%, transparent);
		color: var(--danger);
	}

	.status-pill.status-needsInput {
		background: color-mix(in srgb, var(--warn) 20%, transparent);
		color: var(--warn);
	}

	.status-pill.status-waiting {
		background: color-mix(in srgb, var(--ink-muted) 15%, transparent);
		color: var(--ink-muted);
	}

	.status-pill.acknowledged {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--success);
	}

	.status-pill.warn {
		background: color-mix(in srgb, var(--warn) 18%, transparent);
		color: var(--warn);
	}

	.occurrence-title {
		font-size: 16px;
		font-weight: 600;
		margin: 0 0 4px;
		color: var(--ink);
	}

	.occurrence-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-muted);
	}

	.bullet {
		opacity: 0.5;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.section-box {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.section-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.reasons-list {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.reason-tag {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		font-size: 12px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
	}

	.reason-kind {
		font-weight: 600;
		color: var(--ink);
	}

	.reason-detail {
		color: var(--ink-muted);
	}

	.executions-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 8px;
	}

	.execution-card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-base);
		text-align: left;
		cursor: pointer;
		transition: border-color var(--dur-fast, 120ms) ease, background var(--dur-fast, 120ms) ease;
	}

	.execution-card:hover {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.execution-card.selected {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-base));
	}

	.exec-card-top {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.status-indicator {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ink-muted);
		flex-shrink: 0;
	}

	.status-indicator.status-completed { background: var(--success); }
	.status-indicator.status-running { background: var(--brand-ink); }
	.status-indicator.status-error,
	.status-indicator.status-timeout { background: var(--danger); }
	.status-indicator.status-needsInput { background: var(--warn); }
	.status-indicator.status-waiting { background: var(--ink-muted); }

	.exec-target-name {
		font-size: 13px;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.exec-state-text {
		color: var(--ink-muted);
	}

	.exec-card-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-muted);
	}

	.execution-detail-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 8px;
		border-top: 1px solid var(--line);
	}

	.exec-meta-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 8px 16px;
		padding: 10px 14px;
		background: var(--bg-sunken);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
	}

	.meta-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.meta-item.full {
		grid-column: 1 / -1;
	}

	.meta-label {
		color: var(--ink-muted);
	}

	.meta-val {
		color: var(--ink);
		word-break: break-all;
	}

	.session-open-bar {
		display: flex;
		justify-content: flex-end;
		margin-top: 6px;
	}

	.needs-input-banner {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.input-header {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--warn);
		font-size: 13px;
	}

	.question-text {
		margin: 0;
		font-size: 13px;
		color: var(--ink);
		line-height: 1.5;
	}

	.deadline-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		color: var(--ink-muted);
		background: var(--bg-sunken);
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		margin: 4px 0;
	}

	.input-actions {
		display: flex;
		gap: 8px;
		margin-top: 4px;
	}

	.extend-modal-body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 320px;
	}

	.preset-buttons {
		display: flex;
		gap: 8px;
	}

	.ai-result-box {
		padding: 10px 14px;
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		font-size: 13px;
		line-height: 1.5;
	}

	.result-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}

	.result-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--ink-muted);
		display: block;
	}

	.session-inline-btn {
		font-size: 11px;
		padding: 2px 6px;
	}

	.result-text {
		color: var(--ink);
		white-space: pre-wrap;
	}

	.text-danger {
		color: var(--danger);
	}
	.unknown-outcome-banner {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--warn) 10%, var(--bg-sunken));
		border: 1px solid var(--warn);
	}
</style>
