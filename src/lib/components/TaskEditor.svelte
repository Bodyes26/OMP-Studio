<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { taskStore, type StudioTask, type StudioTaskStatus, type StudioTaskOptions } from '$lib/stores/tasks.svelte';
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
	let advancedOpen = $state(false);

	const allCommands = $derived(mergeCommands(STUDIO_SLASH_COMMANDS, session?.availableCommands ?? []));
	const title = $derived(prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Nuovo task');

	// Ruoli principali disponibili per la barra di selezione rapida
	const DIFFICULTY_ROLES = [
		{ id: 'smol', label: 'Rapido', badge: '⚡ smol', desc: 'Fix rapidi, compiti semplici e modelli veloci' },
		{ id: 'default', label: 'Standard', badge: '⌘ default', desc: 'Sviluppo normale e interazione standard' },
		{ id: 'slow', label: 'Deep Reasoning', badge: '∞ slow', desc: 'Ragionamento approfondito e problemi complessi' },
		{ id: 'plan', label: 'Architettura', badge: '◆ plan', desc: 'Pianificazione e progettazione strutturale' }
	] as const;

	const currentRoleDisplay = $derived.by(() => {
		if (options.role === 'custom') return { badge: 'custom', label: 'Personalizzato' };
		const found = DIFFICULTY_ROLES.find((r) => r.id === options.role);
		return found ? { badge: found.badge, label: found.label } : { badge: options.role || 'default', label: options.role || 'Default' };
	});

	const activeModifiersCount = $derived(
		(options.planMode ? 1 : 0) +
		(options.discussionMode ? 1 : 0) +
		(options.minimalMode ? 1 : 0) +
		(options.researchMode ? 1 : 0) +
		(options.includeEditorContext === false ? 1 : 0)
	);

	$effect(() => {
		void modelSettingsStore.ensureLoaded();
	});

	// Auto-dimensionamento della textarea prompt (140px - 460px)
	function adjustTextareaHeight() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		const scrollH = textareaEl.scrollHeight;
		const minH = 140;
		const maxH = 460;
		const targetH = Math.max(minH, Math.min(scrollH, maxH));
		textareaEl.style.height = `${targetH}px`;
		textareaEl.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
	}

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

			// Apri automaticamente opzioni avanzate se il task usa configurazioni non predefinite
			advancedOpen = Boolean(
				(task.options?.role && task.options.role !== 'default') ||
				task.options?.planMode ||
				task.options?.discussionMode ||
				task.options?.minimalMode ||
				task.options?.researchMode ||
				task.options?.modelSelector ||
				(task.options?.thinkingLevel && task.options.thinkingLevel !== 'auto')
			);

			void tick().then(() => {
				adjustTextareaHeight();
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
		adjustTextareaHeight();
		updateSlashState();
	}

	function handleCursorMovement() {
		updateSlashState();
	}

	function handlePalettePick(value: string, keepsOpen: boolean) {
		if (!currentSlashMatch) {
			prompt = `/${value} `;
			saveTask();
			adjustTextareaHeight();
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
		adjustTextareaHeight();
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

	function toggleResearchMode() {
		options.researchMode = !options.researchMode;
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
			e.preventDefault();
			e.stopPropagation();
			closeEditor();
			return;
		}

		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			closeEditor();
			return;
		}
	}

	function cycleStatus() {
		const next: Record<StudioTaskStatus, StudioTaskStatus> = {
			queued: 'in_progress',
			in_progress: 'completed',
			completed: 'queued',
			abandoned: 'queued',
			dispatching: 'queued'
		};
		task.status = next[task.status] || 'queued';
		task.updatedAt = Date.now();
		taskStore.updateTask(task.id, prompt, attachedImages, options);
	}

	function requestDelete() {
		if (deleteArmed) {
			taskStore.deleteTask(task.id);
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

<svelte:window onkeydown={handleKeydown} />

<div class="task-editor" role="region" aria-label="Editor del task">
	<header class="task-toolbar">
		<div class="task-heading">
			<span class="task-badge">TASK</span>
			<button
				type="button"
				class="status-toggle-btn {task.status}"
				onclick={cycleStatus}
				title="Clicca per cambiare lo stato del task"
			>
				{#if task.status === 'in_progress'}
					● In corso
				{:else if task.status === 'completed'}
					✓ Fatto
				{:else if task.status === 'abandoned'}
					✕ Abbandonato
				{:else}
					○ In coda
				{/if}
			</button>
			<span class="task-title" title={title}>{title}</span>
			<span class="save-state" aria-live="polite">Salvato</span>
		</div>

		<div class="task-actions">
			<!-- Distruttivo: Elimina -->
			<button
				type="button"
				class="action-btn btn-danger"
				class:confirm-delete={deleteArmed}
				onclick={requestDelete}
				aria-label={deleteArmed ? 'Conferma eliminazione task' : 'Elimina task'}
				title={deleteArmed ? 'Clicca ancora per eliminare definitivamente' : 'Elimina questo task'}
			>
				{#if deleteArmed}
					<span>Conferma elimina</span>
				{:else}
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3 4.5h10M6 2.5h4l.7 2H5.3l.7-2ZM5 6.5v6M8 6.5v6M11 6.5v6M4.5 4.5l.6 9h5.8l.6-9" />
					</svg>
					<span>Elimina</span>
				{/if}
			</button>

			<!-- Secondario: Esegui / Avvia subito -->
			{#if onRunTask}
				<button
					type="button"
					class="action-btn btn-secondary"
					onclick={runNow}
					disabled={!prompt.trim() && attachedImages.length === 0}
					aria-label="Esegui subito questo task"
					title="Esegui subito questo task"
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M4 3.5l9 4.5-9 4.5V3.5z" />
					</svg>
					<span>Esegui</span>
				</button>
			{/if}

			<!-- Primario: Salva (Ctrl+Invio) -->
			<button
				type="button"
				class="action-btn btn-primary"
				onclick={closeEditor}
				aria-label="Salva e chiudi editor task (Ctrl+Invio)"
				title="Salva modifiche e chiudi editor (Ctrl+Invio)"
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M3.5 8.5l3 3 6-6" />
				</svg>
				<span>Salva</span>
				<kbd>Ctrl+↵</kbd>
			</button>

			<div class="actions-divider" aria-hidden="true"></div>

			<!-- Chiudi (Esc) -->
			<button
				type="button"
				class="action-btn btn-close"
				onclick={closeEditor}
				aria-label="Chiudi editor (Esc)"
				title="Chiudi editor (Esc)"
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M4 4l8 8M12 4L4 12" />
				</svg>
			</button>
		</div>
	</header>

	<div class="editor-scroll-body">
		<!-- Sezione 1: Prompt & Allegati (Hero / Centro) -->
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
					onkeydown={(e) => {
						if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
							e.preventDefault();
							e.stopPropagation();
							closeEditor();
						}
					}}
					onpaste={handlePaste}
					placeholder="Descrivi cosa deve fare l'agente... digita / per inserire skill e comandi..."
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
						aria-label="Allega screenshot o immagine al task"
						title="Allega screenshot o immagine"
					>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M6 3.5a2.5 2.5 0 0 1 5 0v7a4 4 0 0 1-8 0V4.5a1 1 0 0 1 2 0v6a2 2 0 0 0 4 0v-7a1 1 0 0 0-2 0v6" />
						</svg>
						<span>Allega immagine</span>
					</button>

					<div class="footer-hints">
						<span class="hint-text"><kbd>Ctrl+V</kbd> incolla screenshot · digita <code>/</code> per le skill</span>
					</div>
				</div>
			</div>
		</section>

		<!-- Sezione 2: Opzioni Avanzate (Collassabile e compatta) -->
		<section class="advanced-section" aria-label="Opzioni avanzate del task">
			<button
				type="button"
				class="advanced-toggle-btn"
				onclick={() => (advancedOpen = !advancedOpen)}
				aria-expanded={advancedOpen}
				aria-controls="advanced-controls-panel"
			>
				<div class="advanced-toggle-left">
					<svg
						class="chevron-icon"
						class:rotated={advancedOpen}
						viewBox="0 0 16 16"
						aria-hidden="true"
					>
						<path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<span class="advanced-title">Opzioni avanzate</span>
					<div class="advanced-summary">
						<span class="summary-chip">{currentRoleDisplay.badge}</span>
						{#if options.thinkingLevel && options.thinkingLevel !== 'auto'}
							<span class="summary-chip">thinking: {options.thinkingLevel}</span>
						{/if}
						{#if activeModifiersCount > 0}
							<span class="summary-chip active-count">{activeModifiersCount} {activeModifiersCount === 1 ? 'modalità attiva' : 'modalità attive'}</span>
						{/if}
					</div>
				</div>
				<span class="advanced-toggle-hint">{advancedOpen ? 'Comprimi' : 'Espandi'}</span>
			</button>

			{#if advancedOpen}
				<div id="advanced-controls-panel" class="advanced-panel-content">
					<!-- Ruolo / Livello complessità -->
					<div class="config-block">
						<div class="block-header">
							<span class="block-label">Ruolo & Complessità</span>
							<span class="block-sub">Profilo di ragionamento e modello associato</span>
						</div>
						<div class="role-pills-row" role="radiogroup" aria-label="Ruolo e complessità">
							{#each DIFFICULTY_ROLES as r (r.id)}
								{@const active = options.role === r.id}
								<button
									type="button"
									class="role-pill-btn"
									class:active
									role="radio"
									aria-checked={active}
									aria-label={`Ruolo: ${r.label}. ${r.desc}`}
									title={r.desc}
									onclick={() => selectRole(r.id)}
								>
									<span class="role-pill-badge">{r.badge}</span>
									<span class="role-pill-label">{r.label}</span>
								</button>
							{/each}

							<button
								type="button"
								class="role-pill-btn"
								class:active={options.role === 'custom'}
								role="radio"
								aria-checked={options.role === 'custom'}
								aria-label="Ruolo: Personalizzato. Modello e thinking specifici"
								title="Personalizza manualmente modello e livello di thinking"
								onclick={() => selectRole('custom')}
							>
								<span class="role-pill-badge">custom</span>
								<span class="role-pill-label">Personalizzato</span>
							</button>
						</div>
					</div>

					<!-- Modello e Thinking Effort -->
					<div class="config-block">
						<div class="model-thinking-grid">
							<div class="model-col">
								<label for="task-model-picker" class="block-label">Modello specifico</label>
								<ModelPickerDropdown
									catalog={modelSettingsStore.catalog}
									value={options.modelSelector || ''}
									placeholder="Usa modello predefinito del ruolo..."
									onSelect={handleModelSelect}
								/>
							</div>

							<div class="thinking-col">
								<div class="block-label">Thinking effort</div>
								<ReasoningSlider
									value={options.thinkingLevel || 'auto'}
									onChange={handleThinkingChange}
								/>
							</div>
						</div>
					</div>

					<!-- Modalità e Direttive Speciali -->
					<div class="config-block">
						<div class="block-header">
							<span class="block-label">Modalità & Direttive Speciali</span>
							<span class="block-sub">Vincoli operativi e automatismi durante l'esecuzione del task</span>
						</div>
						<div class="modifiers-grid">
							<label class="modifier-card" class:checked={Boolean(options.planMode)}>
								<input
									type="checkbox"
									checked={Boolean(options.planMode)}
									onchange={togglePlanMode}
								/>
								<div class="modifier-body">
									<div class="modifier-top">
										<span class="modifier-title">Modalità Piano (Plan Mode)</span>
										<span class="modifier-tag">/plan</span>
									</div>
									<p class="modifier-desc">
										Formula un piano architetturale ed attende approvazione prima di modificare file.
									</p>
								</div>
							</label>

							<label class="modifier-card" class:checked={Boolean(options.discussionMode)}>
								<input
									type="checkbox"
									checked={Boolean(options.discussionMode)}
									onchange={toggleDiscussionMode}
								/>
								<div class="modifier-body">
									<div class="modifier-top">
										<span class="modifier-title">Discussione & Requisiti</span>
										<span class="modifier-tag">/grill-me</span>
									</div>
									<p class="modifier-desc">
										Pone domande approfondite per chiarire ogni decisione prima di toccare il codice.
									</p>
								</div>
							</label>

							<label class="modifier-card" class:checked={Boolean(options.minimalMode)}>
								<input
									type="checkbox"
									checked={Boolean(options.minimalMode)}
									onchange={toggleMinimalMode}
								/>
								<div class="modifier-body">
									<div class="modifier-top">
										<span class="modifier-title">Soluzione Minimale</span>
										<span class="modifier-tag">/ponytail</span>
									</div>
									<p class="modifier-desc">
										Forza la soluzione più semplice, pigra e senza dipendenze o astrazioni superflue.
									</p>
								</div>
							</label>

							<label class="modifier-card" class:checked={Boolean(options.researchMode)}>
								<input
									type="checkbox"
									checked={Boolean(options.researchMode)}
									onchange={toggleResearchMode}
								/>
								<div class="modifier-body">
									<div class="modifier-top">
										<span class="modifier-title">Ricerca Web Online</span>
										<span class="modifier-tag">Web</span>
									</div>
									<p class="modifier-desc">
										Esegue ricerche online mirate sull'ambito della richiesta prima di procedere.
									</p>
								</div>
							</label>

							<label class="modifier-card" class:checked={options.includeEditorContext !== false}>
								<input
									type="checkbox"
									checked={options.includeEditorContext !== false}
									onchange={toggleIncludeEditorContext}
								/>
								<div class="modifier-body">
									<div class="modifier-top">
										<span class="modifier-title">Contesto Editor</span>
										<span class="modifier-tag">File aperti</span>
									</div>
									<p class="modifier-desc">
										Allega l'elenco dei file correntemente aperti e la selezione attiva nell'editor.
									</p>
								</div>
							</label>
						</div>
					</div>
				</div>
			{/if}
		</section>
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
		font-family: var(--font-ui);
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
		z-index: 2;
	}

	.task-heading,
	.task-actions {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: var(--space-2);
	}

	.task-badge {
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--brand-dim);
		color: var(--ink);
	}
	.status-toggle-btn {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-faint);
		cursor: pointer;
		transition: all 120ms ease;
	}

	.status-toggle-btn:hover {
		border-color: var(--brand);
		color: var(--ink);
	}

	.status-toggle-btn.in_progress {
		background: var(--brand-dim);
		color: var(--brand-ink);
		font-weight: 600;
		border-color: var(--brand);
	}

	.status-toggle-btn.completed {
		background: var(--bg-sunken);
		color: var(--success, #22c55e);
		border-color: var(--success, #22c55e);
	}

	.status-toggle-btn.abandoned {
		background: var(--bg-sunken);
		color: var(--ink-faint);
		opacity: 0.7;
	}

	.task-title {
		max-width: 28ch;
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
		margin-left: var(--space-1);
	}

	.action-btn {
		height: 28px;
		padding: 0 var(--space-2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		cursor: pointer;
		user-select: none;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.action-btn kbd {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
	}

	.action-btn svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		flex-shrink: 0;
	}

	/* 1. Primario: Salva (Ctrl+Invio) */
	.action-btn.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
		border: 1px solid var(--brand);
		font-weight: 600;
	}

	.action-btn.btn-primary kbd {
		background: color-mix(in srgb, var(--on-brand) 20%, transparent);
		border: 1px solid transparent;
		color: var(--on-brand);
	}

	.action-btn.btn-primary:hover:not(:disabled) {
		background: var(--brand-ink);
		border-color: var(--brand-ink);
	}

	/* 2. Secondario: Esegui */
	.action-btn.btn-secondary {
		background: var(--bg-base);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		font-weight: 500;
	}

	.action-btn.btn-secondary:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--brand);
	}

	.action-btn.btn-secondary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		border-color: var(--line);
	}

	/* 3. Distruttivo: Elimina */
	.action-btn.btn-danger {
		background: transparent;
		color: var(--ink-faint);
		border: 1px solid transparent;
	}

	.action-btn.btn-danger:hover {
		background: var(--danger-dim);
		color: var(--ink);
		border-color: var(--danger);
	}

	.action-btn.btn-danger.confirm-delete {
		background: var(--danger);
		color: var(--on-danger);
		border-color: var(--danger);
		font-weight: 600;
	}

	/* 4. Ausiliario: Chiudi */
	.action-btn.btn-close {
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		color: var(--ink-faint);
		border: 1px solid transparent;
	}

	.action-btn.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.actions-divider {
		width: 1px;
		height: 16px;
		background: var(--line);
		margin: 0 2px;
	}

	.editor-scroll-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: 100%;
		max-width: 900px;
		margin: 0 auto;
		box-sizing: border-box;
	}

	/* Prompt Section */
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
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.input-card:focus-within {
		border-color: var(--line-strong);
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
		max-height: 460px;
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
		box-sizing: border-box;
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
		height: 48px;
		max-width: 100px;
		object-fit: cover;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		transition: opacity var(--dur-fast) var(--ease-out);
	}

	.image-thumb-btn:hover .image-thumb {
		opacity: 0.85;
	}

	.image-remove-btn {
		position: absolute;
		top: -5px;
		right: -5px;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		color: var(--ink-faint);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--text-xs);
		line-height: 1;
		cursor: pointer;
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
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.attach-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.attach-btn svg {
		width: 13px;
		height: 13px;
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

	.hint-text kbd,
	.hint-text code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
	}

	/* Advanced Section (Collapsible) */
	.advanced-section {
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.advanced-toggle-btn {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--bg-raised);
		border: none;
		color: var(--ink);
		cursor: pointer;
		font-family: var(--font-ui);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.advanced-toggle-btn:hover {
		background: var(--bg-hover);
	}

	.advanced-toggle-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		flex-wrap: wrap;
	}

	.chevron-icon {
		width: 14px;
		height: 14px;
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease-out);
		flex-shrink: 0;
	}

	.chevron-icon.rotated {
		transform: rotate(90deg);
	}

	.advanced-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.advanced-summary {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.summary-chip {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-muted);
		line-height: 1.3;
	}

	.summary-chip.active-count {
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
		background: color-mix(in srgb, var(--brand) 8%, var(--bg-sunken));
	}

	.advanced-toggle-hint {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.advanced-panel-content {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		border-top: 1px solid var(--line);
	}

	.config-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-header {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.block-label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.block-sub {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	/* Role Pills */
	.role-pills-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.role-pill-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.role-pill-btn:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.role-pill-btn.active {
		background: var(--brand-dim);
		border-color: var(--brand);
		color: var(--ink);
		font-weight: 600;
	}

	.role-pill-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--brand-ink);
	}

	.role-pill-btn.active .role-pill-badge {
		color: var(--ink);
	}

	.role-pill-label {
		font-size: var(--text-xs);
	}

	/* Model & Thinking Grid */
	.model-thinking-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		align-items: start;
	}

	@media (max-width: 720px) {
		.model-thinking-grid {
			grid-template-columns: 1fr;
		}
	}

	.model-col,
	.thinking-col {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	/* Modifiers Grid */
	.modifiers-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-2);
	}

	.modifier-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		cursor: pointer;
		user-select: none;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.modifier-card:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.modifier-card.checked {
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-raised));
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
	}

	.modifier-card input[type="checkbox"] {
		margin-top: 2px;
		accent-color: var(--brand);
		cursor: pointer;
	}

	.modifier-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.modifier-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-1);
	}

	.modifier-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.modifier-tag {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
	}

	.modifier-desc {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.35;
	}

	@media (max-width: 800px) {
		.save-state,
		.hint-text,
		.advanced-toggle-hint {
			display: none;
		}
	}
</style>