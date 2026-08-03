<script lang="ts">
	import { projectStore, PRESET_HUES, type Project } from '$lib/stores/projects.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { automaticProjectHue, THEME_GROUPS, THEMES, swatchesFor, type ThemeMode } from '$lib/theme';
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
	let editingProjectId = $state<string | null>(null);
	let projectNameDraft = $state('');
	let projectLabelDraft = $state('');


	const activeThemeGroup = $derived(THEME_GROUPS.find((group) => group.mode === themeStore.pickerMode)!);
	const filteredThemes = $derived(
		activeThemeGroup.names
			.filter((name) => name.includes(themeFilter.trim().toLowerCase()))
			.map((name) => ({ name, ...swatchesFor(THEMES[name]) }))
	);

	function pickTheme(name: string) {
		themeStore.select(name);
		themeOpen = false;
		themeFilter = '';
	}

	function setThemePickerMode(mode: ThemeMode) {
		void themeStore.setPickerMode(mode);
	}

	function projectHue(project: Project): number {
		if (!project.path || project.colorMode === 'custom') return project.hue;
		return automaticProjectHue(THEMES[themeStore.current], project.path);
	}

	function projectLabel(project: Project): string {
		return project.label ?? getInitials(project.name);
	}

	function startProjectEdit(project: Project) {
		editingProjectId = project.id;
		projectNameDraft = project.name;
		projectLabelDraft = project.label ?? '';
	}

	function saveProjectEdit(project: Project) {
		projectStore.renameProject(project.id, projectNameDraft);
		projectStore.setProjectLabel(project.id, projectLabelDraft);
		editingProjectId = null;
	}

	function cancelProjectEdit() {
		editingProjectId = null;
	}

	function handleProjectEditKeydown(event: KeyboardEvent, project: Project) {
		if (event.key === 'Enter') {
			event.preventDefault();
			saveProjectEdit(project);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelProjectEdit();
		}
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
					style="--proj-hue: {projectHue(p)}"
					onclick={() => projectStore.setActive(p.id)}
					title={p.name}
				>
					{#if !p.path}
						<svg class="ghost-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 3 3 4-4 4 4 3-3V10a8 8 0 0 0-8-8z"/>
						</svg>
					{:else}
						{projectLabel(p)}
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
						{#if editingProjectId === p.id}
							<form class="project-identity-form" onsubmit={(event) => { event.preventDefault(); saveProjectEdit(p); }}>
								<label>
									<span>Nome</span>
									<input bind:value={projectNameDraft} onkeydown={(event) => handleProjectEditKeydown(event, p)} />
								</label>
								<label>
									<span>Sigla</span>
									<input bind:value={projectLabelDraft} placeholder={getInitials(p.name)} onkeydown={(event) => handleProjectEditKeydown(event, p)} />
								</label>
								<div class="project-identity-actions">
									<button type="submit" class="identity-save">Salva</button>
									<button type="button" class="identity-cancel" onclick={cancelProjectEdit}>Annulla</button>
								</div>
							</form>
						{:else}
							<div class="popover-header">
								<div class="popover-titles">
									<div class="popover-name">{p.name}</div>
									{#if p.path}
										<div class="popover-path" title={p.path}>{truncateMiddle(p.path)}</div>
									{:else}
										<div class="popover-path">Chat temporanea</div>
									{/if}
								</div>
								<button class="popover-edit" onclick={() => startProjectEdit(p)}>Modifica</button>
							</div>
						{/if}

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
									<button
										class="color-mode"
										class:selected={p.colorMode === 'auto'}
										style="--auto-hue: {projectHue(p)}"
										onclick={() => projectStore.useAutomaticProjectColor(p.id)}
										title="Segui la palette del tema"
									>
										<span class="color-mode-preview"></span>
										<span>Temi</span>
									</button>
									{#each PRESET_HUES as hue}
										<button
											class="color-swatch"
											class:selected={p.colorMode === 'custom' && p.hue === hue}
											style="--swatch-hue: {hue};"
											onclick={() => projectStore.setProjectHue(p.id, hue)}
											title="Cambia colore"
										></button>
									{/each}
									<button
										class="color-swatch custom-rainbow"
										class:selected={p.colorMode === 'custom' && !PRESET_HUES.includes(p.hue)}
										onclick={() => colorInputEl?.click()}
										title="Colore personalizzato (color picker)"
									></button>
									<input
										type="color"
										bind:this={colorInputEl}
										class="hidden-color-input"
										onchange={(event) => handleCustomColorChange(p.id, event.currentTarget.value)}
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
			class="theme-badge"
			onclick={(event) => { event.stopPropagation(); themeOpen = !themeOpen; }}
			title="Tema: {themeStore.current}"
			aria-label="Cambia tema: {themeStore.current}"
		>
			<span class="theme-badge-color"></span>
			<span class="theme-badge-name">{themeStore.current}</span>
		</button>

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
		<div class="theme-tabs" role="group" aria-label="Categoria temi">
			{#each THEME_GROUPS as group (group.mode)}
				<button
					class:active={themeStore.pickerMode === group.mode}
					aria-pressed={themeStore.pickerMode === group.mode}
					onclick={() => setThemePickerMode(group.mode)}
				>
					{group.label} <span>{group.names.length}</span>
				</button>
			{/each}
		</div>
		<input
			class="theme-filter"
			type="text"
			placeholder="Filtra {activeThemeGroup.names.length} temi"
			bind:value={themeFilter}
			onkeydown={(event) => { if (event.key === 'Escape') themeOpen = false; }}
		/>
		<div class="theme-list">
			{#each filteredThemes as theme (theme.name)}
				<button
					class="theme-row"
					class:selected={theme.name === themeStore.current}
					aria-pressed={theme.name === themeStore.current}
					onclick={() => pickTheme(theme.name)}
				>
					<span class="theme-preview" style="background: {theme.bg};">
						<span class="dot" style="background: {theme.accent};"></span>
						<span class="dot" style="background: {theme.text};"></span>
					</span>
					<span class="theme-name">{theme.name}</span>
				</button>
			{:else}
				<div class="theme-empty">Nessun tema {themeStore.pickerMode === 'dark' ? 'scuro' : 'chiaro'} trovato</div>
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

	.tab,
	.tab-add {
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

	.tab {
		min-width: 30px;
		max-width: 96px;
		padding: 0 var(--space-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tab-add {
		width: 30px;
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
		width: min(280px, calc(100vw - 16px));
		box-sizing: border-box;
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
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.popover-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
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
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.popover-edit,
	.identity-save,
	.identity-cancel {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: var(--space-1) var(--space-2);
	}

	.popover-edit:hover,
	.identity-cancel:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.project-identity-form {
		display: grid;
		gap: var(--space-2);
	}

	.project-identity-form label {
		display: grid;
		gap: var(--space-1);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.project-identity-form input {
		min-width: 0;
		box-sizing: border-box;
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font: inherit;
		font-size: var(--text-sm);
		padding: var(--space-1) var(--space-2);
	}

	.project-identity-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.identity-save {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--on-brand);
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

	.color-mode {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		height: 22px;
		padding: 0 var(--space-1);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
	}

	.color-mode:hover,
	.color-mode.selected {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.color-mode-preview {
		width: 12px;
		height: 12px;
		border-radius: var(--radius-full);
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--auto-hue));
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

	/* Il badge conserva il colore del tema, ma rende leggibile anche il suo nome. */
	.theme-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		height: 24px;
		max-width: 160px;
		padding: 0 var(--space-2);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		color: var(--ink-muted);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		margin-right: var(--space-3);
	}

	.theme-badge:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.theme-badge-color {
		width: 10px;
		height: 10px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-full);
		background: var(--brand);
		flex: none;
	}

	.theme-badge-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.theme-tabs {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-1);
		padding-bottom: var(--space-1);
		border-bottom: 1px solid var(--line);
	}

	.theme-tabs button {
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: var(--space-1) var(--space-2);
	}

	.theme-tabs button:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.theme-tabs button.active {
		background: var(--bg-active);
		color: var(--ink);
		font-weight: 600;
	}

	.theme-tabs span {
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 500;
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
