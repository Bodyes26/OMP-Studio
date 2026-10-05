<script lang="ts">
	// Vista anteprima della corsia Laboratorio prototipi (contratto §8).
	// Montato stabilmente nella colonna centrale, visibilita' alternata via CSS.
	// Governa l'anteprima isolata su server loopback Rust:
	//  - Toolbar con selettore viewport (desktop / tablet 768px / mobile 375px);
	//  - Ricarica e apertura nel browser di sistema;
	//  - Modalita' "Seleziona" per ispezionare elementi nel DOM del prototipo;
	//  - Selettore revisioni git con banner sola lettura e ripristino;
	//  - Duplicazione ed esportazione cartella;
	//  - Barra errori di compilazione e runtime con azione "Chiedi di correggere".

	import { onDestroy } from 'svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { open } from '@tauri-apps/plugin-dialog';
	import { m } from '$lib/paraglide/messages.js';
	import type { AgentSession } from '$lib/agent/session.svelte';
	import { openLabEntry } from '$lib/lanes/laneActions';
	import { labApi } from './api';
	import {
		disposeLabRuntime,
		getOrCreateLabRuntime,
		type LabLaneRuntime
	} from './runtime.svelte';
	import type { LabRevision } from './types';
	import {
		IconChevronDown,
		IconChevronRight,
		IconCopy,
		IconDownload,
		IconExternalLink,
		IconRefresh,
		IconSparkles,
		IconWarning,
		IconCheck,
		IconClose
	} from '$lib/icons';
	import AlertBanner from '$lib/components/AlertBanner.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { Lingering, ROW_EXIT_MS } from '$lib/agent/motionState.svelte';

	let {
		projectId,
		laneId,
		prototypeId,
		workspacePath,
		projectPath,
		visible = true,
		session,
		onRunEnd
	} = $props<{
		projectId: string;
		laneId: string;
		prototypeId: string;
		workspacePath: string;
		projectPath: string | null;
		visible: boolean;
		session: AgentSession;
		/** Fine della richiesta: revisione registrata e anteprima aggiornata. */
		onRunEnd?: () => void;
	}>();

	// Inizializza il runtime della corsia in modo reattivo
	const runtime = $derived(
		getOrCreateLabRuntime({
			projectId,
			laneId,
			prototypeId,
			workspacePath,
			projectPath,
			session
		})
	);

	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let viewportMode = $state<'desktop' | 'tablet' | 'mobile'>('desktop');
	let isSelectModeActive = $state(false);

	// Revisioni storiche
	let revisions = $state<LabRevision[]>([]);
	let isRevisionsOpen = $state(false);
	let activeRevMessage = $state('');

	// Notifica esportazione
	let exportNotice = $state<{ kind: 'success' | 'error'; text: string } | null>(null);
	let exportNoticeTimer: number | null = null;

	// Espansione barra errori
	let isErrorsExpanded = $state(false);
	const errorsLinger = new Lingering<true>(ROW_EXIT_MS);
	$effect(() => {
		errorsLinger.update(isErrorsExpanded ? true : undefined);
	});

	// Calcolo larghezza del viewport
	const iframeWrapperWidth = $derived(
		viewportMode === 'mobile' ? '375px' : viewportMode === 'tablet' ? '768px' : '100%'
	);

	// Avvio del runtime al montaggio
	$effect(() => {
		void runtime.start();
		void loadRevisions();

		return () => {
			disposeLabRuntime(projectId, laneId);
		};
	});

	// Fine della richiesta dell'utente: `agent_end` terminale. Il primo giro
	// dell'effetto registra solo il valore corrente, cosi' montare la corsia
	// non chiude una revisione.
	let seenRunEndSeq: number | null = null;
	$effect(() => {
		const seq = session.runEndSeq;
		if (seenRunEndSeq !== null && seq !== seenRunEndSeq) {
			void runtime.handleAgentTurnEnd().then(() => {
				void loadRevisions();
				onRunEnd?.();
			});
		}
		seenRunEndSeq = seq;
	});

	// Ascolto messaggi dall'iframe dell'anteprima
	$effect(() => {
		function handleIframeMessage(event: MessageEvent) {
			// Invariante di sicurezza: ignora messaggi non provenienti dal nostro iframe
			if (!iframeEl || event.source !== iframeEl.contentWindow) return;
			const data = event.data;
			if (!data || data.source !== 'lab-preview') return;

			if (data.type === 'runtime_error' && data.error) {
				runtime.reportRuntimeError(data.error);
			} else if (data.type === 'element_selected') {
				isSelectModeActive = false;
				iframeEl.contentWindow?.postMessage(
					{ source: 'lab-parent', type: 'toggle_select_mode', enabled: false },
					'*'
				);

				const snippet = data.textSnippet ? ` "${data.textSnippet}"` : '';
				const refText = m.lab_view_selected_element_text({
					tag: data.tag,
					selector: data.selector,
					snippet
				});
				session.insertComposerText(refText);
			}
		}

		window.addEventListener('message', handleIframeMessage);
		return () => {
			window.removeEventListener('message', handleIframeMessage);
		};
	});

	onDestroy(() => {
		if (exportNoticeTimer !== null) {
			window.clearTimeout(exportNoticeTimer);
		}
		errorsLinger.dispose();
	});

	async function loadRevisions(): Promise<void> {
		try {
			revisions = await labApi.log(workspacePath, 100);
		} catch {
			revisions = [];
		}
	}

	// Ogni pubblicazione ricrea l'iframe, che riparte senza modalita' Seleziona.
	$effect(() => {
		void runtime.publishSeq;
		isSelectModeActive = false;
	});

	function toggleSelectMode(): void {
		isSelectModeActive = !isSelectModeActive;
		iframeEl?.contentWindow?.postMessage(
			{ source: 'lab-parent', type: 'toggle_select_mode', enabled: isSelectModeActive },
			'*'
		);
	}

	function handleReload(): void {
		void runtime.recompileAndPublish();
	}

	function handleOpenBrowser(): void {
		if (runtime.url) {
			void openUrl(runtime.url);
		}
	}

	async function handleSelectRevision(rev: LabRevision): Promise<void> {
		isRevisionsOpen = false;
		activeRevMessage = rev.message;
		await runtime.viewRevision(rev.sha);
	}

	async function handleRestoreCurrentRevision(): Promise<void> {
		if (!runtime.activeRevisionSha) return;
		await runtime.restoreRevision(runtime.activeRevisionSha);
		await loadRevisions();
	}

	async function handleReturnToCurrent(): Promise<void> {
		await runtime.returnToCurrent();
	}

	async function handleDuplicate(): Promise<void> {
		try {
			const duplicated = await labApi.duplicate(projectPath, prototypeId);
			await openLabEntry(projectPath ? projectId : null, duplicated);
		} catch (err) {
			console.error('Errore durante la duplicazione del prototipo:', err);
		}
	}

	async function handleExport(): Promise<void> {
		try {
			const destination = await open({
				directory: true,
				multiple: false,
				title: m.lab_view_export_dialog_title()
			});

			if (destination && typeof destination === 'string') {
				await labApi.exportTo(workspacePath, destination);
				setExportNotice('success', m.lab_view_export_success({ path: destination }));
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setExportNotice('error', m.lab_view_export_failed({ error: message }));
		}
	}

	function setExportNotice(kind: 'success' | 'error', text: string): void {
		if (exportNoticeTimer !== null) {
			window.clearTimeout(exportNoticeTimer);
		}
		exportNotice = { kind, text };
		exportNoticeTimer = window.setTimeout(() => {
			exportNotice = null;
			exportNoticeTimer = null;
		}, 5000);
	}

	function handleAskToFix(): void {
		if (runtime.allErrors.length === 0) return;
		const formattedErrors = runtime.allErrors
			.map((e, idx) => {
				const loc = e.file
					? `${e.file}${e.line != null ? `:${e.line}` : ''}${e.column != null ? `:${e.column}` : ''}`
					: '';
				return `${idx + 1}. [${e.kind.toUpperCase()}] ${loc ? `${loc} — ` : ''}${e.message}`;
			})
			.join('\n');

		const prompt = m.lab_view_ask_fix_prompt({ errors: formattedErrors });
		session.insertComposerText(prompt);
	}
</script>

<div class="lab-preview-pane" class:is-hidden={!visible}>
	<!-- Toolbar superiore -->
	<header class="lab-toolbar" aria-label="Strumenti anteprima prototipo">
		<!-- Selettore Viewport -->
		<div class="toolbar-group" role="group" aria-label="Dimensioni viewport">
			<Tooltip text={m.lab_view_viewport_desktop()} placement="bottom">
				<button
					type="button"
					class="tool-btn"
					class:is-active={viewportMode === 'desktop'}
					onclick={() => (viewportMode = 'desktop')}
					aria-label={m.lab_view_viewport_desktop()}
				>
					<span class="btn-text">Desktop</span>
				</button>
			</Tooltip>
			<Tooltip text={m.lab_view_viewport_tablet()} placement="bottom">
				<button
					type="button"
					class="tool-btn"
					class:is-active={viewportMode === 'tablet'}
					onclick={() => (viewportMode = 'tablet')}
					aria-label={m.lab_view_viewport_tablet()}
				>
					<span class="btn-text">Tablet</span>
				</button>
			</Tooltip>
			<Tooltip text={m.lab_view_viewport_mobile()} placement="bottom">
				<button
					type="button"
					class="tool-btn"
					class:is-active={viewportMode === 'mobile'}
					onclick={() => (viewportMode = 'mobile')}
					aria-label={m.lab_view_viewport_mobile()}
				>
					<span class="btn-text">Mobile</span>
				</button>
			</Tooltip>
		</div>

		<div class="toolbar-divider" role="separator"></div>

		<!-- Azioni di navigazione ed esame -->
		<div class="toolbar-group">
			<Tooltip text={m.lab_view_reload()} placement="bottom">
				<button
					type="button"
					class="tool-btn"
					onclick={handleReload}
					aria-label={m.lab_view_reload()}
					disabled={runtime.isCompiling}
				>
					<IconRefresh />
				</button>
			</Tooltip>
			<Tooltip text={m.lab_view_open_browser()} placement="bottom">
				<button
					type="button"
					class="tool-btn"
					onclick={handleOpenBrowser}
					aria-label={m.lab_view_open_browser()}
					disabled={!runtime.url}
				>
					<IconExternalLink />
				</button>
			</Tooltip>
			<Tooltip
				text={isSelectModeActive ? m.lab_view_select_element_active() : m.lab_view_select_element()}
				placement="bottom"
			>
				<button
					type="button"
					class="tool-btn select-btn"
					class:is-active={isSelectModeActive}
					onclick={toggleSelectMode}
					aria-label={m.lab_view_select_element()}
					aria-pressed={isSelectModeActive}
				>
					<span class="select-indicator"></span>
					<span class="btn-text">{m.lab_view_select_element()}</span>
				</button>
			</Tooltip>
		</div>

		<div class="toolbar-spacer"></div>

		<!-- Storico revisioni, duplicazione ed esportazione -->
		<div class="toolbar-group">
			<MenuButton
				open={isRevisionsOpen}
				ariaLabel={m.lab_view_revisions()}
				width="320px"
				align="right"
				onToggle={() => (isRevisionsOpen = !isRevisionsOpen)}
				onClose={() => (isRevisionsOpen = false)}
			>
				{#snippet trigger()}
					<span class="btn-text">{m.lab_view_revisions()}</span>
					<IconChevronDown />
				{/snippet}

				<button
					type="button"
					class="current-rev-item"
					role="menuitem"
					onclick={() => {
						isRevisionsOpen = false;
						void handleReturnToCurrent();
					}}
				>
					<span class="rev-title">{m.lab_view_current_revision()}</span>
				</button>
				<div class="menu-divider"></div>
				{#if revisions.length === 0}
					<div class="empty-rev-notice">{m.lab_view_no_revisions()}</div>
				{:else}
					<div class="rev-list">
						{#each revisions as rev}
							<button
								type="button"
								class="rev-menu-item"
								class:is-selected={runtime.activeRevisionSha === rev.sha}
								role="menuitem"
								onclick={() => handleSelectRevision(rev)}
							>
								<span class="rev-sha">{rev.sha.slice(0, 7)}</span>
								<span class="rev-message" title={rev.message}>{rev.message}</span>
							</button>
						{/each}
					</div>
				{/if}
			</MenuButton>

			<Tooltip text={m.lab_view_duplicate()} placement="bottom">
				<button
					type="button"
					class="tool-btn"
					onclick={handleDuplicate}
					aria-label={m.lab_view_duplicate()}
				>
					<IconCopy />
					<span class="btn-text">{m.lab_view_duplicate()}</span>
				</button>
			</Tooltip>

			<Tooltip text={m.lab_view_export()} placement="bottom">
				<button
					type="button"
					class="tool-btn"
					onclick={handleExport}
					aria-label={m.lab_view_export()}
				>
					<IconDownload />
					<span class="btn-text">{m.lab_view_export()}</span>
				</button>
			</Tooltip>
		</div>
	</header>

	<!-- Banner di visualizzazione revisione storica -->
	{#if runtime.isViewingHistorical}
		<div class="historical-banner" role="status">
			<div class="banner-content">
				<span class="banner-icon" aria-hidden="true">
					<IconWarning />
				</span>
				<span class="banner-text">
					{m.lab_view_historical_banner({
						sha: runtime.activeRevisionSha?.slice(0, 7) ?? '',
						message: activeRevMessage
					})}
				</span>
			</div>
			<div class="banner-actions">
				<button
					type="button"
					class="ui-button ui-button-secondary"
					onclick={handleRestoreCurrentRevision}
				>
					{m.lab_view_restore()}
				</button>
				<button
					type="button"
					class="ui-button ui-button-ghost"
					onclick={handleReturnToCurrent}
				>
					{m.lab_view_return_to_current()}
				</button>
			</div>
		</div>
	{/if}

	<!-- Notifica toast esportazione -->
	{#if exportNotice}
		<div class="export-toast" class:is-error={exportNotice.kind === 'error'} role="alert">
			{#if exportNotice.kind === 'success'}
				<span class="toast-icon is-success"><IconCheck /></span>
			{:else}
				<span class="toast-icon is-danger"><IconWarning /></span>
			{/if}
			<span>{exportNotice.text}</span>
			<button
				type="button"
				class="toast-close"
				onclick={() => (exportNotice = null)}
				aria-label="Chiudi"
			>
				<IconClose />
			</button>
		</div>
	{/if}

	<!-- Area visualizzazione anteprima -->
	<div class="preview-stage">
		<div class="preview-frame-wrapper" style:width={iframeWrapperWidth}>
			{#if runtime.isInitialLoading}
				<div class="state-overlay">
					<StatusMark status="running" label={m.lab_view_initial_loading()} />
					<p>{m.lab_view_initial_loading()}</p>
				</div>
			{:else if !runtime.url}
				<div class="state-overlay empty-state">
					<p>{m.lab_view_no_preview()}</p>
				</div>
			{/if}

			{#if runtime.url}
				<!-- L'URL resta lo stesso a ogni pubblicazione: senza ricreare
				     l'iframe il riquadro mostrerebbe per sempre la prima build. -->
				{#key runtime.publishSeq}
					<iframe
						bind:this={iframeEl}
						sandbox="allow-scripts allow-forms allow-modals allow-popups"
						src={runtime.url}
						title="Laboratorio Anteprima"
						class="preview-iframe"
					></iframe>
				{/key}
			{/if}

			{#if runtime.isCompiling && !runtime.isInitialLoading}
				<div class="compiling-indicator" role="status" aria-live="polite">
					<StatusMark status="running" label={m.lab_view_compiling()} />
					<span>{m.lab_view_compiling()}</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Barra errori di compilazione e runtime -->
	{#if runtime.hasErrors}
		<footer class="error-bar" role="region" aria-label="Errori anteprima">
			<AlertBanner variant="error">
				<div class="error-banner-header">
					<button
						type="button"
						class="error-toggle-btn"
						onclick={() => (isErrorsExpanded = !isErrorsExpanded)}
						aria-expanded={isErrorsExpanded}
					>
						<span class="chevron" class:open={isErrorsExpanded}>
							<IconChevronRight />
						</span>
						<span class="error-count-text">
							{m.lab_view_errors_count({ count: runtime.allErrors.length })}
						</span>
					</button>

					<button
						type="button"
						class="ui-button ui-button-primary ask-fix-btn"
						onclick={handleAskToFix}
					>
						<IconSparkles />
						<span>{m.lab_view_ask_fix()}</span>
					</button>
				</div>

				{#if errorsLinger.shown}
					<div class="error-fold {errorsLinger.leaving ? 'tray-out' : 'tray-in'}">
						<div class="tray-fold-inner">
							<div class="error-list" role="list">
								{#each runtime.allErrors as err}
									<div class="error-item" role="listitem">
										<span class="error-kind-badge" class:is-runtime={err.kind === 'runtime'}>
											{err.kind === 'compile' ? 'Build' : 'Runtime'}
										</span>
										{#if err.file}
											<span class="error-location">
												{err.file}{err.line != null ? `:${err.line}` : ''}{err.column != null
													? `:${err.column}`
													: ''}
											</span>
										{/if}
										<span class="error-msg">{err.message}</span>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}
			</AlertBanner>
		</footer>
	{/if}
</div>

<style>
	.lab-preview-pane {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background-color: var(--bg-sunken);
		overflow: hidden;
		position: relative;
	}

	.lab-preview-pane.is-hidden {
		display: none;
	}

	/* Toolbar */
	.lab-toolbar {
		display: flex;
		align-items: center;
		height: 32px;
		min-height: 32px;
		padding: 0 var(--space-2);
		background-color: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		gap: var(--space-1);
		user-select: none;
		z-index: var(--z-sticky);
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.toolbar-divider {
		width: 1px;
		height: 18px;
		background-color: var(--line);
		margin: 0 var(--space-1);
	}

	.toolbar-spacer {
		flex: 1;
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		height: 28px;
		padding: 0 var(--space-2);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: inherit;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.tool-btn:hover:not(:disabled) {
		background-color: var(--bg-hover);
		color: var(--ink);
	}

	.tool-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -1px;
	}

	.tool-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.tool-btn.is-active {
		background-color: var(--bg-sunken);
		color: var(--ink);
		border-color: var(--line);
		font-weight: 500;
	}

	.select-btn.is-active {
		background-color: color-mix(in oklch, var(--brand) 12%, transparent);
		color: var(--brand-ink);
		border-color: color-mix(in oklch, var(--brand) 30%, transparent);
	}

	.select-indicator {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background-color: currentColor;
	}

	/* Menu revisioni (elementi interni al popover) */
	.current-rev-item {
		width: 100%;
		padding: 7px 8px;
		text-align: left;
		font-size: 13px;
		color: var(--ink);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		font-weight: 500;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.current-rev-item:hover {
		background-color: var(--bg-hover);
	}

	.menu-divider {
		height: 1px;
		background-color: var(--line);
		margin: var(--space-1) 0;
	}

	.rev-list {
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 2px 0;
	}

	.rev-menu-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 7px 8px;
		font-size: 13px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		text-align: left;
		color: var(--ink-muted);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.rev-menu-item:hover {
		background-color: var(--bg-hover);
		color: var(--ink);
	}

	.rev-menu-item.is-selected {
		background-color: var(--bg-sunken);
		color: var(--brand-ink);
		font-weight: 500;
	}

	.rev-sha {
		font-family: var(--font-mono, monospace);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.rev-message {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty-rev-notice {
		padding: var(--space-3);
		text-align: center;
		color: var(--ink-muted);
		font-size: var(--text-xs);
	}

	/* Historical banner */
	.historical-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background-color: var(--bg-raised);
		color: var(--ink);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-xs);
		gap: var(--space-3);
		z-index: var(--z-sticky);
	}

	.banner-content {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		overflow: hidden;
		min-width: 0;
	}

	.banner-icon {
		display: inline-flex;
		align-items: center;
		color: var(--warn);
		flex-shrink: 0;
	}

	.banner-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink);
	}

	.banner-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	/* Toast esportazione */
	.export-toast {
		position: absolute;
		top: 48px;
		right: var(--space-4);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background-color: var(--bg-raised);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		font-size: var(--text-xs);
		z-index: var(--z-toast);
	}

	.export-toast.is-error {
		border-color: var(--danger);
		color: var(--danger);
	}

	.toast-icon.is-success {
		display: inline-flex;
		color: var(--success);
	}

	.toast-icon.is-danger {
		display: inline-flex;
		color: var(--danger);
	}

	.toast-close {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		padding: 0;
		border-radius: var(--radius-sm);
		transition: color var(--dur-fast) var(--ease-out);
	}

	.toast-close:hover {
		color: var(--ink);
	}

	/* Stage anteprima */
	.preview-stage {
		flex: 1;
		display: flex;
		justify-content: center;
		align-items: stretch;
		background-color: var(--bg-sunken);
		overflow: hidden;
		position: relative;
	}

	.preview-frame-wrapper {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
		background-color: var(--bg-base);
		overflow: hidden;
	}

	.preview-iframe {
		width: 100%;
		height: 100%;
		border: none;
		background-color: var(--bg-base);
	}

	.state-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background-color: var(--bg-raised);
		color: var(--ink-muted);
		gap: var(--space-2);
		font-size: var(--text-sm);
		z-index: var(--z-sticky);
	}

	.compiling-indicator {
		position: absolute;
		bottom: var(--space-3);
		right: var(--space-3);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		background-color: var(--bg-raised);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		box-shadow: var(--shadow-raise);
		font-size: var(--text-caption);
		z-index: var(--z-sticky);
	}

	/* Barra errori */
	.error-bar {
		padding: var(--space-2) var(--space-3);
		background-color: var(--bg-sunken);
		border-top: 1px solid var(--line);
		z-index: var(--z-sticky);
	}

	.error-banner-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		min-height: 28px;
	}

	.error-toggle-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: none;
		color: var(--ink);
		font-family: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		padding: 0;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.error-toggle-btn:hover {
		color: var(--danger);
	}

	.chevron {
		display: inline-grid;
		--icon-size: 14px;
		color: var(--ink-muted);
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.ask-fix-btn {
		flex-shrink: 0;
	}

	.error-fold {
		--dur-tray: var(--dur-row);
	}

	.error-list {
		overflow-y: auto;
		max-height: 160px;
		margin-top: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.error-item {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-caption);
		color: var(--ink);
		word-break: break-all;
	}

	.error-kind-badge {
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background-color: var(--bg-base);
		color: var(--danger);
		font-size: var(--text-caption);
		font-weight: 500;
		flex-shrink: 0;
	}

	.error-kind-badge.is-runtime {
		background-color: var(--bg-base);
		color: var(--warn);
	}

	.error-location {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.error-msg {
		color: var(--ink);
		font-size: var(--text-caption);
	}
</style>
