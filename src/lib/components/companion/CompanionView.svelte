<script lang="ts">
	import './companion.css';
	import { m } from '$lib/paraglide/messages.js';
	import { onMount, tick } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { companionStore, type AttentionRequest, type QuickTaskAiParsed } from '$lib/stores/companion.svelte';
	import { projectStore, type Project } from '$lib/stores/projects.svelte';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { modelSettingsStore, STANDARD_ROLES, resolveCatalogModel } from '$lib/stores/modelSettings.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { THEMES, automaticProjectHue } from '$lib/theme';
	import UsagePopover from '$lib/components/UsagePopover.svelte';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { rankFrequentTaskModels } from '$lib/stores/taskSerialization';
	import { isImageFile, prepareImage } from '$lib/agent/images';
	import type { ImageContent } from '$lib/agent/wire';
	import type { ComposerSegment } from '$lib/agent/composerDoc';
	import type ComposerEditor from '$lib/agent/components/ComposerEditor.svelte';
	import { ROLE_HUES } from '$lib/agent/roleHues';
	import { FAST_EXIT_MS, motionReduced } from '$lib/agent/motionState.svelte';
	import { parseQuickTaskLocal, type LocalQuickTask } from '$lib/companion/quickTaskLocal';
	import { directiveDisplayName } from '$lib/stores/taskDirectives';
	import CompanionShell from './CompanionShell.svelte';
	import CompanionComposer, { type CompanionSuggestSources } from './CompanionComposer.svelte';
	import CompanionMonitor from './CompanionMonitor.svelte';
	import type { CompanionAskHandlers } from './companionAsk';
	import { promptBus } from '$lib/agent/promptBus';

	const STATE_RANK: Record<string, number> = {
		attention: 0,
		working: 1,
		finished: 2,
		idle: 3,
		unknown: 4
	};

	let editor = $state<ComposerEditor | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);
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

	const suggestSources = $derived<CompanionSuggestSources>({
		projects: knownProjects
			.filter((p) => p.canonicalProjectPath)
			.map((p) => ({ name: p.name, label: p.label?.trim() || p.name, hue: projectHues.get(p.id) ?? p.hue })),
		directives: knownDirectives.map((d) => ({
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
		}))
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
		const projectPath = aiParsed ? aiParsed.projectPath : local.projectPath;
		return projectPath ? [] : [m.companion_missing_project_hint()];
	});

	const monitorProjects = $derived.by<Project[]>(() => {
		const list = knownProjects.filter((p) => p.canonicalProjectPath);
		return [...list].sort((a, b) => {
			const ra = STATE_RANK[a.lane.agentState] ?? 9;
			const rb = STATE_RANK[b.lane.agentState] ?? 9;
			if (ra !== rb) return ra - rb;
			return (a.label?.trim() || a.name).localeCompare(b.label?.trim() || b.name);
		});
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
	 *
	 * Si misura il contenuto (non il corpo che scorre: la sua altezza e' quella
	 * della finestra e non scenderebbe mai) e si chiede a Rust di ridimensionare
	 * senza ricentrare: la finestra cresce verso il basso come una barra di
	 * ricerca di sistema. Una richiesta per fotogramma, senza accodarne: mentre
	 * una sezione si piega l'altezza della finestra la segue in modo continuo.
	 * La palette dei suggerimenti sta fuori dal flusso e si somma a parte.
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
			// Testata (fissata) e bordi del guscio: tutto cio' che non e' corpo.
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
		// La palette (assoluta) non cambia l'altezza del contenuto: la sua
		// comparsa si coglie dalle mutazioni del sottoalbero.
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
		// La finestra resta viva ma nascosta: mentre non e' visibile puo' aver
		// perso una scrittura di Studio (il watcher Rust scarta le auto-eco).
		// Al summon si rilegge il file, non la cache d'idratazione iniziale.
		for (const project of knownProjects) {
			if (project.canonicalProjectPath) {
				void taskStore.reloadProject(project.canonicalProjectPath);
			}
		}
	}

	function trackListener(registration: Promise<UnlistenFn>) {
		void registration.then((fn) => {
			// La registrazione e' asincrona: se la vista e' gia' smontata il
			// listener va chiuso subito, altrimenti resterebbe appeso.
			if (viewDisposed) fn();
			else unlisteners.push(fn);
		});
	}

	onMount(() => {
		void companionStore.init();
		refreshCompanionState();
		void quotaStore.init();
		void settingsStore.init();
		// Cataloghi completi in background: il salvataggio di un task non deve
		// mai aspettarli, ma le menzioni `!ruolo` e `!modello` li vogliono.
		void modelSettingsStore.ensureLoaded();
		void tick().then(() => {
			// Il campo del task e' la prima cosa e prende sempre il fuoco:
			// qualunque cosa ci sia sotto (una domanda, una coda pronta), il
			// punto dove si scrive non cambia mai sotto le mani.
			editor?.focusEnd();
		});
		playOpenAnimation();

		// Uscita breve prima di `hide()`: la finestra si dissolve invece di
		// sparire di colpo. Con il movimento ridotto si nasconde subito.
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
			})
		);
		// La scorciatoia globale non nasconde da Rust: chiede l'uscita animata.
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
		// La finestra torna a vista ancora dissolta dall'uscita: l'ingresso
		// riparte da li', senza un fotogramma pieno in mezzo.
		leaving = false;
		justOpened = false;
		void tick().then(() => {
			justOpened = true;
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			// Escape consumato da un campo (palette, risposta libera) chiude solo
			// quello, mai la finestra nello stesso gesto.
			if (e.defaultPrevented) return;
			e.preventDefault();
			if (usageOpen) {
				usageOpen = false;
				return;
			}
			void companionStore.hideCompanion();
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void handleSaveTask();
		}
	}

	function handleInput() {
		cancelAutoHide();
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
		cancelAutoHide();
		const text = taskInput.trim();
		if ((!text && attachedImages.length === 0) || isBusy) return;
		if (!text && local.needsAi) {
			companionStore.parseError = m.ui_companionview_indica_il_progetto_con_prima_di_salvare_4185();
			return;
		}

		isSaving = true;
		try {
			let toSave: QuickTaskAiParsed | null = null;

			if (!local.needsAi && local.projectPath) {
				toSave = {
					projectPath: local.projectPath,
					projectName: local.projectName,
					taskPrompt: local.taskPrompt,
					role: local.role,
					modelSelector: local.modelSelector,
					directiveIds: local.directiveIds,
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
					role: local.role ?? res.role,
					modelSelector: local.modelSelector ?? res.modelSelector,
					directiveIds: [...new Set([...res.directiveIds, ...local.directiveIds])]
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
				cancelAutoHide();
				autoHideTimer = setTimeout(() => {
					autoHideTimer = null;
					successNotice = null;
					if (!companionStore.isPinned && taskInput.trim().length === 0) {
						void companionStore.hideCompanion();
					}
				}, 1200);
			}
		} finally {
			isSaving = false;
		}
	}

	async function handleQuickReplySelect(
		projectId: string,
		value: string,
		laneId?: string | null,
		requestId?: string | null
	) {
		delete replyDrafts[projectId];
		delete customReplyProjects[projectId];
		const targetReq = companionStore.attentionRequests.find(
			(r) => r.projectId === projectId && (!laneId || (r.laneId ?? 'main') === laneId)
		);
		const targetReqId = requestId ?? targetReq?.pendingUi?.requestId;

		if (targetReq?.pendingUi?.method === 'ask') {
			const questions = targetReq.pendingUi.questions as Array<{ id?: string }> | undefined;
			const qId = questions?.[0]?.id ?? 'q1';
			const answer = {
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

		if (targetReqId) {
			const handled = await companionStore.respondPrompt(targetReqId, { action: 'select', value }, laneId);
			if (handled) return;
		}
		await companionStore.respondUi(projectId, { action: 'select', value }, laneId, targetReqId);
	}

	async function handleQuickReplyConfirm(
		projectId: string,
		confirmed: boolean,
		laneId?: string | null,
		requestId?: string | null
	) {
		delete replyDrafts[projectId];
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
		delete replyDrafts[projectId];
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
		requestId?: string | null
	) {
		const request = companionStore.attentionRequests.find(
			(req) => req.projectId === projectId && (!laneId || (req.laneId ?? 'main') === laneId)
		);
		const value = (replyDrafts[projectId] ?? request?.pendingUi.prefill ?? '').trim();
		if (!value) return;
		delete replyDrafts[projectId];
		delete customReplyProjects[projectId];
		const targetReqId = requestId ?? request?.pendingUi?.requestId;

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

	/**
	 * Precompila il campo con il badge del progetto e riporta il fuoco:
	 * accodare al progetto che stai guardando non deve costare la digitazione
	 * del suo nome. Un badge di progetto gia' in testa viene sostituito.
	 */
	function prefillProject(project: Project) {
		if (!editor) return;
		const segments = editor.getSegments();
		const rest = segments[0]?.t === 'project' ? segments.slice(1) : segments;
		const badge: ComposerSegment = {
			t: 'project',
			name: project.name,
			label: project.label?.trim() || project.name,
			hue: projectHues.get(project.id) ?? project.hue
		};
		const head = rest[0];
		editor.setSegments(
			head?.t === 'text'
				? [badge, { t: 'text', s: ` ${head.s.trimStart()}` }, ...rest.slice(1)]
				: [badge, ...rest]
		);
		editor.focusEnd();
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
		onResolveQuotaBlocked: (projectId: string, selector: string, laneId?: string | null) =>
			companionStore.resolveQuotaBlocked(projectId, selector, undefined, laneId),
		onDismissQuotaBlocked: (projectId: string, laneId?: string | null) =>
			companionStore.dismissQuotaBlocked(projectId, laneId),
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

	<main class="companion-body" bind:this={bodyEl}>
		<!-- Il campo del nuovo task e' sempre la prima cosa e sempre grande:
		     e' la ragione per cui la finestra si apre. Domande, code e stato
		     dei progetti stanno sotto, dentro le card. -->
		<div class="companion-content" bind:this={contentEl}>
			<CompanionComposer
				bind:editor
				{attachedImages}
				sources={suggestSources}
				fileProjectPath={local.projectPath}
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
			/>

			<CompanionMonitor
				projects={monitorProjects}
				hues={projectHues}
				runtimes={companionStore.projectRuntimes}
				{attentionList}
				ask={askHandlers}
				onFocusProject={(projectId) => void companionStore.focusProject(projectId)}
				onNewTask={prefillProject}
				onRunTask={(projectId, taskId) => void companionStore.runTask(projectId, taskId)}
				onToggleUsage={() => (usageOpen = !usageOpen)}
			/>

			{#if monitorProjects.length === 0}
				<p class="companion-empty">{m.companion_empty()}</p>
			{/if}
		</div>
	</main>

	<input type="file" accept="image/*" multiple bind:this={fileInputEl} onchange={onFileInputChange} hidden />
</CompanionShell>

<style>
	/* La finestra e' trasparente su Windows (Mica): il fondo lo dipinge il guscio. */
	:global(body) {
		margin: 0;
		padding: 0;
		background: transparent !important;
		user-select: none;
	}
</style>
