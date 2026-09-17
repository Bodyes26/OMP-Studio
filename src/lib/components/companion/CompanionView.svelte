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
	import { THEMES, anchorsFor, automaticProjectHue } from '$lib/theme';
	import { matchesLooseQuery } from '$lib/looseSearch';
	import UsagePopover from '$lib/components/UsagePopover.svelte';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { rankFrequentTaskModels } from '$lib/stores/taskSerialization';
	import { extractImageFiles, isImageFile, prepareImage } from '$lib/agent/images';
	import type { ImageContent } from '$lib/agent/wire';
	import {
		parseQuickTaskLocal,
		mentionStateAt,
		applyMention,
		tokenizeForDisplay,
		type LocalQuickTask,
		type DisplayToken
	} from '$lib/companion/quickTaskLocal';
	import CompanionShell from './CompanionShell.svelte';
	import CompanionAttentionSection from './CompanionAttentionSection.svelte';
	import CompanionComposer from './CompanionComposer.svelte';
	import CompanionMonitor from './CompanionMonitor.svelte';
	import CompanionProjectQueue from './CompanionProjectQueue.svelte';
	import CompanionQueueBoard from './CompanionQueueBoard.svelte';
	import { sortQueueGroups, type CompanionQueueGroup } from './companionQueue';
	import { IconPlay } from '$lib/icons';

	const STATE_RANK: Record<string, number> = {
		attention: 0,
		working: 1,
		finished: 2,
		idle: 3,
		unknown: 4
	};

	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let backdropEl = $state<HTMLDivElement | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let taskInput = $state('');
	let caret = $state(0);
	let mentionIndex = $state(0);
	let aiParsed = $state<QuickTaskAiParsed | null>(null);
	let isSaving = $state(false);
	let successNotice = $state<string | null>(null);
	let expandedHistory = $state<Record<string, boolean>>({});
	let replyDrafts = $state<Record<string, string>>({});
	let customReplyProjects = $state<Record<string, boolean>>({});
	let usageOpen = $state(false);
	let justOpened = $state(false);
	let attachedImages = $state<ImageContent[]>([]);
	let isDraggingOver = $state(false);
	let imageProcessingCount = $state(0);
	let isFileDialogOpen = false;
	let attachmentError = $state<string | null>(null);
	let expandedProjectId = $state<string | null>(null);
	let attentionPageIndex = $state(0);

	let unlistenSummon: UnlistenFn | null = null;
	let viewDisposed = false;

	const isLightTheme = $derived(anchorsFor(THEMES[themeStore.current] ?? THEMES['titanium']).isLight);
	const attentionList = $derived(companionStore.attentionRequests);
	const knownProjects = $derived(
		companionStore.projects.length > 0 ? companionStore.projects : projectStore.projects
	);
	const knownDirectives = $derived(settingsStore.taskDirectives.filter((d) => !d.hidden));

	type MentionItem = {
		value: string;
		label: string;
		hint?: string;
		kind: 'project' | 'directive' | 'role' | 'model';
		search: string;
	};

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

	const knownModelSelectors = $derived(
		modelSettingsStore.assignableCatalog.map((model) => model.selector)
	);

	const parseInput = $derived({
		projects: knownProjects.map((p) => ({ id: p.id, name: p.name, label: p.label ?? undefined, path: p.path })),
		directives: knownDirectives.map((d) => ({ id: d.id, name: d.name, tag: d.tag, hidden: d.hidden })),
		roles: configuredRoles.map((role) => role.id),
		modelSelectors: knownModelSelectors
	});

	const local = $derived<LocalQuickTask>(parseQuickTaskLocal(taskInput, parseInput));
	const displayTokens = $derived<DisplayToken[]>(tokenizeForDisplay(taskInput, parseInput));
	const mention = $derived(mentionStateAt(taskInput, caret));

	const mentionItems = $derived.by<MentionItem[]>(() => {
		const q = mention.query.toLowerCase();
		if (mention.kind === 'project') {
			return knownProjects
				.filter((p) => p.path)
				.filter((p) => !q || (p.label ?? p.name).toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
				.slice(0, 6)
				.map((p) => ({
					value: p.name,
					label: p.label?.trim() || p.name,
					hint: p.name,
					kind: 'project' as const,
					search: `${p.label ?? ''} ${p.name}`.toLowerCase()
				}));
		}
		if (mention.kind === 'directive') {
			return knownDirectives
				.filter((d) => !q || d.name.toLowerCase().includes(q) || (d.tag ?? '').toLowerCase().includes(q))
				.slice(0, 6)
				.map((d) => ({
					value: (d.tag ?? d.name).replace(/^\//, ''),
					label: d.name,
					hint: d.tag,
					kind: 'directive' as const,
					search: `${d.name} ${d.tag ?? ''}`.toLowerCase()
				}));
		}
		if (mention.kind === 'role') {
			const roles: MentionItem[] = configuredRoles.map((role) => ({
				value: role.id,
				label: role.label,
				hint: role.modelLabel,
				kind: 'role',
				search: `${role.id} ${role.label} ${role.selector} ${role.modelLabel}`.toLowerCase()
			}));
			const models: MentionItem[] = frequentModels.map(({ model, count }) => ({
				value: model.selector,
				label: model.name,
				hint: `${model.provider} · ${count} ${count === 1 ? 'uso' : 'usi'}`,
				kind: 'model',
				search: `${model.selector} ${model.name} ${model.provider}`.toLowerCase()
			}));
			return [...roles, ...models].filter((item) => matchesLooseQuery(mention.query, item.search));
		}
		return [];
	});

	const mentionOpen = $derived(mention.kind !== null && mentionItems.length > 0);
	const isBusy = $derived(isSaving || companionStore.isParsingTask || imageProcessingCount > 0);
	const canSave = $derived((taskInput.trim().length > 0 || attachedImages.length > 0) && !isBusy);

	const monitorProjects = $derived.by<Project[]>(() => {
		const list = knownProjects.filter((p) => p.path);
		return [...list].sort((a, b) => {
			const ra = STATE_RANK[a.agentState] ?? 9;
			const rb = STATE_RANK[b.agentState] ?? 9;
			if (ra !== rb) return ra - rb;
			return (a.label?.trim() || a.name).localeCompare(b.label?.trim() || b.name);
		});
	});

	/**
	 * Le code di tutti i progetti, nell'ordine in cui vanno guardate. Con piu'
	 * di una coda la vista per singolo progetto raccontava solo la prima e
	 * lasciava le altre a un numero accanto al nome.
	 */
	const queueGroups = $derived.by<CompanionQueueGroup[]>(() => {
		const theme = THEMES[themeStore.current] ?? THEMES['titanium'];
		const groups: CompanionQueueGroup[] = [];
		for (const project of monitorProjects) {
			if (!project.path) continue;
			const tasks = taskStore.tasksFor(project.path).filter((t) => t.status === 'queued');
			if (tasks.length === 0) continue;
			const runtime = companionStore.projectRuntimes.find((r) => r.projectId === project.id);
			groups.push({
				projectId: project.id,
				name: project.label?.trim() || project.name,
				hue: project.colorMode === 'custom'
					? project.hue
					: automaticProjectHue(theme, project.path),
				tasks,
				ready: runtime?.canRunTask === true,
				blockReason: runtime?.runBlockReason
			});
		}
		return sortQueueGroups(groups);
	});

	/**
	 * Lo slot in cima non e' una preferenza: e' una conseguenza dello stato,
	 * ricalcolata a ogni evocazione. Chi ti aspetta batte il lavoro pronto,
	 * che batte il campo vuoto.
	 */
	const readyGroup = $derived(queueGroups.find((group) => group.ready) ?? null);
	const surface = $derived<'attention' | 'queue' | 'hero'>(
		attentionList.length > 0 ? 'attention' : readyGroup ? 'queue' : 'hero'
	);

	const INPUT_MAX_HEIGHT = 160;

	$effect(() => {
		for (const project of knownProjects) {
			if (project.path) {
				void taskStore.loadProject(project.path);
			}
		}
	});

	$effect(() => {
		if (attentionPageIndex >= attentionList.length) {
			attentionPageIndex = Math.max(0, attentionList.length - 1);
		}
	});

	// Il backdrop dipinge il testo che la textarea tiene trasparente: i due strati
	// devono avvolgere le righe alla stessa larghezza, altrimenti il caret (nativo
	// della textarea) deriva rispetto ai glifi visibili. Quando il testo supera
	// l'altezza massima compare la scrollbar verticale della textarea, che ruba
	// ~10px alla sua content-box mentre il backdrop (overflow hidden) resta largo:
	// si compensa con un padding-right pari alla larghezza della scrollbar.
	function syncBackdropGeometry() {
		const el = inputEl;
		const backdrop = backdropEl;
		if (!el || !backdrop) return;
		const scrollbarWidth = el.offsetWidth - el.clientWidth;
		backdrop.style.paddingRight =
			scrollbarWidth > 0 ? `calc(var(--space-1) + ${scrollbarWidth}px)` : '';
		backdrop.scrollTop = el.scrollTop;
		backdrop.scrollLeft = el.scrollLeft;
	}

	$effect(() => {
		const el = inputEl;
		if (!el || typeof ResizeObserver === 'undefined') return;
		// La scrollbar puo' comparire/sparire anche senza digitazione (resize finestra):
		// la compensazione segue la geometria reale della textarea.
		const geometryObserver = new ResizeObserver(() => syncBackdropGeometry());
		geometryObserver.observe(el);
		syncBackdropGeometry();
		return () => geometryObserver.disconnect();
	});

	$effect(() => {
		const el = inputEl;
		const text = taskInput;
		if (!el) return;
		el.style.height = 'auto';
		const target = text ? Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) : 0;
		el.style.height = target > 0 ? `${target}px` : '';
		el.style.overflowY = text && el.scrollHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
		syncBackdropGeometry();
	});

	function refreshCompanionState() {
		companionStore.requestSync();
		// La finestra resta viva ma nascosta: mentre non e' visibile puo' aver
		// perso una scrittura di Studio (il watcher Rust scarta le auto-eco).
		// Al summon si rilegge il file, non la cache d'idratazione iniziale.
		for (const project of knownProjects) {
			if (project.path) void taskStore.reloadProject(project.path);
		}
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
			// Il fuoco va nel campo solo se non c'e' nulla di urgente sopra:
			// altrimenti la scrollbar porta il campo in vista e spinge la domanda
			// fuori dallo schermo.
			if (surface === 'hero') inputEl?.focus();
		});
		playOpenAnimation();

		void listen('companion-summon', () => {
			refreshCompanionState();
			playOpenAnimation();
			void tick().then(() => {
				if (surface === 'hero') inputEl?.focus();
			});
		}).then((fn) => {
			// La registrazione e' asincrona: se la vista e' gia' smontata il
			// listener va chiuso subito, altrimenti resterebbe appeso.
			if (viewDisposed) fn();
			else unlistenSummon = fn;
		});

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
			window.removeEventListener('blur', handleBlur);
			window.removeEventListener('focus', handleFocus);
			unlistenSummon?.();
		};
	});

	function playOpenAnimation() {
		justOpened = false;
		void tick().then(() => {
			justOpened = true;
			setTimeout(() => (justOpened = false), 220);
		});
	}

	function handleInputScroll() {
		syncBackdropGeometry();
	}

	function insertToken(char: string) {
		const el = inputEl;
		const at = el?.selectionStart ?? taskInput.length;
		const before = taskInput.slice(0, at);
		const needsSpace = before.length > 0 && !/\s$/.test(before);
		const insert = `${needsSpace ? ' ' : ''}${char}`;
		taskInput = before + insert + taskInput.slice(el?.selectionEnd ?? at);
		const next = at + insert.length;
		aiParsed = null;
		companionStore.parseError = null;
		mentionIndex = 0;
		void tick().then(() => {
			inputEl?.focus();
			inputEl?.setSelectionRange(next, next);
			caret = next;
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			if (usageOpen) {
				usageOpen = false;
				return;
			}
			if (mentionOpen) {
				caret = -1;
				return;
			}
			void companionStore.hideCompanion();
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void handleSaveTask();
		}
	}

	function handleInputKeydown(e: KeyboardEvent) {
		if (!mentionOpen) {
			if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				void handleSaveTask();
				return;
			}
			syncCaret();
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			mentionIndex = (mentionIndex + 1) % mentionItems.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length;
		} else if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey)) {
			e.preventDefault();
			chooseMention(mentionItems[Math.min(mentionIndex, mentionItems.length - 1)].value);
		}
	}

	function syncCaret() {
		void tick().then(() => {
			caret = inputEl?.selectionStart ?? taskInput.length;
		});
	}

	function handleInput() {
		caret = inputEl?.selectionStart ?? taskInput.length;
		mentionIndex = 0;
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

	function handlePaste(event: ClipboardEvent) {
		const imageFiles = extractImageFiles(event.clipboardData);
		if (imageFiles.length === 0) return;
		event.preventDefault();
		void handleProcessFiles(imageFiles);
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDraggingOver = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		isDraggingOver = false;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDraggingOver = false;
		const imageFiles = extractImageFiles(event.dataTransfer);
		if (imageFiles.length > 0) {
			void handleProcessFiles(imageFiles);
		} else if (event.dataTransfer?.files.length) {
			attachmentError = m.ui_companionview_sono_supportati_solo_file_immagine_f024();
		}
	}

	function removeImage(index: number) {
		attachedImages = attachedImages.filter((_, imageIndex) => imageIndex !== index);
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

	function chooseMention(value: string) {
		const next = applyMention(taskInput, mention, value);
		taskInput = next.text;
		mentionIndex = 0;
		void tick().then(() => {
			inputEl?.focus();
			inputEl?.setSelectionRange(next.caret, next.caret);
			caret = next.caret;
		});
	}

	async function handleSaveTask() {
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
				taskInput = '';
				attachedImages = [];
				caret = 0;
				aiParsed = null;
				setTimeout(() => {
					successNotice = null;
					if (!companionStore.isPinned) {
						void companionStore.hideCompanion();
					}
				}, 1200);
			}
		} finally {
			isSaving = false;
		}
	}

	async function handleQuickReplySelect(projectId: string, value: string) {
		delete replyDrafts[projectId];
		delete customReplyProjects[projectId];
		await companionStore.respondUi(projectId, { action: 'select', value });
	}

	async function handleQuickReplyConfirm(projectId: string, confirmed: boolean) {
		delete replyDrafts[projectId];
		delete customReplyProjects[projectId];
		await companionStore.respondUi(projectId, { action: 'confirm', confirmed });
	}

	async function handleQuickReplyCancel(projectId: string) {
		delete replyDrafts[projectId];
		delete customReplyProjects[projectId];
		await companionStore.respondUi(projectId, { action: 'cancel' });
	}

	async function handleQuickReplyText(projectId: string) {
		const value = (replyDrafts[projectId] ?? '').trim();
		if (!value) return;
		delete replyDrafts[projectId];
		delete customReplyProjects[projectId];
		await companionStore.respondUi(projectId, { action: 'select', value });
	}

	function draftFor(req: AttentionRequest): string {
		return replyDrafts[req.projectId] ?? req.pendingUi.prefill ?? '';
	}

	function wantsText(pending: AttentionRequest['pendingUi']): boolean {
		if (pending.options && pending.options.length > 0) return false;
		return pending.method === 'input' || pending.method === 'editor';
	}

	function toggleHistory(projectId: string) {
		expandedHistory[projectId] = !expandedHistory[projectId];
	}

	function togglePinned() {
		void companionStore.setPinned(!companionStore.isPinned);
	}

	function handleRunTask(projectId: string, taskId: string) {
		void companionStore.runTask(projectId, taskId);
	}

	const attentionProps = $derived({
		attentionList,
		expandedHistory,
		replyDrafts,
		customReplyProjects,
		onToggleHistory: toggleHistory,
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
		onResolveQuotaBlocked: (projectId: string, selector: string) =>
			companionStore.resolveQuotaBlocked(projectId, selector),
		onDismissQuotaBlocked: (projectId: string) => companionStore.dismissQuotaBlocked(projectId),
		draftFor,
		wantsText
	});

	const composerProps = $derived({
		displayTokens,
		attachedImages,
		isDraggingOver,
		isBusy,
		canSave,
		imageProcessingCount,
		isParsingTask: companionStore.isParsingTask,
		mentionOpen,
		mentionItems,
		mentionIndex,
		local,
		aiParsed,
		parseError: companionStore.parseError,
		successNotice,
		attachmentError,
		onInsertToken: insertToken,
		onInput: handleInput,
		onInputKeydown: handleInputKeydown,
		onSyncCaret: syncCaret,
		onInputScroll: handleInputScroll,
		onPaste: handlePaste,
		onDragOver: handleDragOver,
		onDragLeave: handleDragLeave,
		onDrop: handleDrop,
		onRemoveImage: removeImage,
		onTriggerFileInput: triggerFileInput,
		onFileInputChange,
		onSaveTask: handleSaveTask,
		onChooseMention: chooseMention
	});

	const monitorProps = $derived({
		projects: monitorProjects,
		runtimes: companionStore.projectRuntimes,
		attentionList,
		isPinned: companionStore.isPinned,
		selectedProjectId: expandedProjectId,
		onSelectProject: (id: string | null) => { expandedProjectId = id; },
		onRunTask: handleRunTask,
		onToggleUsage: () => { usageOpen = !usageOpen; },
		onTogglePin: togglePinned
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<CompanionShell
	isPinned={companionStore.isPinned}
	{isLightTheme}
	attentionCount={attentionList.length}
	{justOpened}
	onTogglePin={togglePinned}
	onClose={() => void companionStore.hideCompanion()}
>
	{#if usageOpen}
		<UsagePopover open={usageOpen} onClose={() => (usageOpen = false)} />
	{/if}

	<main class="companion-body" class:surface-hero={surface === 'hero'}>
		{#if surface === 'attention'}
			<!-- Chi ti aspetta sta in cima, gia' aperto: la finestra non chiama
			     mai da sola, quindi quando la guardi deve essere gia' pronta. -->
			<CompanionAttentionSection
				variant="open"
				pageIndex={attentionPageIndex}
				onPrevPage={() => { if (attentionPageIndex > 0) attentionPageIndex -= 1; }}
				onNextPage={() => { if (attentionPageIndex < attentionList.length - 1) attentionPageIndex += 1; }}
				{...attentionProps}
			/>
		{:else if surface === 'queue' && readyGroup}
			<!-- Nessuno ti aspetta ma c'e' lavoro pronto a partire. Con una sola
			     coda si vedono i suoi task; con piu' code il riepilogo per
			     progetto, perche' l'elenco di una sola nascondeva le altre. -->
			{#if queueGroups.length > 1}
				<CompanionQueueBoard
					groups={queueGroups}
					onRunNext={handleRunTask}
					onOpenProject={(projectId) => { expandedProjectId = projectId; }}
				/>
			{:else}
				<section class="ready-queue">
					<div class="section-title">
						<IconPlay />
						<span>{m.companion_ready_title({ project: readyGroup.name })}</span>
					</div>
					<CompanionProjectQueue
						projectName={readyGroup.name}
						tasks={readyGroup.tasks}
						disabled={false}
						onRunNext={(taskId) => handleRunTask(readyGroup.projectId, taskId)}
					/>
				</section>
			{/if}
		{/if}

		<CompanionComposer
			size={surface === 'hero' ? 'hero' : 'row'}
			{...composerProps}
			bind:taskInput
			bind:inputEl
			bind:composerEl
			bind:backdropEl
			bind:fileInputEl
		/>

		{#if surface === 'attention'}
			<CompanionAttentionSection variant="list" pageIndex={attentionPageIndex} {...attentionProps} />
		{/if}

		<CompanionMonitor variant={surface === 'hero' ? 'list' : 'dense'} {...monitorProps} />

		{#if surface === 'hero' && monitorProjects.length === 0}
			<p class="companion-empty">{m.companion_empty()}</p>
		{/if}
	</main>
</CompanionShell>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: transparent !important;
		user-select: none;
	}
</style>
