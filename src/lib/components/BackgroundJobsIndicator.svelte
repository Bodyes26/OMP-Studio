<script lang="ts">
	/**
	 * Indicatore dei processi in background nella barra di stato (statusbar).
	 *
	 * Mostra lo stato aggregato della coda seriale (in esecuzione, in attesa,
	 * in pausa). Al clic apre un popover ancorato in alto a destra con il dettaglio
	 * del task corrente, l'elenco dei job con i relativi motivi di pausa e le azioni
	 * rapide di interruzione, pausa/ripresa, avvio immediato e collegamento alle impostazioni.
	 */
	import {
		backgroundJobs,
		type BackgroundJobId,
		type BackgroundJobView
	} from '#lib/stores/backgroundJobs.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { m } from '#lib/paraglide/messages.js';
	import { anchoredPopover } from '#lib/anchoredPopover.ts';
	import { formatRelativeTime } from '#lib/agent/sessionModes.ts';
	import { rvLift, badgeReveal } from '#lib/agent/motion.ts';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import {
		IconJobs,
		IconPlay,
		IconPause,
		IconStop,
		IconRefresh,
		IconSettings,
		IconClose,
		IconWarning
	} from '#lib/icons.ts';

	let open = $state(false);
	let triggerBtnEl = $state<HTMLButtonElement | null>(null);
	let popoverEl = $state<HTMLDivElement | null>(null);
	let now = $state(Date.now());

	const isManagerEnabled = $derived(settingsStore.backgroundJobs?.enabled ?? true);
	const activeCount = $derived(backgroundJobs.activeCount ?? 0);
	const runningJob = $derived(backgroundJobs.running);
	const isRunning = $derived(runningJob !== null);
	const allPaused = $derived(backgroundJobs.allPaused ?? false);
	const views = $derived(backgroundJobs.views ?? []);

	const hasQuotaFloorPause = $derived(
		views.some((v) => v.paused === 'quotaFloor')
	);

	// Timer di aggiornamento per durate e tempi trascorsi
	$effect(() => {
		if (open || isRunning) {
			now = Date.now();
			const timer = setInterval(() => {
				now = Date.now();
			}, 1000);
			return () => clearInterval(timer);
		}
	});

	function togglePopover() {
		open = !open;
	}

	function close() {
		if (!open) return;
		open = false;
		triggerBtnEl?.focus();
	}

	function handleTriggerKeyDown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open = true;
		}
	}

	function handlePopoverKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
		}
	}

	function handleFocusOut(e: FocusEvent) {
		const related = e.relatedTarget as Node | null;
		if (!popoverEl?.contains(related) && !triggerBtnEl?.contains(related)) {
			open = false;
		}
	}

	// Chiusura al click esterno fuori da popover e trigger
	$effect(() => {
		if (!open) return;
		const handlePointerDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (!target) return;
			if (popoverEl?.contains(target) || triggerBtnEl?.contains(target)) {
				return;
			}
			open = false;
		};
		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
		};
	});

	function jobName(id: BackgroundJobId): string {
		switch (id) {
			case 'taskTitles':
				return m.settings_background_jobs_task_titles_title();
			case 'sessionTitles':
				return m.settings_background_jobs_session_titles_title();
			case 'sessionIndex':
				return m.settings_background_jobs_session_index_title();
			case 'gitFetch':
				return m.settings_background_jobs_git_fetch_title();
			case 'updateCheck':
				return m.settings_background_jobs_update_check_title();
			default:
				return id;
		}
	}

	function formatElapsed(startedAt: number): string {
		const diffSec = Math.max(0, Math.floor((now - startedAt) / 1000));
		if (diffSec < 60) return `${diffSec}s`;
		const min = Math.floor(diffSec / 60);
		const remSec = diffSec % 60;
		return `${min}m ${remSec}s`;
	}

	function formatLastRun(lastRun: { at: number; ok: boolean; detail?: string }): string {
		if (!lastRun.ok) {
			if (lastRun.detail === 'cancelled') return m.bg_jobs_popover_last_run_cancelled();
			return m.bg_jobs_popover_last_run_failed({ detail: lastRun.detail || 'error' });
		}
		return m.bg_jobs_popover_last_run({ time: formatRelativeTime(lastRun.at, now) });
	}

	const tooltipText = $derived.by(() => {
		if (isRunning && runningJob?.running) {
			return `${jobName(runningJob.id)}: ${runningJob.running.label}`;
		}
		if (allPaused) {
			return m.bg_jobs_indicator_paused_aria();
		}
		if (activeCount > 0) {
			return m.bg_jobs_indicator_active_aria({ count: activeCount });
		}
		return m.bg_jobs_indicator_idle_aria();
	});
</script>

{#if isManagerEnabled}
	<Tooltip text={tooltipText} disabled={open} placement="top" offset={6}>
		<button
			bind:this={triggerBtnEl}
			type="button"
			class="version-btn jobs-indicator-btn"
			class:has-running={isRunning}
			class:is-paused={allPaused}
			class:active={open}
			aria-expanded={open}
			aria-haspopup="dialog"
			aria-label={m.bg_jobs_indicator_title()}
			onclick={togglePopover}
			onkeydown={handleTriggerKeyDown}
		>
			{#if isRunning}
				<span class="btn-spinner" transition:badgeReveal={{ duration: 160, blur: 2 }}>
					<StatusMark status="running" active={true} />
				</span>
			{:else if allPaused}
				<span class="status-glyph paused" aria-hidden="true"><IconPause /></span>
			{:else}
				<span class="status-glyph" aria-hidden="true"><IconJobs /></span>
			{/if}
			<span class="version-label">{m.bg_jobs_indicator_title()}</span>
			{#if activeCount > 0}
				<span
					class="update-chip"
					class:info={!allPaused}
					class:warn={allPaused}
					transition:badgeReveal
				>
					<span class="chip-text">{activeCount}</span>
				</span>
			{/if}
		</button>
	</Tooltip>

	{#if open}
		<div
			bind:this={popoverEl}
			class="jobs-popover rv-lift"
			role="dialog"
			tabindex="-1"
			aria-label={m.bg_jobs_popover_heading()}
			popover="manual"
			use:anchoredPopover={{
				anchor: triggerBtnEl,
				placement: 'top-end',
				offset: 8,
				constrainHeight: true,
				motion: true
			}}
			transition:rvLift={{ blur: 3 }}
			onkeydown={handlePopoverKeyDown}
			onfocusout={handleFocusOut}
		>
			<!-- Testata popover con comandi globali -->
			<div class="popover-header">
				<div class="header-left">
					<span class="header-icon" aria-hidden="true"><IconJobs /></span>
					<h3 class="popover-title">{m.bg_jobs_popover_heading()}</h3>
					{#if activeCount > 0}
						<span class="ui-count tabular">{activeCount}</span>
					{/if}
				</div>

				<div class="header-actions">
					{#if allPaused}
						<Tooltip text={m.bg_jobs_popover_resume_all()} placement="top">
							<button
								type="button"
								class="ui-button ui-button-secondary action-sm"
								onclick={() => backgroundJobs.resumeAll()}
							>
								<IconPlay />
								<span>{m.bg_jobs_popover_resume_all()}</span>
							</button>
						</Tooltip>
					{:else}
						<Tooltip text={m.bg_jobs_popover_pause_all()} placement="top">
							<button
								type="button"
								class="ui-button ui-button-secondary action-sm"
								onclick={() => backgroundJobs.pauseAll()}
							>
								<IconPause />
								<span>{m.bg_jobs_popover_pause_all()}</span>
							</button>
						</Tooltip>
					{/if}

					<Tooltip text={m.bg_jobs_popover_settings_link()} placement="top">
						<button
							type="button"
							class="ui-button ui-button-ghost icon-only-btn"
							aria-label={m.bg_jobs_popover_settings_link()}
							onclick={() => {
								close();
								settingsStore.openSection('backgroundJobs');
							}}
						>
							<IconSettings />
						</button>
					</Tooltip>

					<Tooltip text={m.bg_jobs_popover_close()} placement="top">
						<button
							type="button"
							class="ui-button ui-button-ghost icon-only-btn"
							aria-label={m.bg_jobs_popover_close()}
							onclick={close}
						>
							<IconClose />
						</button>
					</Tooltip>
				</div>
			</div>

			<!-- Task attualmente in esecuzione -->
			{#if runningJob && runningJob.running}
				<div class="current-card">
					<div class="current-top">
						<div class="current-title-wrap">
							<StatusMark status="running" active={true} />
							<span class="current-job-name">{jobName(runningJob.id)}</span>
						</div>
						<span class="current-elapsed font-mono tabular">
							{m.bg_jobs_popover_elapsed({ time: formatElapsed(runningJob.running.startedAt) })}
						</span>
					</div>
					<div class="current-bottom">
						<span class="current-label" title={runningJob.running.label}>
							{runningJob.running.label}
						</span>
						<button
							type="button"
							class="ui-button ui-button-danger cancel-btn"
							onclick={() => backgroundJobs.cancelCurrent()}
						>
							<IconStop />
							<span>{m.bg_jobs_popover_cancel_current()}</span>
						</button>
					</div>
				</div>
			{:else}
				<div class="idle-card">
					<StatusMark status="pending" />
					<span class="idle-text">{m.bg_jobs_popover_no_running()}</span>
				</div>
			{/if}

			<!-- Avviso quota floor se attiva -->
			{#if hasQuotaFloorPause}
				<div class="quota-warning-banner">
					<span class="warning-icon" aria-hidden="true"><IconWarning /></span>
					<span class="warning-text">{m.bg_jobs_popover_quota_warning()}</span>
				</div>
			{/if}

			<!-- Elenco per job -->
			<div class="jobs-list">
				{#each views as view (view.id)}
					{@const isCurrent = runningJob?.id === view.id}
					<div class="job-row" class:is-running={isCurrent} class:is-paused={Boolean(view.paused)}>
						<div class="job-info">
							<div class="job-header-line">
								<span class="job-name">{jobName(view.id)}</span>
								{#if isCurrent}
									<span class="status-badge running">{m.bg_jobs_popover_current_running()}</span>
								{:else if view.paused === 'globalOff'}
									<span class="status-badge faint">{m.bg_jobs_popover_reason_global_off()}</span>
								{:else if view.paused === 'disabled'}
									<span class="status-badge faint">{m.bg_jobs_popover_reason_disabled()}</span>
								{:else if view.paused === 'userPaused'}
									<span class="status-badge warn">{m.bg_jobs_popover_reason_user_paused()}</span>
								{:else if view.paused === 'quotaFloor'}
									<span class="status-badge warn">
										{m.bg_jobs_popover_reason_quota_floor({
											provider: view.quota?.provider ?? '',
											pct: view.quota?.remainingPct ?? 0
										})}
									</span>
								{:else if view.pending > 0}
									<span class="ui-count tabular">
										{m.bg_jobs_popover_pending_count({ count: view.pending })}
									</span>
								{/if}
							</div>

							<div class="job-meta-line">
								{#if !isCurrent && view.lastRun}
									<span class="last-run" class:error={!view.lastRun.ok}>
										{formatLastRun(view.lastRun)}
									</span>
								{:else if !isCurrent && !view.paused && view.pending === 0}
									<span class="last-run faint">{m.bg_jobs_popover_last_run_never()}</span>
								{/if}
							</div>
						</div>

						<div class="job-actions">
							{#if view.paused === 'userPaused'}
								<Tooltip text={m.bg_jobs_popover_resume_job()} placement="top">
									<button
										type="button"
										class="row-action-btn"
										aria-label={`${m.bg_jobs_popover_resume_job()} ${jobName(view.id)}`}
										onclick={() => backgroundJobs.resumeJob(view.id)}
									>
										<IconPlay />
									</button>
								</Tooltip>
							{:else if view.enabled && !view.paused}
								<Tooltip text={m.bg_jobs_popover_pause_job()} placement="top">
									<button
										type="button"
										class="row-action-btn"
										aria-label={`${m.bg_jobs_popover_pause_job()} ${jobName(view.id)}`}
										onclick={() => backgroundJobs.pauseJob(view.id)}
									>
										<IconPause />
									</button>
								</Tooltip>
							{/if}

							<Tooltip text={m.bg_jobs_popover_run_now()} placement="top">
								<button
									type="button"
									class="row-action-btn"
									disabled={!view.enabled || view.paused === 'globalOff' || view.paused === 'quotaFloor'}
									aria-label={`${m.bg_jobs_popover_run_now()} ${jobName(view.id)}`}
									onclick={() => backgroundJobs.runNow(view.id)}
								>
									<IconRefresh />
								</button>
							</Tooltip>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
{/if}

<style>
	.jobs-indicator-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.status-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-faint);
		--icon-size: 13px;
	}

	.status-glyph.paused {
		color: var(--warn);
	}

	.jobs-indicator-btn.has-running {
		color: var(--ink);
	}

	.jobs-indicator-btn.is-paused {
		color: var(--warn);
	}

	/* Popover ancorato nel top layer */
	.jobs-popover {
		position: fixed;
		inset: auto;
		width: 380px;
		max-height: 480px;
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		overflow-y: auto;
		z-index: var(--z-dialog);
		outline: none;
		user-select: none;
	}

	.popover-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.header-icon {
		display: inline-flex;
		align-items: center;
		color: var(--ink-muted);
		--icon-size: 15px;
	}

	.popover-title {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.action-sm {
		height: 24px;
		padding: 0 8px;
		font-size: 11px;
		gap: 4px;
		display: inline-flex;
		align-items: center;
		--icon-size: 12px;
	}

	.icon-only-btn {
		width: 24px;
		height: 24px;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		--icon-size: 14px;
	}

	/* Card in esecuzione */
	.current-card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.current-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.current-title-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.current-job-name {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.current-elapsed {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.current-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.current-label {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.cancel-btn {
		height: 22px;
		padding: 0 6px;
		font-size: 11px;
		gap: 4px;
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		--icon-size: 11px;
	}

	/* Stato inattivo */
	.idle-card {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.idle-text {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	/* Avviso quota */
	.quota-warning-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in oklch, var(--warn) 10%, transparent);
		border: 1px solid color-mix(in oklch, var(--warn) 25%, transparent);
		color: var(--warn);
		font-size: 11.5px;
		line-height: 1.35;
	}

	.warning-icon {
		display: inline-flex;
		flex-shrink: 0;
		--icon-size: 14px;
	}

	/* Elenco dei job */
	.jobs-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.job-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 6px var(--space-2);
		border-radius: var(--radius-md);
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.job-row:hover {
		background: var(--bg-hover);
	}

	.job-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.job-header-line {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.job-name {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status-badge {
		font-size: 10.5px;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.status-badge.running {
		background: color-mix(in oklch, var(--brand) 15%, transparent);
		color: var(--brand-ink);
	}

	.status-badge.warn {
		background: color-mix(in oklch, var(--warn) 15%, transparent);
		color: var(--warn);
	}

	.status-badge.faint {
		background: var(--bg-sunken);
		color: var(--ink-faint);
	}

	.job-meta-line {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.last-run {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.last-run.error {
		color: var(--danger);
	}

	.job-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.row-action-btn {
		width: 24px;
		height: 24px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
		--icon-size: 13px;
	}

	.row-action-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.row-action-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.tabular {
		font-variant-numeric: tabular-nums;
	}
</style>
