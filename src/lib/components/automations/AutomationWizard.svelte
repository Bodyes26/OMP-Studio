<!-- AutomationWizard: Editor a 5 passi per la creazione e modifica delle automazioni.
     Conforme a AUT-019..AUT-024, AUT-044..AUT-051, AUT-060..AUT-062, AUT-074..AUT-078, AUT-099. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		AutomationDraft,
		AutomationDefinition,
		AutomationProject,
		AutomationPlatform,
		AutomationTriggerKind,
		AutomationTrigger,
		TargetFilter,
		CommandVariant,
		AutomationPreview,
		ResolvedAutomationTarget
	} from '#lib/automations/types.ts';
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { t, formatDateTime, formatDuration } from '#lib/automations/i18n.ts';
	import AutomationAssistant from './AutomationAssistant.svelte';
	import ModelField from '#lib/components/models/ModelField.svelte';
	import { modelSettingsStore, STANDARD_ROLES } from '#lib/stores/modelSettings.svelte.ts';
	import {
		IconSparkles,
		IconCheck,
		IconClose,
		IconChevronRight,
		IconChevronLeft,
		IconPlus
	} from '#lib/icons.ts';

	let {
		draft: initialDraft = undefined,
		initialStep = 0,
		startWithAi = false,
		existingDefinition = null,
		projects: initialProjects = [],
		onclose,
		onsave,
		onactivate
	} = $props<{
		draft?: AutomationDraft;
		initialStep?: number;
		startWithAi?: boolean;
		existingDefinition?: AutomationDefinition | null;
		projects?: AutomationProject[];
		onclose?: () => void;
		onsave?: (draft: AutomationDraft) => void | Promise<void>;
		onactivate?: (draftId: string, revision: number) => void | Promise<void>;
	}>();

	// Usa draft passato come prop oppure editingDraft dallo store singleton
	const currentDraft = $derived(initialDraft || automationsStore.editingDraft);
	const projects = $derived(
		initialProjects.length > 0
			? initialProjects
			: (automationsStore.snapshot?.projects ?? [])
	);

	let currentStep = $state(untrack(() => initialStep ?? 0));
	let isAiMode = $state(untrack(() => startWithAi ?? false));

	$effect(() => {
		if (initialStep !== undefined) currentStep = initialStep;
	});
	$effect(() => {
		if (startWithAi !== undefined) isAiMode = startWithAi;
	});
	const manualFields = $state(new Set<string>());
	function markManual(field: string) {
		manualFields.add(field);
	}
	let isSaving = $state(false);
	let isActivating = $state(false);
	let errorMessage = $state<string | null>(null);
	let successMessage = $state<string | null>(null);

	// Anteprima dinamica per il passo 5 (Riepilogo)
	let previewData = $state<AutomationPreview | null>(null);
	let isPreviewLoading = $state(false);

	const STEPS = [
		{ id: 0, title: t('wizard_step_1') },
		{ id: 1, title: t('wizard_step_2') },
		{ id: 2, title: t('wizard_step_3') },
		{ id: 3, title: t('wizard_step_4') },
		{ id: 4, title: t('wizard_step_5') }
	];

	// Carica anteprima risoluzione quando si entra nel passo 5
	$effect(() => {
		if (currentStep === 4 && currentDraft && !isAiMode) {
			loadPreview();
		}
	});

	async function loadPreview() {
		if (!currentDraft) return;
		isPreviewLoading = true;
		try {
			if (typeof automationsStore.preview === 'function') {
				previewData = await automationsStore.preview(currentDraft.definition);
			} else {
				previewData = {
					targets: currentDraft.definition.targets.projectPaths.map((p: string) => ({
						key: p,
						projectId: null,
						path: p,
						name: p.split(/[\\/]/).pop() || p,
						kind: 'project'
					})),
					nextRuns: [Date.now() + 86400000],
					issues: [],
					fileHashes: {}
				};
			}
		} catch (err) {
			console.warn('Errore calcolo preview:', err);
		} finally {
			isPreviewLoading = false;
		}
	}

	function goToStep(stepIndex: number) {
		errorMessage = null;
		isAiMode = false;
		currentStep = Math.max(0, Math.min(STEPS.length - 1, stepIndex));
	}

	function handleNext() {
		if (!validateCurrentStep()) return;
		if (currentStep < STEPS.length - 1) {
			goToStep(currentStep + 1);
		}
	}

	function handleBack() {
		if (currentStep > 0) {
			goToStep(currentStep - 1);
		}
	}

	function validateCurrentStep(): boolean {
		if (!currentDraft) return false;
		const def = currentDraft.definition;

		if (currentStep === 0) {
			if (!def.name.trim()) {
				errorMessage = t('val_name_required');
				return false;
			}
			if (
				def.targets.source === 'selected' &&
				def.targets.projectPaths.length === 0
			) {
				errorMessage = t('val_targets_required');
				return false;
			}
		} else if (currentStep === 1) {
			if (def.action.kind === 'command' && !def.action.command.trim()) {
				errorMessage = t('val_command_required');
				return false;
			}
			if (def.action.kind === 'prompt' && !def.action.prompt.trim()) {
				errorMessage = t('val_prompt_required');
				return false;
			}
		}
		errorMessage = null;
		return true;
	}

	async function handleSaveDraft() {
		if (!currentDraft) return;
		isSaving = true;
		errorMessage = null;
		try {
			currentDraft.updatedAt = Date.now();
			if (onsave) {
				await onsave(currentDraft);
			} else {
				await automationsStore.saveDraft(currentDraft);
			}
			successMessage = t('saved_draft_success');
			setTimeout(() => {
				successMessage = null;
			}, 3000);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : String(err);
		} finally {
			isSaving = false;
		}
	}

	async function handleActivate() {
		if (!currentDraft) return;
		if (!validateCurrentStep()) return;

		isActivating = true;
		errorMessage = null;
		try {
			await handleSaveDraft();
			const expectedRev = currentDraft.baseRevision ?? 0;
			if (onactivate) {
				await onactivate(currentDraft.id, expectedRev);
			} else {
				await automationsStore.activate(currentDraft.id, expectedRev);
			}
			successMessage = t('activated_success');
			setTimeout(() => {
				onclose?.();
			}, 1000);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : String(err);
		} finally {
			isActivating = false;
		}
	}

	function handleClose() {
		if (onclose) {
			onclose();
		} else {
			automationsStore.editingDraft = null;
		}
	}

	// Helper per manipolazione liste del passo 1 (Target e filtri)
	function toggleProjectPath(path: string) {
		markManual('targets.projectPaths');
		const paths = currentDraft.definition.targets.projectPaths;
		const idx = paths.indexOf(path);
		if (idx >= 0) {
			currentDraft.definition.targets.projectPaths = paths.filter((p: string) => p !== path);
		} else {
			currentDraft.definition.targets.projectPaths = [...paths, path];
		}
	}

	function addTargetFilter() {
		markManual('targets.filters');
		const newFilter: TargetFilter = {
			kind: 'dirty',
			period: 'today',
			authors: []
		};
		currentDraft.definition.targets.filters = [
			...currentDraft.definition.targets.filters,
			newFilter
		];
	}

	function removeTargetFilter(index: number) {
		if (!currentDraft) return;
		markManual('targets.filters');
			currentDraft.definition.targets.filters.filter((_: TargetFilter, i: number) => i !== index);
	}

	// Helper per manipolazione trigger del passo 3
	function addAdditionalTrigger(kind: AutomationTriggerKind = 'file') {
		markManual('triggers');
		const newTrig: AutomationTrigger = {
			id: crypto.randomUUID(),
			kind,
			roots: [],
			includePatterns: ['**/*'],
			excludePatterns: ['node_modules/**'],
			changes: ['modify', 'create']
		};
		currentDraft.definition.triggers = [
			...currentDraft.definition.triggers,
			newTrig
		];
	}

	function removeTrigger(id: string) {
		if (!currentDraft) return;
		markManual('triggers');
		currentDraft.definition.triggers = currentDraft.definition.triggers.filter(
			(tr: AutomationTrigger) => tr.id !== id
		);
	}

	function handleIncludePatternsChange(trig: AutomationTrigger, event: Event) {
		const target = event.currentTarget as HTMLInputElement | null;
		markManual('triggers');
		if (target) {
			trig.includePatterns = target.value
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		}
	}


	function toggleWeekday(weekdayIndex: number) {
		if (!currentDraft) return;
		markManual('triggers');
		const primary = currentDraft.definition.triggers[0];
		if (!primary) return;
		const days = primary.weekdays ?? [];
		if (days.includes(weekdayIndex)) {
			primary.weekdays = days.filter((d: number) => d !== weekdayIndex);
		} else {
			primary.weekdays = [...days, weekdayIndex].sort();
		}
	}

	// Helper per variabili d'ambiente e segreti del passo 2
	let newEnvKey = $state('');
	let newEnvVal = $state('');
	function addEnvVar() {
		if (!currentDraft || !newEnvKey.trim() || currentDraft.definition.action.kind !== 'command') return;
		markManual('action.environment');
		currentDraft.definition.action.environment[newEnvKey.trim()] = newEnvVal;
		newEnvKey = '';
		newEnvVal = '';
	}

	function removeEnvVar(key: string) {
		if (!currentDraft || currentDraft.definition.action.kind !== 'command') return;
		markManual('action.environment');
		const env = { ...currentDraft.definition.action.environment };
		delete env[key];
		currentDraft.definition.action.environment = env;
	}
	let newSecretEnvName = $state('');
	let newSecretVaultId = $state('');
	function addSecretRef() {
		if (!currentDraft || !newSecretEnvName.trim() || !newSecretVaultId.trim() || currentDraft.definition.action.kind !== 'command') return;
		markManual('action.secretRefs');
		currentDraft.definition.action.secretRefs[newSecretEnvName.trim()] =
			newSecretVaultId.trim();
		newSecretEnvName = '';
		newSecretVaultId = '';
	}

	function removeSecretRef(key: string) {
		if (!currentDraft || currentDraft.definition.action.kind !== 'command') return;
		markManual('action.secretRefs');
		const sec = { ...currentDraft.definition.action.secretRefs };
		delete sec[key];
		currentDraft.definition.action.secretRefs = sec;
	}

	// Calcolo differenze rispetto alla revisione base (Passo 5)
	const diffItems = $derived.by(() => {
		if (!currentDraft) return [];
		const base =
			existingDefinition ||
			automationsStore.snapshot?.definitions.find(
				(d: AutomationDefinition) => d.id === currentDraft.definition.id
			);
		if (!base) return [];

		const diffs: Array<{ label: string; oldVal: string; newVal: string }> = [];
		const current = currentDraft.definition;

		if (base.name !== current.name) {
			diffs.push({ label: 'Nome', oldVal: base.name, newVal: current.name });
		}
		if (base.description !== current.description) {
			diffs.push({
				label: 'Descrizione',
				oldVal: base.description || '(vuota)',
				newVal: current.description || '(vuota)'
			});
		}
		if (base.action.kind !== current.action.kind) {
			diffs.push({
				label: 'Tipo azione',
				oldVal: base.action.kind,
				newVal: current.action.kind
			});
		} else if (
			base.action.kind === 'command' &&
			current.action.kind === 'command' &&
			base.action.command !== current.action.command
		) {
			diffs.push({
				label: 'Comando',
				oldVal: base.action.command,
				newVal: current.action.command
			});
		} else if (
			base.action.kind === 'prompt' &&
			current.action.kind === 'prompt' &&
			base.action.prompt !== current.action.prompt
		) {
			diffs.push({
				label: 'Prompt',
				oldVal: base.action.prompt,
				newVal: current.action.prompt
			});
		}
		if (base.targets.source !== current.targets.source) {
			diffs.push({
				label: 'Origine destinatari',
				oldVal: base.targets.source,
				newVal: current.targets.source
			});
		}
		if (base.policy.timeoutMinutes !== current.policy.timeoutMinutes) {
			diffs.push({
				label: 'Timeout',
				oldVal: `${base.policy.timeoutMinutes} min`,
				newVal: `${current.policy.timeoutMinutes} min`
			});
		}
		return diffs;
	});
</script>

{#if currentDraft}
	<div class="wizard-root" role="dialog" aria-modal="true" aria-label={t('wizard_title')}>
		<!-- Barra superiore con badge bozza e chiusura -->
		<header class="wizard-topbar">
			<div class="topbar-left">
				<h1 class="wizard-main-title">{t('wizard_title')}</h1>
				{#if currentDraft.baseRevision !== null}
					<span class="badge editing-badge">
						{t('editing_revision_badge', { rev: currentDraft.baseRevision })}
					</span>
				{:else}
					<span class="badge draft-badge">{t('draft_status_badge')}</span>
				{/if}
			</div>

			<div class="topbar-right">
				<button
					type="button"
					class="ai-toggle-btn {isAiMode ? 'active' : ''}"
					onclick={() => (isAiMode = !isAiMode)}
					aria-label={t('btn_create_ai')}
				>
					<IconSparkles size={16} />
					<span>{t('btn_create_ai')}</span>
				</button>
				<button
					type="button"
					class="close-btn"
					onclick={handleClose}
					aria-label={t('btn_close')}
				>
					<IconClose size={18} />
				</button>
			</div>
		</header>

		{#if isAiMode}
			<!-- Superficie Assistente AI Dedicato (AUT-059..AUT-062, AUT-099) -->
			<div class="ai-container">
				<AutomationAssistant
					draft={currentDraft}
					settings={automationsStore.snapshot?.settings}
					{manualFields}
					onSwitchToFields={() => (isAiMode = false)}
					onDraftUpdated={() => {
						currentDraft.updatedAt = Date.now();
					}}
				/>
			</div>
		{:else}
			<!-- Navigazione a 5 passi ed Editor -->
			<div class="wizard-layout">
				<nav class="steps-nav" aria-label="Passi editor">
					{#each STEPS as step (step.id)}
						<button
							type="button"
							class="step-btn {currentStep === step.id ? 'active' : ''} {step.id < currentStep ? 'completed' : ''}"
							onclick={() => goToStep(step.id)}
							aria-current={currentStep === step.id ? 'step' : undefined}
						>
							<span class="step-num">{step.id + 1}</span>
							<span class="step-label">{step.title}</span>
						</button>
					{/each}
				</nav>

				<main class="step-content">
					{#if errorMessage}
						<div class="banner error-banner" role="alert">
							{errorMessage}
						</div>
					{/if}
					{#if successMessage}
						<div class="banner success-banner" role="status">
							{successMessage}
						</div>
					{/if}

					<!-- PASSO 1: OBIETTIVO E DESTINATARI -->
					{#if currentStep === 0}
						<section class="form-section">
							<h2>{t('goal_heading')}</h2>

							<div class="field-group">
								<label for="auto-name">{t('name_label')} *</label>
								<input
									id="auto-name"
									type="text"
									class="text-input"
									oninput={() => markManual('name')}
									placeholder={t('name_placeholder')}
									required
								/>
							</div>

							<div class="field-group">
								<label for="auto-desc">{t('description_label')}</label>
								<textarea
									id="auto-desc"
									class="textarea-input"
									oninput={() => markManual('description')}
									placeholder={t('description_placeholder')}
									rows="2"
								></textarea>
							</div>

							<h3>{t('targets_heading')}</h3>

							<div class="field-group">
								<label for="targets-source">{t('targets_source_label')}</label>
								<select
									id="targets-source"
									class="select-input"
									onchange={() => markManual('targets.source')}
								>
									<option value="selected">{t('targets_source_selected')}</option>
									<option value="open">{t('targets_source_open')}</option>
									<option value="registered">{t('targets_source_registered')}</option>
									<option value="directory">{t('targets_source_directory')}</option>
									<option value="studio">{t('targets_source_studio')}</option>
								</select>
							</div>

							{#if currentDraft.definition.targets.source === 'selected'}
								<div class="field-group">
									<span class="field-label">{t('targets_project_paths')}</span>
									{#if projects.length === 0}
										<p class="muted-hint">{t('targets_no_projects')}</p>
									{:else}
										<div class="checkbox-grid">
											{#each projects as proj (proj.id)}
												<label class="checkbox-item">
													<input
														type="checkbox"
														checked={currentDraft.definition.targets.projectPaths.includes(
															proj.path
														)}
														onchange={() => toggleProjectPath(proj.path)}
													/>
													<span class="proj-name">{proj.name}</span>
													<span class="proj-path">{proj.path}</span>
												</label>
											{/each}
										</div>
									{/if}
								</div>
							{/if}

							<div class="row-2">
								<div class="field-group">
									<label for="targets-mode">{t('targets_mode_label')}</label>
									<select
										id="targets-mode"
										class="select-input"
										bind:value={currentDraft.definition.targets.mode}
										onchange={() => markManual('targets.mode')}
									>
										<option value="each">{t('targets_mode_each')}</option>
										<option value="aggregate">{t('targets_mode_aggregate')}</option>
									</select>
								</div>

								<div class="field-group">
									<label for="targets-cwd">{t('targets_cwd_label')}</label>
									<input
										id="targets-cwd"
										type="text"
										class="text-input"
										bind:value={currentDraft.definition.targets.cwd}
										oninput={() => markManual('targets.cwd')}
										placeholder={t('targets_cwd_placeholder')}
									/>
								</div>
							</div>

							<!-- Filtri dinamici destinatari -->
							<div class="filters-subgroup">
								<div class="subgroup-header">
									<h4>{t('targets_filters_heading')}</h4>
									<button
										type="button"
										class="small-action-btn"
										onclick={addTargetFilter}
									>
										<IconPlus size={14} />
										{t('targets_filter_add')}
									</button>
								</div>

								{#each currentDraft.definition.targets.filters as filter, fIdx}
									<div class="filter-row">
										<select class="select-input small" bind:value={filter.kind}>
											<option value="dirty">{t('targets_filter_kind_dirty')}</option>
											<option value="activity">{t('targets_filter_kind_activity')}</option>
											<option value="commit">{t('targets_filter_kind_commit')}</option>
										</select>
										<select class="select-input small" bind:value={filter.period}>
											<option value="today">{t('targets_filter_period_today')}</option>
											<option value="24h">{t('targets_filter_period_24h')}</option>
											<option value="7d">{t('targets_filter_period_7d')}</option>
										</select>
										<button
											type="button"
											class="remove-icon-btn"
											onclick={() => removeTargetFilter(fIdx)}
											aria-label={t('targets_filter_remove')}
										>
											<IconClose size={14} />
										</button>
									</div>
								{/each}
							</div>
						</section>

					<!-- PASSO 2: AZIONE -->
					{:else if currentStep === 1}
						<section class="form-section">
							<h2>{t('action_heading')}</h2>

							<div class="field-group">
								<label for="action-kind">{t('action_type_label')}</label>
								<select
									id="action-kind"
									class="select-input"
									bind:value={currentDraft.definition.action.kind}
									onchange={() => markManual('action.kind')}
								>
									<option value="command">{t('action_kind_shell')}</option>
									<option value="prompt">{t('action_kind_prompt')}</option>
								</select>
							</div>

							{#if currentDraft.definition.action.kind === 'prompt'}
								<!-- Configurazione Prompt AI -->
								<div class="field-group">
									<label for="action-prompt">{t('prompt_label')} *</label>
									<textarea
										id="action-prompt"
										class="textarea-input"
										bind:value={currentDraft.definition.action.prompt}
										oninput={() => markManual('action.prompt')}
										placeholder={t('prompt_placeholder')}
										rows="4"
										required
									></textarea>
								</div>

								<div class="row-2">
									<div class="field-group">
										<label for="model-mode">{t('model_mode_label')}</label>
										<select
											id="model-mode"
											class="select-input"
											bind:value={currentDraft.definition.action.modelMode}
											onchange={() => markManual('action.modelMode')}
										>
											<option value="role">{t('model_mode_role')}</option>
											<option value="model">{t('model_mode_model')}</option>
										</select>
									</div>

									{#if currentDraft.definition.action.modelMode === 'role'}
										<div class="field-group">
											<label for="model-role">{t('model_role_label')}</label>
											<select
												id="model-role"
												class="select-input"
												bind:value={currentDraft.definition.action.model}
												onchange={() => markManual('action.model')}
											>
												{#each STANDARD_ROLES as r (r.id)}
													<option value={r.id}>{r.label}</option>
												{/each}
											</select>
										</div>
									{:else}
										<div class="field-group">
											<span class="field-label">{t('model_specific_label')}</span>
											<ModelField
												catalog={modelSettingsStore.catalog}
												value={currentDraft.definition.action.model}
												ariaLabel={t('model_specific_label')}
												onSelect={(selector) => {
													markManual('action.model');
													if (currentDraft && currentDraft.definition.action.kind === 'prompt') {
														currentDraft.definition.action.model = selector;
													}
												}}
											/>
										</div>
									{/if}
								</div>

								<div class="row-2">
									<label class="checkbox-item">
										<input
											type="checkbox"
											bind:checked={currentDraft.definition.action.allowPayAsYouGo}
										/>
										<span>{t('allow_pay_as_you_go')}</span>
									</label>

									<div class="field-group">
										<label for="max-cost">{t('max_cost_label')}</label>
										<input
											id="max-cost"
											type="number"
											step="0.05"
											class="text-input"
											bind:value={currentDraft.definition.action.maxCostUsd}
											placeholder={t('max_cost_placeholder')}
											oninput={() => markManual('action.maxCostUsd')}
										/>
									</div>
								</div>

							{:else if currentDraft.definition.action.kind === 'command'}
								<!-- Configurazione Comando Shell / Eseguibile -->
								<div class="field-group">
									<label for="command-mode">Modalità comando</label>
									<select
										id="command-mode"
										class="select-input"
										bind:value={currentDraft.definition.action.mode}
									>
										<option value="shell">Shell script</option>
										<option value="executable">Eseguibile binario</option>
										<option value="script">File script dedicato</option>
									</select>
								</div>

								<div class="field-group">
									<label for="cmd-input">{t('command_label')} *</label>
									<input
										id="cmd-input"
										type="text"
										class="text-input mono"
										bind:value={currentDraft.definition.action.command}
										placeholder={t('command_placeholder')}
										oninput={() => markManual('action.command')}
									/>
								</div>

								<div class="row-2">
									<div class="field-group">
										<label for="cmd-interpreter">{t('interpreter_label')}</label>
										<input
											id="cmd-interpreter"
											type="text"
											class="text-input mono"
											bind:value={currentDraft.definition.action.interpreter}
											placeholder={t('interpreter_placeholder')}
											oninput={() => markManual('action.interpreter')}
										/>
									</div>

									<div class="field-group">
										<label for="script-policy">{t('script_policy_label')}</label>
										<select
											id="script-policy"
											class="select-input"
											bind:value={currentDraft.definition.action.scriptPolicy}
											onchange={() => markManual('action.scriptPolicy')}
										>
											<option value="review">{t('script_policy_review')}</option>
											<option value="follow">{t('script_policy_follow')}</option>
										</select>
									</div>
								</div>

								<!-- Variabili d'ambiente -->
								<div class="env-vars-block">
									<h4>{t('env_vars_heading')}</h4>
									<p class="muted-hint">{t('env_vars_desc')}</p>

									{#each Object.entries(currentDraft.definition.action.environment) as [key, val]}
										<div class="key-value-row">
											<code>{key}</code> = <code>{val}</code>
											<button
												type="button"
												class="remove-icon-btn"
												onclick={() => removeEnvVar(key)}
											>
												<IconClose size={14} />
											</button>
										</div>
									{/each}

									<div class="add-row">
										<input
											type="text"
											class="text-input small mono"
											placeholder={t('env_var_key')}
											bind:value={newEnvKey}
										/>
										<input
											type="text"
											class="text-input small"
											placeholder={t('env_var_val')}
											bind:value={newEnvVal}
										/>
										<button type="button" class="small-action-btn" onclick={addEnvVar}>
											{t('env_var_add')}
										</button>
									</div>
								</div>

								<!-- Riferimenti a Vault segreti -->
								<div class="vault-block">
									<h4>{t('secret_refs_heading')}</h4>
									<p class="muted-hint">{t('secret_refs_desc')}</p>

									{#each Object.entries(currentDraft.definition.action.secretRefs) as [envName, vaultId]}
										<div class="key-value-row">
											<span>Variabile: <code>{envName}</code></span>
											<span>Segreto OS: <code>{vaultId}</code></span>
											<button
												type="button"
												class="remove-icon-btn"
												onclick={() => removeSecretRef(envName)}
											>
												<IconClose size={14} />
											</button>
										</div>
									{/each}

									<div class="add-row">
										<input
											type="text"
											class="text-input small mono"
											placeholder={t('secret_env_name')}
											bind:value={newSecretEnvName}
										/>
										<input
											type="text"
											class="text-input small mono"
											placeholder={t('secret_vault_id')}
											bind:value={newSecretVaultId}
										/>
										<button type="button" class="small-action-btn" onclick={addSecretRef}>
											{t('secret_ref_add')}
										</button>
									</div>
								</div>
							{/if}
						</section>

					<!-- PASSO 3: QUANDO (Trigger e Calendario) -->
					{:else if currentStep === 2}
						<section class="form-section">
							<h2>{t('triggers_heading')}</h2>
							<p class="muted-hint">{t('triggers_intro')}</p>

							<div class="field-group">
								<label for="timezone-input">{t('timezone_label')}</label>
								<input
									id="timezone-input"
									type="text"
									class="text-input"
									bind:value={currentDraft.definition.policy.timezone}
									readonly
								/>
							</div>

							<h3>{t('primary_schedule_heading')}</h3>

							{#if currentDraft.definition.triggers.length > 0}
								{@const primaryTrig = currentDraft.definition.triggers[0]}
								<div class="field-group">
									<label for="primary-kind">{t('trigger_kind_label')}</label>
									<select
										id="primary-kind"
										class="select-input"
										bind:value={primaryTrig.kind}
									>
										<option value="manual">{t('trigger_manual')}</option>
										<option value="daily">{t('trigger_daily')}</option>
										<option value="weekly">{t('trigger_weekly')}</option>
										<option value="interval">{t('trigger_interval')}</option>
										<option value="once">{t('trigger_once')}</option>
									</select>
								</div>

								{#if primaryTrig.kind === 'daily' || primaryTrig.kind === 'weekly'}
									<div class="field-group">
										<label for="primary-time">{t('time_label')}</label>
										<input
											id="primary-time"
											type="time"
											class="text-input small"
											bind:value={primaryTrig.time}
										/>
									</div>
								{/if}

								{#if primaryTrig.kind === 'weekly'}
									<div class="field-group">
										<span class="field-label">{t('weekdays_label')}</span>
										<div class="weekday-selector">
											{#each [
												{ day: 1, label: t('weekday_mon') },
												{ day: 2, label: t('weekday_tue') },
												{ day: 3, label: t('weekday_wed') },
												{ day: 4, label: t('weekday_thu') },
												{ day: 5, label: t('weekday_fri') },
												{ day: 6, label: t('weekday_sat') },
												{ day: 0, label: t('weekday_sun') }
											] as wd (wd.day)}
												<button
													type="button"
													class="weekday-btn {(primaryTrig.weekdays ?? []).includes(wd.day) ? 'selected' : ''}"
													onclick={() => toggleWeekday(wd.day)}
												>
													{wd.label}
												</button>
											{/each}
										</div>
									</div>
								{/if}

								{#if primaryTrig.kind === 'interval'}
									<div class="field-group">
										<label for="interval-min">{t('interval_minutes_label')}</label>
										<input
											id="interval-min"
											type="number"
											min="1"
											class="text-input small"
											bind:value={primaryTrig.intervalMinutes}
										/>
									</div>
								{/if}
							{/if}

							<!-- Eventi aggiuntivi (Git / File) -->
							<div class="additional-triggers-block">
								<div class="subgroup-header">
									<h4>{t('additional_triggers_heading')}</h4>
									<button
										type="button"
										class="small-action-btn"
										onclick={() => addAdditionalTrigger('gitCommit')}
									>
										<IconPlus size={14} />
										{t('trigger_add_event')}
									</button>
								</div>

								{#each currentDraft.definition.triggers.slice(1) as trig (trig.id)}
									<div class="additional-trigger-card">
										<div class="trigger-card-top">
											<select class="select-input small" bind:value={trig.kind}>
												<option value="gitCommit">{t('trigger_gitCommit')}</option>
												<option value="gitBranch">{t('trigger_gitBranch')}</option>
												<option value="gitDirty">{t('trigger_gitDirty')}</option>
												<option value="gitClean">{t('trigger_gitClean')}</option>
												<option value="file">{t('trigger_file')}</option>
												<option value="studioStarted">{t('trigger_studioStarted')}</option>
												<option value="projectOpened">{t('trigger_projectOpened')}</option>
											</select>
											<button
												type="button"
												class="remove-icon-btn"
												onclick={() => removeTrigger(trig.id)}
											>
												<IconClose size={14} />
											</button>
										</div>

										{#if trig.kind === 'file'}
											<div class="field-group">
												<label for="trig-include-{trig.id}">{t('trigger_include_patterns')}</label>
												<input
													id="trig-include-{trig.id}"
													type="text"
													class="text-input small mono"
													value={(trig.includePatterns ?? []).join(', ')}
													onchange={(e) => handleIncludePatternsChange(trig, e)}
												/>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</section>

					<!-- PASSO 4: CONDIZIONI E PERMESSI (Policy) -->
					{:else if currentStep === 3}
						<section class="form-section">
							<h2>{t('policy_heading')}</h2>
							<p class="muted-hint">{t('policy_intro')}</p>

							<div class="row-2">
								<div class="field-group">
									<label for="policy-timeout">{t('timeout_label')}</label>
									<input
										id="policy-timeout"
										type="number"
										min="1"
										class="text-input"
										bind:value={currentDraft.definition.policy.timeoutMinutes}
										oninput={() => markManual('policy.timeoutMinutes')}
									/>
									<span class="muted-hint">{t('timeout_help')}</span>
								</div>

								<div class="field-group">
									<label for="policy-wait">{t('max_wait_label')}</label>
									<input
										id="policy-wait"
										type="number"
										min="1"
										class="text-input"
										bind:value={currentDraft.definition.policy.maxWaitMinutes}
										oninput={() => markManual('policy.maxWaitMinutes')}
									/>
									<span class="muted-hint">{t('max_wait_help')}</span>
								</div>
							</div>

							<div class="row-2">
								<div class="field-group">
									<label for="policy-missed">{t('missed_label')}</label>
									<select
										id="policy-missed"
										class="select-input"
										bind:value={currentDraft.definition.policy.missed}
										onchange={() => markManual('policy.missed')}
									>
										<option value="notify">{t('missed_notify')}</option>
										<option value="ignore">{t('missed_ignore')}</option>
										<option value="recover">{t('missed_recover')}</option>
									</select>

								{#if currentDraft.definition.policy.missed === 'recover'}
									<div class="field-group">
										<label for="policy-recovery">{t('recovery_minutes_label')}</label>
										<input
											id="policy-recovery"
											type="number"
											min="1"
											class="text-input"
											bind:value={currentDraft.definition.policy.recoveryMinutes}
											oninput={() => markManual('policy.recoveryMinutes')}
										/>
									</div>
								{/if}
							</div>

							<div class="field-group">
								<label for="policy-overlap">{t('overlap_label')}</label>
								<select
									id="policy-overlap"
									class="select-input"
									bind:value={currentDraft.definition.policy.overlap}
									onchange={() => markManual('policy.overlap')}
								>
									<option value="coalesce">{t('overlap_coalesce')}</option>
									<option value="skip">{t('overlap_skip')}</option>
								</select>
							</div>

							<div class="field-group">
								<label class="checkbox-item">
									<input
										type="checkbox"
										bind:checked={currentDraft.definition.policy.notifySuccess}
									/>
									<span>{t('notify_success_label')}</span>
								</label>
								<span class="muted-hint">{t('notify_success_help')}</span>
							</div>

							<!-- Politica quote agente -->
							<div class="quota-policy-block">
								<h4>{t('quota_heading')}</h4>
								<p class="muted-hint">{t('quota_desc')}</p>

								<div class="row-3">
									<div class="field-group">
										<label for="quota-short">{t('quota_short_label')}</label>
										<input
											id="quota-short"
											type="number"
											min="1"
											max="100"
											class="text-input small"
											bind:value={currentDraft.definition.policy.quota.shortPct}
										/>
									</div>
									<div class="field-group">
										<label for="quota-weekly">{t('quota_weekly_label')}</label>
										<input
											id="quota-weekly"
											type="number"
											min="1"
											max="100"
											class="text-input small"
											bind:value={currentDraft.definition.policy.quota.weeklyPct}
										/>
									</div>
									<div class="field-group">
										<label for="quota-other">{t('quota_other_label')}</label>
										<input
											id="quota-other"
											type="number"
											min="1"
											max="100"
											class="text-input small"
											bind:value={currentDraft.definition.policy.quota.otherPct}
										/>
									</div>
								</div>
							</div>
						</section>

					<!-- PASSO 5: RIEPILOGO E ATTIVAZIONE -->
					{:else if currentStep === 4}
						<section class="form-section">
							<h2>{t('review_heading')}</h2>
							<p class="muted-hint">{t('review_intro')}</p>

							<!-- Differenze rispetto alla versione attiva se modifica -->
							{#if currentDraft.baseRevision !== null}
								<div class="diff-box">
									<h3>{t('review_diff_heading', { baseRev: currentDraft.baseRevision })}</h3>
									{#if diffItems.length === 0}
										<p class="muted-hint">{t('review_diff_none')}</p>
									{:else}
										<ul class="diff-list">
											{#each diffItems as diff}
												<li>
													<strong>{diff.label}:</strong>
													<span class="diff-old"><s>{diff.oldVal}</s></span>
													<IconChevronRight size={14} />
													<span class="diff-new"><strong>{diff.newVal}</strong></span>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/if}

							<!-- Anteprima di risoluzione al trigger -->
							<div class="preview-box">
								<h3>{t('review_preview_heading')}</h3>
								{#if isPreviewLoading}
									<p class="muted-hint">Calcolo anteprima in corso…</p>
								{:else if previewData}
									<div class="preview-facts">
										<div class="fact-row">
											<span class="fact-key">{t('review_preview_targets_heading', { count: previewData.targets.length })}:</span>
											<span class="fact-val">
												{previewData.targets.map((t: ResolvedAutomationTarget) => t.name).join(', ') || t('review_preview_no_targets')}
											</span>
										</div>
										<div class="fact-row">
											<span class="fact-key">{t('review_preview_next_runs')}:</span>
											<span class="fact-val">
												{previewData.nextRuns.map((r: number) => formatDateTime(r)).join(' · ') || 'Nessuna programmata'}
											</span>
										</div>
										{#if previewData.issues.length > 0}
											<div class="issues-alert">
												<strong>{t('review_preview_issues')}:</strong>
												<ul>
													{#each previewData.issues as issue}
														<li>{issue}</li>
													{/each}
												</ul>
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<div class="warning-banner">
								<span>⚠️ {t('review_warning_banner')}</span>
							</div>
						</section>
					{/if}
				</main>
			</div>

			<!-- Barra inferiore dei pulsanti -->
			<footer class="wizard-footer">
				<div class="footer-left">
					<button
						type="button"
						class="btn-secondary"
						onclick={handleBack}
						disabled={currentStep === 0}
					>
						<IconChevronLeft size={16} />
						{t('btn_back')}
					</button>
				</div>

				<div class="footer-right">
					<button
						type="button"
						class="btn-secondary"
						onclick={handleSaveDraft}
						disabled={isSaving}
					>
						{t('btn_save_draft')}
					</button>

					{#if currentStep < STEPS.length - 1}
						<button
							type="button"
							class="btn-primary"
							onclick={handleNext}
						>
							{t('btn_forward')}
							<IconChevronRight size={16} />
						</button>
					{:else}
						<button
							type="button"
							class="btn-activate"
							onclick={handleActivate}
							disabled={isActivating}
						>
							<IconCheck size={16} />
							{currentDraft.baseRevision !== null
								? t('btn_update_activate')
								: t('btn_activate')}
						</button>
					{/if}
				</div>
			</footer>
		{/if}
	</div>
{/if}

<style>
	.wizard-root {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 560px;
		background: var(--bg-primary, #1e1e24);
		color: var(--text-primary, #ffffff);
		border-radius: 8px;
		overflow: hidden;
	}

	.wizard-topbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 14px 20px;
		border-bottom: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		background: var(--bg-secondary, #25252d);
	}

	.topbar-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.wizard-main-title {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.badge {
		font-size: 0.72rem;
		padding: 2px 8px;
		border-radius: 4px;
		font-weight: 500;
	}

	.draft-badge {
		background: rgba(156, 163, 175, 0.15);
		color: #9ca3af;
		border: 1px solid rgba(156, 163, 175, 0.3);
	}

	.editing-badge {
		background: rgba(245, 158, 11, 0.15);
		color: #fcd34d;
		border: 1px solid rgba(245, 158, 11, 0.3);
	}

	.topbar-right {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.ai-toggle-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(124, 58, 237, 0.15);
		color: #c4b5fd;
		border: 1px solid rgba(124, 58, 237, 0.3);
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.ai-toggle-btn.active,
	.ai-toggle-btn:hover {
		background: var(--accent, #7c3aed);
		color: #ffffff;
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--text-muted, #9ca3af);
		padding: 6px;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.close-btn:hover {
		color: #ffffff;
		background: rgba(255, 255, 255, 0.08);
	}

	.ai-container {
		flex: 1;
		min-height: 0;
	}

	.wizard-layout {
		display: grid;
		grid-template-columns: 210px minmax(0, 1fr);
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	@media (max-width: 800px) {
		.wizard-layout {
			grid-template-columns: 1fr;
		}
		.steps-nav {
			flex-direction: row !important;
			overflow-x: auto;
			border-right: none !important;
			border-bottom: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		}
	}

	.steps-nav {
		background: var(--bg-secondary, #25252d);
		border-right: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		padding: 16px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.step-btn {
		display: flex;
		align-items: center;
		gap: 10px;
		background: transparent;
		border: none;
		color: var(--text-muted, #9ca3af);
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 0.84rem;
		text-align: left;
		cursor: pointer;
		transition: all 0.15s;
	}

	.step-btn:hover {
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-primary, #ffffff);
	}

	.step-btn.active {
		background: rgba(124, 58, 237, 0.15);
		color: #ffffff;
		font-weight: 500;
	}

	.step-num {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.1);
		font-size: 0.75rem;
		font-weight: 600;
		flex-shrink: 0;
	}

	.step-btn.active .step-num {
		background: var(--accent, #7c3aed);
		color: #ffffff;
	}

	.step-btn.completed .step-num {
		background: #059669;
		color: #ffffff;
	}

	.step-content {
		padding: 24px 32px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.form-section h2 {
		margin: 0 0 12px 0;
		font-size: 1.2rem;
		font-weight: 600;
	}

	.form-section h3 {
		margin: 20px 0 10px 0;
		font-size: 1rem;
		font-weight: 600;
		border-top: 1px solid var(--line, rgba(255, 255, 255, 0.08));
		padding-top: 16px;
	}

	.form-section h4 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 14px;
	}

	.field-group label,
	.field-group .field-label {
		font-size: 0.84rem;
		font-weight: 500;
		color: var(--text-primary, #ffffff);
	}

	.text-input,
	.select-input,
	.textarea-input {
		background: var(--bg-secondary, #25252d);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.15));
		color: var(--text-primary, #ffffff);
		border-radius: 6px;
		padding: 8px 12px;
		font-size: 0.86rem;
		font-family: inherit;
	}

	.text-input:focus,
	.select-input:focus,
	.textarea-input:focus {
		outline: none;
		border-color: var(--accent, #7c3aed);
	}

	.text-input.small,
	.select-input.small {
		padding: 6px 10px;
		font-size: 0.8rem;
	}

	.mono {
		font-family: monospace;
	}

	.muted-hint {
		font-size: 0.78rem;
		color: var(--text-muted, #9ca3af);
		margin: 2px 0 0 0;
	}

	.row-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.row-3 {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 12px;
	}

	.checkbox-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 8px;
		max-height: 180px;
		overflow-y: auto;
		background: rgba(0, 0, 0, 0.15);
		padding: 10px;
		border-radius: 6px;
		border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
	}

	.checkbox-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.proj-name {
		font-weight: 500;
	}

	.proj-path {
		font-size: 0.72rem;
		color: var(--text-muted, #9ca3af);
		margin-left: auto;
	}

	.filters-subgroup,
	.env-vars-block,
	.vault-block,
	.additional-triggers-block,
	.quota-policy-block {
		background: rgba(0, 0, 0, 0.12);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
		border-radius: 6px;
		padding: 12px 14px;
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.subgroup-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.small-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: 1px solid var(--line, rgba(255, 255, 255, 0.2));
		color: var(--text-primary, #ffffff);
		padding: 4px 10px;
		border-radius: 4px;
		font-size: 0.76rem;
		cursor: pointer;
	}

	.remove-icon-btn {
		background: transparent;
		border: none;
		color: var(--text-muted, #9ca3af);
		cursor: pointer;
		padding: 4px;
		display: flex;
		align-items: center;
	}

	.remove-icon-btn:hover {
		color: #ef4444;
	}

	.filter-row,
	.key-value-row,
	.add-row {
		display: flex;
		gap: 10px;
		align-items: center;
	}

	.weekday-selector {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.weekday-btn {
		background: var(--bg-secondary, #25252d);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.15));
		color: var(--text-primary, #ffffff);
		border-radius: 4px;
		padding: 6px 12px;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.weekday-btn.selected {
		background: var(--accent, #7c3aed);
		color: #ffffff;
		border-color: var(--accent, #7c3aed);
	}

	.additional-trigger-card {
		background: var(--bg-secondary, #25252d);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		border-radius: 6px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.trigger-card-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.diff-box,
	.preview-box {
		background: rgba(0, 0, 0, 0.15);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		border-radius: 8px;
		padding: 14px 16px;
		margin-bottom: 14px;
	}

	.diff-box h3,
	.preview-box h3 {
		margin: 0 0 10px 0;
		font-size: 0.95rem;
		border: none;
		padding: 0;
	}

	.diff-list {
		margin: 0;
		padding-left: 18px;
		font-size: 0.84rem;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.diff-old {
		color: #ef4444;
		margin: 0 4px;
	}

	.diff-new {
		color: #34d399;
		margin-left: 4px;
	}

	.fact-row {
		display: flex;
		gap: 8px;
		font-size: 0.85rem;
		margin-bottom: 6px;
	}

	.fact-key {
		color: var(--text-muted, #9ca3af);
		min-width: 140px;
	}

	.warning-banner {
		background: rgba(245, 158, 11, 0.12);
		border: 1px solid rgba(245, 158, 11, 0.25);
		color: #fcd34d;
		padding: 10px 14px;
		border-radius: 6px;
		font-size: 0.82rem;
	}

	.banner {
		padding: 10px 14px;
		border-radius: 6px;
		font-size: 0.85rem;
	}

	.error-banner {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	.success-banner {
		background: rgba(16, 185, 129, 0.15);
		color: #6ee7b7;
		border: 1px solid rgba(16, 185, 129, 0.3);
	}

	.wizard-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 14px 24px;
		border-top: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		background: var(--bg-secondary, #25252d);
	}

	.footer-right {
		display: flex;
		gap: 12px;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: 1px solid var(--line, rgba(255, 255, 255, 0.2));
		color: var(--text-primary, #ffffff);
		border-radius: 6px;
		padding: 8px 16px;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.btn-secondary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--accent, #7c3aed);
		color: #ffffff;
		border: none;
		border-radius: 6px;
		padding: 8px 18px;
		font-size: 0.84rem;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-activate {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: #059669;
		color: #ffffff;
		border: none;
		border-radius: 6px;
		padding: 8px 20px;
		font-size: 0.86rem;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-activate:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
