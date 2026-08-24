<script lang="ts">
	import {
		modelSettingsStore,
		type CustomProviderDef
	} from '$lib/stores/modelSettings.svelte';
	import { slide, fade } from 'svelte/transition';

	const KNOWN_BUILTIN_PROVIDERS = [
		{ id: 'anthropic', name: 'Anthropic Claude', desc: 'Claude Opus, Sonnet, Haiku', abbr: 'CL' },
		{ id: 'openai-codex', name: 'OpenAI Codex (OAuth)', desc: 'GPT-5.6 Terra, Sol, Luna (ChatGPT Pro/Plus/Team)', abbr: 'OA' },
		{ id: 'google-antigravity', name: 'Google Antigravity', desc: 'Gemini 3.1 Pro, 3.6/3.7 Flash Tiered', abbr: 'GO' },
		{ id: 'opencode-go', name: 'OpenCode Go', desc: 'DeepSeek V4, Kimi K2.7, GLM-5', abbr: 'OG' },
		{ id: 'opencode-zen', name: 'OpenCode Zen', desc: 'Modelli Free e ad alto rendimento', abbr: 'OZ' },
		{ id: 'perplexity', name: 'Perplexity Search', desc: 'Sonar reasoning e web grounding', abbr: 'PX' },
		{ id: 'cerebras', name: 'Cerebras', desc: 'Llama 3.3 70B ultra-fast inference', abbr: 'CB' },
		{ id: 'tavily', name: 'Tavily Search', desc: 'Web search engine per subagenti', abbr: 'TV' },
		{ id: 'ollama-cloud', name: 'Ollama Cloud', desc: 'Ollama cloud-hosted models', abbr: 'OL' },
		{ id: 'openrouter', name: 'OpenRouter', desc: 'Gateway multi-provider unificato', abbr: 'OR' },
		{ id: 'cursor', name: 'Cursor AI', desc: 'Modelli Cursor account', abbr: 'CU' },
		{ id: 'devin', name: 'Devin AI', desc: 'Cognition models', abbr: 'DV' },
		{ id: 'groq', name: 'Groq LPU', desc: 'LPU high-speed inference', abbr: 'GQ' },
		{ id: 'mistral', name: 'Mistral AI', desc: 'Mistral Large, Codestral, Pixtral', abbr: 'MS' },
		{ id: 'xai', name: 'xAI Grok', desc: 'Grok 3, Grok Vision', abbr: 'XA' },
		{ id: 'zai', name: 'Zhipu AI (GLM)', desc: 'GLM-4 e GLM-5 models', abbr: 'ZA' },
		{ id: 'llama.cpp', name: 'llama.cpp (Local)', desc: 'Server locale llama.cpp', abbr: 'LC' },
		{ id: 'lm-studio', name: 'LM Studio (Local)', desc: 'Server locale LM Studio', abbr: 'LM' }
	];

	let editingProviderName = $state<string | null>(null);
	let newProviderName = $state('');
	let showNewProviderForm = $state(false);
	let providerToDelete = $state<string | null>(null);

	function isProviderDisabled(id: string): boolean {
		return modelSettingsStore.draftConfig?.disabledProviders.includes(id) || false;
	}

	function toggleProvider(id: string) {
		modelSettingsStore.toggleProviderDisabled(id);
	}

	function getAuthSummary(providerId: string) {
		return modelSettingsStore.authProviders.filter(a => a.provider === providerId || a.provider.startsWith(providerId + ':'));
	}

	function handleStartNewProvider() {
		newProviderName = '';
		showNewProviderForm = true;
	}

	function handleCreateProvider() {
		const name = newProviderName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
		if (!name) return;
		if (modelSettingsStore.draftCustomProviders[name]) {
			modelSettingsStore.showToast('Un provider con questo identificativo esiste già');
			return;
		}

		modelSettingsStore.setDraftCustomProvider(name, {
			baseUrl: 'http://127.0.0.1:11434/v1',
			apiKey: '',
			api: 'openai-completions',
			models: [
				{
					id: 'my-model-1',
					name: 'My Custom Model',
					contextWindow: 128000,
					maxTokens: 8192,
					reasoning: false,
					input: ['text']
				}
			]
		});

		editingProviderName = name;
		showNewProviderForm = false;
	}

	function confirmDeleteCustomProvider(name: string) {
		providerToDelete = name;
	}

	function executeDeleteCustomProvider() {
		if (!providerToDelete) return;
		modelSettingsStore.deleteDraftCustomProvider(providerToDelete);
		if (editingProviderName === providerToDelete) {
			editingProviderName = null;
		}
		providerToDelete = null;
		modelSettingsStore.showToast('Provider rimosso dalla bozza');
	}

	function cancelDeleteCustomProvider() {
		providerToDelete = null;
	}

	function handleAddCustomModel(providerName: string) {
		const prov = modelSettingsStore.draftCustomProviders[providerName];
		if (!prov) return;
		modelSettingsStore.addDraftCustomModel(providerName, {
			id: `model-${prov.models.length + 1}`,
			name: `Custom Model ${prov.models.length + 1}`,
			contextWindow: 128000,
			maxTokens: 8192,
			reasoning: false,
			input: ['text']
		});
	}

	function handleDeleteCustomModel(providerName: string, modelIndex: number) {
		modelSettingsStore.deleteDraftCustomModel(providerName, modelIndex);
	}
</script>

<div class="providers-tab">
	<!-- Sezione 1: Provider Built-in & Autenticazione -->
	<div class="section-group">
		<div class="section-header">
			<div class="section-title-group">
				<h4 class="section-title">Provider Supportati e Stato Autenticazione</h4>
				<span class="section-desc">Abilita o disabilita i provider per la ricerca e controlla le credenziali attive.</span>
			</div>
		</div>

		<div class="providers-grid">
			{#each KNOWN_BUILTIN_PROVIDERS as p (p.id)}
				{@const disabled = isProviderDisabled(p.id)}
				{@const authList = getAuthSummary(p.id)}

				<div class="provider-row-card" class:disabled>
					<div class="provider-left">
						<span class="p-abbr-badge">{p.abbr}</span>
						<div class="p-info">
							<div class="p-name-row">
								<span class="p-name">{p.name}</span>
								<span class="p-id">({p.id})</span>
							</div>
							<span class="p-desc">{p.desc}</span>
							{#if authList.length > 0}
								<div class="p-auth-badges">
									{#each authList as auth}
										<span class="auth-chip" class:invalid={!!auth.disabledCause} title={auth.disabledCause || 'Credenziale verificata'}>
											{auth.disabledCause ? 'Non valido' : 'Attivo'} · {auth.identityKey?.replace('email:', '') || auth.credentialType}
										</span>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					<div class="provider-right">
						<label class="switch" for="switch-{p.id}">
							<input
								id="switch-{p.id}"
								type="checkbox"
								checked={!disabled}
								aria-label="Abilita provider {p.name}"
								onchange={() => toggleProvider(p.id)}
							/>
							<span class="slider"></span>
						</label>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Sezione 2: Custom Providers (models.json) -->
	<div class="section-group">
		<div class="section-header">
			<div class="section-title-group">
				<h4 class="section-title">Provider Custom & Endpoint Locali</h4>
				<span class="section-desc">Configura proxy OpenAI-compatibili, Ollama locali o gateway configurati su <code>models.json</code>.</span>
			</div>
			<button type="button" class="btn btn-secondary" onclick={handleStartNewProvider}>
				+ Aggiungi Provider Custom
			</button>
		</div>

		{#if showNewProviderForm}
			<div class="new-provider-box" transition:slide={{ duration: 150 }}>
				<span class="box-title">Nuovo Provider Personalizzato</span>
				<div class="new-provider-inputs">
					<input
						type="text"
						bind:value={newProviderName}
						placeholder="Identificativo provider (es. my-ollama, local-llm)..."
						aria-label="Identificativo nuovo provider"
						onkeydown={(e) => { if (e.key === 'Enter') handleCreateProvider(); }}
					/>
					<button type="button" class="btn btn-primary" onclick={handleCreateProvider}>Crea</button>
					<button type="button" class="btn btn-secondary" onclick={() => showNewProviderForm = false}>Annulla</button>
				</div>
			</div>
		{/if}

		<div class="custom-providers-list">
			{#if Object.keys(modelSettingsStore.draftCustomProviders).length === 0}
				<div class="empty-custom">
					Nessun provider personalizzato configurato. Clicca "+ Aggiungi Provider Custom" per configurare endpoint OpenAI-compatibili o server locali.
				</div>
			{:else}
				{#each Object.entries(modelSettingsStore.draftCustomProviders) as [pName, pDef] (pName)}
					{@const isEditing = editingProviderName === pName}

					<div class="custom-provider-card">
						<div class="cp-header">
							<div class="cp-titles">
								<span class="cp-name">{pName}</span>
								<span class="cp-url">{pDef.baseUrl}</span>
								<span class="cp-count">{pDef.models.length} modelli</span>
							</div>
							<div class="cp-actions">
								<button
									type="button"
									class="btn btn-sm btn-secondary"
									onclick={() => editingProviderName = isEditing ? null : pName}
								>
									{isEditing ? 'Comprimi' : 'Modifica'}
								</button>
								<button
									type="button"
									class="btn btn-sm btn-secondary"
									onclick={() => confirmDeleteCustomProvider(pName)}
								>
									Elimina
								</button>
							</div>
						</div>

						{#if isEditing}
							<div class="cp-editor" transition:slide={{ duration: 160 }}>
								<div class="form-grid">
									<label class="form-field">
										<span class="field-label">Base URL</span>
										<input type="text" bind:value={pDef.baseUrl} placeholder="https://api.openai.com/v1" />
									</label>

									<label class="form-field">
										<span class="field-label">API Key (Opzionale)</span>
										<input type="password" bind:value={pDef.apiKey} placeholder="sk-..." />
									</label>

									<label class="form-field">
										<span class="field-label">Formato API</span>
										<select bind:value={pDef.api}>
											<option value="openai-completions">openai-completions (Standard)</option>
											<option value="openai-responses">openai-responses (Codex)</option>
											<option value="anthropic-messages">anthropic-messages (Claude)</option>
										</select>
									</label>
								</div>

								<!-- Modelli del provider custom -->
								<div class="custom-models-section">
									<div class="cm-header">
										<span class="cm-title">Modelli Definiti</span>
										<button type="button" class="btn btn-sm btn-secondary" onclick={() => handleAddCustomModel(pName)}>
											+ Aggiungi Modello
										</button>
									</div>

									<div class="models-list">
										{#each pDef.models as model, mIdx (mIdx)}
											<div class="model-edit-row">
												<input
													type="text"
													class="inp-id"
													bind:value={model.id}
													placeholder="ID Modello (es. qwen2.5-coder)"
													aria-label="ID Modello"
												/>
												<input
													type="text"
													class="inp-name"
													bind:value={model.name}
													placeholder="Nome visualizzato"
													aria-label="Nome visualizzato modello"
												/>
												<input
													type="number"
													class="inp-num"
													bind:value={model.contextWindow}
													placeholder="Context (128000)"
													aria-label="Finestra di contesto"
												/>
												<input
													type="number"
													class="inp-num"
													bind:value={model.maxTokens}
													placeholder="Max tokens (8192)"
													aria-label="Max output tokens"
												/>
												<label class="chk-cap" title="Supporta Reasoning / Thinking">
													<input type="checkbox" bind:checked={model.reasoning} />
													<span class="chk-label">Reasoning</span>
												</label>
												<button
													type="button"
													class="btn-del-model"
													onclick={() => handleDeleteCustomModel(pName, mIdx)}
													title="Elimina modello"
													aria-label="Elimina modello"
												>
													<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
														<path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
													</svg>
												</button>
											</div>
										{/each}
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>

	<!-- Dialog di conferma eliminazione custom provider -->
	{#if providerToDelete}
		<div class="confirm-overlay" transition:fade={{ duration: 100 }}>
			<div class="confirm-box" transition:slide={{ duration: 150 }}>
				<h4>Eliminare il provider personalizzato "{providerToDelete}"?</h4>
				<p>Il provider e i suoi modelli definiti verranno rimossi dalla bozza.</p>
				<div class="confirm-actions">
					<button type="button" class="btn btn-secondary" onclick={cancelDeleteCustomProvider}>Annulla</button>
					<button type="button" class="btn btn-primary" onclick={executeDeleteCustomProvider}>Elimina</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.providers-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		position: relative;
	}

	.section-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.section-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
		border-bottom: 1px solid var(--line);
		padding-bottom: var(--space-2);
	}

	.section-title-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.section-title {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.section-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.section-desc code {
		font-family: var(--font-mono);
	}

	.providers-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: var(--space-2);
	}

	.provider-row-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		transition: opacity var(--dur-fast), border-color var(--dur-fast);
	}

	.provider-row-card:hover {
		border-color: var(--line-strong);
	}

	.provider-row-card.disabled {
		opacity: 0.55;
	}

	.provider-left {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-width: 0;
		flex: 1;
	}

	.p-abbr-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--ink);
		flex-shrink: 0;
	}

	.p-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.p-name-row {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}

	.p-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.p-id {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--ink-faint);
	}

	.p-desc {
		font-size: 11px;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.p-auth-badges {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 2px;
		flex-wrap: wrap;
	}

	.auth-chip {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.auth-chip.invalid {
		color: var(--danger);
		border-color: var(--danger-dim);
	}

	.provider-right {
		flex-shrink: 0;
	}

	.switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
		cursor: pointer;
	}

	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.slider {
		position: absolute;
		inset: 0;
		background: var(--bg-hover);
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

	input:checked + .slider {
		background: var(--brand);
		border-color: var(--brand);
	}

	input:checked + .slider::before {
		transform: translateX(14px);
		background: var(--on-brand);
	}

	.custom-providers-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.custom-provider-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.cp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.cp-titles {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.cp-name {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.cp-url {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
	}

	.cp-count {
		font-size: 11px;
		color: var(--ink-faint);
		background: var(--bg-hover);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.cp-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.cp-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		border-top: 1px solid var(--line);
		padding-top: var(--space-2);
		margin-top: 2px;
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-2);
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.field-label {
		font-size: 10px;
		font-weight: 500;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.form-field input,
	.form-field select {
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
	}

	.form-field input:focus,
	.form-field select:focus {
		border-color: var(--brand);
	}

	.custom-models-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}

	.cm-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.cm-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.models-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.model-edit-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.model-edit-row input {
		height: 28px;
		padding: 0 6px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: 11px;
		font-family: var(--font-mono);
		outline: none;
	}

	.model-edit-row input:focus {
		border-color: var(--brand);
	}

	.inp-id { flex: 2; min-width: 0; }
	.inp-name { flex: 2; min-width: 0; }
	.inp-num { width: 90px; flex-shrink: 0; }

	.chk-cap {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
		font-size: 10px;
		color: var(--ink-muted);
		padding: 0 4px;
	}

	.btn-del-model {
		width: 24px;
		height: 24px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.btn-del-model:hover {
		background: var(--bg-hover);
		color: var(--brand-ink);
		border-color: var(--line);
	}

	.new-provider-box {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.box-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.new-provider-inputs {
		display: flex;
		gap: var(--space-2);
	}

	.new-provider-inputs input {
		flex: 1;
		height: 32px;
		padding: 0 var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		outline: none;
	}

	.new-provider-inputs input:focus {
		border-color: var(--brand);
	}

	.empty-custom {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		padding: var(--space-4) 0;
		text-align: center;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px 12px;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 500;
		font-family: var(--font-ui);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-sm {
		padding: 3px 8px;
		font-size: 11px;
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-secondary:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}

	.btn-primary:hover {
		filter: brightness(1.08);
	}

	.confirm-overlay {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--bg-base) 85%, black);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-overlay);
	}

	.confirm-box {
		width: 380px;
		max-width: 90%;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		box-shadow: var(--shadow-overlay);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.confirm-box h4 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.confirm-box p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
</style>
