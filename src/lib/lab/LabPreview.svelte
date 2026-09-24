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

	let {
		projectId,
		laneId,
		prototypeId,
		workspacePath,
		projectPath,
		visible = true,
		session
	} = $props<{
		projectId: string;
		laneId: string;
		prototypeId: string;
		workspacePath: string;
		projectPath: string | null;
		visible: boolean;
		session: AgentSession;
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

	// Rileva la fine del turno dell'agente (quando lo streaming si conclude dopo un prompt utente)
	let wasStreaming = false;
	$effect(() => {
		const isStreamingNow = session.isStreaming;
		if (wasStreaming && !isStreamingNow) {
			void runtime.handleAgentTurnEnd().then(() => {
				void loadRevisions();
			});
		}
		wasStreaming = isStreamingNow;
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
	});

	async function loadRevisions(): Promise<void> {
		try {
			revisions = await labApi.log(workspacePath, 100);
		} catch {
			revisions = [];
		}
	}

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
			<button
				type="button"
				class="tool-btn"
				class:is-active={viewportMode === 'desktop'}
				onclick={() => (viewportMode = 'desktop')}
				title={m.lab_view_viewport_desktop()}
				aria-label={m.lab_view_viewport_desktop()}
			>
				<span class="btn-text">Desktop</span>
			</button>
			<button
				type="button"
				class="tool-btn"
				class:is-active={viewportMode === 'tablet'}
				onclick={() => (viewportMode = 'tablet')}
				title={m.lab_view_viewport_tablet()}
				aria-label={m.lab_view_viewport_tablet()}
			>
				<span class="btn-text">Tablet</span>
			</button>
			<button
				type="button"
				class="tool-btn"
				class:is-active={viewportMode === 'mobile'}
				onclick={() => (viewportMode = 'mobile')}
				title={m.lab_view_viewport_mobile()}
				aria-label={m.lab_view_viewport_mobile()}
			>
				<span class="btn-text">Mobile</span>
			</button>
		</div>

		<div class="toolbar-divider" role="separator"></div>

		<!-- Azioni di navigazione ed esame -->
		<div class="toolbar-group">
			<button
				type="button"
				class="tool-btn"
				onclick={handleReload}
				title={m.lab_view_reload()}
				aria-label={m.lab_view_reload()}
				disabled={runtime.isCompiling}
			>
				<IconRefresh />
			</button>
			<button
				type="button"
				class="tool-btn"
				onclick={handleOpenBrowser}
				title={m.lab_view_open_browser()}
				aria-label={m.lab_view_open_browser()}
				disabled={!runtime.url}
			>
				<IconExternalLink />
			</button>
			<button
				type="button"
				class="tool-btn select-btn"
				class:is-active={isSelectModeActive}
				onclick={toggleSelectMode}
				title={isSelectModeActive ? m.lab_view_select_element_active() : m.lab_view_select_element()}
				aria-label={m.lab_view_select_element()}
				aria-pressed={isSelectModeActive}
			>
				<span class="select-indicator"></span>
				<span class="btn-text">{m.lab_view_select_element()}</span>
			</button>
		</div>

		<div class="toolbar-spacer"></div>

		<!-- Storico revisioni, duplicazione ed esportazione -->
		<div class="toolbar-group">
			<div class="rev-dropdown-container">
				<button
					type="button"
					class="tool-btn rev-btn"
					onclick={() => (isRevisionsOpen = !isRevisionsOpen)}
					aria-expanded={isRevisionsOpen}
					aria-label={m.lab_view_revisions()}
				>
					<span class="btn-text">{m.lab_view_revisions()}</span>
					<IconChevronDown />
				</button>

				{#if isRevisionsOpen}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div class="dropdown-backdrop" onclick={() => (isRevisionsOpen = false)}></div>
					<div class="rev-dropdown-menu" role="menu">
						<button
							type="button"
							class="rev-menu-item current-rev-item"
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
					</div>
				{/if}
			</div>

			<button
				type="button"
				class="tool-btn"
				onclick={handleDuplicate}
				title={m.lab_view_duplicate()}
				aria-label={m.lab_view_duplicate()}
			>
				<IconCopy />
				<span class="btn-text">{m.lab_view_duplicate()}</span>
			</button>

			<button
				type="button"
				class="tool-btn"
				onclick={handleExport}
				title={m.lab_view_export()}
				aria-label={m.lab_view_export()}
			>
				<IconDownload />
				<span class="btn-text">{m.lab_view_export()}</span>
			</button>
		</div>
	</header>

	<!-- Banner di visualizzazione revisione storica -->
	{#if runtime.isViewingHistorical}
		<div class="historical-banner" role="status">
			<div class="banner-content">
				<IconWarning />
				<span class="banner-text">
					{m.lab_view_historical_banner({
						sha: runtime.activeRevisionSha?.slice(0, 7) ?? '',
						message: activeRevMessage
					})}
				</span>
			</div>
			<div class="banner-actions">
				<button type="button" class="banner-btn restore-btn" onclick={handleRestoreCurrentRevision}>
					{m.lab_view_restore()}
				</button>
				<button type="button" class="banner-btn return-btn" onclick={handleReturnToCurrent}>
					{m.lab_view_return_to_current()}
				</button>
			</div>
		</div>
	{/if}

	<!-- Notifica toast esportazione -->
	{#if exportNotice}
		<div class="export-toast" class:is-error={exportNotice.kind === 'error'} role="alert">
			{#if exportNotice.kind === 'success'}
				<IconCheck />
			{:else}
				<IconWarning />
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
					<div class="loading-spinner" aria-hidden="true"></div>
					<p>{m.lab_view_initial_loading()}</p>
				</div>
			{:else if !runtime.url}
				<div class="state-overlay empty-state">
					<p>{m.lab_view_no_preview()}</p>
				</div>
			{/if}

			{#if runtime.url}
				<iframe
					bind:this={iframeEl}
					sandbox="allow-scripts allow-forms allow-modals allow-popups"
					src={runtime.url}
					title="Laboratorio Anteprima"
					class="preview-iframe"
				></iframe>
			{/if}

			{#if runtime.isCompiling && !runtime.isInitialLoading}
				<div class="compiling-indicator" role="status" aria-live="polite">
					<div class="small-spinner" aria-hidden="true"></div>
					<span>{m.lab_view_compiling()}</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Barra errori di compilazione e runtime -->
	{#if runtime.hasErrors}
		<footer class="error-bar" role="region" aria-label="Errori anteprima">
			<div class="error-bar-header">
				<button
					type="button"
					class="error-toggle-btn"
					onclick={() => (isErrorsExpanded = !isErrorsExpanded)}
					aria-expanded={isErrorsExpanded}
				>
					{#if isErrorsExpanded}
						<IconChevronDown />
					{:else}
						<IconChevronRight />
					{/if}
					<IconWarning />
					<span class="error-count-text">
						{m.lab_view_errors_count({ count: runtime.allErrors.length })}
					</span>
				</button>

				<button type="button" class="ask-fix-btn" onclick={handleAskToFix}>
					<IconSparkles />
					<span>{m.lab_view_ask_fix()}</span>
				</button>
			</div>

			{#if isErrorsExpanded}
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
			{/if}
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
		height: 38px;
		min-height: 38px;
		padding: 0 var(--space-2);
		background-color: var(--bg-panel);
		border-bottom: 1px solid var(--line);
		gap: var(--space-1);
		user-select: none;
		z-index: 10;
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
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: inherit;
		cursor: pointer;
		transition: background-color 0.1s ease, color 0.1s ease, border-color 0.1s ease;
	}

	.tool-btn:hover:not(:disabled) {
		background-color: var(--bg-hover);
		color: var(--ink);
	}

	.tool-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}

	.tool-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.tool-btn.is-active {
		background-color: var(--bg-sunken);
		color: var(--ink);
		border-color: var(--line);
		font-weight: 500;
	}

	.select-btn.is-active {
		background-color: rgba(37, 99, 235, 0.12);
		color: #2563eb;
		border-color: rgba(37, 99, 235, 0.3);
	}

	.select-indicator {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: currentColor;
	}

	/* Dropdown revisioni */
	.rev-dropdown-container {
		position: relative;
	}

	.dropdown-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
	}

	.rev-dropdown-menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		width: 320px;
		max-height: 380px;
		background-color: var(--bg-panel);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
		z-index: 50;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.current-rev-item {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		font-size: var(--text-xs);
		color: var(--ink);
		background: transparent;
		border: none;
		cursor: pointer;
		font-weight: 500;
	}

	.current-rev-item:hover {
		background-color: var(--bg-hover);
	}

	.menu-divider {
		height: 1px;
		background-color: var(--line);
	}

	.rev-list {
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.rev-menu-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		text-align: left;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		transition: background-color 0.1s ease;
	}

	.rev-menu-item:hover {
		background-color: var(--bg-hover);
		color: var(--ink);
	}

	.rev-menu-item.is-selected {
		background-color: var(--bg-sunken);
		color: var(--accent);
		font-weight: 500;
	}

	.rev-sha {
		font-family: var(--font-mono, monospace);
		font-size: 11px;
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
		background-color: #fef3c7;
		color: #92400e;
		border-bottom: 1px solid #fde68a;
		font-size: var(--text-xs);
		gap: var(--space-3);
		z-index: 5;
	}

	.banner-content {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		overflow: hidden;
	}

	.banner-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.banner-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.banner-btn {
		height: 24px;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
	}

	.restore-btn {
		background-color: #d97706;
		color: #ffffff;
	}

	.restore-btn:hover {
		background-color: #b45309;
	}

	.return-btn {
		background-color: transparent;
		border-color: #d97706;
		color: #92400e;
	}

	.return-btn:hover {
		background-color: rgba(217, 119, 6, 0.1);
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
		background-color: var(--bg-panel);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		font-size: var(--text-xs);
		z-index: 30;
	}

	.export-toast.is-error {
		border-color: #ef4444;
		color: #ef4444;
	}

	.toast-close {
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		display: flex;
		align-items: center;
		padding: 0;
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
		background-color: #ffffff;
		box-shadow: 0 0 16px rgba(0, 0, 0, 0.08);
		transition: width 0.15s ease-out;
		overflow: hidden;
	}

	.preview-iframe {
		width: 100%;
		height: 100%;
		border: none;
		background-color: #ffffff;
	}

	.state-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background-color: var(--bg-panel);
		color: var(--ink-muted);
		gap: var(--space-2);
		font-size: var(--text-sm);
		z-index: 2;
	}

	.compiling-indicator {
		position: absolute;
		bottom: var(--space-3);
		right: var(--space-3);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		background-color: rgba(0, 0, 0, 0.75);
		color: #ffffff;
		border-radius: var(--radius-full);
		font-size: 11px;
		backdrop-filter: blur(4px);
		z-index: 5;
	}

	.loading-spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--line);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.small-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #ffffff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Barra errori */
	.error-bar {
		display: flex;
		flex-direction: column;
		background-color: #fef2f2;
		border-top: 1px solid #fee2e2;
		max-height: 180px;
		z-index: 10;
	}

	.error-bar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 32px;
		padding: 0 var(--space-3);
	}

	.error-toggle-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: none;
		color: #b91c1c;
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		padding: 0;
	}

	.ask-fix-btn {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		height: 24px;
		padding: 0 var(--space-2);
		background-color: #b91c1c;
		color: #ffffff;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.1s ease;
	}

	.ask-fix-btn:hover {
		background-color: #991b1b;
	}

	.error-list {
		overflow-y: auto;
		padding: 0 var(--space-3) var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.error-item {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: 11px;
		color: #991b1b;
		font-family: var(--font-mono, monospace);
		word-break: break-all;
	}

	.error-kind-badge {
		padding: 1px 4px;
		border-radius: 3px;
		background-color: #fee2e2;
		color: #991b1b;
		font-size: 9px;
		font-weight: bold;
		text-transform: uppercase;
		flex-shrink: 0;
	}

	.error-kind-badge.is-runtime {
		background-color: #ffedd5;
		color: #c2410c;
	}

	.error-location {
		color: var(--ink-muted);
		flex-shrink: 0;
	}
</style>
