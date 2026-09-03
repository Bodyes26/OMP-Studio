<script lang="ts">
	import type { AgentSession } from '$lib/agent/session.svelte';
	import {
		type BrowserFrameMeta,
		type BrowserInputEvent,
		type BrowserTabState,
		type ViewportPoint,
		mapClientToViewportCoords,
		mapWheelToViewportScroll
	} from '$lib/agent/browser-live';
	import {
		IconArrowLeft,
		IconArrowRight,
		IconCamera,
		IconCheck,
		IconClose,
		IconGlobe,
		IconLock,
		IconRefresh,
		IconWarning
	} from '$lib/icons';

	let {
		session,
		projectPath,
		onClose,
		onInput
	}: {
		session: AgentSession | null;
		projectPath: string;
		onClose?: () => void;
		onInput?: (event: BrowserInputEvent) => void;
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
			.connectLiveTab(tab, (frame) => {
				if (!active) return;
				currentFrame = frame;
				streamStatus = 'live';
			})
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

	function handleClick(e: MouseEvent) {
		const pt = getViewportCoords(e.clientX, e.clientY);
		if (!pt) return;
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
		if (e.key === 'Escape') {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
				return;
			}
			onClose?.();
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

		<span class="toolbar-spacer"></span>

		<!-- Azioni future S42/S44 (screenshot attivo in S41) -->
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
	<div class="browser-stage">
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
			>
				<img
					bind:this={imageEl}
					src="data:{currentFrame.meta.mimeType};base64,{currentFrame.imageBase64}"
					alt="Live Browser Viewport"
					class="live-image"
					draggable="false"
				/>

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
				</div>
			</div>
		{:else}
			<div class="center-note">
				<span class="spinner"></span>
				<p class="note-title">In attesa del primo frame...</p>
			</div>
		{/if}
	</div>
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

	/* Viewport device buttons */
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
</style>
