<script lang="ts">
	/**
	 * Sezione Impostazioni: Titoli AI e Processi in background (AUT-000, AUT-029–032, AUT-090, AUT-093, AUT-094).
	 *
	 * - La manutenzione ordinaria (sessionIndex, gitFetch, updateCheck) continua sempre
	 *   internamente e non viene mostrata qui (AUT-000, AUT-090).
	 * - Qui si configurano solo i titoli AI (task e sessioni), con riserve di quota
	 *   distinte per finestra (breve e settimanale, default 30%), finestra di quiete task (default 2s)
	 *   e backfill manuale con anteprima numeri per la cronologia delle sessioni.
	 */
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
	import {
		type BackgroundJobId,
		getMissingSessionTitlesCount,
		startSessionTitlesBackfill
	} from '#lib/stores/backgroundJobs.svelte.ts';
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

	// AUT-000 / AUT-090: solo taskTitles e sessionTitles gestibili dall'utente
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
		}
	];

	const bgSettings = $derived(
		settingsStore.backgroundJobs ?? {
			enabled: true,
			quotaFloorPct: 30,
			quotaShortPct: 30,
			quotaWeeklyPct: 30,
			quotaOtherPct: 30,
			taskTitleQuietSeconds: 2,
			jobs: {}
		}
	);

	const isGlobalEnabled = $derived(bgSettings.enabled ?? true);
	const quotaShort = $derived(bgSettings.quotaShortPct ?? bgSettings.quotaFloorPct ?? 30);
	const quotaWeekly = $derived(bgSettings.quotaWeeklyPct ?? bgSettings.quotaFloorPct ?? 30);
	const taskQuiet = $derived(bgSettings.taskTitleQuietSeconds ?? 2);
	const jobs = $derived(bgSettings.jobs ?? {});

	let missingSessionCount = $state<number | null>(null);
	let isBackfilling = $state(false);

	async function refreshMissingCount() {
		try {
			missingSessionCount = await getMissingSessionTitlesCount();
		} catch {
			missingSessionCount = 0;
		}
	}

	$effect(() => {
		void refreshMissingCount();
	});

	async function handleBackfill() {
		if (isBackfilling) return;
		isBackfilling = true;
		try {
			await startSessionTitlesBackfill();
			await refreshMissingCount();
		} finally {
			isBackfilling = false;
		}
	}

	function handleReset() {
		settingsStore.reset('backgroundJobs');
		void refreshMissingCount();
	}
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>{m.settings_background_jobs_title()}</h4>
		<button type="button" class="ui-button ui-button-secondary" onclick={handleReset}>
			{m.settings_section_reset()}
		</button>
	</div>

	<!-- Interruttore generale titoli AI -->
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

		<!-- Riserva finestra breve (AUT-031 / AUT-077: default 30%) -->
		<div class="form-row quota-row">
			<div class="form-row-copy">
				<div class="label-with-value">
					<label for="bg-quota-short" id="bg-quota-short-label" class="form-row-label">
						Riserva minima finestra breve (giornaliera / 5h)
					</label>
					<span class="ui-count tabular font-mono">{quotaShort}%</span>
				</div>
				<span id="bg-quota-short-desc" class="form-row-desc">
					Sospende la generazione automatica dei titoli quando la quota residua nelle finestre brevi scende sotto questa soglia.
				</span>
			</div>
			<div class="form-row-control slider-control">
				<Slider
					min={0}
					max={90}
					step={5}
					value={quotaShort}
					valueText={`${quotaShort}%`}
					disabled={!isGlobalEnabled}
					ariaLabelledBy="bg-quota-short-label"
					ariaDescribedBy="bg-quota-short-desc"
					onChange={(val) => settingsStore.updateBackgroundJobs({ quotaShortPct: val, quotaFloorPct: val })}
				/>
			</div>
		</div>

		<!-- Riserva finestra settimanale (AUT-030 / AUT-031 / AUT-076: default 30%) -->
		<div class="form-row quota-row">
			<div class="form-row-copy">
				<div class="label-with-value">
					<label for="bg-quota-weekly" id="bg-quota-weekly-label" class="form-row-label">
						Riserva minima finestra settimanale
					</label>
					<span class="ui-count tabular font-mono">{quotaWeekly}%</span>
				</div>
				<span id="bg-quota-weekly-desc" class="form-row-desc">
					Soglia protetta per la capacità aggregata della finestra settimanale (calcolata sui report multi-account).
				</span>
			</div>
			<div class="form-row-control slider-control">
				<Slider
					min={0}
					max={90}
					step={5}
					value={quotaWeekly}
					valueText={`${quotaWeekly}%`}
					disabled={!isGlobalEnabled}
					ariaLabelledBy="bg-quota-weekly-label"
					ariaDescribedBy="bg-quota-weekly-desc"
					onChange={(val) => settingsStore.updateBackgroundJobs({ quotaWeeklyPct: val })}
				/>
			</div>
		</div>

		<!-- Finestra di quiete task titoli (AUT-093: default 2s) -->
		<div class="form-row">
			<div class="form-row-copy">
				<div class="label-with-value">
					<label for="bg-task-quiet" id="bg-task-quiet-label" class="form-row-label">
						Quiete salvataggio task (secondi)
					</label>
					<span class="ui-count tabular font-mono">{taskQuiet}s</span>
				</div>
				<span id="bg-task-quiet-desc" class="form-row-desc">
					Attesa dopo il salvataggio o la digitazione del prompt prima di invocare il modello leggero (preserva titoli manuali).
				</span>
			</div>
			<div class="form-row-control slider-control">
				<Slider
					min={1}
					max={10}
					step={1}
					value={taskQuiet}
					valueText={`${taskQuiet}s`}
					disabled={!isGlobalEnabled}
					ariaLabelledBy="bg-task-quiet-label"
					ariaDescribedBy="bg-task-quiet-desc"
					onChange={(val) => settingsStore.updateBackgroundJobs({ taskTitleQuietSeconds: val })}
				/>
			</div>
		</div>
	</div>

	<!-- Titoli AI: configurazione per task e sessioni -->
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

	<!-- Recupero manuale titoli sessioni storiche con anteprima numeri (AUT-094) -->
	<div class="section-group">
		<div class="form-row backfill-row">
			<div class="form-row-copy">
				<div class="label-with-value">
					<span class="form-row-label">Titoli mancanti nella cronologia</span>
					{#if missingSessionCount !== null}
						<span class="ui-count tabular font-mono">{missingSessionCount}</span>
					{/if}
				</div>
				<span class="form-row-desc">
					Le nuove sessioni vengono titolate automaticamente al primo messaggio. Per le sessioni pregresse, avvia il recupero manuale senza sweep automatici.
				</span>
			</div>
			<div class="form-row-control">
				<button
					type="button"
					class="ui-button ui-button-secondary"
					disabled={!isGlobalEnabled || isBackfilling || (missingSessionCount !== null && missingSessionCount === 0)}
					onclick={handleBackfill}
				>
					{isBackfilling ? 'Generazione in corso…' : 'Genera titoli mancanti'}
				</button>
			</div>
		</div>
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

	.backfill-row button {
		white-space: nowrap;
	}
</style>
