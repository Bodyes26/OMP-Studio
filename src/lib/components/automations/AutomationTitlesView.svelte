<script lang="ts">
	import {
		backgroundJobs,
		getMissingSessionTitlesCount,
		previewSessionTitlesBackfill,
		startSessionTitlesBackfill
	} from '#lib/stores/backgroundJobs.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { t } from '#lib/automations/i18n.ts';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import {
		IconSparkles,
		IconPlay,
		IconPause,
		IconRefresh,
		IconWarning,
		IconCheck,
		IconQuota,
		IconSchedule,
		IconStop
	} from '#lib/icons.ts';

	let missingSessionCount = $state<number | null>(null);
	let isCheckingMissing = $state(false);
	let isBackfilling = $state(false);
	let backfillSuccessMsg = $state<string | null>(null);
	let backfillError = $state<string | null>(null);

	const views = $derived(backgroundJobs.views || []);
	const taskTitleJob = $derived(views.find((v) => v.id === 'taskTitles'));
	const sessionTitleJob = $derived(views.find((v) => v.id === 'sessionTitles'));

	const runningJob = $derived(backgroundJobs.running);
	const isTitleRunning = $derived(
		runningJob?.id === 'taskTitles' || runningJob?.id === 'sessionTitles'
	);

	async function checkMissingSessions() {
		isCheckingMissing = true;
		backfillError = null;
		backfillSuccessMsg = null;
		try {
			const res = await previewSessionTitlesBackfill();
			missingSessionCount = res.count;
		} catch (err) {
			backfillError = err instanceof Error ? err.message : String(err);
		} finally {
			isCheckingMissing = false;
		}
	}

	async function startBackfill() {
		isBackfilling = true;
		backfillError = null;
		backfillSuccessMsg = null;
		try {
			const res = await startSessionTitlesBackfill();
			backfillSuccessMsg = `Avviata generazione per ${res.queued} sessioni.`;
			missingSessionCount = 0;
		} catch (err) {
			backfillError = err instanceof Error ? err.message : String(err);
		} finally {
			isBackfilling = false;
		}
	}

	function toggleJob(jobId: string, currentPaused: boolean) {
		if (currentPaused) {
			backgroundJobs.resumeJob(jobId as any);
		} else {
			backgroundJobs.pauseJob(jobId as any);
		}
	}
</script>

<div class="titles-view-container">
	<!-- Intestazione informativa -->
	<div class="titles-header">
		<div class="title-with-icon">
			<span class="icon-wrap"><IconSparkles /></span>
			<div>
				<h3 class="section-heading">{t('titles_heading')}</h3>
				<p class="section-desc text-xs">{t('titles_desc')}</p>
			</div>
		</div>
	</div>

	<!-- Stato generale quota Titoli AI (AUT-029/031: riserva 30%/30%) -->
	<div class="quota-card">
		<div class="quota-card-header">
			<IconQuota />
			<span class="card-title-text">{t('titles_quota_status')}</span>
		</div>
		<p class="text-xs text-muted" style="margin: 0 0 10px;">
			La generazione dei titoli viene sospesa automaticamente per non consumare la quota necessaria al lavoro interattivo se il residuo scende sotto il 30% nella finestra breve (5h) o settimanale.
		</p>

		{#if taskTitleJob?.paused === 'quotaFloor' || sessionTitleJob?.paused === 'quotaFloor'}
			<div class="quota-alert warn">
				<IconWarning />
				<span class="text-xs">
					{t('titles_quota_blocked', {
						provider: taskTitleJob?.quota?.provider || 'AI Provider',
						pct: taskTitleJob?.quota?.remainingPct ?? 24
					})}
				</span>
			</div>
		{:else}
			<div class="quota-alert ok">
				<IconCheck />
				<span class="text-xs">{t('titles_quota_ok')}</span>
			</div>
		{/if}
	</div>

	<!-- Job automatici titoli: Task e Sessioni -->
	<div class="jobs-list">
		<!-- Titoli dei Task -->
		{#if taskTitleJob}
			<div class="title-job-row" class:is-running={runningJob?.id === taskTitleJob.id}>
				<div class="job-meta">
					<div class="job-name-line">
						<StatusMark status={taskTitleJob.running ? 'running' : taskTitleJob.paused ? 'pending' : 'completed'} />
						<span class="job-name font-medium">Titoli automatici dei task</span>
						{#if taskTitleJob.running}
							<span class="status-chip running">{t('exec_running')}</span>
						{:else if taskTitleJob.paused}
							<span class="status-chip paused">In pausa ({taskTitleJob.paused})</span>
						{:else}
							<span class="status-chip ok">Attivo</span>
						{/if}
					</div>
					<div class="job-sub text-xs text-muted">
						Generato dopo il salvataggio con 2s di quiete. I titoli modificati manualmente vengono preservati.
					</div>
				</div>
				<div class="job-actions">
					{#if taskTitleJob.running}
						<button
							type="button"
							class="ui-button ui-button-danger text-xs"
							onclick={() => backgroundJobs.cancelCurrent()}
						>
							<IconStop />
							<span>{t('popover_action_stop')}</span>
						</button>
					{:else}
						<button
							type="button"
							class="ui-button ui-button-secondary text-xs"
							onclick={() => toggleJob(taskTitleJob.id, Boolean(taskTitleJob.paused))}
						>
							{#if taskTitleJob.paused}
								<IconPlay />
								<span>Riprendi</span>
							{:else}
								<IconPause />
								<span>Pausa</span>
							{/if}
						</button>
						<button
							type="button"
							class="ui-button ui-button-ghost text-xs"
							onclick={() => backgroundJobs.runNow(taskTitleJob.id)}
							title="Esegui subito il controllo della coda task"
						>
							<IconRefresh />
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Titoli delle Sessioni -->
		{#if sessionTitleJob}
			<div class="title-job-row" class:is-running={runningJob?.id === sessionTitleJob.id}>
				<div class="job-meta">
					<div class="job-name-line">
						<StatusMark status={sessionTitleJob.running ? 'running' : sessionTitleJob.paused ? 'pending' : 'completed'} />
						<span class="job-name font-medium">Titoli delle nuove sessioni chat</span>
						{#if sessionTitleJob.running}
							<span class="status-chip running">{t('exec_running')}</span>
						{:else if sessionTitleJob.paused}
							<span class="status-chip paused">In pausa ({sessionTitleJob.paused})</span>
						{:else}
							<span class="status-chip ok">Attivo</span>
						{/if}
					</div>
					<div class="job-sub text-xs text-muted">
						Generato al termine del primo turno della sessione. Nessun recupero massivo automatico dello storico.
					</div>
				</div>
				<div class="job-actions">
					{#if sessionTitleJob.running}
						<button
							type="button"
							class="ui-button ui-button-danger text-xs"
							onclick={() => backgroundJobs.cancelCurrent()}
						>
							<IconStop />
							<span>{t('popover_action_stop')}</span>
						</button>
					{:else}
						<button
							type="button"
							class="ui-button ui-button-secondary text-xs"
							onclick={() => toggleJob(sessionTitleJob.id, Boolean(sessionTitleJob.paused))}
						>
							{#if sessionTitleJob.paused}
								<IconPlay />
								<span>Riprendi</span>
							{:else}
								<IconPause />
								<span>Pausa</span>
							{/if}
						</button>
						<button
							type="button"
							class="ui-button ui-button-ghost text-xs"
							onclick={() => backgroundJobs.runNow(sessionTitleJob.id)}
							title="Esegui subito"
						>
							<IconRefresh />
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- Sezione recupero manuale dello storico (AUT-094: esplicito con anteprima) -->
	<div class="backfill-card">
		<h4 class="card-title">{t('titles_backfill_heading')}</h4>
		<p class="text-xs text-muted" style="margin: 0 0 12px;">
			{t('titles_backfill_desc')}
		</p>

		<div class="backfill-actions">
			<button
				type="button"
				class="ui-button ui-button-secondary text-xs"
				onclick={checkMissingSessions}
				disabled={isCheckingMissing}
			>
				<IconRefresh />
				<span>{t('titles_backfill_btn_preview')}</span>
			</button>

			{#if missingSessionCount !== null}
				<span class="missing-count-text text-xs">
					{t('titles_backfill_missing_count', { count: missingSessionCount })}
				</span>

				{#if missingSessionCount > 0}
					<button
						type="button"
						class="ui-button ui-button-primary text-xs"
						onclick={startBackfill}
						disabled={isBackfilling}
					>
						<IconPlay />
						<span>{t('titles_backfill_btn_start')}</span>
					</button>
				{/if}
			{/if}
		</div>

		{#if backfillSuccessMsg}
			<div class="status-msg success text-xs">
				<IconCheck />
				<span>{backfillSuccessMsg}</span>
			</div>
		{/if}

		{#if backfillError}
			<div class="status-msg error text-xs">
				<IconWarning />
				<span>{backfillError}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.titles-view-container {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px;
		height: 100%;
		overflow-y: auto;
	}

	.titles-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		border-bottom: 1px solid var(--line);
		padding-bottom: 14px;
	}

	.title-with-icon {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}

	.icon-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--brand) 16%, transparent);
		color: var(--brand-ink);
		flex-shrink: 0;
	}

	.section-heading {
		font-size: 16px;
		font-weight: 600;
		margin: 0 0 4px;
		color: var(--ink);
	}

	.section-desc {
		margin: 0;
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.quota-card,
	.backfill-card {
		padding: 14px 16px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.quota-card-header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		margin-bottom: 6px;
	}

	.card-title {
		margin: 0 0 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
	}

	.quota-alert {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: var(--radius-sm);
	}

	.quota-alert.ok {
		background: color-mix(in srgb, var(--success) 12%, transparent);
		color: var(--success);
		border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
	}

	.quota-alert.warn {
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		color: var(--warn);
		border: 1px solid color-mix(in srgb, var(--warn) 25%, transparent);
	}

	.jobs-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.title-job-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		gap: 16px;
	}

	.title-job-row.is-running {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 8%, var(--bg-raised));
	}

	.job-meta {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.job-name-line {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.job-name {
		font-size: 13px;
		color: var(--ink);
	}

	.status-chip {
		font-size: 11px;
		padding: 1px 6px;
		border-radius: var(--radius-full);
		font-weight: 500;
	}

	.status-chip.ok { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
	.status-chip.running { background: color-mix(in srgb, var(--brand) 18%, transparent); color: var(--brand-ink); }
	.status-chip.paused { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }

	.job-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.backfill-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.missing-count-text {
		color: var(--ink);
		font-weight: 500;
	}

	.status-msg {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		padding: 6px 10px;
		border-radius: var(--radius-sm);
	}

	.status-msg.success {
		background: color-mix(in srgb, var(--success) 12%, transparent);
		color: var(--success);
	}

	.status-msg.error {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		color: var(--danger);
	}

	.text-muted {
		color: var(--ink-muted);
	}
</style>
