<script lang="ts">
	/**
	 * Sezione Impostazioni: Processi in background.
	 *
	 * Governa l'attivazione globale della coda seriale in background, la soglia di
	 * sicurezza della quota per i modelli con abbonamento/rate limit, e i singoli
	 * job con eventuale modello AI dedicato (con fallback sul ruolo smol).
	 */
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
	import type { BackgroundJobId } from '#lib/stores/backgroundJobs.svelte.ts';
	import { m } from '#lib/paraglide/messages.js';
	import Switch from '#lib/ui/Switch.svelte';
	import Slider from '#lib/ui/Slider.svelte';
	import ModelField from '#lib/components/models/ModelField.svelte';

	// Assicura il caricamento del catalogo dei modelli all'apertura della sezione
	$effect(() => {
		void modelSettingsStore.ensureLoaded();
	});

	const catalog = $derived(
		modelSettingsStore.assignableCatalog.length > 0
			? modelSettingsStore.assignableCatalog
			: modelSettingsStore.catalog
	);

	interface JobMeta {
		id: BackgroundJobId;
		usesAi: boolean;
		title: () => string;
		description: () => string;
	}

	const JOB_CONFIGS: JobMeta[] = [
		{
			id: 'taskTitles',
			usesAi: true,
			title: () => m.settings_background_jobs_task_titles_title(),
			description: () => m.settings_background_jobs_task_titles_desc()
		},
		{
			id: 'sessionTitles',
			usesAi: true,
			title: () => m.settings_background_jobs_session_titles_title(),
			description: () => m.settings_background_jobs_session_titles_desc()
		},
		{
			id: 'sessionIndex',
			usesAi: false,
			title: () => m.settings_background_jobs_session_index_title(),
			description: () => m.settings_background_jobs_session_index_desc()
		},
		{
			id: 'gitFetch',
			usesAi: false,
			title: () => m.settings_background_jobs_git_fetch_title(),
			description: () => m.settings_background_jobs_git_fetch_desc()
		},
		{
			id: 'updateCheck',
			usesAi: false,
			title: () => m.settings_background_jobs_update_check_title(),
			description: () => m.settings_background_jobs_update_check_desc()
		}
	];

	const bgSettings = $derived(
		settingsStore.backgroundJobs ?? {
			enabled: true,
			quotaFloorPct: 30,
			jobs: {}
		}
	);

	const isGlobalEnabled = $derived(bgSettings.enabled ?? true);
	const quotaFloor = $derived(bgSettings.quotaFloorPct ?? 30);
	const jobs = $derived(bgSettings.jobs ?? {});

	function handleReset() {
		settingsStore.reset('backgroundJobs');
	}
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>{m.settings_background_jobs_title()}</h4>
		<button type="button" class="ui-button ui-button-secondary" onclick={handleReset}>
			{m.settings_section_reset()}
		</button>
	</div>

	<!-- Interruttore generale e soglia quota -->
	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<label for="bg-global-switch" id="bg-global-switch-label" class="form-row-label">
					{m.settings_background_jobs_global_enable_label()}
				</label>
				<span id="bg-global-switch-desc" class="form-row-desc">
					{m.settings_background_jobs_global_enable_desc()}
				</span>
			</div>
			<div class="form-row-control">
				<Switch
					id="bg-global-switch"
					checked={isGlobalEnabled}
					ariaLabelledBy="bg-global-switch-label"
					ariaDescribedBy="bg-global-switch-desc"
					onChange={(val) => settingsStore.updateBackgroundJobs({ enabled: val })}
				/>
			</div>
		</div>

		<div class="form-row quota-row">
			<div class="form-row-copy">
				<div class="label-with-value">
					<label for="bg-quota-floor" id="bg-quota-floor-label" class="form-row-label">
						{m.settings_background_jobs_quota_floor_label()}
					</label>
					<span class="ui-count tabular font-mono">{quotaFloor}%</span>
				</div>
				<span id="bg-quota-floor-desc" class="form-row-desc">
					{m.settings_background_jobs_quota_floor_desc()}
				</span>
			</div>
			<div class="form-row-control slider-control">
				<Slider
					min={0}
					max={90}
					step={5}
					value={quotaFloor}
					valueText={`${quotaFloor}%`}
					disabled={!isGlobalEnabled}
					ariaLabelledBy="bg-quota-floor-label"
					ariaDescribedBy="bg-quota-floor-desc"
					onChange={(val) => settingsStore.updateBackgroundJobs({ quotaFloorPct: val })}
				/>
			</div>
		</div>
	</div>

	<!-- Righe per singolo job -->
	<div class="section-group">
		{#each JOB_CONFIGS as job (job.id)}
			{@const jobState = jobs[job.id] ?? { enabled: true, model: '' }}
			{@const jobEnabled = jobState.enabled ?? true}
			{@const jobModel = jobState.model ?? ''}
			<div class="job-item" class:disabled={!isGlobalEnabled}>
				<div class="form-row">
					<div class="form-row-copy">
						<label for={`bg-job-${job.id}`} id={`bg-job-${job.id}-label`} class="form-row-label">
							{job.title()}
						</label>
						<span id={`bg-job-${job.id}-desc`} class="form-row-desc">
							{job.description()}
						</span>
					</div>
					<div class="form-row-control">
						<Switch
							id={`bg-job-${job.id}`}
							checked={jobEnabled}
							disabled={!isGlobalEnabled}
							ariaLabelledBy={`bg-job-${job.id}-label`}
							ariaDescribedBy={`bg-job-${job.id}-desc`}
							onChange={(val) => settingsStore.updateBackgroundJob(job.id, { enabled: val })}
						/>
					</div>
				</div>

				{#if job.usesAi}
					<div class="job-model-row" class:dimmed={!isGlobalEnabled || !jobEnabled}>
						<div class="model-row-copy">
							<span class="model-row-label">{m.settings_background_jobs_model_label()}</span>
							<span class="model-row-desc">{m.settings_background_jobs_model_desc()}</span>
						</div>
						<div class="model-row-control">
							<ModelField
								{catalog}
								value={jobModel}
								emptyOption={{ label: m.settings_background_jobs_model_smol_default(), value: '' }}
								placeholder={m.settings_background_jobs_model_smol_default()}
								ariaLabel={`${job.title()} · ${m.settings_background_jobs_model_label()}`}
								disabled={!isGlobalEnabled || !jobEnabled}
								onSelect={(selector) => settingsStore.updateBackgroundJob(job.id, { model: selector })}
							/>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.section-group {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.form-row:last-child {
		border-bottom: none;
	}

	.form-row-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.form-row-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.label-with-value {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.tabular {
		font-variant-numeric: tabular-nums;
	}

	.slider-control {
		width: 200px;
		flex-shrink: 0;
	}

	.job-item {
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--line);
		transition: opacity var(--dur-fast) var(--ease-out);
	}

	.job-item:last-child {
		border-bottom: none;
	}

	.job-item.disabled {
		opacity: 0.6;
	}

	.job-item .form-row {
		border-bottom: none;
	}

	.job-model-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: 0 var(--space-3) var(--space-3) calc(var(--space-3) + 12px);
		transition: opacity var(--dur-fast) var(--ease-out);
	}

	.job-model-row.dimmed {
		opacity: 0.45;
		pointer-events: none;
	}

	.model-row-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.model-row-label {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.model-row-desc {
		font-size: 11px;
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.model-row-control {
		width: 260px;
		flex-shrink: 0;
	}
</style>
