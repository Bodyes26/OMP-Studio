<script lang="ts">
	import {
		m,
		ui_catalogtab_aggiungi_come_fallback_6dd1 as addAsFallbackLabel,
		ui_catalogtab_costo_1m_7226 as costPerMillionLabel
	} from '$lib/paraglide/messages.js';
	import {
		modelSettingsStore,
		STANDARD_ROLES,
		splitModelSelector,
		type ModelDto
	} from '$lib/stores/modelSettings.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconSearch,
		IconClose,
		IconRefresh,
		IconChevronDown,
		IconCheck,
		IconRoleVision,
		IconRoleSlow,
		IconContextWindow
	} from '$lib/icons';
	import { matchesLooseQuery } from '$lib/looseSearch';

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
				count: effectiveCatalog.filter((mDto) => mDto.provider === p.id).length
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	const providerScoped = $derived.by(() => {
		const scope = modelSettingsStore.catalogFilterProviderId;
		if (!scope) return effectiveCatalog;
		return effectiveCatalog.filter((mDto) => mDto.provider === scope);
	});

	const filteredCatalog = $derived.by(() => {
		let list = providerScoped;

		if (filterVision) {
			list = list.filter((mDto) => mDto.input?.includes('image'));
		}
		if (filterReasoning) {
			list = list.filter((mDto) => mDto.reasoning);
		}
		if (filterFree) {
			list = list.filter((mDto) => isFree(mDto));
		}

		const q = searchQuery.trim();
		if (q) {
			list = list.filter((mDto) => matchesLooseQuery(q, mDto.name, mDto.id, mDto.provider, mDto.selector));
		}

		return list;
	});

	const refreshTip = $derived(
		modelSettingsStore.catalogFilterProviderId
			? m.catalog_tab_refresh_provider_tooltip({ name: providerName(modelSettingsStore.catalogFilterProviderId) })
			: m.ui_catalogtab_aggiorna_catalogo_da_tutti_i_provider_attivi_c6bb()
	);

	function providerName(id: string): string {
		return modelSettingsStore.providers.find((p) => p.id === id)?.name || id;
	}

	function isFree(mDto: ModelDto): boolean {
		if (mDto.cost?.input === undefined && mDto.cost?.output === undefined) return false;
		return (mDto.cost?.input ?? 0) === 0 && (mDto.cost?.output ?? 0) === 0;
	}

	function formatCtx(tokens?: number) {
		if (!tokens) return '-';
		if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
		if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
		return `${tokens}`;
	}

	function formatMoney(cost?: number) {
		if (cost === undefined || cost === null) return '-';
		if (cost === 0) return m.catalog_tab_cost_free();
		return `$${cost.toFixed(2)}`;
	}

	function formatCostPair(mDto: ModelDto): string {
		if (mDto.cost?.input === undefined && mDto.cost?.output === undefined) return '-';
		if (isFree(mDto)) return m.catalog_tab_cost_free();
		return `${formatMoney(mDto.cost?.input)} / ${formatMoney(mDto.cost?.output)}`;
	}

	function reasoningTitle(mDto: ModelDto): string {
		const levels = mDto.thinking?.efforts;
		if (levels?.length) {
			return m.catalog_tab_reasoning_efforts_tooltip({ efforts: levels.join(', ') });
		}
		return m.catalog_tab_reasoning_tooltip();
	}

	function isRoleAssigned(roleId: string, model: ModelDto): boolean {
		const raw = modelSettingsStore.draftConfig?.modelRoles[roleId];
		if (!raw) return false;
		return splitModelSelector(raw, modelSettingsStore.knownSelectors).base === model.selector;
	}

	function isRoleFallback(roleId: string, model: ModelDto): boolean {
		const fallbacks = modelSettingsStore.draftConfig?.fallbackChains[roleId] ?? [];
		return fallbacks.some(
			(fb) => splitModelSelector(fb, modelSettingsStore.knownSelectors).base === model.selector
		);
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
		modelSettingsStore.showToast(m.ui_catalogtab_modello_assegnato_al_ruolo_value1_6cd2({ value1: roleId }));
	}

	function handleAddAsFallback(roleId: string, model: ModelDto) {
		modelSettingsStore.addFallback(roleId, model.selector);
		openAssignMenuFor = null;
		modelSettingsStore.showToast(m.catalog_tab_added_as_fallback({ role: roleId }));
	}
</script>

<div class="catalog-tab">
	<!-- Sidebar sinistra: filtro per ambito/provider -->
	<aside class="catalog-sidebar" aria-label={m.models_catalog_scope_sidebar()}>
		<div class="sidebar-title">{m.catalog_tab_scope_title()}</div>
		<nav class="scope-list">
			<button
				type="button"
				class="scope-item"
				class:active={modelSettingsStore.catalogFilterProviderId === null}
				onclick={selectAllProviders}
			>
				<span class="scope-label">{m.catalog_tab_all_models()}</span>
				<span class="scope-count">{effectiveCatalog.length}</span>
			</button>
			{#each providerEntries as p (p.id)}
				{@const pTooltip = p.source === 'plugin' ? `${p.name} (plugin)` : p.name}
				<Tooltip text={pTooltip}>
					<button
						type="button"
						class="scope-item"
						class:active={modelSettingsStore.catalogFilterProviderId === p.id}
						onclick={() => selectScopeProvider(p.id)}
					>
						<span class="scope-label">{p.name}</span>
						<span class="scope-count">{p.count}</span>
					</button>
				</Tooltip>
			{/each}
			{#if providerEntries.length === 0}
				<div class="scope-empty">{m.catalog_tab_no_providers()}</div>
			{/if}
		</nav>
	</aside>

	<!-- Pannello destro: ricerca, filtri rapidi e lista modelli -->
	<div class="catalog-main">
		<div class="filter-header">
			<div class="search-input-wrapper">
				<span class="search-icon" aria-hidden="true">
					<IconSearch />
				</span>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder={m.models_catalog_search_placeholder()}
					aria-label={m.ui_catalogtab_cerca_nel_catalogo_modelli_2515()}
				/>
				{#if searchQuery}
					<button
						type="button"
						class="btn-clear"
						aria-label={m.file_tree_clear_search()}
						onclick={() => (searchQuery = '')}
					>
						<IconClose />
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
					{m.catalog_tab_filter_vision()}
				</button>
				<button
					type="button"
					class="filter-toggle-chip"
					class:active={filterReasoning}
					onclick={() => (filterReasoning = !filterReasoning)}
				>
					{m.catalog_tab_filter_reasoning()}
				</button>
				<button
					type="button"
					class="filter-toggle-chip free"
					class:active={filterFree}
					onclick={() => (filterFree = !filterFree)}
				>
					{m.catalog_tab_filter_free()}
				</button>
				<Tooltip text={refreshTip}>
					<button
						type="button"
						class="refresh-catalog-btn"
						disabled={modelSettingsStore.isRefreshingCatalog}
						onclick={() => modelSettingsStore.refreshCatalog(modelSettingsStore.catalogFilterProviderId ?? undefined)}
					>
						<span class="refresh-icon" class:spinning={modelSettingsStore.isRefreshingCatalog} aria-hidden="true">
							<IconRefresh />
						</span>
						<span>{modelSettingsStore.isRefreshingCatalog ? m.catalog_tab_refreshing() : m.ui_catalogtab_aggiorna_catalogo_7a49()}</span>
					</button>
				</Tooltip>
			</div>
		</div>

		<div class="catalog-stats">
			<span>{m.catalog_tab_stats({ shown: filteredCatalog.length, total: effectiveCatalog.length })}</span>
		</div>

		<div class="catalog-list">
			{#if effectiveCatalog.length === 0 && !modelSettingsStore.loading}
				<div class="empty-state">
					<p>{m.ui_catalogtab_nessun_modello_disponibile_nel_catalogo_611a()}</p>
					<button type="button" class="btn-retry" onclick={() => modelSettingsStore.refreshCatalog()}>
						{m.catalog_tab_reload_providers()}
					</button>
				</div>
			{:else if filteredCatalog.length === 0}
				<div class="empty-state">
					<p>{m.ui_catalogtab_nessun_modello_trovato_per_i_filtri_selezionati_9d95()}</p>
					<button type="button" class="btn-retry" onclick={clearSearchFilters}>
						{m.catalog_tab_clear_filters()}
					</button>
				</div>
			{:else}
				{#each filteredCatalog as mDto (mDto.selector)}
					<div class="model-row">
						<div class="model-meta-cell">
							<div class="name-row">
								<span class="m-name">{mDto.name}</span>
								<span class="m-provider">{providerName(mDto.provider)}</span>
								{#if mDto.isCustom}
									<span class="m-custom-badge">{m.catalog_tab_custom_badge()}</span>
								{/if}
							</div>
							<div class="m-selector-row">
								<span class="m-selector">{mDto.selector}</span>
							</div>
						</div>

						<div class="badges-cell">
							{#if mDto.contextWindow}
								<Tooltip text={m.catalog_tab_context_window_tooltip()}>
									<span class="ui-cap ctx">
										<IconContextWindow />
										<small>{formatCtx(mDto.contextWindow)}</small>
									</span>
								</Tooltip>
							{/if}
							{#if mDto.maxTokens}
								<Tooltip text={m.catalog_tab_max_tokens_tooltip()}>
									<span class="ui-cap ctx">
										<small>{formatCtx(mDto.maxTokens)} {m.catalog_tab_max_out()}</small>
									</span>
								</Tooltip>
							{/if}
							{#if mDto.input?.includes('image')}
								<Tooltip text={m.models_picker_vision_cap()}>
									<span class="ui-cap">
										<IconRoleVision />
										<span>Vision</span>
									</span>
								</Tooltip>
							{/if}
							{#if mDto.reasoning}
								<Tooltip text={reasoningTitle(mDto)}>
									<span class="ui-cap">
										<IconRoleSlow />
										<span>Reasoning</span>{#if mDto.thinking?.efforts?.length}<small> · {mDto.thinking.efforts.join(', ')}</small>{/if}
									</span>
								</Tooltip>
							{/if}
						</div>

						<div class="cost-cell">
							<span class="cost-label">{costPerMillionLabel()}</span>
							<span class="cost-val" class:free={isFree(mDto)}>{formatCostPair(mDto)}</span>
						</div>

						<div class="action-cell">
							{#if modelSettingsStore.modelPickCallback}
								<button
									type="button"
									class="ui-button ui-button-primary select-model-btn"
									onclick={() => modelSettingsStore.selectModel(mDto.selector)}
								>
									<span>{m.ui_catalogtab_seleziona_modello?.() ?? 'Usa modello'}</span>
								</button>
							{:else}
							<MenuButton
								open={openAssignMenuFor === mDto.selector}
								width="280px"
								align="right"
								hasPopup="menu"
								ariaLabel={m.catalog_tab_assign_model_aria({ name: mDto.name })}
								onToggle={() => {
									openAssignMenuFor = openAssignMenuFor === mDto.selector ? null : mDto.selector;
								}}
								onClose={() => {
									if (openAssignMenuFor === mDto.selector) openAssignMenuFor = null;
								}}
							>
								{#snippet trigger()}
									<span>{m.catalog_tab_assign_btn()}</span>
									<IconChevronDown />
								{/snippet}

								<div class="assign-menu">
									<div class="assign-section-title">{m.catalog_tab_assign_to_role()}</div>
									<div class="assign-grid">
										{#each STANDARD_ROLES as r (r.id)}
											{@const RoleIcon = r.icon}
											{@const isAssigned = isRoleAssigned(r.id, mDto)}
											<button
												type="button"
												class="assign-opt"
												class:assigned={isAssigned}
												onclick={() => handleAssignToRole(r.id, mDto)}
											>
												<span class="opt-badge">{r.abbr}</span>
												<span class="opt-icon"><RoleIcon /></span>
												<span class="opt-label">{r.label}</span>
												{#if isAssigned}
													<span class="opt-check" aria-hidden="true">
														<IconCheck />
													</span>
												{/if}
											</button>
										{/each}
									</div>

									<div class="assign-divider"></div>

									<div class="assign-section-title">{addAsFallbackLabel()}</div>
									<div class="assign-grid">
										{#each STANDARD_ROLES as r (r.id)}
											{@const isFallback = isRoleFallback(r.id, mDto)}
											<button
												type="button"
												class="assign-opt fallback"
												class:assigned={isFallback}
												onclick={() => handleAddAsFallback(r.id, mDto)}
											>
												<span class="opt-badge">{r.abbr}</span>
												<span class="opt-label">+ {m.catalog_tab_fallback_prefix()} {r.label}</span>
												{#if isFallback}
													<span class="opt-check" aria-hidden="true">
														<IconCheck />
													</span>
												{/if}
											</button>
										{/each}
									</div>
								</div>
							</MenuButton>
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
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
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
		border-radius: var(--radius-md);
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
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		--icon-size: 13px;
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
		transition: border-color var(--dur-fast);
	}

	.search-input-wrapper input:focus-visible {
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
		border-radius: var(--radius-sm);
		--icon-size: 12px;
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
		border-radius: var(--radius-md);
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
		border-radius: var(--radius-md);
		padding: 5px 10px;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
		--icon-size: 12px;
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

	.catalog-stats {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
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
		font-size: var(--text-caption);
		color: var(--ink-faint);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.m-custom-badge {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
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
		font-size: var(--text-caption);
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

	.cost-cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		width: 130px;
		flex-shrink: 0;
	}

	.cost-label {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
	}

	.cost-val {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cost-val.free {
		color: var(--ink-muted);
		font-weight: 500;
	}

	.action-cell {
		position: relative;
		flex-shrink: 0;
	}
	.select-model-btn {
		font-size: 12px;
		padding: 4px 10px;
		height: 28px;
		white-space: nowrap;
	}

	.assign-menu {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
	}

	.assign-section-title {
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink-faint);
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
		padding: 7px 8px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
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

	.assign-opt.assigned {
		background: color-mix(in oklab, var(--brand) 8%, transparent);
	}

	.opt-badge {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
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
		--icon-size: 12px;
	}

	.opt-label {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.opt-check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--brand-ink);
		margin-left: auto;
		--icon-size: 14px;
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
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-retry:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}
</style>
