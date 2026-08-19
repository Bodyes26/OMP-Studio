<script lang="ts">
	import {
		modelSettingsStore,
		type CustomProviderDef,
		type CustomModelDef
	} from '$lib/stores/modelSettings.svelte';
	import { slide } from 'svelte/transition';

	const KNOWN_BUILTIN_PROVIDERS = [
		{ id: 'anthropic', name: 'Anthropic Claude', desc: 'Claude Opus, Sonnet, Haiku', icon: '🟠' },
		{ id: 'openai-codex', name: 'OpenAI Codex (OAuth)', desc: 'GPT-5.6 Terra, Sol, Luna (ChatGPT Pro/Plus/Team)', icon: '🟢' },
		{ id: 'google-antigravity', name: 'Google Antigravity', desc: 'Gemini 3.1 Pro, 3.6/3.7 Flash Tiered', icon: '🔵' },
		{ id: 'opencode-go', name: 'OpenCode Go', desc: 'DeepSeek V4, Kimi K2.7, GLM-5', icon: '🟣' },
		{ id: 'opencode-zen', name: 'OpenCode Zen', desc: 'Modelli Free e ad alto rendimento', icon: '🟣' },
		{ id: 'perplexity', name: 'Perplexity Search', desc: 'Sonar reasoning e web grounding', icon: '🌐' },
		{ id: 'cerebras', name: 'Cerebras', desc: 'Llama 3.3 70B ultra-fast inference', icon: '⚡' },
		{ id: 'tavily', name: 'Tavily Search', desc: 'Web search engine per subagenti', icon: '🔍' },
		{ id: 'ollama-cloud', name: 'Ollama Cloud', desc: 'Ollama cloud-hosted models', icon: '🦙' },
		{ id: 'openrouter', name: 'OpenRouter', desc: 'Gateway multi-provider unificato', icon: '🔀' },
		{ id: 'cursor', name: 'Cursor AI', desc: 'Modelli Cursor account', icon: '🖱️' },
		{ id: 'devin', name: 'Devin AI', desc: 'Cognition models', icon: '🤖' },
		{ id: 'groq', name: 'Groq LPU', desc: 'LPU high-speed inference', icon: '⚡' },
		{ id: 'mistral', name: 'Mistral AI', desc: 'Mistral Large, Codestral, Pixtral', icon: '🌪️' },
		{ id: 'xai', name: 'xAI Grok', desc: 'Grok 3, Grok Vision', icon: '✖️' },
		{ id: 'zai', name: 'Zhipu AI (GLM)', desc: 'GLM-4 e GLM-5 models', icon: '🇨🇳' },
		{ id: 'llama.cpp', name: 'llama.cpp (Local)', desc: 'Server locale llama.cpp', icon: '💻' },
		{ id: 'lm-studio', name: 'LM Studio (Local)', desc: 'Server locale LM Studio', icon: '💻' }
	];

	// Stato locale per l'editor dei provider custom
	let customDraft = $state<Record<string, CustomProviderDef>>({});
	let editingProviderName = $state<string | null>(null);
	let newProviderName = $state('');
	let showNewProviderForm = $state(false);

	$effect(() => {
		// Sincronizza lo stato con lo store quando cambia
		customDraft = JSON.parse(JSON.stringify(modelSettingsStore.customProviders));
	});

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
		if (customDraft[name]) {
			modelSettingsStore.showToast('Un provider con questo nome esiste già');
			return;
		}

		customDraft[name] = {
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
		};

		editingProviderName = name;
		showNewProviderForm = false;
	}

	function handleDeleteCustomProvider(name: string) {
		const updated = { ...customDraft };
		delete updated[name];
		customDraft = updated;
		if (editingProviderName === name) editingProviderName = null;
		void modelSettingsStore.saveCustomProviders(customDraft);
	}

	function handleAddCustomModel(providerName: string) {
		const prov = customDraft[providerName];
		if (!prov) return;
		prov.models.push({
			id: `model-${prov.models.length + 1}`,
			name: `Custom Model ${prov.models.length + 1}`,
			contextWindow: 128000,
			maxTokens: 8192,
			reasoning: false,
			input: ['text']
		});
		customDraft[providerName] = { ...prov };
	}

	function handleDeleteCustomModel(providerName: string, modelIndex: number) {
		const prov = customDraft[providerName];
		if (!prov) return;
		prov.models.splice(modelIndex, 1);
		customDraft[providerName] = { ...prov };
	}

	async function handleSaveCustomChanges() {
		await modelSettingsStore.saveCustomProviders(customDraft);
		editingProviderName = null;
	}
</script>

<div class="providers-tab">
	<!-- Sezione 1: Provider Built-in & Autenticazione -->
	<div class="section-card">
		<div class="section-header">
			<div class="section-title-group">
				<h4>Provider Supportati e Stato Autenticazione</h4>
				<p>Abilita o disabilita i provider per la ricerca dei modelli e verifica quali account risultano autenticati in OMP.</p>
			</div>
		</div>

		<div class="providers-grid">
			{#each KNOWN_BUILTIN_PROVIDERS as p (p.id)}
				{@const disabled = isProviderDisabled(p.id)}
				{@const authList = getAuthSummary(p.id)}
				{@const isAuthed = authList.some(a => !a.disabledCause)}

				<div class="provider-row-card" class:disabled>
					<div class="provider-left">
						<span class="p-icon">{p.icon}</span>
						<div class="p-info">
							<div class="p-name-row">
								<span class="p-name">{p.name}</span>
								<span class="p-id">({p.id})</span>
							</div>
							<span class="p-desc">{p.desc}</span>
							{#if authList.length > 0}
								<div class="p-auth-badges">
									{#each authList as auth}
										{#if auth.disabledCause}
											<span class="auth-chip error" title={auth.disabledCause}>
												⚠️ {auth.identityKey?.replace('email:', '') || auth.credentialType} (Non valido)
											</span>
										{:else}
											<span class="auth-chip success">
												✓ {auth.identityKey?.replace('email:', '') || (auth.credentialType === 'oauth' ? 'OAuth collegato' : 'API Key attiva')}
											</span>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					</div>

					<div class="provider-right">
						<label class="switch" title={disabled ? 'Abilita provider' : 'Disabilita provider'}>
							<input
								type="checkbox"
								checked={!disabled}
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
	<div class="section-card">
		<div class="section-header">
			<div class="section-title-group">
				<h4>🔌 Provider Custom & Endpoint Locali</h4>
				<p>Configura proxy compatibili OpenAI/Anthropic, endpoint Ollama locali o gateway aziendali memorizzati in <code>~/.omp/agent/models.json</code>.</p>
			</div>
			<button class="btn btn-secondary" onclick={handleStartNewProvider}>
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
						placeholder="Identificativo provider (es. my-ollama, local-llm, xkiro)..."
						onkeydown={(e) => { if (e.key === 'Enter') handleCreateProvider(); }}
					/>
					<button class="btn btn-primary" onclick={handleCreateProvider}>Crea</button>
					<button class="btn btn-secondary" onclick={() => showNewProviderForm = false}>Annulla</button>
				</div>
			</div>
		{/if}

		<div class="custom-providers-list">
			{#each Object.entries(customDraft) as [pName, pDef] (pName)}
				{@const isEditing = editingProviderName === pName}

				<div class="custom-provider-card">
					<div class="cp-header">
						<div class="cp-titles">
							<span class="cp-name">{pName}</span>
							<span class="cp-url">{pDef.baseUrl}</span>
							<span class="cp-count">{pDef.models.length} modelli definiti</span>
						</div>
						<div class="cp-actions">
							<button
								class="btn btn-sm btn-secondary"
								onclick={() => editingProviderName = isEditing ? null : pName}
							>
								{isEditing ? 'Comprimi' : 'Modifica'}
							</button>
							<button
								class="btn btn-sm btn-danger"
								onclick={() => handleDeleteCustomProvider(pName)}
							>
								Elimina
							</button>
						</div>
					</div>

					{#if isEditing}
						<div class="cp-editor" transition:slide={{ duration: 180 }}>
							<div class="form-grid">
								<label class="form-field">
									<span>Base URL</span>
									<input type="text" bind:value={pDef.baseUrl} placeholder="https://api.openai.com/v1" />
								</label>

								<label class="form-field">
									<span>API Key (Opzionale)</span>
									<input type="password" bind:value={pDef.apiKey} placeholder="sk-..." />
								</label>

								<label class="form-field">
									<span>Formato API</span>
									<select bind:value={pDef.api}>
										<option value="openai-completions">openai-completions (Standard)</option>
										<option value="openai-responses">openai-responses (OpenAI Codex)</option>
										<option value="anthropic-messages">anthropic-messages (Claude)</option>
									</select>
								</label>
							</div>

							<!-- Modelli del provider custom -->
							<div class="custom-models-section">
								<div class="cm-header">
									<span>Modelli Definiti per {pName}</span>
									<button class="btn btn-sm btn-secondary" onclick={() => handleAddCustomModel(pName)}>
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
											/>
											<input
												type="text"
												class="inp-name"
												bind:value={model.name}
												placeholder="Nome visualizzato"
											/>
											<input
												type="number"
												class="inp-num"
												bind:value={model.contextWindow}
												placeholder="Context (128000)"
											/>
											<input
												type="number"
												class="inp-num"
												bind:value={model.maxTokens}
												placeholder="Max tokens (8192)"
											/>
											<label class="chk-cap" title="Supporta Reasoning / Thinking">
												<input type="checkbox" bind:checked={model.reasoning} />
												<span>🧠</span>
											</label>
											<button
												class="btn-del-model"
												onclick={() => handleDeleteCustomModel(pName, mIdx)}
												title="Elimina modello"
											>
												✕
											</button>
										</div>
									{/each}
								</div>
							</div>

							<div class="cp-footer">
								<button class="btn btn-primary" onclick={handleSaveCustomChanges}>Salva Provider</button>
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<div class="empty-custom">
					Nessun provider personalizzato configurato. Clicca "+ Aggiungi Provider Custom" per configurare endpoint OpenAI-compatibili o Ollama locali.
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.providers-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-2) 0;
	}

	.section-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
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
		padding-bottom: var(--space-3);
	}

	.section-title-group h4 {
		margin: 0 0 2px 0;
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
	}

	.section-title-group p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.section-title-group code {
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
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		transition: opacity 0.15s ease, border-color 0.15s ease;
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

	.p-icon {
		font-size: 16px;
		line-height: 1.2;
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
		font-size: var(--text-sm);
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
	}

	.auth-chip.success {
		background: rgba(16, 163, 127, 0.12);
		color: #10a37f;
	}

	.auth-chip.error {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
	}

	/* Switch component */
	.switch {
		position: relative;
		display: inline-block;
		width: 36px;
		height: 20px;
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
		top: 0; left: 0; right: 0; bottom: 0;
		background-color: var(--line-strong);
		transition: 0.2s;
		border-radius: 20px;
	}

	.slider:before {
		position: absolute;
		content: "";
		height: 14px;
		width: 14px;
		left: 3px;
		bottom: 3px;
		background-color: white;
		transition: 0.2s;
		border-radius: 50%;
	}

	input:checked + .slider {
		background-color: var(--brand);
	}

	input:checked + .slider:before {
		transform: translateX(16px);
	}

	.new-provider-box {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--brand);
		border-radius: var(--radius-md);
	}

	.box-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.new-provider-inputs {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.new-provider-inputs input {
		flex: 1;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 6px 10px;
		font-family: inherit;
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.custom-providers-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.custom-provider-card {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.cp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3);
		gap: var(--space-2);
	}

	.cp-titles {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.cp-name {
		font-size: var(--text-sm);
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--brand-ink);
	}

	.cp-url {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--ink-faint);
	}

	.cp-count {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 99px;
		background: var(--bg-base);
		color: var(--ink-muted);
	}

	.cp-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.cp-editor {
		padding: var(--space-3);
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--bg-base);
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-2);
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.form-field input,
	.form-field select {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 6px 8px;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--ink);
		outline: none;
	}

	.custom-models-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	.cm-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
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
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 5px 8px;
		font-size: var(--text-xs);
		font-family: inherit;
		color: var(--ink);
	}

	.inp-id { flex: 2; font-family: var(--font-mono) !important; }
	.inp-name { flex: 2; }
	.inp-num { width: 90px; }

	.chk-cap {
		display: flex;
		align-items: center;
		gap: 2px;
		font-size: 12px;
		cursor: pointer;
	}

	.btn-del-model {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: 12px;
		padding: 4px 6px;
	}

	.btn-del-model:hover {
		color: var(--danger, #ef4444);
	}

	.cp-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--space-2);
	}

	.empty-custom {
		padding: var(--space-4);
		text-align: center;
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}

	.btn {
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		transition: all 0.15s ease;
	}

	.btn-sm {
		padding: 3px 8px;
		font-size: 11px;
	}

	.btn-secondary {
		background: var(--bg-sunken);
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-secondary:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.btn-danger {
		background: transparent;
		border-color: transparent;
		color: var(--danger, #ef4444);
	}

	.btn-danger:hover {
		background: rgba(239, 68, 68, 0.1);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}

	.btn-primary:hover {
		filter: brightness(1.1);
	}
</style>
