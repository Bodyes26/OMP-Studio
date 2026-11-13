<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
	import { projectOrder } from '#lib/stores/projectOrder.svelte.ts';
	import { taskStore } from '#lib/stores/tasks.svelte.ts';
	import { settingsStore, type ProjectBarOrder, type SettingsSection } from '#lib/stores/settings.svelte.ts';
	import { filesOnRight } from '#lib/panelGeometry.ts';
	import { themeStore } from '#lib/stores/theme.svelte.ts';
	import { automaticProjectHue, THEMES } from '#lib/theme.ts';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { onMount } from 'svelte';
	import { trapFocus } from '#lib/focusTrap.ts';
	import { IS_MAC, IS_WINDOWS } from '#lib/utils/platform.ts';
	import { quotaStore } from '#lib/stores/quota.svelte.ts';
	import { activeQuotaStore } from '#lib/stores/activeQuota.svelte.ts';
	import QuotaChip from './quota/QuotaChip.svelte';
	import { scheduleStore } from '#lib/stores/schedule.svelte.ts';
	import BrandMark from '#lib/ui/BrandMark.svelte';
	import ProjectPopover from './ProjectPopover.svelte';
	import GitDiffBadge from './GitDiffBadge.svelte';
	import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
	import { perfSpan } from '#lib/perf.ts';
	import {
		gitDiffStore,
		hasGitChanges,
		type GitStatusRefreshDetail
	} from '#lib/stores/gitDiff.svelte.ts';
	import { githubStore } from '#lib/stores/github.svelte.ts';
	import { normalizeProjectPath } from '#lib/stores/projects.svelte.ts';
	import {
		IconChevronDown,
		IconChevronLeft,
		IconChevronRight,
		IconPanelLeftClose,
		IconPanelLeftOpen,
		IconPanelRightClose,
		IconPanelRightOpen,
		IconGhost,
		IconPlus,
		IconQuota,
		IconSettings,
		IconWarning,
		IconLab,
		IconGitBranch,
		IconTrash,
		IconDownload,
		IconFile,
		IconClose,
		IconMore
	} from '#lib/icons.ts';
	import { laneStore, type LaneRecord } from '#lib/stores/lanes.svelte.ts';
	import { MAIN_LANE_ID, type ProjectId, type AgentLane } from '#lib/types/lanes.ts';
	import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
	import { contextMenu, type ContextMenuEntry } from '#lib/contextMenu.svelte.ts';
	import { labApi } from '#lib/lab/api.ts';
	import { openLabEntry, reportLabDeleteFailure } from '#lib/lanes/laneActions.ts';
	import { deleteLabPrototype } from '#lib/lanes/laneLifecycle.ts';
	import { ask } from '@tauri-apps/plugin-dialog';
	import { createAdaptivePoller } from '#lib/utils/windowActivity.svelte.ts';

	let {
		onUsageClick, onNewProject, onSettingsClick, onSetupClick, onQueueClick,
		setupIncomplete = false,
		onRunTask, onEditTask, onNewTask, canRunTask, runReason,
		onRequestCloseProject, onReviewLane
	} = $props<{
		onUsageClick?: (anchor?: HTMLElement | null) => void;
		onNewProject?: () => void;
		onSettingsClick?: (section?: SettingsSection) => void;
		onSetupClick?: () => void;
		onQueueClick?: (anchor?: HTMLElement | null) => void;
		/** Vero quando manca qualcosa perche' la GUI funzioni: il chip di
		 *  setup compare solo allora, e sparisce quando non ha piu' niente da
		 *  dire. */
		setupIncomplete?: boolean;
		onRunTask?: (projectId: string, taskId: string, follow: boolean, newWorktree?: boolean) => boolean | Promise<boolean>;
		onEditTask?: (projectId: string, taskId: string) => void;
		/** Apre l'editor di un task nuovo sul progetto indicato. */
		onNewTask?: (projectId: string) => void;
		canRunTask?: (projectId: string) => boolean;
		runReason?: (projectId: string) => string;
		onRequestCloseProject: (projectId: string) => void;
		onReviewLane: (projectId: string, lane: AgentLane | LaneRecord) => void;
	}>();

	async function handleGhostButtonClick(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		const drafts = await labApi.listIndex(null).catch(() => []);
		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: m.lab_lane_temporary_chat(),
				icon: IconGhost,
				run: () => {
					projectStore.openScratchpad();
				}
			},
			{
				kind: 'item',
				label: m.lab_lane_draft_free(),
				icon: IconLab,
				run: async () => {
					try {
						const entry = await labApi.createPrototype(null);
						await openLabEntry(null, entry);
					} catch (err) {
						console.error('Creazione prototipo libero fallita:', err);
					}
				}
			}
		];
		if (drafts.length > 0) {
			items.push({ kind: 'separator' });
			for (const draft of drafts) {
				const statusLabel =
					draft.status === 'active'
						? m.lab_lane_status_active()
						: m.lab_lane_status_closed();
				items.push({
					kind: 'item',
					label: `${draft.title} (${statusLabel})`,
					icon: IconLab,
					secondaryAction: {
						label: m.lanestrip_action_delete_prototype(),
						icon: IconTrash,
						run: () => void requestDeleteDraft(draft.id, draft.title)
					},
					run: async () => {
						await openLabEntry(null, draft);
					}
				});
			}
		}
		contextMenu.open(event, {
			label: m.topbar_action_scratchpad(),
			items,
			invoker: event.currentTarget as HTMLElement
		});
	}

	// Il menu contestuale non ha una vista di conferma: per un'azione irreversibile
	// basta il dialogo nativo, che resta leggibile anche con il menu gia' chiuso.
	async function requestDeleteDraft(prototypeId: string, title: string) {
		const confirmed = await ask(m.lab_delete_dialog_message({ name: title }), {
			title: m.lab_delete_dialog_title(),
			kind: 'warning',
			okLabel: m.lanestrip_delete_dialog_confirm(),
			cancelLabel: m.lanestrip_delete_dialog_cancel()
		});
		if (!confirmed) return;
		const outcome = await deleteLabPrototype(null, prototypeId);
		if (outcome.kind === 'failed') await reportLabDeleteFailure(outcome.message);
	}

	const PROJECT_BAR_ORDER_OPTIONS = $derived.by((): { value: ProjectBarOrder; label: string }[] => [
		{ value: 'fixed', label: m.topbar_order_fixed() },
		{ value: 'mru', label: m.topbar_order_mru() },
		{ value: 'priority', label: m.topbar_order_priority() },
		{ value: 'alpha', label: m.topbar_order_alpha() }
	]);

	// Lo stato di una tessera e' un anello e un colore: senza queste etichette
	// dentro l'`aria-label` sarebbe un'informazione affidata al solo colore.
	const AGENT_STATE_LABEL = $derived.by((): Record<Project['lane']['agentState'], string> => ({
		idle: m.topbar_agent_state_idle(),
		working: m.topbar_agent_state_working(),
		attention: m.topbar_agent_state_attention(),
		finished: m.topbar_agent_state_finished(),
		unknown: m.topbar_agent_state_unknown()
	}));

	const appWindow = getCurrentWindow();

	/** Il pannello di una tessera: chi lo ospita, a che cosa e' agganciato e se
	 *  e' fissato dal click destro invece di seguire il mouse. */
	interface PanelState {
		projectId: string;
		anchor: HTMLElement;
		pinned: boolean;
		invoker: HTMLElement | null;
	}

	const HOVER_OPEN_MS = 280;
	const HOVER_CLOSE_MS = 160;

	let isMaximized = $state(false);
	let panel = $state<PanelState | null>(null);
	let openTimer: ReturnType<typeof setTimeout> | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	let pointerInsidePanel = false;
	let orderMenuOpen = $state(false);
	// Riordino manuale delle tessere tramite Pointer Events con soglia di resistenza:
	// In WebView2/Chromium sotto Tauri il drag&drop HTML5 nativo viene disabilitato
	// quando e' attivo il drop di file nativi (dragDropEnabled). I pointer events
	// con soglia di movimento evitano falsi avvii su normali clic o micro-movimenti.
	const DRAG_RESISTANCE_PX = 6;
	let dragCandidate = $state<{ id: string; startX: number; startY: number } | null>(null);
	let isDraggingProject = $state(false);
	let draggedProjectId = $state<string | null>(null);
	let dragOverProjectId = $state<string | null>(null);
	let dragOverAfter = $state(false);
	let suppressTabClickUntil = 0;

	$effect(() => {
		if (isDraggingProject) {
			document.body.classList.add('is-dragging-project-tab');
			return () => document.body.classList.remove('is-dragging-project-tab');
		}
	});
	let tabsTrackEl = $state<HTMLElement | null>(null);
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);

	const panelProject = $derived(
		panel ? projectStore.projects.find((candidate) => candidate.id === panel!.projectId) ?? null : null
	);

	// Il pannello sinistro ha due memorie, una per i prototipi e una per il
	// resto: il logo deve mostrare e commutare quella della corsia a schermo.
	const activeLaneKind = $derived(projectStore.activeProject?.lane.kind ?? 'git');
	const isSidebarCollapsed = $derived(
		activeLaneKind === 'lab' ? settingsStore.general.labSidebarCollapsed : settingsStore.general.sidebarCollapsed
	);
	const sidebarOnRight = $derived(filesOnRight(settingsStore.general.columnOrder));

	/** Tessera che tiene il posto della barra nel tab order: e' quella attiva,
	 *  oppure la prima se nessun progetto lo e' (all'avvio, o dopo la chiusura
	 *  dell'ultimo attivo), altrimenti la barra diventerebbe irraggiungibile
	 *  da tastiera. */
	const externalProjects = $derived(projectStore.projects.filter((p) => p.external));
	const isExternalActive = $derived(Boolean(projectStore.activeProject?.external));
	const lastUsedExternal = $derived(
		externalProjects.slice().sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))[0]
	);
	let externalMenuOpen = $state(false);

	function handleExternalTileClick() {
		if (externalProjects.length === 0) return;
		if (externalProjects.length === 1) {
			projectStore.setActive(externalProjects[0].id);
			externalMenuOpen = false;
			return;
		}
		if (!isExternalActive && lastUsedExternal) {
			projectStore.setActive(lastUsedExternal.id);
		}
		externalMenuOpen = !externalMenuOpen;
	}

	const rovingTabId = $derived(
		projectOrder.list.some((candidate) => candidate.id === projectStore.activeId)
			? projectStore.activeId
			: isExternalActive
				? 'external-tab'
				: projectOrder.list[0]?.id ?? (externalProjects.length > 0 ? 'external-tab' : null)
	);

	/** Tooltip e aria-label per la chip impostazioni: se c'e' un avviso di salute
	 *  dei modelli, antepone il riassunto alla descrizione con la scorciatoia. */
	const settingsChipTitle = $derived(
		modelSettingsStore.attentionLevel !== 'none' && modelSettingsStore.attentionTooltip
			? m.ui_topbar_value1_impostazioni_di_studio_ctrl_alt_f8aa({ value1: modelSettingsStore.attentionTooltip })
			: m.ui_topbar_impostazioni_di_studio_ctrl_alt_3e0d()
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

	/**
	 * Aggiorna le statistiche git e upstream di un singolo progetto,
	 * proteggendo l'operazione con soglia temporale e tracciando i tempi.
	 */
	async function refreshTopBarProject(
		project: Project,
		reason: 'interval' | 'focus' | 'visible' | 'event' | 'boot',
		force = false
	) {
		const path = project.lane.kind !== 'lab' ? project.lane.workspacePath : null;
		if (!path) return;

		// Se non e' forzato ed entrambi gli stati sono gia' freschi (< 5 s),
		// saltiamo per evitare spawn git inutili e tracciamento a vuoto.
		if (
			!force &&
			gitDiffStore.wasRefreshedRecently(path, 5000) &&
			githubStore.wasUpstreamRefreshedRecently(path, 5000)
		) {
			return;
		}

		const end = perfSpan('poll', `topbar ${project.name} reason=${reason}`);
		try {
			await Promise.all([
				gitDiffStore.load(path, force),
				githubStore.loadUpstreamStatus(path, force)
			]);
		} finally {
			end();
		}
	}

	// Ricarica il progetto inattivo appena diventa attivo
	let previousActiveId: string | null = null;
	$effect(() => {
		const currentActiveId = projectStore.activeId;
		if (currentActiveId && currentActiveId !== previousActiveId) {
			const isFirstRun = previousActiveId === null;
			previousActiveId = currentActiveId;
			if (!isFirstRun) {
				const proj = projectStore.projects.find((p) => p.id === currentActiveId);
				if (proj) {
					void refreshTopBarProject(proj, 'event');
				}
			}
		}
	});

	const bootedProjects = new Set<string>();

	$effect(() => {
		let cancelled = false;

		// All'avvio: carica subito il progetto attivo
		const activeProj = projectStore.projects.find((p) => p.id === projectStore.activeId);
		if (activeProj && !bootedProjects.has(activeProj.id)) {
			bootedProjects.add(activeProj.id);
			void refreshTopBarProject(activeProj, 'boot', true);
		}

		// Gli altri progetti si caricano in modo scaglionato (uno alla volta, distanziati)
		// per evitare raffiche di spawn git all'avvio dell'applicazione.
		const otherProjects = projectStore.projects.filter(
			(p) =>
				p.id !== projectStore.activeId &&
				p.lane.kind !== 'lab' &&
				p.lane.workspacePath &&
				!bootedProjects.has(p.id)
		);
		// Il progetto si segna come avviato solo quando il suo refresh parte
		// davvero: segnarli tutti subito faceva saltare per sempre quelli
		// rimasti in fila se l'effetto si rieseguiva (cancelled) a meta' giro.
		if (otherProjects.length > 0) {
			void (async () => {
				for (const p of otherProjects) {
					if (cancelled) break;
					await new Promise((resolve) => setTimeout(resolve, 600));
					if (cancelled) break;
					if (bootedProjects.has(p.id)) continue;
					bootedProjects.add(p.id);
					await refreshTopBarProject(p, 'boot', true);
				}
			})();
		}

		const handleGitRefresh = (event: Event) => {
			const projectPath = (event as CustomEvent<GitStatusRefreshDetail>).detail?.projectPath;
			if (projectPath) {
				const proj = projectStore.projects.find(
					(p) =>
						p.lane.workspacePath &&
						normalizeProjectPath(p.lane.workspacePath).toLowerCase() ===
							normalizeProjectPath(projectPath).toLowerCase()
				);
				if (proj) {
					void refreshTopBarProject(proj, 'event', true);
				}
				return;
			}
			// Evento senza percorso: aggiorna subito solo il progetto attivo e marca obsoleti gli altri
			const active = projectStore.projects.find((p) => p.id === projectStore.activeId);
			if (active?.lane.workspacePath) {
				gitDiffStore.markOthersStale(active.lane.workspacePath);
				githubStore.markOtherUpstreamsStale(active.lane.workspacePath);
				void refreshTopBarProject(active, 'event', true);
			}
		};

		// Poller adattivo locale da 15 s: rallenta a 60 s quando la finestra e' visibile
		// ma non a fuoco (es. secondo monitor) per non sprecare spawn git; si sospende
		// del tutto se nascosta e si riaggiorna al rientro a fuoco (cooldown 5 s).
		const poller = createAdaptivePoller({
			focusedIntervalMs: 15_000,
			unfocusedIntervalMs: 60_000,
			cooldownMs: 5_000,
			action: (reason) => {
				const active = projectStore.projects.find((p) => p.id === projectStore.activeId);
				if (active) {
					void refreshTopBarProject(active, reason, false);
				}
			}
		});

		window.addEventListener('git-status-refresh', handleGitRefresh);

		return () => {
			cancelled = true;
			window.removeEventListener('git-status-refresh', handleGitRefresh);
			poller.destroy();
		};
	});


	$effect(() => () => clearTimers());

	/** Il cambio di stato di un agente e' un evento, non soltanto un colore
	 *  diverso: un lampo nella tinta del progetto lo rende percepibile con la
	 *  coda dell'occhio, che e' l'unico modo in cui questa barra viene
	 *  guardata mentre si lavora. */
	function getAggregatedState(p: Project): Project['lane']['agentState'] {
		const projectLanes = laneStore.lanesFor(p.id as ProjectId).filter((l) => l.status !== 'archived' && l.status !== 'closed');
		const sessions = sessionRegistry.getSessionsForProject(p.id);
		const candidateStates: string[] = [];

		if (p.lane.agentState && p.lane.agentState !== 'unknown') {
			candidateStates.push(p.lane.agentState);
		}

		for (const l of projectLanes) {
			if (l.status === 'conflict') {
				candidateStates.push('attention');
			}
			if (l.agentState && l.agentState !== 'unknown') {
				candidateStates.push(l.agentState);
			}
		}

		for (const s of sessions) {
			if (s.agentState && s.agentState !== 'unknown') {
				candidateStates.push(s.agentState);
			}
			if (s.pendingUi) {
				candidateStates.push('attention');
			}
		}

		if (candidateStates.includes('attention')) return 'attention';
		if (candidateStates.includes('working')) return 'working';
		if (candidateStates.includes('finished')) return 'finished';
		if (candidateStates.includes('idle')) return 'idle';
		return p.lane.agentState ?? 'unknown';
	}



	function projectHue(project: Project): number {
		if (!project.canonicalProjectPath || project.colorMode === 'custom') return project.hue;
		return automaticProjectHue(THEMES[themeStore.current], project.canonicalProjectPath);
	}

	/** Tinta che il tema assegnerebbe: serve al selettore per mostrare cosa si
	 *  ottiene tornando alla modalita' automatica. */
	function themeHue(project: Project): number {
		if (!project.canonicalProjectPath) return 0;
		return automaticProjectHue(THEMES[themeStore.current], project.canonicalProjectPath);
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

	function openPanel(projectId: string, anchor: HTMLElement, pinned: boolean, invoker: HTMLElement | null = null) {
		clearTimers();
		pointerInsidePanel = false;
		panel = { projectId, anchor, pinned, invoker };
	}

	function handleTabMenuClick(projectId: string, event: MouseEvent) {
		event.stopPropagation();
		const invoker = event.currentTarget as HTMLElement;
		const anchor = invoker.closest<HTMLElement>('[data-tab-id]');
		if (!anchor) return;
		if (panel?.pinned && panel.projectId === projectId) closePanel(true);
		else openPanel(projectId, anchor, true, invoker);
	}

	function closePanel(returnFocus = false) {
		clearTimers();
		const anchor = panel?.anchor;
		const invoker = panel?.invoker;
		const wasPinned = panel?.pinned ?? false;
		panel = null;
		pointerInsidePanel = false;
		// Il fuoco torna alla tessera solo se era stato spostato: dopo un hover
		// nessuno lo ha mosso, e rubarlo qui interromperebbe la digitazione.
		if (returnFocus && wasPinned) (invoker?.isConnected ? invoker : anchor?.querySelector('button'))?.focus();
	}

	function handleTabPointerEnter(projectId: string, event: PointerEvent) {
		// Solo il mouse apre l'anteprima: con penna o dito non esiste "passare
		// sopra", e il pannello comparirebbe al tocco insieme alla selezione.
		if (event.pointerType !== 'mouse') return;
		if (draggedProjectId || isDraggingProject) return;
		if (panel?.pinned) return;
		const anchor = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-tab-id]');
		if (!anchor) return;
		clearTimers();
		if (panel && !panel.pinned) openPanel(projectId, anchor, false);
		else openTimer = setTimeout(() => openPanel(projectId, anchor, false), HOVER_OPEN_MS);
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

	// Riordino manuale della barra: ha senso solo con order === 'fixed'.
	// Il trascinamento usa Pointer Events per operare stabilmente sotto WebView2/Tauri.
	function handleTabPointerDown(event: PointerEvent, id: string) {
		if (event.button !== 0) return;
		if (settingsStore.projectBar.order !== 'fixed') return;
		dragCandidate = {
			id,
			startX: event.clientX,
			startY: event.clientY
		};
		isDraggingProject = false;
	}

	function handleWindowPointerMove(event: PointerEvent) {
		if (!dragCandidate) return;

		if (!isDraggingProject) {
			const dist = Math.hypot(
				event.clientX - dragCandidate.startX,
				event.clientY - dragCandidate.startY
			);
			if (dist >= DRAG_RESISTANCE_PX) {
				isDraggingProject = true;
				draggedProjectId = dragCandidate.id;
				closePanel();
				clearTimers();
			}
		}

		if (isDraggingProject && draggedProjectId) {
			const el = document.elementFromPoint(event.clientX, event.clientY);
			const targetContainer = el?.closest<HTMLElement>('.tab-container[data-tab-id]');
			const targetId = targetContainer?.dataset.tabId ?? null;

			if (targetId && targetId !== draggedProjectId) {
				dragOverProjectId = targetId;
				const rect = targetContainer!.getBoundingClientRect();
				dragOverAfter = event.clientX > rect.left + rect.width / 2;
			} else {
				dragOverProjectId = null;
				dragOverAfter = false;
			}
		}
	}

	function handleWindowPointerUp(event: PointerEvent) {
		if (!dragCandidate) return;

		if (isDraggingProject && draggedProjectId) {
			if (dragOverProjectId && dragOverProjectId !== draggedProjectId) {
				projectStore.moveProject(draggedProjectId, dragOverProjectId, dragOverAfter ? 'after' : 'before');
			}
			suppressTabClickUntil = Date.now() + 150;
		}

		dragCandidate = null;
		isDraggingProject = false;
		draggedProjectId = null;
		dragOverProjectId = null;
		dragOverAfter = false;
	}

	function handleWindowPointerCancel() {
		dragCandidate = null;
		isDraggingProject = false;
		draggedProjectId = null;
		dragOverProjectId = null;
		dragOverAfter = false;
	}

	function selectProjectOrder(order: ProjectBarOrder) {
		settingsStore.patchProjectBar({ order });
		orderMenuOpen = false;
	}

	function queueBadgeTitle(project: Project, queued: number, ready: boolean): string {
		const base = m.topbar_queue_count_label({ count: queued });
		if (settingsStore.projectBar.queueBadge !== 'count-state') return base;
		return ready ? `${base} · ${m.topbar_queue_ready()}` : `${base} · ${runReason?.(project.id) ?? m.topbar_queue_not_runnable()}`;
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
		// Unica via d'uscita: `close()` passa per `close-requested`, dove la
		// pagina principale salva le code e lascia distruggere la finestra.
		appWindow.close().catch((err) => console.error('Close error:', err));
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (isDraggingProject) {
				dragCandidate = null;
				isDraggingProject = false;
				draggedProjectId = null;
				dragOverProjectId = null;
				dragOverAfter = false;
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


	// Task programmati in attesa nei progetti aperti (Gate R35):
	// contatore con l'orologio sulla chip della quota, niente cruscotti.
	const scheduledSummary = $derived.by(() =>
		scheduleStore.waitingSummary(
			projectStore.projects.flatMap((project) =>
				project.canonicalProjectPath ? taskStore.tasksFor(project.canonicalProjectPath) : []
			)
		)
	);
	const scheduledTip = $derived(
		scheduledSummary.next !== undefined
			? m.schedule_quota_chip_tip({ count: scheduledSummary.count, when: scheduleStore.formatWhen(scheduledSummary.next) })
			: m.schedule_quota_chip_tip_unknown({ count: scheduledSummary.count })
	);
</script>

<svelte:window
	onkeydown={handleKeydown}
	onpointermove={handleWindowPointerMove}
	onpointerup={handleWindowPointerUp}
	onpointercancel={handleWindowPointerCancel}
/>

<header class="topbar" class:mac-chrome={IS_MAC} data-tauri-drag-region="deep">
	<div class="brand-section">
		<button
			type="button"
			class="app-icon-btn"
			class:collapsed={isSidebarCollapsed}
			onclick={(e) => {
				e.stopPropagation();
				settingsStore.toggleSidebar(activeLaneKind);
			}}
			title={isSidebarCollapsed
				? m.ui_topbar_mostra_barra_laterale_ctrl_alt_b_1e8b()
				: m.ui_topbar_nascondi_barra_laterale_ctrl_alt_b_093c()}
			aria-label={isSidebarCollapsed
				? m.ui_topbar_mostra_barra_laterale_ctrl_alt_b_1e8b()
				: m.ui_topbar_nascondi_barra_laterale_ctrl_alt_b_093c()}
			aria-expanded={!isSidebarCollapsed}
		>
			<span class="brand-swap">
				<BrandMark class="brand-logo-img" />
				<span class="brand-toggle-icon" aria-hidden="true">
					{#if sidebarOnRight}
						{#if isSidebarCollapsed}
							<IconPanelRightOpen size={18} />
						{:else}
							<IconPanelRightClose size={18} />
						{/if}
					{:else if isSidebarCollapsed}
						<IconPanelLeftOpen size={18} />
					{:else}
						<IconPanelLeftClose size={18} />
					{/if}
				</span>
			</span>
		</button>
	</div>

	<div class="tabs-nav" data-tauri-drag-region="false" class:is-dragging-tab={isDraggingProject}>
		{#if canScrollLeft}
			<button
				type="button"
				class="tab-scroll-btn left"
				onclick={() => scrollTabs(-180)}
				title={m.topbar_scroll_left()}
				aria-label={m.topbar_scroll_left()}
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
			<div class="tabs" role="tablist" aria-orientation="horizontal" aria-label={m.topbar_open_projects()}>
		{#each projectOrder.list as p (p.id)}
			{@const queued = p.canonicalProjectPath ? taskStore.queuedCountFor(p.canonicalProjectPath) : 0}
			{@const ready = canRunTask?.(p.id) ?? false}
			{@const isActive = projectStore.activeId === p.id}
			{@const showName = isActive || settingsStore.projectBar.label === 'name'}
			{@const queueStyle = settingsStore.projectBar.queueBadge}
			{@const gitDiff = p.lane.kind !== 'lab' && p.lane.workspacePath ? gitDiffStore.forPath(p.lane.workspacePath) : null}
			{@const gitDiffLabel = gitDiff && hasGitChanges(gitDiff) ? ` · Git +${gitDiff.additions} -${gitDiff.deletions}` : ''}
			{@const upstream = p.canonicalProjectPath ? githubStore.upstreamByPath[normalizeProjectPath(p.canonicalProjectPath).toLowerCase()] : null}
			{@const upstreamLabel = (settingsStore.github.showUpstreamBadges && upstream)
				? (upstream.behind > 0 ? m.topbar_upstream_behind_aria({ count: upstream.behind }) : '') +
				  (upstream.ahead > 0 ? m.topbar_upstream_ahead_aria({ count: upstream.ahead }) : '')
				: ''}
			{@const aggState = getAggregatedState(p)}
			{@const secondaryLanes = laneStore.lanesFor(p.id as ProjectId).filter((l) => l.laneId !== MAIN_LANE_ID && l.status !== 'archived' && l.status !== 'closed')}
			{@const gitLanesCount = secondaryLanes.filter((l) => l.kind !== 'lab').length}
			{@const labLanesCount = secondaryLanes.filter((l) => l.kind === 'lab').length}
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
						class:can-reorder={settingsStore.projectBar.order === 'fixed'}
						class:dragging={draggedProjectId === p.id}
						class:drag-over={dragOverProjectId === p.id && draggedProjectId !== null && draggedProjectId !== p.id}
						class:drag-after={dragOverAfter && dragOverProjectId === p.id}
						class:panel-open={panel?.projectId === p.id}
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
					onpointerdown={(event) => handleTabPointerDown(event, p.id)}
					onpointerenter={(event) => handleTabPointerEnter(p.id, event)}
					onpointerleave={handleTabPointerLeave}
					class:active={isActive}
					class:attention={settingsStore.projectBar.showAgentDot && aggState === 'attention'}
					class:finished={settingsStore.projectBar.showAgentDot && aggState === 'finished'}
					class:quiet={aggState === 'idle' || aggState === 'unknown'}
					class:scratchpad={!p.canonicalProjectPath}
					style="--proj-hue: {projectHue(p)}"
					onclick={() => {
						if (Date.now() < suppressTabClickUntil) return;
						closePanel();
						projectStore.setActive(p.id);
					}}
					onkeydown={handleTabKeydown}
					aria-selected={isActive}
					tabindex={p.id === rovingTabId ? 0 : -1}
					aria-label={m.topbar_tab_aria_label({ type: p.labDraft ? m.lab_lane_draft_badge() : p.canonicalProjectPath ? m.topbar_tab_project() : m.topbar_tab_scratchpad(), name: p.name, state: AGENT_STATE_LABEL[aggState], queued: queued > 0 ? ` · ${m.topbar_queue_count_label({ count: queued })}` : '' }) + (gitLanesCount > 0 ? ` · ${m.topbar_tab_aria_worktrees({ count: gitLanesCount })}` : '') + (labLanesCount > 0 ? ` · ${m.topbar_tab_aria_prototypes({ count: labLanesCount })}` : '') + gitDiffLabel + upstreamLabel}
				>

					<span
						class="tab-dot"
						class:working={aggState === 'working'}
						aria-hidden="true"
					></span>
					{#if p.canonicalProjectPath}
						<span class="tab-code">{projectCode(p)}</span>
					{:else if p.labDraft}
						<span class="tab-ghost" aria-hidden="true"><IconLab /></span>
					{:else}
						<span class="tab-ghost" aria-hidden="true"><IconGhost /></span>
					{/if}

					<span class="tab-reveal" class:show={showName}>
						<span class="tab-reveal-inner"><span class="tab-name">{p.name}</span></span>
					</span>

					{#if p.canonicalProjectPath && queueStyle !== 'off'}
						<span class="tab-reveal" class:show={isActive && queued > 0}>
							<span class="tab-reveal-inner">
								{#if queueStyle === 'dot'}
									<span class="tab-queue-dot" aria-hidden="true" title={m.topbar_queue_count_label({ count: queued })}></span>
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
					{#if gitLanesCount > 0}
						<span
							class="tab-lanes-badge"
							aria-hidden="true"
							title={m.topbar_lanes_badge_worktree_title({ count: gitLanesCount })}
						>
							<IconGitBranch />
							<span>{gitLanesCount}</span>
						</span>
					{/if}
					{#if labLanesCount > 0}
						<span
							class="tab-lanes-badge lab"
							aria-hidden="true"
							title={m.topbar_lanes_badge_lab_title({ count: labLanesCount })}
						>
							<IconLab />
							<span>{labLanesCount}</span>
						</span>
					{/if}
					{#if gitDiff && hasGitChanges(gitDiff)}
						<span class="tab-git-diff" aria-hidden="true">
							<GitDiffBadge
								additions={gitDiff.additions}
								deletions={gitDiff.deletions}
								compact
							/>
						</span>
					{/if}
					{#if settingsStore.github.showUpstreamBadges && upstream && (upstream.ahead > 0 || upstream.behind > 0)}
						<span class="tab-upstream" aria-hidden="true">
							{#if upstream.behind > 0}
								<span
									class="upstream-pill behind"
									title={m.topbar_upstream_behind_tooltip({ count: upstream.behind })}
								>
									<IconDownload />
									<span>{upstream.behind}</span>
								</span>
							{/if}
							{#if upstream.ahead > 0}
								<span
									class="upstream-pill ahead"
									title={m.topbar_upstream_ahead_tooltip({ count: upstream.ahead })}
								>
									↑{upstream.ahead}
								</span>
							{/if}
						</span>
					{/if}
				</button>
				<button
					type="button"
					class="tab-menu"
					data-project-menu-trigger
					aria-label={m.project_tabs_core_commands({ name: p.name })}
					aria-haspopup="dialog"
					aria-expanded={panel?.pinned && panel.projectId === p.id}
					tabindex={p.id === rovingTabId ? 0 : -1}
					onpointerdown={(event) => event.stopPropagation()}
					onclick={(event) => handleTabMenuClick(p.id, event)}
				><IconMore /></button>

			</div>
		{/each}

		{#if externalProjects.length > 0}
			<div class="tab-container external-container" role="presentation">
				<button
					class="tab external-tab"
					type="button"
					role="tab"
					class:active={isExternalActive}
					onclick={handleExternalTileClick}
					onkeydown={handleTabKeydown}
					aria-selected={isExternalActive}
					tabindex={rovingTabId === 'external-tab' ? 0 : -1}
					aria-haspopup={externalProjects.length > 1 ? 'menu' : undefined}
					aria-expanded={externalProjects.length > 1 ? externalMenuOpen : undefined}
					aria-label={m.topbar_external_files()}
				>
					<span class="tab-ghost" aria-hidden="true"><IconFile /></span>
					<span class="tab-reveal show">
						<span class="tab-reveal-inner">
							<span class="tab-name">{m.topbar_external_files()}</span>
						</span>
					</span>
					{#if externalProjects.length > 1}
						<span class="external-count-badge">{externalProjects.length}</span>
					{/if}
				</button>

				{#if externalMenuOpen && externalProjects.length > 1}
					<button
						type="button"
						class="order-backdrop"
						onclick={() => (externalMenuOpen = false)}
						aria-label={m.common_close()}
						tabindex="-1"
					></button>
					<div
						class="order-popover rv-lift external-popover"
						role="menu"
						aria-label={m.topbar_external_files()}
						use:trapFocus={{ onEscape: () => (externalMenuOpen = false) }}
					>
						{#each externalProjects as ext (ext.id)}
							{@const isActive = projectStore.activeId === ext.id}
							<div class="external-menu-row" class:active={isActive}>
								<button
									type="button"
									class="order-option external-folder-btn"
									class:active={isActive}
									role="menuitem"
									title={ext.canonicalProjectPath ?? ext.lane.workspacePath ?? ext.name}
									onclick={() => {
										projectStore.setActive(ext.id);
										externalMenuOpen = false;
									}}
								>
									<span class="external-folder-name">{ext.name}</span>
									{#if ext.lane.openFiles.length > 0}
										<span class="external-folder-count">({ext.lane.openFiles.length})</span>
									{/if}
								</button>
								<button
									type="button"
									class="external-close-btn"
									title={m.topbar_close_external_folder()}
									aria-label={m.topbar_close_external_folder()}
									onclick={(e) => {
										e.stopPropagation();
										projectStore.closeProject(ext.id);
										if (projectStore.projects.filter((p) => p.external).length <= 1) {
											externalMenuOpen = false;
										}
									}}
								>
									<IconClose />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
			</div>
		</div>

		{#if canScrollRight}
			<button
				type="button"
				class="tab-scroll-btn right"
				onclick={() => scrollTabs(180)}
				title={m.topbar_scroll_right()}
				aria-label={m.topbar_scroll_right()}
			><IconChevronRight /></button>
		{/if}

		<div class="tabs-actions">
			<button class="tab-add" onclick={() => onNewProject?.()} title={m.topbar_action_new_project()} aria-label={m.topbar_action_new_project()}><IconPlus /></button>
			<button
				type="button"
				class="tab-add"
				onclick={handleGhostButtonClick}
				title={m.topbar_action_scratchpad()}
				aria-label={m.topbar_action_scratchpad()}
			><IconGhost /></button>

			<div class="order-control">
				<button
					type="button"
					class="tab-add"
					onclick={(event) => { event.stopPropagation(); orderMenuOpen = !orderMenuOpen; }}
					title={m.topbar_action_sort_projects()}
					aria-label={m.topbar_action_sort_projects()}
					aria-haspopup="menu"
					aria-expanded={orderMenuOpen}
				><IconChevronDown /></button>
				{#if orderMenuOpen}
					<button type="button" class="order-backdrop" onclick={() => orderMenuOpen = false} aria-label={m.topbar_sort_menu_close()} tabindex="-1"></button>
					<div class="order-popover rv-lift" role="menu" aria-label={m.topbar_sort_menu_title()} use:trapFocus={{ onEscape: () => orderMenuOpen = false }}>
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
						>{m.topbar_all_bar_settings()}</button>
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
				title={m.topbar_setup_chip_title()}
				aria-label={m.topbar_setup_chip_aria()}
			>
				<IconWarning /> Setup
			</button>
		{/if}
		<button
			class="settings-chip"
			class:warn={modelSettingsStore.attentionLevel === 'warn'}
			class:info={modelSettingsStore.attentionLevel === 'info'}
			onclick={(e) => {
				e.stopPropagation();
				if (modelSettingsStore.attentionLevel !== 'none') {
					onSettingsClick?.('models');
				} else {
					onSettingsClick?.();
				}
			}}
			oncontextmenu={(e) => {
				e.preventDefault();
				e.stopPropagation();
				contextMenu.open(e, {
					label: m.ui_settingsmodal_impostazioni_d713(),
					items: [
						{ kind: 'item', label: m.ui_settingsmodal_impostazioni_d713(), run: () => onSettingsClick?.('general'), shortcut: 'Ctrl+Alt+,' },
						{ kind: 'item', label: m.settings_nav_models(), run: () => onSettingsClick?.('models'), shortcut: 'Ctrl+Alt+M' },
						{ kind: 'item', label: m.settings_nav_doctor(), run: () => onSettingsClick?.('doctor'), shortcut: 'Ctrl+Alt+D' }
					]
				});
			}}
			title={settingsChipTitle}
			aria-label={settingsChipTitle}
		>
			<IconSettings /> {m.ui_settingsmodal_impostazioni_d713()}
			{#if modelSettingsStore.attentionLevel === 'warn'}
				<span class="settings-badge warn" aria-hidden="true">!</span>
			{:else if modelSettingsStore.attentionLevel === 'info'}
				<span class="settings-badge info" aria-hidden="true"></span>
			{/if}
		</button>

		<QuotaChip
			showProvider={settingsStore.appearance.quotaChip.showProvider}
			alwaysShowPct={settingsStore.appearance.quotaChip.alwaysShowPct}
			semanticColors={settingsStore.appearance.quotaChip.semanticColors}
			status={activeQuotaStore.info.status}
			remainingPct={activeQuotaStore.info.remainingPct}
			shortName={activeQuotaStore.info.shortName}
			hasLimits={activeQuotaStore.info.hasLimits}
			title={scheduledSummary.count > 0 ? `${activeQuotaStore.info.tooltip}\n${scheduledTip}` : activeQuotaStore.info.tooltip}
			ariaLabel={scheduledSummary.count > 0 ? `${activeQuotaStore.info.tooltip}. ${scheduledTip}` : activeQuotaStore.info.tooltip}
			scheduledCount={scheduledSummary.count}
			longWindowAlert={activeQuotaStore.info.longWindowAlert}
			onclick={(e) => { e.stopPropagation(); onUsageClick?.(e.currentTarget instanceof HTMLElement ? e.currentTarget : null); }}
		/>
		{#if IS_WINDOWS}
			<!-- Su Windows Studio disegna i tre controlli personalizzati;
			     su macOS e Linux le decorazioni sono native per evitare doppie barre. -->
			<div class="window-controls">
				<button class="win-btn" onclick={handleMinimize} title={m.topbar_win_minimize()} aria-label={m.topbar_win_minimize()}>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M3 8h10"/>
					</svg>
				</button>
				<button class="win-btn" onclick={handleToggleMaximize} title={isMaximized ? m.topbar_win_restore() : m.topbar_win_maximize()} aria-label={isMaximized ? m.topbar_win_restore() : m.l10n_cmp_topbar_maximize_aria()}>
					{#if isMaximized}
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M6 3h5a2 2 0 0 1 2 2v5"/>
							<rect x="3" y="6" width="7" height="7" rx="2"/>
						</svg>
					{:else}
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<rect x="3" y="3" width="10" height="10" rx="2.4"/>
						</svg>
					{/if}
				</button>
				<button class="win-btn close" onclick={handleClose} title={m.topbar_win_close()} aria-label={m.topbar_win_close_app_aria()}>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="m4 4 8 8m0-8-8 8"/>
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
		onClose={() => closePanel(true)}
		onHoverChange={handlePanelHoverChange}
		{onRunTask}
		{onEditTask}
		{onNewTask}
		{canRunTask}
		{runReason}
		{onRequestCloseProject}
		onReviewLane={(lane) => onReviewLane(lane.projectId, lane)}
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

	.app-icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 30px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		padding: 2px 4px;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			opacity var(--dur-base) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}

	.app-icon-btn:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.app-icon-btn:active {
		transform: scale(0.92);
	}

	.app-icon-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}

	.app-icon-btn.collapsed {
		opacity: 0.6;
	}

	.app-icon-btn.collapsed:hover {
		opacity: 1;
	}

	/* Il glifo e' 6:5 e pieno fino ai bordi: 18px reggono il peso del vecchio
	   pi a 26px, che aveva aria attorno. */
	.app-icon-btn :global(.brand-logo-img) {
		display: block;
		height: 18px;
		width: auto;
		color: var(--ink);
	}

	/* Al passaggio il logo lascia il posto al glifo della barra laterale:
	   stesso riquadro, nessuno spostamento di layout. */
	.brand-swap {
		position: relative;
		display: grid;
		place-items: center;
	}

	.brand-swap > :global(*) {
		grid-area: 1 / 1;
		transition: opacity var(--dur-fast) var(--ease-out);
	}

	.brand-toggle-icon {
		display: flex;
		color: var(--ink);
		opacity: 0;
	}

	.app-icon-btn:hover :global(.brand-logo-img),
	.app-icon-btn:focus-visible :global(.brand-logo-img) {
		opacity: 0;
	}

	.app-icon-btn:hover .brand-toggle-icon,
	.app-icon-btn:focus-visible .brand-toggle-icon {
		opacity: 1;
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
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: var(--text-xs);
		line-height: 1;
		flex-shrink: 0;
		transition: background-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out),
		            border-color var(--dur-fast) var(--ease-out);
		z-index: 2;
		padding: 0;
	}
	.tab-scroll-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.tab-scroll-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.tab-container {
		position: relative;
		display: flex;
		align-items: center;
	}

	.tab-menu {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		padding: 6px;
		border: 0;
		border-left: 1px solid var(--line);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		flex: none;
		--icon-size: 15px;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}
	.tab-menu:hover,
	.tab-menu[aria-expanded='true'] { background: var(--bg-hover); color: var(--ink); }
	.tab-menu:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

	/* Riordino manuale: la tessera trascinata segnala il punto di sgancio con
	   una barra sottile, mai con un'animazione che distragga. */
	.tab-container.can-reorder .tab {
		cursor: grab;
	}

	.tab-container.can-reorder .tab:active,
	.tab-container.dragging .tab {
		cursor: grabbing;
	}

	.tab-container.dragging {
		opacity: 0.45;
	}

	.tab-container.drag-over::before {
		content: '';
		position: absolute;
		top: 2px;
		bottom: 2px;
		left: -2px;
		width: 2px;
		border-radius: var(--radius-full);
		background-color: var(--line-strong);
		pointer-events: none;
		z-index: 2;
	}

	.tab-container.drag-over.drag-after::before {
		left: auto;
		right: -2px;
	}

	:global(body.is-dragging-project-tab),
	.tabs-nav.is-dragging-tab,
	.tabs-nav.is-dragging-tab * {
		user-select: none !important;
		cursor: grabbing !important;
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

	/* Tessera in focus da tastiera: filetto interno sottile come quello del
	   pannello aperto. L'outline da 2px della regola globale su WebKit (macOS)
	   compare anche dopo il click, perche' il fuoco torna alla tessera da script. */
	.tab:focus-visible,
	.tab-add:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--ink-faint);
	}
	/* La tessera non ha piu' una larghezza massima: si allarga quando il suo
	   progetto viene aperto e si stringe quando un altro prende il posto. Il
	   solo tetto e' sul nome. */
	.tab {
		padding: 0 var(--space-2);
		border-radius: var(--radius-md) 0 0 var(--radius-md);
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
		padding: var(--space-1);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		gap: 2px;
		--dur: var(--dur-menu, 150ms);
		--blur: 3px;
	}

	.order-option {
		display: flex;
		align-items: center;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		font: inherit;
		font-size: var(--text-label);
		padding: 7px 8px;
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.order-option:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.order-option.active {
		background: var(--bg-active);
		color: var(--brand-ink);
		font-weight: 500;
	}

	.external-tab {
		--proj-hue: 200;
	}

	.external-tab.active {
		background-color: var(--bg-hover);
	}

	.external-tab.active:hover {
		background-color: var(--bg-active);
	}

	.external-count-badge {
		font-size: var(--text-xs);
		background: var(--bg-hover);
		color: var(--ink-muted);
		padding: 0 5px;
		border-radius: var(--radius-full);
		margin-left: 4px;
	}

	.external-popover {
		width: 280px;
	}

	.external-menu-row {
		display: flex;
		align-items: center;
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.external-menu-row:hover {
		background: var(--bg-hover);
	}

	.external-menu-row.active {
		background: var(--bg-active);
	}

	.external-folder-btn {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 7px 8px;
		border: none;
		background: transparent;
	}

	.external-folder-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.external-folder-count {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.external-close-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		border-radius: var(--radius-sm);
		margin-right: 4px;
		transition: color var(--dur-fast), background var(--dur-fast);
	}

	.external-close-btn:hover {
		color: var(--danger);
		background: var(--bg-sunken);
	}

	/* Progetto aperto: fondo con tinta leggera del progetto (12%) e nome rivelato.
	   Nessun riempimento saturo pesante ne' bordi/ombre di elevazione. */
	.tab.active {
		background-color: color-mix(in srgb, oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue)) 12%, transparent);
	}

	.tab.active:hover {
		background-color: color-mix(in srgb, oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue)) 18%, transparent);
	}

	.tab.scratchpad.active {
		background-color: var(--bg-hover);
	}

	.tab.scratchpad.active:hover {
		background-color: var(--bg-active);
	}

	/* Punto di identita': 8px, sempre presente. E' l'unico posto della barra
	   dove compare la tinta del progetto piena. Quando l'agente e' al lavoro
	   in background pulsa organicamente con breathing morbido. */
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

	/* Agente al lavoro: il punto diventa un anello con un quarto in tinta
	   del progetto che gira. Stessa forma delle corsie. Occupa 10px con
	   margine negativo, cosi' la tessera non si sposta. */
	.tab-dot.working {
		box-sizing: border-box;
		width: 10px;
		height: 10px;
		margin: -1px;
		background-color: transparent;
		border: 1.5px solid var(--line-strong);
		border-top-color: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue));
		animation: spin 0.9s linear infinite;
	}

	/* Icona del fantasma (scratchpad) o beuta (bozza libera): distanziata
	   dal punto d'identita' come il codice progetto (tab-code), cosi' il
	   segnalino al lavoro, in attenzione o finito non tocca la sagoma. */
	.tab-ghost {
		display: flex;
		align-items: center;
		position: relative;
		z-index: 1;
		transition: color var(--dur-calm) var(--ease-out);
	}

	.tab-dot + .tab-ghost {
		margin-left: var(--space-2);
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

	.tab-queue {
		margin-left: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
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
		border-radius: var(--radius-sm);
		background-color: var(--ink-faint);
	}

	.tab-git-diff {
		display: flex;
		align-items: center;
		margin-left: 6px;
		position: relative;
		z-index: 1;
	}
	.tab-lanes-badge {
		--icon-size: 10px;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		margin-left: var(--space-2);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink-muted);
		background-color: var(--bg-hover);
		border: 1px solid var(--line);
		line-height: 1;
		flex-shrink: 0;
	}

	.tab-lanes-badge :global(svg) {
		width: var(--icon-size, 10px);
		height: var(--icon-size, 10px);
		flex-shrink: 0;
	}
	.tab-lanes-badge + .tab-lanes-badge {
		margin-left: 3px;
	}


	/* Stato: sul punto d'identita', mai sul perimetro della tessera. L'anello
	   attorno al punto non tocca il bordo, quindi non ha angoli da sporcare ne'
	   un filetto da raddoppiare. Si muove solo quello che chiede una risposta:
	   "sta lavorando" non chiama nessuno, "finito" e' un fatto. */
	.tab.attention .tab-dot::after,
	.tab.finished .tab-dot::after {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: var(--radius-full);
		border: 1.5px solid var(--warn);
		pointer-events: none;
	}

	.tab.attention .tab-dot::after {
		animation: breathing-amber-ring var(--dur-breathing, 1.9s) var(--ease-breathing, cubic-bezier(0.4, 0, 0.2, 1)) infinite;
		will-change: opacity;
	}

	.tab.finished .tab-dot::after {
		border-color: var(--ink-faint);
	}

	@media (prefers-reduced-motion: reduce) {
		.tab.attention .tab-dot::after {
			animation: none;
			opacity: 1;
		}
		.tab-dot.working {
			animation: none;
			transform: none;
			opacity: 1;
		}
	}

	:global(:root[data-animations="false"]) .tab.attention .tab-dot::after {
		animation: none;
		opacity: 1;
	}
	:global(:root[data-animations="false"]) .tab-dot.working {
		animation: none;
		transform: none;
		opacity: 1;
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
		height: 28px;
		padding: 0 8px;
		font-size: var(--text-caption);
		border-radius: var(--radius-md);
		cursor: pointer;
		margin-right: var(--space-2);
		transition: background-color var(--dur-fast) var(--ease-out),
		            border-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out);
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.settings-chip:hover {
		color: var(--ink);
		border-color: var(--brand);
		background: var(--bg-hover);
	}

	/* Stato di attenzione per la salute dei modelli: coerente con .setup-chip */
	.settings-chip.warn {
		border-color: var(--warn-dim);
		color: var(--warn);
	}

	.settings-chip.warn:hover {
		border-color: var(--warn);
		background: var(--bg-hover);
	}

	.settings-chip.info {
		border-color: var(--brand-dim);
		color: var(--ink);
	}

	.settings-chip.info:hover {
		border-color: var(--brand);
		background: var(--bg-hover);
	}


	.settings-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.settings-badge.warn {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--warn);
		line-height: 1;
	}

	.settings-badge.info {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--brand);
	}

	/* Il solo chip che ha diritto di usare l'ambra: dice che una cosa manca,
	   ed e' anche il solo che compare e sparisce da solo. */
	.setup-chip {
		background: transparent;
		border: 1px solid var(--warn-dim);
		color: var(--warn);
		height: 28px;
		padding: 0 8px;
		font-size: var(--text-caption);
		border-radius: var(--radius-md);
		cursor: pointer;
		margin-right: var(--space-2);
		transition: background-color var(--dur-fast) var(--ease-out),
		            border-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out);
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.setup-chip:hover {
		border-color: var(--warn);
		background: var(--bg-hover);
	}

	.controls :global(.quota-chip) {
		/* L'allineamento riguarda la barra principale, non la chip del Companion. */
		height: 28px;
		padding: 0 8px;
		margin-right: var(--space-3);
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
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.win-btn:hover {
		background-color: var(--bg-hover);
		color: var(--ink);
	}

	.win-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.win-btn.close:hover {
		background-color: var(--danger);
		color: var(--on-danger);
	}

	.tab-upstream {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		margin-left: 2px;
	}

	.upstream-pill {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		line-height: 1;
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.upstream-pill :global(svg) {
		width: 9px;
		height: 9px;
		flex-shrink: 0;
	}

	.upstream-pill.behind {
		background: color-mix(in srgb, var(--brand) 12%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 28%, transparent);
	}

	.upstream-pill.ahead {
		background: color-mix(in srgb, var(--brand) 12%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 28%, transparent);
	}
</style>
