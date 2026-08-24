<script lang="ts">
	import {
		modelSettingsStore,
		STANDARD_ROLES,
		type ModelDto
	} from '$lib/stores/modelSettings.svelte';

	let searchQuery = $state('');
	let selectedProvider = $state<string>('all');
	let filterVision = $state(false);
	let filterReasoning = $state(false);

	let openAssignMenuFor = $state<string | null>(null);

	const providersList = $derived.by(() => {
		const set = new Set<string>();
		for (const m of modelSettingsStore.catalog) {
			if (m.provider) set.add(m.provider);
		}
		return Array.from(set).sort();
	});

	const filteredCatalog = $derived.by(() => {
		let list = modelSettingsStore.catalog;
		const q = searchQuery.trim().toLowerCase();

		if (selectedProvider !== 'all') {
			list = list.filter(m => m.provider === selectedProvider);
		}

		if (filterVision) {
			list = list.filter(m => m.input?.includes('image'));
		}

		if (filterReasoning) {
			list = list.filter(m => m.reasoning);
		}

		if (q) {
			list = list.filter(m =>
				m.name.toLowerCase().includes(q) ||
				m.id.toLowerCase().includes(q) ||
				m.provider.toLowerCase().includes(q) ||
				m.selector.toLowerCase().includes(q)
			);
		}

		return list;
	});

	function formatCtx(tokens?: number) {
		if (!tokens) return '-';
		if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
		if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
		return `${tokens}`;
	}

	function formatCost(cost?: number) {
		if (cost === undefined || cost === null) return '-';
		if (cost === 0) return 'Gratis';
		return `$${cost.toFixed(2)}`;
	}

	function handleAssignToRole(roleId: string, model: ModelDto) {
		modelSettingsStore.setRoleModel(roleId, model.selector);
		openAssignMenuFor = null;
		modelSettingsStore.showToast(`Modello assegnato al ruolo ${roleId}`);
	}

	function handleAddAsFallback(roleId: string, model: ModelDto) {
		modelSettingsStore.addFallback(roleId, model.selector);
		openAssignMenuFor = null;
		modelSettingsStore.showToast(`Aggiunto come fallback a ${roleId}`);
	}

	function handleDocClick() {
		openAssignMenuFor = null;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && openAssignMenuFor) {
			e.stopPropagation();
			openAssignMenuFor = null;
		}
	}

	function getRoleAbbr(id: string): string {
		switch (id) {
			case 'default': return 'CH';
			case 'plan': return 'PL';
			case 'smol': return 'SM';
			case 'slow': return 'SL';
			case 'vision': return 'VI';
			case 'task': return 'TS';
			case 'commit': return 'CM';
			case 'advisor': return 'AD';
			default: return id.slice(0, 2).toUpperCase();
		}
	}
</script>

<svelte:window onclick={handleDocClick} onkeydown={handleKeydown} />

<div class="catalog-tab">
	<!-- Top Controls -->
	<div class="filter-header">
		<div class="search-input-wrapper">
			<svg class="search-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
				<circle cx="7" cy="7" r="4.5" />
				<path d="M10.5 10.5L14 14" stroke-linecap="round" />
			</svg>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Cerca per nome, ID o provider..."
				aria-label="Cerca nel catalogo modelli"
				onclick={(e) => e.stopPropagation()}
			/>
			{#if searchQuery}
				<button type="button" class="btn-clear" aria-label="Cancella ricerca" onclick={() => searchQuery = ''}>
					<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
						<path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
					</svg>
				</button>
			{/if}
		</div>

		<div class="quick-toggles">
			<button
				type="button"
				class="filter-toggle-chip"
				class:active={filterVision}
				onclick={() => filterVision = !filterVision}
			>
				Vision
			</button>
			<button
				type="button"
				class="filter-toggle-chip"
				class:active={filterReasoning}
				onclick={() => filterReasoning = !filterReasoning}
			>
				Reasoning
			</button>
			<button
				type="button"
				class="refresh-catalog-btn"
				disabled={modelSettingsStore.isRefreshingCatalog}
				onclick={() => modelSettingsStore.refreshCatalog()}
				title="Aggiorna catalogo da tutti i provider attivi"
			>
				<svg
					class="refresh-icon"
					class:spinning={modelSettingsStore.isRefreshingCatalog}
					viewBox="0 0 16 16"
					width="12"
					height="12"
					fill="none"
					stroke="currentColor"
					stroke-width="1.4"
				>
					<path d="M2 8a6 6 0 0 1 10.2-4.2M14 8a6 6 0 0 1-10.2 4.2" stroke-linecap="round" />
					<path d="M12.5 1v3h-3M3.5 15v-3h3" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				<span>{modelSettingsStore.isRefreshingCatalog ? 'Aggiornamento...' : 'Ricarica Catalogo'}</span>
			</button>
		</div>
	</div>

	<!-- Provider Pills -->
	<div class="provider-pills">
		<button
			type="button"
			class="pill"
			class:active={selectedProvider === 'all'}
			onclick={() => selectedProvider = 'all'}
		>
			Tutti ({modelSettingsStore.catalog.length})
		</button>
		{#each providersList as p (p)}
			{@const count = modelSettingsStore.catalog.filter(m => m.provider === p).length}
			<button
				type="button"
				class="pill"
				class:active={selectedProvider === p}
				onclick={() => selectedProvider = p}
			>
				{p} ({count})
			</button>
		{/each}
	</div>

	<!-- Stats Bar -->
	<div class="catalog-stats">
		<span>Visualizzati <strong>{filteredCatalog.length}</strong> modelli su {modelSettingsStore.catalog.length} totali</span>
	</div>

	<!-- Catalog List / Table -->
	<div class="catalog-list">
		{#if modelSettingsStore.catalog.length === 0 && !modelSettingsStore.loading}
			<div class="empty-state">
				<p>Nessun modello trovato nel catalogo.</p>
				<button type="button" class="btn-retry" onclick={() => modelSettingsStore.refreshCatalog()}>
					Ricarica catalogo provider
				</button>
			</div>
		{:else if filteredCatalog.length === 0}
			<div class="empty-state">
				<p>Nessun modello corrisponde ai criteri di ricerca impostati.</p>
			</div>
		{:else}
			{#each filteredCatalog as m (m.selector)}
				<div class="model-row">
					<div class="model-meta-cell">
						<div class="name-row">
							<span class="m-provider">{m.provider}</span>
							<span class="m-name">{m.name}</span>
							{#if m.isCustom}
								<span class="m-custom-badge">Custom</span>
							{/if}
						</div>
						<div class="m-id-row">
							<span class="m-id">{m.id}</span>
						</div>
					</div>

					<div class="specs-cell">
						<div class="spec-item" title="Finestra di contesto massima">
							<span class="spec-label">Contesto</span>
							<span class="spec-val">{formatCtx(m.contextWindow)}</span>
						</div>
						<div class="spec-item" title="Max output tokens">
							<span class="spec-label">Max Out</span>
							<span class="spec-val">{formatCtx(m.maxTokens)}</span>
						</div>
						{#if m.cost?.input !== undefined && m.cost?.output !== undefined}
							<div class="spec-item" title="Costo stimato per 1M token (Input / Output)">
								<span class="spec-label">Costo 1M</span>
								<span class="spec-val">{formatCost(m.cost.input)} / {formatCost(m.cost.output)}</span>
							</div>
						{/if}
					</div>

					<div class="badges-cell">
						{#if m.input?.includes('image')}
							<span class="cap-badge vision" title="Supporto input immagini / vision">Vision</span>
						{/if}
						{#if m.reasoning}
							<span class="cap-badge reasoning" title="Supporto reasoning / thinking">Reasoning</span>
						{/if}
					</div>

					<div class="action-cell">
						<button
							type="button"
							class="btn-assign-dropdown"
							aria-haspopup="menu"
							aria-expanded={openAssignMenuFor === m.selector}
							onclick={(e) => {
								e.stopPropagation();
								openAssignMenuFor = openAssignMenuFor === m.selector ? null : m.selector;
							}}
						>
							<span>Assegna</span>
							<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
								<path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						</button>

						{#if openAssignMenuFor === m.selector}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="assign-popover" onclick={(e) => e.stopPropagation()}>
								<div class="assign-section-title">Imposta come Ruolo Primario</div>
								<div class="assign-grid">
									{#each STANDARD_ROLES as r}
										<button
											type="button"
											class="assign-opt"
											onclick={() => handleAssignToRole(r.id, m)}
										>
											<span class="opt-badge">{getRoleAbbr(r.id)}</span>
											<span class="opt-label">{r.label}</span>
										</button>
									{/each}
								</div>

								<div class="assign-divider"></div>

								<div class="assign-section-title">Aggiungi a Catena Fallback</div>
								<div class="assign-grid">
									{#each STANDARD_ROLES as r}
										<button
											type="button"
											class="assign-opt fallback"
											onclick={() => handleAddAsFallback(r.id, m)}
										>
											<span class="opt-badge">{getRoleAbbr(r.id)}</span>
											<span class="opt-label">+ Fallback {r.id}</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.catalog-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
	}

	.filter-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.search-input-wrapper {
		flex: 1;
		min-width: 240px;
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 10px;
		color: var(--ink-faint);
		pointer-events: none;
	}

	.search-input-wrapper input {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 6px 28px 6px 30px;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--ink);
		outline: none;
		transition: border-color var(--dur-fast);
	}

	.search-input-wrapper input:focus {
		border-color: var(--brand);
	}

	.btn-clear {
		position: absolute;
		right: 8px;
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
	}

	.btn-clear:hover {
		color: var(--ink);
	}

	.quick-toggles {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.filter-toggle-chip {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 5px 10px;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		font-weight: 500;
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.filter-toggle-chip:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.filter-toggle-chip.active {
		background: var(--bg-active);
		color: var(--ink);
		border-color: var(--brand);
		font-weight: 600;
	}

	.refresh-catalog-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 5px 10px;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.refresh-catalog-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.refresh-catalog-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.refresh-icon.spinning {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.provider-pills {
		display: flex;
		align-items: center;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 2px;
	}

	.pill {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		padding: 3px 10px;
		font-size: 11px;
		font-family: var(--font-ui);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.pill:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.pill.active {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--brand);
		font-weight: 600;
	}

	.catalog-stats {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.catalog-stats strong {
		color: var(--ink);
		font-weight: 600;
	}

	.catalog-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.model-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		transition: border-color var(--dur-fast);
	}

	.model-row:hover {
		border-color: var(--line-strong);
	}

	.model-meta-cell {
		flex: 2;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.name-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.m-provider {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.m-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.m-custom-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--brand-ink);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.m-id-row {
		display: flex;
		align-items: center;
	}

	.m-id {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.specs-cell {
		flex: 2;
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.spec-item {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.spec-label {
		font-size: 10px;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.spec-val {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.badges-cell {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 140px;
		flex-shrink: 0;
	}

	.cap-badge {
		font-size: 10px;
		font-weight: 500;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.action-cell {
		position: relative;
		flex-shrink: 0;
	}

	.btn-assign-dropdown {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		font-weight: 500;
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-assign-dropdown:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.assign-popover {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		width: 280px;
		max-height: 380px;
		overflow-y: auto;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-2);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.assign-section-title {
		font-size: 10px;
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 4px;
	}

	.assign-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 2px;
	}

	.assign-opt {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		text-align: left;
		transition: background var(--dur-fast);
	}

	.assign-opt:hover {
		background: var(--bg-hover);
	}

	.opt-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--ink-muted);
		background: var(--bg-base);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		flex-shrink: 0;
		width: 22px;
		text-align: center;
	}

	.opt-label {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.assign-divider {
		height: 1px;
		background: var(--line);
		margin: var(--space-1) 0;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-6) var(--space-4);
		color: var(--ink-muted);
		font-size: var(--text-sm);
		gap: var(--space-3);
		text-align: center;
	}

	.btn-retry {
		padding: 6px 14px;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
	}

	.btn-retry:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}
</style>
