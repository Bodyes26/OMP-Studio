<script lang="ts" module>
	// Task gia' mostrato a schermo: rimontare lo stesso task (cambio di progetto e
	// ritorno) non rianima la schermata, perche' cambiare progetto e' cambiare
	// stanza (Still-Room Rule). Si azzera alla chiusura esplicita.
	let presentedTaskId: string | null = null;
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { onDestroy, tick, untrack } from 'svelte';
	import { taskStore, type StudioTask, type StudioTaskOptions } from '$lib/stores/tasks.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import {
		createDirectiveSnapshot,
		compareDirectiveRevision,
		type TaskDirective,
		type TaskDirectiveSnapshot
	} from '$lib/stores/taskDirectives';
	import { rankFrequentTaskModelConfigurations } from '$lib/stores/taskSerialization';
	import { taskLabel } from '$lib/stores/taskTitle';
	import { requestTaskTitle } from '$lib/stores/taskTitles';
	import { modelSettingsStore, STANDARD_ROLES, THINKING_LEVELS } from '$lib/stores/modelSettings.svelte';
	import { supportedThinkingLevels } from '$lib/stores/modelSettingsHelpers';
	import { quotaStore, providersMatch, type ProviderHost } from '$lib/stores/quota.svelte';
	import type { AgentSession } from '$lib/agent/session.svelte';
	import type { AvailableCommand, ImageContent } from '$lib/agent/wire';
	import { prepareImage, isImageFile } from '$lib/agent/images';
	import { STUDIO_SLASH_COMMANDS, mergeCommands } from '$lib/agent/commands';
	import {
		loadProjectFiles,
		rankFileCandidates,
		extractTouchedFilesFromTranscript,
		computeCaretAnchorLeft
	} from '$lib/agent/fileMention';
	import { createFileBadgeElement, createCommandBadgeElement, type ComposerTrigger } from '$lib/agent/composerDoc';
	import {
		SUGGEST_WIDTH,
		commandSuggestions,
		fileSuggestions,
		isSkillName,
		suggestKeyAction
	} from '$lib/agent/suggestItems';
	import { rvLift } from '$lib/agent/motion';
	import { projectStore, pathKey } from '$lib/stores/projects.svelte';
	import ComposerEditor from '$lib/agent/components/ComposerEditor.svelte';
	import SuggestPanel, { type SuggestionItem } from '$lib/agent/components/SuggestPanel.svelte';
	import AttachmentThumb, { type ComposerAttachment } from '$lib/agent/components/AttachmentThumb.svelte';
	import ModelField from '$lib/components/models/ModelField.svelte';
	import ReasoningSlider from '$lib/components/models/ReasoningSlider.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { roleConfigFromSelector } from './taskRoleConfig';
	import {
		IconAttach,
		IconAt,
		IconCheck,
		IconChevronUp,
		IconClose,
		IconGitBranch,
		IconPlay,
		IconTrash
	} from '$lib/icons';

	let {
		task,
		session,
		guiHosts = [],
		onClose,
		onRunTask,
		onOpenImage
	}: {
		task: StudioTask;
		session?: AgentSession | null;
		guiHosts?: ProviderHost[];
		onClose: () => void;
		/** `newLane`: avvio forzato in una corsia isolata, come Shift su «Avvia» nella coda. */
		onRunTask?: (taskId: string, options: { newLane: boolean }) => void;
		onOpenImage?: (data: string, mimeType: string) => void;
	} = $props();

	type RoleChoice = 'smol' | 'default' | 'slow' | 'plan' | 'custom';
	const ROLE_CHOICES: RoleChoice[] = ['smol', 'default', 'slow', 'plan', 'custom'];
	const DEFAULT_OPTIONS: StudioTaskOptions = { role: 'default', thinkingLevel: 'auto', includeEditorContext: true };

	let prompt = $state('');
	let attachedImages = $state<ImageContent[]>([]);
	let options = $state<StudioTaskOptions>({ ...DEFAULT_OPTIONS });

	let lastTaskId = '';
	// Durante il caricamento della bozza l'editor emette input: non sono modifiche.
	let loadingDraft = false;
	let deleteArmed = $state(false);
	let deleteTimer: number | null = null;
	let editorRef = $state<ComposerEditor | null>(null);
	let bodyEl = $state<HTMLElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let isDragging = $state(false);
	let activeMenu = $state<'run' | null>(null);
	let isModelMenuOpen = $state(false);

	let currentTrigger = $state<ComposerTrigger | null>(null);
	let suggestItems = $state<SuggestionItem[]>([]);
	let suggestIndex = $state(0);

	// Letto una volta al montaggio: decide solo se questa apertura entra animata.
	const mountedTaskId = untrack(() => task.id);
	const entering = mountedTaskId !== presentedTaskId;
	presentedTaskId = mountedTaskId;

	const allCommands = $derived(mergeCommands(STUDIO_SLASH_COMMANDS, session?.availableCommands ?? []));
	const isSkill = (name: string) => isSkillName(allCommands, name);
	const title = $derived(
		taskLabel({ prompt, title: task.title, titleHash: task.titleHash }) || m.agent_panel_new_task_btn()
	);
	const hasContent = $derived(prompt.trim().length > 0 || attachedImages.length > 0);
	const activeRole = $derived<RoleChoice>(
		ROLE_CHOICES.includes(options.role as RoleChoice) ? (options.role as RoleChoice) : 'custom'
	);
	const roleOptions = $derived(ROLE_CHOICES.map((id) => ({ value: id, label: id })));
	const roleDescription = $derived.by(() => {
		if (activeRole === 'custom') return m.task_editor_role_custom_desc();
		return STANDARD_ROLES.find((role) => role.id === activeRole)?.desc ?? '';
	});
	const attachments = $derived<ComposerAttachment[]>(
		attachedImages.map((img, index) => ({
			id: index,
			kind: 'image',
			name: m.task_editor_image_name({ index: index + 1 }),
			size: Math.round((img.data.length * 3) / 4),
			url: `data:${img.mimeType};base64,${img.data}`,
			mimeType: img.mimeType,
			tokens: 0
		}))
	);
	const selectedModel = $derived(
		modelSettingsStore.assignableCatalog.find((model) => model.selector === options.modelSelector) ??
		modelSettingsStore.catalog.find((model) => model.selector === options.modelSelector)
	);
	// «Auto» lascia decidere a omp; gli altri passi sono quelli che il modello accetta.
	const offeredThinkingLevels = $derived.by(() => {
		const supported = supportedThinkingLevels(selectedModel);
		return supported ? (['auto', ...supported] as const) : undefined;
	});
	const frequentModelConfigurations = $derived.by(() => {
		const ranked = rankFrequentTaskModelConfigurations(taskStore.originsFor(task.projectPath));
		return ranked.flatMap((configuration) => {
			const model = modelSettingsStore.assignableCatalog.find(
				(candidate) => candidate.selector === configuration.modelSelector
			);
			return model ? [{ ...configuration, model }] : [];
		});
	});
	const selectedModelContext = $derived.by(() => {
		if (!selectedModel) return null;
		const reports = quotaStore.reports.filter((report) =>
			providersMatch(report.provider, selectedModel.provider)
		);
		const windows = reports.flatMap((report) =>
			(report.limits ?? []).flatMap((limit) => {
				const remaining = limit.amount?.remainingFraction ??
					(limit.amount?.usedFraction === undefined ? undefined : 1 - limit.amount.usedFraction);
				if (remaining === undefined) return [];
				const resetsAt = limit.window?.resetsAt ?? limit.resetsAt;
				return [{
					label: limit.label,
					remainingPercent: Math.round(Math.max(0, Math.min(1, remaining)) * 100),
					resetsAt
				}];
			})
		);
		let detail = '';
		let detailTitle = '';
		if (reports.length > 0) {
			if (windows.length > 0) {
				const minimum = Math.min(...windows.map((window) => window.remainingPercent));
				detail = m.task_editor_quota_min({ percent: minimum });
				detailTitle = windows
					.map((window) => {
						const reset = window.resetsAt
							? ` · reset ${i18n.formatDate(window.resetsAt, { dateStyle: 'short', timeStyle: 'short' })}`
							: '';
						return `${window.label}: ${window.remainingPercent}%${reset}`;
					})
					.join(' · ');
			} else {
				detail = m.task_editor_quota_unavailable();
				detailTitle = m.task_editor_quota_unavailable_detail();
			}
		} else if (selectedModel.cost) {
			const formatCost = (value: number | undefined) =>
				i18n.formatNumber(value ?? 0, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
			detail = m.task_editor_model_cost({
				input: formatCost(selectedModel.cost.input),
				output: formatCost(selectedModel.cost.output)
			});
			detailTitle = m.ui_taskeditor_costo_api_indicativo_per_un_milione_di_7767();
		}

		const currentProjectPath = task.projectPath.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
		const currentProjectName = currentProjectPath.split('/').filter(Boolean).at(-1);
		const projects = [...new Set([...guiHosts, ...quotaStore.providerHosts]
			.filter((host) => {
				const hostProjectPath = host.project_path
					?.replaceAll('\\', '/')
					.replace(/\/+$/, '')
					.toLowerCase();
				const belongsToAnotherProject = hostProjectPath
					? hostProjectPath !== currentProjectPath
					: host.project.toLowerCase() !== currentProjectName;
				return (
					providersMatch(host.provider, selectedModel.provider) &&
					(host.model === selectedModel.id ||
						host.model === selectedModel.selector ||
						host.model.endsWith(`/${selectedModel.id}`)) &&
					belongsToAnotherProject
				);
			})
			.map((host) => host.project)
			.filter(Boolean))];

		return {
			detail,
			detailTitle,
			usage: projects.length > 0 ? m.task_editor_quota_used_elsewhere() : '',
			usageTitle: projects.length > 0 ? m.task_editor_quota_used_in({ projects: projects.join(', ') }) : ''
		};
	});

	const availableDirectives = $derived.by(() => {
		const catalog = settingsStore.taskDirectives;
		const snapshots = options.directives || [];
		const list: (TaskDirective | TaskDirectiveSnapshot)[] = [];
		const seenIds = new Set<string>();

		for (const cat of catalog) {
			if (!cat.hidden || snapshots.some((s) => s.id === cat.id)) {
				list.push(cat);
				seenIds.add(cat.id);
			}
		}

		for (const snap of snapshots) {
			if (!seenIds.has(snap.id)) {
				list.push(snap);
				seenIds.add(snap.id);
			}
		}

		return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
	});

	/** Direttive attive che chiedono attenzione: versione nuova nel catalogo o rimosse. */
	const directiveNotices = $derived(
		(options.directives ?? []).flatMap((snapshot) => {
			const status = compareDirectiveRevision(snapshot, settingsStore.taskDirectives);
			if (status === 'up_to_date') return [];
			const revision = settingsStore.taskDirectives.find((d) => d.id === snapshot.id)?.revision ?? 0;
			return [{ snapshot, status, revision }];
		})
	);

	$effect(() => {
		void modelSettingsStore.ensureLoaded();
	});

	// Carica la bozza nell'editor e mette il fuoco in fondo al cambio di task.
	$effect(() => {
		const editor = editorRef;
		if (!editor || task.id === lastTaskId) return;
		lastTaskId = task.id;
		attachedImages = task.images ? [...task.images] : [];
		options = task.options ? { ...task.options } : { ...DEFAULT_OPTIONS };
		deleteArmed = false;
		currentTrigger = null;
		activeMenu = null;
		loadingDraft = true;
		editor.setPlainText(task.prompt, isSkill);
		loadingDraft = false;
		prompt = task.prompt;
		void tick().then(() => editor.focusEnd());
	});

	function saveTask() {
		taskStore.updateTask(task.id, prompt, attachedImages, options);
		requestTaskTitle(task.id);
	}

	function handleEditorInput() {
		if (loadingDraft || !editorRef) return;
		prompt = editorRef.getWireText(isSkill);
		saveTask();
	}

	async function loadAvailableCommands() {
		if (!session || !session.client.isOpen) return;
		try {
			const res = await session.client.send({ type: 'get_available_commands' });
			if (res && typeof res === 'object' && 'commands' in res && Array.isArray((res as { commands: unknown }).commands)) {
				session.availableCommands = (res as { commands: AvailableCommand[] }).commands;
			}
		} catch {
			// Restano i comandi di Studio.
		}
	}

	// Voci della palette per il trigger corrente: file del progetto del task con
	// precedenza ai file aperti o toccati di recente, oppure comandi e skill.
	$effect(() => {
		const trigger = currentTrigger;
		if (!trigger) {
			suggestItems = [];
			suggestIndex = 0;
			return;
		}
		const query = trigger.query;
		if (trigger.kind === '/') {
			if (session && session.availableCommands.length === 0) void loadAvailableCommands();
			suggestItems = commandSuggestions(allCommands, query);
			suggestIndex = 0;
			return;
		}
		if (!task.projectPath) {
			suggestItems = [];
			return;
		}
		void loadProjectFiles(task.projectPath).then((files) => {
			if (currentTrigger !== trigger) return;
			const key = pathKey(task.projectPath);
			const project = projectStore.projects.find(
				(p) =>
					(p.canonicalProjectPath && pathKey(p.canonicalProjectPath) === key) ||
					(p.lane.workspacePath && pathKey(p.lane.workspacePath) === key)
			);
			suggestItems = fileSuggestions(
				rankFileCandidates(query, files, {
					activeFile: project?.lane.activeFile,
					openFiles: project?.lane.openFiles,
					touchedFiles: session?.entries ? extractTouchedFilesFromTranscript(session.entries) : undefined
				}, 8)
			);
			suggestIndex = 0;
		});
	});

	// Altezza della palette con il piede (lista massima 280 px): se sopra la riga
	// non c'e' spazio nella vista, la palette si apre sotto, come un menu ribaltato.
	const SUGGEST_MAX_HEIGHT = 330;
	const LINE_HEIGHT = 24;

	// La palette si apre sopra la riga in cui si scrive, allineata al trigger.
	const suggestAnchor = $derived.by(() => {
		if (!currentTrigger || !composerEl) return { left: 0, bottom: 0, top: undefined };
		const rect = composerEl.getBoundingClientRect();
		const viewTop = bodyEl?.getBoundingClientRect().top ?? 0;
		const left = computeCaretAnchorLeft(currentTrigger.caretRect, rect, SUGGEST_WIDTH);
		if (currentTrigger.caretRect.top - viewTop < SUGGEST_MAX_HEIGHT) {
			return { left, bottom: 0, top: currentTrigger.caretRect.top - rect.top + LINE_HEIGHT + 6 };
		}
		return { left, bottom: Math.max(0, rect.bottom - currentTrigger.caretRect.top + 6), top: undefined };
	});

	function pickSuggestion(item: SuggestionItem) {
		// Il Task Editor offre solo file e comandi; le voci del companion non arrivano qui.
		if (!currentTrigger || !editorRef || (item.kind !== 'file' && item.kind !== 'cmd')) return;
		const badge = item.kind === 'file'
			? createFileBadgeElement(item.item.path)
			: createCommandBadgeElement(item.command.name);
		editorRef.replaceTrigger(badge, currentTrigger);
		currentTrigger = null;
	}

	function handleEditorKeydown(e: KeyboardEvent): boolean {
		if (!currentTrigger || suggestItems.length === 0) return false;
		const action = suggestKeyAction(e, suggestItems.length, suggestIndex);
		if (action?.kind === 'move') suggestIndex = action.index;
		else if (action?.kind === 'pick') {
			const target = suggestItems[suggestIndex];
			if (target) pickSuggestion(target);
		} else if (action?.kind === 'dismiss') {
			editorRef?.dismissCurrentTrigger(currentTrigger);
			currentTrigger = null;
		}
		return action !== null;
	}

	/** Modello e thinking configurati per un ruolo, letti dalla configurazione dei modelli. */
	function resolveRoleConfig(roleId: string): { model: string; thinking: string } {
		const rolesMap = modelSettingsStore.config?.modelRoles || modelSettingsStore.draftConfig?.modelRoles || {};
		return roleConfigFromSelector(rolesMap[roleId] || '', modelSettingsStore.knownSelectors);
	}

	function syncRoleToConfiguration(modelSelector: string, thinkingLevel: string) {
		const matchingRole = STANDARD_ROLES.find((role) => {
			const configured = resolveRoleConfig(role.id);
			return configured.model === modelSelector && configured.thinking === thinkingLevel;
		});
		options.role = matchingRole?.id ?? 'custom';
	}

	function selectRole(roleId: string) {
		options.role = roleId;
		if (roleId !== 'custom') {
			const { model, thinking } = resolveRoleConfig(roleId);
			options.modelSelector = model;
			options.thinkingLevel = thinking;
		}
		saveTask();
	}

	// Un task nuovo nasce con il ruolo predefinito ma senza modello: appena la
	// configurazione dei modelli e' disponibile si compilano modello e thinking
	// effettivi del ruolo, cosi' i controlli mostrano subito cio' che verra' usato.
	$effect(() => {
		const role = options.role;
		if (!role || role === 'custom' || options.modelSelector) return;
		const { model, thinking } = resolveRoleConfig(role);
		if (!model) return;
		options.modelSelector = model;
		options.thinkingLevel = thinking;
		saveTask();
	});

	function handleModelSelect(selector: string) {
		options.modelSelector = selector;
		syncRoleToConfiguration(selector, options.thinkingLevel || 'auto');
		saveTask();
	}

	function handleThinkingChange(level: string) {
		options.thinkingLevel = level;
		syncRoleToConfiguration(options.modelSelector || '', level);
		saveTask();
	}

	function applyFrequentConfiguration(modelSelector: string, thinkingLevel: string) {
		options.modelSelector = modelSelector;
		options.thinkingLevel = thinkingLevel;
		syncRoleToConfiguration(modelSelector, thinkingLevel);
		saveTask();
	}

	function thinkingLabel(level: string): string {
		return THINKING_LEVELS.find((candidate) => candidate.id === level)?.label ?? level;
	}

	function toggleDirective(item: TaskDirective | TaskDirectiveSnapshot) {
		const current = [...(options.directives || [])];
		const index = current.findIndex((d) => d.id === item.id);
		if (index >= 0) {
			current.splice(index, 1);
		} else {
			const cat = settingsStore.taskDirectives.find((d) => d.id === item.id);
			current.push(createDirectiveSnapshot(cat || item));
		}
		current.sort((a, b) => a.order - b.order);
		options.directives = current.length > 0 ? current : undefined;
		saveTask();
	}

	function upgradeDirective(directiveId: string) {
		const cat = settingsStore.taskDirectives.find((d) => d.id === directiveId);
		if (!cat) return;
		const current = [...(options.directives || [])];
		const index = current.findIndex((d) => d.id === directiveId);
		if (index < 0) return;
		current[index] = createDirectiveSnapshot(cat);
		current.sort((a, b) => a.order - b.order);
		options.directives = current;
		saveTask();
	}

	function directiveTooltip(directive: TaskDirective | TaskDirectiveSnapshot): string {
		const placement = directive.placement === 'after' ? m.task_editor_directive_after_tooltip() : '';
		return [directive.description, placement].filter(Boolean).join(' · ');
	}

	function setIncludeEditorContext(checked: boolean) {
		options.includeEditorContext = checked;
		saveTask();
	}

	async function addFiles(files: FileList | File[]) {
		let updated = false;
		for (const file of Array.from(files)) {
			if (!isImageFile(file)) continue;
			const res = await prepareImage(file);
			if (!('error' in res)) {
				attachedImages = [...attachedImages, res];
				updated = true;
			}
		}
		if (updated) saveTask();
	}

	function removeImage(index: number) {
		attachedImages = attachedImages.filter((_, i) => i !== index);
		saveTask();
	}

	function closeEditor() {
		saveTask();
		if (!hasContent) taskStore.deleteTask(task.id);
		presentedTaskId = null;
		onClose();
	}

	function runTask(newLane: boolean) {
		activeMenu = null;
		saveTask();
		if (!hasContent || !onRunTask) return;
		presentedTaskId = null;
		onRunTask(task.id, { newLane });
	}

	// Esc chiude solo se la tastiera e' dentro l'editor e nessuna palette o menu
	// e' aperto: palette e popover consumano Esc per primi.
	function handleRootKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented || currentTrigger || activeMenu || isModelMenuOpen) return;
		e.preventDefault();
		closeEditor();
	}

	function requestDelete() {
		if (deleteArmed) {
			window.clearTimeout(deleteTimer ?? undefined);
			taskStore.deleteTask(task.id);
			presentedTaskId = null;
			onClose();
			return;
		}
		deleteArmed = true;
		window.clearTimeout(deleteTimer ?? undefined);
		deleteTimer = window.setTimeout(() => (deleteArmed = false), 4000);
	}

	onDestroy(() => {
		window.clearTimeout(deleteTimer ?? undefined);
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	class="task-editor"
	aria-label={m.task_editor_region_aria()}
	onkeydown={handleRootKeydown}
	in:rvLift={{ duration: entering ? undefined : 0 }}
>
	<!-- Testata: prende il posto di quella della colonna -->
	<header class="task-header">
		<h2 class="task-title">{title}</h2>
		<span class="save-state">{m.task_editor_state_saved()}</span>
		<div class="header-actions">
			{#if deleteArmed}
				<button type="button" class="ui-button ui-button-danger" onclick={requestDelete}>
					{m.ui_taskeditor_conferma_eliminazione_task_43a9()}
				</button>
			{:else}
				<Tooltip text={m.ui_taskeditor_elimina_questo_task_867e()} placement="bottom">
					<button
						type="button"
						class="header-icon-btn"
						aria-label={m.ui_taskeditor_elimina_task_f0ee()}
						onclick={requestDelete}
					>
						<IconTrash />
					</button>
				</Tooltip>
			{/if}
			<button
				type="button"
				class="header-icon-btn"
				aria-label={m.task_editor_close_aria()}
				onclick={closeEditor}
			>
				<IconClose />
			</button>
		</div>
	</header>

	<div class="task-body" bind:this={bodyEl}>
		<div class="task-column">
			<!-- Prompt: stessa sagoma, voce e badge del composer della chat -->
			<div
				class="task-composer"
				role="group"
				aria-label={m.task_editor_prompt_area_aria()}
				ondragover={(e) => {
					if (e.dataTransfer?.types.includes('Files')) {
						e.preventDefault();
						isDragging = true;
					}
				}}
				ondragleave={(e) => {
					if (e.currentTarget.contains(e.relatedTarget as Node)) return;
					isDragging = false;
				}}
				ondrop={(e) => {
					if (e.dataTransfer?.files.length) {
						e.preventDefault();
						isDragging = false;
						void addFiles(e.dataTransfer.files);
					}
				}}
			>
				{#if currentTrigger && suggestItems.length > 0}
					<SuggestPanel
						kind={currentTrigger.kind}
						query={currentTrigger.query}
						items={suggestItems}
						selectedIndex={suggestIndex}
						left={suggestAnchor.left}
						bottom={suggestAnchor.bottom}
						top={suggestAnchor.top}
						onPick={pickSuggestion}
						onHover={(index) => (suggestIndex = index)}
					/>
				{/if}

				<div class="composer-shell" class:dragging={isDragging} bind:this={composerEl}>
					{#if attachments.length > 0}
						<div class="attachments-row" role="list" aria-label={m.task_editor_images_aria()}>
							{#each attachments as attachment, index (attachment.id)}
								<div role="listitem">
									<AttachmentThumb
										{attachment}
										onOpen={() => onOpenImage?.(attachedImages[index].data, attachedImages[index].mimeType)}
										onRemove={() => removeImage(index)}
									/>
								</div>
							{/each}
						</div>
					{/if}

					<ComposerEditor
						bind:this={editorRef}
						placeholder={m.task_editor_prompt_placeholder()}
						ariaLabel={m.task_editor_prompt_label()}
						submitWithModifier
						onSend={() => closeEditor()}
						onFilesPaste={(files) => void addFiles(files)}
						onTriggerChange={(trigger) => (currentTrigger = trigger)}
						onKeydownFilter={handleEditorKeydown}
						onInput={handleEditorInput}
					/>

					<div class="composer-toolbar">
						<Tooltip text={m.task_editor_attach_image_title()} placement="top" offset={6}>
							<button
								type="button"
								class="composer-icon-btn"
								aria-label={m.task_editor_attach_image_title()}
								onclick={() => fileInputEl?.click()}
							>
								<IconAttach />
							</button>
						</Tooltip>
						<Tooltip text={m.chat_v2_composer_mention_title()} placement="top" offset={6}>
							<button
								type="button"
								class="composer-icon-btn"
								aria-label={m.chat_v2_composer_mention_title()}
								onclick={() => editorRef?.insertTrigger('@')}
							>
								<IconAt />
							</button>
						</Tooltip>

						<!-- Salva e' l'azione principale; avviare e' una scelta esplicita nel menu -->
						<div class="save-split">
							<button
								type="button"
								class="ui-button ui-button-primary save-main"
								onclick={closeEditor}
								aria-label={m.task_editor_save_close_aria()}
							>
								{m.task_editor_save_close_btn()}
								<kbd>Ctrl+↵</kbd>
							</button>
							{#if onRunTask}
								<MenuButton
									open={activeMenu === 'run'}
									title={m.task_editor_run_menu_title()}
									hasPopup="menu"
									align="right"
									width="260px"
									className="save-split-trigger"
									onToggle={() => (activeMenu = activeMenu === 'run' ? null : 'run')}
									onClose={() => (activeMenu = null)}
								>
									{#snippet trigger()}
										<span class="split-chevron"><IconChevronUp /></span>
									{/snippet}
									{#snippet children()}
										<div class="run-menu">
											<button
												type="button"
												role="menuitem"
												class="run-option"
												disabled={!hasContent}
												onclick={() => runTask(false)}
											>
												<span class="run-icon"><IconPlay /></span>
												<span class="run-text">
													<span class="run-title">{m.task_editor_run_now_btn()}</span>
													<span class="run-sub">{m.task_editor_run_now_desc()}</span>
												</span>
											</button>
											<button
												type="button"
												role="menuitem"
												class="run-option"
												disabled={!hasContent}
												onclick={() => runTask(true)}
											>
												<span class="run-icon"><IconGitBranch /></span>
												<span class="run-text">
													<span class="run-title">{m.task_editor_run_new_lane_btn()}</span>
													<span class="run-sub">{m.task_editor_run_new_lane_desc()}</span>
												</span>
											</button>
										</div>
									{/snippet}
								</MenuButton>
							{/if}
						</div>
					</div>

					{#if isDragging}
						<div class="composer-drop-overlay" aria-hidden="true">
							<IconAttach />
							<span>{m.chat_v2_composer_drop_overlay()}</span>
						</div>
					{/if}
				</div>

				<input
					bind:this={fileInputEl}
					type="file"
					accept="image/*"
					multiple
					hidden
					onchange={(e) => {
						if (e.currentTarget.files?.length) void addFiles(e.currentTarget.files);
						e.currentTarget.value = '';
					}}
				/>
			</div>

			<!-- Esecuzione: con che cosa gira il task, tutto visibile senza menu -->
			<section class="task-section" aria-labelledby="task-run-heading">
				<h3 id="task-run-heading" class="section-title">{m.task_editor_run_heading()}</h3>

				<div class="field">
					<span class="field-label" id="task-role-label">{m.task_editor_role_label()}</span>
					<Segmented
						options={roleOptions}
						value={activeRole}
						ariaLabelledBy="task-role-label"
						fill
						onChange={selectRole}
					/>
					<p class="field-help">{roleDescription}</p>
				</div>

				<div class="run-grid">
					<div class="field">
						<span class="field-label" id="task-model-label">{m.task_editor_specific_model_label()}</span>
						<div class="model-field">
							<ModelField
								catalog={modelSettingsStore.assignableCatalog}
								value={options.modelSelector || ''}
								placeholder={m.task_editor_specific_model_placeholder()}
								ariaLabel={m.task_editor_specific_model_label()}
								onSelect={(selector) => handleModelSelect(selector)}
								onOpenChange={(open) => (isModelMenuOpen = open)}
							/>
						</div>
						{#if selectedModelContext && (selectedModelContext.detail || selectedModelContext.usage)}
							<p class="model-context">
								{#if selectedModelContext.detail}
									<Tooltip text={selectedModelContext.detailTitle} disabled={!selectedModelContext.detailTitle}>
										<span class="context-detail">{selectedModelContext.detail}</span>
									</Tooltip>
								{/if}
								{#if selectedModelContext.usage}
									<Tooltip text={selectedModelContext.usageTitle}>
										<span class="context-usage">{selectedModelContext.usage}</span>
									</Tooltip>
								{/if}
							</p>
						{/if}
						{#if frequentModelConfigurations.length > 0}
							<div class="frequent" role="group" aria-labelledby="task-frequent-label">
								<span class="frequent-label" id="task-frequent-label">{m.task_editor_frequent_label()}</span>
								<div class="chip-row">
									{#each frequentModelConfigurations as configuration (`${configuration.modelSelector}:${configuration.thinkingLevel}`)}
										{@const active = options.modelSelector === configuration.modelSelector && (options.thinkingLevel || 'auto') === configuration.thinkingLevel}
										<Tooltip
											text={m.task_editor_frequent_chip_title({
												provider: configuration.model.provider,
												model: configuration.model.name,
												thinking: thinkingLabel(configuration.thinkingLevel),
												count: configuration.count
											})}
										>
											<button
												type="button"
												class="ui-chip"
												aria-pressed={active}
												onclick={() => applyFrequentConfiguration(configuration.modelSelector, configuration.thinkingLevel)}
											>
												{#if active}<span class="chip-check"><IconCheck /></span>{/if}
												<span class="chip-text">{configuration.model.name}</span>
												<span class="chip-meta font-mono">{thinkingLabel(configuration.thinkingLevel)}</span>
											</button>
										</Tooltip>
									{/each}
								</div>
							</div>
						{/if}
					</div>

					<div class="field">
						<span class="field-label">{m.task_editor_thinking_effort_label()}</span>
						<div class="thinking-field">
							<ReasoningSlider
								value={options.thinkingLevel || 'auto'}
								levels={offeredThinkingLevels}
								onChange={handleThinkingChange}
							/>
						</div>
					</div>
				</div>

				<div class="switch-row">
					<div class="switch-text">
						<span class="switch-title" id="task-prewalk-label">{m.task_editor_prewalk_title()}</span>
						<span class="field-help" id="task-prewalk-desc">{m.task_editor_prewalk_desc()}</span>
					</div>
					<Switch
						checked={Boolean(options.prewalk)}
						ariaLabelledBy="task-prewalk-label"
						ariaDescribedBy="task-prewalk-desc"
						onChange={(checked) => {
							options.prewalk = checked ? true : undefined;
							saveTask();
						}}
					/>
				</div>

				<div class="switch-row">
					<div class="switch-text">
						<span class="switch-title" id="task-context-label">{m.task_editor_context_editor_title()}</span>
						<span class="field-help" id="task-context-desc">{m.task_editor_context_editor_desc()}</span>
					</div>
					<Switch
						checked={options.includeEditorContext !== false}
						ariaLabelledBy="task-context-label"
						ariaDescribedBy="task-context-desc"
						onChange={setIncludeEditorContext}
					/>
				</div>
			</section>

			<!-- Direttive: chip con il solo titolo, la spiegazione nel Tooltip -->
			<section class="task-section" aria-labelledby="task-directives-heading">
				<div class="section-head">
					<h3 id="task-directives-heading" class="section-title">{m.task_editor_directives_heading()}</h3>
					{#if (options.directives?.length ?? 0) > 0}
						<span class="section-count">{m.task_editor_directives_active_count({ count: options.directives?.length ?? 0 })}</span>
					{/if}
					<button
						type="button"
						class="ui-button ui-button-ghost manage-btn"
						onclick={() => settingsStore.openSection('tasks')}
					>
						{m.task_editor_manage_directives_btn()}
					</button>
				</div>

				<div class="chip-row" role="group" aria-labelledby="task-directives-heading">
					{#each availableDirectives as directive (directive.id)}
						{@const active = Boolean(options.directives?.some((d) => d.id === directive.id))}
						<Tooltip text={directiveTooltip(directive)} disabled={!directiveTooltip(directive)}>
							<button
								type="button"
								class="ui-chip"
								aria-pressed={active}
								onclick={() => toggleDirective(directive)}
							>
								{#if active}<span class="chip-check"><IconCheck /></span>{/if}
								<span class="chip-text">{directive.name}</span>
							</button>
						</Tooltip>
					{/each}
				</div>

				{#each directiveNotices as notice (notice.snapshot.id)}
					<div class="directive-notice">
						{#if notice.status === 'upgrade_available'}
							<StatusMark status="attention" active={false} />
							<span class="notice-text">{m.task_editor_directive_upgrade_available({ name: notice.snapshot.name, revision: notice.revision })}</span>
							<Tooltip text={m.ui_taskeditor_sostituisce_lo_snapshot_congelato_con_la_versione_b86f()}>
								<button type="button" class="ui-button ui-button-ghost" onclick={() => upgradeDirective(notice.snapshot.id)}>
									{m.task_editor_directive_upgrade_btn()}
								</button>
							</Tooltip>
						{:else}
							<span class="notice-text muted">{m.task_editor_directive_orphan({ name: notice.snapshot.name })}</span>
						{/if}
					</div>
				{/each}
			</section>
		</div>
	</div>
</section>

<style>
	.task-editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--bg-sunken);
		overflow: hidden;
		font-family: var(--font-ui);
	}

	/* Stessa misura della testata di colonna che sostituisce. */
	.task-header {
		height: 32px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-1) 0 var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.task-title {
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.save-state {
		flex-shrink: 0;
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}

	.header-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.header-icon-btn {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 14px;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.header-icon-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.task-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	/* Colonna di lettura da 720 px, come il transcript della chat. */
	.task-column {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-3) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		box-sizing: border-box;
	}

	.task-composer {
		position: relative;
		--editor-min-height: 140px;
		--editor-max-height: 460px;
	}

	.attachments-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: 12px 14px 2px;
	}

	.save-split {
		margin-left: auto;
		display: flex;
		align-items: center;
		border-radius: var(--radius-md);
		background: var(--brand);
	}

	.save-main {
		height: 28px;
		gap: var(--space-2);
	}

	.save-split:has(:global(.save-split-trigger)) .save-main {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}

	.save-main kbd {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 500;
	}

	:global(.menu-button.save-split-trigger) {
		height: 28px;
		padding: 0 8px 0 6px;
		background: var(--brand);
		color: var(--on-brand);
		border: 1px solid transparent;
		border-left-color: color-mix(in oklch, var(--on-brand) 25%, transparent);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
	}

	:global(.menu-button.save-split-trigger:hover:not(:disabled)),
	:global(.menu-button.save-split-trigger.active) {
		background: var(--brand);
		color: var(--on-brand);
		border-color: var(--on-brand);
	}

	.split-chevron {
		display: inline-flex;
		--icon-size: 12px;
	}

	.run-menu {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-1);
	}

	.run-option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: 7px 8px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		font-family: var(--font-ui);
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.run-option:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.run-option:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.run-icon {
		display: inline-flex;
		padding-top: 2px;
		color: var(--ink-muted);
		--icon-size: 14px;
	}

	.run-text {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.run-title {
		font-size: var(--text-body);
		font-weight: 450;
	}

	.run-sub {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.task-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.section-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.section-title {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.section-count {
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.manage-btn {
		margin-left: auto;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.field-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.field-help {
		margin: 0;
		font-size: var(--text-label);
		line-height: 1.4;
		color: var(--ink-muted);
	}

	.run-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
		align-items: start;
	}

	@media (max-width: 720px) {
		.run-grid {
			grid-template-columns: 1fr;
		}
	}

	.model-context {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.context-usage {
		color: var(--warn);
	}

	.frequent {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 2px;
	}

	.frequent-label {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip-check {
		display: inline-flex;
		--icon-size: 12px;
	}

	.chip-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip-meta {
		flex-shrink: 0;
		color: var(--ink-faint);
	}

	/* Su --bg-active --ink-faint scende a 3,96:1: la chip scelta usa --ink-muted. */
	:global(.ui-chip[aria-pressed='true']) .chip-meta {
		color: var(--ink-muted);
	}

	.thinking-field {
		padding-top: 2px;
		--slider-ring: var(--bg-sunken);
	}

	.switch-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--line);
	}

	.switch-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.switch-title {
		font-size: var(--text-body);
		font-weight: 450;
		color: var(--ink);
	}

	.directive-notice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-label);
		color: var(--ink);
	}

	.notice-text {
		min-width: 0;
	}

	.notice-text.muted {
		color: var(--ink-muted);
	}

	@media (max-width: 800px) {
		.save-state {
			display: none;
		}
	}
</style>
