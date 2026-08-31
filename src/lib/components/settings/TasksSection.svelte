<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { STANDARD_ROLES } from '$lib/stores/modelSettings.svelte';
	import {
		type TaskDirective,
		type DirectivePlacement,
		getFactoryDirective
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
		IconArrowRight
	} from '$lib/icons';

	// Livelli di thinking supportati nei default dei task
	const THINKING_LEVEL_OPTIONS = [
		{ id: 'auto', label: 'Auto' },
		{ id: 'off', label: 'Off' },
		{ id: 'low', label: 'Low' },
		{ id: 'medium', label: 'Medium' },
		{ id: 'high', label: 'High' },
		{ id: 'max', label: 'Max' }
	];

	const openProjects = $derived(projectStore.projects.filter((p) => p.path !== ''));

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

	function openCreateForm() {
		editingDirectiveId = 'new';
		editName = '';
		editDescription = '';
		editTag = '';
		editPrompt = '';
		editPlacement = 'before';
		editFormError = null;
		aiMode = 'idle';
		currentAiProposal = null;
	}

	function openEditForm(d: TaskDirective) {
		editingDirectiveId = d.id;
		editName = d.name;
		editDescription = d.description;
		editTag = d.tag;
		editPrompt = d.prompt;
		editPlacement = d.placement;
		editFormError = null;
		aiMode = 'idle';
		currentAiProposal = null;
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
			editFormError = 'Il nome della direttiva non può essere vuoto.';
			return;
		}
		if (!prompt) {
			editFormError = 'Il prompt della direttiva non può essere vuoto.';
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
		const copy: TaskDirective = {
			id: `dir_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
			name: `${d.name} (Copia)`,
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
		settingsStore.upsertTaskDirective({
			...d,
			hidden: !d.hidden
		});
	}

	function resetDirectiveToFactory(d: TaskDirective) {
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
			aiError = 'Descrivi lo scopo della direttiva da generare.';
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
			aiError = `Generazione AI non riuscita: ${String(err)}`;
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
			aiError = `Miglioramento AI non riuscito: ${String(err)}`;
		} finally {
			aiLoading = false;
		}
	}

	async function runAnalyzeFriction() {
		const targetProject = currentProject ?? openProjects[0];
		if (!targetProject || !targetProject.path) {
			aiError = 'Nessun progetto aperto disponibile per analizzare i prompt recenti.';
			return;
		}
		aiMode = 'friction';
		aiLoading = true;
		aiError = null;
		frictionProposals = [];
		try {
			const res = await invoke<AiProposal[]>('analyze_task_directives_friction', {
				projectPath: targetProject.path,
				existingDirectives: settingsStore.taskDirectives,
				modelSelector: null
			});
			frictionProposals = res;
			if (frictionProposals.length === 0) {
				aiError = 'Nessuno schema di attrito ricorrente rilevato nei prompt recenti.';
			}
		} catch (err) {
			aiError = `Analisi attrito non riuscita: ${String(err)}`;
		} finally {
			aiLoading = false;
		}
	}

	function applyAiProposalToForm(proposal: AiProposal) {
		editName = proposal.name;
		editDescription = proposal.description;
		editTag = proposal.tag;
		editPrompt = proposal.prompt;
		editPlacement = proposal.placement;
		aiMode = 'idle';
		currentAiProposal = null;
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
			<span class="block-title">Ambito & Configurazione di avvio dei task</span>
			{#if isProjectScope}
				<div class="scope-indicator-row">
					<span class="scope-pill project">Progetto: {currentProject?.name}</span>
					{#if effectiveDefaults.hasOverride}
						<button type="button" class="btn-reset-scope" onclick={resetProjectScopeDefaults}>
							Ripristina ereditarietà
						</button>
					{/if}
				</div>
			{:else}
				<span class="scope-pill global">Default Globali</span>
			{/if}
		</div>

		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Ambito di configurazione</span>
					<span class="form-row-desc">Modifica i valori globali di default o personalizza l'avvio per un repository aperto.</span>
				</div>
				<div class="form-row-control">
					<select
						value={selectedScopeId}
						onchange={(e) => (selectedScopeId = (e.currentTarget as HTMLSelectElement).value)}
					>
						<option value="global">Default globali (tutti i progetti)</option>
						{#if openProjects.length > 0}
							<optgroup label="Progetti aperti">
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
					<span class="form-row-label">Ruolo iniziale</span>
					<span class="form-row-desc">Profilo e modello assegnato ai nuovi task appena creati.</span>
				</div>
				<div class="form-row-control">
					<select
						value={effectiveDefaults.role}
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
					<span class="form-row-label">Livello di ragionamento (Thinking)</span>
					<span class="form-row-desc">Sforzo di pensiero predefinito inviato al modello.</span>
				</div>
				<div class="form-row-control">
					<select
						value={effectiveDefaults.thinkingLevel}
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
					<span class="form-row-label">Includi contesto editor</span>
					<span class="form-row-desc">Allega l'elenco dei file correntemente aperti e la selezione attiva nell'editor Monaco.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={effectiveDefaults.includeEditorContext}
							onchange={(e) => updateScopeIncludeEditorContext((e.currentTarget as HTMLInputElement).checked)}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>
		</div>
	</div>

	<!-- Blocco 2: Catalogo Direttive dei Task & Selezione Predefinita -->
	<div class="section-block">
		<div class="directives-header">
			<div class="header-left">
				<span class="block-title">Libreria direttive & modalità del task</span>
				<p class="section-subtitle">
					Regole e vincoli operativi applicati al prompt. La spunta indica le direttive attive di default per l'ambito corrente ({isProjectScope ? currentProject?.name : 'Globale'}).
				</p>
			</div>
			<div class="header-actions">
				<button type="button" class="btn-action primary" onclick={openCreateForm} disabled={editingDirectiveId !== null}>
					<IconPlus />
					<span>Nuova direttiva</span>
				</button>
				<button
					type="button"
					class="btn-action"
					onclick={() => { openCreateForm(); aiMode = 'generating'; aiPromptInput = ''; }}
					disabled={editingDirectiveId !== null}
					title="Genera una direttiva a partire da una descrizione in linguaggio naturale"
				>
					<IconSkill />
					<span>Genera con AI</span>
				</button>
				{#if openProjects.length > 0}
					<button
						type="button"
						class="btn-action"
						onclick={runAnalyzeFriction}
						disabled={aiLoading}
						title="Analizza i prompt recenti del progetto per suggerire nuove direttive ricorrenti"
					>
						<IconWarning />
						<span>Analizza ricorrenze</span>
					</button>
				{/if}
			</div>
		</div>

		<!-- Pannello Risultati Analisi Ricorrenze (Friction) -->
		{#if aiMode === 'friction'}
			<div class="ai-friction-panel" role="region" aria-label="Proposte direttive da analisi attrito">
				<div class="panel-top">
					<div class="panel-title-wrap">
						<IconWarning />
						<span class="panel-title">Proposte AI da prompt e richieste recenti</span>
					</div>
					<button type="button" class="btn-icon-close" onclick={() => (aiMode = 'idle')} aria-label="Chiudi"><IconClose /></button>
				</div>
				{#if aiLoading}
					<div class="ai-loading-state">
						<span class="spinner"></span>
						<span>Analisi dello storico prompt del progetto in corso...</span>
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
									<span class="proposal-placement">{proposal.placement === 'before' ? 'Prima del prompt' : 'Dopo il prompt'}</span>
								</div>
								{#if proposal.reason}
									<p class="proposal-reason">{proposal.reason}</p>
								{/if}
								<pre class="proposal-prompt">{proposal.prompt}</pre>
								<div class="proposal-actions">
									<button type="button" class="btn-proposal-action primary" onclick={() => applyProposalAsNewDirective(proposal)}>
										<IconCheck />
										<span>Aggiungi alla libreria</span>
									</button>
									<button type="button" class="btn-proposal-action" onclick={() => { openCreateForm(); applyAiProposalToForm(proposal); }}>
										<IconRename />
										<span>Modifica e aggiungi</span>
									</button>
									<button type="button" class="btn-proposal-action dismiss" onclick={() => dismissFrictionProposal(proposal)}>
										<IconClose />
										<span>Ignora</span>
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
			<div class="inline-editor-card" role="region" aria-label="Editor direttiva">
				<div class="editor-header">
					<span class="editor-title">{editingDirectiveId === 'new' ? 'Crea nuova direttiva' : 'Modifica direttiva'}</span>
					<button type="button" class="btn-icon-close" onclick={cancelEdit} aria-label="Annulla"><IconClose /></button>
				</div>

				{#if aiMode === 'generating' || aiMode === 'refining'}
					<div class="ai-assistant-box">
						<div class="assistant-head">
							<IconSkill />
							<span>{aiMode === 'generating' ? 'Assistente AI: Genera nuova direttiva' : 'Assistente AI: Migliora con AI'}</span>
						</div>
						<div class="assistant-body">
							<div class="form-field">
								<label for="ai-prompt-input" class="field-label">
									{aiMode === 'generating' ? 'Descrivi cosa deve fare o imporre questa modalità:' : 'Istruzioni opzionali per il miglioramento (es. rendilo più rigido, aggiungi vincolo di compilazione):'}
								</label>
								<textarea
									id="ai-prompt-input"
									class="text-input"
									rows="2"
									bind:value={aiPromptInput}
									placeholder={aiMode === 'generating' ? 'Es. Forza sempre l\'esecuzione dei test prima di dichiarare finito il task...' : 'Es. Rendi il prompt più sintetico ed esplicito...'}
								></textarea>
							</div>

							{#if aiMode === 'generating'}
								<div class="form-field">
									<label for="ai-context-input" class="field-label">Contesto aggiuntivo o regole speciali (opzionale):</label>
									<input
										id="ai-context-input"
										type="text"
										class="text-input"
										bind:value={aiContextInput}
										placeholder="Es. Stack: Svelte 5 + Rust Tauri, no test end-to-end cloud..."
									/>
								</div>
							{/if}

							<div class="assistant-actions">
								<button
									type="button"
									class="btn-action primary"
									onclick={aiMode === 'generating' ? runGenerateAi : runRefineAi}
									disabled={aiLoading}
								>
									{#if aiLoading}
										<span class="spinner"></span>
										<span>Elaborazione...</span>
									{:else}
										<IconSkill />
										<span>{aiMode === 'generating' ? 'Genera bozza' : 'Migliora prompt'}</span>
									{/if}
								</button>
								<button type="button" class="btn-action" onclick={() => { aiMode = 'idle'; currentAiProposal = null; }}>
									Chiudi assistente
								</button>
							</div>

							{#if aiError}
								<div class="ai-msg error">{aiError}</div>
							{/if}

							{#if currentAiProposal}
								<div class="ai-proposal-preview">
									<div class="preview-head">
										<span class="preview-title">Proposta dell'AI</span>
										{#if currentAiProposal.reason}
											<span class="preview-reason">{currentAiProposal.reason}</span>
										{/if}
									</div>
									<div class="preview-fields">
										<div class="preview-field"><strong>Nome:</strong> {currentAiProposal.name} · <strong>Tag:</strong> {currentAiProposal.tag} · <strong>Posizione:</strong> {currentAiProposal.placement === 'before' ? 'Prima' : 'Dopo'}</div>
										<div class="preview-field"><strong>Descrizione:</strong> {currentAiProposal.description}</div>
										<div class="preview-prompt-box">
											<pre>{currentAiProposal.prompt}</pre>
										</div>
									</div>
									<div class="preview-actions">
										<button type="button" class="btn-action primary" onclick={() => applyAiProposalToForm(currentAiProposal!)}>
											<IconCheck />
											<span>Applica al modulo</span>
										</button>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<div class="editor-fields-grid">
					<div class="form-field">
						<label for="edit-directive-name" class="field-label">Nome visualizzato</label>
						<input
							id="edit-directive-name"
							type="text"
							class="text-input"
							bind:value={editName}
							placeholder="Es. Verifica Rigorosa"
						/>
					</div>

					<div class="form-field">
						<label for="edit-directive-tag" class="field-label">Tag / Etichetta compatta</label>
						<input
							id="edit-directive-tag"
							type="text"
							class="text-input"
							bind:value={editTag}
							placeholder="Es. /audit o Test"
						/>
					</div>

					<div class="form-field full">
						<label for="edit-directive-desc" class="field-label">Descrizione breve (interfaccia)</label>
						<input
							id="edit-directive-desc"
							type="text"
							class="text-input"
							bind:value={editDescription}
							placeholder="Spiega sinteticamente cosa impone la modalità..."
						/>
					</div>

					<div class="form-field full">
						<span class="field-label">Posizione rispetto al prompt del task</span>
						<div class="placement-radios">
							<label class="radio-label">
								<input type="radio" name="placement" value="before" bind:group={editPlacement} />
								<span>Prima del prompt principale (istruzioni e vincoli preliminari)</span>
							</label>
							<label class="radio-label">
								<input type="radio" name="placement" value="after" bind:group={editPlacement} />
								<span>Dopo il prompt principale (direttive finali o post-condizioni)</span>
							</label>
						</div>
					</div>

					<div class="form-field full">
						<div class="field-label-row">
							<label for="edit-directive-prompt" class="field-label">Testo della direttiva inviato all'agente</label>
							{#if aiMode === 'idle'}
								<button
									type="button"
									class="btn-mini-ai"
									onclick={() => { aiMode = 'refining'; aiPromptInput = ''; aiError = null; }}
									title="Fai ottimizzare o affinare questo prompt dall'AI"
								>
									<IconSkill />
									<span>Migliora con AI</span>
								</button>
							{/if}
						</div>
						<textarea
							id="edit-directive-prompt"
							class="text-input mono"
							rows="4"
							bind:value={editPrompt}
							placeholder="[Direttiva: Istruzioni operative precise da inviare nel prompt...]"
						></textarea>
					</div>
				</div>

				{#if editFormError}
					<div class="ai-msg error">{editFormError}</div>
				{/if}

				<div class="editor-footer">
					<div class="footer-left">
						<button type="button" class="btn-action primary" onclick={saveDirectiveForm}>
							<IconCheck />
							<span>Salva direttiva</span>
						</button>
						<button type="button" class="btn-action" onclick={cancelEdit}>
							Annulla
						</button>
					</div>

					{#if editingDirectiveId !== 'new'}
						{@const currentDir = settingsStore.taskDirectives.find((d) => d.id === editingDirectiveId)}
						{#if currentDir?.factoryKey}
							<button type="button" class="btn-action text-warn" onclick={() => resetDirectiveToFactory(currentDir)}>
								<IconRefresh />
								<span>Ripristina originale di fabbrica</span>
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/if}

		<!-- Elenco Direttive a Righe Dense -->
		<div class="directives-list" role="list" aria-label="Elenco direttive configurate">
			{#each settingsStore.taskDirectives as d, idx (d.id)}
				{@const isDefault = effectiveDefaults.selectedDirectiveIds.includes(d.id)}
				<div class="directive-row" class:hidden-dir={d.hidden} class:is-editing={editingDirectiveId === d.id} role="listitem">
					<!-- Checkbox di attivazione default -->
					<div class="col-checkbox" title={`Attiva di default per ${isProjectScope ? currentProject?.name : 'Globale'}`}>
						<input
							type="checkbox"
							checked={isDefault}
							onchange={() => toggleDefaultDirective(d.id)}
							aria-label={`Attiva ${d.name} di default`}
						/>
					</div>

					<!-- Riordino -->
					<div class="col-order">
						<button
							type="button"
							class="order-btn"
							disabled={idx === 0}
							onclick={() => moveDirective(d.id, -1)}
							title="Sposta su"
							aria-label="Sposta su"
						>
							▲
						</button>
						<button
							type="button"
							class="order-btn"
							disabled={idx === settingsStore.taskDirectives.length - 1}
							onclick={() => moveDirective(d.id, 1)}
							title="Sposta giù"
							aria-label="Sposta giù"
						>
							▼
						</button>
					</div>

					<!-- Info Direttiva -->
					<div class="col-main">
						<div class="row-top">
							<span class="dir-name">{d.name}</span>
							{#if d.factoryKey}
								<span class="factory-pill">Preset</span>
							{/if}
							{#if d.placement === 'after'}
								<span class="placement-pill after">dopo</span>
							{:else}
								<span class="placement-pill before">prima</span>
							{/if}
							{#if d.tag}
								<span class="tag-pill">{d.tag}</span>
							{/if}
							{#if d.hidden}
								<span class="hidden-pill">Nascosta nei task</span>
							{/if}
						</div>
						<p class="dir-desc">{d.description || d.prompt}</p>
					</div>

					<!-- Azioni sulla riga -->
					<div class="col-actions">
						<button type="button" class="btn-row-action" onclick={() => openEditForm(d)} title="Modifica direttiva">
							<IconRename />
						</button>
						<button type="button" class="btn-row-action" onclick={() => duplicateDirective(d)} title="Duplica direttiva">
							<IconCopy />
						</button>
						<button
							type="button"
							class="btn-row-action"
							class:active-hidden={d.hidden}
							onclick={() => toggleDirectiveHidden(d)}
							title={d.hidden ? 'Mostra nei nuovi task' : 'Nascondi dai nuovi task'}
						>
							{d.hidden ? 'Mostra' : 'Nascondi'}
						</button>
						{#if d.factoryKey}
							<button
								type="button"
								class="btn-row-action"
								onclick={() => resetDirectiveToFactory(d)}
								title="Ripristina testo e configurazione originale di fabbrica"
							>
								<IconRefresh />
							</button>
						{:else}
							<button
								type="button"
								class="btn-row-action danger"
								class:armed={deleteArmedId === d.id}
								onclick={() => handleDelete(d.id)}
								title={deleteArmedId === d.id ? 'Clicca di nuovo per confermare eliminazione' : 'Elimina direttiva'}
							>
								{#if deleteArmedId === d.id}
									<span>Sicuro?</span>
								{:else}
									<IconTrash />
								{/if}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Blocco 3: Progetti Aperti & Auto-Dispatch (invariante preservato) -->
	<div class="section-block">
		<span class="block-title">Auto-avvio per progetto</span>
		{#if openProjects.length === 0}
			<p class="empty-note">Nessun progetto aperto.</p>
		{:else}
			<div class="section-group">
				{#each openProjects as p (p.id)}
					<div class="project-row">
						<div class="form-row-copy">
							<span class="form-row-label">{p.label || p.name}</span>
							<span class="form-row-desc">Avvia automaticamente il prossimo task in coda quando l'agente è libero. Vale solo per questo progetto.</span>
							{#if p.taskDefaults}
								<button type="button" class="override-reset" onclick={() => projectStore.setTaskDefaults(p.id, null)}>
									Default personalizzati attivi · Ripristina ereditarietà
								</button>
							{/if}
						</div>
						<div class="form-row-control">
							<label class="switch">
								<input
									type="checkbox"
									checked={p.autoDispatch}
									onchange={(e) => projectStore.setAutoDispatch(p.id, (e.currentTarget as HTMLInputElement).checked)}
								/>
								<span class="slider"></span>
							</label>
						</div>
					</div>
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
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.section-subtitle {
		margin: 2px 0 0 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.4;
	}

	.scope-indicator-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.scope-pill {
		font-size: 11px;
		font-family: var(--font-mono);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.scope-pill.project {
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-sunken));
		border-color: color-mix(in srgb, var(--brand) 30%, var(--line));
		color: var(--brand-ink);
	}

	.btn-reset-scope {
		font-size: var(--text-xs);
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
		font-size: var(--text-base);
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.form-row-control select {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-sm);
		padding: 4px 8px;
		min-width: 220px;
	}

	/* Switch component */
	.switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
		flex-shrink: 0;
	}

	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--line);
		transition: var(--dur-fast);
		border-radius: var(--radius-full);
	}

	.slider:before {
		position: absolute;
		content: "";
		height: 14px;
		width: 14px;
		left: 2px;
		bottom: 2px;
		background-color: var(--ink-muted);
		transition: var(--dur-fast);
		border-radius: var(--radius-full);
	}

	input:checked + .slider {
		background-color: var(--brand);
	}

	input:checked + .slider:before {
		transform: translateX(14px);
		background-color: var(--ink);
	}

	/* Directives Header */
	.directives-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.btn-action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		font-weight: 500;
		padding: 4px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.btn-action:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.btn-action.primary {
		background: color-mix(in srgb, var(--brand) 15%, var(--bg-raised));
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
		color: var(--brand-ink);
	}

	.btn-action.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--brand) 25%, var(--bg-hover));
	}

	.btn-action.text-warn {
		color: var(--warn);
	}

	.btn-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
		border-bottom: 1px solid var(--line);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.directive-row:last-child {
		border-bottom: none;
	}

	.directive-row:hover {
		background: var(--bg-hover);
	}

	.directive-row.hidden-dir {
		opacity: 0.6;
	}

	.directive-row.is-editing {
		border-left: 2px solid var(--brand);
		background: color-mix(in srgb, var(--brand) 5%, var(--bg-raised));
	}

	.col-checkbox input {
		accent-color: var(--brand);
		cursor: pointer;
	}

	.col-order {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.order-btn {
		font-size: 8px;
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 0 2px;
		line-height: 1;
	}

	.order-btn:hover:not(:disabled) {
		color: var(--ink);
	}

	.order-btn:disabled {
		opacity: 0.2;
		cursor: default;
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
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.factory-pill {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
	}

	.placement-pill {
		font-size: 10px;
		font-family: var(--font-mono);
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
		background: color-mix(in srgb, var(--brand) 12%, var(--bg-sunken));
		border: 1px solid color-mix(in srgb, var(--brand) 30%, var(--line));
		color: var(--brand-ink);
	}

	.tag-pill {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}

	.hidden-pill {
		font-size: 10px;
		color: var(--warn);
		font-style: italic;
	}

	.dir-desc {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
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
		font-size: var(--text-xs);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		padding: 3px 6px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background var(--dur-fast), color var(--dur-fast);
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
		color: var(--ink-faint);
	}

	.btn-row-action.danger:hover {
		color: var(--warn);
	}

	.btn-row-action.danger.armed {
		background: color-mix(in srgb, var(--warn) 20%, var(--bg-sunken));
		border-color: var(--warn);
		color: var(--warn);
		font-weight: 600;
	}

	/* Inline Editor Card */
	.inline-editor-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--brand);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
	}

	.editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.editor-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.btn-icon-close {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 2px;
	}

	.btn-icon-close:hover {
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
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.btn-mini-ai {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--brand-ink);
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--brand) 30%, var(--line));
		border-radius: var(--radius-sm);
		padding: 1px 6px;
		cursor: pointer;
	}

	.btn-mini-ai:hover {
		background: color-mix(in srgb, var(--brand) 15%, var(--bg-hover));
	}

	.text-input {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-sm);
		padding: 6px 8px;
		font-family: var(--font-ui);
	}

	.text-input:focus {
		border-color: var(--brand);
		outline: none;
	}

	.text-input.mono {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.4;
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
		font-size: var(--text-xs);
		color: var(--ink);
		cursor: pointer;
	}

	.radio-label input {
		accent-color: var(--brand);
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

	/* AI Assistant Box */
	.ai-assistant-box {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-sunken));
		border: 1px solid color-mix(in srgb, var(--brand) 30%, var(--line));
		border-radius: var(--radius-sm);
	}

	.assistant-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-xs);
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
		border-radius: var(--radius-sm);
		margin-top: var(--space-2);
	}

	.preview-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.preview-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--brand-ink);
	}

	.preview-reason {
		font-size: 11px;
		color: var(--ink-faint);
		font-style: italic;
	}

	.preview-fields {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--ink);
	}

	.preview-prompt-box pre {
		margin: 4px 0 0 0;
		padding: 6px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
		white-space: pre-wrap;
		color: var(--ink-muted);
	}

	/* AI Friction Panel */
	.ai-friction-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--warn);
		border-radius: var(--radius-md);
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
		color: var(--warn);
		font-size: var(--text-sm);
		font-weight: 600;
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
		border-radius: var(--radius-sm);
	}

	.proposal-head {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.proposal-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.proposal-tag {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 1px 4px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}

	.proposal-placement {
		font-size: 10px;
		color: var(--ink-faint);
		text-transform: uppercase;
	}

	.proposal-reason {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--warn);
	}

	.proposal-prompt {
		margin: 2px 0 0 0;
		padding: 4px 6px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
		white-space: pre-wrap;
		color: var(--ink-muted);
	}

	.proposal-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-top: 4px;
	}

	.btn-proposal-action {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		padding: 2px 8px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		cursor: pointer;
	}

	.btn-proposal-action.primary {
		background: color-mix(in srgb, var(--brand) 15%, var(--bg-raised));
		border-color: var(--brand);
		color: var(--brand-ink);
	}

	.btn-proposal-action.dismiss {
		color: var(--ink-faint);
	}

	.ai-msg.error {
		font-size: var(--text-xs);
		color: var(--warn);
		padding: 4px 0;
	}

	.ai-loading-state {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		padding: var(--space-2) 0;
	}

	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: spin 800ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
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

	.override-reset {
		font-size: var(--text-xs);
		color: var(--warn);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: 0;
		text-decoration: underline;
	}

	.empty-note {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin: 0;
	}

	@media (max-width: 600px) {
		.editor-fields-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
