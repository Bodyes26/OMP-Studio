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
	import { THEMES, anchorsFor } from '$lib/theme';
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
	import CompanionStatusStrip from './CompanionStatusStrip.svelte';

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
	let composerExpanded = $state(true);
	let attentionPageIndex = $state(0);

	let unlistenSummon: UnlistenFn | null = null;

	const isLightTheme = $derived(anchorsFor(THEMES[themeStore.current] ?? THEMES['titanium']).isLight);
	const attentionList = $derived(companionStore.attentionRequests);
	const layout = $derived(settingsStore.appearance.companionLayout);
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

	const workingCount = $derived(monitorProjects.filter((p) => p.agentState === 'working').length);
	const queuedCount = $derived.by(() => {
		let total = 0;
		for (const project of monitorProjects) {
			if (!project.path) continue;
			total += taskStore.tasksFor(project.path).filter((t) => t.status === 'queued').length;
		}
		return total;
	});

	const composerCollapsed = $derived(layout === 'inbox' && attentionList.length > 0 && !composerExpanded);
	const composerSize = $derived<'default' | 'hero' | 'compact'>(
		layout === 'launcher' ? 'hero' : layout === 'dashboard' || layout === 'compact' ? 'compact' : 'default'
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

	$effect(() => {
		const el = inputEl;
		const text = taskInput;
		if (!el) return;
		el.style.height = 'auto';
		const target = text ? Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) : 0;
		el.style.height = target > 0 ? `${target}px` : '';
		el.style.overflowY = text && el.scrollHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
		if (backdropEl) {
			backdropEl.scrollTop = el.scrollTop;
			backdropEl.scrollLeft = el.scrollLeft;
		}
	});

	onMount(() => {
		void companionStore.init();
		void quotaStore.init();
		void settingsStore.init();
		void modelSettingsStore.loadAll();
		void taskStore.tasks;

		void tick().then(() => inputEl?.focus());
		playOpenAnimation();

		void listen('companion-summon', () => {
			playOpenAnimation();
			void tick().then(() => inputEl?.focus());
		}).then((fn) => {
			unlistenSummon = fn;
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
		if (backdropEl && inputEl) {
			backdropEl.scrollTop = inputEl.scrollTop;
			backdropEl.scrollLeft = inputEl.scrollLeft;
		}
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
				successNotice = `Task aggiunto a ${toSave.projectName || 'progetto'}!`;
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
		onSelectProject: layout === 'dashboard' ? (id: string | null) => { expandedProjectId = id; } : undefined,
		onRunTask: handleRunTask,
		onToggleUsage: () => { usageOpen = !usageOpen; },
		onTogglePin: togglePinned,
		detailPanel: layout === 'dashboard'
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

	<main class="companion-body layout-{layout}">
		{#if layout === 'balanced'}
			<CompanionAttentionSection variant="full" {...attentionProps} />
			<CompanionComposer
				size="default"
				collapsed={false}
				{...composerProps}
				bind:taskInput
				bind:inputEl
				bind:composerEl
				bind:backdropEl
				bind:fileInputEl
			/>
			<CompanionMonitor variant="full" {...monitorProps} />

		{:else if layout === 'dashboard'}
			<CompanionMonitor variant="full" {...monitorProps} />
			<CompanionComposer
				size="compact"
				collapsed={false}
				{...composerProps}
				bind:taskInput
				bind:inputEl
				bind:composerEl
				bind:backdropEl
				bind:fileInputEl
			/>

		{:else if layout === 'inbox'}
			<CompanionAttentionSection
				variant="focused"
				pageIndex={attentionPageIndex}
				onPrevPage={() => { if (attentionPageIndex > 0) attentionPageIndex -= 1; }}
				onNextPage={() => { if (attentionPageIndex < attentionList.length - 1) attentionPageIndex += 1; }}
				{...attentionProps}
			/>
			<CompanionStatusStrip
				workingCount={workingCount}
				attentionCount={attentionList.length}
				queuedCount={queuedCount}
			/>
			<CompanionComposer
				size="default"
				collapsed={composerCollapsed}
				onExpand={() => { composerExpanded = true; void tick().then(() => inputEl?.focus()); }}
				{...composerProps}
				bind:taskInput
				bind:inputEl
				bind:composerEl
				bind:backdropEl
				bind:fileInputEl
			/>

		{:else if layout === 'compact'}
			<CompanionMonitor variant="dense" {...monitorProps} />
			<CompanionComposer
				size="compact"
				collapsed={false}
				{...composerProps}
				bind:taskInput
				bind:inputEl
				bind:composerEl
				bind:backdropEl
				bind:fileInputEl
			/>
			{#if attentionList.length > 0}
				<CompanionAttentionSection variant="compact" {...attentionProps} />
			{/if}

		{:else if layout === 'launcher'}
			<CompanionComposer
				size="hero"
				collapsed={false}
				{...composerProps}
				bind:taskInput
				bind:inputEl
				bind:composerEl
				bind:backdropEl
				bind:fileInputEl
			/>
			<CompanionStatusStrip
				workingCount={workingCount}
				attentionCount={attentionList.length}
				queuedCount={queuedCount}
			/>
			{#if attentionList.length > 0}
				<CompanionAttentionSection variant="banner" {...attentionProps} />
			{/if}
			<CompanionMonitor variant="strip" {...monitorProps} />
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
