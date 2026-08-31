<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { slide } from 'svelte/transition';
	import { setContext, getContext, tick } from 'svelte';
	import FileTree from './FileTree.svelte';
	import {
		IconChevronRight,
		IconFile,
		IconFolderOpen,
		IconRename,
		IconRefresh,
		IconCopy,
		IconTerminal,
		IconExternalLink,
		IconGitBranch,
		IconTrash,
		IconNewFile,
		IconNewFolder
	} from '$lib/icons';
	import { contextMenu, type ContextMenuEntry } from '$lib/contextMenu.svelte';
	import { joinProjectPath, isWindows } from '$lib/utils/paths';

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
	let errorKey = $derived(`err:${relPath}`);

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

	// Una riga chiusa resta nel DOM per tutta la transizione di slide: va
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
		if (!treeEl) return [];
		return Array.from(treeEl.querySelectorAll<HTMLElement>('[data-tree-key]')).filter(isRowLive);
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
		if (!treeEl || findRow(activeKey)) return;
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

	async function loadGitStatus() {
		if (!projectPath) return;
		try {
			const res: { statuses: Record<string, string> } = await invoke('project_git_status', { projectPath });
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
				loaded = false;
				loadError = null;
				entries = [];
				if (!isNoisy) {
					expanded = true;
					void loadEntries();
				}
			}
			void loadGitStatus();

			const handleRefresh = () => {
				void loadGitStatus();
			};

			window.addEventListener('git-status-refresh', handleRefresh);
			window.addEventListener('focus', handleRefresh);

			return () => {
				window.removeEventListener('git-status-refresh', handleRefresh);
				window.removeEventListener('focus', handleRefresh);
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
			return status === 'U' ? 'Contiene file non tracciati' : 'Contiene modifiche git (in attesa di commit)';
		}
		switch (status) {
			case 'M': return 'Modificato (in attesa di commit)';
			case 'A': return 'Aggiunto (in attesa di commit)';
			case 'U': return 'Non tracciato (in attesa di commit)';
			case 'D': return 'Rimosso (in attesa di commit)';
			case 'R': return 'Rinominato (in attesa di commit)';
			case 'C': return 'Conflitto git';
			default: return 'Modificato (in attesa di commit)';
		}
	}

	async function loadEntries(force = false) {
		if (loaded && !force) return;
		loadError = null;
		try {
			entries = await invoke('tree_read', { projectPath, rel: relPath });
			loaded = true;
		} catch (e) {
			// Conserviamo l'errore reale per mostrare il messaggio all'utente con pulsante di riprova
			loadError = String(e);
		}
	}

	async function toggle() {
		if (!isDir) {
			if (onFileSelect) onFileSelect(relPath);
			return;
		}

		expanded = !expanded;
		if (expanded && (!loaded || loadError)) {
			await loadEntries();
		}
	}

	async function copyText(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch (err) {
			console.error('Errore copia negli appunti:', err);
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
			console.error('Errore apertura terminale:', err);
		}
	}

	async function refreshRoot() {
		await loadEntries(true);
		await loadGitStatus();
	}

	// Creazione inline
	async function startCreation(type: 'file' | 'dir') {
		if (!expanded) {
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
		try {
			await invoke('path_trash', { projectPath, rel: relPath });
			if (parentRefresh) {
				await parentRefresh();
			}
			onPathTrashed?.(relPath, isDir);
			window.dispatchEvent(new CustomEvent('git-status-refresh'));
		} catch (err) {
			console.error('Errore spostamento nel cestino:', err);
		}
	}

	// Costruzione dei menu contestuali
	function openFileMenu(event: MouseEvent) {
		const fullPath = joinProjectPath(projectPath, relPath);
		const revealLabel = isWindows ? 'Mostra in Esplora file' : 'Mostra nel Finder';

		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: 'Apri',
				icon: IconFile,
				run: () => onFileSelect?.(relPath)
			}
		];

		if (fileStatus && onFileDiff) {
			items.push({
				kind: 'item',
				label: 'Diff Git',
				icon: IconGitBranch,
				run: () => onFileDiff?.(relPath)
			});
		}

		items.push(
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Copia percorso relativo',
				icon: IconCopy,
				run: () => void copyText(relPath)
			},
			{
				kind: 'item',
				label: 'Copia percorso completo',
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
				label: 'Rinomina…',
				icon: IconRename,
				disabled: isDirty,
				hint: isDirty ? 'Salva le modifiche prima di rinominare' : undefined,
				run: () => void startRename()
			},
			{
				kind: 'item',
				label: 'Sposta nel Cestino',
				icon: IconTrash,
				danger: true,
				disabled: isDirty,
				hint: isDirty ? 'Salva le modifiche prima di eliminare' : undefined,
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
		const revealLabel = isWindows ? 'Mostra in Esplora file' : 'Mostra nel Finder';

		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: 'Nuovo file…',
				icon: IconNewFile,
				run: () => void startCreation('file')
			},
			{
				kind: 'item',
				label: 'Nuova cartella…',
				icon: IconNewFolder,
				run: () => void startCreation('dir')
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Aggiorna',
				icon: IconRefresh,
				run: () => void loadEntries(true)
			},
			{
				kind: 'item',
				label: 'Apri nel terminale',
				icon: IconTerminal,
				run: () => void openInTerminal(relPath)
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Copia percorso relativo',
				icon: IconCopy,
				run: () => void copyText(relPath)
			},
			{
				kind: 'item',
				label: 'Copia percorso completo',
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
				label: 'Rinomina…',
				icon: IconRename,
				disabled: isDirty,
				hint: isDirty ? 'Salva le modifiche prima di rinominare' : undefined,
				run: () => void startRename()
			},
			{
				kind: 'item',
				label: 'Sposta nel Cestino',
				icon: IconTrash,
				danger: true,
				disabled: isDirty,
				hint: isDirty ? 'Salva le modifiche prima di eliminare' : undefined,
				run: () => void trashItem()
			}
		];

		contextMenu.open(event, {
			label: `Cartella: ${name}`,
			items,
			invoker: event.currentTarget as HTMLElement
		});
	}

	function openRootMenu(event: MouseEvent) {
		const revealLabel = isWindows ? 'Mostra in Esplora file' : 'Mostra nel Finder';

		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: 'Nuovo file…',
				icon: IconNewFile,
				run: () => void startCreation('file')
			},
			{
				kind: 'item',
				label: 'Nuova cartella…',
				icon: IconNewFolder,
				run: () => void startCreation('dir')
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: 'Aggiorna',
				icon: IconRefresh,
				run: () => void refreshRoot()
			},
			{
				kind: 'item',
				label: 'Copia percorso completo',
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
				label: 'Apri nel terminale',
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

	function getFileType(filename: string): string {
		const ext = filename.split('.').pop()?.toLowerCase() || '';
		if (ext === 'md' || ext === 'markdown') return 'md';
		if (ext === 'json' || ext === 'jsonc' || ext === 'json5') return 'json';
		if (ext === 'vb' || ext === 'vbs' || ext === 'vbproj') return 'vb';
		if (ext === 'aspx' || ext === 'ascx' || ext === 'master' || ext === 'asmx' || ext === 'ashx') return 'aspx';
		if (ext === 'cs' || ext === 'csx' || ext === 'csproj' || ext === 'sln') return 'cs';
		if (ext === 'svg') return 'svg';
		if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'js';
		if (ext === 'ts' || ext === 'tsx' || ext === 'mts') return 'ts';
		if (ext === 'html' || ext === 'htm') return 'html';
		if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
		if (ext === 'sql' || ext === 'db' || ext === 'sqlite' || ext === 'sqlite3' || ext === 'mdf') return 'sql';
		if (ext === 'xml' || ext === 'config' || ext === 'xaml' || ext === 'props' || ext === 'targets') return 'xml';
		if (['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp'].includes(ext)) return 'image';
		if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archive';
		if (ext === 'pdf') return 'pdf';
		return 'file';
	}
</script>

<!-- Il nodo radice intercetta solo lo spazio vuoto; righe e pulsanti mantengono i propri ruoli. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="tree-node"
	class:tree-root={level === 0}
	oncontextmenu={level === 0 ? handleRootContainerContextMenu : undefined}
>
	{#if isRenaming}
		<div class="tree-row inline-edit-row" style="padding-left: {level * 12 + 8}px;">
			{#if isDir}
				<span class="arrow-icon" class:expanded={expanded}><IconChevronRight /></span>
				<span class="type-icon folder">
					{#if expanded}
						<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.2">
							<path d="M1.5 3.5h4l1.5 2h7.5v2.5h-11.5v5.5l-1.5-6z" fill-opacity="0.3"/>
						</svg>
					{:else}
						<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.2">
							<path d="M1.5 3.5h4l1.5 2h7.5v8h-13z" fill-opacity="0.2"/>
						</svg>
					{/if}
				</span>
			{:else}
				{@const fileType = getFileType(renameValue || name)}
				<span class="type-icon file {fileType}">
					{#if fileType === 'md'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.15"/>
							<path d="M4 11V5l2.5 3L9 5v6M12 9l-1.5 2L9 9" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					{:else if fileType === 'json'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
							<path d="M5 3c-1 0-1.5.5-1.5 1.5v2c0 1-.5 1.5-1.5 1.5 1 0 1.5.5 1.5 1.5v2c0 1 .5 1.5 1.5 1.5M11 3c1 0 1.5.5 1.5 1.5v2c0 1 .5 1.5 1.5 1.5-1 0-1.5.5-1.5 1.5v2c0 1-.5 1.5-1.5 1.5" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'vb'}
						<svg viewBox="0 0 16 16" fill="none">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.2"/>
							<text x="3.5" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="currentColor">VB</text>
						</svg>
					{:else if fileType === 'aspx'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.2" stroke-width="1.2"/>
							<path d="M5 6l-2 2 2 2M11 6l2 2-2 2M9 5l-2 6" stroke-width="1.1" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'cs'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.25" stroke-width="1.2"/>
							<path d="M5.5 6.5C5 6 4 6.5 4 8s1 2 1.5 1.5M9 6v4M11 6v4M8 7.5h4M8 9.5h4" stroke-width="1.1" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'svg'}
						<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.2">
							<circle cx="4" cy="12" r="1.5"/>
							<circle cx="12" cy="4" r="1.5"/>
							<path d="M4 12C4 7 12 9 12 4" fill="none" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'js'}
						<svg viewBox="0 0 16 16" fill="none">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.2"/>
							<text x="3.8" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="currentColor">JS</text>
						</svg>
					{:else if fileType === 'ts'}
						<svg viewBox="0 0 16 16" fill="none">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.2"/>
							<text x="3.8" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="currentColor">TS</text>
						</svg>
					{:else if fileType === 'html'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
							<path d="M5.5 5L3 8l2.5 3M10.5 5l2.5 3-2.5 3M9 4l-2 8"/>
						</svg>
					{:else if fileType === 'css'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
							<path d="M4 6h8M4 10h8M6.5 3.5l-1 9M10.5 3.5l-1 9"/>
						</svg>
					{:else if fileType === 'sql'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
							<ellipse cx="8" cy="4" rx="5" ry="2"/>
							<path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8"/>
						</svg>
					{:else if fileType === 'xml'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
							<rect x="3" y="2" width="10" height="12" rx="1.5" fill="currentColor" fill-opacity="0.15"/>
							<path d="M6 6l-1.5 2L6 10M10 6l1.5 2-1.5 2"/>
						</svg>
					{:else if fileType === 'image'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
							<rect x="2" y="3" width="12" height="10" rx="1.5"/>
							<circle cx="5.5" cy="6" r="1" fill="currentColor"/>
							<path d="M14 11l-3.5-3.5-4 4-2-2L2 11.5" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'archive'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
							<path d="M3 4h10v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" fill="currentColor" fill-opacity="0.15"/>
							<path d="M2 2h12v2H2zM8 6v3M6.5 7.5h3"/>
						</svg>
					{:else if fileType === 'pdf'}
						<svg viewBox="0 0 16 16" fill="none">
							<rect x="3" y="2" width="10" height="12" rx="1.5" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.2"/>
							<text x="3.5" y="10.5" font-family="sans-serif" font-weight="bold" font-size="6.5" fill="currentColor">PDF</text>
						</svg>
					{:else}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.6">
							<path d="M4 2.5h5.5L13 6v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1v-10a1 1 0 011-1z"/>
							<path d="M9.5 2.5V6H13"/>
						</svg>
					{/if}
				</span>
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
			class="tree-row" 
			class:faint={isNoisy}
			class:git-m={fileStatus === 'M'}
			class:git-a={fileStatus === 'A'}
			class:git-u={fileStatus === 'U'}
			class:git-d={fileStatus === 'D'}
			class:git-r={fileStatus === 'R'}
			class:git-c={fileStatus === 'C'}
			style="padding-left: {level * 12 + 8}px;"
			onclick={toggle}
			oncontextmenu={handleRowContextMenu}
		>
			{#if isDir}
				<span class="arrow-icon" class:expanded={expanded}><IconChevronRight /></span>
				<span class="type-icon folder">
					{#if expanded}
						<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.2">
							<path d="M1.5 3.5h4l1.5 2h7.5v2.5h-11.5v5.5l-1.5-6z" fill-opacity="0.3"/>
						</svg>
					{:else}
						<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.2">
							<path d="M1.5 3.5h4l1.5 2h7.5v8h-13z" fill-opacity="0.2"/>
						</svg>
					{/if}
				</span>
			{:else}
				{@const fileType = getFileType(name)}
				<span class="type-icon file {fileType}">
					{#if fileType === 'md'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.15"/>
							<path d="M4 11V5l2.5 3L9 5v6M12 9l-1.5 2L9 9" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					{:else if fileType === 'json'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
							<path d="M5 3c-1 0-1.5.5-1.5 1.5v2c0 1-.5 1.5-1.5 1.5 1 0 1.5.5 1.5 1.5v2c0 1 .5 1.5 1.5 1.5M11 3c1 0 1.5.5 1.5 1.5v2c0 1 .5 1.5 1.5 1.5-1 0-1.5.5-1.5 1.5v2c0 1-.5 1.5-1.5 1.5" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'vb'}
						<svg viewBox="0 0 16 16" fill="none">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.2"/>
							<text x="3.5" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="currentColor">VB</text>
						</svg>
					{:else if fileType === 'aspx'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.2" stroke-width="1.2"/>
							<path d="M5 6l-2 2 2 2M11 6l2 2-2 2M9 5l-2 6" stroke-width="1.1" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'cs'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.25" stroke-width="1.2"/>
							<path d="M5.5 6.5C5 6 4 6.5 4 8s1 2 1.5 1.5M9 6v4M11 6v4M8 7.5h4M8 9.5h4" stroke-width="1.1" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'svg'}
						<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.2">
							<circle cx="4" cy="12" r="1.5"/>
							<circle cx="12" cy="4" r="1.5"/>
							<path d="M4 12C4 7 12 9 12 4" fill="none" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'js'}
						<svg viewBox="0 0 16 16" fill="none">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.2"/>
							<text x="3.8" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="currentColor">JS</text>
						</svg>
					{:else if fileType === 'ts'}
						<svg viewBox="0 0 16 16" fill="none">
							<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.2"/>
							<text x="3.8" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="currentColor">TS</text>
						</svg>
					{:else if fileType === 'html'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
							<path d="M5.5 5L3 8l2.5 3M10.5 5l2.5 3-2.5 3M9 4l-2 8"/>
						</svg>
					{:else if fileType === 'css'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
							<path d="M4 6h8M4 10h8M6.5 3.5l-1 9M10.5 3.5l-1 9"/>
						</svg>
					{:else if fileType === 'sql'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
							<ellipse cx="8" cy="4" rx="5" ry="2"/>
							<path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8"/>
						</svg>
					{:else if fileType === 'xml'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
							<rect x="3" y="2" width="10" height="12" rx="1.5" fill="currentColor" fill-opacity="0.15"/>
							<path d="M6 6l-1.5 2L6 10M10 6l1.5 2-1.5 2"/>
						</svg>
					{:else if fileType === 'image'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
							<rect x="2" y="3" width="12" height="10" rx="1.5"/>
							<circle cx="5.5" cy="6" r="1" fill="currentColor"/>
							<path d="M14 11l-3.5-3.5-4 4-2-2L2 11.5" stroke-linecap="round"/>
						</svg>
					{:else if fileType === 'archive'}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
							<path d="M3 4h10v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" fill="currentColor" fill-opacity="0.15"/>
							<path d="M2 2h12v2H2zM8 6v3M6.5 7.5h3"/>
						</svg>
					{:else if fileType === 'pdf'}
						<svg viewBox="0 0 16 16" fill="none">
							<rect x="3" y="2" width="10" height="12" rx="1.5" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.2"/>
							<text x="3.5" y="10.5" font-family="sans-serif" font-weight="bold" font-size="6.5" fill="currentColor">PDF</text>
						</svg>
					{:else}
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.6">
							<path d="M4 2.5h5.5L13 6v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1v-10a1 1 0 011-1z"/>
							<path d="M9.5 2.5V6H13"/>
						</svg>
					{/if}
				</span>
			{/if}
			<span class="name">{name}</span>
			{#if fileStatus}
				<span 
					class="git-badge status-{fileStatus}" 
					class:dir-badge={isDir}
					title={getStatusTitle(fileStatus, isDir)}
				>
					{isDir ? '•' : fileStatus}
				</span>
			{/if}
		</button>
	{/if}

	{#if isDir && expanded}
		<div class="children" transition:slide={{ duration: 180 }}>
			{#if creatingType}
				<div class="tree-row inline-edit-row" style="padding-left: {(level + 1) * 12 + 8}px;">
					{#if creatingType === 'dir'}
						<span class="arrow-icon"><IconChevronRight /></span>
						<span class="type-icon folder">
							<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.2">
								<path d="M1.5 3.5h4l1.5 2h7.5v8h-13z" fill-opacity="0.2"/>
							</svg>
						</span>
					{:else}
						{@const fileType = getFileType(creationName)}
						<span class="type-icon file {fileType}">
							{#if fileType === 'md'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
									<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.15"/>
									<path d="M4 11V5l2.5 3L9 5v6M12 9l-1.5 2L9 9" stroke-linecap="round" stroke-linejoin="round"/>
								</svg>
							{:else if fileType === 'json'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
									<path d="M5 3c-1 0-1.5.5-1.5 1.5v2c0 1-.5 1.5-1.5 1.5 1 0 1.5.5 1.5 1.5v2c0 1 .5 1.5 1.5 1.5M11 3c1 0 1.5.5 1.5 1.5v2c0 1 .5 1.5 1.5 1.5-1 0-1.5.5-1.5 1.5v2c0 1-.5 1.5-1.5 1.5" stroke-linecap="round"/>
								</svg>
							{:else if fileType === 'vb'}
								<svg viewBox="0 0 16 16" fill="none">
									<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.2"/>
									<text x="3.5" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="currentColor">VB</text>
								</svg>
							{:else if fileType === 'aspx'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
									<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.2" stroke-width="1.2"/>
									<path d="M5 6l-2 2 2 2M11 6l2 2-2 2M9 5l-2 6" stroke-width="1.1" stroke-linecap="round"/>
								</svg>
							{:else if fileType === 'cs'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
									<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.25" stroke-width="1.2"/>
									<path d="M5.5 6.5C5 6 4 6.5 4 8s1 2 1.5 1.5M9 6v4M11 6v4M8 7.5h4M8 9.5h4" stroke-width="1.1" stroke-linecap="round"/>
								</svg>
							{:else if fileType === 'svg'}
								<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.2">
									<circle cx="4" cy="12" r="1.5"/>
									<circle cx="12" cy="4" r="1.5"/>
									<path d="M4 12C4 7 12 9 12 4" fill="none" stroke-linecap="round"/>
								</svg>
							{:else if fileType === 'js'}
								<svg viewBox="0 0 16 16" fill="none">
									<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.2"/>
									<text x="3.8" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="currentColor">JS</text>
								</svg>
							{:else if fileType === 'ts'}
								<svg viewBox="0 0 16 16" fill="none">
									<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.2"/>
									<text x="3.8" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="currentColor">TS</text>
								</svg>
							{:else if fileType === 'html'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
									<path d="M5.5 5L3 8l2.5 3M10.5 5l2.5 3-2.5 3M9 4l-2 8"/>
								</svg>
							{:else if fileType === 'css'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
									<path d="M4 6h8M4 10h8M6.5 3.5l-1 9M10.5 3.5l-1 9"/>
								</svg>
							{:else if fileType === 'sql'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
									<ellipse cx="8" cy="4" rx="5" ry="2"/>
									<path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8"/>
								</svg>
							{:else if fileType === 'xml'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
									<rect x="3" y="2" width="10" height="12" rx="1.5" fill="currentColor" fill-opacity="0.15"/>
									<path d="M6 6l-1.5 2L6 10M10 6l1.5 2-1.5 2"/>
								</svg>
							{:else if fileType === 'image'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
									<rect x="2" y="3" width="12" height="10" rx="1.5"/>
									<circle cx="5.5" cy="6" r="1" fill="currentColor"/>
									<path d="M14 11l-3.5-3.5-4 4-2-2L2 11.5" stroke-linecap="round"/>
								</svg>
							{:else if fileType === 'archive'}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
									<path d="M3 4h10v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" fill="currentColor" fill-opacity="0.15"/>
									<path d="M2 2h12v2H2zM8 6v3M6.5 7.5h3"/>
								</svg>
							{:else if fileType === 'pdf'}
								<svg viewBox="0 0 16 16" fill="none">
									<rect x="3" y="2" width="10" height="12" rx="1.5" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.2"/>
									<text x="3.5" y="10.5" font-family="sans-serif" font-weight="bold" font-size="6.5" fill="currentColor">PDF</text>
								</svg>
							{:else}
								<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.6">
									<path d="M4 2.5h5.5L13 6v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1v-10a1 1 0 011-1z"/>
									<path d="M9.5 2.5V6H13"/>
								</svg>
							{/if}
						</span>
					{/if}
					<form class="inline-form" onsubmit={(e) => { e.preventDefault(); void commitCreation(); }}>
						<input
							bind:this={creationInputRef}
							bind:value={creationName}
							type="text"
							class="inline-input"
							class:has-error={!!creationError}
							placeholder={creatingType === 'dir' ? 'Nome cartella' : 'Nome file'}
							onkeydown={handleCreationKeyDown}
							onblur={handleCreationBlur}
							aria-label={creatingType === 'dir' ? 'Nome nuova cartella' : 'Nome nuovo file'}
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
				{#each entries as entry}
					<FileTree
						projectPath={projectPath}
						relPath={entry.path}
						name={entry.name}
						isDir={entry.is_dir}
						level={level + 1}
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
					<button type="button" class="retry-btn" onclick={() => void loadEntries(true)}>Riprova</button>
				</div>
			{:else}
				<div class="loading" style="padding-left: {(level + 1) * 12 + 24}px;">Loading...</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tree-node {
		overflow: hidden;
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
		font-size: var(--text-sm);
		cursor: pointer;
		text-align: left;
		padding-right: var(--space-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		gap: 4px;
	}

	.tree-row:hover {
		background: var(--bg-hover);
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
		background: var(--bg-card);
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		padding: 0 4px;
		outline: none;
	}

	.inline-input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}

	.inline-input.has-error {
		border-color: var(--danger);
		box-shadow: 0 0 0 1px var(--danger);
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

	.tree-row.faint {
		color: var(--ink-faint);
		opacity: 0.6;
	}

	.arrow-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
		--icon-size: 12px;
		color: var(--ink-muted);
		transition: transform 0.18s ease-out;
		flex-shrink: 0;
	}

	.arrow-icon.expanded {
		transform: rotate(90deg);
	}

	.type-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 15px;
		height: 15px;
		flex-shrink: 0;
	}

	.type-icon svg {
		width: 14px;
		height: 14px;
	}

	/* Il colore dell'icona vive nel foglio di stile, non nell'SVG: un solo
	   token per tipo, stessa L/C per tutti. */
	.type-icon { color: var(--ink-faint); }
	.type-icon.folder  { color: var(--icon-folder); }
	.type-icon.md      { color: var(--icon-md); }
	.type-icon.json    { color: var(--icon-json); }
	.type-icon.vb      { color: var(--icon-vb); }
	.type-icon.aspx    { color: var(--icon-aspx); }
	.type-icon.cs      { color: var(--icon-cs); }
	.type-icon.svg     { color: var(--icon-svg); }
	.type-icon.js      { color: var(--icon-js); }
	.type-icon.ts      { color: var(--icon-ts); }
	.type-icon.html    { color: var(--icon-html); }
	.type-icon.css     { color: var(--icon-css); }
	.type-icon.sql     { color: var(--icon-sql); }
	.type-icon.xml     { color: var(--icon-xml); }
	.type-icon.image   { color: var(--icon-image); }
	.type-icon.archive { color: var(--icon-archive); }
	.type-icon.pdf     { color: var(--icon-pdf); }

	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.git-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
		padding: 1px 3px;
		border-radius: var(--radius-sm);
		margin-left: auto;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.git-badge.dir-badge {
		font-size: 12px;
		padding: 0 2px;
	}

	.tree-row.git-m .name, .git-badge.status-M {
		color: var(--git-modified);
	}
	.tree-row.git-a .name, .git-badge.status-A {
		color: var(--git-added);
	}
	.tree-row.git-u .name, .git-badge.status-U {
		color: var(--git-untracked);
	}
	.tree-row.git-d .name, .git-badge.status-D {
		color: var(--git-deleted);
		text-decoration: line-through;
	}
	.tree-row.git-r .name, .git-badge.status-R {
		color: var(--git-renamed);
	}
	.tree-row.git-c .name, .git-badge.status-C {
		color: var(--git-conflict);
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
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		padding: 1px 6px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.load-error .retry-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}
</style>
