<script lang="ts">
	import {
		modelSettingsStore,
		isAuthAccountActive,
		getProviderEnvVarHint,
		type ProviderSummary,
		type AuthAccount
	} from '$lib/stores/modelSettings.svelte';
	import { anchoredPopover } from '$lib/anchoredPopover';
	import { IconClose, IconPlus } from '$lib/icons';
	import { slide, fade } from 'svelte/transition';

	let searchQuery = $state('');
	let listRootEl = $state<HTMLDivElement | null>(null);

	let addMenuOpen = $state(false);
	let addMenuMode = $state<'pick' | 'custom'>('pick');
	let newProviderName = $state('');
	let addMenuEl = $state<HTMLDivElement | null>(null);
	let addMenuBtnEl = $state<HTMLButtonElement | null>(null);

	let providerToDelete = $state<string | null>(null);
	let accountToRemove = $state<AuthAccount | null>(null);
	let removingAccountId = $state<number | null>(null);

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

	const isOAuthProvider = $derived(
		selectedProvider ? (selectedProvider.hasOauth || selectedProvider.authOrigin === 'oauth') : false
	);

	// Seleziona automaticamente il primo provider quando nessuno e' ancora attivo
	$effect(() => {
		if (!modelSettingsStore.selectedProviderId && displayProviders.length > 0) {
			modelSettingsStore.selectProvider(displayProviders[0].id);
		}
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
		selectProvider(name);
		closeAddMenu();
	}

	function handleDocClick(e: MouseEvent) {
		if (!addMenuOpen) return;
		const target = e.target as Node;
		if (addMenuEl?.contains(target) || addMenuBtnEl?.contains(target)) return;
		closeAddMenu();
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (accountToRemove) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation?.();
			accountToRemove = null;
		} else if (providerToDelete) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation?.();
			providerToDelete = null;
		} else if (addMenuOpen) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation?.();
			closeAddMenu();
		}
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
		modelSettingsStore.showToast('Provider rimosso dalla bozza');
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
				label: 'Credenziale mancante',
				variant: 'danger',
				message: 'Nessuna credenziale valida salvata per questo account.'
			};
		}
		if (a.disabledCause) {
			return { label: 'Disabilitato', variant: 'warn', message: a.disabledCause };
		}
		return { label: 'Connesso', variant: 'ok' };
	}

	function accountDisplayName(a: AuthAccount): string {
		return a.email || a.accountId || a.identityKey?.replace(/^email:/, '') || a.credentialType;
	}

	function formatDate(ts?: number): string | null {
		if (!ts) return null;
		// Convenzione SQLite: unix epoch in secondi; alcune sorgenti potrebbero gia' essere in ms.
		const ms = ts > 1e12 ? ts : ts * 1000;
		try {
			return new Date(ms).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
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
	// Studio non ha modo di avviare il flusso OAuth da questo pannello (nessuna sessione agente
	// attiva raggiungibile da qui): prepariamo il comando CLI reale nella clipboard dell'utente.
	async function handleLoginAction(providerId: string) {
		const cmd = `omp auth-broker login ${providerId}`;
		try {
			await navigator.clipboard.writeText(cmd);
			modelSettingsStore.showToast(`Comando copiato: esegui "${cmd}" in un terminale per accedere`);
		} catch {
			modelSettingsStore.showToast(`Esegui "${cmd}" in un terminale per accedere`);
		}
	}

	async function handleCopyEnvHint(envVar: string) {
		try {
			await navigator.clipboard.writeText(envVar);
			modelSettingsStore.showToast(`Copiato: "${envVar}"`);
		} catch {
			modelSettingsStore.showToast(`Variabile: ${envVar}`);
		}
	}
</script>

<svelte:window onclick={handleDocClick} onkeydown={handleWindowKeydown} />

<div class="providers-tab">
	<!-- Colonna sinistra: elenco provider -->
	<aside class="providers-sidebar">
		<div class="sidebar-header">
			<div class="search-box">
				<svg class="search-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6">
					<circle cx="6.5" cy="6.5" r="4" />
					<path d="M9.5 9.5L13.5 13.5" stroke-linecap="round" />
				</svg>
				<input
					type="text"
					class="search-input"
					bind:value={searchQuery}
					onkeydown={handleSearchKeydown}
					placeholder="Cerca provider per nome o ID..."
					aria-label="Cerca provider"
				/>
				{#if searchQuery}
					<button type="button" class="btn-clear-search" onclick={() => searchQuery = ''} aria-label="Cancella ricerca">
						<IconClose />
					</button>
				{/if}
			</div>
		</div>

		<div
			class="providers-list"
			role="listbox"
			aria-label="Provider disponibili"
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
						<span class="origin-badge origin-{p.source}">{sourceLabel(p.source)}</span>
					</div>
					<div class="provider-item-id">{p.id}</div>
					<div class="provider-item-bottom">
						<span class="state-badge" class:off={!enabled}>{enabled ? 'Abilitato' : 'Disabilitato'}</span>
						<span class="count-pill" title="Account collegati">
							<svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="5.5" r="2.5" /><path d="M2.5 14c0-2.8 2.4-5 5.5-5s5.5 2.2 5.5 5" stroke-linecap="round" /></svg>
							{activeAccountCountFor(p)}
						</span>
						<span class="count-pill" title="Modelli disponibili">
							<svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M2.5 6.5h11M6.5 2.5v11" /></svg>
							{modelCountFor(p)}
						</span>
					</div>
				</button>
			{/each}

			{#if filteredProviders.length === 0}
				<div class="no-providers-found">Nessun provider corrisponde alla ricerca.</div>
			{/if}
		</div>

		<div class="sidebar-footer">
			<button type="button" class="btn-add-provider" bind:this={addMenuBtnEl} onclick={openAddMenu}>
				<IconPlus />
				<span>Aggiungi provider</span>
			</button>

			{#if addMenuOpen}
				<div
					class="add-menu"
					bind:this={addMenuEl}
					popover="manual"
					use:anchoredPopover={{
						anchor: addMenuBtnEl,
						offset: 6,
						matchWidth: true,
						constrainHeight: true
					}}
				>
					{#if addMenuMode === 'pick'}
						<span class="add-menu-title">Provider non configurati</span>
						{#if unconfiguredProviders.length === 0}
							<div class="add-menu-empty">Tutti i provider conosciuti sono già configurati.</div>
						{:else}
							<div class="add-menu-list">
								{#each unconfiguredProviders as p (p.id)}
									<button type="button" class="add-menu-item" onclick={() => pickUnconfiguredProvider(p.id)}>
										<span>{p.name}</span>
										<span class="origin-badge origin-{p.source}">{sourceLabel(p.source)}</span>
									</button>
								{/each}
							</div>
						{/if}
						<button type="button" class="add-menu-switch" onclick={() => addMenuMode = 'custom'}>
							+ Crea provider Custom...
						</button>
					{:else}
						<span class="add-menu-title">Nuovo provider Custom</span>
						<div class="add-menu-custom-form">
							<input
								type="text"
								bind:value={newProviderName}
								placeholder="Identificativo (es. my-ollama)"
								aria-label="Identificativo nuovo provider Custom"
								onkeydown={(e) => { if (e.key === 'Enter') handleCreateCustomProvider(); }}
							/>
							<div class="add-menu-actions">
								<button type="button" class="btn btn-sm btn-secondary" onclick={() => addMenuMode = 'pick'}>Indietro</button>
								<button type="button" class="btn btn-sm btn-primary" onclick={handleCreateCustomProvider}>Crea</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
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
						<span class="origin-badge origin-{selectedProvider.source}">{sourceLabel(selectedProvider.source)}</span>
					</div>
					<span class="detail-id">{selectedProvider.id}</span>
				</div>

				<div class="detail-header-actions">
					{#if selectedProvider.source === 'custom'}
						<button
							type="button"
							class="btn btn-sm btn-danger-outline"
							onclick={() => confirmDeleteCustomProvider(selectedProvider.id)}
						>
							Rimuovi provider
						</button>
					{/if}
					<button
						type="button"
						class="btn btn-sm btn-secondary"
						disabled={modelSettingsStore.isRefreshingCatalog}
						onclick={() => handleRefreshModels(selectedProvider.id)}
					>
						{modelSettingsStore.isRefreshingCatalog ? 'Aggiornamento...' : 'Aggiorna modelli'}
					</button>
					<label class="switch" for="switch-{selectedProvider.id}">
						<input
							id="switch-{selectedProvider.id}"
							type="checkbox"
							checked={enabled}
							aria-label="Abilita provider {selectedProvider.name}"
							onchange={() => toggleEnabled(selectedProvider.id)}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</header>

			<div class="detail-body">
				{#if selectedProvider.source === 'custom' && modelSettingsStore.draftCustomProviders[selectedProvider.id]}
					{@const pDef = modelSettingsStore.draftCustomProviders[selectedProvider.id]}
					<section class="detail-section">
						<h3 class="detail-section-title">Configurazione Endpoint</h3>
						<div class="form-grid">
							<label class="form-field">
								<span class="field-label">Base URL</span>
								<input type="text" bind:value={pDef.baseUrl} placeholder="https://api.openai.com/v1" />
							</label>

							<label class="form-field">
								<span class="field-label">API Key (opzionale)</span>
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

						<div class="custom-models-section">
							<div class="cm-header">
								<span class="cm-title">Modelli definiti</span>
								<button type="button" class="btn btn-sm btn-secondary" onclick={() => handleAddCustomModel(selectedProvider.id)}>
									+ Aggiungi modello
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
											onclick={() => handleDeleteCustomModel(selectedProvider.id, mIdx)}
											title="Elimina modello"
											aria-label="Elimina modello"
										>
											<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
												<path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
											</svg>
										</button>
									</div>
								{/each}

								{#if pDef.models.length === 0}
									<div class="empty-models">Nessun modello definito per questo provider.</div>
								{/if}
							</div>
						</div>
					</section>
				{/if}

				<section class="detail-section">
					<div class="section-header-row">
						<h3 class="detail-section-title">Autenticazione e Account</h3>
						{#if isOAuthProvider}
							<button
								type="button"
								class="btn btn-sm btn-secondary"
								title="Copia il comando per collegare un nuovo account via terminale"
								onclick={() => handleLoginAction(selectedProvider.id)}
							>
								+ Aggiungi un altro account
							</button>
						{/if}
					</div>

					{#if selectedAccounts.length === 0}
						<div class="empty-accounts">
							{#if selectedProvider.source === 'custom'}
								<p>I provider Custom usano la API key configurata sopra: non richiedono account separati.</p>
							{:else if isOAuthProvider}
								<p>Nessun account collegato a questo provider.</p>
								<button type="button" class="btn btn-sm btn-primary" onclick={() => handleLoginAction(selectedProvider.id)}>
									Accedi con OAuth
								</button>
							{:else}
								{@const envHint = getProviderEnvVarHint(selectedProvider.id)}
								<p class="auth-instruction">
									Questo provider si autentica tramite chiave API o variabile d'ambiente.
									{#if envHint}
										Configura la variabile <code>{envHint}</code> o esegui il setup iniziale in OMP.
									{:else}
										Configura la chiave API nelle impostazioni ambiente di OMP.
									{/if}
								</p>
								{#if envHint}
									<button type="button" class="btn btn-sm btn-secondary" onclick={() => handleCopyEnvHint(envHint)}>
										Copia nome variabile ({envHint})
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
										<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4">
											<circle cx="8" cy="5.5" r="2.8" />
											<path d="M2.2 14c0-3 2.6-5.3 5.8-5.3s5.8 2.3 5.8 5.3" stroke-linecap="round" />
										</svg>
									</span>

									<div class="account-info">
										<div class="account-top-row">
											<span class="account-name">{accountDisplayName(account)}</span>
											<span class="status-badge status-{status.variant}" title={status.message ?? status.label}>
												{status.label}
											</span>
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
												<span class="account-date">Aggiunto il {created}</span>
											{/if}
										</div>
										{#if status.message}
											<span class="account-error-msg">{status.message}</span>
										{/if}
									</div>

									<div class="account-actions">
										{#if status.variant !== 'ok' && isOAuthProvider}
											<button type="button" class="btn btn-xs btn-secondary" onclick={() => handleLoginAction(account.provider)}>
												Accedi di nuovo
											</button>
										{/if}
										<button
											type="button"
											class="btn btn-xs btn-danger-outline"
											disabled={removingAccountId === account.id}
											onclick={() => requestRemoveAccount(account)}
										>
											Disconnetti
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
				<p>Seleziona un provider dall'elenco per vederne i dettagli.</p>
			</div>
		{/if}
	</main>

	<!-- Dialog: rimuovi provider Custom dalla bozza -->
	{#if providerToDelete}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="confirm-overlay" onclick={cancelDeleteCustomProvider} transition:fade={{ duration: 100 }}>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="confirm-box" role="alertdialog" tabindex="-1" aria-modal="true" aria-labelledby="del-provider-title" onclick={(e) => e.stopPropagation()} transition:slide={{ duration: 150 }}>
				<h4 id="del-provider-title">Rimuovere il provider "{providerToDelete}"?</h4>
				<p>Il provider e i suoi modelli definiti verranno rimossi dalla bozza.</p>
				<div class="confirm-actions">
					<button type="button" class="btn btn-secondary" onclick={cancelDeleteCustomProvider}>Annulla</button>
					<button type="button" class="btn btn-danger" onclick={executeDeleteCustomProvider}>Rimuovi</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Dialog: disconnetti account -->
	{#if accountToRemove}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="confirm-overlay" onclick={cancelRemoveAccount} transition:fade={{ duration: 100 }}>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="confirm-box" role="alertdialog" tabindex="-1" aria-modal="true" aria-labelledby="del-account-title" onclick={(e) => e.stopPropagation()} transition:slide={{ duration: 150 }}>
				<h4 id="del-account-title">Disconnettere l'account "{accountDisplayName(accountToRemove)}"?</h4>
				<p>Le credenziali salvate per questo account verranno rimosse. Potrai ricollegarlo in qualunque momento.</p>
				<div class="confirm-actions">
					<button type="button" class="btn btn-secondary" onclick={cancelRemoveAccount}>Annulla</button>
					<button type="button" class="btn btn-danger" onclick={executeRemoveAccount}>Disconnetti</button>
				</div>
			</div>
		</div>
	{/if}
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
		background: color-mix(in srgb, var(--bg-sunken) 80%, var(--bg-base));
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
		transition: border-color 120ms ease;
	}

	.search-box:focus-within {
		border-color: var(--brand-ink);
	}

	.search-icon {
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font-size: var(--text-xs);
		color: var(--ink);
		outline: none;
	}

	.search-input::placeholder {
		color: var(--ink-faint);
	}

	.btn-clear-search {
		border: none;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 0 2px;
		display: flex;
		--icon-size: 12px;
	}

	.providers-list {
		flex: 1;
		/* Senza min-height: 0 il flex item non si comprime sotto l'altezza del
		   contenuto e il contenitore lo taglia invece di far comparire la barra. */
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
		transition: all 120ms ease;
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
		background: color-mix(in srgb, var(--brand) 12%, var(--bg-base));
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line-strong));
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
		font-size: 11.5px;
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.provider-item-id {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.provider-item-bottom {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}

	.origin-badge {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 1px 6px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink-muted);
		flex-shrink: 0;
		white-space: nowrap;
	}

	.origin-badge.origin-plugin {
		color: oklch(0.78 0.13 195);
		border-color: color-mix(in srgb, oklch(0.68 0.16 195) 30%, transparent);
	}

	.origin-badge.origin-custom {
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 35%, transparent);
	}

	.state-badge {
		font-size: 9px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, oklch(0.72 0.16 142) 15%, var(--bg-raised));
		color: oklch(0.72 0.16 142);
		border: 1px solid color-mix(in srgb, oklch(0.72 0.16 142) 30%, transparent);
	}

	.state-badge.off {
		background: var(--bg-raised);
		color: var(--ink-faint);
		border-color: var(--line);
	}

	.count-pill {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--ink-faint);
		padding: 0 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		border: 1px solid var(--line);
	}

	.no-providers-found {
		padding: 16px;
		font-size: 11px;
		color: var(--ink-faint);
		text-align: center;
	}

	.sidebar-footer {
		position: relative;
		padding: 8px 10px;
		border-top: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg-base) 40%, transparent);
	}

	.btn-add-provider {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 6px 8px;
		font-size: 11px;
		font-weight: 500;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		transition: all 120ms ease;
		--icon-size: 12px;
	}

	.btn-add-provider:hover {
		border-color: var(--brand-ink);
		color: var(--brand-ink);
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-raised));
	}

	/* Nel top layer (`popover`) il menu non viene clippato dalla sidebar o dal
	   contenitore con overflow. Posizionamento e ribaltamento gestiti da anchoredPopover. */
	.add-menu {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: var(--space-2);
		color: var(--ink);
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		display: flex;
		flex-direction: column;
		gap: 6px;
		z-index: var(--z-overlay);
		max-height: min(280px, var(--anchored-space, 280px));
		overflow-y: auto;
	}
	.add-menu-title {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--ink-faint);
	}

	.add-menu-empty {
		font-size: 11px;
		color: var(--ink-faint);
		padding: 6px 0;
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
		padding: 5px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink);
		font-size: 11px;
		text-align: left;
		cursor: pointer;
	}

	.add-menu-item:hover {
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.add-menu-switch {
		align-self: flex-start;
		background: transparent;
		border: none;
		color: var(--brand-ink);
		font-size: 11px;
		cursor: pointer;
		padding: 4px 2px 0;
	}

	.add-menu-custom-form {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.add-menu-custom-form input {
		height: 28px;
		padding: 0 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		outline: none;
	}

	.add-menu-custom-form input:focus {
		border-color: var(--brand);
	}

	.add-menu-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
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
		font-size: var(--text-xs);
		text-align: center;
		padding: var(--space-4);
	}

	.detail-header {
		padding: 12px 18px;
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		background: color-mix(in srgb, var(--bg-base) 70%, var(--bg-sunken));
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
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.detail-id {
		font-family: var(--font-mono);
		font-size: 11px;
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
		/* Senza min-height: 0 il flex item non si comprime sotto l'altezza del
		   contenuto e il contenitore lo taglia invece di far comparire la barra. */
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
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.section-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	/* --- Switch abilita/disabilita (riuso identico allo stile storico) --- */
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

	.switch input:checked + .slider {
		background: var(--brand);
		border-color: var(--brand);
	}

	.switch input:checked + .slider::before {
		transform: translateX(14px);
		background: var(--on-brand);
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
		background: var(--bg-base);
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
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		margin-top: var(--space-2);
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
		background: var(--bg-sunken);
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
		flex-shrink: 0;
	}

	.btn-del-model:hover {
		background: var(--bg-hover);
		color: var(--brand-ink);
		border-color: var(--line);
	}

	.empty-models {
		font-size: 11px;
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
		font-size: var(--text-xs);
		color: var(--ink-faint);
		padding: var(--space-3);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.empty-accounts p {
		margin: 0;
		line-height: 1.45;
	}

	.empty-accounts code {
		font-family: var(--font-mono);
		font-size: 11px;
		background: var(--bg-surface);
		padding: 1px 4px;
		border-radius: var(--radius-xs);
		color: var(--ink);
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
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status-badge {
		font-size: 9.5px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.status-badge.status-ok {
		color: oklch(0.72 0.16 142);
		background: color-mix(in srgb, oklch(0.72 0.16 142) 12%, var(--bg-raised));
		border-color: color-mix(in srgb, oklch(0.72 0.16 142) 30%, transparent);
	}

	.status-badge.status-warn {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, var(--bg-raised));
		border-color: color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.status-badge.status-danger {
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 12%, var(--bg-raised));
		border-color: var(--danger-dim);
	}

	.account-meta-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		font-size: 10.5px;
		color: var(--ink-faint);
	}

	.account-sub {
		font-family: var(--font-mono);
	}

	.org-badge,
	.plan-badge {
		font-size: 9.5px;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.plan-badge {
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.account-date {
		color: var(--ink-faint);
	}

	.account-error-msg {
		font-size: 10.5px;
		color: var(--warn);
	}

	.account-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		flex-shrink: 0;
	}

	/* --- Bottoni comuni --- */
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
		white-space: nowrap;
	}

	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.btn-sm {
		padding: 3px 8px;
		font-size: 11px;
	}

	.btn-xs {
		padding: 2px 7px;
		font-size: 10px;
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn-danger {
		background: var(--danger);
		color: var(--on-danger);
	}

	.btn-danger:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn-danger-outline {
		background: transparent;
		color: var(--danger);
		border-color: var(--danger-dim);
	}

	.btn-danger-outline:hover:not(:disabled) {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
	}

	/* --- Dialoghi di conferma --- */
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
