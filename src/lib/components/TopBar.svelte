<script lang="ts">
	import { projectStore, type Project } from '$lib/stores/projects.svelte';
	import { projectOrder } from '$lib/stores/projectOrder.svelte';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { settingsStore, type ProjectBarOrder, type SettingsSection } from '$lib/stores/settings.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { automaticProjectHue, THEMES, anchorsFor } from '$lib/theme';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { onMount } from 'svelte';
	import { trapFocus } from '$lib/focusTrap';
	import { IS_MAC } from '$lib/utils/platform';
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

	// Lo stato di una tessera e' un anello e un colore: senza queste etichette
	// dentro l'`aria-label` sarebbe un'informazione affidata al solo colore.
	const AGENT_STATE_LABEL: Record<Project['agentState'], string> = {
		idle: 'nessun agente',
		working: 'agente al lavoro',
		attention: 'attende una risposta',
		finished: 'ha finito il lavoro',
		unknown: 'stato non disponibile'
	};

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
	let orderMenuOpen = $state(false);
	let draggedProjectId = $state<string | null>(null);
	let dragOverProjectId = $state<string | null>(null);
	let tabsTrackEl = $state<HTMLElement | null>(null);
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);

	/** Sequenza del lampo di transizione, una per progetto: cambiarla rimonta
	 *  l'overlay e riavvia l'animazione. */
	let flashSeq = $state<Record<string, number>>({});
	const flashCount = new Map<string, number>();
	const lastSeenState = new Map<string, Project['agentState']>();

	const panelProject = $derived(
		panel ? projectStore.projects.find((candidate) => candidate.id === panel!.projectId) ?? null : null
	);

	/** Tessera che tiene il posto della barra nel tab order: e' quella attiva,
	 *  oppure la prima se nessun progetto lo e' (all'avvio, o dopo la chiusura
	 *  dell'ultimo attivo), altrimenti la barra diventerebbe irraggiungibile
	 *  da tastiera. */
	const rovingTabId = $derived(
		projectOrder.list.some((candidate) => candidate.id === projectStore.activeId)
			? projectStore.activeId
			: projectOrder.list[0]?.id ?? null
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

	/** Il cambio di stato di un agente e' un evento, non soltanto un colore
	 *  diverso: un lampo nella tinta del progetto lo rende percepibile con la
	 *  coda dell'occhio, che e' l'unico modo in cui questa barra viene
	 *  guardata mentre si lavora. */
	$effect(() => {
		for (const p of projectStore.projects) {
			const previous = lastSeenState.get(p.id);
			lastSeenState.set(p.id, p.agentState);
			// Il primo stato osservato non e' una transizione, e 'unknown' e' il
			// valore prima che la sessione si attacchi: all'avvio non lampeggia
			// niente.
			if (previous === undefined || previous === 'unknown' || previous === p.agentState) continue;
			const next = (flashCount.get(p.id) ?? 0) + 1;
			flashCount.set(p.id, next);
			// Scrittura pura: `flashSeq` non viene mai letto qui dentro, quindi
			// l'effetto non si invalida da solo.
			flashSeq[p.id] = next;
		}
	});


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

	/** Sigla della tessera: sempre visibile, e' l'ancora spaziale della barra.
	 *  Il nome intero non la sostituisce piu', si affianca. */
	function projectCode(project: Project): string {
		if (project.label !== null) return project.label;
		return getInitials(project.name);
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

	/** Le tessere in ordine di documento, che nella barra e' anche quello
	 *  visibile: il `#each` segue `projectOrder.list` e nessuna regola CSS
	 *  inverte le righe, quindi le frecce restano coerenti anche dopo un
	 *  riordino manuale. */
	function tabButtons(): HTMLElement[] {
		if (!tabsTrackEl) return [];
		return Array.from(tabsTrackEl.querySelectorAll<HTMLElement>('button.tab[role="tab"]'));
	}

	/** Frecce, Inizio e Fine spostano solo il fuoco: il progetto cambia con
	 *  Invio o Spazio, che il `<button>` traduce in click da solo. Senza
	 *  `preventDefault` la traccia scorrerebbe di lato per conto suo. */
	function handleTabKeydown(event: KeyboardEvent) {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const tabs = tabButtons();
		const current = tabs.indexOf(event.currentTarget as HTMLElement);
		if (current < 0) return;
		let next: number;
		switch (event.key) {
			// La barra e' un anello: dall'ultima tessera si torna alla prima,
			// che con molti progetti aperti risparmia una traversata.
			case 'ArrowLeft': next = (current - 1 + tabs.length) % tabs.length; break;
			case 'ArrowRight': next = (current + 1) % tabs.length; break;
			case 'Home': next = 0; break;
			case 'End': next = tabs.length - 1; break;
			default: return;
		}
		event.preventDefault();
		tabs[next].focus();
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

<header class="topbar" class:mac-chrome={IS_MAC} data-tauri-drag-region="deep">
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
			<!-- Le tessere sono schede: selezionandone una cambia il contenuto
			     della finestra sotto. Il pannello non ha un id stabile a cui
			     agganciare `aria-controls`, e inventarne uno che non punta a
			     niente sarebbe peggio dell'assenza. -->
			<div class="tabs" role="tablist" aria-orientation="horizontal" aria-label="Progetti aperti">
		{#each projectOrder.list as p (p.id)}
			{@const queued = p.path ? taskStore.queuedCountFor(p.path) : 0}
			{@const ready = canRunTask?.(p.id) ?? false}
			{@const isActive = projectStore.activeId === p.id}
			{@const showName = isActive || settingsStore.projectBar.label === 'name'}
			{@const queueStyle = settingsStore.projectBar.queueBadge}
			<!-- Il contenitore esiste solo per trascinamento, hover e menu
			     contestuale: con `role="presentation"` sparisce dall'albero
			     accessibile e la tessera resta figlia diretta del tablist, come
			     la relazione tablist/tab richiede. `role="presentation"` copre
			     anche i gestori senza semantica, percio' non serve piu' l'ignore
			     di a11y_no_static_element_interactions. -->
					<div
						class="tab-container"
						role="presentation"
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
				<!-- `aria-selected` dice quale progetto e' in primo piano, percio'
				     l'`aria-current` di prima sarebbe un doppione letto due volte.
				     Anche `aria-expanded` e' sparito: su una scheda descrive il
				     pannello di contenuto, non l'anteprima al passaggio del mouse,
				     e annuncerebbe "non espanso" su ogni tessera.
				     Invio e Spazio non hanno un gestore: il pulsante nativo li
				     traduce gia' in click, e intercettarli attiverebbe due volte. -->
				<button
					class="tab"
					type="button"
					role="tab"
					class:active={isActive}
					class:attention={settingsStore.projectBar.showAgentDot && p.agentState === 'attention'}
					class:finished={settingsStore.projectBar.showAgentDot && p.agentState === 'finished'}
					class:quiet={p.agentState === 'idle' || p.agentState === 'unknown'}
					class:scratchpad={!p.path}
					style="--proj-hue: {projectHue(p)}"
					onclick={() => projectStore.setActive(p.id)}
					onkeydown={handleTabKeydown}
					aria-selected={isActive}
					tabindex={p.id === rovingTabId ? 0 : -1}
					aria-haspopup="dialog"
					aria-label={`${p.path ? 'Progetto' : 'Scratchpad'}: ${p.name} · ${AGENT_STATE_LABEL[p.agentState]}${queued > 0 ? ` · ${queued} task in coda` : ''}`}
				>
					<!-- Il lampo vive dentro la tessera per essere tagliato dal suo
					     raggio; il rimontaggio con `#key` riavvia l'animazione. -->
					{#if flashSeq[p.id]}
						{#key flashSeq[p.id]}
							<span class="tab-flash" aria-hidden="true"></span>
						{/key}
					{/if}

					{#if p.path}
						<span class="tab-dot" aria-hidden="true"></span>
						<span class="tab-code">{projectCode(p)}</span>
					{:else}
						<span class="tab-ghost" aria-hidden="true"><IconGhost /></span>
					{/if}

					<span class="tab-reveal" class:show={showName}>
						<span class="tab-reveal-inner"><span class="tab-name">{p.name}</span></span>
					</span>

					<span class="tab-reveal" class:show={isActive && p.agentState === 'working'}>
						<span class="tab-reveal-inner"><span class="tab-spin" aria-hidden="true"></span></span>
					</span>

					{#if p.path && queueStyle !== 'off'}
						<span class="tab-reveal" class:show={isActive && queued > 0}>
							<span class="tab-reveal-inner">
								{#if queueStyle === 'dot'}
									<span class="tab-queue-dot" aria-hidden="true" title="{queued} task in coda"></span>
								{:else}
									<span
										class="tab-queue"
										class:ready={queueStyle === 'count-state' && ready}
										aria-hidden="true"
										title={queueBadgeTitle(p, queued, ready)}
									>{queued}</span>
								{/if}
							</span>
						</span>
					{/if}
				</button>

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

	<!-- Il nome del progetto attivo vive dentro la sua tessera: qui resta solo
	     l'area di trascinamento della finestra, che senza decorazioni native e'
	     l'unico modo per spostarla. -->
	<div class="drag-spacer" data-tauri-drag-region="deep"></div>

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
		{#if !IS_MAC}
			<!-- Su macOS i tre controlli li disegna il sistema (semafori nativi):
			     duplicarli darebbe due serie di pulsanti nella stessa finestra. -->
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
		{/if}
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

	/* macOS: `titleBarStyle: Overlay` tiene i semafori nativi sopra la barra,
	   in alto a sinistra. Senza questo spazio coprirebbero il logo. */
	.topbar.mac-chrome {
		padding-left: 78px;
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
		gap: 2px;
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
		left: -2px;
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
	}

	/* La tessera non ha piu' una larghezza massima: si allarga quando il suo
	   progetto viene aperto e si stringe quando un altro prende il posto. Il
	   solo tetto e' sul nome. */
	.tab {
		padding: 0 var(--space-2);
		white-space: nowrap;
		overflow: hidden;
		transition: background-color var(--dur-slow) var(--ease-out);
	}

	.tab-add {
		width: 30px;
		transition: background-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out);
	}

	/* Tessera: neutra sempre. Il colore del progetto vive nel punto da 8px e
	   non nel riempimento, cosi' sei progetti aperti sono sei punti e non sei
	   blocchi saturi in cima allo schermo. */
	.tab {
		background-color: transparent;
		border: 1px solid transparent;
		position: relative;
	}

	.tab:hover {
		background-color: color-mix(in srgb, var(--ink) 5%, transparent);
	}

	/* Nessun agente aperto: la tessera si ritira. Il punto perde la tinta e il
	   testo scende a --ink-faint, che resta sopra 4.5:1. */
	.tab.quiet .tab-dot {
		background-color: var(--ink-faint);
		opacity: 0.5;
	}

	/* Una tessera aperta non e' mai spenta: il progetto che stai guardando
	   resta leggibile anche quando nessun agente e' al lavoro. */
	.tab.quiet:not(.active) .tab-code,
	.tab.quiet:not(.active) .tab-name {
		color: var(--ink-faint);
	}

	.tab.scratchpad {
		border: 1px dashed var(--line-strong);
		color: var(--ink-faint);
	}

	.tab.scratchpad:hover {
		border-color: var(--ink-faint);
		color: var(--ink);
	}

	.tab.scratchpad.active {
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

	/* Click-catcher, non un controllo da disegnare: e' un <button> per il focus
	   e la tastiera, e senza reset lo user agent gli dipinge `ButtonFace` piu'
	   un bordo `outset`, tingendo di grigio tutta la finestra. */
	.order-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-backdrop);
		background: transparent;
		border: none;
		padding: 0;
		cursor: default;
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

	/* Progetto aperto: fondo neutro e nome rivelato. Nessun riempimento saturo,
	   e il nome dentro la tessera rende inutile il titolo al centro. */
	.tab.active {
		background-color: color-mix(in srgb, var(--ink) 8%, transparent);
	}

	.tab.active:hover {
		background-color: color-mix(in srgb, var(--ink) 11%, transparent);
	}

	/* Punto di identita': 8px, sempre presente. E' l'unico posto della barra
	   dove compare la tinta del progetto. */
	.tab-dot {
		width: 8px;
		height: 8px;
		flex: none;
		border-radius: var(--radius-full);
		background-color: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue));
		position: relative;
		z-index: 1;
		transition: background-color var(--dur-calm) var(--ease-out),
		            opacity var(--dur-calm) var(--ease-out);
	}

	.tab-ghost {
		display: flex;
		align-items: center;
		position: relative;
		z-index: 1;
	}

	.tab-code {
		margin-left: var(--space-2);
		color: var(--ink);
		position: relative;
		z-index: 1;
		transition: color var(--dur-calm) var(--ease-out);
	}

	/* Rivelazione: la larghezza automatica si anima passando da 0fr a 1fr, che
	   e' l'unico modo di farlo senza cablare un max-width. Il figlio taglia il
	   contenuto mentre la colonna si stringe. */
	.tab-reveal {
		display: grid;
		grid-template-columns: 0fr;
		opacity: 0;
		position: relative;
		z-index: 1;
		transition: grid-template-columns var(--dur-slow) var(--ease-out),
		            opacity var(--dur-slow) var(--ease-out);
	}

	.tab-reveal.show {
		grid-template-columns: 1fr;
		opacity: 1;
	}

	.tab-reveal-inner {
		display: flex;
		align-items: center;
		min-width: 0;
		overflow: hidden;
	}

	.tab-name {
		margin-left: var(--space-2);
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-weight: 450;
		color: var(--ink-muted);
		transition: color var(--dur-calm) var(--ease-out);
	}

	/* "Sta lavorando" e' un arco che gira, e solo sulla tessera aperta: sulle
	   altre lo dicono il punto pieno e il testo acceso. */
	.tab-spin {
		margin-left: var(--space-2);
		width: 12px;
		height: 12px;
		flex: none;
		border-radius: var(--radius-full);
		border: 1.5px solid transparent;
		border-top-color: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue));
		animation: tab-spin 900ms linear infinite;
	}

	.tab-queue {
		margin-left: var(--space-2);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.tab-queue.ready {
		color: oklch(var(--proj-l-ink) var(--proj-c-ink) var(--proj-hue));
	}

	.tab-queue-dot {
		margin-left: var(--space-2);
		width: 6px;
		height: 6px;
		flex: none;
		border-radius: 1px;
		background-color: var(--ink-faint);
	}

	/* Stato: un anello, mai un alone. L'unico anello che si muove e' quello che
	   chiede una risposta, perche' il movimento serve a chiamare qualcuno e
	   "sta lavorando" non chiama nessuno. */
	.tab.attention::after,
	.tab.finished::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		pointer-events: none;
		z-index: 2;
	}

	.tab.attention::after {
		box-shadow: inset 0 0 0 1.5px var(--warn);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.tab.finished::after {
		box-shadow: inset 0 0 0 1px var(--brand);
	}

	/* Lampo di transizione: rende percepibile un cambio di stato che altrimenti
	   sarebbe solo un'opacita' diversa. */
	.tab-flash {
		position: absolute;
		inset: 0;
		z-index: 0;
		border-radius: inherit;
		pointer-events: none;
		background-color: color-mix(in srgb, oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue)) 35%, transparent);
		animation: tab-flash var(--dur-flash) var(--ease-out) both;
	}

	@keyframes tab-spin {
		to { transform: rotate(360deg); }
	}

	@keyframes tab-flash {
		0%   { opacity: 0; }
		25%  { opacity: 0.9; }
		100% { opacity: 0; }
	}

	/* Senza movimento l'arco si fermerebbe in un punto qualsiasi e sembrerebbe
	   un anello rotto: diventa un anello intero. */
	@media (prefers-reduced-motion: reduce) {
		.tab-spin {
			border-color: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue));
		}
	}

	/* Il divisore serve ancora al menu di ordinamento. */
	.popover-divider {
		height: 1px;
		background: var(--line);
		margin: 4px 0;
	}

	.drag-spacer {
		flex: 1 1 auto;
		min-width: var(--space-3);
		height: 100%;
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
