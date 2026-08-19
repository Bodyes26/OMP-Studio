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
		modelSettingsStore.showToast(`Modello assegnato al ruolo ${roleId.toUpperCase()} ✓`);
	}

	function handleAddAsFallback(roleId: string, model: ModelDto) {
		modelSettingsStore.addFallback(roleId, model.selector);
		openAssignMenuFor = null;
		modelSettingsStore.showToast(`Aggiunto come fallback a ${roleId.toUpperCase()} ✓`);
	}

	function handleDocClick() {
		openAssignMenuFor = null;
	}
</script>

<svelte:window onclick={handleDocClick} />

<div class="catalog-tab">
	<!-- Top Controls -->
	<div class="filter-header">
		<div class="search-input-wrapper">
			<span class="search-icon">🔍</span>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Cerca per nome, ID o provider..."
				onclick={(e) => e.stopPropagation()}
			/>
			{#if searchQuery}
				<button class="btn-clear" onclick={() => searchQuery = ''}>✕</button>
			{/if}
		</div>

		<div class="quick-toggles">
			<button
				type="button"
				class="filter-toggle-chip"
				class:active={filterVision}
				onclick={() => filterVision = !filterVision}
			>
				👁️ Vision
			</button>
			<button
				type="button"
				class="filter-toggle-chip"
				class:active={filterReasoning}
				onclick={() => filterReasoning = !filterReasoning}
			>
				🧠 Reasoning
			</button>
			<button
				type="button"
				class="refresh-catalog-btn"
				disabled={modelSettingsStore.isRefreshingCatalog}
				onclick={() => modelSettingsStore.refreshCatalog()}
				title="Forza il refresh dei cataloghi da tutti i provider OMP"
			>
				<span class:spinning={modelSettingsStore.isRefreshingCatalog}>↻</span>
				{modelSettingsStore.isRefreshingCatalog ? 'Aggiornamento...' : 'Ricarica Catalogo'}
			</button>
		</div>
	</div>

	<!-- Provider Pills -->
	<div class="provider-pills">
		<button
			class="pill"
			class:active={selectedProvider === 'all'}
			onclick={() => selectedProvider = 'all'}
		>
			Tutti ({modelSettingsStore.catalog.length})
		</button>
		{#each providersList as p (p)}
			{@const count = modelSettingsStore.catalog.filter(m => m.provider === p).length}
			<button
				class="pill"
				class:active={selectedProvider === p}
				onclick={() => selectedProvider = p}
			>
				{p} ({count})
			</button>
		{/each}
	</div>

	<!-- Stats & Count -->
	<div class="catalog-stats">
		<span>Visualizzati <strong>{filteredCatalog.length}</strong> modelli di {modelSettingsStore.catalog.length} totali</span>
	</div>

	<!-- Catalog List / Table -->
	<div class="catalog-list">
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
						<span class="spec-label">Context</span>
						<span class="spec-val">{formatCtx(m.contextWindow)}</span>
					</div>
					<div class="spec-item" title="Max output tokens">
						<span class="spec-label">Max Out</span>
						<span class="spec-val">{formatCtx(m.maxTokens)}</span>
					</div>
					{#if m.cost?.input !== undefined && m.cost?.output !== undefined}
						<div class="spec-item" title="Costo per milione di token (Input / Output)">
							<span class="spec-label">$/1M in/out</span>
							<span class="spec-val">{formatCost(m.cost.input)} / {formatCost(m.cost.output)}</span>
						</div>
					{/if}
				</div>

				<div class="badges-cell">
					{#if m.input?.includes('image')}
						<span class="cap-badge vision" title="Supporta input immagini / vision">👁️ Vision</span>
					{/if}
					{#if m.reasoning}
						<span class="cap-badge reasoning" title="Supporta modalità reasoning / thinking">🧠 Thinking</span>
					{/if}
				</div>

				<div class="action-cell">
					<button
						type="button"
						class="btn-assign-dropdown"
						onclick={(e) => {
							e.stopPropagation();
							openAssignMenuFor = openAssignMenuFor === m.selector ? null : m.selector;
						}}
					>
						Assegna ▾
					</button>

					{#if openAssignMenuFor === m.selector}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="assign-popover" onclick={(e) => e.stopPropagation()}>
							<div class="assign-section-title">Imposta come Ruolo:</div>
							{#each STANDARD_ROLES as r}
								<button
									class="assign-opt"
									onclick={() => handleAssignToRole(r.id, m)}
								>
									<span>{r.icon}</span>
									<span>{r.label}</span>
								</button>
							{/each}
							<div class="assign-divider"></div>
							<div class="assign-section-title">Aggiungi come Fallback:</div>
							{#each STANDARD_ROLES.slice(0, 4) as r}
								<button
									class="assign-opt fallback"
									onclick={() => handleAddAsFallback(r.id, m)}
								>
									<span>+ Fallback {r.id}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<div class="empty-state">
				Nessun modello trovato corrispondente ai filtri impostati.
			</div>
		{/each}
	</div>
</div>

<style>
	.catalog-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-2) 0;
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
		font-size: 13px;
		color: var(--ink-faint);
		pointer-events: none;
	}

	.search-input-wrapper input {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 7px 28px 7px 32px;
		font-family: inherit;
		font-size: var(--text-sm);
		color: var(--ink);
		outline: none;
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
		font-size: 11px;
	}

	.quick-toggles {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.filter-toggle-chip {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		padding: 6px 10px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 4px;
		transition: all 0.15s ease;
	}

	.filter-toggle-chip:hover {
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.filter-toggle-chip.active {
		background: var(--brand-dim);
		border-color: var(--brand);
		color: var(--brand-ink);
		font-weight: 600;
	}

	.refresh-catalog-btn {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		padding: 6px 10px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 4px;
		transition: all 0.15s ease;
	}

	.refresh-catalog-btn:hover:not(:disabled) {
		border-color: var(--line-strong);
		color: var(--ink);
		background: var(--bg-hover);
	}

	.refresh-catalog-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.spinning {
		animation: spin 1s linear infinite;
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
		padding-bottom: 4px;
	}

	.pill {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: 99px;
		color: var(--ink-faint);
		font-size: 11px;
		font-family: var(--font-mono);
		padding: 3px 10px;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s ease;
	}

	.pill:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.pill.active {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}

	.catalog-stats {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.catalog-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 480px;
		overflow-y: auto;
		padding-right: 2px;
	}

	.model-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: 8px 12px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		transition: border-color 0.15s ease;
	}

	.model-row:hover {
		border-color: var(--line-strong);
		background: var(--bg-hover);
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
	}

	.m-provider {
		font-size: 10px;
		font-family: var(--font-mono);
		font-weight: 600;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		text-transform: lowercase;
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
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--brand-dim);
		color: var(--brand);
	}

	.m-id-row {
		display: flex;
		align-items: center;
	}

	.m-id {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.specs-cell {
		flex: 1.5;
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
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.spec-val {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink-muted);
		font-weight: 500;
	}

	.badges-cell {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 120px;
	}

	.cap-badge {
		font-size: 10px;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.cap-badge.vision {
		background: rgba(66, 133, 244, 0.08);
		border-color: rgba(66, 133, 244, 0.25);
		color: #4285f4;
	}

	.cap-badge.reasoning {
		background: rgba(139, 92, 246, 0.08);
		border-color: rgba(139, 92, 246, 0.25);
		color: #8b5cf6;
	}

	.action-cell {
		position: relative;
	}

	.btn-assign-dropdown {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-weight: 500;
		padding: 5px 10px;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s ease;
	}

	.btn-assign-dropdown:hover {
		border-color: var(--brand);
		color: var(--ink);
		background: var(--bg-hover);
	}

	.assign-popover {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		width: 190px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-2);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.assign-section-title {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
		padding: 4px 6px;
	}

	.assign-divider {
		height: 1px;
		background: var(--line);
		margin: 4px 0;
	}

	.assign-opt {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 5px 8px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		cursor: pointer;
		text-align: left;
	}

	.assign-opt:hover {
		background: var(--bg-hover);
	}

	.assign-opt.fallback {
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.empty-state {
		padding: var(--space-6);
		text-align: center;
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}
</style>
