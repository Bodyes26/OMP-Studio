<script lang="ts" module>
	export interface SelectedProjectMeta {
		name: string;
		label: string;
		hue?: number;
		path?: string;
	}

	export interface SelectedDirectiveMeta {
		id: string;
		name: string;
		tag?: string;
	}

	export interface SelectedRoleMeta {
		kind: 'role' | 'model';
		value: string;
		label: string;
		hue?: number;
	}

	/** Voci che la vista passa alla palette: i dati restano della vista, il filtro qui. */
	export interface CompanionSuggestSources {
		projects: { name: string; label: string; hue: number; path?: string }[];
		directives: { id?: string; value: string; label: string; hint?: string }[];
		roles: { value: string; label: string; hint?: string; hue?: number }[];
		models: { value: string; label: string; hint: string; search: string }[];
		commands?: AvailableCommand[];
	}
</script>

<script lang="ts">
	// Campo del nuovo task: la stessa sagoma e lo stesso editor a badge della
	// chat e del Task Editor (`.composer-shell`, `ComposerEditor`, `SuggestPanel`),
	// ridotto a cio' che serve per accodare: niente modello ne' thinking, il
	// ruolo si sceglie con il badge `!`. In piu' rispetto alla chat il companion
	// conosce `#progetto` e `!ruolo`, che diventano badge d'identita'.
	import { m } from '#lib/paraglide/messages.js';
	import type { AvailableCommand, ImageContent } from '#lib/agent/wire.ts';
	import ComposerEditor from '#lib/agent/components/ComposerEditor.svelte';
	import SuggestPanel, { type SuggestionItem } from '#lib/agent/components/SuggestPanel.svelte';
	import AttachmentThumb, { type ComposerAttachment } from '#lib/agent/components/AttachmentThumb.svelte';
	import {
		createCommandBadgeElement,
		createFileBadgeElement,
		createProjectBadgeElement,
		createRoleBadgeElement,
		type ComposerTrigger
	} from '#lib/agent/composerDoc.ts';
	import { computeCaretAnchorLeft, loadProjectFiles, rankFileCandidates } from '#lib/agent/fileMention.ts';
	import { SUGGEST_WIDTH, commandSuggestions, fileSuggestions, suggestKeyAction } from '#lib/agent/suggestItems.ts';
	import { matchesLooseQuery } from '#lib/looseSearch.ts';
	import { trayFold } from '#lib/agent/motion.ts';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import {
		IconArrowUp,
		IconAt,
		IconAttach,
		IconCircleAlert,
		IconCircleCheck,
		IconClose,
		IconWarning
	} from '#lib/icons.ts';

	let {
		editor = $bindable(null as ComposerEditor | null),
		attachedImages,
		sources,
		fileProjectPath,
		destinationName = null,
		selectedProject = null,
		selectedDirectives = [],
		selectedRole = null,
		canSave,
		statusText,
		successNotice,
		errors,
		previewNotes,
		onInput,
		onSave,
		onFilesAdd,
		onRemoveImage,
		onOpenFileDialog,
		onSelectProject,
		onRemoveProject,
		onAddDirective,
		onRemoveDirective,
		onSelectRole,
		onRemoveRole
	} = $props<{
		editor?: ComposerEditor | null;
		attachedImages: ImageContent[];
		sources: CompanionSuggestSources;
		/** Progetto da cui prendere i file per `@`; vuoto finche' manca `#progetto`. */
		fileProjectPath: string | null;
		/** Nome del progetto di destinazione del task, se noto. */
		destinationName?: string | null;
		selectedProject?: SelectedProjectMeta | null;
		selectedDirectives?: SelectedDirectiveMeta[];
		selectedRole?: SelectedRoleMeta | null;
		canSave: boolean;
		/** Salvataggio, interpretazione AI o immagini in preparazione. */
		statusText: string | null;
		successNotice: string | null;
		errors: string[];
		/** Ambiguita' o progetto mancante, dal parse locale o dall'AI. */
		previewNotes: string[];
		onInput: () => void;
		onSave: () => void;
		onFilesAdd: (files: FileList | File[]) => void;
		onRemoveImage: (index: number) => void;
		onOpenFileDialog: () => void;
		onSelectProject?: (proj: SelectedProjectMeta) => void;
		onRemoveProject?: () => void;
		onAddDirective?: (dir: SelectedDirectiveMeta) => void;
		onRemoveDirective?: (id: string) => void;
		onSelectRole?: (role: SelectedRoleMeta) => void;
		onRemoveRole?: () => void;
	}>();

	const TOKEN_HINTS = $derived([
		{ char: '#' as const, label: m.companion_token_project(), tooltip: m.ui_companionview_scegli_il_progetto_di_destinazione_254a() },
		{ char: '/' as const, label: m.companion_token_directive(), tooltip: m.ui_companionview_aggiungi_una_direttiva_al_task_e689() },
		{ char: '!' as const, label: m.companion_token_role(), tooltip: m.ui_companionview_forza_il_ruolo_o_il_modello_32cf() }
	]);
	// La palette si apre sotto la riga: il campo sta in cima alla finestra.
	const LINE_HEIGHT = 24;
	const MAX_PROJECT_ITEMS = 6;

	let shellEl = $state<HTMLDivElement | null>(null);
	let windowHeight = $state(typeof window !== 'undefined' ? window.innerHeight : 800);
	let isDragging = $state(false);
	let currentTrigger = $state<ComposerTrigger | null>(null);
	let suggestItems = $state<SuggestionItem[]>([]);
	let suggestIndex = $state(0);
	const attachments = $derived<ComposerAttachment[]>(
		attachedImages.map((img: ImageContent, index: number) => ({
			id: index,
			kind: 'image',
			name: m.companion_attachment_alt({ index: index + 1 }),
			size: Math.round((img.data.length * 3) / 4),
			url: `data:${img.mimeType};base64,${img.data}`,
			mimeType: img.mimeType,
			tokens: 0
		}))
	);

	// `@` senza progetto apre la palette con l'invito a indicarlo: e' l'unico
	// caso in cui una lista vuota resta a vista.
	const fileNeedsProject = $derived(currentTrigger?.kind === '@' && !fileProjectPath);
	const panelVisible = $derived(currentTrigger !== null && (suggestItems.length > 0 || fileNeedsProject));

	$effect(() => {
		const trigger = currentTrigger;
		suggestIndex = 0;
		if (!trigger) {
			suggestItems = [];
			return;
		}
		const query = trigger.query.toLowerCase();
		if (trigger.kind === '#') {
			suggestItems = sources.projects
				.filter((p: CompanionSuggestSources['projects'][number]) =>
					!query || p.label.toLowerCase().includes(query) || p.name.toLowerCase().includes(query)
				)
				.slice(0, MAX_PROJECT_ITEMS)
				.map((p: CompanionSuggestSources['projects'][number]): SuggestionItem => ({
					kind: 'project',
					value: p.name,
					label: p.label,
					hint: p.name,
					hue: p.hue
				}));
		} else if (trigger.kind === '/') {
			const directiveItems: SuggestionItem[] = sources.directives
				.filter((d: CompanionSuggestSources['directives'][number]) =>
					!query || d.label.toLowerCase().includes(query) || d.value.toLowerCase().includes(query)
				)
				.map((d: CompanionSuggestSources['directives'][number]): SuggestionItem => ({ kind: 'directive', ...d }));
			const cmdItems: SuggestionItem[] = sources.commands
				? commandSuggestions(sources.commands, trigger.query)
				: [];
			suggestItems = [...directiveItems, ...cmdItems];
		} else if (trigger.kind === '!') {
			suggestItems = [
				...sources.roles
					.filter((r: CompanionSuggestSources['roles'][number]) =>
						matchesLooseQuery(trigger.query, `${r.value} ${r.label} ${r.hint ?? ''}`.toLowerCase())
					)
					.map((r: CompanionSuggestSources['roles'][number]): SuggestionItem => ({ kind: 'role', ...r })),
				...sources.models
					.filter((model: CompanionSuggestSources['models'][number]) => matchesLooseQuery(trigger.query, model.search))
					.map(({ value, label, hint }: CompanionSuggestSources['models'][number]): SuggestionItem => ({
						kind: 'model',
						value,
						label,
						hint
					}))
			];
		} else if (fileProjectPath) {
			const projectPath = fileProjectPath;
			suggestItems = [];
			void loadProjectFiles(projectPath).then((files) => {
				// Un tasto arrivato durante il caricamento ha gia' cambiato trigger.
				if (currentTrigger !== trigger) return;
				suggestItems = fileSuggestions(rankFileCandidates(trigger.query, files, {}));
			});
		} else {
			suggestItems = [];
		}
	});

	const suggestAnchor = $derived.by(() => {
		if (!currentTrigger || !shellEl) return { left: 0, top: 0 };
		const rect = shellEl.getBoundingClientRect();
		return {
			left: computeCaretAnchorLeft(currentTrigger.caretRect, rect, SUGGEST_WIDTH),
			top: currentTrigger.caretRect.top - rect.top + LINE_HEIGHT + 6
		};
	});

	function pickSuggestion(item: SuggestionItem) {
		if (!currentTrigger || !editor) return;
		switch (item.kind) {
			case 'file': {
				const badge = createFileBadgeElement(item.item.path);
				editor.replaceTrigger(badge, currentTrigger);
				break;
			}
			case 'cmd': {
				const badge = createCommandBadgeElement(item.command.name);
				editor.replaceTrigger(badge, currentTrigger);
				break;
			}
			case 'project': {
				editor.replaceTrigger(null, currentTrigger);
				const foundProj = sources.projects.find((p: CompanionSuggestSources['projects'][number]) => p.name === item.value);
				onSelectProject?.({
					name: item.value,
					label: item.label,
					hue: item.hue,
					path: foundProj?.path
				});
				break;
			}
			case 'directive': {
				editor.replaceTrigger(null, currentTrigger);
				const dirItem = item as SuggestionItem & { id?: string; hint?: string };
				onAddDirective?.({
					id: dirItem.id ?? item.value,
					name: item.label,
					tag: dirItem.hint ?? `/${item.value}`
				});
				break;
			}
			case 'role': {
				editor.replaceTrigger(null, currentTrigger);
				onSelectRole?.({
					kind: 'role',
					value: item.value,
					label: item.label,
					hue: item.hue
				});
				break;
			}
			case 'model': {
				editor.replaceTrigger(null, currentTrigger);
				onSelectRole?.({
					kind: 'model',
					value: item.value,
					label: item.label
				});
				break;
			}
		}
		currentTrigger = null;
	}

	function handleEditorKeydown(e: KeyboardEvent): boolean {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			currentTrigger = null;
			onSave();
			return true;
		}
		if (!currentTrigger) return false;
		// Escape chiude la palette anche quando e' vuota: mai la finestra nello
		// stesso gesto.
		if (e.key === 'Escape') {
			e.preventDefault();
			editor?.dismissCurrentTrigger(currentTrigger);
			currentTrigger = null;
			return true;
		}
		const action = suggestKeyAction(e, suggestItems.length, suggestIndex);
		if (action?.kind === 'move') suggestIndex = action.index;
		else if (action?.kind === 'pick') {
			const target = suggestItems[suggestIndex];
			if (target) pickSuggestion(target);
		}
		return action !== null;
	}

	function handleShellClick(e: MouseEvent) {
		// La sagoma intera porta il fuoco nell'editor, salvo i controlli e i badge.
		if ((e.target as HTMLElement).closest('button, .chat-badge, [contenteditable="true"]')) return;
		editor?.focusEnd();
	}
</script>

<svelte:window bind:innerHeight={windowHeight} />

<section class="quick-task-section">
	<div
		class="composer-area"
		role="group"
		aria-label={m.companion_composer_aria()}
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
				onFilesAdd(e.dataTransfer.files);
			}
		}}
	>
		{#if panelVisible && currentTrigger}
			<SuggestPanel
				kind={currentTrigger.kind}
				query={currentTrigger.query}
				items={suggestItems}
				selectedIndex={suggestIndex}
				left={suggestAnchor.left}
				bottom={0}
				top={suggestAnchor.top}
				emptyMessage={fileNeedsProject ? m.companion_file_mention_no_project() : undefined}
				onPick={pickSuggestion}
				onHover={(index) => (suggestIndex = index)}
			/>
		{/if}

		<!-- Il clic sulla sagoma porta il fuoco nell'editor: comodita' del puntatore,
		     la tastiera ci arriva gia' con Tab. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="composer-shell"
			class:dragging={isDragging}
			bind:this={shellEl}
			role="presentation"
			style:--editor-min-height="{windowHeight >= 700 ? '48px' : '24px'}"
			onclick={handleShellClick}
		>
			{#if attachments.length > 0}
				<div class="composer-attachments" role="list" aria-label={m.task_editor_images_aria()}>
					{#each attachments as attachment, index (attachment.id)}
						<div role="listitem">
							<AttachmentThumb {attachment} onRemove={() => onRemoveImage(index)} />
						</div>
					{/each}
				</div>
			{/if}

			<ComposerEditor
				bind:this={editor}
				placeholder={m.companion_composer_placeholder()}
				ariaLabel={m.companion_composer_aria()}
				triggers={['@', '#', '/', '!']}
				submitWithModifier={true}
				onSend={() => onSave()}
				onFilesPaste={(files) => onFilesAdd(files)}
				onTriggerChange={(trigger) => (currentTrigger = trigger)}
				onKeydownFilter={handleEditorKeydown}
				{onInput}
			/>

			<div class="composer-toolbar">
				<Tooltip text={m.companion_attach_images()} placement="top">
					<button
						type="button"
						class="composer-icon-btn"
						aria-label={m.companion_attach_images()}
						onclick={onOpenFileDialog}
					>
						<IconAttach />
					</button>
				</Tooltip>
				<Tooltip text={m.chat_v2_composer_mention_title()} placement="top">
					<button
						type="button"
						class="composer-icon-btn"
						aria-label={m.chat_v2_composer_mention_title()}
						onclick={() => editor?.insertTrigger('@')}
					>
						<IconAt />
					</button>
				</Tooltip>
				<span class="composer-divider" aria-hidden="true"></span>
				<div class="token-hints">
					{#each TOKEN_HINTS as hint (hint.char)}
						<Tooltip text={hint.tooltip} placement="top">
							<button type="button" class="ui-chip token-hint" onclick={() => editor?.insertTrigger(hint.char)}>
								<span class="token-char">{hint.char}</span>{hint.label}
							</button>
						</Tooltip>
					{/each}
				</div>
				<div class="composer-metadata-badges" role="list">
					{#if selectedProject}
						<span class="chat-badge chat-badge--project metadata-badge" style:--badge-h={selectedProject.hue} role="listitem">
							<span class="chat-badge-dot"></span>
							<span class="chat-badge-name">{selectedProject.name}</span>
							<button
								type="button"
								class="metadata-badge-remove"
								aria-label={m.companion_card_close_title()}
								onclick={(e) => { e.stopPropagation(); onRemoveProject?.(); }}
							>
								<IconClose />
							</button>
						</span>
					{:else if destinationName}
						<span class="capture-destination">{m.companion_destination_queue({ project: destinationName })}</span>
					{/if}

					{#each selectedDirectives as directive (directive.id)}
						<span class="chat-badge chat-badge--cmd metadata-badge" role="listitem">
							<span class="chat-badge-name">{directive.tag ?? `/${directive.name}`}</span>
							<button
								type="button"
								class="metadata-badge-remove"
								aria-label={m.companion_card_close_title()}
								onclick={(e) => { e.stopPropagation(); onRemoveDirective?.(directive.id); }}
							>
								<IconClose />
							</button>
						</span>
					{/each}

					{#if selectedRole}
						<span class="chat-badge chat-badge--role metadata-badge" style:--badge-h={selectedRole.hue} role="listitem">
							{#if selectedRole.hue !== undefined}
								<span class="chat-badge-dot" class:is-default={selectedRole.value === 'default'}></span>
							{/if}
							<span class="chat-badge-name">!{selectedRole.label}</span>
							<button
								type="button"
								class="metadata-badge-remove"
								aria-label={m.companion_card_close_title()}
								onclick={(e) => { e.stopPropagation(); onRemoveRole?.(); }}
							>
								<IconClose />
							</button>
						</span>
					{/if}
				</div>
				<Tooltip text={m.ui_companionview_salva_il_task_invio_maiusc_invio_va_7235()} placement="top">
					<button
						type="button"
						class="ui-button ui-button-secondary action-submit"
						disabled={!canSave}
						aria-label={m.companion_add_to_queue()}
						onclick={() => onSave()}
					>
						<IconArrowUp />
						<span>{m.companion_add_to_queue()}</span>
					</button>
				</Tooltip>
			</div>

			{#if isDragging}
				<div class="composer-drop-overlay" aria-hidden="true">
					<IconAttach />
					<span>{m.companion_drop_overlay()}</span>
				</div>
			{/if}
		</div>
	</div>

	<div class="composer-notes" aria-live="polite">
		{#if statusText}
			<p class="composer-note" transition:trayFold>
				<StatusMark status="running" />
				<span class="text-shimmer">{statusText}</span>
			</p>
		{/if}
		{#if successNotice}
			<p class="composer-note" transition:trayFold>
				<span class="note-icon success"><IconCircleCheck /></span>
				<span>{successNotice}</span>
			</p>
		{/if}
		{#each errors as error (error)}
			<p class="composer-note" transition:trayFold>
				<span class="note-icon danger"><IconCircleAlert /></span>
				<span>{error}</span>
			</p>
		{/each}
		{#each previewNotes as note (note)}
			<p class="composer-note muted" transition:trayFold>
				<span class="note-icon warn"><IconWarning /></span>
				<span>{note}</span>
			</p>
		{/each}
	</div>
</section>

<style>
	.composer-metadata-badges {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-left: auto;
		margin-right: 8px;
	}

	.metadata-badge {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		line-height: 1.4;
		max-width: 220px;
	}

	.metadata-badge-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		padding: 0;
		margin-left: 2px;
		border: none;
		background: transparent;
		color: inherit;
		opacity: 0.6;
		cursor: pointer;
		border-radius: var(--radius-full);
		transition: opacity var(--transition-fast), background-color var(--transition-fast);
	}

	.metadata-badge-remove:hover {
		opacity: 1;
		background: color-mix(in oklch, currentColor 15%, transparent);
	}

	.metadata-badge-remove :global(svg) {
		width: 10px;
		height: 10px;
	}
</style>
