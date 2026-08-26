<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		disposeFileModel,
		getCurrentFileContent,
		getEditorInstance,
		openFileModel,
		revealLineInEditor,
		createDiffEditorInstance,
		updateGutterDecorations,
		applyEditorSettings
	} from './monaco';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import ImageViewer from './ImageViewer.svelte';
	import { projectStore, joinProjectPath } from '$lib/stores/projects.svelte';
	import { invoke } from '@tauri-apps/api/core';

	let { projectPath, filePaths, filePath, onFileSaved, openFileRequest, editorDiffRequest, onPreviewRequest } = $props<{
		projectPath: string;
		filePaths: string[];
		filePath: string | null;
		onFileSaved?: () => void;
		openFileRequest?: { filePath: string; line: number | null; id: number } | null;
		editorDiffRequest?: {
			filePath: string;
			mode: 'working' | 'commit';
			hash?: string;
			id: number;
		} | null;
		onPreviewRequest?: (filePath: string) => void;
	}>();

	function isHtmlFile(path: string): boolean {
		return ['html', 'htm'].includes(path.split('.').pop()?.toLowerCase() || '');
	}

	interface FileState {
		initialContent: string;
		gitHeadContent: string | null;
		currentText: string;
		decorationIds: string[];
	}

	const fileStates = new Map<string, FileState>();
	const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'ico'];

	let container = $state<HTMLElement>();
	let diffContainer = $state<HTMLElement>();
	let splitContainer = $state<HTMLElement>();
	let dirtyFiles = $state<Record<string, boolean>>({});
	let loadedKey: string | null = null;
	let requestedKey: string | null = null;
	let handledOpenFileRequest = 0;
	let pendingDiffFile: string | null = null;
	let handledEditorDiffRequest = 0;
	// Contenuto "prima" e "dopo" del diff attivo: working = HEAD vs disco,
	// commit = hash~1 vs hash. Null quando il diff non e' di tipo commit.
	let diffOriginalOverride: string | null = null;
	let diffModifiedOverride: string | null = null;
	let loading = $state(false);
	let showDiff = $state(false);

	let initialContent = '';
	let gitHeadContent: string | null = null;
	let currentText = $state('');
	let diffEditorInstance: any = null;
	let editor: any = null;

	let splitPercent = $state(50);
	let isResizing = $state(false);

	let isDirty = $derived(filePath ? dirtyFiles[fileKey(projectPath, filePath)] === true : false);
	let isImage = $derived(filePath ? isImageFile(filePath) : false);
	let isSvg = $derived(filePath ? filePath.split('.').pop()?.toLowerCase() === 'svg' : false);
	let isMarkdown = $derived(filePath ? ['md', 'markdown'].includes(filePath.split('.').pop()?.toLowerCase() || '') : false);

	let commandsBound = false;

	function fileKey(project: string, path: string): string {
		return `${project}\u0000${path}`;
	}

	function isImageFile(path: string): boolean {
		return IMAGE_EXTS.includes(path.split('.').pop()?.toLowerCase() || '');
	}

	function fileName(path: string): string {
		return path.split(/[\\/]/).pop() || path;
	}

	function languageFor(path: string): string {
		const ext = path.split('.').pop()?.toLowerCase();
		if (ext === 'sql') return 'sql';
		if (ext === 'ts' || ext === 'tsx') return 'typescript';
		if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript';
		if (ext === 'json' || ext === 'jsonc') return 'json';
		if (ext === 'css') return 'css';
		if (ext === 'scss') return 'scss';
		if (ext === 'less') return 'less';
		if (ext === 'html' || ext === 'aspx' || ext === 'ascx' || ext === 'ashx' || ext === 'svg') return 'html';
		if (ext === 'xml' || ext === 'config' || ext === 'csproj' || ext === 'vbproj' || ext === 'props' || ext === 'targets' || ext === 'resx' || ext === 'xaml') return 'xml';
		if (ext === 'vb') return 'vb';
		if (ext === 'cs') return 'csharp';
		if (ext === 'md' || ext === 'markdown') return 'markdown';
		if (ext === 'rs') return 'rust';
		if (ext === 'py') return 'python';
		if (ext === 'yaml' || ext === 'yml') return 'yaml';
		if (ext === 'toml' || ext === 'ini') return 'ini';
		if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'shell';
		if (ext === 'ps1' || ext === 'psm1') return 'powershell';
		if (ext === 'bat' || ext === 'cmd') return 'bat';
		return 'plaintext';
	}

	function setDirty(key: string, value: boolean) {
		if (dirtyFiles[key] === value) return;
		dirtyFiles = { ...dirtyFiles, [key]: value };
	}

	function clearDirty(key: string) {
		if (!(key in dirtyFiles)) return;
		const { [key]: _, ...remaining } = dirtyFiles;
		dirtyFiles = remaining;
	}

	function disposeDiff() {
		if (!diffEditorInstance) return;
		const models = diffEditorInstance.getModel?.();
		diffEditorInstance.dispose();
		models?.original?.dispose();
		models?.modified?.dispose();
		diffEditorInstance = null;
	}

	function activateLoadedFile(project: string, path: string, key: string, state: FileState) {
		loadedKey = key;
		initialContent = state.initialContent;
		gitHeadContent = state.gitHeadContent;
		openFileModel(joinProjectPath(project, path), state.initialContent, languageFor(path));

		const content = getCurrentFileContent(joinProjectPath(project, path)) ?? state.currentText;
		state.currentText = content;
		currentText = content;
		setDirty(key, content !== state.initialContent);

		if (editor) {
			state.decorationIds = updateGutterDecorations(
				editor,
				state.gitHeadContent,
				content,
				state.decorationIds
			);
			setTimeout(() => editor?.layout(), 10);
		}

		if (pendingDiffFile === path) {
			pendingDiffFile = null;
			toggleGitDiff();
		}
	}

	async function load(project: string, path: string, key: string) {
		const cached = fileStates.get(key);
		if (cached) {
			activateLoadedFile(project, path, key, cached);
			return;
		}

		loading = true;
		try {
			const res: { content: string } = await invoke('file_read', { projectPath: project, rel: path });
			let headContent: string | null = null;
			try {
				const gitRes: { content: string; exists: boolean } = await invoke('file_git_head', {
					projectPath: project,
					rel: path
				});
				headContent = gitRes.exists ? gitRes.content : null;
			} catch {
				// Un file fuori da Git non ha un originale per diff e gutter.
			}

			const state: FileState = {
				initialContent: res.content,
				gitHeadContent: headContent,
				currentText: res.content,
				decorationIds: []
			};
			fileStates.set(key, state);
			if (requestedKey === key) activateLoadedFile(project, path, key, state);
		} catch (error) {
			console.error('Failed to load file', error);
		} finally {
			if (requestedKey === key) loading = false;
		}
	}

	async function openCommitDiff(path: string, hash: string) {
		pendingDiffFile = path;
		if (path !== filePath) selectFile(path);
		try {
			const rev = (r: string) =>
				invoke<{ content: string; exists: boolean }>('file_git_rev', { projectPath, rel: path, rev: r });
			const [oldRes, newRes] = await Promise.all([rev(`${hash}~1`), rev(hash)]);
			diffOriginalOverride = oldRes.exists ? oldRes.content : '';
			diffModifiedOverride = newRes.exists ? newRes.content : '';
			if (pendingDiffFile === path && path === filePath) {
				pendingDiffFile = null;
				showDiff = true;
			}
		} catch (e) {
			console.error('Failed to load commit diff', e);
			pendingDiffFile = null;
		}
	}

	// Il pannello GIT chiede un diff: working usa HEAD vs disco (override a
	// null), commit usa le due revisioni scaricate da git.
	$effect(() => {
		const req = editorDiffRequest;
		if (!req || req.id === handledEditorDiffRequest || !projectPath) return;
		handledEditorDiffRequest = req.id;
		if (req.mode === 'commit' && req.hash) {
			void openCommitDiff(req.filePath, req.hash);
		} else {
			diffOriginalOverride = null;
			diffModifiedOverride = null;
			pendingDiffFile = req.filePath;
			if (req.filePath === filePath) {
				pendingDiffFile = null;
				showDiff = true;
			}
		}
	});

	$effect(() => {
		const path = filePath;
		const project = projectPath;
		disposeDiff();
		showDiff = false;

		if (!path || !project) {
			loadedKey = null;
			requestedKey = null;
			loading = false;
			return;
		}

		const key = fileKey(project, path);
		requestedKey = key;
		if (isImageFile(path)) {
			loadedKey = key;
			loading = false;
			return;
		}

		void load(project, path, key);
	});

	$effect(() => {
		const host = container;
		if (!host) return;

		editor = getEditorInstance(host);
		const disposables: { dispose: () => void }[] = [];

		if (!commandsBound) {
			commandsBound = true;
			editor.addCommand(2048 | 49 /* Ctrl | S */, () => {
				void saveCurrentFile();
			});
			editor.addCommand(2048 | 53 /* Ctrl | W */, () => {
				closeFile();
			});
			editor.addCommand(2048 | 62 /* Ctrl | F4 */, () => {
				closeFile();
			});
		}

		const changeListener = editor.onDidChangeModelContent(() => {
			if (!filePath || !projectPath || !loadedKey) return;
			const state = fileStates.get(loadedKey);
			if (!state) return;
			const abs = joinProjectPath(projectPath, filePath);
			const value = getCurrentFileContent(abs) ?? '';
			state.currentText = value;
			currentText = value;
			setDirty(loadedKey, value !== state.initialContent);
			state.decorationIds = updateGutterDecorations(
				editor,
				state.gitHeadContent,
				value,
				state.decorationIds
			);
		});
		if (changeListener && typeof changeListener.dispose === 'function') {
			disposables.push(changeListener);
		}

		editor.layout();

		return () => {
			for (const d of disposables) {
				d.dispose();
			}
		};
	});

	// Le preferenze dell'editor si applicano a caldo: leggere i singoli campi
	// (non l'oggetto) evita di rieseguire l'effetto per scritture che non
	// riguardano l'editor (es. terminale). Mai ricreare l'istanza per un
	// cambio di impostazione.
	$effect(() => {
		void settingsStore.editor.fontSize;
		void settingsStore.editor.fontFamily;
		void settingsStore.editor.minimap;
		void settingsStore.editor.wordWrap;
		void settingsStore.editor.tabSize;
		void settingsStore.editor.lineNumbers;
		applyEditorSettings(diffEditorInstance);
	});

	// Il modello arriva dal filesystem in asincrono: il cursore va mosso solo
	// dopo il suo caricamento, anche quando il file era gia aperto.
	$effect(() => {
		const request = openFileRequest;
		if (
			!request ||
			request.id === handledOpenFileRequest ||
			request.filePath !== filePath ||
			!projectPath
		) return;

		if (showDiff) {
			showDiff = false;
			return;
		}
		if (isImage) {
			handledOpenFileRequest = request.id;
			return;
		}

		const key = fileKey(projectPath, filePath);
		if (loading || loadedKey !== key || !container) return;
		if (request.line !== null && !revealLineInEditor(request.line)) return;
		handledOpenFileRequest = request.id;
	});

	onDestroy(() => {
		disposeDiff();
		stopResize();
	});

	async function saveCurrentFile() {
		if (!loadedKey || !filePath || !projectPath || isImage) return;
		const abs = joinProjectPath(projectPath, filePath);
		const content = getCurrentFileContent(abs);
		const state = fileStates.get(loadedKey);
		if (content === null || !state) return;
		try {
			await invoke('file_write', { projectPath, rel: filePath, content });
			state.initialContent = content;
			state.currentText = content;
			initialContent = content;
			currentText = content;
			setDirty(loadedKey, false);
			if (editor) {
				state.decorationIds = updateGutterDecorations(
					editor,
					state.gitHeadContent,
					content,
					state.decorationIds
				);
			}
			onFileSaved?.();
		} catch (error) {
			console.error('Save failed', error);
		}
	}

	function selectFile(path: string) {
		if (projectStore.activeId) projectStore.openFile(projectStore.activeId, path);
	}

	function closeFile(path = filePath) {
		if (!path || !projectPath || !projectStore.activeId) return;
		const key = fileKey(projectPath, path);
		if (path === filePath) {
			disposeDiff();
			showDiff = false;
		}
		fileStates.delete(key);
		clearDirty(key);
		disposeFileModel(joinProjectPath(projectPath, path));
		projectStore.closeFile(projectStore.activeId, path);
	}

	function openDiff(path: string) {
		if (isImageFile(path)) return;
		if (path === filePath) {
			toggleGitDiff();
			return;
		}
		pendingDiffFile = path;
		selectFile(path);
	}

	function toggleGitDiff() {
		if (isImage || !filePath) return;
		showDiff = !showDiff;
		if (!showDiff) {
			disposeDiff();
			return;
		}

	setTimeout(() => {
		if (!diffContainer) return;
		disposeDiff();
		const original = diffOriginalOverride ?? gitHeadContent ?? '';
		const modified = diffModifiedOverride ?? currentText;
		diffEditorInstance = createDiffEditorInstance(
			diffContainer,
			original,
			modified,
			languageFor(filePath!)
		);
	}, 20);
	}

	function startResize(event: MouseEvent) {
		event.preventDefault();
		isResizing = true;
		window.addEventListener('mousemove', handleResize);
		window.addEventListener('mouseup', stopResize);
	}

	function handleResize(event: MouseEvent) {
		if (!isResizing || !splitContainer) return;
		const rect = splitContainer.getBoundingClientRect();
		const relativeY = event.clientY - rect.top;
		const newPercent = (relativeY / rect.height) * 100;
		splitPercent = Math.max(20, Math.min(80, newPercent));
		editor?.layout();
	}

	function stopResize() {
		isResizing = false;
		window.removeEventListener('mousemove', handleResize);
		window.removeEventListener('mouseup', stopResize);
	}

	function renderMarkdown(md: string): string {
		if (!md) return '';
		return md
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/^### (.*$)/gim, '<h3>$1</h3>')
			.replace(/^## (.*$)/gim, '<h2>$1</h2>')
			.replace(/^# (.*$)/gim, '<h1>$1</h1>')
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.*?)\*/g, '<em>$1</em>')
			.replace(/`(.*?)`/g, '<code>$1</code>')
			.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>')
			.replace(/\n\n/g, '<br/><br/>');
	}
</script>

<div class="editor-wrapper">
	{#if filePaths.length > 0}
		<div class="editor-header">
			<div class="editor-tabs" role="group" aria-label="File aperti">
				{#each filePaths as path (path)}
					{@const isActive = path === filePath}
					<div class="editor-tab" class:active={isActive}>
						<button
							class="editor-tab-file"
							aria-pressed={isActive}
							title={path}
							onclick={() => selectFile(path)}
						>
							<span>{fileName(path)}</span>
							{#if dirtyFiles[fileKey(projectPath, path)]}
								<span class="dirty-dot" title="Modifiche non salvate">•</span>
							{/if}
						</button>
						{#if !isImageFile(path)}
							<button
								class="editor-tab-action"
								class:active={isActive && showDiff}
								onclick={(event) => { event.stopPropagation(); openDiff(path); }}
								title="Visualizza Git Diff"
								aria-label="Visualizza Git Diff di {fileName(path)}"
							>Diff</button>
						{/if}
						<button
							class="editor-tab-action close-tab"
							onclick={(event) => { event.stopPropagation(); closeFile(path); }}
							title="Chiudi file (Ctrl+W o Ctrl+F4)"
							aria-label="Chiudi {fileName(path)}"
						>×</button>
					</div>
				{/each}
			</div>
			{#if filePath && isHtmlFile(filePath)}
				<button
					class="action-btn"
					onclick={() => onPreviewRequest?.(filePath)}
					title="Apri anteprima live in sandbox"
				>
					Anteprima
				</button>
			{/if}
			{#if isDirty && !isImage}
				<button class="action-btn save-btn" onclick={() => void saveCurrentFile()} title="Salva modifiche (Ctrl+S)">
					Salva
				</button>
			{/if}
		</div>
	{/if}

	<div class="editor-body">
		{#if loading}
			<div class="loading-overlay">Caricamento in corso...</div>
		{/if}

		{#if !filePath}
			<div class="empty-state">
				<div class="empty-text">Seleziona un file dall'albero per modificarlo</div>
				<div class="empty-hint">Ctrl+S salva · Ctrl+W o Ctrl+F4 chiude il file</div>
			</div>
		{:else if isImage}
			<ImageViewer projectPath={projectPath} filePath={filePath} />
		{:else if showDiff}
			<div class="diff-wrapper" bind:this={diffContainer}></div>
		{:else if isSvg || isMarkdown}
			<div class="split-container" bind:this={splitContainer}>
				<div class="split-top" style="height: {splitPercent}%;">
					<div class="monaco-host" bind:this={container}></div>
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="splitter-bar" onmousedown={startResize} title="Trascina per ridimensionare">
					<div class="splitter-line"></div>
				</div>
				<div class="split-bottom" style="height: {100 - splitPercent}%;">
					{#if isSvg}
						<div class="preview-header">Anteprima SVG Live</div>
						<div class="svg-preview-viewport">
							{@html currentText}
						</div>
					{:else if isMarkdown}
						<div class="preview-header">Anteprima Markdown Live</div>
						<div class="markdown-preview-viewport">
							{@html renderMarkdown(currentText)}
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<div class="monaco-host" bind:this={container}></div>
		{/if}
	</div>
</div>

<style>
	.editor-wrapper {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		position: relative;
	}

	.editor-header {
		min-height: 34px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: stretch;
		gap: var(--space-1);
		padding: 0 var(--space-1);
		font-size: var(--text-xs);
		z-index: var(--z-sticky);
		flex-shrink: 0;
	}

	.editor-tabs {
		display: flex;
		align-items: stretch;
		min-width: 0;
		flex: 1;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.editor-tab {
		display: flex;
		align-items: center;
		min-width: 0;
		color: var(--ink-muted);
	}

	.editor-tab.active {
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.editor-tab-file {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		max-width: 180px;
		height: 100%;
		padding: 0 var(--space-2);
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		font: inherit;
		overflow: hidden;
		white-space: nowrap;
	}

	.editor-tab-file > span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.editor-tab-file:hover,
	.editor-tab-action:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.dirty-dot {
		color: var(--warn);
		font-size: 14px;
		line-height: 1;
		flex: none;
	}

	.editor-tab-action {
		height: 22px;
		padding: 0 var(--space-1);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: inherit;
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
	}

	.editor-tab-action.active {
		background: var(--bg-active);
		color: var(--ink);
	}

	.close-tab {
		font-size: 16px;
		line-height: 1;
	}

	.action-btn {
		align-self: center;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		padding: 2px 8px;
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		flex: none;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.action-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.action-btn.save-btn {
		background: var(--brand);
		color: var(--on-brand);
		border-color: var(--brand);
		font-weight: 600;
	}

	.editor-body {
		flex: 1;
		width: 100%;
		position: relative;
		overflow: hidden;
	}

	.monaco-host, .diff-wrapper {
		width: 100%;
		height: 100%;
	}

	.split-container {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.split-top {
		width: 100%;
		position: relative;
		overflow: hidden;
	}

	.splitter-bar {
		height: 6px;
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		cursor: ns-resize;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-splitter);
		flex-shrink: 0;
	}

	.splitter-bar:hover {
		background: var(--brand);
	}

	.splitter-line {
		width: 32px;
		height: 2px;
		background: var(--line-strong);
		border-radius: 1px;
	}

	.split-bottom {
		width: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
		overflow: hidden;
	}

	.preview-header {
		height: 24px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		padding: 0 var(--space-3);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink-faint);
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.svg-preview-viewport {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		overflow: auto;
		/* Scacchiera di trasparenza: quadri traslucidi sopra il pozzo, cosi'
		   seguono la superficie invece di essere due grigi fissi. */
		--checker: color-mix(in srgb, var(--ink) 5%, transparent);
		background-color: var(--bg-sunken);
		background-image:
			linear-gradient(45deg, var(--checker) 25%, transparent 25%),
			linear-gradient(-45deg, var(--checker) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--checker) 75%),
			linear-gradient(-45deg, transparent 75%, var(--checker) 75%);
		background-size: 16px 16px;
	}

	.markdown-preview-viewport {
		flex: 1;
		padding: var(--space-4);
		overflow-y: auto;
		color: var(--ink);
		font-family: var(--font-ui);
		line-height: 1.6;
		font-size: var(--text-base);
	}

	.markdown-preview-viewport :global(h1),
	.markdown-preview-viewport :global(h2),
	.markdown-preview-viewport :global(h3) {
		border-bottom: 1px solid var(--line);
		padding-bottom: var(--space-1);
		margin-top: var(--space-3);
		margin-bottom: var(--space-2);
		color: var(--ink);
	}

	.markdown-preview-viewport :global(code) {
		background: var(--bg-sunken);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.loading-overlay, .empty-state {
		position: absolute;
		top: 0; left: 0; right: 0; bottom: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: var(--bg-sunken);
		z-index: var(--z-splitter);
	}

	.empty-text {
		color: var(--ink-faint);
		font-size: var(--text-md);
		margin-bottom: var(--space-2);
	}

	.empty-hint {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
	}
</style>
