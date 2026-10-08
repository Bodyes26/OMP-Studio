<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import type { AgentSession } from '$lib/agent/session.svelte';
	import {
		type BrowserFrameMeta,
		type BrowserInputEvent,
		type BrowserTabState,
		type ViewportPoint,
		type InspectedElementData,
		type ConsoleEntry,
		type NetworkEntry,
		type ActionEntry,
		ConsoleRingBuffer,
		NetworkRingBuffer,
		ActionRingBuffer,
		formatElementContextForPrompt,
		formatConsoleErrorsForPrompt,
		formatFailedRequestsForPrompt,
		formatInspectorContextForPrompt,
		cropImageElement,
		mapClientToViewportCoords,
		mapWheelToViewportScroll,
		extractOrigin,
		type BrowserDialogState,
		type BrowserDownloadState,
		type BrowserFileChooserState,
		type BrowserCapabilityState,
		type BrowserCapability,
		type BrowserCapabilityDecision,
		type BrowserRecordingState,
		type BrowserRelayProbe,
		type BrowserRelayTarget,
		BROWSER_CAPABILITIES
	} from '$lib/agent/browser-live';
	import { untrack } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { traceFocus } from '$lib/focusTracer';
	import { projectStore } from '$lib/stores/projects.svelte';
	import {
		IconArrowLeft,
		IconArrowRight,
		IconCamera,
		IconCheck,
		IconClose,
		IconGlobe,
		IconLock,
		IconRefresh,
		IconWarning,
		IconInspect,
		IconTerminal,
		IconNetwork,
		IconHistory,
		IconSend,
		IconCopy,
		IconClear,
		IconSearch,
		IconChevronDown,
		IconChevronRight,
		IconPlus
	} from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import ColumnTabs, { type ColumnTabItem } from '$lib/ui/ColumnTabs.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { motionReduced } from '$lib/agent/motionState.svelte';
	import { rvLift } from '$lib/agent/motion';
	let {
		session,
		projectPath,
		onClose,
		onInput,
		onAttachPromptContext
	}: {
		session: AgentSession | null;
		projectPath: string;
		onClose?: () => void;
		onInput?: (event: BrowserInputEvent) => void;
		onAttachPromptContext?: (text: string, images?: { type: 'image'; data: string; mimeType: string }[]) => void;
	} = $props();
	// Tab aperte dalla sessione corrente
	const tabs = $derived<BrowserTabState[]>(session?.browserLiveTabs ?? []);
	let selectedTabId = $state<string | null>(null);
	let currentTabId = $state<string | null>(null);

	const activeTab = $derived.by<BrowserTabState | null>(() => {
		if (!tabs.length) return null;
		if (selectedTabId) {
			const found = tabs.find((t) => t.tabId === selectedTabId);
			if (found) return found;
		}
		return tabs[0];
	});

	// Frame live e stato connessione
	let currentFrame = $state<{ meta: BrowserFrameMeta; imageBase64: string } | null>(null);
	let streamStatus = $state<'idle' | 'connecting' | 'live' | 'disconnected' | 'error'>('idle');
	let streamError = $state<string | null>(null);
	let retryNonce = $state(0);
	let copiedScreenshot = $state(false);

	// Viewport responsive (allineato al pattern di PreviewViewer)
	type Device = 'desktop' | 'tablet' | 'mobile';
	const DEVICE_WIDTHS: Record<Device, string> = {
		desktop: '100%',
		tablet: '768px',
		mobile: '390px'
	};
	let device = $state<Device>('desktop');

	// Coordinate e puntatore
	let viewportEl = $state<HTMLElement | null>(null);
	let imageEl = $state<HTMLImageElement | null>(null);
	let hoverPoint = $state<ViewportPoint | null>(null);
	let lastInputEvent = $state<BrowserInputEvent | null>(null);
	let isHovering = $state(false);

	// Stato Inspector mirato e Ring Buffer (S44)
	let isPickerActive = $state(false);
	let isInspectorOpen = $state(false);
	type InspectorTab = 'elements' | 'console' | 'network' | 'actions';
	let activeInspectorTab = $state<InspectorTab>('elements');
	const inspectorId = $props.id();

	let inspectedElement = $state<InspectedElementData | null>(null);
	let inspectedCropBase64 = $state<string | null>(null);
	let hoveredInspectElement = $state<InspectedElementData | null>(null);

	const consoleBuffer = new ConsoleRingBuffer(500);
	const networkBuffer = new NetworkRingBuffer(200);
	const actionBuffer = new ActionRingBuffer(100);

	let consoleEntries = $state<ConsoleEntry[]>([]);
	let networkEntries = $state<NetworkEntry[]>([]);
	let actionEntries = $state<ActionEntry[]>([]);

	let consoleFilterLevel = $state<'all' | 'error' | 'warn' | 'info' | 'debug'>('all');
	let consoleSearchQuery = $state('');

	let networkFilter = $state<'all' | 'failed' | 'slow' | 'xhr' | 'other'>('all');
	let networkSearchQuery = $state('');
	let selectedNetworkRequestId = $state<string | null>(null);

	let actionSearchQuery = $state('');

	let copiedSelector = $state(false);
	let contextAttachedNotice = $state<string | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;

	/* ------------------- dialoghi, download, upload, recording (S45) */

	let dialogs = $state<BrowserDialogState[]>([]);
	let downloads = $state<BrowserDownloadState[]>([]);
	let fileChoosers = $state<BrowserFileChooserState[]>([]);
	let capabilities = $state<BrowserCapabilityState[]>([]);
	let recording = $state<BrowserRecordingState | null>(null);
	let promptAnswer = $state('');
	let isCapabilityMenuOpen = $state(false);
	let uploadBusy = $state(false);
	let relayPickerOpen = $state(false);
	let relayBusy = $state(false);
	let relayTargets = $state<BrowserRelayTarget[]>([]);
	let relayProbe = $state<BrowserRelayProbe | null>(null);
	let relayDiagnostic = $state<string | null>(null);
	let originBusy = $state(false);
	/** Dialogo per cui la risposta e' gia' partita: evita il doppio invio. */
	let respondedDialogId = $state<string | null>(null);
	/** Il focus da tastiera appartiene alla superficie live, anche dopo un rimontaggio. */
	let surfaceHasKeyboard = $state(false);
	/** `code` dei tasti gia' inoltrati: serve a non perdere mai il key_up. */
	const pressedKeys = new Set<string>();


	const CAPABILITY_LABELS: Record<BrowserCapability, string> = {
		'clipboard-read': m.browser_cap_clipboard_read(),
		'clipboard-write': m.browser_cap_clipboard_write(),
		geolocation: m.browser_cap_geolocation(),
		notifications: m.browser_cap_notifications()
	};

	/** Un solo dialogo per volta puo' essere aperto: la pagina resta bloccata. */
	const openDialog = $derived(dialogs.find((d) => d.status === 'open') ?? null);
	const pendingDownloads = $derived(downloads.filter((d) => d.status === 'pending-consent'));
	const runningDownloads = $derived(downloads.filter((d) => d.status === 'in-progress'));
	const finishedDownloads = $derived(
		downloads.filter((d) => d.status === 'completed' || d.status === 'denied' || d.status === 'failed')
	);
	const pendingChooser = $derived(fileChoosers.find((c) => c.status === 'pending-choice') ?? null);
	const isRecording = $derived(recording?.status === 'recording' || recording?.status === 'stopping');
	const isRecordingActive = $derived(recording?.status === 'recording');
	let recordingDotEl = $state<HTMLElement | null>(null);
	let recordingOnScreen = $state(false);
	let recordingPageVisible = $state(true);

	const isRecordingLive = $derived(
		isRecordingActive &&
		recordingOnScreen &&
		recordingPageVisible &&
		!motionReduced()
	);

	$effect(() => {
		const node = recordingDotEl;
		if (!node || !isRecordingActive) {
			recordingOnScreen = false;
			return;
		}
		const updateVisibility = () => {
			recordingPageVisible = document.visibilityState !== 'hidden';
		};
		updateVisibility();
		const observer = new IntersectionObserver(([entry]) => {
			const style = getComputedStyle(node);
			recordingOnScreen = entry.isIntersecting && style.visibility !== 'hidden';
		});
		observer.observe(node);
		document.addEventListener('visibilitychange', updateVisibility);
		return () => {
			observer.disconnect();
			document.removeEventListener('visibilitychange', updateVisibility);
		};
	});
	/** Takeover privato: nessun pixel ne' dato della pagina puo' uscire da qui. */
	const isPrivateTakeover = $derived(
		activeTab?.controller === 'private-user' || currentFrame?.meta.privacy === 'private'
	);
	/** Risposta al dialogo gia' inviata: il runtime rifiuta la seconda con DIALOG_ALREADY_SETTLED. */
	const dialogBusy = $derived(openDialog !== null && respondedDialogId === openDialog.dialogId);

	function capabilityDecision(capability: BrowserCapability): BrowserCapabilityDecision {
		// Senza `capability_state` dal runtime la decisione e' quella di default del
		// contratto, cioe' `prompt`: dichiarare `denied` mostrerebbe come attivo uno
		// stato che nessuno ha scelto.
		return capabilities.find((c) => c.capability === capability)?.decision ?? 'prompt';
	}

	/** Sostituisce lo stato con lo stesso id e limita la memoria degli eventi conclusi. */
	function upsertBounded<T>(list: T[], next: T, key: (item: T) => string, capacity: number): T[] {
		const id = key(next);
		const idx = list.findIndex((item) => key(item) === id);
		if (idx === -1) return [...list.slice(-(capacity - 1)), next];
		const copy = [...list];
		copy[idx] = next;
		return copy;
	}

	/** Un solo invio per dialogo, e nessun click silenziosamente perso. */
	async function respondDialog(accept: boolean) {
		const dialog = openDialog;
		if (!dialog || !activeTab || !session || dialogBusy) return;
		respondedDialogId = dialog.dialogId;
		const sent = await session.sendLiveMessage(activeTab, {
			type: 'dialog_respond',
			dialogId: dialog.dialogId,
			accept,
			...(dialog.kind === 'prompt' && accept ? { promptText: promptAnswer } : {})
		});
		if (!sent) {
			respondedDialogId = null;
			showNotice(m.ui_browserviewer_canale_live_non_disponibile_riprova_f377());
			return;
		}
		promptAnswer = '';
	}

	async function decideDownload(downloadId: string, allow: boolean) {
		if (!activeTab || !session) return;
		const sent = await session.sendLiveMessage(activeTab, { type: 'download_decide', downloadId, allow });
		if (!sent) showNotice(m.ui_browserviewer_canale_live_non_disponibile_riprova_f377());
	}

	async function chooseUploadFiles() {
		const chooser = pendingChooser;
		if (!chooser || !activeTab || !session || uploadBusy) return;
		uploadBusy = true;
		try {
			const count = await session.pickUploadFiles(activeTab, chooser.chooserId, chooser.mode === 'multiple');
			showNotice(count > 0 ? m.ui_browserviewer_value1_file_autorizzati_per_il_caricamento_1e76({ value1: count }) : m.ui_browserviewer_selezione_file_annullata_5351());
		} catch (err) {
			showNotice(m.browser_notice_file_picker_unavailable({ error: String(err) }));
		} finally {
			uploadBusy = false;
		}
	}

	async function cancelChooser() {
		const chooser = pendingChooser;
		if (!chooser || !activeTab || !session) return;
		const sent = await session.sendLiveMessage(activeTab, {
			type: 'cancel_file_chooser',
			chooserId: chooser.chooserId
		});
		if (!sent) showNotice(m.ui_browserviewer_canale_live_non_disponibile_riprova_f377());
	}

	async function changeCapability(capability: BrowserCapability, decision: BrowserCapabilityDecision) {
		if (!activeTab || !session) return;
		const sent = await session.sendLiveMessage(activeTab, { type: 'set_capability', capability, decision });
		if (!sent) showNotice(m.ui_browserviewer_canale_live_non_disponibile_riprova_f377());
	}

	async function toggleRecording() {
		if (!activeTab || !session) return;
		const sent = await session.sendLiveMessage(activeTab, {
			type: isRecording ? 'stop_recording' : 'start_recording'
		});
		if (!sent) showNotice(m.ui_browserviewer_canale_live_non_disponibile_riprova_f377());
	}

	async function revealArtifact(path: string) {
		try {
			await revealItemInDir(path);
		} catch (err) {
			showNotice(m.ui_browserviewer_impossibile_aprire_la_cartella_value1_5c22({ value1: String(err) }));
		}
	}

	async function openRelayPicker() {
		if (!session || relayBusy) return;
		relayBusy = true;
		relayDiagnostic = null;
		try {
			const result = await session.listBrowserRelayTargets();
			relayTargets = result.targets;
			relayProbe = result.probe;
			relayPickerOpen = true;
		} catch (error) {
			relayDiagnostic = String(error);
			relayPickerOpen = true;
		} finally {
			relayBusy = false;
		}
	}

	async function authorizeRelayTarget(targetId: string) {
		if (!session || relayBusy) return;
		relayBusy = true;
		relayDiagnostic = null;
		try {
			const result = await session.authorizeBrowserRelayTarget(targetId);
			relayProbe = result.probe;
			selectedTabId = result.state.tabId;
			relayPickerOpen = false;
			relayTargets = [];
		} catch (error) {
			relayDiagnostic = String(error);
		} finally {
			relayBusy = false;
		}
	}

	async function disconnectRelay() {
		if (!session || activeTab?.mode !== 'chrome-relay' || relayBusy) return;
		relayBusy = true;
		try {
			await session.revokeBrowserRelayTarget(activeTab.browserSessionId);
			currentFrame = null;
			streamStatus = 'disconnected';
			selectedTabId = null;
		} catch (error) {
			relayDiagnostic = String(error);
		} finally {
			relayBusy = false;
		}
	}


	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function showNotice(msg: string) {
		contextAttachedNotice = msg;
		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			contextAttachedNotice = null;
			noticeTimer = null;
		}, 2200);
	}

	/**
	 * Identita' del canale live come chiave primitiva. L'effetto di connessione
	 * NON puo' dipendere dall'oggetto tab: il riduttore RPC lo sostituisce a ogni
	 * `tab_state` (navigazione, loading, takeover, epoch), e ogni sostituzione
	 * farebbe ripartire la connessione da zero bruciando un ticket monouso.
	 */
	const liveKey = $derived(activeTab ? `${activeTab.browserSessionId}::${activeTab.tabId}` : null);

	/** Azzera tutto cio' che appartiene alla tab precedente. */
	function resetTabSurface() {
		currentFrame = null;
		dialogs = [];
		downloads = [];
		fileChoosers = [];
		capabilities = [];
		recording = null;
		promptAnswer = '';
		respondedDialogId = null;
		consoleBuffer.clear();
		networkBuffer.clear();
		actionBuffer.clear();
		consoleEntries = [];
		networkEntries = [];
		actionEntries = [];
		inspectedElement = null;
		inspectedCropBase64 = null;
		hoveredInspectElement = null;
		selectedNetworkRequestId = null;
		isPickerActive = false;
	}

	// Gestione connessione live con ticket fresco e backoff limitato.
	$effect(() => {
		const key = liveKey;
		retryNonce;
		// Lo stato precedente e l'oggetto tab si leggono fuori dal grafo: senza
		// `untrack` la scrittura di `currentTabId` rischedulerebbe questo stesso
		// effetto, aprendo due sessioni live per ogni montaggio.
		const previousKey = untrack(() => currentTabId);
		const tab = untrack(() => activeTab);
		const s = untrack(() => session);

		if (!key || !tab || !s) {
			currentTabId = null;
			streamStatus = 'idle';
			streamError = null;
			resetTabSurface();
			return;
		}

		streamStatus = 'connecting';
		streamError = null;
		if (key !== previousKey) {
			currentTabId = key;
			resetTabSurface();
		}

		let active = true;
		let liveHandle: (() => void) | null = null;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;
		let attempt = 0;

		const scheduleReconnect = (message: string) => {
			if (!active) return;
			liveHandle?.();
			liveHandle = null;
			// L'ultimo frame resta a schermo sotto l'overlay di stato: smontarlo
			// distruggerebbe il nodo che possiede il focus da tastiera.
			streamError = message;
			if (attempt >= 5) {
				streamStatus = 'error';
				return;
			}
			const delay = Math.min(4000, 250 * 2 ** attempt);
			attempt += 1;
			streamStatus = 'disconnected';
			retryTimer = setTimeout(() => {
				retryTimer = null;
				void connect();
			}, delay);
		};

		const connect = async () => {
			if (!active) return;
			streamStatus = attempt === 0 ? 'connecting' : 'disconnected';
			try {
				const handle = await s.connectLiveTab(
					tab,
					(frame) => {
						if (!active) return;
						currentFrame = frame;
						streamStatus = 'live';
						streamError = null;
						attempt = 0;
					},
					(event) => {
						if (!active) return;
						if (event.type === 'inspected_element') {
							if (isPickerActive) hoveredInspectElement = event.element;
							else inspectedElement = event.element;
						} else if (event.type === 'console_entry') {
							consoleBuffer.push(event.entry);
							consoleEntries = [...consoleBuffer.items];
						} else if (event.type === 'network_entry') {
							networkBuffer.push(event.entry);
							networkEntries = [...networkBuffer.items];
						} else if (event.type === 'network_body_response') {
							if (event.body) {
								networkBuffer.setBody(event.requestId, event.body);
								networkEntries = [...networkBuffer.items];
							}
						} else if (event.type === 'action_entry') {
							actionBuffer.push(event.entry);
							actionEntries = [...actionBuffer.items];
						} else if (event.type === 'dialog_state') {
							dialogs = upsertBounded(dialogs, event.dialog, (d) => d.dialogId, 32);
							if (event.dialog.status === 'open') promptAnswer = event.dialog.defaultPrompt;
						} else if (event.type === 'download_state') {
							downloads = upsertBounded(downloads, event.download, (d) => d.downloadId, 100);
						} else if (event.type === 'file_chooser_state') {
							fileChoosers = upsertBounded(fileChoosers, event.chooser, (c) => c.chooserId, 16);
						} else if (event.type === 'capability_state') {
							capabilities = upsertBounded(capabilities, event.capability, (c) => c.capability, BROWSER_CAPABILITIES.length);
						} else if (event.type === 'recording_state') {
							recording = event.recording;
						} else if (event.type === 'error') {
							streamError = event.message;
						} else if (event.type === 'disconnected') {
							scheduleReconnect(streamError || m.browser_stream_channel_interrupted());
						}
					}
				);
				if (!active) {
					handle?.();
					return;
				}
				if (!handle) {
					scheduleReconnect(m.browser_stream_channel_unavailable());
					return;
				}
				liveHandle = handle;
			} catch (error) {
				scheduleReconnect(String(error));
			}
		};

		void connect();
		return () => {
			active = false;
			if (retryTimer) clearTimeout(retryTimer);
			liveHandle?.();
		};
	});

	function retryStream() {
		retryNonce += 1;
	}
	function handleBack() {
		if (!activeTab) return;
		emitInput({
			type: 'key_down',
			key: 'ArrowLeft',
			code: 'ArrowLeft',
			modifiers: { alt: true, ctrl: false, meta: false, shift: false }
		});
		emitInput({
			type: 'key_up',
			key: 'ArrowLeft',
			code: 'ArrowLeft',
			modifiers: { alt: true, ctrl: false, meta: false, shift: false }
		});
	}

	function handleForward() {
		if (!activeTab) return;
		emitInput({
			type: 'key_down',
			key: 'ArrowRight',
			code: 'ArrowRight',
			modifiers: { alt: true, ctrl: false, meta: false, shift: false }
		});
		emitInput({
			type: 'key_up',
			key: 'ArrowRight',
			code: 'ArrowRight',
			modifiers: { alt: true, ctrl: false, meta: false, shift: false }
		});
	}

	function handleReload() {
		if (!activeTab) return;
		emitInput({
			type: 'key_down',
			key: 'F5',
			code: 'F5',
			modifiers: { alt: false, ctrl: false, meta: false, shift: false }
		});
		emitInput({
			type: 'key_up',
			key: 'F5',
			code: 'F5',
			modifiers: { alt: false, ctrl: false, meta: false, shift: false }
		});
	}

	/** Calcola le coordinate in pixel CSS del viewport dal puntatore client. */
	function getViewportCoords(clientX: number, clientY: number): ViewportPoint | null {
		if (!imageEl || !currentFrame?.meta) return null;
		const rect = imageEl.getBoundingClientRect();
		return mapClientToViewportCoords(clientX, clientY, rect, {
			viewportWidth: currentFrame.meta.viewportWidth,
			viewportHeight: currentFrame.meta.viewportHeight
		});
	}

	function emitInput(event: BrowserInputEvent) {
		lastInputEvent = event;
		onInput?.(event);
		if (!activeTab || !session) return;
		// Con lo stream non attivo il frame a schermo e' l'ultimo ricevuto: le
		// coordinate non corrispondono piu' a nulla di vivo.
		if (streamStatus !== 'live') return;
		if (activeTab.controller === 'agent') {
			// Il takeover interrompe fail-closed il comando dell'agente: deve
			// nascere da un gesto deliberato, non dal puntatore che passa sopra.
			if (event.type === 'mouse_move') return;
			void session.requestTakeover(activeTab, event);
		} else {
			void session.sendTabInput(activeTab, event);
		}
	}

	async function handleReturnControl() {
		if (!activeTab || !session) return;
		await session.returnControl(activeTab);
	}

	async function handleTogglePrivacy() {
		if (!activeTab || !session) return;
		const next = activeTab.controller === 'private-user' ? 'normal' : 'private';
		await session.setPrivacy(activeTab, next);
	}
	function handlePointerDown(e: PointerEvent) {
		viewportEl?.focus();
		const pt = getViewportCoords(e.clientX, e.clientY);
		if (!pt) return;
		const event: BrowserInputEvent = {
			type: 'mouse_down',
			x: pt.x,
			y: pt.y,
			button: e.button,
			buttons: e.buttons,
			clickCount: e.detail || 1
		};
		emitInput(event);
	}

	function handlePointerMove(e: PointerEvent) {
		const pt = getViewportCoords(e.clientX, e.clientY);
		hoverPoint = pt;
		if (!pt) return;

		if (isPickerActive) {
			// Modalita' Picker: richiede analisi elemento al punto
			if (activeTab && session) {
				void session.inspectPoint(activeTab, pt.x, pt.y);
			}
			return;
		}

		const event: BrowserInputEvent = {
			type: 'mouse_move',
			x: pt.x,
			y: pt.y,
			buttons: e.buttons
		};
		emitInput(event);
	}
	function handlePointerUp(e: PointerEvent) {
		const pt = getViewportCoords(e.clientX, e.clientY);
		if (!pt) return;
		const event: BrowserInputEvent = {
			type: 'mouse_up',
			x: pt.x,
			y: pt.y,
			button: e.button,
			buttons: e.buttons
		};
		emitInput(event);
	}

	async function handleClick(e: MouseEvent) {
		const pt = getViewportCoords(e.clientX, e.clientY);
		if (!pt) return;

		if (isPickerActive) {
			// Selezione elemento e apertura inspector
			if (hoveredInspectElement) {
				inspectedElement = hoveredInspectElement;
			} else if (activeTab && session) {
				void session.inspectPoint(activeTab, pt.x, pt.y);
			}

			// In takeover privato il frame resta solo qui: nessun ritaglio, perche'
			// il ritaglio e' allegabile al prompt e finirebbe al modello.
			if (inspectedElement && currentFrame && !isPrivateTakeover) {
				try {
					inspectedCropBase64 = await cropImageElement(
						currentFrame.imageBase64,
						inspectedElement.boundingBox,
						{ width: currentFrame.meta.viewportWidth, height: currentFrame.meta.viewportHeight }
					);
				} catch {
					inspectedCropBase64 = null;
				}
			} else {
				inspectedCropBase64 = null;
			}

			isPickerActive = false;
			isInspectorOpen = true;
			activeInspectorTab = 'elements';

			actionBuffer.push({
				id: `inspect-${Date.now()}`,
				timestamp: Date.now(),
				kind: 'agent_action',
				label: m.browser_action_element_selected({
					tag: inspectedElement?.tag || 'element',
					selector: inspectedElement?.selector || ''
				}).trim()
			});
			actionEntries = [...actionBuffer.items];
			return;
		}

		const event: BrowserInputEvent = {
			type: 'click',
			x: pt.x,
			y: pt.y,
			button: e.button,
			detail: e.detail || 1
		};
		emitInput(event);
	}
	function handleDblClick(e: MouseEvent) {
		const pt = getViewportCoords(e.clientX, e.clientY);
		if (!pt) return;
		const event: BrowserInputEvent = {
			type: 'double_click',
			x: pt.x,
			y: pt.y
		};
		emitInput(event);
	}

	function handleWheel(e: WheelEvent) {
		const pt = getViewportCoords(e.clientX, e.clientY);
		if (!pt) return;
		const scroll = mapWheelToViewportScroll(e.deltaX, e.deltaY, e.deltaMode);
		const event: BrowserInputEvent = {
			type: 'wheel',
			x: pt.x,
			y: pt.y,
			deltaX: scroll.deltaX,
			deltaY: scroll.deltaY
		};
		emitInput(event);
	}

	function isViewportKeyboardTarget(target: EventTarget | null): boolean {
		return target instanceof HTMLElement && target.closest('.viewport-frame') !== null;
	}

	/**
	 * Il solo `e.target` non basta: la superficie puo' essere rimontata (cambio
	 * tab, riconnessione) e il focus tornare a `body`, lasciando la tastiera
	 * muta fino al click successivo. Qui si ricorda che il focus appartiene alla
	 * superficie e lo si restituisce al nodo appena ricompare.
	 */
	function handleFocusIn(e: FocusEvent) {
		const target = e.target as HTMLElement | null;
		if (isViewportKeyboardTarget(target)) {
			surfaceHasKeyboard = true;
			return;
		}
		if (target instanceof HTMLElement && target.tagName !== 'BODY') {
			surfaceHasKeyboard = false;
		}
	}

	$effect(() => {
		if (!currentFrame || !viewportEl || !surfaceHasKeyboard) return;
		if (document.activeElement === viewportEl) return;
		// La superficie ricorda il fuoco solo quando e' andato perso nel vuoto
		// (rimontaggio con focus tornato a body): mai strapparlo a un input o
		// a un controllo dove l'utente sta scrivendo o operando, e mai mentre
		// Studio e' in secondo piano, dove un focus programmatico puo' far
		// risalire la finestra sopra l'applicazione che l'utente sta usando.
		if (document.activeElement !== null && document.activeElement !== document.body) return;
		if (!document.hasFocus()) return;
		traceFocus('browser-viewport-refocus');
		viewportEl.focus({ preventScroll: true });
	});

	// Entrando in takeover privato niente della pagina resta allegabile.
	$effect(() => {
		if (!isPrivateTakeover) return;
		inspectedCropBase64 = null;
		hoveredInspectElement = null;
		isPickerActive = false;
	});

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		const isInsideInspector = target?.closest('.inspector-dock') !== null;
		const isTextTarget = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

		if (e.key === 'Escape') {
			if (openDialog && activeTab) {
				// `e.repeat` a Escape tenuto premuto produrrebbe due risposte, e la
				// seconda torna come DIALOG_ALREADY_SETTLED.
				if (!e.repeat && !dialogBusy) void respondDialog(openDialog.kind === 'alert');
				return;
			}
			if (relayPickerOpen) {
				relayPickerOpen = false;
				relayTargets = [];
				return;
			}
			if (isCapabilityMenuOpen) {
				isCapabilityMenuOpen = false;
				return;
			}
			if (isPickerActive) {
				isPickerActive = false;
				hoveredInspectElement = null;
				return;
			}
			if (isInspectorOpen && !isTextTarget) {
				isInspectorOpen = false;
				return;
			}
			if (isTextTarget) return;
			onClose?.();
			return;
		}

		// `defaultPrevented`: Alt+I e' anche «Punta» dell'anteprima del Laboratorio;
		// un solo ascoltatore per colpo.
		if (!e.defaultPrevented && ((e.altKey && (e.key === 'i' || e.key === 'I')) || (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C')))) {
			e.preventDefault();
			togglePicker();
			return;
		}

		if (isInsideInspector || isTextTarget) return;
		if (!isViewportKeyboardTarget(e.target) && !surfaceHasKeyboard) return;
		pressedKeys.add(e.code);

		const event: BrowserInputEvent = {
			type: 'key_down',
			key: e.key,
			code: e.code,
			modifiers: {
				alt: e.altKey,
				ctrl: e.ctrlKey,
				meta: e.metaKey,
				shift: e.shiftKey
			}
		};
		emitInput(event);
	}

	function handleKeyUp(e: KeyboardEvent) {
		// Il key_up parte anche se il focus e' cambiato tra i due eventi: altrimenti
		// la pagina resterebbe con il tasto o il modificatore logicamente premuto.
		const wasPressed = pressedKeys.delete(e.code);
		if (!wasPressed && !isViewportKeyboardTarget(e.target)) return;
		const event: BrowserInputEvent = {
			type: 'key_up',
			key: e.key,
			code: e.code,
			modifiers: {
				alt: e.altKey,
				ctrl: e.ctrlKey,
				meta: e.metaKey,
				shift: e.shiftKey
			}
		};
		emitInput(event);
	}

	async function copyScreenshot() {
		if (!currentFrame?.imageBase64) return;
		try {
			// Decodifica base64 in blob per appunti
			const byteChars = atob(currentFrame.imageBase64);
			const byteNumbers = new Array(byteChars.length);
			for (let i = 0; i < byteChars.length; i++) {
				byteNumbers[i] = byteChars.charCodeAt(i);
			}
			const byteArray = new Uint8Array(byteNumbers);
			const blob = new Blob([byteArray], { type: currentFrame.meta.mimeType || 'image/jpeg' });
			await navigator.clipboard.write([
				new ClipboardItem({
					[blob.type]: blob
				})
			]);
			copiedScreenshot = true;
			setTimeout(() => {
				copiedScreenshot = false;
			}, 1800);
		} catch {
			// Fallback o mancata autorizzazione appunti
		}
	}

	function formatTabLabel(tab: BrowserTabState): string {
		if (tab.mode === 'chrome-relay') return m.browser_tab_personal_chrome();
		const parts = tab.tabId.split('::');
		return parts[1] || parts[0] || 'main';
	}

	/**
	 * La decisione va al runtime, che possiede l'allow-list rispettata
	 * dall'agente: lo store di progetto e' solo la copia consultabile dalle
	 * impostazioni. Il badge non viene forzato a mano, arriva con `tab_state`.
	 */
	async function decideOrigin(decision: 'grant' | 'revoke') {
		const tab = activeTab;
		if (!tab || !session || originBusy) return;
		const origin = extractOrigin(tab.url);
		if (!origin) return;
		originBusy = true;
		try {
			await session.setBrowserOriginDecision(tab.projectId, origin, decision);
			const pid = tab.projectId || projectStore.activeId;
			if (pid) {
				if (decision === 'grant') projectStore.grantBrowserOrigin(pid, origin);
				else projectStore.revokeBrowserOrigin(pid, origin);
			}
		} catch (error) {
			// Un runtime che non conosce ancora il comando va detto, non nascosto:
			// senza applicazione lato broker il consenso non vale nulla.
			const detail = String(error);
			showNotice(
				/unknown|not supported|sconosciut/i.test(detail)
						? m.browser_notice_origin_unsupported()
						: m.browser_notice_origin_failed({ detail })
			);
		} finally {
			originBusy = false;
		}
	}

	function togglePicker() {
		if (!isPickerActive && isPrivateTakeover) {
			showNotice(m.ui_browserviewer_takeover_privato_attivo_ispezione_della_pagina_disabilitata_825f());
			return;
		}
		isPickerActive = !isPickerActive;
		if (isPickerActive) {
			hoveredInspectElement = null;
		}
	}

	function toggleInspector() {
		isInspectorOpen = !isInspectorOpen;
		if (isInspectorOpen && activeTab && session) {
			void session.setInspector(activeTab, true, { console: true, network: true });
		}
	}

	async function copySelectorText() {
		if (!inspectedElement?.selector) return;
		try {
			await navigator.clipboard.writeText(inspectedElement.selector);
			copiedSelector = true;
			setTimeout(() => {
				copiedSelector = false;
			}, 1800);
		} catch {
			// Fallback
		}
	}

	function attachContextToPrompt(type: 'element' | 'console' | 'network' | 'all') {
		if (isPrivateTakeover) {
			showNotice(m.ui_browserviewer_takeover_privato_attivo_nulla_di_questa_pagina_506a());
			return;
		}
		let formattedText = '';
		const images: { type: 'image'; data: string; mimeType: string }[] = [];

		if (type === 'element' && inspectedElement) {
			formattedText = formatElementContextForPrompt(inspectedElement);
			if (inspectedCropBase64) {
				images.push({ type: 'image', data: inspectedCropBase64, mimeType: 'image/png' });
			}
		} else if (type === 'console') {
			formattedText = formatConsoleErrorsForPrompt(consoleEntries);
		} else if (type === 'network') {
			formattedText = formatFailedRequestsForPrompt(networkEntries);
		} else if (type === 'all') {
			formattedText = formatInspectorContextForPrompt({
				element: inspectedElement,
				consoleEntries,
				networkEntries
			});
			if (inspectedCropBase64) {
				images.push({ type: 'image', data: inspectedCropBase64, mimeType: 'image/png' });
			}
		}

		if (!formattedText.trim() && images.length === 0) {
			showNotice(m.browser_notice_nothing_to_attach());
			return;
		}

		onAttachPromptContext?.(formattedText, images);
		window.dispatchEvent(
			new CustomEvent('composer-insert-context', {
				detail: { text: formattedText, images }
			})
		);
		showNotice(m.browser_notice_context_attached());
	}

	function handleClearBuffer(target: 'console' | 'network' | 'actions' | 'all') {
		if (target === 'console' || target === 'all') {
			consoleBuffer.clear();
			consoleEntries = [];
		}
		if (target === 'network' || target === 'all') {
			networkBuffer.clear();
			networkEntries = [];
		}
		if (target === 'actions' || target === 'all') {
			actionBuffer.clear();
			actionEntries = [];
		}
		if (activeTab && session) {
			void session.clearInspectorBuffer(activeTab, target);
		}
	}

	function requestBodyForEntry(requestId: string) {
		if (!activeTab || !session) return;
		selectedNetworkRequestId = selectedNetworkRequestId === requestId ? null : requestId;
		const entry = networkEntries.find((e) => e.requestId === requestId);
		if (entry && !entry.body && entry.hasBody) {
			void session.requestNetworkBody(activeTab, requestId);
		}
	}

	// Conteggi per badge toolbar
	const errorCount = $derived(consoleEntries.filter((e) => e.level === 'error').length);
	const failedNetworkCount = $derived(networkEntries.filter((e) => e.failed || e.status >= 400).length);

	const inspectorTabs = $derived<ColumnTabItem[]>([
		{
			id: 'elements',
			label: inspectedElement ? m.browser_tab_elements_count({ count: 1 }) : m.browser_tab_elements()
		},
		{
			id: 'console',
			label: errorCount > 0
				? m.browser_tab_console_count({ count: errorCount })
				: consoleEntries.length > 0
					? m.browser_tab_console_count({ count: consoleEntries.length })
					: m.browser_tab_console()
		},
		{
			id: 'network',
			label: failedNetworkCount > 0
				? m.browser_tab_network_count({ count: failedNetworkCount })
				: networkEntries.length > 0
					? m.browser_tab_network_count({ count: networkEntries.length })
					: m.browser_tab_network()
		},
		{
			id: 'actions',
			label: actionEntries.length > 0 ? m.browser_tab_actions_count({ count: actionEntries.length }) : m.browser_tab_actions()
		}
	]);
	// Filtri Console
	const filteredConsoleEntries = $derived.by(() => {
		return consoleEntries.filter((entry) => {
			if (consoleFilterLevel !== 'all' && entry.level !== consoleFilterLevel) return false;
			if (consoleSearchQuery.trim()) {
				const q = consoleSearchQuery.toLowerCase();
				return entry.text.toLowerCase().includes(q) || (entry.url && entry.url.toLowerCase().includes(q));
			}
			return true;
		});
	});

	// Filtri Network
	const filteredNetworkEntries = $derived.by(() => {
		return networkEntries.filter((entry) => {
			if (networkFilter === 'failed' && !entry.failed && entry.status < 400) return false;
			if (networkFilter === 'slow' && entry.durationMs < 1000) return false;
			if (networkFilter === 'xhr' && entry.resourceType !== 'fetch' && entry.resourceType !== 'xhr') return false;
			if (networkFilter === 'other' && (entry.resourceType === 'fetch' || entry.resourceType === 'xhr')) return false;
			if (networkSearchQuery.trim()) {
				const q = networkSearchQuery.toLowerCase();
				return entry.url.toLowerCase().includes(q) || entry.method.toLowerCase().includes(q);
			}
			return true;
		});
	});

	// Filtri Actions
	const filteredActionEntries = $derived.by(() => {
		return actionEntries.filter((entry) => {
			if (actionSearchQuery.trim()) {
				const q = actionSearchQuery.toLowerCase();
				return entry.label.toLowerCase().includes(q) || (entry.details && entry.details.toLowerCase().includes(q));
			}
			return true;
		});
	});

	// Calcolo coordinate overlay dell'elemento ispezionato / puntato sul client
	const activeHighlightElement = $derived(isPickerActive ? hoveredInspectElement : inspectedElement);
	const highlightBox = $derived.by(() => {
		if (!imageEl || !currentFrame?.meta || !activeHighlightElement?.boundingBox) return null;
		const imgRect = imageEl.getBoundingClientRect();
		const meta = currentFrame.meta;
		if (imgRect.width <= 0 || imgRect.height <= 0 || meta.viewportWidth <= 0 || meta.viewportHeight <= 0) return null;

		const scaleX = imgRect.width / meta.viewportWidth;
		const scaleY = imgRect.height / meta.viewportHeight;
		const bbox = activeHighlightElement.boundingBox;

		const left = bbox.x * scaleX;
		const top = bbox.y * scaleY;
		const width = bbox.width * scaleX;
		const height = bbox.height * scaleY;

		return {
			left: Math.round(left),
			top: Math.round(top),
			width: Math.max(2, Math.round(width)),
			height: Math.max(2, Math.round(height)),
			tag: activeHighlightElement.tag,
			selector: activeHighlightElement.selector,
			role: activeHighlightElement.role
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} onkeyup={handleKeyUp} onfocusin={handleFocusIn} />

<div class="browser-viewer">
	<!-- Toolbar Browser Studio (S41) -->
	<div class="browser-toolbar">
		<!-- Navigazione: Back, Forward, Reload -->
		<div class="nav-group" role="group" aria-label={m.browser_nav_aria()}>
			<Tooltip text={m.browser_back_tooltip()} placement="bottom">
				<button
					type="button"
					class="tool-btn icon-btn"
					disabled={!activeTab}
					onclick={handleBack}
					aria-label={m.browser_btn_back()}
				>
					<IconArrowLeft />
				</button>
			</Tooltip>
			<Tooltip text={m.browser_forward_tooltip()} placement="bottom">
				<button
					type="button"
					class="tool-btn icon-btn"
					disabled={!activeTab}
					onclick={handleForward}
					aria-label={m.browser_btn_forward()}
				>
					<IconArrowRight />
				</button>
			</Tooltip>
			<Tooltip text={m.browser_reload_tooltip()} placement="bottom">
				<button
					type="button"
					class="tool-btn icon-btn"
					class:loading={activeTab?.loading}
					disabled={!activeTab}
					onclick={handleReload}
					aria-label={m.browser_btn_reload()}
				>
					<IconRefresh />
				</button>
			</Tooltip>
		</div>

		<!-- URL Bar e indicatore stato caricamento -->
		<div class="url-bar" class:is-loading={activeTab?.loading}>
			<span class="url-icon" aria-hidden="true">
				{#if activeTab?.originPermission === 'local' || (activeTab?.url && activeTab.url.startsWith('https://'))}
					<IconLock />
				{:else}
					<IconGlobe />
				{/if}
			</span>
			<input
				type="text"
				class="url-input"
				readonly
				value={activeTab?.url || (tabs.length ? 'about:blank' : m.browser_no_session())}
				title={activeTab?.url || m.browser_url_page_title()}
				aria-label={m.browser_url_input_aria()}
			/>
			{#if activeTab?.loading}
				<StatusMark status="running" label={m.browser_loading_dot()} />
			{/if}
		</div>

		<!-- Badge origine e revoca immediata S43 -->
		{#if activeTab}
			<div class="origin-badge-group">
				<span
					class="origin-perm-badge"
					class:local={activeTab.originPermission === 'local'}
					class:granted={activeTab.originPermission === 'granted'}
					class:pending={activeTab.originPermission === 'pending'}
					class:denied={activeTab.originPermission === 'denied'}
					title={activeTab.originPermission === 'local'
							? m.browser_origin_local_title()
						: activeTab.originPermission === 'granted'
							? m.ui_browserviewer_origine_remota_autorizzata_per_questo_progetto_0481()
							: activeTab.originPermission === 'pending'
								? m.ui_browserviewer_in_attesa_di_consenso_per_origine_remota_41de()
									: m.browser_origin_denied_title()}
				>
					{#if activeTab.originPermission === 'local'}
						{m.browser_origin_local()}
					{:else if activeTab.originPermission === 'granted'}
						{m.browser_origin_granted()}
					{:else if activeTab.originPermission === 'pending'}
						<StatusMark status="pending" label={m.ui_browserviewer_in_attesa_di_consenso_per_origine_remota_41de()} />
						{m.page_agent_state_idle()}
					{:else}
						{m.browser_origin_denied()}
					{/if}
				</span>
				{#if activeTab.originPermission === 'granted'}
					<button
						type="button"
						class="revoke-origin-btn"
						onclick={() => decideOrigin('revoke')}
						disabled={originBusy}
						title={m.browser_revoke_origin_title()}
					>
						{m.browser_revoke_btn()}
					</button>
				{/if}
			</div>
		{/if}

		<!-- Selettore Tab se multiple -->
		{#if tabs.length > 1}
			<div class="tabs-group" role="group" aria-label={m.browser_tabs_selector_aria()}>
				{#each tabs as tab}
					<button
						type="button"
						class="tab-btn"
						class:active={activeTab?.tabId === tab.tabId}
						onclick={() => (selectedTabId = tab.tabId)}
						title={tab.title ? `${tab.title} (${tab.url})` : tab.tabId}
					>
						{formatTabLabel(tab)}
					</button>
				{/each}
			</div>
		{:else if activeTab}
			<span class="tab-single-badge" title={m.browser_tab_active_badge()}>{formatTabLabel(activeTab)}</span>
		{/if}

		<!-- Modalita e selezione esplicita Chrome personale (S46) -->
		<span class="mode-badge" class:relay={activeTab?.mode === 'chrome-relay'}>
			{activeTab?.mode === 'chrome-relay' ? 'Chrome Relay' : 'Browser Studio'}
		</span>
		{#if activeTab?.mode === 'chrome-relay'}
			<button type="button" class="tool-btn" disabled={relayBusy} onclick={disconnectRelay}>
				{m.browser_btn_disconnect_relay()}
			</button>
		{:else}
			<button type="button" class="tool-btn" disabled={relayBusy || !session?.browserLive?.features.includes('chrome-relay')} onclick={openRelayPicker}>
				<IconPlus /> {m.browser_btn_use_my_chrome()}
			</button>
		{/if}


		<!-- Viewport responsive selector -->
		<div class="device-group" role="group" aria-label={m.browser_viewport_aria()}>
			<button
				type="button"
				class="device-btn"
				class:active={device === 'desktop'}
				onclick={() => (device = 'desktop')}
				title={m.preview_device_desktop_aria()}
			>
				{m.preview_device_desktop()}
			</button>
			<button
				type="button"
				class="device-btn"
				class:active={device === 'tablet'}
				onclick={() => (device = 'tablet')}
				title={m.preview_device_tablet_aria()}
			>
				{m.preview_device_tablet()}
			</button>
			<button
				type="button"
				class="device-btn"
				class:active={device === 'mobile'}
				onclick={() => (device = 'mobile')}
				title={m.preview_device_mobile_aria()}
			>
				{m.preview_device_mobile()}
			</button>
		</div>

		<!-- Stato controller: Agente / Utente / Privato -->
		<span
			class="controller-badge"
			class:agent={activeTab?.controller === 'agent' || !activeTab}
			class:user={activeTab?.controller === 'user'}
			class:private={activeTab?.controller === 'private-user'}
			title={m.browser_controller_title()}
		>
			<span class="controller-dot" aria-hidden="true"></span>
			{#if activeTab?.controller === 'private-user'}
				<IconLock /> {m.browser_controller_private()}
			{:else if activeTab?.controller === 'user'}
				{m.browser_controller_user()}
			{:else}
				{m.project_popover_speaker_agent()}
			{/if}
		</span>

		<!-- Azioni controllo S42: Rilascio all'Agente e Toggle Privato -->
		{#if activeTab && (activeTab.controller === 'user' || activeTab.controller === 'private-user')}
			<button
				type="button"
				class="tool-btn return-control-btn"
				onclick={handleReturnControl}
				title={m.ui_browserviewer_restituisci_il_controllo_della_scheda_all_agente_c47d()}
			>
				<IconArrowLeft /> {m.browser_btn_release_to_agent()}
			</button>
		{/if}

		{#if activeTab}
			<button
				type="button"
				class="tool-btn privacy-toggle-btn"
				class:active={activeTab.controller === 'private-user'}
				onclick={handleTogglePrivacy}
				title={activeTab.controller === 'private-user'
					? m.ui_browserviewer_disattiva_modalita_privata_ripristina_visibilita_utente_standard_8136()
					: m.ui_browserviewer_attiva_modalita_privata_oscura_transcript_screenshot_e_f83c()}
			>
				<IconLock /> {activeTab.controller === 'private-user' ? m.browser_controller_private() : m.browser_controller_private()}
			</button>
		{/if}

		<!-- Controlli Inspector mirato (S44) -->
		<Tooltip text={m.browser_inspect_tooltip()} placement="bottom">
			<button
				type="button"
				class="tool-btn picker-btn"
				class:active={isPickerActive}
				onclick={togglePicker}
				aria-label={m.browser_inspect_aria()}
			>
				<IconInspect /> {m.browser_inspect_element_btn()}
			</button>
		</Tooltip>

		<Tooltip text={m.ui_browserviewer_apri_inspector_mirato_console_network_actions_00be()} placement="bottom">
			<button
				type="button"
				class="tool-btn inspector-btn"
				class:active={isInspectorOpen}
				onclick={toggleInspector}
				aria-label={m.browser_inspector_aria()}
			>
				<IconTerminal /> {m.browser_inspector_btn()}
				{#if errorCount > 0}
					<span class="inspector-err-badge" title={m.browser_console_errors_badge({ count: errorCount })}>{errorCount}</span>
				{:else if failedNetworkCount > 0}
					<span class="inspector-warn-badge" title={m.browser_network_failed_badge({ count: failedNetworkCount })}>{failedNetworkCount}</span>
				{/if}
			</button>
		</Tooltip>

		<!-- Capability della pagina e registrazione locale (S45) -->
		{#if activeTab}
			<MenuButton
				open={isCapabilityMenuOpen}
				title={m.browser_permissions_menu_title()}
				ariaLabel={m.browser_permissions_menu_aria()}
				hasPopup="menu"
				width="300px"
				align="right"
				onToggle={() => (isCapabilityMenuOpen = !isCapabilityMenuOpen)}
				onClose={() => (isCapabilityMenuOpen = false)}
			>
				{#snippet trigger()}
					<IconLock /> {m.browser_permissions_btn()} <IconChevronDown />
				{/snippet}
				<div class="capability-menu-content">
					<p class="capability-menu-origin">{extractOrigin(activeTab.url) || activeTab.url}</p>
					{#each BROWSER_CAPABILITIES as capability}
						<div class="capability-row">
							<span class="capability-name">{CAPABILITY_LABELS[capability]}</span>
							<Segmented
								options={[
									{ value: 'denied', label: 'Nega' },
									{ value: 'prompt', label: 'Chiedi' },
									{ value: 'granted', label: 'Consenti' }
								]}
								value={capabilityDecision(capability)}
								onChange={(val) => changeCapability(capability, val as BrowserCapabilityDecision)}
								ariaLabel={CAPABILITY_LABELS[capability]}
							/>
						</div>
					{/each}
				</div>
			</MenuButton>

			<Tooltip text={isRecording ? m.ui_browserviewer_interrompi_la_registrazione_locale_della_scheda_9af8() : m.browser_record_tooltip()} placement="bottom">
				<button
					type="button"
					class="tool-btn recording-btn"
					class:active={isRecording}
					onclick={toggleRecording}
					disabled={recording?.status === 'stopping'}
					aria-label={isRecording ? m.browser_record_stop_aria() : m.browser_record_start_aria()}
				>
					<span bind:this={recordingDotEl} class="recording-dot" class:recording={isRecording} class:live={isRecordingLive} aria-hidden="true"></span>
					{#if recording?.status === 'stopping'}
						{m.browser_recording_stopping()}
					{:else if isRecording}
						{m.browser_record_stop({ count: recording?.frameCount ?? 0 })}
					{:else}
						{m.browser_record_start()}
					{/if}
				</button>
			</Tooltip>
		{/if}

		<span class="toolbar-spacer"></span>
		<Tooltip text={m.ui_browserviewer_copia_screenshot_negli_appunti_e888()} placement="bottom">
			<button
				type="button"
				class="tool-btn"
				disabled={!currentFrame}
				onclick={copyScreenshot}
				aria-label={m.browser_copy_screenshot()}
			>
				{#if copiedScreenshot}
					<IconCheck /> {m.browser_copied()}
				{:else}
					<IconCamera /> {m.browser_capture()}
				{/if}
			</button>
		</Tooltip>

		<button
			type="button"
			class="tool-btn close icon-btn"
			onclick={() => onClose?.()}
			aria-label={m.browser_close_viewer()}
		>
			<IconClose />
		</button>
	</div>

	<Dialog
		open={relayPickerOpen}
		title={m.browser_relay_picker_title()}
		onClose={() => {
			relayPickerOpen = false;
			relayTargets = [];
		}}
		ariaLabel={m.browser_relay_picker_title()}
	>
		{#snippet body()}
			<p class="relay-picker-sub">{m.browser_relay_picker_sub()}</p>
			{#if relayDiagnostic}
				<p class="relay-diagnostic"><IconWarning /> {relayDiagnostic}</p>
			{:else if relayTargets.length === 0}
				<p class="relay-empty">{m.browser_relay_empty()}</p>
			{:else}
				<div class="relay-targets" role="list">
					{#each relayTargets as target (target.targetId)}
						<button type="button" class="relay-target" disabled={relayBusy} onclick={() => authorizeRelayTarget(target.targetId)}>
							<span>{target.title || m.browser_relay_untitled_tab()}</span>
							<small>{target.origin}{target.active ? ' · attiva' : ''}</small>
						</button>
					{/each}
				</div>
			{/if}
			{#if relayProbe?.diagnostic}<p class="relay-diagnostic"><IconWarning /> {relayProbe.diagnostic}</p>{/if}
		{/snippet}
	</Dialog>

	<!-- Stage di visualizzazione live -->
	<div class="browser-stage" class:with-inspector={isInspectorOpen} class:picker-active={isPickerActive}>
		<!-- Toast notifica contesto allegato -->
		{#if contextAttachedNotice}
			<div class="context-attached-toast" role="status" aria-live="polite">
				<IconCheck /> {contextAttachedNotice}
			</div>
		{/if}

		<!-- Pila dei consensi: origine remota (S43), file e download (S45) -->
		<div class="consent-stack">
		{#if isPrivateTakeover}
			<div class="origin-consent-banner" role="status">
				<div class="origin-consent-info">
					<span class="origin-consent-icon danger" aria-hidden="true"><IconLock /></span>
					<div class="origin-consent-text">
						<p class="origin-consent-title">{m.browser_controller_private()}</p>
						<p class="origin-consent-desc">{m.browser_private_active_desc()}</p>
					</div>
				</div>
				{#if activeTab}
					<div class="origin-consent-actions">
						<button type="button" class="btn-consent-deny" onclick={handleTogglePrivacy}>
							{m.browser_private_disable()}
						</button>
					</div>
				{/if}
			</div>
		{/if}
		{#if activeTab?.originPermission === 'pending'}
			<div class="origin-consent-banner" role="alert">
				<div class="origin-consent-info">
					<span class="origin-consent-icon" aria-hidden="true"><IconWarning /></span>
					<div class="origin-consent-text">
						<p class="origin-consent-title">{m.browser_consent_origin_title()}</p>
						<p class="origin-consent-desc">
							{m.ui_browserviewer_l_agente_richiede_di_navigare_verso_l_1e06()} <strong>{extractOrigin(activeTab.url) || activeTab.url}</strong>.
						</p>
					</div>
				</div>
				<div class="origin-consent-actions">
					<button
						type="button"
						class="btn-consent-grant"
						onclick={() => decideOrigin('grant')}
						disabled={originBusy}
					>
						{m.ui_browserviewer_consenti_per_questo_progetto_6b61()}
					</button>
					<button
						type="button"
						class="btn-consent-deny"
						onclick={() => decideOrigin('revoke')}
						disabled={originBusy}
					>
						{m.browser_origin_deny()}
					</button>
				</div>
			</div>
		{/if}
		<!-- Selettore file intercettato: solo dal dialogo nativo (S45) -->
		{#if pendingChooser}
			<div class="origin-consent-banner" role="alert">
				<div class="origin-consent-info">
					<span class="origin-consent-icon" aria-hidden="true"><IconWarning /></span>
					<div class="origin-consent-text">
						<p class="origin-consent-title">
							{pendingChooser.mode === 'multiple' ? m.browser_consent_file_multiple() : m.browser_consent_file_single()}
						</p>
						<p class="origin-consent-desc">
							{m.browser_consent_file_desc()}
						</p>
					</div>
				</div>
				<div class="origin-consent-actions">
					<button type="button" class="btn-consent-grant" disabled={uploadBusy} onclick={chooseUploadFiles}>
						{uploadBusy ? m.browser_consent_choose_file_busy() : m.browser_consent_choose_file()}
					</button>
					<button type="button" class="btn-consent-deny" onclick={cancelChooser}>{m.common_cancel()}</button>
				</div>
			</div>
		{/if}

		<!-- Download in attesa di consenso su origine remota (S45) -->
		{#each pendingDownloads as download (download.downloadId)}
			<div class="origin-consent-banner" role="alert">
				<div class="origin-consent-info">
					<span class="origin-consent-icon" aria-hidden="true"><IconWarning /></span>
					<div class="origin-consent-text">
						<p class="origin-consent-title">{m.browser_consent_download_title()}</p>
						<p class="origin-consent-desc">
							<strong>{download.suggestedFilename}</strong> ({formatBytes(download.receivedBytes)}) {m.browser_download_from()}
							<strong>{download.origin || download.url}</strong>{m.ui_browserviewer_il_file_e_in_quarantena_e_non_34e1()}
						</p>
					</div>
				</div>
				<div class="origin-consent-actions">
					<button type="button" class="btn-consent-grant" onclick={() => decideDownload(download.downloadId, true)}>
						{m.browser_consent_download_save()}
					</button>
					<button type="button" class="btn-consent-deny" onclick={() => decideDownload(download.downloadId, false)}>
						{m.browser_consent_download_delete()}
					</button>
				</div>
			</div>
		{/each}
		</div>
		{#if openDialog}
			<Dialog
				open={true}
				title={openDialog.kind === 'beforeunload'
					? m.browser_dialog_beforeunload()
					: openDialog.kind === 'confirm'
						? m.ui_browserviewer_conferma_richiesta_dalla_pagina_1c4b()
						: openDialog.kind === 'prompt'
							? m.browser_dialog_prompt_title()
							: m.browser_dialog_alert_title()}
				onClose={() => respondDialog(openDialog.kind === 'alert')}
				ariaLabel={m.browser_dialog_page_title()}
			>
				{#snippet body()}
					<p class="js-dialog-origin">{extractOrigin(openDialog.url) || openDialog.url}</p>
					<p class="js-dialog-message">{openDialog.message || m.browser_dialog_no_message()}</p>
					{#if openDialog.kind === 'prompt'}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="text"
							class="ui-input"
							bind:value={promptAnswer}
							autofocus
							aria-label={m.browser_dialog_prompt_aria()}
						/>
					{/if}
					<p class="js-dialog-note">{m.browser_dialog_paused_note()}</p>
				{/snippet}
				{#snippet footer()}
					<div class="js-dialog-actions">
						{#if openDialog.kind !== 'alert'}
							<button type="button" class="btn-consent-deny" onclick={() => respondDialog(false)}>
								{openDialog.kind === 'beforeunload' ? m.browser_dialog_stay() : m.common_cancel()}
							</button>
						{/if}
						<button type="button" class="btn-consent-grant" onclick={() => respondDialog(true)}>
							{openDialog.kind === 'beforeunload' ? m.browser_dialog_leave() : 'OK'}
						</button>
					</div>
				{/snippet}
			</Dialog>
		{/if}

		<!-- Avanzamento download e artifact conclusi (S45) -->
		{#if runningDownloads.length || finishedDownloads.length || recording}
			<div class="artifact-strip">
				{#each runningDownloads as download (download.downloadId)}
					<span class="artifact-chip in-progress">
						{download.suggestedFilename}
						{download.totalBytes > 0
							? `${Math.round((download.receivedBytes / download.totalBytes) * 100)}%`
							: formatBytes(download.receivedBytes)}
					</span>
				{/each}
				{#each finishedDownloads as download (download.downloadId)}
					{#if download.status === 'completed' && download.artifactPath}
						<button
							type="button"
							class="artifact-chip done"
							onclick={() => revealArtifact(download.artifactPath as string)}
							title={download.artifactPath}
						>
							{download.suggestedFilename} · {formatBytes(download.receivedBytes)}
						</button>
					{:else}
						<span class="artifact-chip rejected" title={download.error ?? ''}>
							{download.suggestedFilename} · {download.status === 'denied' ? 'eliminato' : m.ui_browserviewer_fallito_ca59()}
						</span>
					{/if}
				{/each}
				{#if recording && recording.status === 'completed' && recording.path}
					<button
						type="button"
						class="artifact-chip done"
						onclick={() => revealArtifact(recording?.path as string)}
						title={recording.path}
					>
						{m.browser_recording_chip({ count: recording.frameCount, size: formatBytes(recording.bytes) })}
					</button>
				{:else if recording && recording.status === 'failed'}
					<span class="artifact-chip rejected" title={recording.error ?? ''}>{m.ui_browserviewer_registrazione_fallita_d34b()}</span>
				{/if}
			</div>
		{/if}
		{#if !tabs.length}
			<div class="center-note">
				<span class="note-icon"><IconGlobe /></span>
				<p class="note-title">{m.browser_empty_title()}</p>
				<p class="note-desc">
					{m.ui_browserviewer_avvia_un_comando_o_task_che_utilizza_f0ce()} <code>browser</code> {m.browser_empty_desc_after()}
				</p>
			</div>
		{:else if currentFrame}
			<!-- Contenitore Responsive Viewport -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events, a11y_no_noninteractive_tabindex -->
			<div
				bind:this={viewportEl}
				class="viewport-frame"
				style:width={DEVICE_WIDTHS[device]}
				role="application"
				tabindex="0"
				aria-label={m.browser_stage_aria()}
				onpointerenter={() => (isHovering = true)}
				onpointerleave={() => {
					isHovering = false;
					hoverPoint = null;
				}}
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
				onwheel={handleWheel}
				onclick={handleClick}
				ondblclick={handleDblClick}
			>
				<img
					bind:this={imageEl}
					src="data:{currentFrame.meta.mimeType};base64,{currentFrame.imageBase64}"
					alt={m.browser_live_viewport_alt()}
					class="live-image"
					draggable="false"
				/>

				<!-- Highlight overlay non invasivo per Element Picker (S44) -->
				{#if highlightBox}
					<div
						class="element-highlight-overlay"
						style:left="{highlightBox.left}px"
						style:top="{highlightBox.top}px"
						style:width="{highlightBox.width}px"
						style:height="{highlightBox.height}px"
						aria-hidden="true"
					>
						<div class="element-highlight-tooltip">
							<span class="tag-name">&lt;{highlightBox.tag}&gt;</span>
							<span class="dim-label">{highlightBox.width}&times;{highlightBox.height}</span>
							{#if highlightBox.role}
								<span class="role-label">[{highlightBox.role}]</span>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Indicatori metadata e coordinate overlay (S41) -->
				<div class="frame-meta-bar" aria-hidden="true">
					<span class="meta-item">
						{currentFrame.meta.viewportWidth} &times; {currentFrame.meta.viewportHeight}
						{#if currentFrame.meta.deviceScaleFactor > 1}
							<span class="meta-sub">@{currentFrame.meta.deviceScaleFactor}x</span>
						{/if}
					</span>
					<span class="meta-item seq">#{currentFrame.meta.sequence}</span>
					{#if hoverPoint}
						<span class="meta-item coords">
							X: {Math.round(hoverPoint.x)}, Y: {Math.round(hoverPoint.y)}
						</span>
					{/if}
					{#if isPickerActive}
						<span class="meta-item picker-indicator">{m.browser_picker_indicator()}</span>
					{/if}
				</div>

				<!--
					Lo stato dello stream e' un overlay: sostituire il frame smonterebbe
					il nodo che possiede il focus da tastiera e coprirebbe la pagina di
					spinner a ogni riconnessione. L'overlay intercetta anche il puntatore,
					quindi nessun input parte su coordinate non piu' vive.
				-->
				{#if streamStatus !== 'live'}
					<div class="stream-overlay" role="status">
						{#if streamStatus === 'error'}
							<span class="note-icon error"><IconWarning /></span>
							<p class="note-title">{m.browser_stream_err_title()}</p>
						{:else}
							<StatusMark status="running" label={streamStatus === 'disconnected' ? m.browser_stream_disconnected_title() : m.browser_stream_reconnect_title()} />
							<p class="note-title">
								{streamStatus === 'disconnected' ? m.browser_stream_disconnected_title() : m.browser_stream_reconnect_title()}
							</p>
						{/if}
						<p class="note-desc">{streamError || m.ui_browserviewer_fotogramma_non_aggiornato_in_attesa_del_canale_2649()}</p>
						<button type="button" class="tool-btn" onclick={retryStream}>
							<IconRefresh /> {m.browser_stream_retry_btn()}
						</button>
					</div>
				{/if}
			</div>
		{:else if streamStatus === 'error'}
			<div class="center-note error" role="alert">
				<span class="note-icon error"><IconWarning /></span>
				<p class="note-title">{m.browser_stream_err_title()}</p>
				<p class="note-desc">{streamError || m.browser_stream_connect_failed()}</p>
				<button type="button" class="tool-btn" onclick={retryStream} style="margin-top: var(--space-3);">
					<IconRefresh /> {m.browser_stream_retry_conn()}
				</button>
			</div>
		{:else if streamStatus === 'disconnected'}
			<div class="center-note" role="status">
				<StatusMark status="running" label={m.browser_stream_disconnected()} />
				<p class="note-title">{m.browser_stream_disconnected()}</p>
				<p class="note-desc">{streamError || m.ui_browserviewer_riconnessione_automatica_in_corso_f7ab()}</p>
				<button type="button" class="tool-btn" onclick={retryStream} style="margin-top: var(--space-3);">
					<IconRefresh /> {m.browser_stream_retry_btn()}
				</button>
			</div>
		{:else}
			<div class="center-note">
				<StatusMark status="running" label={m.ui_browserviewer_connessione_allo_stream_live_in_corso_3962()} />
				<p class="note-title">{m.ui_browserviewer_connessione_allo_stream_live_in_corso_3962()}</p>
				<p class="note-desc">{m.browser_stream_connecting_desc()}</p>
			</div>
		{/if}
	</div>

	<!-- Dock Inspector mirato retrattile (S44) -->
	{#if isInspectorOpen}
		<div class="inspector-dock" role="region" aria-label={m.browser_inspector_aria()} transition:rvLift>
			<div class="inspector-tabbar">
				<div class="tabbar-left">
					<ColumnTabs
						tabs={inspectorTabs}
						selected={activeInspectorTab}
						onChange={(id) => (activeInspectorTab = id as InspectorTab)}
						ariaLabel={m.browser_inspector_sections_aria()}
						tabIdPrefix={`${inspectorId}-tab-`}
						panelIdPrefix={`${inspectorId}-panel-`}
					/>
				</div>

				<div class="tabbar-right">
					<!-- Azioni contestuali al prompt e pulizia buffer -->
					{#if activeInspectorTab === 'elements' && inspectedElement}
						<Tooltip text={m.ui_browserviewer_invia_dettagli_e_ritaglio_dell_elemento_al_b1eb()} placement="top">
							<button
								type="button"
								class="inspector-action-btn attach-btn"
								onclick={() => attachContextToPrompt('element')}
							>
								<IconSend /> {m.browser_btn_attach_element()}
							</button>
						</Tooltip>
					{:else if activeInspectorTab === 'console' && consoleEntries.length > 0}
						<Tooltip text={m.browser_attach_console_tooltip()} placement="top">
							<button
								type="button"
								class="inspector-action-btn attach-btn"
								disabled={errorCount === 0}
								onclick={() => attachContextToPrompt('console')}
							>
								<IconSend /> {m.browser_btn_attach_errors({ count: errorCount })}
							</button>
						</Tooltip>
						<Tooltip text={m.browser_clear_console()} placement="top">
							<button
								type="button"
								class="inspector-action-btn"
								onclick={() => handleClearBuffer('console')}
								aria-label={m.browser_clear_console()}
							>
								<IconClear /> {m.browser_btn_clear()}
							</button>
						</Tooltip>
					{:else if activeInspectorTab === 'network' && networkEntries.length > 0}
						<Tooltip text={m.browser_attach_network_tooltip()} placement="top">
							<button
								type="button"
								class="inspector-action-btn attach-btn"
								disabled={failedNetworkCount === 0}
								onclick={() => attachContextToPrompt('network')}
							>
								<IconSend /> {m.browser_btn_attach_failed_network({ count: failedNetworkCount })}
							</button>
						</Tooltip>
						<Tooltip text={m.browser_clear_network()} placement="top">
							<button
								type="button"
								class="inspector-action-btn"
								onclick={() => handleClearBuffer('network')}
								aria-label={m.browser_clear_network()}
							>
								<IconClear /> {m.browser_btn_clear()}
							</button>
						</Tooltip>
					{:else if activeInspectorTab === 'actions' && actionEntries.length > 0}
						<Tooltip text={m.browser_clear_actions()} placement="top">
							<button
								type="button"
								class="inspector-action-btn"
								onclick={() => handleClearBuffer('actions')}
								aria-label={m.browser_clear_actions()}
							>
								<IconClear /> {m.browser_btn_clear()}
							</button>
						</Tooltip>
					{/if}

					<button
						type="button"
						class="tool-btn icon-btn"
						onclick={() => (isInspectorOpen = false)}
						aria-label={m.ui_browserviewer_chiudi_inspector_e1dd()}
					>
						<IconClose />
					</button>
				</div>
			</div>

			<div
				class="inspector-panel-body"
				role="tabpanel"
				id={`${inspectorId}-panel-${activeInspectorTab}`}
				aria-labelledby={`${inspectorId}-tab-${activeInspectorTab}`}
			>
				{#if activeInspectorTab === 'elements'}
					<!-- Elements Tab -->
					{#if inspectedElement}
						<div class="elements-tab-content">
							<div class="element-header-row">
								<div class="element-main-spec">
									<span class="elem-tag">&lt;{inspectedElement.tag}&gt;</span>
									{#if inspectedElement.component}
										<span class="elem-component">&lt;{inspectedElement.component}&gt;</span>
									{/if}
									<span class="elem-selector" title={inspectedElement.selector}>
										{inspectedElement.selector}
									</span>
									<button
										type="button"
										class="mini-copy-btn"
										onclick={copySelectorText}
										title={m.ui_browserviewer_copia_selettore_css_negli_appunti_3f94()}
									>
										{#if copiedSelector}
											<IconCheck /> {m.browser_copied()}
										{:else}
											<IconCopy /> {m.browser_btn_copy_selector()}
										{/if}
									</button>
								</div>
								{#if inspectedCropBase64}
									<div class="elem-crop-preview" title={m.browser_element_crop()}>
										<img src="data:image/png;base64,{inspectedCropBase64}" alt={m.browser_element_crop()} />
									</div>
								{/if}
							</div>

							<div class="element-meta-grid">
								<div class="meta-field">
									<span class="field-label">{m.browser_field_aria_role()}</span>
									<span class="field-val">{inspectedElement.role || '—'}</span>
								</div>
								<div class="meta-field">
									<span class="field-label">{m.browser_field_accessible_name()}</span>
									<span class="field-val">{inspectedElement.accessibleName || '—'}</span>
								</div>
								<div class="meta-field">
									<span class="field-label">Bounding Box</span>
									<span class="field-val">
										{m.browser_bounding_box_value({
										width: Math.round(inspectedElement.boundingBox.width),
										height: Math.round(inspectedElement.boundingBox.height),
										x: Math.round(inspectedElement.boundingBox.x),
										y: Math.round(inspectedElement.boundingBox.y)
									})}
									</span>
								</div>
								<div class="meta-field">
									<span class="field-label">{m.browser_field_text()}</span>
									<span class="field-val text-truncate">{inspectedElement.text || '—'}</span>
								</div>
							</div>

							{#if Object.keys(inspectedElement.computedStyles).length > 0}
								<div class="element-styles-section">
									<span class="section-sub-title">{m.browser_field_relevant_styles()}</span>
									<div class="styles-chip-cloud">
										{#each Object.entries(inspectedElement.computedStyles) as [prop, val]}
											<span class="style-chip">
												<strong>{prop}:</strong> {val}
											</span>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{:else}
						<div class="inspector-empty-state">
							<span class="empty-icon"><IconInspect /></span>
							<p class="empty-text">{m.browser_no_element_selected()}</p>
							<p class="empty-hint">
								{m.browser_inspect_hint_before()} <strong>{m.browser_inspect_element_btn()}</strong> {m.browser_inspect_hint_after()}
							</p>
						</div>
					{/if}

				{:else if activeInspectorTab === 'console'}
					<!-- Console Tab -->
					<div class="tab-filter-bar">
						<div class="filter-pills" role="group" aria-label={m.browser_console_filter_aria()}>
							<button
								type="button"
								class="filter-pill"
								class:active={consoleFilterLevel === 'all'}
								onclick={() => (consoleFilterLevel = 'all')}
							>
								{m.browser_filter_all({ count: consoleEntries.length })}
							</button>
							<button
								type="button"
								class="filter-pill error"
								class:active={consoleFilterLevel === 'error'}
								onclick={() => (consoleFilterLevel = 'error')}
							>
								{m.browser_filter_errors({ count: errorCount })}
							</button>
							<button
								type="button"
								class="filter-pill warn"
								class:active={consoleFilterLevel === 'warn'}
								onclick={() => (consoleFilterLevel = 'warn')}
							>
								{m.browser_filter_warnings({ count: consoleEntries.filter((e) => e.level === 'warn').length })}
							</button>
							<button
								type="button"
								class="filter-pill info"
								class:active={consoleFilterLevel === 'info'}
								onclick={() => (consoleFilterLevel = 'info')}
							>
								Info ({consoleEntries.filter((e) => e.level === 'info').length})
							</button>
						</div>
						<div class="filter-search-box">
							<IconSearch />
							<input
								type="text"
								class="filter-search-input"
								placeholder={m.browser_filter_search_placeholder()}
								bind:value={consoleSearchQuery}
							/>
						</div>
					</div>

					<div class="tab-list-scroll">
						{#if filteredConsoleEntries.length === 0}
							<div class="inspector-empty-state mini">
								<p class="empty-text">{m.browser_no_console_messages()}</p>
							</div>
						{:else}
							{#each filteredConsoleEntries as item (item.id)}
								<div class="console-row" class:err={item.level === 'error'} class:warn={item.level === 'warn'}>
									<span class="log-level-badge {item.level}">{item.level}</span>
									{#if item.count > 1}
										<span class="count-badge">x{item.count}</span>
									{/if}
									<span class="log-text">{item.text}</span>
									{#if item.url}
										<span class="log-location" title="{item.url}:{item.line || 1}">
											{item.url.split('/').pop()}:{item.line || 1}
										</span>
									{/if}
								</div>
							{/each}
						{/if}
					</div>

				{:else if activeInspectorTab === 'network'}
					<!-- Network Tab -->
					<div class="tab-filter-bar">
						<div class="filter-pills" role="group" aria-label={m.browser_network_filter_aria()}>
							<button
								type="button"
								class="filter-pill"
								class:active={networkFilter === 'all'}
								onclick={() => (networkFilter = 'all')}
							>
								{m.browser_filter_all({ count: networkEntries.length })}
							</button>
							<button
								type="button"
								class="filter-pill error"
								class:active={networkFilter === 'failed'}
								onclick={() => (networkFilter = 'failed')}
							>
								{m.browser_filter_failed({ count: failedNetworkCount })}
							</button>
							<button
								type="button"
								class="filter-pill warn"
								class:active={networkFilter === 'slow'}
								onclick={() => (networkFilter = 'slow')}
							>
								{m.browser_filter_slow({ count: networkEntries.filter((e) => e.durationMs >= 1000).length })}
							</button>
							<button
								type="button"
								class="filter-pill"
								class:active={networkFilter === 'xhr'}
								onclick={() => (networkFilter = 'xhr')}
							>
								Fetch/XHR ({networkEntries.filter((e) => e.resourceType === 'fetch' || e.resourceType === 'xhr').length})
							</button>
						</div>
						<div class="filter-search-box">
							<IconSearch />
							<input
								type="text"
								class="filter-search-input"
								placeholder={m.browser_filter_url_placeholder()}
								bind:value={networkSearchQuery}
							/>
						</div>
					</div>

					<div class="tab-list-scroll">
						{#if filteredNetworkEntries.length === 0}
							<div class="inspector-empty-state mini">
								<p class="empty-text">{m.browser_no_network_requests()}</p>
							</div>
						{:else}
							{#each filteredNetworkEntries as req (req.id)}
								<div
									class="network-row"
									role="button"
									tabindex="0"
									class:failed={req.failed || req.status >= 400}
									onclick={() => requestBodyForEntry(req.requestId)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											requestBodyForEntry(req.requestId);
										}
									}}
								>
									<span class="status-pill" class:ok={req.status >= 200 && req.status < 400} class:err={req.status >= 400 || req.failed}>
										{req.status > 0 ? req.status : 'ERR'}
									</span>
									<span class="net-url" title={req.url}>{req.url}</span>
									<span class="net-type">{req.resourceType}</span>
									<span class="net-duration">{req.durationMs}ms</span>
								</div>
								{#if selectedNetworkRequestId === req.requestId}
									<div class="network-detail-pane">
										{#if req.errorText}
											<div class="detail-err-banner">{m.ui_browserviewer_errore_873d()} {req.errorText}</div>
										{/if}
										{#if req.headers}
											<div class="detail-section">
												<span class="detail-label">{m.browser_headers_label()}</span>
												<div class="detail-headers">
													{#each Object.entries(req.headers) as [hk, hv]}
														<div class="header-line"><strong>{hk}:</strong> {hv}</div>
													{/each}
												</div>
											</div>
										{/if}
										{#if req.body}
											<div class="detail-section">
												<span class="detail-label">{m.browser_response_body_label()}</span>
												<pre class="body-pre">{req.body}</pre>
											</div>
										{:else if req.hasBody}
											<div class="detail-section">
												<span class="detail-label muted">{m.browser_response_body_available()}</span>
											</div>
										{/if}
									</div>
								{/if}
							{/each}
						{/if}
					</div>

				{:else if activeInspectorTab === 'actions'}
					<!-- Actions Tab -->
					<div class="tab-filter-bar">
						<div class="filter-search-box">
							<IconSearch />
							<input
								type="text"
								class="filter-search-input"
								placeholder={m.browser_search_actions_placeholder()}
								bind:value={actionSearchQuery}
							/>
						</div>
					</div>

					<div class="tab-list-scroll">
						{#if filteredActionEntries.length === 0}
							<div class="inspector-empty-state mini">
								<p class="empty-text">{m.browser_no_recorded_actions()}</p>
							</div>
						{:else}
							{#each filteredActionEntries as act (act.id)}
								<div class="action-row">
									<span class="action-time">{i18n.formatDate(act.timestamp, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
									<span class="action-kind-pill {act.kind}">{act.kind}</span>
									<span class="action-label">{act.label}</span>
									{#if act.details}
										<span class="action-details">{act.details}</span>
									{/if}
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.browser-viewer {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background: var(--bg-sunken);
		overflow: hidden;
	}

	/* Toolbar conforme ai token e allineata a PreviewViewer */
	.browser-toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-3);
		height: 32px;
		background: var(--bg-sunken);
		overflow-x: auto;
		overflow-y: hidden;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		user-select: none;
	}

	.nav-group,
	.device-group,
	.origin-badge-group {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		height: 28px;
		padding: 0 var(--space-2);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.tool-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.tool-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.tool-btn.icon-btn {
		width: 28px;
		padding: 0;
	}

	.tool-btn.close:hover {
		background: var(--danger-dim);
		color: var(--ink);
	}

	/* Barra URL */
	.url-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1 1 200px;
		min-width: 160px;
		max-width: 440px;
		height: 28px;
		padding: 0 var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
	}

	.url-icon {
		display: inline-flex;
		align-items: center;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.url-input {
		flex: 1;
		background: transparent;
		border: none;
	}

	.url-input:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Gruppo Schede (Tab) */
	.tabs-group {
		display: flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 2px;
	}

	.tab-btn {
		height: 22px;
		padding: 0 var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.tab-btn.active {
		background: var(--bg-raised);
		color: var(--ink);
		font-weight: 500;
	}

	.tab-single-badge {
		padding: 2px 6px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: nowrap;
		flex-shrink: 0;
	}

	/* Badge di stato e modalita */
	.mode-badge {
		padding: 2px 6px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.mode-badge.relay {
		background: var(--bg-base);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.controller-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		border: 1px solid var(--line);
		background: var(--bg-base);
		color: var(--ink);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.controller-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		flex-shrink: 0;
	}

	.controller-badge.agent .controller-dot {
		background: var(--brand);
	}

	.controller-badge.user .controller-dot {
		background: var(--warn);
	}

	.controller-badge.private .controller-dot {
		background: var(--danger);
	}

	.controller-badge.private :global(svg) {
		color: var(--danger);
		width: 12px;
		height: 12px;
	}

	.tool-btn.return-control-btn {
		background: color-mix(in srgb, var(--brand) 12%, transparent);
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
		font-weight: 500;
	}

	.tool-btn.return-control-btn:hover {
		background: color-mix(in srgb, var(--brand) 18%, transparent);
	}

	.tool-btn.privacy-toggle-btn.active {
		background: var(--bg-base);
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 30%, transparent);
		font-weight: 500;
	}
	.device-group {
		display: flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 2px;
	}

	.device-btn {
		height: 22px;
		padding: 0 var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.device-btn.active {
		background: var(--bg-raised);
		color: var(--ink);
		font-weight: 500;
	}

	.toolbar-spacer {
		flex: 1;
	}

	/* Stage centrale */
	.browser-stage {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3);
		overflow: auto;
		background: var(--bg-sunken);
		position: relative;
	}

	.viewport-frame {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		max-width: 100%;
		max-height: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.live-image {
		display: block;
		width: 100%;
		height: auto;
		max-height: calc(100vh - 120px);
		object-fit: contain;
		user-select: none;
		-webkit-user-drag: none;
		cursor: crosshair;
	}

	/* Stato dello stream sopra il frame, senza smontarlo */
	.stream-overlay {
		position: absolute;
		inset: 0;
		z-index: var(--z-backdrop);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-4);
		text-align: center;
		background: color-mix(in srgb, var(--bg-base) 78%, transparent);
	}

	.stream-overlay .note-desc {
		max-width: 42ch;
	}

	/* Overlay metadati e coordinate */
	.frame-meta-bar {
		position: absolute;
		bottom: var(--space-2);
		right: var(--space-2);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 2px 8px;
		background: color-mix(in srgb, var(--bg-base) 88%, transparent);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		pointer-events: none;
		user-select: none;
	}

	.meta-item {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.meta-sub {
		color: var(--ink-faint);
	}

	.meta-item.seq {
		color: var(--ink-faint);
	}

	.meta-item.coords {
		color: var(--brand-ink);
		font-weight: 500;
	}

	/* Note e stati centrali */
	.center-note {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-6);
		color: var(--ink-muted);
		text-align: center;
		max-width: 360px;
	}

	.note-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-full);
		background: var(--bg-base);
		color: var(--ink-muted);
		margin-bottom: var(--space-2);
	}

	.note-icon.error {
		background: var(--danger-dim);
		color: var(--danger);
	}

	.note-title {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--ink);
	}

	.note-desc {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.5;
	}

	.note-desc code {
		padding: 1px 4px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}

	/* S43 — Badge e banner origine */
	.origin-badge-group {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.origin-perm-badge {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.origin-perm-badge.local {
		background: var(--bg-base);
		color: var(--ink-faint);
		border: 1px solid var(--line);
	}

	.origin-perm-badge.granted {
		background: var(--bg-base);
		color: var(--success);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
	}

	.origin-perm-badge.pending {
		background: var(--bg-base);
		color: var(--warn);
		border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
	}

	.origin-perm-badge.denied {
		background: var(--bg-base);
		color: var(--danger);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
	}

	.revoke-origin-btn {
		height: 20px;
		padding: 0 6px;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.revoke-origin-btn:hover {
		background: var(--danger-dim);
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}

	.origin-consent-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		width: 100%;
	}

	.origin-consent-info {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.origin-consent-icon {
		color: var(--warn);
		flex-shrink: 0;
		display: inline-flex;
	}

	.origin-consent-icon.danger {
		color: var(--danger);
	}

	.origin-consent-title {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.origin-consent-desc {
		margin: 2px 0 0 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.origin-consent-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.btn-consent-grant {
		padding: 6px 12px;
		background: var(--brand);
		color: var(--on-brand);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		transition: opacity var(--dur-fast) var(--ease-out);
	}

	.btn-consent-grant:hover {
		opacity: 0.9;
	}

	.btn-consent-deny {
		padding: 6px 12px;
		background: var(--bg-base);
		color: var(--ink-muted);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.btn-consent-deny:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	/* Una sola colonna per tutti i consensi: nessun banner ne copre un altro. */
	.consent-stack {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 600px;
		width: calc(100% - 32px);
		pointer-events: none;
	}

	.consent-stack > :global(*) {
		pointer-events: auto;
	}

	/* S44 — Inspector mirato, Element Picker e Dock */
	.tool-btn.picker-btn.active {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand-ink);
		border-color: var(--brand);
		font-weight: 500;
	}

	.tool-btn.inspector-btn.active {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand-ink);
		border-color: var(--brand);
		font-weight: 500;
	}

	.inspector-err-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		background: var(--danger);
		color: var(--on-danger);
		border-radius: var(--radius-full);
		font-size: var(--text-caption);
		font-weight: 700;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.inspector-warn-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		background: var(--warn);
		color: var(--bg-sunken);
		border-radius: var(--radius-full);
		font-size: var(--text-caption);
		font-weight: 700;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.browser-stage.picker-active {
		cursor: crosshair;
	}

	.picker-indicator {
		color: var(--brand-ink);
		font-weight: 600;
	}

	/* Highlight overlay non invasivo (pointer-events: none) */
	.element-highlight-overlay {
		position: absolute;
		border: 2px solid var(--brand);
		background: color-mix(in srgb, var(--brand) 18%, transparent);
		pointer-events: none;
		z-index: var(--z-backdrop);
		box-sizing: border-box;
	}

	.element-highlight-tooltip {
		position: absolute;
		top: -24px;
		left: 0;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		background: var(--bg-raised);
		border: 1px solid var(--brand);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.2;
		white-space: nowrap;
		box-shadow: var(--shadow-dock);
	}

	.element-highlight-tooltip .tag-name {
		color: var(--brand-ink);
		font-weight: 600;
	}

	.element-highlight-tooltip .dim-label {
		color: var(--ink-muted);
	}

	.element-highlight-tooltip .role-label {
		color: var(--success);
	}

	.context-attached-toast {
		position: absolute;
		top: 16px;
		right: 16px;
		z-index: var(--z-toast);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: var(--success);
		color: var(--on-success);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		font-weight: 500;
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-overlay);
		animation: fadeIn var(--dur-fast) var(--ease-out);
	}

	/* Dock Inspector */
	.inspector-dock {
		display: flex;
		flex-direction: column;
		height: 250px;
		min-height: 180px;
		max-height: 50vh;
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
		flex-shrink: 0;
		z-index: var(--z-sticky);
		user-select: text;
		overflow: hidden;
	}

	.inspector-tabbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-2);
		height: 32px;
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.tabbar-left {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.tabbar-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.inspector-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 8px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.inspector-action-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--ink-faint);
	}

	.inspector-action-btn.attach-btn {
		background: color-mix(in srgb, var(--brand) 12%, transparent);
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
		font-weight: 500;
	}

	.inspector-action-btn.attach-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--brand) 18%, transparent);
		border-color: var(--brand);
	}

	.inspector-action-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.inspector-panel-body {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
	}

	/* Elements Tab Content */
	.elements-tab-content {
		padding: var(--space-3);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.element-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.element-main-spec {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}

	.elem-tag {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 700;
		color: var(--brand-ink);
	}

	.elem-component {
		padding: 2px 6px;
		background: color-mix(in srgb, var(--brand) 12%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 25%, transparent);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
	}

	.elem-selector {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-base);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		max-width: 400px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mini-copy-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 6px;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		cursor: pointer;
	}

	.mini-copy-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.elem-crop-preview img {
		max-height: 48px;
		max-width: 90px;
		object-fit: contain;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-base);
	}

	.element-meta-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-2);
	}

	.meta-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 8px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.field-label {
		font-size: var(--text-group-label);
		font-family: var(--font-ui);
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.field-val {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink);
	}

	.text-truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.element-styles-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.section-sub-title {
		font-size: var(--text-group-label);
		font-family: var(--font-ui);
		color: var(--ink-faint);
		text-transform: uppercase;
	}

	.styles-chip-cloud {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.style-chip {
		padding: 2px 6px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink);
	}

	.style-chip strong {
		color: var(--ink-muted);
	}

	/* Filter Bar */
	.tab-filter-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 4px var(--space-2);
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.filter-pills {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.filter-pill {
		height: 20px;
		padding: 0 6px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		cursor: pointer;
	}

	.filter-pill:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.filter-pill.active {
		background: var(--bg-raised);
		color: var(--ink);
		border-color: var(--line);
		font-weight: 500;
	}

	.filter-pill.error.active {
		background: var(--bg-base);
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 30%, transparent);
	}

	.filter-pill.warn.active {
		background: var(--bg-base);
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.filter-search-box {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 6px;
		height: 22px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		width: 220px;
	}

	.filter-search-input {
		flex: 1;
		background: transparent;
		border: none;
		font-size: var(--text-caption);
		font-family: var(--font-ui);
		color: var(--ink);
	}

	.filter-search-input:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	/* Tab List Scroll */
	.tab-list-scroll {
		flex: 1;
		overflow-y: auto;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}

	.console-row {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 4px var(--space-2);
		border-bottom: 1px solid var(--line);
		color: var(--ink);
	}

	.console-row:hover {
		background: var(--bg-hover);
	}

	.console-row.err {
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		color: var(--danger);
	}

	.console-row.warn {
		background: color-mix(in srgb, var(--warn) 8%, transparent);
		color: var(--warn);
	}

	.log-level-badge {
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		font-weight: 700;
		text-transform: uppercase;
		background: var(--bg-base);
		border: 1px solid var(--line);
	}

	.log-level-badge.error {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 30%, transparent);
	}

	.log-level-badge.warn {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.log-level-badge.info {
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.log-level-badge.debug, .log-level-badge.log {
		color: var(--ink-muted);
		border-color: var(--line);
	}

	.count-badge {
		padding: 0 4px;
		background: var(--bg-sunken);
		border-radius: var(--radius-full);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink-muted);
		font-variant-numeric: tabular-nums;
	}

	.log-text {
		flex: 1;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.log-location {
		color: var(--ink-faint);
		font-size: var(--text-caption);
		white-space: nowrap;
	}

	.network-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px var(--space-2);
		border-bottom: 1px solid var(--line);
		cursor: pointer;
	}

	.network-row:hover {
		background: var(--bg-hover);
	}

	.network-row.failed {
		background: color-mix(in srgb, var(--danger) 8%, transparent);
	}

	.method-pill {
		font-weight: 700;
		font-size: var(--text-caption);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		border: 1px solid var(--line);
		font-family: var(--font-mono);
	}

	.method-pill.get,
	.method-pill.post,
	.method-pill.put,
	.method-pill.delete {
		color: var(--ink-muted);
	}

	.status-pill {
		font-weight: 600;
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
	}

	.status-pill.ok { color: var(--success); }
	.status-pill.err { color: var(--danger); }

	.net-url {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
	}

	.net-type {
		color: var(--ink-muted);
		font-size: var(--text-caption);
		width: 60px;
	}

	.net-duration {
		color: var(--ink-faint);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		width: 50px;
		text-align: right;
	}

	.network-detail-pane {
		padding: var(--space-2) var(--space-3);
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-caption);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.detail-err-banner {
		color: var(--danger);
		font-weight: 600;
	}

	.detail-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.detail-label {
		font-size: var(--text-group-label);
		color: var(--ink-faint);
		text-transform: uppercase;
	}

	.detail-label.muted {
		color: var(--ink-muted);
		font-style: italic;
	}

	.detail-headers {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--bg-sunken);
		padding: 4px 6px;
		border-radius: var(--radius-sm);
	}

	.body-pre {
		margin: 0;
		padding: 4px 6px;
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		white-space: pre-wrap;
		word-break: break-all;
		max-height: 120px;
		overflow-y: auto;
	}

	.action-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px var(--space-2);
		border-bottom: 1px solid var(--line);
		color: var(--ink);
	}

	.action-time {
		color: var(--ink-faint);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		width: 65px;
	}

	.action-kind-pill {
		font-size: var(--text-caption);
		font-weight: 700;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		background: var(--bg-base);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.action-kind-pill.navigation,
	.action-kind-pill.agent_action,
	.action-kind-pill.takeover,
	.action-kind-pill.privacy {
		color: var(--ink-muted);
	}

	.action-label {
		flex: 1;
		color: var(--ink);
	}

	.action-details {
		color: var(--ink-muted);
		font-size: var(--text-caption);
	}

	/* Empty States */
	.inspector-empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: var(--space-4);
		color: var(--ink-muted);
		text-align: center;
	}

	.inspector-empty-state.mini {
		padding: var(--space-3);
	}

	.empty-icon {
		color: var(--ink-faint);
		display: inline-flex;
		margin-bottom: 2px;
	}

	.empty-text {
		margin: 0;
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.empty-hint {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		max-width: 320px;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(-4px); }
	}

	/* S45 — dialoghi, permessi, download e registrazione */

	.js-dialog-origin {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.js-dialog-message {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 220px;
		overflow-y: auto;
	}


	.js-dialog-note {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.js-dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.capability-menu-content {
		display: flex;
		flex-direction: column;
		padding: 4px;
	}

	.capability-menu-origin {
		margin: 0 0 var(--space-2) 0;
		padding: 0 8px;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		overflow-wrap: anywhere;
	}

	.capability-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: 7px 8px;
		font-size: 13px;
	}

	.capability-name {
		font-size: var(--text-base);
		color: var(--ink);
	}

	.capability-choices {
		display: inline-flex;
		gap: 2px;
	}

	.capability-choice {
		padding: 2px 6px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.capability-choice:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.capability-choice.active {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		border-color: var(--brand);
		color: var(--brand-ink);
		font-weight: 600;
	}

	.recording-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		display: inline-block;
	}

	.recording-dot.recording {
		background: var(--danger);
	}

	.recording-dot.live {
		animation: recordingPulse 1.4s ease-in-out infinite;
	}

	@keyframes recordingPulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.35; }
	}

	.artifact-strip {
		position: absolute;
		left: 12px;
		bottom: 12px;
		z-index: var(--z-sticky);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		max-width: calc(100% - 24px);
	}

	.artifact-chip {
		padding: 3px 8px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	button.artifact-chip {
		cursor: pointer;
	}

	.artifact-chip.done {
		color: var(--ink);
		border-color: var(--brand);
	}

	.artifact-chip.rejected {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}

	@media (prefers-reduced-motion: reduce) {
		.recording-dot.live {
			animation: none !important;
		}
	}

	:global(:root[data-animations="false"]) .recording-dot.live {
		animation: none !important;
	}
	.relay-picker-sub {
		margin: 0 0 var(--space-2) 0;
		color: var(--ink-muted);
		font-size: var(--text-caption);
	}
	.relay-empty { color: var(--ink-muted); font-size: var(--text-sm); }
	.relay-targets { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-3); }
	.relay-target {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: var(--space-2);
		background: var(--bg-base);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		text-align: left;
		cursor: pointer;
	}
	.relay-target:hover { background: var(--bg-hover); }
	.relay-target:disabled { opacity: .55; cursor: default; }
	.relay-target small { color: var(--ink-faint); }
	.relay-diagnostic { display: flex; gap: var(--space-2); align-items: flex-start; color: var(--warn); font-size: var(--text-sm); }
</style>
