<script lang="ts">
	import { projectStore, type Project } from '$lib/stores/projects.svelte';
	import { projectOrder } from '$lib/stores/projectOrder.svelte';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { settingsStore, type ProjectBarOrder, type SettingsSection } from '$lib/stores/settings.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { automaticProjectHue, THEME_GROUPS, THEMES, swatchesFor, anchorsFor, type ThemeMode } from '$lib/theme';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { onMount } from 'svelte';
	import { trapFocus } from '$lib/focusTrap';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import ProjectPopover from './ProjectPopover.svelte';
	import {
		IconChevronDown,
		IconChevronLeft,
		IconChevronRight,
		IconGhost,
		IconPlus,
		IconQuota,
		IconSettings,
		IconWarning
	} from '$lib/icons';

	let {
		onUsageClick, onNewProject, onSettingsClick, onSetupClick, onQueueClick,
		setupIncomplete = false,
		onRunTask, onEditTask, onNewTask, canRunTask, runReason
	} = $props<{
		onUsageClick?: () => void;
		onNewProject?: () => void;
		onSettingsClick?: (section?: SettingsSection) => void;
		onSetupClick?: () => void;
		onQueueClick?: () => void;
		/** Vero quando manca qualcosa perche' la GUI funzioni: il chip di
		 *  setup compare solo allora, e sparisce quando non ha piu' niente da
		 *  dire. */
		setupIncomplete?: boolean;
		onRunTask?: (projectId: string, taskId: string, follow: boolean) => void;
		onEditTask?: (projectId: string, taskId: string) => void;
		/** Apre l'editor di un task nuovo sul progetto indicato. */
		onNewTask?: (projectId: string) => void;
		canRunTask?: (projectId: string) => boolean;
		runReason?: (projectId: string) => string;
	}>();

	const PROJECT_BAR_ORDER_OPTIONS: { value: ProjectBarOrder; label: string }[] = [
		{ value: 'fixed', label: 'Manuale' },
		{ value: 'mru', label: 'Ultimo aperto' },
		{ value: 'priority', label: 'Priorità task' },
		{ value: 'alpha', label: 'Alfabetico' }
	];

	const appWindow = getCurrentWindow();

	/** Il pannello di una tessera: chi lo ospita, a che cosa e' agganciato e se
	 *  e' fissato dal click destro invece di seguire il mouse. */
	interface PanelState {
		projectId: string;
		anchor: HTMLElement;
		pinned: boolean;
	}

	const HOVER_OPEN_MS = 280;
	const HOVER_CLOSE_MS = 160;

	let isMaximized = $state(false);
	let panel = $state<PanelState | null>(null);
	let openTimer: ReturnType<typeof setTimeout> | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	let pointerInsidePanel = false;
	let themeOpen = $state(false);
	let themeFilter = $state('');
	let orderMenuOpen = $state(false);
	let draggedProjectId = $state<string | null>(null);
	let dragOverProjectId = $state<string | null>(null);
	let tabsTrackEl = $state<HTMLElement | null>(null);
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);

	const panelProject = $derived(
		panel ? projectStore.projects.find((candidate) => candidate.id === panel!.projectId) ?? null : null
	);

	function updateScrollState() {
		if (!tabsTrackEl) return;
		const { scrollLeft, scrollWidth, clientWidth } = tabsTrackEl;
		canScrollLeft = scrollLeft > 2;
		canScrollRight = scrollLeft + clientWidth < scrollWidth - 2;
	}

	function scrollTabs(delta: number) {
		if (!tabsTrackEl) return;
		tabsTrackEl.scrollBy({ left: delta, behavior: 'smooth' });
	}

	function handleTabsWheel(e: WheelEvent) {
		if (!tabsTrackEl) return;
		if (e.deltaY && !e.deltaX) {
			e.preventDefault();
			tabsTrackEl.scrollLeft += e.deltaY;
			updateScrollState();
		}
	}

	$effect(() => {
		const activeId = projectStore.activeId;
		if (!activeId || !tabsTrackEl) return;
		const activeEl = tabsTrackEl.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
		if (activeEl) {
			activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
		}
		updateScrollState();
	});

	$effect(() => {
		// Tracciamo il numero di progetti per ricalcolare lo scorrimento
		void projectOrder.list.length;
		if (tabsTrackEl) {
			requestAnimationFrame(updateScrollState);
		}
	});

	const isLightTheme = $derived(anchorsFor(THEMES[themeStore.current] ?? THEMES['titanium']).isLight);

	const activeThemeGroup = $derived(THEME_GROUPS.find((group) => group.mode === themeStore.pickerMode)!);
	const filteredThemes = $derived(
		activeThemeGroup.names
			.filter((name) => name.includes(themeFilter.trim().toLowerCase()))
			.map((name) => ({ name, ...swatchesFor(THEMES[name]) }))
	);

	// Il progetto chiuso dal pannello non lascia dietro un pannello orfano.
	$effect(() => {
		if (panel && !panelProject) closePanel();
	});

	$effect(() => {
		quotaStore.init();
		return () => {
			quotaStore.destroy();
		};
	});

	$effect(() => () => clearTimers());

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

	/** Tinta che il tema assegnerebbe: serve al selettore per mostrare cosa si
	 *  ottiene tornando alla modalita' automatica. */
	function themeHue(project: Project): number {
		if (!project.path) return 0;
		return automaticProjectHue(THEMES[themeStore.current], project.path);
	}

	function projectLabel(project: Project): string {
		if (project.label !== null) return project.label;
		return settingsStore.projectBar.label === 'name' ? truncateName(project.name) : getInitials(project.name);
	}

	// Etichetta come nome: troncata in fondo, non al centro come il path,
	// perche' qui e' l'inizio del nome la parte che identifica il progetto.
	function truncateName(name: string, max = 12): string {
		if (name.length <= max) return name;
		return name.slice(0, max - 1) + '…';
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

	function clearTimers() {
		if (openTimer) clearTimeout(openTimer);
		if (closeTimer) clearTimeout(closeTimer);
		openTimer = null;
		closeTimer = null;
	}

	function openPanel(projectId: string, anchor: HTMLElement, pinned: boolean) {
		clearTimers();
		pointerInsidePanel = false;
		panel = { projectId, anchor, pinned };
	}

	function closePanel(returnFocus = false) {
		clearTimers();
		const anchor = panel?.anchor;
		const wasPinned = panel?.pinned ?? false;
		panel = null;
		pointerInsidePanel = false;
		// Il fuoco torna alla tessera solo se era stato spostato: dopo un hover
		// nessuno lo ha mosso, e rubarlo qui interromperebbe la digitazione.
		if (returnFocus && wasPinned) anchor?.querySelector('button')?.focus();
	}

	function handleTabPointerEnter(projectId: string, event: PointerEvent) {
		// Solo il mouse apre l'anteprima: con penna o dito non esiste "passare
		// sopra", e il pannello comparirebbe al tocco insieme alla selezione.
		if (event.pointerType !== 'mouse') return;
		if (draggedProjectId) return;
		if (panel?.pinned) return;
		const anchor = event.currentTarget as HTMLElement;
		clearTimers();
		openTimer = setTimeout(() => openPanel(projectId, anchor, false), HOVER_OPEN_MS);
	}

	function handleTabPointerLeave() {
		if (openTimer) clearTimeout(openTimer);
		openTimer = null;
		if (panel?.pinned) return;
		scheduleHoverClose();
	}

	function scheduleHoverClose() {
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = setTimeout(() => {
			if (!pointerInsidePanel) closePanel();
		}, HOVER_CLOSE_MS);
	}

	function handlePanelHoverChange(inside: boolean) {
		pointerInsidePanel = inside;
		if (inside) {
			if (closeTimer) clearTimeout(closeTimer);
			closeTimer = null;
			return;
		}
		if (panel?.pinned) return;
		scheduleHoverClose();
	}

	/** Click destro sulla tessera, e anche tasto Menu o Shift+F10: la WebView
	 *  manda `contextmenu` in tutti e tre i casi. Il menu di default della
	 *  WebView si ferma qui con `preventDefault`. */
	function handleTabContextMenu(projectId: string, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		openPanel(projectId, event.currentTarget as HTMLElement, true);
	}

	// Riordino manuale della barra: ha senso solo con order === 'fixed', gli
	// altri modi sono viste calcolate che non hanno un ordine da spostare.
	function handleProjectDragStart(id: string) {
		if (settingsStore.projectBar.order !== 'fixed') return;
		closePanel();
		draggedProjectId = id;
	}

	function handleProjectDragOver(event: DragEvent, id: string) {
		if (settingsStore.projectBar.order !== 'fixed' || !draggedProjectId) return;
		event.preventDefault();
		dragOverProjectId = id;
	}

	function handleProjectDragLeave(id: string) {
		if (dragOverProjectId === id) dragOverProjectId = null;
	}

	function handleProjectDrop(id: string) {
		if (draggedProjectId && draggedProjectId !== id) projectStore.moveProject(draggedProjectId, id);
		draggedProjectId = null;
		dragOverProjectId = null;
	}

	function handleProjectDragEnd() {
		draggedProjectId = null;
		dragOverProjectId = null;
	}

	function selectProjectOrder(order: ProjectBarOrder) {
		settingsStore.patchProjectBar({ order });
		orderMenuOpen = false;
	}

	function queueBadgeTitle(project: Project, queued: number, ready: boolean): string {
		const base = `${queued} task in coda`;
		if (settingsStore.projectBar.queueBadge !== 'count-state') return base;
		return ready ? `${base} · pronti a partire` : `${base} · ${runReason?.(project.id) ?? 'non lanciabili ora'}`;
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

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (themeOpen) {
				themeOpen = false;
				return;
			}
			if (orderMenuOpen) {
				orderMenuOpen = false;
				return;
			}
			if (panel) {
				closePanel(true);
				return;
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<header class="topbar" data-tauri-drag-region="deep">
	<div class="brand-section">
		<div class="app-icon" title="OMP Studio">
			<img
				src={isLightTheme ? '/logo-topbar-light.png' : '/logo-topbar.png'}
				alt="OMP Studio"
				class="brand-logo-img"
			/>
		</div>
	</div>

	<div class="tabs-nav" data-tauri-drag-region="deep">
		{#if canScrollLeft}
			<button
				type="button"
				class="tab-scroll-btn left"
				onclick={() => scrollTabs(-180)}
				title="Scorri progetti a sinistra"
				aria-label="Scorri progetti a sinistra"
			><IconChevronLeft /></button>
		{/if}

		<div
			class="tabs-track"
			bind:this={tabsTrackEl}
			onscroll={updateScrollState}
			onwheel={handleTabsWheel}
		>
			<div class="tabs">
		{#each projectOrder.list as p (p.id)}
			{@const queued = p.path ? taskStore.queuedCountFor(p.path) : 0}
			{@const ready = canRunTask?.(p.id) ?? false}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="tab-container"
						data-tab-id={p.id}
						class:drag-over={dragOverProjectId === p.id}
						class:panel-open={panel?.projectId === p.id}
						draggable={settingsStore.projectBar.order === 'fixed'}
						ondragstart={() => handleProjectDragStart(p.id)}
						ondragend={handleProjectDragEnd}
						ondragover={(event) => handleProjectDragOver(event, p.id)}
						ondragleave={() => handleProjectDragLeave(p.id)}
						ondrop={() => handleProjectDrop(p.id)}
						onpointerenter={(event) => handleTabPointerEnter(p.id, event)}
						onpointerleave={handleTabPointerLeave}
						oncontextmenu={(event) => handleTabContextMenu(p.id, event)}
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
					aria-haspopup="dialog"
					aria-expanded={panel?.projectId === p.id}
					aria-label={!p.path ? `Scratchpad: ${p.name}` : `Progetto: ${p.name}`}
				>
					{#if !p.path}
						<IconGhost />
					{:else}
						<span class="tab-label">{projectLabel(p)}</span>
					{/if}
				</button>

				{#if settingsStore.projectBar.showAgentDot}
					{#if p.agentState === 'attention'}
						<span class="status-dot attention" aria-hidden="true" title="L'agente richiede un intervento"></span>
					{:else if p.agentState === 'finished'}
						<span class="status-dot finished" aria-hidden="true" title="L'agente ha completato il lavoro"></span>
					{/if}
				{/if}

				{#if p.path && queued > 0 && settingsStore.projectBar.queueBadge !== 'off'}
					{#if settingsStore.projectBar.queueBadge === 'dot'}
						<span class="queue-dot" aria-hidden="true" title="{queued} task in coda"></span>
					{:else}
						<span
							class="queue-badge"
							class:ready={settingsStore.projectBar.queueBadge === 'count-state' && ready}
							aria-hidden="true"
							title={queueBadgeTitle(p, queued, ready)}
						>{queued}</span>
					{/if}
				{/if}

			</div>
		{/each}
			</div>
		</div>

		{#if canScrollRight}
			<button
				type="button"
				class="tab-scroll-btn right"
				onclick={() => scrollTabs(180)}
				title="Scorri progetti a destra"
				aria-label="Scorri progetti a destra"
			><IconChevronRight /></button>
		{/if}

		<div class="tabs-actions">
			<button class="tab-add" onclick={() => onNewProject?.()} title="Nuovo progetto (Ctrl+Alt+N)" aria-label="Nuovo progetto (Ctrl+Alt+N)"><IconPlus /></button>
			<button class="tab-add" onclick={() => projectStore.openScratchpad()} title="Scratchpad (Ctrl+Alt+S)" aria-label="Scratchpad (Ctrl+Alt+S)"><IconGhost /></button>

			<div class="order-control">
				<button
					type="button"
					class="tab-add"
					onclick={(event) => { event.stopPropagation(); orderMenuOpen = !orderMenuOpen; }}
					title="Ordina i progetti"
					aria-label="Ordina i progetti"
					aria-haspopup="menu"
					aria-expanded={orderMenuOpen}
				><IconChevronDown /></button>
				{#if orderMenuOpen}
					<button type="button" class="order-backdrop" onclick={() => orderMenuOpen = false} aria-label="Chiudi menu ordinamento" tabindex="-1"></button>
					<div class="order-popover" role="menu" aria-label="Ordinamento progetti" use:trapFocus={{ onEscape: () => orderMenuOpen = false }}>
						{#each PROJECT_BAR_ORDER_OPTIONS as option (option.value)}
							<button
								type="button"
								class="order-option"
								role="menuitem"
								class:active={settingsStore.projectBar.order === option.value}
								onclick={() => selectProjectOrder(option.value)}
							>{option.label}</button>
						{/each}
						<div class="popover-divider"></div>
						<button
							type="button"
							class="order-option"
							role="menuitem"
							onclick={() => { orderMenuOpen = false; onSettingsClick?.('projectBar'); }}
						>Tutte le impostazioni della barra...</button>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<div class="title">
		{projectStore.activeProject ? projectStore.activeProject.name : 'OMP Studio'}
	</div>

	<div class="controls">
		{#if setupIncomplete}
			<button
				class="setup-chip"
				onclick={(e) => { e.stopPropagation(); onSetupClick?.(); }}
				title="Completa la configurazione di omp"
				aria-label="Completa configurazione OMP"
			>
				<IconWarning /> Setup
			</button>
		{/if}
		<button
			class="settings-chip"
			onclick={(e) => { e.stopPropagation(); onSettingsClick?.(); }}
			title="Impostazioni di Studio (Ctrl+Alt+,)"
			aria-label="Impostazioni di Studio (Ctrl+Alt+,)"
		>
			<IconSettings /> Impostazioni
		</button>

		<button
			class="theme-badge"
			onclick={(event) => { event.stopPropagation(); themeOpen = !themeOpen; }}
			title="Tema: {themeStore.current}"
			aria-label="Cambia tema: {themeStore.current}"
		>
			<span class="theme-badge-color"></span>
			<span class="theme-badge-name">{themeStore.current}</span>
		</button>

		{#if taskStore.totalQueued > 0}
			<button
				class="queue-chip"
				onclick={(e) => { e.stopPropagation(); onQueueClick?.(); }}
				title="Task in attesa su tutti i progetti (Ctrl+Alt+T)"
				aria-label="Task in coda su tutti i progetti: {taskStore.totalQueued} (Ctrl+Alt+T)"
			>
				Coda ({taskStore.totalQueued})
			</button>
		{/if}
		<button
			class="usage-chip"
			class:offline={quotaStore.status === 'offline'}
			class:unconfigured={quotaStore.status === 'unconfigured'}
			class:warning={quotaStore.status === 'warning'}
			class:exhausted={quotaStore.status === 'exhausted'}
			onclick={(e) => { e.stopPropagation(); onUsageClick?.(); }}
			title={quotaStore.chipTooltip}
			aria-label="{quotaStore.chipLabel} (Ctrl+Alt+U)"
		>
			<IconQuota /> {quotaStore.chipLabel}
		</button>
		<div class="window-controls">
			<button class="win-btn" onclick={handleMinimize} title="Riduci a icona" aria-label="Riduci a icona">
				<svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
			</button>
			<button class="win-btn" onclick={handleToggleMaximize} title={isMaximized ? "Ripristina" : "Ingrandisci"} aria-label={isMaximized ? "Ripristina finestra" : "Ingrandisci finestra"}>
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
			<button class="win-btn close" onclick={handleClose} title="Chiudi" aria-label="Chiudi applicazione">
				<svg width="10" height="10" viewBox="0 0 10 10">
					<path d="M1 1l8 8m0-8l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
				</svg>
			</button>
		</div>
	</div>
</header>

{#if panel && panelProject}
	<ProjectPopover
		project={panelProject}
		anchor={panel.anchor}
		pinned={panel.pinned}
		autoHue={themeHue(panelProject)}
		otherProjectCount={projectStore.projects.length - 1}
		onClose={() => closePanel(true)}
		onHoverChange={handlePanelHoverChange}
		{onRunTask}
		{onEditTask}
		{onNewTask}
		{onQueueClick}
		{canRunTask}
		{runReason}
	/>
{/if}

{#if themeOpen}
	<button type="button" class="theme-backdrop" onclick={() => themeOpen = false} aria-label="Chiudi selezione tema" tabindex="-1"></button>
	<div class="theme-popover" role="dialog" aria-modal="true" aria-label="Selezione tema" use:trapFocus={{ onEscape: () => themeOpen = false }}>
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
			aria-label="Cerca e filtra temi"
			bind:value={themeFilter}
			onkeydown={(event) => { if (event.key === 'Escape') themeOpen = false; }}
		/>
		<div class="theme-list" role="listbox" aria-label="Elenco temi">
			{#each filteredThemes as theme (theme.name)}
				<button
					class="theme-row"
					class:selected={theme.name === themeStore.current}
					aria-pressed={theme.name === themeStore.current}
					aria-label={`Tema ${theme.name}`}
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
		gap: var(--space-2);
	}

	.brand-section {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-right: var(--space-2);
		flex-shrink: 0;
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

	.tabs-nav {
		display: flex;
		align-items: center;
		flex: 0 1 auto;
		min-width: 0;
		max-width: min(58vw, 920px);
		position: relative;
		gap: 2px;
	}

	.tabs-track {
		display: flex;
		align-items: center;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		-ms-overflow-style: none;
		min-width: 0;
		flex: 1 1 auto;
		scroll-behavior: smooth;
	}

	.tabs-track::-webkit-scrollbar {
		display: none;
	}

	.tabs {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		padding: 2px 0;
		z-index: 2;
	}

	.tabs-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		padding-left: 2px;
	}

	.tab-scroll-btn {
		height: 26px;
		width: 18px;
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink-muted);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		flex-shrink: 0;
		transition: all 0.15s ease;
		z-index: 3;
		padding: 0;
	}

	.tab-scroll-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--brand);
	}

	.tab-container {
		position: relative;
		display: flex;
		align-items: center;
	}

	/* Riordino manuale: la tessera trascinata segnala il punto di sgancio con
	   una barra sottile, mai con un'animazione che distragga. */
	.tab-container[draggable="true"] .tab {
		cursor: grab;
	}

	.tab-container.drag-over::before {
		content: '';
		position: absolute;
		top: 2px;
		bottom: 2px;
		left: -5px;
		width: 2px;
		border-radius: var(--radius-full);
		background-color: var(--brand);
		pointer-events: none;
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
		white-space: nowrap;
	}

	.tab-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
		max-width: 100%;
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


	/* Tessera con il pannello aperto: l'anello dice da dove esce il pannello,
	   cosi' con piu' progetti aperti si sa sempre di chi si stanno guardando
	   le azioni. */
	.tab-container.panel-open .tab {
		box-shadow: inset 0 0 0 1px var(--line-strong);
	}

	.tab-add {
		background-color: transparent;
		color: var(--ink-faint);
	}
	.tab-add:hover {
		color: var(--ink);
		background-color: var(--bg-hover);
	}

	.order-control {
		position: relative;
		display: flex;
		align-items: center;
	}

	.order-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-backdrop);
	}

	.order-popover {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		width: 200px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-2);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.order-option {
		display: flex;
		align-items: center;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		font: inherit;
		font-size: var(--text-xs);
		padding: 6px 8px;
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.order-option:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.order-option.active {
		background: var(--bg-active);
		color: var(--ink);
		font-weight: 600;
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
		pointer-events: none;
	}

	.status-dot.attention {
		background-color: var(--warn);
	}

	.status-dot.finished {
		background-color: var(--brand);
	}

	/* Il badge non deve mai spostare la tessera: resta in overlay come lo
	   status-dot, ma sul lato opposto per restare distinguibile a colpo d'occhio
	   anche quando i due compaiono insieme. */
	.queue-dot {
		position: absolute;
		bottom: -2px;
		right: -2px;
		width: 6px;
		height: 6px;
		border-radius: 1px;
		background-color: var(--ink-faint);
		outline: 2px solid var(--bg-raised);
		z-index: 3;
		pointer-events: none;
	}

	.queue-badge {
		position: absolute;
		bottom: -5px;
		right: -5px;
		min-width: 14px;
		height: 14px;
		padding: 0 3px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		background-color: var(--ink-faint);
		color: var(--bg-raised);
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		outline: 2px solid var(--bg-raised);
		z-index: 3;
		pointer-events: none;
	}

	.queue-badge.ready {
		background-color: var(--brand-dim);
		color: var(--ink);
	}

	/* Il divisore serve ancora al menu di ordinamento. */
	.popover-divider {
		height: 1px;
		background: var(--line);
		margin: 4px 0;
	}

	.title {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink-muted);
		flex: 1 1 auto;
		min-width: 0;
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
		flex-shrink: 0;
		z-index: 2;
	}
	.settings-chip {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-muted);
		padding: 3px 10px;
		font-size: var(--text-xs);
		border-radius: var(--radius-full);
		cursor: pointer;
		margin-right: var(--space-2);
		transition: all 0.15s ease;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.settings-chip:hover {
		color: var(--ink);
		border-color: var(--brand);
		background: var(--bg-hover);
	}

	.queue-chip {
		background: transparent;
		border: 1px solid var(--brand-dim);
		color: var(--brand-ink);
		padding: 3px 10px;
		font-size: var(--text-xs);
		border-radius: var(--radius-full);
		cursor: pointer;
		margin-right: var(--space-2);
		transition: all 0.15s ease;
	}

	.queue-chip:hover {
		border-color: var(--brand);
		background: var(--bg-hover);
	}

	/* Il solo chip che ha diritto di usare l'ambra: dice che una cosa manca,
	   ed e' anche il solo che compare e sparisce da solo. */
	.setup-chip {
		background: transparent;
		border: 1px solid var(--warn-dim);
		color: var(--warn);
		padding: 3px 10px;
		font-size: var(--text-xs);
		border-radius: var(--radius-full);
		cursor: pointer;
		margin-right: var(--space-2);
		transition: all 0.15s ease;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.setup-chip:hover {
		border-color: var(--warn);
		background: var(--bg-hover);
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
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-variant-numeric: tabular-nums;
	}

	.usage-chip:hover {
		color: var(--ink);
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.usage-chip.offline {
		border-color: var(--warn-dim, #f59e0b44);
		color: var(--warn, #f59e0b);
		background: color-mix(in srgb, var(--warn, #f59e0b) 6%, transparent);
	}

	.usage-chip.offline:hover {
		border-color: var(--warn, #f59e0b);
		background: color-mix(in srgb, var(--warn, #f59e0b) 12%, transparent);
	}

	.usage-chip.unconfigured {
		border-color: var(--line);
		border-style: dashed;
		color: var(--ink-faint);
	}

	.usage-chip.unconfigured:hover {
		border-color: var(--ink-muted);
		color: var(--ink-muted);
	}

	.usage-chip.exhausted {
		border-color: var(--danger-dim, #ef444466);
		color: var(--danger, #ef4444);
		background: color-mix(in srgb, var(--danger, #ef4444) 6%, transparent);
	}

	.usage-chip.exhausted:hover {
		border-color: var(--danger, #ef4444);
	}

	.usage-chip.warning {
		border-color: var(--warn-dim, #f59e0b44);
		color: var(--warn, #f59e0b);
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
		z-index: var(--z-overlay);
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
