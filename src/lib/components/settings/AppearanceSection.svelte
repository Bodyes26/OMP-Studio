<script lang="ts">
	import { themeStore } from '$lib/stores/theme.svelte';
	import { THEME_GROUPS, THEMES, swatchesFor, type ThemeMode } from '$lib/theme';
	import { IconCheck } from '$lib/icons';

	let filterQuery = $state('');

	const activeGroup = $derived(
		THEME_GROUPS.find((group) => group.mode === themeStore.pickerMode) ?? THEME_GROUPS[0]
	);

	const filteredThemes = $derived(
		activeGroup.names
			.filter((name) => name.toLowerCase().includes(filterQuery.trim().toLowerCase()))
			.map((name) => ({
				name,
				...swatchesFor(THEMES[name])
			}))
	);

	function setPickerMode(mode: ThemeMode) {
		void themeStore.setPickerMode(mode);
	}

	function selectTheme(name: string) {
		void themeStore.select(name);
	}
</script>

<div class="settings-section">
	<div class="section-header">
		<div class="header-titles">
			<h4>Aspetto e Tema</h4>
			<span class="header-subtitle">
				Tema attuale: <strong class="current-theme-name">{themeStore.current}</strong>
			</span>
		</div>
	</div>

	<div class="theme-info-box">
		<div class="info-icon">
			<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3">
				<circle cx="8" cy="8" r="6.5" />
				<line x1="8" y1="5" x2="8" y2="8.5" stroke-linecap="round" />
				<circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
			</svg>
		</div>
		<div class="info-text">
			{#if themeStore.bridged}
				Il tema selezionato viene applicato all'interfaccia di Studio e sincronizzato con le sessioni <code>omp</code> (in <code>~/.omp/agent/themes/omp-studio.json</code>).
			{:else}
				Alla selezione del tema, la combinazione cromatica viene applicata a Studio e propagata a <code>omp</code> per le nuove sessioni.
			{/if}
		</div>
	</div>

	<div class="theme-toolbar">
		<div class="mode-tabs" role="tablist" aria-label="Filtro modalità tema">
			{#each THEME_GROUPS as group (group.mode)}
				<button
					type="button"
					role="tab"
					class="mode-tab-btn"
					class:active={themeStore.pickerMode === group.mode}
					aria-selected={themeStore.pickerMode === group.mode}
					onclick={() => setPickerMode(group.mode)}
				>
					<span>{group.label}</span>
					<span class="tab-count">{group.names.length}</span>
				</button>
			{/each}
		</div>

		<div class="filter-wrapper">
			<svg class="search-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3">
				<circle cx="6.5" cy="6.5" r="4.5" />
				<path d="M10 10l3.5 3.5" stroke-linecap="round" />
			</svg>
			<input
				type="text"
				class="filter-input"
				placeholder="Cerca tra i {activeGroup.names.length} temi..."
				bind:value={filterQuery}
				aria-label="Cerca e filtra temi"
			/>
			{#if filterQuery}
				<button
					type="button"
					class="clear-filter-btn"
					onclick={() => (filterQuery = '')}
					aria-label="Cancella filtro"
					title="Cancella filtro"
				>
					&times;
				</button>
			{/if}
		</div>
	</div>

	<div class="theme-grid" role="listbox" aria-label="Galleria temi">
		{#each filteredThemes as theme (theme.name)}
			{@const isSelected = theme.name === themeStore.current}
			<button
				type="button"
				class="theme-card"
				class:selected={isSelected}
				role="option"
				aria-selected={isSelected}
				onclick={() => selectTheme(theme.name)}
			>
				<div class="card-preview" style="background-color: {theme.bg};">
					<div class="preview-mockup">
						<div class="mockup-header">
							<span class="mockup-dot" style="background-color: {theme.accent};"></span>
							<span class="mockup-line accent-line" style="background-color: {theme.accent};"></span>
						</div>
						<div class="mockup-body">
							<span class="mockup-line text-line" style="background-color: {theme.text};"></span>
							<span class="mockup-line text-line-short" style="background-color: {theme.text};"></span>
						</div>
					</div>
					<div class="preview-palette">
						<span class="swatch-bg" title="Sfondo" style="background-color: {theme.bg};"></span>
						<span class="swatch-accent" title="Accento" style="background-color: {theme.accent};"></span>
						<span class="swatch-text" title="Testo" style="background-color: {theme.text};"></span>
					</div>
				</div>

				<div class="card-meta">
					<span class="theme-name" title={theme.name}>{theme.name}</span>
					{#if isSelected}
						<span class="active-badge">
							<IconCheck />
							<span>Attivo</span>
						</span>
					{/if}
				</div>
			</button>
		{:else}
			<div class="empty-state">
				<p>Nessun tema trovato per "<strong>{filterQuery}</strong>" nella categoria {activeGroup.label.toLowerCase()}.</p>
				<button type="button" class="btn btn-secondary" onclick={() => (filterQuery = '')}>
					Azzera ricerca
				</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.header-titles {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.header-subtitle {
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.current-theme-name {
		color: var(--ink);
		font-family: var(--font-mono);
	}

	.theme-info-box {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		line-height: 1.5;
		color: var(--ink-muted);
	}

	.info-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-faint);
		margin-top: 1px;
		flex-shrink: 0;
	}

	.info-text code {
		font-family: var(--font-mono);
		color: var(--ink);
		background: var(--bg-raised);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
	}

	.theme-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.mode-tabs {
		display: inline-flex;
		align-items: center;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 2px;
		gap: 2px;
	}

	.mode-tab-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 4px 10px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease;
	}

	.mode-tab-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.mode-tab-btn.active {
		background: var(--bg-raised);
		color: var(--ink);
		font-weight: 600;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
	}

	.tab-count {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		background: var(--bg-sunken);
		padding: 0 5px;
		border-radius: var(--radius-full);
	}

	.mode-tab-btn.active .tab-count {
		color: var(--ink-muted);
	}

	.filter-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 220px;
	}

	.search-icon {
		position: absolute;
		left: var(--space-2);
		color: var(--ink-faint);
		pointer-events: none;
	}

	.filter-input {
		width: 100%;
		padding: 5px var(--space-4) 5px 28px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-xs);
		outline: none;
		transition: border-color 0.15s ease;
	}

	.filter-input:focus {
		border-color: var(--line-strong);
	}

	.clear-filter-btn {
		position: absolute;
		right: 4px;
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: 14px;
		padding: 0 4px;
		line-height: 1;
	}

	.clear-filter-btn:hover {
		color: var(--ink);
	}

	.theme-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: var(--space-3);
		max-height: 480px;
		overflow-y: auto;
		padding-right: var(--space-1);
	}

	.theme-card {
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2);
		gap: var(--space-2);
		text-align: left;
		cursor: pointer;
		transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
	}

	.theme-card:hover {
		border-color: var(--line-strong);
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.theme-card.selected {
		border-color: color-mix(in srgb, oklch(0.75 var(--brand-c) var(--brand-h)) 60%, var(--line-strong));
		background: color-mix(in srgb, oklch(0.7 var(--brand-c) var(--brand-h)) 6%, var(--bg-raised));
		box-shadow: 0 0 0 1px color-mix(in srgb, oklch(0.75 var(--brand-c) var(--brand-h)) 40%, transparent);
	}

	.card-preview {
		height: 64px;
		border-radius: var(--radius-sm);
		border: 1px solid rgba(128, 128, 128, 0.2);
		padding: 8px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		position: relative;
		overflow: hidden;
	}

	.preview-mockup {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.mockup-header {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.mockup-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.mockup-line {
		height: 3px;
		border-radius: var(--radius-full);
		display: block;
	}

	.accent-line {
		width: 32px;
		opacity: 0.9;
	}

	.mockup-body {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding-left: 2px;
	}

	.text-line {
		width: 65%;
		opacity: 0.6;
	}

	.text-line-short {
		width: 40%;
		opacity: 0.4;
	}

	.preview-palette {
		position: absolute;
		right: 6px;
		bottom: 6px;
		display: flex;
		align-items: center;
		gap: 3px;
		background: rgba(0, 0, 0, 0.35);
		padding: 2px 4px;
		border-radius: var(--radius-full);
		backdrop-filter: blur(4px);
	}

	.preview-palette span {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		border: 1px solid rgba(255, 255, 255, 0.15);
	}

	.card-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 20px;
	}

	.theme-name {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.theme-card.selected .theme-name {
		font-weight: 600;
	}

	.active-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 10px;
		font-weight: 600;
		color: oklch(0.8 var(--brand-c) var(--brand-h));
		background: color-mix(in srgb, oklch(0.7 var(--brand-c) var(--brand-h)) 15%, transparent);
		padding: 1px 6px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.active-badge :global(svg) {
		width: 10px;
		height: 10px;
	}

	.empty-state {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-6) var(--space-4);
		color: var(--ink-muted);
		font-size: var(--text-sm);
		text-align: center;
	}

	.empty-state p {
		margin: 0;
	}
</style>
