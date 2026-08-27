<script lang="ts">
	import {
		modelSettingsStore,
		STANDARD_ROLES,
		type ModelDto,
		type RoleSuggestionsResponse,
		type SuggestedModelItem
	} from '$lib/stores/modelSettings.svelte';
	import { IconClose, IconCheck, IconWarning } from '$lib/icons';
	import ModelPickerDropdown from './ModelPickerDropdown.svelte';
	import ReasoningSlider from './ReasoningSlider.svelte';
	import CycleDrawer from './CycleDrawer.svelte';

	let selectedRoleId = $state<string>(STANDARD_ROLES[0].id);
	let roleFilterQuery = $state('');
	let cycleDrawerOpen = $state(false);
	let isAddingFallback = $state(false);
	let rootEl = $state<HTMLDivElement | null>(null);
	let currentSuggestions = $state<RoleSuggestionsResponse | null>(null);
	let isFetchingSuggestions = $state(false);

	const selectedRole = $derived(
		STANDARD_ROLES.find((r) => r.id === selectedRoleId) || STANDARD_ROLES[0]
	);
	const SelectedRoleIcon = $derived(selectedRole.icon);

	const filteredRoles = $derived.by(() => {
		const q = roleFilterQuery.trim().toLowerCase();
		if (!q) return STANDARD_ROLES;
		return STANDARD_ROLES.filter(
			(r) =>
				r.label.toLowerCase().includes(q) ||
				r.id.toLowerCase().includes(q) ||
				r.desc.toLowerCase().includes(q)
		);
	});

	function getRoleSelector(roleId: string): string {
		return modelSettingsStore.draftConfig?.modelRoles[roleId] || '';
	}

	function getRoleModelRaw(roleId: string): string {
		const full = getRoleSelector(roleId);
		return full.split(':')[0] || '';
	}

	function getRoleThinking(roleId: string): string {
		const full = getRoleSelector(roleId);
		if (full.includes(':')) {
			return full.split(':')[1];
		}
		return 'auto';
	}
	const configuredCount = $derived(
		STANDARD_ROLES.filter((r) => !!getRoleSelector(r.id)).length
	);

	function getFallbacks(roleId: string): string[] {
		return modelSettingsStore.draftConfig?.fallbackChains[roleId] || [];
	}

	function getModelDto(selector: string): ModelDto | undefined {
		const raw = selector.split(':')[0];
		return modelSettingsStore.catalog.find((m) => m.selector === raw || m.id === raw);
	}

	const selectedRoleModelRaw = $derived(getRoleModelRaw(selectedRole.id));
	const selectedRoleModelDto = $derived(getModelDto(selectedRoleModelRaw));
	const selectedRoleThinking = $derived(getRoleThinking(selectedRole.id));
	const selectedRoleFallbacks = $derived(getFallbacks(selectedRole.id));

	// Caricamento dinamico dei suggerimenti con OMP e caching
	$effect(() => {
		const roleId = selectedRole.id;
		const primaryRaw = selectedRoleModelRaw;
		const fallbacks = selectedRoleFallbacks;

		let cancelled = false;
		isFetchingSuggestions = true;

		void modelSettingsStore
			.getRoleSuggestions(roleId, primaryRaw, fallbacks)
			.then((res) => {
				if (!cancelled) {
					currentSuggestions = res;
					isFetchingSuggestions = false;
				}
			})
			.catch(() => {
				if (!cancelled) {
					isFetchingSuggestions = false;
				}
			});

		return () => {
			cancelled = true;
		};
	});

	function handleRefreshSuggestions() {
		isFetchingSuggestions = true;
		void modelSettingsStore
			.getRoleSuggestions(selectedRole.id, selectedRoleModelRaw, selectedRoleFallbacks, true)
			.then((res) => {
				currentSuggestions = res;
			})
			.finally(() => {
				isFetchingSuggestions = false;
			});
	}

	function handleApplyPrimarySuggestion(sug: SuggestedModelItem) {
		modelSettingsStore.setRoleModel(selectedRole.id, sug.selector, sug.recommendedThinking);
	}
	function handleModelChange(roleId: string, selector: string) {
		modelSettingsStore.setRoleModel(roleId, selector);
	}

	function handleThinkingChange(roleId: string, level: string) {
		modelSettingsStore.setRoleThinking(roleId, level);
	}

	function handleAddFallback(roleId: string, selector: string) {
		modelSettingsStore.addFallback(roleId, selector);
		isAddingFallback = false;
	}

	function moveFallback(roleId: string, fromIndex: number, delta: number) {
		modelSettingsStore.moveFallback(roleId, fromIndex, fromIndex + delta);
	}

	function removeFallback(roleId: string, index: number) {
		modelSettingsStore.removeFallback(roleId, index);
	}

	function formatContextTokens(tokens?: number) {
		if (!tokens) return '';
		if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M ctx`;
		if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k ctx`;
		return `${tokens} ctx`;
	}

	// Scorciatoia Ctrl+P per togglare il pannello ciclo rapido.
	// Confinata al modale aperto e con il fuoco al suo interno, ignora i campi testo esterni.
	function handleKeydown(e: KeyboardEvent) {
		if (!modelSettingsStore.isOpen) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
			const target = e.target as HTMLElement | null;
			if (target) {
				const isField =
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target.isContentEditable;
				// Se il campo non appartiene a questo pannello (es. composer chat), non intercettare
				if (isField && (!rootEl || !rootEl.contains(target))) {
					return;
				}
			}
			// Se il fuoco e' del tutto fuori dal contenitore di RolesTab, non interferire col composer
			if (rootEl && document.activeElement && !rootEl.contains(document.activeElement)) {
				return;
			}
			e.preventDefault();
			cycleDrawerOpen = !cycleDrawerOpen;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="master-detail-container" bind:this={rootEl}>
	<!-- Left Sidebar: Lista Ruoli -->
	<aside class="roles-sidebar">
		<div class="sidebar-header">
			<div class="search-box">
				<svg class="search-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6">
					<circle cx="6.5" cy="6.5" r="4" />
					<path d="M9.5 9.5L13.5 13.5" stroke-linecap="round" />
				</svg>
				<input
					type="text"
					class="search-input"
					bind:value={roleFilterQuery}
					placeholder="Filtra ruoli..."
					aria-label="Filtra ruoli"
				/>
				{#if roleFilterQuery}
					<button
						type="button"
						class="btn-clear-search"
						onclick={() => roleFilterQuery = ''}
						aria-label="Cancella filtro"
					>
						<IconClose />
					</button>
				{/if}
			</div>
		</div>

		<div class="roles-list">
			{#each filteredRoles as role (role.id)}
				{@const rawModel = getRoleModelRaw(role.id)}
				{@const modelDto = getModelDto(rawModel)}
				{@const isConfigured = !!rawModel}
				{@const isSelected = role.id === selectedRole.id}
				{@const fallbacksCount = getFallbacks(role.id).length}
				{@const RoleIcon = role.icon}

				<button
					type="button"
					class="role-nav-item"
					class:selected={isSelected}
					class:unconfigured={!isConfigured}
					onclick={() => {
						selectedRoleId = role.id;
						isAddingFallback = false;
					}}
				>
					<span class="role-glyph" class:selected={isSelected}><RoleIcon /></span>
					
					<div class="role-nav-meta">
						<div class="role-nav-top">
							<span class="role-nav-name">{role.label}</span>
							{#if isConfigured}
								<span class="status-indicator configured" title="Configurato"><IconCheck /></span>
							{:else}
								<span class="status-indicator warning" title="Non configurato"><IconWarning /></span>
							{/if}
						</div>

						<div class="role-nav-bottom">
							{#if isConfigured}
								<span class="role-nav-model truncate" title={rawModel}>
									{modelDto?.name || rawModel.split('/')[1] || rawModel}
								</span>
								{#if fallbacksCount > 0}
									<span class="fallback-pill">+{fallbacksCount}</span>
								{/if}
							{:else}
								<span class="role-nav-empty">Non configurato</span>
							{/if}
						</div>
					</div>
				</button>
			{/each}

			{#if filteredRoles.length === 0}
				<div class="no-roles-found">
					Nessun ruolo corrisponde al filtro.
				</div>
			{/if}
		</div>

		<div class="sidebar-footer">
			<div class="summary-text">
				<span class="count-badge">{configuredCount}/{STANDARD_ROLES.length}</span>
				<span>ruoli configurati</span>
			</div>
			
			<button
				type="button"
				class="btn-toggle-cycle"
				class:active={cycleDrawerOpen}
				onclick={() => cycleDrawerOpen = !cycleDrawerOpen}
				title="Apri pannello Sequenza Ciclo Rapido (Ctrl+P)"
			>
				<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4">
					<path d="M2 8a6 6 0 0 1 10.2-4.2M14 8a6 6 0 0 1-10.2 4.2" stroke-linecap="round" />
					<path d="M12.5 1v3h-3M3.5 15v-3h3" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				<span>Ciclo (Ctrl+P)</span>
			</button>
		</div>
	</aside>

	<!-- Center Panel: Dettaglio Ruolo Selezionato -->
	<main class="role-detail-panel">
		<header class="detail-header">
			<div class="role-header-info">
				<span class="role-hero-glyph"><SelectedRoleIcon /></span>
				<div class="role-header-titles">
					<div class="role-title-line">
						<h2 class="role-title">{selectedRole.label}</h2>
						<span class="role-id-pill">{selectedRole.id}</span>
					</div>
					<p class="role-description">{selectedRole.desc}</p>
				</div>
			</div>

			{#if selectedRoleModelRaw}
				<button
					type="button"
					class="btn-clear-role"
					onclick={() => modelSettingsStore.removeRole(selectedRole.id)}
					title="Rimuovi la configurazione per questo ruolo"
				>
					Rimuovi Assegnazione
				</button>
			{/if}
		</header>

		<div class="detail-scroll-body">
			<!-- Sezione 1: Modello Primario -->
			<section class="config-section">
				<div class="section-heading">
					<h3 class="section-title">Modello Primario</h3>
					<span class="section-subtitle">
						Instradamento predefinito a cui vengono delegate le richieste per questo ruolo.
					</span>
				</div>

				<div class="picker-container">
					<ModelPickerDropdown
						catalog={modelSettingsStore.catalog}
						value={selectedRoleModelRaw}
						placeholder="Seleziona modello per {selectedRole.label}..."
						onSelect={(sel) => handleModelChange(selectedRole.id, sel)}
					/>
				</div>

				<!-- Metadati modello selezionato -->
				{#if selectedRoleModelDto}
					<div class="model-meta-row">
						<span class="meta-badge provider">{selectedRoleModelDto.provider}</span>
						{#if selectedRoleModelDto.contextWindow}
							<span class="meta-badge ctx">{formatContextTokens(selectedRoleModelDto.contextWindow)}</span>
						{/if}
						{#if selectedRoleModelDto.reasoning}
							<span class="meta-badge reasoning">Reasoning</span>
						{/if}
						{#if selectedRoleModelDto.input?.includes('image')}
							<span class="meta-badge vision">Vision</span>
						{/if}
						{#if selectedRoleModelDto.isCustom}
							<span class="meta-badge custom">Custom</span>
						{/if}
					</div>
				{/if}

				<!-- Suggerimenti Intelligenti Primari -->
				{#if isFetchingSuggestions && (!currentSuggestions || currentSuggestions.roleId !== selectedRole.id)}
					<div class="suggestions-loading">
						<span class="sug-spinner"></span>
						<span>Analisi modelli ottimali con AI in corso...</span>
					</div>
				{:else if currentSuggestions && currentSuggestions.primary.length > 0}
					<div class="suggestions-row">
						<div class="suggestions-header">
							<span class="suggestions-label">
								<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4">
									<path d="M8 1.5a4.5 4.5 0 0 0-2.5 8.2v1.8h5V9.7A4.5 4.5 0 0 0 8 1.5zM6.5 14.5h3" stroke-linecap="round" />
								</svg>
								Suggeriti AI
							</span>
							<button
								type="button"
								class="btn-refresh-sug"
								class:spinning={isFetchingSuggestions}
								disabled={isFetchingSuggestions}
								onclick={handleRefreshSuggestions}
								title="Rianalizza raccomandazioni per questo ruolo"
							>
								<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4">
									<path d="M2 8a6 6 0 1 1 1.8 4.2M2 8V4.5M2 8h3.5" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
								<span>Rianalizza</span>
							</button>
						</div>
						<div class="suggestions-chips">
							{#each currentSuggestions.primary as sug (sug.selector)}
								{@const modelDto = getModelDto(sug.selector)}
								{@const isAlreadySelected = selectedRoleModelRaw === sug.selector}
								{@const tooltipText = `${sug.reason}${sug.arenaElo ? ` • ELO: ~${sug.arenaElo}` : ''}${sug.tokensPerSec ? ` • Velocità: ${Math.round(sug.tokensPerSec)} tok/s` : ''} (${sug.selector})`}
								<button
									type="button"
									class="suggestion-chip"
									class:active-choice={isAlreadySelected}
									onclick={() => handleApplyPrimarySuggestion(sug)}
									title={tooltipText}
								>
									<span class="sug-provider">{modelDto?.provider || sug.selector.split('/')[0] || ''}</span>
									<span class="sug-name">{modelDto?.name || sug.selector.split('/')[1] || sug.selector}</span>
									{#if sug.badge}
										<span class="sug-badge" class:elo-badge={sug.badge.includes('ELO')} class:speed-badge={sug.badge.includes('tok/s')}>{sug.badge}</span>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</section>

			<!-- Sezione 2: Reasoning Effort -->
			<section class="config-section">
				<div class="section-heading">
					<h3 class="section-title">Reasoning / Thinking Effort</h3>
					<span class="section-subtitle">
						Budget di ragionamento computazionale allocato per ogni chiamata in questo ruolo.
					</span>
				</div>

				<ReasoningSlider
					value={selectedRoleThinking}
					disabled={!selectedRoleModelRaw}
					onChange={(lvl) => handleThinkingChange(selectedRole.id, lvl)}
				/>
			</section>

			<!-- Sezione 3: Catena di Fallback -->
			<section class="config-section">
				<div class="section-heading">
					<div class="section-title-row">
						<h3 class="section-title">Catena di Fallback (Modelli di Riserva)</h3>
						{#if selectedRoleFallbacks.length > 0}
							<span class="badge-count">{selectedRoleFallbacks.length}</span>
						{/if}
					</div>
					<span class="section-subtitle">
						Intervengono in sequenza ordinata in caso di rate-limit, timeout o indisponibilità del modello primario.
					</span>
				</div>

				<!-- Lista Fallback -->
				<div class="fallbacks-list">
					{#each selectedRoleFallbacks as fbSelector, idx (fbSelector + idx)}
						{@const fbModel = getModelDto(fbSelector)}
						<div class="fallback-row">
							<span class="fb-order">#{idx + 1}</span>
							
							<div class="fb-info">
								<span class="fb-name">{fbModel?.name || fbSelector.split('/')[1] || fbSelector}</span>
								{#if fbModel}
									<span class="fb-provider-tag">{fbModel.provider}</span>
								{/if}
							</div>

							<div class="fb-actions">
								<button
									type="button"
									class="btn-fb-action"
									disabled={idx === 0}
									onclick={() => moveFallback(selectedRole.id, idx, -1)}
									title="Aumenta priorità (sposta su)"
								>
									<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
										<path d="M3.5 10L8 5.5l4.5 4.5" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								</button>
								<button
									type="button"
									class="btn-fb-action"
									disabled={idx === selectedRoleFallbacks.length - 1}
									onclick={() => moveFallback(selectedRole.id, idx, 1)}
									title="Riduci priorità (sposta giù)"
								>
									<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
										<path d="M3.5 6L8 10.5l4.5-4.5" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								</button>
								<button
									type="button"
									class="btn-fb-action delete"
									onclick={() => removeFallback(selectedRole.id, idx)}
									title="Rimuovi modello di riserva"
								>
									<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
										<path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
									</svg>
								</button>
							</div>
						</div>
					{/each}

					{#if selectedRoleFallbacks.length === 0}
						<div class="empty-fallback-warning">
							<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
								<path d="M8 2l6 11H2L8 2zM8 6.5v3M8 11.5v.5" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
							<span>Nessuna riserva configurata: se il modello primario va in errore o rate-limit, la richiesta fallirà.</span>
						</div>
					{/if}
				</div>

				<!-- Aggiungi Fallback -->
				<div class="add-fallback-container">
					{#if isAddingFallback}
						<div class="inline-fallback-picker">
							<ModelPickerDropdown
								catalog={modelSettingsStore.catalog}
								placeholder="Scegli modello di riserva..."
								onSelect={(sel) => handleAddFallback(selectedRole.id, sel)}
							/>
							<button
								type="button"
								class="btn-cancel-fb"
								onclick={() => isAddingFallback = false}
							>
								Annulla
							</button>
						</div>
					{:else}
						<button
							type="button"
							class="btn-add-fallback"
							onclick={() => isAddingFallback = true}
						>
							+ Aggiungi Modello di Riserva
						</button>
					{/if}
				</div>

				<!-- Fallback Suggestions -->
				{#if currentSuggestions && currentSuggestions.fallback.length > 0}
					<div class="suggestions-row mt-2">
						<div class="suggestions-header">
							<span class="suggestions-label">Riserve consigliate AI (Cross-Provider)</span>
						</div>
						<div class="suggestions-chips">
							{#each currentSuggestions.fallback as sug (sug.selector)}
								{@const fbModel = getModelDto(sug.selector)}
								{@const alreadyInFallback = selectedRoleFallbacks.includes(sug.selector)}
								{@const tooltipText = `${sug.reason}${sug.arenaElo ? ` • ELO: ~${sug.arenaElo}` : ''}${sug.tokensPerSec ? ` • Velocità: ${Math.round(sug.tokensPerSec)} tok/s` : ''} (${sug.selector})`}
								{#if !alreadyInFallback && sug.selector !== selectedRoleModelRaw}
									<button
										type="button"
										class="suggestion-chip"
										onclick={() => handleAddFallback(selectedRole.id, sug.selector)}
										title={tooltipText}
									>
										<span class="sug-provider">{fbModel?.provider || sug.selector.split('/')[0] || ''}</span>
										<span class="sug-name">{fbModel?.name || sug.selector.split('/')[1] || sug.selector}</span>
										{#if sug.badge}
											<span class="sug-badge fallback-badge" class:free-badge={sug.badge.includes('Zero-Cost') || sug.isFree}>{sug.badge}</span>
										{/if}
									</button>
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			</section>
		</div>
	</main>

	<!-- Right Drawer: Ciclo Rapido Ctrl+P -->
	<CycleDrawer
		open={cycleDrawerOpen}
		onClose={() => cycleDrawerOpen = false}
	/>
</div>

<style>
	.master-detail-container {
		display: flex;
		height: 100%;
		min-height: 520px;
		max-height: 640px;
		overflow: hidden;
		background: var(--bg-sunken);
	}

	/* --- Sidebar Ruoli (Sinistra) --- */
	.roles-sidebar {
		width: 250px;
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
		font-size: 14px;
		cursor: pointer;
		padding: 0 2px;
	}

	.roles-list {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.role-nav-item {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 7px 8px;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: all 120ms ease;
		width: 100%;
	}

	.role-nav-item:hover {
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.role-nav-item.selected {
		background: color-mix(in srgb, var(--brand) 12%, var(--bg-base));
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line-strong));
	}

	.role-glyph {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		font-size: 11px;
		color: var(--ink-muted);
		margin-top: 1px;
		transition: all 120ms ease;
		--icon-size: 14px;
	}

	.role-glyph.selected {
		background: var(--brand);
		color: var(--on-brand);
		border-color: var(--brand);
		font-weight: 700;
	}

	.role-nav-meta {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.role-nav-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
	}

	.role-nav-name {
		font-size: 11.5px;
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status-indicator {
		font-size: 10px;
		font-weight: 700;
		flex-shrink: 0;
		--icon-size: 12px;
	}

	.status-indicator.configured {
		color: oklch(0.72 0.16 142);
	}

	.status-indicator.warning {
		color: var(--warn);
	}

	.role-nav-bottom {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	.role-nav-model {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.fallback-pill {
		font-family: var(--font-mono);
		font-size: 9px;
		padding: 0 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		color: var(--brand-ink);
		border: 1px solid var(--line);
		flex-shrink: 0;
	}

	.role-nav-empty {
		font-size: 10px;
		color: var(--warn);
		font-style: italic;
	}

	.no-roles-found {
		padding: 16px;
		font-size: 11px;
		color: var(--ink-faint);
		text-align: center;
	}

	.sidebar-footer {
		padding: 8px 10px;
		border-top: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: color-mix(in srgb, var(--bg-base) 40%, transparent);
	}

	.summary-text {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--ink-muted);
	}

	.count-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--brand-ink);
	}

	.btn-toggle-cycle {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px 6px;
		font-size: 10.5px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		transition: all 120ms ease;
	}

	.btn-toggle-cycle:hover,
	.btn-toggle-cycle.active {
		border-color: var(--brand-ink);
		color: var(--brand-ink);
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-raised));
	}

	/* --- Center Detail Panel --- */
	.role-detail-panel {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		overflow: hidden;
	}

	.detail-header {
		padding: 12px 18px;
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		background: color-mix(in srgb, var(--bg-base) 70%, var(--bg-sunken));
		gap: 12px;
	}

	.role-header-info {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		min-width: 0;
	}

	.role-hero-glyph {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--brand) 15%, var(--bg-base));
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
		color: var(--brand-ink);
		font-size: 16px;
		font-weight: 600;
		flex-shrink: 0;
		--icon-size: 18px;
	}

	.role-header-titles {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.role-title-line {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.role-title {
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.role-id-pill {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		color: var(--ink-faint);
	}

	.role-description {
		font-size: 11.5px;
		color: var(--ink-muted);
		margin: 0;
	}

	.btn-clear-role {
		padding: 4px 8px;
		font-size: 11px;
		border-radius: var(--radius-sm);
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-faint);
		cursor: pointer;
		transition: all 120ms ease;
		flex-shrink: 0;
	}

	.btn-clear-role:hover {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
		background: color-mix(in srgb, var(--warn) 6%, transparent);
	}

	.detail-scroll-body {
		flex: 1;
		overflow-y: auto;
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.config-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 620px;
	}

	.section-heading {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.section-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.section-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.badge-count {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 0 5px;
		border-radius: var(--radius-sm);
		background: var(--brand);
		color: var(--on-brand);
		font-weight: 700;
	}

	.section-subtitle {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.picker-container {
		width: 100%;
	}

	.model-meta-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
	}

	.meta-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-base);
		color: var(--ink-muted);
	}

	.meta-badge.provider {
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
		color: var(--brand-ink);
		background: color-mix(in srgb, var(--brand) 8%, var(--bg-base));
		text-transform: capitalize;
	}

	.meta-badge.reasoning {
		border-color: color-mix(in srgb, oklch(0.65 0.18 290) 30%, transparent);
		color: oklch(0.78 0.14 290);
	}

	.meta-badge.vision {
		border-color: color-mix(in srgb, oklch(0.68 0.16 195) 30%, transparent);
		color: oklch(0.78 0.13 195);
	}

	.suggestions-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 4px;
	}

	.suggestions-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.btn-refresh-sug {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-size: 10px;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: var(--radius-sm);
		transition: color 120ms ease;
	}

	.btn-refresh-sug:hover:not(:disabled) {
		color: var(--brand-ink);
	}

	.btn-refresh-sug.spinning svg,
	.sug-spinner {
		animation: spin 1s linear infinite;
	}

	.suggestions-loading {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--ink-faint);
		padding: 4px 0;
	}

	.sug-spinner {
		width: 11px;
		height: 11px;
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--brand);
		border-radius: 50%;
		flex-shrink: 0;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.suggestions-label {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
		font-weight: 600;
	}

	.suggestions-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.suggestion-chip {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		border-radius: var(--radius-md);
		border: 1px dashed var(--line-strong);
		background: var(--bg-base);
		font-size: 11px;
		color: var(--ink-muted);
		cursor: pointer;
		transition: all 120ms ease;
	}

	.suggestion-chip:hover {
		border-color: var(--brand-ink);
		color: var(--ink);
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-base));
	}

	.suggestion-chip.active-choice {
		border-style: solid;
		border-color: var(--brand-ink);
		background: color-mix(in srgb, var(--brand) 12%, var(--bg-base));
		color: var(--brand-ink);
	}

	.sug-provider {
		font-size: 9.5px;
		color: var(--ink-faint);
		text-transform: capitalize;
	}

	.sug-name {
		font-family: var(--font-mono);
		font-weight: 500;
	}

	.sug-badge {
		font-size: 9px;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--brand) 16%, transparent);
		color: var(--brand-ink);
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.sug-badge.elo-badge {
		background: color-mix(in srgb, var(--brand) 22%, transparent);
		border: 1px solid color-mix(in srgb, var(--brand-ink) 25%, transparent);
	}

	.sug-badge.speed-badge {
		background: color-mix(in srgb, var(--ink-muted) 14%, transparent);
		color: var(--ink);
	}

	.sug-badge.fallback-badge.free-badge {
		background: color-mix(in srgb, var(--ink-faint) 18%, transparent);
		color: var(--ink-muted);
		border: 1px dashed var(--line-strong);
	}
	/* Fallbacks */
	.fallbacks-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.fallback-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.fb-order {
		font-family: var(--font-mono);
		font-size: 10.5px;
		font-weight: 600;
		color: var(--brand-ink);
		width: 22px;
		flex-shrink: 0;
	}

	.fb-info {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.fb-name {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.fb-provider-tag {
		font-size: 10px;
		color: var(--ink-faint);
		text-transform: capitalize;
	}

	.fb-actions {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.btn-fb-action {
		width: 22px;
		height: 22px;
		padding: 0;
		display: grid;
		place-items: center;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		transition: all 120ms ease;
	}

	.btn-fb-action:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-fb-action.delete:hover:not(:disabled) {
		color: var(--warn);
	}

	.btn-fb-action:disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	.empty-fallback-warning {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: color-mix(in srgb, var(--warn) 6%, var(--bg-base));
		border: 1px dashed color-mix(in srgb, var(--warn) 30%, transparent);
		border-radius: var(--radius-md);
		font-size: 11px;
		color: var(--warn);
	}

	.add-fallback-container {
		display: flex;
		flex-direction: column;
	}

	.btn-add-fallback {
		padding: 6px 12px;
		background: transparent;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: 11.5px;
		cursor: pointer;
		transition: all 120ms ease;
		text-align: center;
	}

	.btn-add-fallback:hover {
		border-color: var(--brand-ink);
		color: var(--brand-ink);
		background: color-mix(in srgb, var(--brand) 6%, transparent);
	}

	.inline-fallback-picker {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.btn-cancel-fb {
		align-self: flex-end;
		padding: 3px 8px;
		font-size: 11px;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: pointer;
	}

	.btn-cancel-fb:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.mt-2 {
		margin-top: 8px;
	}
</style>
