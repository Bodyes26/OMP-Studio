<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as monaco from 'monaco-editor';
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
	import SvgPreview from './SvgPreview.svelte';
	import Markdown from '$lib/agent/components/Markdown.svelte';
	import { lexMarkdown } from '$lib/agent/markdown';
	import { projectStore, joinProjectPath, isWindows } from '$lib/stores/projects.svelte';
	import { IS_MAC, REVEAL_LABEL } from '$lib/utils/platform';
	import { invoke } from '@tauri-apps/api/core';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { contextMenu, type ContextMenuEntry } from '$lib/contextMenu.svelte';
	import {
		IconChevronLeft,
		IconChevronRight,
		IconClose,
		IconCloseOthers,
		IconCopy,
		IconCut,
		IconDiff,
		IconFolderOpen,
		IconPaste,
		IconRedo,
		IconSave,
		IconSelectAll,
		IconUndo,
		IconViewCode,
		IconViewPreview,
		IconViewSplit
	} from '$lib/icons';

	let {
		projectPath,
		filePaths,
		filePath,
		onFileSaved,
		openFileRequest,
		editorDiffRequest,
		onPreviewRequest,
		onDirtyFilesChange
	} = $props<{
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
		onDirtyFilesChange?: (paths: string[]) => void;
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

	/** `code` mostra solo Monaco, `split` Monaco piu' anteprima, `preview` solo
	 *  l'anteprima. Vale solo per i tipi con anteprima (markdown, SVG). */
	type ViewMode = 'code' | 'split' | 'preview';

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

	// Vista scelta per file: la chiave e' fileKey, non il path, cosi' due
	// progetti con lo stesso file relativo non si sovrascrivono la scelta.
	// Vive fuori da FileState perche' sopravvive al caricamento e serve anche
	// prima che il contenuto sia arrivato.
	let viewModes = $state<Record<string, ViewMode>>({});
	let tabsTrackEl = $state<HTMLElement | null>(null);
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);
	let draggedTabPath = $state<string | null>(null);
	let dragOverTabPath = $state<string | null>(null);
	// La linea di inserimento sta dal lato verso cui la scheda si muove:
	// `moveFile` inserisce dopo il bersaglio quando lo si trascina in avanti.
	let dragOverAfter = $state(false);

	let previewCapable = $derived(isSvg || isMarkdown);
	let viewMode = $derived.by<ViewMode>(() => {
		if (!filePath || !previewCapable) return 'code';
		return viewModes[fileKey(projectPath, filePath)] ?? 'split';
	});
	let markdownTokens = $derived(isMarkdown && viewMode !== 'code' ? lexMarkdown(currentText) : []);

	let currentProjectDirtyPaths = $derived.by(() => {
		if (!projectPath) return [];
		const prefix = `${projectPath}\u0000`;
		const paths: string[] = [];
		for (const [key, dirty] of Object.entries(dirtyFiles)) {
			if (dirty && key.startsWith(prefix)) {
				paths.push(key.slice(prefix.length));
			}
		}
		return paths;
	});

	$effect(() => {
		const paths = currentProjectDirtyPaths;
		onDirtyFilesChange?.(paths);
	});

	const knownFilesByProject = new Map<string, Set<string>>();

	$effect(() => {
		const currentProject = projectPath;
		const currentPaths = filePaths;
		if (!currentProject) return;

		const currentSet = new Set<string>(currentPaths);
		const prefix = `${currentProject}\u0000`;

		// Smaltisce fileState, vista e modelli Monaco dei file di questo progetto non piu' in filePaths
		for (const key of Array.from(fileStates.keys())) {
			if (key.startsWith(prefix)) {
				const path = key.slice(prefix.length);
				if (!currentSet.has(path)) {
					fileStates.delete(key);
					clearDirty(key);
					clearViewMode(key);
					disposeFileModel(joinProjectPath(currentProject, path));
				}
			}
		}

		const prev = knownFilesByProject.get(currentProject);
		if (prev) {
			for (const oldFile of prev) {
				if (!currentSet.has(oldFile)) {
					disposeFileModel(joinProjectPath(currentProject, oldFile));
				}
			}
		}
		knownFilesByProject.set(currentProject, currentSet);
	});

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

	function clearViewMode(key: string) {
		if (!(key in viewModes)) return;
		const { [key]: _, ...remaining } = viewModes;
		viewModes = remaining;
	}

	function setViewMode(mode: ViewMode) {
		if (!filePath || !previewCapable) return;
		// Anteprima e diff occupano lo stesso spazio: scegliere una vista
		// chiude il diff, invece di lasciare due modi attivi insieme.
		if (showDiff) {
			showDiff = false;
			disposeDiff();
		}
		viewModes = { ...viewModes, [fileKey(projectPath, filePath)]: mode };
	}

	const VIEW_CYCLE: ViewMode[] = ['split', 'preview', 'code'];

	function cycleViewMode() {
		if (!filePath || !previewCapable) return;
		const next = VIEW_CYCLE[(VIEW_CYCLE.indexOf(viewMode) + 1) % VIEW_CYCLE.length];
		setViewMode(next);
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
			showDiff = true;
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

		// Nessun `addCommand` qui: Monaco viene ricreato quando cambia il
		// contenitore DOM (split <-> non split), quindi comandi agganciati
		// all'istanza sparirebbero senza preavviso. Le scorciatoie stanno tutte
		// nell'handler di finestra, che vale anche fuori dall'area di testo.

		const ctxListener = editor.onContextMenu((e: any) => {
			handleEditorContextMenu(e.event.browserEvent, editor);
		});
		if (ctxListener && typeof ctxListener.dispose === 'function') {
			disposables.push(ctxListener);
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

	$effect(() => {
		const host = diffContainer;
		if (!host || !showDiff || !filePath) return;
		disposeDiff();
		const original = diffOriginalOverride ?? gitHeadContent ?? '';
		const modified = diffModifiedOverride ?? currentText;
		const diffInst = createDiffEditorInstance(
			host,
			original,
			modified,
			languageFor(filePath)
		);
		diffEditorInstance = diffInst;

		const disposables: { dispose: () => void }[] = [];
		const origListener = diffInst.getOriginalEditor().onContextMenu((e: any) => {
			handleEditorContextMenu(e.event.browserEvent, diffInst.getOriginalEditor());
		});
		if (origListener && typeof origListener.dispose === 'function') {
			disposables.push(origListener);
		}

		const modListener = diffInst.getModifiedEditor().onContextMenu((e: any) => {
			handleEditorContextMenu(e.event.browserEvent, diffInst.getModifiedEditor());
		});
		if (modListener && typeof modListener.dispose === 'function') {
			disposables.push(modListener);
		}

		return () => {
			for (const d of disposables) {
				d.dispose();
			}
			disposeDiff();
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

	async function saveFileByPath(targetPath: string) {
		if (!targetPath || !projectPath || isImageFile(targetPath)) return;
		const key = fileKey(projectPath, targetPath);
		const abs = joinProjectPath(projectPath, targetPath);
		const state = fileStates.get(key);
		const content = getCurrentFileContent(abs) ?? state?.currentText;
		if (content === null || content === undefined) return;
		try {
			await invoke('file_write', { projectPath, rel: targetPath, content });
			if (state) {
				state.initialContent = content;
				state.currentText = content;
			}
			if (targetPath === filePath) {
				initialContent = content;
				currentText = content;
			}
			setDirty(key, false);
			if (targetPath === filePath && editor && state) {
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

	async function saveCurrentFile() {
		if (!filePath) return;
		await saveFileByPath(filePath);
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
		clearViewMode(key);
		disposeFileModel(joinProjectPath(projectPath, path));
		projectStore.closeFile(projectStore.activeId, path);
	}

	function closeOtherFiles(keepPath: string) {
		if (!projectPath || !projectStore.activeId) return;
		for (const p of filePaths) {
			if (p !== keepPath) {
				const key = fileKey(projectPath, p);
				fileStates.delete(key);
				clearDirty(key);
				clearViewMode(key);
				disposeFileModel(joinProjectPath(projectPath, p));
			}
		}
		projectStore.closeOtherFiles(projectStore.activeId, keepPath);
	}

	function closeAllFiles() {
		if (!projectPath || !projectStore.activeId) return;
		disposeDiff();
		showDiff = false;
		for (const p of filePaths) {
			const key = fileKey(projectPath, p);
			fileStates.delete(key);
			clearDirty(key);
			clearViewMode(key);
			disposeFileModel(joinProjectPath(projectPath, p));
		}
		projectStore.closeAllFiles(projectStore.activeId);
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
		}
	}

	/** Un `keydown` in cattura sulla finestra: l'unico posto dove vivono le
	 *  scorciatoie dell'editor. Escluso il terminale, dove Ctrl+W cancella la
	 *  parola nella shell, e i campi di testo dell'app - ma non l'area di
	 *  input di Monaco, che e' l'editor stesso. */
	function isInsideEditorSurface(target: EventTarget | null): boolean {
		return target instanceof Element && target.closest('.editor-wrapper') !== null;
	}

	function swallowsEditorShortcuts(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		if (target.closest('.xterm')) return true;
		if (isInsideEditorSurface(target)) return false;
		if (target.closest('input, textarea, [contenteditable="true"]')) return true;
		return false;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!event.ctrlKey && !event.metaKey) return;
		if (event.altKey) return;
		if (swallowsEditorShortcuts(event.target)) return;

		const key = event.key.toLowerCase();

		if (key === 's' && !event.shiftKey) {
			if (!filePath || isImage) return;
			event.preventDefault();
			void saveCurrentFile();
			return;
		}

		if (key === 'v' && event.shiftKey) {
			if (!previewCapable) return;
			event.preventDefault();
			cycleViewMode();
			return;
		}

		// Ctrl+W e Ctrl+F4 chiudono la scheda; con nessun file aperto non
		// fanno nulla, mai chiudere la finestra dell'app.
		if ((key === 'w' || event.key === 'F4') && !event.shiftKey) {
			if (!filePath) return;
			event.preventDefault();
			closeFile();
			return;
		}

		if (key === 'w' && event.shiftKey) {
			if (filePaths.length === 0) return;
			event.preventDefault();
			closeAllFiles();
		}
	}

	function updateTabScrollState() {
		if (!tabsTrackEl) return;
		const { scrollLeft, scrollWidth, clientWidth } = tabsTrackEl;
		canScrollLeft = scrollLeft > 2;
		canScrollRight = scrollLeft + clientWidth < scrollWidth - 2;
	}

	function scrollTabs(delta: number) {
		tabsTrackEl?.scrollBy({ left: delta, behavior: 'smooth' });
	}

	function handleTabsWheel(event: WheelEvent) {
		if (!tabsTrackEl) return;
		if (event.deltaY && !event.deltaX) {
			event.preventDefault();
			tabsTrackEl.scrollLeft += event.deltaY;
			updateTabScrollState();
		}
	}

	// La scheda attiva deve restare visibile anche quando la barra scorre, e
	// le frecce vanno ricalcolate quando cambia il numero di schede.
	$effect(() => {
		const active = filePath;
		const count = filePaths.length;
		void count;
		if (!tabsTrackEl) return;
		if (active) {
			const activeEl = tabsTrackEl.querySelector<HTMLElement>(`[data-tab-path="${CSS.escape(active)}"]`);
			activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
		}
		requestAnimationFrame(updateTabScrollState);
	});

	// Il tasto centrale su Windows avvia l'autoscroll: va fermato sul
	// mousedown, non basta chiudere la scheda sull'auxclick.
	function handleTabMouseDown(event: MouseEvent, path: string) {
		if (event.button !== 1) return;
		event.preventDefault();
		closeFile(path);
	}

	function handleTabDragStart(event: DragEvent, path: string) {
		draggedTabPath = path;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', path);
		}
	}

	function handleTabDragOver(event: DragEvent, path: string) {
		if (!draggedTabPath) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dragOverTabPath = path;
		dragOverAfter = filePaths.indexOf(path) > filePaths.indexOf(draggedTabPath);
	}

	function handleTabDragLeave(path: string) {
		if (dragOverTabPath === path) dragOverTabPath = null;
	}

	function handleTabDrop(event: DragEvent, path: string) {
		event.preventDefault();
		const source = draggedTabPath || event.dataTransfer?.getData('text/plain');
		if (source && source !== path && projectStore.activeId) {
			projectStore.moveFile(projectStore.activeId, source, path);
		}
		draggedTabPath = null;
		dragOverTabPath = null;
	}

	function handleTabDragEnd() {
		draggedTabPath = null;
		dragOverTabPath = null;
	}

	function handleTabContextMenu(event: MouseEvent, tabPath: string) {
		event.preventDefault();
		event.stopPropagation();
		if (!projectPath) return;

		const isTabDirty = dirtyFiles[fileKey(projectPath, tabPath)] === true;
		const isTabImage = isImageFile(tabPath);
		const revealLabel = REVEAL_LABEL;

		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: 'Salva',
				icon: IconSave,
				shortcut: IS_MAC ? 'Cmd+S' : 'Ctrl+S',
				disabled: !isTabDirty || isTabImage,
				hint: !isTabDirty ? 'Nessuna modifica da salvare' : isTabImage ? 'File non modificabile' : undefined,
				run: () => void saveFileByPath(tabPath)
			},
			{
				kind: 'item',
				label: 'Confronta con HEAD',
				icon: IconDiff,
				disabled: isTabImage,
				hint: isTabImage ? 'Diff non disponibile per le immagini' : undefined,
				run: () => openDiff(tabPath)
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Copia percorso relativo',
				icon: IconCopy,
				run: async () => {
					await navigator.clipboard.writeText(tabPath);
				}
			},
			{
				kind: 'item',
				label: 'Copia percorso completo',
				icon: IconCopy,
				run: async () => {
					await navigator.clipboard.writeText(joinProjectPath(projectPath, tabPath));
				}
			},
			{
				kind: 'item',
				label: revealLabel,
				icon: IconFolderOpen,
				run: async () => {
					try {
						await revealItemInDir(joinProjectPath(projectPath, tabPath));
					} catch (error) {
						console.error('Impossibile mostrare il file nel file manager:', error);
					}
				}
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Chiudi',
				icon: IconClose,
				shortcut: IS_MAC ? 'Cmd+W' : 'Ctrl+W',
				run: () => closeFile(tabPath)
			},
			{
				kind: 'item',
				label: 'Chiudi gli altri',
				icon: IconCloseOthers,
				disabled: filePaths.length <= 1,
				hint: filePaths.length <= 1 ? 'Nessun altro file aperto' : undefined,
				run: () => closeOtherFiles(tabPath)
			},
			{
				kind: 'item',
				label: 'Chiudi tutti',
				icon: IconCloseOthers,
				shortcut: IS_MAC ? 'Cmd+Shift+W' : 'Ctrl+Shift+W',
				disabled: filePaths.length === 0,
				run: () => closeAllFiles()
			}
		];

		contextMenu.open(event, {
			label: fileName(tabPath),
			items,
			invoker: (event.currentTarget as HTMLElement) ?? (event.target as HTMLElement)
		});
	}

	function handleEditorContextMenu(event: MouseEvent, targetEditor?: monaco.editor.IStandaloneCodeEditor | null) {
		event.preventDefault();
		event.stopPropagation();
		const ed = targetEditor ?? editor;
		if (!ed) return;

		const isMainEditor = ed === editor;
		const isReadOnly = Boolean(
			ed.getOption?.(monaco.editor.EditorOption.readOnly) ??
			(ed as any).getRawOptions?.()?.readOnly
		);
		const selection = ed.getSelection?.();
		const hasSelection = selection ? !selection.isEmpty() : false;
		const isDiffOriginal = isReadOnly && showDiff;
		const readOnlyHint = isDiffOriginal ? 'Originale non modificabile' : 'File in sola lettura';

		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: 'Annulla',
				icon: IconUndo,
				shortcut: IS_MAC ? 'Cmd+Z' : 'Ctrl+Z',
				disabled: isReadOnly,
				hint: isReadOnly ? readOnlyHint : undefined,
				run: () => {
					ed.focus();
					ed.trigger('contextMenu', 'undo', null);
				}
			},
			{
				kind: 'item',
				label: 'Ripeti',
				icon: IconRedo,
				shortcut: IS_MAC ? 'Cmd+Shift+Z' : 'Ctrl+Y',
				disabled: isReadOnly,
				hint: isReadOnly ? readOnlyHint : undefined,
				run: () => {
					ed.focus();
					ed.trigger('contextMenu', 'redo', null);
				}
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Taglia',
				icon: IconCut,
				shortcut: IS_MAC ? 'Cmd+X' : 'Ctrl+X',
				disabled: isReadOnly || !hasSelection,
				hint: isReadOnly ? readOnlyHint : !hasSelection ? 'Nessun testo selezionato' : undefined,
				run: async () => {
					ed.focus();
					const sel = ed.getSelection();
					const model = ed.getModel();
					if (sel && model && !sel.isEmpty()) {
						const text = model.getValueInRange(sel);
						if (navigator.clipboard?.writeText) {
							try {
								await navigator.clipboard.writeText(text);
							} catch {
								// ignora errore clipboard
							}
						}
						ed.trigger('contextMenu', 'editor.action.clipboardCutAction', null);
					}
				}
			},
			{
				kind: 'item',
				label: 'Copia',
				icon: IconCopy,
				shortcut: IS_MAC ? 'Cmd+C' : 'Ctrl+C',
				disabled: !hasSelection,
				hint: !hasSelection ? 'Nessun testo selezionato' : undefined,
				run: async () => {
					ed.focus();
					const sel = ed.getSelection();
					const model = ed.getModel();
					if (sel && model && !sel.isEmpty()) {
						const text = model.getValueInRange(sel);
						if (navigator.clipboard?.writeText) {
							try {
								await navigator.clipboard.writeText(text);
								return;
							} catch {
								// fallback a trigger Monaco
							}
						}
					}
					ed.trigger('contextMenu', 'editor.action.clipboardCopyAction', null);
				}
			},
			{
				kind: 'item',
				label: 'Incolla',
				icon: IconPaste,
				shortcut: IS_MAC ? 'Cmd+V' : 'Ctrl+V',
				disabled: isReadOnly,
				hint: isReadOnly ? readOnlyHint : undefined,
				run: async () => {
					ed.focus();
					if (navigator.clipboard?.readText) {
						try {
							const text = await navigator.clipboard.readText();
							if (text) {
								const sel = ed.getSelection() ?? new monaco.Range(1, 1, 1, 1);
								ed.executeEdits('paste', [{ range: sel, text, forceMoveMarkers: true }]);
								return;
							}
						} catch {
							// fallback a trigger Monaco
						}
					}
					ed.trigger('contextMenu', 'editor.action.clipboardPasteAction', null);
				}
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Seleziona tutto',
				icon: IconSelectAll,
				shortcut: IS_MAC ? 'Cmd+A' : 'Ctrl+A',
				run: () => {
					ed.focus();
					ed.trigger('contextMenu', 'editor.action.selectAll', null);
				}
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Salva',
				icon: IconSave,
				shortcut: IS_MAC ? 'Cmd+S' : 'Ctrl+S',
				disabled: !isMainEditor || isReadOnly || !isDirty,
				hint: !isMainEditor
					? 'Salvataggio disponibile nell’editor principale'
					: isReadOnly
						? readOnlyHint
						: !isDirty
							? 'Nessuna modifica da salvare'
							: undefined,
				run: () => {
					void saveCurrentFile();
				}
			},
			{
				kind: 'item',
				label: showDiff ? 'Chiudi confronto' : 'Confronta con HEAD',
				icon: IconDiff,
				disabled: isImage,
				hint: isImage ? 'Diff non disponibile per le immagini' : undefined,
				run: () => {
					toggleGitDiff();
				}
			},
			{
				kind: 'item',
				label: 'Cambia vista',
				icon: IconViewPreview,
				shortcut: IS_MAC ? 'Cmd+Shift+V' : 'Ctrl+Shift+V',
				disabled: !previewCapable,
				hint: !previewCapable ? 'Nessuna anteprima per questo tipo di file' : undefined,
				run: () => {
					cycleViewMode();
				}
			}
		];

		contextMenu.open(event, {
			label: 'Editor',
			items,
			invoker: (event.target as HTMLElement) ?? (event.currentTarget as HTMLElement)
		});
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

</script>

<svelte:window onkeydowncapture={handleWindowKeydown} />

<div class="editor-wrapper">
	{#if filePaths.length > 0}
		<div class="editor-header">
			{#if canScrollLeft}
				<button
					type="button"
					class="tab-scroll-btn"
					onclick={() => scrollTabs(-180)}
					title="Scorri le schede a sinistra"
					aria-label="Scorri le schede a sinistra"
				><IconChevronLeft /></button>
			{/if}
			<div
				class="editor-tabs"
				role="group"
				aria-label="File aperti"
				bind:this={tabsTrackEl}
				onscroll={updateTabScrollState}
				onwheel={handleTabsWheel}
			>
				{#each filePaths as path (path)}
					{@const isActive = path === filePath}
					{@const isTabDirty = dirtyFiles[fileKey(projectPath, path)] === true}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="editor-tab"
						class:active={isActive}
						class:dragging={draggedTabPath === path}
						class:drag-over={dragOverTabPath === path && draggedTabPath !== path}
						class:drag-after={dragOverAfter}
						data-tab-path={path}
						draggable="true"
						ondragstart={(event) => handleTabDragStart(event, path)}
						ondragover={(event) => handleTabDragOver(event, path)}
						ondragleave={() => handleTabDragLeave(path)}
						ondrop={(event) => handleTabDrop(event, path)}
						ondragend={handleTabDragEnd}
						onmousedown={(event) => handleTabMouseDown(event, path)}
						oncontextmenu={(event) => handleTabContextMenu(event, path)}
					>
						<button
							class="editor-tab-file"
							aria-pressed={isActive}
							title={path}
							onclick={() => selectFile(path)}
						>
							<span class="tab-label" class:unsaved={isTabDirty}>{fileName(path)}</span>
						</button>
						<!-- Un solo posto per due segni: il pallino delle modifiche non
						     salvate lascia il posto alla X al passaggio del mouse, cosi'
						     la larghezza della scheda non cambia mai. -->
						<span class="tab-slot" class:has-dot={isTabDirty}>
							{#if isTabDirty}
								<span class="dirty-dot" aria-hidden="true">•</span>
							{/if}
							<button
								class="close-tab"
								onclick={(event) => { event.stopPropagation(); closeFile(path); }}
								title="Chiudi {fileName(path)} (Ctrl+W)"
								aria-label="Chiudi {fileName(path)}"
							><IconClose /></button>
						</span>
					</div>
				{/each}
			</div>
			{#if canScrollRight}
				<button
					type="button"
					class="tab-scroll-btn"
					onclick={() => scrollTabs(180)}
					title="Scorri le schede a destra"
					aria-label="Scorri le schede a destra"
				><IconChevronRight /></button>
			{/if}

			{#if filePath}
				<div class="header-actions">
					{#if previewCapable}
						<!-- La vista vale per la scheda attiva: un solo controllo,
						     non un pulsante per ogni linguetta. -->
						<div class="segmented" role="group" aria-label="Vista del file">
							<button
								class="seg-btn"
								class:active={viewMode === 'code' && !showDiff}
								onclick={() => setViewMode('code')}
								title="Solo codice (Ctrl+Shift+V cicla)"
								aria-label="Solo codice"
								aria-pressed={viewMode === 'code' && !showDiff}
							><IconViewCode /></button>
							<button
								class="seg-btn"
								class:active={viewMode === 'split' && !showDiff}
								onclick={() => setViewMode('split')}
								title="Codice e anteprima (Ctrl+Shift+V cicla)"
								aria-label="Codice e anteprima"
								aria-pressed={viewMode === 'split' && !showDiff}
							><IconViewSplit /></button>
							<button
								class="seg-btn"
								class:active={viewMode === 'preview' && !showDiff}
								onclick={() => setViewMode('preview')}
								title="Solo anteprima (Ctrl+Shift+V cicla)"
								aria-label="Solo anteprima"
								aria-pressed={viewMode === 'preview' && !showDiff}
							><IconViewPreview /></button>
						</div>
					{/if}
					{#if !isImage}
						<button
							class="icon-btn"
							class:active={showDiff}
							onclick={toggleGitDiff}
							title={showDiff ? 'Chiudi il confronto con HEAD' : 'Confronta con HEAD'}
							aria-label={showDiff ? 'Chiudi il confronto con HEAD' : 'Confronta con HEAD'}
							aria-pressed={showDiff}
						><IconDiff /></button>
					{/if}
					{#if isHtmlFile(filePath)}
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
		</div>
	{/if}

	<div class="editor-body">
		{#if loading}
			<div class="loading-overlay">Caricamento in corso...</div>
		{/if}

		{#if !filePath}
			<div class="empty-state">
				<div class="empty-text">Seleziona un file dall'albero per modificarlo</div>
				<div class="empty-hint">Ctrl+S salva · Ctrl+W chiude la scheda</div>
			</div>
		{:else if isImage}
			<ImageViewer projectPath={projectPath} filePath={filePath} />
		{:else if showDiff}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="diff-wrapper"
				bind:this={diffContainer}
				oncontextmenu={(event) => handleEditorContextMenu(event, diffEditorInstance?.getModifiedEditor() ?? null)}
			></div>
		{:else if previewCapable && viewMode === 'preview'}
			<div class="preview-only">
				{#if isSvg}
					<div class="svg-preview-viewport">
						<SvgPreview content={currentText} title="Anteprima live di {fileName(filePath)}" />
					</div>
				{:else}
					<div class="markdown-preview-viewport">
						<Markdown tokens={markdownTokens} />
					</div>
				{/if}
			</div>
		{:else if previewCapable && viewMode === 'split'}
			<div class="split-container" bind:this={splitContainer}>
				<div class="split-top" style="height: {splitPercent}%;">
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="monaco-host"
						bind:this={container}
						oncontextmenu={(event) => handleEditorContextMenu(event, editor)}
					></div>
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="splitter-bar" onmousedown={startResize} title="Trascina per ridimensionare">
					<div class="splitter-line"></div>
				</div>
				<div class="split-bottom" style="height: {100 - splitPercent}%;">
					{#if isSvg}
						<div class="svg-preview-viewport">
							<SvgPreview content={currentText} title="Anteprima live di {fileName(filePath)}" />
						</div>
					{:else}
						<div class="markdown-preview-viewport">
							<Markdown tokens={markdownTokens} />
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="monaco-host"
				bind:this={container}
				oncontextmenu={(event) => handleEditorContextMenu(event, editor)}
			></div>
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
		scrollbar-width: none;
	}

	.editor-tabs::-webkit-scrollbar {
		display: none;
	}

	.tab-scroll-btn {
		align-self: center;
		width: 18px;
		height: 26px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		flex: none;
	}

	.tab-scroll-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.editor-tab {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 0;
		color: var(--ink-muted);
		cursor: grab;
		border-right: 1px solid var(--line);
	}

	.editor-tab:active {
		cursor: grabbing;
	}

	.editor-tab:hover {
		background: var(--bg-hover);
	}

	.editor-tab.active {
		background: var(--bg-sunken);
		color: var(--ink);
	}

	/* La scheda attiva si riconosce da una barra sopra, non solo dal fondo
	   piu' scuro: a tema chiaro la differenza di superficie e' troppo tenue. */
	.editor-tab.active::before {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 2px;
		background: var(--brand);
	}

	.editor-tab.dragging {
		opacity: 0.5;
	}

	.editor-tab.drag-over::after {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 2px;
		background: var(--brand);
	}

	.editor-tab.drag-over.drag-after::after {
		inset: 0 0 0 auto;
	}

	.editor-tab-file {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		max-width: 180px;
		height: 100%;
		padding: 0 var(--space-1) 0 var(--space-2);
		background: transparent;
		border: none;
		color: inherit;
		cursor: inherit;
		font: inherit;
		overflow: hidden;
		white-space: nowrap;
	}

	.editor-tab-file:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.tab-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Il corsivo dice "non salvato" anche a chi non distingue il colore del
	   pallino (DESIGN.md: nessuna informazione affidata al solo colore). */
	.tab-label.unsaved {
		font-style: italic;
	}

	/* Cella di larghezza fissa: il pallino e la X vivono nello stesso posto,
	   quindi passare col mouse non fa saltare la linguetta di qualche pixel. */
	.tab-slot {
		position: relative;
		width: 20px;
		height: 20px;
		margin-right: var(--space-1);
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.dirty-dot {
		color: var(--warn);
		font-size: 16px;
		line-height: 1;
	}

	.close-tab {
		position: absolute;
		inset: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: inherit;
		cursor: pointer;
		padding: 0;
		opacity: 0;
	}

	.close-tab:hover {
		background: var(--bg-active);
		color: var(--ink);
	}

	.editor-tab:hover .close-tab {
		opacity: 1;
	}

	.close-tab:focus-visible {
		opacity: 1;
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.editor-tab:hover .dirty-dot,
	.tab-slot:focus-within .dirty-dot {
		opacity: 0;
	}

	/* Senza modifiche pendenti la X resta visibile sulla scheda attiva: e'
	   l'azione piu' probabile su quella linguetta. */
	.editor-tab.active .close-tab {
		opacity: 0.7;
	}

	.editor-tab.active:hover .close-tab {
		opacity: 1;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex: none;
		padding-left: var(--space-1);
	}

	.segmented {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.seg-btn {
		width: 26px;
		height: 22px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-left: 1px solid var(--line);
		color: var(--ink-muted);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.seg-btn:first-child {
		border-left: none;
	}

	.seg-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.seg-btn.active {
		background: var(--bg-active);
		color: var(--ink);
	}

	.icon-btn {
		width: 26px;
		height: 22px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.icon-btn.active {
		background: var(--bg-active);
		color: var(--ink);
		border-color: var(--brand);
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

	/* Vista a tutta altezza: stessa impaginazione del pannello inferiore dello
	   split, senza il divisore. */
	.preview-only {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
		overflow: hidden;
	}

	.svg-preview-viewport {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-2);
		overflow: hidden;
		position: relative;
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

	/* Nessuna regola sui figli: il markdown arriva dal componente della chat,
	   che porta i propri stili. Due fogli sullo stesso albero divergerebbero. */
	.markdown-preview-viewport {
		flex: 1;
		padding: var(--space-4) var(--space-5);
		overflow-y: auto;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-base);
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
