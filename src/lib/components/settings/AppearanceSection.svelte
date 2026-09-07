<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { themeStore } from '$lib/stores/theme.svelte';
	import {
		settingsStore,
		type LayoutMode,
		type QuotaChipVariant,
		type QuotaPopoverVariant
	} from '$lib/stores/settings.svelte';
	import { activeQuotaStore } from '$lib/stores/activeQuota.svelte';
	import { THEME_GROUPS, THEMES, swatchesFor, anchorsFor, type ThemeMode } from '$lib/theme';
	import { IconCheck } from '$lib/icons';
	import QuotaChip from '../quota/QuotaChip.svelte';
	import QuotaLimitRow from '../quota/QuotaLimitRow.svelte';
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

	function setLayoutMode(mode: LayoutMode) {
		settingsStore.patchGeneral({ layoutMode: mode });
	}

	function setChipVariant(variant: QuotaChipVariant) {
		settingsStore.patchQuotaChip({ variant });
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

	function setPopoverVariant(variant: QuotaPopoverVariant) {
		settingsStore.patchQuotaPopover({ variant });
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
			resetCountdown: 'tra 3h 21m'
		},
		{
			label: 'Claude 7 Day',
			remainingPercent: 8,
			tone: 'bad',
			resetCountdown: 'tra 4g 2h'
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
				<h4>Disposizione Finestra</h4>
				<span class="block-desc">
					Configurazione dei pannelli dell'interfaccia: 3 colonne affiancate, vista a stack per monitor verticali o adattamento automatico (modificabile al volo con Ctrl+Alt+L).
				</span>
			</div>
		</div>

		<!-- Selettore layout (cards con preview live) -->
		<div class="layout-variant-grid" role="radiogroup" aria-label="Disposizione finestra">
			<!-- Card 1: Automatico -->
			<button
				type="button"
				class="variant-card"
				class:selected={settingsStore.general.layoutMode === 'auto'}
				role="radio"
				aria-checked={settingsStore.general.layoutMode === 'auto'}
				onclick={() => setLayoutMode('auto')}
			>
				<div class="card-radio-head">
					<div class="radio-indicator">
						{#if settingsStore.general.layoutMode === 'auto'}
							<span class="radio-dot"></span>
						{/if}
					</div>
					<span class="variant-title">Automatico</span>
				</div>
				<p class="variant-desc">
					Rileva le dimensioni della finestra: 3 colonne su schermi larghi, stack verticale se l'altezza supera la larghezza o sotto i 1100px.
				</p>
				<div class="variant-preview">
					<div class="layout-mini-preview">
						<div class="mini-col side" title="Barra laterale"></div>
						<div class="mini-auto-body">
							<span>Auto</span>
						</div>
					</div>
				</div>
			</button>

			<!-- Card 2: Orizzontale -->
			<button
				type="button"
				class="variant-card"
				class:selected={settingsStore.general.layoutMode === 'horizontal'}
				role="radio"
				aria-checked={settingsStore.general.layoutMode === 'horizontal'}
				onclick={() => setLayoutMode('horizontal')}
			>
				<div class="card-radio-head">
					<div class="radio-indicator">
						{#if settingsStore.general.layoutMode === 'horizontal'}
							<span class="radio-dot"></span>
						{/if}
					</div>
					<span class="variant-title">Orizzontale</span>
				</div>
				<p class="variant-desc">
					3 colonne affiancate: albero dei file/Git a sinistra, editor al centro e terminale o chat agente a destra.
				</p>
				<div class="variant-preview">
					<div class="layout-mini-preview horizontal">
						<div class="mini-col side" title="Barra laterale"></div>
						<div class="mini-col editor" title="Editor"></div>
						<div class="mini-col terminal" title="Terminale / Chat"></div>
					</div>
				</div>
			</button>

			<!-- Card 3: Verticale -->
			<button
				type="button"
				class="variant-card"
				class:selected={settingsStore.general.layoutMode === 'vertical'}
				role="radio"
				aria-checked={settingsStore.general.layoutMode === 'vertical'}
				onclick={() => setLayoutMode('vertical')}
			>
				<div class="card-radio-head">
					<div class="radio-indicator">
						{#if settingsStore.general.layoutMode === 'vertical'}
							<span class="radio-dot"></span>
						{/if}
					</div>
					<span class="variant-title">Verticale</span>
				</div>
				<p class="variant-desc">
					Vista a stack: albero a sinistra, editor in alto e terminale o chat in basso. Ottimizzato per monitor verticali.
				</p>
				<div class="variant-preview">
					<div class="layout-mini-preview vertical">
						<div class="mini-col side" title="Barra laterale"></div>
						<div class="mini-stack">
							<div class="mini-row editor" title="Editor"></div>
							<div class="mini-row terminal" title="Terminale / Chat"></div>
						</div>
					</div>
				</div>
			</button>
		</div>
	</div>

	<!-- SEPARATORE TRA BLOCCHI -->
	<div class="block-divider"></div>
	<!-- BLOCCO 1: CHIP QUOTA TOPBAR -->
	
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>Chip Quota (Barra Superiore)</h4>
				<span class="block-desc">
					Scegli lo stile e le informazioni mostrate nella chip delle quote in alto a destra.
				</span>
			</div>
		</div>

		<!-- Selettore stili (cards con preview live) -->
		<div class="chip-variant-grid">
			<!-- Card 1: Anello progressivo (ringHalo) -->
			<button
				type="button"
				class="variant-card"
				class:selected={settingsStore.appearance.quotaChip.variant === 'ringHalo'}
				onclick={() => setChipVariant('ringHalo')}
			>
				<div class="card-radio-head">
					<div class="radio-indicator">
						{#if settingsStore.appearance.quotaChip.variant === 'ringHalo'}
							<span class="radio-dot"></span>
						{/if}
					</div>
					<span class="variant-title">Anello progressivo</span>
				</div>
				<p class="variant-desc">
					Indicatore circolare che mostra la quota ancora disponibile e segnala gli stati di allarme con alone colorato.
				</p>
				<div class="variant-preview">
					<QuotaChip
						variant="ringHalo"
						showProvider={settingsStore.appearance.quotaChip.showProvider}
						alwaysShowPct={settingsStore.appearance.quotaChip.alwaysShowPct}
						semanticColors={settingsStore.appearance.quotaChip.semanticColors}
						status={activeQuotaStore.info.status}
						remainingPct={activeQuotaStore.info.remainingPct ?? 78}
						usedPct={activeQuotaStore.info.usedPct || 22}
						shortName={activeQuotaStore.info.shortName || 'Google'}
						hasLimits={true}
						interactive={false}
					/>
				</div>
			</button>

			<!-- Card 2: Pill riempita (fillWave) -->
			<button
				type="button"
				class="variant-card"
				class:selected={settingsStore.appearance.quotaChip.variant === 'fillWave'}
				onclick={() => setChipVariant('fillWave')}
			>
				<div class="card-radio-head">
					<div class="radio-indicator">
						{#if settingsStore.appearance.quotaChip.variant === 'fillWave'}
							<span class="radio-dot"></span>
						{/if}
					</div>
					<span class="variant-title">Pill riempita</span>
				</div>
				<p class="variant-desc">
					Capsula fluida che si svuota mentre la quota si consuma, con menisco animato ed effetto sfocato.
				</p>
				<div class="variant-preview">
					<QuotaChip
						variant="fillWave"
						showProvider={settingsStore.appearance.quotaChip.showProvider}
						alwaysShowPct={settingsStore.appearance.quotaChip.alwaysShowPct}
						semanticColors={settingsStore.appearance.quotaChip.semanticColors}
						status={activeQuotaStore.info.status}
						remainingPct={activeQuotaStore.info.remainingPct ?? 78}
						usedPct={activeQuotaStore.info.usedPct || 22}
						shortName={activeQuotaStore.info.shortName || 'Google'}
						hasLimits={true}
						interactive={false}
					/>
				</div>
			</button>
		</div>

		<!-- Opzioni / Checkbox -->
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Mostra sempre la percentuale</span>
					<span class="form-row-desc">
						Se disattivata, la percentuale numerica viene mostrata solo quando la quota scende al 30% o meno (avviso o critico).
					</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.appearance.quotaChip.alwaysShowPct}
							onchange={(e) => toggleAlwaysShowPct((e.currentTarget as HTMLInputElement).checked)}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Mostra nome del provider</span>
					<span class="form-row-desc">
						Visualizza il provider AI in uso dal progetto attivo (es. · Google, · Anthropic).
					</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.appearance.quotaChip.showProvider}
							onchange={(e) => toggleShowProvider((e.currentTarget as HTMLInputElement).checked)}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Colori semaforo per la quota</span>
					<span class="form-row-desc">
						Sostituisce i colori del tema con verde/giallo/rosso a contrasto elevato, con varianti dedicate per tema chiaro e scuro. Soglie a 30% (avviso) e 10% (critico) di quota residua.
					</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.appearance.quotaChip.semanticColors}
							onchange={(e) => toggleSemanticColors((e.currentTarget as HTMLInputElement).checked)}
						/>
						<span class="slider"></span>
					</label>
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
				<h4>Popover Quota (Limiti di Utilizzo)</h4>
				<span class="block-desc">
					Scegli lo stile e la visualizzazione dei limiti di utilizzo nel popover delle quote per entrambe le finestre (principale e Companion).
				</span>
			</div>
		</div>

		<!-- Selettore stili popover (cards con preview live) -->
		<div class="chip-variant-grid">
			<!-- Card 1: Telemetria -->
			<button
				type="button"
				class="variant-card"
				class:selected={settingsStore.appearance.quotaPopover.variant === 'telemetry'}
				onclick={() => setPopoverVariant('telemetry')}
			>
				<div class="card-radio-head">
					<div class="radio-indicator">
						{#if settingsStore.appearance.quotaPopover.variant === 'telemetry'}
							<span class="radio-dot"></span>
						{/if}
					</div>
					<span class="variant-title">Telemetria</span>
				</div>
				<p class="variant-desc">
					Barra sottile con zona consumata rigata e lettura di stato OK / WARN / CRIT, ad alta densita' informativa.
				</p>
				<div class="variant-preview">
					<div class="popover-mini-container">
						{#key `${settingsStore.appearance.quotaPopover.variant}-${settingsStore.appearance.quotaPopover.semanticColors}`}
							<div
								class="popover-miniature"
								class:quota-semantic={settingsStore.appearance.quotaPopover.semanticColors}
								aria-hidden="true"
								inert
								transition:fade={{ duration: 150 }}
							>
								<div class="mini-provider-head telemetry">
									<span class="mini-provider-name">anthropic</span>
									<span class="mini-provider-email">user@example.com</span>
								</div>
								<div class="mini-limits-list">
									{#each PREVIEW_LIMITS as limit, idx (limit.label)}
										<QuotaLimitRow
											variant="telemetry"
											label={limit.label}
											remainingPercent={limit.remainingPercent}
											tone={limit.tone}
											resetCountdown={limit.resetCountdown}
											delayIndex={idx}
										/>
									{/each}
								</div>
							</div>
						{/key}
					</div>
				</div>
			</button>

			<!-- Card 2: Anello -->
			<button
				type="button"
				class="variant-card"
				class:selected={settingsStore.appearance.quotaPopover.variant === 'radial'}
				onclick={() => setPopoverVariant('radial')}
			>
				<div class="card-radio-head">
					<div class="radio-indicator">
						{#if settingsStore.appearance.quotaPopover.variant === 'radial'}
							<span class="radio-dot"></span>
						{/if}
					</div>
					<span class="variant-title">Anello</span>
				</div>
				<p class="variant-desc">
					Un indicatore circolare per finestra, che si scarica senza direzione da interpretare, con pastiglia di stato quando la quota scende.
				</p>
				<div class="variant-preview">
					<div class="popover-mini-container">
						{#key `${settingsStore.appearance.quotaPopover.variant}-${settingsStore.appearance.quotaPopover.semanticColors}`}
							<div
								class="popover-miniature"
								class:quota-semantic={settingsStore.appearance.quotaPopover.semanticColors}
								aria-hidden="true"
								inert
								transition:fade={{ duration: 150 }}
							>
								<div class="mini-provider-head radial">
									<span class="mini-provider-name">anthropic</span>
									<span class="mini-provider-email">user@example.com</span>
								</div>
								<div class="mini-limits-list">
									{#each PREVIEW_LIMITS as limit, idx (limit.label)}
										<QuotaLimitRow
											variant="radial"
											label={limit.label}
											remainingPercent={limit.remainingPercent}
											tone={limit.tone}
											resetCountdown={limit.resetCountdown}
											delayIndex={idx}
										/>
									{/each}
								</div>
							</div>
						{/key}
					</div>
				</div>
			</button>
		</div>

		<!-- Opzioni Popover / Toggle Colori semaforo -->
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Colori semaforo</span>
					<span class="form-row-desc">
						Sostituisce i colori del tema attivo con la scala verde/ambra/rosso ad alto contrasto per indicatori e barre di avanzamento nel popover delle quote.
					</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.appearance.quotaPopover.semanticColors}
							onchange={(e) => togglePopoverSemanticColors((e.currentTarget as HTMLInputElement).checked)}
						/>
						<span class="slider"></span>
					</label>
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
					<h4>Tema Interfaccia</h4>
					<span class="current-theme-pill" title="Tema attualmente selezionato">
						Attivo: <strong>{themeStore.current}</strong>
					</span>
				</div>
				<span class="block-desc">
					Combinazione cromatica applicata a Studio e sincronizzata con le sessioni OMP.
				</span>
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
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-4);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
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
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.block-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.header-with-pill {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.current-theme-pill {
		font-size: var(--text-xs);
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

	/* --- Chip Variant Grid --- */

	.chip-variant-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-3);
	}

	.variant-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
		padding: var(--space-3);
		background: var(--bg-surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
		user-select: none;
	}

	.variant-card:hover {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.variant-card.selected {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 4%, var(--bg-surface));
		box-shadow: 0 0 0 1px var(--brand);
	}

	.card-radio-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
	}

	.radio-indicator {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.5px solid var(--line-strong);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.15s ease;
	}

	.variant-card.selected .radio-indicator {
		border-color: var(--brand);
	}

	.radio-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--brand);
	}

	.variant-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.variant-desc {
		margin: 0 0 var(--space-3) 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.variant-preview {
		margin-top: auto;
		padding-top: var(--space-2);
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
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		overflow: hidden;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.mini-provider-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
	}

	.mini-provider-head.telemetry .mini-provider-name {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-muted);
	}

	.mini-provider-head.telemetry .mini-provider-email {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mini-provider-head.radial .mini-provider-name {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.mini-provider-head.radial .mini-provider-email {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
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
		background: var(--bg-surface);
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
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-control {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	/* Toggle Switch */
	.switch {
		position: relative;
		display: inline-block;
		width: 36px;
		height: 20px;
	}

	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.slider {
		position: absolute;
		cursor: pointer;
		inset: 0;
		background-color: var(--line-strong);
		transition: 0.2s;
		border-radius: var(--radius-full);
	}

	.slider:before {
		position: absolute;
		content: "";
		height: 14px;
		width: 14px;
		left: 3px;
		bottom: 3px;
		background-color: var(--ink);
		transition: 0.2s;
		border-radius: 50%;
	}

	input:checked + .slider {
		background-color: var(--brand);
	}

	input:checked + .slider:before {
		transform: translateX(16px);
		background-color: #ffffff;
	}

	.switch input:focus-visible + .slider {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	/* --- Theme Toolbar & Grid --- */

	.theme-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.mode-tabs {
		display: flex;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 2px;
		gap: 2px;
	}

	.mode-tab-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		border: none;
		border-radius: calc(var(--radius-md) - 2px);
		background: transparent;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.mode-tab-btn:hover {
		color: var(--ink);
	}

	.mode-tab-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.mode-tab-btn.active {
		background: var(--bg-surface);
		color: var(--ink);
		font-weight: 500;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}
	.tab-count {
		font-size: 10px;
		padding: 1px 5px;
		border-radius: var(--radius-full);
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	.filter-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		max-width: 260px;
	}

	.search-icon {
		position: absolute;
		left: var(--space-2);
		color: var(--ink-muted);
		pointer-events: none;
	}

	.filter-input {
		width: 100%;
		padding: var(--space-1) var(--space-2) var(--space-1) calc(var(--space-2) + 16px);
		font-size: var(--text-xs);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		color: var(--ink);
	}

	.filter-input:focus {
		outline: none;
		border-color: var(--brand);
	}

	.clear-filter-btn {
		position: absolute;
		right: var(--space-2);
		background: none;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		padding: 0;
		font-size: var(--text-sm);
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
		background: var(--bg-surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s ease, transform 0.1s ease;
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
		border-radius: 1px;
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
		border: 1px solid rgba(0, 0, 0, 0.15);
	}

	.card-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-surface);
		border-top: 1px solid var(--line);
	}

	.theme-name {
		font-size: 11px;
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
		font-size: 10px;
		color: var(--brand);
		font-weight: 600;
	}

	.empty-state {
		grid-column: 1 / -1;
		padding: var(--space-4);
		text-align: center;
		color: var(--ink-muted);
		font-size: var(--text-xs);
	}

	/* --- Layout Variant Grid & Mini Previews --- */

	.layout-variant-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-3);
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
		transition: border-color 0.15s ease;
	}

	.variant-card:hover .layout-mini-preview {
		border-color: var(--line-strong);
	}

	.variant-card.selected .layout-mini-preview {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand-tint) 15%, var(--bg-sunken));
	}

	.mini-col {
		height: 100%;
		border-radius: 2px;
		background: var(--bg-surface);
		border: 1px solid var(--line);
		box-sizing: border-box;
		transition: all 0.15s ease;
	}

	.mini-col.side {
		width: 22%;
		background: var(--bg-raised);
	}

	.mini-col.editor {
		flex: 1;
	}

	.mini-col.terminal {
		flex: 1;
		background: var(--bg-raised);
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
		border-radius: 2px;
		background: var(--bg-surface);
		border: 1px solid var(--line);
		box-sizing: border-box;
		transition: all 0.15s ease;
	}

	.mini-row.terminal {
		background: var(--bg-raised);
	}

	.mini-auto-body {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface);
		border-radius: 2px;
		border: 1px dashed var(--line);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.variant-card.selected .mini-auto-body {
		color: var(--brand);
		border-color: var(--brand);
	}

	.variant-card.selected .mini-col.editor,
	.variant-card.selected .mini-row.editor {
		border-color: var(--brand-dim);
	}
</style>
