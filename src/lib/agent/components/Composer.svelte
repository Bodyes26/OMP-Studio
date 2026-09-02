<script lang="ts">
	import { tick } from 'svelte';
	import { formatTokens } from '$lib/utils/format';
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
		type ModelInfo,
		type StreamingBehavior,
		type ThinkingLevel
	} from '../wire';
	import { asRecord } from '../tools/types';
	import { prepareImage, extractImageFiles, isImageFile } from '../images';
	import QueueChips from './QueueChips.svelte';
	import SuggestionChips from './SuggestionChips.svelte';
	import {
		visibleSuggestions,
		composeSuggestionChips,
		MAX_STATIC_CHIPS,
		type SuggestionChipItem
	} from '$lib/stores/promptSuggestions';
	import { settingsStore } from '$lib/stores/settings.svelte';
import CommandPalette from './CommandPalette.svelte';
import { shortcutsModalStore } from '$lib/stores/shortcutsModal.svelte';
import {
	STUDIO_SLASH_COMMANDS,
	mergeCommands,
	extractSlashQueryAtCursor,
	shouldOpenSlashPaletteAtCursor,
	insertSlashCommandAtCursor,
	type SlashCursorMatch
} from '../commands';
import { modelSettingsStore, STANDARD_ROLES, type ModelDto } from '$lib/stores/modelSettings.svelte';
import {
	IconClose,
	IconCheck,
	IconKeyboard,
	IconContextWindow,
	IconRoleSlow,
	IconRoleVision
} from '$lib/icons';
import { anchoredPopover } from '$lib/anchoredPopover';
import { getCaretCoordinates } from './caretCoordinates';
	let {
		session,
		visible = true,
		onSlashCommand,
		onNewChat
	} = $props<{
		session: AgentSession;
		visible?: boolean;
		onSlashCommand: (raw: string) => boolean;
		onNewChat?: () => void;
	}>();

	$effect(() => {
		session.suggestions.setVisible(visible);
	});
	let text = $state('');
	let attachedImages = $state<ImageContent[]>([]);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let paletteOpen = $state(false);
	let paletteQuery = $state('');
	let currentSlashMatch = $state<SlashCursorMatch | null>(null);

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
let activeMenu = $state<'role' | 'model' | 'thinking' | 'send' | null>(null);
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
// Ancore dei menu a comparsa: i pannelli vivono nel top layer, quindi le
// coordinate si calcolano dal chip che li apre.
let roleChipEl = $state<HTMLElement | null>(null);
let modelChipEl = $state<HTMLElement | null>(null);
let thinkingChipEl = $state<HTMLElement | null>(null);
let sendCaretEl = $state<HTMLElement | null>(null);
	// Modalita di streaming/accodamento (predefinita e alternativa)
	const defaultBehavior = $derived<StreamingBehavior>(settingsStore.general.defaultStreamingBehavior ?? 'steer');
	const alternativeBehavior = $derived<StreamingBehavior>(defaultBehavior === 'steer' ? 'followUp' : 'steer');

	function getBehaviorLabel(b: StreamingBehavior): string {
		return b === 'steer' ? 'Steer' : 'Follow-up';
	}
	const defaultBehaviorLabel = $derived(getBehaviorLabel(defaultBehavior));

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

// Il protocollo di sessione manda solo id, nome, provider e contesto: vision
// e thinking si leggono dal catalogo, cosi' questa lista mostra le stesse
// icone del selettore modello del task invece di due righe di testo nudo.
const catalogByKey = $derived.by(() => {
	const byKey: Record<string, ModelDto> = {};
	for (const model of modelSettingsStore.catalog) {
		byKey[`${model.provider}/${model.id}`] = model;
		byKey[model.selector] = model;
		byKey[model.id] = model;
	}
	return byKey;
});

function modelCapabilities(m: ModelInfo) {
	const dto = catalogByKey[`${m.provider}/${m.id}`] ?? (m.id ? catalogByKey[m.id] : undefined);
	return {
		vision: dto?.input?.includes('image') ?? false,
		thinking: dto?.reasoning ?? false,
		contextWindow: m.contextWindow ?? dto?.contextWindow,
		thinkingTitle:
			dto?.thinking?.efforts && dto.thinking.efforts.length > 0
				? `Thinking: ${dto.thinking.efforts.join(' · ')}`
				: 'Thinking: supporta il ragionamento esteso'
	};
}

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
	function isComposerActiveAndFocused(): boolean {
		if (!textareaEl || typeof document === 'undefined') return false;
		const hasDocFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
		return hasDocFocus && document.activeElement === textareaEl && !document.hidden;
	}

	function updateSmoothCursor(instant = false) {
		if (!textareaEl) return;
		const isFocused = isComposerActiveAndFocused();
		isCursorFocused = isFocused;
		if (!isFocused) {
			isCursorBlinking = false;
			if (blinkTimer !== null) {
				window.clearTimeout(blinkTimer);
				blinkTimer = null;
			}
			return;
		}

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
			if (isComposerActiveAndFocused()) {
				isCursorBlinking = true;
			}
		}, 500);
	}

	$effect(() => {
		if (typeof document === 'undefined' || typeof window === 'undefined') return;

		function handleSelectionChange() {
			if (document.activeElement === textareaEl) {
				updateSmoothCursor();
			}
		}

		function handleWindowFocus() {
			if (document.activeElement === textareaEl) {
				updateSmoothCursor(true);
			} else {
				isCursorFocused = false;
				isCursorBlinking = false;
			}
		}

		function handleWindowBlur() {
			isCursorFocused = false;
			isCursorBlinking = false;
			if (blinkTimer !== null) {
				window.clearTimeout(blinkTimer);
				blinkTimer = null;
			}
		}

		function handleVisibilityChange() {
			if (document.hidden) {
				handleWindowBlur();
			} else if (document.activeElement === textareaEl) {
				handleWindowFocus();
			}
		}

		document.addEventListener('selectionchange', handleSelectionChange);
		window.addEventListener('focus', handleWindowFocus);
		window.addEventListener('blur', handleWindowBlur);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			document.removeEventListener('selectionchange', handleSelectionChange);
			window.removeEventListener('focus', handleWindowFocus);
			window.removeEventListener('blur', handleWindowBlur);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			if (blinkTimer !== null) {
				window.clearTimeout(blinkTimer);
				blinkTimer = null;
			}
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
	function handleInputRowClick(event: MouseEvent) {
		const target = event.target as HTMLElement | null;
		if (target && (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('.image-thumb-wrap'))) {
			return;
		}
		if (textareaEl && document.activeElement !== textareaEl) {
			textareaEl.focus();
			updateSmoothCursor(true);
		}
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

	function toggleMenu(menu: 'role' | 'model' | 'thinking' | 'send') {
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
	$effect(() => {
		if (!session.isStreaming && activeMenu === 'send') {
			activeMenu = null;
		}
	});


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

		const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
		const isInteractiveElement = activeEl instanceof HTMLElement && (
			activeEl instanceof HTMLButtonElement
			|| activeEl instanceof HTMLSelectElement
			|| activeEl.getAttribute('role') === 'button'
			|| activeEl.getAttribute('role') === 'option'
			|| activeEl.getAttribute('role') === 'tab'
			|| activeEl.getAttribute('role') === 'menuitem'
			|| activeEl.getAttribute('role') === 'radio'
			|| activeEl.getAttribute('role') === 'checkbox'
			|| activeEl.closest('.ask-card') !== null
			|| activeEl.closest('.modal-dialog') !== null
			|| activeEl.closest('.popover') !== null
			|| activeEl.closest('.drawer') !== null
		);
		const hasOpenOverlay = typeof document !== 'undefined' && Boolean(
			settingsStore.open
			|| modelSettingsStore.isOpen
			|| shortcutsModalStore.isOpen
			|| document.querySelector('.modal-dialog, .modal-backdrop, .project-picker-modal, .queue-drawer.open')
		);

		// Type-to-focus: se l'utente inizia a scrivere (lettera/simbolo normale) e il focus non e' in un altro input
		// ne' ci sono dialoghi/menu aperti o elementi interattivi a fuoco
		if (!isComposerTextarea && !activeMenu && !paletteOpen && !hasOpenOverlay) {
			if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !event.isComposing) {
				if (event.key === ' ' && isInteractiveElement) {
					// Lascia che lo spazio attivi l'elemento con focus
					return;
				}
				if (isInteractiveElement && activeEl?.closest('.ask-card')) {
					// Non rubare il fuoco alla card di ask
					return;
				}
				textareaEl?.focus();
				// Lascia propagare l'evento per inserire il carattere nella textarea
			}
		}
		// Escape: chiusura a cascata o abort streaming
		if (event.key === 'Escape') {
			if (shortcutsModalStore.isOpen) {
				event.preventDefault();
				shortcutsModalStore.close();
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


		// Se il modale di aiuto e' aperto, non processare scorciatoie di composer
		if (shortcutsModalStore.isOpen) return;
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
		}
		// Alt+1 .. Alt+6: applica suggerimento prompt corrispondente
		if (isAltOnly && !activeMenu && showSuggestionChips) {
			let digit: number | null = null;
			if (event.key >= '1' && event.key <= '6') {
				digit = parseInt(event.key, 10);
			} else if (code.startsWith('Digit')) {
				const d = parseInt(code.slice(5), 10);
				if (d >= 1 && d <= 6) digit = d;
			} else if (code.startsWith('Numpad')) {
				const d = parseInt(code.slice(6), 10);
				if (d >= 1 && d <= 6) digit = d;
			}

			if (digit !== null) {
				const targetIndex = digit - 1;
				if (targetIndex >= 0 && targetIndex < displayedSuggestions.length) {
					event.preventDefault();
					applySuggestion(displayedSuggestions[targetIndex].prompt);
					return;
				}
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

		// Nota: Alt+Enter e' gestito direttamente in handleKeydown della textarea per inviare con la modalita' alternativa
		// e non deve essere intercettato qui a livello di finestra.

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

		// Alt+N: apre una nuova chat nel progetto attivo
		if (isAltOnly && (keyLower === 'n' || code === 'KeyN')) {
			event.preventDefault();
			onNewChat?.();
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

	async function handleSubmit(behavior?: StreamingBehavior) {
		session.suggestions.invalidate();
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
		await session.prompt(raw, imagesToSend, behavior ?? settingsStore.general.defaultStreamingBehavior);
	}

	function handleKeydown(event: KeyboardEvent) {
		// Alt+Enter: invia con la modalita' opposta al default
		if (event.key === 'Enter' && event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
			if (paletteOpen) {
				// Se la palette e' aperta, lascia che sia essa a gestire l'Enter
				return;
			}
			event.preventDefault();
			void handleSubmit(alternativeBehavior);
			return;
		}

		// Enter: invia con la modalita' predefinita da impostazioni
		if (event.key === 'Enter' && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
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

	const displayedSuggestions = $derived.by<SuggestionChipItem[]>(() =>
		composeSuggestionChips(
			visibleSuggestions(settingsStore.promptSuggestions, MAX_STATIC_CHIPS),
			session.suggestions.items,
			settingsStore.suggestions.maxDynamic
		)
	);

	const showSuggestionChips = $derived(
		visible &&
		text.trim() === '' &&
		!session.isStreaming &&
		attachedImages.length === 0 &&
		!paletteOpen &&
		displayedSuggestions.length > 0
	);

	function applySuggestion(prompt: string) {
		text = prompt;
		paletteOpen = false;
		adjustTextareaHeight();

		void tick().then(() => {
			if (textareaEl) {
				adjustTextareaHeight();
				textareaEl.focus();
				const len = textareaEl.value.length;
				textareaEl.setSelectionRange(len, len);
			}
		});
	}
</script>

<svelte:window onclick={closeMenus} onkeydown={handleWindowKeydown} />

<div class="composer-container" bind:this={composerEl}>
	<!-- Chip dei messaggi in coda -->
	<QueueChips
		queued={session.queued}
		serverCount={session.queuedMessageCount}
	/>
	<!-- Suggerimenti prompt (statici e dinamici) -->
	{#if showSuggestionChips}
		<SuggestionChips
			chips={displayedSuggestions}
			onSelect={applySuggestion}
		/>
	{/if}
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
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
	<div
		class="input-row"
		role="presentation"
		ondrop={handleDrop}
		ondragover={handleDragOver}
		onclick={handleInputRowClick}
	>
		<div class="composer-textarea-wrap">
			<textarea
				bind:this={textareaEl}
				bind:value={text}
				oninput={handleComposerInput}
				onclick={handleCursorMovement}
				onkeyup={handleCursorMovement}
				onscroll={handleCursorMovement}
				onkeydown={handleKeydown}
				onpaste={handlePaste}
				onfocus={() => updateSmoothCursor(true)}
				onblur={() => {
					isCursorFocused = false;
					isCursorBlinking = false;
					if (blinkTimer !== null) {
						window.clearTimeout(blinkTimer);
						blinkTimer = null;
					}
				}}
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
			<!-- Pulsante Invio / Stop / Split Button -->
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
			{:else if session.isStreaming}
				<div class="send-split-wrap" role="group" aria-label="Invio messaggio in coda">
					<button
						type="button"
						class="send-btn send-btn-split"
						title={`Accoda come ${defaultBehaviorLabel} (Invio)`}
						aria-label={`Accoda come ${defaultBehaviorLabel} (Invio)`}
						disabled={!text.trim() && attachedImages.length === 0}
						onclick={() => handleSubmit()}
					>
						<svg viewBox="0 0 16 16" class="btn-icon" aria-hidden="true">
							<path d="M8 12.5V3.5M3.5 8L8 3.5 12.5 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						<span class="send-btn-label">{defaultBehaviorLabel}</span>
					</button>
					<button
						type="button"
						bind:this={sendCaretEl}
						class="send-btn send-caret-btn"
						title="Altre modalità di invio"
						aria-haspopup="menu"
						aria-expanded={activeMenu === 'send'}
						aria-label="Altre modalità di invio"
						disabled={!text.trim() && attachedImages.length === 0}
						onclick={(e) => {
							e.stopPropagation();
							toggleMenu('send');
						}}
					>
						<svg viewBox="0 0 16 16" class="caret-icon" aria-hidden="true">
							<path d="M4 6L8 10L12 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>

					{#if activeMenu === 'send'}
						<div
							class="dropdown-menu send-menu"
							role="menu"
							aria-label="Modalità di invio"
							popover="manual"
							use:anchoredPopover={{ anchor: sendCaretEl, offset: 6, placement: 'bottom-end', constrainHeight: true }}
						>
							<div class="menu-header">
								<span>Modalità di accodamento</span>
							</div>
							<div class="menu-body">
								<button
									type="button"
									class="menu-item send-menu-item"
									class:selected={defaultBehavior === 'steer'}
									role="menuitem"
									onclick={() => {
										activeMenu = null;
										void handleSubmit('steer');
									}}
								>
									<div class="send-menu-item-main">
										<div class="send-menu-item-title">
											<span class="send-mode-name">Steer</span>
											<kbd class="key-shortcut-tag">{defaultBehavior === 'steer' ? 'Invio' : 'Alt+Invio'}</kbd>
										</div>
										<span class="send-mode-desc">Interrompe il turno in corso e subentra subito</span>
									</div>
									{#if defaultBehavior === 'steer'}
										<span class="item-check"><IconCheck /></span>
									{/if}
								</button>
								<button
									type="button"
									class="menu-item send-menu-item"
									class:selected={defaultBehavior === 'followUp'}
									role="menuitem"
									onclick={() => {
										activeMenu = null;
										void handleSubmit('followUp');
									}}
								>
									<div class="send-menu-item-main">
										<div class="send-menu-item-title">
											<span class="send-mode-name">Follow-up</span>
											<kbd class="key-shortcut-tag">{defaultBehavior === 'followUp' ? 'Invio' : 'Alt+Invio'}</kbd>
										</div>
										<span class="send-mode-desc">Attende il completamento del turno in corso</span>
									</div>
									{#if defaultBehavior === 'followUp'}
										<span class="item-check"><IconCheck /></span>
									{/if}
								</button>
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<button
					type="button"
					class="send-btn"
					title={session.isStarting ? 'Invia messaggio (verrà recapitato appena OMP è pronto)' : 'Invia messaggio (Invio)'}
					aria-label="Invia messaggio (Invio)"
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
				bind:this={roleChipEl}
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
				<div
					class="dropdown-menu role-menu"
					role="group"
					aria-label="Ruoli configurati"
					popover="manual"
					use:anchoredPopover={{ anchor: roleChipEl, offset: 6, constrainHeight: true }}
				>
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
				bind:this={modelChipEl}
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
				<div
					class="dropdown-menu model-menu"
					role="group"
					aria-label="Modelli disponibili"
					popover="manual"
					use:anchoredPopover={{ anchor: modelChipEl, offset: 6, constrainHeight: true }}
				>
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
								{@const caps = modelCapabilities(m)}
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
									<span class="model-item-meta">
										{#if m.provider}
											<span class="model-item-provider">{m.provider}</span>
										{/if}
										{#if caps.contextWindow}
											<span
												class="cap-chip ctx"
												role="img"
												title={`Finestra di contesto: ${formatTokens(caps.contextWindow)} token`}
												aria-label={`Contesto ${formatTokens(caps.contextWindow)} token`}
											>
												<IconContextWindow />
												<small>{formatTokens(caps.contextWindow)}</small>
											</span>
										{/if}
										{#if caps.vision}
											<span
												class="cap-chip vision"
												role="img"
												title="Vision: accetta immagini in input"
												aria-label="Vision: accetta immagini in input"
											>
												<IconRoleVision />
											</span>
										{/if}
										{#if caps.thinking}
											<span
												class="cap-chip thinking"
												role="img"
												title={caps.thinkingTitle}
												aria-label={caps.thinkingTitle}
											>
												<IconRoleSlow />
											</span>
										{/if}
									</span>
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
				bind:this={thinkingChipEl}
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
				<div
					class="dropdown-menu thinking-menu"
					role="group"
					aria-label="Livello di thinking"
					popover="manual"
					use:anchoredPopover={{ anchor: thinkingChipEl, offset: 6, constrainHeight: true }}
				>
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

		<!-- Chip Scorciatoie da tastiera -->
		<div class="status-item-wrap">
			<button
				type="button"
				class="status-chip shortcuts-help-chip"
				title="Scorciatoie da tastiera (Alt+H o F1)"
				onclick={(e) => {
					e.stopPropagation();
					shortcutsModalStore.toggle();
				}}
			>
				<span class="chip-label"><IconKeyboard /></span>
				<span class="chip-val shortcut-hint">Alt+H</span>
			</button>
		</div>
	</div>
</div>


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
	/* Split button invio / accodamento */
	.send-split-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.send-btn.send-btn-split {
		width: auto;
		height: 28px;
		padding: 0 var(--space-2);
		gap: var(--space-1);
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		font-weight: 500;
		line-height: 1;
	}

	.send-btn-label {
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: 1;
	}

	.send-btn.send-caret-btn {
		width: 20px;
		height: 28px;
		padding: 0;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-left: 1px solid rgba(255, 255, 255, 0.25);
	}

	.send-btn.send-caret-btn:disabled {
		border-left-color: var(--line);
	}

	.caret-icon {
		width: 12px;
		height: 12px;
		flex-shrink: 0;
	}

	/* Il lato lo decide `anchoredPopover` con `placement: bottom-end`: qui
	   resta solo la larghezza propria del pannello. */
	.send-menu {
		width: 260px;
	}

	.send-menu-item {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2);
	}

	.send-menu-item-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		text-align: left;
	}

	.send-menu-item-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.send-mode-name {
		font-weight: 600;
		font-size: var(--text-xs);
		color: var(--ink);
	}

	.send-mode-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.3;
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


	/* Menu a comparsa. Nel top layer (`popover`) non li taglia nessun
	   `overflow`: da `absolute` con `bottom: 100%` venivano tosati da
	   `.chat-surface` e dalla colonna quando la chat era bassa. Le coordinate
	   e il ribaltamento li calcola `anchoredPopover`. */
	.dropdown-menu {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		/* Lo stile UA di `[popover]` impone `color: CanvasText`. */
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		min-width: 180px;
		max-width: calc(100vw - 2 * var(--space-4));
		max-height: min(360px, var(--anchored-space, 360px));
		overflow: hidden;
	}


	/* Intestazione, ricerca e piede non si comprimono: quando il pannello
	   e' limitato dallo spazio disponibile deve cedere solo il corpo. */
	.menu-header {
		flex-shrink: 0;
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

	/* Il corpo assorbe lo spazio residuo e scorre: con il pannello limitato
	   allo spazio disponibile, senza `min-height: 0` non si comprimerebbe e
	   le ultime voci resterebbero fuori. */
	.menu-body {
		flex: 1 1 auto;
		min-height: 0;
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

	.model-item-meta {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.model-item-provider {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
	}

	/* Stesse icone e stessi colori del selettore modello del task: vision e
	   thinking si riconoscono senza leggere. */
	.cap-chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-base);
		color: var(--ink-muted);
		--icon-size: 11px;
	}

	.cap-chip small {
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 1;
	}

	.cap-chip.ctx {
		color: var(--ink-faint);
	}

	.cap-chip.vision {
		border-color: color-mix(in srgb, oklch(0.68 0.16 195) 30%, transparent);
		color: oklch(0.78 0.13 195);
	}

	.cap-chip.thinking {
		border-color: color-mix(in srgb, oklch(0.65 0.18 290) 30%, transparent);
		color: oklch(0.78 0.14 290);
	}

	.menu-loading,
	.menu-empty {
		padding: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-align: center;
	}

	/* Barra di ricerca nel menu modelli */
	.menu-search-wrap {
		flex-shrink: 0;
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
		flex-shrink: 0;
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
