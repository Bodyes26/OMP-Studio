<script lang="ts">
	import { projectStore, PRESET_HUES } from '$lib/stores/projects.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { THEME_GROUPS, THEMES, swatchesFor } from '$lib/theme';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { onMount } from 'svelte';

	let { onUsageClick, onNewProject } = $props<{ onUsageClick?: () => void; onNewProject?: () => void }>();

	const appWindow = getCurrentWindow();

	let isMaximized = $state(false);
	let hoveredTabId = $state<string | null>(null);
	let hoverTimer: any = null;
	let mouseInsidePopover = false;
	let colorInputEl = $state<HTMLInputElement | null>(null);
	let themeOpen = $state(false);
	let themeFilter = $state('');

	const themeGroups = $derived(
		THEME_GROUPS
			.map((group) => ({
				...group,
				themes: group.names
					.filter((n) => n.includes(themeFilter.trim().toLowerCase()))
					.map((name) => ({ name, ...swatchesFor(THEMES[name]) }))
			}))
			.filter((group) => group.themes.length > 0)
	);

	function pickTheme(name: string) {
		themeStore.select(name);
		themeOpen = false;
		themeFilter = '';
	}

	function hexToHue(hex: string): number {
		let c = hex.replace('#', '');
		if (c.length === 3) c = c.split('').map(x => x + x).join('');
		const num = parseInt(c, 16);
		const r = ((num >> 16) & 255) / 255;
		const g = ((num >> 8) & 255) / 255;
		const b = (num & 255) / 255;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;

		if (d === 0) return 0;

		let h = 0;
		if (max === r) {
			h = ((g - b) / d) % 6;
		} else if (max === g) {
			h = (b - r) / d + 2;
		} else {
			h = (r - g) / d + 4;
		}

		h = Math.round(h * 60);
		if (h < 0) h += 360;
		return h;
	}

	function handleCustomColorChange(projectId: string, hex: string) {
		const hue = hexToHue(hex);
		projectStore.setProjectHue(projectId, hue);
	}

	onMount(() => {
		let unlisten: any;
		appWindow.isMaximized().then(max => isMaximized = max);
		appWindow.onResized(() => {
			appWindow.isMaximized().then(max => isMaximized = max);
		}).then(u => unlisten = u);

		return () => {
			if (unlisten) unlisten();
		};
	});

	function getInitials(name: string) {
		return name.slice(0, 2).toUpperCase();
	}

	// Il path si tronca al centro: la coda e' la parte informativa.
	function truncateMiddle(path: string, max = 38) {
		if (path.length <= max) return path;
		const head = Math.ceil((max - 1) / 2);
		const tail = Math.floor((max - 1) / 2);
		return path.slice(0, head) + '…' + path.slice(path.length - tail);
	}

	function handleTabMouseEnter(id: string) {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => {
			hoveredTabId = id;
		}, 300);
	}

	function handleTabMouseLeave() {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => {
			if (!mouseInsidePopover) {
				hoveredTabId = null;
			}
		}, 150);
	}

	function handlePopoverMouseEnter() {
		mouseInsidePopover = true;
		if (hoverTimer) clearTimeout(hoverTimer);
	}

	function handlePopoverMouseLeave() {
		mouseInsidePopover = false;
		hoveredTabId = null;
	}

	function handleMinimize(e: MouseEvent) {
		e.stopPropagation();
		appWindow.minimize().catch(err => console.error("Minimize error:", err));
	}

	async function handleToggleMaximize(e: MouseEvent) {
		e.stopPropagation();
		try {
			await appWindow.toggleMaximize();
			isMaximized = await appWindow.isMaximized();
		} catch (err) {
			console.error("Toggle maximize error:", err);
		}
	}

	function handleClose(e: MouseEvent) {
		e.stopPropagation();
		appWindow.close().catch(err => console.error("Close error:", err));
	}
</script>

<header class="topbar" data-tauri-drag-region="deep">
	<div class="brand-section">
		<div class="app-icon" title="OMP Studio">
			<img src="/logo-topbar.png" alt="OH MY π" class="brand-logo-img" />
		</div>
	</div>

	<div class="tabs">
		{#each projectStore.projects as p}
			<!-- svelte-ignore a11y_mouse_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div 
				class="tab-container"
				onmouseenter={() => handleTabMouseEnter(p.id)}
				onmouseleave={handleTabMouseLeave}
			>
				<button 
					class="tab"
					class:active={projectStore.activeId === p.id}
					class:working={p.agentState === 'working'}
					class:attention={p.agentState === 'attention'}
					class:finished={p.agentState === 'finished'}
					class:scratchpad={!p.path}
					style="--proj-hue: {p.hue}"
					onclick={() => projectStore.setActive(p.id)}
					title={p.name}
				>
					{#if !p.path}
						<svg class="ghost-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 3 3 4-4 4 4 3-3V10a8 8 0 0 0-8-8z"/>
						</svg>
					{:else}
						{getInitials(p.name)}
					{/if}

					{#if p.agentState === 'attention'}
						<span class="status-dot attention" title="L'agente richiede un intervento"></span>
					{:else if p.agentState === 'finished'}
						<span class="status-dot finished" title="L'agente ha completato il lavoro"></span>
					{/if}
				</button>

				{#if hoveredTabId === p.id}
					<!-- svelte-ignore a11y_mouse_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div 
						class="tab-popover"
						onmouseenter={handlePopoverMouseEnter}
						onmouseleave={handlePopoverMouseLeave}
					>
						<div class="popover-header">
							<div class="popover-titles">
								<div class="popover-name">{p.name}</div>
								{#if p.path}
									<div class="popover-path" title={p.path}>{truncateMiddle(p.path)}</div>
								{:else}
									<div class="popover-path">Chat temporanea</div>
								{/if}
							</div>
						</div>

						<div class="popover-actions">
							{#if projectStore.activeId !== p.id}
								<button class="popover-btn" onclick={() => { projectStore.setActive(p.id); hoveredTabId = null; }}>
									<span class="btn-icon">✓</span> Seleziona progetto
								</button>
							{/if}
							{#if p.path}
								<button class="popover-btn" onclick={() => { revealItemInDir(p.path); hoveredTabId = null; }}>
									<span class="btn-icon">📁</span> Mostra nella cartella
								</button>
								<div class="popover-divider"></div>
								<div class="popover-section-label">Colore scheda</div>
								<div class="color-picker-grid">
									{#each PRESET_HUES as hue}
										<button 
											class="color-swatch"
											class:selected={p.hue === hue}
											style="--swatch-hue: {hue};"
											onclick={() => projectStore.setProjectHue(p.id, hue)}
											title="Cambia colore"
										></button>
									{/each}
									<button
										class="color-swatch custom-rainbow"
										class:selected={!PRESET_HUES.includes(p.hue)}
										onclick={() => colorInputEl?.click()}
										title="Colore personalizzato (color picker)"
									></button>
									<input
										type="color"
										bind:this={colorInputEl}
										class="hidden-color-input"
										onchange={(e) => handleCustomColorChange(p.id, e.currentTarget.value)}
									/>
								</div>
							{/if}
							<div class="popover-divider"></div>
							<button class="popover-btn danger" onclick={() => { projectStore.closeProject(p.id); hoveredTabId = null; }}>
								<span class="btn-icon">✕</span> Chiudi progetto
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/each}

		<button class="tab-add" onclick={() => onNewProject?.()} title="Nuovo progetto (Ctrl+Alt+N)">+</button>
		<button class="tab-add" onclick={() => projectStore.openScratchpad()} title="Scratchpad (Ctrl+Alt+S)">*</button>
	</div>

	<div class="title">
		{projectStore.activeProject ? projectStore.activeProject.name : 'OMP Studio'}
	</div>

	<div class="controls">
		<button
			class="theme-chip"
			onclick={(e) => { e.stopPropagation(); themeOpen = !themeOpen; }}
			title="Tema: {themeStore.current}"
			aria-label="Cambia tema"
		></button>

		<button class="usage-chip" onclick={(e) => { e.stopPropagation(); onUsageClick?.(); }} title="Quota (Ctrl+Alt+U)">⚡ Quota</button>

		<div class="window-controls">
			<button class="win-btn" onclick={handleMinimize} title="Riduci a icona">
				<svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
			</button>
			<button class="win-btn" onclick={handleToggleMaximize} title={isMaximized ? "Ripristina" : "Ingrandisci"}>
				{#if isMaximized}
					<svg width="10" height="10" viewBox="0 0 10 10">
						<path d="M2.5 1h6v6h-1v-5h-5v-1zm-1.5 2.5h6v6h-6v-6zm1 1v4h4v-4h-4z" fill="currentColor"/>
					</svg>
				{:else}
					<svg width="10" height="10" viewBox="0 0 10 10">
						<path d="M1 1h8v8h-8v-8zm1 1v6h6v-6h-6z" fill="currentColor"/>
					</svg>
				{/if}
			</button>
			<button class="win-btn close" onclick={handleClose} title="Chiudi">
				<svg width="10" height="10" viewBox="0 0 10 10">
					<path d="M1 1l8 8m0-8l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
				</svg>
			</button>
		</div>
	</div>
</header>

{#if themeOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="theme-backdrop" onclick={() => themeOpen = false}></div>
	<div class="theme-popover">
		<input
			class="theme-filter"
			type="text"
			placeholder="Filtra {themeStore.names.length} temi"
			bind:value={themeFilter}
			onkeydown={(e) => { if (e.key === 'Escape') themeOpen = false; }}
		/>
		<div class="theme-list">
			{#each themeGroups as group (group.mode)}
				<section class="theme-group" aria-labelledby={'theme-group-' + group.mode}>
					<div class="theme-group-label" id={'theme-group-' + group.mode} role="heading" aria-level="3">
						<span>{group.label}</span>
						<span class="theme-group-count">{group.themes.length}</span>
					</div>
					<div class="theme-group-items">
						{#each group.themes as t (t.name)}
							<button
								class="theme-row"
								class:selected={t.name === themeStore.current}
								aria-pressed={t.name === themeStore.current}
								onclick={() => pickTheme(t.name)}
							>
								<span class="theme-preview" style="background: {t.bg};">
									<span class="dot" style="background: {t.accent};"></span>
									<span class="dot" style="background: {t.text};"></span>
								</span>
								<span class="theme-name">{t.name}</span>
							</button>
						{/each}
					</div>
				</section>
			{:else}
				<div class="theme-empty">Nessun tema trovato</div>
			{/each}
		</div>
		<div class="theme-note">
			{#if themeStore.bridged}
				Lo usano anche le sessioni <code>omp</code> aperte da Studio.
			{:else}
				Alla prima scelta il tema passa anche a <code>omp</code>: le sessioni già
				aperte restano come sono.
			{/if}
		</div>
	</div>
{/if}

<style>
	.topbar {
		height: 48px;
		background-color: var(--bg-raised);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0 0 var(--space-2);
		z-index: var(--z-topbar);
		user-select: none;
		position: relative;
	}

	.brand-section {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-right: var(--space-2);
	}

	.app-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 30px;
	}

	.brand-logo-img {
		height: 26px;
		width: auto;
		object-fit: contain;
	}

	.tabs {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		z-index: 2;
	}

	.tab-container {
		position: relative;
		display: flex;
		align-items: center;
	}

	.tab, .tab-add {
		width: 30px;
		height: 30px;
		border-radius: var(--radius-md);
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		cursor: pointer;
		padding: 0;
		transition: background-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out);
	}

	/* Tessera: neutra a riposo, con la sola lettera tinta del progetto.
	   Il riempimento pieno e' riservato al progetto attivo: un solo blocco
	   saturo per schermata invece di uno per progetto aperto. */
	.tab {
		background-color: color-mix(in srgb, var(--ink) 8%, transparent);
		border: 1px solid transparent;
		color: oklch(var(--proj-l-ink) var(--proj-c-ink) var(--proj-hue));
		position: relative;
	}

	.tab:hover {
		background-color: var(--bg-active);
	}

	.tab.scratchpad {
		background-color: transparent;
		color: var(--ink-faint);
		border: 1px dashed var(--line-strong);
	}

	.tab.scratchpad:hover {
		background-color: var(--bg-hover);
		border-color: var(--ink-faint);
		color: var(--ink);
	}

	.tab.scratchpad.active {
		background-color: var(--bg-active);
		border-style: solid;
		border-color: var(--ink-faint);
		color: var(--ink);
	}


	.ghost-icon {
		width: 14px;
		height: 14px;
	}

	.tab-add {
		background-color: transparent;
		color: var(--ink-faint);
	}
	.tab-add:hover {
		color: var(--ink);
		background-color: var(--bg-hover);
	}

	.tab.active {
		background-color: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue));
		color: var(--on-project);
		font-weight: 700;
	}

	/* Stato: un anello, mai un alone. Solo "working" respira. */
	.tab.working::after,
	.tab.attention::after,
	.tab.finished::after {
		content: '';
		position: absolute;
		inset: -2px;
		border-radius: var(--radius-md);
		pointer-events: none;
	}

	.tab.working::after {
		border: 2px solid var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.tab.attention::after {
		border: 1px solid var(--warn);
	}

	.tab.finished::after {
		border: 1px solid var(--brand);
	}

	.status-dot {
		position: absolute;
		top: -2px;
		right: -2px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		/* Knockout sul colore della barra: separa il punto dalla tessera
		   senza usare un'ombra. */
		outline: 2px solid var(--bg-raised);
		z-index: 3;
	}

	.status-dot.attention {
		background-color: var(--warn);
	}

	.status-dot.finished {
		background-color: var(--brand);
	}

	/* Tab Popover Card */
	.tab-popover {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		width: 240px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-3);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		animation: popoverFadeIn var(--dur-slow) var(--ease-out-expo);
		transform-origin: top left;
	}

	@keyframes popoverFadeIn {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.popover-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}


	.popover-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
		width: 100%;
	}

	.popover-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.popover-path {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink-faint);
		white-space: nowrap;
	}


	.popover-actions {
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-top: 1px solid var(--line);
		padding-top: var(--space-2);
	}
	.popover-divider {
		height: 1px;
		background: var(--line);
		margin: 4px 0;
	}

	.popover-section-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-faint);
		padding: 2px 8px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.color-picker-grid {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		flex-wrap: wrap;
	}

	.color-swatch {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid transparent;
		background-color: oklch(0.68 0.16 var(--swatch-hue));
		cursor: pointer;
		padding: 0;
		transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.color-swatch:hover {
		transform: scale(1.25);
	}

	.color-swatch.selected {
		border-color: var(--ink);
		transform: scale(1.2);
	}
	.color-swatch.custom-rainbow {
		background: conic-gradient(from 0deg in oklch,
			oklch(0.68 0.16 0), oklch(0.68 0.16 60), oklch(0.68 0.16 135),
			oklch(0.68 0.16 175), oklch(0.68 0.16 220), oklch(0.68 0.16 265),
			oklch(0.68 0.16 305), oklch(0.68 0.16 0));
	}

	.hidden-color-input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
		pointer-events: none;
	}

	.popover-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: none;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		padding: 6px 8px;
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.popover-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.popover-btn.danger:hover {
		background: var(--bg-hover);
		color: var(--brand-ink);
	}

	.btn-icon {
		font-size: 12px;
		width: 14px;
		text-align: center;
	}

	.title {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink-muted);
		flex: 1;
		text-align: center;
		cursor: default;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0 var(--space-3);
	}

	.controls {
		display: flex;
		align-items: center;
		height: 100%;
		z-index: 2;
	}

	.usage-chip {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-muted);
		padding: 3px 10px;
		font-size: var(--text-xs);
		border-radius: var(--radius-full);
		cursor: pointer;
		margin-right: var(--space-3);
		transition: all 0.15s ease;
	}

	.usage-chip:hover {
		color: var(--ink);
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	/* Selettore di tema: la pastiglia mostra l'accento del tema corrente,
	   che e' l'unica cosa del tema che il guscio adotta oltre alle superfici. */
	.theme-chip {
		width: 14px;
		height: 14px;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-full);
		background: var(--brand);
		cursor: pointer;
		margin-right: var(--space-3);
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.theme-chip:hover {
		border-color: var(--ink-muted);
	}

	.theme-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-backdrop);
	}

	.theme-popover {
		position: fixed;
		top: 54px;
		right: 140px;
		width: 260px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-2);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.theme-filter {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		padding: var(--space-1) var(--space-2);
	}

	.theme-list {
		display: flex;
		flex-direction: column;
		max-height: 320px;
		overflow-y: auto;
	}
	.theme-group {
		display: flex;
		flex-direction: column;
	}

	.theme-group + .theme-group {
		border-top: 1px solid var(--line);
		margin-top: var(--space-2);
		padding-top: var(--space-2);
	}

	.theme-group-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-weight: 650;
		padding: 0 var(--space-2) var(--space-1);
	}

	.theme-group-count {
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 500;
	}

	.theme-group-items {
		display: flex;
		flex-direction: column;
	}

	.theme-empty {
		color: var(--ink-faint);
		font-size: var(--text-sm);
		padding: var(--space-3) var(--space-2);
		text-align: center;
	}


	.theme-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		font-size: var(--text-sm);
		padding: var(--space-1) var(--space-2);
		text-align: left;
	}

	.theme-row:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.theme-row.selected {
		background: var(--bg-active);
		color: var(--ink);
	}

	.theme-preview {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		width: 34px;
		height: 18px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		flex: none;
	}

	.theme-preview .dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
	}

	.theme-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.theme-note {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: 1.4;
		padding: 0 var(--space-2) var(--space-1);
	}

	.theme-note code {
		font-family: var(--font-mono);
	}

	/* Native Window Controls */
	.window-controls {
		display: flex;
		align-items: stretch;
		height: 100%;
	}

	.win-btn {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		width: 44px;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background-color 0.15s ease, color 0.15s ease;
	}

	.win-btn:hover {
		background-color: var(--bg-hover);
		color: var(--ink);
	}

	.win-btn.close:hover {
		background-color: var(--brand-dim);
		color: var(--ink);
	}
</style>
