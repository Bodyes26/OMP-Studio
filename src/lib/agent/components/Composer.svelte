<script lang="ts">
	/**
	 * Composer v2 (Gate R32).
	 * Editor contenteditable a badge per @file e /comando, barra strumenti con
	 * allegati, @, ruolo, modello, thinking, anello di contesto e pulsante Invio/Stop.
	 */
	import type { AgentSession, QueuedMessage } from '$lib/agent/session.svelte';
	import type { ImageContent, ModelInfo, ThinkingLevel, AvailableCommand, RestoredQueuedMessage } from '$lib/agent/wire';
	import { restoreBesideDraft, restoredQueueImages, restoredQueueText } from '$lib/agent/queueRestore';
	import { modelSupportsImages, modelSupportsReasoning } from '$lib/agent/wire';
	import { STUDIO_SLASH_COMMANDS, mergeCommands } from '$lib/agent/commands';
	import {
		SUGGEST_WIDTH,
		commandSuggestions,
		fileSuggestions,
		isSkillName,
		suggestKeyAction
	} from '$lib/agent/suggestItems';
	import {
		loadProjectFiles,
		rankFileCandidates,
		extractTouchedFilesFromTranscript,
		computeCaretAnchorLeft,
		type RankedFileItem
	} from '$lib/agent/fileMention';
	import {
		parsePlainTextToSegments,
		createFileBadgeElement,
		createCommandBadgeElement,
		type ComposerSegment,
		type ComposerTrigger
	} from '$lib/agent/composerDoc';
	import { prepareImage, isImageFile } from '$lib/agent/images';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { settingsStore, type StreamingBehavior } from '$lib/stores/settings.svelte';
	import {
		visibleSuggestions,
		composeSuggestionChips,
		MAX_STATIC_CHIPS,
		type SuggestionChipItem
	} from '$lib/stores/promptSuggestions';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { splitModelSelector, resolveActiveRole, supportedThinkingLevels } from '$lib/stores/modelSettingsHelpers';
	import { shortcutsModalStore } from '$lib/stores/shortcutsModal.svelte';
	import { isTypingSurface } from '$lib/agent/askFocus';
	import { resolveContextWindow } from '$lib/agent/contextReport';
	import { formatTokens } from '$lib/utils/format';
	import { invoke } from '@tauri-apps/api/core';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import {
		MAX_STAGED_ATTACHMENT_BYTES,
		base64ToBlob,
		isPreviewableImagePath,
		pathBaseName,
		readImageErrorCode,
		readImageErrorMessage,
		stageAttachmentHeaders,
		uniquePaths,
		type DroppedImage
	} from '$lib/agent/chatDrop';
	import { untrack } from 'svelte';
	import { routeComposerSubmit, remainingAfterSend } from '$lib/agent/composerSubmit';
	import { TwoStepStop } from '$lib/agent/twoStepStop';
	import { composerChord, yieldsToShellShortcut } from '$lib/agent/composerShortcuts';
	import { IS_MAC } from '$lib/utils/platform';
	import { m } from '$lib/paraglide/messages.js';

	import ComposerEditor from './ComposerEditor.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import ThinkingMeter from './ThinkingMeter.svelte';
	import ReasoningSlider from '$lib/components/models/ReasoningSlider.svelte';
	import ModelPickerList from '$lib/components/models/ModelPickerList.svelte';
	import RoleMenu, { type RoleAssignment } from './RoleMenu.svelte';
	import ContextPanel from './ContextPanel.svelte';
	import AttachMenu from './AttachMenu.svelte';
	import AttachmentThumb, { type ComposerAttachment } from './AttachmentThumb.svelte';
	import SuggestPanel, { type SuggestionItem } from './SuggestPanel.svelte';
	import SuggestionChips from './SuggestionChips.svelte';
	import ComposerNoticeStrip from './ComposerNoticeStrip.svelte';
	import ModesMenu from './ModesMenu.svelte';

	import {
		IconAttach,
		IconAt,
		IconArrowUp,
		IconStop,
		IconWarning,
		IconChevronUp,
		IconSparkles,
		IconPrewalk,
		IconRefresh
	} from '$lib/icons';

	let {
		session,
		visible = true,
		dropTarget = false,
		onSlashCommand,
		onNewChat
	} = $props<{
		session: AgentSession;
		visible?: boolean;
		/** Un trascinamento dal sistema operativo e' sopra la chat: evidenzia la sagoma. */
		dropTarget?: boolean;
		onSlashCommand?: (raw: string) => boolean;
		onNewChat?: () => void;
	}>();

	// Convertitore esportato per trasformare ImageContent del protocollo wire in ComposerAttachment
	export function imageContentToAttachment(img: ImageContent): ComposerAttachment {
		const mime = img.mimeType || 'image/jpeg';
		return {
			id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			kind: 'image',
			name: 'image.jpg',
			size: Math.round((img.data.length * 3) / 4),
			url: `data:${mime};base64,${img.data}`,
			mimeType: mime,
			base64: img.data,
			tokens: 1600
		};
	}

	let rootEl = $state<HTMLDivElement | null>(null);
	let editorRef = $state<ReturnType<typeof ComposerEditor> | null>(null);
	let controlsStripEl = $state<HTMLDivElement | null>(null);
	type MenuKind = 'attach' | 'role' | 'model' | 'thinking' | 'modes' | 'context' | 'sendMode' | null;
	let activeMenu = $state<MenuKind>(null);

	let attachments = $state<ComposerAttachment[]>([]);
	let draftRevision = $state(0);
	let availableModels = $state<ModelInfo[]>([]);

	let currentTrigger = $state<ComposerTrigger | null>(null);

	let suggestItems = $state<SuggestionItem[]>([]);
	let suggestIndex = $state(0);

	// Stop a due stadi: abort, poi «Forza arresto» se l'agente non si ferma.
	let stopArmed = $state(false);
	const stopControl = new TwoStepStop({
		abort: () => session.abort(),
		forceKill: () => session.forceKill(),
		onChange: (armed) => (stopArmed = armed),
		setTimer: (callback, ms) => window.setTimeout(callback, ms),
		clearTimer: (handle) => window.clearTimeout(handle as number)
	});
	// Fine reale del turno, processo uscito o sessione cambiata: niente da forzare.
	$effect(() => {
		void session;
		void session.runEndSeq;
		void session.exited;
		void session.sessionId;
		stopControl.settle();
	});
	$effect(() => () => stopControl.settle());
	// Un turno nuovo riparte dal primo stadio: senza, uno stato armato rimasto
	// dal turno precedente (abort chiuso dal timer di sicurezza, senza agent_end)
	// farebbe uccidere omp al primo clic invece di tentare l'interruzione.
	let wasStreaming = false;
	$effect(() => {
		const streaming = session.isStreaming;
		if (streaming && !wasStreaming) stopControl.settle();
		wasStreaming = streaming;
	});

	let sendBehaviorChoice = $state<StreamingBehavior>(settingsStore.general.defaultStreamingBehavior);
	$effect(() => {
		sendBehaviorChoice = settingsStore.general.defaultStreamingBehavior;
	});

	// Catalogo unificato dei comandi
	const allCommands = $derived.by(() => {
		return mergeCommands(STUDIO_SLASH_COMMANDS, session.availableCommands);
	});

	function isSkillCommand(name: string): boolean {
		return isSkillName(allCommands, name);
	}

	// Caricamento modelli disponibili. Il composer e' visibile prima che la
	// sessione RPC sia aperta: `send` lanciava, l'errore veniva ingoiato e,
	// senza dipendere da `isReady`, la lista restava vuota per sempre.
	// Si ricarica anche a ogni apertura del menu: un login dalle impostazioni
	// aggiunge modelli a sessione gia' avviata.
	const modelMenuOpen = $derived(activeMenu === 'model');
	let modelsLoadedFor: AgentSession | null = null;
	$effect(() => {
		const target = session;
		if (!visible || !target.isReady) return;
		if (!modelMenuOpen && modelsLoadedFor === target) return;
		void (async () => {
			try {
				const res = await target.client.send({ type: 'get_available_models' });
				if (target !== session) return;
				if (Array.isArray(res)) {
					availableModels = res as ModelInfo[];
				} else if (res && typeof res === 'object' && 'models' in res && Array.isArray((res as { models: unknown }).models)) {
					availableModels = (res as { models: ModelInfo[] }).models;
				}
				modelsLoadedFor = target;
			} catch {
				// Fallback silente: resta l'ultimo elenco caricato
			}
		})();
	});

	// Senza configurazione caricata le assegnazioni sono vuote e il ruolo mostrato
	// resterebbe 'default' fino alla prima apertura delle impostazioni modelli.
	$effect(() => {
		if (visible) void modelSettingsStore.ensureConfigAndCatalog();
	});

	const rolesMap = $derived(modelSettingsStore.config?.modelRoles || modelSettingsStore.draftConfig?.modelRoles || {});
	// Assegnazioni ruoli dal settings store
	const roleAssignments = $derived.by(() => {
		const out: Record<string, RoleAssignment> = {};
		for (const [rId, sel] of Object.entries(rolesMap)) {
			if (typeof sel === 'string') {
				const { base, thinking } = splitModelSelector(sel, modelSettingsStore.knownSelectors);
				out[rId] = { model: base, thinking: thinking ?? undefined };
			}
		}
		return out;
	});
	// Il ruolo e' una configurazione Studio, non uno stato del protocollo RPC.
	const activeRole = $derived(
		resolveActiveRole(
			rolesMap,
			session.model,
			session.thinkingLevel,
			session.lastPickedRole,
			modelSettingsStore.knownSelectors
		) ?? 'default'
	);

	const contextTooltip = $derived.by(() => {
		const base = m.chat_v2_composer_context_title();
		const total = session.totalCost;
		if (total === null || total <= 0) return base;
		if (session.subagentCost > 0) {
			const split = m.chat_session_cost_split({
				own: `$${(session.sessionCost ?? 0).toFixed(4)}`,
				subagents: `$${session.subagentCost.toFixed(4)}`
			});
			return `${base} · $${total.toFixed(4)} (${split})`;
		}
		return `${base} · $${total.toFixed(4)}`;
	});


	// Aggiornamento suggerimenti palette
	$effect(() => {
		if (!currentTrigger) {
			suggestItems = [];
			suggestIndex = 0;
			return;
		}

		const q = currentTrigger.query;
		if (currentTrigger.kind === '@') {
			const projectPath = projectStore.activeProject?.lane.workspacePath;
			if (!projectPath) {
				suggestItems = [];
				return;
			}

			const trigger = currentTrigger;
			void loadProjectFiles(projectPath).then((files) => {
				// Una risposta arrivata dopo altri tasti non deve sovrascrivere
				// la palette della query corrente (o riaprirne una chiusa).
				if (
					!currentTrigger ||
					currentTrigger.kind !== trigger.kind ||
					currentTrigger.query !== trigger.query
				) {
					return;
				}
				const context = {
					activeFile: projectStore.activeProject?.lane.activeFile,
					openFiles: projectStore.activeProject?.lane.openFiles,
					touchedFiles: extractTouchedFilesFromTranscript(session.entries)
				};
				suggestItems = fileSuggestions(rankFileCandidates(q, files, context, 8));
				suggestIndex = 0;
			});
		} else {
			suggestItems = commandSuggestions(allCommands, q);
			suggestIndex = 0;
		}
	});

	// La palette si apre sopra la riga in cui si sta scrivendo, allineata al trigger,
	// non sopra l'intero composer: l'occhio resta dove c'e' il cursore.
	const suggestAnchor = $derived.by(() => {
		if (!currentTrigger || !rootEl) return { left: 0, bottom: 0 };
		const rootRect = rootEl.getBoundingClientRect();
		return {
			left: computeCaretAnchorLeft(currentTrigger.caretRect, rootRect, SUGGEST_WIDTH),
			bottom: Math.max(0, rootRect.bottom - currentTrigger.caretRect.top + 6)
		};
	});

	// Identificazione comando corrente nel testo per banner argomenti
	const currentSegments = $derived.by(() => {
		draftRevision;
		return editorRef?.getSegments() ?? [];
	});
	const activeCmdSeg = $derived(currentSegments.find((s) => s.t === 'cmd') as { t: 'cmd'; name: string } | undefined);
	const activeCmdDef = $derived.by(() => {
		if (!activeCmdSeg) return null;
		const clean = activeCmdSeg.name.replace(/^skill:/, '');
		return allCommands.find((c) => c.name.toLowerCase() === clean.toLowerCase()) ?? null;
	});

	// Il rapporto di /context si chiede solo a pannello aperto: e' un prompt
	// locale sulla coda RPC e non deve partire a ogni turno.
	$effect(() => {
		if (!visible || activeMenu !== 'context') return;
		void session.isReady;
		void session.isAttached;
		void session.isStreaming;
		void session.isCompacting;
		void session.sessionId;
		void session.model?.id;
		void session.contextUsage?.tokens;
		void session.contextUsage?.contextWindow;
		void session.availableCommands;
		void session.refreshContextReport();
	});

	// Stima token della bozza corrente
	const draftTokensEstimate = $derived.by(() => {
		let total = 0;
		for (const seg of currentSegments) {
			if (seg.t === 'text') total += Math.round(seg.s.length / 4);
			else if (seg.t === 'file') total += 60;
			else if (seg.t === 'cmd') total += 30;
		}
		for (const att of attachments) {
			total += att.tokens;
		}
		return total;
	});

	// Avviso visivo quando il modello non supporta immagini ma sono presenti immagini o video
	const hasVisualAttachments = $derived(attachments.some((a) => a.kind === 'image' || a.kind === 'video'));
	const visualNoVisionWarning = $derived(hasVisualAttachments && !modelSupportsImages(session.model));

	// Aggiunta file generici e immagini
	export async function addFiles(files: FileList | File[]): Promise<void> {
		const list = Array.from(files);
		for (const file of list) {
			if (isImageFile(file)) {
				const prep = await prepareImage(file);
				if ('data' in prep) {
					attachments = [
						...attachments,
						{
							id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
							kind: 'image',
							name: file.name,
							size: file.size,
							url: `data:${prep.mimeType};base64,${prep.data}`,
							mimeType: prep.mimeType,
							base64: prep.data,
							tokens: 1600
						}
					];
				} else {
					session.flashNotice('warning', prep.error);
				}
			} else {
				const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
				// Il limite si controlla prima di leggere: un file enorme non deve
				// passare per la memoria della WebView solo per essere rifiutato.
				if (file.size > MAX_STAGED_ATTACHMENT_BYTES) {
					session.flashNotice(
						'warning',
						m.chat_v2_composer_attachment_too_large({
							name: file.name,
							limit: String(MAX_STAGED_ATTACHMENT_BYTES / (1024 * 1024))
						})
					);
					continue;
				}
				try {
					// IPC grezzo: i byte viaggiano come corpo binario, i metadati negli header.
					const bytes = new Uint8Array(await file.arrayBuffer());
					const staged = await invoke<{ path: string; name: string; size: number }>('stage_chat_attachment', bytes, {
						headers: stageAttachmentHeaders(session.sessionKey, file.name)
					});
					const objUrl = isVideo ? URL.createObjectURL(file) : undefined;
					attachments = [
						...attachments,
						{
							id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
							kind: isVideo ? 'video' : 'file',
							name: staged.name,
							size: staged.size,
							url: objUrl,
							path: staged.path,
							tokens: isVideo ? 9000 : Math.min(40000, Math.round(staged.size / 4))
						}
					];
				} catch (err) {
					session.flashNotice(
						'error',
						m.chat_v2_composer_attachment_failed({ error: err instanceof Error ? err.message : String(err) })
					);
				}
			}
		}
	}

	/**
	 * File e cartelle dal sistema operativo (trascinati o scelti dal
	 * selettore): ognuno diventa una menzione `@` con il percorso assoluto,
	 * come quelle della palette. Nessuna copia e nessun limite: omp legge il
	 * file da se'. Le immagini fino a 5 MB si allegano anche come immagine,
	 * perche' il modello le veda.
	 */
	export async function addPaths(paths: readonly string[]): Promise<void> {
		const list = uniquePaths(paths);
		if (list.length === 0 || !editorRef) return;
		editorRef.insertBadges(list.map((path) => createFileBadgeElement(path)));
		for (const path of list) {
			if (isPreviewableImagePath(path)) await attachImageFromPath(path);
		}
	}

	async function attachImageFromPath(path: string): Promise<void> {
		const name = pathBaseName(path);
		try {
			const image = await invoke<DroppedImage>('chat_attachment_read_image', { path });
			const prep = await prepareImage(base64ToBlob(image.base64, image.mimeType));
			if (!('data' in prep)) {
				session.flashNotice('warning', m.chat_v2_drop_image_failed({ name, error: prep.error }));
				return;
			}
			attachments = [
				...attachments,
				{
					id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
					kind: 'image',
					name,
					size: image.size,
					url: `data:${prep.mimeType};base64,${prep.data}`,
					mimeType: prep.mimeType,
					base64: prep.data,
					path,
					tokens: 1600
				}
			];
		} catch (err) {
			const code = readImageErrorCode(err);
			// Il file resta citato per percorso: oltre 5 MB lo si dice, un file
			// che solo nel nome sembra un'immagine non merita un avviso.
			if (code === 'too_large') session.flashNotice('info', m.chat_v2_drop_image_too_large({ name }));
			else if (code !== 'not_image') {
				session.flashNotice('warning', m.chat_v2_drop_image_failed({ name, error: readImageErrorMessage(err) }));
			}
		}
	}

	/** Il pulsante allega usa il selettore nativo: restituisce percorsi, come il trascinamento. */
	async function pickFromDialog(directory: boolean): Promise<void> {
		activeMenu = null;
		try {
			const picked = await openDialog({ multiple: true, directory });
			const list = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
			await addPaths(list);
			focus();
		} catch (err) {
			session.flashNotice(
				'error',
				m.chat_v2_composer_attach_dialog_failed({ error: err instanceof Error ? err.message : String(err) })
			);
		}
	}

	function removeAttachment(id: string | number) {
		releaseAttachments(attachments.filter((a) => a.id === id));
		attachments = attachments.filter((a) => a.id !== id);
	}

	/** Gli URL blob dei video tengono in memoria l'intero file finche' non si revocano. */
	function releaseAttachments(list: readonly ComposerAttachment[]): void {
		for (const att of list) {
			if (att.url?.startsWith('blob:')) URL.revokeObjectURL(att.url);
		}
	}
	// Solo alla distruzione: l'effetto non ha dipendenze e la lettura avviene nel teardown.
	$effect(() => () => releaseAttachments(untrack(() => attachments)));

	// Selezione voce dalla tendina
	function pickSuggestion(item: SuggestionItem) {
		if (!currentTrigger || !editorRef) return;

		if (item.kind === 'file') {
			const badge = createFileBadgeElement(item.item.path);
			editorRef.replaceTrigger(badge, currentTrigger);
			currentTrigger = null;
		} else if (item.kind === 'cmd') {
			const cmd = item.command;
			const isImmediate =
				!item.isSkill && ['new', 'copy', 'model', 'role', 'thinking'].includes(cmd.name);

			if (isImmediate) {
				editorRef.replaceTrigger(null, currentTrigger);
				currentTrigger = null;
				executeImmediateCommand(cmd.name);
			} else {
				const badge = createCommandBadgeElement(cmd.name);
				editorRef.replaceTrigger(badge, currentTrigger);
				currentTrigger = null;
			}
		}
	}

	function executeImmediateCommand(name: string) {
		if (name === 'model' || name === 'role' || name === 'thinking') {
			activeMenu = name;
			return;
		}
		if (onSlashCommand?.(`/${name}`)) return;
		if (name === 'new') {
			clear();
			if (onNewChat) onNewChat();
			else void session.newSession();
		}
	}

	// Livelli offerti dalla sessione: «auto» esiste solo per task e ruoli. Si
	// mostrano solo gli sforzi che il modello attivo accetta; la scala intera
	// resta per i modelli che non li dichiarano.
	const CHAT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
	const chatThinkingLevels = $derived<readonly ThinkingLevel[]>(
		supportedThinkingLevels(session.model) ?? CHAT_THINKING_LEVELS
	);

	function cycleThinkingLevel() {
		const levels = chatThinkingLevels;
		const current = session.thinkingLevel || 'off';
		const next = levels[(levels.indexOf(current) + 1) % levels.length];
		void session.client.send({
			type: 'set_thinking_level',
			level: next
		}).then(() => session.refreshState());
	}

	/**
	 * Se la striscia controlli ha overflow orizzontale e l'utente usa la rotellina
	 * verticale senza asse orizzontale, converte il movimento in scorrimento orizzontale.
	 */
	function handleStripWheel(e: WheelEvent) {
		if (!controlsStripEl) return;
		if (e.deltaY && !e.deltaX) {
			if (controlsStripEl.scrollWidth > controlsStripEl.clientWidth) {
				e.preventDefault();
				controlsStripEl.scrollLeft += e.deltaY;
			}
		}
	}

	/**
	 * Richiama in bozza l'ultimo messaggio in coda: esce dalla coda di omp
	 * (`remove_queued_message`) e torna nell'editor accanto alla bozza. La
	 * gesture ha senso a bozza vuota, come il dequeue della TUI.
	 */
	async function recallQueuedMessage(chip: QueuedMessage) {
		const restored = await session.removeQueuedMessage(chip.text, chip.queue);
		if (restored) restoreQueue([restored]);
	}

	// Filtro tasti editor
	function handleKeydownFilter(e: KeyboardEvent): boolean {
		if (e.altKey && e.key === 'ArrowUp' && isDraftEmpty()) {
			const chip = session.lastQueuedMessage();
			if (chip) {
				e.preventDefault();
				void recallQueuedMessage(chip);
				return true;
			}
		}
		if (currentTrigger && suggestItems.length > 0) {
			const action = suggestKeyAction(e, suggestItems.length, suggestIndex);
			if (action?.kind === 'move') suggestIndex = action.index;
			else if (action?.kind === 'pick') {
				const target = suggestItems[suggestIndex];
				if (target) pickSuggestion(target);
			} else if (action?.kind === 'dismiss') {
				if (editorRef) editorRef.dismissCurrentTrigger(currentTrigger);
				currentTrigger = null;
			}
			if (action) return true;
		}

		if (e.key === 'Tab' && e.shiftKey) {
			e.preventDefault();
			cycleThinkingLevel();
			return true;
		}

		return false;
	}

	// Scorciatoie della superficie GUI (docs/SHORTCUTS.md). Ascoltate sulla finestra
	// perche' valgono anche con il fuoco fuori dal composer; chi scrive in un'altra
	// superficie (Monaco, terminale, AskCard) tiene i propri tasti.
	function handleWindowKeydown(e: KeyboardEvent) {
		if (!visible || e.defaultPrevented || e.isComposing) return;
		const activeEl = document.activeElement;
		const insideComposer = !!rootEl && activeEl instanceof Node && rootEl.contains(activeEl);
		if (!insideComposer && (isTypingSurface(e.target) || isTypingSurface(activeEl))) return;
		if (settingsStore.open || modelSettingsStore.isOpen || shortcutsModalStore.isOpen) return;

		// Alt+lettera su Windows/Linux, Ctrl+Opzione+lettera su Mac: Opzione da
		// sola scrive caratteri (€ ç ñ) e non va rubata.
		const chord = composerChord(e, IS_MAC);
		if (chord === null) return;
		const ctrlOnly = chord === 'command';
		// e.code prima di e.key: con Alt alcuni layout producono caratteri speciali.
		const key = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
		if (chord === 'letter' && yieldsToShellShortcut(key, IS_MAC, insideComposer)) return;

		if (ctrlOnly) {
			if (key === 'p') {
				// Senza preventDefault la WebView apre la stampa.
				e.preventDefault();
				onSlashCommand?.('/role next');
			} else if (key === 'c' && (session.isStreaming || stopArmed) && !window.getSelection()?.toString()) {
				e.preventDefault();
				stopControl.press();
			}
			return;
		}

		const digit = /^(?:Digit|Numpad)([1-6])$/.exec(e.code)?.[1];
		if (digit) {
			const chip = showSuggestionChips ? displayedSuggestions[Number(digit) - 1] : undefined;
			if (chip) {
				e.preventDefault();
				insertComposerText(chip.prompt);
				focus();
			}
			return;
		}

		const toggle = (menu: 'role' | 'model' | 'thinking') => {
			activeMenu = activeMenu === menu ? null : menu;
		};
		switch (key) {
			case 'r':
				toggle('role');
				break;
			case 'p':
				toggle('model');
				break;
			case 'm':
				toggle('thinking');
				break;
			case 't':
				cycleThinkingLevel();
				break;
			case 'c':
				if (session.isStreaming || stopArmed) stopControl.press();
				else clear();
				break;
			case 'e':
				focus();
				break;
			case 'n':
				executeImmediateCommand('new');
				break;
			default:
				return;
		}
		e.preventDefault();
	}

	// Invio del messaggio: la bozza rimane intatta finche' omp o la coda locale accettano.
	let submitting = false;
	async function handleSubmit(isAlt = false) {
		if (!editorRef || submitting || isDraftEmpty()) return;
		submitting = true;
		// Un nuovo invio chiude l'esito precedente, errori compresi.
		session.dismissComposerNotice();
		try {
			let wireText = editorRef.getWireText(isSkillCommand);
			// I comandi di Studio passano dal guscio prima di omp; cio' che il
			// guscio non riconosce (skill, comandi delle estensioni) va a omp.
			const route = routeComposerSubmit(wireText);
			if (route.kind === 'studio' && onSlashCommand?.(route.raw)) {
				// Il comando consuma solo il testo: allegati e immagini restano per
				// il prossimo messaggio invece di sparire senza essere mai partiti.
				if (editorRef) editorRef.clear();
				currentTrigger = null;
				return;
			}
			const sent = [...attachments];
			const stagedNonImages = sent.filter((a) => a.path && a.kind !== 'image');
			if (stagedNonImages.length > 0) {
				const pathsBlock = stagedNonImages.map((a) => `- ${a.path}`).join('\n');
				wireText = wireText
					? `${wireText}\n\n${m.chat_v2_composer_attachments_block()}\n${pathsBlock}`
					: pathsBlock;
			}
			const imagesToSend: ImageContent[] = sent
				.filter((a) => a.kind === 'image' && a.base64)
				.map((a) => ({ type: 'image', data: a.base64!, mimeType: a.mimeType || 'image/jpeg' }));
			let behavior: StreamingBehavior = sendBehaviorChoice;
			if (isAlt) behavior = behavior === 'steer' ? 'followUp' : 'steer';
			const result = await session.prompt(wireText, imagesToSend, behavior);
			if (result === 'sent' || result === 'deferred') clearAfterSend(sent);
		} catch (error) {
			session.flashNotice(
				'error',
				m.chat_v2_composer_prompt_rejected({ error: error instanceof Error ? error.message : String(error) })
			);
		} finally {
			submitting = false;
		}
	}

	export function isDraftEmpty(): boolean {
		return (!editorRef || editorRef.getIsEmpty()) && attachments.length === 0;
	}


	export function clear(): void {
		if (editorRef) editorRef.clear();
		releaseAttachments(attachments);
		attachments = [];
		currentTrigger = null;
	}

	/** Dopo l'invio restano gli allegati aggiunti mentre la richiesta era in volo. */
	function clearAfterSend(sent: ComposerAttachment[]): void {
		if (editorRef) editorRef.clear();
		releaseAttachments(sent);
		attachments = remainingAfterSend(attachments, sent);
		currentTrigger = null;
	}

	export function focus(): void {
		editorRef?.focus();
	}

	export function insertComposerText(text: string): void {
		if (editorRef) {
			editorRef.setPlainText(text, isSkillCommand);
		}
	}

	// Testo da altre superfici (Laboratorio, «Chiedi all'agente»): entra alla
	// posizione del cursore e non sostituisce la bozza in corso.
	$effect(() => {
		const target = session;
		return target.registerComposerInsertHandler((text: string) => {
			editorRef?.insertPlainText(text, isSkillCommand);
		});
	});

	// L'input ritirato dalla coda (Stop, modifica di un chip) torna qui: la
	// sessione conosce il protocollo, il composer conosce l'editor.
	$effect(() => {
		const target = session;
		return target.registerQueueRestoreHandler((entries: readonly RestoredQueuedMessage[]) => restoreQueue(entries));
	});

	/**
	 * Riporta nell'editor l'input ritirato dalla coda di omp: il testo si
	 * accoda alla bozza corrente (una riga vuota in mezzo), le immagini vanno
	 * negli allegati. Sostituisce il vecchio ripristino a bozza vuota, che
	 * rifiutava di lavorare con una bozza presente e perdeva il messaggio.
	 */
	export function restoreQueue(entries: readonly RestoredQueuedMessage[]): void {
		if (!editorRef) return;
		const restored = restoredQueueText(entries);
		const images = restoredQueueImages(entries);
		if (!restored && images.length === 0) return;
		const draft = editorRef.getWireText(isSkillCommand);
		editorRef.setPlainText(restoreBesideDraft(draft, restored), isSkillCommand);
		if (images.length > 0) attachments = [...attachments, ...images.map(imageContentToAttachment)];
		focus();
	}

	const canSend = $derived(currentSegments.some((s) => s.t !== 'text' || s.s.trim().length > 0) || attachments.length > 0);
	const placeholderText = $derived(
		session.isStreaming
			? m.chat_v2_composer_placeholder_busy()
			: m.chat_v2_composer_placeholder_idle()
	);

	// Chip di risposta: le statiche configurate davanti, poi quelle generate dal
	// modello leggero sull'ultimo turno (anche quando l'agente chiude con una
	// domanda senza tool ask). Solo ad agente fermo e bozza vuota: una chip
	// sostituisce il testo, non deve cancellare quello che si sta scrivendo.
	const displayedSuggestions = $derived.by<SuggestionChipItem[]>(() =>
		composeSuggestionChips(
			visibleSuggestions(settingsStore.promptSuggestions, MAX_STATIC_CHIPS),
			session.suggestions.items,
			settingsStore.suggestions.maxDynamic
		)
	);
	const showSuggestionChips = $derived(
		visible && !session.isStreaming && !canSend && !currentTrigger && displayedSuggestions.length > 0
	);

	// Stato e controlli Prewalk
	const isLab = $derived(Boolean(session.labConfig));
	const smolConfigured = $derived(modelSettingsStore.config?.modelRoles?.smol?.trim() || '');
	const smolEmpty = $derived(!smolConfigured);
	const smolFallbacks = $derived(modelSettingsStore.config?.fallbackChains?.smol || []);
	const prewalkState = $derived(session.prewalk?.state ?? 'off');
	const prewalkTarget = $derived(session.prewalk.target || '');
	const handedOffTo = $derived(session.prewalk?.handedOffTo || session.model?.name || session.model?.id || '');
	const isPrewalkBusy = $derived(session.prewalkBusy || !session.isReady);

	const prewalkTooltipText = $derived.by(() => {
		if (smolEmpty) return m.chat_v2_composer_prewalk_missing_smol();
		if (session.prewalkBusy) return m.chat_v2_composer_prewalk_busy();
		if (smolFallbacks.length > 0) {
			return m.chat_v2_composer_prewalk_tooltip_with_fallbacks({
				smol: smolConfigured,
				fallbacks: smolFallbacks.join(', ')
			});
		}
		return m.chat_v2_composer_prewalk_tooltip({ smol: smolConfigured });
	});

	const prewalkAriaLabel = $derived.by(() => {
		if (prewalkState === 'off') return m.chat_v2_composer_prewalk_arm_aria();
		return m.chat_v2_composer_prewalk_disarm_aria();
	});

	async function handlePrewalkClick() {
		if (prewalkState === 'off') {
			try {
				await session.armPrewalk();
			} catch (err) {
				session.pushNotice('error', err instanceof Error ? err.message : String(err), 'prewalk');
			}
		} else {
			try {
				await session.disarmPrewalk();
			} catch (err) {
				session.pushNotice('error', err instanceof Error ? err.message : String(err), 'prewalk');
			}
		}
	}

	async function handleRestartPrewalk() {
		try {
			await session.restartPrewalk();
		} catch (err) {
			session.pushNotice('error', err instanceof Error ? err.message : String(err), 'prewalk');
		}
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<!-- Il trascinamento dal sistema operativo arriva come evento nativo di
     Tauri e lo gestisce Chat.svelte (addPaths): i gestori HTML non ricevono file. -->
<div bind:this={rootEl} class="composer-root" class:hidden={!visible}>
	<ComposerNoticeStrip {session} />

	<!-- Suggerimenti prompt (visibili solo quando l'agente è fermo) -->
	{#if showSuggestionChips}
		<SuggestionChips
			chips={displayedSuggestions}
			onSelect={(prompt) => {
				insertComposerText(prompt);
				focus();
			}}
		/>
	{/if}

	<!-- Tendina suggerimenti @ o / ancorata sul Range rect del cursore -->
	{#if currentTrigger && suggestItems.length > 0}
		<SuggestPanel
			kind={currentTrigger.kind}
			query={currentTrigger.query}
			items={suggestItems}
			selectedIndex={suggestIndex}
			left={suggestAnchor.left}
			bottom={suggestAnchor.bottom}
			onPick={pickSuggestion}
			onHover={(idx) => (suggestIndex = idx)}
		/>
	{/if}

	<!-- Riquadro principale del composer -->
	<div class="composer-shell" class:dragging={dropTarget}>
		<!-- Striscia informativa per comando/skill attivo con argomenti -->
		{#if activeCmdDef}
			<div class="cmd-strip rv-blur" style="--dur: 200ms; --blur: 4px;">
				<span class="cmd-strip-icon">
					{#if isSkillCommand(activeCmdDef.name)}
						<IconSparkles />
					{:else}
						<span class="font-mono">/</span>
					{/if}
				</span>
				<span class="cmd-strip-name font-mono">/{activeCmdDef.name}</span>
				<span class="cmd-strip-desc">{activeCmdDef.description}</span>
				{#if activeCmdDef.input?.hint}
					<span class="cmd-strip-hint font-mono">‹{activeCmdDef.input.hint}›</span>
				{/if}
			</div>
		{/if}

		<!-- Riquadro allegati (miniature immagini, video e file) -->
		{#if attachments.length > 0}
			<div class="attachments-row">
				{#each attachments as att (att.id)}
					<AttachmentThumb
						attachment={att}
						onRemove={() => removeAttachment(att.id)}
					/>
				{/each}
			</div>
		{/if}

		<!-- Striscia avviso per modelli senza supporto visione -->
		{#if visualNoVisionWarning}
			<div class="vision-warning-strip">
				<IconWarning />
				<span>{m.chat_v2_composer_vision_warning({ model: session.model?.name || session.model?.id || m.chat_v2_composer_model_fallback() })}</span>
				<button type="button" class="change-model-btn" onclick={() => (activeMenu = 'model')}>
					{m.chat_v2_composer_change_model()}
				</button>
			</div>
		{/if}

		<!-- Editor di testo a badge contenteditable -->
		<ComposerEditor
			bind:this={editorRef}
			placeholder={placeholderText}
			onSend={(isAlt) => handleSubmit(isAlt)}
			onFilesPaste={(files) => void addFiles(files)}
			onTriggerChange={(tr) => (currentTrigger = tr)}
			onKeydownFilter={handleKeydownFilter}
			onInput={() => (draftRevision += 1)}
		/>

		<!-- Barra inferiore: controlli modello, ruolo, allegati, contesto, invio -->
		<div class="composer-toolbar">
			<!-- Azioni primarie fisse a sinistra: allegati e menzione @ -->
			<div class="toolbar-left">
				<!-- Allega file -->
				<MenuButton
					open={activeMenu === 'attach'}
					title={m.chat_v2_composer_attach_title()}
					hasPopup="menu"
					width="260px"
					onToggle={() => (activeMenu = activeMenu === 'attach' ? null : 'attach')}
					onClose={() => (activeMenu = null)}
				>
					{#snippet trigger()}
						<span class="toolbar-attach-icon"><IconAttach /></span>
					{/snippet}
					{#snippet children()}
						<AttachMenu
							onPickFiles={() => void pickFromDialog(false)}
							onPickFolder={() => void pickFromDialog(true)}
						/>
					{/snippet}
				</MenuButton>

				<!-- Menzione file @ -->
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
			</div>

			<span class="toolbar-divider" aria-hidden="true"></span>

			<!-- Striscia controlli sessione a scorrimento orizzontale (ruolo, modello, thinking, prewalk) -->
			<div
				class="toolbar-controls-strip"
				bind:this={controlsStripEl}
				onwheel={handleStripWheel}
				tabindex="-1"
			>

			<!-- Menu Ruolo -->
			<MenuButton
				open={activeMenu === 'role'}
				title={m.chat_v2_composer_role_title()}
				hasPopup="listbox"
				width="420px"
				onToggle={() => (activeMenu = activeMenu === 'role' ? null : 'role')}
				onClose={() => (activeMenu = null)}
			>
				{#snippet trigger()}
					<span class="active-role-dot"></span>
					<span class="role-name font-mono">{activeRole}</span>
				{/snippet}
				{#snippet children()}
					<RoleMenu
						activeRole={activeRole}
						assignments={roleAssignments}
						onPick={(roleId) => {
							activeMenu = null;
							onSlashCommand?.(`/role ${roleId}`);
						}}
					/>
				{/snippet}
			</MenuButton>

			<!-- Menu Modello -->
			<MenuButton
				open={activeMenu === 'model'}
				title={m.chat_v2_composer_model_title()}
				hasPopup="dialog"
				contentRole="dialog"
				width="400px"
				onToggle={() => (activeMenu = activeMenu === 'model' ? null : 'model')}
				onClose={() => (activeMenu = null)}
			>
				{#snippet trigger()}
					<span class="model-name-label">{session.model?.name || session.model?.id || m.chat_v2_composer_model_label()}</span>
					<span class="chevron-indicator"><IconChevronUp /></span>
				{/snippet}
				{#snippet children()}
					<ModelPickerList
						catalog={availableModels}
						value={session.model?.provider && session.model?.id
							? `${session.model.provider}/${session.model.id}`
							: session.model?.id || ''}
						placeholder={m.chat_v2_composer_model_search()}
						showFooter
						onSelect={(selector, mod) => {
							activeMenu = null;
							const provider = mod.provider || (selector.includes('/') ? selector.split('/')[0] : '');
							const modelId = mod.id || (selector.includes('/') ? selector.split('/')[1] : selector);
							if (provider && modelId) {
								void session.client.send({
									type: 'set_model',
									provider,
									modelId
								}).then(() => session.refreshState());
							}
						}}
						onClose={() => (activeMenu = null)}
					/>
				{/snippet}
			</MenuButton>

			<!-- Menu Thinking -->
			<MenuButton
				open={activeMenu === 'thinking'}
				title={m.chat_v2_composer_thinking_title()}
				hasPopup="dialog"
				contentRole="dialog"
				width="320px"
				onToggle={() => (activeMenu = activeMenu === 'thinking' ? null : 'thinking')}
				onClose={() => (activeMenu = null)}
			>
				{#snippet trigger()}
					<ThinkingMeter level={session.thinkingLevel || 'off'} />
					<span class="thinking-label font-mono">{session.thinkingLevel || 'off'}</span>
				{/snippet}
				{#snippet children()}
					<!-- Il popover resta aperto mentre si trascina: ogni passo si applica subito. -->
					<div class="thinking-popover">
						{#if modelSupportsReasoning(session.model)}
							<ReasoningSlider
								value={session.thinkingLevel || 'off'}
								levels={chatThinkingLevels}
								onChange={(level) => {
									void session.client.send({
										type: 'set_thinking_level',
										level: level as ThinkingLevel
									}).then(() => session.refreshState());
								}}
							/>
						{:else}
							<p class="thinking-unsupported">
								{m.chat_v2_composer_thinking_unsupported({ model: session.model?.name || session.model?.id || m.chat_v2_composer_model_fallback() })}
							</p>
						{/if}
					</div>
				{/snippet}
			</MenuButton>

			<!-- Menu Modalita e limiti (Fast, Slow, Limiti, Riscaldamento cache) -->
			{#if !isLab}
				<ModesMenu
					{session}
					open={activeMenu === 'modes'}
					onToggle={() => (activeMenu = activeMenu === 'modes' ? null : 'modes')}
					onClose={() => (activeMenu = null)}
				/>
			{/if}

			<!-- Controlli Prewalk -->
			{#if !isLab}
				<div class="prewalk-controls">
					<Tooltip text={prewalkTooltipText} placement="top" offset={6}>
						<button
							type="button"
							class="prewalk-btn"
							class:armed={prewalkState === 'armed'}
							class:handed-off={prewalkState === 'handedOff'}
							disabled={smolEmpty || isPrewalkBusy}
							aria-pressed={prewalkState !== 'off'}
							aria-label={prewalkAriaLabel}
							onclick={handlePrewalkClick}
						>
							<span class="prewalk-icon"><IconPrewalk /></span>
							<span class="prewalk-name font-mono">{m.chat_v2_composer_prewalk_title()}</span>
							{#if prewalkState === 'armed'}
								<span class="prewalk-target font-mono">→ {prewalkTarget || '…'}</span>
							{:else if prewalkState === 'handedOff'}
								<span class="prewalk-target font-mono">{handedOffTo || '…'}</span>
							{/if}
						</button>
					</Tooltip>

					{#if prewalkState === 'handedOff'}
						<Tooltip text={m.chat_v2_composer_prewalk_restart_aria()} placement="top" offset={6}>
							<button
								type="button"
								class="prewalk-repeat-btn"
								disabled={smolEmpty || isPrewalkBusy}
								aria-label={m.chat_v2_composer_prewalk_restart_aria()}
								onclick={handleRestartPrewalk}
							>
								<span class="prewalk-icon"><IconRefresh /></span>
								<span>{m.chat_v2_composer_prewalk_restart()}</span>
							</button>
						</Tooltip>
					{/if}
				</div>
			{/if}
			</div>

			<!-- Parte destra: Finestra di contesto e Pulsante Invio/Stop -->
			<div class="toolbar-right">
				<!-- Anello finestra di contesto -->
				<MenuButton
					open={activeMenu === 'context'}
					title={m.chat_v2_composer_context_title()}
					tooltip={contextTooltip}
					hasPopup="dialog"
					contentRole="dialog"
					align="right"
					width="320px"
					onToggle={() => (activeMenu = activeMenu === 'context' ? null : 'context')}
					onClose={() => (activeMenu = null)}
				>
					{#snippet trigger()}
						{@const maxCtx = resolveContextWindow(session.contextUsage, session.model?.contextWindow)}
						{@const used = (session.contextUsage?.tokens || 0) + draftTokensEstimate}
						{@const pct = Math.min(1, used / maxCtx)}
						{@const C = 2 * Math.PI * 7}
						<svg viewBox="0 0 18 18" class="context-ring" aria-hidden="true">
							<circle cx="9" cy="9" r="7" fill="none" stroke="var(--line)" stroke-width="2.2" />
							<circle
								cx="9"
								cy="9"
								r="7"
								fill="none"
								stroke={pct > 0.85 ? 'var(--danger)' : pct > 0.6 ? 'var(--warn)' : 'var(--ink)'}
								stroke-width="2.2"
								stroke-linecap="round"
								stroke-dasharray={C}
								stroke-dashoffset={C * (1 - pct)}
							/>
						</svg>
						<span class="context-numbers font-mono tabular-nums">
							{formatTokens(used)}<span class="context-max">/{formatTokens(maxCtx)}</span>
						</span>
					{/snippet}
					{#snippet children()}
						<ContextPanel
							model={session.model}
							contextUsage={session.contextUsage}
							report={session.contextReport}
							draftTokens={draftTokensEstimate}
							sessionCost={session.sessionCost}
							subagentCost={session.subagentCost}
							onCompact={() => {
								activeMenu = null;
								void session.compact();
							}}
						/>
					{/snippet}
				</MenuButton>

				<!-- Stop non disabilita l'invio: durante il turno si puo' fare steer o follow-up.
				     Se dopo l'abort l'agente non si ferma, il pulsante si arma come «Forza arresto». -->
				{#if session.isStreaming || stopArmed}
					{@const stopLabel = stopArmed ? m.force_kill_session_btn() : m.chat_v2_composer_stop_tooltip()}
					<button
						type="button"
						class="composer-send-btn send-btn stop"
						class:armed={stopArmed}
						title={stopLabel}
						aria-label={stopLabel}
						onclick={() => stopControl.press()}
					>
						<IconStop />
						{#if stopArmed}
							<span class="stop-force-text">{m.force_kill_session_short()}</span>
						{/if}
					</button>
				{/if}
				<span class="sr-only" aria-live="polite">{stopArmed ? m.chat_v2_composer_stop_armed_announce() : ''}</span>
				<div class="send-split-group">
						<button
							type="button"
							class="composer-send-btn send-btn main"
							disabled={!canSend}
							title={sendBehaviorChoice === 'steer'
								? `${m.chat_v2_composer_send_tooltip()} — ${m.chat_v2_composer_send_steer()}`
								: `${m.chat_v2_composer_send_tooltip()} — ${m.chat_v2_composer_send_followup()}`}
							onclick={() => handleSubmit(false)}
						>
							<IconArrowUp />
						</button>

						{#if session.isStreaming}
						<MenuButton
							open={activeMenu === 'sendMode'}
							title={m.chat_v2_composer_send_mode_title()}
							hasPopup="menu"
							align="right"
							width="240px"
							className="send-mode-trigger"
							onToggle={() => (activeMenu = activeMenu === 'sendMode' ? null : 'sendMode')}
							onClose={() => (activeMenu = null)}
						>
							{#snippet trigger()}
								<span class="send-mode-chevron"><IconChevronUp /></span>
							{/snippet}
							{#snippet children()}
								<div class="send-mode-menu">
									<button
										type="button"
										role="menuitemradio"
										aria-checked={sendBehaviorChoice === 'steer'}
										class="send-mode-option"
										class:selected={sendBehaviorChoice === 'steer'}
										onclick={() => {
											sendBehaviorChoice = 'steer';
											activeMenu = null;
										}}
									>
										<span class="mode-title">{m.chat_v2_composer_send_steer()}</span>
										<span class="mode-sub">{m.chat_v2_composer_send_mode_default_hint()}</span>
									</button>
									<button
										type="button"
										role="menuitemradio"
										aria-checked={sendBehaviorChoice === 'followUp'}
										class="send-mode-option"
										class:selected={sendBehaviorChoice === 'followUp'}
										onclick={() => {
											sendBehaviorChoice = 'followUp';
											activeMenu = null;
										}}
									>
										<span class="mode-title">{m.chat_v2_composer_send_followup()}</span>
										<span class="mode-sub">{m.chat_v2_composer_send_mode_alt_hint({ modifier: IS_MAC ? '⌥' : 'Alt' })}</span>
									</button>
								</div>
							{/snippet}
						</MenuButton>
						{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.composer-root {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
		container-type: inline-size;
	}

	.composer-root.hidden {
		display: none;
	}

	.cmd-strip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-2) var(--space-2) 0;
		padding: 6px 10px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.cmd-strip-icon {
		color: var(--ink-muted);
		display: inline-flex;
		--icon-size: 14px;
	}

	.cmd-strip-name {
		font-weight: 600;
		color: var(--ink);
	}

	.cmd-strip-desc {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cmd-strip-hint {
		color: var(--ink-faint);
		margin-left: auto;
	}

	.attachments-row {
		display: flex;
		gap: var(--space-2);
		overflow-x: auto;
		padding: 10px 14px 2px;
	}

	.vision-warning-strip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-2) var(--space-2) 0;
		padding: 6px 10px;
		background: color-mix(in oklch, var(--warn) 10%, transparent);
		border: 1px solid color-mix(in oklch, var(--warn) 30%, transparent);
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		color: var(--warn);
		--icon-size: 14px;
	}

	.change-model-btn {
		margin-left: auto;
		background: transparent;
		border: none;
		color: var(--warn);
		font-weight: 600;
		font-size: var(--text-xs);
		text-decoration: underline;
		cursor: pointer;
	}

	.toolbar-attach-icon {
		display: inline-flex;
		align-items: center;
		--icon-size: 15px;
	}

	.chevron-indicator {
		display: inline-flex;
		align-items: center;
		--icon-size: 12px;
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.toolbar-left {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.toolbar-controls-strip {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: 1 1 auto;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		white-space: nowrap;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.toolbar-controls-strip::-webkit-scrollbar {
		display: none;
	}

	.toolbar-controls-strip > * {
		flex-shrink: 0;
	}

	.toolbar-divider {
		width: 1px;
		height: 16px;
		background: var(--line);
		margin: 0 4px;
		flex-shrink: 0;
	}

	.active-role-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--brand-ink);
	}

	.model-name-label {
		max-width: 130px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}


	.thinking-label {
		font-size: var(--text-caption);
	}

	.thinking-popover {
		padding: var(--space-3) var(--space-4) var(--space-4);
		--slider-ring: var(--bg-raised);
	}

	.thinking-unsupported {
		margin: 0;
		font-size: var(--text-label);
		line-height: 1.4;
		color: var(--ink-muted);
	}

	.prewalk-controls {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.prewalk-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 8px;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.prewalk-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.prewalk-btn.armed,
	.prewalk-btn.handed-off {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.prewalk-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.prewalk-icon {
		display: inline-flex;
		align-items: center;
		--icon-size: 14px;
	}

	.prewalk-name {
		font-size: var(--text-xs);
	}

	.prewalk-target {
		color: var(--brand-ink);
		font-size: var(--text-caption);
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.prewalk-repeat-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 6px;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.prewalk-repeat-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.prewalk-repeat-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.toolbar-right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	@container (max-width: 340px) {
		.context-max {
			display: none;
		}
	}

	@container (max-width: 270px) {
		.context-numbers {
			display: none;
		}
		.toolbar-divider {
			display: none;
		}
	}

	.context-ring {
		width: 18px;
		height: 18px;
		transform: rotate(-90deg);
	}

	.context-numbers {
		font-size: var(--text-caption);
		color: var(--ink);
	}

	.context-max {
		color: var(--ink-faint);
	}

	/* Pulsante tondo pieno: riprende il raggio del composer che lo contiene.
	   Con la scelta della modalita' (durante lo streaming) il gruppo diventa una pillola. */
	.send-split-group {
		display: flex;
		align-items: center;
		background: var(--ink);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.send-btn.stop {
		border-radius: var(--radius-full);
		background: var(--danger);
		color: var(--on-danger);
		--icon-size: 15px;
	}

	/* Armato: pillola con il testo del secondo clic e contorno cremisi che pulsa. */
	.send-btn.stop.armed {
		display: inline-flex;
		align-items: center;
		width: auto;
		gap: 6px;
		padding: 0 10px;
		outline: 2px solid var(--danger);
		outline-offset: 2px;
		animation: stop-armed-pulse 1.2s var(--ease-out) infinite;
	}

	.stop-force-text {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-weight: 600;
		white-space: nowrap;
	}

	@keyframes stop-armed-pulse {
		0%,
		100% {
			outline-color: color-mix(in oklch, var(--danger) 90%, transparent);
		}
		50% {
			outline-color: color-mix(in oklch, var(--danger) 25%, transparent);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.send-btn.stop.armed {
			animation: none;
		}
	}

	.send-mode-chevron {
		display: inline-flex;
		align-items: center;
		--icon-size: 11px;
	}

	:global(.menu-button.send-mode-trigger) {
		height: 28px;
		/* Piu' spazio a destra: la pillola arrotonda l'estremita' del chevron. */
		padding: 0 7px 0 4px;
		background: var(--ink);
		color: var(--bg-base);
		border: none;
		border-radius: 0;
		border-left: 1px solid color-mix(in oklch, var(--bg-base) 25%, transparent);
	}

	:global(.menu-button.send-mode-trigger:hover:not(:disabled)),
	:global(.menu-button.send-mode-trigger.active) {
		background: color-mix(in oklch, var(--ink) 90%, var(--bg-base) 10%);
		color: var(--bg-base);
		border-left-color: color-mix(in oklch, var(--bg-base) 35%, transparent);
	}

	.send-mode-menu {
		display: flex;
		flex-direction: column;
		padding: var(--space-1);
		gap: 2px;
	}

	.send-mode-option {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 6px 10px;
		border-radius: var(--radius-md);
		background: transparent;
		border: none;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		font-family: var(--font-ui);
	}

	.send-mode-option:hover,
	.send-mode-option.selected {
		background: var(--bg-hover);
	}

	.send-mode-option.selected .mode-title {
		color: var(--brand-ink);
	}

	.mode-title {
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.mode-sub {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

</style>
