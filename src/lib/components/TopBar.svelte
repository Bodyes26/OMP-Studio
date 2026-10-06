<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { projectStore, type Project } from '$lib/stores/projects.svelte';
	import { projectOrder } from '$lib/stores/projectOrder.svelte';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { settingsStore, type ProjectBarOrder, type SettingsSection } from '$lib/stores/settings.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { automaticProjectHue, THEMES, anchorsFor } from '$lib/theme';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { onMount } from 'svelte';
	import { trapFocus } from '$lib/focusTrap';
	import { IS_MAC, IS_WINDOWS } from '$lib/utils/platform';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import { activeQuotaStore } from '$lib/stores/activeQuota.svelte';
	import QuotaChip from './quota/QuotaChip.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import ProjectPopover from './ProjectPopover.svelte';
	import GitDiffBadge from './GitDiffBadge.svelte';
	import { companionStore } from '$lib/stores/companion.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { perfSpan } from '$lib/perf';
	import {
		gitDiffStore,
		hasGitChanges,
		type GitStatusRefreshDetail
	} from '$lib/stores/gitDiff.svelte';
	import { githubStore } from '$lib/stores/github.svelte';
	import { normalizeProjectPath } from '$lib/stores/projects.svelte';
	import {
		IconChevronDown,
		IconChevronLeft,
		IconChevronRight,
		IconGhost,
		IconPlus,
		IconPin,
		IconQuota,
		IconSettings,
		IconWarning,
		IconLab,
		IconGitBranch,
		IconTrash,
		IconDownload
	} from '$lib/icons';
	import { laneStore } from '$lib/stores/lanes.svelte';
	import { MAIN_LANE_ID, type ProjectId } from '$lib/types/lanes';
	import { sessionRegistry } from '$lib/agent/sessionRegistry';
	import { contextMenu, type ContextMenuEntry } from '$lib/contextMenu.svelte';
	import { labApi } from '$lib/lab/api';
	import { openLabEntry, reportLabDeleteFailure } from '$lib/lanes/laneActions';
	import { deleteLabPrototype } from '$lib/lanes/laneLifecycle';
	import { ask } from '@tauri-apps/plugin-dialog';

	let {
		onUsageClick, onNewProject, onSettingsClick, onSetupClick, onQueueClick,
		setupIncomplete = false,
		onRunTask, onEditTask, onNewTask, canRunTask, runReason,
		onRequestCloseProject, onOpenFile
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
		onRunTask?: (projectId: string, taskId: string, follow: boolean) => void;
		onEditTask?: (projectId: string, taskId: string) => void;
		/** Apre l'editor di un task nuovo sul progetto indicato. */
		onNewTask?: (projectId: string) => void;
		canRunTask?: (projectId: string) => boolean;
		runReason?: (projectId: string) => string;
		onRequestCloseProject?: (projectId: string) => void;
		/** Apre nell'editor un file menzionato nei task del popover di progetto. */
		onOpenFile?: (projectId: string, relPath: string) => void;
	}>();

	async function handleGhostButtonClick(event: MouseEvent) {
		if (!settingsStore.general.labAlphaEnabled) {
			projectStore.openScratchpad();
			return;
		}
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

	const panelProject = $derived(
		panel ? projectStore.projects.find((candidate) => candidate.id === panel!.projectId) ?? null : null
	);

	// Il pannello sinistro ha due memorie, una per i prototipi e una per il
	// resto: il logo deve mostrare e commutare quella della corsia a schermo.
	const activeLaneKind = $derived(projectStore.activeProject?.lane.kind ?? 'git');
	const isSidebarCollapsed = $derived(
		activeLaneKind === 'lab' ? settingsStore.general.labSidebarCollapsed : settingsStore.general.sidebarCollapsed
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
		for (const p of otherProjects) {
			bootedProjects.add(p.id);
		}
		if (otherProjects.length > 0) {
			void (async () => {
				for (const p of otherProjects) {
					if (cancelled) break;
					await new Promise((resolve) => setTimeout(resolve, 600));
					if (cancelled) break;
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

		// Focus della finestra: aggiorna SOLO il progetto attivo, con soglia minima di 5 s
		const handleFocus = () => {
			const active = projectStore.projects.find((p) => p.id === projectStore.activeId);
			if (active) {
				void refreshTopBarProject(active, 'focus', false);
			}
		};

		// Cambio visibilita': al rientro visibile aggiorna una sola volta il progetto attivo
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				const active = projectStore.projects.find((p) => p.id === projectStore.activeId);
				if (active) {
					void refreshTopBarProject(active, 'visible', false);
				}
			}
		};

		// Poller ogni 15 s: ignora i tick se la finestra e' minimizzata o nascosta
		const interval = window.setInterval(() => {
			if (document.visibilityState === 'hidden') return;
			const active = projectStore.projects.find((p) => p.id === projectStore.activeId);
			if (active) {
				void refreshTopBarProject(active, 'interval', false);
			}
		}, 15_000);

		window.addEventListener('git-status-refresh', handleGitRefresh);
		window.addEventListener('focus', handleFocus);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			cancelled = true;
			window.removeEventListener('git-status-refresh', handleGitRefresh);
			window.removeEventListener('focus', handleFocus);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			clearInterval(interval);
		};
	});

	// Lifecycle remoto separato (non interferisce con il polling locale da 15 s)
	const openRealCanonicalPaths = $derived.by(() => {
		const paths: string[] = [];
		const seen = new Set<string>();
		for (const p of projectStore.projects) {
			if (!p.labDraft && p.canonicalProjectPath) {
				const norm = normalizeProjectPath(p.canonicalProjectPath).toLowerCase();
				if (!seen.has(norm)) {
					seen.add(norm);
					paths.push(p.canonicalProjectPath);
				}
			}
		}
		return paths;
	});

	// Firma stabile derivata dei percorsi canonici per evitare riavvii
	// dell'effetto quando mutano proprietà reattive (sync, notifiche, agentState, ecc.)
	const openCanonicalPathsKey = $derived(
		openRealCanonicalPaths
			.map((p) => normalizeProjectPath(p).toLowerCase())
			.sort()
			.join('|')
	);

	$effect(() => {
		const isReady = settingsStore.ready;
		const autoFetchEnabled = settingsStore.github.autoFetch;
		const pathsKey = openCanonicalPathsKey;

		if (!isReady || !autoFetchEnabled || !pathsKey) {
			return;
		}

		let cancelled = false;
		let isSweeping = false;

		async function runSweep() {
			if (cancelled || isSweeping || !settingsStore.ready || !settingsStore.github.autoFetch) {
				return;
			}
			isSweeping = true;
			try {
				const targets = [...openRealCanonicalPaths];
				for (const targetPath of targets) {
					if (cancelled || !settingsStore.github.autoFetch) break;
					// Ri-verifica l'appartenenza ai progetti aperti prima di ogni percorso
					const stillOpen = projectStore.projects.some(
						(p) =>
							!p.labDraft &&
							p.canonicalProjectPath &&
							normalizeProjectPath(p.canonicalProjectPath).toLowerCase() ===
								normalizeProjectPath(targetPath).toLowerCase()
					);
					if (!stillOpen) continue;
					try {
						await githubStore.checkRemote(targetPath);
					} catch (err) {
						console.error('githubStore.checkRemote failed for', targetPath, err);
					}
				}
			} finally {
				isSweeping = false;
			}
		}

		// 1. All'avvio e ad ogni apertura/chiusura che altera la firma dei percorsi
		void runSweep();

		// 2. Ogni 5 minuti, anche con applicazione in secondo piano/nascosta
		const interval = window.setInterval(() => {
			void runSweep();
		}, 5 * 60_000);

		// 3. Al ritorno del focus o della visibilità (con rate limit gestito nello store)
		const handleFocus = () => {
			void runSweep();
		};
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				void runSweep();
			}
		};

		window.addEventListener('focus', handleFocus);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			cancelled = true;
			clearInterval(interval);
			window.removeEventListener('focus', handleFocus);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
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
	function handleProjectDragStart(event: DragEvent, id: string) {
		if (settingsStore.projectBar.order !== 'fixed') return;
		closePanel();
		draggedProjectId = id;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', id);
		}
	}

	function handleProjectDragOver(event: DragEvent, id: string) {
		if (settingsStore.projectBar.order !== 'fixed' || !draggedProjectId) return;
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		dragOverProjectId = id;
	}

	function handleProjectDragLeave(id: string) {
		if (dragOverProjectId === id) dragOverProjectId = null;
	}

	function handleProjectDrop(event: DragEvent, id: string) {
		event.preventDefault();
		const sourceId = draggedProjectId || event.dataTransfer?.getData('text/plain');
		if (sourceId && sourceId !== id) projectStore.moveProject(sourceId, id);
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
			<img
				src={isLightTheme ? '/logo-topbar-light.png' : '/logo-topbar.png'}
				alt="OMP Studio"
				class="brand-logo-img"
			/>
		</button>
	</div>

	<div class="tabs-nav">
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
						class:dragging={draggedProjectId === p.id}
						class:drag-over={dragOverProjectId === p.id && draggedProjectId !== null && draggedProjectId !== p.id}
						class:panel-open={panel?.projectId === p.id}
						draggable={settingsStore.projectBar.order === 'fixed'}
						ondragover={(event) => handleProjectDragOver(event, p.id)}
						ondragleave={() => handleProjectDragLeave(p.id)}
						ondrop={(event) => handleProjectDrop(event, p.id)}
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
					draggable={settingsStore.projectBar.order === 'fixed'}
					ondragstart={(event) => handleProjectDragStart(event, p.id)}
					ondragend={handleProjectDragEnd}
					class:active={isActive}
					class:attention={settingsStore.projectBar.showAgentDot && aggState === 'attention'}
					class:finished={settingsStore.projectBar.showAgentDot && aggState === 'finished'}
					class:quiet={aggState === 'idle' || aggState === 'unknown'}
					class:scratchpad={!p.canonicalProjectPath}
					style="--proj-hue: {projectHue(p)}"
					onclick={() => projectStore.setActive(p.id)}
					onkeydown={handleTabKeydown}
					aria-selected={isActive}
					tabindex={p.id === rovingTabId ? 0 : -1}
					aria-haspopup="dialog"
					aria-label={m.topbar_tab_aria_label({ type: p.labDraft ? m.lab_lane_draft_badge() : p.canonicalProjectPath ? m.topbar_tab_project() : m.topbar_tab_scratchpad(), name: p.name, state: AGENT_STATE_LABEL[aggState], queued: queued > 0 ? ` · ${queued} task in coda` : '' }) + (gitLanesCount > 0 ? ` · ${gitLanesCount} worktree` : '') + (labLanesCount > 0 ? ` · ${labLanesCount} prototipi` : '') + gitDiffLabel + upstreamLabel}
				>

					{#if p.canonicalProjectPath}
						<span
							class="tab-dot"
							class:working={aggState === 'working'}
							aria-hidden="true"
						></span>
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

			</div>
		{/each}
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
					label: 'Impostazioni',
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

		<button
			class="settings-chip companion-chip"
			class:active={companionStore.isPinned}
			onclick={(e) => { e.stopPropagation(); void companionStore.toggleCompanion(); }}
			title={m.topbar_companion_chip_title()}
			aria-label="Finestra Companion (Alt+Spazio)"
		>
			<IconPin /> Companion
		</button>


		{#if taskStore.totalQueued > 0}
			<Tooltip text={m.topbar_queue_chip_title()} placement="bottom">
			<button
				class="queue-chip"
				onclick={(e) => { e.stopPropagation(); onQueueClick?.(e.currentTarget); }}
				aria-label={m.topbar_queue_chip_aria({ count: taskStore.totalQueued })}
			>
				Coda ({taskStore.totalQueued})
			</button>
			</Tooltip>
		{/if}
		<QuotaChip
			showProvider={settingsStore.appearance.quotaChip.showProvider}
			alwaysShowPct={settingsStore.appearance.quotaChip.alwaysShowPct}
			semanticColors={settingsStore.appearance.quotaChip.semanticColors}
			status={activeQuotaStore.info.status}
			remainingPct={activeQuotaStore.info.remainingPct}
			shortName={activeQuotaStore.info.shortName}
			hasLimits={activeQuotaStore.info.hasLimits}
			title={activeQuotaStore.info.tooltip}
			ariaLabel={activeQuotaStore.info.tooltip}
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
				<button class="win-btn" onclick={handleToggleMaximize} title={isMaximized ? m.topbar_win_restore() : m.topbar_win_maximize()} aria-label={isMaximized ? m.ui_topbar_ripristina_finestra_a21a() : "Ingrandisci finestra"}>
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
		otherProjectCount={projectStore.projects.length - 1}
		onClose={() => closePanel(true)}
		onHoverChange={handlePanelHoverChange}
		{onRunTask}
		{onEditTask}
		{onNewTask}
		onQueueClick={() => onQueueClick?.(null)}
		{canRunTask}
		{runReason}
		{onRequestCloseProject}
		{onOpenFile}
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

	.brand-logo-img {
		height: 26px;
		width: auto;
		object-fit: contain;
		transition:
			filter var(--dur-base) var(--ease-out),
			opacity var(--dur-base) var(--ease-out);
	}

	.app-icon-btn.collapsed .brand-logo-img {
		filter: grayscale(0.2);
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

	/* Riordino manuale: la tessera trascinata segnala il punto di sgancio con
	   una barra sottile, mai con un'animazione che distragga. */
	.tab[draggable="true"],
	.tab-container[draggable="true"] .tab {
		cursor: grab;
	}

	.tab[draggable="true"]:active,
	.tab-container[draggable="true"] .tab:active {
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

	.tab:focus-visible,
	.tab-add:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
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

	.tab-dot.working {
		animation: dot-breathing 1.6s ease-in-out infinite;
	}

	@keyframes dot-breathing {
		0%, 100% {
			transform: scale(0.85);
			opacity: 0.65;
		}
		50% {
			transform: scale(1.15);
			opacity: 1;
		}
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
		animation: breathing-amber-ring var(--dur-breathing, 1.9s) var(--ease-breathing, cubic-bezier(0.4, 0, 0.2, 1)) infinite;
		will-change: opacity, box-shadow;
	}

	.tab.finished::after {
		box-shadow: inset 0 0 0 1.5px var(--warn);
	}


	@media (prefers-reduced-motion: reduce) {
		.tab.attention::after {
			animation: none;
			opacity: 1;
			box-shadow: inset 0 0 0 1.5px var(--warn);
		}
		.tab-dot.working {
			animation: none;
			transform: none;
			opacity: 1;
		}
	}

	:global(:root[data-animations="false"]) .tab.attention::after {
		animation: none;
		opacity: 1;
		box-shadow: inset 0 0 0 1.5px var(--warn);
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

	.companion-chip.active {
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line-strong));
		background: color-mix(in oklch, var(--brand) 12%, transparent);
	}

	.queue-chip {
		background: transparent;
		border: 1px solid var(--brand-dim);
		color: var(--brand-ink);
		height: 28px;
		padding: 0 8px;
		font-size: var(--text-caption);
		border-radius: var(--radius-md);
		cursor: pointer;
		margin-right: var(--space-2);
		transition: background-color var(--dur-fast) var(--ease-out),
		            border-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out);
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
		outline-offset: 2px;
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
