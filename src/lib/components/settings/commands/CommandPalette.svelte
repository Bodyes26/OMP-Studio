<!--
  CommandPalette.svelte — Elenco dei comandi disponibili non ancora fissati nel composer.
  Organizzato per categorie, con ricerca, pulsante rapido di fissaggio e supporto al
  trascinamento verso il composer finto (pointer events drag).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { CommandCategory, CommandManifestEntry } from '$lib/agent/commandCatalog/types';
	import type { AvailableCommand } from '$lib/agent/wire';
	import { resolveCommandText, matchesCommandSearch } from '$lib/agent/commandCatalog/text';
	import CommandIcon from './CommandIcon.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconSearch,
		IconClose,
		IconPlus,
		IconGrip,
		IconSparkles
	} from '$lib/icons';

	let {
		manifest,
		pinnedIds,
		searchQuery = $bindable(''),
		selectedId,
		newCommands = [],
		selectedNewCommand,
		onSelect,
		onSelectNew,
		onQuickPin,
		onStartDrag
	}: {
		manifest: readonly CommandManifestEntry[];
		pinnedIds: Set<string>;
		searchQuery: string;
		selectedId: string | null;
		newCommands?: AvailableCommand[];
		selectedNewCommand?: AvailableCommand | null;
		onSelect: (id: string) => void;
		onSelectNew: (cmd: AvailableCommand) => void;
		onQuickPin: (entry: CommandManifestEntry) => void;
		onStartDrag: (entry: CommandManifestEntry, clientX: number, clientY: number) => void;
	} = $props();

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

	// Comandi disponibili = non presenti nei pin attivi
	const availableEntries = $derived(
		manifest.filter((entry) => !pinnedIds.has(entry.id))
	);

	const groupedAvailable = $derived.by(() => {
		const q = searchQuery.trim();
		const result: { category: CommandCategory; title: string; entries: CommandManifestEntry[] }[] = [];

		for (const cat of CATEGORY_ORDER) {
			const matching = availableEntries.filter((entry) => {
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

	const filteredNew = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return newCommands;
		return newCommands.filter(
			(cmd) =>
				cmd.name.toLowerCase().includes(q) ||
				`/${cmd.name}`.toLowerCase().includes(q) ||
				(cmd.description && cmd.description.toLowerCase().includes(q))
		);
	});

	const totalMatching = $derived(
		groupedAvailable.reduce((acc, g) => acc + g.entries.length, 0) + filteredNew.length
	);

	function handlePointerDown(e: PointerEvent, entry: CommandManifestEntry) {
		if (e.button !== 0) return;
		if (entry.supported.length === 0) return;
		// Se il clic cade sul bottone rapido di aggiunta, non avviamo il drag
		const target = e.target as HTMLElement | null;
		if (target?.closest('.quick-pin-btn')) return;

		onStartDrag(entry, e.clientX, e.clientY);
	}
</script>

<div class="palette-container">
	<div class="palette-header">
		<div class="header-titles">
			<h4 class="palette-title">{m.settings_commands_palette_title()}</h4>
			<p class="palette-desc">{m.settings_commands_palette_desc()}</p>
		</div>

		<!-- Barra di ricerca -->
		<div class="search-bar">
			<span class="search-icon" aria-hidden="true"><IconSearch /></span>
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
	</div>

	<div class="palette-scroll" role="list">
		{#if totalMatching === 0}
			<div class="empty-state">
				<IconSearch />
				<p class="empty-title">{m.settings_commands_search_empty()}</p>
				<p class="empty-hint">{m.settings_commands_search_empty_hint()}</p>
			</div>
		{:else}
			{#if filteredNew.length > 0}
				<div class="category-block">
					<div class="category-header new-header">
						<span class="cat-title">
							<IconSparkles />
							<span>{m.settings_commands_section_new()}</span>
						</span>
						<span class="cat-count">{filteredNew.length}</span>
					</div>
					<div class="chips-grid">
						{#each filteredNew as cmd (cmd.name)}
							{@const isSelected = selectedNewCommand?.name === cmd.name}
							<button
								type="button"
								class="palette-chip new-chip"
								class:selected={isSelected}
								onclick={() => onSelectNew(cmd)}
							>
								<IconSparkles />
								<span class="chip-name font-mono">/{cmd.name}</span>
								<span class="badge-new">new</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#each groupedAvailable as group (group.category)}
				<div class="category-block">
					<div class="category-header">
						<span class="cat-title">{group.title}</span>
						<span class="cat-count">{group.entries.length}</span>
					</div>

					<div class="chips-grid">
						{#each group.entries as entry (entry.id)}
							{@const text = resolveCommandText(entry)}
							{@const isSelected = selectedId === entry.id}
							{@const pinnable = entry.supported.length > 0}

							<div
								class="palette-chip-wrapper"
								class:selected={isSelected}
								class:not-pinnable={!pinnable}
							>
								<button
									type="button"
									class="palette-chip"
									class:selected={isSelected}
									class:pinnable={pinnable}
									onclick={() => onSelect(entry.id)}
									onpointerdown={(e) => handlePointerDown(e, entry)}
									title={pinnable ? undefined : m.settings_commands_cannot_pin()}
								>
									{#if pinnable}
										<span class="drag-grip" aria-hidden="true"><IconGrip /></span>
									{/if}
									<CommandIcon icon={entry.icon} class="chip-icon" />
									<span class="chip-title">{text.title}</span>
									{#if entry.origin !== 'control'}
										<span class="chip-slash font-mono">/{entry.id}</span>
									{/if}
								</button>

								{#if pinnable}
									<Tooltip text={m.settings_commands_quick_pin()}>
										<button
											type="button"
											class="quick-pin-btn"
											aria-label={m.settings_commands_quick_pin()}
											onclick={(e) => {
												e.stopPropagation();
												onQuickPin(entry);
											}}
										>
											<IconPlus />
										</button>
									</Tooltip>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.palette-container {
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		overflow: hidden;
		min-width: 0;
	}

	.palette-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
		background: var(--bg-sunken);
	}

	.palette-title {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.palette-desc {
		margin: 2px 0 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.search-bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 4px var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
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
		font-size: var(--text-xs);
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

	.palette-scroll {
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		max-height: 520px;
	}

	.category-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.category-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 4px;
	}

	.new-header {
		color: var(--warn);
	}

	.cat-title {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.cat-count {
		font-feature-settings: 'tnum';
		opacity: 0.7;
	}

	.chips-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.palette-chip-wrapper {
		display: inline-flex;
		align-items: center;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		transition:
			border-color var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}

	.palette-chip-wrapper:hover {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.palette-chip-wrapper.selected {
		border-color: var(--brand);
		background: var(--bg-active);
	}

	.palette-chip-wrapper.not-pinnable {
		opacity: 0.65;
	}

	.palette-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		background: transparent;
		border: none;
		color: var(--ink);
		font-size: var(--text-xs);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
	}

	.palette-chip.pinnable {
		cursor: grab;
	}

	.palette-chip:active.pinnable {
		cursor: grabbing;
	}

	.drag-grip {
		display: inline-flex;
		color: var(--ink-faint);
		opacity: 0.6;
		margin-left: -2px;
	}

	.chip-title {
		font-weight: 500;
	}

	.chip-slash {
		color: var(--ink-faint);
		font-size: 11px;
	}

	.quick-pin-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		margin-right: 3px;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.quick-pin-btn:hover {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand-ink);
	}

	.new-chip {
		padding: 4px 10px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.badge-new {
		font-size: 9.5px;
		text-transform: uppercase;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, var(--warn) 18%, transparent);
		color: var(--warn);
		font-weight: 600;
	}

	.empty-state {
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
	}
</style>
