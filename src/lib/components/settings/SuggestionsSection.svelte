<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { modelSettingsStore, type ModelDto } from '$lib/stores/modelSettings.svelte';
	import type { PromptSuggestion, FactorySuggestionKey } from '$lib/stores/promptSuggestions';
	import {
		IconPlus,
		IconRename,
		IconCopy,
		IconTrash,
		IconRefresh,
		IconCheck,
		IconClose,
		IconChevronUp,
		IconChevronDown
	} from '$lib/icons';
	import Switch from '$lib/ui/Switch.svelte';
	import PromptField from '$lib/ui/PromptField.svelte';
	import { escapeDismiss } from '$lib/ui/escapeDismiss';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { trayFold } from '$lib/agent/motion';

	// Il caricamento lo fa lo store, una volta: `assignableCatalog` contiene
	// solo i modelli raggiungibili con le credenziali presenti, quindi la
	// select non propone provider che l'utente non ha configurato.
	let catalogRequested = $state(false);

	$effect(() => {
		if (catalogRequested) return;
		catalogRequested = true;
		void modelSettingsStore.ensureLoaded();
	});

	const availableModels = $derived(modelSettingsStore.assignableCatalog);

	// Raggruppa i modelli per provider per una select ordinata
	const groupedModels = $derived.by(() => {
		const map: Record<string, ModelDto[]> = {};
		for (const m of availableModels) {
			const providerKey = m.provider || 'Altri';
			if (!map[providerKey]) map[providerKey] = [];
			map[providerKey].push(m);
		}
		return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
	});

	// --- Stato Editor Inline Suggerimento Fisso ---
	let suggestionPromptField = $state<ReturnType<typeof PromptField> | null>(null);
	let editingSuggestionId = $state<string | null>(null);
	let editLabel = $state('');
	let editPrompt = $state('');
	let editFormError = $state<string | null>(null);
	let deleteArmedId = $state<string | null>(null);

	async function openCreateForm(focusPrompt = false) {
		editingSuggestionId = 'new';
		editLabel = '';
		editPrompt = '';
		editFormError = null;
		deleteArmedId = null;
		if (focusPrompt) {
			await tick();
			suggestionPromptField?.focus();
		}
	}

	async function openEditForm(s: PromptSuggestion, focusPrompt = false) {
		editingSuggestionId = s.id;
		editLabel = s.label;
		editPrompt = s.prompt;
		editFormError = null;
		deleteArmedId = null;
		if (focusPrompt) {
			await tick();
			suggestionPromptField?.focus();
		}
	}

	function cancelEdit() {
		editingSuggestionId = null;
		editLabel = '';
		editPrompt = '';
		editFormError = null;
	}

	function saveSuggestionForm() {
		const label = editLabel.trim();
		const prompt = editPrompt.trim();

		if (!label) {
			editFormError = 'L\'etichetta del suggerimento non puo\' essere vuota.';
			return;
		}
		if (label.length > 28) {
			editFormError = 'L\'etichetta non puo\' superare i 28 caratteri.';
			return;
		}
		if (!prompt) {
			editFormError = 'Il testo del prompt non puo\' essere vuoto.';
			return;
		}

		if (editingSuggestionId === 'new') {
			const existing = settingsStore.promptSuggestions || [];
			const maxOrder = existing.length > 0 ? Math.max(...existing.map((s) => s.order)) : 0;
			const newSuggestion: PromptSuggestion = {
				id: `sug_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
				factoryKey: null,
				label,
				prompt,
				order: maxOrder + 10,
				hidden: false
			};
			settingsStore.upsertPromptSuggestion(newSuggestion);
		} else if (editingSuggestionId) {
			const existing = (settingsStore.promptSuggestions || []).find((s) => s.id === editingSuggestionId);
			if (existing) {
				const updated: PromptSuggestion = {
					...existing,
					label,
					prompt
				};
				settingsStore.upsertPromptSuggestion(updated);
			}
		}

		cancelEdit();
	}

	function handleDuplicate(id: string) {
		settingsStore.duplicatePromptSuggestion(id);
		deleteArmedId = null;
	}

	function handleToggleHidden(s: PromptSuggestion) {
		settingsStore.setPromptSuggestionHidden(s.id, !s.hidden);
		deleteArmedId = null;
	}

	async function handleResetFactory(s: PromptSuggestion) {
		if (!s.factoryKey) return;
		settingsStore.resetPromptSuggestionToFactory(s.factoryKey);
		deleteArmedId = null;
		if (editingSuggestionId === s.id) {
			const restored = (settingsStore.promptSuggestions || []).find((item) => item.id === s.id);
			if (restored) {
				editLabel = restored.label;
				editPrompt = restored.prompt;
				await tick();
				suggestionPromptField?.focus();
			}
		}
	}

	function handleDelete(id: string) {
		if (deleteArmedId === id) {
			settingsStore.deletePromptSuggestion(id);
			deleteArmedId = null;
			if (editingSuggestionId === id) cancelEdit();
		} else {
			deleteArmedId = id;
		}
	}

	function handleMove(id: string, delta: -1 | 1) {
		settingsStore.movePromptSuggestion(id, delta);
		deleteArmedId = null;
	}
</script>

<div class="settings-section">
	<!-- Blocco A: Suggerimenti dinamici (AI) -->
	<div class="section-block">
		<span class="block-title">Suggerimenti dinamici (AI)</span>
		<div class="section-group">
			<!-- Toggle abilitazione dinamica -->
			<div class="form-row">
				<div class="form-row-copy">
					<span id="switch-dynamic-suggestions-label" class="form-row-label">Abilita suggerimenti dinamici</span>
					<span id="switch-dynamic-suggestions-desc" class="form-row-desc">
						Genera automaticamente opzioni di prompt contestuali al termine di ogni risposta dell'agente.
					</span>
					<span class="form-row-warning">
						{m.ui_suggestionssection_costo_e_privacy_alla_fine_di_ogni_f94a()}
					</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="switch-dynamic-suggestions"
						checked={settingsStore.suggestions.dynamicEnabled}
						ariaLabelledBy="switch-dynamic-suggestions-label"
						ariaDescribedBy="switch-dynamic-suggestions-desc"
						onChange={(checked) =>
							settingsStore.patchSuggestions({
								dynamicEnabled: checked
							})
						}
					/>
				</div>
			</div>

			<!-- Selettore del modello -->
			<div class="form-row">
				<div class="form-row-copy">
					<label for="suggestion-model-selector" id="suggestion-model-label" class="form-row-label">{m.ui_suggestionssection_modello_per_suggerimenti_13bc()}</label>
					<span id="suggestion-model-desc" class="form-row-desc">
						{m.ui_suggestionssection_modello_leggero_delegato_alla_formulazione_dei_suggerimenti_dd58()}
					</span>
					<span class="form-row-help">
						Un suffisso come <code>:minimal</code> o <code>:low</code> riduce la latenza di generazione.
					</span>
				</div>
				<div class="form-row-control">
					{#if availableModels.length > 0}
						<select
							id="suggestion-model-selector"
							class="ui-select"
							value={settingsStore.suggestions.modelSelector}
							disabled={!settingsStore.suggestions.dynamicEnabled}
							aria-labelledby="suggestion-model-label"
							aria-describedby="suggestion-model-desc"
							onchange={(e) =>
								settingsStore.patchSuggestions({
									modelSelector: (e.currentTarget as HTMLSelectElement).value
								})
							}
						>
							<option value="">Ruolo smol (predefinito)</option>
							{#if settingsStore.suggestions.modelSelector && !availableModels.some((m) => m.selector === settingsStore.suggestions.modelSelector || m.id === settingsStore.suggestions.modelSelector)}
								<option value={settingsStore.suggestions.modelSelector}>
									{settingsStore.suggestions.modelSelector} (personalizzato)
								</option>
							{/if}
							{#each groupedModels as [provider, models] (provider)}
								<optgroup label={provider}>
									{#each models as m (m.id || m.selector)}
										<option value={m.selector}>{m.name || m.selector} ({m.selector})</option>
									{/each}
								</optgroup>
							{/each}
						</select>
					{:else}
						<input
							id="suggestion-model-selector"
							type="text"
							class="ui-input"
							value={settingsStore.suggestions.modelSelector}
							disabled={!settingsStore.suggestions.dynamicEnabled}
							aria-labelledby="suggestion-model-label"
							aria-describedby="suggestion-model-desc"
							placeholder={m.ui_suggestionssection_provider_modello_thinking_17aa()}
							oninput={(e) =>
								settingsStore.patchSuggestions({
									modelSelector: (e.currentTarget as HTMLInputElement).value.trim()
								})
							}
						/>
					{/if}
				</div>
			</div>

			<!-- Numero massimo di suggerimenti dinamici -->
			<div class="form-row">
				<div class="form-row-copy">
					<label for="suggestion-max-dynamic" id="suggestion-max-dynamic-label" class="form-row-label">Numero massimo di suggerimenti dinamici</label>
					<span id="suggestion-max-dynamic-desc" class="form-row-desc">
						Quante chip generate dall'AI mostrare al massimo nel composer.
					</span>
				</div>
				<div class="form-row-control">
					<select
						id="suggestion-max-dynamic"
						class="ui-select"
						value={settingsStore.suggestions.maxDynamic}
						disabled={!settingsStore.suggestions.dynamicEnabled}
						aria-labelledby="suggestion-max-dynamic-label"
						aria-describedby="suggestion-max-dynamic-desc"
						onchange={(e) =>
							settingsStore.patchSuggestions({
								maxDynamic: Number((e.currentTarget as HTMLSelectElement).value)
							})
						}
					>
						<option value={1}>1 suggerimento</option>
						<option value={2}>2 suggerimenti</option>
						<option value={3}>3 suggerimenti</option>
					</select>
				</div>
			</div>

			<!-- Timeout di generazione in secondi -->
			<div class="form-row">
				<div class="form-row-copy">
					<label for="suggestion-timeout" id="suggestion-timeout-label" class="form-row-label">Timeout di generazione (secondi)</label>
					<span id="suggestion-timeout-desc" class="form-row-desc">
						{m.ui_suggestionssection_tempo_limite_di_attesa_per_la_risposta_a885()}
					</span>
				</div>
				<div class="form-row-control">
					<input
						id="suggestion-timeout"
						type="number"
						class="ui-input number-input"
						min="5"
						max="60"
						step="1"
						disabled={!settingsStore.suggestions.dynamicEnabled}
						aria-labelledby="suggestion-timeout-label"
						aria-describedby="suggestion-timeout-desc"
						value={Math.round(settingsStore.suggestions.timeoutMs / 1000)}
						onchange={(e) => {
							const raw = Number((e.currentTarget as HTMLInputElement).value) || 20;
							const clamped = Math.max(5, Math.min(60, raw));
							settingsStore.patchSuggestions({ timeoutMs: clamped * 1000 });
						}}
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- Blocco B: Suggerimenti fissi -->
	<div class="section-block">
		<div class="suggestions-header">
			<div class="header-left">
				<span class="block-title">Suggerimenti fissi</span>
				<p class="section-subtitle">
					Prompt predefiniti configurabili visualizzati come chip cliccabili sopra il composer.
				</p>
			</div>
			<div class="header-actions">
				<button
					type="button"
					class="ui-button ui-button-primary"
					onclick={() => openCreateForm(true)}
					disabled={editingSuggestionId !== null}
				>
					<IconPlus />
					<span>Nuovo suggerimento</span>
				</button>
			</div>
		</div>

		<!-- Nota informativa slot composer -->
		<div class="info-banner">
			<span class="info-banner-text">
				Nel composer vengono mostrati al massimo i primi 3 suggerimenti non nascosti, in quest'ordine, raggiungibili con le scorciatoie Alt+1, Alt+2 e Alt+3.
			</span>
		</div>

		<!-- Form inline di creazione o modifica -->
		{#if editingSuggestionId !== null}
			<div
				class="inline-editor-card"
				transition:trayFold
				role="region"
				aria-label="Editor suggerimento"
				use:escapeDismiss={cancelEdit}
			>
				<div class="editor-header">
					<span class="editor-title">
						{editingSuggestionId === 'new' ? m.settings_suggestions_create_title() : m.settings_suggestions_edit_title()}
					</span>
					<button
						type="button"
						class="btn-icon-close"
						onclick={cancelEdit}
						aria-label={m.common_cancel()}
					>
						<IconClose />
					</button>
				</div>

				<div class="form-fields">
					<div class="form-field full">
						<div class="field-label-row">
							<label for="edit-sug-label" class="field-label">Etichetta sulla chip (max 28 caratteri)</label>
							<span class="char-counter" class:warn={editLabel.length > 24} class:limit={editLabel.length >= 28}>
								{editLabel.length}/28
							</span>
						</div>
						<input
							id="edit-sug-label"
							type="text"
							class="ui-input"
							maxlength="28"
							bind:value={editLabel}
							placeholder={m.ui_suggestionssection_es_procedi_spiega_verifica_094c()}
						/>
					</div>

					<div class="form-field full">
						<span class="field-label">Testo del prompt inserito nel composer</span>
						<PromptField
							bind:this={suggestionPromptField}
							bind:value={editPrompt}
							placeholder="Testo completo che verra' precompilato nel composer..."
							ariaLabel="Testo del prompt inserito nel composer"
							onSubmit={saveSuggestionForm}
							onCancel={cancelEdit}
						/>
					</div>
				</div>

				{#if editFormError}
					<div class="form-msg error">{editFormError}</div>
				{/if}

				<div class="editor-footer">
					<div class="footer-left">
						<button type="button" class="ui-button ui-button-primary" onclick={saveSuggestionForm}>
							<IconCheck />
							<span>Salva suggerimento</span>
						</button>
						<button type="button" class="ui-button ui-button-secondary" onclick={cancelEdit}>
							{m.common_cancel()}
						</button>
					</div>

					{#if editingSuggestionId !== 'new'}
						{@const currentSug = (settingsStore.promptSuggestions || []).find((s) => s.id === editingSuggestionId)}
						{#if currentSug?.factoryKey}
							<button
								type="button"
								class="ui-button ui-button-ghost text-warn"
								onclick={() => handleResetFactory(currentSug)}
							>
								<IconRefresh />
								<span>Ripristina originale di fabbrica</span>
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/if}

		<!-- Elenco Suggerimenti a Righe Dense -->
		<div class="suggestions-list" role="list" aria-label="Elenco suggerimenti configurati">
			{#if (settingsStore.promptSuggestions || []).length === 0}
				<div class="empty-note">Nessun suggerimento fisso configurato.</div>
			{:else}
				{@const nonHiddenSuggestions = (settingsStore.promptSuggestions || []).filter((s) => !s.hidden)}
				{#each settingsStore.promptSuggestions || [] as s, idx (s.id)}
					{@const visibleIndex = nonHiddenSuggestions.findIndex((item) => item.id === s.id)}
					{@const composerSlot = !s.hidden && visibleIndex >= 0 && visibleIndex < 3 ? visibleIndex + 1 : null}
					<div
						class="suggestion-row"
						class:hidden-sug={s.hidden}
						class:ui-selected={editingSuggestionId === s.id}
						role="listitem"
					>
						<!-- Riordino -->
						<div class="col-order">
							<Tooltip text="Sposta su">
								<button
									type="button"
									class="order-btn"
									disabled={idx === 0}
									onclick={() => handleMove(s.id, -1)}
									aria-label="Sposta su"
								>
									<IconChevronUp />
								</button>
							</Tooltip>
							<Tooltip text={m.ui_suggestionssection_sposta_giu_10cf()}>
								<button
									type="button"
									class="order-btn"
									disabled={idx === (settingsStore.promptSuggestions || []).length - 1}
									onclick={() => handleMove(s.id, 1)}
									aria-label={m.ui_suggestionssection_sposta_giu_10cf()}
								>
									<IconChevronDown />
								</button>
							</Tooltip>
						</div>

						<!-- Info Suggerimento -->
						<div class="col-main">
							<div class="row-top">
								<span class="sug-name">{s.label}</span>
								{#if composerSlot !== null}
									<Tooltip text={`Visibile nel composer come chip ${composerSlot}`}>
										<span class="slot-pill">
											Alt+{composerSlot}
										</span>
									</Tooltip>
								{/if}
								{#if s.factoryKey}
									<span class="factory-pill">Preset</span>
								{/if}
								{#if s.hidden}
									<span class="hidden-pill">Nascosto</span>
								{/if}
							</div>
							<p class="sug-prompt">{s.prompt}</p>
						</div>

						<!-- Azioni sulla riga -->
						<div class="col-actions">
							<Tooltip text={m.settings_suggestions_edit_title()}>
								<button
									type="button"
									class="btn-row-action"
									onclick={() => openEditForm(s)}
									aria-label={m.ui_suggestionssection_modifica_value1_1535({ value1: s.label })}
								>
									<IconRename />
								</button>
							</Tooltip>
							<Tooltip text="Duplica suggerimento">
								<button
									type="button"
									class="btn-row-action"
									onclick={() => handleDuplicate(s.id)}
									aria-label={`Duplica ${s.label}`}
								>
									<IconCopy />
								</button>
							</Tooltip>
							<Tooltip text={s.hidden ? m.ui_suggestionssection_mostra_nel_composer_4e18() : m.ui_suggestionssection_nascondi_dal_composer_a7ac()}>
								<button
									type="button"
									class="btn-row-action"
									class:active-hidden={s.hidden}
									onclick={() => handleToggleHidden(s)}
									aria-label={s.hidden ? m.ui_suggestionssection_mostra_nel_composer_4e18() : m.ui_suggestionssection_nascondi_dal_composer_a7ac()}
								>
									{s.hidden ? m.ui_suggestionssection_mostra_4e74() : m.ui_usermessage_nascondi_82ca()}
								</button>
							</Tooltip>
							{#if s.factoryKey}
								<Tooltip text="Ripristina testo e configurazione originale di fabbrica">
									<button
										type="button"
										class="btn-row-action"
										onclick={() => handleResetFactory(s)}
										aria-label={`Ripristina ${s.label} di fabbrica`}
									>
										<IconRefresh />
									</button>
								</Tooltip>
							{:else}
								<Tooltip text={deleteArmedId === s.id ? m.ui_suggestionssection_conferma_eliminazione_7049() : m.ui_suggestionssection_elimina_suggerimento_4996()}>
									<button
										type="button"
										class="btn-row-action danger"
										class:ui-button-danger={deleteArmedId === s.id}
										class:armed={deleteArmedId === s.id}
										onclick={() => handleDelete(s.id)}
										aria-label={deleteArmedId === s.id ? m.ui_suggestionssection_conferma_eliminazione_7049() : m.ui_suggestionssection_elimina_value1_ac11({ value1: s.label })}
									>
										{#if deleteArmedId === s.id}
											<span>Sicuro?</span>
										{:else}
											<IconTrash />
										{/if}
									</button>
								</Tooltip>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
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

	.section-block {
		display: flex;
		flex-direction: column;
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
	}

	.form-row-label {
		font-size: var(--text-body);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-warning {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
		margin-top: 4px;
	}

	.form-row-help {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
		margin-top: 2px;
	}

	.form-row-help code {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		background: var(--bg-sunken);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.form-row-control {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.form-row-control :global(.ui-select) {
		min-width: 200px;
	}

	.number-input {
		width: 80px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	/* Header per Blocco B */
	.suggestions-header {
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
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	/* Info banner */
	.info-banner {
		padding: var(--space-2) var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.info-banner-text {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	/* Inline editor card */
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
		gap: var(--space-2);
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
		padding: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.btn-icon-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.form-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.field-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.char-counter {
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		font-family: var(--font-mono);
		color: var(--ink-faint);
	}

	.char-counter.warn {
		color: var(--warn);
	}

	.char-counter.limit {
		color: var(--danger);
		font-weight: 600;
	}

	.form-msg.error {
		font-size: var(--text-caption);
		color: var(--danger);
		background: color-mix(in oklab, var(--danger) 10%, var(--bg-raised));
		border: 1px solid var(--danger);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
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

	/* Elenco suggerimenti */
	.suggestions-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.empty-note {
		padding: var(--space-4);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		text-align: center;
	}

	.suggestion-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid transparent;
		border-bottom-color: var(--line);
		border-radius: var(--radius-md);
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.suggestion-row:last-child {
		border-bottom-color: transparent;
	}

	.suggestion-row:hover:not(.ui-selected) {
		background: var(--bg-hover);
	}

	.suggestion-row.hidden-sug {
		opacity: 0.55;
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
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.row-top {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.sug-name {
		font-size: var(--text-body);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.slot-pill {
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		font-family: var(--font-mono);
		font-weight: 600;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--brand) 15%, var(--bg-sunken));
		border: 1px solid color-mix(in oklab, var(--brand) 40%, var(--line));
		color: var(--brand-ink);
	}

	.factory-pill {
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.hidden-pill {
		font-size: var(--text-caption);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.sug-prompt {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		line-height: 1.3;
	}

	.col-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.btn-row-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 24px;
		min-height: 24px;
		padding: 0 6px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.btn-row-action:hover {
		background: var(--bg-sunken);
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-row-action.active-hidden {
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
</style>
