<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
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
		IconClose
	} from '$lib/icons';

	// Catalogo modelli caricato come fallback locale se non ancora presente nello store
	let fallbackCatalog = $state<ModelDto[]>([]);
	let catalogLoaded = $state(false);

	// Caricamento non bloccante del catalogo modelli per popolare il selettore
	$effect(() => {
		if (modelSettingsStore.catalog.length > 0) {
			catalogLoaded = true;
			return;
		}
		invoke<ModelDto[]>('get_models_catalog')
			.then((models) => {
				fallbackCatalog = models || [];
				catalogLoaded = true;
			})
			.catch((err) => {
				console.warn('Impossibile caricare il catalogo modelli per i suggerimenti:', err);
				catalogLoaded = true;
			});
	});

	const availableModels = $derived.by(() => {
		if (modelSettingsStore.catalog.length > 0) {
			return modelSettingsStore.catalog;
		}
		return fallbackCatalog;
	});

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
	let editingSuggestionId = $state<string | null>(null);
	let editLabel = $state('');
	let editPrompt = $state('');
	let editFormError = $state<string | null>(null);
	let deleteArmedId = $state<string | null>(null);

	function openCreateForm() {
		editingSuggestionId = 'new';
		editLabel = '';
		editPrompt = '';
		editFormError = null;
		deleteArmedId = null;
	}

	function openEditForm(s: PromptSuggestion) {
		editingSuggestionId = s.id;
		editLabel = s.label;
		editPrompt = s.prompt;
		editFormError = null;
		deleteArmedId = null;
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

	function handleResetFactory(s: PromptSuggestion) {
		if (!s.factoryKey) return;
		settingsStore.resetPromptSuggestionToFactory(s.factoryKey);
		deleteArmedId = null;
		if (editingSuggestionId === s.id) {
			const restored = (settingsStore.promptSuggestions || []).find((item) => item.id === s.id);
			if (restored) {
				editLabel = restored.label;
				editPrompt = restored.prompt;
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
					<label for="switch-dynamic-suggestions" class="form-row-label">Abilita suggerimenti dinamici</label>
					<span class="form-row-desc">
						Genera automaticamente opzioni di prompt contestuali al termine di ogni risposta dell'agente.
					</span>
					<span class="form-row-warning">
						Costo e privacy: alla fine di ogni turno viene inviata una richiesta a un modello leggero, consumando quota del provider e trasmettendo l'ultimo messaggio dell'agente e il tuo ultimo prompt.
					</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							id="switch-dynamic-suggestions"
							type="checkbox"
							checked={settingsStore.suggestions.dynamicEnabled}
							onchange={(e) =>
								settingsStore.patchSuggestions({
									dynamicEnabled: (e.currentTarget as HTMLInputElement).checked
								})
							}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>

			<!-- Selettore del modello -->
			<div class="form-row">
				<div class="form-row-copy">
					<label for="suggestion-model-selector" class="form-row-label">Modello per suggerimenti</label>
					<span class="form-row-desc">
						Modello leggero delegato alla formulazione dei suggerimenti rapidi.
					</span>
					<span class="form-row-help">
						Un suffisso come <code>:minimal</code> o <code>:low</code> riduce la latenza di generazione.
					</span>
				</div>
				<div class="form-row-control">
					{#if availableModels.length > 0}
						<select
							id="suggestion-model-selector"
							value={settingsStore.suggestions.modelSelector}
							disabled={!settingsStore.suggestions.dynamicEnabled}
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
							class="text-input"
							value={settingsStore.suggestions.modelSelector}
							disabled={!settingsStore.suggestions.dynamicEnabled}
							placeholder="provider/modello[:thinking]"
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
					<label for="suggestion-max-dynamic" class="form-row-label">Numero massimo di suggerimenti dinamici</label>
					<span class="form-row-desc">
						Quante chip generate dall'AI mostrare al massimo nel composer.
					</span>
				</div>
				<div class="form-row-control">
					<select
						id="suggestion-max-dynamic"
						value={settingsStore.suggestions.maxDynamic}
						disabled={!settingsStore.suggestions.dynamicEnabled}
						onchange={(e) =>
							settingsStore.patchSuggestions({
								maxDynamic: Number((e.currentTarget as HTMLSelectElement).value)
							})
						}
					>
						<option value="1">1 suggerimento</option>
						<option value="2">2 suggerimenti</option>
						<option value="3">3 suggerimenti</option>
					</select>
				</div>
			</div>

			<!-- Timeout di generazione in secondi -->
			<div class="form-row">
				<div class="form-row-copy">
					<label for="suggestion-timeout" class="form-row-label">Timeout di generazione (secondi)</label>
					<span class="form-row-desc">
						Tempo limite di attesa per la risposta del modello (fra 5 e 60 secondi).
					</span>
				</div>
				<div class="form-row-control">
					<input
						id="suggestion-timeout"
						type="number"
						class="text-input number-input"
						min="5"
						max="60"
						step="1"
						disabled={!settingsStore.suggestions.dynamicEnabled}
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
					class="btn-action primary"
					onclick={openCreateForm}
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
			<div class="inline-editor-card" role="region" aria-label="Editor suggerimento">
				<div class="editor-header">
					<span class="editor-title">
						{editingSuggestionId === 'new' ? 'Crea nuovo suggerimento' : 'Modifica suggerimento'}
					</span>
					<button
						type="button"
						class="btn-icon-close"
						onclick={cancelEdit}
						aria-label="Annulla"
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
							class="text-input"
							maxlength="28"
							bind:value={editLabel}
							placeholder="Es. Procedi, Spiega, Verifica..."
						/>
					</div>

					<div class="form-field full">
						<label for="edit-sug-prompt" class="field-label">Testo del prompt inserito nel composer</label>
						<textarea
							id="edit-sug-prompt"
							class="text-input mono"
							rows="3"
							bind:value={editPrompt}
							placeholder="Testo completo che verra' precompilato nel composer..."
						></textarea>
					</div>
				</div>

				{#if editFormError}
					<div class="form-msg error">{editFormError}</div>
				{/if}

				<div class="editor-footer">
					<div class="footer-left">
						<button type="button" class="btn-action primary" onclick={saveSuggestionForm}>
							<IconCheck />
							<span>Salva suggerimento</span>
						</button>
						<button type="button" class="btn-action" onclick={cancelEdit}>
							Annulla
						</button>
					</div>

					{#if editingSuggestionId !== 'new'}
						{@const currentSug = (settingsStore.promptSuggestions || []).find((s) => s.id === editingSuggestionId)}
						{#if currentSug?.factoryKey}
							<button
								type="button"
								class="btn-action text-warn"
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
						class:is-editing={editingSuggestionId === s.id}
						role="listitem"
					>
						<!-- Riordino -->
						<div class="col-order">
							<button
								type="button"
								class="order-btn"
								disabled={idx === 0}
								onclick={() => handleMove(s.id, -1)}
								title="Sposta su"
								aria-label="Sposta su"
							>
								▲
							</button>
							<button
								type="button"
								class="order-btn"
								disabled={idx === (settingsStore.promptSuggestions || []).length - 1}
								onclick={() => handleMove(s.id, 1)}
								title="Sposta giù"
								aria-label="Sposta giù"
							>
								▼
							</button>
						</div>

						<!-- Info Suggerimento -->
						<div class="col-main">
							<div class="row-top">
								<span class="sug-name">{s.label}</span>
								{#if composerSlot !== null}
									<span class="slot-pill" title={`Visibile nel composer come chip ${composerSlot}`}>
										Alt+{composerSlot}
									</span>
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
							<button
								type="button"
								class="btn-row-action"
								onclick={() => openEditForm(s)}
								title="Modifica suggerimento"
								aria-label={`Modifica ${s.label}`}
							>
								<IconRename />
							</button>
							<button
								type="button"
								class="btn-row-action"
								onclick={() => handleDuplicate(s.id)}
								title="Duplica suggerimento"
								aria-label={`Duplica ${s.label}`}
							>
								<IconCopy />
							</button>
							<button
								type="button"
								class="btn-row-action"
								class:active-hidden={s.hidden}
								onclick={() => handleToggleHidden(s)}
								title={s.hidden ? 'Mostra nel composer' : 'Nascondi dal composer'}
								aria-label={s.hidden ? 'Mostra nel composer' : 'Nascondi dal composer'}
							>
								{s.hidden ? 'Mostra' : 'Nascondi'}
							</button>
							{#if s.factoryKey}
								<button
									type="button"
									class="btn-row-action"
									onclick={() => handleResetFactory(s)}
									title="Ripristina testo e configurazione originale di fabbrica"
									aria-label={`Ripristina ${s.label} di fabbrica`}
								>
									<IconRefresh />
								</button>
							{:else}
								<button
									type="button"
									class="btn-row-action danger"
									class:armed={deleteArmedId === s.id}
									onclick={() => handleDelete(s.id)}
									title={deleteArmedId === s.id ? 'Clicca di nuovo per confermare eliminazione' : 'Elimina suggerimento'}
									aria-label={deleteArmedId === s.id ? 'Conferma eliminazione' : `Elimina ${s.label}`}
								>
									{#if deleteArmedId === s.id}
										<span>Sicuro?</span>
									{:else}
										<IconTrash />
									{/if}
								</button>
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
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-warning {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
		margin-top: 4px;
	}

	.form-row-help {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.4;
		margin-top: 2px;
	}

	.form-row-help code {
		font-family: var(--font-mono);
		font-size: 11px;
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

	select {
		height: 30px;
		padding: 0 var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		outline: none;
		transition: border-color var(--dur-fast);
		min-width: 200px;
	}

	select:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
		border-color: var(--brand);
	}

	select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.text-input {
		height: 30px;
		padding: 0 var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		outline: none;
		transition: border-color var(--dur-fast);
		width: 100%;
		box-sizing: border-box;
	}

	.text-input.number-input {
		width: 80px;
		text-align: right;
	}

	.text-input.mono {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		height: auto;
		padding: var(--space-2);
		resize: vertical;
	}

	.text-input:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
		border-color: var(--brand);
	}

	.text-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Switch component */
	.switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.slider {
		position: absolute;
		inset: 0;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.slider::before {
		position: absolute;
		content: "";
		height: 12px;
		width: 12px;
		left: 2px;
		bottom: 2px;
		background: var(--ink-muted);
		border-radius: 50%;
		transition: transform var(--dur-fast), background var(--dur-fast);
	}

	.switch input:checked + .slider {
		background: var(--brand);
		border-color: var(--brand);
	}

	.switch input:checked + .slider::before {
		transform: translateX(14px);
		background: var(--on-brand);
	}

	.switch input:focus-visible + .slider {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
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
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.4;
	}

	/* Bottoni azione standard */
	.btn-action {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 5px var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
	}

	.btn-action:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.btn-action:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.btn-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-action.primary {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--on-brand);
		font-weight: 500;
	}

	.btn-action.primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn-action.text-warn {
		color: var(--warn-ink);
	}

	.btn-action.text-warn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--warn) 12%, var(--bg-raised));
		border-color: var(--warn);
	}

	/* Inline editor card */
	.inline-editor-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--brand);
		border-radius: var(--radius-md);
	}

	.editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.editor-title {
		font-size: var(--text-sm);
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
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.btn-icon-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.btn-icon-close:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
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
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.char-counter {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--ink-faint);
	}

	.char-counter.warn {
		color: var(--warn-ink);
	}

	.char-counter.limit {
		color: var(--danger-ink);
		font-weight: 600;
	}

	.form-msg.error {
		font-size: var(--text-xs);
		color: var(--danger-ink);
		background: color-mix(in srgb, var(--danger) 10%, var(--bg-raised));
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
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-align: center;
	}

	.suggestion-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
		transition: background var(--dur-fast);
	}

	.suggestion-row:last-child {
		border-bottom: none;
	}

	.suggestion-row:hover {
		background: var(--bg-hover);
	}

	.suggestion-row.is-editing {
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-raised));
	}

	.suggestion-row.hidden-sug {
		opacity: 0.55;
	}

	.col-order {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex-shrink: 0;
	}

	.order-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 14px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: 2px;
		color: var(--ink-muted);
		font-size: 8px;
		cursor: pointer;
	}

	.order-btn:hover:not(:disabled) {
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.order-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
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
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.slot-pill {
		font-size: 10px;
		font-family: var(--font-mono);
		font-weight: 600;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--brand) 15%, var(--bg-sunken));
		border: 1px solid color-mix(in srgb, var(--brand) 40%, var(--line));
		color: var(--brand-ink);
	}

	.factory-pill {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-faint);
	}

	.hidden-pill {
		font-size: 10px;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-faint);
	}

	.sug-prompt {
		margin: 0;
		font-size: var(--text-xs);
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
		padding: 0 6px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: 11px;
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-row-action:hover {
		background: var(--bg-sunken);
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-row-action:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.btn-row-action.active-hidden {
		color: var(--ink-faint);
	}

	.btn-row-action.danger:hover {
		background: color-mix(in srgb, var(--danger) 12%, var(--bg-raised));
		border-color: var(--danger);
		color: var(--danger-ink);
	}

	.btn-row-action.danger.armed {
		background: var(--danger);
		border-color: var(--danger);
		color: var(--on-brand);
		font-weight: 500;
		padding: 0 8px;
	}
</style>
