<script lang="ts">
	import Terminal from '$lib/terminal/Terminal.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import FileTree from '$lib/components/FileTree.svelte';
	import Editor from '$lib/editor/Editor.svelte';
	import SessionList from '$lib/components/SessionList.svelte';
	import UsagePopover from '$lib/components/UsagePopover.svelte';
	import ProjectPicker from '$lib/components/ProjectPicker.svelte';
	import GitPanel from '$lib/components/GitPanel.svelte';
	import DiagramViewer from '$lib/components/DiagramViewer.svelte';
	import PreviewViewer from '$lib/components/PreviewViewer.svelte';
	import StudioUpdateModal from '$lib/components/StudioUpdateModal.svelte';
	import ModelSettingsModal from '$lib/components/models/ModelSettingsModal.svelte';
	import { studioUpdaterStore } from '$lib/stores/studioUpdater.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { onDestroy } from 'svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { onMount } from 'svelte';
	let leftSection = $state<'files' | 'sessions' | 'git'>('files');
	// Quando un diagramma arriva, la colonna centrale mostra la whiteboard
	// al posto dell'editor; si torna all'editor chiudendo la whiteboard.
	let diagramOpen = $state(false);
	// Anteprima sandbox di un file HTML del progetto (vibecoding).
	let previewFile = $state<string | null>(null);

	onMount(() => {
		const unlistenDiagram = listen<{ cwd?: string }>('diagram://new', (e) => {
			const targetCwd = e.payload?.cwd;
			if (!targetCwd || !projectStore.activeProject || targetCwd.toLowerCase() === projectStore.activeProject.path.toLowerCase()) {
				diagramOpen = true;
			}
		});

		const unlistenPreview = listen<{ cwd?: string; file_path?: string }>('preview://new', (e) => {
			const targetCwd = e.payload?.cwd;
			if (!targetCwd || !projectStore.activeProject || targetCwd.toLowerCase() === projectStore.activeProject.path.toLowerCase()) {
				if (e.payload?.file_path) {
					previewFile = e.payload.file_path;
					diagramOpen = false;
				}
			}
		});

		return () => {
			void unlistenDiagram.then((un) => un());
			void unlistenPreview.then((un) => un());
		};
	});
	let usageOpen = $state(false);
	let pickerOpen = $state(false);

	// Richiesta di apertura diff proveniente dal pannello GIT: porta il file
	// nell'editor gia' in modalita' diff, con la revisione giusta.
	let editorDiffRequest = $state<{
		filePath: string;
		mode: 'working' | 'commit';
		hash?: string;
		id: number;
	} | null>(null);
	let editorDiffRequestId = 0;

	// Sessioni terminale per progetto: servono a riprendere una sessione
	// storica con `--resume` senza toccare il PTY degli altri progetti.
	const terminalSessions = new Map<string, import('$lib/terminal/terminal').TerminalSession>();

	function handleResumeSession(projectId: string, sessionId: string) {
		const term = terminalSessions.get(projectId);
		if (term) void term.resumeSession(sessionId);
	}

	function handleGitPanelDiff(filePath: string, mode: 'working' | 'commit', hash?: string) {
		if (!projectStore.activeId) return;
		projectStore.openFile(projectStore.activeId, filePath);
		editorDiffRequest = { filePath, mode, hash, id: ++editorDiffRequestId };
	}

	let terminalOpenRequest = $state<{
		projectId: string;
		filePath: string;
		line: number | null;
		id: number;
	} | null>(null);
	let terminalOpenRequestId = 0;

	function handleTerminalOpenFile(projectId: string, filePath: string, line: number | null) {
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		projectStore.openFile(projectId, filePath);
		terminalOpenRequest = {
			projectId,
			filePath,
			line,
			id: ++terminalOpenRequestId
		};
	}

	let ompVersion = $state<string | null>(null);
	let isCheckingUpdate = $state(false);
	let updateMessage = $state<string | null>(null);
	let showUpdatePromptModal = $state(false);
	let showRestartModal = $state(false);
	let pendingUpdateCheck = $state<{ has_update: boolean; current_version: string; message: string } | null>(null);
	let isInstallingUpdate = $state(false);

	async function fetchOmpVersion() {
		try {
			const ver: string = await invoke('get_omp_version');
			ompVersion = ver;
		} catch (e) {
			console.error("Failed to fetch OMP version", e);
		}
	}

	onMount(() => {
		fetchOmpVersion();
		studioUpdaterStore.init();
	});

	onDestroy(() => {
		studioUpdaterStore.destroy();
	});

	async function handleCheckUpdate() {
		if (isCheckingUpdate || isInstallingUpdate) return;
		isCheckingUpdate = true;
		updateMessage = 'Verifica...';
		try {
			const res: { has_update: boolean; current_version: string; message: string } = await invoke('check_omp_update');
			if (res.current_version && res.current_version !== 'unknown') {
				ompVersion = res.current_version;
			}
			if (res.has_update) {
				pendingUpdateCheck = res;
				updateMessage = 'Nuova versione!';
				showUpdatePromptModal = true;
			} else {
				updateMessage = 'OMP aggiornato ✓';
				setTimeout(() => { updateMessage = null; }, 3000);
			}
		} catch (e) {
			console.error("Update check failed", e);
			updateMessage = 'Errore verifica';
			setTimeout(() => { updateMessage = null; }, 3000);
		} finally {
			isCheckingUpdate = false;
		}
	}

	async function handlePerformUpdate() {
		showUpdatePromptModal = false;
		isInstallingUpdate = true;
		updateMessage = 'Installazione...';
		try {
			await invoke('run_omp_update');
			await fetchOmpVersion();
			updateMessage = 'Aggiornato!';
			showRestartModal = true;
		} catch (e) {
			console.error("Update failed", e);
			updateMessage = 'Errore aggiornamento';
			setTimeout(() => { updateMessage = null; }, 4000);
		} finally {
			isInstallingUpdate = false;
		}
	}

	function handleRestartApp() {
		window.location.reload();
	}
	const SPLIT = 6;
	const MIN_COL = 160;
	let columnsEl: HTMLElement;
	let leftWidth = $state(260);
	// 0 = non ancora misurata: il centro resta elastico finche' non si trascina.
	let centerWidth = $state(0);
	let dragging = $state(false);

	const gridTemplate = $derived(
		`${leftWidth}px ${SPLIT}px ${centerWidth > 0 ? `${centerWidth}px` : 'minmax(0, 1fr)'} ${SPLIT}px minmax(0, 1fr)`
	);

	const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

	function maxCenter() {
		return Math.max(MIN_COL, columnsEl.clientWidth - leftWidth - 2 * SPLIT - MIN_COL);
	}

	function startDrag(e: PointerEvent, which: 'left' | 'center') {
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		dragging = true;

		const startX = e.clientX;
		const startLeft = leftWidth;
		// Al primo trascinamento il centro va congelato alla larghezza reale,
		// altrimenti passerebbe da elastico a un valore arbitrario.
		const startCenter = centerWidth > 0
			? centerWidth
			: columnsEl.children[2].getBoundingClientRect().width;

		const onMove = (ev: PointerEvent) => {
			const dx = ev.clientX - startX;
			const total = columnsEl.clientWidth;
			if (which === 'left') {
				leftWidth = clamp(startLeft + dx, MIN_COL, total - 2 * SPLIT - 2 * MIN_COL);
				centerWidth = clamp(startCenter, MIN_COL, maxCenter());
			} else {
				centerWidth = clamp(startCenter + dx, MIN_COL, maxCenter());
			}
		};

		const onUp = () => {
			dragging = false;
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onUp);
			handle.removeEventListener('pointercancel', onUp);
		};

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp);
		handle.addEventListener('pointercancel', onUp);
	}

	function resetSplit(which: 'left' | 'center') {
		if (which === 'left') leftWidth = 260;
		else centerWidth = 0;
	}

	// Se la finestra si restringe, il centro fisso potrebbe schiacciare la
	// colonna destra a zero: va riclampato. Le misure degeneri (finestra
	// minimizzata o nascosta) vanno ignorate, altrimenti le colonne
	// resterebbero schiacciate al minimo dopo il ripristino.
	$effect(() => {
		const ro = new ResizeObserver(() => {
			const total = columnsEl.clientWidth;
			if (total < 3 * MIN_COL + 2 * SPLIT) return;
			leftWidth = clamp(leftWidth, MIN_COL, total - 2 * SPLIT - 2 * MIN_COL);
			if (centerWidth > 0) centerWidth = clamp(centerWidth, MIN_COL, maxCenter());
		});
		ro.observe(columnsEl);
		return () => ro.disconnect();
	});

	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.altKey) {
			if (e.key.toLowerCase() === 's') {
				e.preventDefault();
				projectStore.openScratchpad();
			} else if (e.key.toLowerCase() === 'n') {
				e.preventDefault();
				pickerOpen = true;
			} else if (e.key.toLowerCase() === 'u') {
				e.preventDefault();
				usageOpen = !usageOpen;
			} else if (e.key.toLowerCase() === 'm' || e.key === ',') {
				e.preventDefault();
				modelSettingsStore.openModal();
			} else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
				e.preventDefault();
				const projects = projectStore.projects;
				const idx = projects.findIndex(p => p.id === projectStore.activeId);
				if (idx !== -1 && projects.length > 1) {
					let nextIdx = e.key === 'ArrowRight' ? (idx + 1) % projects.length : (idx - 1 + projects.length) % projects.length;
					projectStore.setActive(projects[nextIdx].id);
				}
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app-layout">
	<TopBar
		onUsageClick={() => usageOpen = !usageOpen}
		onNewProject={() => pickerOpen = true}
		onModelsClick={() => modelSettingsStore.openModal()}
	/>
	<UsagePopover open={usageOpen} onClose={() => usageOpen = false} />
	<ProjectPicker open={pickerOpen} onClose={() => pickerOpen = false} />
	<ModelSettingsModal />

	<main class="columns" class:dragging bind:this={columnsEl} style:grid-template-columns={gridTemplate}>
		<aside class="col-left">
			<div class="col-header tabs-header">
				<button class:active={leftSection === 'files'} onclick={() => leftSection = 'files'}>FILE</button>
				<button class:active={leftSection === 'git'} onclick={() => leftSection = 'git'}>GIT</button>
				<button class:active={leftSection === 'sessions'} onclick={() => leftSection = 'sessions'}>SESSIONI</button>
			</div>
			<div class="col-content">
				{#if projectStore.activeProject}
					{@const proj = projectStore.activeProject}
					{#if proj.path === ''}
						<div style="padding: var(--space-2); color: var(--ink-faint);">
							Chat temporanea: nessuna cartella collegata
						</div>
					{:else if leftSection === 'files'}
						{#key proj.id}
							<FileTree
								projectPath={proj.path}
								name={proj.name}
								onFileSelect={(file) => projectStore.openFile(proj.id, file)}
							/>
						{/key}
					{:else if leftSection === 'git'}
						<GitPanel
							projectPath={proj.path}
							agentState={proj.agentState}
							onOpenWorkingDiff={(p) => handleGitPanelDiff(p, 'working')}
							onOpenCommitDiff={(p, hash) => handleGitPanelDiff(p, 'commit', hash)}
							onResumeSession={(sid) => handleResumeSession(proj.id, sid)}
						/>
					{:else}
						<SessionList projectPath={proj.path} />
					{/if}
				{/if}
			</div>
		</aside>

		<div
			class="splitter"
			role="separator"
			aria-orientation="vertical"
			aria-label="Ridimensiona pannello file"
			onpointerdown={(e) => startDrag(e, 'left')}
			ondblclick={() => resetSplit('left')}
		></div>

		<section class="col-center">
			<div class="col-header">{diagramOpen ? 'DIAGRAMMA' : previewFile ? 'ANTEPRIMA' : 'EDITOR'}</div>
			<div class="col-content fill" style="background: var(--bg-sunken); position: relative;">
				{#if projectStore.activeProject}
					{#if diagramOpen}
						<DiagramViewer
							projectPath={projectStore.activeProject.path}
							onClose={() => (diagramOpen = false)}
						/>
					{:else if previewFile}
						<PreviewViewer
							projectPath={projectStore.activeProject.path}
							filePath={previewFile}
							onClose={() => (previewFile = null)}
						/>
					{:else}
						<Editor
							projectPath={projectStore.activeProject.path}
							filePaths={projectStore.activeProject.openFiles}
							filePath={projectStore.activeProject.activeFile}
							openFileRequest={terminalOpenRequest?.projectId === projectStore.activeProject.id ? terminalOpenRequest : null}
							editorDiffRequest={editorDiffRequest}
							onPreviewRequest={(fp) => (previewFile = fp)}
							onFileSaved={() => {
								window.dispatchEvent(new CustomEvent('git-status-refresh'));
							}}
						/>
					{/if}
				{/if}
			</div>
		</section>

		<div
			class="splitter"
			role="separator"
			aria-orientation="vertical"
			aria-label="Ridimensiona editor"
			onpointerdown={(e) => startDrag(e, 'center')}
			ondblclick={() => resetSplit('center')}
		></div>

		<section class="col-right">
			<div class="col-header">TERMINAL</div>
			<div class="col-content fill" style="background: var(--bg-sunken); position: relative;">
				{#each projectStore.projects as p (p.id)}
					<Terminal
						cwd={p.path}
						visible={p.id === projectStore.activeId}
						sessionRef={(s) => {
							if (s) terminalSessions.set(p.id, s);
							else terminalSessions.delete(p.id);
						}}
						onStateChange={(s) => projectStore.setAgentState(p.id, s as any)}
						onOpenFile={(filePath, line) => handleTerminalOpenFile(p.id, filePath, line)}
					/>
				{/each}
			</div>
		</section>
	</main>

	<footer class="statusbar">
		<div class="statusbar-left">
			<span class="sb-label">Progetto:</span>
			<span class="sb-value">{projectStore.activeProject?.name || 'Nessuno'}</span>
		</div>
		<div class="statusbar-right">
			<button 
				class="version-btn"
				class:spinning={studioUpdaterStore.isChecking || studioUpdaterStore.isDownloading}
				onclick={() => {
					if (studioUpdaterStore.hasUpdate) {
						studioUpdaterStore.openModal();
					} else {
						studioUpdaterStore.checkUpdate(true);
					}
				}}
				title="Clicca per verificare aggiornamenti OMP Studio"
			>
				{studioUpdaterStore.currentVersion ? `Studio v${studioUpdaterStore.currentVersion}` : 'Studio'}
				{#if studioUpdaterStore.updateBadge}
					<span 
						class="update-chip" 
						class:warn={studioUpdaterStore.badgeType === 'warn'} 
						class:success={studioUpdaterStore.badgeType === 'success'} 
						class:error={studioUpdaterStore.badgeType === 'error'}
					>
						{studioUpdaterStore.updateBadge}
					</span>
				{/if}
			</button>
			<button 
				class="version-btn"
				class:spinning={isCheckingUpdate || isInstallingUpdate}
				onclick={handleCheckUpdate}
				title="Clicca per verificare aggiornamenti OMP CLI"
			>
				{ompVersion ? `OMP v${ompVersion}` : 'OMP'}
				{#if updateMessage}
					<span class="update-chip">{updateMessage}</span>
				{/if}
			</button>
			<div class="status-indicator" title="Stato agente: {projectStore.activeProject?.agentState || 'idle'}">
				<span class="status-led {projectStore.activeProject?.agentState || 'idle'}"></span>
				<span>Status: {projectStore.activeProject?.agentState || 'idle'}</span>
			</div>
		</div>
	</footer>

	{#if showUpdatePromptModal}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => showUpdatePromptModal = false}></div>
		<div class="modal-dialog">
			<div class="modal-header">
				<h3>🚀 Aggiornamento OMP Disponibile</h3>
			</div>
			<div class="modal-body">
				<p>È disponibile una nuova versione di OMP CLI.</p>
				<p class="modal-sub">Versione attualmente installata: <strong>v{ompVersion || 'sconosciuta'}</strong></p>
				{#if pendingUpdateCheck?.message}
					<pre class="update-log">{pendingUpdateCheck.message}</pre>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn btn-secondary" onclick={() => showUpdatePromptModal = false}>Annulla</button>
				<button class="btn btn-primary" onclick={handlePerformUpdate}>Scarica e Aggiorna</button>
			</div>
		</div>
	{/if}

	{#if showRestartModal}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => showRestartModal = false}></div>
		<div class="modal-dialog">
			<div class="modal-header">
				<h3>✅ Aggiornamento Completato!</h3>
			</div>
			<div class="modal-body">
				<p>L'aggiornamento di OMP è stato installato con successo.</p>
				<p>Per applicare le modifiche a tutti i terminali attivi dell'applicazione, è consigliato ricaricare l'interfaccia.</p>
			</div>
			<div class="modal-footer">
				<button class="btn btn-secondary" onclick={() => showRestartModal = false}>Chiudi</button>
				<button class="btn btn-primary" onclick={handleRestartApp}>Riavvia Applicazione</button>
			</div>
		</div>
	{/if}

	<StudioUpdateModal />
</div>

<style>
	.app-layout {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
	}

	.columns {
		display: grid;
		/* grid-template-columns arriva inline: left | splitter | center | splitter | right */
		flex: 1;
		min-height: 0;
		min-width: 0;
	}

	.columns.dragging {
		cursor: col-resize;
		user-select: none;
	}

	.col-left {
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
		min-width: 0;
		overflow: hidden;
	}

	/* Le colonne si separano per luminanza, non per riga: il pozzo scuro di
	   terminale ed editor contro la base della colonna file. Nessun bordo
	   verticale nel corpo dell'app. */
	.col-center,
	.col-right {
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		min-width: 0;
		overflow: hidden;
	}

	.col-header {
		height: 32px;
		padding: 0 var(--space-2);
		display: flex;
		align-items: center;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
		background: transparent;
		letter-spacing: 0.05em;
		z-index: var(--z-sticky);
	}

	.tabs-header {
		padding: 0;
		gap: 0;
	}

	.tabs-header button {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.05em;
		height: 100%;
		padding: 0 var(--space-3);
		cursor: pointer;
		border-bottom: 2px solid transparent;
	}

	.tabs-header button:hover {
		color: var(--ink-muted);
	}

	.tabs-header button.active {
		color: var(--ink);
		border-bottom-color: var(--brand);
	}

	.col-content {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		/* Le righe svaniscono passando sotto l'header invece di essere
		   tagliate da una linea. */
		-webkit-mask-image: linear-gradient(to bottom, transparent 0, black 10px);
		mask-image: linear-gradient(to bottom, transparent 0, black 10px);
	}

	/* Editor e terminale gestiscono il proprio scroll: uno scroll esterno
	   falserebbe le misure di fit/layout. */
	.col-content.fill {
		overflow: hidden;
		-webkit-mask-image: none;
		mask-image: none;
	}

	.splitter {
		/* La larghezza reale (6px) e' definita dal grid-template inline.
		   Invisibile a riposo: separano le superfici, non una riga. */
		background-color: transparent;
		cursor: col-resize;
		touch-action: none;
		z-index: var(--z-splitter);
	}

	.splitter:hover,
	.columns.dragging .splitter:active {
		background-image: linear-gradient(var(--brand), var(--brand));
		background-size: 1px 100%;
		background-position: center;
		background-repeat: no-repeat;
	}

	.statusbar {
		height: 26px;
		background-color: var(--bg-raised);
		/* Separata per luminanza dal pozzo, come la topbar. */
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		z-index: var(--z-sticky);
	}

	.statusbar-left, .statusbar-right {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.sb-label {
		color: var(--ink-faint);
	}
	.sb-value {
		color: var(--ink);
		font-weight: 500;
	}

	.version-btn {
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: all 0.15s ease;
	}

	.version-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.version-btn.spinning {
		opacity: 0.8;
	}

	.update-chip {
		font-size: 10px;
		padding: 1px 5px;
		border-radius: 99px;
		background: var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}

	.update-chip.warn {
		background: var(--warn, #f59e0b);
		color: #000;
	}

	.update-chip.success {
		background: var(--brand);
		color: var(--on-brand);
	}

	.update-chip.error {
		background: var(--danger, #ef4444);
		color: #fff;
	}

	.status-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 500;
		color: var(--ink-muted);
	}

	.status-led {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		display: inline-block;
		background-color: var(--ink-faint);
	}

	.status-led.working {
		background-color: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.status-led.attention {
		background-color: var(--warn);
	}

	.status-led.finished {
		background-color: var(--brand);
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-backdrop);
	}

	.modal-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 420px;
		max-width: 90vw;
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
	}

	.modal-body {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.modal-sub {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.update-log {
		max-height: 120px;
		overflow-y: auto;
		background: var(--bg-sunken);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--ink-faint);
		white-space: pre-wrap;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.btn {
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		transition: all 0.15s ease;
	}

	.btn-secondary {
		background: transparent;
		border-color: var(--line);
		color: var(--ink);
	}
	.btn-secondary:hover {
		background: var(--bg-hover);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}
	.btn-primary:hover {
		filter: brightness(1.1);
	}
</style>