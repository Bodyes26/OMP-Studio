<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { taskStore, type StudioTask } from '$lib/stores/tasks.svelte';
	import type { AgentSession } from '$lib/agent/session.svelte';
	import type { AvailableCommand, ImageContent } from '$lib/agent/wire';
	import { prepareImage, extractImageFiles, isImageFile } from '$lib/agent/images';
	import { STUDIO_SLASH_COMMANDS, mergeCommands } from '$lib/agent/commands';
	import CommandPalette from '$lib/agent/components/CommandPalette.svelte';

	let {
		task,
		session,
		onClose,
		onOpenImage
	}: {
		task: StudioTask;
		session?: AgentSession | null;
		onClose: () => void;
		onOpenImage?: (data: string, mimeType: string) => void;
	} = $props();

	let prompt = $state('');
	let attachedImages = $state<ImageContent[]>([]);
	let lastTaskId = '';
	let deleteArmed = $state(false);
	let deleteTimer: number | null = null;
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let paletteOpen = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let isDraggingOver = $state(false);

	const allCommands = $derived(mergeCommands(STUDIO_SLASH_COMMANDS, session?.availableCommands ?? []));
	const title = $derived(prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Nuovo task');

	// Sincronizza stato e mette il focus immediato al cambio o creazione del task
	$effect(() => {
		if (task.id !== lastTaskId) {
			lastTaskId = task.id;
			prompt = task.prompt;
			attachedImages = task.images ? [...task.images] : [];
			deleteArmed = false;
			paletteOpen = false;
			void tick().then(() => {
				textareaEl?.focus();
				if (textareaEl) {
					textareaEl.selectionStart = textareaEl.value.length;
					textareaEl.selectionEnd = textareaEl.value.length;
				}
			});
		}
	});

	function saveTask() {
		taskStore.updateTask(task.id, prompt, attachedImages);
	}

	function shouldOpenPalette(value: string): boolean {
		if (!value.startsWith('/')) return false;
		const body = value.slice(1);
		const space = body.search(/\s/);
		if (space === -1) return true;
		const token = body.slice(0, space).toLowerCase();
		const command = allCommands.find(
			(candidate: AvailableCommand) =>
				candidate.name.toLowerCase() === token
				|| candidate.aliases?.some((alias: string) => alias.toLowerCase() === token)
		);
		return Boolean(command?.subcommands?.length);
	}

	async function loadAvailableCommands() {
		if (!session || !session.client.isOpen) return;
		try {
			const res = await session.client.send({
				type: 'get_available_commands'
			});
			if (res && typeof res === 'object' && 'commands' in res && Array.isArray((res as { commands: unknown }).commands)) {
				session.availableCommands = (res as { commands: AvailableCommand[] }).commands;
			}
		} catch {
			// Fallback comandi studio
		}
	}

	function handlePromptInput() {
		saveTask();
		paletteOpen = shouldOpenPalette(prompt);
		if (prompt.startsWith('/') && session && session.availableCommands.length === 0) {
			void loadAvailableCommands().then(() => {
				paletteOpen = shouldOpenPalette(prompt);
			});
		}
	}
	function handlePalettePick(value: string, keepsOpen: boolean) {
		prompt = `/${value} `;
		saveTask();
		paletteOpen = keepsOpen;
		textareaEl?.focus();
	}

	async function handleProcessFiles(files: FileList | File[]) {
		let updated = false;
		for (const file of Array.from(files)) {
			if (!isImageFile(file)) continue;
			const res = await prepareImage(file);
			if (!('error' in res)) {
				attachedImages = [...attachedImages, res];
				updated = true;
			}
		}
		if (updated) {
			saveTask();
		}
	}

	function handlePaste(event: ClipboardEvent) {
		const imageFiles = extractImageFiles(event.clipboardData);
		if (imageFiles.length > 0) {
			event.preventDefault();
			void handleProcessFiles(imageFiles);
		}
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
		}
	}

	function removeImage(index: number) {
		attachedImages = attachedImages.filter((_, i) => i !== index);
		saveTask();
	}

	function triggerFileInput() {
		fileInputEl?.click();
	}

	function onFileInputChange(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			void handleProcessFiles(input.files);
			input.value = '';
		}
	}

	function closeEditor() {
		if (!prompt.trim() && attachedImages.length === 0) taskStore.deleteTask(task.id);
		onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (paletteOpen) {
				paletteOpen = false;
				return;
			}
			e.stopPropagation();
			closeEditor();
		}
	}

	function requestDelete() {
		if (deleteArmed) {
			taskStore.deleteTask(task.id);
			onClose();
			return;
		}
		deleteArmed = true;
		if (deleteTimer !== null) window.clearTimeout(deleteTimer);
		deleteTimer = window.setTimeout(() => deleteArmed = false, 4000);
	}

	onDestroy(() => {
		if (deleteTimer !== null) window.clearTimeout(deleteTimer);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="task-editor" onkeydown={handleKeydown}>
	<header class="task-toolbar">
		<div class="task-heading">
			<span class="task-title" title={title}>{title}</span>
		</div>
		<div class="task-actions">
			<span class="save-state" aria-live="polite">Salvato automaticamente</span>
			<button
				type="button"
				class:confirm-delete={deleteArmed}
				onclick={requestDelete}
				aria-label={deleteArmed ? 'Conferma eliminazione task' : 'Elimina task'}
				title={deleteArmed ? 'Clicca ancora per eliminare' : 'Elimina task'}
			>
				{#if deleteArmed}
					Conferma elimina
				{:else}
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3 4.5h10M6 2.5h4l.7 2H5.3l.7-2ZM5 6.5v6M8 6.5v6M11 6.5v6M4.5 4.5l.6 9h5.8l.6-9" />
					</svg>
				{/if}
			</button>
			<button type="button" onclick={closeEditor} aria-label="Chiudi editor task" title="Chiudi">
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M4 4l8 8M12 4l-8 8" />
				</svg>
			</button>
		</div>
	</header>

	<div
		class="prompt-area"
		class:dragging={isDraggingOver}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		role="region"
		aria-label="Area prompt task"
	>
		<div class="palette-anchor">
			<CommandPalette
				open={paletteOpen}
				commands={allCommands}
				query={prompt}
				onPick={handlePalettePick}
				onClose={() => (paletteOpen = false)}
				onSubmitFallback={() => (paletteOpen = false)}
			/>
		</div>

		{#if attachedImages.length > 0}
			<div class="image-previews" role="region" aria-label="Immagini allegate al task">
				{#each attachedImages as img, idx (idx)}
					<div class="image-thumb-wrap">
						<button
							type="button"
							class="image-thumb-btn"
							onclick={() => onOpenImage?.(img.data, img.mimeType)}
							title="Ingrandisci immagine"
						>
							<img
								src="data:{img.mimeType};base64,{img.data}"
								alt="Allegato task {idx + 1}"
								class="image-thumb"
							/>
						</button>
						<button
							type="button"
							class="image-remove-btn"
							title="Rimuovi immagine"
							onclick={() => removeImage(idx)}
							aria-label="Rimuovi immagine"
						>
							&times;
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="input-container">
			<label for="task-prompt">Prompt del task</label>
			<textarea
				id="task-prompt"
				bind:this={textareaEl}
				bind:value={prompt}
				oninput={handlePromptInput}
				onpaste={handlePaste}
				placeholder="Scrivi il prossimo prompt, incolla screenshot, digita / per i comandi..."
				spellcheck="true"
			></textarea>

			<div class="input-footer">
				<input
					type="file"
					accept="image/*"
					multiple
					bind:this={fileInputEl}
					onchange={onFileInputChange}
					style="display: none;"
				/>
				<button
					type="button"
					class="attach-btn"
					onclick={triggerFileInput}
					title="Allega screenshot o immagine"
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M6 3.5a2.5 2.5 0 0 1 5 0v7a4 4 0 0 1-8 0V4.5a1 1 0 0 1 2 0v6a2 2 0 0 0 4 0v-7a1 1 0 0 0-2 0v6" />
					</svg>
					<span>Allega immagine</span>
				</button>
				<span class="input-hint">Incolla screenshot (Ctrl+V) o digita / per autocompletare i comandi</span>
			</div>
		</div>
	</div>
</div>

<style>
	.task-editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--bg-sunken);
	}

	.task-toolbar {
		height: 36px;
		padding: 0 var(--space-2) 0 var(--space-3);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		background: var(--bg-raised);
	}

	.task-heading,
	.task-actions {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.task-heading {
		gap: var(--space-2);
	}

	.task-actions {
		gap: var(--space-1);
	}

	.task-title {
		max-width: 42ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.save-state {
		margin-right: var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.task-actions button {
		height: 26px;
		min-width: 26px;
		padding: 0 var(--space-2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.task-actions button:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.task-actions button:active {
		background: var(--bg-active);
	}

	.task-actions button.confirm-delete {
		background: var(--brand-dim);
		color: var(--ink);
	}

	.task-actions svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.prompt-area {
		position: relative;
		flex: 1;
		min-height: 0;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.prompt-area.dragging {
		background: color-mix(in srgb, var(--brand) 8%, var(--bg-sunken));
		outline: 2px dashed var(--brand);
		outline-offset: -4px;
	}

	.palette-anchor {
		position: absolute;
		top: var(--space-3);
		left: var(--space-3);
		right: var(--space-3);
		z-index: var(--z-overlay);
		pointer-events: none;
	}

	.palette-anchor :global(.palette-container) {
		pointer-events: auto;
		position: static;
		margin-bottom: var(--space-2);
	}

	.image-previews {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: var(--space-1) 0;
		flex-shrink: 0;
	}

	.image-thumb-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.image-thumb-btn {
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.image-thumb {
		height: 56px;
		max-width: 120px;
		object-fit: cover;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		transition: opacity 0.15s;
	}

	.image-thumb-btn:hover .image-thumb {
		opacity: 0.85;
	}

	.image-remove-btn {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		color: var(--ink-faint);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		padding: 0;
	}

	.image-remove-btn:hover {
		background: var(--brand-dim);
		color: var(--ink);
	}

	.input-container {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.input-container:focus-within {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
		border-color: transparent;
	}

	.input-container label {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	textarea {
		flex: 1;
		width: 100%;
		min-height: 0;
		padding: var(--space-3);
		resize: none;
		border: none;
		background: transparent;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-base);
		line-height: 1.55;
		caret-color: var(--brand-ink);
		outline: none;
	}

	textarea::placeholder {
		color: var(--ink-faint);
	}

	.input-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
	}

	.attach-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 3px var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: all 0.15s;
	}

	.attach-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.attach-btn svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.input-hint {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (max-width: 900px) {
		.save-state,
		.input-hint {
			display: none;
		}
	}
</style>
