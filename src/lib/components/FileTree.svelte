<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { invoke } from '@tauri-apps/api/core';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { Lingering, ROW_EXIT_MS } from '$lib/agent/motionState.svelte';
	import { setContext, getContext, tick } from 'svelte';
	import FileTree from './FileTree.svelte';
	import {
		IconChevronRight,
		IconClose,
		IconDatabase,
		IconFile,
		IconFileArchive,
		IconFileBraces,
		IconFileCode,
		IconFileImage,
		IconFileText,
		IconFolder,
		IconFolderOpen,
		IconRename,
		IconRefresh,
		IconCopy,
		IconTerminal,
		IconExternalLink,
		IconGitBranch,
		IconTrash,
		IconNewFile,
		IconNewFolder,
		IconSearch
	} from '$lib/icons';
	import GitStatusMark from '$lib/ui/GitStatusMark.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { contextMenu, type ContextMenuEntry } from '$lib/contextMenu.svelte';
	import { joinProjectPath, isWindows, normalizeProjectPath } from '$lib/utils/paths';
	import type { GitStatusRefreshDetail } from '$lib/stores/gitDiff.svelte';
	import { REVEAL_LABEL } from '$lib/utils/platform';

	let {
		projectPath,
		relPath = "",
		name = "src",
		isDir = true,
		level = 0,
		posInSet = 1,
		setSize = 1,
		onFileSelect,
		onFileDiff,
		dirtyFilePaths = [],
		onPathRenamed,
		onPathTrashed
	} = $props<{
		projectPath: string,
		relPath?: string,
		name?: string,
		isDir?: boolean,
		level?: number,
		posInSet?: number,
		setSize?: number,
		onFileSelect?: (path: string) => void,
		onFileDiff?: (path: string) => void,
		dirtyFilePaths?: string[],
		onPathRenamed?: (from: string, to: string, isDir: boolean) => void,
		onPathTrashed?: (path: string, isDir: boolean) => void
	}>();

	let expanded = $state(false);
	// Piegatura dei figli a --dur-row. Si anima solo dopo un gesto: la radice
	// che nasce aperta al montaggio resta ferma (Still-Room Rule).
	const childrenLinger = new Lingering<true>(ROW_EXIT_MS);
	let foldAnimated = $state(false);
	$effect(() => {
		childrenLinger.update(isDir && expanded ? true : undefined);
	});
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let entries = $state<{name: string, path: string, is_dir: boolean}[]>([]);

	// Stato per creazione inline (nuovo file / cartella)
	let creatingType = $state<'file' | 'dir' | null>(null);
	let creationName = $state('');
	let creationError = $state<string | null>(null);
	let creationInputRef = $state<HTMLInputElement | null>(null);

	// Stato per rinomina inline
	let isRenaming = $state(false);
	let renameValue = $state('');
	let renameError = $state<string | null>(null);
	let renameInputRef = $state<HTMLInputElement | null>(null);

	interface FileSearchResult {
		name: string;
		path: string;
		is_dir: boolean;
		score: number;
		name_indices: number[];
		path_indices: number[];
	}

	// Stato per ricerca file (attivo solo alla radice level === 0)
	let searchQuery = $state('');
	let searchResults = $state<FileSearchResult[]>([]);
	let searchLoading = $state(false);
	let searchError = $state<string | null>(null);
	let selectedSearchIndex = $state(0);
	let searchInputRef = $state<HTMLInputElement | null>(null);
	let searchTimer: number | null = null;
	let searchRequestToken = 0;

	const NOISY_DIRS = ['bin', 'obj', '.vs', 'packages', 'node_modules'];
	let isNoisy = $derived(NOISY_DIRS.includes(name));

	let rootGitStatuses = $state<Record<string, string>>({});

	const parentGitStatuses = getContext<() => Record<string, string>>('gitStatusesCtx');
	// Il contesto va installato in modo sincrono, ma il valore della prop
	// `level` resta reattivo dentro la closure: leggerlo qui una sola volta
	// congelerebbe il ruolo root/nodo segnalato da Svelte.
	const getGitStatuses = () =>
		level === 0 ? rootGitStatuses : (parentGitStatuses ? parentGitStatuses() : {});
	setContext('gitStatusesCtx', getGitStatuses);
	let gitStatuses = $derived(getGitStatuses());

	async function loadEntries(force = false) {
		if (loaded && !force) return;
		loadError = null;
		const hadFocus = typeof document !== 'undefined' && nodeEl?.contains(document.activeElement);
		try {
			entries = await invoke('tree_read', { projectPath, rel: relPath });
			loaded = true;
			await nav.syncActive();
			if (hadFocus) {
				await nav.focusKey(activeKey);
			}
		} catch (e) {
			// Conserviamo l'errore reale per mostrare il messaggio all'utente con pulsante di riprova
			loadError = String(e);
		}
	}
	// Contesto per aggiornare solo il ramo genitore interessato da rinomina/eliminazione
	const parentRefresh = getContext<() => Promise<void>>('fileTreeRefreshDirCtx');
	const refreshThisDir = async () => {
		await loadEntries(true);
	};
	setContext('fileTreeRefreshDirCtx', refreshThisDir);

	// Riferimenti DOM del nodo: servono a riportare il focus su questa riga
	// quando una riga discendente sparisce (chiusura cartella, cestino).
	let nodeEl = $state<HTMLDivElement | null>(null);
	let rowEl = $state<HTMLButtonElement | null>(null);

	// Chiavi opache: il prefisso distingue la riga del nodo dalla riga di
	// errore, cosi due treeitem dello stesso percorso non collidono mai.
	let rowKey = $derived(`row:${relPath}`);
	// Navigazione ad albero: solo la radice possiede lo stato del roving
	// tabindex e lo condivide con i discendenti, cosi una sola riga per volta
	// resta nel tab order anche se ogni nodo e' un componente separato.
	type TreeNav = {
		isActive: (key: string) => boolean;
		setActive: (key: string) => void;
		focusKey: (key: string) => Promise<void>;
		syncActive: () => Promise<void>;
	};

	let treeEl = $state<HTMLDivElement | null>(null);
	let activeKey = $state('row:');
	let trashError = $state<string | null>(null);


	// Una riga chiusa resta nel DOM per tutta la piegatura d'uscita: va
	// esclusa dalla navigazione, altrimenti il focus finisce su un nodo morente.
	function isRowLive(row: HTMLElement): boolean {
		let group = row.parentElement?.closest('.children') ?? null;
		while (group) {
			if (group.previousElementSibling?.getAttribute('aria-expanded') === 'false') return false;
			group = group.parentElement?.closest('.children') ?? null;
		}
		return true;
	}

	// L'ordine del DOM coincide con l'ordine visivo delle righe aperte:
	// non serve un registro dei nodi, basta interrogare l'albero renderizzato.
	function treeRows(): HTMLElement[] {
		const root = nodeEl ?? treeEl;
		if (!root) return [];
		return Array.from(root.querySelectorAll<HTMLElement>('[data-tree-key]')).filter(isRowLive);
	}

	function findRow(key: string): HTMLElement | null {
		return treeRows().find((row) => row.dataset.treeKey === key) ?? null;
	}

	function rowLevel(row: HTMLElement): number {
		return Number(row.getAttribute('aria-level') ?? '1');
	}

	function focusRow(row: HTMLElement | null | undefined) {
		if (!row) return;
		activeKey = row.dataset.treeKey ?? activeKey;
		row.focus();
	}

	async function syncActiveRow() {
		await tick();
		const root = nodeEl ?? treeEl;
		if (!root || findRow(activeKey)) return;
		// La riga nel tab order e' sparita (chiusura, cestino, ricarica):
		// senza questo rientro l'albero resterebbe irraggiungibile con Tab.
		activeKey = treeRows()[0]?.dataset.treeKey ?? 'row:';
	}

	const parentNav = getContext<TreeNav | undefined>('fileTreeNavCtx');
	const nav: TreeNav = parentNav ?? {
		isActive: (key) => activeKey === key,
		setActive: (key) => { activeKey = key; },
		focusKey: async (key) => {
			await tick();
			const row = findRow(key);
			if (!row) {
				await syncActiveRow();
				return;
			}
			activeKey = key;
			row.focus();
		},
		syncActive: syncActiveRow
	};
	if (!parentNav) setContext('fileTreeNavCtx', nav);

	function parentRow(rows: HTMLElement[], index: number): HTMLElement | null {
		const depth = rowLevel(rows[index]);
		for (let i = index - 1; i >= 0; i--) {
			if (rowLevel(rows[i]) < depth) return rows[i];
		}
		return null;
	}

	function handleTreeKeyDown(event: KeyboardEvent) {
		// Le scorciatoie applicative con modificatori restano di competenza della finestra
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		// Gli input inline non sono treeitem: la navigazione non li intercetta
		const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tree-key]');
		if (!target) return;
		const rows = treeRows();
		const index = rows.indexOf(target);
		if (index < 0) return;
		const expandedAttr = target.getAttribute('aria-expanded');

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				focusRow(rows[index + 1]);
				break;
			case 'ArrowUp':
				event.preventDefault();
				focusRow(rows[index - 1]);
				break;
			case 'Home':
				event.preventDefault();
				focusRow(rows[0]);
				break;
			case 'End':
				event.preventDefault();
				focusRow(rows[rows.length - 1]);
				break;
			case 'ArrowRight':
				event.preventDefault();
				if (expandedAttr === 'false') {
					// Il click passa da toggle(): l'apertura carica i figli su richiesta
					target.click();
				} else if (expandedAttr === 'true') {
					const child = rows[index + 1];
					// Cartella aperta ma vuota o ancora in caricamento: non si esce dal sottoalbero
					if (child && rowLevel(child) > rowLevel(target)) focusRow(child);
				}
				break;
			case 'ArrowLeft':
				event.preventDefault();
				if (expandedAttr === 'true') {
					target.click();
					break;
				}
				focusRow(parentRow(rows, index));
				break;
			case 'Enter':
				event.preventDefault();
				target.click();
				break;
		}
	}
	// Verifica se il file o un discendente ha modifiche non salvate
	function isDirtyOrHasDirtyChildren(targetRel: string, isDirectory: boolean): boolean {
		if (dirtyFilePaths.length === 0) return false;
		const normalize = (path: string) => {
			const normalized = path.replace(/\\/g, '/');
			return isWindows ? normalized.toLowerCase() : normalized;
		};
		const normTarget = normalize(targetRel);
		if (!isDirectory) {
			return dirtyFilePaths.some((path: string) => normalize(path) === normTarget);
		}
		const prefix = normTarget === '' ? '' : (normTarget.endsWith('/') ? normTarget : `${normTarget}/`);
		return dirtyFilePaths.some((path: string) => {
			const normalized = normalize(path);
			return prefix === '' || normalized === normTarget || normalized.startsWith(prefix);
		});
	}

	let isDirty = $derived(isDirtyOrHasDirtyChildren(relPath, isDir));

	let lastGitStatusLoadedAt = 0;

	async function loadGitStatus(force = false) {
		if (!projectPath) return;
		if (!force && Date.now() - lastGitStatusLoadedAt < 5000) return;
		try {
			const res: { statuses: Record<string, string> } = await invoke('project_git_status', { projectPath });
			lastGitStatusLoadedAt = Date.now();
			rootGitStatuses = res.statuses || {};
		} catch {
			// Progetto non git o comando fallito: lo stato git degrada a vuoto
			rootGitStatuses = {};
		}
	}

	let lastLoadedPath = '';

	$effect(() => {
		if (level === 0 && projectPath) {
			if (lastLoadedPath !== projectPath) {
				lastLoadedPath = projectPath;
				clearSearch();
				loaded = false;
				loadError = null;
				entries = [];
				if (!isNoisy) {
					expanded = true;
					void loadEntries();
				}
			}
			void loadGitStatus(true);

			const handleGitRefresh = (event: Event) => {
				const target = (event as CustomEvent<GitStatusRefreshDetail>).detail?.projectPath;
				if (
					target &&
					normalizeProjectPath(target).toLowerCase() !== normalizeProjectPath(projectPath).toLowerCase()
				) {
					return;
				}
				void loadGitStatus(true);
			};

			const handleFocus = () => {
				void loadGitStatus(false);
			};

			window.addEventListener('git-status-refresh', handleGitRefresh);
			window.addEventListener('focus', handleFocus);

			return () => {
				if (searchTimer !== null) {
					window.clearTimeout(searchTimer);
					searchTimer = null;
				}
				window.removeEventListener('git-status-refresh', handleGitRefresh);
				window.removeEventListener('focus', handleFocus);
			};
		}
	});
	let fileStatus = $derived.by(() => {
		const statuses = gitStatuses;
		if (!statuses || Object.keys(statuses).length === 0) return null;

		if (!isDir) {
			return statuses[relPath] || null;
		}

		const prefix = relPath === "" ? "" : relPath + "/";
		let hasModified = false;
		let hasUntracked = false;

		for (const [path, code] of Object.entries(statuses)) {
			if (relPath === "" || path.startsWith(prefix)) {
				if (code === 'U') {
					hasUntracked = true;
				} else {
					hasModified = true;
				}
			}
		}

		if (hasModified) return 'M';
		if (hasUntracked) return 'U';
		return null;
	});

	function getStatusTitle(status: string | null, isDirectory: boolean): string {
		if (!status) return '';
		if (isDirectory) {
			return status === 'U' ? m.ui_filetree_contiene_file_non_tracciati_9bb3() : m.ui_filetree_contiene_modifiche_git_in_attesa_di_commit_7cb6();
		}
		switch (status) {
			case 'M': return m.ui_filetree_modificato_in_attesa_di_commit_45d7();
			case 'A': return m.ui_filetree_aggiunto_in_attesa_di_commit_3d4a();
			case 'U': return m.ui_filetree_non_tracciato_in_attesa_di_commit_36ca();
			case 'D': return m.ui_filetree_rimosso_in_attesa_di_commit_e3cf();
			case 'R': return m.ui_filetree_rinominato_in_attesa_di_commit_f9b2();
			case 'C': return 'Conflitto git';
			default: return m.ui_filetree_modificato_in_attesa_di_commit_45d7();
		}
	}


	async function toggle() {
		trashError = null;
		if (!isDir) {
			if (onFileSelect) onFileSelect(relPath);
			return;
		}

		foldAnimated = true;
		expanded = !expanded;
		if (expanded && (!loaded || loadError)) {
			await loadEntries();
		}
	}


	async function copyText(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch (err) {
			console.error(m.ui_filetree_errore_copia_negli_appunti_7b94(), err);
		}
	}

	function revealPath(targetRel: string) {
		const full = joinProjectPath(projectPath, targetRel);
		void revealItemInDir(full);
	}

	async function openInTerminal(targetRel: string) {
		try {
			await invoke('open_project_external', {
				projectPath,
				target: 'terminal',
				...(targetRel ? { rel: targetRel } : {})
			});
		} catch (err) {
			console.error(m.ui_filetree_errore_apertura_terminale_ce02(), err);
		}
	}

	async function refreshRoot() {
		await loadEntries(true);
		await loadGitStatus();
	}

	// Creazione inline
	async function startCreation(type: 'file' | 'dir') {
		trashError = null;
		if (!expanded) {
			foldAnimated = true;
			expanded = true;
		}
		if (!loaded || loadError) {
			await loadEntries(true);
		}
		creatingType = type;
		creationName = '';
		creationError = null;
		await tick();
		creationInputRef?.focus();
	}
	function cancelCreation() {
		creatingType = null;
		creationName = '';
		creationError = null;
	}

	async function commitCreation() {
		const trimmed = creationName.trim();
		if (!trimmed) {
			creationError = 'Il nome non puo essere vuoto';
			await tick();
			creationInputRef?.focus();
			return;
		}
		if (trimmed.includes('/') || trimmed.includes('\\')) {
			creationError = 'Il nome non puo contenere barre';
			await tick();
			creationInputRef?.focus();
			return;
		}
		creationError = null;
		try {
			if (creatingType === 'dir') {
				await invoke('path_create_directory', {
					projectPath,
					parentRel: relPath,
					name: trimmed
				});
			} else {
				const res = await invoke<{ name: string; path: string; is_dir: boolean }>('path_create_file', {
					projectPath,
					parentRel: relPath,
					name: trimmed
				});
				if (res?.path && onFileSelect) {
					onFileSelect(res.path);
				}
			}
			await loadEntries(true);
			cancelCreation();
			window.dispatchEvent(new CustomEvent('git-status-refresh'));
		} catch (err) {
			creationError = String(err);
			await tick();
			creationInputRef?.focus();
		}
	}

	function handleCreationKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			cancelCreation();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			void commitCreation();
		}
	}

	function handleCreationBlur() {
		if (!creationError && creationName.trim() === '') {
			cancelCreation();
		}
	}

	// Rinomina inline
	async function startRename() {
		if (isDirty) return;
		trashError = null;
		isRenaming = true;
		renameValue = name;
		renameError = null;
		await tick();
		if (renameInputRef) {
			renameInputRef.focus();
			const lastDot = name.lastIndexOf('.');
			if (!isDir && lastDot > 0) {
				renameInputRef.setSelectionRange(0, lastDot);
			} else {
				renameInputRef.select();
			}
		}
	}

	function cancelRename() {
		isRenaming = false;
		renameValue = '';
		renameError = null;
	}

	async function commitRename() {
		const trimmed = renameValue.trim();
		if (!trimmed) {
			renameError = 'Il nome non puo essere vuoto';
			await tick();
			renameInputRef?.focus();
			return;
		}
		if (trimmed === name) {
			cancelRename();
			return;
		}
		if (trimmed.includes('/') || trimmed.includes('\\')) {
			renameError = 'Il nome non puo contenere barre';
			await tick();
			renameInputRef?.focus();
			return;
		}
		renameError = null;
		try {
			const res = await invoke<{ name: string; path: string; is_dir: boolean }>('path_rename', {
				projectPath,
				rel: relPath,
				newName: trimmed
			});
			const oldRel = relPath;
			const newRel = res?.path || (relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/') + 1) + trimmed : trimmed);

			cancelRename();

			if (parentRefresh) {
				await parentRefresh();
			}
			onPathRenamed?.(oldRel, newRel, isDir);
			window.dispatchEvent(new CustomEvent('git-status-refresh'));
		} catch (err) {
			renameError = String(err);
			await tick();
			renameInputRef?.focus();
		}
	}

	function handleRenameKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			cancelRename();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			void commitRename();
		}
	}

	function handleRenameBlur() {
		if (!renameError && (renameValue.trim() === '' || renameValue.trim() === name)) {
			cancelRename();
		}
	}

	// Cestino
	async function trashItem() {
		if (isDirty) return;
		trashError = null;
		try {
			await invoke('path_trash', { projectPath, rel: relPath });
			trashError = null;
			if (parentRefresh) {
				await parentRefresh();
			}
			onPathTrashed?.(relPath, isDir);
			window.dispatchEvent(new CustomEvent('git-status-refresh'));
		} catch (err) {
			trashError = typeof err === 'string' ? err : (err instanceof Error ? err.message : String(err));
		}
	}

	// Costruzione dei menu contestuali
	function openFileMenu(event: MouseEvent) {
		const fullPath = joinProjectPath(projectPath, relPath);
		const revealLabel = REVEAL_LABEL;

		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: m.file_tree_menu_open(),
				icon: IconFile,
				run: () => onFileSelect?.(relPath)
			}
		];

		if (fileStatus && onFileDiff) {
			items.push({
				kind: 'item',
				label: m.file_tree_menu_git_diff(),
				icon: IconGitBranch,
				run: () => onFileDiff?.(relPath)
			});
		}

		items.push(
			{ kind: 'separator' },
			{
				kind: 'item',
				label: m.file_tree_menu_copy_rel_path(),
				icon: IconCopy,
				run: () => void copyText(relPath)
			},
			{
				kind: 'item',
				label: m.file_tree_menu_copy_full_path(),
				icon: IconCopy,
				run: () => void copyText(fullPath)
			},
			{
				kind: 'item',
				label: revealLabel,
				icon: IconExternalLink,
				run: () => revealPath(relPath)
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: m.file_tree_menu_rename(),
				icon: IconRename,
				disabled: isDirty,
				hint: isDirty ? m.ui_filetree_salva_le_modifiche_prima_di_rinominare_60a1() : undefined,
				run: () => void startRename()
			},
			{
				kind: 'item',
				label: m.file_tree_menu_trash(),
				icon: IconTrash,
				danger: true,
				disabled: isDirty,
				hint: isDirty ? m.ui_filetree_salva_le_modifiche_prima_di_eliminare_9cd7() : undefined,
				run: () => void trashItem()
			}
		);

		contextMenu.open(event, {
			label: `File: ${name}`,
			items,
			invoker: event.currentTarget as HTMLElement
		});
	}

	function openFolderMenu(event: MouseEvent) {
		const fullPath = joinProjectPath(projectPath, relPath);
		const revealLabel = REVEAL_LABEL;

		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: m.file_tree_menu_new_file(),
				icon: IconNewFile,
				run: () => void startCreation('file')
			},
			{
				kind: 'item',
				label: m.file_tree_menu_new_folder(),
				icon: IconNewFolder,
				run: () => void startCreation('dir')
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: m.file_tree_menu_refresh(),
				icon: IconRefresh,
				run: () => void loadEntries(true)
			},
			{
				kind: 'item',
				label: m.file_tree_menu_open_terminal(),
				icon: IconTerminal,
				run: () => void openInTerminal(relPath)
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: m.file_tree_menu_copy_rel_path(),
				icon: IconCopy,
				run: () => void copyText(relPath)
			},
			{
				kind: 'item',
				label: m.file_tree_menu_copy_full_path(),
				icon: IconCopy,
				run: () => void copyText(fullPath)
			},
			{
				kind: 'item',
				label: revealLabel,
				icon: IconFolderOpen,
				run: () => revealPath(relPath)
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: m.file_tree_menu_rename(),
				icon: IconRename,
				disabled: isDirty,
				hint: isDirty ? m.ui_filetree_salva_le_modifiche_prima_di_rinominare_60a1() : undefined,
				run: () => void startRename()
			},
			{
				kind: 'item',
				label: m.file_tree_menu_trash(),
				icon: IconTrash,
				danger: true,
				disabled: isDirty,
				hint: isDirty ? m.ui_filetree_salva_le_modifiche_prima_di_eliminare_9cd7() : undefined,
				run: () => void trashItem()
			}
		];

		contextMenu.open(event, {
			label: m.ui_filetree_cartella_value1_7a84({ value1: name }),
			items,
			invoker: event.currentTarget as HTMLElement
		});
	}

	function openRootMenu(event: MouseEvent) {
		const revealLabel = REVEAL_LABEL;

		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: m.file_tree_menu_new_file(),
				icon: IconNewFile,
				run: () => void startCreation('file')
			},
			{
				kind: 'item',
				label: m.file_tree_menu_new_folder(),
				icon: IconNewFolder,
				run: () => void startCreation('dir')
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: m.file_tree_menu_refresh(),
				icon: IconRefresh,
				run: () => void refreshRoot()
			},
			{
				kind: 'item',
				label: m.file_tree_menu_copy_full_path(),
				icon: IconCopy,
				run: () => void copyText(projectPath)
			},
			{
				kind: 'item',
				label: revealLabel,
				icon: IconFolderOpen,
				run: () => revealPath('')
			},
			{
				kind: 'item',
				label: m.file_tree_menu_open_terminal(),
				icon: IconTerminal,
				run: () => void openInTerminal('')
			}
		];

		contextMenu.open(event, {
			label: `Progetto: ${name}`,
			items,
			invoker: event.currentTarget as HTMLElement
		});
	}

	function handleRowContextMenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (level === 0) {
			openRootMenu(event);
		} else if (isDir) {
			openFolderMenu(event);
		} else {
			openFileMenu(event);
		}
	}

	function handleRootContainerContextMenu(event: MouseEvent) {
		if (contextMenu.isOpen) return;
		event.preventDefault();
		event.stopPropagation();
		openRootMenu(event);
	}

	// Una forma Lucide per famiglia: l'estensione e' gia' nel nome, l'icona
	// separa solo codice, dati, testo, media e archivi.
	const FILE_ICONS = new Map<string, typeof IconFile>([
		...['md', 'markdown', 'txt', 'pdf'].map((ext) => [ext, IconFileText] as const),
		...['json', 'jsonc', 'json5'].map((ext) => [ext, IconFileBraces] as const),
		...[
			'vb', 'vbs', 'vbproj', 'aspx', 'ascx', 'master', 'asmx', 'ashx', 'cs', 'csx', 'csproj', 'sln',
			'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'html', 'htm', 'css', 'scss', 'less',
			'xml', 'config', 'xaml', 'props', 'targets'
		].map((ext) => [ext, IconFileCode] as const),
		...['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'svg'].map((ext) => [ext, IconFileImage] as const),
		...['zip', 'tar', 'gz', '7z', 'rar'].map((ext) => [ext, IconFileArchive] as const),
		...['sql', 'db', 'sqlite', 'sqlite3', 'mdf'].map((ext) => [ext, IconDatabase] as const)
	]);

	function fileIcon(filename: string): typeof IconFile {
		const dot = filename.lastIndexOf('.');
		if (dot === -1) return IconFile;
		return FILE_ICONS.get(filename.slice(dot + 1).toLowerCase()) ?? IconFile;
	}
	function getParentDirectory(path: string): string {
		const lastSlash = path.lastIndexOf('/');
		if (lastSlash > 0) {
			return path.substring(0, lastSlash);
		}
		return '';
	}

	async function executeSearch(q: string) {
		const trimmed = q.trim();
		if (!trimmed || !projectPath) {
			searchResults = [];
			searchLoading = false;
			searchError = null;
			selectedSearchIndex = 0;
			return;
		}

		const token = ++searchRequestToken;
		searchLoading = true;
		searchError = null;

		try {
			const results = await invoke<FileSearchResult[]>('project_files_search', {
				projectPath,
				query: trimmed,
				limit: 150
			});
			if (token === searchRequestToken) {
				searchResults = results;
				searchLoading = false;
				selectedSearchIndex = 0;
			}
		} catch (err) {
			if (token === searchRequestToken) {
				searchError = String(err);
				searchLoading = false;
				searchResults = [];
			}
		}
	}

	function handleSearchInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		searchQuery = val;
		if (searchTimer !== null) window.clearTimeout(searchTimer);
		if (!val.trim()) {
			searchResults = [];
			searchLoading = false;
			searchError = null;
			selectedSearchIndex = 0;
			return;
		}
		searchTimer = window.setTimeout(() => {
			searchTimer = null;
			void executeSearch(val);
		}, 150);
	}

	function clearSearch() {
		searchQuery = '';
		if (searchTimer !== null) {
			window.clearTimeout(searchTimer);
			searchTimer = null;
		}
		searchResults = [];
		searchLoading = false;
		searchError = null;
		selectedSearchIndex = 0;
		searchInputRef?.focus();
	}

	function handleSelectSearchResult(res: FileSearchResult) {
		if (res.is_dir) {
			clearSearch();
		} else if (onFileSelect) {
			onFileSelect(res.path);
		}
	}

	function renderHighlightedText(text: string, indices: number[]): { text: string; match: boolean }[] {
		if (!indices || indices.length === 0) {
			return [{ text, match: false }];
		}
		const matchSet = new Set(indices);
		const segments: { text: string; match: boolean }[] = [];
		const chars = Array.from(text);
		let currentSegment = '';
		let currentIsMatch = false;

		for (let i = 0; i < chars.length; i++) {
			const isMatch = matchSet.has(i);
			if (i === 0) {
				currentSegment = chars[i];
				currentIsMatch = isMatch;
			} else if (isMatch === currentIsMatch) {
				currentSegment += chars[i];
			} else {
				segments.push({ text: currentSegment, match: currentIsMatch });
				currentSegment = chars[i];
				currentIsMatch = isMatch;
			}
		}
		if (currentSegment) {
			segments.push({ text: currentSegment, match: currentIsMatch });
		}
		return segments;
	}

	function handleSearchKeyDown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (searchResults.length > 0) {
				selectedSearchIndex = 0;
				const firstRow = document.querySelector<HTMLButtonElement>('.search-result-row');
				firstRow?.focus();
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (searchResults.length > 0) {
				const target = searchResults[selectedSearchIndex] || searchResults[0];
				handleSelectSearchResult(target);
			}
		} else if (e.key === 'Escape') {
			if (searchQuery) {
				e.preventDefault();
				clearSearch();
			}
		}
	}

	function handleSearchResultKeyDown(e: KeyboardEvent, index: number, res: FileSearchResult) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (index < searchResults.length - 1) {
				selectedSearchIndex = index + 1;
				const next = (e.currentTarget as HTMLElement).nextElementSibling as HTMLButtonElement | null;
				next?.focus();
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (index > 0) {
				selectedSearchIndex = index - 1;
				const prev = (e.currentTarget as HTMLElement).previousElementSibling as HTMLButtonElement | null;
				prev?.focus();
			} else {
				searchInputRef?.focus();
			}
		} else if (e.key === 'Home') {
			e.preventDefault();
			selectedSearchIndex = 0;
			const first = (e.currentTarget as HTMLElement).parentElement?.firstElementChild as HTMLButtonElement | null;
			first?.focus();
		} else if (e.key === 'End') {
			e.preventDefault();
			selectedSearchIndex = searchResults.length - 1;
			const last = (e.currentTarget as HTMLElement).parentElement?.lastElementChild as HTMLButtonElement | null;
			last?.focus();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			handleSelectSearchResult(res);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			clearSearch();
		}
	}

	function handleSearchResultContextMenu(event: MouseEvent, res: FileSearchResult) {
		event.preventDefault();
		event.stopPropagation();

		const fullPath = joinProjectPath(projectPath, res.path);
		const revealLabel = REVEAL_LABEL;
		const resStatus = gitStatuses[res.path] || null;

		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: m.file_tree_menu_open(),
				icon: IconFile,
				run: () => onFileSelect?.(res.path)
			}
		];

		if (resStatus && onFileDiff) {
			items.push({
				kind: 'item',
				label: m.file_tree_menu_git_diff(),
				icon: IconGitBranch,
				run: () => onFileDiff?.(res.path)
			});
		}

		items.push(
			{ kind: 'separator' },
			{
				kind: 'item',
				label: m.file_tree_menu_copy_rel_path(),
				icon: IconCopy,
				run: () => void copyText(res.path)
			},
			{
				kind: 'item',
				label: m.file_tree_menu_copy_full_path(),
				icon: IconCopy,
				run: () => void copyText(fullPath)
			},
			{
				kind: 'item',
				label: revealLabel,
				icon: IconExternalLink,
				run: () => revealPath(res.path)
			}
		);

		if (res.is_dir) {
			items.push({
				kind: 'item',
				label: m.file_tree_menu_open_terminal(),
				icon: IconTerminal,
				run: () => void openInTerminal(res.path)
			});
		}

		contextMenu.open(event, {
			label: `${res.is_dir ? m.ui_filetree_cartella_ee2c() : m.ui_filetree_file_8635()}: ${res.name}`,
			items,
			invoker: event.currentTarget as HTMLElement
		});
	}
</script>
{#snippet typeIcon(fileName: string, isFolder: boolean = false, isExp: boolean = false)}
	{@const Icon = isFolder ? (isExp ? IconFolderOpen : IconFolder) : fileIcon(fileName)}
	<span class="type-icon" class:folder={isFolder} aria-hidden="true"><Icon /></span>
{/snippet}

<!-- Il nodo radice intercetta solo lo spazio vuoto; righe e pulsanti mantengono i propri ruoli. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="tree-node"
	class:tree-root={level === 0}
	bind:this={nodeEl}
	role={level === 0 && !searchQuery.trim() ? "tree" : undefined}
	aria-label={level === 0 ? `Albero file: ${name}` : undefined}
	tabindex={level === 0 && !searchQuery.trim() ? -1 : undefined}
	onkeydown={level === 0 && !searchQuery.trim() ? handleTreeKeyDown : undefined}
	oncontextmenu={level === 0 && !searchQuery.trim() ? handleRootContainerContextMenu : undefined}
>
	{#if level === 0}
		<!-- Barra di ricerca file sempre visibile in cima al pannello FILE -->
		<div class="tree-search-bar">
			<div class="search-input-wrapper">
				{#if searchLoading}
					<span class="search-icon" aria-hidden="true"><StatusMark status="running" /></span>
				{:else}
					<span class="search-icon" aria-hidden="true">
						<IconSearch />
					</span>
				{/if}
				<input
					bind:this={searchInputRef}
					type="search"
					class="search-input"
					value={searchQuery}
					oninput={handleSearchInput}
					onkeydown={handleSearchKeyDown}
					placeholder={m.file_tree_search_placeholder()}
					aria-label={m.file_tree_search_aria()}
					aria-controls="file-search-results"
					spellcheck="false"
					autocomplete="off"
				/>
				{#if searchQuery}
					<Tooltip text={m.file_tree_clear_search()} placement="bottom">
						<button
							type="button"
							class="clear-search-btn"
							onclick={clearSearch}
							aria-label={m.file_tree_clear_search()}
						>
							<IconClose />
						</button>
					</Tooltip>
				{/if}
			</div>
			{#if searchQuery.trim()}
				<div class="search-meta">
					{#if searchLoading}
						<span class="meta-label">{m.file_tree_searching()}</span>
					{:else if searchError}
						<span class="meta-label error">{searchError}</span>
					{:else}
						<span class="meta-label">
							{searchResults.length === 1 ? m.ui_filetree_1_file_trovato_d26d() : `${searchResults.length} file trovati`}
						</span>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if level === 0 && searchQuery.trim()}
		<!-- Vista Lista Risultati Ricerca -->
		<div class="search-results" id="file-search-results" role="listbox" aria-label={m.file_tree_results_aria()}>
			{#if searchLoading && searchResults.length === 0}
				<div class="search-state loading">
					<StatusMark status="running" />
					<span>{m.ui_filetree_ricerca_file_in_corso_c572()}</span>
				</div>
			{:else if searchError}
				<div class="search-state error" role="alert">
					<span>{searchError}</span>
					<button type="button" class="retry-btn" onclick={() => void executeSearch(searchQuery)}>{m.file_tree_retry()}</button>
				</div>
			{:else if searchResults.length === 0}
				<div class="search-state empty">
					<span>{m.ui_filetree_nessun_file_corrisponde_a_b494()}<strong>{searchQuery}</strong>"</span>
					<button type="button" class="reset-btn" onclick={clearSearch}>{m.file_tree_reset_filter()}</button>
				</div>
			{:else}
				{#each searchResults as res, i (res.path)}
					{@const resStatus = gitStatuses[res.path] || null}
					{@const isSelected = i === selectedSearchIndex}
					{@const parentDir = getParentDirectory(res.path)}
					<button
						type="button"
						role="option"
						aria-selected={isSelected}
						class="search-result-row"
						class:selected={isSelected}
						class:git-d={resStatus === 'D'}
						onclick={() => handleSelectSearchResult(res)}
						onkeydown={(e) => handleSearchResultKeyDown(e, i, res)}
						oncontextmenu={(e) => handleSearchResultContextMenu(e, res)}
					>
						{@render typeIcon(res.name, res.is_dir, false)}
						<div class="result-info">
							<span class="result-name">
								{#each renderHighlightedText(res.name, res.name_indices) as seg}
									{#if seg.match}
										<mark class="match">{seg.text}</mark>
									{:else}
										{seg.text}
									{/if}
								{/each}
							</span>
							{#if parentDir}
								<span class="result-path" title={res.path}>
									{parentDir}
								</span>
							{/if}
						</div>
						{#if resStatus}
							<GitStatusMark status={resStatus} description={getStatusTitle(resStatus, res.is_dir)} />
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	{:else}
		{#if isRenaming}
			<div class="tree-row inline-edit-row" style="padding-left: {level * 12 + 8}px;">
				{#if isDir}
					<span class="arrow-icon" class:expanded={expanded}><IconChevronRight /></span>
					{@render typeIcon('folder', true, expanded)}
				{:else}
					{@render typeIcon(renameValue || name, false, false)}
				{/if}
				<form class="inline-form" onsubmit={(e) => { e.preventDefault(); void commitRename(); }}>
					<input
						bind:this={renameInputRef}
						bind:value={renameValue}
						type="text"
						class="inline-input"
						class:has-error={!!renameError}
						onkeydown={handleRenameKeyDown}
						onblur={handleRenameBlur}
						aria-label={`Rinomina ${name}`}
					/>
				</form>
			</div>
			{#if renameError}
				<div
					class="inline-error"
					role="alert"
					aria-live="polite"
					style="padding-left: {level * 12 + 28}px;"
				>
					{renameError}
				</div>
			{/if}
		{:else}
			<button
				bind:this={rowEl}
				type="button"
				class="tree-row"
				role="treeitem"
				data-tree-key={rowKey}
				aria-level={level + 1}
				aria-setsize={setSize}
				aria-posinset={posInSet}
				aria-expanded={isDir ? expanded : undefined}
				aria-selected={isDir ? undefined : false}
				tabindex={nav.isActive(rowKey) ? 0 : -1}
				class:faint={isNoisy}
				class:git-d={fileStatus === 'D'}
				style="padding-left: {level * 12 + 8}px;"
				onfocus={() => nav.setActive(rowKey)}
				onclick={toggle}
				oncontextmenu={handleRowContextMenu}
			>
				{#if isDir}
					<span class="arrow-icon" class:expanded={expanded}><IconChevronRight /></span>
					{@render typeIcon('folder', true, expanded)}
				{:else}
					{@render typeIcon(name, false, false)}
				{/if}
				<span class="name">{name}</span>
				{#if fileStatus}
					<GitStatusMark status={fileStatus} description={getStatusTitle(fileStatus, isDir)} />
				{/if}
			</button>
			{#if trashError}
				<div
					class="inline-error"
					role="alert"
					aria-live="polite"
					style="padding-left: {level * 12 + 28}px;"
				>
					{trashError}
				</div>
			{/if}
		{/if}

		{#if isDir && childrenLinger.shown}
			<div
				class={foldAnimated ? `children ${childrenLinger.leaving ? 'tray-out' : 'tray-in'}` : 'children'}
				role="group"
			>
				<div class="tray-fold-inner">
					{#if creatingType}
						<div class="tree-row inline-edit-row" style="padding-left: {(level + 1) * 12 + 8}px;">
							{#if creatingType === 'dir'}
								<span class="arrow-icon"><IconChevronRight /></span>
								{@render typeIcon('', true, false)}
							{:else}
								{@render typeIcon(creationName, false, false)}
							{/if}
							<form class="inline-form" onsubmit={(e) => { e.preventDefault(); void commitCreation(); }}>
								<input
									bind:this={creationInputRef}
									bind:value={creationName}
									type="text"
									class="inline-input"
									class:has-error={!!creationError}
									placeholder={creatingType === 'dir' ? m.file_tree_input_folder_placeholder() : m.file_tree_input_file_placeholder()}
									onkeydown={handleCreationKeyDown}
									onblur={handleCreationBlur}
									aria-label={creatingType === 'dir' ? m.ui_filetree_nome_nuova_cartella_6114() : m.ui_filetree_nome_nuovo_file_1264()}
								/>
							</form>
						</div>
						{#if creationError}
							<div
								class="inline-error"
								role="alert"
								aria-live="polite"
								style="padding-left: {(level + 1) * 12 + 28}px;"
							>
								{creationError}
							</div>
						{/if}
					{/if}

					{#if loaded}
						{#each entries as entry, i (entry.path)}
							<FileTree
								projectPath={projectPath}
								relPath={entry.path}
								name={entry.name}
								isDir={entry.is_dir}
								level={level + 1}
								posInSet={i + 1}
								setSize={entries.length}
								onFileSelect={onFileSelect}
								onFileDiff={onFileDiff}
								dirtyFilePaths={dirtyFilePaths}
								onPathRenamed={onPathRenamed}
								onPathTrashed={onPathTrashed}
							/>
						{/each}
						{#if entries.length === 0 && !creatingType}
							<div class="empty" style="padding-left: {(level + 1) * 12 + 24}px;">(empty)</div>
						{/if}
					{:else if loadError}
						<div class="load-error" style="padding-left: {(level + 1) * 12 + 24}px;">
							<span class="error-text" title={loadError}>{loadError}</span>
							<button type="button" class="retry-btn" onclick={() => void loadEntries(true)}>{m.file_tree_retry()}</button>
						</div>
					{:else}
						<div class="loading" style="padding-left: {(level + 1) * 12 + 24}px;">Loading...</div>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.tree-node {
		overflow: hidden;
		outline: none;
	}
	.tree-node.tree-root {
		min-height: 100%;
		display: flex;
		flex-direction: column;
		flex: 1;
	}

	.tree-row {
		display: flex;
		align-items: center;
		width: 100%;
		height: 22px;
		background: transparent;
		border: none;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-body);
		cursor: pointer;
		text-align: left;
		padding-right: var(--space-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		gap: 4px;
	}

	.tree-row:hover,
	.tree-row:focus-visible {
		background: var(--bg-hover);
	}

	/* Le righe vivono dentro contenitori con overflow nascosto: l'anello
	   globale va disegnato all'interno, o verrebbe tagliato sui bordi. */
	.tree-row:focus-visible,
	.search-result-row:focus-visible {
		outline-offset: -2px;
	}

	.inline-edit-row {
		background: var(--bg-hover);
		cursor: default;
	}

	.inline-form {
		display: flex;
		flex: 1;
		min-width: 0;
		height: 100%;
		align-items: center;
	}

	.inline-input {
		width: 100%;
		height: 18px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-body);
		padding: 0 4px;
	}

	/* Il campo alto 18 px sta in una riga da 22: l'anello globale da 2 px
	   resta intero solo appoggiato al bordo. */
	.inline-input:focus-visible {
		outline-offset: 0;
	}

	.inline-input.has-error {
		border-color: var(--danger);
	}

	.inline-error {
		color: var(--danger);
		font-size: var(--text-xs);
		padding-top: 2px;
		padding-bottom: 4px;
		padding-right: var(--space-2);
		line-height: 1.2;
		word-break: break-word;
	}

	/* Cartelle rumorose (bin, obj, node_modules): un gradino sotto, mai sotto AA. */
	.tree-row.faint {
		color: var(--ink-faint);
	}

	.arrow-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
		--icon-size: 12px;
		color: var(--ink-muted);
		transition: transform var(--dur-fast) var(--ease-out);
		flex-shrink: 0;
	}

	.arrow-icon.expanded {
		transform: rotate(90deg);
	}

	.type-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		color: var(--ink-faint);
	}

	.type-icon.folder {
		color: var(--ink-muted);
	}

	/* Piegatura dell'albero alla durata delle righe: si apre decine di volte
	   al minuto, e su cartelle grandi il layout per fotogramma dura la meta'. */
	.children {
		--dur-tray: var(--dur-row);
	}

	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Lo stato Git e' la lettera di GitStatusMark: il nome resta --ink e il
	   file eliminato si legge dal segno barrato, non dal colore. */
	.tree-row.git-d .name,
	.search-result-row.git-d .result-name {
		text-decoration: line-through;
	}

	.empty, .loading {
		height: 22px;
		display: flex;
		align-items: center;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.load-error {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-right: var(--space-2);
		min-height: 22px;
		color: var(--danger);
		font-size: var(--text-xs);
	}

	.load-error .error-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.load-error .retry-btn {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		padding: 1px 6px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.load-error .retry-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	/* Barra di ricerca file */
	.tree-search-bar {
		padding: var(--space-2) var(--space-2) var(--space-1);
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.search-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		height: 26px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		padding: 0 6px;
		gap: 6px;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	/* Il campo non disegna l'anello: lo porta l'involucro, a 2 px come ovunque. */
	.search-input-wrapper:has(.search-input:focus-visible) {
		border-color: var(--line-strong);
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.search-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-faint);
		--icon-size: 13px;
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		height: 100%;
		background: transparent;
		border: none;
		outline: none;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-body);
		padding: 0;
	}

	.search-input::placeholder {
		color: var(--ink-faint);
	}

	.search-input::-webkit-search-decoration,
	.search-input::-webkit-search-cancel-button,
	.search-input::-webkit-search-results-button,
	.search-input::-webkit-search-results-decoration {
		display: none;
	}

	.clear-search-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		--icon-size: 12px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-faint);
		cursor: pointer;
		flex-shrink: 0;
	}

	.clear-search-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.search-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 2px;
	}

	.meta-label {
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.meta-label.error {
		color: var(--danger);
	}

	/* Lista Risultati Ricerca */
	.search-results {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 4px 0;
	}

	.search-result-row {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 28px;
		padding: 3px var(--space-2);
		background: transparent;
		border: none;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-body);
		cursor: pointer;
		text-align: left;
		gap: 6px;
	}

	.search-result-row:hover,
	.search-result-row:focus-visible,
	.search-result-row.selected {
		background: var(--bg-hover);
	}

	.result-info {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		line-height: 1.2;
	}

	.result-name {
		font-size: var(--text-body);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result-path {
		font-size: var(--text-meta);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Lettere trovate come nelle palette: sottolineatura --warn da 2 px. */
	mark.match {
		background: transparent;
		color: inherit;
		font-weight: 700;
		text-decoration: underline 2px var(--warn);
		text-underline-offset: 2px;
	}


	.search-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-4) var(--space-2);
		gap: var(--space-2);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		text-align: center;
	}

	.search-state.error {
		color: var(--danger);
	}

	.search-state .reset-btn,
	.search-state .retry-btn {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-caption);
		padding: 3px 8px;
		cursor: pointer;
	}

	.search-state .reset-btn:hover,
	.search-state .retry-btn:hover {
		background: var(--bg-hover);
	}
</style>
