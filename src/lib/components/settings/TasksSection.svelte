<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { invoke } from '@tauri-apps/api/core';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { STANDARD_ROLES } from '$lib/stores/modelSettings.svelte';
	import {
		type TaskDirective,
		type DirectivePlacement,
		getFactoryDirective,
		directiveDisplayName,
		directiveDisplayDescription
	} from '$lib/stores/taskDirectives';
	import {
		IconCheck,
		IconClose,
		IconCopy,
		IconPlus,
		IconRefresh,
		IconRename,
		IconTrash,
		IconWarning,
		IconSkill,
		IconChevronUp,
		IconChevronDown
	} from '$lib/icons';
	import Switch from '$lib/ui/Switch.svelte';
	import PromptField from '$lib/ui/PromptField.svelte';
	import { escapeDismiss } from '$lib/ui/escapeDismiss';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { trayFold } from '$lib/agent/motion';

	// Livelli di thinking supportati nei default dei task
	const THINKING_LEVEL_OPTIONS = [
		{ id: 'auto', label: 'Auto' },
		{ id: 'off', label: 'Off' },
		{ id: 'low', label: 'Low' },
		{ id: 'medium', label: 'Medium' },
		{ id: 'high', label: 'High' },
		{ id: 'max', label: 'Max' }
	];

	const openProjects = $derived(
		projectStore.projects.filter((p) => p.canonicalProjectPath !== null)
	);

	// Ambito selezionato per la configurazione dei default ('global' oppure projectId)
	let selectedScopeId = $state<'global' | string>('global');

	const currentProject = $derived(
		selectedScopeId === 'global' ? null : projectStore.projects.find((p) => p.id === selectedScopeId)
	);

	const isProjectScope = $derived(Boolean(currentProject));

	// Valori effettivi risolti per lo scope selezionato
	const effectiveDefaults = $derived.by(() => {
		if (currentProject && currentProject.taskDefaults) {
			return {
				role: currentProject.taskDefaults.role ?? settingsStore.taskDefaults.role,
				thinkingLevel: currentProject.taskDefaults.thinkingLevel ?? settingsStore.taskDefaults.thinkingLevel,
				includeEditorContext: currentProject.taskDefaults.includeEditorContext ?? settingsStore.taskDefaults.includeEditorContext,
				selectedDirectiveIds: currentProject.taskDefaults.selectedDirectiveIds ?? settingsStore.taskDefaults.selectedDirectiveIds,
				hasOverride: true
			};
		}
		return {
			role: settingsStore.taskDefaults.role,
			thinkingLevel: settingsStore.taskDefaults.thinkingLevel,
			includeEditorContext: settingsStore.taskDefaults.includeEditorContext,
			selectedDirectiveIds: settingsStore.taskDefaults.selectedDirectiveIds,
			hasOverride: false
		};
	});

	// --- Stato Editor Inline Direttiva ---
	let directivePromptField = $state<ReturnType<typeof PromptField> | null>(null);
	let aiPromptField = $state<ReturnType<typeof PromptField> | null>(null);
	let editingDirectiveId = $state<string | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let editTag = $state('');
	let editPrompt = $state('');
	let editPlacement = $state<DirectivePlacement>('before');
	let editFormError = $state<string | null>(null);

	// --- Stato AI Assistant (Generazione & Raffinamento) ---
	let aiMode = $state<'idle' | 'generating' | 'refining' | 'friction'>('idle');
	let aiPromptInput = $state('');
	let aiContextInput = $state('');
	let aiLoading = $state(false);
	let aiError = $state<string | null>(null);

	interface AiProposal {
		id?: string;
		name: string;
		description: string;
		tag: string;
		prompt: string;
		placement: DirectivePlacement;
		reason?: string;
	}

	let currentAiProposal = $state<AiProposal | null>(null);
	let frictionProposals = $state<AiProposal[]>([]);
	let deleteArmedId = $state<string | null>(null);

	async function openCreateForm(focusPrompt = false) {
		editingDirectiveId = 'new';
		editName = '';
		editDescription = '';
		editTag = '';
		editPrompt = '';
		editPlacement = 'before';
		editFormError = null;
		aiMode = 'idle';
		currentAiProposal = null;
		deleteArmedId = null;
		if (focusPrompt) {
			await tick();
			directivePromptField?.focus();
		}
	}

	async function openEditForm(d: TaskDirective, focusPrompt = false) {
		editingDirectiveId = d.id;
		editName = d.name;
		editDescription = d.description;
		editTag = d.tag;
		editPrompt = d.prompt;
		editPlacement = d.placement;
		editFormError = null;
		aiMode = 'idle';
		currentAiProposal = null;
		deleteArmedId = null;
		if (focusPrompt) {
			await tick();
			directivePromptField?.focus();
		}
	}

	function cancelEdit() {
		editingDirectiveId = null;
		editFormError = null;
		aiMode = 'idle';
		currentAiProposal = null;
	}

	function saveDirectiveForm() {
		const name = editName.trim();
		const prompt = editPrompt.trim();
		if (!name) {
			editFormError = m.ui_taskssection_il_nome_della_direttiva_non_puo_essere_74b4();
			return;
		}
		if (!prompt) {
			editFormError = m.ui_taskssection_il_prompt_della_direttiva_non_puo_essere_2869();
			return;
		}

		if (editingDirectiveId === 'new') {
			const newDirective: TaskDirective = {
				id: `dir_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
				name,
				description: editDescription.trim(),
				tag: editTag.trim() || (name.length <= 10 ? name : name.slice(0, 10)),
				prompt,
				placement: editPlacement,
				order: settingsStore.taskDirectives.length * 10 + 10,
				revision: 1
			};
			settingsStore.upsertTaskDirective(newDirective);
		} else if (editingDirectiveId) {
			const existing = settingsStore.taskDirectives.find((d) => d.id === editingDirectiveId);
			if (existing) {
				const updated: TaskDirective = {
					...existing,
					name,
					description: editDescription.trim(),
					tag: editTag.trim() || existing.tag,
					prompt,
					placement: editPlacement
				};
				settingsStore.upsertTaskDirective(updated);
			}
		}

		cancelEdit();
	}

	function duplicateDirective(d: TaskDirective) {
		deleteArmedId = null;
		const copy: TaskDirective = {
			id: `dir_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
			name: m.ui_taskssection_value1_copia_f056({ value1: d.name }),
			description: d.description,
			tag: d.tag ? `${d.tag}-copy` : 'copy',
			prompt: d.prompt,
			placement: d.placement,
			order: d.order + 1,
			revision: 1
		};
		settingsStore.upsertTaskDirective(copy);
	}

	function toggleDirectiveHidden(d: TaskDirective) {
		deleteArmedId = null;
		settingsStore.upsertTaskDirective({
			...d,
			hidden: !d.hidden
		});
	}

	async function resetDirectiveToFactory(d: TaskDirective) {
		if (!d.factoryKey) return;
		settingsStore.resetFactoryDirective(d.factoryKey);
		if (editingDirectiveId === d.id) {
			const restored = getFactoryDirective(d.factoryKey);
			if (restored) {
				editName = restored.name;
				editDescription = restored.description;
				editTag = restored.tag;
				editPrompt = restored.prompt;
				editPlacement = restored.placement;
				await tick();
				directivePromptField?.focus();
			}
		}
	}

	function handleDelete(id: string) {
		if (deleteArmedId === id) {
			settingsStore.deleteTaskDirective(id);
			deleteArmedId = null;
			if (editingDirectiveId === id) cancelEdit();
		} else {
			deleteArmedId = id;
		}
	}

	function moveDirective(id: string, delta: number) {
		deleteArmedId = null;
		const list = [...settingsStore.taskDirectives];
		const index = list.findIndex((d) => d.id === id);
		if (index === -1) return;
		const targetIndex = Math.max(0, Math.min(list.length - 1, index + delta));
		if (targetIndex === index) return;
		const [moved] = list.splice(index, 1);
		list.splice(targetIndex, 0, moved);
		list.forEach((item, idx) => (item.order = (idx + 1) * 10));
		settingsStore.setTaskDirectives(list);
	}

	// --- Gestione Default Scope ---
	function updateScopeRole(role: string) {
		if (currentProject) {
			projectStore.setTaskDefaults(currentProject.id, { role });
		} else {
			settingsStore.patchTaskDefaults({ role });
		}
	}

	function updateScopeThinking(thinkingLevel: string) {
		if (currentProject) {
			projectStore.setTaskDefaults(currentProject.id, { thinkingLevel });
		} else {
			settingsStore.patchTaskDefaults({ thinkingLevel });
		}
	}

	function updateScopeIncludeEditorContext(includeEditorContext: boolean) {
		if (currentProject) {
			projectStore.setTaskDefaults(currentProject.id, { includeEditorContext });
		} else {
			settingsStore.patchTaskDefaults({ includeEditorContext });
		}
	}

	function toggleDefaultDirective(directiveId: string) {
		deleteArmedId = null;
		const currentIds = [...effectiveDefaults.selectedDirectiveIds];
		const index = currentIds.indexOf(directiveId);
		if (index >= 0) {
			currentIds.splice(index, 1);
		} else {
			currentIds.push(directiveId);
		}

		if (currentProject) {
			projectStore.setTaskDefaults(currentProject.id, { selectedDirectiveIds: currentIds });
		} else {
			settingsStore.patchTaskDefaults({ selectedDirectiveIds: currentIds });
		}
	}

	function resetProjectScopeDefaults() {
		if (currentProject) {
			projectStore.setTaskDefaults(currentProject.id, null);
		}
	}

	// --- Azioni AI ---
	async function runGenerateAi() {
		if (!aiPromptInput.trim()) {
			aiError = m.settings_tasks_err_describe();
			return;
		}
		aiLoading = true;
		aiError = null;
		currentAiProposal = null;
		try {
			const res = await invoke<AiProposal>('generate_task_directive_ai', {
				topic: aiPromptInput.trim(),
				context: aiContextInput.trim() || null,
				modelSelector: null
			});
			currentAiProposal = res;
		} catch (err) {
			aiError = m.settings_tasks_err_generate({ error: String(err) });
		} finally {
			aiLoading = false;
		}
	}

	async function runRefineAi() {
		aiLoading = true;
		aiError = null;
		currentAiProposal = null;
		try {
			const dto = {
				id: editingDirectiveId ?? 'custom',
				name: editName.trim(),
				description: editDescription.trim(),
				tag: editTag.trim(),
				prompt: editPrompt.trim(),
				placement: editPlacement,
				order: 10,
				revision: 1
			};
			const res = await invoke<AiProposal>('refine_task_directive_ai', {
				directive: dto,
				feedback: aiPromptInput.trim(),
				modelSelector: null
			});
			currentAiProposal = res;
		} catch (err) {
			aiError = m.settings_tasks_err_refine({ error: String(err) });
		} finally {
			aiLoading = false;
		}
	}

	async function runAnalyzeFriction() {
		const targetProject = currentProject ?? openProjects[0];
		if (!targetProject || !targetProject.canonicalProjectPath) {
			aiError = m.settings_tasks_err_no_project();
			return;
		}
		aiMode = 'friction';
		aiLoading = true;
		aiError = null;
		frictionProposals = [];
		try {
			const res = await invoke<AiProposal[]>('analyze_task_directives_friction', {
				projectPath: targetProject.canonicalProjectPath,
				existingDirectives: settingsStore.taskDirectives,
				modelSelector: null
			});
			frictionProposals = res;
			if (frictionProposals.length === 0) {
				aiError = m.settings_tasks_err_no_friction();
			}
		} catch (err) {
			aiError = m.settings_tasks_err_friction({ error: String(err) });
		} finally {
			aiLoading = false;
		}
	}

	async function applyAiProposalToForm(proposal: AiProposal) {
		editName = proposal.name;
		editDescription = proposal.description;
		editTag = proposal.tag;
		editPrompt = proposal.prompt;
		editPlacement = proposal.placement;
		aiMode = 'idle';
		currentAiProposal = null;
		await tick();
		directivePromptField?.focus();
	}

	async function startGeneratingAi() {
		await openCreateForm();
		aiMode = 'generating';
		aiPromptInput = '';
		await tick();
		aiPromptField?.focus();
	}

	async function startRefiningAi() {
		aiMode = 'refining';
		aiPromptInput = '';
		aiError = null;
		await tick();
		aiPromptField?.focus();
	}

	function applyProposalAsNewDirective(proposal: AiProposal) {
		const newDirective: TaskDirective = {
			id: `dir_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
			name: proposal.name,
			description: proposal.description,
			tag: proposal.tag || 'AI',
			prompt: proposal.prompt,
			placement: proposal.placement,
			order: settingsStore.taskDirectives.length * 10 + 10,
			revision: 1
		};
		settingsStore.upsertTaskDirective(newDirective);
		// Rimuovi la proposta dalla coda delle ricorrenze se presente
		frictionProposals = frictionProposals.filter((p) => p !== proposal);
		if (frictionProposals.length === 0 && aiMode === 'friction') {
			aiMode = 'idle';
		}
	}

	function dismissFrictionProposal(proposal: AiProposal) {
		frictionProposals = frictionProposals.filter((p) => p !== proposal);
		if (frictionProposals.length === 0) {
			aiMode = 'idle';
		}
	}
</script>

<div class="settings-section">
	<!-- Blocco 1: Ambito e Valori Predefiniti dei Nuovi Task -->
	<div class="section-block">
		<div class="block-header-row">
			<span class="block-title">{m.settings_tasks_scope_title()}</span>
			{#if isProjectScope}
				<div class="scope-indicator-row">
					<span class="scope-pill project">{m.settings_tasks_scope_project_pill({ name: currentProject?.name ?? '' })}</span>
					{#if effectiveDefaults.hasOverride}
						<button type="button" class="btn-reset-scope" onclick={resetProjectScopeDefaults}>
							{m.ui_taskssection_ripristina_ereditarieta_312c()}
						</button>
					{/if}
				</div>
			{:else}
				<span class="scope-pill global">{m.settings_tasks_scope_global_pill()}</span>
			{/if}
		</div>

		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<label for="tasks-scope-select" id="tasks-scope-label" class="form-row-label">{m.settings_tasks_scope_label()}</label>
					<span id="tasks-scope-desc" class="form-row-desc">{m.ui_taskssection_modifica_i_valori_globali_di_default_o_8c48()}</span>
				</div>
				<div class="form-row-control">
					<select
						id="tasks-scope-select"
						class="ui-select"
						value={selectedScopeId}
						aria-labelledby="tasks-scope-label"
						aria-describedby="tasks-scope-desc"
						onchange={(e) => (selectedScopeId = (e.currentTarget as HTMLSelectElement).value)}
					>
						<option value="global">{m.settings_tasks_scope_global_option()}</option>
						{#if openProjects.length > 0}
							<optgroup label={m.settings_tasks_scope_open_projects()}>
								{#each openProjects as p (p.id)}
									<option value={p.id}>{p.label || p.name}</option>
								{/each}
							</optgroup>
						{/if}
					</select>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<label for="tasks-initial-role-select" id="tasks-initial-role-label" class="form-row-label">{m.settings_tasks_initial_role()}</label>
					<span id="tasks-initial-role-desc" class="form-row-desc">{m.ui_taskssection_profilo_e_modello_assegnato_ai_nuovi_task_13f1()}</span>
				</div>
				<div class="form-row-control">
					<select
						id="tasks-initial-role-select"
						class="ui-select"
						value={effectiveDefaults.role}
						aria-labelledby="tasks-initial-role-label"
						aria-describedby="tasks-initial-role-desc"
						onchange={(e) => updateScopeRole((e.currentTarget as HTMLSelectElement).value)}
					>
						{#each STANDARD_ROLES as r (r.id)}
							<option value={r.id}>{r.label}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<label for="tasks-thinking-select" id="tasks-thinking-label" class="form-row-label">{m.settings_tasks_thinking_label()}</label>
					<span id="tasks-thinking-desc" class="form-row-desc">{m.ui_taskssection_sforzo_di_pensiero_predefinito_inviato_al_modello_c8f1()}</span>
				</div>
				<div class="form-row-control">
					<select
						id="tasks-thinking-select"
						class="ui-select"
						value={effectiveDefaults.thinkingLevel}
						aria-labelledby="tasks-thinking-label"
						aria-describedby="tasks-thinking-desc"
						onchange={(e) => updateScopeThinking((e.currentTarget as HTMLSelectElement).value)}
					>
						{#each THINKING_LEVEL_OPTIONS as t (t.id)}
							<option value={t.id}>{t.label}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span id="tasks-editor-ctx-label" class="form-row-label">{m.settings_tasks_editor_ctx_label()}</span>
					<span id="tasks-editor-ctx-desc" class="form-row-desc">{m.settings_tasks_editor_ctx_desc()}</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="tasks-editor-ctx"
						checked={effectiveDefaults.includeEditorContext}
						ariaLabelledBy="tasks-editor-ctx-label"
						ariaDescribedBy="tasks-editor-ctx-desc"
						onChange={(checked) => updateScopeIncludeEditorContext(checked)}
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- Titoli dei task in coda: preferenza globale, non per progetto -->
	<div class="section-block">
		<div class="block-header-row">
			<span class="block-title">{m.settings_task_titles_block_title()}</span>
		</div>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span id="tasks-auto-titles-label" class="form-row-label">{m.settings_task_titles_auto_label()}</span>
					<span id="tasks-auto-titles-desc" class="form-row-desc">{m.settings_task_titles_auto_desc()}</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="tasks-auto-titles"
						checked={settingsStore.taskTitles.autoGenerate}
						ariaLabelledBy="tasks-auto-titles-label"
						ariaDescribedBy="tasks-auto-titles-desc"
						onChange={(checked) => settingsStore.patchTaskTitles({ autoGenerate: checked })}
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- Blocco 2: Catalogo Direttive dei Task & Selezione Predefinita -->
	<div class="section-block">
		<div class="directives-header">
			<div class="header-left">
				<span class="block-title">{m.ui_taskssection_libreria_direttive_modalita_del_task_0c5a()}</span>
				<p class="section-subtitle">
					{m.settings_tasks_directives_subtitle({ scope: (isProjectScope ? currentProject?.name : undefined) ?? m.settings_tasks_scope_global_name() })}
				</p>
			</div>
			<div class="header-actions">
				<button type="button" class="ui-button ui-button-primary" onclick={() => openCreateForm(true)} disabled={editingDirectiveId !== null}>
					<IconPlus />
					<span>{m.settings_tasks_new_directive()}</span>
				</button>
				<Tooltip text={m.settings_tasks_generate_tooltip()}>
					<button
						type="button"
						class="ui-button ui-button-secondary"
						onclick={startGeneratingAi}
						disabled={editingDirectiveId !== null}
					>
						<IconSkill />
						<span>{m.settings_tasks_generate_ai_btn()}</span>
					</button>
				</Tooltip>
				{#if openProjects.length > 0}
					<Tooltip text={m.settings_tasks_analyze_tooltip()}>
						<button
							type="button"
							class="ui-button ui-button-secondary"
							onclick={runAnalyzeFriction}
							disabled={aiLoading}
						>
							<IconWarning />
							<span>{m.settings_tasks_analyze_recurrences_btn()}</span>
						</button>
					</Tooltip>
				{/if}
			</div>
		</div>

		<!-- Pannello Risultati Analisi Ricorrenze (Friction) -->
		{#if aiMode === 'friction'}
			<div class="ai-friction-panel" transition:trayFold role="region" aria-label={m.settings_tasks_friction_aria()}>
				<div class="panel-top">
					<div class="panel-title-wrap">
						<StatusMark status="attention" active={false} label={m.settings_tasks_friction_mark()} />
						<span class="panel-title">{m.settings_tasks_friction_title()}</span>
					</div>
					<button type="button" class="btn-icon-close" onclick={() => (aiMode = 'idle')} aria-label={m.common_close()}>
						<IconClose />
					</button>
				</div>
				{#if aiLoading}
					<div class="ai-loading-state">
						<StatusMark status="running" />
						<span>{m.ui_taskssection_analisi_dello_storico_prompt_del_progetto_in_13b6()}</span>
					</div>
				{:else if aiError}
					<div class="ai-msg error">{aiError}</div>
				{:else if frictionProposals.length > 0}
					<div class="proposals-list">
						{#each frictionProposals as proposal, pIdx (pIdx)}
							<div class="proposal-card">
								<div class="proposal-head">
									<span class="proposal-name">{proposal.name}</span>
									<span class="proposal-tag">{proposal.tag}</span>
									<span class="proposal-placement">{proposal.placement === 'before' ? m.settings_tasks_placement_before_short() : m.settings_tasks_placement_after_short()}</span>
								</div>
								{#if proposal.reason}
									<p class="proposal-reason">{proposal.reason}</p>
								{/if}
								<pre class="proposal-prompt">{proposal.prompt}</pre>
								<div class="proposal-actions">
									<button type="button" class="ui-button ui-button-primary" onclick={() => applyProposalAsNewDirective(proposal)}>
										<IconCheck />
										<span>{m.settings_tasks_add_to_library()}</span>
									</button>
									<button type="button" class="ui-button ui-button-ghost" onclick={() => { openCreateForm(); applyAiProposalToForm(proposal); }}>
										<IconRename />
										<span>{m.ui_taskssection_modifica_e_aggiungi_711d()}</span>
									</button>
									<button type="button" class="ui-button ui-button-ghost" onclick={() => dismissFrictionProposal(proposal)}>
										<IconClose />
										<span>{m.settings_tasks_ignore()}</span>
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Editor Inline / Form Creazione o Modifica -->
		{#if editingDirectiveId !== null}
			<div
				class="inline-editor-card"
				transition:trayFold
				role="region"
				aria-label={m.settings_tasks_editor_aria()}
				use:escapeDismiss={cancelEdit}
			>
				<div class="editor-header">
					<span class="editor-title">{editingDirectiveId === 'new' ? m.ui_taskssection_crea_nuova_direttiva_9717() : m.ui_taskssection_modifica_direttiva_dcc7()}</span>
					<button type="button" class="btn-icon-close" onclick={cancelEdit} aria-label={m.common_cancel()}>
						<IconClose />
					</button>
				</div>

				{#if aiMode === 'generating' || aiMode === 'refining'}
					<div class="ai-assistant-box" transition:trayFold>
						<div class="assistant-head">
							<IconSkill />
							<span>{aiMode === 'generating' ? m.settings_tasks_ai_generate_head() : m.settings_tasks_ai_refine_head()}</span>
						</div>
						<div class="assistant-body">
							<div class="form-field">
								<span class="field-label">
									{aiMode === 'generating' ? m.ui_taskssection_descrivi_cosa_deve_fare_o_imporre_questa_9573() : m.ui_taskssection_istruzioni_opzionali_per_il_miglioramento_es_rendilo_0a16()}
								</span>
								<PromptField
									bind:this={aiPromptField}
									bind:value={aiPromptInput}
									placeholder={aiMode === 'generating' ? m.settings_tasks_ai_generate_placeholder() : m.ui_taskssection_es_rendi_il_prompt_piu_sintetico_ed_bc8e()}
									ariaLabel={aiMode === 'generating' ? m.ui_taskssection_descrivi_cosa_deve_fare_o_imporre_questa_9573() : m.ui_taskssection_istruzioni_opzionali_per_il_miglioramento_es_rendilo_0a16()}
									onSubmit={aiMode === 'generating' ? runGenerateAi : runRefineAi}
									onCancel={() => { aiMode = 'idle'; currentAiProposal = null; }}
								/>
							</div>

							{#if aiMode === 'generating'}
								<div class="form-field">
									<label for="ai-context-input" class="field-label">{m.settings_tasks_ai_context_label()}</label>
									<input
										id="ai-context-input"
										type="text"
										class="ui-input"
										bind:value={aiContextInput}
										placeholder={m.settings_tasks_ai_context_placeholder()}
									/>
								</div>
							{/if}

							<div class="assistant-actions">
								<button
									type="button"
									class="ui-button ui-button-primary"
									onclick={aiMode === 'generating' ? runGenerateAi : runRefineAi}
									disabled={aiLoading}
								>
									{#if aiLoading}
										<StatusMark status="running" />
										<span>{m.settings_processing()}</span>
									{:else}
										<IconSkill />
										<span>{aiMode === 'generating' ? m.settings_tasks_ai_generate_btn() : m.settings_tasks_ai_refine_btn()}</span>
									{/if}
								</button>
								<button type="button" class="ui-button ui-button-secondary" onclick={() => { aiMode = 'idle'; currentAiProposal = null; }}>
									{m.ui_taskssection_chiudi_assistente_dfa2()}
								</button>
							</div>

							{#if aiError}
								<div class="ai-msg error">{aiError}</div>
							{/if}

							{#if currentAiProposal}
								<div class="ai-proposal-preview">
									<div class="preview-head">
										<span class="preview-title">{m.settings_tasks_ai_proposal_title()}</span>
										{#if currentAiProposal.reason}
											<span class="preview-reason">{currentAiProposal.reason}</span>
										{/if}
									</div>
									<div class="preview-fields">
										<div class="preview-field"><strong>{m.settings_tasks_ai_proposal_name()}</strong> {currentAiProposal.name} · <strong>{m.settings_tasks_ai_proposal_tag()}</strong> {currentAiProposal.tag} · <strong>{m.settings_tasks_ai_proposal_placement()}</strong> {currentAiProposal.placement === 'before' ? m.settings_tasks_ai_proposal_before() : m.settings_tasks_ai_proposal_after()}</div>
										<div class="preview-field"><strong>{m.settings_tasks_ai_proposal_description()}</strong> {currentAiProposal.description}</div>
										<div class="preview-prompt-box">
											<pre>{currentAiProposal.prompt}</pre>
										</div>
									</div>
									<div class="preview-actions">
										<button type="button" class="ui-button ui-button-primary" onclick={() => applyAiProposalToForm(currentAiProposal!)}>
											<IconCheck />
											<span>{m.settings_tasks_apply_to_form()}</span>
										</button>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<div class="editor-fields-grid">
					<div class="form-field">
						<label for="edit-directive-name" class="field-label">{m.settings_tasks_field_name()}</label>
						<input
							id="edit-directive-name"
							type="text"
							class="ui-input"
							bind:value={editName}
							placeholder={m.ui_taskssection_es_verifica_rigorosa_30e1()}
						/>
					</div>

					<div class="form-field">
						<label for="edit-directive-tag" class="field-label">{m.settings_tasks_field_tag()}</label>
						<input
							id="edit-directive-tag"
							type="text"
							class="ui-input"
							bind:value={editTag}
							placeholder={m.settings_tasks_field_tag_placeholder()}
						/>
					</div>

					<div class="form-field full">
						<label for="edit-directive-desc" class="field-label">{m.settings_tasks_field_desc()}</label>
						<input
							id="edit-directive-desc"
							type="text"
							class="ui-input"
							bind:value={editDescription}
							placeholder={m.ui_taskssection_spiega_sinteticamente_cosa_impone_la_modalita_2fa8()}
						/>
					</div>

					<div class="form-field full">
						<span class="field-label">{m.settings_tasks_field_placement()}</span>
						<div class="placement-radios">
							<label class="radio-label">
								<input type="radio" name="placement" value="before" bind:group={editPlacement} />
								<span>{m.settings_tasks_placement_before_long()}</span>
							</label>
							<label class="radio-label">
								<input type="radio" name="placement" value="after" bind:group={editPlacement} />
								<span>{m.settings_tasks_placement_after_long()}</span>
							</label>
						</div>
					</div>

					<div class="form-field full">
						<div class="field-label-row">
							<span class="field-label">{m.settings_tasks_field_prompt()}</span>
							{#if aiMode === 'idle'}
								<Tooltip text={m.settings_tasks_refine_tooltip()}>
									<button
										type="button"
										class="ui-button ui-button-ghost"
										onclick={startRefiningAi}
									>
										<IconSkill />
										<span>{m.settings_tasks_improve_ai_btn()}</span>
									</button>
								</Tooltip>
							{/if}
						</div>
						<PromptField
							bind:this={directivePromptField}
							bind:value={editPrompt}
							placeholder={m.settings_tasks_prompt_placeholder()}
							ariaLabel={m.settings_tasks_field_prompt()}
							onSubmit={saveDirectiveForm}
							onCancel={cancelEdit}
						/>
					</div>
				</div>

				{#if editFormError}
					<div class="ai-msg error">{editFormError}</div>
				{/if}

				<div class="editor-footer">
					<div class="footer-left">
						<button type="button" class="ui-button ui-button-primary" onclick={saveDirectiveForm}>
							<IconCheck />
							<span>{m.settings_tasks_save_directive()}</span>
						</button>
						<button type="button" class="ui-button ui-button-secondary" onclick={cancelEdit}>
							{m.common_cancel()}
						</button>
					</div>

					{#if editingDirectiveId !== 'new'}
						{@const currentDir = settingsStore.taskDirectives.find((d) => d.id === editingDirectiveId)}
						{#if currentDir?.factoryKey}
							<button type="button" class="ui-button ui-button-ghost text-warn" onclick={() => resetDirectiveToFactory(currentDir)}>
								<IconRefresh />
								<span>{m.settings_factory_reset()}</span>
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/if}

		<!-- Elenco Direttive a Righe Dense -->
		<div class="directives-list" role="list" aria-label={m.settings_tasks_list_aria()}>
			{#each settingsStore.taskDirectives as d, idx (d.id)}
				{@const isDefault = effectiveDefaults.selectedDirectiveIds.includes(d.id)}
				<div
					class="directive-row"
					class:hidden-dir={d.hidden}
					class:ui-selected={editingDirectiveId === d.id}
					role="listitem"
				>
					<!-- Switch di attivazione default -->
					<div class="col-checkbox">
						<Tooltip text={m.settings_tasks_default_for_tooltip({ scope: (isProjectScope ? currentProject?.name : undefined) ?? m.settings_tasks_scope_global_name() })}>
							<Switch
								id={`dir-default-${d.id}`}
								checked={isDefault}
								onChange={() => toggleDefaultDirective(d.id)}
								ariaLabel={m.settings_tasks_default_for_aria({ name: directiveDisplayName(d), scope: (isProjectScope ? currentProject?.name : undefined) ?? m.settings_tasks_scope_global_name() })}
							/>
						</Tooltip>
					</div>

					<!-- Riordino -->
					<div class="col-order">
						<Tooltip text={m.settings_move_up()}>
							<button
								type="button"
								class="order-btn"
								disabled={idx === 0}
								onclick={() => moveDirective(d.id, -1)}
								aria-label={m.settings_move_up()}
							>
								<IconChevronUp />
							</button>
						</Tooltip>
						<Tooltip text={m.ui_suggestionssection_sposta_giu_10cf()}>
							<button
								type="button"
								class="order-btn"
								disabled={idx === settingsStore.taskDirectives.length - 1}
								onclick={() => moveDirective(d.id, 1)}
								aria-label={m.ui_suggestionssection_sposta_giu_10cf()}
							>
								<IconChevronDown />
							</button>
						</Tooltip>
					</div>

					<!-- Info Direttiva -->
					<div class="col-main">
						<div class="row-top">
							<span class="dir-name">{directiveDisplayName(d)}</span>
							{#if d.factoryKey}
								<span class="factory-pill">{m.settings_preset_pill()}</span>
							{/if}
							{#if d.placement === 'after'}
								<span class="placement-pill after">{m.settings_tasks_pill_after()}</span>
							{:else}
								<span class="placement-pill before">{m.settings_tasks_pill_before()}</span>
							{/if}
							{#if d.tag}
								<span class="tag-pill">{d.tag}</span>
							{/if}
							{#if d.hidden}
								<span class="hidden-pill">{m.settings_tasks_hidden_pill()}</span>
							{/if}
						</div>
						<p class="dir-desc">{directiveDisplayDescription(d) || d.prompt}</p>
					</div>

					<!-- Azioni sulla riga -->
					<div class="col-actions">
						<Tooltip text={m.ui_taskssection_modifica_direttiva_dcc7()}>
							<button
								type="button"
								class="btn-row-action"
								onclick={() => openEditForm(d)}
								aria-label={m.ui_taskssection_modifica_direttiva_dcc7()}
							>
								<IconRename />
							</button>
						</Tooltip>
						<Tooltip text={m.settings_tasks_duplicate()}>
							<button
								type="button"
								class="btn-row-action"
								onclick={() => duplicateDirective(d)}
								aria-label={m.settings_tasks_duplicate()}
							>
								<IconCopy />
							</button>
						</Tooltip>
						<Tooltip text={d.hidden ? m.ui_taskssection_mostra_nei_nuovi_task_ea98() : m.ui_taskssection_nascondi_dai_nuovi_task_3cad()}>
							<button
								type="button"
								class="btn-row-action"
								class:active-hidden={d.hidden}
								onclick={() => toggleDirectiveHidden(d)}
								aria-label={d.hidden ? m.ui_taskssection_mostra_nei_nuovi_task_ea98() : m.ui_taskssection_nascondi_dai_nuovi_task_3cad()}
							>
								{d.hidden ? m.ui_suggestionssection_mostra_4e74() : m.ui_usermessage_nascondi_82ca()}
							</button>
						</Tooltip>
						{#if d.factoryKey}
							<Tooltip text={m.settings_factory_reset_tooltip()}>
								<button
									type="button"
									class="btn-row-action"
									onclick={() => resetDirectiveToFactory(d)}
									aria-label={m.settings_factory_reset_tooltip()}
								>
									<IconRefresh />
								</button>
							</Tooltip>
						{:else}
							<Tooltip text={deleteArmedId === d.id ? m.settings_delete_click_again() : m.ui_taskssection_elimina_direttiva_ca0d()}>
								<button
									type="button"
									class="btn-row-action danger"
									class:ui-button-danger={deleteArmedId === d.id}
									class:armed={deleteArmedId === d.id}
									onclick={() => handleDelete(d.id)}
									aria-label={deleteArmedId === d.id ? m.ui_suggestionssection_conferma_eliminazione_7049() : m.ui_taskssection_elimina_direttiva_ca0d()}
								>
									{#if deleteArmedId === d.id}
										<span>{m.settings_delete_armed()}</span>
									{:else}
										<IconTrash />
									{/if}
								</button>
							</Tooltip>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Blocco 3: Progetti Aperti & Auto-Dispatch (invariante preservato) -->
	<div class="section-block">
		<span class="block-title">{m.settings_tasks_autodispatch_title()}</span>
		{#if openProjects.length === 0}
			<p class="empty-note">{m.settings_tasks_no_open_projects()}</p>
		{:else}
			<div class="section-group">
				{#each openProjects as p (p.id)}
					<div class="project-row">
						<div class="form-row-copy">
							<span id={`project-autodispatch-label-${p.id}`} class="form-row-label">{p.label || p.name}</span>
							<span id={`project-autodispatch-desc-${p.id}`} class="form-row-desc">{m.ui_taskssection_avvia_automaticamente_il_prossimo_task_in_coda_2e2a()}</span>
							{#if p.taskDefaults}
								<button type="button" class="override-reset" onclick={() => projectStore.setTaskDefaults(p.id, null)}>
									{m.ui_taskssection_default_personalizzati_attivi_ripristina_ereditarieta_ca4a()}
								</button>
							{/if}
						</div>
						<div class="form-row-control">
							<Switch
								id={`project-autodispatch-${p.id}`}
								checked={p.autoDispatch}
								ariaLabelledBy={`project-autodispatch-label-${p.id}`}
								ariaDescribedBy={`project-autodispatch-desc-${p.id}`}
								onChange={(checked) => projectStore.setAutoDispatch(p.id, checked)}
							/>
						</div>
					</div>
					{#if !p.labDraft}
						<!-- Toggle ripresa automatica sessione worktree per progetti Git -->
						<div class="project-row project-subrow">
							<div class="form-row-copy">
								<span id={`project-resume-chat-desc-${p.id}`} class="form-row-desc">{m.lanestrip_worktree_resume_chat_desc()}</span>
							</div>
							<div class="form-row-control">
								<Switch
									id={`project-resume-chat-${p.id}`}
									checked={p.worktreeResumeChat ?? true}
									ariaLabel={m.lanestrip_resume_chat()}
									ariaDescribedBy={`project-resume-chat-desc-${p.id}`}
									onChange={(checked) => projectStore.setWorktreeResumeChat(p.id, checked)}
								/>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.block-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
	}

	.section-subtitle {
		margin: 2px 0 0 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.scope-indicator-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.scope-pill {
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		font-family: var(--font-mono);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.scope-pill.project {
		background: color-mix(in oklab, var(--brand) 10%, var(--bg-sunken));
		border-color: color-mix(in oklab, var(--brand) 30%, var(--line));
		color: var(--brand-ink);
	}

	.btn-reset-scope {
		font-size: var(--text-caption);
		color: var(--warn);
		background: transparent;
		border: none;
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
	}

	.section-group {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
		gap: var(--space-3);
	}

	.form-row:last-child {
		border-bottom: none;
	}

	.form-row-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.form-row-label {
		font-size: var(--text-body);
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.35;
	}

	.form-row-control {
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.form-row-control :global(.ui-select) {
		min-width: 220px;
	}

	/* Directives Header */
	.directives-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.header-left {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	/* Directives List */
	.directives-list {
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.directive-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid transparent;
		border-bottom-color: var(--line);
		border-radius: var(--radius-md);
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.directive-row:last-child {
		border-bottom-color: transparent;
	}

	.directive-row:hover:not(.ui-selected) {
		background: var(--bg-hover);
	}

	.directive-row.hidden-dir {
		opacity: 0.6;
	}

	.col-checkbox {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.col-order {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex-shrink: 0;
	}

	.order-btn {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		min-width: 20px;
		min-height: 20px;
		padding: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.order-btn:hover:not(:disabled) {
		background: var(--bg-sunken);
		border-color: var(--line);
		color: var(--ink);
	}

	.order-btn:disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	.col-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.row-top {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.dir-name {
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--ink);
	}

	.factory-pill {
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}

	.placement-pill {
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
	}

	.placement-pill.before {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.placement-pill.after {
		background: color-mix(in oklab, var(--brand) 12%, var(--bg-sunken));
		border: 1px solid color-mix(in oklab, var(--brand) 30%, var(--line));
		color: var(--brand-ink);
	}

	.tag-pill {
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}

	.hidden-pill {
		font-size: var(--text-caption);
		color: var(--warn);
		font-style: italic;
	}

	.dir-desc {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.col-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.btn-row-action {
		font-size: var(--text-caption);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		padding: 3px 6px;
		min-height: 24px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.btn-row-action:hover {
		background: var(--bg-sunken);
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-row-action.active-hidden {
		color: var(--warn);
	}

	.btn-row-action.danger {
		color: var(--ink-muted);
	}

	.btn-row-action.danger:hover:not(.armed) {
		background: color-mix(in oklab, var(--danger) 12%, var(--bg-raised));
		border-color: var(--danger);
		color: var(--danger);
	}

	.btn-row-action.danger.armed {
		background: var(--danger);
		border-color: var(--danger);
		color: var(--on-danger);
		font-weight: 600;
		padding: 0 8px;
	}

	/* Inline Editor Card */
	.inline-editor-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
	}

	.editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.editor-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.btn-icon-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		padding: 0;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.btn-icon-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.editor-fields-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2) var(--space-3);
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.form-field.full {
		grid-column: 1 / -1;
	}

	.field-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.field-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}


	.placement-radios {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 4px 0;
	}

	.radio-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-label);
		color: var(--ink);
		cursor: pointer;
	}

	.editor-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--line);
	}

	.footer-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.text-warn {
		color: var(--warn);
	}

	/* AI Assistant Box */
	.ai-assistant-box {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: color-mix(in oklab, var(--brand) 6%, var(--bg-sunken));
		border: 1px solid color-mix(in oklab, var(--brand) 30%, var(--line));
		border-radius: var(--radius-md);
	}

	.assistant-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--brand-ink);
	}

	.assistant-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.assistant-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.ai-proposal-preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		margin-top: var(--space-2);
	}

	.preview-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.preview-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--brand-ink);
	}

	.preview-reason {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		font-style: italic;
	}

	.preview-fields {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-caption);
		color: var(--ink);
	}

	.preview-prompt-box pre {
		margin: 4px 0 0 0;
		padding: 6px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-ui);
		font-size: var(--text-chat);
		line-height: 24px;
		white-space: pre-wrap;
		color: var(--ink-muted);
	}

	.preview-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	/* AI Friction Panel */
	.ai-friction-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		margin-bottom: var(--space-2);
	}

	.panel-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.panel-title-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ink);
	}

	.panel-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.proposals-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.proposal-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.proposal-head {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.proposal-name {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.proposal-tag {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		padding: 1px 4px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}

	.proposal-placement {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		text-transform: uppercase;
	}

	.proposal-reason {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.proposal-prompt {
		margin: 2px 0 0 0;
		padding: 6px 8px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		white-space: pre-wrap;
		color: var(--ink-muted);
	}

	.proposal-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-top: 4px;
	}

	.ai-msg.error {
		font-size: var(--text-caption);
		color: var(--danger);
		background: color-mix(in oklab, var(--danger) 10%, var(--bg-raised));
		border: 1px solid var(--danger);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}

	.ai-loading-state {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		padding: var(--space-2) 0;
	}

	.project-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
		gap: var(--space-3);
	}

	.project-row:last-child {
		border-bottom: none;
	}

	.project-subrow {
		padding-left: var(--space-4);
		background-color: color-mix(in oklab, var(--bg-raised) 25%, transparent);
	}

	.override-reset {
		font-size: var(--text-caption);
		color: var(--warn);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: 0;
		text-decoration: underline;
	}

	.empty-note {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		margin: 0;
	}

	@media (max-width: 600px) {
		.editor-fields-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
