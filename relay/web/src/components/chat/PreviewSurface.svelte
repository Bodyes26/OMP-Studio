<!--
  PreviewSurface.svelte — Superficie di anteprima a due modalita' (Desktop e Mobile).
  - Desktop (>=960px): colonna docked affiancata alla chat, toolbar completa, zoom,
    switcher dimensioni dispositivo per prototipi HTML (390 / 820 / fit), toggle sorgente con copia.
  - Mobile (<960px): foglio a tutto schermo sopra la chat, barra superiore con pulsante indietro (>=44px),
    pan/zoom con gesti touch e pulsanti galleggianti di supporto, safe-area, blocco scroll sottostante.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import { buildSandboxedSvgDocument } from '#lib/editor/svgSandbox.ts';
	import PanZoom from '#lib/ui/PanZoom.svelte';
	import MermaidDiagram from '#lib/agent/components/MermaidDiagram.svelte';
	import {
		IconClose,
		IconChevronLeft,
		IconZoomIn,
		IconZoomOut,
		IconReset,
		IconPhone,
		IconTablet,
		IconMachine,
		IconRefresh,
		IconViewCode,
		IconViewPreview,
		IconCopy,
		IconCheck,
		IconWarning
	} from '../../icons.ts';
	import {
		getPreviewContext,
		type PreviewStore
	} from '../../preview.svelte.ts';

	let {
		preview: propStore
	}: {
		preview?: PreviewStore;
	} = $props();

	const contextStore = getPreviewContext();
	const store = $derived(propStore ?? contextStore);

	let isDesktop = $state(
		typeof window !== 'undefined' ? window.matchMedia('(min-width: 960px)').matches : true
	);

	$effect(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(min-width: 960px)');
		const handler = (e: MediaQueryListEvent) => {
			isDesktop = e.matches;
		};
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	interface PanZoomHandle {
		zoomIn(): void;
		zoomOut(): void;
		reset(): void;
	}

	// Riferimento a PanZoom
	let panZoomRef = $state<PanZoomHandle | null>(null);
	let zoomScale = $state(1);

	// Errori di rendering Mermaid
	let mermaidError = $state<string | null>(null);
	let mermaidReady = $state(false);

	// Stato copia sorgente
	let copied = $state(false);
	let copyTimeout: ReturnType<typeof setTimeout> | null = null;

	const current = $derived(store?.current);
	const kind = $derived(current?.kind ?? 'mermaid');
	const title = $derived(current?.title ?? t('artifactKindUnknown'));
	const content = $derived(current?.content ?? '');

	const kindBadge = $derived.by(() => {
		switch (kind) {
			case 'mermaid':
				return t('artifactKindDiagram');
			case 'svg':
				return t('artifactKindSvg');
			case 'html':
				return t('artifactKindHtml');
			default:
				return t('artifactKindUnknown');
		}
	});

	async function copySource(): Promise<void> {
		if (!content) return;
		try {
			await navigator.clipboard.writeText(content);
			copied = true;
			if (copyTimeout) clearTimeout(copyTimeout);
			copyTimeout = setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			// Fallback o permesso negato
		}
	}

	function handleKeyDown(e: KeyboardEvent): void {
		if (!store?.isOpen) return;
		const target = e.target;
		if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;

		// Esc chiude
		if (e.key === 'Escape') {
			e.preventDefault();
			store.close();
			return;
		}

		// Tasti zoom solo per diagrammi e SVG (e quando non si visualizza il sorgente)
		if (!store.showSource && (kind === 'mermaid' || kind === 'svg')) {
			if (e.key === '+' || e.key === '=') {
				e.preventDefault();
				panZoomRef?.zoomIn();
			} else if (e.key === '-' || e.key === '_') {
				e.preventDefault();
				panZoomRef?.zoomOut();
			} else if (e.key === '0') {
				e.preventDefault();
				panZoomRef?.reset();
			}
		}
	}

	function handleRetry(): void {
		if (!store) return;
		if (kind === 'html' && current?.content) {
			void store.reloadHtml();
		} else if (current) {
			void store.open({
				kind: current.kind,
				title: current.title,
				content: current.content,
				bytes: current.bytes,
				messageId: current.messageId
			});
		}
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if store && store.isOpen && current}
	<div
		class="preview-surface"
		class:desktop={isDesktop}
		class:mobile={!isDesktop}
		class:kind-mermaid={kind === 'mermaid'}
		class:kind-svg={kind === 'svg'}
		class:kind-html={kind === 'html'}
		aria-label="{kindBadge}: {title}"
	>
		{#if isDesktop}
			<!-- ============================================================ -->
			<!-- VISTA DESKTOP (Docked column beside transcript)             -->
			<!-- ============================================================ -->
			<header class="desktop-toolbar">
				<div class="toolbar-left">
					<span class="kind-pill">{kindBadge}</span>
					<span class="toolbar-title" title={title}>{title}</span>
				</div>

				<div class="toolbar-center">
					{#if !store.showSource && (kind === 'mermaid' || kind === 'svg')}
						<div class="zoom-controls">
							<button
								type="button"
								class="tool-btn"
								onclick={() => panZoomRef?.zoomOut()}
								title="{t('previewZoomOut')} (-)"
								aria-label="{t('previewZoomOut')}"
							>
								<IconZoomOut />
							</button>

							<span class="zoom-level font-mono tabular-nums">
								{Math.round(zoomScale * 100)}%
							</span>

							<button
								type="button"
								class="tool-btn"
								onclick={() => panZoomRef?.zoomIn()}
								title="{t('previewZoomIn')} (+)"
								aria-label="{t('previewZoomIn')}"
							>
								<IconZoomIn />
							</button>

							<button
								type="button"
								class="tool-btn"
								onclick={() => panZoomRef?.reset()}
								title="{t('previewResetZoom')} (0)"
								aria-label="{t('previewResetZoom')}"
							>
								<IconReset />
							</button>
						</div>
					{:else if !store.showSource && kind === 'html'}
						<div class="device-switcher">
							<button
								type="button"
								class="device-btn"
								class:active={store.deviceMode === 'phone'}
								onclick={() => (store.deviceMode = 'phone')}
								title={t('previewPhone')}
								aria-label={t('previewPhone')}
							>
								<IconPhone />
							</button>
							<button
								type="button"
								class="device-btn"
								class:active={store.deviceMode === 'tablet'}
								onclick={() => (store.deviceMode = 'tablet')}
								title={t('previewTablet')}
								aria-label={t('previewTablet')}
							>
								<IconTablet />
							</button>
							<button
								type="button"
								class="device-btn"
								class:active={store.deviceMode === 'fit'}
								onclick={() => (store.deviceMode = 'fit')}
								title={t('previewFit')}
								aria-label={t('previewFit')}
							>
								<IconMachine />
							</button>
						</div>

						<button
							type="button"
							class="tool-btn"
							onclick={() => void store.reloadHtml()}
							title={t('previewReload')}
							aria-label={t('previewReload')}
						>
							<IconRefresh />
						</button>
					{/if}
				</div>

				<div class="toolbar-right">
					<button
						type="button"
						class="tool-btn"
						class:active={store.showSource}
						onclick={() => (store.showSource = !store.showSource)}
						title={store.showSource ? t('previewHideSource') : t('previewViewSource')}
						aria-label={store.showSource ? t('previewHideSource') : t('previewViewSource')}
					>
						{#if store.showSource}
							<IconViewPreview />
						{:else}
							<IconViewCode />
						{/if}
					</button>

					{#if store.showSource}
						<button
							type="button"
							class="tool-btn copy-btn"
							onclick={copySource}
							title={copied ? t('previewCopied') : t('previewCopySource')}
							aria-label={copied ? t('previewCopied') : t('previewCopySource')}
						>
							{#if copied}
								<IconCheck />
							{:else}
								<IconCopy />
							{/if}
						</button>
					{/if}

					<button
						type="button"
						class="tool-btn close-btn"
						onclick={() => store.close()}
						title="{t('previewClose')} (Esc)"
						aria-label="{t('previewClose')}"
					>
						<IconClose />
					</button>
				</div>
			</header>

			<!-- Corpo del contenuto Desktop -->
			<div class="preview-body">
				{#if store.isLoading}
					<div class="loading-state">
						<span class="spinner" aria-hidden="true"></span>
						<p>{t('previewLoading')}</p>
					</div>
				{:else if store.error}
					<div class="error-state">
						<span class="error-icon"><IconWarning /></span>
						<p class="error-msg">{store.error}</p>
						<button type="button" class="retry-btn" onclick={handleRetry}>
							<IconRefresh />
							<span>{t('previewRetry')}</span>
						</button>
					</div>
				{:else if store.showSource}
					<div class="source-viewport">
						<pre class="source-code font-mono"><code>{content}</code></pre>
					</div>
				{:else}
					<!-- Render visuale per tipo -->
					{#if kind === 'mermaid'}
						<div class="canvas-wrap">
							<PanZoom bind:this={panZoomRef} bind:scale={zoomScale} label={title}>
								<div class="panzoom-content">
									<MermaidDiagram source={content} bind:error={mermaidError} bind:ready={mermaidReady} />
								</div>
							</PanZoom>
							{#if mermaidError}
								<div class="mermaid-error-overlay">
									<div class="error-banner">
										<IconWarning />
										<span>{t('previewErrorInvalidMermaid')}: {mermaidError}</span>
									</div>
									<pre class="error-source font-mono"><code>{content}</code></pre>
								</div>
							{/if}
						</div>
					{:else if kind === 'svg'}
						<div class="canvas-wrap">
							<PanZoom bind:this={panZoomRef} bind:scale={zoomScale} label={title}>
								<div class="panzoom-content svg-wrapper">
									<iframe
										sandbox=""
										srcdoc={buildSandboxedSvgDocument(content)}
										title={title}
										class="svg-frame"
									></iframe>
								</div>
							</PanZoom>
						</div>
					{:else if kind === 'html'}
						<div class="html-container" class:device-phone={store.deviceMode === 'phone'} class:device-tablet={store.deviceMode === 'tablet'}>
							{#if store.previewUrl}
								<iframe
									sandbox="allow-scripts"
									src={store.previewUrl}
									title={title}
									class="html-frame"
								></iframe>
							{/if}
						</div>
					{/if}
				{/if}
			</div>

		{:else}
			<!-- ============================================================ -->
			<!-- VISTA MOBILE (Full-screen overlay sheet)                     -->
			<!-- ============================================================ -->
			<header class="mobile-topbar">
				<button
					type="button"
					class="mobile-back-btn"
					onclick={() => store.close()}
					title={t('previewBack')}
					aria-label={t('previewBack')}
				>
					<IconChevronLeft />
				</button>

				<div class="mobile-title-group">
					<span class="kind-pill">{kindBadge}</span>
					<span class="mobile-title" title={title}>{title}</span>
				</div>

				<div class="mobile-actions">
					{#if kind === 'html' && !store.showSource}
						<button
							type="button"
							class="mobile-action-btn"
							onclick={() => void store.reloadHtml()}
							title={t('previewReload')}
							aria-label={t('previewReload')}
						>
							<IconRefresh />
						</button>
					{/if}

					<button
						type="button"
						class="mobile-action-btn"
						class:active={store.showSource}
						onclick={() => (store.showSource = !store.showSource)}
						title={store.showSource ? t('previewHideSource') : t('previewViewSource')}
						aria-label={store.showSource ? t('previewHideSource') : t('previewViewSource')}
					>
						{#if store.showSource}
							<IconViewPreview />
						{:else}
							<IconViewCode />
						{/if}
					</button>

					{#if store.showSource}
						<button
							type="button"
							class="mobile-action-btn"
							onclick={copySource}
							title={copied ? t('previewCopied') : t('previewCopySource')}
							aria-label={copied ? t('previewCopied') : t('previewCopySource')}
						>
							{#if copied}
								<IconCheck />
							{:else}
								<IconCopy />
							{/if}
						</button>
					{/if}
				</div>
			</header>

			<!-- Contenuto Mobile -->
			<div class="mobile-body">
				{#if store.isLoading}
					<div class="loading-state">
						<span class="spinner" aria-hidden="true"></span>
						<p>{t('previewLoading')}</p>
					</div>
				{:else if store.error}
					<div class="error-state">
						<span class="error-icon"><IconWarning /></span>
						<p class="error-msg">{store.error}</p>
						<button type="button" class="retry-btn" onclick={handleRetry}>
							<IconRefresh />
							<span>{t('previewRetry')}</span>
						</button>
					</div>
				{:else if store.showSource}
					<div class="source-viewport">
						<pre class="source-code font-mono"><code>{content}</code></pre>
					</div>
				{:else}
					<!-- Vista visuale mobile -->
					{#if kind === 'mermaid'}
						<div class="canvas-wrap mobile-canvas">
							<PanZoom bind:this={panZoomRef} bind:scale={zoomScale} label={title}>
								<div class="panzoom-content">
									<MermaidDiagram source={content} bind:error={mermaidError} bind:ready={mermaidReady} />
								</div>
							</PanZoom>

							{#if mermaidError}
								<div class="mermaid-error-overlay">
									<div class="error-banner">
										<IconWarning />
										<span>{t('previewErrorInvalidMermaid')}: {mermaidError}</span>
									</div>
									<pre class="error-source font-mono"><code>{content}</code></pre>
								</div>
							{/if}

							<!-- Pulsanti galleggianti di zoom secondari per mobile -->
							<div class="mobile-floating-zoom">
								<button
									type="button"
									class="floating-zoom-btn"
									onclick={() => panZoomRef?.zoomIn()}
									aria-label={t('previewZoomIn')}
								>
									<IconZoomIn />
								</button>
								<button
									type="button"
									class="floating-zoom-btn"
									onclick={() => panZoomRef?.zoomOut()}
									aria-label={t('previewZoomOut')}
								>
									<IconZoomOut />
								</button>
								<button
									type="button"
									class="floating-zoom-btn"
									onclick={() => panZoomRef?.reset()}
									aria-label={t('previewResetZoom')}
								>
									<IconReset />
								</button>
							</div>
						</div>
					{:else if kind === 'svg'}
						<div class="canvas-wrap mobile-canvas">
							<PanZoom bind:this={panZoomRef} bind:scale={zoomScale} label={title}>
								<div class="panzoom-content svg-wrapper">
									<iframe
										sandbox=""
										srcdoc={buildSandboxedSvgDocument(content)}
										title={title}
										class="svg-frame"
									></iframe>
								</div>
							</PanZoom>

							<div class="mobile-floating-zoom">
								<button
									type="button"
									class="floating-zoom-btn"
									onclick={() => panZoomRef?.zoomIn()}
									aria-label={t('previewZoomIn')}
								>
									<IconZoomIn />
								</button>
								<button
									type="button"
									class="floating-zoom-btn"
									onclick={() => panZoomRef?.zoomOut()}
									aria-label={t('previewZoomOut')}
								>
									<IconZoomOut />
								</button>
								<button
									type="button"
									class="floating-zoom-btn"
									onclick={() => panZoomRef?.reset()}
									aria-label={t('previewResetZoom')}
								>
									<IconReset />
								</button>
							</div>
						</div>
					{:else if kind === 'html'}
						<div class="mobile-html-container">
							{#if store.previewUrl}
								<iframe
									sandbox="allow-scripts"
									src={store.previewUrl}
									title={title}
									class="mobile-html-frame"
								></iframe>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ============================================================ */
	/* LAYOUT GENERALE E CONTENITORI                                */
	/* ============================================================ */
	.preview-surface {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
		color: var(--ink);
		user-select: none;
	}

	/* DESKTOP (Docked column beside transcript) */
	.preview-surface.desktop {
		flex: 0 0 55%;
		width: 55%;
		min-width: 360px;
		height: 100%;
		border-left: 1px solid var(--line);
		overflow: hidden;
		position: relative;
		z-index: 10;
	}

	/* La sidebar macchine occupa 390px: nei desktop stretti una seconda
	   colonna taglierebbe i controlli. L'anteprima occupa allora il solo
	   pannello chat, senza coprire l'elenco delle conversazioni. */
	@container (max-width: 800px) {
		.preview-surface.desktop {
			position: absolute;
			inset: 0;
			width: 100%;
			min-width: 0;
			z-index: 30;
		}
	}

	/* MOBILE (Full-screen overlay above chat) */
	.preview-surface.mobile {
		position: fixed;
		inset: var(--app-top, 0) 0 auto 0;
		width: 100vw;
		height: 100vh;
		height: var(--app-height, 100dvh);
		z-index: 35;
		overflow: hidden;
		overscroll-behavior: contain;
		touch-action: pan-y;
	}

	/* ============================================================ */
	/* DESKTOP TOOLBAR                                              */
	/* ============================================================ */
	.desktop-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 48px;
		height: auto;
		padding: var(--space-2) var(--space-3);
		flex-wrap: wrap;
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
		flex-shrink: 0;
		gap: var(--space-2, 8px);
	}

	.toolbar-left {
		display: flex;
		align-items: center;
		gap: var(--space-2, 8px);
		min-width: 0;
		flex: 1 1 auto;
	}

	.kind-pill {
		font-size: var(--text-xs, 11px);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 6px;
		border-radius: var(--radius-sm, 4px);
		background: var(--bg-sunken, rgba(0, 0, 0, 0.15));
		border: 1px solid var(--line);
		flex-shrink: 0;
	}

	.kind-mermaid .kind-pill {
		color: var(--brand);
		border-color: color-mix(in oklch, var(--brand) 30%, transparent);
	}

	.kind-svg .kind-pill {
		color: #10b981;
		border-color: color-mix(in srgb, #10b981 30%, transparent);
	}

	.kind-html .kind-pill {
		color: #f59e0b;
		border-color: color-mix(in srgb, #f59e0b 30%, transparent);
	}

	.toolbar-title {
		font-size: var(--text-sm, 13px);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.toolbar-center {
		display: flex;
		align-items: center;
		gap: var(--space-2, 8px);
		flex-shrink: 0;
	}

	.zoom-controls {
		display: flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-sunken, rgba(0, 0, 0, 0.1));
		border: 1px solid var(--line);
		border-radius: var(--radius-md, 6px);
		padding: 2px;
	}

	.zoom-level {
		font-size: var(--text-xs, 11px);
		padding: 0 6px;
		min-width: 44px;
		text-align: center;
		color: var(--ink-muted);
	}

	.device-switcher {
		display: flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-sunken, rgba(0, 0, 0, 0.1));
		border: 1px solid var(--line);
		border-radius: var(--radius-md, 6px);
		padding: 2px;
	}

	.device-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 28px;
		border: none;
		background: transparent;
		color: var(--ink-muted);
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		transition: background-color 0.15s, color 0.15s;
	}

	.device-btn:hover {
		color: var(--ink);
		background: var(--bg-hover, rgba(255, 255, 255, 0.05));
	}

	.device-btn.active {
		color: var(--ink);
		background: var(--bg-raised);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.tool-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-muted);
		border-radius: var(--radius-md, 6px);
		cursor: pointer;
		transition: background-color 0.15s, color 0.15s, border-color 0.15s;
	}

	.tool-btn:hover {
		color: var(--ink);
		background: var(--bg-hover, rgba(255, 255, 255, 0.06));
		border-color: var(--line);
	}

	.tool-btn.active {
		color: var(--brand);
		background: color-mix(in oklch, var(--brand) 15%, transparent);
		border-color: color-mix(in oklch, var(--brand) 30%, transparent);
	}

	.close-btn:hover {
		color: var(--color-danger, #ef4444);
		background: color-mix(in srgb, #ef4444 12%, transparent);
		border-color: color-mix(in srgb, #ef4444 25%, transparent);
	}

	/* ============================================================ */
	/* MOBILE TOPBAR                                                */
	/* ============================================================ */
	.mobile-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 52px;
		padding: max(var(--space-1, 4px), env(safe-area-inset-top, 0px)) var(--space-2, 8px) var(--space-1, 4px);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
		flex-shrink: 0;
		gap: var(--space-2, 8px);
	}

	.mobile-back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		border: none;
		background: transparent;
		color: var(--ink);
		border-radius: var(--radius-md, 8px);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.mobile-back-btn:active {
		background: var(--bg-hover, rgba(255, 255, 255, 0.08));
	}

	.mobile-title-group {
		display: flex;
		align-items: center;
		gap: var(--space-2, 8px);
		min-width: 0;
		flex: 1 1 auto;
	}

	.mobile-title {
		font-size: var(--text-sm, 14px);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mobile-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.mobile-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		border: none;
		background: transparent;
		color: var(--ink-muted);
		border-radius: var(--radius-md, 8px);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.mobile-action-btn:active,
	.mobile-action-btn.active {
		color: var(--ink);
		background: var(--bg-hover, rgba(255, 255, 255, 0.08));
	}

	/* ============================================================ */
	/* CORPO CONTENUTI                                              */
	/* ============================================================ */
	.preview-body,
	.mobile-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
		background: var(--bg-base);
	}

	.mobile-body {
		padding-bottom: max(var(--space-2, 8px), var(--safe-bottom, 0px));
	}

	.loading-state,
	.error-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-4, 16px);
		text-align: center;
		gap: var(--space-3, 12px);
		color: var(--ink-muted);
	}

	.error-icon {
		color: #f59e0b;
		width: 32px;
		height: 32px;
	}

	.error-msg {
		max-width: 400px;
		font-size: var(--text-sm, 13px);
		line-height: 1.5;
	}

	.retry-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2, 8px);
		padding: var(--space-2, 8px) var(--space-3, 14px);
		min-height: 36px;
		border-radius: var(--radius-md, 6px);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink);
		font-size: var(--text-sm, 13px);
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.15s, border-color 0.15s;
	}

	.retry-btn:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong, #888);
	}

	/* SORGENTE */
	.source-viewport {
		flex: 1;
		min-height: 0;
		overflow: auto;
		background: var(--bg-sunken, #000);
		padding: var(--space-3, 14px);
		user-select: text;
	}

	.source-code {
		margin: 0;
		font-size: var(--text-xs, 12px);
		line-height: 1.5;
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-all;
	}

	/* CANVAS PANZOOM */
	.canvas-wrap {
		flex: 1;
		min-height: 0;
		position: relative;
		overflow: hidden;
		display: flex;
	}

	.panzoom-content {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4, 20px);
		box-sizing: border-box;
		min-width: 100%;
		min-height: 100%;
	}

	.svg-wrapper {
		width: 100%;
		height: 100%;
		min-width: 400px;
		min-height: 400px;
		pointer-events: none;
	}

	.svg-frame {
		width: 100%;
		height: 100%;
		min-width: 400px;
		min-height: 400px;
		border: none;
		pointer-events: none;
		background: transparent;
	}

	.mermaid-error-overlay {
		position: absolute;
		inset: 0;
		background: var(--bg-base);
		display: flex;
		flex-direction: column;
		z-index: 5;
		padding: var(--space-3, 14px);
		gap: var(--space-3, 12px);
		overflow: auto;
		user-select: text;
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2, 8px);
		padding: var(--space-2, 8px) var(--space-3, 12px);
		border-radius: var(--radius-md, 6px);
		background: color-mix(in srgb, #ef4444 15%, transparent);
		border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
		color: #f87171;
		font-size: var(--text-sm, 13px);
	}

	.error-source {
		margin: 0;
		padding: var(--space-3, 12px);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md, 6px);
		font-size: var(--text-xs, 12px);
		line-height: 1.5;
		overflow: auto;
		color: var(--ink);
	}

	/* HTML PROTOTYPE CONTAINER */
	.html-container {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-sunken, #111);
		padding: var(--space-3, 12px);
		box-sizing: border-box;
		overflow: auto;
	}

	.html-frame {
		width: 100%;
		height: 100%;
		border: none;
		background: #fff;
		border-radius: var(--radius-md, 6px);
		box-shadow: var(--shadow-elevated, 0 8px 24px rgba(0, 0, 0, 0.2));
		transition: width 0.2s ease;
	}

	.html-container.device-phone .html-frame {
		width: 390px;
		height: 100%;
		border-radius: 20px;
		border: 4px solid var(--line-strong, #444);
	}

	.html-container.device-tablet .html-frame {
		width: 820px;
		max-width: 100%;
		height: 100%;
		border-radius: 14px;
		border: 4px solid var(--line-strong, #444);
	}

	.mobile-html-container {
		flex: 1;
		min-height: 0;
		display: flex;
		background: #fff;
	}

	.mobile-html-frame {
		width: 100%;
		height: 100%;
		border: none;
		display: block;
	}

	/* FLOATING ZOOM BUTTONS (Mobile secondary affordance) */
	.mobile-floating-zoom {
		position: absolute;
		right: 16px;
		bottom: calc(var(--safe-bottom, 0px) + 16px);
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: 10;
	}

	.floating-zoom-btn {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 1px solid var(--line-strong, rgba(255, 255, 255, 0.2));
		background: var(--bg-raised);
		color: var(--ink);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.floating-zoom-btn:active {
		transform: scale(0.94);
		background: var(--bg-hover);
	}

	.spinner {
		width: 24px;
		height: 24px;
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
</style>
