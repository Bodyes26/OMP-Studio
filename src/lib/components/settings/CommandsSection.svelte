<!--
  CommandsSection.svelte — Voce Impostazioni > Comandi:
  1. Editor di layout con anteprima del composer (toolbar e statusLine), drag & drop,
     tastiera accessibile e ripristino di fabbrica.
  2. Catalogo comandi raggruppato per categorie, con ricerca, sezione "Nuovi" da omp runtime,
     pannello dettaglio con spiegazione, vantaggi, esempi e switch/selettore per fissare nel composer.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { sessionRegistry } from '$lib/agent/sessionRegistry';
	import type { AgentSession } from '$lib/agent/session.svelte';
	import type { AvailableCommand } from '$lib/agent/wire';
	import { COMMAND_MANIFEST } from '$lib/agent/commandCatalog/manifest';
	import type {
		CommandCategory,
		CommandManifestEntry,
		CommandPlacement,
		ComposerLayout
	} from '$lib/agent/commandCatalog/types';
	import {
		resolveLayout,
		pin,
		unpin,
		movePin,
		mergeWithOrphans,
		itemsInZone
	} from '$lib/agent/commandCatalog/layout';
	import { resolveCommandText, matchesCommandSearch } from '$lib/agent/commandCatalog/text';
	import ComposerPreview from './commands/ComposerPreview.svelte';
	import CommandDetail from './commands/CommandDetail.svelte';
	import CommandIcon from './commands/CommandIcon.svelte';
	import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconSearch,
		IconClose,
		IconLock,
		IconPin,
		IconSparkles
	} from '$lib/icons';

	// Stato ricerca e selezione
	let searchQuery = $state('');
	let selectedCommandId = $state<string | null>(null);
	let selectedNewCommand = $state<AvailableCommand | null>(null);
	let showResetConfirm = $state(false);

	// Layout risolto reattivo
	const resolvedLayout = $derived(
		resolveLayout(settingsStore.composerLayout, COMMAND_MANIFEST)
	);

	// Set di id fissati per evidenziazione rapida nell'elenco
	const pinnedIds = $derived(
		new Set(resolvedLayout.pinned.map((p) => p.id))
	);

	// Sessione attiva per comandi runtime nuovi
	const activeSession = $derived.by(() => {
		const project = projectStore.activeProject;
		if (project) {
			const s = sessionRegistry.getLaneSession(project.id, project.lane.laneId);
			if (s) return s as AgentSession;
		}
		const all = sessionRegistry.getAllSessions();
		const withCommands = all.find((s) => (s as AgentSession).availableCommands?.length > 0);
		return (withCommands ?? all[0] ?? null) as AgentSession | null;
	});

	// Comandi builtin esposti dal runtime omp ma assenti dal manifesto
	const uncataloguedBuiltinCommands = $derived.by(() => {
		if (!activeSession || !activeSession.availableCommands) return [];
		const manifestIds = new Set(COMMAND_MANIFEST.map((e) => e.id));
		return activeSession.availableCommands.filter((cmd) => {
			const isBuiltin = cmd.source === 'builtin';
			return isBuiltin && !manifestIds.has(cmd.name);
		});
	});

	// Filtraggio dei comandi nuovi tramite la barra di ricerca
	const filteredNewCommands = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return uncataloguedBuiltinCommands;
		return uncataloguedBuiltinCommands.filter(
			(cmd) =>
				cmd.name.toLowerCase().includes(q) ||
				`/${cmd.name}`.toLowerCase().includes(q) ||
				(cmd.description && cmd.description.toLowerCase().includes(q))
		);
	});

	// Ordine fisso delle categorie
	const CATEGORY_ORDER: readonly CommandCategory[] = [
		'modes',
		'models',
		'context',
		'session',
		'workspace',
		'tools',
		'extensions',
		'info',
		'security',
		'app'
	];

	function categoryTitle(category: CommandCategory): string {
		switch (category) {
			case 'modes':
				return m.settings_commands_cat_modes();
			case 'models':
				return m.settings_commands_cat_models();
			case 'context':
				return m.settings_commands_cat_context();
			case 'session':
				return m.settings_commands_cat_session();
			case 'workspace':
				return m.settings_commands_cat_workspace();
			case 'tools':
				return m.settings_commands_cat_tools();
			case 'extensions':
				return m.settings_commands_cat_extensions();
			case 'info':
				return m.settings_commands_cat_info();
			case 'security':
				return m.settings_commands_cat_security();
			case 'app':
				return m.settings_commands_cat_app();
			default:
				return category;
		}
	}

	// Raggruppamento e filtraggio delle voci per categoria
	const groupedEntries = $derived.by(() => {
		const q = searchQuery.trim();
		const result: { category: CommandCategory; title: string; entries: CommandManifestEntry[] }[] = [];

		for (const cat of CATEGORY_ORDER) {
			const matching = COMMAND_MANIFEST.filter((entry) => {
				if (entry.category !== cat) return false;
				if (!q) return true;
				return matchesCommandSearch(entry, q);
			});

			if (matching.length > 0) {
				result.push({
					category: cat,
					title: categoryTitle(cat),
					entries: matching
				});
			}
		}

		return result;
	});

	const totalMatchingEntries = $derived(
		groupedEntries.reduce((acc, g) => acc + g.entries.length, 0) + filteredNewCommands.length
	);

	// Seleziona la prima voce se nulla e' selezionato
	$effect(() => {
		if (selectedCommandId === null && selectedNewCommand === null) {
			if (groupedEntries.length > 0 && groupedEntries[0].entries.length > 0) {
				selectedCommandId = groupedEntries[0].entries[0].id;
			}
		}
	});

	const selectedEntry = $derived(
		selectedCommandId ? COMMAND_MANIFEST.find((e) => e.id === selectedCommandId) ?? null : null
	);

	function selectEntry(id: string) {
		selectedCommandId = id;
		selectedNewCommand = null;
	}

	function selectNewCommand(cmd: AvailableCommand) {
		selectedNewCommand = cmd;
		selectedCommandId = null;
	}

	// Azioni layout con conservazione degli orfani
	function handleLayoutChange(newLayout: ComposerLayout) {
		const merged = mergeWithOrphans(newLayout, settingsStore.composerLayout, COMMAND_MANIFEST);
		settingsStore.setComposerLayout(merged);
	}

	function handleTogglePin(id: string, pinAction: boolean) {
		if (pinAction) {
			const newLayout = pin(resolvedLayout, COMMAND_MANIFEST, id);
			handleLayoutChange(newLayout);
		} else {
			const newLayout = unpin(resolvedLayout, COMMAND_MANIFEST, id);
			handleLayoutChange(newLayout);
		}
	}

	function handleChangePlacement(id: string, placement: CommandPlacement) {
		const currentPin = resolvedLayout.pinned.find((p) => p.id === id);
		if (currentPin && currentPin.zone === placement.zone) {
			const zoneItems = itemsInZone(resolvedLayout, placement.zone);
			const idx = zoneItems.findIndex((p) => p.id === id);
			const newLayout = movePin(resolvedLayout, COMMAND_MANIFEST, id, placement, idx >= 0 ? idx : 0);
			handleLayoutChange(newLayout);
		} else {
			const newLayout = pin(resolvedLayout, COMMAND_MANIFEST, id, placement);
			handleLayoutChange(newLayout);
		}
	}

	function handleConfirmReset() {
		settingsStore.setComposerLayout(null);
		showResetConfirm = false;
	}
</script>

<div class="commands-section">
	<!-- Intestazione della sezione -->
	<div class="section-top-header">
		<h3 class="section-headline">{m.settings_commands_title()}</h3>
		<p class="section-lead">{m.settings_commands_desc()}</p>
	</div>

	<!-- Editor layout: Anteprima del composer -->
	<ComposerPreview
		layout={resolvedLayout}
		manifest={COMMAND_MANIFEST}
		selectedId={selectedCommandId}
		onSelect={selectEntry}
		onLayoutChange={handleLayoutChange}
		onResetRequest={() => (showResetConfirm = true)}
	/>

	<!-- Dialogo di conferma ripristino fabbrica -->
	<ConfirmDialog
		open={showResetConfirm}
		title={m.settings_commands_reset_confirm_title()}
		message={m.settings_commands_reset_confirm_desc()}
		confirmLabel={m.settings_commands_reset_confirm_action()}
		tone="danger"
		onConfirm={handleConfirmReset}
		onCancel={() => (showResetConfirm = false)}
	/>

	<!-- Catalogo comandi: Master / Detail -->
	<div class="catalog-layout">
		<!-- Colonna sinistra: Ricerca ed Elenco categorie -->
		<div class="catalog-master">
			<!-- Barra di ricerca -->
			<div class="search-bar">
				<span class="search-icon" aria-hidden="true">
					<IconSearch />
				</span>
				<input
					type="text"
					class="search-input"
					bind:value={searchQuery}
					placeholder={m.settings_commands_search_placeholder()}
					aria-label={m.settings_commands_search_placeholder()}
				/>
				{#if searchQuery}
					<button
						type="button"
						class="btn-clear-search"
						aria-label={m.file_tree_clear_search()}
						onclick={() => (searchQuery = '')}
					>
						<IconClose />
					</button>
				{/if}
			</div>

			<!-- Elenco comandi raggruppato -->
			<div class="catalog-scroll-list" role="list">
				{#if totalMatchingEntries === 0}
					<div class="empty-search-state">
						<IconSearch />
						<p class="empty-title">{m.settings_commands_search_empty()}</p>
						<p class="empty-hint">{m.settings_commands_search_empty_hint()}</p>
					</div>
				{:else}
					<!-- Sezione Nuovi da omp (se presenti a runtime) -->
					{#if filteredNewCommands.length > 0}
						<div class="category-block">
							<div class="category-header category-new-header">
								<span class="category-title">
									<IconSparkles />
									<span>{m.settings_commands_section_new()}</span>
								</span>
								<span class="category-count">{filteredNewCommands.length}</span>
							</div>
							<div class="category-items">
								{#each filteredNewCommands as cmd (cmd.name)}
									{@const isSelected = selectedNewCommand?.name === cmd.name}
									<button
										type="button"
										class="command-item-btn"
										class:selected={isSelected}
										aria-current={isSelected ? 'true' : undefined}
										onclick={() => selectNewCommand(cmd)}
									>
										<span class="item-icon-box">
											<IconSparkles />
										</span>
										<div class="item-text-box">
											<span class="item-name">{cmd.name}</span>
											<span class="item-slash">/{cmd.name}</span>
										</div>
										<span class="badge-new-pill">new</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Categorie curate dal manifesto -->
					{#each groupedEntries as group (group.category)}
						<div class="category-block">
							<div class="category-header">
								<span class="category-title">{group.title}</span>
								<span class="category-count">{group.entries.length}</span>
							</div>

							<div class="category-items">
								{#each group.entries as entry (entry.id)}
									{@const text = resolveCommandText(entry)}
									{@const isSelected = selectedCommandId === entry.id}
									{@const isPinned = pinnedIds.has(entry.id)}
									{@const isLocked = entry.locked ?? false}

									<button
										type="button"
										class="command-item-btn"
										class:selected={isSelected}
										aria-current={isSelected ? 'true' : undefined}
										onclick={() => selectEntry(entry.id)}
									>
										<span class="item-icon-box">
											<CommandIcon icon={entry.icon} />
										</span>
										<div class="item-text-box">
											<span class="item-name">{text.title}</span>
											{#if entry.origin !== 'control'}
												<span class="item-slash">/{entry.id}</span>
											{:else}
												<span class="item-slash control-tag">{entry.id}</span>
											{/if}
										</div>

										<div class="item-trailing-badges">
											{#if isLocked}
												<Tooltip text={m.settings_commands_locked_badge()}>
													<span class="badge-icon locked" aria-label={m.settings_commands_locked_badge()}>
														<IconLock />
													</span>
												</Tooltip>
											{:else if isPinned}
												<Tooltip text={m.settings_commands_pin_switch()}>
													<span class="badge-icon pinned" aria-label={m.settings_commands_pin_switch()}>
														<IconPin />
													</span>
												</Tooltip>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Colonna destra: Pannello Dettaglio -->
		<div class="catalog-detail">
			<CommandDetail
				entry={selectedEntry}
				newCommand={selectedNewCommand}
				layout={resolvedLayout}
				onTogglePin={handleTogglePin}
				onChangePlacement={handleChangePlacement}
			/>
		</div>
	</div>
</div>

<style>
	.commands-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--bg-base);
	}

	.section-top-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.section-headline {
		margin: 0;
		font-size: var(--text-title);
		font-weight: 600;
		color: var(--ink);
	}

	.section-lead {
		margin: 0;
		font-size: var(--text-body);
		color: var(--ink-muted);
		max-width: 680px;
		line-height: 1.45;
	}

	.catalog-layout {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: var(--space-4);
		align-items: start;
	}

	.catalog-master {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		max-height: 640px;
	}

	.search-bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
		background: var(--bg-sunken);
	}

	.search-icon {
		display: inline-flex;
		color: var(--ink-faint);
		font-size: 13px;
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		color: var(--ink);
		font-size: var(--text-caption);
		outline: none;
		padding: 2px 0;
	}

	.search-input::placeholder {
		color: var(--ink-faint);
	}

	.btn-clear-search {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 2px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
	}

	.btn-clear-search:hover {
		color: var(--ink);
	}

	.catalog-scroll-list {
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		padding: var(--space-2);
		gap: var(--space-3);
	}

	.category-block {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.category-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-1) var(--space-2);
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.category-new-header {
		color: var(--warn);
	}

	.category-title {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.category-count {
		font-feature-settings: 'tnum';
		opacity: 0.75;
	}

	.category-items {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.command-item-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 5px var(--space-2);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		transition: background-color 0.12s ease, border-color 0.12s ease;
		width: 100%;
	}

	.command-item-btn:hover {
		background: var(--bg-hover);
	}

	.command-item-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -1px;
	}

	.command-item-btn.selected {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.item-icon-box {
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.command-item-btn.selected .item-icon-box {
		color: var(--brand-ink);
	}

	.item-text-box {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		gap: 1px;
	}

	.item-name {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-slash {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.control-tag {
		font-family: inherit;
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.item-trailing-badges {
		display: flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
	}

	.badge-icon {
		display: inline-flex;
		font-size: 11px;
		opacity: 0.8;
	}

	.badge-icon.locked {
		color: var(--ink-faint);
	}

	.badge-icon.pinned {
		color: var(--brand-ink);
	}

	.badge-new-pill {
		font-size: 10px;
		text-transform: uppercase;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, var(--warn) 18%, transparent);
		color: var(--warn);
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.empty-search-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-5) var(--space-3);
		text-align: center;
		color: var(--ink-muted);
		gap: var(--space-1);
	}

	.empty-title {
		margin: var(--space-2) 0 0;
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink);
	}

	.empty-hint {
		margin: 0;
		font-size: 11.5px;
		color: var(--ink-faint);
		line-height: 1.4;
	}

	.catalog-detail {
		min-width: 0;
	}

	@media (max-width: 760px) {
		.catalog-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
