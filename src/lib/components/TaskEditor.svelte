<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { taskStore, type StudioTask, type StudioTaskOptions } from '$lib/stores/tasks.svelte';
	import { modelSettingsStore, STANDARD_ROLES, type ModelDto } from '$lib/stores/modelSettings.svelte';
	import type { AgentSession } from '$lib/agent/session.svelte';
	import type { AvailableCommand, ImageContent } from '$lib/agent/wire';
	import { prepareImage, extractImageFiles, isImageFile } from '$lib/agent/images';
	import {
		STUDIO_SLASH_COMMANDS,
		mergeCommands,
		extractSlashQueryAtCursor,
		shouldOpenSlashPaletteAtCursor,
		insertSlashCommandAtCursor,
		type SlashCursorMatch
	} from '$lib/agent/commands';
	import CommandPalette from '$lib/agent/components/CommandPalette.svelte';
	import ModelPickerDropdown from '$lib/components/models/ModelPickerDropdown.svelte';
	import ReasoningSlider from '$lib/components/models/ReasoningSlider.svelte';

	let {
		task,
		session,
		onClose,
		onRunTask,
		onOpenImage
	}: {
		task: StudioTask;
		session?: AgentSession | null;
		onClose: () => void;
		onRunTask?: (taskId: string) => void;
		onOpenImage?: (data: string, mimeType: string) => void;
	} = $props();

	let prompt = $state('');
	let attachedImages = $state<ImageContent[]>([]);
	let options = $state<StudioTaskOptions>({
		role: 'default',
		thinkingLevel: 'auto',
		includeEditorContext: true
	});

	let lastTaskId = '';
	let deleteArmed = $state(false);
	let deleteTimer: number | null = null;
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let paletteOpen = $state(false);
	let paletteQuery = $state('');
	let currentSlashMatch = $state<SlashCursorMatch | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let isDraggingOver = $state(false);

	const allCommands = $derived(mergeCommands(STUDIO_SLASH_COMMANDS, session?.availableCommands ?? []));
	const title = $derived(prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Nuovo task');

	// Ruoli principali disponibili per la barra di difficolta / preset
	const DIFFICULTY_ROLES = [
		{ id: 'smol', label: 'Leggero / Rapido', badge: '⚡ smol', desc: 'Fix rapidi, compiti semplici e modelli veloci' },
		{ id: 'default', label: 'Standard / Chat', badge: '⌘ default', desc: 'Sviluppo normale e interazione standard' },
		{ id: 'slow', label: 'Deep Reasoning', badge: '∞ slow', desc: 'Ragionamento approfondito e problemi complessi' },
		{ id: 'plan', label: 'Architetturale', badge: '◆ plan', desc: 'Pianificazione e progettazione strutturale' }
	] as const;

	$effect(() => {
		void modelSettingsStore.ensureLoaded();
	});

	// Sincronizza stato e mette il focus immediato al cambio o creazione del task
	$effect(() => {
		if (task.id !== lastTaskId) {
			lastTaskId = task.id;
			prompt = task.prompt;
			attachedImages = task.images ? [...task.images] : [];
			options = task.options
				? { ...task.options }
				: { role: 'default', thinkingLevel: 'auto', includeEditorContext: true };
			deleteArmed = false;
			paletteOpen = false;
			currentSlashMatch = null;
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
		taskStore.updateTask(task.id, prompt, attachedImages, options);
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

	function updateSlashState() {
		if (!textareaEl) return;
		const cursor = textareaEl.selectionStart ?? prompt.length;
		const match = extractSlashQueryAtCursor(prompt, cursor);
		currentSlashMatch = match;
		paletteQuery = match?.query ?? '';
		paletteOpen = shouldOpenSlashPaletteAtCursor(match, allCommands);

		if (match && session && session.availableCommands.length === 0) {
			void loadAvailableCommands().then(() => {
				paletteOpen = shouldOpenSlashPaletteAtCursor(currentSlashMatch, allCommands);
			});
		}
	}

	function handlePromptInput() {
		saveTask();
		updateSlashState();
	}

	function handleCursorMovement() {
		updateSlashState();
	}

	function handlePalettePick(value: string, keepsOpen: boolean) {
		if (!currentSlashMatch) {
			prompt = `/${value} `;
			saveTask();
			paletteOpen = keepsOpen;
			textareaEl?.focus();
			return;
		}

		const res = insertSlashCommandAtCursor(
			prompt,
			currentSlashMatch.startIndex,
			currentSlashMatch.endIndex,
			value
		);
		prompt = res.newText;
		saveTask();
		paletteOpen = keepsOpen;
		currentSlashMatch = null;

		void tick().then(() => {
			if (textareaEl) {
				textareaEl.focus();
				textareaEl.setSelectionRange(res.newCursorPos, res.newCursorPos);
			}
		});
	}

	function selectRole(roleId: string) {
		options.role = roleId;
		if (roleId === 'custom') {
			saveTask();
			return;
		}
		const rolesMap = modelSettingsStore.config?.modelRoles || modelSettingsStore.draftConfig?.modelRoles || {};
		const roleSelector = rolesMap[roleId] || '';
		const rawModel = roleSelector.split(':')[0] || '';
		const roleThinking = roleSelector.includes(':') ? roleSelector.split(':')[1] : 'auto';
		options.modelSelector = rawModel;
		options.thinkingLevel = roleThinking;
		saveTask();
	}

	function handleModelSelect(selector: string) {
		options.modelSelector = selector;
		const rolesMap = modelSettingsStore.config?.modelRoles || modelSettingsStore.draftConfig?.modelRoles || {};
		const currentRole = options.role ?? 'default';
		const expectedSelector = rolesMap[currentRole]?.split(':')[0] || '';
		if (selector !== expectedSelector) {
			options.role = 'custom';
		}
		saveTask();
	}

	function handleThinkingChange(level: string) {
		options.thinkingLevel = level;
		saveTask();
	}

	function togglePlanMode() {
		options.planMode = !options.planMode;
		saveTask();
	}

	function toggleDiscussionMode() {
		options.discussionMode = !options.discussionMode;
		saveTask();
	}

	function toggleMinimalMode() {
		options.minimalMode = !options.minimalMode;
		saveTask();
	}

	function toggleIncludeEditorContext() {
		options.includeEditorContext = !options.includeEditorContext;
		saveTask();
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
		saveTask();
		if (!prompt.trim() && attachedImages.length === 0) {
			taskStore.deleteTask(task.id);
		}
		onClose();
	}

	function runNow() {
		saveTask();
		if (!prompt.trim() && attachedImages.length === 0) return;
		if (onRunTask) {
			onRunTask(task.id);
		} else {
			closeEditor();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (paletteOpen) {
				paletteOpen = false;
				return;
			}
			e.stopPropagation();
			closeEditor();
			return;
		}

		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			runNow();
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
			<span class="task-badge">TASK</span>
			<span class="task-title" title={title}>{title}</span>
		</div>
		<div class="task-actions">
			<span class="save-state" aria-live="polite">Salvato</span>
			<button
				type="button"
				class="action-btn delete-btn"
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
					<span>Elimina</span>
				{/if}
			</button>

			<button
				type="button"
				class="action-btn primary-btn"
				onclick={closeEditor}
				title="Chiudi editor e torna alla vista precedente (Esc)"
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M3.5 8.5l3 3 6-6" />
				</svg>
				<span>Salva e Chiudi</span>
				<kbd>Esc</kbd>
			</button>

			{#if onRunTask}
				<button
					type="button"
					class="action-btn launch-btn"
					onclick={runNow}
					disabled={!prompt.trim() && attachedImages.length === 0}
					title="Avvia subito questo task (Ctrl+Invio)"
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M4 3l9 5-9 5V3z" />
					</svg>
					<span>Avvia ora</span>
					<kbd>Ctrl+↵</kbd>
				</button>
			{/if}
		</div>
	</header>

	<div class="editor-scroll-body">
		<!-- Sezione 1: Prompt & Allegati -->
		<section
			class="prompt-section"
			class:dragging={isDraggingOver}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
			aria-label="Area prompt task"
		>
			<div class="palette-anchor">
				<CommandPalette
					open={paletteOpen}
					commands={allCommands}
					query={paletteQuery}
					onPick={handlePalettePick}
					onClose={() => (paletteOpen = false)}
					onSubmitFallback={() => (paletteOpen = false)}
				/>
			</div>

			<div class="input-card">
				<label for="task-prompt" class="sr-only">Prompt del task</label>
				<textarea
					id="task-prompt"
					bind:this={textareaEl}
					bind:value={prompt}
					oninput={handlePromptInput}
					onclick={handleCursorMovement}
					onkeyup={handleCursorMovement}
					onpaste={handlePaste}
					placeholder="Descrivi cosa deve fare l'agente... digita / ovunque per inserire skill e comandi..."
					spellcheck="true"
				></textarea>

				{#if attachedImages.length > 0}
					<div class="image-previews" role="region" aria-label="Immagini allegate">
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

					<div class="footer-hints">
						<span class="hint-text">Incolla screenshot (Ctrl+V) o digita <code>/</code> per le skill</span>
					</div>
				</div>
			</div>
		</section>

		<!-- Sezione 2: Complessità & Ruolo -->
		<section class="config-section">
			<div class="section-title">
				<div class="title-left">
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
						<path d="M8 2v12M2 8h12" stroke-linecap="round" />
					</svg>
					<h3>Livello di Complessità & Ruolo</h3>
				</div>
				<span class="section-desc">Seleziona il profilo di ragionamento ideale per questa richiesta</span>
			</div>

			<div class="role-selector-grid">
				{#each DIFFICULTY_ROLES as r (r.id)}
					{@const active = options.role === r.id}
					<button
						type="button"
						class="role-card"
						class:active
						onclick={() => selectRole(r.id)}
					>
						<div class="role-card-header">
							<span class="role-badge">{r.badge}</span>
							<span class="role-name">{r.label}</span>
						</div>
						<span class="role-desc">{r.desc}</span>
					</button>
				{/each}
				
				<button
					type="button"
					class="role-card"
					class:active={options.role === 'custom'}
					onclick={() => selectRole('custom')}
				>
					<div class="role-card-header">
						<span class="role-badge">⚙️ custom</span>
						<span class="role-name">Personalizzato</span>
					</div>
					<span class="role-desc">Override manuale modello e thinking sotto</span>
				</button>
			</div>
		</section>

		<!-- Sezione 3: Dettaglio Modello & Thinking -->
		<section class="config-section model-section">
			<div class="section-title">
				<div class="title-left">
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
						<path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5v-7z" />
						<path d="M6 8h4M8 6v4" stroke-linecap="round" />
					</svg>
					<h3>Modello Specifico & Thinking Effort</h3>
				</div>
				<span class="section-desc">Sincronizzati col ruolo scelto sopra o personalizzabili liberamente</span>
			</div>

			<div class="model-controls-row">
				<div class="model-picker-wrap">
					<label for="task-model-picker">Modello</label>
					<ModelPickerDropdown
						catalog={modelSettingsStore.catalog}
						value={options.modelSelector || ''}
						placeholder="Usa modello predefinito del ruolo..."
						onSelect={handleModelSelect}
					/>
				</div>

				<div class="thinking-slider-wrap">
					<ReasoningSlider
						value={options.thinkingLevel || 'auto'}
						onChange={handleThinkingChange}
					/>
				</div>
			</div>
		</section>

		<!-- Sezione 4: Modalità Speciali & Spunte -->
		<section class="config-section modifiers-section">
			<div class="section-title">
				<div class="title-left">
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
						<path d="M3 8.5l3 3 7-7" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<h3>Modalità & Direttive Speciali</h3>
				</div>
				<span class="section-desc">Attiva automatismi e vincoli comportamentali per l'esecuzione del task</span>
			</div>

			<div class="toggles-grid">
				<label class="toggle-card" class:checked={Boolean(options.planMode)}>
					<input
						type="checkbox"
						checked={Boolean(options.planMode)}
						onchange={togglePlanMode}
					/>
					<div class="toggle-content">
						<div class="toggle-header">
							<span class="toggle-title">Modalità Piano (Plan Mode)</span>
							<span class="toggle-tag">Pianificazione</span>
						</div>
						<p class="toggle-desc">
							Non modifica subito i file: formula un piano architetturale dettagliato e richiede approvazione prima dell'esecuzione.
						</p>
					</div>
				</label>

				<label class="toggle-card" class:checked={Boolean(options.discussionMode)}>
					<input
						type="checkbox"
						checked={Boolean(options.discussionMode)}
						onchange={toggleDiscussionMode}
					/>
					<div class="toggle-content">
						<div class="toggle-header">
							<span class="toggle-title">Modalità Discussione & Requisiti</span>
							<span class="toggle-tag">/grill-me</span>
						</div>
						<p class="toggle-desc">
							Analizza il contesto e interroga l'utente con domande approfondite per chiarire ogni decisione prima di toccare il codice.
						</p>
					</div>
				</label>

				<label class="toggle-card" class:checked={Boolean(options.minimalMode)}>
					<input
						type="checkbox"
						checked={Boolean(options.minimalMode)}
						onchange={toggleMinimalMode}
					/>
					<div class="toggle-content">
						<div class="toggle-header">
							<span class="toggle-title">Soluzione Minimale</span>
							<span class="toggle-tag">/ponytail</span>
						</div>
						<p class="toggle-desc">
							Forza la soluzione più semplice, pigra e con meno codice/dipendenze. Rifiuta over-engineering e astrazioni premature.
						</p>
					</div>
				</label>

				<label class="toggle-card" class:checked={options.includeEditorContext !== false}>
					<input
						type="checkbox"
						checked={options.includeEditorContext !== false}
						onchange={toggleIncludeEditorContext}
					/>
					<div class="toggle-content">
						<div class="toggle-header">
							<span class="toggle-title">Includi contesto editor</span>
							<span class="toggle-tag">File aperti</span>
						</div>
						<p class="toggle-desc">
							Allega automaticamente l'elenco dei file correntemente aperti e l'eventuale selezione di testo attiva nell'editor.
						</p>
					</div>
				</label>
			</div>
		</section>

		<!-- Footer azioni rapide -->
		<footer class="editor-bottom-bar">
			<div class="bottom-info">
				<span>I task creati vengono salvati nella coda del progetto.</span>
			</div>
			<div class="bottom-actions">
				<button type="button" class="bottom-btn secondary" onclick={closeEditor}>
					<span>Salva e Chiudi</span>
					<kbd>Esc</kbd>
				</button>
				{#if onRunTask}
					<button
						type="button"
						class="bottom-btn primary"
						onclick={runNow}
						disabled={!prompt.trim() && attachedImages.length === 0}
					>
						<span>Salva e Avvia subito</span>
						<kbd>Ctrl+↵</kbd>
					</button>
				{/if}
			</div>
		</footer>
	</div>
</div>

<style>
	.task-editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--bg-sunken);
		overflow: hidden;
	}

	.task-toolbar {
		height: 42px;
		padding: 0 var(--space-3);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.task-heading,
	.task-actions {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: var(--space-2);
	}

	.task-badge {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 2px 6px;
		border-radius: var(--radius-xs);
		background: var(--brand-dim);
		color: var(--brand-ink);
	}

	.task-title {
		max-width: 36ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.save-state {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin-right: var(--space-1);
	}

	.action-btn {
		height: 28px;
		padding: 0 var(--space-2);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.action-btn kbd {
		font-family: var(--font-mono);
		font-size: 10px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-xs);
		padding: 1px 4px;
		color: var(--ink-faint);
	}

	.action-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.action-btn.delete-btn:hover {
		background: color-mix(in srgb, #e05252 15%, transparent);
		color: #e05252;
		border-color: color-mix(in srgb, #e05252 40%, transparent);
	}

	.action-btn.confirm-delete {
		background: #e05252;
		color: #fff;
		border-color: #e05252;
	}

	.action-btn.primary-btn {
		background: var(--bg-base);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.action-btn.primary-btn:hover {
		background: var(--bg-hover);
		border-color: var(--brand);
	}

	.action-btn.launch-btn {
		background: var(--brand);
		color: #fff;
		border-color: var(--brand);
	}

	.action-btn.launch-btn kbd {
		background: color-mix(in srgb, #fff 20%, transparent);
		border-color: transparent;
		color: #fff;
	}

	.action-btn.launch-btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.action-btn svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.editor-scroll-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.prompt-section {
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.prompt-section.dragging {
		background: color-mix(in srgb, var(--brand) 8%, var(--bg-sunken));
		outline: 2px dashed var(--brand);
		outline-offset: -2px;
		border-radius: var(--radius-md);
	}

	.palette-anchor {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: var(--z-overlay);
		pointer-events: none;
	}

	.palette-anchor :global(.palette-container) {
		pointer-events: auto;
		position: static;
		margin-bottom: var(--space-2);
	}

	.input-card {
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.input-card:focus-within {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
		border-color: transparent;
	}

	.sr-only {
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
		width: 100%;
		min-height: 140px;
		max-height: 320px;
		padding: var(--space-3);
		resize: vertical;
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

	.image-previews {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--line);
		background: var(--bg-sunken);
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
		height: 52px;
		max-width: 110px;
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
		padding: 4px var(--space-2);
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

	.footer-hints {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.hint-text {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.hint-text code {
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-xs);
		color: var(--brand-ink);
	}

	.config-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}

	.section-title {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: var(--space-1);
	}

	.title-left {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ink);
	}

	.title-left h3 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.section-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.role-selector-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-2);
	}

	.role-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}

	.role-card:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.role-card.active {
		background: var(--brand-dim);
		border-color: var(--brand);
		outline: 1px solid var(--brand);
	}

	.role-card-header {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
	}

	.role-badge {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		color: var(--brand-ink);
	}

	.role-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.role-desc {
		font-size: 11px;
		color: var(--ink-faint);
		line-height: 1.3;
	}

	.model-controls-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		align-items: start;
	}

	@media (max-width: 840px) {
		.model-controls-row {
			grid-template-columns: 1fr;
		}
	}

	.model-picker-wrap {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.model-picker-wrap label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
	}

	.thinking-slider-wrap {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.toggles-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-2);
	}

	.toggle-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		cursor: pointer;
		user-select: none;
		transition: all 0.15s ease;
	}

	.toggle-card:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.toggle-card.checked {
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-raised));
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
	}

	.toggle-card input[type="checkbox"] {
		margin-top: 2px;
		accent-color: var(--brand);
		cursor: pointer;
	}

	.toggle-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.toggle-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-1);
	}

	.toggle-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.toggle-tag {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-xs);
		color: var(--ink-faint);
	}

	.toggle-desc {
		margin: 0;
		font-size: 11px;
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.editor-bottom-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		margin-top: var(--space-2);
	}

	.bottom-info {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.bottom-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.bottom-btn {
		height: 30px;
		padding: 0 var(--space-3);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.bottom-btn kbd {
		font-family: var(--font-mono);
		font-size: 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-xs);
		padding: 1px 4px;
	}

	.bottom-btn.secondary {
		border: 1px solid var(--line);
		background: var(--bg-base);
		color: var(--ink);
	}

	.bottom-btn.secondary:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.bottom-btn.primary {
		border: 1px solid var(--brand);
		background: var(--brand);
		color: #fff;
	}

	.bottom-btn.primary kbd {
		background: color-mix(in srgb, #fff 20%, transparent);
		border-color: transparent;
		color: #fff;
	}

	.bottom-btn.primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.bottom-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 900px) {
		.save-state,
		.hint-text,
		.bottom-info {
			display: none;
		}
	}
</style>
