<script lang="ts">
	import { tick } from 'svelte';
	// Superficie di inserimento comandi e prompt per l'agente.
	//
	// Gestisce l'auto-dimensionamento della textarea (fino a ~12 righe),
	// la cattura e preparazione di immagini via paste/drop, l'interruttore
	// di comportamento streaming (steer / follow-up), i chip di stato cliccabili
	// (modello, thinking, gauge contesto, costo) e la palette dei comandi slash.
	import type { AgentSession } from '../session.svelte';
	import {
		type AvailableCommand,
		type ImageContent,
		type InterruptMode,
		type ModelInfo,
		type QueueMode,
		type ThinkingLevel
	} from '../wire';
	import { asRecord } from '../tools/types';
	import { prepareImage, extractImageFiles, isImageFile } from '../images';
	import QueueChips from './QueueChips.svelte';
import CommandPalette from './CommandPalette.svelte';
import ShortcutsHelpModal from './ShortcutsHelpModal.svelte';
import {
	STUDIO_SLASH_COMMANDS,
	mergeCommands,
	extractSlashQueryAtCursor,
	shouldOpenSlashPaletteAtCursor,
	insertSlashCommandAtCursor,
	type SlashCursorMatch
} from '../commands';
import { modelSettingsStore, STANDARD_ROLES, type ModelDto } from '$lib/stores/modelSettings.svelte';
import { IconClose, IconCheck, IconSettings, IconKeyboard } from '$lib/icons';
import { getCaretCoordinates } from './caretCoordinates';
	let {
		session,
		visible = true,
		onSlashCommand
	} = $props<{
		session: AgentSession;
		visible?: boolean;
		onSlashCommand: (raw: string) => boolean;
	}>();
	let text = $state('');
	let attachedImages = $state<ImageContent[]>([]);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let paletteOpen = $state(false);
	let paletteQuery = $state('');
	let currentSlashMatch = $state<SlashCursorMatch | null>(null);
	let shortcutsHelpOpen = $state(false);

	// Stato per smooth cursor (cursore fluido animato sulla textarea di chat)
	let cursorX = $state(0);
	let cursorY = $state(0);
	let cursorHeight = $state(18);
	let isCursorFocused = $state(false);
	let isCursorBlinking = $state(false);
	let hasTextSelection = $state(false);
	let cursorInstantSnap = $state(false);
	let blinkTimer: number | null = null;

// Menu a comparsa per i chip di stato
let activeMenu = $state<'role' | 'model' | 'thinking' | 'queue' | null>(null);
let availableModels = $state<ModelInfo[]>([]);
let loadingModels = $state(false);

// Ricerca e navigazione da tastiera per i menu
let modelFilterQuery = $state('');
let roleFilterQuery = $state('');
let highlightedRoleIndex = $state(0);
let highlightedModelIndex = $state(0);
let highlightedThinkingIndex = $state(0);
let roleListEl = $state<HTMLElement | null>(null);
let roleSearchInputEl = $state<HTMLInputElement | null>(null);
let modelListEl = $state<HTMLElement | null>(null);
let modelSearchInputEl = $state<HTMLInputElement | null>(null);
	let steeringMode = $state<QueueMode>('one-at-a-time');
	let followUpMode = $state<QueueMode>('one-at-a-time');
	let interruptMode = $state<InterruptMode>('immediate');

	const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

	const allCommands = $derived(mergeCommands(STUDIO_SLASH_COMMANDS, session.availableCommands));
	const filteredModels = $derived.by(() => {
		const q = modelFilterQuery.trim().toLowerCase();
		if (!q) return availableModels;
		return availableModels.filter(
			(m) =>
				(m.name && m.name.toLowerCase().includes(q))
				|| (m.id && m.id.toLowerCase().includes(q))
				|| (m.provider && m.provider.toLowerCase().includes(q))
		);
});

const configuredRolesList = $derived.by(() => {
	const rolesMap = modelSettingsStore.config?.modelRoles || modelSettingsStore.draftConfig?.modelRoles || {};
	const cycleOrder = modelSettingsStore.config?.cycleOrder || modelSettingsStore.draftConfig?.cycleOrder || [];
	const q = roleFilterQuery.trim().toLowerCase();

	return STANDARD_ROLES.map((r) => {
		const selector = rolesMap[r.id] || '';
		const rawSelector = selector.split(':')[0] || '';
		const thinking = selector.includes(':') ? selector.split(':')[1] : 'auto';
		const modelDto = modelSettingsStore.catalog.find((m) => m.selector === rawSelector || m.id === rawSelector);
		return {
			...r,
			selector,
			rawSelector,
			thinking,
			modelName: modelDto?.name || rawSelector.split('/')[1] || rawSelector,
			provider: modelDto?.provider || rawSelector.split('/')[0] || '',
			isConfigured: Boolean(rawSelector)
		};
	}).filter((item) => {
		if (!q) return true;
		return item.label.toLowerCase().includes(q)
			|| item.id.toLowerCase().includes(q)
			|| item.desc.toLowerCase().includes(q)
			|| item.modelName.toLowerCase().includes(q)
			|| item.provider.toLowerCase().includes(q);
	});
});

const activeRoleInfo = $derived.by(() => {
	if (!session.model?.id) return null;
	const rolesMap = modelSettingsStore.config?.modelRoles || modelSettingsStore.draftConfig?.modelRoles || {};
	const curId = session.model.id;
	const curProvider = session.model.provider || '';

	for (const r of STANDARD_ROLES) {
		const full = rolesMap[r.id];
		if (!full) continue;
		const raw = full.split(':')[0];
		if (raw === curId || raw === `${curProvider}/${curId}` || raw.endsWith(`/${curId}`)) {
			return r;
		}
	}
	return null;
});

$effect(() => {
	void modelSettingsStore.ensureLoaded();
});

$effect(() => {
	if (activeMenu !== 'role' || !roleListEl || configuredRolesList.length === 0) return;
	const item = roleListEl.children[highlightedRoleIndex] as HTMLElement | undefined;
	item?.scrollIntoView({ block: 'nearest' });
});

$effect(() => {
	if (activeMenu !== 'model' || !modelListEl || filteredModels.length === 0) return;
	const item = modelListEl.children[highlightedModelIndex] as HTMLElement | undefined;
	item?.scrollIntoView({ block: 'nearest' });
});
	function updateSlashState() {
		if (!textareaEl) return;
		const cursor = textareaEl.selectionStart ?? text.length;
		const match = extractSlashQueryAtCursor(text, cursor);
		currentSlashMatch = match;
		paletteQuery = match?.query ?? '';
		paletteOpen = shouldOpenSlashPaletteAtCursor(match, allCommands);

		if (match && session.availableCommands.length === 0) {
			void loadAvailableCommands().then(() => {
				if (visible) {
					paletteOpen = shouldOpenSlashPaletteAtCursor(currentSlashMatch, allCommands);
				}
			});
		}
	}
	function updateSmoothCursor(instant = false) {
		if (!textareaEl) return;
		const isFocused = typeof document !== 'undefined' && document.activeElement === textareaEl;
		isCursorFocused = isFocused;
		if (!isFocused) return;

		const start = textareaEl.selectionStart ?? 0;
		const end = textareaEl.selectionEnd ?? 0;
		hasTextSelection = start !== end;
		if (hasTextSelection) return;

		const coords = getCaretCoordinates(textareaEl, start);
		cursorX = coords.left;
		cursorY = coords.top;
		cursorHeight = coords.height;

		if (instant) {
			cursorInstantSnap = true;
			void tick().then(() => {
				cursorInstantSnap = false;
			});
		}

		// Resetta il timer di lampeggio/respiro morbido a riposo (500ms di inattività)
		isCursorBlinking = false;
		if (blinkTimer !== null) {
			window.clearTimeout(blinkTimer);
		}
		blinkTimer = window.setTimeout(() => {
			isCursorBlinking = true;
		}, 500);
	}

	$effect(() => {
		if (typeof document === 'undefined') return;
		function handleSelectionChange() {
			if (document.activeElement === textareaEl) {
				updateSmoothCursor();
			}
		}
		document.addEventListener('selectionchange', handleSelectionChange);
		return () => {
			document.removeEventListener('selectionchange', handleSelectionChange);
		};
	});

	$effect(() => {
		if (!textareaEl || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => {
			if (isCursorFocused) {
				updateSmoothCursor();
			}
		});
		ro.observe(textareaEl);
		return () => {
			ro.disconnect();
		};
	});

	$effect(() => {
		// Reattività su cambi di testo esterni (es. invio prompt, slash autocomplete)
		const _ = text;
		if (isCursorFocused) {
			void tick().then(() => updateSmoothCursor());
		}
	});

	function handleComposerInput() {
		adjustTextareaHeight();
		updateSlashState();
		updateSmoothCursor();
	}

	function handleCursorMovement() {
		updateSlashState();
		updateSmoothCursor();
	}
	// Auto-dimensionamento della textarea fino a circa 12 righe (~240px)
	function adjustTextareaHeight() {
		if (!textareaEl) return;
		if (!text) {
			textareaEl.style.height = '';
			textareaEl.style.overflowY = 'hidden';
			return;
		}
		textareaEl.style.height = 'auto';
		const scrollH = textareaEl.scrollHeight;
		const maxH = 240;
		textareaEl.style.height = `${Math.min(scrollH, maxH)}px`;
		textareaEl.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
	}

	async function loadAvailableCommands() {
		try {
			const res = await session.client.send({
				type: 'get_available_commands'
			});
			const rec = asRecord(res);
			if (rec && Array.isArray(rec.commands)) {
				session.availableCommands = rec.commands as AvailableCommand[];
			}
		} catch {
			// I comandi disponibili restano quelli gia' noti
		}
	}

	async function loadAvailableModels() {
		if (loadingModels) return;
		loadingModels = true;
		try {
			const res = await session.client.send({
				type: 'get_available_models'
			});
			if (Array.isArray(res)) {
				availableModels = res as ModelInfo[];
			} else {
				const rec = asRecord(res);
				if (rec && Array.isArray(rec.models)) {
					availableModels = rec.models as ModelInfo[];
				}
			}
		} catch (err) {
			session.pushNotice('warning', `Impossibile recuperare i modelli disponibili: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			loadingModels = false;
		}
	}

	async function loadQueueSettings() {
		try {
			const res = await session.client.send({ type: 'get_state' });
			const state = asRecord(res);
			if (state) {
				if (state.steeringMode === 'all' || state.steeringMode === 'one-at-a-time') {
					steeringMode = state.steeringMode;
				}
				if (state.followUpMode === 'all' || state.followUpMode === 'one-at-a-time') {
					followUpMode = state.followUpMode;
				}
				if (state.interruptMode === 'immediate' || state.interruptMode === 'wait') {
					interruptMode = state.interruptMode;
				}
			}
		} catch {
			// Mantiene i valori attuali
		}
	}

	async function handleModelSelect(model: ModelInfo) {
		activeMenu = null;
		if (!model.provider || !model.id) return;
		try {
			await session.client.send({
				type: 'set_model',
				provider: model.provider,
				modelId: model.id
			});
			await session.refreshState();
		} catch (err) {
			session.pushNotice('warning', `Errore selezione modello: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function handleRoleSelect(roleId: string) {
		activeMenu = null;
		await modelSettingsStore.ensureLoaded();
		const rolesMap = modelSettingsStore.config?.modelRoles || modelSettingsStore.draftConfig?.modelRoles || {};
		const fullSelector = rolesMap[roleId];
		const roleMeta = STANDARD_ROLES.find(r => r.id === roleId);
		if (!fullSelector) {
			session.pushNotice('warning', `Il ruolo "${roleMeta?.label || roleId}" non è ancora configurato. Configuralo in Gestione Modelli (Ctrl+Alt+M).`, 'studio');
			return;
		}

		const [rawSelector, thinking] = fullSelector.split(':');
		const [provider, modelId] = rawSelector.includes('/') ? rawSelector.split('/') : ['', rawSelector];

		if (!modelId) return;
		try {
			await session.client.send({
				type: 'set_model',
				provider: provider || session.model?.provider || '',
				modelId
			});
			if (thinking && thinking !== 'auto') {
				await session.client.send({
					type: 'set_thinking_level',
					level: thinking as ThinkingLevel
				});
			}
			await session.refreshState();
			const roleLabel = roleMeta ? roleMeta.label : roleId;
			const currentModel = session.model?.name || session.model?.id || modelId;
			session.pushNotice('info', `Ruolo attivo: ${roleLabel} (${currentModel})`, 'studio');
		} catch (err) {
			session.pushNotice('warning', `Errore applicazione ruolo ${roleId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function handleCycleRole() {
		await modelSettingsStore.ensureLoaded();
		const cfg = modelSettingsStore.config || modelSettingsStore.draftConfig;
		const rolesMap = cfg?.modelRoles || {};
		const cycleOrder = cfg?.cycleOrder && cfg.cycleOrder.length > 0
			? cfg.cycleOrder
			: STANDARD_ROLES.map(r => r.id);

		// Filtra solo i ruoli che sono effettivamente configurati con un modello
		const configuredCycle = cycleOrder.filter(rId => Boolean(rolesMap[rId]));

		if (configuredCycle.length === 0) {
			// Se nessun ruolo è configurato, fallback su cycle_model standard
			try {
				await session.client.send({ type: 'cycle_model' });
				await session.refreshState();
				const current = session.model?.name || session.model?.id || 'default';
				session.pushNotice('info', `Modello attivo: ${current}`, 'studio');
			} catch (err) {
				session.pushNotice('warning', `Errore passaggio modello: ${err instanceof Error ? err.message : String(err)}`);
			}
			return;
		}

		// Determina il ruolo attivo corrente
		const curId = session.model?.id || '';
		const curProvider = session.model?.provider || '';
		let currentIndex = -1;

		for (let i = 0; i < configuredCycle.length; i++) {
			const rId = configuredCycle[i];
			const full = rolesMap[rId];
			if (!full) continue;
			const raw = full.split(':')[0];
			if (raw === curId || raw === `${curProvider}/${curId}` || raw.endsWith(`/${curId}`)) {
				currentIndex = i;
				break;
			}
		}

		const nextIndex = (currentIndex + 1) % configuredCycle.length;
		const nextRoleId = configuredCycle[nextIndex];
		await handleRoleSelect(nextRoleId);
	}

	async function handleCycleModel() {
		await handleCycleRole();
	}

	async function handleThinkingSelect(level: ThinkingLevel) {
		activeMenu = null;
		try {
			await session.client.send({
				type: 'set_thinking_level',
				level
			});
			await session.refreshState();
		} catch (err) {
			session.pushNotice('warning', `Errore impostazione livello di thinking: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function handleCycleThinking() {
		const current = session.thinkingLevel || 'off';
		const idx = THINKING_LEVELS.indexOf(current);
		const next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
		await handleThinkingSelect(next);
		session.pushNotice('info', `Livello di thinking: ${next}`, 'studio');
	}

	async function handleToggleSteering() {
		const next = steeringMode === 'one-at-a-time' ? 'all' : 'one-at-a-time';
		await setSteeringMode(next);
		session.pushNotice('info', `Modalità steering: ${next}`, 'studio');
	}

	function handleCancelOrClear() {
		if (session.isStreaming) {
			void session.abort();
			return;
		}
		if (text || attachedImages.length > 0) {
			text = '';
			attachedImages = [];
			paletteOpen = false;
			adjustTextareaHeight();
		}
	}

	async function setSteeringMode(mode: QueueMode) {
		steeringMode = mode;
		try {
			await session.client.send({ type: 'set_steering_mode', mode });
		} catch (err) {
			session.pushNotice('warning', `Errore impostazione modalita' steering: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function setFollowUpMode(mode: QueueMode) {
		followUpMode = mode;
		try {
			await session.client.send({ type: 'set_follow_up_mode', mode });
		} catch (err) {
			session.pushNotice('warning', `Errore impostazione modalita' follow-up: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function setInterruptMode(mode: InterruptMode) {
		interruptMode = mode;
		try {
			await session.client.send({ type: 'set_interrupt_mode', mode });
		} catch (err) {
			session.pushNotice('warning', `Errore impostazione modalita' interruzione: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	function toggleMenu(menu: 'role' | 'model' | 'thinking' | 'queue') {
		if (activeMenu === menu) {
			activeMenu = null;
		} else {
			activeMenu = menu;
			if (menu === 'role') {
				roleFilterQuery = '';
				highlightedRoleIndex = 0;
				void modelSettingsStore.ensureLoaded();
				setTimeout(() => roleSearchInputEl?.focus(), 40);
			}
			if (menu === 'model') {
				modelFilterQuery = '';
				highlightedModelIndex = 0;
				void loadAvailableModels();
				setTimeout(() => modelSearchInputEl?.focus(), 40);
			}
			if (menu === 'thinking') {
				const current = session.thinkingLevel || 'off';
				const idx = THINKING_LEVELS.indexOf(current);
				highlightedThinkingIndex = idx >= 0 ? idx : 0;
			}
			if (menu === 'queue') {
				void loadQueueSettings();
			}
		}
	}

	function openModelSettings() {
		activeMenu = null;
		modelSettingsStore.openModal('roles');
	}


	function closeMenus(event: MouseEvent) {
		if (!visible || (!activeMenu && !paletteOpen)) return;
		const target = event.target;
		if (target instanceof Element && target.closest('.dropdown-menu, .palette-container')) return;
		activeMenu = null;
		paletteOpen = false;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!visible) return;

		const target = event.target;
		const isComposerTextarea = target === textareaEl;
		const isModelSearchInput = target === modelSearchInputEl;
		const isRoleSearchInput = target === roleSearchInputEl;
		const isOtherInput = !isComposerTextarea && !isModelSearchInput && !isRoleSearchInput && (
			target instanceof HTMLInputElement
			|| target instanceof HTMLTextAreaElement
			|| (target instanceof HTMLElement && target.isContentEditable)
		);
		// Se il fuoco e' in un altro campo input/textarea esterno, non intercettare
		if (isOtherInput) return;

		const isAltOnly = event.altKey && !event.ctrlKey && !event.metaKey;
		const isCtrlOrCmd = (event.ctrlKey || event.metaKey) && !event.altKey;
		const keyLower = event.key.toLowerCase();
		const code = event.code;

		// Escape: chiusura a cascata o abort streaming
		if (event.key === 'Escape') {
			if (shortcutsHelpOpen) {
				event.preventDefault();
				shortcutsHelpOpen = false;
				textareaEl?.focus();
				return;
			}
			if (activeMenu) {
				event.preventDefault();
				activeMenu = null;
				textareaEl?.focus();
				return;
			}
			if (paletteOpen) {
				event.preventDefault();
				paletteOpen = false;
				textareaEl?.focus();
				return;
			}
			if (session.isStreaming) {
				event.preventDefault();
				void session.abort();
				return;
			}
			return;
		}

		// Alt+H o Alt+K o F1: toggle modale scorciatoie
		if ((isAltOnly && (keyLower === 'h' || code === 'KeyH' || keyLower === 'k' || code === 'KeyK')) || event.key === 'F1') {
			event.preventDefault();
			shortcutsHelpOpen = !shortcutsHelpOpen;
			return;
		}

		// Se il modale di aiuto e' aperto, non processare scorciatoie di composer
		if (shortcutsHelpOpen) return;
		// Navigazione da tastiera nei menu aperti
		if (activeMenu === 'role') {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				if (configuredRolesList.length > 0) {
					highlightedRoleIndex = (highlightedRoleIndex + 1) % configuredRolesList.length;
				}
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				if (configuredRolesList.length > 0) {
					highlightedRoleIndex = (highlightedRoleIndex - 1 + configuredRolesList.length) % configuredRolesList.length;
				}
				return;
			}
			if (event.key === 'Enter') {
				if (configuredRolesList.length > 0 && highlightedRoleIndex < configuredRolesList.length) {
					event.preventDefault();
					void handleRoleSelect(configuredRolesList[highlightedRoleIndex].id);
					textareaEl?.focus();
					return;
				}
			}
		} else if (activeMenu === 'model') {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				if (filteredModels.length > 0) {
					highlightedModelIndex = (highlightedModelIndex + 1) % filteredModels.length;
				}
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				if (filteredModels.length > 0) {
					highlightedModelIndex = (highlightedModelIndex - 1 + filteredModels.length) % filteredModels.length;
				}
				return;
			}
			if (event.key === 'Enter') {
				if (filteredModels.length > 0 && highlightedModelIndex < filteredModels.length) {
					event.preventDefault();
					void handleModelSelect(filteredModels[highlightedModelIndex]);
					textareaEl?.focus();
					return;
				}
			}
		} else if (activeMenu === 'thinking') {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				highlightedThinkingIndex = (highlightedThinkingIndex + 1) % THINKING_LEVELS.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				highlightedThinkingIndex = (highlightedThinkingIndex - 1 + THINKING_LEVELS.length) % THINKING_LEVELS.length;
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				void handleThinkingSelect(THINKING_LEVELS[highlightedThinkingIndex]);
				textareaEl?.focus();
				return;
			}
		} else if (activeMenu === 'queue') {
			if (event.key === '1' || keyLower === 's') {
				event.preventDefault();
				void setSteeringMode(steeringMode === 'one-at-a-time' ? 'all' : 'one-at-a-time');
				return;
			}
			if (event.key === '2' || keyLower === 'f') {
				event.preventDefault();
				void setFollowUpMode(followUpMode === 'one-at-a-time' ? 'all' : 'one-at-a-time');
				return;
			}
			if (event.key === '3' || keyLower === 'i') {
				event.preventDefault();
				void setInterruptMode(interruptMode === 'immediate' ? 'wait' : 'immediate');
				return;
			}
		}

		// Alt+R: apri/chiudi menu ruoli
		if (isAltOnly && (keyLower === 'r' || code === 'KeyR')) {
			event.preventDefault();
			toggleMenu('role');
			return;
		}

		// Alt+P: apri/chiudi menu modelli
		if (isAltOnly && (keyLower === 'p' || code === 'KeyP')) {
			event.preventDefault();
			toggleMenu('model');
			return;
		}

		// Ctrl+P / Cmd+P: cicla tra i ruoli configurati
		if (isCtrlOrCmd && (keyLower === 'p' || code === 'KeyP')) {
			event.preventDefault();
			void handleCycleRole();
			return;
		}
		// Alt+M: apri/chiudi menu thinking
		if (isAltOnly && (keyLower === 'm' || code === 'KeyM')) {
			event.preventDefault();
			toggleMenu('thinking');
			return;
		}

		// Alt+T: cicla direttamente livello thinking
		if (isAltOnly && (keyLower === 't' || code === 'KeyT')) {
			event.preventDefault();
			void handleCycleThinking();
			return;
		}

		// Alt+Q: apri/chiudi menu impostazioni coda
		if (isAltOnly && (keyLower === 'q' || code === 'KeyQ')) {
			event.preventDefault();
			toggleMenu('queue');
			return;
		}

		// Alt+S: alterna modalita' steering
		if (isAltOnly && (keyLower === 's' || code === 'KeyS')) {
			event.preventDefault();
			void handleToggleSteering();
			return;
		}

		// Alt+C: interrompi streaming o cancella input
		if (isAltOnly && (keyLower === 'c' || code === 'KeyC')) {
			event.preventDefault();
			handleCancelOrClear();
			return;
		}

		// Ctrl+C: interrompi streaming se non c'e' testo selezionato
		if (isCtrlOrCmd && (keyLower === 'c' || code === 'KeyC') && session.isStreaming) {
			const selection = window.getSelection()?.toString();
			if (!selection) {
				event.preventDefault();
				void session.abort();
				return;
			}
		}

		// Alt+E: metti a fuoco la textarea del composer
		if (isAltOnly && (keyLower === 'e' || code === 'KeyE')) {
			event.preventDefault();
			textareaEl?.focus();
			return;
		}
	}

	async function handleProcessFiles(files: FileList | File[]) {
		for (const file of Array.from(files)) {
			if (!isImageFile(file)) continue;
			const res = await prepareImage(file);
			if ('error' in res) {
				session.pushNotice('warning', res.error);
			} else {
				attachedImages = [...attachedImages, res];
			}
		}
	}

	function handlePaste(event: ClipboardEvent) {
		const imageFiles = extractImageFiles(event.clipboardData);
		if (imageFiles.length > 0) {
			event.preventDefault();
			void handleProcessFiles(imageFiles);
		}
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		const imageFiles = extractImageFiles(event.dataTransfer);
		if (imageFiles.length > 0) {
			void handleProcessFiles(imageFiles);
		}
	}
	function handleDragOver(event: DragEvent) {
		event.preventDefault();
	}

	function removeImage(index: number) {
		attachedImages = attachedImages.filter((_, i) => i !== index);
	}

	async function handleSubmit() {
		const raw = text.trim();
		if (!raw && attachedImages.length === 0) return;

		// Se inizia con /, verifica prima se Studio lo intercetta
		if (raw.startsWith('/')) {
			const handled = onSlashCommand(raw);
			if (handled) {
				text = '';
				paletteOpen = false;
				adjustTextareaHeight();
				return;
			}
		}

		const imagesToSend = [...attachedImages];
		text = '';
		attachedImages = [];
		paletteOpen = false;
		adjustTextareaHeight();
		await session.prompt(raw, imagesToSend);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
			if (paletteOpen) {
				// Se la palette e' aperta, lascia che sia essa a gestire l'Enter
				return;
			}
			event.preventDefault();
			void handleSubmit();
			return;
		}
	}
	function handlePalettePick(value: string, keepsOpen: boolean, submitImmediately: boolean) {
		if (!currentSlashMatch) {
			text = `/${value} `;
			paletteOpen = keepsOpen;
			textareaEl?.focus();
			adjustTextareaHeight();
			if (submitImmediately) void handleSubmit();
			return;
		}

		const res = insertSlashCommandAtCursor(
			text,
			currentSlashMatch.startIndex,
			currentSlashMatch.endIndex,
			value
		);
		text = res.newText;
		paletteOpen = keepsOpen;
		currentSlashMatch = null;
		adjustTextareaHeight();

		void tick().then(() => {
			if (textareaEl) {
				adjustTextareaHeight();
				textareaEl.focus();
				textareaEl.setSelectionRange(res.newCursorPos, res.newCursorPos);
			}
			if (submitImmediately) void handleSubmit();
		});
	}

	function formatTokens(count?: number): string {
		if (typeof count !== 'number') return '0';
		if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
		if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
		return String(count);
	}

	function formatCost(cost?: number | null): string {
		if (typeof cost !== 'number') return '$0.0000';
		return `$${cost.toFixed(4)}`;
	}

	const contextPercent = $derived.by(() => {
		if (typeof session.contextUsage?.percent === 'number') {
			return Math.min(100, Math.max(0, session.contextUsage.percent));
		}
		if (session.contextUsage?.tokens && session.contextUsage?.contextWindow) {
			return Math.min(100, Math.max(0, (session.contextUsage.tokens / session.contextUsage.contextWindow) * 100));
		}
		return 0;
	});
</script>

<svelte:window onclick={closeMenus} onkeydown={handleWindowKeydown} />

<div class="composer-container" bind:this={composerEl}>
	<!-- Chip dei messaggi in coda -->
	<QueueChips
		queued={session.queued}
		serverCount={session.queuedMessageCount}
		onToggleBehavior={(id, b) => session.setQueuedBehavior(id, b)}
	/>
	<!-- Palette comandi slash -->
	<CommandPalette
		open={visible && paletteOpen}
		commands={allCommands}
		query={paletteQuery}
		onPick={handlePalettePick}
		onClose={() => (paletteOpen = false)}
		onSubmitFallback={() => void handleSubmit()}
	/>

	<!-- Miniature delle immagini allegate -->
	{#if attachedImages.length > 0}
		<div class="image-previews" role="region" aria-label="Immagini allegate">
			{#each attachedImages as img, idx (idx)}
				<div class="image-thumb-wrap">
					<img
						src="data:{img.mimeType};base64,{img.data}"
						alt="Anteprima allegato {idx + 1}"
						class="image-thumb"
					/>
					<button
						type="button"
						class="image-remove-btn"
						title="Rimuovi immagine"
						onclick={() => removeImage(idx)}
					>
						<IconClose />
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Area di input principale -->
	<div
		class="input-row"
		ondrop={handleDrop}
		ondragover={handleDragOver}
		role="region"
		aria-label="Area di scrittura"
	>
		<div class="composer-textarea-wrap">
			<textarea
				bind:this={textareaEl}
				bind:value={text}
				oninput={handleComposerInput}
				onclick={handleCursorMovement}
				onkeyup={handleCursorMovement}
				onkeydown={handleKeydown}
				onpaste={handlePaste}
				onfocus={() => updateSmoothCursor(true)}
				onblur={() => { isCursorFocused = false; }}
				onscroll={handleCursorMovement}
				placeholder={session.isStarting ? "Avvio di OMP in corso... puoi già scrivere" : "Scrivi un messaggio... digita / per i comandi (Alt+H scorciatoie)"}
				rows="1"
				class="composer-textarea"
				class:has-smooth-cursor={isCursorFocused}
				aria-label="Messaggio per l'assistente"
			></textarea>

			<div
				class="smooth-cursor"
				class:visible={isCursorFocused && !hasTextSelection}
				class:blinking={isCursorBlinking}
				class:no-transition={cursorInstantSnap}
				style="transform: translate3d({cursorX}px, {cursorY}px, 0); height: {cursorHeight}px;"
				aria-hidden="true"
			></div>
		</div>

		<div class="actions-group">
			<!-- Pulsante Invio / Stop -->
			{#if session.isStreaming && !text.trim() && attachedImages.length === 0}
				<button
					type="button"
					class="send-btn stop"
					title="Interrompi risposta (Esc / Alt+C)"
					aria-label="Interrompi generazione (Esc)"
					onclick={() => session.abort()}
				>
					<svg viewBox="0 0 16 16" class="btn-icon" aria-hidden="true">
						<rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" />
					</svg>
				</button>
			{:else}
				<button
					type="button"
					class="send-btn"
					title={session.isStarting ? 'Invia messaggio (verrà recapitato appena OMP è pronto)' : session.isStreaming ? 'Accoda messaggio (Invio)' : 'Invia messaggio (Invio)'}
					aria-label={session.isStreaming ? 'Accoda messaggio (Invio)' : 'Invia messaggio (Invio)'}
					disabled={!text.trim() && attachedImages.length === 0}
					onclick={() => handleSubmit()}
				>
					<svg viewBox="0 0 16 16" class="btn-icon" aria-hidden="true">
						<path d="M8 12.5V3.5M3.5 8L8 3.5 12.5 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
			{/if}
		</div>
	</div>

	<!-- Barra dei chip di stato sotto la textarea -->
	<div class="status-bar" aria-label="Stato della sessione">
		<!-- Chip Ruolo -->
		<div class="status-item-wrap">
			<button
				type="button"
				class="status-chip echo role-chip"
				title={session.isStarting ? 'Avvio di OMP in corso...' : 'Ruolo attivo (Alt+R per aprire il menu ruoli, Ctrl+P per ciclarlo)'}
				aria-haspopup="listbox"
				aria-expanded={activeMenu === 'role'}
				disabled={session.isStarting}
				onclick={(e) => {
					e.stopPropagation();
					toggleMenu('role');
				}}
			>
				
				<span class="chip-val role-val">
					{#if activeRoleInfo}
						{@const RoleIcon = activeRoleInfo.icon}
						<span class="role-glyph-inline"><RoleIcon /></span> {activeRoleInfo.label}
					{:else}
						personalizzato
					{/if}
				</span>
			</button>

			{#if activeMenu === 'role'}
				<div class="dropdown-menu role-menu" role="group" aria-label="Ruoli configurati">
					<div class="menu-header">
						<span>Ruoli (Alt+R)</span>
						<div class="menu-header-actions">
							<button type="button" class="menu-cycle-btn" onclick={handleCycleRole} title="Cicla al ruolo successivo (Ctrl+P)">
								Cicla (Ctrl+P)
							</button>
							<button type="button" class="menu-config-btn" onclick={openModelSettings} title="Gestione completa modelli e ruoli (Ctrl+Alt+M)">
								gestisci
							</button>
						</div>
					</div>
					<div class="menu-search-wrap">
						<span class="search-icon">cerca</span>
						<input
							bind:this={roleSearchInputEl}
							bind:value={roleFilterQuery}
							type="text"
							class="menu-search-input"
							placeholder="Filtra ruoli..."
							aria-autocomplete="list"
							aria-controls="role-listbox"
							aria-activedescendant={configuredRolesList[highlightedRoleIndex] ? `role-opt-${highlightedRoleIndex}` : undefined}
							oninput={() => highlightedRoleIndex = 0}
						/>
						{#if roleFilterQuery}
							<button
								type="button"
								class="menu-search-clear"
								onclick={() => { roleFilterQuery = ''; highlightedRoleIndex = 0; }}
								title="Cancella filtro"
							>
								<IconClose />
							</button>
						{/if}
					</div>
					<div class="menu-body" id="role-listbox" bind:this={roleListEl} role="listbox" aria-label="Ruoli">
						{#if configuredRolesList.length > 0}
							{#each configuredRolesList as r, idx (r.id)}
								{@const isSelected = activeRoleInfo?.id === r.id}
								{@const RoleItemIcon = r.icon}
								<div
									id="role-opt-{idx}"
									class="menu-item role-item"
									class:selected={isSelected}
									class:highlighted={highlightedRoleIndex === idx}
									class:unconfigured={!r.isConfigured}
									role="option"
									tabindex="-1"
									aria-selected={isSelected}
									onclick={() => handleRoleSelect(r.id)}
									onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRoleSelect(r.id); } }}
									onmouseenter={() => highlightedRoleIndex = idx}
								>
									<span class="role-item-glyph"><RoleItemIcon /></span>
									<div class="role-item-main">
										<div class="role-item-title-row">
											<span class="role-item-name">{r.label}</span>
											{#if isSelected}
												<span class="item-check"><IconCheck /></span>
											{/if}
										</div>
										{#if r.isConfigured}
											<span class="role-item-sub truncate">
												{r.modelName} {#if r.provider}<span class="provider-sub">({r.provider})</span>{/if}
											</span>
										{:else}
											<span class="role-item-sub unconfigured-sub">Non configurato — clicca per aprire</span>
										{/if}
									</div>
								</div>
							{/each}
						{:else}
							<div class="menu-empty">Nessun ruolo corrispondente</div>
						{/if}
					</div>
					<div class="menu-footer-hint">
						<span>↑↓ naviga</span>
						<span>↵ seleziona</span>
						<span>Esc chiudi</span>
					</div>
				</div>
			{/if}
		</div>

		<!-- Chip Modello -->
		<div class="status-item-wrap">
			<button
				type="button"
				class="status-chip echo model-chip"
				title={session.isStarting ? 'Avvio di OMP in corso...' : 'Modello corrente (Alt+P per aprire il catalogo modelli)'}
				aria-haspopup="listbox"
				aria-expanded={activeMenu === 'model'}
				disabled={session.isStarting}
				onclick={(e) => {
					e.stopPropagation();
					toggleMenu('model');
				}}
			>
				
				{#if session.isStarting}
					<span class="chip-val starting">
						<span class="starting-spinner"></span> in avvio...
					</span>
				{:else}
					<span class="chip-val">{session.model?.name || session.model?.id || 'default'}</span>
				{/if}
			</button>

			{#if activeMenu === 'model'}
				<div class="dropdown-menu model-menu" role="group" aria-label="Modelli disponibili">
					<div class="menu-header">
						<span>Catalogo modelli (Alt+P)</span>
						<div class="menu-header-actions">
							<button type="button" class="menu-config-btn" onclick={openModelSettings} title="Gestione completa modelli (Ctrl+Alt+M)">
								gestisci
							</button>
						</div>
					</div>
					<div class="menu-search-wrap">
						<span class="search-icon">cerca</span>
						<input
							bind:this={modelSearchInputEl}
							bind:value={modelFilterQuery}
							type="text"
							class="menu-search-input"
							placeholder="Filtra modelli..."
							aria-autocomplete="list"
							aria-controls="model-listbox"
							aria-activedescendant={filteredModels[highlightedModelIndex] ? `model-opt-${highlightedModelIndex}` : undefined}
							oninput={() => highlightedModelIndex = 0}
						/>
						{#if modelFilterQuery}
							<button
								type="button"
								class="menu-search-clear"
								onclick={() => { modelFilterQuery = ''; highlightedModelIndex = 0; }}
								title="Cancella filtro"
							>
								<IconClose />
							</button>
						{/if}
					</div>
					<div class="menu-body" id="model-listbox" bind:this={modelListEl} role="listbox" aria-label="Modelli">
						{#if loadingModels}
							<div class="menu-loading">Caricamento modelli...</div>
						{:else if filteredModels.length > 0}
							{#each filteredModels as m, idx (m.provider + ':' + m.id)}
								{@const isSelected = session.model?.id === m.id && session.model?.provider === m.provider}
								<div
									id="model-opt-{idx}"
									class="menu-item"
									class:selected={isSelected}
									class:highlighted={highlightedModelIndex === idx}
									role="option"
									tabindex="-1"
									aria-selected={isSelected}
									onclick={() => handleModelSelect(m)}
									onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleModelSelect(m); } }}
									onmouseenter={() => highlightedModelIndex = idx}
								>
									<span class="model-item-name">{m.name || m.id}</span>
									{#if m.provider}
										<span class="model-item-provider">{m.provider}</span>
									{/if}
								</div>
							{/each}
						{:else}
							<div class="menu-empty">Nessun modello corrispondente</div>
						{/if}
					</div>
					<div class="menu-footer-hint">
						<span>↑↓ naviga</span>
						<span>↵ scegli</span>
						<span>Esc chiudi</span>
					</div>
				</div>
			{/if}
		</div>


		<!-- Chip Thinking -->
		<div class="status-item-wrap">
			<button
				type="button"
				class="status-chip echo thinking-chip"
				title="Livello di thinking (Alt+M per aprire il menu, Alt+T per ciclarlo)"
				aria-haspopup="listbox"
				aria-expanded={activeMenu === 'thinking'}
				onclick={(e) => {
					e.stopPropagation();
					toggleMenu('thinking');
				}}
			>
				<span class="chip-val">thinking: {session.thinkingLevel || 'off'}</span>
			</button>

			{#if activeMenu === 'thinking'}
				<div class="dropdown-menu thinking-menu" role="group" aria-label="Livello di thinking">
					<div class="menu-header">
						<span>Thinking (Alt+M)</span>
						<button type="button" class="menu-cycle-btn" onclick={handleCycleThinking} title="Cicla rapido (Alt+T)">
							Cicla (Alt+T)
						</button>
					</div>
					<div class="menu-body" id="thinking-listbox" role="listbox" aria-label="Livelli di thinking">
						{#each THINKING_LEVELS as lvl, idx (lvl)}
							{@const isSelected = (session.thinkingLevel || 'off') === lvl}
							<div
								id="thinking-opt-{idx}"
								class="menu-item"
								class:selected={isSelected}
								class:highlighted={highlightedThinkingIndex === idx}
								role="option"
								tabindex="-1"
								aria-selected={isSelected}
								onclick={() => handleThinkingSelect(lvl)}
								onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleThinkingSelect(lvl); } }}
								onmouseenter={() => highlightedThinkingIndex = idx}
							>
								<span>{lvl}</span>
								{#if isSelected}
									<span class="item-check"><IconCheck /></span>
								{/if}
							</div>
						{/each}
					</div>
					<div class="menu-footer-hint">
						<span>↑↓ naviga</span>
						<span>↵ scegli</span>
						<span>Esc chiudi</span>
					</div>
				</div>
			{/if}
		</div>

		<!-- Chip Gauge del contesto -->
		<div
			class="status-readout context-chip"
			role="status"
			title="Utilizzo del contesto: {session.contextUsage?.tokens ?? 0} su {session.contextUsage?.contextWindow ?? 0} token ({contextPercent.toFixed(1)}%)"
		>
			
			<span class="chip-val">
				{formatTokens(session.contextUsage?.tokens)} / {formatTokens(session.contextUsage?.contextWindow)}
			</span>
			<div class="context-gauge-track" aria-hidden="true">
				<div class="context-gauge-fill" style:transform="scaleX({contextPercent / 100})"></div>
			</div>
		</div>

		<!-- Chip Costo -->
		<div class="status-readout cost-chip" role="status" title="Costo stimato della sessione">
			
			<span class="chip-val">{formatCost(session.sessionCost)}</span>
		</div>

		<!-- Menu impostazioni coda (icona discreta) -->
		<div class="status-item-wrap queue-settings-wrap">
			<button
				type="button"
				class="status-chip echo queue-btn"
				title="Impostazioni di accodamento e interruzione (Alt+Q)"
				aria-haspopup="dialog"
				aria-expanded={activeMenu === 'queue'}
				onclick={(e) => {
					e.stopPropagation();
					toggleMenu('queue');
				}}
			>
				<span class="queue-icon"><IconSettings /></span>
			</button>

			{#if activeMenu === 'queue'}
				<div class="dropdown-menu queue-menu" role="group" aria-label="Impostazioni coda">
					<div class="menu-header">
						<span>Coda omp (Alt+Q)</span>
					</div>
					<div class="menu-section">
						<div class="section-title-row">
							<span class="section-title">Modalità steering</span>
							<kbd class="key-shortcut-tag">1 o S</kbd>
						</div>
						<div class="section-buttons">
							<button
								type="button"
								class="toggle-choice-btn"
								class:selected={steeringMode === 'one-at-a-time'}
								onclick={() => setSteeringMode('one-at-a-time')}
							>
								one-at-a-time
							</button>
							<button
								type="button"
								class="toggle-choice-btn"
								class:selected={steeringMode === 'all'}
								onclick={() => setSteeringMode('all')}
							>
								all
							</button>
						</div>
					</div>

					<div class="menu-section">
						<div class="section-title-row">
							<span class="section-title">Modalità follow-up</span>
							<kbd class="key-shortcut-tag">2 o F</kbd>
						</div>
						<div class="section-buttons">
							<button
								type="button"
								class="toggle-choice-btn"
								class:selected={followUpMode === 'one-at-a-time'}
								onclick={() => setFollowUpMode('one-at-a-time')}
							>
								one-at-a-time
							</button>
							<button
								type="button"
								class="toggle-choice-btn"
								class:selected={followUpMode === 'all'}
								onclick={() => setFollowUpMode('all')}
							>
								all
							</button>
						</div>
					</div>

					<div class="menu-section">
						<div class="section-title-row">
							<span class="section-title">Modalità interruzione</span>
							<kbd class="key-shortcut-tag">3 o I</kbd>
						</div>
						<div class="section-buttons">
							<button
								type="button"
								class="toggle-choice-btn"
								class:selected={interruptMode === 'immediate'}
								onclick={() => setInterruptMode('immediate')}
							>
								immediate
							</button>
							<button
								type="button"
								class="toggle-choice-btn"
								class:selected={interruptMode === 'wait'}
								onclick={() => setInterruptMode('wait')}
							>
								wait
							</button>
						</div>
					</div>
					<div class="menu-footer-hint">
						<span>1/2/3 cambia</span>
						<span>Esc chiudi</span>
					</div>
				</div>
			{/if}
		</div>

		<!-- Chip Scorciatoie da tastiera -->
		<div class="status-item-wrap">
			<button
				type="button"
				class="status-chip shortcuts-help-chip"
				title="Scorciatoie da tastiera (Alt+H o F1)"
				onclick={(e) => {
					e.stopPropagation();
					shortcutsHelpOpen = !shortcutsHelpOpen;
				}}
			>
				<span class="chip-label"><IconKeyboard /></span>
				<span class="chip-val shortcut-hint">Alt+H</span>
			</button>
		</div>
	</div>
</div>

<ShortcutsHelpModal open={shortcutsHelpOpen} onClose={() => (shortcutsHelpOpen = false)} />

<style>
	.composer-container {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border-top: 1px solid var(--line-strong);
		font-family: var(--font-ui);
		width: 100%;
	}

	.image-previews {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
	}

	.image-thumb-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-base);
		border: 1px solid var(--line-strong);
	}

	.image-thumb {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.image-remove-btn {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		color: var(--ink);
		font-size: var(--text-xs);
		line-height: 1;
		cursor: pointer;
		padding: 0;
		--icon-size: 12px;
	}

	.image-remove-btn:hover {
		background: var(--brand);
		color: var(--on-brand);
	}

	.input-row {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
	}
	.composer-textarea-wrap {
		position: relative;
		flex: 1;
		display: flex;
		min-width: 0;
		align-self: stretch;
	}

	.composer-textarea {
		width: 100%;
		flex: 1;
		min-height: 36px;
		max-height: 240px;
		padding: var(--space-1) 0;
		background: transparent;
		border: none;
		outline: none;
		box-shadow: none;
		resize: none;
		font-family: var(--font-ui);
		font-size: var(--text-base);
		color: var(--ink);
		line-height: 1.45;
	}

	.composer-textarea.has-smooth-cursor {
		caret-color: transparent;
	}

	.smooth-cursor {
		position: absolute;
		top: 0;
		left: 0;
		width: 2px;
		border-radius: 1px;
		background: var(--brand);
		pointer-events: none;
		z-index: 2;
		opacity: 0;
		transform: translate3d(0, 0, 0);
		transition:
			transform 80ms cubic-bezier(0.1, 0.9, 0.2, 1),
			height 80ms cubic-bezier(0.1, 0.9, 0.2, 1),
			opacity 140ms ease-out;
		will-change: transform, height, opacity;
	}

	.smooth-cursor.visible {
		opacity: 1;
	}

	.smooth-cursor.no-transition {
		transition: opacity 140ms ease-out !important;
	}

	.smooth-cursor.blinking {
		animation: smooth-cursor-blink 1s cubic-bezier(0.65, 0, 0.35, 1) infinite;
	}

	@keyframes smooth-cursor-blink {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.smooth-cursor {
			transition: none !important;
			animation: none !important;
		}
		.smooth-cursor.blinking {
			opacity: 1;
		}
	}

	.composer-textarea:focus,
	.composer-textarea:focus-visible {
		outline: none;
		box-shadow: none;
	}
	.composer-textarea::placeholder {
		color: var(--ink-faint);
	}

	.actions-group {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-bottom: 2px;
		user-select: none;
	}

	.send-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: var(--brand);
		color: var(--on-brand);
		border: 1px solid var(--brand);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-weight: 600;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.send-btn:hover:not(:disabled) {
		background: var(--brand-ink);
		border-color: var(--brand-ink);
	}

	.send-btn:active:not(:disabled) {
		background: var(--brand-dim);
	}

	.send-btn:disabled {
		opacity: 0.35;
		cursor: default;
		background: var(--bg-hover);
		border-color: var(--line);
		color: var(--ink-faint);
	}

	.send-btn.stop {
		background: var(--bg-base);
		border: 1px solid var(--danger);
		color: var(--danger);
	}

	.send-btn.stop:hover {
		background: var(--danger-dim);
		border-color: var(--danger);
		color: var(--ink);
	}

	.send-btn.stop:active {
		background: var(--danger);
		color: var(--on-danger);
	}

	.btn-icon {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	/* Barra di stato inferiore */
	.status-bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3) var(--space-2);
		border-top: 1px solid var(--line);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		flex-wrap: wrap;
	}

	.status-item-wrap {
		position: relative;
	}

	.status-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px 4px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		line-height: 1;
	}

	.status-chip:hover {
		background: var(--bg-hover);
		border-color: var(--line);
		color: var(--ink);
	}

	.status-chip:disabled {
		opacity: 0.5;
		cursor: default;
		background: transparent;
		border-color: transparent;
	}

	.status-chip:disabled:hover {
		background: transparent;
		border-color: transparent;
		color: var(--ink-muted);
	}

	.status-chip.echo {
		color: var(--ink-faint);
	}

	.status-chip.echo .chip-val {
		color: var(--ink-muted);
	}

	.status-chip.echo .role-glyph-inline {
		color: var(--ink-muted);
	}

	.status-chip.echo:hover {
		color: var(--ink);
	}

	.status-chip.echo:hover .chip-val,
	.status-chip.echo:hover .role-glyph-inline {
		color: var(--ink);
	}

	.status-readout {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px 0;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		line-height: 1;
	}

	.chip-label {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		text-transform: lowercase;
		--icon-size: 12px;
	}

	.chip-val {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.chip-val.starting {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-muted);
	}

	.starting-spinner {
		display: inline-block;
		width: 6px;
		height: 6px;
		background: var(--brand);
		border-radius: var(--radius-full);
	}

	.context-chip {
		cursor: default;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.context-chip:hover {
		background: transparent;
		border-color: transparent;
	}

	.context-gauge-track {
		width: 36px;
		height: 2px;
		background: var(--line-strong);
		border-radius: var(--radius-full);
		overflow: hidden;
		margin-left: 2px;
	}

	.context-gauge-fill {
		width: 100%;
		height: 100%;
		background: var(--brand-ink);
		transform-origin: left;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.cost-chip {
		cursor: default;
	}

	.cost-chip:hover {
		background: transparent;
		border-color: transparent;
	}

	.queue-settings-wrap {
		margin-left: auto;
	}

	.queue-btn {
		padding: 2px 6px;
	}

	.queue-icon {
		font-size: var(--text-xs);
		line-height: 1;
		color: var(--ink-faint);
		--icon-size: 12px;
	}

	/* Menu a comparsa */
	.dropdown-menu {
		position: absolute;
		bottom: 100%;
		left: 0;
		margin-bottom: var(--space-1);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		min-width: 180px;
		max-width: calc(100vw - 2 * var(--space-4));
		overflow: hidden;
	}

	.queue-menu {
		left: auto;
		right: 0;
		width: 240px;
		padding: var(--space-2);
	}

	.menu-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
	}

	.menu-header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.menu-cycle-btn,
	.menu-config-btn {
		background: transparent;
		border: none;
		color: var(--brand-ink);
		font-size: var(--text-xs);
		cursor: pointer;
		padding: 0;
	}

	.menu-cycle-btn:hover,
	.menu-config-btn:hover {
		text-decoration: underline;
	}

	.role-chip .role-val {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.role-glyph-inline {
		color: var(--brand-ink);
		font-size: var(--text-xs);
		--icon-size: 12px;
	}

	.role-menu {
		min-width: 250px;
	}

	.role-item {
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
	}

	.role-item-glyph {
		font-size: var(--text-sm);
		color: var(--brand-ink);
		flex-shrink: 0;
		margin-top: 1px;
	}

	.role-item-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
		overflow: hidden;
	}

	.role-item-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.role-item-name {
		font-weight: 500;
		font-size: var(--text-xs);
	}

	.role-item-sub {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.role-item-sub .provider-sub {
		color: var(--ink-faint);
		opacity: 0.8;
	}

	.role-item.unconfigured {
		opacity: 0.65;
	}

	.role-item-sub.unconfigured-sub {
		color: var(--warn);
	}

	.menu-body {
		max-height: 220px;
		overflow-y: auto;
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.menu-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-1) var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		text-align: left;
		cursor: pointer;
	}

	.menu-item:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.menu-item.selected {
		background: var(--bg-active);
		color: var(--brand-ink);
		font-weight: 500;
	}

	.model-item-name {
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.model-item-provider {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.menu-loading,
	.menu-empty {
		padding: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-align: center;
	}

	.menu-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}

	.menu-section:last-child {
		margin-bottom: 0;
	}

	.section-title {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.section-buttons {
		display: flex;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px;
	}

	.toggle-choice-btn {
		flex: 1;
		padding: 2px 4px;
		background: transparent;
		border: none;
		border-radius: calc(var(--radius-sm) - 1px);
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		cursor: pointer;
		text-align: center;
	}

	.toggle-choice-btn.selected {
		background: var(--bg-base);
		color: var(--ink);
		font-weight: 500;
	}

	/* Barra di ricerca nel menu modelli */
	.menu-search-wrap {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 4px var(--space-2);
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
	}

	.menu-search-input {
		flex: 1;
		background: transparent;
		border: none;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--ink);
		min-width: 0;
		padding: 2px 0;
	}

	.menu-search-input::placeholder {
		color: var(--ink-faint);
	}

	.menu-search-clear {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		font-size: var(--text-md);
		line-height: 1;
		padding: 0 2px;
	}

	.menu-search-clear:hover {
		color: var(--ink);
	}

	.search-icon {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.menu-item.highlighted {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.item-check {
		font-size: var(--text-xs);
		color: var(--brand-ink);
		font-weight: 600;
		--icon-size: 12px;
	}

	.menu-footer-hint {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border-top: 1px solid var(--line);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		user-select: none;
	}

	.section-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.key-shortcut-tag {
		display: inline-flex;
		align-items: center;
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.shortcuts-help-chip {
		padding: 2px 5px;
	}

	.shortcut-hint {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}
</style>
