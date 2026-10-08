<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { attachEditorContext } from '$lib/editor/editorContext';
	import { perfMark } from '$lib/perf';
	import { promptBus } from '$lib/agent/promptBus';
	import Terminal from '$lib/terminal/Terminal.svelte';
	import TerminalStopButton from '$lib/terminal/TerminalStopButton.svelte';
	import type { TerminalStopControl } from '$lib/terminal/stopControl.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import Chat from '$lib/agent/components/Chat.svelte';
	import { AgentSession } from '$lib/agent/session.svelte';
	import { laneSessionKey, sessionRegistry, type UiResponsePayload } from '$lib/agent/sessionRegistry';
	import type { RpcCommand, ThinkingLevel } from '$lib/agent/wire';
	import ImageModal from '$lib/agent/components/ImageModal.svelte';
	import { IconNewChat, IconCircleAlert, IconClose } from '$lib/icons';
	import TopBar from '$lib/components/TopBar.svelte';
	import FileTree from '$lib/components/FileTree.svelte';
	import type EditorSurface from '$lib/editor/Editor.svelte';
	import AgentPanel from '$lib/components/AgentPanel.svelte';
	import ColumnTabs from '$lib/ui/ColumnTabs.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
	import { rvLift } from '$lib/agent/motion';
	import UsagePopover, { type ProviderHost } from '$lib/components/UsagePopover.svelte';
	import ProjectPicker from '$lib/components/ProjectPicker.svelte';
	import GitPanel from '$lib/components/GitPanel.svelte';
	import DiagramViewer from '$lib/components/DiagramViewer.svelte';
	import PreviewViewer from '$lib/components/PreviewViewer.svelte';
	import BrowserViewer from '$lib/components/BrowserViewer.svelte';
	import StudioUpdateModal from '$lib/components/StudioUpdateModal.svelte';
	import SettingsModal from '$lib/components/settings/SettingsModal.svelte';
	import CloseConfirmModal, { type ProjectCloseTarget } from '$lib/components/CloseConfirmModal.svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import QueueDrawer from '$lib/components/QueueDrawer.svelte';
	import SetupModal from '$lib/components/SetupModal.svelte';
	import ShortcutsHelpModal from '$lib/agent/components/ShortcutsHelpModal.svelte';
	import { shortcutsModalStore } from '$lib/stores/shortcutsModal.svelte';
	import { isShortcutsHelpKey, isProjectCycleShortcut } from '$lib/shortcuts/shortcutMatch';
	import TaskEditor from '$lib/components/TaskEditor.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { studioUpdaterStore, formatVersion } from '$lib/stores/studioUpdater.svelte';
	import { ompVersionStore } from '$lib/stores/ompVersion.svelte';
	import { ompChangelogStore } from '$lib/stores/ompChangelog.svelte';
	import OmpChangelogModal from '$lib/components/OmpChangelogModal.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { parseRoleSelector, resolveActiveRole, nextCycleRole } from '$lib/stores/modelSettingsHelpers';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { projectOrder } from '$lib/stores/projectOrder.svelte';
	import { notificationManager } from '$lib/stores/notifications.svelte';
	import { companionStore, type CompanionProjectRuntime } from '$lib/stores/companion.svelte';
	import { buildAttentionRequest } from '$lib/stores/companionAttention';
	import { askQuestionText } from '$lib/agent/askTitle';
	import { activeQuotaStore } from '$lib/stores/activeQuota.svelte';
	import { resolveAutomationGate, type AutomationGate } from '$lib/agent/automationGate';
	import { quotaStore, providersMatch } from '$lib/stores/quota.svelte';
	import { onDestroy } from 'svelte';
	import { normalizeProjectPath, projectStore, type AgentState, type Project } from '$lib/stores/projects.svelte';
	import { taskStore, formatTaskPrompt, type StudioTask, type TaskRunLaneContext } from '$lib/stores/tasks.svelte';
	import { taskLabel } from '$lib/stores/taskTitle';
	import { laneStore, type LaneRecord } from '$lib/stores/lanes.svelte';
	import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
	import { describeLaneProcess } from '$lib/lanes/processSupervisor';
	import { laneBranchDeleteArgs } from '$lib/lanes/laneCleanup';
	import {
		buildConcurrencyWarning,
		decideAutoDispatch,
		decideQueueRoute,
		resolveQueueRoot,
		type ConcurrencyWarning
	} from '$lib/lanes/queueDispatch';
	import LaneStrip from '$lib/components/LaneStrip.svelte';
	import LaneDispatchDialog from '$lib/components/LaneDispatchDialog.svelte';
	import LaneProfileDialog from '$lib/components/LaneProfileDialog.svelte';
	import LaneReviewModal from '$lib/components/LaneReviewModal.svelte';
	import { laneLanding, type LaneBridgeRequestPayload } from '$lib/lanes/laneLanding.svelte';
	import {
		recordAllowlistDecision,
		reviewProjectProfile,
		type ProjectProfileReview
	} from '$lib/lanes/laneProfile';
	import { MAIN_LANE_ID, type AgentLane, type ProjectId } from '$lib/types/lanes';
	import {
		laneSurfaceStore,
		type LaneDiagramPayload,
		type LanePreviewPayload
	} from '$lib/stores/laneSurfaces.svelte';
	import LabPreview from '$lib/lab/LabPreview.svelte';
	import { openLabEntry } from '$lib/lanes/laneActions';
	import { labApi } from '$lib/lab/api';
	import type { TerminalSessionInfo } from '$lib/terminal/terminal';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { onMount, untrack } from 'svelte';
	import { startFocusTracer } from '$lib/focusTracer';

	let leftSection = $state<'files' | 'git' | 'agent'>('files');
	const currentLaneSurface = $derived.by(() => {
		const proj = projectStore.activeProject;
		if (!proj) {
			return { surface: 'editor' as const, diagramPayload: null, previewFile: null };
		}
		return laneSurfaceStore.getLaneSurface(proj.id, proj.lane.laneId);
	});
	const diagramOpen = $derived(currentLaneSurface.surface === 'diagram');
	const previewFile = $derived(currentLaneSurface.surface === 'preview' ? currentLaneSurface.previewFile : null);
	const browserOpen = $derived(currentLaneSurface.surface === 'browser');

	function closeActiveSurface() {
		const proj = projectStore.activeProject;
		if (proj) {
			laneSurfaceStore.closeLaneSurface(proj.id, proj.lane.laneId);
		}
	}

	function openPreview(filePath: string) {
		const proj = projectStore.activeProject;
		if (proj) {
			laneSurfaceStore.setLanePreview(proj.id, proj.lane.laneId, filePath);
		}
	}
	let labCenterView = $state<'preview' | 'editor'>('preview');
	const isLabLane = $derived(projectStore.activeProject?.lane.kind === 'lab');

	/**
	 * Con il Laboratorio spento la scorciatoia porta all'interruttore che lo
	 * accende: un tasto che non fa nulla non dice all'utente cosa manca.
	 */
	function openLabFlagSetting() {
		settingsStore.openSection('general');
		let attempts = 0;
		const focusSwitch = () => {
			const target = document.getElementById('settings-lab-alpha');
			if (target) {
				target.scrollIntoView({ block: 'center' });
				target.focus({ preventScroll: true });
				return;
			}
			// La modale monta la sezione al frame successivo: pochi tentativi bastano.
			if (++attempts < 20) requestAnimationFrame(focusSwitch);
		};
		requestAnimationFrame(focusSwitch);
	}

	async function handleNewFreeDraft() {
		try {
			const entry = await labApi.createPrototype(null);
			await openLabEntry(null, entry);
		} catch (err) {
			console.error('Creazione prototipo libero fallita:', err);
		}
	}
	let agentAnnouncement = $state('');
	const prevAgentStates = new Map<string, string>();
	let announcementQueue: Array<{ name: string; state: string }> = [];
	let announcementTimer: ReturnType<typeof setTimeout> | null = null;

	function flushAnnouncements() {
		if (announcementQueue.length === 0) return;
		const queue = announcementQueue;
		announcementQueue = [];
		announcementTimer = null;

		if (queue.length === 1) {
			const item = queue[0];
			if (item.state === 'working') {
				agentAnnouncement = m.page_agent_announcement_working({ name: item.name });
			} else if (item.state === 'attention') {
				agentAnnouncement = m.page_agent_announcement_attention({ name: item.name });
			} else if (item.state === 'finished') {
				agentAnnouncement = m.page_agent_announcement_finished({ name: item.name });
			}
			return;
		}

		const byState: Record<string, string[]> = {};
		for (const item of queue) {
			if (!byState[item.state]) byState[item.state] = [];
			if (!byState[item.state].includes(item.name)) {
				byState[item.state].push(item.name);
			}
		}

		const parts: string[] = [];
		if (byState['attention']?.length) {
			parts.push(
				m.page_agent_announcement_many_attention({
					count: byState['attention'].length,
					names: byState['attention'].join(', ')
				})
			);
		}
		if (byState['finished']?.length) {
			parts.push(
				m.page_agent_announcement_many_finished({
					count: byState['finished'].length,
					names: byState['finished'].join(', ')
				})
			);
		}
		if (byState['working']?.length) {
			parts.push(
				m.page_agent_announcement_many_working({
					count: byState['working'].length,
					names: byState['working'].join(', ')
				})
			);
		}

		if (parts.length > 0) {
			agentAnnouncement = parts.join(' · ');
		}
	}

	function queueAnnouncement(name: string, state: string) {
		announcementQueue.push({ name, state });
		if (!announcementTimer) {
			announcementTimer = setTimeout(flushAnnouncements, 150);
		}
	}
	/**
	 * L'editor porta con se' Monaco: da solo pesa quanto tutto il resto del
	 * guscio. Un import statico lo metterebbe davanti al primo frame, quindi qui
	 * il caricamento e' dinamico di proposito: la finestra si disegna e l'editor
	 * entra subito dopo.
	 */
	let EditorComponent = $state<typeof EditorSurface | null>(null);
	$effect(() => {
		if (EditorComponent) return;
		void import('$lib/editor/Editor.svelte').then((module) => {
			EditorComponent = module.default;
		});
	});

	// Apertura automatica della superficie Browser al rilevamento di una tab live (S41)
	$effect(() => {
		for (const p of projectStore.projects) {
			const session = sessionRegistry.getLaneSession(p.id, p.lane.laneId);
			const tabCount = session?.browserLiveTabs.length ?? 0;
			const isEditorActive = Boolean(activeTaskEditor);
			laneSurfaceStore.syncBrowserTabCount(p.id, p.lane.laneId, tabCount, isEditorActive);
		}
	});

	$effect(() => {
		for (const p of projectStore.projects) {
			const prev = prevAgentStates.get(p.id);
			const curr = p.lane.agentState;
			if (prev && prev !== curr) {
				if (curr === 'working' || curr === 'attention' || curr === 'finished') {
					queueAnnouncement(p.name, curr);
				}
			}
			prevAgentStates.set(p.id, curr);
		}
	});
	// L'effetto sopra si riesegue a ogni cambio di stato di un progetto: il
	// suo cleanup cancellava il timer appena accodato e gli annunci raggruppati
	// non partivano mai. Il timer va annullato solo allo smontaggio.
	onDestroy(() => {
		if (announcementTimer) {
			clearTimeout(announcementTimer);
			announcementTimer = null;
		}
	});

	function agentStateLabel(state?: string): string {
		switch (state) {
			case 'working': return m.page_agent_state_working();
			case 'attention': return m.page_agent_state_attention();
			case 'finished': return m.page_agent_state_finished();
			case 'idle': return m.page_agent_state_idle();
			default: return m.page_agent_state_ready();
		}
	}

	// La barra di stato parla della corsia a schermo, non dell'aggregato del
	// progetto: quello resta sulla tessera nella barra progetti.
	const activeLaneState = $derived.by((): AgentState => {
		const project = projectStore.activeProject;
		if (!project) return 'idle';
		const state = laneOrchestrator.laneAgentState(project, project.lane.laneId);
		return state === 'unknown' ? 'idle' : state;
	});

	onMount(() => {
		void startFocusTracer();
		void notificationManager.init();
		laneLanding.init();
		function buildResolutionContext() {
			return {
				projects: projectStore.projects,
				lanes: laneStore.lanes,
				sessions: sessionRegistry.getAllSessions(),
				activeProjectId: projectStore.activeId,
				activeLaneId: projectStore.activeProject?.lane.laneId ?? 'main'
			};
		}

		const unlistenDiagram = listen<LaneDiagramPayload>('diagram://new', (e) => {
			if (!e.payload) return;
			const context = buildResolutionContext();
			laneSurfaceStore.routeDiagramEvent(e.payload, context);
		});

		const unlistenPreview = listen<LanePreviewPayload>('preview://new', (e) => {
			if (!e.payload) return;
			const context = buildResolutionContext();
			laneSurfaceStore.routePreviewEvent(e.payload, context);
		});
		const unlistenBridge = listen<LaneBridgeRequestPayload>('lane-bridge://request', (e) => {
			if (!e.payload) return;
			void laneLanding.handleBridgeRequest(e.payload);
		});

		return () => {
			void unlistenDiagram.then((un) => un());
			void unlistenPreview.then((un) => un());
			void unlistenBridge.then((un) => un());
			laneLanding.dispose();
		};
	});
	let usageOpen = $state(false);
	let usageAnchor = $state<HTMLElement | null>(null);
	let pickerOpen = $state(false);
	// Vista aggregata delle code: serve a vedere in un posto solo su quali
	// progetti c'e' lavoro in attesa, senza aprirli uno a uno.
	let queueOpen = $state(false);
	let queueAnchor = $state<HTMLElement | null>(null);
	// Primo avvio guidato: `contract_check` decide se e da quale carta partire.
	let setupOpen = $state(false);
	let setupStartAt = $state<'install' | 'wizard' | 'project'>('wizard');
	let setupIncomplete = $state(false);

	// Richiesta di apertura diff proveniente dal pannello GIT: porta il file
	// nell'editor gia' in modalita' diff, con la revisione giusta.
	let editorDiffRequest = $state<{
		filePath: string;
		mode: 'working' | 'commit';
		hash?: string;
		id: number;
	} | null>(null);
	let editorDiffRequestId = 0;

	// Ogni chiave identifica una corsia. PTY e GUI sono adapter alternativi
	// della stessa sessione logica e non condividono stato con le altre corsie.
	const terminalSessions = laneOrchestrator.terminalSessions;

	function runtimeKey(project: Project, laneId: string = project.lane.laneId): string {
		return laneOrchestrator.runtimeKey(project.id, laneId);
	}

	function registeredSessionFor(
		project: Project,
		laneId: string = project.lane.laneId
	): AgentSession | undefined {
		return laneOrchestrator.getLaneSession(project.id, laneId);
	}

	function terminalSessionFor(project: Project, laneId: string = project.lane.laneId) {
		return laneOrchestrator.getTerminalSession(runtimeKey(project, laneId));
	}

	sessionRegistry.setFactory((config) => {
		const session = new AgentSession(config);
		// Processo omp morto prima di ricevere il prompt: il task e' gia'
		// uscito dalla coda e il suo testo vive solo nel prompt perduto.
		// Rimetterlo in cima alla coda e' l'unico recupero possibile.
		session.onStartupPromptsDropped = () => {
			if (session.scope !== 'lane' || !session.cwd) return;
			// La coda vive solo nella radice canonica: il cwd di una corsia e' il
			// worktree fratello e non deve mai ricevere un tasks.json.
			const owner = projectStore.projects.find((p) => p.id === session.projectKey);
			if (!owner?.canonicalProjectPath) return;
			void taskStore.restoreDroppedTask(owner.canonicalProjectPath, session.sessionId);
		};
		return session;
	});
	const terminalMeta = laneOrchestrator.terminalMeta;
	const terminalBusy = laneOrchestrator.terminalBusy;
	const switchingSurface = laneOrchestrator.switchingSurface;
	const activeSwitching = $derived(laneOrchestrator.activeSwitching);
	const agentErrors = laneOrchestrator.agentErrors;
	let viewingImage = $state<{ data: string; mimeType: string } | null>(null);
	let taskEditorId = $state<string | null>(null);
	/**
	 * Richiesta di conferma per il routing della coda: `Principale` al lavoro
	 * oppure soft-cap dei tre agenti simultanei superato.
	 */
	let laneDispatchPrompt = $state<{
		projectId: string;
		taskId: string;
		mode: 'busy-main' | 'concurrency';
		taskTitle: string;
		warning: ConcurrencyWarning | null;
		follow: boolean;
		/** Corsia aperta a schermo: l'utente puo' forzare il task li'. */
		forceLane: { laneId: string; title: string } | null;
	} | null>(null);
	/**
	 * Consenso una tantum sui file locali non versionati prima di aprire il
	 * worktree (Gate R27 / PLAN W10). Riguarda solo le corsie chieste
	 * dall'utente: l'auto-avvio non interrompe mai con un dialogo.
	 */
	let laneProfilePrompt = $state<{
		projectId: string;
		taskId: string;
		review: ProjectProfileReview;
		follow: boolean;
	} | null>(null);
	let reviewingLane = $state<AgentLane | LaneRecord | null>(null);

	async function askLaneToResolveConflicts(prompt: string) {
		const project = projectStore.activeProject;
		const lane = reviewingLane;
		if (!project || !lane) return;
		reviewingLane = null;
		await laneLanding.askLaneToResolveConflicts(project.id, lane.laneId, prompt);
	}
	const taskEditor = $derived(taskStore.taskById(taskEditorId));
	const activeTaskEditor = $derived(
		taskEditor
		&& projectStore.activeProject?.canonicalProjectPath
		&& taskEditor.projectPath === normalizeProjectPath(projectStore.activeProject.canonicalProjectPath).toLowerCase()
			? taskEditor
			: undefined
	);

	const guiHosts = $derived.by(() => {
		const list: ProviderHost[] = [];
		for (const session of sessionRegistry.getAllSessions()) {
			// Un progetto o prototipo consuma quota GUI solo se sta effettivamente generando
			// o se ha subagenti in esecuzione in questo momento.
			const isGenerating = session.isStreaming || session.agentState === 'working';
			const activeSubagents = (session.subagents || []).filter(
				(sub) => sub.status === 'running'
			);

			if (!isGenerating && activeSubagents.length === 0) {
				continue;
			}

			const project = projectStore.projects.find(
				(p) => p.id === session.projectKey || p.lane.workspacePath === session.cwd
			);
			const projectName = project?.label?.trim() || project?.name || 'Progetto';
			const projectPath = project?.canonicalProjectPath ?? session.cwd;
			// 1. Modello primario attivo nella sessione GUI (solo se sta generando)
			if (isGenerating && session.model) {
				let provider = session.model.provider || '';
				let modelId = session.model.id || session.model.name || '';
				if (!provider && modelId.includes('/')) {
					const parts = modelId.split('/');
					provider = parts[0];
					modelId = parts.slice(1).join('/');
				}
				if (provider) {
					list.push({
						provider,
						model: modelId,
						host: 'OMP Studio',
						project: projectName,
						project_path: projectPath,
						last_active_ms: Date.now()
					});
				}
			}

			// 2. Eventuali subagenti attualmente in esecuzione
			for (const sub of activeSubagents) {
				if (sub.resolvedModel) {
					const parts = sub.resolvedModel.split('/');
					if (parts.length >= 2) {
						list.push({
							provider: parts[0],
							model: parts.slice(1).join('/'),
							host: 'OMP Studio',
							project: projectName,
							project_path: projectPath,
							last_active_ms: Date.now()
						});
					}
				}
			}
		}
		return list;
	});
	// Memoizzazione dei pin credenziali per le sessioni per non invocare ad ogni tick dell'effetto
	let sessionPinsCache = $state<Record<string, Record<string, string>>>({});
	const sessionPinsInFlight = new Set<string>();
	const prevGeneratingBySession = new Map<string, boolean>();
	let postGenerationQuotaDebounceTimer: number | null = null;

	function triggerPostGenerationQuotaRefresh(): void {
		if (postGenerationQuotaDebounceTimer !== null) {
			window.clearTimeout(postGenerationQuotaDebounceTimer);
		}
		// Raggruppa le sessioni che finiscono insieme per non lanciare `omp usage` in parallelo
		postGenerationQuotaDebounceTimer = window.setTimeout(() => {
			postGenerationQuotaDebounceTimer = null;
			void quotaStore.refresh(false);
		}, 1500);
	}
	/**
	 * Ricava provider, modello e pin credenziale realmente in uso da un progetto.
	 *
	 * Serve a due consumatori: la chip di quota della topbar (solo progetto attivo)
	 * e l'elenco della finestra companion (tutti i progetti). Una sola funzione,
	 * cosi' le due superfici non possono divergere.
	 */
	function resolveProjectRuntime(project: Project): {
		provider?: string;
		modelId?: string;
		credentialPin?: string;
	} {
		let provider: string | undefined;
		let modelId: string | undefined;

		const laneKey = runtimeKey(project);
		const agentSession = registeredSessionFor(project);
		const terminalSession = terminalSessionFor(project);
		if (project.lane.surface === 'gui') {
			const session = agentSession;
			if (session?.model) {
				provider = session.model.provider;
				modelId = session.model.id || session.model.name;
				if (!provider && modelId && modelId.includes('/')) {
					const parts = modelId.split('/');
					provider = parts[0];
					modelId = parts.slice(1).join('/');
				}
			}
		} else {
			const term = terminalSession;
			const selector = term?.currentSessionInfo?.modelSelector;
			if (selector) {
				const clean = selector.split(':')[0];
				if (clean.includes('/')) {
					const parts = clean.split('/');
					provider = parts[0];
					modelId = parts.slice(1).join('/');
				} else {
					modelId = clean;
				}
			}
		}

		// Fallback su ruolo default configurato
		if (!provider) {
			const defaultRole = modelSettingsStore.config?.modelRoles?.['default'] || modelSettingsStore.draftConfig?.modelRoles?.['default'];
			if (defaultRole) {
				const clean = defaultRole.split(':')[0];
				if (clean.includes('/')) {
					const parts = clean.split('/');
					provider = parts[0];
					modelId = parts.slice(1).join('/');
				}
			}
		}

		// Recupero del pin credenziale per il provider del progetto
		let credentialPin: string | undefined;
		if (provider) {
			const sessionKey =
				project.lane.surface === 'gui'
					? agentSession?.sessionId || agentSession?.sessionFile || undefined
					: terminalSession?.currentSessionInfo?.sessionId ||
						terminalSession?.currentSessionInfo?.sessionPath ||
						undefined;

			if (sessionKey) {
				const isGenerating =
					project.lane.surface === 'gui'
						? (agentSession?.isStreaming || agentSession?.agentState === 'working')
						: (terminalBusy[laneKey] || project.lane.agentState === 'working');

				const wasGenerating = prevGeneratingBySession.get(sessionKey) ?? false;
				prevGeneratingBySession.set(sessionKey, !!isGenerating);

				// Se la generazione e' appena terminata, invalida la cache per rileggere i pin freschi dal transcript
				if (wasGenerating && !isGenerating) {
					delete sessionPinsCache[sessionKey];
					triggerPostGenerationQuotaRefresh();
				}

				const cached = sessionPinsCache[sessionKey];
				if (cached) {
					credentialPin = cached[provider];
					if (!credentialPin) {
						const matchedKey = Object.keys(cached).find((p) => providersMatch(p, provider));
						if (matchedKey) credentialPin = cached[matchedKey];
					}
				}
				// Una sola lettura per sessione, rinnovata quando la generazione termina.
				// Il criterio e' l'assenza della voce in cache, non del pin: una sessione
				// senza pin per questo provider (il caso comune) lascia `credentialPin`
				// vuoto anche dopo la risposta, e la scrittura di `sessionPinsCache`
				// rilanciava l'effetto in un ciclo infinito di scansioni del disco.
				if (cached === undefined && !sessionPinsInFlight.has(sessionKey)) {
					sessionPinsInFlight.add(sessionKey);
					invoke<Record<string, string>>('session_credential_pins', { sessionId: sessionKey })
						.then((pins) => {
							sessionPinsCache[sessionKey] = pins || {};
						})
						.catch(() => {
							sessionPinsCache[sessionKey] = {};
						})
						.finally(() => {
							sessionPinsInFlight.delete(sessionKey);
						});
				}
			}

			// Fallback su providerHosts (es. terminale senza sessionKey nota o finche' session_credential_pins non risponde)
			if (!credentialPin) {
				const projectName = project.label?.trim() || project.name;
				const normActivePath = project.lane.workspacePath
					? normalizeProjectPath(project.lane.workspacePath).toLowerCase()
					: '';
				const host = quotaStore.providerHosts.find((h) => {
					if (!providersMatch(h.provider, provider)) return false;
					const normHostPath = h.project_path ? normalizeProjectPath(h.project_path).toLowerCase() : '';
					const matchesPath = normActivePath && normHostPath && normActivePath === normHostPath;
					const matchesName = h.project && (h.project === projectName || h.project === project.name);
					return matchesPath || matchesName;
				});
				credentialPin = host?.credential_pin;
			}
		}

		return { provider, modelId, credentialPin };
	}

	/**
	 * Etichetta corta del modello per le righe della companion: ultimo segmento
	 * del selettore, senza prefisso provider e senza suffisso di thinking.
	 */
	function shortModelLabel(modelId: string | undefined): string | undefined {
		if (!modelId) return undefined;
		const base = modelId.split(':')[0];
		const tail = base.includes('/') ? base.slice(base.lastIndexOf('/') + 1) : base;
		return tail || undefined;
	}

	// Mantiene la quota contestuale allineata al modello e provider del progetto attivo.
	$effect(() => {
		const project = projectStore.activeProject;
		if (!project) {
			activeQuotaStore.setActiveModel(undefined, undefined);
			return;
		}

		const { provider, modelId, credentialPin } = resolveProjectRuntime(project);
		activeQuotaStore.setActiveModel(provider, modelId, credentialPin);
	});

	// Ritrasmette alla finestra companion stato, modello e riga di attivita' di
	// OGNI progetto. Senza questo, la companion resta ferma allo snapshot
	// ricevuto all'apertura (dove `agentState` vale ancora 'unknown') perche'
	// `broadcastState()` veniva invocato solo all'arrivo o alla chiusura di una
	// richiesta di attenzione.
	let runtimeStructuralDigest = '';
	let runtimeActivityDigest = '';
	let runtimeBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const companionVisible = companionStore.isCompanionVisible;
		const runtimes: CompanionProjectRuntime[] = projectStore.projects.map((p) => {
			const { provider, modelId, credentialPin } = resolveProjectRuntime(p);
			const gate = automationGate(p.id);
			const activity = registeredSessionFor(p)?.activityLine;
			return {
				projectId: p.id,
				provider,
				modelId,
				modelLabel: shortModelLabel(modelId),
				credentialPin,
				canRunTask: gate.ready,
				// La companion ha solo il tooltip: spiegazione e rimedio insieme,
				// altrimenti resta con un'etichetta che non dice cosa fare.
				runBlockReason: gate.ready ? undefined : `${gate.detail} ${gate.hint}`.trim(),
				activity: activity ? { ...activity } : undefined
			};
		});

		// Digest sui soli campi che la companion mostra: durante lo streaming lo stato
		// sfarfalla e senza confronto si inonderebbe l'IPC a ogni token. Nome, etichetta
		// e tinta ci stanno perche' la companion disegna anche quelli: senza, un
		// progetto rinominato restava col vecchio nome fino al riavvio.
		const structural = projectStore.projects
			.map((p, i) => `${p.id}:${p.name}:${p.label ?? ''}:${p.hue}:${p.colorMode}:${p.lane.agentState}:${runtimes[i].provider ?? ''}:${runtimes[i].modelId ?? ''}:${runtimes[i].credentialPin ?? ''}:${runtimes[i].canRunTask ?? false}:${runtimes[i].runBlockReason ?? ''}`)
			.join('|');
		const activityOnly = runtimes
			.map((r) => (r.activity ? `${r.activity.kind}:${r.activity.at}` : ''))
			.join('|');

		// Finestra nascosta: non si trasmette nulla e i digest si azzerano, cosi'
		// alla riapertura il primo giro pubblica lo stato completo.
		if (!companionVisible) {
			if (runtimeBroadcastTimer) {
				clearTimeout(runtimeBroadcastTimer);
				runtimeBroadcastTimer = null;
			}
			runtimeStructuralDigest = '';
			runtimeActivityDigest = '';
			return;
		}

		const structuralChanged = structural !== runtimeStructuralDigest;
		const activityChanged = activityOnly !== runtimeActivityDigest;
		if (!structuralChanged && !activityChanged) return;
		runtimeStructuralDigest = structural;
		runtimeActivityDigest = activityOnly;

		// Throttle a valle: l'ultimo valore vince sempre, gli intermedi si
		// scartano. La sola riga di attivita' cambia a ogni tool e vale un
		// secondo di attesa; uno stato o un modello diverso e' un cambio che
		// l'utente sta guardando adesso.
		if (runtimeBroadcastTimer) clearTimeout(runtimeBroadcastTimer);
		runtimeBroadcastTimer = setTimeout(() => {
			runtimeBroadcastTimer = null;
			companionStore.publishProjectRuntimes(runtimes);
			companionStore.broadcastState();
		}, structuralChanged ? 250 : 1000);

		return () => {
			if (runtimeBroadcastTimer) {
				clearTimeout(runtimeBroadcastTimer);
				runtimeBroadcastTimer = null;
			}
		};
	});


	/**
	 * Crea la sessione se manca, senza aprirla. Il markup puo' chiamarla
	 * durante il rendering: l'apertura del processo omp e' un effetto
	 * collaterale e vive nell'`$effect` qui sotto, non nel disegno.
	 */
	function agentSessionFor(p: Project, lane: AgentLane | LaneRecord = p.lane): AgentSession {
		return laneOrchestrator.getOrCreateAgentSession(p, lane);
	}

	/** Corsia non archiviata del progetto: l'attiva vive in `p.lane`, le altre nel laneStore. */
	function laneOf(p: Project, laneId: string): AgentLane | LaneRecord | undefined {
		if (p.lane.laneId === laneId) return p.lane;
		return laneStore
			.lanesFor(p.id as ProjectId)
			.find((lane) => lane.laneId === laneId && lane.status !== 'archived' && lane.status !== 'closed');
	}


	/**
	 * Come sopra, ma garantisce anche che il processo sia avviato. `ensureOpen`
	 * e non `open`: un'apertura gia' in volo (per esempio la ripresa scelta
	 * dall'utente) non va scavalcata dall'ultima sessione conosciuta.
	 */
	function getOrCreateAgentSession(p: Project): AgentSession {
		const session = agentSessionFor(p);
		removeFromWarmupQueue(p.id);
		void session.ensureOpen(terminalMeta[runtimeKey(p)]?.sessionId ?? null);
		return session;
	}

	// Coda di preriscaldamento seriale per le sessioni GUI non attive all'avvio.
	// Evita che all'apertura dell'app partano 3-5 processi omp in parallelo.
	type WarmupItem = {
		projectId: string;
		session: AgentSession;
		resumeSessionId: string | null;
	};
	let warmupQueue: WarmupItem[] = [];
	let isWarmingUp = false;

	function removeFromWarmupQueue(projectId: string): void {
		const idx = warmupQueue.findIndex((item) => item.projectId === projectId);
		if (idx !== -1) {
			warmupQueue.splice(idx, 1);
		}
	}

	function enqueueWarmup(projectId: string, session: AgentSession, resumeSessionId: string | null): void {
		if (session.isOpen || session.isOpening) return;
		if (!warmupQueue.some((item) => item.projectId === projectId)) {
			warmupQueue.push({ projectId, session, resumeSessionId });
		}
		void processWarmupQueue();
	}

	async function processWarmupQueue(): Promise<void> {
		if (isWarmingUp) return;
		isWarmingUp = true;
		try {
			// Attende che la sessione attiva corrente sia pronta (o timeout di sicurezza)
			const activeProj = projectStore.activeProject;
			const activeSession = activeProj ? registeredSessionFor(activeProj) : undefined;
			if (activeSession && (activeSession.isOpening || !activeSession.isReady)) {
				await activeSession.waitUntilReady(7000);
			}

			// Preriscalda le altre sessioni una alla volta in serie
			while (warmupQueue.length > 0) {
				const next = warmupQueue.shift();
				if (!next) break;

				if (next.session.isOpen || next.session.isOpening || next.session.exited) {
					continue;
				}

				void next.session.ensureOpen(next.resumeSessionId);
				await next.session.waitUntilReady(7000);
			}
		} finally {
			isWarmingUp = false;
			if (warmupQueue.length > 0) {
				void processWarmupQueue();
			}
		}
	}

	// Notifica quando la sessione attiva diventa pronta per la prima volta
	let activeSessionReadyFired = false;
	$effect(() => {
		const activeProj = projectStore.activeProject;
		const activeSession = activeProj ? registeredSessionFor(activeProj) : undefined;
		if (activeSession?.isReady && !activeSessionReadyFired) {
			activeSessionReadyFired = true;
			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('studio-active-session-ready'));
			}
		}
	});

	// Apre i processi delle superfici GUI e ne rispecchia stato e sessione.
	// Ogni scrittura qui dentro deve convergere: `setAgentState` non riassegna
	// un valore uguale e `updateTerminalMeta` scrive solo se qualcosa cambia.
	$effect(() => {
		for (const p of projectStore.projects) {
			const activeSession = registeredSessionFor(p);
			if (p.lane.surface === 'gui' && activeSession) {
				if (!activeSession.exited) {
					const isCurrentProject = p.id === projectStore.activeId;
					const hasPendingWork =
						(p.canonicalProjectPath ? taskStore.pendingCountFor(p.canonicalProjectPath) > 0 : false) ||
						promptBus.getPendingsForProject(p.id).length > 0 ||
						activeSession.hasPendingStartupPrompts ||
						activeSession.pendingUi !== null ||
						activeSession.blockedQuotaState !== null;

					const resumeSessionId = terminalMeta[runtimeKey(p)]?.sessionId ?? null;

					if (isCurrentProject || hasPendingWork) {
						// Progetto attivo o con lavoro pendente: apertura immediata, scavalca la coda
						removeFromWarmupQueue(p.id);
						void activeSession.ensureOpen(resumeSessionId);
					} else {
						// Sessione GUI inattiva senza lavoro pendente: accoda per preriscaldamento seriale
						enqueueWarmup(p.id, activeSession, resumeSessionId);
					}
				}
				if (activeSession.sessionId) {
					updateTerminalMeta(p, { sessionId: activeSession.sessionId });
				}
			}

			// Segno di vita del processo: il prompt del task e' arrivato in
			// sessione e il transcript lo conserva. Da qui in avanti
			// rimetterlo in coda sarebbe lavoro svolto due volte.
			if (
				p.canonicalProjectPath &&
				activeSession &&
				(activeSession.isStreaming || activeSession.agentState === 'working' || activeSession.agentState === 'attention')
			) {
				taskStore.confirmTaskDelivered(p.canonicalProjectPath);
			}

			// Raccogli tutte le sessioni di questo progetto per sincronizzare attenzioni e stato aggregato
			const projectSessions = sessionRegistry.getSessionsForProject(p.id);
			const sessionsToCheck = projectSessions.length > 0 ? projectSessions : (activeSession ? [activeSession] : []);

			// Sincronizza le attenzioni per ciascuna corsia con Companion
			const projectAttentionMessages: string[] = [];

			for (const s of sessionsToCheck) {
				const laneId = s.laneId ?? 'main';
				const laneRecord = laneStore.lanes.find((l) => l.projectId === p.id && l.laneId === laneId);
				const laneTitle = laneRecord?.title ?? (laneId !== 'main' ? laneId : 'Principale');

				// Leggiamo recentMessages solo se esiste una potenziale richiesta di attenzione,
				// e sempre dentro untrack() per evitare che ogni singolo token di streaming
				// sottoscriva questo effect multi-progetto e scateni una cascata di re-render.
				const hasAttentionCandidate = Boolean(s.pendingUi || s.blockedQuotaState || s.inferredAttention);
				const attention = hasAttentionCandidate
					? buildAttentionRequest(
							{ id: p.id, name: p.name, hue: p.hue },
							{
								laneId,
								laneTitle,
								pendingUi: s.pendingUi ? $state.snapshot(s.pendingUi) : null,
								blockedQuotaState: s.blockedQuotaState ? $state.snapshot(s.blockedQuotaState) : null,
								inferredAttention: s.inferredAttention ? $state.snapshot(s.inferredAttention) : null,
								model: s.model,
								recentMessages: untrack(() => s.recentMessages)
							}
						)
					: null;

				if (attention) {
					projectAttentionMessages.push(askQuestionText(attention.pendingUi));
					companionStore.setAttentionRequest(attention);
				} else {
					companionStore.clearAttentionRequest(p.id, laneId);
				}
			}

			if (projectAttentionMessages.length > 0) {
				notificationManager.setProjectAskMessage(p.id, projectAttentionMessages[0]);
			} else {
				notificationManager.clearProjectAskMessage(p.id);
			}

			// Calcola lo stato aggregato del progetto: attention > working > finished > idle
			const candidateStates: string[] = [];
			for (const s of sessionsToCheck) {
				if (s.agentState && s.agentState !== 'unknown') {
					candidateStates.push(s.agentState);
				}
			}
			if (p.lane.surface === 'terminal' && terminalMeta[runtimeKey(p)]?.inputPending) {
				candidateStates.push('attention');
			}

			let aggregateState: AgentState = 'idle';
			if (candidateStates.includes('attention')) {
				aggregateState = 'attention';
			} else if (candidateStates.includes('working')) {
				aggregateState = 'working';
			} else if (candidateStates.includes('finished')) {
				aggregateState = 'finished';
			} else if (candidateStates.includes('idle')) {
				aggregateState = 'idle';
			}

			if (candidateStates.length > 0) {
				projectStore.setAgentState(p.id, aggregateState);
			}
		}
	});

	// Risposte rapide arrivate dalla finestra Companion o da scorciatoia esterna
	$effect(() => {
		let disposed = false;
		const unlistens: Array<() => void> = [];
		const register = (promise: Promise<() => void>) => {
			void promise.then((fn) => {
				if (disposed) {
					fn();
				} else {
					unlistens.push(fn);
				}
			});
		};

		register(listen<UiResponsePayload>('studio-respond-ui', async (event) => {
			await sessionRegistry.routeUiResponse(event.payload);
		}));

		register(listen<{ projectId: string; laneId?: string; targetSelector?: string; thinkingLevel?: string }>(
			'studio-resolve-quota-blocked',
			async (event) => {
				const { projectId, laneId, targetSelector, thinkingLevel } = event.payload;
				await handleResolveQuotaBlocked(projectId, laneId, targetSelector, thinkingLevel);
			}
		));

		register(listen<{ projectId: string; laneId?: string }>('studio-dismiss-quota-blocked', (event) => {
			handleDismissQuotaBlocked(event.payload.projectId, event.payload.laneId);
		}));

		register(listen<{ projectId: string; taskId: string; follow?: boolean }>('studio-run-task', (event) => {
			const { projectId, taskId, follow } = event.payload;
			void handleRunTask(projectId, taskId, { follow: follow ?? false });
		}));

		// La companion chiede di portare qui il fuoco su un progetto: e' la
		// strada rapida per "ha finito, fammi vedere cosa ha fatto". Riusa il
		// percorso del click sulle notifiche di sistema, che sa gia' come
		// ripristinare la finestra e selezionare il progetto.
		register(listen<{ projectId: string }>('studio-focus-project', (event) => {
			void notificationManager.handleNotificationClick(event.payload.projectId);
		}));

		return () => {
			disposed = true;
			for (const unlisten of unlistens) unlisten();
		};
	});
	// Notifiche di sistema e allerta sull'icona dell'app (Dock / Taskbar)
	$effect(() => {
		for (const p of projectStore.projects) {
			void notificationManager.onProjectStateChanged(p.id, p.lane.agentState);
		}
	});

	// Quando cambia il progetto attivo, azzera l'alert se la finestra ha il focus
	$effect(() => {
		const activeId = projectStore.activeId;
		if (activeId) {
			notificationManager.checkFocusAcknowledgement();
		}
	});

	// Sincronizza l'attenzione se l'utente cambia l'impostazione appBadge
	$effect(() => {
		const _badgeEnabled = settingsStore.notifications.appBadge;
		void notificationManager.syncNativeAttention(false);
	});

	// Riapplica le modalita' di coda a tutte le sessioni agenti attive quando cambiano le preferenze generali.
	$effect(() => {
		const _steering = settingsStore.general.steeringMode;
		const _followUp = settingsStore.general.followUpMode;
		const _interrupt = settingsStore.general.interruptMode;
		for (const session of sessionRegistry.getAllSessions()) {
			void session.applyQueueModes?.();
		}
	});

	// Riapplica la modalita' di cache warming a tutte le sessioni agenti attive quando cambia la preferenza generale.
	$effect(() => {
		const warming = settingsStore.general.cacheWarming;
		for (const session of sessionRegistry.getAllSessions()) {
			void session.applyCacheWarming?.(warming);
		}
	});

	/**
	 * Scrive solo se qualcosa cambia davvero. La versione precedente
	 * assegnava un oggetto nuovo a ogni chiamata: dentro l'`$effect` qui sopra
	 * quella scrittura riattivava l'effetto che l'aveva prodotta, Svelte
	 * alzava `effect_update_depth_exceeded` e abbandonava il ciclo di
	 * aggiornamento dell'intera applicazione.
	 */
	function updateTerminalMeta(project: Project, patch: Partial<{ inputPending: boolean; sessionId: string | null }>, laneId = project.lane.laneId) {
		laneOrchestrator.updateTerminalMeta(runtimeKey(project, laneId), patch);
	}

	/**
	 * Stato del terminale: oltre a rispecchiarlo sulla tessera, un omp che
	 * lavora conferma che il prompt del task e' arrivato nel PTY. Dopo la
	 * conferma il task non torna piu' in coda: il suo posto e' la sessione.
	 */
	function handleTerminalState(project: Project, state: AgentState, laneId = project.lane.laneId) {
		laneOrchestrator.handleTerminalState(project, laneId, state);
	}

	/**
	 * Perche' la coda di questo progetto puo' o non puo' partire. Il motivo
	 * completo (etichetta, spiegazione, rimedio) vive in `automationGate.ts`:
	 * qui si raccoglie solo lo stato delle due superfici.
	 *
	 * Il cancello e' per corsia: la coda puo' partire su `Principale` mentre
	 * una corsia secondaria e' al lavoro, e viceversa.
	 */
	function automationGate(projectId: string, targetLaneId?: string): AutomationGate {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		if (!project) return resolveAutomationGate({ surface: 'terminal', busy: false, inputPending: false, agentState: 'unknown' });
		const laneId = targetLaneId ?? project.lane.laneId;
		const isActiveLane = project.lane.laneId === laneId;
		const lane = isActiveLane ? project.lane : laneOrchestrator.laneRecord(project, laneId);
		if (!lane) return resolveAutomationGate({ surface: 'terminal', busy: false, inputPending: false, agentState: 'unknown' });
		const key = runtimeKey(project, laneId);
		const busy = terminalBusy[key] === true;
		if (lane.surface === 'gui') {
			const session = registeredSessionFor(project, laneId);
			return resolveAutomationGate({
				surface: 'gui',
				busy,
				session: session ? session.automationSnapshot : null
			});
		}
		return resolveAutomationGate({
			surface: 'terminal',
			busy,
			inputPending: terminalMeta[key]?.inputPending === true,
			agentState: laneOrchestrator.laneAgentState(project, laneId)
		});
	}

	function automationReason(projectId: string) {
		return automationGate(projectId).label;
	}

	function canAutomate(projectId: string) {
		return automationGate(projectId).ready;
	}

	function openNewTask(projectPath: string) {
		const task = taskStore.createTask(projectPath);
		taskEditorId = task.id;
		closeActiveSurface();
	}

	function openTask(taskId: string) {
		taskEditorId = taskId;
		closeActiveSurface();
	}

	/**
	 * Apre nell'editor un task che puo' appartenere a un altro progetto: il
	 * composer vive nella colonna centrale del progetto attivo, quindi prima
	 * si cambia stanza e poi si apre il task.
	 */
	function openTaskOfProject(projectId: string, taskId: string) {
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		queueOpen = false;
		leftSection = 'agent';
		openTask(taskId);
	}

	/**
	 * Nuovo task chiesto dal pannello di una tessera: il composer vive nella
	 * colonna centrale del progetto attivo, quindi prima si cambia stanza.
	 */
	function openNewTaskOfProject(projectId: string) {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		if (!project?.canonicalProjectPath) return;
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		queueOpen = false;
		leftSection = 'agent';
		openNewTask(project.canonicalProjectPath);
	}

	/** Porta alla chat che contiene il blocco spiegato nel drawer globale. */
	function openProjectFromQueue(projectId: string) {
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		queueOpen = false;
	}

	interface RunTaskOptions {
		/** Porta il fuoco sulla corsia lanciata (Ctrl+click, "Avvia e apri"). */
		follow?: boolean;
		/** Shift+click: nuova corsia isolata senza passare dal dialog. */
		shiftKey?: boolean;
		/** Corsia gia' decisa: conferma del dialog, auto-dispatch o ripresa. */
		laneId?: string;
		/** Creazione corsia gia' autorizzata: salta prompt e soft-cap. */
		newLane?: boolean;
		/** La spedizione nasce dall'auto-dispatch: la corsia occupa lo slot unico. */
		auto?: boolean;
		/**
		 * Avvio forzato sulla corsia indicata: salta il cancello e interrompe
		 * il turno o la domanda in corso. Lo sceglie l'utente quando lo stato
		 * dice "occupato" ma l'agente per lui ha finito.
		 */
		force?: boolean;
	}

	function taskTitleOf(task: StudioTask): string {
		return taskLabel(task) || m.agent_panel_new_task_btn();
	}

	/**
	 * Titolo della corsia per obiettivo: l'etichetta del task quando c'e',
	 * cosi' task e corsia si chiamano allo stesso modo. Il branch tecnico
	 * resta `omp/lane-<id>`.
	 */
	function laneTitleFromTask(task: StudioTask): string {
		const title = taskTitleOf(task);
		return title.length > 48 ? `${title.slice(0, 47)}\u2026` : title;
	}

	/**
	 * Routing deterministico della coda (Gate R27 / PLAN W09).
	 *
	 * Il bersaglio non e' mai la corsia semplicemente visibile: o `Principale`
	 * (se libera), o una corsia creata apposta per quel task. `Shift` + click
	 * salta il dialog; il dialog compare solo quando `Principale` lavora.
	 */
	async function handleRunTask(projectId: string, taskId: string, options: RunTaskOptions = {}) {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		const task = taskStore.taskById(taskId);
		if (!project?.canonicalProjectPath || !task) return;

		if (options.newLane) {
			await dispatchInNewLane(project, task, options);
			return;
		}
		if (options.laneId) {
			const lane = laneOrchestrator.laneRecord(project, options.laneId);
			if (!lane) return;
			await dispatchTaskInLane(project, lane, task, options);
			return;
		}

		const lanes = laneOrchestrator.laneDispatchSnapshots(project);
		const route = decideQueueRoute({
			shiftKey: options.shiftKey === true,
			lanes,
			worktreeCapable: Boolean(project.canonicalProjectPath)
		});

		if (route.kind === 'main') {
			await dispatchTaskInLane(project, laneOrchestrator.mainLaneRecord(project), task, options);
			return;
		}
		if (route.kind === 'blocked') {
			agentErrors[runtimeKey(project)] = m.lane_dispatch_blocked_detail();
			return;
		}
		// `Shift` + click e' gia' la conferma esplicita: il dialog serve solo
		// oltre il soft-cap. Senza questo ramo la richiesta cadeva nel prompt
		// "Agenti simultanei" con un conteggio senza senso ("1° agente").
		if (route.kind === 'new-lane' && !route.confirmConcurrency) {
			await dispatchInNewLane(project, task, options);
			return;
		}
		laneDispatchPrompt = {
			projectId,
			taskId,
			mode: route.kind === 'prompt' ? 'busy-main' : 'concurrency',
			taskTitle: taskTitleOf(task),
			warning: route.confirmConcurrency ? buildConcurrencyWarning(lanes) : null,
			follow: options.follow === true,
			forceLane:
				route.kind === 'prompt'
					? { laneId: project.lane.laneId, title: project.lane.title }
					: null
		};
	}

	/**
	 * Crea la corsia isolata e ci spedisce il task. Se la consegna fallisce la
	 * corsia viene archiviata subito: un worktree vuoto terrebbe occupato lo
	 * slot dell'auto-dispatch senza che nessun lavoro sia partito.
	 */
	async function dispatchInNewLane(project: Project, task: StudioTask, options: RunTaskOptions) {
		const key = runtimeKey(project);
		if (!options.auto) {
			const review = await reviewProjectProfile(project).catch((error) => {
				console.error('Analisi del profilo di progetto fallita:', error);
				return null;
			});
			if (review?.needsConsent) {
				laneProfilePrompt = {
					projectId: project.id,
					taskId: task.id,
					review,
					follow: options.follow === true
				};
				return;
			}
		}
		let created: LaneRecord;
		try {
			created = await laneOrchestrator.createNewLane(project, {
				origin: options.auto ? 'auto' : 'manual',
				// La corsia nasce senza xterm montato: la chat parte subito,
				// il terminale richiederebbe di attendere il DOM.
				surface: 'gui',
				title: laneTitleFromTask(task),
				// La corsia nasce in secondo piano: il workspace visibile cambia
				// solo se l'utente ha chiesto di seguirla (Ctrl+click).
				activate: options.follow === true
			});
		} catch (error) {
			agentErrors[key] = error instanceof Error ? error.message : String(error);
			return;
		}

		const delivered = await dispatchTaskInLane(project, created, task, {
			...options,
			skipGate: true
		});
		if (!delivered) {
			await discardUndeliveredLane(project, created);
			return;
		}
		if (options.follow) {
			if (projectStore.activeId !== project.id) projectStore.setActive(project.id);
			await laneOrchestrator.switchLane(project.id as ProjectId, created.laneId);
		}
	}

	/**
	 * Corsia nata per un task che non e' partito: la sessione GUI aperta per la
	 * consegna terrebbe vivo omp dentro il worktree (e su Windows bloccherebbe
	 * la rimozione), quindi va chiusa prima. Se il worktree resta su disco la
	 * corsia passa in `cleanup_pending` e l'utente lo vede, invece di trovarsi
	 * uno slot dell'auto-dispatch occupato senza spiegazione.
	 */
	async function discardUndeliveredLane(project: Project, lane: LaneRecord) {
		const ownerProjectId = project.id as ProjectId;
		const session = sessionRegistry.getLaneSession(project.id, lane.laneId);
		if (session) await sessionRegistry.disposeSession(session).catch(() => undefined);
		let failure: string | null = null;
		try {
			const outcome = await laneOrchestrator.archiveLane(ownerProjectId, lane.laneId, 'rejected', {
				stopProcesses: true
			});
			if (outcome.kind !== 'archived') {
				failure =
					outcome.kind === 'processes-active'
						? outcome.processes.map(describeLaneProcess).join(', ') || outcome.diagnosis.message
						: outcome.diagnosis.message;
			} else if (project.canonicalProjectPath) {
				// Branch appena creato e senza lavoro: senza consenso esplicito il
				// backend rifiuta comunque di cancellare commit mai integrati.
				await invoke(
					'worktree_delete_lane_branch',
					laneBranchDeleteArgs(project.canonicalProjectPath, lane.laneId, false)
				).catch((error) => console.warn('Branch della corsia non consegnata non eliminato:', error));
			}
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
		if (failure === null) return;
		const record = laneStore.lanesFor(ownerProjectId).find((l) => l.laneId === lane.laneId);
		if (record && record.recoveryState !== 'cleanup_pending') {
			await laneStore
				.updateLane(ownerProjectId, lane.laneId, { recoveryState: 'cleanup_pending' })
				.catch(() => undefined);
		}
		agentErrors[runtimeKey(project)] = m.lane_dispatch_cleanup_failed({
			name: lane.title,
			reason: failure
		});
	}

	/**
	 * Spedizione vera e propria dentro una corsia precisa. La coda letta e
	 * riscritta resta sempre quella canonica del progetto: una corsia worktree
	 * non possiede un proprio `.omp/tasks.json`.
	 */
	async function dispatchTaskInLane(
		project: Project,
		lane: AgentLane | LaneRecord,
		task: StudioTask,
		options: RunTaskOptions & { skipGate?: boolean }
	): Promise<boolean> {
		const queue = resolveQueueRoot(project, lane.workspacePath);
		if (!queue.path) return false;
		if (!options.skipGate && !options.force && !automationGate(project.id, lane.laneId).ready) return false;

		const taskId = task.id;
		const key = runtimeKey(project, lane.laneId);
		const isVisibleLane =
			projectStore.activeId === project.id && project.lane.laneId === lane.laneId;
		if (options.follow && projectStore.activeId !== project.id) projectStore.setActive(project.id);
		queueOpen = false;

		const laneContext: TaskRunLaneContext = {
			laneId: lane.laneId,
			laneTitle: lane.title,
			laneKind: lane.laneId === MAIN_LANE_ID ? 'main' : 'worktree',
			workspacePath: lane.workspacePath,
			branch: lane.branch,
			targetBranch: lane.targetBranch
		};

		terminalBusy[key] = true;
		agentErrors[key] = null;
		taskStore.markDispatching(taskId);

		try {
			const surface = isVisibleLane ? project.lane.surface : lane.surface;
			if (surface === 'gui') {
				const session = laneOrchestrator.getOrCreateAgentSession(project, lane);
				// Forzare vuol dire partire adesso: un turno ancora aperto o una
				// domanda di `ask` in sospeso terrebbero il processo occupato e
				// `newSession()` lo troverebbe a meta' lavoro.
				if (options.force && (session.isStreaming || session.agentState === 'working' || session.pendingUi)) {
					await session.abort();
				}
				const fullPrompt = formatTaskPrompt(task, queue.path);
				if (isVisibleLane) {
					// Semina ottimistica: mostra immediatamente il prompt come primo messaggio
					// nella chat con transizione fluida (chatReveal), nascondendo i tempi tecnici
					// di spawn del processo omp, handshake e roundtrip RPC.
					session.seedPrompt(fullPrompt, task.images ?? []);
				}
				// Una sola apertura, attesa: `newSession()` ha bisogno del
				// processo vivo, e aprirne un secondo qui lo farebbe partire
				// mentre il primo sta ancora nascendo.
				await session.ensureOpen(terminalMeta[key]?.sessionId ?? null);
				const sid = await session.newSession();
				// Una configurazione esplicita e' parte del contratto del task:
				// se non si applica, il task resta in coda invece di partire col
				// modello sbagliato.
				if (task.options?.modelSelector) {
					const rawSelector = task.options.modelSelector;
					const separator = rawSelector.indexOf('/');
					const provider = separator >= 0 ? rawSelector.slice(0, separator) : session.model?.provider || '';
					const modelId = separator >= 0 ? rawSelector.slice(separator + 1) : rawSelector;
					await session.client.send({
						type: 'set_model',
						provider,
						modelId
					});
				}

				if (task.options?.thinkingLevel && task.options.thinkingLevel !== 'auto') {
					await session.client.send({
						type: 'set_thinking_level',
						level: task.options.thinkingLevel as ThinkingLevel
					});
				}

				if (task.options?.prewalk) {
					await session.armPrewalk();
				}

				// Il task esce dalla coda solo a consegna avvenuta: `prompt()`
				// riporta il rifiuto di omp senza sollevare, e senza sessione
				// pubblicata non esiste nemmeno la riga di storico da cui
				// recuperarlo. In entrambi i casi il posto del task e' la coda.
				const delivery = await session.prompt(fullPrompt, task.images ?? [], 'steer');
				if (delivery === 'failed' || delivery === 'empty') {
					throw new Error(m.ui_ts_session_prompt_non_inviato_la_sessione_omp_e_f327());
				}
				const resolvedSid = sid ?? session.sessionId;
				if (!resolvedSid) {
					throw new Error(m.ui_ts_terminal_omp_non_ha_ancora_pubblicato_la_sessione_494e());
				}
				taskStore.completeDispatch(taskId, resolvedSid, laneContext);
				taskStore.setView(queue.path, 'sessions');
				if (taskEditorId === taskId) taskEditorId = null;
				window.dispatchEvent(new CustomEvent('studio-sessions-refresh', {
					detail: { projectPath: queue.path, sessionId: resolvedSid }
				}));
			} else {
				const term = terminalSessionFor(project, lane.laneId);
				if (!term) throw new Error(m.ui__page_terminale_non_pronto_6be5());
				const fullPrompt = formatTaskPrompt(task, queue.path);
				const configuration = (task.options?.modelSelector || task.options?.prewalk)
					? {
							modelSelector: task.options.modelSelector,
							thinkingLevel: task.options.thinkingLevel || 'auto',
							prewalk: task.options.prewalk
						}
					: undefined;
				const session = await term.startTask(fullPrompt, configuration);
				taskStore.completeDispatch(taskId, session.sessionId, laneContext);
				taskStore.setView(queue.path, 'sessions');
				if (taskEditorId === taskId) taskEditorId = null;
				window.dispatchEvent(new CustomEvent('studio-sessions-refresh', {
					detail: { projectPath: queue.path, sessionId: session.sessionId }
				}));
			}
			return true;
		} catch (error) {
			if (lane.surface === 'gui') {
				try {
					laneOrchestrator.getOrCreateAgentSession(project, lane).clearSeed();
				} catch {
					// ignora se la sessione non e' reperibile
				}
			}
			taskStore.rollbackDispatch(taskId);
			agentErrors[key] = error instanceof Error ? error.message : String(error);
			return false;
		} finally {
			terminalBusy[key] = false;
		}
	}

	function confirmLaneDispatch() {
		const request = laneDispatchPrompt;
		if (!request) return;
		laneDispatchPrompt = null;
		void handleRunTask(request.projectId, request.taskId, {
			newLane: true,
			follow: request.follow
		});
	}

	/** Il task parte nella corsia aperta anche se risulta occupata. */
	function forceLaneDispatch() {
		const request = laneDispatchPrompt;
		if (!request?.forceLane) return;
		laneDispatchPrompt = null;
		void handleRunTask(request.projectId, request.taskId, {
			laneId: request.forceLane.laneId,
			force: true,
			follow: request.follow
		});
	}

	/**
	 * Decisione presa: registra l'allowlist (anche vuota) e riprende la
	 * spedizione, che ora trova il profilo confermato e non chiede piu' nulla.
	 */
	async function confirmLaneProfile(accepted: string[]) {
		const request = laneProfilePrompt;
		if (!request) return;
		laneProfilePrompt = null;
		const project = projectStore.projects.find((candidate) => candidate.id === request.projectId);
		if (!project) return;
		try {
			await recordAllowlistDecision(project, {
				accepted,
				reviewed: request.review.pendingCandidates.map((candidate) => candidate.relativePath)
			});
		} catch (error) {
			console.error('Registrazione del consenso sui file locali fallita:', error);
		}
		await handleRunTask(request.projectId, request.taskId, {
			newLane: true,
			follow: request.follow
		});
	}

	/**
	 * Auto-avvio per progetto (spento di default, vedi docs/DECISIONS.md Gate
	 * R12): quando l'agente di un progetto con l'interruttore acceso torna
	 * `Pronto` e ha task in coda, il primo parte da solo.
	 *
	 * Con `Principale` occupata l'auto-avvio apre al massimo **una** corsia
	 * worktree per progetto (Gate R27): lo slot resta impegnato finche' quella
	 * corsia non viene archiviata, e le corsie create a mano lo sospendono del
	 * tutto. Un task che ha gia' fatto fallire un auto-avvio non viene
	 * ritentato da solo: rispedirlo genererebbe una seconda corsia per lo
	 * stesso lavoro.
	 *
	 * La spedizione esce dall'effetto con `queueMicrotask` e passa da un lock
	 * per progetto: `handleRunTask` scrive `terminalBusy` e `markDispatching`,
	 * cioe' proprio lo stato che l'effetto legge, e scriverlo qui dentro
	 * riaccenderebbe l'effetto che l'ha prodotto (`effect_update_depth_exceeded`).
	 */
	const autoDispatching = new Set<string>();
	const autoDispatchFailed = new Set<string>();
	$effect(() => {
		const candidates: Array<{ projectId: string; taskId: string; newLane: boolean }> = [];
		for (const project of projectStore.projects) {
			if (!project.autoDispatch || !project.canonicalProjectPath) continue;
			if (autoDispatching.has(project.id)) continue;
			const next = taskStore
				.tasksFor(project.canonicalProjectPath)
				.find((task) => task.status === 'queued' && !autoDispatchFailed.has(task.id));
			if (!next) continue;
			const decision = decideAutoDispatch({
				lanes: laneOrchestrator.laneDispatchSnapshots(project),
				worktreeCapable: Boolean(project.canonicalProjectPath)
			});
			if (decision.kind === 'wait') continue;
			if (decision.kind === 'main') {
				const gate = automationGate(project.id, MAIN_LANE_ID);
				// Il click manuale puo' scavalcare una domanda testuale; l'auto-run
				// aspetta invece sia la classificazione sia la decisione dell'utente.
				if (!gate.autoDispatchReady) continue;
			}
			candidates.push({
				projectId: project.id,
				taskId: next.id,
				newLane: decision.kind === 'new-lane'
			});
		}

		for (const candidate of candidates) {
			autoDispatching.add(candidate.projectId);
			queueMicrotask(() => {
				void handleRunTask(candidate.projectId, candidate.taskId, {
					auto: true,
					newLane: candidate.newLane,
					laneId: candidate.newLane ? undefined : MAIN_LANE_ID
				})
					.then(() => {
						// Solo i tentativi che hanno creato una corsia restano fuori
						// dall'auto-avvio: riprovarli genererebbe un secondo worktree
						// per lo stesso lavoro. Un fallimento su `Principale` non
						// lascia risorse dietro di se' e puo' ripartire da solo.
						if (candidate.newLane && taskStore.taskById(candidate.taskId)) {
							autoDispatchFailed.add(candidate.taskId);
						}
					})
					.finally(() => autoDispatching.delete(candidate.projectId));
			});
		}
	});

	async function handleResumeSession(projectId: string, sessionId: string, laneId?: string) {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		if (!project?.canonicalProjectPath || !canAutomate(projectId)) return;
		const lane = laneOf(project, laneId ?? project.lane.laneId);
		if (!lane) return;
		const key = runtimeKey(project, lane.laneId);

		terminalBusy[key] = true;
		agentErrors[key] = null;
		try {
			if (lane.surface === 'gui') {
				// `agentSessionFor` e non `getOrCreateAgentSession`: quest'ultimo
				// avvierebbe un processo sulla sessione precedente proprio mentre
				// la stiamo chiudendo per riprenderne un'altra.
				const session = agentSessionFor(project, lane);
				await session.close();
				await session.open(sessionId);
				taskStore.setView(project.canonicalProjectPath, 'sessions');
				window.dispatchEvent(new CustomEvent('studio-sessions-refresh', {
					detail: { projectPath: project.canonicalProjectPath, sessionId }
				}));
			} else {
				const term = terminalSessionFor(project, lane.laneId);
				if (!term) throw new Error(m.ui__page_terminale_non_pronto_6be5());
				await term.resumeSession(sessionId);
				taskStore.setView(project.canonicalProjectPath, 'sessions');
				window.dispatchEvent(new CustomEvent('studio-sessions-refresh', {
					detail: { projectPath: project.canonicalProjectPath, sessionId }
				}));
			}
		} catch (error) {
			agentErrors[key] = error instanceof Error ? error.message : String(error);
		} finally {
			terminalBusy[key] = false;
		}
	}

	/**
	 * Handoff tra TERMINAL e GUI: un solo processo omp attivo per progetto.
	 * La sessione passa da una superficie all'altra con `--resume <sessionId>`
	 * in entrambi i versi: verso la GUI lo riceve `rpc_open`, verso il
	 * terminale lo riceve il PTY tramite la prop `resumeSessionId`.
	 */
	async function switchSurface(projectId: string, target: 'terminal' | 'gui') {
		await laneOrchestrator.switchSurface(projectId, target);
	}

	async function handleResolveQuotaBlocked(
		projectId: string,
		laneId?: string,
		targetSelector?: string,
		thinkingLevel?: string
	) {
		const project = projectStore.projects.find((p) => p.id === projectId);
		if (!project) return;
		const lane = laneOf(project, laneId ?? project.lane.laneId);
		if (!lane) return;

		// Il recupero passa dalla GUI (Decisione Q6) e l'handoff di superficie
		// agisce solo sulla corsia attiva: una corsia in background al terminale
		// va prima portata in primo piano, altrimenti si aprirebbe un secondo
		// processo omp sulla stessa sessione del PTY.
		if (lane.surface === 'terminal') {
			if (project.lane.laneId !== lane.laneId) {
				await laneOrchestrator.switchLane(project.id as ProjectId, lane.laneId);
			}
			await switchSurface(project.id, 'gui');
		}

		const session = agentSessionFor(project, laneOf(project, lane.laneId) ?? lane);
		await session.ensureOpen();
		const success = await session.applyQuotaRecovery(targetSelector, thinkingLevel);
		if (success) {
			companionStore.clearAttentionRequest(projectId, lane.laneId);
		}
	}

	function handleDismissQuotaBlocked(projectId: string, laneId?: string) {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		const targetLaneId = laneId ?? project?.lane.laneId;
		const session = project && targetLaneId ? registeredSessionFor(project, targetLaneId) : undefined;
		if (session) session.dismissBlockedQuota();
		companionStore.clearAttentionRequest(projectId, targetLaneId);
	}

	/**
	 * Intercettazione dei comandi slash nella chat GUI.
	 *
	 * Regola di fondo: un comando slash non deve **mai** finire in `prompt`.
	 * `omp --mode rpc-ui` non li interpreta — verificato sul binario: il
	 * comando entra nel transcript come messaggio dell'utente e l'assistente
	 * risponde vuoto. Chi non trova qui una risposta riceve un avviso, non un
	 * silenzio. Un testo che inizia per `/` ma non nomina un comando conosciuto
	 * (un percorso assoluto, per esempio) resta un prompt normale.
	 */
	async function handleNewChat(projectId: string, laneId?: string) {
		const project = projectStore.projects.find((p) => p.id === projectId);
		const lane = project ? laneOf(project, laneId ?? project.lane.laneId) : undefined;
		if (!project || !lane || lane.kind === 'lab') return;
		const session = agentSessionFor(project, lane);
		// newSession() azzera isStreaming solo localmente e non inoltra l'abort al
		// processo omp: senza questo, i token della risposta in corso finirebbero
		// dentro la chat appena creata.
		if (session.isStreaming) await session.abort();
		await session.newSession();
	}

	function handleGuiSlashCommand(projectId: string, laneId: string, raw: string): boolean {
		const project = projectStore.projects.find((candidate) => candidate.id === projectId);
		const session = project ? registeredSessionFor(project, laneId) : undefined;
		if (!project?.canonicalProjectPath || !session) return false;

		const trimmed = raw.trim();
		const [cmd, ...rest] = trimmed.split(/\s+/);
		const lowerCmd = cmd.toLowerCase();
		const argument = rest.join(' ').trim();

		// --- comandi del guscio: li serve Studio, non omp ---------------------
		if (lowerCmd === '/new' || lowerCmd === '/clear') {
			const targetLane = laneOf(project, laneId);
			if (targetLane?.kind === 'lab') {
				session.pushNotice('info', m.lane_lifecycle_lab_single_chat(), 'studio');
				return true;
			}
			void handleNewChat(projectId, laneId);
			return true;
		}
		if (lowerCmd === '/resume' || lowerCmd === '/sessions' || lowerCmd === '/tree') {
			const targetLane = laneOf(project, laneId);
			if (targetLane?.kind === 'lab') {
				session.pushNotice('info', m.lane_lifecycle_lab_no_sessions(), 'studio');
				return true;
			}
			if (argument && lowerCmd === '/resume') {
				void handleResumeSession(projectId, argument, laneId);
			} else {
				leftSection = 'agent';
				taskStore.setView(project.canonicalProjectPath, 'sessions');
			}
			return true;
		}
		if (lowerCmd === '/fork') {
			void (async () => {
				try {
					const newId = await session.forkSession();
					session.flashNotice('info', m.page_slash_cmd_fork_success({ id: newId ?? '' }));
				} catch (error) {
					session.flashNotice('error', m.page_slash_cmd_fork_error({ error: error instanceof Error ? error.message : String(error) }));
				}
			})();
			return true;
		}
		if (lowerCmd === '/drop') {
			const targetLane = laneOf(project, laneId);
			if (targetLane?.kind === 'lab') {
				session.flashNotice('info', m.lane_lifecycle_lab_no_sessions());
				return true;
			}
			leftSection = 'agent';
			taskStore.setView(project.canonicalProjectPath, 'sessions');
			session.flashNotice('info', m.page_slash_cmd_drop_hint());
			return true;
		}
		if (lowerCmd === '/quit' || lowerCmd === '/exit') {
			const targetLane = laneOf(project, laneId);
			if (targetLane?.kind === 'lab') {
				session.flashNotice('info', m.lane_lifecycle_lab_single_chat());
				return true;
			}
			void session.newSession();
			return true;
		}
		if (lowerCmd === '/copy') {
			const transcriptText = session.entries
				.map((entry) => {
					if (entry.kind === 'user') return `User: ${entry.content || ''}`;
					if (entry.kind === 'assistant') {
						const text = entry.blocks
							.map((b) => (b.type === 'text' ? b.text : b.type === 'thinking' ? `[Thinking: ${b.text}]` : ''))
							.filter(Boolean)
							.join('\n');
						return `Assistant: ${text}`;
					}
					if (entry.kind === 'notice') return `[${entry.level}]: ${entry.message || ''}`;
					return '';
				})
				.filter(Boolean)
				.join('\n\n');
			if (transcriptText) {
				void navigator.clipboard.writeText(transcriptText);
				session.flashNotice('info', m.page_slash_cmd_copy_success());
			} else {
				session.flashNotice('warning', m.page_slash_cmd_copy_empty());
			}
			return true;
		}
		if (lowerCmd === '/login' || lowerCmd === '/logout') {
			modelSettingsStore.openModal('providers', argument || undefined);
			return true;
		}
		if (lowerCmd === '/switch') {
			pickerOpen = true;
			return true;
		}
		if (lowerCmd === '/git' || lowerCmd === '/branch') {
			leftSection = 'git';
			return true;
		}
		if (lowerCmd === '/settings' || lowerCmd === '/setup' || lowerCmd === '/models') {
			modelSettingsStore.openModal();
			return true;
		}
		if (lowerCmd === '/doctor') {
			settingsStore.openSection('doctor');
			return true;
		}
		if (lowerCmd === '/usage' || lowerCmd === '/quota') {
			usageOpen = true;
			return true;
		}
		if (lowerCmd === '/changelog' || lowerCmd === '/whatsnew') {
			const showFull = argument.toLowerCase() === 'full';
			void ompChangelogStore.openModal(showFull);
			return true;
		}
		if (lowerCmd === '/terminal') {
			void switchSurface(projectId, 'terminal');
			return true;
		}
		if (lowerCmd === '/help') {
			session.pushNotice('info', guiHelpText(session), 'studio');
			return true;
		}

		// --- comandi con una RPC corrispondente -------------------------------
		if (lowerCmd === '/compact') {
			void session.compact(argument || undefined);
			return true;
		}
		if (lowerCmd === '/handoff') {
			void session.handoff(argument || undefined);
			return true;
		}
		if (lowerCmd === '/thinking' || lowerCmd === '/reasoning') {
			const level = argument.toLowerCase();
			if (!THINKING_LEVELS.includes(level as ThinkingLevel)) {
				session.flashNotice('warning', m.page_slash_cmd_thinking_levels({ levels: THINKING_LEVELS.join(', ') }));
				return true;
			}
			void runSessionCommand(session, m.page_slash_cmd_thinking_set({ level: level }), {
				type: 'set_thinking_level',
				level: level as ThinkingLevel
			});
			return true;
		}
		if (lowerCmd === '/role' || lowerCmd === '/roles') {
			if (!argument) {
				modelSettingsStore.openModal('roles');
				return true;
			}
			const arg = argument.trim().toLowerCase();
			void (async () => {
				await modelSettingsStore.ensureLoaded();
				const cfg = modelSettingsStore.config || modelSettingsStore.draftConfig;
				const rolesMap = cfg?.modelRoles || {};
				const known = modelSettingsStore.knownSelectors;

				let role = arg;
				if (arg === 'next' || arg === 'cycle') {
					const current = resolveActiveRole(rolesMap, session.model, session.thinkingLevel, session.lastPickedRole, known);
					const next = nextCycleRole(cfg?.cycleOrder ?? [], rolesMap, current);
					if (!next) {
						session.flashNotice('warning', m.page_slash_cmd_no_configured_roles());
						return;
					}
					role = next;
				}

				const full = rolesMap[role];
				if (!full) {
					session.flashNotice('warning', m.page_slash_cmd_unconfigured_role({ role }));
					return;
				}
				const { provider, modelId, thinking } = parseRoleSelector(full, known);
				try {
					await session.client.send({ type: 'set_model', provider: provider || session.model?.provider || '', modelId });
					if (thinking && thinking !== 'auto') {
						await session.client.send({ type: 'set_thinking_level', level: thinking as ThinkingLevel });
					}
					session.lastPickedRole = role;
					await session.refreshState();
					session.flashNotice('info', m.page_slash_cmd_active_role({ role, model: session.model?.name || modelId }));
				} catch (err) {
					session.flashNotice('warning', `/role ${role}: ${err instanceof Error ? err.message : String(err)}`);
				}
			})();
			return true;
		}
		if (lowerCmd === '/model') {
			if (!argument) {
				modelSettingsStore.openModal('catalog');
				return true;
			}
			if (argument.toLowerCase() === 'next' || argument.toLowerCase() === 'cycle') {
				void (async () => {
					await modelSettingsStore.ensureLoaded();
					const cfg = modelSettingsStore.config || modelSettingsStore.draftConfig;
					const rolesMap = cfg?.modelRoles || {};
					const cycleOrder = cfg?.cycleOrder && cfg.cycleOrder.length > 0 ? cfg.cycleOrder : Object.keys(rolesMap);
					const configured = cycleOrder.filter(r => Boolean(rolesMap[r]));
					if (configured.length > 0) {
						const curId = session.model?.id || '';
						const curProvider = session.model?.provider || '';
						let curIdx = -1;
						for (let i = 0; i < configured.length; i++) {
							const raw = (rolesMap[configured[i]] || '').split(':')[0];
							if (raw === curId || raw === `${curProvider}/${curId}` || raw.endsWith(`/${curId}`)) {
								curIdx = i;
								break;
							}
						}
						const nextRole = configured[(curIdx + 1) % configured.length];
						const full = rolesMap[nextRole];
						const [rawSelector, thinking] = full.split(':');
						const [prov, mId] = rawSelector.includes('/') ? rawSelector.split('/') : ['', rawSelector];
						await session.client.send({ type: 'set_model', provider: prov || session.model?.provider || '', modelId: mId });
						if (thinking && thinking !== 'auto') {
							await session.client.send({ type: 'set_thinking_level', level: thinking as any });
						}
						await session.refreshState();
						session.flashNotice('info', m.page_slash_cmd_active_role({ role: nextRole, model: session.model?.name || mId }));
					} else {
						await session.client.send({ type: 'cycle_model' });
						await session.refreshState();
						const current = session.model?.name || session.model?.id || 'default';
						session.flashNotice('info', m.page_slash_cmd_active_model({ model: current }));
					}
				})();
				return true;
			}
			session.flashNotice('info', m.page_slash_cmd_model_hint());
			return true;
		}
		if (lowerCmd === '/name' || lowerCmd === '/rename') {
			if (!argument) {
				session.flashNotice('warning', m.page_slash_cmd_name_usage());
				return true;
			}
			void runSessionCommand(session, m.page_slash_cmd_name_set({ name: argument }), {
				type: 'set_session_name',
				name: argument
			});
			return true;
		}
		if (lowerCmd === '/cost' || lowerCmd === '/stats' || lowerCmd === '/status') {
			void reportSessionStats(session);
			return true;
		}

		// --- Tutti gli altri comandi slash -------------------------------------
		// Qualsiasi altro comando slash (skill, template, prompt, modalita'
		// /plan, /vibe, /goal, /loop, comandi builtin come /fast, /security,
		// /todo, /mcp, /jobs, /dirs, /plugins, ecc.) viene inoltrato
		// direttamente a omp via RPC prompt: omp lo esegue ed emette l'output
		// corrispondente (command_output/notice) oppure attiva l'agente.
		return false;
	}

	const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

	/** Manda una RPC e riporta l'esito sopra il composer, buono o cattivo. */
	async function runSessionCommand(session: AgentSession, done: string, command: RpcCommand) {
		try {
			await session.client.send(command);
			await session.refreshState();
			session.flashNotice('info', done);
		} catch (error) {
			session.flashNotice(
				'error',
				m.page_slash_cmd_command_failed({ error: error instanceof Error ? error.message : String(error) })
			);
		}
	}

	async function reportSessionStats(session: AgentSession) {
		try {
			const stats = await session.client.send<Record<string, unknown>>({ type: 'get_session_stats' });
			const cost = typeof stats?.cost === 'number' ? `$${stats.cost.toFixed(4)}` : m.page_slash_cmd_cost_unavailable();
			const messages = typeof stats?.totalMessages === 'number' ? stats.totalMessages : '?';
			const tools = typeof stats?.toolCalls === 'number' ? stats.toolCalls : '?';
			session.pushNotice(
				'info',
				m.page_slash_cmd_stats_summary({ session: session.sessionName ?? session.sessionId ?? '', messages: messages, tools: tools, cost: cost }),
				'studio'
			);
		} catch (error) {
			session.flashNotice(
				'error',
				m.page_slash_cmd_stats_unavailable({ error: error instanceof Error ? error.message : String(error) })
			);
		}
	}

	function guiHelpText(session: AgentSession): string {
		const lines = [
			m.page_gui_help_title(),
			m.ui__page_new_clear_avvia_una_nuova_sessione_f67b(),
			m.ui__page_resume_id_riprende_una_sessione_o_apre_97fd(),
			m.page_gui_help_compact(),
			m.ui__page_handoff_istruzioni_passa_il_testimone_a_una_1f1b(),
			'/thinking <off|minimal|low|medium|high|xhigh|max>',
			m.ui__page_model_next_apre_le_impostazioni_modelli_o_70f9(),
			m.ui__page_name_titolo_rinomina_la_sessione_0a14(),
			m.ui__page_cost_stats_status_riepilogo_della_sessione_9df5(),
			m.page_gui_help_panels(),
			'',
			m.page_gui_help_shortcuts_title(),
			m.ui__page_alt_p_cambia_modello_rapido_ctrl_p_66d1(),
			m.page_gui_help_thinking_keys(),
			m.ui__page_alt_invio_invia_con_la_modalita_alternativa_4b23(),
			m.ui__page_alt_c_interrompi_cancella_alt_e_fuoco_0496()
		];
		if (session.availableCommands.length > 0) {
			lines.push('', m.page_gui_help_more_commands({ count: session.availableCommands.length }));
		}
		return lines.join('\n');
	}

	/** Il processo omp muore con la scheda: senza questo resta orfano. */
	function disposeAgentSession(projectId: string) {
		void sessionRegistry.disposeProjectSessions(projectId);
	}

	onMount(() => {
		const onProjectClosed = (event: Event) => {
			const projectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
			if (!projectId) return;
			disposeAgentSession(projectId);
			void laneStore.removeDraftLanes(projectId as ProjectId).catch(() => undefined);
		};
		window.addEventListener('studio-project-closed', onProjectClosed);
		return () => window.removeEventListener('studio-project-closed', onProjectClosed);
	});

	onDestroy(() => {
		void sessionRegistry.clearAll();
	});

	let closeConfirmModalState = $state<{
		open: boolean;
		project?: ProjectCloseTarget;
	}>({ open: false });

	/**
	 * Uscita da Studio: il task rimasto in spedizione torna in coda e le
	 * scritture ritardate vengono svuotate subito. Un task consegnato non
	 * torna in coda: la sua sessione esiste e si riprende dallo storico.
	 *
	 * Nessuna domanda all'utente: le code vivono in `.omp/tasks.json` dentro
	 * ogni progetto, quindi chiudere l'app non perde nulla. "Conservo o scarto
	 * la coda?" ha senso solo chiudendo un singolo progetto, che sparisce dalla
	 * barra e porta via la coda dalla vista.
	 */
	async function persistWorkBeforeQuit() {
		for (const p of projectStore.projects) {
			if (!p.canonicalProjectPath) continue;
			try {
				await taskStore.resetDispatchingTasks(p.canonicalProjectPath);
			} catch (error) {
				console.error(
					'Salvataggio della coda in uscita fallito:',
					p.canonicalProjectPath,
					error
				);
			}
		}
		// Il salvataggio dei progetti e' ritardato di 500 ms e `beforeunload`
		// non attende promesse: senza questa attesa l'ultima modifica (layout,
		// progetto attivo, tessera chiusa) poteva perdersi alla chiusura.
		await Promise.allSettled([projectStore.flushSave(), laneStore.flush()]);
	}

	function handleRequestCloseProject(projectId: string) {
		const project = projectStore.projects.find((p) => p.id === projectId);
		if (!project) return;
		// Un task in spedizione non e' ancora una sessione: conta come lavoro
		// in coda, altrimenti la chiusura lo porta via senza chiedere nulla.
		const queuedCount = project.canonicalProjectPath
			? taskStore.pendingCountFor(project.canonicalProjectPath)
			: 0;
		const isWorking =
			project.lane.agentState === 'working' || Boolean(terminalBusy[runtimeKey(project)]);

		if (queuedCount === 0 && !isWorking) {
			projectStore.closeProject(projectId);
			return;
		}

		if (!isWorking && settingsStore.general.closeWithQueuedTasks === 'keep') {
			projectStore.closeProject(projectId);
			return;
		}

		if (!isWorking && settingsStore.general.closeWithQueuedTasks === 'discard') {
			if (project.canonicalProjectPath) void taskStore.clearProject(project.canonicalProjectPath);
			projectStore.closeProject(projectId);
			return;
		}

		closeConfirmModalState = {
			open: true,
			project: {
				id: project.id,
				name: project.label?.trim() || project.name || m.page_project_fallback_name(),
				path: project.canonicalProjectPath ?? '',
				queuedCount,
				isWorking
			}
		};
	}

	async function handleConfirmKeepClose() {
		const target = closeConfirmModalState.project;
		if (!target) return;
		if (target.path) {
			await taskStore.resetDispatchingTasks(target.path);
		}
		projectStore.closeProject(target.id);
		closeConfirmModalState = { open: false };
	}

	async function handleConfirmDiscardClose() {
		const target = closeConfirmModalState.project;
		if (!target) return;
		closeConfirmModalState = { open: false };
		projectStore.closeProject(target.id);
		if (target.path) await taskStore.clearProject(target.path);
	}

	function handleCancelCloseModal() {
		closeConfirmModalState = { open: false };
	}

	onMount(() => {
		let unlistenClose: (() => void) | undefined;
		if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
			const appWindow = getCurrentWindow();
			// Tauri annulla sempre la chiusura nativa quando la webview ha un
			// ascoltatore di `close-requested`: da qui in poi distruggere la
			// finestra spetta al wrapper JS, che lo fa appena l'handler
			// termina senza `preventDefault()`. Quindi l'unica cosa da fare e'
			// attendere il salvataggio delle code.
			void appWindow.onCloseRequested(async () => {
				await persistWorkBeforeQuit();
			}).then((unlisten) => {
				unlistenClose = unlisten;
			});
		}
		return () => {
			unlistenClose?.();
		};
	});

	function handleGitPanelDiff(filePath: string, mode: 'working' | 'commit', hash?: string) {
		if (!projectStore.activeId) return;
		projectStore.openFile(projectStore.activeId, filePath);
		closeActiveSurface();
		editorDiffRequest = { filePath, mode, hash, id: ++editorDiffRequestId };
	}

	let activeDirtyFiles = $state<string[]>([]);

	let terminalOpenRequest = $state<{
		projectId: string;
		filePath: string;
		line: number | null;
		id: number;
	} | null>(null);
	let terminalOpenRequestId = 0;

	async function handleTerminalOpenFile(projectId: string, filePath: string, line: number | null) {
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		let targetPath = filePath;
		let targetLine = line;

		const proj = projectStore.projects.find((p) => p.id === projectId);
		if (proj?.lane.workspacePath) {
			try {
				const res: { rel_path: string; line: number | null } | null = await invoke('resolve_project_file', {
					projectPath: proj.lane.workspacePath,
					candidate: filePath
				});
				if (res?.rel_path) {
					targetPath = res.rel_path;
					if (res.line !== null && targetLine === null) {
						targetLine = res.line;
					}
				}
			} catch {
				// In caso di errore IPC o disconnessione, mantieni filePath grezzo come fallback
			}
		}

		projectStore.openFile(projectId, targetPath);
		if (projectStore.activeProject?.lane.kind === 'lab') {
			labCenterView = 'editor';
		}
		terminalOpenRequest = {
			projectId,
			filePath: targetPath,
			line: targetLine,
			id: ++terminalOpenRequestId
		};
	}

	/**
	 * Badge `+N −M` del piè di turno: apre il diff con HEAD del file, lo stesso
	 * del pannello Git. Il percorso arriva dalla card del tool (relativo o
	 * assoluto) e si risolve come i link del terminale.
	 */
	async function handleChatOpenDiff(projectId: string, filePath: string) {
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		let targetPath = filePath;
		const proj = projectStore.projects.find((p) => p.id === projectId);
		if (proj?.lane.workspacePath) {
			try {
				const res: { rel_path: string; line: number | null } | null = await invoke('resolve_project_file', {
					projectPath: proj.lane.workspacePath,
					candidate: filePath
				});
				if (res?.rel_path) targetPath = res.rel_path;
			} catch {
				// Senza risoluzione si prova con il percorso grezzo, come per i link.
			}
		}
		handleGitPanelDiff(targetPath, 'working');
	}

	// Chip @file nelle anteprime dei task (coda, popover di progetto): apre il
	// file nel progetto del task e toglie di mezzo la superficie sopra l'editor.
	function openMentionedFile(projectId: string, relPath: string) {
		queueOpen = false;
		void handleTerminalOpenFile(projectId, relPath, null);
		closeActiveSurface();
	}

	let isCheckingUpdate = $state(false);
	let updateMessage = $state<string | null>(null);
	let ompBadgeType = $state<'warn' | 'success' | 'error' | null>(null);
	let showUpdatePromptModal = $state(false);
	let showRestartModal = $state(false);
	let lastSeenLoadError = $state<string | null>(null);
	let loadErrorDismissed = $state(false);

	/**
	 * Problemi del registro corsie da far vedere: prima erano solo in console.
	 * Il testo fa anche da chiave di chiusura: un problema nuovo riappare.
	 */
	const laneStoreNotice = $derived.by(() => {
		if (laneStore.loadError) return m.lanes_store_notice_load_error({ reason: laneStore.loadError });
		if (laneStore.saveError) return m.lanes_store_notice_save_error({ reason: laneStore.saveError });
		const discarded = laneStore.loadDiscarded;
		if (!discarded) return null;
		const count = discarded.lanes + discarded.profiles;
		if (laneStore.backupError) {
			return m.lanes_store_notice_discarded_backup_failed({ count, error: laneStore.backupError });
		}
		if (laneStore.backupPath) {
			return m.lanes_store_notice_discarded_backup({ count, path: laneStore.backupPath });
		}
		return m.lanes_store_notice_discarded({ count });
	});
	let dismissedLaneStoreNotice = $state<string | null>(null);

	$effect(() => {
		const currentErr = projectStore.loadError;
		if (currentErr !== lastSeenLoadError) {
			lastSeenLoadError = currentErr;
			loadErrorDismissed = false;
		}
	});
	let pendingUpdateCheck = $state<{
		has_update: boolean;
		current_version: string;
		latest_version: string;
		message: string;
	} | null>(null);
	let isInstallingUpdate = $state(false);

	/**
	 * Verifica del contratto con `omp` all'avvio (docs/PLAN.md Fase 8). Il
	 * wizard si apre solo quando c'e' qualcosa da fare, e parte dalla carta
	 * giusta: senza binario dall'installazione, senza credenziali o modello
	 * dal setup nativo, tutto a posto ma senza progetti dalla cartella.
	 */
	async function checkSetupContract() {
		try {
			// I progetti salvati arrivano dal disco in modo asincrono: senza
			// attendere, un utente con progetti vedrebbe il wizard solo perche'
			// la lista e' ancora vuota.
			await Promise.all([projectStore.init(), laneStore.init()]);
			const status = await invoke<{ missing: string[]; ompVersion?: string | null }>('setup_status');
			if (status.ompVersion) {
				ompVersionStore.set(status.ompVersion);
			}
			setupIncomplete = status.missing.length > 0;
			if (status.missing.includes('omp')) {
				setupStartAt = 'install';
			} else if (setupIncomplete) {
				setupStartAt = 'wizard';
			} else if (projectStore.projects.length === 0) {
				setupStartAt = 'project';
			} else {
				return;
			}
			setupOpen = true;
		} catch (e) {
			console.error(m.ui__page_verifica_del_contratto_omp_545e(), e);
		}
	}

	function openSetup() {
		setupStartAt = setupIncomplete ? 'wizard' : 'project';
		setupOpen = true;
	}

	async function closeSetup() {
		setupOpen = false;
		// Rileggere lo stato aggiorna il chip: se manca ancora qualcosa resta
		// visibile in barra, ma il wizard non si riapre da solo — sarebbe una
		// trappola.
		const wasIncomplete = setupIncomplete;
		await refreshSetupChip();
		if (wasIncomplete) await ompVersionStore.refresh();
	}

	/** Aggiorna il solo indicatore, senza decidere di aprire niente. */
	async function refreshSetupChip() {
		try {
			const status = await invoke<{ missing: string[]; ompVersion?: string | null }>('setup_status');
			if (status.ompVersion) {
				ompVersionStore.set(status.ompVersion);
			}
			setupIncomplete = status.missing.length > 0;
		} catch (e) {
			console.error(m.ui__page_verifica_del_contratto_omp_545e(), e);
		}
	}

	async function checkOmpUpdateSilently() {
		try {
			const res: {
				has_update: boolean;
				current_version: string;
				latest_version: string;
				message: string;
			} = await invoke('check_omp_update');
			if (res.current_version && res.current_version !== 'unknown') {
				ompVersionStore.set(res.current_version);
			}
			if (res.has_update) {
				pendingUpdateCheck = res;
				updateMessage = m.page_omp_update_status_new_version();
				ompBadgeType = 'warn';
			}
		} catch {
			// Verifica di background: errori di rete o rate limit non sono bloccanti
		}
	}

	/**
	 * Differisce compiti non critici all'avvio: partono quando la sessione
	 * attiva e' pronta oppure dopo ~10s (il primo dei due).
	 */
	function scheduleDeferredBootTask(task: () => void): void {
		let executed = false;
		let timeoutId: number | null = null;
		let cleanup: (() => void) | null = null;

		const run = () => {
			if (executed) return;
			executed = true;
			if (timeoutId !== null) window.clearTimeout(timeoutId);
			cleanup?.();
			task();
		};

		timeoutId = window.setTimeout(run, 10_000);
		const onReady = () => run();
		window.addEventListener('studio-active-session-ready', onReady, { once: true });
		cleanup = () => window.removeEventListener('studio-active-session-ready', onReady);
	}

	let updateCheckBootTimer: number | null = null;

	onMount(() => {
		perfMark('boot', 'app start');
		// Non lanciamo ompVersionStore.refresh() all'avvio: checkSetupContract()
		// interroga `setup_status` che popola gia' la versione senza spawnare
		// un processo `omp --version` separato a vuoto.
		// Differiamo la verifica degli aggiornamenti a ~30s dall'avvio per non competere
		// con lo startup delle sessioni.
		updateCheckBootTimer = window.setTimeout(() => {
			updateCheckBootTimer = null;
			void checkOmpUpdateSilently();
		}, 30_000);
		scheduleDeferredBootTask(() => void ompChangelogStore.checkStatus());
		void checkSetupContract();
		studioUpdaterStore.init();
		modelSettingsStore.initHealthWatch();
	});

	onDestroy(() => {
		if (postGenerationQuotaDebounceTimer !== null) {
			window.clearTimeout(postGenerationQuotaDebounceTimer);
			postGenerationQuotaDebounceTimer = null;
		}
		if (updateCheckBootTimer !== null) {
			window.clearTimeout(updateCheckBootTimer);
			updateCheckBootTimer = null;
		}
		studioUpdaterStore.destroy();
		modelSettingsStore.destroyHealthWatch();
	});
	async function handleCheckUpdate() {
		if (isCheckingUpdate || isInstallingUpdate) return;
		if (pendingUpdateCheck?.has_update) {
			showUpdatePromptModal = true;
			return;
		}
		isCheckingUpdate = true;
		updateMessage = m.page_omp_update_status_checking();
		ompBadgeType = null;
		try {
			const res: {
				has_update: boolean;
				current_version: string;
				latest_version: string;
				message: string;
			} = await invoke('check_omp_update');
			if (res.current_version && res.current_version !== 'unknown') {
				ompVersionStore.set(res.current_version);
			}
			if (res.has_update) {
				pendingUpdateCheck = res;
				updateMessage = m.page_omp_update_status_new_version();
				ompBadgeType = 'warn';
				showUpdatePromptModal = true;
			} else {
				pendingUpdateCheck = null;
				updateMessage = m.page_omp_update_status_up_to_date();
				ompBadgeType = 'success';
				setTimeout(() => {
					if (!pendingUpdateCheck?.has_update) {
						updateMessage = null;
						ompBadgeType = null;
					}
				}, 3000);
			}
		} catch (e) {
			console.error("Update check failed", e);
			updateMessage = m.page_omp_update_status_check_error();
			ompBadgeType = 'error';
			setTimeout(() => {
				if (!pendingUpdateCheck?.has_update) {
					updateMessage = null;
					ompBadgeType = null;
				}
			}, 3000);
		} finally {
			isCheckingUpdate = false;
		}
	}

	async function handlePerformUpdate() {
		showUpdatePromptModal = false;
		isInstallingUpdate = true;
		updateMessage = m.page_omp_update_status_installing();
		ompBadgeType = null;
		try {
			await invoke('run_omp_update');
			await ompVersionStore.refresh();
			void ompChangelogStore.checkStatus(true);
			pendingUpdateCheck = null;
			updateMessage = m.page_omp_update_status_installed();
			ompBadgeType = 'success';
			showRestartModal = true;
		} catch (e) {
			console.error("Update failed", e);
			updateMessage = m.page_omp_update_status_update_error();
			ompBadgeType = 'error';
			setTimeout(() => {
				if (!pendingUpdateCheck?.has_update) {
					updateMessage = null;
					ompBadgeType = null;
				}
			}, 4000);
		} finally {
			isInstallingUpdate = false;
		}
	}

	function handleRestartApp() {
		window.location.reload();
	}
	const SPLIT = 6;
	const MIN_COL = 160;
	const MIN_ROW = 120;
	let columnsEl = $state<HTMLElement | null>(null);
	let leftWidth = $state(260);
	// 0 = non ancora misurata: il centro resta elastico finche' non si trascina.
	let centerWidth = $state(0);
	// 0 = proporzionale 50/50: l'altezza top resta elastica finche' non si trascina.
	let topHeight = $state(0);
	let dragging = $state(false);
	let draggingWhich = $state<'left' | 'center' | null>(null);

	let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1200);
	let windowHeight = $state(typeof window !== 'undefined' ? window.innerHeight : 800);

	$effect(() => {
		const updateDims = () => {
			windowWidth = window.innerWidth;
			windowHeight = window.innerHeight;
		};
		updateDims();
		window.addEventListener('resize', updateDims);
		return () => window.removeEventListener('resize', updateDims);
	});

	// Determina il layout effettivo: se 'auto', confronta larghezza e altezza della finestra (o soglia 1100px)
	const effectiveLayout = $derived.by<'horizontal' | 'vertical'>(() => {
		if (settingsStore.general.layoutMode === 'horizontal') return 'horizontal';
		if (settingsStore.general.layoutMode === 'vertical') return 'vertical';
		// 'auto': se la finestra e' portrait (altezza > larghezza) o la larghezza e' troppo stretta per 3 colonne (< 1100px)
		return (windowHeight > windowWidth || windowWidth < 1100) ? 'vertical' : 'horizontal';
	});
	const activeLaneKind = $derived(projectStore.activeProject?.lane.kind ?? 'git');
	const isSidebarCollapsed = $derived(
		activeLaneKind === 'lab'
			? settingsStore.general.labSidebarCollapsed
			: settingsStore.general.sidebarCollapsed
	);

	const sidebarTabs = $derived([
		{ id: 'files', label: m.page_tabs_files_panel(), ariaLabel: m.page_tabs_files_panel_label() },
		{ id: 'git', label: m.page_tabs_git_panel(), ariaLabel: m.page_tabs_git_panel_label() },
		...(activeLaneKind !== 'lab'
			? [{ id: 'agent', label: m.page_tabs_agent_panel(), ariaLabel: m.page_tabs_agent_panel_label() }]
			: [])
	]);

	// Lo switch della colonna destra usa la stessa primitiva delle schede di
	// sinistra (D2); la scorciatoia passa dal Tooltip, non da un `title` (D8).
	const surfaceTabs = $derived([
		{
			id: 'terminal',
			label: m.page_tabs_terminal(),
			tooltip: activeSwitching ? m.page_tabs_terminal_switching() : m.page_tabs_terminal_label(),
			disabled: activeSwitching
		},
		{
			id: 'gui',
			label: m.page_tabs_gui(),
			tooltip: activeSwitching ? m.page_tabs_terminal_switching() : m.page_tabs_gui_label(),
			disabled: activeSwitching
		}
	]);
	const activeSurface = $derived(projectStore.activeProject?.lane.surface === 'gui' ? 'gui' : 'terminal');

	// Controlli di arresto dei terminali montati: lo Stop della corsia attiva
	// vive nella testata della colonna, mai sopra la viewport (D6).
	const terminalStops = new SvelteMap<string, TerminalStopControl>();
	const activeTerminalStop = $derived(
		projectStore.activeProject && activeSurface === 'terminal'
			? terminalStops.get(laneSessionKey(projectStore.activeProject.id, projectStore.activeProject.lane.laneId))
			: undefined
	);

	$effect(() => {
		if (activeLaneKind === 'lab' && leftSection === 'agent') {
			leftSection = 'files';
		}
	});

	const gridColumns = $derived.by(() => {
		const sideW = isSidebarCollapsed ? 0 : leftWidth;
		const splitW = isSidebarCollapsed ? 0 : SPLIT;
		if (effectiveLayout === 'vertical') {
			return `${sideW}px ${splitW}px minmax(0, 1fr)`;
		}
		const center = centerWidth > 0 ? `${centerWidth}px` : 'minmax(0, 1fr)';
		return `${sideW}px ${splitW}px ${center} ${SPLIT}px minmax(0, 1fr)`;
	});
	const gridRows = $derived.by(() => {
		if (effectiveLayout === 'vertical') {
			const top = topHeight > 0 ? `${topHeight}px` : 'minmax(0, 1fr)';
			return `${top} ${SPLIT}px minmax(0, 1fr)`;
		}
		return '1fr';
	});

	const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

	function maxCenter() {
		if (!columnsEl) return MIN_COL;
		const sideW = isSidebarCollapsed ? 0 : leftWidth;
		const splitW = isSidebarCollapsed ? 0 : SPLIT;
		return Math.max(MIN_COL, columnsEl.clientWidth - sideW - splitW - SPLIT - MIN_COL);
	}

	function maxTop() {
		if (!columnsEl) return MIN_ROW;
		return Math.max(MIN_ROW, columnsEl.clientHeight - SPLIT - MIN_ROW);
	}

	function startDrag(e: PointerEvent, which: 'left' | 'center') {
		if (!columnsEl) return;
		const el = columnsEl;
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		dragging = true;
		draggingWhich = which;

		const startX = e.clientX;
		const startY = e.clientY;
		const startLeft = leftWidth;
		const isVertical = effectiveLayout === 'vertical';

		// Al primo trascinamento il centro va congelato alla dimensione reale,
		// altrimenti passerebbe da elastico a un valore arbitrario.
		const startCenter = centerWidth > 0
			? centerWidth
			: (el.querySelector('.col-center')?.getBoundingClientRect().width ?? MIN_COL);
		const startTop = topHeight > 0
			? topHeight
			: (el.querySelector('.col-center')?.getBoundingClientRect().height ?? MIN_ROW);

		const onMove = (ev: PointerEvent) => {
			const totalW = el.clientWidth;
			if (which === 'left') {
				const dx = ev.clientX - startX;
				leftWidth = clamp(startLeft + dx, MIN_COL, totalW - 2 * SPLIT - 2 * MIN_COL);
				if (!isVertical && centerWidth > 0) {
					centerWidth = clamp(startCenter, MIN_COL, maxCenter());
				}
			} else {
				if (isVertical) {
					const dy = ev.clientY - startY;
					topHeight = clamp(startTop + dy, MIN_ROW, maxTop());
				} else {
					const dx = ev.clientX - startX;
					centerWidth = clamp(startCenter + dx, MIN_COL, maxCenter());
				}
			}
		};

		const onUp = () => {
			dragging = false;
			draggingWhich = null;
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onUp);
			handle.removeEventListener('pointercancel', onUp);
		};

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp);
		handle.addEventListener('pointercancel', onUp);
	}

	function resetSplit(which: 'left' | 'center') {
		if (which === 'left') {
			leftWidth = 260;
		} else {
			if (effectiveLayout === 'vertical') {
				topHeight = 0;
			} else {
				centerWidth = 0;
			}
		}
	}

	// Se la finestra si restringe, le dimensioni fisse potrebbero schiacciare le
	// sezioni flessibili a zero: vanno riclampate.
	$effect(() => {
		if (!columnsEl) return;
		const el = columnsEl;
		const ro = new ResizeObserver(() => {
			const totalW = el.clientWidth;
			const totalH = el.clientHeight;
			if (totalW < 3 * MIN_COL + 2 * SPLIT) return;
			leftWidth = clamp(leftWidth, MIN_COL, totalW - 2 * SPLIT - 2 * MIN_COL);
			if (centerWidth > 0) centerWidth = clamp(centerWidth, MIN_COL, maxCenter());
			if (topHeight > 0 && totalH > 2 * MIN_ROW + SPLIT) {
				topHeight = clamp(topHeight, MIN_ROW, maxTop());
			}
		});
		ro.observe(el);
		return () => {
			ro.disconnect();
		};
	});

	function cycleProject(direction: 1 | -1) {
		const projects = projectOrder.list;
		if (projects.length < 2) return;
		const idx = projects.findIndex(p => p.id === projectStore.activeId);
		const currentIdx = idx >= 0 ? idx : 0;
		const nextIdx = direction === 1
			? (currentIdx + 1) % projects.length
			: (currentIdx - 1 + projects.length) % projects.length;
		projectStore.setActive(projects[nextIdx].id);
	}

	function handleKeydown(e: KeyboardEvent) {
		// Esc chiude il dialogo piu' esterno, dal piu' recente al piu' vecchio.
		if (e.key === 'Escape') {

			if (shortcutsModalStore.isOpen) {
				e.preventDefault();
				shortcutsModalStore.close();
				return;
			}
			return;
		}

		// Alt+H, Alt+K, F1 o Ctrl+Alt+H: guida scorciatoie globale
		if (isShortcutsHelpKey(e)) {
			e.preventDefault();
			shortcutsModalStore.toggle();
			return;
		}

		// Ctrl+Tab / Ctrl+Shift+Tab: passa al progetto aperto successivo o precedente
		if (isProjectCycleShortcut(e)) {
			const hasOpenModal =
				settingsStore.open ||
				shortcutsModalStore.isOpen ||
				closeConfirmModalState.open ||
				setupOpen ||
				usageOpen ||
				pickerOpen ||
				queueOpen ||
				showRestartModal ||
				showUpdatePromptModal;

			const target = e.target;
			const isTargetEditable =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				(target instanceof HTMLElement &&
					(target.isContentEditable || Boolean(target.closest('.monaco-editor'))));

			if (hasOpenModal || isTargetEditable) {
				return;
			}
			e.preventDefault();
			cycleProject(e.shiftKey ? -1 : 1);
			return;
		}

		if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
		// Su tastiere internazionali AltGr alza sia ctrlKey sia altKey: senza
		// questa guardia scrivere una parentesi graffa in un campo di testo
		// aprirebbe un pannello. Nei campi le scorciatoie del guscio tacciono.
		const target = e.target;
		if (
			target instanceof HTMLInputElement
			|| target instanceof HTMLTextAreaElement
			|| (target instanceof HTMLElement && target.isContentEditable)
		) {
			return;
		}

		if (e.key.toLowerCase() === 's') {
			e.preventDefault();
			projectStore.openScratchpad();
		} else if (e.key.toLowerCase() === 'n') {
			e.preventDefault();
			pickerOpen = true;
		} else if (e.key.toLowerCase() === 'u') {
			e.preventDefault();
			usageOpen = !usageOpen;
		} else if (e.key.toLowerCase() === 'm') {
			e.preventDefault();
			modelSettingsStore.openModal();
		} else if (e.key.toLowerCase() === 'd') {
			e.preventDefault();
			settingsStore.openSection('doctor');
		} else if (e.key === ',') {
			e.preventDefault();
			settingsStore.openSection();
		} else if (e.key.toLowerCase() === 't') {
			e.preventDefault();
			queueOpen = !queueOpen;
		} else if (e.key.toLowerCase() === 'b') {
			e.preventDefault();
			settingsStore.toggleSidebar(activeLaneKind);
		} else if (e.key.toLowerCase() === 'l') {
			e.preventDefault();
			settingsStore.cycleLayoutMode();
		} else if (e.key.toLowerCase() === 'p') {
			e.preventDefault();
			if (settingsStore.general.labAlphaEnabled) {
				void handleNewFreeDraft();
			} else {
				openLabFlagSetting();
			}
		} else if (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'r') {
			e.preventDefault();
			void companionStore.toggleCompanion();
		} else if (e.key.toLowerCase() === 'a') {
			e.preventDefault();
			if (projectStore.activeProject) {
				const next = projectStore.activeProject.lane.surface === 'gui' ? 'terminal' : 'gui';
				void switchSurface(projectStore.activeProject.id, next);
			}
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			const activeProj = projectStore.activeProject;
			const secondaryLanes = activeProj
				? laneStore.lanesFor(activeProj.id as ProjectId).filter((l) => l.laneId !== MAIN_LANE_ID && l.status !== 'archived' && l.status !== 'closed')
				: [];

			if (activeProj && secondaryLanes.length > 0 && !e.shiftKey) {
				void laneOrchestrator.cycleLane(activeProj.id as ProjectId, e.key === 'ArrowRight' ? 'next' : 'prev');
				return;
			}

			// La navigazione segue l'ordine mostrato, non quello dell'array:
			// con ordinamento per priorita' o alfabetico i due divergono.
			const projects = projectOrder.list;
			const idx = projects.findIndex(p => p.id === projectStore.activeId);
			if (idx === -1 || projects.length < 2) return;
			if (e.shiftKey) {
				projectStore.shiftProject(projects[idx].id, e.key === 'ArrowRight' ? 1 : -1);
				return;
			}
			cycleProject(e.key === 'ArrowRight' ? 1 : -1);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app-layout">
	<TopBar
		onUsageClick={(anchor) => { usageAnchor = anchor ?? null; usageOpen = !usageOpen; }}
		onNewProject={() => pickerOpen = true}
		onSettingsClick={(section) => settingsStore.openSection(section)}
		onSetupClick={openSetup}
		onQueueClick={(anchor) => { queueAnchor = anchor ?? null; queueOpen = !queueOpen; }}

		{setupIncomplete}
		onRunTask={(projectId, taskId, follow) => void handleRunTask(projectId, taskId, { follow })}
		onEditTask={openTaskOfProject}
		onNewTask={openNewTaskOfProject}
		canRunTask={(projectId) => automationGate(projectId, MAIN_LANE_ID).ready}
		runReason={(projectId) => automationGate(projectId, MAIN_LANE_ID).label}
		onRequestCloseProject={handleRequestCloseProject}
		onOpenFile={openMentionedFile}
	/>
	{#if projectStore.activeProject && projectStore.activeProject.canonicalProjectPath}
		{@const secondaryLanes = laneStore.lanesFor(projectStore.activeProject.id as ProjectId).filter((l) => l.laneId !== MAIN_LANE_ID && l.status !== 'archived' && l.status !== 'closed')}
		{#if secondaryLanes.length > 0}
			<LaneStrip project={projectStore.activeProject} onReviewLane={(lane) => (reviewingLane = lane)} />
		{/if}
	{/if}
	<SetupModal open={setupOpen} startAt={setupStartAt} onClose={closeSetup} />
	<UsagePopover open={usageOpen} anchor={usageAnchor} onClose={() => usageOpen = false} {guiHosts} />
	<ProjectPicker open={pickerOpen} onClose={() => pickerOpen = false} />
	<SettingsModal />
	<CloseConfirmModal
		open={closeConfirmModalState.open}
		project={closeConfirmModalState.project}
		onConfirmKeep={handleConfirmKeepClose}
		onConfirmDiscard={handleConfirmDiscardClose}
		onCancel={handleCancelCloseModal}
	/>
	<LaneDispatchDialog
		open={laneDispatchPrompt !== null}
		mode={laneDispatchPrompt?.mode ?? 'busy-main'}
		taskTitle={laneDispatchPrompt?.taskTitle ?? ''}
		warning={laneDispatchPrompt?.warning ?? null}
		forceLaneTitle={laneDispatchPrompt?.forceLane?.title ?? ''}
		onConfirm={confirmLaneDispatch}
		onForce={laneDispatchPrompt?.forceLane ? forceLaneDispatch : undefined}
		onCancel={() => (laneDispatchPrompt = null)}
	/>
	<LaneProfileDialog
		open={laneProfilePrompt !== null}
		detection={laneProfilePrompt?.review.detection ?? null}
		candidates={laneProfilePrompt?.review.pendingCandidates ?? []}
		onConfirm={(accepted) => void confirmLaneProfile(accepted)}
		onCancel={() => (laneProfilePrompt = null)}
	/>
	{#if projectStore.activeProject}
		<LaneReviewModal
			open={reviewingLane !== null}
			lane={reviewingLane}
			project={projectStore.activeProject}
			onClose={() => (reviewingLane = null)}
			onResolveConflicts={(prompt) => void askLaneToResolveConflicts(prompt)}
		/>
	{/if}
	<QueueDrawer
		open={queueOpen}
		anchor={queueAnchor}
		onClose={() => queueOpen = false}
		onRunTask={(projectId, taskId, options) => void handleRunTask(projectId, taskId, options)}
		onEditTask={openTaskOfProject}
		onOpenProject={openProjectFromQueue}
		gateFor={(projectId: string) => automationGate(projectId, MAIN_LANE_ID)}
		onOpenFile={openMentionedFile}
	/>

	<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
		{agentAnnouncement}
	</div>
	{#if laneStoreNotice && laneStoreNotice !== dismissedLaneStoreNotice}
		<div
			class="floating-error-toast lane-store-toast"
			class:with-sibling={projectStore.loadError && !loadErrorDismissed}
			role="alert"
			in:rvLift={{ duration: 150 }}
		>
			<span class="floating-error-icon"><IconCircleAlert /></span>
			<span class="floating-error-text">{laneStoreNotice}</span>
			<button
				type="button"
				class="floating-error-close"
				onclick={() => (dismissedLaneStoreNotice = laneStoreNotice)}
				aria-label={m.common_close()}
			>
				<IconClose />
			</button>
		</div>
	{/if}
	{#if projectStore.loadError && !loadErrorDismissed}
		<div
			class="floating-error-toast"
			role="alert"
			in:rvLift={{ duration: 150 }}
		>
			<span class="floating-error-icon"><IconCircleAlert /></span>
			<span class="floating-error-text">{m.page_projects_load_error({ reason: projectStore.loadError })}</span>
			<button
				type="button"
				class="floating-error-close"
				onclick={() => (loadErrorDismissed = true)}
				aria-label={m.common_close()}
			>
				<IconClose />
			</button>
		</div>
	{/if}


	{#if !projectStore.ready}
		<!-- I progetti salvati non sono ancora arrivati dal disco: `projects` e'
		     vuoto perche' non si sa niente, non perche' non ce ne siano. Qui va
		     lo sfondo del tema e nient'altro, altrimenti si vede la schermata
		     «nessun progetto» per tutta la lettura e poi sparire. -->
		<main class="empty-workspace" aria-busy="true"></main>
	{:else if projectStore.projects.length === 0}
		<main class="empty-workspace">
			<EmptyState
				variant="no-projects"
				setupIncomplete={setupIncomplete}
				onSetupClick={() => { setupOpen = true; setupStartAt = 'wizard'; }}
				primaryAction={{
					label: m.page_empty_open_project(),
					shortcut: 'Ctrl+Alt+N',
					onClick: () => pickerOpen = true
				}}
				secondaryAction={{
					label: m.page_empty_open_scratchpad(),
					shortcut: 'Ctrl+Alt+S',
					onClick: () => projectStore.openScratchpad()
				}}
				shortcuts={[
					{ key: 'Ctrl+Alt+N', label: m.page_empty_open_folder_shortcut(), action: () => pickerOpen = true },
					{ key: 'Ctrl+Alt+S', label: m.page_empty_new_chat_shortcut(), action: () => projectStore.openScratchpad() },
					{ key: 'Ctrl+Alt+P', label: m.page_empty_lab_shortcut(), action: () => void handleNewFreeDraft() },
					{ key: 'Ctrl+Alt+U', label: m.page_empty_quota_shortcut(), action: () => usageOpen = true },
					{ key: 'Ctrl+Alt+,', label: m.page_empty_settings_shortcut(), action: () => settingsStore.openSection() },
					{ key: 'Ctrl+Alt+M', label: m.page_empty_models_shortcut(), action: () => settingsStore.openSection('models') }
				]}
			/>
		</main>
	{:else}
	<main
		class="columns"
		class:dragging
		class:dragging-row={dragging && draggingWhich === 'center' && effectiveLayout === 'vertical'}
		class:layout-vertical={effectiveLayout === 'vertical'}
		class:sidebar-collapsed={isSidebarCollapsed}
		bind:this={columnsEl}
		style:grid-template-columns={gridColumns}
		style:grid-template-rows={gridRows}
		ontransitionend={(e) => {
			if (e.target === columnsEl && e.propertyName === 'grid-template-columns') {
				window.dispatchEvent(new Event('resize'));
			}
		}}
	>
		<aside
			class="col-left"
			inert={isSidebarCollapsed}
			style:--sidebar-width="{leftWidth}px"
		>
			<div class="col-left-inner">
				<div class="col-header tabs-header">
					<ColumnTabs
						tabs={sidebarTabs}
						selected={leftSection}
						onChange={(id) => (leftSection = id as typeof leftSection)}
						ariaLabel={m.page_tabs_sidebar_panels()}
						tabIdPrefix="sidebar-tab-"
						panelIdPrefix="sidebar-panel-"
					/>
				</div>
				<div
					class="col-content"
					class:agent-content={leftSection === 'agent'}
					role="tabpanel"
					id={`sidebar-panel-${leftSection}`}
					aria-labelledby={`sidebar-tab-${leftSection}`}
					tabindex="0"
				>
					{#if projectStore.activeProject}
						{@const proj = projectStore.activeProject}
					{#if !proj.lane.workspacePath}
						<div style="padding: var(--space-2); color: var(--ink-faint);">
							{m.page_scratchpad_notice()}
						</div>
					{:else if leftSection === 'files'}
						{#key `${proj.id}:${proj.lane.laneId}:${proj.lane.workspacePath}`}
							<FileTree
								projectPath={proj.lane.workspacePath}
								name={proj.name}
								onFileSelect={(file: string) => {
									projectStore.openFile(proj.id, file);
									closeActiveSurface();
									if (proj.lane.kind === 'lab') {
										labCenterView = 'editor';
									}
								}}
								onFileDiff={(path: string) => handleGitPanelDiff(path, 'working')}
								dirtyFilePaths={activeDirtyFiles}
								onPathRenamed={(from: string, to: string, isDir: boolean) => projectStore.renamePath(proj.id, from, to, isDir)}
								onPathTrashed={(path: string, isDir: boolean) => projectStore.trashPath(proj.id, path, isDir)}
							/>
						{/key}
					{:else if leftSection === 'git'}
						{#key `${proj.id}:${proj.lane.laneId}:${proj.lane.workspacePath}`}
							<GitPanel
								projectPath={proj.lane.workspacePath}
								agentState={proj.lane.agentState}
								onOpenWorkingDiff={(p) => handleGitPanelDiff(p, 'working')}
								onOpenCommitDiff={(p, hash) => handleGitPanelDiff(p, 'commit', hash)}
								onResumeSession={(sid) => handleResumeSession(proj.id, sid)}
								canResume={canAutomate(proj.id)}
								resumeReason={automationReason(proj.id)}
							/>
						{/key}
					{:else if proj.canonicalProjectPath}
						<AgentPanel
							projectPath={proj.canonicalProjectPath}
							gate={automationGate(proj.id)}
							actionError={agentErrors[runtimeKey(proj)] ?? null}
							currentSessionId={terminalMeta[runtimeKey(proj)]?.sessionId ?? null}
							onCreateTask={() => openNewTask(proj.canonicalProjectPath!)}
							onRunTask={(taskId, shiftKey) => void handleRunTask(proj.id, taskId, { shiftKey })}
							onEditTask={(taskId) => openTask(taskId)}
							onResumeSession={(sessionId) => void handleResumeSession(proj.id, sessionId)}
							onOpenFile={(relPath) => {
								void handleTerminalOpenFile(proj.id, relPath, null);
								closeActiveSurface();
							}}
						/>
					{/if}
				{/if}
				</div>
			</div>
		</aside>

		<div
			class="splitter splitter-left"
			role="separator"
			aria-orientation="vertical"
			aria-label={m.page_splitter_files_resize()}
			onpointerdown={(e) => startDrag(e, 'left')}
			ondblclick={() => resetSplit('left')}
		></div>

		<section class="col-center">
			<!-- Ogni vista porta la propria barra da 32 px al posto di questa (D7):
			     resta solo nelle corsie Lab, per lo switch Anteprima/Editor. -->
			{#if isLabLane}
				<div class="col-header lab-header">
					<Segmented
						mode="tablist"
						tabIdPrefix="lab-view-tab-"
						panelIdPrefix="lab-view-panel-"
						ariaLabel={m.lab_lane_switch_group()}
						options={[
							{ value: 'preview', label: m.lab_lane_switch_preview() },
							{ value: 'editor', label: m.lab_lane_switch_editor() }
						]}
						value={labCenterView}
						onChange={(view) => (labCenterView = view)}
					/>
				</div>
			{/if}
			<div class="col-content fill">
				<div
					class="center-surface"
					id={isLabLane ? 'lab-view-panel-editor' : undefined}
					role={isLabLane ? 'tabpanel' : undefined}
					aria-labelledby={isLabLane ? 'lab-view-tab-editor' : undefined}
				>
				{#if projectStore.activeProject}
					{#if activeTaskEditor}
						<TaskEditor
							task={activeTaskEditor}
							session={registeredSessionFor(projectStore.activeProject) ?? null}
							guiHosts={guiHosts}
							onClose={() => taskEditorId = null}
							onRunTask={(taskId: string, { newLane }) => void handleRunTask(projectStore.activeProject!.id, taskId, { shiftKey: newLane })}
							onOpenImage={(data: string, mimeType: string) => (viewingImage = { data, mimeType })}
						/>
					{:else if diagramOpen}
						<DiagramViewer
							projectPath={projectStore.activeProject.lane.workspacePath ?? ''}
							initialDiagram={currentLaneSurface.diagramPayload}
							laneId={projectStore.activeProject.lane.laneId}
							projectId={projectStore.activeProject.id}
							onClose={() => closeActiveSurface()}
						/>
					{:else if previewFile}
						<PreviewViewer
							projectPath={projectStore.activeProject.lane.workspacePath ?? ''}
							filePath={previewFile}
							onClose={() => closeActiveSurface()}
						/>
					{:else if browserOpen}
						<BrowserViewer
							session={registeredSessionFor(projectStore.activeProject) ?? null}
							projectPath={projectStore.activeProject.lane.workspacePath ?? ''}
							onClose={() => closeActiveSurface()}
						/>
					{:else if EditorComponent}
						<EditorComponent
							projectPath={projectStore.activeProject.lane.workspacePath ?? ''}
							filePaths={projectStore.activeProject.lane.openFiles}
							filePath={projectStore.activeProject.lane.activeFile}
							openFileRequest={terminalOpenRequest?.projectId === projectStore.activeProject.id ? terminalOpenRequest : null}
							editorDiffRequest={editorDiffRequest}
							onDirtyFilesChange={(paths: string[]) => (activeDirtyFiles = paths)}
							onPreviewRequest={(fp: string) => {
								openPreview(fp);
							}}
							onFileSaved={() => {
								window.dispatchEvent(new CustomEvent('git-status-refresh'));
							}}
						/>
					{/if}
				{/if}
				</div>

				<!-- Livelli anteprima Laboratorio per ogni corsia Lab montata (contratto §7 e §8) -->
				{#each projectStore.projects as p (p.id)}
					{@const mountedLanes = laneOrchestrator.getMountedLanes(p)}
					{#each mountedLanes as lane (lane.laneId)}
						{#if lane.kind === 'lab' && lane.workspacePath && lane.labPrototypeId}
							{@const isLaneActive = p.id === projectStore.activeId && p.lane.laneId === lane.laneId}
							{@const visible = isLaneActive && labCenterView === 'preview'}
							<div
								class="lab-preview-layer"
								class:visible
								id={isLaneActive ? 'lab-view-panel-preview' : undefined}
								role={isLaneActive ? 'tabpanel' : undefined}
								aria-labelledby={isLaneActive ? 'lab-view-tab-preview' : undefined}
							>
								<LabPreview
									projectId={p.id}
									laneId={lane.laneId}
									prototypeId={lane.labPrototypeId}
									workspacePath={lane.workspacePath}
									projectPath={p.canonicalProjectPath}
									{visible}
									session={laneOrchestrator.getOrCreateAgentSession(p, lane)}
									onRunEnd={() => {
										// La richiesta e' finita: se l'utente sta guardando questa
										// corsia, riporta al centro l'anteprima aggiornata.
										if (projectStore.activeId === p.id && projectStore.activeProject?.lane.laneId === lane.laneId) {
											labCenterView = 'preview';
										}
									}}
								/>
							</div>
						{/if}
					{/each}
				{/each}
			</div>
		</section>

		<div
			class="splitter splitter-center"
			role="separator"
			aria-orientation={effectiveLayout === 'vertical' ? 'horizontal' : 'vertical'}
			aria-label={effectiveLayout === 'vertical' ? m.page_splitter_editor_resize_vertical() : m.page_splitter_editor_resize_horizontal()}
			onpointerdown={(e) => startDrag(e, 'center')}
			ondblclick={() => resetSplit('center')}
		></div>

		<section class="col-right">
			<div class="col-header tabs-header">
				{#if projectStore.activeProject?.lane.kind !== 'lab'}
					<ColumnTabs
						tabs={surfaceTabs}
						selected={activeSurface}
						onChange={(id) => projectStore.activeProject && void switchSurface(projectStore.activeProject.id, id as 'terminal' | 'gui')}
						ariaLabel={m.page_tabs_surfaces_group()}
						tabIdPrefix="surface-tab-"
						panelIdPrefix="surface-panel-"
					/>
				{/if}
				{#if activeSurface === 'gui' && projectStore.activeProject?.lane.kind !== 'lab'}
					<Tooltip text={m.page_actions_new_chat()} placement="bottom">
						<button
							type="button"
							class="header-action"
							aria-label={m.page_actions_new_chat()}
							onclick={() => projectStore.activeProject && void handleNewChat(projectStore.activeProject.id)}
						><IconNewChat /></button>
					</Tooltip>
				{:else if activeTerminalStop?.visible}
					<span class="header-stop"><TerminalStopButton control={activeTerminalStop} /></span>
				{/if}
			</div>
			<div
				class="col-content fill"
				role={projectStore.activeProject?.lane.kind !== 'lab' ? 'tabpanel' : undefined}
				id={projectStore.activeProject?.lane.kind !== 'lab' ? `surface-panel-${activeSurface}` : undefined}
				aria-labelledby={projectStore.activeProject?.lane.kind !== 'lab' ? `surface-tab-${activeSurface}` : undefined}
			>
				{#each projectStore.projects as p (p.id)}
					{@const mountedLanes = laneOrchestrator.getMountedLanes(p)}
					{#each mountedLanes as lane (lane.laneId)}
						{@const key = laneSessionKey(p.id, lane.laneId)}
						{@const isLaneActive = p.id === projectStore.activeId && p.lane.laneId === lane.laneId}
						{@const currentSurface = isLaneActive ? p.lane.surface : lane.surface}
						{#if lane.kind === 'lab' || currentSurface === 'gui'}
							<Chat
								session={laneOrchestrator.getOrCreateAgentSession(p, lane)}
								visible={isLaneActive}
								onOpenFile={(filePath, line) => handleTerminalOpenFile(p.id, filePath, line ?? null)}
								onOpenDiff={lane.kind === 'lab' ? undefined : (filePath) => void handleChatOpenDiff(p.id, filePath)}
								onOpenImage={(data, mimeType) => (viewingImage = { data, mimeType })}
								onSwitchToTerminal={lane.kind === 'lab' ? undefined : () => void switchSurface(p.id, 'terminal')}
								onSlashCommand={(raw) => handleGuiSlashCommand(p.id, lane.laneId, raw)}
								onNewChat={lane.kind === 'lab' ? undefined : () => void handleNewChat(p.id, lane.laneId)}
							/>
						{:else}
							<Terminal
								cwd={lane.workspacePath ?? p.canonicalProjectPath ?? ''}
								laneId={lane.laneId}
								projectId={p.id}
								continueLast={lane.laneId !== MAIN_LANE_ID && lane.kind === 'git' && p.worktreeResumeChat}
								visible={isLaneActive}
								resumeSessionId={terminalMeta[key]?.sessionId ?? null}
								stopRef={(control) => {
									if (control) terminalStops.set(key, control);
									else terminalStops.delete(key);
								}}
								sessionRef={(s) => {
									if (s) terminalSessions.set(key, s);
									else terminalSessions.delete(key);
								}}
								onStateChange={(state) => handleTerminalState(p, state, lane.laneId)}
								onInputPendingChange={(inputPending) => laneOrchestrator.updateTerminalMeta(key, { inputPending })}
								onSessionChange={(session: TerminalSessionInfo | null) => laneOrchestrator.updateTerminalMeta(key, { sessionId: session?.sessionId ?? null })}
								onOpenFile={(filePath, line) => handleTerminalOpenFile(p.id, filePath, line)}
							/>
						{/if}
					{/each}
				{/each}
			</div>
		</section>
	</main>
	{/if}

	<footer class="statusbar">
		<div class="statusbar-right">
			<Tooltip text={studioUpdaterStore.currentVersion ? m.page_statusbar_studio_version_title({ version: studioUpdaterStore.currentVersion }) : m.page_statusbar_studio_version_check()}>
			<button 
				class="version-btn"
				aria-busy={studioUpdaterStore.isChecking || studioUpdaterStore.isDownloading}
				onclick={() => {
					if (studioUpdaterStore.hasUpdate) {
						studioUpdaterStore.openModal();
					} else {
						studioUpdaterStore.checkUpdate(true);
					}
				}}
				aria-label={m.ui__page_verifica_aggiornamenti_omp_studio_e895()}
			>
				{#if studioUpdaterStore.isChecking || studioUpdaterStore.isDownloading}
					<StatusMark status="running" />
				{/if}
				{studioUpdaterStore.currentVersion ? `Studio ${formatVersion(studioUpdaterStore.currentVersion, { prefix: true, compact: true })}` : 'Studio'}
				{#if studioUpdaterStore.updateBadge}
					<span 
						class="update-chip" 
						class:warn={studioUpdaterStore.badgeType === 'warn'} 
						class:success={studioUpdaterStore.badgeType === 'success'} 
						class:error={studioUpdaterStore.badgeType === 'error'}
					>
						{studioUpdaterStore.updateBadge}
					</span>
				{/if}
			</button>
			</Tooltip>
			<Tooltip text={m.page_statusbar_omp_version_check()}>
			<button 
				class="version-btn"
				aria-busy={isCheckingUpdate || isInstallingUpdate}
				onclick={handleCheckUpdate}
				aria-label={m.ui__page_verifica_aggiornamenti_omp_cli_c90f()}
			>
				{#if isCheckingUpdate || isInstallingUpdate}
					<StatusMark status="running" />
				{/if}
				{ompVersionStore.current ? `OMP v${ompVersionStore.current}` : 'OMP'}
				{#if updateMessage}
					<span
						class="update-chip"
						class:warn={ompBadgeType === 'warn'}
						class:success={ompBadgeType === 'success'}
						class:error={ompBadgeType === 'error'}
					>
						{updateMessage}
					</span>
				{/if}
			</button>
			</Tooltip>
			<div
				class="status-indicator"
				role="status"
				aria-live="polite"
			>
				<StatusMark
					status={activeLaneState === 'working' ? 'running' : activeLaneState === 'finished' ? 'completed' : activeLaneState === 'attention' ? 'attention' : 'pending'}
					active={activeLaneState === 'working' || activeLaneState === 'attention'}
				/>
				<span>{agentStateLabel(activeLaneState)}</span>
			</div>
		</div>
	</footer>

	<ConfirmDialog
		open={showUpdatePromptModal}
		title={m.page_modal_update_title()}
		confirmLabel={m.page_modal_update_btn_update()}
		cancelLabel={m.page_modal_update_btn_cancel()}
		onConfirm={handlePerformUpdate}
		onCancel={() => (showUpdatePromptModal = false)}
	>
		<p>{m.page_modal_update_desc()}</p>
		<p class="modal-sub">
			{ompVersionStore.current
				? m.page_modal_update_current_version({ version: ompVersionStore.current })
				: m.page_modal_update_current_version_unknown()}
		</p>
		{#if pendingUpdateCheck?.latest_version}
			<p class="modal-sub">{m.page_modal_update_latest_version({ version: pendingUpdateCheck.latest_version })}</p>
		{/if}
		{#if pendingUpdateCheck?.message}
			<pre class="update-log">{pendingUpdateCheck.message}</pre>
		{/if}
	</ConfirmDialog>

	<ConfirmDialog
		open={showRestartModal}
		title={m.page_modal_restart_title()}
		confirmLabel={m.page_modal_restart_btn_restart()}
		cancelLabel={m.page_modal_restart_btn_close()}
		onConfirm={handleRestartApp}
		onCancel={() => (showRestartModal = false)}
	>
		<p>{m.page_modal_restart_desc()}</p>
		<p>{m.page_modal_restart_sub()}</p>
	</ConfirmDialog>

	<StudioUpdateModal />
	<ShortcutsHelpModal />
	<OmpChangelogModal />
	{#if viewingImage}
		<ImageModal
			data={viewingImage.data}
			mimeType={viewingImage.mimeType}
			onClose={() => (viewingImage = null)}
		/>
	{/if}
</div>

<style>
	.app-layout {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
	}

	.empty-workspace {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-base);
		overflow: auto;
		min-height: 0;
		min-width: 0;
	}

	.columns {
		display: grid;
		flex: 1;
		min-height: 0;
		min-width: 0;
	}

	.columns:not(.dragging) {
		transition: grid-template-columns var(--dur-slow) var(--ease-reveal);
	}

	.columns.dragging {
		user-select: none;
	}

	.columns.dragging:not(.dragging-row) {
		cursor: col-resize;
	}

	.columns.dragging.dragging-row {
		cursor: row-resize;
	}

	/* Posizionamento griglia: Orizzontale (3 colonne) */
	.columns:not(.layout-vertical) .col-left {
		grid-column: 1;
		grid-row: 1;
	}
	.columns:not(.layout-vertical) .splitter-left {
		grid-column: 2;
		grid-row: 1;
		cursor: col-resize;
	}
	.columns:not(.layout-vertical) .col-center {
		grid-column: 3;
		grid-row: 1;
	}
	.columns:not(.layout-vertical) .splitter-center {
		grid-column: 4;
		grid-row: 1;
		cursor: col-resize;
	}
	.columns:not(.layout-vertical) .col-right {
		grid-column: 5;
		grid-row: 1;
	}

	/* Posizionamento griglia: Verticale (sidebar + stack editor sopra / chat sotto) */
	.columns.layout-vertical .col-left {
		grid-column: 1;
		grid-row: 1 / span 3;
	}
	.columns.layout-vertical .splitter-left {
		grid-column: 2;
		grid-row: 1 / span 3;
		cursor: col-resize;
	}
	.columns.layout-vertical .col-center {
		grid-column: 3;
		grid-row: 1;
	}
	.columns.layout-vertical .splitter-center {
		grid-column: 3;
		grid-row: 2;
		cursor: row-resize;
	}
	.columns.layout-vertical .splitter-center:hover,
	.columns.layout-vertical.dragging .splitter-center:active {
		background-image: linear-gradient(to right, var(--brand), var(--brand));
		background-size: 100% 1px;
		background-position: center;
		background-repeat: no-repeat;
	}
	.columns.layout-vertical .col-right {
		grid-column: 3;
		grid-row: 3;
	}

	/* Sidebar collassata */
	.columns.sidebar-collapsed .col-left {
		overflow: hidden;
		pointer-events: none;
		visibility: hidden;
		transition: visibility 0s linear var(--dur-slow);
	}

	.columns.sidebar-collapsed .col-left-inner {
		opacity: 0;
		transform: translateX(-16px);
	}

	.columns.sidebar-collapsed .splitter-left {
		overflow: hidden;
		pointer-events: none;
		visibility: hidden;
		transition: visibility 0s linear var(--dur-slow);
	}

	:root[data-animations="false"] .columns.sidebar-collapsed .col-left,
	:root[data-animations="false"] .columns.sidebar-collapsed .splitter-left {
		transition-delay: 0ms !important;
	}

	@media (prefers-reduced-motion: reduce) {
		.columns.sidebar-collapsed .col-left,
		.columns.sidebar-collapsed .splitter-left {
			transition-delay: 0ms !important;
		}
	}

	.col-left {
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
		min-width: 0;
		overflow: hidden;
		visibility: visible;
		pointer-events: auto;
		transition: visibility 0s linear;
	}

	.col-left-inner {
		width: var(--sidebar-width, 260px);
		min-width: var(--sidebar-width, 260px);
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
		transform: translateX(0);
		opacity: 1;
	}

	.columns:not(.dragging) .col-left-inner {
		transition:
			opacity var(--dur-slow) var(--ease-reveal),
			transform var(--dur-slow) var(--ease-reveal);
	}

	.splitter-left {
		overflow: hidden;
		visibility: visible;
		pointer-events: auto;
		transition: visibility 0s linear;
	}

	/* Le colonne si separano per luminanza, non per riga: il pozzo scuro di
	   terminale ed editor contro la base della colonna file. Nessun bordo
	   verticale nel corpo dell'app. */
	.col-center,
	.col-right {
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		min-width: 0;
		overflow: hidden;
	}

	.col-header {
		height: 32px;
		padding: 0 var(--space-2);
		display: flex;
		align-items: center;
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
		background: transparent;
		z-index: var(--z-sticky);
	}

	.tabs-header {
		justify-content: space-between;
		padding: 0;
		gap: 0;
	}

	.header-action {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md);
		border: none;
		background: transparent;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 0;
		margin-right: 2px;
		--icon-size: 14px;
		flex: 0 0 auto;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.header-stop {
		display: inline-flex;
		align-items: center;
		margin-right: 2px;
	}

	.header-action:hover {
		color: var(--ink);
		background-color: var(--bg-hover);
	}

	.col-content {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		/* Le righe svaniscono passando sotto l'header invece di essere
		   tagliate da una linea. Nella maschera conta solo l'alfa: qualsiasi
		   token opaco vale. */
		-webkit-mask-image: linear-gradient(to bottom, transparent 0, var(--ink) 10px);
		mask-image: linear-gradient(to bottom, transparent 0, var(--ink) 10px);
	}

	.col-content.agent-content {
		overflow: hidden;
		-webkit-mask-image: none;
		mask-image: none;
	}

	/* Editor e terminale gestiscono il proprio scroll: uno scroll esterno
	   falserebbe le misure di fit/layout. */
	.col-content.fill {
		position: relative;
		overflow: hidden;
		background: var(--bg-sunken);
		-webkit-mask-image: none;
		mask-image: none;
	}

	.center-surface {
		height: 100%;
	}

	/* Barra da 32 px sul pozzo con una linea sotto, come le testate fuse
	   delle viste (Editor, Anteprima, Whiteboard, Task). */
	.lab-header {
		border-bottom: 1px solid var(--line);
	}

	/* Un livello per ogni corsia Lab montata: resta nel DOM anche nascosto,
	   cosi' l'anteprima non si ricarica quando si torna alla corsia. */
	.lab-preview-layer {
		position: absolute;
		inset: 0;
		display: none;
		z-index: var(--z-base);
		pointer-events: none;
	}

	.lab-preview-layer.visible {
		display: block;
		z-index: var(--z-sticky);
		pointer-events: auto;
	}

	.splitter {
		/* La larghezza reale (6px) e' definita dal grid-template inline.
		   Invisibile a riposo: separano le superfici, non una riga. */
		background-color: transparent;
		cursor: col-resize;
		touch-action: none;
		z-index: var(--z-splitter);
	}

	.splitter:hover,
	.columns.dragging .splitter:active {
		background-image: linear-gradient(var(--brand), var(--brand));
		background-size: 1px 100%;
		background-position: center;
		background-repeat: no-repeat;
	}

	.statusbar {
		height: 26px;
		background-color: var(--bg-raised);
		/* Separata per luminanza dal pozzo, come la topbar. */
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding: 0 var(--space-3);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		z-index: var(--z-sticky);
	}

	.statusbar-right {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}


	.version-btn {
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-faint);
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		padding: 2px 6px;
		border-radius: var(--radius-md);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: color var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.version-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
		border-color: var(--line);
	}


	.update-chip {
		font-size: var(--text-caption);
		padding: 1px var(--space-1);
		border-radius: var(--radius-full);
		background: var(--bg-active);
		color: var(--ink);
		font-weight: 600;
	}

	.update-chip.warn {
		background: var(--warn);
		color: var(--bg-sunken);
	}

	.update-chip.success {
		background: var(--success);
		color: var(--on-success);
	}

	.update-chip.error {
		background: var(--danger);
		color: var(--on-danger);
	}

	.status-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 500;
		color: var(--ink-muted);
	}


	/* Il velo e' un <button>: il colore lo mette la regola, ma il bordo
	   `outset` dello user agent va rimosso o disegna una cornice a 2px
	   lungo tutto il perimetro della finestra. */
	.floating-error-toast {
		position: fixed;
		inset-inline: 0;
		bottom: var(--space-3);
		margin-inline: auto;
		width: fit-content;
		max-width: min(80vw, 560px);
		z-index: var(--z-toast);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-3);
		border-radius: var(--radius-lg);
		border: 1px solid var(--line-strong);
		background: var(--bg-overlay);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		font-size: var(--text-label);
	}

	/* Con l'avviso dei progetti gia' a schermo quello delle corsie sale sopra. */
	.lane-store-toast.with-sibling {
		bottom: calc(var(--space-3) + 44px);
	}

	.floating-error-icon {
		display: flex;
		align-items: center;
		color: var(--danger);
		--icon-size: 16px;
		flex-shrink: 0;
	}

	.floating-error-text {
		color: var(--ink);
		line-height: 1.4;
	}

	.floating-error-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		margin-left: var(--space-1);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 12px;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.floating-error-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.modal-sub {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		margin: 0;
	}

	.update-log {
		max-height: 120px;
		overflow-y: auto;
		background: var(--bg-sunken);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--ink-faint);
		white-space: pre-wrap;
		margin: 0;
	}
</style>