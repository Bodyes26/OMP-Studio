<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		getEditorInstance,
		openFileModel,
		revealLineInEditor,
		getCurrentFileContent,
		createDiffEditorInstance,
		updateGutterDecorations
	} from './monaco';
	import ImageViewer from './ImageViewer.svelte';
	import { projectStore, joinProjectPath } from '$lib/stores/projects.svelte';
	import { invoke } from '@tauri-apps/api/core';

	let { projectPath, filePath, onFileSaved, openFileRequest } = $props<{
		projectPath: string;
		filePath: string | null;
		onFileSaved?: () => void;
		openFileRequest?: { filePath: string; line: number | null; id: number } | null;
	}>();

	let container = $state<HTMLElement>();
	let diffContainer = $state<HTMLElement>();
	let splitContainer = $state<HTMLElement>();

	let loadedKey: string | null = null;
	let handledOpenFileRequest = 0;
	let loading = $state(false);
	let isDirty = $state(false);
	let showDiff = $state(false);

	let initialContent = $state('');
	let gitHeadContent = $state<string | null>(null);
	let currentText = $state('');

	let decorationIds: string[] = [];
	let diffEditorInstance: any = null;
	let editor: any = null;

	let splitPercent = $state(50);
	let isResizing = $state(false);

	const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'ico'];

	let isImage = $derived(
		filePath ? IMAGE_EXTS.includes(filePath.split('.').pop()?.toLowerCase() || '') : false
	);
	let isSvg = $derived(
		filePath ? filePath.split('.').pop()?.toLowerCase() === 'svg' : false
	);
	let isMarkdown = $derived(
		filePath ? ['md', 'markdown'].includes(filePath.split('.').pop()?.toLowerCase() || '') : false
	);

	// Il div host non esiste al mount (senza file aperto si mostra l'empty
	// state) e cambia nodo quando si passa da/verso la vista split md/svg:
	// l'editor va quindi (ri)agganciato ogni volta che `container` cambia.
	let wiredContainer: HTMLElement | null = null;

	$effect(() => {
		const host = container;
		if (!host || host === wiredContainer) return;
		wiredContainer = host;

		editor = getEditorInstance(host);
		editor.addCommand(2048 | 49 /* Ctrl | S */, () => {
			saveCurrentFile();
		});

		// Aggiorna dirty state e marker git nel gutter a ogni modifica.
		editor.onDidChangeModelContent(() => {
			if (!filePath || !projectPath) return;
			const abs = joinProjectPath(projectPath, filePath);
			const val = getCurrentFileContent(abs) || '';
			currentText = val;
			isDirty = val !== initialContent;
			decorationIds = updateGutterDecorations(editor, gitHeadContent, val, decorationIds);
		});

		editor.layout();
	});

	onDestroy(() => {
		if (diffEditorInstance) {
			diffEditorInstance.dispose();
			diffEditorInstance = null;
		}
	});

	$effect(() => {
		if (!filePath || !projectPath) {
			loadedKey = null;
			return;
		}
		const key = `${projectPath}\u0000${filePath}`;
		if (key !== loadedKey) {
			showDiff = false;
			load(projectPath, filePath, key);
		}
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

		const key = `${projectPath}\u0000${filePath}`;
		if (loading || loadedKey !== key || !container) return;
		if (request.line !== null && !revealLineInEditor(request.line)) return;
		handledOpenFileRequest = request.id;
	});

	async function load(project: string, path: string, key: string) {
		if (IMAGE_EXTS.includes(path.split('.').pop()?.toLowerCase() || '')) {
			loadedKey = key;
			loading = false;
			return;
		}

		loading = true;
		isDirty = false;
		try {
			const res: { content: string } = await invoke('file_read', { projectPath: project, rel: path });
			initialContent = res.content;
			currentText = res.content;

			// Fetch Git HEAD content for diff & gutter margin markers
			try {
				const gitRes: { content: string, exists: boolean } = await invoke('file_git_head', { projectPath: project, rel: path });
				gitHeadContent = gitRes.exists ? gitRes.content : null;
			} catch (e) {
				gitHeadContent = null;
			}

			// Simple language detection
			let ext = path.split('.').pop()?.toLowerCase();
			let lang = 'plaintext';
			if (ext === 'ts' || ext === 'tsx') lang = 'typescript';
			if (ext === 'js' || ext === 'jsx') lang = 'javascript';
			if (ext === 'json' || ext === 'jsonc') lang = 'json';
			if (ext === 'css') lang = 'css';
			if (ext === 'html' || ext === 'aspx') lang = 'html';
			if (ext === 'svg') lang = 'html';
			if (ext === 'vb') lang = 'vb';
			if (ext === 'cs') lang = 'csharp';
			if (ext === 'md') lang = 'markdown';
			if (ext === 'rs') lang = 'rust';

			openFileModel(joinProjectPath(project, path), res.content, lang);
			loadedKey = key;

			if (editor) {
				decorationIds = updateGutterDecorations(editor, gitHeadContent, res.content, decorationIds);
				setTimeout(() => editor.layout(), 10);
			}
		} catch (e) {
			console.error("Failed to load file", e);
		} finally {
			loading = false;
		}
	}

	async function saveCurrentFile() {
		if (!loadedKey || !filePath || !projectPath) return;
		const abs = joinProjectPath(projectPath, filePath);
		const content = getCurrentFileContent(abs);
		if (content === null) return;
		try {
			await invoke('file_write', { projectPath, rel: filePath, content });
			initialContent = content;
			isDirty = false;
			if (editor) {
				decorationIds = updateGutterDecorations(editor, gitHeadContent, content, decorationIds);
			}
			if (onFileSaved) onFileSaved();
		} catch (e) {
			console.error("Save failed", e);
		}
	}

	function closeFile() {
		if (projectStore.activeId) {
			projectStore.setActiveFile(projectStore.activeId, null);
		}
	}

	function toggleGitDiff() {
		showDiff = !showDiff;
		if (showDiff) {
			setTimeout(() => {
				if (!diffContainer) return;
				if (diffEditorInstance) diffEditorInstance.dispose();
				let ext = filePath?.split('.').pop()?.toLowerCase() || '';
				let lang = 'plaintext';
				if (ext === 'ts' || ext === 'tsx') lang = 'typescript';
				if (ext === 'js' || ext === 'jsx') lang = 'javascript';
				if (ext === 'json') lang = 'json';
				if (ext === 'css') lang = 'css';
				if (ext === 'html' || ext === 'aspx' || ext === 'svg') lang = 'html';
				if (ext === 'cs') lang = 'csharp';

				diffEditorInstance = createDiffEditorInstance(
					diffContainer,
					gitHeadContent ?? '',
					currentText,
					lang
				);
			}, 20);
		}
	}

	function startResize(e: MouseEvent) {
		e.preventDefault();
		isResizing = true;
		window.addEventListener('mousemove', handleResize);
		window.addEventListener('mouseup', stopResize);
	}

	function handleResize(e: MouseEvent) {
		if (!isResizing || !splitContainer) return;
		const rect = splitContainer.getBoundingClientRect();
		const relativeY = e.clientY - rect.top;
		const newPercent = (relativeY / rect.height) * 100;
		splitPercent = Math.max(20, Math.min(80, newPercent));
		if (editor) editor.layout();
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
	{#if filePath}
		<div class="editor-header">
			<div class="header-left">
				<span class="file-path" title={filePath}>{filePath}</span>
				{#if isDirty}
					<span class="dirty-dot" title="Modifiche non salvate">•</span>
				{/if}
			</div>
			<div class="header-actions">
				{#if isDirty && !isImage}
					<button class="action-btn save-btn" onclick={saveCurrentFile} title="Salva modifiche (Ctrl+S)">
						💾 Salva
					</button>
				{/if}
				{#if !isImage}
					<button class="action-btn" class:active={showDiff} onclick={toggleGitDiff} title="Visualizza Git Diff">
						🔀 Diff
					</button>
				{/if}
				<button class="action-btn close-btn" onclick={closeFile} title="Chiudi file">
					✕
				</button>
			</div>
		</div>
	{/if}

	<div class="editor-body">
		{#if loading}
			<div class="loading-overlay">Caricamento in corso...</div>
		{/if}

		{#if !filePath}
			<div class="empty-state">
				<div class="empty-text">Seleziona un file dall'albero per modificarlo</div>
				<div class="empty-hint">Ctrl+S per salvare le modifiche</div>
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
		height: 34px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-3);
		font-size: var(--text-xs);
		z-index: 10;
		flex-shrink: 0;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		overflow: hidden;
	}

	.file-path {
		font-family: var(--font-mono);
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}

	.dirty-dot {
		color: var(--warn);
		font-size: 16px;
		line-height: 1;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.action-btn {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		padding: 2px 8px;
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 4px;
		transition: all 0.15s ease;
	}

	.action-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.action-btn.active {
		background: var(--brand);
		color: var(--on-brand);
		border-color: var(--brand);
	}

	.action-btn.save-btn {
		background: var(--brand);
		color: var(--on-brand);
		border-color: var(--brand);
		font-weight: 600;
	}

	.action-btn.close-btn:hover {
		background: oklch(0.45 0.18 25);
		color: white;
		border-color: oklch(0.45 0.18 25);
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
		z-index: 5;
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
		z-index: 10;
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
