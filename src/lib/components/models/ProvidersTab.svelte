<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import {
		modelSettingsStore,
		isAuthAccountActive,
		getProviderEnvVarHint,
		type ProviderSummary,
		type AuthAccount
	} from '$lib/stores/modelSettings.svelte';
	import {
		IconClose,
		IconPlus,
		IconSearch,
		IconAccount,
		IconModels,
		IconTrash,
		IconPlug
	} from '$lib/icons';
	import Terminal from '$lib/terminal/Terminal.svelte';
	import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	let searchQuery = $state('');
	let listRootEl = $state<HTMLDivElement | null>(null);

	let addMenuOpen = $state(false);
	let addMenuMode = $state<'pick' | 'custom'>('pick');
	let newProviderName = $state('');

	let providerToDelete = $state<string | null>(null);
	let accountToRemove = $state<AuthAccount | null>(null);
	let removingAccountId = $state<number | null>(null);
	// Provider di cui e' aperto il terminale di accesso (`omp login <id>`).
	let loginTarget = $state<{ id: string; name: string } | null>(null);

	// Elenco unificato: provider noti al backend (builtin/plugin/custom salvati) piu'
	// eventuali provider Custom appena creati in bozza e non ancora salvati.
	const displayProviders = $derived.by<ProviderSummary[]>(() => {
		const base = modelSettingsStore.providers;
		const known = new Set(base.map((p) => p.id));
		const extra: ProviderSummary[] = [];
		for (const [name, def] of Object.entries(modelSettingsStore.draftCustomProviders)) {
			if (!known.has(name)) {
				extra.push({
					id: name,
					name,
					source: 'custom',
					enabled: true,
					configured: true,
					authOrigin: 'custom',
					availableModelCount: def.models.length,
					accountCount: 0,
					hasOauth: false,
					isCustom: true
				});
			}
		}
		return [...base, ...extra];
	});

	const filteredProviders = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return displayProviders;
		return displayProviders.filter(
			(p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
		);
	});

	const unconfiguredProviders = $derived(displayProviders.filter((p) => !p.configured));

	const selectedProvider = $derived(
		displayProviders.find((p) => p.id === modelSettingsStore.selectedProviderId) ?? null
	);

	const selectedAccounts = $derived(
		modelSettingsStore.authAccounts.filter(
			(a) => a.provider === modelSettingsStore.selectedProviderId && isAuthAccountActive(a)
		)
	);

	// `hasOauth`/`authOrigin` contano solo le credenziali attive: quando l'unico
	// account OAuth scade (refresh token revocato) il provider li perde, ed e'
	// proprio il caso in cui serve il pulsante per rifare l'accesso.
	const isOAuthProvider = $derived(
		selectedProvider
			? selectedProvider.hasOauth ||
				selectedProvider.authOrigin === 'oauth' ||
				selectedAccounts.some((a) => a.credentialType === 'oauth')
			: false
	);

	// Seleziona automaticamente il primo provider quando nessuno e' ancora attivo
	$effect(() => {
		if (!modelSettingsStore.selectedProviderId && displayProviders.length > 0) {
			modelSettingsStore.selectProvider(displayProviders[0].id);
		}
	});

	// Gli account vivono in `agent.db` e cambiano fuori da Studio (login da CLI,
	// scadenza token): `ensureLoaded()` non li carica, quindi li leggiamo qui a
	// ogni apertura della tab, cosi' la lista e' sempre quella reale.
	$effect(() => {
		void modelSettingsStore.loadAccounts();
	});

	function isEnabled(id: string): boolean {
		return !(modelSettingsStore.draftConfig?.disabledProviders.includes(id) ?? false);
	}

	function modelCountFor(p: ProviderSummary): number {
		const draft = modelSettingsStore.draftCustomProviders[p.id];
		return p.source === 'custom' && draft ? draft.models.length : p.availableModelCount;
	}

	function activeAccountCountFor(p: ProviderSummary): number {
		if (p.source === 'custom') return 0;
		return modelSettingsStore.authAccounts.filter(
			(a) => a.provider === p.id && isAuthAccountActive(a)
		).length;
	}

	function sourceLabel(source: string): string {
		switch (source) {
			case 'builtin': return 'Built-in';
			case 'plugin': return 'Plugin';
			case 'custom': return 'Custom';
			default: return source;
		}
	}

	function selectProvider(id: string) {
		modelSettingsStore.selectProvider(id);
	}

	function toggleEnabled(id: string) {
		modelSettingsStore.toggleProviderDisabled(id);
	}

	function handleRefreshModels(id: string) {
		void modelSettingsStore.refreshCatalog(id);
	}

	// --- Navigazione da tastiera nella lista provider (roving tabindex) ---
	function focusListItem(delta: number) {
		if (!listRootEl) return;
		const items = Array.from(listRootEl.querySelectorAll<HTMLButtonElement>('.provider-item'));
		if (items.length === 0) return;
		const idx = items.findIndex((el) => el === document.activeElement);
		const nextIdx = idx === -1 ? 0 : Math.min(Math.max(idx + delta, 0), items.length - 1);
		items[nextIdx].focus();
	}

	function handleListKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusListItem(1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			focusListItem(-1);
		} else if (e.key === 'Home') {
			e.preventDefault();
			listRootEl?.querySelector<HTMLButtonElement>('.provider-item')?.focus();
		} else if (e.key === 'End') {
			e.preventDefault();
			const items = listRootEl?.querySelectorAll<HTMLButtonElement>('.provider-item');
			if (items && items.length > 0) items[items.length - 1].focus();
		}
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			listRootEl?.querySelector<HTMLButtonElement>('.provider-item')?.focus();
		} else if (e.key === 'Escape' && searchQuery) {
			e.stopPropagation();
			searchQuery = '';
		}
	}

	// --- Menu "+ Aggiungi provider" ---
	function openAddMenu() {
		if (addMenuOpen) {
			closeAddMenu();
			return;
		}
		addMenuMode = unconfiguredProviders.length > 0 ? 'pick' : 'custom';
		newProviderName = '';
		addMenuOpen = true;
	}

	function closeAddMenu() {
		addMenuOpen = false;
	}

	function pickUnconfiguredProvider(id: string) {
		selectProvider(id);
		closeAddMenu();
	}

	function handleCreateCustomProvider() {
		const name = newProviderName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
		if (!name) return;
		if (displayProviders.some((p) => p.id === name)) {
			modelSettingsStore.showToast(m.ui_providerstab_un_provider_con_questo_identificativo_esiste_gia_5fdf());
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
		selectProvider(name);
		closeAddMenu();
	}

	// --- Editing dei provider Custom (bozza) ---
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

	function confirmDeleteCustomProvider(name: string) {
		providerToDelete = name;
	}

	function cancelDeleteCustomProvider() {
		providerToDelete = null;
	}

	function executeDeleteCustomProvider() {
		if (!providerToDelete) return;
		const name = providerToDelete;
		modelSettingsStore.deleteDraftCustomProvider(name);
		if (modelSettingsStore.selectedProviderId === name) {
			modelSettingsStore.selectedProviderId = null;
		}
		providerToDelete = null;
		modelSettingsStore.showToast(m.providers_tab_provider_removed_toast());
	}

	// --- Stato credenziale account ---
	interface AccountStatus {
		label: string;
		variant: 'ok' | 'warn' | 'danger';
		message?: string;
	}

	function accountStatus(a: AuthAccount): AccountStatus {
		if (!a.hasCredential) {
			return {
				label: m.ui_providerstab_credenziale_mancante_195a(),
				variant: 'danger',
				message: m.ui_providerstab_nessuna_credenziale_valida_salvata_per_questo_account_4e7a()
			};
		}
		if (a.disabledCause) {
			return { label: m.models_providers_disabled(), variant: 'warn', message: a.disabledCause };
		}
		return { label: m.providers_tab_connected(), variant: 'ok' };
	}

	function accountDisplayName(a: AuthAccount): string {
		return a.email || a.accountId || a.identityKey?.replace(/^email:/, '') || a.credentialType;
	}

	function formatDate(ts?: number): string | null {
		if (!ts) return null;
		// Convenzione SQLite: unix epoch in secondi; alcune sorgenti potrebbero gia' essere in ms.
		const ms = ts > 1e12 ? ts : ts * 1000;
		try {
			return i18n.formatDate(ms, { day: '2-digit', month: 'short', year: 'numeric' });
		} catch {
			return null;
		}
	}

	// --- Disconnessione account ---
	function requestRemoveAccount(a: AuthAccount) {
		accountToRemove = a;
	}

	function cancelRemoveAccount() {
		accountToRemove = null;
	}

	async function executeRemoveAccount() {
		if (!accountToRemove) return;
		const acc = accountToRemove;
		removingAccountId = acc.id;
		try {
			await modelSettingsStore.removeAccount(acc.provider, acc.id);
		} finally {
			removingAccountId = null;
			accountToRemove = null;
		}
	}

	// --- Accesso / nuovo account ---
	// Il flusso OAuth e' quello nativo di `omp login <provider>`, ospitato in un
	// terminale come fa il setup guidato: apre il browser, attende il callback e
	// scrive la credenziale in agent.db. Studio rilegge gli account alla chiusura.
	function handleLoginAction(providerId: string) {
		const name = displayProviders.find((p) => p.id === providerId)?.name ?? providerId;
		loginTarget = { id: providerId, name };
	}

	async function closeLogin() {
		loginTarget = null;
		await Promise.all([modelSettingsStore.loadAccounts(), modelSettingsStore.loadProviders()]);
	}

	async function handleCopyEnvHint(envVar: string) {
		try {
			await navigator.clipboard.writeText(envVar);
			modelSettingsStore.showToast(m.providers_tab_copied_toast({ envVar }));
		} catch {
			modelSettingsStore.showToast(m.providers_tab_variable_toast({ envVar }));
		}
	}
</script>

<div class="providers-tab">
	<!-- Colonna sinistra: elenco provider -->
	<aside class="providers-sidebar">
		<div class="sidebar-header">
			<div class="search-box">
				<span class="search-icon">
					<IconSearch />
				</span>
				<input
					type="text"
					class="search-input"
					bind:value={searchQuery}
					onkeydown={handleSearchKeydown}
					placeholder={m.models_providers_search_placeholder()}
					aria-label={m.ui_providerstab_cerca_provider_feaf()}
				/>
				{#if searchQuery}
					<button type="button" class="search-clear-action" onclick={() => (searchQuery = '')} aria-label={m.file_tree_clear_search()}>
						<IconClose />
					</button>
				{/if}
			</div>
		</div>

		<div
			class="providers-list"
			role="listbox"
			aria-label={m.providers_tab_available_providers_aria()}
			tabindex="-1"
			bind:this={listRootEl}
			onkeydown={handleListKeydown}
		>
			{#each filteredProviders as p (p.id)}
				{@const enabled = isEnabled(p.id)}
				{@const selected = p.id === modelSettingsStore.selectedProviderId}

				<button
					type="button"
					class="provider-item"
					role="option"
					aria-selected={selected}
					class:selected
					class:disabled-provider={!enabled}
					tabindex={selected ? 0 : -1}
					onclick={() => selectProvider(p.id)}
				>
					<div class="provider-item-top">
						<span class="provider-item-name">{p.name}</span>
						<span class="origin-badge origin-{p.source}">
							{#if p.source === 'plugin'}
								<IconPlug />
							{/if}
							<span>{sourceLabel(p.source)}</span>
						</span>
					</div>
					<div class="provider-item-id">{p.id}</div>
					<div class="provider-item-bottom">
						<span class="provider-status">
							<StatusMark status={enabled ? 'completed' : 'pending'} active={enabled} />
							<span>{enabled ? m.models_providers_enabled() : m.models_providers_disabled()}</span>
						</span>
						<Tooltip text={m.providers_tab_connected_accounts()}>
							<span class="count-pill">
								<IconAccount />
								<span>{activeAccountCountFor(p)}</span>
							</span>
						</Tooltip>
						<Tooltip text={m.providers_tab_available_models()}>
							<span class="count-pill">
								<IconModels />
								<span>{modelCountFor(p)}</span>
							</span>
						</Tooltip>
					</div>
				</button>
			{/each}

			{#if filteredProviders.length === 0}
				<div class="no-providers-found">{m.providers_tab_no_providers_found()}</div>
			{/if}
		</div>

		<div class="sidebar-footer">
			<MenuButton
				open={addMenuOpen}
				onToggle={openAddMenu}
				onClose={closeAddMenu}
				ariaLabel={m.ui_providerstab_aggiungi_provider_5da0()}
				hasPopup="dialog"
				contentRole="dialog"
				width="250px"
				className="add-provider-trigger ui-button ui-button-secondary"
			>
				{#snippet trigger()}
					<IconPlus />
					<span>{m.ui_providerstab_aggiungi_provider_5da0()}</span>
				{/snippet}

				{#if addMenuMode === 'pick'}
					<div class="add-menu-header">
						<span class="add-menu-title">{m.providers_tab_unconfigured_providers()}</span>
					</div>
					{#if unconfiguredProviders.length === 0}
						<div class="add-menu-empty">
							{m.ui_providerstab_tutti_i_provider_conosciuti_sono_gia_configurati_6438()}
						</div>
					{:else}
						<div class="add-menu-list">
							{#each unconfiguredProviders as p (p.id)}
								<button
									type="button"
									class="add-menu-item"
									onclick={() => pickUnconfiguredProvider(p.id)}
								>
									<span class="add-menu-item-name">{p.name}</span>
									<span class="origin-badge origin-{p.source}">
										{#if p.source === 'plugin'}
											<IconPlug />
										{/if}
										<span>{sourceLabel(p.source)}</span>
									</span>
								</button>
							{/each}
						</div>
					{/if}
					<button
						type="button"
						class="add-menu-switch ui-button ui-button-ghost"
						onclick={() => (addMenuMode = 'custom')}
					>
						{m.ui_providerstab_crea_provider_custom_d873()}
					</button>
				{:else}
					<div class="add-menu-header">
						<span class="add-menu-title">{m.ui_providerstab_nuovo_provider_custom_f3ff()}</span>
					</div>
					<div class="add-menu-custom-form">
						<input
							type="text"
							class="ui-input"
							bind:value={newProviderName}
							placeholder={m.providers_tab_custom_id_placeholder()}
							aria-label={m.ui_providerstab_identificativo_nuovo_provider_custom_c72d()}
							onkeydown={(e) => {
								if (e.key === 'Enter') handleCreateCustomProvider();
							}}
						/>
						<div class="add-menu-actions">
							<button
								type="button"
								class="ui-button ui-button-secondary"
								onclick={() => (addMenuMode = 'pick')}
							>
								{m.browser_btn_back()}
							</button>
							<button
								type="button"
								class="ui-button ui-button-primary"
								onclick={handleCreateCustomProvider}
							>
								{m.ui_providerstab_crea_383b()}
							</button>
						</div>
					</div>
				{/if}
			</MenuButton>
		</div>
	</aside>

	<!-- Colonna destra: dettaglio provider selezionato -->
	<main class="provider-detail">
		{#if selectedProvider}
			{@const enabled = isEnabled(selectedProvider.id)}
			<header class="detail-header">
				<div class="detail-header-info">
					<div class="detail-title-line">
						<h2 class="detail-title">{selectedProvider.name}</h2>
						<span class="origin-badge origin-{selectedProvider.source}">
							{#if selectedProvider.source === 'plugin'}
								<IconPlug />
							{/if}
							<span>{sourceLabel(selectedProvider.source)}</span>
						</span>
					</div>
					<span class="detail-id">{selectedProvider.id}</span>
				</div>

				<div class="detail-header-actions">
					{#if selectedProvider.source === 'custom'}
						<button
							type="button"
							class="ui-button ui-button-danger"
							onclick={() => confirmDeleteCustomProvider(selectedProvider.id)}
						>
							{m.ui_providerstab_rimuovi_provider_fba3()}
						</button>
					{/if}
					<button
						type="button"
						class="ui-button ui-button-secondary"
						disabled={modelSettingsStore.isRefreshingCatalog}
						onclick={() => handleRefreshModels(selectedProvider.id)}
					>
						{modelSettingsStore.isRefreshingCatalog
							? m.providers_tab_updating_models()
							: m.ui_providerstab_aggiorna_modelli_919e()}
					</button>
					<Switch
						checked={enabled}
						ariaLabel={m.providers_tab_enable_provider_aria({ name: selectedProvider.name })}
						onChange={() => toggleEnabled(selectedProvider.id)}
					/>
				</div>
			</header>

			<div class="detail-body">
				{#if selectedProvider.source === 'custom' && modelSettingsStore.draftCustomProviders[selectedProvider.id]}
					{@const pDef = modelSettingsStore.draftCustomProviders[selectedProvider.id]}
					<section class="detail-section">
						<h3 class="detail-section-title">{m.providers_tab_endpoint_configuration()}</h3>
						<div class="form-grid">
							<label class="form-field">
								<span class="field-label">{m.providers_tab_base_url()}</span>
								<input
									type="text"
									class="ui-input"
									bind:value={pDef.baseUrl}
									placeholder="https://api.openai.com/v1"
								/>
							</label>

							<label class="form-field">
								<span class="field-label">{m.providers_tab_api_key_optional()}</span>
								<input
									type="password"
									class="ui-input"
									bind:value={pDef.apiKey}
									placeholder="sk-..."
								/>
							</label>

							<label class="form-field">
								<span class="field-label">{m.providers_tab_api_format()}</span>
								<select class="ui-select" bind:value={pDef.api}>
									<option value="openai-completions">openai-completions (Standard)</option>
									<option value="openai-responses">openai-responses (Codex)</option>
									<option value="anthropic-messages">anthropic-messages (Claude)</option>
								</select>
							</label>
						</div>

						<div class="custom-models-section">
							<div class="cm-header">
								<span class="cm-title">{m.providers_tab_defined_models()}</span>
								<button
									type="button"
									class="ui-button ui-button-secondary"
									onclick={() => handleAddCustomModel(selectedProvider.id)}
								>
									{m.ui_providerstab_aggiungi_modello_6f3c()}
								</button>
							</div>

							<div class="models-list">
								{#each pDef.models as model, mIdx (mIdx)}
									<div class="model-edit-row">
										<input
											type="text"
											class="ui-input inp-id"
											bind:value={model.id}
											placeholder={m.ui_providerstab_id_modello_es_qwen2_5_coder_aa8f()}
											aria-label={m.ui_providerstab_id_modello_a333()}
										/>
										<input
											type="text"
											class="ui-input inp-name"
											bind:value={model.name}
											placeholder={m.providers_tab_display_name_placeholder()}
											aria-label={m.ui_providerstab_nome_visualizzato_modello_9a65()}
										/>
										<input
											type="number"
											class="ui-input inp-num"
											bind:value={model.contextWindow}
											placeholder={m.providers_tab_context_placeholder()}
											aria-label={m.providers_tab_context_window_aria()}
										/>
										<input
											type="number"
											class="ui-input inp-num"
											bind:value={model.maxTokens}
											placeholder={m.providers_tab_max_tokens_placeholder()}
											aria-label={m.providers_tab_max_output_tokens_aria()}
										/>
										<Tooltip text={m.providers_tab_reasoning_tooltip()}>
											<label class="chk-cap">
												<input type="checkbox" class="ui-checkbox" bind:checked={model.reasoning} />
												<span class="chk-label">{m.providers_tab_reasoning()}</span>
											</label>
										</Tooltip>
										<Tooltip text={m.models_providers_delete_model()}>
											<button
												type="button"
												class="del-model-action ui-button ui-button-ghost"
												onclick={() => handleDeleteCustomModel(selectedProvider.id, mIdx)}
												aria-label={m.models_providers_delete_model()}
											>
												<IconTrash />
											</button>
										</Tooltip>
									</div>
								{/each}

								{#if pDef.models.length === 0}
									<div class="empty-models">
										{m.ui_providerstab_nessun_modello_definito_per_questo_provider_2e4c()}
									</div>
								{/if}
							</div>
						</div>
					</section>
				{/if}

				<section class="detail-section">
					<div class="section-header-row">
						<h3 class="detail-section-title">{m.providers_tab_auth_and_accounts()}</h3>
						{#if isOAuthProvider}
							<Tooltip text={m.ui_providerstab_login_new_account_title()}>
								<button
									type="button"
									class="ui-button ui-button-secondary"
									onclick={() => handleLoginAction(selectedProvider.id)}
								>
									{m.models_providers_add_account()}
								</button>
							</Tooltip>
						{/if}
					</div>

					{#if selectedAccounts.length === 0}
						<div class="empty-accounts">
							{#if selectedProvider.source === 'custom'}
								<p>{m.providers_tab_custom_auth_note()}</p>
							{:else if isOAuthProvider}
								<p>{m.providers_tab_no_accounts_connected()}</p>
								<button
									type="button"
									class="ui-button ui-button-primary"
									onclick={() => handleLoginAction(selectedProvider.id)}
								>
									{m.providers_tab_login_oauth()}
								</button>
							{:else}
								{@const envHint = getProviderEnvVarHint(selectedProvider.id)}
								<p class="auth-instruction">
									{m.providers_tab_env_auth_instruction()}
									{#if envHint}
										{m.providers_tab_configure_env_hint({ envVar: envHint })}
									{:else}
										{m.ui_providerstab_configura_la_chiave_api_nelle_impostazioni_ambiente_8930()}
									{/if}
								</p>
								{#if envHint}
									<button
										type="button"
										class="ui-button ui-button-secondary"
										onclick={() => handleCopyEnvHint(envHint)}
									>
										{m.ui_providerstab_copia_nome_variabile_1f23()}{envHint})
									</button>
								{/if}
							{/if}
						</div>
					{:else}
						<div class="accounts-list">
							{#each selectedAccounts as account (account.id)}
								{@const status = accountStatus(account)}
								{@const created = formatDate(account.createdAt)}

								<div class="account-card">
									<span class="account-avatar">
										<IconAccount />
									</span>

									<div class="account-info">
										<div class="account-top-row">
											<span class="account-name">{accountDisplayName(account)}</span>
											<Tooltip text={status.message ?? status.label}>
												<span class="account-status">
													<StatusMark
														status={status.variant === 'ok'
															? 'completed'
															: status.variant === 'warn'
																? 'attention'
																: 'failed'}
													/>
													<span
														class="account-status-label"
														class:is-danger={status.variant === 'danger'}
														class:is-warn={status.variant === 'warn'}
													>
														{status.label}
													</span>
												</span>
											</Tooltip>
										</div>
										<div class="account-meta-row">
											{#if account.accountId && account.email}
												<span class="account-sub">ID: {account.accountId}</span>
											{/if}
											{#if account.orgName}
												<span class="org-badge">{account.orgName}</span>
											{/if}
											{#if account.plan}
												<span class="plan-badge">{account.plan}</span>
											{/if}
											{#if created}
												<span class="account-date">
													{m.providers_tab_added_on({ date: created })}
												</span>
											{/if}
										</div>
										{#if status.message}
											<span class="account-error-msg">{status.message}</span>
										{/if}
									</div>

									<div class="account-actions">
										{#if status.variant !== 'ok' && isOAuthProvider}
											<button
												type="button"
												class="ui-button ui-button-secondary account-action-btn"
												onclick={() => handleLoginAction(account.provider)}
											>
												{m.ui_providerstab_accedi_di_nuovo_5726()}
											</button>
										{/if}
										<button
											type="button"
											class="ui-button ui-button-ghost account-action-btn is-danger-action"
											disabled={removingAccountId === account.id}
											onclick={() => requestRemoveAccount(account)}
										>
											{m.browser_btn_disconnect_relay()}
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			</div>
		{:else}
			<div class="empty-detail">
				<p>{m.ui_providerstab_seleziona_un_provider_dall_elenco_per_vederne_5522()}</p>
			</div>
		{/if}
	</main>

	<!-- Dialog: rimuovi provider Custom dalla bozza -->
	<ConfirmDialog
		open={providerToDelete !== null}
		title={m.providers_tab_delete_provider_title({ name: providerToDelete ?? '' })}
		message={m.providers_tab_delete_provider_message()}
		confirmLabel={m.ui_providerstab_rimuovi_68f6()}
		cancelLabel={m.common_cancel()}
		tone="danger"
		onConfirm={executeDeleteCustomProvider}
		onCancel={cancelDeleteCustomProvider}
	/>

	<!-- Dialog: disconnetti account -->
	<ConfirmDialog
		open={accountToRemove !== null}
		title={m.providers_tab_disconnect_account_title({
			name: accountToRemove ? accountDisplayName(accountToRemove) : ''
		})}
		message={m.providers_tab_disconnect_account_message()}
		confirmLabel={m.browser_btn_disconnect_relay()}
		cancelLabel={m.common_cancel()}
		tone="danger"
		confirmDisabled={removingAccountId !== null}
		onConfirm={() => void executeRemoveAccount()}
		onCancel={cancelRemoveAccount}
	/>

	<!-- Dialog: accesso OAuth nel terminale -->
	<Dialog
		open={loginTarget !== null}
		title={loginTarget ? m.ui_providerstab_login_dialog_title({ value1: loginTarget.name }) : ''}
		onClose={() => void closeLogin()}
		size="wide"
	>
		{#snippet body()}
			{#if loginTarget}
				<p class="login-dialog-hint">{m.ui_providerstab_login_dialog_hint()}</p>
				<div class="login-terminal">
					{#key loginTarget.id}
						<Terminal cwd={''} launchArgs={['login', loginTarget.id]} />
					{/key}
				</div>
			{/if}
		{/snippet}
		{#snippet footer()}
			<button
				type="button"
				class="ui-button ui-button-primary"
				onclick={() => void closeLogin()}
			>
				{m.common_close()}
			</button>
		{/snippet}
	</Dialog>
</div>

<style>
	.providers-tab {
		display: flex;
		height: 100%;
		min-height: 520px;
		max-height: 640px;
		overflow: hidden;
		background: var(--bg-sunken);
		position: relative;
	}

	/* --- Sidebar Provider (Sinistra) --- */
	.providers-sidebar {
		width: 270px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--line);
		background: color-mix(in oklab, var(--bg-sunken) 80%, var(--bg-base));
		overflow: hidden;
	}

	.sidebar-header {
		padding: 8px 10px;
		border-bottom: 1px solid var(--line);
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		transition: border-color var(--dur-fast) var(--ease-out);
		--icon-size: 13px;
	}

	.search-box:focus-within {
		border-color: var(--brand-ink);
	}

	.search-icon {
		color: var(--ink-faint);
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font-size: var(--text-body);
		color: var(--ink);
	}

	.search-input::placeholder {
		color: var(--ink-faint);
	}

.search-clear-action {
		border: none;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 0 2px;
		display: flex;
		align-items: center;
		--icon-size: 12px;
	}

	.providers-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.provider-item {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 7px 8px;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
		width: 100%;
	}

	.provider-item:hover {
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.provider-item:focus-visible {
		outline: 2px solid var(--brand-ink);
		outline-offset: -2px;
	}

	.provider-item.selected {
		background: color-mix(in oklab, var(--brand) 12%, var(--bg-base));
		border-color: color-mix(in oklab, var(--brand) 40%, var(--line-strong));
	}

	.provider-item.disabled-provider {
		opacity: 0.6;
	}

	.provider-item-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}

	.provider-item-name {
		font-size: var(--text-meta);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.provider-item-id {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.provider-item-bottom {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.origin-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-caption);
		font-weight: 500;
		padding: 1px 6px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink-muted);
		flex-shrink: 0;
		white-space: nowrap;
		--icon-size: 11px;
	}

	.origin-badge.origin-plugin {
		color: var(--ink-muted);
		border-color: var(--line);
	}

	.origin-badge.origin-custom {
		color: var(--brand-ink);
		border-color: color-mix(in oklab, var(--brand) 35%, transparent);
	}

	.provider-status {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.count-pill {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
		padding: 0 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		--icon-size: 11px;
	}

	.no-providers-found {
		padding: 16px;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		text-align: center;
	}

	.sidebar-footer {
		position: relative;
		padding: 8px 10px;
		border-top: 1px solid var(--line);
		background: color-mix(in oklab, var(--bg-base) 40%, transparent);
	}

	.sidebar-footer :global(.menu-button-container) {
		width: 100%;
		display: flex;
	}

	.sidebar-footer :global(.menu-button-container > .menu-button.add-provider-trigger) {
		width: 100%;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 0 10px;
		font-size: var(--text-caption);
		font-weight: 500;
		border-radius: var(--radius-md);
		--icon-size: 12px;
	}

	.add-menu-header {
		padding: 2px 4px 4px;
	}

	.add-menu-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.add-menu-empty {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		padding: 6px 4px;
	}

	.add-menu-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.add-menu-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 7px 8px;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink);
		font-size: var(--text-caption);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.add-menu-item:hover {
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.add-menu-item-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.add-menu-switch {
		align-self: flex-start;
		font-size: var(--text-caption);
		padding: 4px 6px;
		margin-top: 2px;
	}

	.add-menu-custom-form {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 4px 2px;
	}

	.add-menu-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		margin-top: 2px;
	}

	/* --- Pannello di destra: dettaglio provider --- */
	.provider-detail {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		overflow: hidden;
	}

	.empty-detail {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-faint);
		font-size: var(--text-caption);
		text-align: center;
		padding: var(--space-4);
	}

	.detail-header {
		padding: 12px 18px;
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		background: color-mix(in oklab, var(--bg-base) 70%, var(--bg-sunken));
		gap: 12px;
		flex-wrap: wrap;
	}

	.detail-header-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.detail-title-line {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.detail-title {
		font-size: var(--text-title);
		font-weight: 550;
		color: var(--ink);
		margin: 0;
	}

	.detail-id {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.detail-header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.detail-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3) 18px var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.detail-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.detail-section-title {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.section-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	/* --- Configurazione provider Custom --- */
	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-2);
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.field-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.custom-models-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2);
		margin-top: var(--space-2);
	}

	.cm-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.cm-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
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

	.inp-id {
		flex: 2;
		min-width: 0;
		font-family: var(--font-mono);
	}

	.inp-name {
		flex: 2;
		min-width: 0;
	}

	.inp-num {
		width: 110px;
		flex-shrink: 0;
		font-family: var(--font-mono);
	}

	.chk-cap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		padding: 0 4px;
		user-select: none;
	}

	.chk-label {
		font-size: var(--text-caption);
	}

.del-model-action {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		--icon-size: 13px;
		flex-shrink: 0;
		color: var(--ink-muted);
	}

.del-model-action:hover {
		color: var(--danger);
		background: color-mix(in oklab, var(--danger) 10%, transparent);
	}

	.empty-models {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		padding: var(--space-2) 0;
		text-align: center;
	}

	/* --- Autenticazione e Account --- */
	.empty-accounts {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--text-body);
		color: var(--ink-muted);
		padding: var(--space-3);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.empty-accounts p {
		margin: 0;
		line-height: 1.45;
	}

	.accounts-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.account-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.account-avatar {
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		color: var(--ink-muted);
		margin-top: 1px;
		--icon-size: 15px;
	}

	.account-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.account-top-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.account-name {
		font-size: var(--text-body);
		font-weight: 550;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.account-status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.account-status-label.is-warn {
		color: var(--warn);
	}

	.account-status-label.is-danger {
		color: var(--danger);
	}

	.account-meta-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.account-sub {
		font-family: var(--font-mono);
	}

	.org-badge,
	.plan-badge {
		font-size: var(--text-caption);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.plan-badge {
		color: var(--brand-ink);
		border-color: color-mix(in oklab, var(--brand) 30%, transparent);
	}

	.account-date {
		color: var(--ink-faint);
	}

	.account-error-msg {
		font-size: var(--text-caption);
		color: var(--warn);
	}

	.account-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		flex-shrink: 0;
	}

	.account-action-btn {
		height: 24px;
		padding: 0 8px;
		font-size: var(--text-caption);
	}

	.account-action-btn.is-danger-action:hover:not(:disabled) {
		color: var(--danger);
		background: color-mix(in oklab, var(--danger) 10%, transparent);
	}

	/* --- Terminal dialog hint e terminale --- */
	.login-dialog-hint {
		margin: 0;
		font-size: var(--text-body);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.login-terminal {
		position: relative;
		height: 420px;
		min-height: 320px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
</style>
