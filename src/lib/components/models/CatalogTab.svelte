<script lang="ts">
	import {
		modelSettingsStore,
		STANDARD_ROLES,
		type ModelDto
	} from '$lib/stores/modelSettings.svelte';

	let searchQuery = $state('');
	let filterVision = $state(false);
	let filterReasoning = $state(false);
	let filterFree = $state(false);

	let openAssignMenuFor = $state<string | null>(null);

	/** Sorgente dati unica: i modelli realmente disponibili (auth valida / provider raggiungibile),
	 *  con fallback sul catalogo statico completo finche' il primo non e' ancora stato caricato. */
	const effectiveCatalog = $derived.by(() => {
		const available = modelSettingsStore.availableCatalog;
		return available.length > 0 ? available : modelSettingsStore.catalog;
	});

	/** Solo i provider configurati/abilitati compaiono nel filtro di ambito, ciascuno con il conteggio
	 *  di modelli realmente disponibili (inclusi quelli esposti da plugin, es. Command Code). */
	const providerEntries = $derived.by(() => {
		return modelSettingsStore.providers
			.filter((p) => p.enabled && p.configured)
			.map((p) => ({
				id: p.id,
				name: p.name,
				source: p.source,
				count: effectiveCatalog.filter((m) => m.provider === p.id).length
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	const providerScoped = $derived.by(() => {
		const scope = modelSettingsStore.catalogFilterProviderId;
		if (!scope) return effectiveCatalog;
		return effectiveCatalog.filter((m) => m.provider === scope);
	});

	const filteredCatalog = $derived.by(() => {
		let list = providerScoped;

		if (filterVision) {
			list = list.filter((m) => m.input?.includes('image'));
		}
		if (filterReasoning) {
			list = list.filter((m) => m.reasoning);
		}
		if (filterFree) {
			list = list.filter((m) => isFree(m));
		}

		const q = searchQuery.trim().toLowerCase();
		if (q) {
			list = list.filter(
				(m) =>
					m.name.toLowerCase().includes(q) ||
					m.id.toLowerCase().includes(q) ||
					m.provider.toLowerCase().includes(q) ||
					m.selector.toLowerCase().includes(q)
			);
		}

		return list;
	});

	function providerName(id: string): string {
		return modelSettingsStore.providers.find((p) => p.id === id)?.name || id;
	}

	function isFree(m: ModelDto): boolean {
		if (m.cost?.input === undefined && m.cost?.output === undefined) return false;
		return (m.cost?.input ?? 0) === 0 && (m.cost?.output ?? 0) === 0;
	}

	function formatCtx(tokens?: number) {
		if (!tokens) return '-';
		if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
		if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
		return `${tokens}`;
	}

	function formatMoney(cost?: number) {
		if (cost === undefined || cost === null) return '-';
		if (cost === 0) return 'Gratis';
		return `$${cost.toFixed(2)}`;
	}

	function formatCostPair(m: ModelDto): string {
		if (m.cost?.input === undefined && m.cost?.output === undefined) return '-';
		if (isFree(m)) return 'Gratis';
		return `${formatMoney(m.cost?.input)} / ${formatMoney(m.cost?.output)}`;
	}

	function reasoningTitle(m: ModelDto): string {
		const levels = m.thinking?.efforts;
		return levels?.length
			? `Supporta reasoning / thinking con livelli: ${levels.join(', ')}`
			: 'Supporto reasoning / thinking';
	}

	function selectAllProviders() {
		modelSettingsStore.setCatalogFilter(null);
	}

	function selectScopeProvider(id: string) {
		modelSettingsStore.setCatalogFilter(id);
	}

	function clearSearchFilters() {
		searchQuery = '';
		filterVision = false;
		filterReasoning = false;
		filterFree = false;
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
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation?.();
			openAssignMenuFor = null;
		}
	}
</script>

<svelte:window onclick={handleDocClick} onkeydown={handleKeydown} />

<div class="catalog-tab">
	<!-- Sidebar sinistra: filtro per ambito/provider -->
	<aside class="catalog-sidebar" aria-label="Filtro per provider">
		<div class="sidebar-title">Ambito</div>
		<nav class="scope-list">
			<button
				type="button"
				class="scope-item"
				class:active={modelSettingsStore.catalogFilterProviderId === null}
				onclick={selectAllProviders}
			>
				<span class="scope-label">Tutti i modelli</span>
				<span class="scope-count">{effectiveCatalog.length}</span>
			</button>
			{#each providerEntries as p (p.id)}
				<button
					type="button"
					class="scope-item"
					class:active={modelSettingsStore.catalogFilterProviderId === p.id}
					onclick={() => selectScopeProvider(p.id)}
					title={p.source === 'plugin' ? `${p.name} (plugin)` : p.name}
				>
					<span class="scope-label">{p.name}</span>
					<span class="scope-count">{p.count}</span>
				</button>
			{/each}
			{#if providerEntries.length === 0}
				<div class="scope-empty">Nessun provider configurato o abilitato.</div>
			{/if}
		</nav>
	</aside>

	<!-- Pannello destro: ricerca, filtri rapidi e lista modelli -->
	<div class="catalog-main">
		<div class="filter-header">
			<div class="search-input-wrapper">
				<svg class="search-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
					<circle cx="7" cy="7" r="4.5" />
					<path d="M10.5 10.5L14 14" stroke-linecap="round" />
				</svg>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Cerca per nome, ID, provider o selettore..."
					aria-label="Cerca nel catalogo modelli"
					onclick={(e) => e.stopPropagation()}
				/>
				{#if searchQuery}
					<button type="button" class="btn-clear" aria-label="Cancella ricerca" onclick={() => (searchQuery = '')}>
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
					onclick={() => (filterVision = !filterVision)}
				>
					Vision
				</button>
				<button
					type="button"
					class="filter-toggle-chip"
					class:active={filterReasoning}
					onclick={() => (filterReasoning = !filterReasoning)}
				>
					Reasoning
				</button>
				<button
					type="button"
					class="filter-toggle-chip free"
					class:active={filterFree}
					onclick={() => (filterFree = !filterFree)}
				>
					Gratis
				</button>
				<button
					type="button"
					class="refresh-catalog-btn"
					disabled={modelSettingsStore.isRefreshingCatalog}
					onclick={() => modelSettingsStore.refreshCatalog(modelSettingsStore.catalogFilterProviderId ?? undefined)}
					title={modelSettingsStore.catalogFilterProviderId
						? `Aggiorna catalogo per ${providerName(modelSettingsStore.catalogFilterProviderId)}`
						: 'Aggiorna catalogo da tutti i provider attivi'}
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
					<span>{modelSettingsStore.isRefreshingCatalog ? 'Aggiornamento...' : 'Aggiorna catalogo'}</span>
				</button>
			</div>
		</div>

		<div class="catalog-stats">
			<span>Visualizzati <strong>{filteredCatalog.length}</strong> modelli su {effectiveCatalog.length} disponibili</span>
		</div>

		<div class="catalog-list">
			{#if effectiveCatalog.length === 0 && !modelSettingsStore.loading}
				<div class="empty-state">
					<p>Nessun modello disponibile nel catalogo.</p>
					<button type="button" class="btn-retry" onclick={() => modelSettingsStore.refreshCatalog()}>
						Ricarica catalogo provider
					</button>
				</div>
			{:else if filteredCatalog.length === 0}
				<div class="empty-state">
					<p>Nessun modello trovato per i filtri selezionati.</p>
					<button type="button" class="btn-retry" onclick={clearSearchFilters}>
						Cancella filtri di ricerca
					</button>
				</div>
			{:else}
				{#each filteredCatalog as m (m.selector)}
					<div class="model-row">
						<div class="model-meta-cell">
							<div class="name-row">
								<span class="m-name">{m.name}</span>
								<span class="m-provider">{providerName(m.provider)}</span>
								{#if m.isCustom}
									<span class="m-custom-badge">Custom</span>
								{/if}
							</div>
							<div class="m-selector-row">
								<span class="m-selector">{m.selector}</span>
							</div>
						</div>

						<div class="badges-cell">
							<span class="spec-badge" title="Finestra di contesto massima">{formatCtx(m.contextWindow)}</span>
							<span class="spec-badge" title="Token massimi generabili in output">{formatCtx(m.maxTokens)} max out</span>
							{#if m.input?.includes('image')}
								<span class="cap-badge vision" title="Supporto input immagini / vision">Vision</span>
							{/if}
							{#if m.reasoning}
								<span class="cap-badge reasoning" title={reasoningTitle(m)}>
									Reasoning{#if m.thinking?.efforts?.length}<span class="reasoning-levels"> · {m.thinking.efforts.join(', ')}</span>{/if}
								</span>
							{/if}
						</div>

						<div class="cost-cell">
							<span class="cost-label">Costo /1M</span>
							<span class="cost-val" class:free={isFree(m)}>{formatCostPair(m)}</span>
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
									<div class="assign-section-title">Assegna a Ruolo</div>
									<div class="assign-grid">
										{#each STANDARD_ROLES as r (r.id)}
											{@const RoleIcon = r.icon}
											<button
												type="button"
												class="assign-opt"
												onclick={() => handleAssignToRole(r.id, m)}
											>
												<span class="opt-badge">{r.abbr}</span>
												<span class="opt-icon"><RoleIcon /></span>
												<span class="opt-label">{r.label}</span>
											</button>
										{/each}
									</div>

									<div class="assign-divider"></div>

									<div class="assign-section-title">Aggiungi come Fallback</div>
									<div class="assign-grid">
										{#each STANDARD_ROLES as r (r.id)}
											<button
												type="button"
												class="assign-opt fallback"
												onclick={() => handleAddAsFallback(r.id, m)}
											>
												<span class="opt-badge">{r.abbr}</span>
												<span class="opt-label">+ Fallback {r.label}</span>
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
</div>

<style>
	.catalog-tab {
		display: flex;
		flex-direction: row;
		height: 100%;
		min-height: 0;
	}

	/* Sidebar sinistra: ambito/provider */
	.catalog-sidebar {
		width: 190px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		border-right: 1px solid var(--line);
		overflow-y: auto;
	}

	.sidebar-title {
		font-size: 10px;
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0 var(--space-2) var(--space-1);
	}

	.scope-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.scope-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: 6px var(--space-2);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		text-align: left;
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.scope-item:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.scope-item.active {
		background: var(--bg-active);
		color: var(--ink);
		border-color: var(--brand);
		font-weight: 600;
	}

	.scope-label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.scope-count {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.scope-item.active .scope-count {
		color: var(--ink);
	}

	.scope-empty {
		padding: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.4;
	}

	/* Pannello destro */
	.catalog-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		overflow: hidden;
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

	.filter-toggle-chip.free.active {
		border-color: var(--success, #22c55e);
		color: var(--success, #22c55e);
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

	.catalog-stats {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.catalog-stats strong {
		color: var(--ink);
		font-weight: 600;
	}

	.catalog-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		overflow-y: auto;
		min-height: 0;
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

	.m-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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

	.m-selector-row {
		display: flex;
		align-items: center;
	}

	.m-selector {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.badges-cell {
		flex: 2;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
	}

	.spec-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.cap-badge {
		font-size: 10px;
		font-weight: 500;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		color: var(--ink-muted);
		white-space: nowrap;
	}

	.cap-badge.vision {
		color: var(--brand-ink);
	}

	.cap-badge.reasoning .reasoning-levels {
		color: var(--ink-faint);
	}

	.cost-cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		width: 130px;
		flex-shrink: 0;
	}

	.cost-label {
		font-size: 10px;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.cost-val {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cost-val.free {
		color: var(--success, #22c55e);
		font-weight: 600;
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

	.opt-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 14px;
		height: 14px;
		color: var(--ink-muted);
	}

	.opt-icon :global(svg) {
		width: 12px;
		height: 12px;
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
