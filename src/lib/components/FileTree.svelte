<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { slide } from 'svelte/transition';
	import { setContext, getContext } from 'svelte';
	import FileTree from './FileTree.svelte';
	let { projectPath, relPath = "", name = "src", isDir = true, level = 0, onFileSelect } = $props<{
		projectPath: string,
		relPath?: string,
		name?: string,
		isDir?: boolean,
		level?: number,
		onFileSelect?: (path: string) => void
	}>();

	let expanded = $state(false);
	let loaded = $state(false);
	let entries = $state<{name: string, path: string, is_dir: boolean}[]>([]);

	const NOISY_DIRS = ['bin', 'obj', '.vs', 'packages', 'node_modules'];
	let isNoisy = $derived(NOISY_DIRS.includes(name));

	let rootGitStatuses = $state<Record<string, string>>({});

	if (level === 0) {
		setContext('gitStatusesCtx', () => rootGitStatuses);
	}
	const getGitStatuses = getContext<() => Record<string, string>>('gitStatusesCtx');
	let gitStatuses = $derived(level === 0 ? rootGitStatuses : (getGitStatuses ? getGitStatuses() : {}));

	async function loadGitStatus() {
		if (!projectPath) return;
		try {
			const res: { statuses: Record<string, string> } = await invoke('project_git_status', { projectPath });
			rootGitStatuses = res.statuses || {};
		} catch (e) {
			console.error("Failed to fetch git status", e);
		}
	}

	let initialized = false;

	$effect(() => {
		if (level === 0 && projectPath) {
			if (!initialized && !isNoisy) {
				initialized = true;
				expanded = true;
				loadEntries();
			}
			loadGitStatus();

			const handleRefresh = () => {
				loadGitStatus();
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

	async function loadEntries() {
		if (loaded) return;
		try {
			entries = await invoke('tree_read', { projectPath, rel: relPath });
			loaded = true;
		} catch (e) {
			console.error("Failed to load directory", e);
		}
	}

	async function toggle() {
		if (!isDir) {
			if (onFileSelect) onFileSelect(relPath);
			return;
		}

		expanded = !expanded;
		if (expanded && !loaded) {
			await loadEntries();
		}
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

<div class="tree-node">
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
	>
		{#if isDir}
			<span class="arrow-icon" class:expanded={expanded}>▸</span>
			<span class="type-icon folder">
				{#if expanded}
					<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
						<path d="M1.5 3.5h4l1.5 2h7.5v2.5h-11.5v5.5l-1.5-6z" fill="#E5A93C" fill-opacity="0.3" stroke="#E5A93C"/>
					</svg>
				{:else}
					<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
						<path d="M1.5 3.5h4l1.5 2h7.5v8h-13z" fill="#E5A93C" fill-opacity="0.2" stroke="#E5A93C"/>
					</svg>
				{/if}
			</span>
		{:else}
			{@const fileType = getFileType(name)}
			<span class="type-icon file {fileType}">
				{#if fileType === 'md'}
					<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
						<rect x="2" y="2" width="12" height="12" rx="2" stroke="#42a5f5" fill="#42a5f5" fill-opacity="0.15"/>
						<path d="M4 11V5l2.5 3L9 5v6M12 9l-1.5 2L9 9" stroke="#42a5f5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				{:else if fileType === 'json'}
					<svg viewBox="0 0 16 16" fill="none" stroke="#fbc02d" stroke-width="1.3">
						<path d="M5 3c-1 0-1.5.5-1.5 1.5v2c0 1-.5 1.5-1.5 1.5 1 0 1.5.5 1.5 1.5v2c0 1 .5 1.5 1.5 1.5M11 3c1 0 1.5.5 1.5 1.5v2c0 1 .5 1.5 1.5 1.5-1 0-1.5.5-1.5 1.5v2c0 1-.5 1.5-1.5 1.5" stroke-linecap="round"/>
					</svg>
				{:else if fileType === 'vb'}
					<svg viewBox="0 0 16 16" fill="none">
						<rect x="2" y="2" width="12" height="12" rx="2" fill="#7b1fa2" fill-opacity="0.2" stroke="#ab47bc" stroke-width="1.2"/>
						<text x="3.5" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="#e1bee7">VB</text>
					</svg>
				{:else if fileType === 'aspx'}
					<svg viewBox="0 0 16 16" fill="none">
						<rect x="2" y="2" width="12" height="12" rx="2" fill="#e65100" fill-opacity="0.2" stroke="#ff7043" stroke-width="1.2"/>
						<path d="M5 6l-2 2 2 2M11 6l2 2-2 2M9 5l-2 6" stroke="#ff8a65" stroke-width="1.1" stroke-linecap="round"/>
					</svg>
				{:else if fileType === 'cs'}
					<svg viewBox="0 0 16 16" fill="none">
						<rect x="2" y="2" width="12" height="12" rx="2" fill="#1b5e20" fill-opacity="0.25" stroke="#66bb6a" stroke-width="1.2"/>
						<path d="M5.5 6.5C5 6 4 6.5 4 8s1 2 1.5 1.5M9 6v4M11 6v4M8 7.5h4M8 9.5h4" stroke="#81c784" stroke-width="1.1" stroke-linecap="round"/>
					</svg>
				{:else if fileType === 'svg'}
					<svg viewBox="0 0 16 16" fill="none" stroke="#ff4081" stroke-width="1.2">
						<circle cx="4" cy="12" r="1.5" fill="#ff4081"/>
						<circle cx="12" cy="4" r="1.5" fill="#ff4081"/>
						<path d="M4 12C4 7 12 9 12 4" stroke-linecap="round"/>
					</svg>
				{:else if fileType === 'js'}
					<svg viewBox="0 0 16 16" fill="none">
						<rect x="2" y="2" width="12" height="12" rx="2" fill="#f57f17" fill-opacity="0.25" stroke="#ffee58" stroke-width="1.2"/>
						<text x="3.8" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="#fff59d">JS</text>
					</svg>
				{:else if fileType === 'ts'}
					<svg viewBox="0 0 16 16" fill="none">
						<rect x="2" y="2" width="12" height="12" rx="2" fill="#0277bd" fill-opacity="0.25" stroke="#29b6f6" stroke-width="1.2"/>
						<text x="3.8" y="11.5" font-family="sans-serif" font-weight="bold" font-size="8.5" fill="#81d4fa">TS</text>
					</svg>
				{:else if fileType === 'html'}
					<svg viewBox="0 0 16 16" fill="none" stroke="#ef5350" stroke-width="1.3" stroke-linecap="round">
						<path d="M5.5 5L3 8l2.5 3M10.5 5l2.5 3-2.5 3M9 4l-2 8"/>
					</svg>
				{:else if fileType === 'css'}
					<svg viewBox="0 0 16 16" fill="none" stroke="#26c6da" stroke-width="1.3" stroke-linecap="round">
						<path d="M4 6h8M4 10h8M6.5 3.5l-1 9M10.5 3.5l-1 9"/>
					</svg>
				{:else if fileType === 'sql'}
					<svg viewBox="0 0 16 16" fill="none" stroke="#26a69a" stroke-width="1.2">
						<ellipse cx="8" cy="4" rx="5" ry="2"/>
						<path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8"/>
					</svg>
				{:else if fileType === 'xml'}
					<svg viewBox="0 0 16 16" fill="none" stroke="#8d6e63" stroke-width="1.2" stroke-linecap="round">
						<rect x="3" y="2" width="10" height="12" rx="1.5" fill="#8d6e63" fill-opacity="0.15"/>
						<path d="M6 6l-1.5 2L6 10M10 6l1.5 2-1.5 2"/>
					</svg>
				{:else if fileType === 'image'}
					<svg viewBox="0 0 16 16" fill="none" stroke="#9ccc65" stroke-width="1.2">
						<rect x="2" y="3" width="12" height="10" rx="1.5"/>
						<circle cx="5.5" cy="6" r="1" fill="#9ccc65"/>
						<path d="M14 11l-3.5-3.5-4 4-2-2L2 11.5" stroke-linecap="round"/>
					</svg>
				{:else if fileType === 'archive'}
					<svg viewBox="0 0 16 16" fill="none" stroke="#ffa726" stroke-width="1.2">
						<path d="M3 4h10v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" fill="#ffa726" fill-opacity="0.15"/>
						<path d="M2 2h12v2H2zM8 6v3M6.5 7.5h3"/>
					</svg>
				{:else if fileType === 'pdf'}
					<svg viewBox="0 0 16 16" fill="none">
						<rect x="3" y="2" width="10" height="12" rx="1.5" fill="#b71c1c" fill-opacity="0.2" stroke="#ef5350" stroke-width="1.2"/>
						<text x="3.5" y="10.5" font-family="sans-serif" font-weight="bold" font-size="6.5" fill="#ef9a9a">PDF</text>
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

	{#if isDir && expanded}
		<div class="children" transition:slide={{ duration: 180 }}>
			{#if loaded}
				{#each entries as entry}
					<FileTree 
						projectPath={projectPath} 
						relPath={entry.path}
						name={entry.name}
						isDir={entry.is_dir}
						level={level + 1}
						onFileSelect={onFileSelect}
					/>
				{/each}
				{#if entries.length === 0}
					<div class="empty" style="padding-left: {(level + 1) * 12 + 24}px;">(empty)</div>
				{/if}
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
		font-size: 9px;
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
		border-radius: 3px;
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
		color: var(--git-modified, #e5a93c);
	}
	.tree-row.git-a .name, .git-badge.status-A {
		color: var(--git-added, #4caf50);
	}
	.tree-row.git-u .name, .git-badge.status-U {
		color: var(--git-untracked, #73c991);
	}
	.tree-row.git-d .name, .git-badge.status-D {
		color: var(--git-deleted, #ef5350);
		text-decoration: line-through;
	}
	.tree-row.git-r .name, .git-badge.status-R {
		color: var(--git-renamed, #64b5f6);
	}
	.tree-row.git-c .name, .git-badge.status-C {
		color: var(--git-conflict, #ef5350);
	}

	.empty, .loading {
		height: 22px;
		display: flex;
		align-items: center;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
</style>
