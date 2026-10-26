<script lang="ts">
	import './companion.css';
	import { m } from '#lib/paraglide/messages.js';
	import { onMount, tick, untrack } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { companionStore, type AttentionRequest, type QuickTaskAiParsed } from '#lib/stores/companion.svelte.ts';
	import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
	import { quotaStore } from '#lib/stores/quota.svelte.ts';
	import { scheduleStore } from '#lib/stores/schedule.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { modelSettingsStore, STANDARD_ROLES, resolveCatalogModel } from '#lib/stores/modelSettings.svelte.ts';
	import { themeStore } from '#lib/stores/theme.svelte.ts';
	import { THEMES, automaticProjectHue } from '#lib/theme.ts';
	import UsagePopover from '#lib/components/UsagePopover.svelte';
	import { taskStore, type StudioTask } from '#lib/stores/tasks.svelte.ts';
	import { rankFrequentTaskModels } from '#lib/stores/taskSerialization.ts';
	import { taskLabel } from '#lib/stores/taskTitle.ts';
	import { isImageFile, prepareImage } from '#lib/agent/images.ts';
	import type { AvailableCommand, ImageContent } from '#lib/agent/wire.ts';
	import type { ComposerSegment } from '#lib/agent/composerDoc.ts';
	import type ComposerEditor from '#lib/agent/components/ComposerEditor.svelte';
	import { ROLE_HUES } from '#lib/agent/roleHues.ts';
	import { FAST_EXIT_MS, motionReduced } from '#lib/agent/motionState.svelte.ts';
	import { parseQuickTaskLocal, type LocalQuickTask } from '#lib/companion/quickTaskLocal.ts';
	import { directiveDisplayName } from '#lib/stores/taskDirectives.ts';
	import CompanionShell from './CompanionShell.svelte';
	import CompanionComposer, {
		type CompanionSuggestSources,
		type SelectedProjectMeta,
		type SelectedDirectiveMeta,
		type SelectedRoleMeta
	} from './CompanionComposer.svelte';
	import CompanionCenterReader from './CompanionCenterReader.svelte';
	import { trayFold } from '#lib/agent/motion.ts';
	import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
	import { STUDIO_SLASH_COMMANDS, mergeCommands } from '#lib/agent/commands.ts';
	import { sessionCompletions } from '#lib/agent/completion.svelte.ts';
	import CompanionRightRail, { type RailProjectItem } from './CompanionRightRail.svelte';
	import type { CompanionAskHandlers } from './companionAsk';
	import { promptBus } from '#lib/agent/promptBus.ts';
	import {
		createInitialPresentationState,
		selectProject,
		returnToPreviousSelection,
		setConversationSnapshot,
		toggleConversationExpanded,
		setConversationDraft,
		startSendingReply,
		markReplySent,
		setSendReplyError,
		isProjectUnread,
		buildGlobalQueueItems,
		conversationKey,
		getOrCreateConversation,
		type CompanionPresentationState,
		type CompanionViewMode
	} from '#lib/companion/companionPresentation.ts';
	import type { CompanionConversationTarget } from '#lib/companion/conversation.ts';

	let editor = $state<ComposerEditor | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let workspaceEl = $state<HTMLElement | null>(null);

	/** Testo wire dell'editor: i badge diventano `#progetto`, `/direttiva`, `!ruolo`, `@file`. */
	let taskInput = $state('');
	let aiParsed = $state<QuickTaskAiParsed | null>(null);
	let isSaving = $state(false);
	let successNotice = $state<string | null>(null);
	let expandedHistory = $state<Record<string, boolean>>({});
	let replyDrafts = $state<Record<string, string>>({});
	let customReplyProjects = $state<Record<string, boolean>>({});
	let usageOpen = $state(false);
	let justOpened = $state(false);
	let leaving = $state(false);
	let attachedImages = $state<ImageContent[]>([]);
	let imageProcessingCount = $state(0);
	let isFileDialogOpen = false;
	let attachmentError = $state<string | null>(null);
	let bodyEl = $state<HTMLElement | null>(null);
	let contentEl = $state<HTMLElement | null>(null);
	let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
	let selectedProjectMeta = $state<SelectedProjectMeta | null>(null);
	let selectedDirectives = $state<SelectedDirectiveMeta[]>([]);
	let selectedRole = $state<SelectedRoleMeta | null>(null);

	function handleSelectProjectMeta(proj: SelectedProjectMeta) {
		selectedProjectMeta = proj;
	}

	function handleRemoveProjectMeta() {
		selectedProjectMeta = null;
	}

	function handleAddDirective(dir: SelectedDirectiveMeta) {
		if (!selectedDirectives.some((d) => d.id === dir.id)) {
			selectedDirectives = [...selectedDirectives, dir];
		}
	}

	function handleRemoveDirective(id: string) {
		selectedDirectives = selectedDirectives.filter((d) => d.id !== id);
	}

	function handleSelectRole(role: SelectedRoleMeta) {
		selectedRole = role;
	}

	function handleRemoveRole() {
		selectedRole = null;
	}
	const presentation = $state<CompanionPresentationState>(createInitialPresentationState());
	const conversationLoads = new Map<string, number>();
	const laneTitles = $state<Record<string, string>>({});

	function cancelAutoHide() {
		if (autoHideTimer) {
			clearTimeout(autoHideTimer);
			autoHideTimer = null;
		}
	}

	let viewDisposed = false;
	const unlisteners: UnlistenFn[] = [];

	$effect(() => {
		return () => {
			cancelAutoHide();
		};
	});

	const attentionList = $derived(companionStore.attentionRequests);
	const knownProjects = $derived(
		companionStore.projects.length > 0 ? companionStore.projects : projectStore.projects
	);
	const knownDirectives = $derived(settingsStore.taskDirectives.filter((d) => !d.hidden));

	/** Tinta d'identita' di ogni progetto: la stessa nelle card e nei badge `#progetto`. */
	const projectHues = $derived.by(() => {
		const theme = THEMES[themeStore.current] ?? THEMES['titanium'];
		const hues = new Map<string, number>();
		for (const project of knownProjects) {
			hues.set(
				project.id,
				!project.canonicalProjectPath || project.colorMode === 'custom'
					? project.hue
					: automaticProjectHue(theme, project.canonicalProjectPath)
			);
		}
		return hues;
	});

	const configuredRoles = $derived.by(() => {
		const rolesMap = modelSettingsStore.config?.modelRoles ?? modelSettingsStore.draftConfig?.modelRoles ?? {};
		return STANDARD_ROLES.flatMap((role) => {
			const selector = rolesMap[role.id]?.trim();
			if (!selector) return [];
			const model = resolveCatalogModel(modelSettingsStore.catalog, selector);
			return [{
				id: role.id,
				label: role.label,
				selector,
				modelLabel: model?.name ?? selector
			}];
		});
	});

	const frequentModels = $derived.by(() =>
		rankFrequentTaskModels(taskStore.origins, 4).flatMap((entry) => {
			const model = resolveCatalogModel(modelSettingsStore.assignableCatalog, entry.modelSelector);
			return model ? [{ ...entry, model }] : [];
		})
	);

	const parseInput = $derived({
		projects: knownProjects.map((p) => ({ id: p.id, name: p.name, label: p.label ?? undefined, path: p.canonicalProjectPath ?? '' })),
		directives: knownDirectives.map((d) => ({ id: d.id, name: directiveDisplayName(d), tag: d.tag, hidden: d.hidden })),
		roles: configuredRoles.map((role) => role.id),
		modelSelectors: modelSettingsStore.assignableCatalog.map((model) => model.selector)
	});

	const allAvailableCommands = $derived.by(() => {
		const commandsMap = new Map<string, AvailableCommand>();
		for (const runtime of companionStore.projectRuntimes) {
			if (runtime.availableCommands) {
				for (const cmd of runtime.availableCommands) {
					commandsMap.set(cmd.name, cmd);
				}
			}
		}
		if (currentConvState?.snapshot?.availableCommands) {
			for (const cmd of currentConvState.snapshot.availableCommands) {
				commandsMap.set(cmd.name, cmd);
			}
		}
		return mergeCommands(STUDIO_SLASH_COMMANDS, Array.from(commandsMap.values()));
	});

	const suggestSources = $derived<CompanionSuggestSources>({
		projects: knownProjects
			.filter((p) => p.canonicalProjectPath)
			.map((p) => ({
				name: p.name,
				label: p.label?.trim() || p.name,
				hue: projectHues.get(p.id) ?? p.hue,
				path: p.canonicalProjectPath ?? undefined
			})),
		directives: knownDirectives.map((d) => ({
			id: d.id,
			value: (d.tag ?? directiveDisplayName(d)).replace(/^\//, ''),
			label: directiveDisplayName(d),
			hint: d.tag
		})),
		roles: configuredRoles.map((role) => ({
			value: role.id,
			label: role.label,
			hint: role.modelLabel,
			hue: ROLE_HUES[role.id]
		})),
		models: frequentModels.map(({ model, count }) => ({
			value: model.selector,
			label: model.name,
			hint:
				count === 1
					? m.companion_model_uses_one({ provider: model.provider })
					: m.companion_model_uses_other({ provider: model.provider, count }),
			search: `${model.selector} ${model.name} ${model.provider}`.toLowerCase()
		})),
		commands: allAvailableCommands
	});

	const local = $derived<LocalQuickTask>(parseQuickTaskLocal(taskInput, parseInput));
	const isBusy = $derived(isSaving || companionStore.isParsingTask || imageProcessingCount > 0);
	const canSave = $derived((taskInput.trim().length > 0 || attachedImages.length > 0) && !isBusy);
	const statusText = $derived(
		!isBusy
			? null
			: imageProcessingCount > 0
				? m.companion_status_processing_images()
				: companionStore.isParsingTask
					? m.companion_status_interpreting_ai()
					: m.companion_status_saving()
	);
	const composerErrors = $derived(
		[attachmentError, companionStore.parseError].filter((error): error is string => Boolean(error))
	);
	/** Ambiguita' o progetto mancante: dall'AI se ha gia' risposto, altrimenti dal parse locale. */
	const previewNotes = $derived.by(() => {
		if (!taskInput.trim() && attachedImages.length === 0) return [];
		const ambiguities = aiParsed?.ambiguities ?? [];
		if (ambiguities.length > 0) return ambiguities;
		const projectPath = selectedProjectMeta?.path ?? (aiParsed ? aiParsed.projectPath : local.projectPath);
		return projectPath ? [] : [m.companion_missing_project_hint()];
	});

	let hasAppliedInitialSelection = false;

	const selectedProject = $derived.by<Project | null>(() => {
		if (presentation.selectedProjectId) {
			return (
				knownProjects.find(
					(p) => p.id.toLowerCase() === presentation.selectedProjectId?.toLowerCase()
				) ?? null
			);
		}
		return null;
	});

	$effect(() => {
		if (hasAppliedInitialSelection) return;
		if (!presentation.selectedProjectId) {
			if (railQuestions.length > 0) {
				const firstQ = railQuestions[0];
				presentation.selectedProjectId = firstQ.project.id;
				presentation.selectedLaneId = firstQ.laneId;
				presentation.viewMode = 'question';
				presentation.selectedRequestId = firstQ.requestId ?? null;
				hasAppliedInitialSelection = true;
			} else if (railUnread.length > 0) {
				const firstU = railUnread[0];
				presentation.selectedProjectId = firstU.project.id;
				presentation.selectedLaneId = firstU.laneId;
				presentation.viewMode = 'answer';
				presentation.selectedRequestId = null;
				hasAppliedInitialSelection = true;
			} else if (knownProjects.length > 0) {
				hasAppliedInitialSelection = true;
			}
		}
	});

	async function loadConversationForSelected(projectId: string, laneId = 'main', refresh = false) {
		const conv = getOrCreateConversation(presentation, projectId, laneId);
		if (!refresh && (conv.snapshot || conv.isLoading)) return;
		const key = conversationKey(projectId, laneId);
		const request = (conversationLoads.get(key) ?? 0) + 1;
		conversationLoads.set(key, request);
		conv.isLoading = true;
		conv.loadError = null;
		try {
			const snapshot = await companionStore.loadConversation(projectId, laneId);
			if (conversationLoads.get(key) === request) {
				setConversationSnapshot(presentation, snapshot);
				await tick();
				if (workspaceEl && presentation.selectedProjectId === projectId &&
					presentation.selectedLaneId === laneId && presentation.viewMode === 'answer') {
					workspaceEl.scrollTop = getOrCreateConversation(presentation, projectId, laneId).scroll;
				}
			}
		} catch (error) {
			if (conversationLoads.get(key) === request) {
				conv.loadError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (conversationLoads.get(key) === request) conv.isLoading = false;
		}
	}

	$effect(() => {
		const pid = presentation.selectedProjectId;
		const laneId = presentation.selectedLaneId;
		if (pid && presentation.viewMode === 'answer') {
			untrack(() => void loadConversationForSelected(pid, laneId));
		}
	});

	const currentConvState = $derived.by(() => {
		const pid = presentation.selectedProjectId;
		return pid ? presentation.conversations[conversationKey(pid, presentation.selectedLaneId)] ?? null : null;
	});

	const currentAttention = $derived.by<AttentionRequest | null>(() => {
		const pid = presentation.selectedProjectId ?? selectedProject?.id;
		if (!pid) return null;
		return (
			attentionList.find((a) =>
				a.projectId.toLowerCase() === pid.toLowerCase() &&
				(a.laneId ?? 'main').toLowerCase() === presentation.selectedLaneId.toLowerCase() &&
				a.pendingUi.requestId === presentation.selectedRequestId
			) ?? null
		);
	});

	$effect(() => {
		if (presentation.viewMode === 'question' && !currentAttention) {
			presentation.selectedRequestId = null;
			presentation.selectedProjectId = null;
			presentation.viewMode = 'answer';
		}
	});

	// Una risposta aperta come "da leggere" e poi letta o superata nella finestra
	// principale (risposta in chat, nuovo turno, domanda) chiude la card: le due
	// superfici mostrano lo stesso stato. Una card aperta a mano su una risposta
	// gia' letta resta aperta, e le chiusure della companion stessa (Letto,
	// risposta inviata) seguono il proprio percorso.
	let unreadCardKey: string | null = null;
	$effect(() => {
		const pid = presentation.selectedProjectId;
		if (!pid || presentation.viewMode !== 'answer') {
			unreadCardKey = null;
			return;
		}
		const key = conversationKey(pid, presentation.selectedLaneId);
		if (unreadProjectIds.has(pid.toLowerCase())) {
			unreadCardKey = key;
			return;
		}
		const consumed = unreadCardKey === key;
		unreadCardKey = null;
		const conv = presentation.conversations[key];
		if (!consumed || (conv?.lastRepliedMessageId && conv.lastRepliedMessageId === conv.snapshot?.message?.id)) return;
		presentation.selectedProjectId = null;
		presentation.selectedRequestId = null;
	});

	const currentLaneLabel = $derived(
		presentation.selectedLaneId === 'main'
			? m.companion_lane_main()
			: laneTitles[conversationKey(presentation.selectedProjectId ?? '', presentation.selectedLaneId)] ||
				currentAttention?.laneTitle ||
				(selectedProject?.lane.laneId === presentation.selectedLaneId ? selectedProject.lane.title : presentation.selectedLaneId)
	);

	const queuedForSelected = $derived.by<number>(() => {
		if (!selectedProject?.canonicalProjectPath) return 0;
		return taskStore.tasksFor(selectedProject.canonicalProjectPath).filter(
			(t) => t.status === 'queued'
		).length;
	});

	const previousProjectName = $derived.by<string | null>(() => {
		if (!presentation.previousSelection) return null;
		const prevId = presentation.previousSelection.projectId;
		const p = knownProjects.find((proj) => proj.id.toLowerCase() === prevId.toLowerCase());
		return p ? p.name : prevId;
	});

	const effectiveProjectPath = $derived(
		selectedProjectMeta?.path ?? local.projectPath ?? null
	);

	const topDestinationName = $derived.by<string | null>(() => {
		return selectedProjectMeta?.name || local.projectName || aiParsed?.projectName || null;
	});

	const attentionProjectIds = $derived(
		new Set(attentionList.map((a) => a.projectId.toLowerCase()))
	);

	const unreadProjectIds = $derived.by(() => {
		const set = new Set<string>();
		const runtimes = companionStore.projectRuntimes;
		const runtimesMap = new Map(runtimes.map((r) => [r.projectId.toLowerCase(), r]));

		for (const p of knownProjects) {
			const runtime = runtimesMap.get(p.id.toLowerCase());
			const hasAtt = attentionProjectIds.has(p.id.toLowerCase());
			const unread = isProjectUnread(
				presentation,
				p.id,
				runtime?.latestAssistant?.laneId ?? p.lane.laneId,
				p.lane.agentState,
				hasAtt,
				runtime?.latestAssistant,
				// La finestra principale e' la fonte del "letto"; lo store locale copre
				// la conferma data dalla companion prima del giro successivo del digest.
				(sessionId, messageId) =>
					(runtime?.latestAssistant?.sessionId === sessionId &&
						runtime.latestAssistant.messageId === messageId &&
						runtime.latestAssistant.seen === true) ||
					(sessionCompletions.get(sessionId)?.id === messageId && sessionCompletions.get(sessionId)?.seen === true)
			);
			if (unread) {
				set.add(p.id.toLowerCase());
			}
		}
		return set;
	});

	const globalQueueItems = $derived.by(() => {
		const runtimesMap: Record<string, { canRunTask?: boolean; runBlockReason?: string }> = {};
		for (const r of companionStore.projectRuntimes) {
			runtimesMap[r.projectId] = r;
		}

		const tasksMap: Record<string, StudioTask[]> = {};
		for (const p of knownProjects) {
			if (p.canonicalProjectPath) {
				tasksMap[p.canonicalProjectPath] = taskStore.tasksFor(p.canonicalProjectPath);
			}
		}

		return buildGlobalQueueItems(
			knownProjects,
			tasksMap,
			runtimesMap,
			attentionProjectIds,
			unreadProjectIds,
			(t) => taskLabel(t) || t.prompt || m.queue_drawer_title_only_images(),
			{
				question: m.companion_badge_question(),
				busy: m.companion_state_working(),
				unread: m.companion_rail_unread(),
				idle: m.companion_state_idle(),
				reasonAttention: m.companion_reason_attention(),
				reasonBusy: m.companion_reason_busy(),
				reasonBlockedDefault: m.companion_reason_blocked_default()
			}
		);
	});

	const railQuestions = $derived.by<RailProjectItem[]>(() => {
		return attentionList.flatMap((req) => {
			const project = knownProjects.find((p) => p.id.toLowerCase() === req.projectId.toLowerCase());
			if (!project) return [];
			return [{
				project,
				laneId: req.laneId ?? 'main',
				requestId: req.pendingUi.requestId,
				name: req.laneTitle ? `${req.projectName} · ${req.laneTitle}` : req.projectName,
				hue: req.projectHue
			}];
		});
	});

	const railUnread = $derived.by<RailProjectItem[]>(() => {
		return knownProjects
			.filter((p) => unreadProjectIds.has(p.id.toLowerCase()))
			.map((p) => {
				const runtime = companionStore.projectRuntimes.find((r) => r.projectId === p.id);
				const laneId = runtime?.latestAssistant?.laneId ?? p.lane.laneId;
				const conv = presentation.conversations[conversationKey(p.id, laneId)];
				return {
					project: p,
					laneId,
					name: p.name,
					hue: projectHues.get(p.id) ?? p.hue,
					activityText: runtime?.headsUp,
					hasDraft: Boolean(conv?.draft?.trim())
				};
			});
	});

	const railWorking = $derived.by<RailProjectItem[]>(() => {
		return knownProjects
			.filter((p) => p.lane.agentState === 'working')
			.map((p) => {
				const rt = companionStore.projectRuntimes.find((r) => r.projectId === p.id);
				return {
					project: p,
					laneId: p.lane.laneId,
					name: p.name,
					hue: projectHues.get(p.id) ?? p.hue,
					activityText: rt?.headsUp || rt?.activity?.text
				};
			});
	});

	const railParked = $derived.by<RailProjectItem[]>(() => {
		return knownProjects
			.filter((p) => {
				const pid = p.id.toLowerCase();
				return (
					p.lane.agentState !== 'working' &&
					!attentionProjectIds.has(pid) &&
					!unreadProjectIds.has(pid)
				);
			})
			.map((p) => ({
				project: p,
				laneId: 'main',
				name: p.name,
				hue: projectHues.get(p.id) ?? p.hue
			}));
	});

	$effect(() => {
		for (const project of knownProjects) {
			if (project.canonicalProjectPath) {
				void taskStore.loadProject(project.canonicalProjectPath);
			}
		}
	});

	/**
	 * Altezza della finestra in modalita' a scomparsa: la decide il contenuto.
	 */
	$effect(() => {
		const body = bodyEl;
		const content = contentEl;
		if (!body || !content || typeof ResizeObserver === 'undefined') return;
		if (companionStore.isPinned) return;

		let frame = 0;
		let pending: number | null = null;
		let inFlight = false;
		let lastSent = 0;

		const contentHeight = () => {
			let height = content.offsetHeight;
			const panel = content.querySelector('.suggest-panel');
			if (panel) {
				const panelBottom =
					panel.getBoundingClientRect().bottom - content.getBoundingClientRect().top + 12;
				height = Math.max(height, panelBottom);
			}
			return height + (window.innerHeight - body.clientHeight);
		};

		const flush = async () => {
			inFlight = true;
			while (pending !== null) {
				const height = pending;
				pending = null;
				if (Math.abs(height - lastSent) < 1) continue;
				lastSent = height;
				await companionStore.fitToContent(height);
			}
			inFlight = false;
		};

		const measure = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				pending = contentHeight();
				if (!inFlight) void flush();
			});
		};

		const resizeObserver = new ResizeObserver(measure);
		resizeObserver.observe(content);
		const mutationObserver = new MutationObserver(measure);
		mutationObserver.observe(content, { childList: true, subtree: true });
		measure();
		return () => {
			if (frame) cancelAnimationFrame(frame);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	});

	function refreshCompanionState() {
		companionStore.requestSync();
		for (const project of knownProjects) {
			if (project.canonicalProjectPath) {
				void taskStore.reloadProject(project.canonicalProjectPath);
			}
		}
	}

	function trackListener(registration: Promise<UnlistenFn>) {
		void registration.then((fn) => {
			if (viewDisposed) fn();
			else unlisteners.push(fn);
		});
	}

	onMount(() => {
		void companionStore.init();
		refreshCompanionState();
		void quotaStore.init();
		scheduleStore.init();
		void settingsStore.init();
		void modelSettingsStore.ensureLoaded();
		void tick().then(() => {
			editor?.focusEnd();
		});
		playOpenAnimation();

		companionStore.setExitAnimation({
			play: () => {
				if (motionReduced()) return Promise.resolve();
				leaving = true;
				return new Promise((resolve) => setTimeout(resolve, FAST_EXIT_MS));
			},
			cancel: () => {
				leaving = false;
			}
		});

		trackListener(
			listen('companion-summon', () => {
				refreshCompanionState();
				playOpenAnimation();
				void tick().then(() => editor?.focusEnd());
				if (!presentation.selectedProjectId) {
					if (railQuestions.length > 0) {
						handleSelectProject(railQuestions[0].project.id, railQuestions[0].laneId, 'question', railQuestions[0].requestId);
					} else if (railUnread.length > 0) {
						handleSelectProject(railUnread[0].project.id, railUnread[0].laneId, 'answer');
					}
				}
			})
		);
		trackListener(listen('companion-dismiss', () => void companionStore.hideCompanion()));

		const handleBlur = () => {
			if (
				!companionStore.isPinned &&
				!usageOpen &&
				!isFileDialogOpen &&
				settingsStore.appearance.companionSpotlightDismiss === 'esc-and-blur'
			) {
				void companionStore.hideCompanion();
			}
		};
		const handleFocus = () => {
			isFileDialogOpen = false;
		};

		window.addEventListener('blur', handleBlur);
		window.addEventListener('focus', handleFocus);

		return () => {
			viewDisposed = true;
			companionStore.setExitAnimation(null);
			window.removeEventListener('blur', handleBlur);
			window.removeEventListener('focus', handleFocus);
			for (const fn of unlisteners) fn();
		};
	});

	function playOpenAnimation() {
		leaving = false;
		justOpened = false;
		void tick().then(() => {
			justOpened = true;
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (e.defaultPrevented) return;
			e.preventDefault();
			if (usageOpen) {
				usageOpen = false;
				return;
			}
			void companionStore.hideCompanion();
		}
	}

	function handleInput() {
		taskInput = editor?.getWireText() ?? '';
		aiParsed = null;
		companionStore.parseError = null;
	}

	async function handleProcessFiles(files: FileList | File[]) {
		const candidates = Array.from(files);
		if (candidates.length === 0) return;
		imageProcessingCount += 1;
		attachmentError = null;
		try {
			for (const file of candidates) {
				if (!isImageFile(file)) {
					attachmentError = m.ui_companionview_sono_supportati_solo_file_immagine_f024();
					continue;
				}
				const result = await prepareImage(file);
				if ('error' in result) {
					attachmentError = result.error;
				} else {
					attachedImages = [...attachedImages, result];
				}
			}
		} finally {
			imageProcessingCount -= 1;
		}
	}

	function triggerFileInput() {
		if (!fileInputEl) return;
		isFileDialogOpen = true;
		fileInputEl.click();
	}

	function onFileInputChange(event: Event) {
		isFileDialogOpen = false;
		const input = event.currentTarget as HTMLInputElement;
		if (input.files?.length) {
			void handleProcessFiles(input.files);
		}
		input.value = '';
	}

	async function handleSaveTask() {
		const text = taskInput.trim();
		if ((!text && attachedImages.length === 0) || isBusy) return;

		const targetProjectPath = selectedProjectMeta?.path ?? local.projectPath;
		const targetProjectName = selectedProjectMeta?.name ?? local.projectName;
		const targetRole = selectedRole?.kind === 'role' ? selectedRole.value : local.role;
		const targetModelSelector = selectedRole?.kind === 'model' ? selectedRole.value : local.modelSelector;
		const confirmedDirectiveIds = selectedDirectives.map((d) => d.id);
		const targetDirectiveIds = [...new Set([...confirmedDirectiveIds, ...local.directiveIds])];

		if (!text && !targetProjectPath) {
			companionStore.parseError = m.ui_companionview_indica_il_progetto_con_prima_di_salvare_4185();
			return;
		}

		isSaving = true;
		try {
			let toSave: QuickTaskAiParsed | null = null;

			if (targetProjectPath) {
				toSave = {
					projectPath: targetProjectPath,
					projectName: targetProjectName,
					taskPrompt: local.taskPrompt || text,
					role: targetRole,
					modelSelector: targetModelSelector,
					directiveIds: targetDirectiveIds,
					ambiguities: []
				};
			} else {
				const res = await companionStore.parseQuickTask(text);
				if (!res || !res.projectPath) {
					aiParsed = res;
					return;
				}
				aiParsed = res;
				toSave = {
					...res,
					role: targetRole ?? res.role,
					modelSelector: targetModelSelector ?? res.modelSelector,
					directiveIds: [...new Set([...res.directiveIds, ...targetDirectiveIds])]
				};
			}

			const ok = await companionStore.saveTask(toSave, attachedImages);
			if (ok) {
				successNotice = m.companion_task_saved({
					project: toSave.projectName || m.companion_task_saved_fallback()
				});
				companionStore.parseError = null;
				attachmentError = null;
				editor?.clear();
				taskInput = '';
				attachedImages = [];
				aiParsed = null;
				selectedProjectMeta = null;
				selectedDirectives = [];
				selectedRole = null;
				cancelAutoHide();

				// Conferma temporanea per 5 secondi completi, con timer indipendente
				autoHideTimer = setTimeout(() => {
					autoHideTimer = null;
					successNotice = null;
					if (!companionStore.isPinned && taskInput.trim().length === 0) {
						void companionStore.hideCompanion();
					}
				}, 5000);
			}
		} finally {
			isSaving = false;
		}
	}

	function handleSelectProject(projectId: string, laneId = 'main', mode: CompanionViewMode = 'answer', requestId?: string) {
		const scroll = workspaceEl?.scrollTop ?? 0;
		selectProject(presentation, projectId, laneId, mode, scroll);
		presentation.selectedRequestId = requestId ?? null;
		const project = knownProjects.find((p) => p.id.toLowerCase() === projectId.toLowerCase());
		const request = attentionList.find((a) => a.pendingUi.requestId === requestId && a.projectId.toLowerCase() === projectId.toLowerCase());
		const title = request?.laneTitle || (project?.lane.laneId === laneId ? project.lane.title : null);
		if (title) laneTitles[conversationKey(projectId, laneId)] = title;
		if (mode === 'answer') void loadConversationForSelected(projectId, laneId, true);
		void tick().then(() => {
			const targetConv = getOrCreateConversation(presentation, projectId, laneId);
			if (workspaceEl) {
				workspaceEl.scrollTop = mode === 'question' ? targetConv.questionScroll : targetConv.scroll;
			}
		});
	}

	function handleReturnToPrevious() {
		const scroll = workspaceEl?.scrollTop ?? 0;
		const prev = presentation.previousSelection;
		if (prev) {
			returnToPreviousSelection(presentation, scroll);
			void loadConversationForSelected(prev.projectId, prev.laneId);
			void tick().then(() => {
				const targetConv = getOrCreateConversation(presentation, prev.projectId, prev.laneId);
				if (workspaceEl) {
					workspaceEl.scrollTop = prev.viewMode === 'question' ? targetConv.questionScroll : targetConv.scroll;
				}
			});
		}
	}

	function handleReloadConversation() {
		const projectId = presentation.selectedProjectId;
		if (!projectId) return;
		presentation.viewMode = 'answer';
		presentation.selectedRequestId = null;
		void loadConversationForSelected(projectId, presentation.selectedLaneId, true);
	}

	function handleToggleExpanded() {
		const projectId = presentation.selectedProjectId;
		if (!projectId) return;
		const conv = getOrCreateConversation(presentation, projectId, presentation.selectedLaneId);
		if (toggleConversationExpanded(presentation, projectId, presentation.selectedLaneId, workspaceEl?.scrollTop ?? 0)) {
			void tick().then(() => {
				if (workspaceEl) workspaceEl.scrollTop = conv.scroll;
			});
		}
	}

	function rememberReadingScroll() {
		if (!workspaceEl || !currentConvState) return;
		if (presentation.viewMode === 'question') currentConvState.questionScroll = workspaceEl.scrollTop;
		else if (currentConvState.expanded) currentConvState.scroll = workspaceEl.scrollTop;
	}

	async function handleSendReply() {
		const projectId = presentation.selectedProjectId;
		const laneId = presentation.selectedLaneId;
		if (!projectId) return;

		const conv = getOrCreateConversation(presentation, projectId, laneId);
		const text = conv.draft.trim();
		if (!text || conv.isSending || conv.isLoading || conv.loadError || conv.snapshot?.canSend === false) return;

		if (!conv.snapshot?.sessionId) {
			setSendReplyError(presentation, projectId, laneId, m.companion_no_active_session());
			return;
		}

		const target: CompanionConversationTarget = {
			projectId,
			laneId,
			sessionId: conv.snapshot.sessionId
		};
		const repliedMessageId = conv.snapshot.message?.id ?? null;

		startSendingReply(presentation, projectId, laneId);
		try {
			await companionStore.sendConversation(target, text);
			markReplySent(presentation, projectId, laneId, text, repliedMessageId, target.sessionId);
			setTimeout(() => {
				presentation.selectedProjectId = null;
				presentation.selectedRequestId = null;
			}, 1000);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			conv.isSending = false;
			conv.sendError = message;
		}
	}

	function handleRunTask(projectId: string, taskId: string) {
		void companionStore.runTask(projectId, taskId, false);
	}

	async function handleQuickReplySelect(
		projectId: string,
		value: string,
		laneId?: string | null,
		requestId?: string | null,
		note?: string
	) {
		delete replyDrafts[projectId];
		delete customReplyProjects[projectId];
		const targetReq = companionStore.attentionRequests.find(
			(r) => r.projectId === projectId && (!laneId || (r.laneId ?? 'main') === laneId)
		);
		const targetReqId = requestId ?? targetReq?.pendingUi?.requestId;

		presentation.selectedProjectId = null;
		presentation.selectedRequestId = null;

		if (targetReq?.pendingUi?.method === 'ask') {
			const questions = targetReq.pendingUi.questions as Array<{ id?: string }> | undefined;
			const qId = questions?.[0]?.id ?? 'q1';
			const trimmedNote = note?.trim();
			const answer = trimmedNote
				? {
						action: 'wizard' as const,
						answers: [{ id: qId, selectedOptions: [], customInput: `${value} (nota: ${trimmedNote})` }]
				  }
				: {
						action: 'wizard' as const,
						answers: [{ id: qId, selectedOptions: [value] }]
				  };
			if (targetReqId) {
				const handled = await companionStore.respondPrompt(targetReqId, answer, laneId);
				if (handled) return;
			}
			await companionStore.respondUi(projectId, answer, laneId, targetReqId);
			return;
		}

		const trimmedNote = note?.trim();
		const finalValue = trimmedNote ? `${value} (nota: ${trimmedNote})` : value;
		if (targetReqId) {
			const handled = await companionStore.respondPrompt(targetReqId, { action: 'select', value: finalValue }, laneId);
			if (handled) return;
		}
		await companionStore.respondUi(projectId, { action: 'select', value: finalValue }, laneId, targetReqId);
	}

	async function handleQuickReplyConfirm(
		projectId: string,
		confirmed: boolean,
		laneId?: string | null,
		requestId?: string | null
	) {
		presentation.selectedProjectId = null;
		presentation.selectedRequestId = null;
		delete customReplyProjects[projectId];
		const targetReqId =
			requestId ??
			companionStore.attentionRequests.find(
				(r) => r.projectId === projectId && (!laneId || (r.laneId ?? 'main') === laneId)
			)?.pendingUi?.requestId;
		if (targetReqId) {
			const handled = await companionStore.respondPrompt(targetReqId, { action: 'confirm', confirmed }, laneId);
			if (handled) return;
		}
		await companionStore.respondUi(projectId, { action: 'confirm', confirmed }, laneId, targetReqId);
	}

	async function handleQuickReplyCancel(
		projectId: string,
		laneId?: string | null,
		requestId?: string | null
	) {
		presentation.selectedProjectId = null;
		presentation.selectedRequestId = null;
		delete customReplyProjects[projectId];
		const targetReqId =
			requestId ??
			companionStore.attentionRequests.find(
				(r) => r.projectId === projectId && (!laneId || (r.laneId ?? 'main') === laneId)
			)?.pendingUi?.requestId;
		if (targetReqId) {
			const handled = await promptBus.cancelRequest(targetReqId, { projectId, laneId });
			companionStore.clearAttentionRequest(projectId, laneId);
			if (handled) return;
		}
		await companionStore.respondUi(projectId, { action: 'cancel' }, laneId, targetReqId);
	}

	async function handleQuickReplyText(
		projectId: string,
		laneId?: string | null,
		requestId?: string | null,
		note?: string
	) {
		const request = companionStore.attentionRequests.find(
			(req) => req.projectId === projectId && (!laneId || (req.laneId ?? 'main') === laneId)
		);
		let value = (replyDrafts[projectId] ?? request?.pendingUi.prefill ?? '').trim();
		if (note?.trim()) {
			value = value ? `${value} (nota: ${note.trim()})` : note.trim();
		}
		if (!value) return;
		delete replyDrafts[projectId];
		delete customReplyProjects[projectId];
		const targetReqId = requestId ?? request?.pendingUi?.requestId;

		presentation.selectedProjectId = null;
		presentation.selectedRequestId = null;

		if (request?.pendingUi?.method === 'ask') {
			const questions = request.pendingUi.questions as Array<{ id?: string }> | undefined;
			const qId = questions?.[0]?.id ?? 'q1';
			const answer = {
				action: 'wizard' as const,
				answers: [{ id: qId, selectedOptions: [], customInput: value }]
			};
			if (targetReqId) {
				const handled = await companionStore.respondPrompt(targetReqId, answer, laneId);
				if (handled) return;
			}
			await companionStore.respondUi(projectId, answer, laneId, targetReqId);
			return;
		}

		if (targetReqId) {
			const handled = await companionStore.respondPrompt(targetReqId, { action: 'select', value }, laneId);
			if (handled) return;
		}
		await companionStore.respondUi(projectId, { action: 'select', value }, laneId, targetReqId);
	}

	function draftFor(req: AttentionRequest): string {
		return replyDrafts[req.projectId] ?? req.pendingUi.prefill ?? '';
	}

	function wantsText(pending: AttentionRequest['pendingUi']): boolean {
		if (pending.options && pending.options.length > 0) return false;
		return pending.method === 'input' || pending.method === 'editor';
	}

	function prefillProject(project: Project) {
		selectedProjectMeta = {
			name: project.name,
			label: project.label?.trim() || project.name,
			hue: projectHues.get(project.id) ?? project.hue,
			path: project.canonicalProjectPath ?? undefined
		};
		editor?.focusEnd();
		handleInput();
	}

	const askHandlers = $derived<CompanionAskHandlers>({
		expandedHistory,
		customReplyProjects,
		onToggleHistory: (projectId: string) => {
			expandedHistory[projectId] = !expandedHistory[projectId];
		},
		onReplyDraftChange: (projectId: string, value: string) => {
			replyDrafts[projectId] = value;
		},
		onCustomReplyToggle: (projectId: string, open: boolean) => {
			customReplyProjects[projectId] = open;
		},
		onQuickReplySelect: handleQuickReplySelect,
		onQuickReplyConfirm: handleQuickReplyConfirm,
		onQuickReplyCancel: handleQuickReplyCancel,
		onQuickReplyText: handleQuickReplyText,
		onResolveQuotaBlocked: (projectId: string, selector: string, laneId?: string | null) => {
			presentation.selectedProjectId = null;
			presentation.selectedRequestId = null;
			return companionStore.resolveQuotaBlocked(projectId, selector, undefined, laneId);
		},
		onDismissQuotaBlocked: (projectId: string, laneId?: string | null) => {
			presentation.selectedProjectId = null;
			presentation.selectedRequestId = null;
			return companionStore.dismissQuotaBlocked(projectId, laneId);
		},
		onWaitQuotaReset: (projectId: string, laneId?: string | null) => {
			presentation.selectedProjectId = null;
			presentation.selectedRequestId = null;
			return companionStore.waitQuotaReset(projectId, laneId);
		},
		draftFor,
		wantsText
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<CompanionShell
	isPinned={companionStore.isPinned}
	attentionCount={attentionList.length}
	{justOpened}
	{leaving}
	onOpenEnd={() => (justOpened = false)}
	onTogglePin={() => void companionStore.setPinned(!companionStore.isPinned)}
	onClose={() => void companionStore.hideCompanion()}
>
	{#if usageOpen}
		<UsagePopover open={usageOpen} onClose={() => (usageOpen = false)} />
	{/if}

	<main class="companion-body priority-body" class:pinned={companionStore.isPinned} bind:this={bodyEl}>
		<div class="companion-content" bind:this={contentEl}>
			<CompanionComposer
				bind:editor
				{attachedImages}
				sources={suggestSources}
				fileProjectPath={effectiveProjectPath}
				destinationName={topDestinationName}
				selectedProject={selectedProjectMeta}
				{selectedDirectives}
				{selectedRole}
				{canSave}
				{statusText}
				{successNotice}
				errors={composerErrors}
				{previewNotes}
				onInput={handleInput}
				onSave={() => void handleSaveTask()}
				onFilesAdd={(files) => void handleProcessFiles(files)}
				onRemoveImage={(index) => (attachedImages = attachedImages.filter((_, i) => i !== index))}
				onOpenFileDialog={triggerFileInput}
				onSelectProject={handleSelectProjectMeta}
				onRemoveProject={handleRemoveProjectMeta}
				onAddDirective={handleAddDirective}
				onRemoveDirective={handleRemoveDirective}
				onSelectRole={handleSelectRole}
				onRemoveRole={handleRemoveRole}
			/>

			{#if knownProjects.length > 0}
				<section class="priority-workspace" aria-label={m.companion_cards_aria()}>
					<div class="priority-reader-scroll" bind:this={workspaceEl} onscroll={rememberReadingScroll}>
						{#if selectedProject && currentConvState}
							<!-- La lettura entra e se ne va piegandosi: con "Ok" la carta
								 sparisce senza strappo e la colonna si richiude. -->
							<div transition:trayFold>
								<CompanionCenterReader
									project={selectedProject}
									hue={projectHues.get(selectedProject.id) ?? selectedProject.hue}
									viewMode={presentation.viewMode}
									convState={currentConvState}
									attention={currentAttention}
									queuedCount={queuedForSelected}
									laneLabel={currentLaneLabel}
									{previousProjectName}
									ask={askHandlers}
									onFocusProject={(projectId) => void companionStore.focusProject(projectId)}
									onNewTask={prefillProject}
									onCloseCard={() => {
										presentation.selectedProjectId = null;
										presentation.selectedRequestId = null;
									}}
									onToggleExpanded={handleToggleExpanded}
									onDraftChange={(text) => setConversationDraft(presentation, selectedProject.id, presentation.selectedLaneId, text)}
									onSendReply={() => void handleSendReply()}
									onReload={handleReloadConversation}
									onReturnToPrevious={handleReturnToPrevious}
								/>
							</div>
						{/if}
					</div>

					<CompanionRightRail
						selectedProjectId={presentation.selectedProjectId}
						selectedLaneId={presentation.selectedLaneId}
						selectedRequestId={presentation.selectedRequestId}
						viewMode={presentation.viewMode}
						questions={railQuestions}
						unread={railUnread}
						working={railWorking}
						globalQueue={globalQueueItems}
						parked={railParked}
						parkedOpen={presentation.parkedOpen}
						onToggleParked={() => (presentation.parkedOpen = !presentation.parkedOpen)}
						onSelectProject={handleSelectProject}
						onRunTask={handleRunTask}
					/>
				</section>
			{:else}
				<p class="companion-empty">{m.companion_empty()}</p>
			{/if}
		</div>
	</main>

	<input type="file" accept="image/*" multiple bind:this={fileInputEl} onchange={onFileInputChange} hidden />
</CompanionShell>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: transparent !important;
		user-select: none;
	}
</style>
