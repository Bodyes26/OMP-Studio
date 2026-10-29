<script lang="ts">
	import { untrack } from 'svelte';
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { t, formatDateTime } from '#lib/automations/i18n.ts';
	import type { AutomationDefinition, AutomationState } from '#lib/automations/types.ts';
	import AutomationDetail from './AutomationDetail.svelte';
	import AutomationTitlesView from './AutomationTitlesView.svelte';
	import AutomationSettingsModal from './AutomationSettingsModal.svelte';
	import AutomationImportExportModal from './AutomationImportExportModal.svelte';
	import AutomationWizard from './AutomationWizard.svelte';
	import IconAutomation from './IconAutomation.svelte';
	import {
		IconSearch,
		IconPlus,
		IconSparkles,
		IconSettings,
		IconDownload,
		IconClose,
		IconWarning,
		IconCheck,
		IconSchedule,
		IconTerminal,
		IconFileCode,
		IconFolder
	} from '#lib/icons.ts';

	interface Props {
		onClose?: () => void;
		onOpenSession?: (sessionId: string) => void;
		initialFilter?: string;
	}

	let { onClose, onOpenSession, initialFilter = '' }: Props = $props();

	let activeMainTab = $state<'personal' | 'titles'>('personal');
	let searchQuery = $state('');
	let statusFilter = $state<string>('all');
	let projectFilter = $state<string>(untrack(() => initialFilter || automationsStore.projectFilter || ''));

	let showSettingsModal = $state(false);
	let showIoModal = $state(false);
	let wizardStartWithAi = $state(false);

	// Ensure automationsStore is initialized
	$effect(() => {
		if (!automationsStore.snapshot && !automationsStore.loading && !automationsStore.error) {
			void automationsStore.init();
		}
	});

	// Sync projectFilter with store if changed
	$effect(() => {
		if (initialFilter && initialFilter !== projectFilter) {
			projectFilter = initialFilter;
			automationsStore.projectFilter = initialFilter;
		}
	});

	const snapshot = $derived(automationsStore.snapshot);
	const allDefinitions = $derived(snapshot?.definitions || []);
	const projects = $derived(snapshot?.projects || []);
	const nextRuns = $derived(snapshot?.nextRuns || {});
	const allRuns = $derived(snapshot?.runs || []);

	// Filtered definitions
	const filteredDefinitions = $derived(
		allDefinitions.filter((def) => {
			// Search query match
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				const matchesName = def.name.toLowerCase().includes(q);
				const matchesDesc = (def.description || '').toLowerCase().includes(q);
				const matchesAction =
					def.action.kind === 'command'
						? (def.action.command || '').toLowerCase().includes(q)
						: (def.action.prompt || '').toLowerCase().includes(q);
				if (!matchesName && !matchesDesc && !matchesAction) return false;
			}

			// Project filter match
			if (projectFilter) {
				const paths = def.targets.projectPaths || [];
				if (def.targets.source !== 'studio' && paths.length > 0 && !paths.includes(projectFilter)) {
					return false;
				}
			}

			// Status filter match
			if (statusFilter === 'active' && def.state !== 'enabled') return false;
			if (statusFilter === 'disabled' && def.state !== 'disabled' && def.state !== 'archived') return false;
			if (statusFilter === 'attention' && !hasAttention(def.id) && def.state !== 'suspended') return false;

			return true;
		})
	);

	// Selected definition
	let selectedId = $state<string | null>(null);
	let selectedRunId = $state<string | null>(null);

	$effect(() => {
		if (automationsStore.selectedId) {
			selectedId = automationsStore.selectedId;
		}
		if (automationsStore.selectedRunId) {
			selectedRunId = automationsStore.selectedRunId;
		}
	});

	// Select first available item if none selected and definitions exist
	$effect(() => {
		if (activeMainTab === 'personal') {
			if (!selectedId && filteredDefinitions.length > 0) {
				selectedId = filteredDefinitions[0].id;
			} else if (selectedId && !allDefinitions.some(d => d.id === selectedId) && filteredDefinitions.length > 0) {
				selectedId = filteredDefinitions[0].id;
			}
		}
	});

	const selectedDefinition = $derived(
		allDefinitions.find((d) => d.id === selectedId) || null
	);

	function handleNewManual() {
		wizardStartWithAi = false;
		automationsStore.newDraft(projectFilter || undefined);
	}

	function handleNewAi() {
		wizardStartWithAi = true;
		automationsStore.newDraft(projectFilter || undefined);
	}

	function hasAttention(defId: string): boolean {
		return allRuns.some(
			(r) =>
				r.automationId === defId &&
				(r.requiresReview ||
					r.executions.some((e) => e.state === 'needsInput') ||
					(!r.acknowledged &&
						(r.state === 'error' ||
							r.state === 'timeout' ||
							r.state === 'unknown' ||
							r.state === 'skipped' ||
							r.executions.some((e) => e.state === 'error' || e.state === 'timeout'))))
		);
	}
</script>

<div class="automations-view">
	<!-- Barra superiore della vista -->
	<header class="view-header">
		<div class="header-left">
			<IconAutomation size={22} class="header-brand-icon" />
			<div class="title-wrap">
				<div class="title-line">
					<h1 class="view-title">{t('view_title')}</h1>
					{#if projectFilter}
						<span class="project-filter-chip font-mono text-xs">
							<IconFolder />
							<span>{projectFilter.split(/[\\/]/).pop()}</span>
							<button
								type="button"
								class="clear-chip-btn"
								onclick={() => { projectFilter = ''; automationsStore.projectFilter = ''; }}
								aria-label="Rimuovi filtro progetto"
							>
								<IconClose />
							</button>
						</span>
					{/if}
				</div>
				<p class="view-subtitle text-xs">{t('view_subtitle')}</p>
			</div>
		</div>

		<div class="header-right">
			<button
				type="button"
				class="ui-button ui-button-secondary text-xs"
				onclick={() => { showIoModal = true; }}
				title="Importa o esporta definizioni JSON"
			>
				<IconDownload />
				<span>{t('btn_import_export')}</span>
			</button>

			<button
				type="button"
				class="ui-button ui-button-secondary text-xs"
				onclick={() => { showSettingsModal = true; }}
				title="Configura limiti operativi e modello assistente"
			>
				<IconSettings />
				<span>{t('btn_settings')}</span>
			</button>

			{#if onClose}
				<button
					type="button"
					class="ui-button ui-button-ghost icon-only-btn close-main-btn"
					onclick={onClose}
					aria-label={t('btn_close')}
				>
					<IconClose />
				</button>
			{/if}
		</div>
	</header>
	{#if automationsStore.error}
		<div class="store-error-banner" role="alert">
			<div class="error-msg-wrap">
				<IconWarning />
				<span>{automationsStore.error}</span>
			</div>
			<button
				type="button"
				class="ui-button ui-button-secondary text-xs"
				onclick={() => void automationsStore.refresh()}
			>
				Riprova
			</button>
		</div>
	{/if}
	<!-- Layout A: due colonne affiancate stabili -->
	<div class="view-layout-a">
		<!-- Colonna sinistra: Elenco e Filtri -->
		<aside class="sidebar-pane">
			<!-- Selettore gruppi principali: Le tue / Titoli AI -->
			<div class="tabs-segmented">
				<button
					type="button"
					class="seg-btn"
					class:active={activeMainTab === 'personal'}
					onclick={() => { activeMainTab = 'personal'; }}
				>
					<span>{t('tab_personal')}</span>
					<span class="count-badge font-mono">{allDefinitions.length}</span>
				</button>
				<button
					type="button"
					class="seg-btn"
					class:active={activeMainTab === 'titles'}
					onclick={() => { activeMainTab = 'titles'; }}
				>
					<span>{t('tab_titles')}</span>
				</button>
			</div>

			{#if activeMainTab === 'personal'}
				<!-- Azioni di creazione -->
				<div class="creation-actions">
					<button
						type="button"
						class="ui-button ui-button-primary text-xs create-btn"
						onclick={handleNewManual}
					>
						<IconPlus />
						<span>{t('btn_new_manual')}</span>
					</button>

					<button
						type="button"
						class="ui-button ui-button-secondary text-xs create-ai-btn"
						onclick={handleNewAi}
						title="Conversa con l'assistente dedicato per generare una bozza strutturata"
					>
						<IconSparkles />
						<span>{t('btn_create_ai')}</span>
					</button>
				</div>

				<!-- Barra di ricerca -->
				<div class="search-box">
					<IconSearch />
					<input
						type="text"
						class="search-input text-xs"
						placeholder={t('search_placeholder')}
						bind:value={searchQuery}
					/>
					{#if searchQuery}
						<button
							type="button"
							class="clear-search-btn"
							onclick={() => { searchQuery = ''; }}
							aria-label="Cancella ricerca"
						>
							<IconClose />
						</button>
					{/if}
				</div>

				<!-- Filtri Progetto e Stato -->
				<div class="filters-row">
					<select
						class="filter-select text-xs"
						bind:value={projectFilter}
						onchange={() => { automationsStore.projectFilter = projectFilter; }}
					>
						<option value="">{t('filter_all_projects')}</option>
						{#each projects as proj}
							<option value={proj.path}>{proj.name || proj.path}</option>
						{/each}
					</select>

					<select class="filter-select text-xs" bind:value={statusFilter}>
						<option value="all">{t('filter_all_states')}</option>
						<option value="active">{t('filter_state_active')}</option>
						<option value="attention">{t('filter_state_needs_attention')}</option>
						<option value="disabled">{t('filter_state_disabled')}</option>
					</select>
				</div>

				<!-- Lista definizioni -->
				<div class="definitions-list">
					{#if filteredDefinitions.length === 0}
						<div class="empty-list-notice text-xs">
							<p class="empty-title font-medium">{t('empty_title')}</p>
							<p class="empty-desc">{t('empty_desc')}</p>
						</div>
					{:else}
						{#each filteredDefinitions as def (def.id)}
							{@const needsAttention = hasAttention(def.id)}
							{@const nextRun = nextRuns[def.id]}
							<button
								type="button"
								class="def-list-item"
								class:selected={selectedId === def.id}
								class:has-attention={needsAttention}
								onclick={() => { selectedId = def.id; selectedRunId = null; automationsStore.selectedId = def.id; automationsStore.selectedRunId = null; }}
							>
								<div class="item-top">
									<span class="item-state-dot state-{def.state}"></span>
									<span class="item-name font-medium">{def.name || 'Automazione senza nome'}</span>
									{#if needsAttention}
										<span class="attention-badge" title="Richiede attenzione o presa visione">
											<IconWarning />
										</span>
									{/if}
								</div>

								<div class="item-sub text-xs">
									<span class="action-kind-label">
										{#if def.action.kind === 'prompt'}
											Prompt AI
										{:else}
											Comando ({def.action.mode})
										{/if}
									</span>
									<span class="bullet">·</span>
									<span class="targets-summary font-mono">
										{def.targets.source === 'studio' ? 'Studio' : def.targets.projectPaths?.length ? `${def.targets.projectPaths.length} proj` : 'Tutti'}
									</span>
								</div>

								{#if nextRun}
									<div class="item-next-run text-xs font-mono">
										<IconSchedule />
										<span>{formatDateTime(nextRun)}</span>
									</div>
								{/if}
							</button>
						{/each}
					{/if}
				</div>
			{:else}
				<!-- Sidebar Titoli AI: riepilogo rapido -->
				<div class="titles-sidebar-summary">
					<div class="summary-card text-xs">
						<span class="font-semibold">Titoli automatici</span>
						<p class="text-muted" style="margin: 4px 0 0;">
							I titoli per i task salvati e per le sessioni completate vengono generati in background senza bloccare l'interfaccia.
						</p>
					</div>
				</div>
			{/if}
		</aside>

		<!-- Colonna destra: Dettaglio / Contenuto principale -->
		<main class="content-pane">
			{#if activeMainTab === 'titles'}
				<AutomationTitlesView />
			{:else if selectedDefinition}
				<AutomationDetail
					definition={selectedDefinition}
					{selectedRunId}
					onSelectRun={(runId) => { selectedRunId = runId; automationsStore.selectedRunId = runId; }}
					{onOpenSession}
				/>
			{:else}
				<!-- Stato vuoto selezione -->
				<div class="empty-selection-view">
					<IconAutomation size={48} class="empty-icon" />
					<h3 class="empty-heading">Seleziona o crea un'automazione</h3>
					<p class="empty-paragraph text-xs">
						Automatizza comandi ripetitivi sui progetti o richiedi a un agente AI di eseguire task complessi a scadenze prefissate o su eventi Git e file.
					</p>
					<div class="empty-actions">
						<button
							type="button"
							class="ui-button ui-button-primary text-xs"
							onclick={handleNewManual}
						>
							<IconPlus />
							<span>{t('btn_new_manual')}</span>
						</button>
						<button
							type="button"
							class="ui-button ui-button-secondary text-xs"
							onclick={handleNewAi}
						>
							<IconSparkles />
							<span>{t('btn_create_ai')}</span>
						</button>
					</div>
				</div>
			{/if}
		</main>
	</div>

	<!-- Modali ed Editor Wizard -->
	{#if automationsStore.editingDraft}
		<AutomationWizard
			draft={automationsStore.editingDraft}
			startWithAi={wizardStartWithAi}
			onclose={() => { automationsStore.editingDraft = null; }}
		/>
	{/if}

	{#if showSettingsModal}
		<AutomationSettingsModal
			open={showSettingsModal}
			onClose={() => { showSettingsModal = false; }}
		/>
	{/if}

	{#if showIoModal}
		<AutomationImportExportModal
			open={showIoModal}
			onClose={() => { showIoModal = false; }}
		/>
	{/if}
</div>

<style>
	.automations-view {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: 1024px;
		min-height: 640px;
		background: var(--bg-base);
		color: var(--ink);
		box-sizing: border-box;
		overflow: hidden;
	}

	.view-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 20px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.store-error-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		background: color-mix(in srgb, var(--danger) 15%, transparent);
		color: var(--danger);
		border-bottom: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		font-size: 12px;
	}

	.error-msg-wrap {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.header-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.header-brand-icon {
		color: var(--brand-ink);
	}

	.title-wrap {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.title-line {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.view-title {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
		color: var(--ink);
	}

	.project-filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--brand) 16%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.clear-chip-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		padding: 0;
		margin-left: 2px;
	}

	.view-subtitle {
		margin: 0;
		color: var(--ink-muted);
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.view-layout-a {
		display: flex;
		flex: 1;
		height: calc(100% - 61px);
		overflow: hidden;
	}

	.sidebar-pane {
		width: 320px;
		min-width: 280px;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border-right: 1px solid var(--line);
		padding: 14px;
		gap: 10px;
		overflow-y: auto;
		flex-shrink: 0;
	}

	.tabs-segmented {
		display: flex;
		padding: 3px;
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
	}

	.seg-btn {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		background: transparent;
		border: none;
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-muted);
		cursor: pointer;
		transition: all var(--dur-fast, 120ms) ease;
	}

	.seg-btn:hover {
		color: var(--ink);
	}

	.seg-btn.active {
		background: var(--bg-base);
		color: var(--ink);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
	}

	.count-badge {
		font-size: 10px;
		padding: 1px 5px;
		border-radius: var(--radius-full);
		background: var(--bg-sunken);
	}

	.creation-actions {
		display: flex;
		gap: 8px;
	}

	.create-btn,
	.create-ai-btn {
		flex: 1;
		justify-content: center;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		background: var(--bg-sunken);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--ink);
	}

	.clear-search-btn {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		padding: 0;
	}

	.filters-row {
		display: flex;
		gap: 8px;
	}

	.filter-select {
		flex: 1;
		padding: 5px 8px;
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		color: var(--ink);
		outline: none;
	}

	.definitions-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		overflow-y: auto;
		flex: 1;
	}

	.empty-list-notice {
		padding: 24px 12px;
		text-align: center;
		color: var(--ink-muted);
	}

	.empty-title {
		margin: 0 0 4px;
		color: var(--ink);
	}

	.empty-desc {
		margin: 0;
		line-height: 1.4;
	}

	.def-list-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: var(--bg-base);
		border: 1px solid var(--line);
		text-align: left;
		cursor: pointer;
		transition: all var(--dur-fast, 120ms) ease;
	}

	.def-list-item:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.def-list-item.selected {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-base));
	}

	.def-list-item.has-attention {
		border-left: 3px solid var(--warn);
	}

	.item-top {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.item-state-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.item-state-dot.state-enabled { background: var(--success); }
	.item-state-dot.state-disabled { background: var(--ink-faint); }
	.item-state-dot.state-suspended { background: var(--warn); }
	.item-state-dot.state-draft { background: var(--brand-ink); }
	.item-state-dot.state-archived { background: var(--ink-faint); }

	.item-name {
		font-size: 13px;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.attention-badge {
		color: var(--warn);
		display: inline-flex;
	}

	.item-sub {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-muted);
	}

	.action-kind-label {
		color: var(--ink-muted);
	}

	.targets-summary {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-next-run {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--ink-faint);
		font-size: 11px;
	}

	.bullet {
		opacity: 0.5;
	}

	.titles-sidebar-summary {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.summary-card {
		padding: 12px;
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		line-height: 1.4;
	}

	.content-pane {
		flex: 1;
		height: 100%;
		overflow-y: auto;
		background: var(--bg-base);
	}

	.empty-selection-view {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 40px 20px;
		text-align: center;
	}

	.empty-icon {
		color: var(--ink-faint);
		margin-bottom: 16px;
	}

	.empty-heading {
		font-size: 18px;
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 8px;
	}

	.empty-paragraph {
		max-width: 440px;
		color: var(--ink-muted);
		margin: 0 0 20px;
		line-height: 1.5;
	}

	.empty-actions {
		display: flex;
		gap: 10px;
	}
</style>
