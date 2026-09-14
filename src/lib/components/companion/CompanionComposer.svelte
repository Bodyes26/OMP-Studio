<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { slide } from 'svelte/transition';
	import { anchoredPopover } from '$lib/anchoredPopover';
	import type { QuickTaskAiParsed } from '$lib/stores/companion.svelte';
	import type { DisplayToken, LocalQuickTask } from '$lib/companion/quickTaskLocal';
	import type { ImageContent } from '$lib/agent/wire';
	import { IconArrowUp, IconAttach, IconCheck, IconClose, IconWarning } from '$lib/icons';

	type MentionItem = {
		value: string;
		label: string;
		hint?: string;
		kind: 'project' | 'directive' | 'role' | 'model';
		search: string;
	};

	let {
		size = 'default',
		collapsed = false,
		onExpand,
		taskInput = $bindable(''),
		inputEl = $bindable(null as HTMLTextAreaElement | null),
		composerEl = $bindable(null as HTMLElement | null),
		backdropEl = $bindable(null as HTMLDivElement | null),
		fileInputEl = $bindable(null as HTMLInputElement | null),
		displayTokens,
		attachedImages,
		isDraggingOver,
		isBusy,
		canSave,
		imageProcessingCount,
		isParsingTask,
		mentionOpen,
		mentionItems,
		mentionIndex,
		local,
		aiParsed,
		parseError,
		successNotice,
		attachmentError,
		onInsertToken,
		onInput,
		onInputKeydown,
		onSyncCaret,
		onInputScroll,
		onPaste,
		onDragOver,
		onDragLeave,
		onDrop,
		onRemoveImage,
		onTriggerFileInput,
		onFileInputChange,
		onSaveTask,
		onChooseMention
	} = $props<{
		size?: 'default' | 'hero' | 'compact';
		collapsed?: boolean;
		onExpand?: () => void;
		taskInput?: string;
		inputEl?: HTMLTextAreaElement | null;
		composerEl?: HTMLElement | null;
		backdropEl?: HTMLDivElement | null;
		fileInputEl?: HTMLInputElement | null;
		displayTokens: DisplayToken[];
		attachedImages: ImageContent[];
		isDraggingOver: boolean;
		isBusy: boolean;
		canSave: boolean;
		imageProcessingCount: number;
		isParsingTask: boolean;
		mentionOpen: boolean;
		mentionItems: MentionItem[];
		mentionIndex: number;
		local: LocalQuickTask;
		aiParsed: QuickTaskAiParsed | null;
		parseError: string | null;
		successNotice: string | null;
		attachmentError: string | null;
		onInsertToken: (char: string) => void;
		onInput: () => void;
		onInputKeydown: (e: KeyboardEvent) => void;
		onSyncCaret: () => void;
		onInputScroll: () => void;
		onPaste: (e: ClipboardEvent) => void;
		onDragOver: (e: DragEvent) => void;
		onDragLeave: (e: DragEvent) => void;
		onDrop: (e: DragEvent) => void;
		onRemoveImage: (index: number) => void;
		onTriggerFileInput: () => void;
		onFileInputChange: (e: Event) => void;
		onSaveTask: () => void | Promise<void>;
		onChooseMention: (value: string) => void;
	}>();

	const TOKEN_HINTS = [
		{ char: '@', label: 'progetto', title: m.ui_companionview_scegli_il_progetto_di_destinazione_254a() },
		{ char: '/', label: 'direttiva', title: m.ui_companionview_aggiungi_una_direttiva_al_task_e689() },
		{ char: '!', label: 'ruolo', title: m.ui_companionview_forza_il_ruolo_o_il_modello_32cf() }
	];

	const sizeClass = $derived(
		size === 'hero' ? 'composer-hero' : size === 'compact' ? 'composer-compact' : ''
	);

	function handleComposerClick() {
		if (collapsed) {
			onExpand?.();
			return;
		}
		inputEl?.focus();
	}
</script>

<section class="quick-task-section {sizeClass}" class:composer-collapsed={collapsed}>
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="composer"
		class:dragging={isDraggingOver}
		bind:this={composerEl}
		role="presentation"
		ondragover={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
		onclick={handleComposerClick}
	>
		{#if collapsed}
			<!-- Bottone vero: da tastiera il composer chiuso deve essere raggiungibile. -->
			<button type="button" class="composer-expand-hint" onclick={() => onExpand?.()}>
				{m.companion_composer_collapsed_hint()}
			</button>
		{:else}
			<div class="composer-stage">
				<!--
					Backdrop: dipinge il testo che la textarea tiene trasparente. I segmenti
					stanno tutti su una riga sola, senza spazi di indentazione fra i tag:
					qualunque carattere in piu' disallineerebbe il caret.
				-->
				<div class="composer-backdrop" aria-hidden="true" bind:this={backdropEl}>{#each displayTokens as token, idx (idx)}<span class="tok" class:project={token.kind === 'project'} class:directive={token.kind === 'directive'} class:role={token.kind === 'role'}>{token.text}</span>{/each}{#if taskInput.endsWith('\n')}<span>&#8203;</span>{/if}</div>
				<textarea
					bind:this={inputEl}
					bind:value={taskInput}
					oninput={onInput}
					onkeydown={onInputKeydown}
					onclick={onSyncCaret}
					onkeyup={onSyncCaret}
					onpaste={onPaste}
					onscroll={onInputScroll}
					rows="1"
					class="composer-input"
					placeholder={m.companion_composer_placeholder()}
					aria-label={m.companion_composer_aria()}
					aria-autocomplete="list"
					aria-controls={mentionOpen ? 'companion-mention-listbox' : undefined}
					aria-activedescendant={mentionOpen ? `companion-mention-${Math.min(mentionIndex, mentionItems.length - 1)}` : undefined}
				></textarea>
			</div>

			{#if attachedImages.length > 0}
				<div class="image-previews" role="region" aria-label={m.task_editor_images_aria()}>
					{#each attachedImages as image, idx (idx)}
						<div class="image-thumb-wrap">
							<img
								src="data:{image.mimeType};base64,{image.data}"
								alt="Allegato task {idx + 1}"
								class="image-thumb"
							/>
							<button
								type="button"
								class="image-remove-btn"
								aria-label="Rimuovi immagine {idx + 1}"
								title={m.task_editor_remove_image_title()}
								onclick={(event) => {
									event.stopPropagation();
									onRemoveImage(idx);
								}}
							>
								<IconClose />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="composer-rail">
				<div class="token-hints">
					{#each TOKEN_HINTS as hint (hint.char)}
						<button
							type="button"
							class="token-hint"
							title={hint.title}
							onclick={(e) => {
								e.stopPropagation();
								onInsertToken(hint.char);
							}}
						>
							<span class="token-char">{hint.char}</span>{hint.label}
						</button>
					{/each}
				</div>

				<div class="composer-actions">
					<input
						type="file"
						accept="image/*"
						multiple
						bind:this={fileInputEl}
						onchange={onFileInputChange}
						hidden
					/>
					<button
						type="button"
						class="attach-btn"
						title="Allega screenshot o immagini"
						aria-label={m.companion_attach_images()}
						onclick={(event) => {
							event.stopPropagation();
							onTriggerFileInput();
						}}
					>
						<IconAttach />
					</button>
					<button
						type="button"
						class="send-btn"
						class:busy={isBusy}
						disabled={!canSave}
						title={isBusy
							? imageProcessingCount > 0
								? 'Preparazione immagini'
								: m.ui_companionview_salvataggio_in_corso_dbfc()
							: m.ui_companionview_salva_il_task_invio_maiusc_invio_va_7235()}
						aria-label={m.companion_save_task()}
						onclick={(event) => {
							event.stopPropagation();
							void onSaveTask();
						}}
					>
						{#if isBusy}
							<span class="spinner"></span>
						{:else}
							<IconArrowUp />
						{/if}
					</button>
				</div>
			</div>
		{/if}
	</div>

	{#if !collapsed}
		{#if isBusy}
			<p class="composer-status">
				{imageProcessingCount > 0
					? 'Preparazione immagini…'
					: isParsingTask
						? 'Interpretazione con AI…'
						: 'Salvataggio…'}
			</p>
		{/if}

		{#if mentionOpen}
			<div
				id="companion-mention-listbox"
				class="mention-popover"
				role="listbox"
				aria-label={m.companion_suggestions_aria()}
				popover="manual"
				use:anchoredPopover={{ anchor: composerEl, offset: 6, matchWidth: true, constrainHeight: true }}
			>
				{#each mentionItems as item, idx (`${item.kind}:${item.value}`)}
					<button
						type="button"
						id="companion-mention-{idx}"
						class="mention-item"
						class:selected={idx === Math.min(mentionIndex, mentionItems.length - 1)}
						role="option"
						aria-selected={idx === Math.min(mentionIndex, mentionItems.length - 1)}
						onmousedown={(e) => {
							e.preventDefault();
							onChooseMention(item.value);
						}}
					>
						<span class="mention-label">{item.label}</span>
						{#if item.hint && item.hint !== item.label}
							<span class="mention-hint">{item.hint}</span>
						{/if}
						{#if item.kind === 'model' || item.kind === 'role'}
							<span class="mention-kind">{item.kind === 'model' ? m.ui_companionview_modello_fa78() : 'ruolo'}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		{#if successNotice}
			<div class="notice success" transition:slide={{ duration: 180 }}>
				<IconCheck />
				<span>{successNotice}</span>
			</div>
		{/if}

		{#if attachmentError}
			<div class="notice error" transition:slide={{ duration: 180 }}>
				<IconWarning />
				<span>{attachmentError}</span>
			</div>
		{/if}

		{#if parseError}
			<div class="notice error" transition:slide={{ duration: 180 }}>
				<IconWarning />
				<span>{parseError}</span>
			</div>
		{/if}

		{#if taskInput.trim() || attachedImages.length > 0}
			{@const preview = aiParsed ?? {
				projectName: local.projectName,
				projectPath: local.projectPath,
				taskPrompt: local.taskPrompt,
				role: local.role,
				modelSelector: local.modelSelector,
				directiveIds: local.directiveIds,
				ambiguities: []
			}}
			{@const hasAmbiguities = Boolean(preview.ambiguities && preview.ambiguities.length > 0)}
			{@const hasMissingProject = !preview.projectPath}
			{#if hasAmbiguities || hasMissingProject}
				<div class="parsed-strip" transition:slide={{ duration: 180 }}>
					{#if hasAmbiguities}
						{#each preview.ambiguities as amb, idx (idx)}
							<p class="parsed-note"><IconWarning /><span>{amb}</span></p>
						{/each}
					{:else if hasMissingProject}
						<p class="parsed-note">
							<IconWarning />
							<span>Scrivi <span class="token-char">@</span>{m.ui_companionview_progetto_oppure_salva_e_lascia_decidere_all_cea9()}</span>
						</p>
					{/if}
				</div>
			{/if}
		{/if}
	{/if}
</section>
