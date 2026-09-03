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
		extractOrigin
	} from '$lib/agent/browser-live';
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
		IconChevronRight
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
	let imageEl = $state<HTMLImageElement | null>(null);
	let hoverPoint = $state<ViewportPoint | null>(null);
	let lastInputEvent = $state<BrowserInputEvent | null>(null);
	let isHovering = $state(false);

	// Funzione di cleanup dello stream live
	let disconnectFn = $state<(() => void) | null>(null);

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

	function showNotice(msg: string) {
		contextAttachedNotice = msg;
		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			contextAttachedNotice = null;
			noticeTimer = null;
		}, 2200);
	}

	// Gestione connessione live stream deterministica
	$effect(() => {
		const tab = activeTab;
		const s = session;

		// Disconnette lo stream precedente
		if (disconnectFn) {
			disconnectFn();
			disconnectFn = null;
		}

		if (!tab || !s) {
			currentFrame = null;
			streamStatus = 'idle';
			streamError = null;
			return;
		}

		streamStatus = 'connecting';
		streamError = null;

		let active = true;
		void s
			.connectLiveTab(
				tab,
				(frame) => {
					if (!active) return;
					currentFrame = frame;
					streamStatus = 'live';
				},
				(event) => {
					if (!active) return;
					if (event.type === 'inspected_element') {
						if (isPickerActive) {
							hoveredInspectElement = event.element;
						} else {
							inspectedElement = event.element;
						}
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
					}
				}
			)
			.then((cleanup) => {
				if (!active) {
					cleanup?.();
					return;
				}
				if (!cleanup) {
					streamStatus = 'disconnected';
					streamError = 'Canale live non disponibile';
				} else {
					disconnectFn = cleanup;
				}
			})
			.catch((err) => {
				if (!active) return;
				streamStatus = 'error';
				streamError = String(err);
			});

		return () => {
			active = false;
			if (disconnectFn) {
				disconnectFn();
				disconnectFn = null;
			}
		};
	});

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
		if (activeTab && session) {
			if (activeTab.controller === 'agent') {
				// Takeover atomico al primo input umano con input bufferizzato inviato una volta sola
				void session.requestTakeover(activeTab, event);
			} else {
				void session.sendTabInput(activeTab, event);
			}
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

			if (inspectedElement && currentFrame) {
				try {
					inspectedCropBase64 = await cropImageElement(
						currentFrame.imageBase64,
						inspectedElement.boundingBox,
						{ width: currentFrame.meta.viewportWidth, height: currentFrame.meta.viewportHeight }
					);
				} catch {
					inspectedCropBase64 = null;
				}
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

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		const isInsideInspector = target?.closest('.inspector-dock') !== null;
		const isTextTarget = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

		if (e.key === 'Escape') {
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

		// Alt+I / Ctrl+Shift+C: toggle element picker
		if ((e.altKey && (e.key === 'i' || e.key === 'I')) || (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C'))) {
			e.preventDefault();
			togglePicker();
			return;
		}

		// Se il target e' dentro l'inspector o un campo di testo locale, non inoltrare a Chromium
		if (isInsideInspector || isTextTarget) {
			return;
		}

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
		const parts = tab.tabId.split('::');
		return parts[1] || parts[0] || 'main';
	}

	function handleGrantOrigin() {
		if (!activeTab) return;
		const origin = extractOrigin(activeTab.url);
		if (!origin) return;
		const pid = activeTab.projectId || projectStore.activeId;
		if (pid) {
			projectStore.grantBrowserOrigin(pid, origin);
		}
		activeTab.originPermission = 'granted';
	}

	function handleDenyOrigin() {
		if (!activeTab) return;
		const origin = extractOrigin(activeTab.url);
		if (!origin) return;
		const pid = activeTab.projectId || projectStore.activeId;
		if (pid) {
			projectStore.revokeBrowserOrigin(pid, origin);
		}
		activeTab.originPermission = 'denied';
	}

	function handleRevokeOrigin() {
		if (!activeTab) return;
		const origin = extractOrigin(activeTab.url);
		if (!origin) return;
		const pid = activeTab.projectId || projectStore.activeId;
		if (pid) {
			projectStore.revokeBrowserOrigin(pid, origin);
		}
		activeTab.originPermission = 'denied';
	}

	function togglePicker() {
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

<svelte:window onkeydown={handleKeydown} onkeyup={handleKeyUp} />

<div class="browser-viewer">
	<!-- Toolbar Browser Studio (S41) -->
	<div class="browser-toolbar">
		<!-- Navigazione: Back, Forward, Reload -->
		<div class="nav-group" role="group" aria-label="Navigazione browser">
			<button
				type="button"
				class="tool-btn icon-btn"
				disabled={!activeTab}
				title="Indietro"
				aria-label="Indietro"
			>
				<IconArrowLeft />
			</button>
			<button
				type="button"
				class="tool-btn icon-btn"
				disabled={!activeTab}
				title="Avanti"
				aria-label="Avanti"
			>
				<IconArrowRight />
			</button>
			<button
				type="button"
				class="tool-btn icon-btn"
				class:loading={activeTab?.loading}
				disabled={!activeTab}
				title="Ricarica pagina"
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
						onclick={handleRevokeOrigin}
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

		<!-- Modalita: Browser Studio / Chrome personale -->
		<span class="mode-badge" class:relay={activeTab?.mode === 'chrome-relay'}>
			{activeTab?.mode === 'chrome-relay' ? 'Chrome Relay' : 'Browser Studio'}
		</span>

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

	<!-- Stage di visualizzazione live -->
	<div class="browser-stage" class:with-inspector={isInspectorOpen} class:picker-active={isPickerActive}>
		<!-- Toast notifica contesto allegato -->
		{#if contextAttachedNotice}
			<div class="context-attached-toast" role="status" aria-live="polite">
				<IconCheck /> {contextAttachedNotice}
			</div>
		{/if}

		<!-- Banner di consenso per nuova origine remota (S43) -->
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
					<button type="button" class="btn-consent-grant" onclick={handleGrantOrigin}>
						Consenti per questo progetto
					</button>
					<button type="button" class="btn-consent-deny" onclick={handleDenyOrigin}>
						Rifiuta
					</button>
				</div>
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
		{:else if streamStatus === 'connecting'}
			<div class="center-note">
				<span class="spinner"></span>
				<p class="note-title">Connessione allo stream live in corso...</p>
				<p class="note-desc">Aggancio al canale loopback autenticato di Chromium gestito.</p>
			</div>
		{:else if streamStatus === 'error'}
			<div class="center-note error" role="alert">
				<span class="note-icon error"><IconWarning /></span>
				<p class="note-title">Errore stream live</p>
				<p class="note-desc">{streamError || 'Impossibile connettersi al WebSocket live'}</p>
			</div>
		{:else if currentFrame}
			<!-- Contenitore Responsive Viewport -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
			<div
				class="viewport-frame"
				style:width={DEVICE_WIDTHS[device]}
				role="application"
				aria-label="Superficie live browser"
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
			</div>
		{:else}
			<div class="center-note">
				<span class="spinner"></span>
				<p class="note-title">In attesa del primo frame...</p>
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
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
		max-width: 600px;
		width: calc(100% - 32px);
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

	/* S44 — Inspector mirato, Element Picker e Dock */
	.tool-btn.picker-btn.active {
		background: var(--accent-dim, rgba(59, 130, 246, 0.15));
		color: var(--accent, #3b82f6);
		border-color: var(--accent, #3b82f6);
		font-weight: 500;
	}

	.tool-btn.inspector-btn.active {
		background: var(--bg-hover);
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
</style>
