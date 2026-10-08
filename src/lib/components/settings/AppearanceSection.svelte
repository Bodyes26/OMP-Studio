<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import {
		settingsStore,
		type LayoutMode,
		type QueueViewVariant,
	} from '$lib/stores/settings.svelte';
	import { activeQuotaStore } from '$lib/stores/activeQuota.svelte';
	import { THEME_GROUPS, THEMES, swatchesFor, anchorsFor, type ThemeMode } from '$lib/theme';
	import { IconCheck, IconSparkles, IconSearch, IconClose } from '$lib/icons';
	import Switch from '$lib/ui/Switch.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import QuotaChip from '../quota/QuotaChip.svelte';
	import QuotaLimitRow from '../quota/QuotaLimitRow.svelte';
	import IconInspectorModal from './IconInspectorModal.svelte';
	let filterQuery = $state('');
	let isIconInspectorOpen = $state(false);

	const activeGroup = $derived(
		THEME_GROUPS.find((group) => group.mode === themeStore.pickerMode) ?? THEME_GROUPS[0]
	);
	const modeOptions = $derived(
		THEME_GROUPS.map((group) => ({
			value: group.mode,
			label: group.label,
			count: group.names.length
		}))
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

	function setLayoutMode(mode: LayoutMode) {
		settingsStore.patchGeneral({ layoutMode: mode });
	}

	function setQueueView(variant: QueueViewVariant) {
		settingsStore.patchQueueView(variant);
	}


	function toggleAlwaysShowPct(checked: boolean) {
		settingsStore.patchQuotaChip({ alwaysShowPct: checked });
	}

	function toggleShowProvider(checked: boolean) {
		settingsStore.patchQuotaChip({ showProvider: checked });
	}

	function toggleSemanticColors(checked: boolean) {
		settingsStore.patchQuotaChip({ semanticColors: checked });
	}


	function togglePopoverSemanticColors(checked: boolean) {
		settingsStore.patchQuotaPopover({ semanticColors: checked });
	}

	// Dati simulati per l'anteprima realistica del popover quote
	interface PreviewLimit {
		label: string;
		remainingPercent: number;
		tone: 'ok' | 'warn' | 'bad';
		resetCountdown: string;
	}

	const PREVIEW_LIMITS: PreviewLimit[] = [
		{
			label: 'Claude 5 Hour',
			remainingPercent: 78,
			tone: 'ok',
			resetCountdown: m.quota_reset_in_hours({ hours: 3, min: 21 })
		},
		{
			label: 'Claude 7 Day',
			remainingPercent: 8,
			tone: 'bad',
			resetCountdown: m.quota_reset_in_days({ days: 4, hours: 2 })
		}
	];

	// Sincronizza la scheda del tema con la modalità attiva (scuro/chiaro) all'apertura
	onMount(() => {
		const curTheme = THEMES[themeStore.current];
		if (curTheme) {
			const isLight = anchorsFor(curTheme).isLight;
			const targetMode: ThemeMode = isLight ? 'light' : 'dark';
			if (themeStore.pickerMode !== targetMode) {
				void themeStore.setPickerMode(targetMode);
			}
		}
	});
</script>

<div class="settings-section">
	<!-- BLOCCO: DISPOSIZIONE FINESTRA -->
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>{m.settings_appearance_layout_title()}</h4>
				<span class="block-desc">
					{m.settings_appearance_layout_desc()}
				</span>
			</div>
		</div>

		<!-- Selettore layout (cards con preview live) -->
		<div class="layout-variant-grid" role="radiogroup" aria-label={m.settings_appearance_layout_radiogroup()}>
			<!-- Card 1: Automatico -->
			<label class="ui-choice">
				<div class="card-radio-head">
					<input
						type="radio"
						name="settings-layout-mode"
						value="auto"
						checked={settingsStore.general.layoutMode === 'auto'}
						onchange={() => setLayoutMode('auto')}
					/>
					<span class="variant-title">{m.settings_appearance_layout_auto()}</span>
				</div>
				<p class="variant-desc">
					{m.settings_appearance_layout_auto_desc()}
				</p>
				<div class="variant-preview">
					<div class="layout-mini-preview" aria-hidden="true">
						<div class="mini-col side"></div>
						<div class="mini-auto-body">
							<span>{m.settings_appearance_layout_auto_short()}</span>
						</div>
					</div>
				</div>
			</label>

			<!-- Card 2: Orizzontale -->
			<label class="ui-choice">
				<div class="card-radio-head">
					<input
						type="radio"
						name="settings-layout-mode"
						value="horizontal"
						checked={settingsStore.general.layoutMode === 'horizontal'}
						onchange={() => setLayoutMode('horizontal')}
					/>
					<span class="variant-title">{m.settings_appearance_layout_horizontal()}</span>
				</div>
				<p class="variant-desc">
					{m.ui_appearancesection_3_colonne_affiancate_albero_dei_file_git_f8d1()}
				</p>
				<div class="variant-preview">
					<div class="layout-mini-preview horizontal" aria-hidden="true">
						<div class="mini-col side"></div>
						<div class="mini-col editor"></div>
						<div class="mini-col terminal"></div>
					</div>
				</div>
			</label>

			<!-- Card 3: Verticale -->
			<label class="ui-choice">
				<div class="card-radio-head">
					<input
						type="radio"
						name="settings-layout-mode"
						value="vertical"
						checked={settingsStore.general.layoutMode === 'vertical'}
						onchange={() => setLayoutMode('vertical')}
					/>
					<span class="variant-title">{m.settings_appearance_layout_vertical()}</span>
				</div>
				<p class="variant-desc">
					{m.ui_appearancesection_vista_a_stack_albero_a_sinistra_editor_7c6e()}
				</p>
				<div class="variant-preview">
					<div class="layout-mini-preview vertical" aria-hidden="true">
						<div class="mini-col side"></div>
						<div class="mini-stack">
							<div class="mini-row editor"></div>
							<div class="mini-row terminal"></div>
						</div>
					</div>
				</div>
			</label>
		</div>
	</div>
	<!-- BLOCCO: VISTA CODA TASK -->
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>{m.settings_appearance_queue_title()}</h4>
				<span class="block-desc">
					{m.settings_appearance_queue_desc()}
				</span>
			</div>
		</div>
		<div class="layout-variant-grid queue-view-grid" role="radiogroup" aria-label={m.settings_appearance_queue_aria()}>
			<label class="ui-choice">
				<div class="card-radio-head">
					<input
						type="radio"
						name="settings-queue-view"
						value="compact"
						checked={settingsStore.appearance.queueView === 'compact'}
						onchange={() => setQueueView('compact')}
					/>
					<span class="variant-title">{m.settings_appearance_queue_compact()}</span>
				</div>
				<p class="variant-desc">
					{m.settings_appearance_queue_compact_desc()}
				</p>
				<div class="variant-preview">
					<div class="queue-mini-preview" aria-hidden="true">
						<span class="mini-queue-title"></span>
						<span class="mini-queue-excerpt"></span>
						<span class="mini-queue-chips"><i></i><i></i><i></i></span>
					</div>
				</div>
			</label>
			<label class="ui-choice">
				<div class="card-radio-head">
					<input
						type="radio"
						name="settings-queue-view"
						value="cards"
						checked={settingsStore.appearance.queueView === 'cards'}
						onchange={() => setQueueView('cards')}
					/>
					<span class="variant-title">{m.settings_appearance_queue_cards()}</span>
				</div>
				<p class="variant-desc">
					{m.settings_appearance_queue_cards_desc()}
				</p>
				<div class="variant-preview">
					<div class="queue-mini-preview card" aria-hidden="true">
						<span class="mini-queue-title"></span>
						<span class="mini-queue-excerpt"></span>
						<span class="mini-queue-excerpt short"></span>
						<span class="mini-queue-chips"><i></i><i></i></span>
					</div>
				</div>
			</label>
		</div>
	</div>

	<!-- SEPARATORE TRA BLOCCHI -->
	<div class="block-divider"></div>
	<!-- BLOCCO 1: CHIP QUOTA TOPBAR -->
	
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>{m.settings_appearance_quota_chip_title()}</h4>
				<span class="block-desc">
					{m.settings_appearance_quota_chip_desc()}
				</span>
			</div>
		</div>

		<!-- Anteprima densa chip -->
		<div class="quota-preview-card">
			<span class="quota-preview-title">{m.settings_appearance_preview()}</span>
			<div class="chip-preview-host">
				<QuotaChip
					showProvider={settingsStore.appearance.quotaChip.showProvider}
					alwaysShowPct={settingsStore.appearance.quotaChip.alwaysShowPct}
					semanticColors={settingsStore.appearance.quotaChip.semanticColors}
					status={activeQuotaStore.info.status}
					remainingPct={activeQuotaStore.info.remainingPct ?? 78}
					shortName={activeQuotaStore.info.shortName || 'Google'}
					hasLimits={true}
					interactive={false}
				/>
			</div>
		</div>

		<!-- Opzioni / Checkbox -->
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-quota-always-pct-label" class="form-row-label">{m.ui_appearancesection_mostra_sempre_la_percentuale_2958()}</span>
					<span id="settings-quota-always-pct-desc" class="form-row-desc">
						{m.settings_appearance_always_pct_desc()}
					</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-quota-always-pct"
						checked={settingsStore.appearance.quotaChip.alwaysShowPct}
						ariaLabelledBy="settings-quota-always-pct-label"
						ariaDescribedBy="settings-quota-always-pct-desc"
						onChange={(checked) => toggleAlwaysShowPct(checked)}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-quota-show-provider-label" class="form-row-label">{m.ui_appearancesection_mostra_nome_del_provider_b467()}</span>
					<span id="settings-quota-show-provider-desc" class="form-row-desc">
						{m.settings_appearance_show_provider_desc()}
					</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-quota-show-provider"
						checked={settingsStore.appearance.quotaChip.showProvider}
						ariaLabelledBy="settings-quota-show-provider-label"
						ariaDescribedBy="settings-quota-show-provider-desc"
						onChange={(checked) => toggleShowProvider(checked)}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-quota-chip-semantic-label" class="form-row-label">{m.settings_appearance_chip_semantic_label()}</span>
					<span id="settings-quota-chip-semantic-desc" class="form-row-desc">
						{m.settings_appearance_chip_semantic_desc()}
					</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-quota-chip-semantic"
						checked={settingsStore.appearance.quotaChip.semanticColors}
						ariaLabelledBy="settings-quota-chip-semantic-label"
						ariaDescribedBy="settings-quota-chip-semantic-desc"
						onChange={(checked) => toggleSemanticColors(checked)}
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- SEPARATORE TRA BLOCCHI -->
	<div class="block-divider"></div>

	<!-- BLOCCO: POPOVER QUOTA (LIMITI DI UTILIZZO) -->
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>{m.settings_appearance_popover_title()}</h4>
				<span class="block-desc">
					{m.settings_appearance_popover_desc()}
				</span>
			</div>
		</div>

		<!-- Anteprima densa popover -->
		<div class="quota-preview-card">
			<span class="quota-preview-title">{m.settings_appearance_preview()}</span>
			<div class="popover-mini-container">
				<div
					class="popover-miniature"
					class:quota-semantic={settingsStore.appearance.quotaPopover.semanticColors}
					aria-hidden="true"
					inert
				>
					<div class="mini-provider-head">
						<span class="mini-provider-name">anthropic</span>
						<span class="mini-provider-email">user@example.com</span>
					</div>
					<div class="mini-limits-list">
						{#each PREVIEW_LIMITS as limit, idx (limit.label)}
							<QuotaLimitRow
								label={limit.label}
								remainingPercent={limit.remainingPercent}
								tone={limit.tone}
								resetCountdown={limit.resetCountdown}
								delayIndex={idx}
							/>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- Opzioni Popover / Toggle Colori semaforo -->
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-quota-popover-semantic-label" class="form-row-label">{m.settings_appearance_popover_semantic_label()}</span>
					<span id="settings-quota-popover-semantic-desc" class="form-row-desc">
						{m.settings_appearance_popover_semantic_desc()}
					</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-quota-popover-semantic"
						checked={settingsStore.appearance.quotaPopover.semanticColors}
						ariaLabelledBy="settings-quota-popover-semantic-label"
						ariaDescribedBy="settings-quota-popover-semantic-desc"
						onChange={(checked) => togglePopoverSemanticColors(checked)}
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- SEPARATORE TRA BLOCCHI -->
	<div class="block-divider"></div>

	<!-- BLOCCO 2: TEMA INTERFACCIA -->
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<div class="header-with-pill">
					<h4>{m.settings_appearance_theme_title()}</h4>
					<span class="current-theme-pill" title={m.settings_appearance_theme_current_title()}>
						{m.settings_appearance_theme_active_label()} <strong>{themeStore.current}</strong>
					</span>
				</div>
				<span class="block-desc">
					{m.settings_appearance_theme_desc()}
				</span>
			</div>
		</div>

		<div class="theme-toolbar">
			<Segmented
				options={modeOptions}
				value={themeStore.pickerMode}
				onChange={(val) => setPickerMode(val as ThemeMode)}
				ariaLabel={m.ui_appearancesection_filtro_modalita_tema_6f07()}
			/>

			<div class="filter-wrapper">
				<span class="filter-search-icon" aria-hidden="true">
					<IconSearch />
				</span>
				<input
					type="text"
					class="ui-input filter-input"
					placeholder={m.settings_appearance_theme_search_placeholder({ count: activeGroup.names.length })}
					bind:value={filterQuery}
					aria-label={m.ui_appearancesection_cerca_e_filtra_temi_b7aa()}
				/>
				{#if filterQuery}
					<button
						type="button"
						class="clear-filter-btn"
						onclick={() => (filterQuery = '')}
						aria-label={m.settings_appearance_clear_filter()}
					>
						<IconClose />
					</button>
				{/if}
			</div>
		</div>

		<div class="theme-grid" role="listbox" aria-label={m.settings_appearance_theme_gallery_aria()}>
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
							<span class="swatch-bg" title={m.settings_appearance_swatch_bg()} style="background-color: {theme.bg};"></span>
							<span class="swatch-accent" title={m.settings_appearance_swatch_accent()} style="background-color: {theme.accent};"></span>
							<span class="swatch-text" title={m.settings_appearance_swatch_text()} style="background-color: {theme.text};"></span>
						</div>
					</div>

					<div class="card-meta">
						<span class="theme-name" title={theme.name}>{theme.name}</span>
						{#if isSelected}
							<span class="active-badge">
								<IconCheck />
								<span>{m.settings_appearance_theme_active_badge()}</span>
							</span>
						{/if}
					</div>
				</button>
			{:else}
				<div class="empty-state">
					<p>{m.ui_appearancesection_nessun_tema_trovato_per_19d9()}<strong>{filterQuery}</strong>{m.settings_appearance_theme_not_found_category({ category: activeGroup.label.toLowerCase() })}</p>
					<button type="button" class="ui-button ui-button-secondary" onclick={() => (filterQuery = '')}>
						{m.settings_appearance_clear_search()}
					</button>
				</div>
			{/each}
		</div>
	</div>

	<!-- SEPARATORE TRA BLOCCHI -->
	<div class="block-divider"></div>

	<!-- BLOCCO: REGISTRO & CONTROLLO QUALITÀ ICONE -->
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>{m.settings_appearance_icons_title()}</h4>
				<span class="block-desc">
					{m.settings_appearance_icons_desc()}
				</span>
			</div>
			<button
				type="button"
				class="ui-button ui-button-secondary"
				onclick={() => (isIconInspectorOpen = true)}
			>
				<IconSparkles />
				<span>{m.settings_appearance_icons_open()}</span>
			</button>
		</div>
	</div>

	<IconInspectorModal open={isIconInspectorOpen} onClose={() => (isIconInspectorOpen = false)} />
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-head-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.block-titles {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.block-titles h4 {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
	}

	.block-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.header-with-pill {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.current-theme-pill {
		font-size: var(--text-caption);
		padding: 2px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		color: var(--ink-muted);
	}

	.current-theme-pill strong {
		color: var(--ink);
		font-family: var(--font-mono);
	}

	.block-divider {
		height: 1px;
		background: var(--line);
		margin: var(--space-1) 0;
	}


	.card-radio-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.variant-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.variant-desc {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.variant-preview {
		margin-top: auto;
		display: flex;
		align-items: center;
		width: 100%;
	}

	/* --- Popover Miniature Preview --- */

	.popover-mini-container {
		width: 100%;
		display: grid;
		grid-template-columns: 1fr;
	}

	.popover-miniature {
		grid-area: 1 / 1;
		width: 100%;
		box-sizing: border-box;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		overflow: hidden;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.quota-preview-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.quota-preview-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
	}

	.chip-preview-host {
		display: flex;
		align-items: center;
		padding: var(--space-1) 0;
	}

	.mini-provider-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
	}

	.mini-provider-name {
		font-family: var(--font-ui, var(--font-sans));
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink);
	}

	.mini-provider-email {
		font-family: var(--font-ui, var(--font-sans));
		font-size: var(--text-caption);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mini-limits-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* --- Form Rows & Switches --- */

	.section-group {
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.form-row:last-child {
		border-bottom: none;
	}

	.form-row-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.form-row-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-control {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	/* --- Theme Toolbar & Grid --- */

	.theme-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}


	.filter-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		max-width: 260px;
	}

	.filter-search-icon {
		position: absolute;
		left: var(--space-2);
		color: var(--ink-muted);
		pointer-events: none;
		display: inline-flex;
		align-items: center;
		--icon-size: 13px;
	}

	.filter-input {
		width: 100%;
		padding-left: calc(var(--space-2) + 16px);
		padding-right: calc(var(--space-2) + 18px);
	}

	.clear-filter-btn {
		position: absolute;
		right: var(--space-2);
		background: none;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		--icon-size: 13px;
		border-radius: var(--radius-sm);
		transition: color var(--dur-fast) var(--ease-out);
	}

	.clear-filter-btn:hover {
		color: var(--ink);
	}

	.theme-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: var(--space-2);
		max-height: 280px;
		overflow-y: auto;
		padding: 4px;
	}
	.theme-card {
		display: flex;
		flex-direction: column;
		padding: 0;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
		cursor: pointer;
		text-align: left;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.theme-card:hover {
		border-color: var(--line-strong);
	}

	.theme-card:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.theme-card.selected {
		border-color: var(--brand);
		box-shadow: inset 0 0 0 1px var(--brand);
	}
	.card-preview {
		height: 64px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: var(--space-2);
		position: relative;
	}

	.preview-mockup {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.mockup-header {
		display: flex;
		align-items: center;
		gap: 3px;
	}

	.mockup-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
	}

	.mockup-line {
		height: 3px;
		border-radius: var(--radius-sm);
	}

	.accent-line {
		width: 24px;
	}

	.text-line {
		width: 44px;
		opacity: 0.7;
	}

	.text-line-short {
		width: 28px;
		opacity: 0.5;
	}

	.preview-palette {
		display: flex;
		gap: 3px;
	}

	.preview-palette span {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1px solid var(--line);
	}

	.card-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
	}

	.theme-name {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.active-badge {
		display: flex;
		align-items: center;
		gap: 2px;
		font-size: var(--text-caption);
		color: var(--brand-ink);
		font-weight: 600;
		--icon-size: 12px;
	}

	.empty-state {
		grid-column: 1 / -1;
		padding: var(--space-4);
		text-align: center;
		color: var(--ink-muted);
		font-size: var(--text-caption);
	}

	/* --- Layout Variant Grid & Mini Previews --- */

	.layout-variant-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-3);
	}

	.queue-view-grid {
		grid-template-columns: repeat(2, 1fr);
	}

	@media (max-width: 640px) {
		.layout-variant-grid {
			grid-template-columns: 1fr;
		}
	}

	.layout-mini-preview {
		width: 100%;
		height: 48px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 4px;
		display: flex;
		gap: 3px;
		box-sizing: border-box;
		transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
	}

	.ui-choice:hover .layout-mini-preview,
	.ui-choice:hover .queue-mini-preview {
		border-color: var(--line-strong);
	}

	.ui-choice:has(input:checked) .layout-mini-preview {
		border-color: var(--brand);
		background: color-mix(in oklab, var(--brand) 15%, var(--bg-sunken));
	}

	.mini-col {
		height: 100%;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		box-sizing: border-box;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.mini-col.side {
		width: 22%;
		background: var(--bg-raised);
	}

	.mini-col.editor {
		flex: 1;
		background: var(--bg-sunken);
	}

	.mini-col.terminal {
		flex: 1;
		background: var(--bg-base);
	}

	.mini-stack {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		height: 100%;
	}

	.mini-row {
		width: 100%;
		flex: 1;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		box-sizing: border-box;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.mini-row.editor {
		background: var(--bg-sunken);
	}

	.mini-row.terminal {
		background: var(--bg-base);
	}

	.mini-auto-body {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-base);
		border-radius: var(--radius-sm);
		border: 1px dashed var(--line);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.ui-choice:has(input:checked) .mini-auto-body {
		color: var(--brand-ink);
		border-color: var(--brand);
	}

	.ui-choice:has(input:checked) .mini-col.editor,
	.ui-choice:has(input:checked) .mini-row.editor {
		border-color: var(--brand-dim);
	}

	.queue-mini-preview {
		width: 100%;
		box-sizing: border-box;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.queue-mini-preview.card {
		border-radius: var(--radius-md);
		padding: 8px;
		gap: 5px;
	}

	.ui-choice:has(input:checked) .queue-mini-preview {
		border-color: var(--brand);
	}

	.mini-queue-title {
		height: 7px;
		width: 75%;
		border-radius: var(--radius-sm);
		background: var(--ink);
		opacity: 0.75;
	}

	.mini-queue-excerpt {
		height: 5px;
		width: 95%;
		border-radius: var(--radius-sm);
		background: var(--ink-faint);
		opacity: 0.6;
	}

	.mini-queue-excerpt.short {
		width: 60%;
	}

	.mini-queue-chips {
		display: flex;
		gap: 3px;
	}

	.mini-queue-chips i {
		height: 9px;
		width: 26px;
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		border: 1px solid var(--line);
	}
</style>
