<script lang="ts">
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
	import { trapFocus } from '$lib/focusTrap';
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
		'clipboard-read': 'Lettura appunti',
		'clipboard-write': 'Scrittura appunti',
		geolocation: 'Geolocalizzazione',
		notifications: 'Notifiche'
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
			showNotice('Canale live non disponibile: riprova');
			return;
		}
		promptAnswer = '';
	}

	async function decideDownload(downloadId: string, allow: boolean) {
		if (!activeTab || !session) return;
		const sent = await session.sendLiveMessage(activeTab, { type: 'download_decide', downloadId, allow });
		if (!sent) showNotice('Canale live non disponibile: riprova');
	}

	async function chooseUploadFiles() {
		const chooser = pendingChooser;
		if (!chooser || !activeTab || !session || uploadBusy) return;
		uploadBusy = true;
		try {
			const count = await session.pickUploadFiles(activeTab, chooser.chooserId, chooser.mode === 'multiple');
			showNotice(count > 0 ? `${count} file autorizzati per il caricamento` : 'Selezione file annullata');
		} catch (err) {
			showNotice(`Selettore file non disponibile: ${String(err)}`);
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
		if (!sent) showNotice('Canale live non disponibile: riprova');
	}

	async function changeCapability(capability: BrowserCapability, decision: BrowserCapabilityDecision) {
		if (!activeTab || !session) return;
		const sent = await session.sendLiveMessage(activeTab, { type: 'set_capability', capability, decision });
		if (!sent) showNotice('Canale live non disponibile: riprova');
	}

	async function toggleRecording() {
		if (!activeTab || !session) return;
		const sent = await session.sendLiveMessage(activeTab, {
			type: isRecording ? 'stop_recording' : 'start_recording'
		});
		if (!sent) showNotice('Canale live non disponibile: riprova');
	}

	async function revealArtifact(path: string) {
		try {
			await revealItemInDir(path);
		} catch (err) {
			showNotice(`Impossibile aprire la cartella: ${String(err)}`);
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
							scheduleReconnect(streamError || 'Canale live interrotto');
						}
					}
				);
				if (!active) {
					handle?.();
					return;
				}
				if (!handle) {
					scheduleReconnect('Canale live non disponibile');
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
				label: `Elemento selezionato: <${inspectedElement?.tag || 'elemento'}> ${inspectedElement?.selector || ''}`.trim()
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
		// a un controllo dove l'utente sta scrivendo o operando.
		if (document.activeElement !== null && document.activeElement !== document.body) return;
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

		if ((e.altKey && (e.key === 'i' || e.key === 'I')) || (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C'))) {
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
		if (tab.mode === 'chrome-relay') return 'Chrome personale';
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
					? 'Il runtime omp in uso non applica le decisioni sulle origini: aggiornalo'
					: `Decisione sull'origine non applicata: ${detail}`
			);
		} finally {
			originBusy = false;
		}
	}

	function togglePicker() {
		if (!isPickerActive && isPrivateTakeover) {
			showNotice('Takeover privato attivo: ispezione della pagina disabilitata');
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
			showNotice('Takeover privato attivo: nulla di questa pagina viene inviato all\'agente');
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
			showNotice('Nessun dato da allegare');
			return;
		}

		onAttachPromptContext?.(formattedText, images);
		window.dispatchEvent(
			new CustomEvent('composer-insert-context', {
				detail: { text: formattedText, images }
			})
		);
		showNotice('Contesto allegato al prompt!');
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
		<div class="nav-group" role="group" aria-label="Navigazione browser">
			<button
				type="button"
				class="tool-btn icon-btn"
				disabled={!activeTab}
				onclick={handleBack}
				title="Indietro (Alt+Freccia Sinistra)"
				aria-label="Indietro"
			>
				<IconArrowLeft />
			</button>
			<button
				type="button"
				class="tool-btn icon-btn"
				disabled={!activeTab}
				onclick={handleForward}
				title="Avanti (Alt+Freccia Destra)"
				aria-label="Avanti"
			>
				<IconArrowRight />
			</button>
			<button
				type="button"
				class="tool-btn icon-btn"
				class:loading={activeTab?.loading}
				disabled={!activeTab}
				onclick={handleReload}
				title="Ricarica pagina (F5)"
				aria-label="Ricarica"
			>
				<IconRefresh />
			</button>
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
				value={activeTab?.url || (tabs.length ? 'about:blank' : 'Nessuna sessione')}
				title={activeTab?.url || 'URL della pagina'}
				aria-label="URL pagina corrente"
			/>
			{#if activeTab?.loading}
				<span class="loading-dot" title="Caricamento in corso"></span>
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
						? 'Origine locale autorizzata automaticamente'
						: activeTab.originPermission === 'granted'
							? 'Origine remota autorizzata per questo progetto'
							: activeTab.originPermission === 'pending'
								? 'In attesa di consenso per origine remota'
								: 'Origine bloccata o revocata'}
				>
					{#if activeTab.originPermission === 'local'}
						Locale
					{:else if activeTab.originPermission === 'granted'}
						Consentita
					{:else if activeTab.originPermission === 'pending'}
						In attesa
					{:else}
						Bloccata
					{/if}
				</span>
				{#if activeTab.originPermission === 'granted'}
					<button
						type="button"
						class="revoke-origin-btn"
						onclick={() => decideOrigin('revoke')}
						disabled={originBusy}
						title="Revoca immediatamente l'autorizzazione a questa origine remota"
					>
						Revoca
					</button>
				{/if}
			</div>
		{/if}

		<!-- Selettore Tab se multiple -->
		{#if tabs.length > 1}
			<div class="tabs-group" role="group" aria-label="Selettore schede">
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
			<span class="tab-single-badge" title="Scheda attiva">{formatTabLabel(activeTab)}</span>
		{/if}

		<!-- Modalita e selezione esplicita Chrome personale (S46) -->
		<span class="mode-badge" class:relay={activeTab?.mode === 'chrome-relay'}>
			{activeTab?.mode === 'chrome-relay' ? 'Chrome Relay' : 'Browser Studio'}
		</span>
		{#if activeTab?.mode === 'chrome-relay'}
			<button type="button" class="tool-btn" disabled={relayBusy} onclick={disconnectRelay}>
				Disconnetti
			</button>
		{:else}
			<button type="button" class="tool-btn" disabled={relayBusy || !session?.browserLive?.features.includes('chrome-relay')} onclick={openRelayPicker}>
				<IconPlus /> Usa il mio Chrome
			</button>
		{/if}


		<!-- Viewport responsive selector -->
		<div class="device-group" role="group" aria-label="Larghezza viewport">
			<button
				type="button"
				class="device-btn"
				class:active={device === 'desktop'}
				onclick={() => (device = 'desktop')}
				title="Desktop (100%)"
			>
				Desktop
			</button>
			<button
				type="button"
				class="device-btn"
				class:active={device === 'tablet'}
				onclick={() => (device = 'tablet')}
				title="Tablet (768px)"
			>
				Tablet
			</button>
			<button
				type="button"
				class="device-btn"
				class:active={device === 'mobile'}
				onclick={() => (device = 'mobile')}
				title="Mobile (390px)"
			>
				Mobile
			</button>
		</div>

		<!-- Stato controller: Agente / Utente / Privato -->
		<span
			class="controller-badge"
			class:agent={activeTab?.controller === 'agent' || !activeTab}
			class:user={activeTab?.controller === 'user'}
			class:private={activeTab?.controller === 'private-user'}
			title="Stato controllo della sessione"
		>
			{#if activeTab?.controller === 'private-user'}
				Privato
			{:else if activeTab?.controller === 'user'}
				Utente
			{:else}
				Agente
			{/if}
		</span>

		<!-- Azioni controllo S42: Rilascio all'Agente e Toggle Privato -->
		{#if activeTab && (activeTab.controller === 'user' || activeTab.controller === 'private-user')}
			<button
				type="button"
				class="tool-btn return-control-btn"
				onclick={handleReturnControl}
				title="Restituisci il controllo della scheda all'agente"
			>
				<IconArrowLeft /> Rilascia all'Agente
			</button>
		{/if}

		{#if activeTab}
			<button
				type="button"
				class="tool-btn privacy-toggle-btn"
				class:active={activeTab.controller === 'private-user'}
				onclick={handleTogglePrivacy}
				title={activeTab.controller === 'private-user'
					? "Disattiva modalità privata (ripristina visibilità utente standard)"
					: "Attiva modalità privata (oscura transcript, screenshot e dati all'agente)"}
			>
				<IconLock /> {activeTab.controller === 'private-user' ? 'Privato' : 'Privato'}
			</button>
		{/if}

		<!-- Controlli Inspector mirato (S44) -->
		<button
			type="button"
			class="tool-btn picker-btn"
			class:active={isPickerActive}
			onclick={togglePicker}
			title="Ispeziona elemento (Alt+I)"
			aria-label="Ispeziona elemento"
		>
			<IconInspect /> Ispeziona
		</button>

		<button
			type="button"
			class="tool-btn inspector-btn"
			class:active={isInspectorOpen}
			onclick={toggleInspector}
			title="Apri Inspector mirato (Console, Network, Actions)"
			aria-label="Inspector mirato"
		>
			<IconTerminal /> Inspector
			{#if errorCount > 0}
				<span class="inspector-err-badge" title="{errorCount} errori console">{errorCount}</span>
			{:else if failedNetworkCount > 0}
				<span class="inspector-warn-badge" title="{failedNetworkCount} richieste fallite">{failedNetworkCount}</span>
			{/if}
		</button>

		<!-- Capability della pagina e registrazione locale (S45) -->
		{#if activeTab}
			<div class="capability-menu-wrap">
				<button
					type="button"
					class="tool-btn capability-btn"
					class:active={isCapabilityMenuOpen}
					onclick={() => (isCapabilityMenuOpen = !isCapabilityMenuOpen)}
					title="Permessi della pagina: appunti, geolocalizzazione, notifiche"
					aria-expanded={isCapabilityMenuOpen}
				>
					<IconLock /> Permessi
				</button>
				{#if isCapabilityMenuOpen}
					<div class="capability-menu" role="group" aria-label="Permessi della pagina">
						<p class="capability-menu-origin">{extractOrigin(activeTab.url) || activeTab.url}</p>
						{#each BROWSER_CAPABILITIES as capability}
							<div class="capability-row">
								<span class="capability-name">{CAPABILITY_LABELS[capability]}</span>
								<div class="capability-choices">
									<button
										type="button"
										class="capability-choice"
										class:active={capabilityDecision(capability) === 'denied'}
										onclick={() => changeCapability(capability, 'denied')}
									>
										Nega
									</button>
									<button
										type="button"
										class="capability-choice"
										class:active={capabilityDecision(capability) === 'prompt'}
										onclick={() => changeCapability(capability, 'prompt')}
									>
										Chiedi
									</button>
									<button
										type="button"
										class="capability-choice"
										class:active={capabilityDecision(capability) === 'granted'}
										onclick={() => changeCapability(capability, 'granted')}
									>
										Consenti
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<button
				type="button"
				class="tool-btn recording-btn"
				class:active={isRecording}
				onclick={toggleRecording}
				disabled={recording?.status === 'stopping'}
				title={isRecording
					? 'Interrompi la registrazione locale della scheda'
					: 'Registra la scheda in un artifact video locale'}
			>
				<span class="recording-dot" class:live={isRecording} aria-hidden="true"></span>
				{#if recording?.status === 'stopping'}
					Chiusura...
				{:else if isRecording}
					Stop ({recording?.frameCount ?? 0} fotogrammi)
				{:else}
					Registra
				{/if}
			</button>
		{/if}

		<span class="toolbar-spacer"></span>
		<button
			type="button"
			class="tool-btn"
			disabled={!currentFrame}
			onclick={copyScreenshot}
			title="Copia screenshot negli appunti"
			aria-label="Copia screenshot"
		>
			{#if copiedScreenshot}
				<IconCheck /> Copiato!
			{:else}
				<IconCamera /> Cattura
			{/if}
		</button>

		<button
			type="button"
			class="tool-btn close"
			onclick={() => onClose?.()}
			title="Chiudi (Esc)"
			aria-label="Chiudi visualizzatore browser"
		>
			<IconClose />
		</button>
	</div>

	{#if relayPickerOpen}
		<div
			class="relay-picker"
			role="dialog"
			aria-modal="true"
			aria-labelledby="relay-picker-title"
			use:trapFocus={{
				onEscape: () => {
					relayPickerOpen = false;
					relayTargets = [];
				}
			}}
		>
			<div class="relay-picker-head">
				<div>
					<strong id="relay-picker-title">Scegli una scheda Chrome</strong>
					<span>Studio potra leggere e controllare soltanto la scheda concessa.</span>
				</div>
				<button type="button" class="tool-btn" aria-label="Chiudi selettore" onclick={() => { relayPickerOpen = false; relayTargets = []; }}><IconClose /></button>
			</div>
			{#if relayDiagnostic}
				<p class="relay-diagnostic"><IconWarning /> {relayDiagnostic}</p>
		{:else if relayTargets.length === 0}
				<p class="relay-empty">Nessuna scheda collegabile. Verifica che il Relay OMP esistente sia attivo.</p>
			{:else}
				<div class="relay-targets" role="list">
					{#each relayTargets as target (target.targetId)}
						<button type="button" class="relay-target" disabled={relayBusy} onclick={() => authorizeRelayTarget(target.targetId)}>
							<span>{target.title || 'Scheda senza titolo'}</span>
							<small>{target.origin}{target.active ? ' · attiva' : ''}</small>
						</button>
					{/each}
				</div>
			{/if}
			{#if relayProbe?.diagnostic}<p class="relay-diagnostic"><IconWarning /> {relayProbe.diagnostic}</p>{/if}
		</div>
	{/if}

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
		{#if activeTab?.originPermission === 'pending'}
			<div class="origin-consent-banner" role="alert">
				<div class="origin-consent-info">
					<span class="origin-consent-icon" aria-hidden="true"><IconWarning /></span>
					<div class="origin-consent-text">
						<p class="origin-consent-title">Autorizzazione origine remota richiesta</p>
						<p class="origin-consent-desc">
							L'agente richiede di navigare verso l'origine <strong>{extractOrigin(activeTab.url) || activeTab.url}</strong>.
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
						Consenti per questo progetto
					</button>
					<button
						type="button"
						class="btn-consent-deny"
						onclick={() => decideOrigin('revoke')}
						disabled={originBusy}
					>
						Rifiuta
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
							La pagina chiede {pendingChooser.mode === 'multiple' ? 'dei file' : 'un file'}
						</p>
						<p class="origin-consent-desc">
							Nessun percorso viene concesso automaticamente: scegli tu i file nel dialogo di sistema.
						</p>
					</div>
				</div>
				<div class="origin-consent-actions">
					<button type="button" class="btn-consent-grant" disabled={uploadBusy} onclick={chooseUploadFiles}>
						{uploadBusy ? 'Selezione in corso...' : 'Scegli file'}
					</button>
					<button type="button" class="btn-consent-deny" onclick={cancelChooser}>Annulla</button>
				</div>
			</div>
		{/if}

		<!-- Download in attesa di consenso su origine remota (S45) -->
		{#each pendingDownloads as download (download.downloadId)}
			<div class="origin-consent-banner" role="alert">
				<div class="origin-consent-info">
					<span class="origin-consent-icon" aria-hidden="true"><IconWarning /></span>
					<div class="origin-consent-text">
						<p class="origin-consent-title">Download da origine remota</p>
						<p class="origin-consent-desc">
							<strong>{download.suggestedFilename}</strong> ({formatBytes(download.receivedBytes)}) da
							<strong>{download.origin || download.url}</strong>. Il file e' in quarantena e non e' ancora un
							artifact della chat.
						</p>
					</div>
				</div>
				<div class="origin-consent-actions">
					<button type="button" class="btn-consent-grant" onclick={() => decideDownload(download.downloadId, true)}>
						Salva negli artifact
					</button>
					<button type="button" class="btn-consent-deny" onclick={() => decideDownload(download.downloadId, false)}>
						Elimina
					</button>
				</div>
			</div>
		{/each}
		</div>
		{#if openDialog}
			<div class="js-dialog-backdrop" role="alertdialog" aria-modal="true" aria-label="Dialogo della pagina">
				<div
					class="js-dialog"
					use:trapFocus={{
						onEscape: () => respondDialog(openDialog.kind === 'alert')
					}}
				>
					<p class="js-dialog-kind">
						{#if openDialog.kind === 'beforeunload'}
							La pagina chiede conferma prima di lasciarla
						{:else if openDialog.kind === 'confirm'}
							Conferma richiesta dalla pagina
						{:else if openDialog.kind === 'prompt'}
							Richiesta di inserimento dalla pagina
						{:else}
							Avviso della pagina
						{/if}
					</p>
					<p class="js-dialog-origin">{extractOrigin(openDialog.url) || openDialog.url}</p>
					<p class="js-dialog-message">{openDialog.message || '(nessun messaggio)'}</p>
					{#if openDialog.kind === 'prompt'}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="text"
							class="js-dialog-input"
							bind:value={promptAnswer}
							autofocus
							aria-label="Risposta al prompt della pagina"
						/>
					{/if}
					<p class="js-dialog-note">
						L'esecuzione dell'agente su questa scheda e' stata interrotta: la pagina resta bloccata finche' non rispondi.
					</p>
					<div class="js-dialog-actions">
						{#if openDialog.kind !== 'alert'}
							<button type="button" class="btn-consent-deny" onclick={() => respondDialog(false)}>
								{openDialog.kind === 'beforeunload' ? 'Resta sulla pagina' : 'Annulla'}
							</button>
						{/if}
						<button type="button" class="btn-consent-grant" onclick={() => respondDialog(true)}>
							{openDialog.kind === 'beforeunload' ? 'Lascia la pagina' : 'OK'}
						</button>
					</div>
				</div>
			</div>
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
							{download.suggestedFilename} · {download.status === 'denied' ? 'eliminato' : 'fallito'}
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
						Registrazione · {recording.frameCount} fotogrammi · {formatBytes(recording.bytes)}
					</button>
				{:else if recording && recording.status === 'failed'}
					<span class="artifact-chip rejected" title={recording.error ?? ''}>Registrazione fallita</span>
				{/if}
			</div>
		{/if}
		{#if !tabs.length}
			<div class="center-note">
				<span class="note-icon"><IconGlobe /></span>
				<p class="note-title">Nessuna sessione browser attiva</p>
				<p class="note-desc">
					Avvia un comando o task che utilizza il tool <code>browser</code> per visualizzare lo stream live della pagina.
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
				aria-label="Superficie live browser. Premi per interagire con mouse o tastiera"
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
					alt="Live Browser Viewport"
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
						<span class="meta-item picker-indicator">Picker Attivo (clicca per selezionare, Esc per uscire)</span>
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
							<p class="note-title">Errore stream live</p>
						{:else}
							<span class="spinner"></span>
							<p class="note-title">
								{streamStatus === 'disconnected' ? 'Stream live interrotto' : 'Riconnessione allo stream live'}
							</p>
						{/if}
						<p class="note-desc">{streamError || 'Fotogramma non aggiornato: in attesa del canale live.'}</p>
						<button type="button" class="tool-btn" onclick={retryStream}>
							<IconRefresh /> Riprova ora
						</button>
					</div>
				{/if}
			</div>
		{:else if streamStatus === 'error'}
			<div class="center-note error" role="alert">
				<span class="note-icon error"><IconWarning /></span>
				<p class="note-title">Errore stream live</p>
				<p class="note-desc">{streamError || 'Impossibile connettersi al WebSocket live'}</p>
				<button type="button" class="tool-btn" onclick={retryStream} style="margin-top: var(--space-3);">
					<IconRefresh /> Riprova connessione
				</button>
			</div>
		{:else if streamStatus === 'disconnected'}
			<div class="center-note" role="status">
				<span class="spinner"></span>
				<p class="note-title">Stream live disconnesso</p>
				<p class="note-desc">{streamError || 'Riconnessione automatica in corso...'}</p>
				<button type="button" class="tool-btn" onclick={retryStream} style="margin-top: var(--space-3);">
					<IconRefresh /> Riprova ora
				</button>
			</div>
		{:else}
			<div class="center-note">
				<span class="spinner"></span>
				<p class="note-title">Connessione allo stream live in corso...</p>
				<p class="note-desc">Aggancio al canale loopback autenticato di Chromium gestito.</p>
			</div>
		{/if}
	</div>

	<!-- Dock Inspector mirato retrattile (S44) -->
	{#if isInspectorOpen}
		<div class="inspector-dock" role="region" aria-label="Inspector mirato">
			<div class="inspector-tabbar">
				<div class="tabbar-left" role="tablist">
					<button
						type="button"
						role="tab"
						class="inspector-tab"
						class:active={activeInspectorTab === 'elements'}
						aria-selected={activeInspectorTab === 'elements'}
						onclick={() => (activeInspectorTab = 'elements')}
					>
						<IconInspect /> Elementi
						{#if inspectedElement}
							<span class="tab-indicator active"></span>
						{/if}
					</button>
					<button
						type="button"
						role="tab"
						class="inspector-tab"
						class:active={activeInspectorTab === 'console'}
						aria-selected={activeInspectorTab === 'console'}
						onclick={() => (activeInspectorTab = 'console')}
					>
						<IconTerminal /> Console
						{#if errorCount > 0}
							<span class="tab-badge error">{errorCount}</span>
						{:else if consoleEntries.length > 0}
							<span class="tab-badge">{consoleEntries.length}</span>
						{/if}
					</button>
					<button
						type="button"
						role="tab"
						class="inspector-tab"
						class:active={activeInspectorTab === 'network'}
						aria-selected={activeInspectorTab === 'network'}
						onclick={() => (activeInspectorTab = 'network')}
					>
						<IconNetwork /> Rete
						{#if failedNetworkCount > 0}
							<span class="tab-badge error">{failedNetworkCount}</span>
						{:else if networkEntries.length > 0}
							<span class="tab-badge">{networkEntries.length}</span>
						{/if}
					</button>
					<button
						type="button"
						role="tab"
						class="inspector-tab"
						class:active={activeInspectorTab === 'actions'}
						aria-selected={activeInspectorTab === 'actions'}
						onclick={() => (activeInspectorTab = 'actions')}
					>
						<IconHistory /> Actions
						{#if actionEntries.length > 0}
							<span class="tab-badge">{actionEntries.length}</span>
						{/if}
					</button>
				</div>

				<div class="tabbar-right">
					<!-- Azioni contestuali al prompt e pulizia buffer -->
					{#if activeInspectorTab === 'elements' && inspectedElement}
						<button
							type="button"
							class="inspector-action-btn attach-btn"
							onclick={() => attachContextToPrompt('element')}
							title="Invia dettagli e ritaglio dell'elemento al prompt"
						>
							<IconSend /> Allega elemento al prompt
						</button>
					{:else if activeInspectorTab === 'console' && consoleEntries.length > 0}
						<button
							type="button"
							class="inspector-action-btn attach-btn"
							disabled={errorCount === 0}
							onclick={() => attachContextToPrompt('console')}
							title="Allega errori e avvisi console al prompt"
						>
							<IconSend /> Allega errori ({errorCount})
						</button>
						<button
							type="button"
							class="inspector-action-btn"
							onclick={() => handleClearBuffer('console')}
							title="Cancella log console"
						>
							<IconClear /> Svuota
						</button>
					{:else if activeInspectorTab === 'network' && networkEntries.length > 0}
						<button
							type="button"
							class="inspector-action-btn attach-btn"
							disabled={failedNetworkCount === 0}
							onclick={() => attachContextToPrompt('network')}
							title="Allega richieste di rete fallite al prompt"
						>
							<IconSend /> Allega fallite ({failedNetworkCount})
						</button>
						<button
							type="button"
							class="inspector-action-btn"
							onclick={() => handleClearBuffer('network')}
							title="Cancella log di rete"
						>
							<IconClear /> Svuota
						</button>
					{:else if activeInspectorTab === 'actions' && actionEntries.length > 0}
						<button
							type="button"
							class="inspector-action-btn"
							onclick={() => handleClearBuffer('actions')}
							title="Cancella timeline azioni"
						>
							<IconClear /> Svuota
						</button>
					{/if}

					<button
						type="button"
						class="tool-btn icon-btn"
						onclick={() => (isInspectorOpen = false)}
						title="Chiudi pannello Inspector"
						aria-label="Chiudi Inspector"
					>
						<IconClose />
					</button>
				</div>
			</div>

			<div class="inspector-panel-body">
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
										title="Copia selettore CSS negli appunti"
									>
										{#if copiedSelector}
											<IconCheck /> Copiato!
										{:else}
											<IconCopy /> Copia selettore
										{/if}
									</button>
								</div>
								{#if inspectedCropBase64}
									<div class="elem-crop-preview" title="Ritaglio elemento">
										<img src="data:image/png;base64,{inspectedCropBase64}" alt="Element crop" />
									</div>
								{/if}
							</div>

							<div class="element-meta-grid">
								<div class="meta-field">
									<span class="field-label">Ruolo ARIA</span>
									<span class="field-val">{inspectedElement.role || '—'}</span>
								</div>
								<div class="meta-field">
									<span class="field-label">Nome accessibile</span>
									<span class="field-val">{inspectedElement.accessibleName || '—'}</span>
								</div>
								<div class="meta-field">
									<span class="field-label">Bounding Box</span>
									<span class="field-val">
										{Math.round(inspectedElement.boundingBox.width)}&times;{Math.round(inspectedElement.boundingBox.height)} a ({Math.round(inspectedElement.boundingBox.x)}, {Math.round(inspectedElement.boundingBox.y)})
									</span>
								</div>
								<div class="meta-field">
									<span class="field-label">Testo</span>
									<span class="field-val text-truncate">{inspectedElement.text || '—'}</span>
								</div>
							</div>

							{#if Object.keys(inspectedElement.computedStyles).length > 0}
								<div class="element-styles-section">
									<span class="section-sub-title">Stili rilevanti:</span>
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
							<p class="empty-text">Nessun elemento selezionato</p>
							<p class="empty-hint">
								Attiva <strong>Ispeziona</strong> (Alt+I) nella barra superiore o clicca su qualsiasi punto della pagina live.
							</p>
						</div>
					{/if}

				{:else if activeInspectorTab === 'console'}
					<!-- Console Tab -->
					<div class="tab-filter-bar">
						<div class="filter-pills" role="group" aria-label="Filtro livello console">
							<button
								type="button"
								class="filter-pill"
								class:active={consoleFilterLevel === 'all'}
								onclick={() => (consoleFilterLevel = 'all')}
							>
								Tutti ({consoleEntries.length})
							</button>
							<button
								type="button"
								class="filter-pill error"
								class:active={consoleFilterLevel === 'error'}
								onclick={() => (consoleFilterLevel = 'error')}
							>
								Errori ({errorCount})
							</button>
							<button
								type="button"
								class="filter-pill warn"
								class:active={consoleFilterLevel === 'warn'}
								onclick={() => (consoleFilterLevel = 'warn')}
							>
								Avvisi ({consoleEntries.filter((e) => e.level === 'warn').length})
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
								placeholder="Cerca nei log..."
								bind:value={consoleSearchQuery}
							/>
						</div>
					</div>

					<div class="tab-list-scroll">
						{#if filteredConsoleEntries.length === 0}
							<div class="inspector-empty-state mini">
								<p class="empty-text">Nessun messaggio console</p>
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
						<div class="filter-pills" role="group" aria-label="Filtro rete">
							<button
								type="button"
								class="filter-pill"
								class:active={networkFilter === 'all'}
								onclick={() => (networkFilter = 'all')}
							>
								Tutti ({networkEntries.length})
							</button>
							<button
								type="button"
								class="filter-pill error"
								class:active={networkFilter === 'failed'}
								onclick={() => (networkFilter = 'failed')}
							>
								Fallite ({failedNetworkCount})
							</button>
							<button
								type="button"
								class="filter-pill warn"
								class:active={networkFilter === 'slow'}
								onclick={() => (networkFilter = 'slow')}
							>
								Lente &gt;1s ({networkEntries.filter((e) => e.durationMs >= 1000).length})
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
								placeholder="Filtra URL..."
								bind:value={networkSearchQuery}
							/>
						</div>
					</div>

					<div class="tab-list-scroll">
						{#if filteredNetworkEntries.length === 0}
							<div class="inspector-empty-state mini">
								<p class="empty-text">Nessuna richiesta di rete</p>
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
											<div class="detail-err-banner">Errore: {req.errorText}</div>
										{/if}
										{#if req.headers}
											<div class="detail-section">
												<span class="detail-label">Headers (redatti):</span>
												<div class="detail-headers">
													{#each Object.entries(req.headers) as [hk, hv]}
														<div class="header-line"><strong>{hk}:</strong> {hv}</div>
													{/each}
												</div>
											</div>
										{/if}
										{#if req.body}
											<div class="detail-section">
												<span class="detail-label">Corpo risposta:</span>
												<pre class="body-pre">{req.body}</pre>
											</div>
										{:else if req.hasBody}
											<div class="detail-section">
												<span class="detail-label muted">Corpo disponibile su richiesta (clicca per ricaricare)</span>
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
								placeholder="Cerca nella timeline azioni..."
								bind:value={actionSearchQuery}
							/>
						</div>
					</div>

					<div class="tab-list-scroll">
						{#if filteredActionEntries.length === 0}
							<div class="inspector-empty-state mini">
								<p class="empty-text">Nessuna azione registrata</p>
							</div>
						{:else}
							{#each filteredActionEntries as act (act.id)}
								<div class="action-row">
									<span class="action-time">{new Date(act.timestamp).toLocaleTimeString()}</span>
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
		height: 36px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		user-select: none;
	}

	.nav-group {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		height: 26px;
		padding: 0 var(--space-2);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
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
		width: 26px;
		padding: 0;
	}

	.tool-btn.icon-btn.loading :global(svg) {
		animation: spin 1.2s linear infinite;
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
		flex: 1;
		max-width: 440px;
		height: 26px;
		padding: 0 var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
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
		outline: none;
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.loading-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--brand);
		animation: pulse 1.2s infinite ease-in-out;
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
		border-radius: calc(var(--radius-sm) - 2px);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
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
	}

	.mode-badge.relay {
		background: var(--brand-dim);
		color: var(--ink);
	}

	.controller-badge {
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		border: 1px solid var(--line);
	}

	.controller-badge.agent {
		background: color-mix(in srgb, var(--brand) 18%, transparent);
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.controller-badge.user {
		background: color-mix(in srgb, var(--warn) 18%, transparent);
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.controller-badge.private {
		background: color-mix(in srgb, var(--danger) 18%, transparent);
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 30%, transparent);
	}

	.tool-btn.return-control-btn {
		background: color-mix(in srgb, var(--brand) 20%, transparent);
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 40%, transparent);
		font-weight: 500;
	}

	.tool-btn.return-control-btn:hover {
		background: color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.tool-btn.privacy-toggle-btn.active {
		background: color-mix(in srgb, var(--danger) 20%, transparent);
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
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
		border-radius: calc(var(--radius-sm) - 2px);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
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
		background: #000;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		overflow: hidden;
		transition: width var(--dur-base) var(--ease-out);
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
		z-index: 60;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-4);
		text-align: center;
		background: color-mix(in srgb, var(--bg-base) 78%, transparent);
		backdrop-filter: blur(6px);
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
		backdrop-filter: blur(8px);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: 10px;
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
		font-size: 10px;
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 0.4;
			transform: scale(0.8);
		}
		50% {
			opacity: 1;
			transform: scale(1.2);
		}
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
		font-size: 10px;
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
		background: rgba(34, 197, 94, 0.12);
		color: #16a34a;
		border: 1px solid rgba(34, 197, 94, 0.3);
	}

	.origin-perm-badge.pending {
		background: rgba(245, 158, 11, 0.15);
		color: #d97706;
		border: 1px solid rgba(245, 158, 11, 0.35);
		animation: pulse 2s infinite ease-in-out;
	}

	.origin-perm-badge.denied {
		background: rgba(239, 68, 68, 0.12);
		color: #dc2626;
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	.revoke-origin-btn {
		height: 20px;
		padding: 0 6px;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: 10px;
		font-family: var(--font-ui);
		cursor: pointer;
		transition: all var(--dur-fast);
	}

	.revoke-origin-btn:hover {
		background: var(--danger-dim);
		color: var(--danger, #dc2626);
		border-color: rgba(239, 68, 68, 0.4);
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
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
		width: 100%;
	}

	.origin-consent-info {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.origin-consent-icon {
		color: #d97706;
		flex-shrink: 0;
		display: inline-flex;
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
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		transition: opacity var(--dur-fast);
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
		transition: background var(--dur-fast);
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
		z-index: 100;
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
		background: var(--accent-dim, rgba(59, 130, 246, 0.15));
		color: var(--accent, #3b82f6);
		border-color: var(--accent, #3b82f6);
		font-weight: 500;
	}

	.tool-btn.inspector-btn.active {
		background: var(--accent-dim, rgba(59, 130, 246, 0.15));
		color: var(--ink);
		border-color: var(--line);
		font-weight: 500;
	}

	.inspector-err-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		background: #dc2626;
		color: white;
		border-radius: var(--radius-full);
		font-size: 10px;
		font-weight: 700;
		font-family: var(--font-mono);
	}

	.inspector-warn-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		background: #d97706;
		color: white;
		border-radius: var(--radius-full);
		font-size: 10px;
		font-weight: 700;
		font-family: var(--font-mono);
	}

	.browser-stage.picker-active {
		cursor: crosshair;
	}

	.picker-indicator {
		color: var(--accent, #3b82f6) !important;
		font-weight: 600;
	}

	/* Highlight overlay non invasivo (pointer-events: none) */
	.element-highlight-overlay {
		position: absolute;
		border: 2px solid var(--accent, #3b82f6);
		background: rgba(59, 130, 246, 0.18);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
		pointer-events: none;
		z-index: 40;
		box-sizing: border-box;
		transition: all 50ms ease-out;
	}

	.element-highlight-tooltip {
		position: absolute;
		top: -24px;
		left: 0;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		background: var(--bg-raised, #1e1e2e);
		border: 1px solid var(--accent, #3b82f6);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.2;
		white-space: nowrap;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.element-highlight-tooltip .tag-name {
		color: var(--accent, #3b82f6);
		font-weight: 600;
	}

	.element-highlight-tooltip .dim-label {
		color: var(--ink-muted);
	}

	.element-highlight-tooltip .role-label {
		color: #10b981;
	}

	.context-attached-toast {
		position: absolute;
		top: 16px;
		right: 16px;
		z-index: 120;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: rgba(16, 185, 129, 0.95);
		color: white;
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		font-weight: 500;
		border-radius: var(--radius-sm);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
		animation: fadeIn 0.2s ease-out;
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
		z-index: 30;
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

	.inspector-tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: all var(--dur-fast);
	}

	.inspector-tab:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.inspector-tab.active {
		background: var(--bg-raised);
		color: var(--ink);
		border-color: var(--line);
		font-weight: 500;
	}

	.tab-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 14px;
		height: 14px;
		padding: 0 3px;
		background: var(--bg-sunken);
		color: var(--ink-muted);
		border-radius: var(--radius-full);
		font-size: 9px;
		font-family: var(--font-mono);
	}

	.tab-badge.error {
		background: #dc2626;
		color: white;
		font-weight: bold;
	}

	.tab-indicator.active {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--brand);
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
		font-size: 11px;
		cursor: pointer;
		transition: all var(--dur-fast);
	}

	.inspector-action-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--ink-faint);
	}

	.inspector-action-btn.attach-btn {
		background: var(--accent-dim, rgba(59, 130, 246, 0.12));
		color: var(--accent, #3b82f6);
		border-color: rgba(59, 130, 246, 0.3);
		font-weight: 500;
	}

	.inspector-action-btn.attach-btn:hover:not(:disabled) {
		background: rgba(59, 130, 246, 0.22);
		border-color: var(--accent, #3b82f6);
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
		color: var(--accent, #3b82f6);
	}

	.elem-component {
		padding: 2px 6px;
		background: rgba(168, 85, 247, 0.12);
		color: #a855f7;
		border: 1px solid rgba(168, 85, 247, 0.25);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
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
		font-size: 10px;
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
		font-size: 10px;
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
		font-size: 10px;
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
		font-size: 11px;
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
		font-size: 11px;
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
		background: rgba(239, 68, 68, 0.12);
		color: #dc2626;
		border-color: rgba(239, 68, 68, 0.3);
	}

	.filter-pill.warn.active {
		background: rgba(245, 158, 11, 0.12);
		color: #d97706;
		border-color: rgba(245, 158, 11, 0.3);
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
		outline: none;
		font-size: 11px;
		font-family: var(--font-ui);
		color: var(--ink);
	}

	/* Tab List Scroll */
	.tab-list-scroll {
		flex: 1;
		overflow-y: auto;
		font-family: var(--font-mono);
		font-size: 11px;
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
		background: rgba(239, 68, 68, 0.06);
		color: #ef4444;
	}

	.console-row.warn {
		background: rgba(245, 158, 11, 0.06);
		color: #f59e0b;
	}

	.log-level-badge {
		padding: 1px 4px;
		border-radius: 2px;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
	}

	.log-level-badge.error {
		background: #dc2626;
		color: white;
	}

	.log-level-badge.warn {
		background: #d97706;
		color: white;
	}

	.log-level-badge.info {
		background: #3b82f6;
		color: white;
	}

	.log-level-badge.debug, .log-level-badge.log {
		background: var(--bg-sunken);
		color: var(--ink-muted);
	}

	.count-badge {
		padding: 0 4px;
		background: var(--bg-sunken);
		border-radius: var(--radius-full);
		font-size: 9px;
		font-weight: 600;
		color: var(--ink-muted);
	}

	.log-text {
		flex: 1;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.log-location {
		color: var(--ink-faint);
		font-size: 10px;
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
		background: rgba(239, 68, 68, 0.06);
	}

	.method-pill {
		font-weight: 700;
		font-size: 10px;
		padding: 1px 4px;
		border-radius: 2px;
		background: var(--bg-base);
		color: var(--ink);
	}

	.method-pill.get { color: #10b981; }
	.method-pill.post { color: #3b82f6; }
	.method-pill.put { color: #f59e0b; }
	.method-pill.delete { color: #ef4444; }

	.status-pill {
		font-weight: 600;
		font-size: 10px;
	}

	.status-pill.ok { color: #10b981; }
	.status-pill.err { color: #ef4444; }

	.net-url {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
	}

	.net-type {
		color: var(--ink-muted);
		font-size: 10px;
		width: 60px;
	}

	.net-duration {
		color: var(--ink-faint);
		font-size: 10px;
		width: 50px;
		text-align: right;
	}

	.network-detail-pane {
		padding: var(--space-2) var(--space-3);
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		font-size: 11px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.detail-err-banner {
		color: #ef4444;
		font-weight: 600;
	}

	.detail-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.detail-label {
		font-size: 10px;
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
		font-size: 10px;
		width: 65px;
	}

	.action-kind-pill {
		font-size: 9px;
		font-weight: 700;
		padding: 1px 4px;
		border-radius: 2px;
		text-transform: uppercase;
		background: var(--bg-base);
		color: var(--ink-muted);
	}

	.action-kind-pill.navigation { color: #3b82f6; }
	.action-kind-pill.agent_action { color: #8b5cf6; }
	.action-kind-pill.takeover { color: #f59e0b; }
	.action-kind-pill.privacy { color: #ec4899; }

	.action-label {
		flex: 1;
		color: var(--ink);
	}

	.action-details {
		color: var(--ink-muted);
		font-size: 10px;
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
		font-size: 11px;
		color: var(--ink-faint);
		max-width: 320px;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	/* S45 — dialoghi, permessi, download e registrazione */
	.js-dialog-backdrop {
		position: absolute;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.45);
	}

	.js-dialog {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: min(460px, calc(100% - 48px));
		padding: var(--space-4);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
	}

	.js-dialog-kind {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.js-dialog-origin {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 11px;
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

	.js-dialog-input {
		padding: 6px 8px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-sm);
	}

	.js-dialog-note {
		margin: 0;
		font-size: 11px;
		color: var(--ink-muted);
	}

	.js-dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.capability-menu-wrap {
		position: relative;
		display: inline-flex;
	}

	.capability-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 150;
		min-width: 260px;
		padding: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
	}

	.capability-menu-origin {
		margin: 0 0 var(--space-2) 0;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
		overflow-wrap: anywhere;
	}

	.capability-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: 3px 0;
	}

	.capability-name {
		font-size: var(--text-xs);
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
		font-size: 10px;
		cursor: pointer;
	}

	.capability-choice.active {
		background: var(--accent-dim, rgba(59, 130, 246, 0.15));
		border-color: var(--accent, #3b82f6);
		color: var(--accent, #3b82f6);
		font-weight: 600;
	}

	.recording-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		display: inline-block;
	}

	.recording-dot.live {
		background: #dc2626;
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
		z-index: 90;
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
		font-size: 11px;
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
		border-color: var(--accent, #3b82f6);
	}

	.artifact-chip.rejected {
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.4);
	}
	.relay-picker {
		position: absolute;
		inset: 44px 12px auto auto;
		z-index: var(--z-dialog);
		width: min(420px, calc(100% - 24px));
		max-height: calc(100% - 56px);
		overflow: auto;
		padding: var(--space-3);
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
	}
	.relay-picker-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
	.relay-picker-head > div { display: flex; flex-direction: column; gap: var(--space-1); }
	.relay-picker-head span, .relay-empty { color: var(--ink-muted); font-size: var(--text-sm); }
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
