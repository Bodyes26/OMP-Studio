<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { invoke } from '@tauri-apps/api/core';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { projectStore, joinProjectPath } from '$lib/stores/projects.svelte';
	import { githubStore, type GithubRemoteRepo, type DetectedGithubRemote } from '$lib/stores/github.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { trapFocus } from '$lib/focusTrap';
	import { IconGithub, IconFolderOpen } from '$lib/icons';

	let { open = false, onClose } = $props<{ open?: boolean; onClose?: () => void }>();

	interface Candidate {
		name: string;
		path: string;
		githubRemote?: DetectedGithubRemote;
	}

	let candidates = $state<Candidate[]>([]);
	let error = $state<string | null>(null);
	let query = $state('');
	let index = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);
	let isCloning = $state(false);
	let cloningName = $state<string | null>(null);
	let cloneError = $state<string | null>(null);

	// Filtra cartelle locali
	const filteredLocal = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q
			? candidates.filter(
					(c) =>
						c.name.toLowerCase().includes(q) ||
						c.path.toLowerCase().includes(q) ||
						c.githubRemote?.fullName.toLowerCase().includes(q)
				)
			: candidates;
	});

	// Repo remoti GitHub dell'utente che NON sono già presenti tra le cartelle locali
	const availableRemoteRepos = $derived.by(() => {
		if (!githubStore.status.authenticated) return [];

		const localFolderNames = new Set(candidates.map((c) => c.name.toLowerCase()));
		const localGithubSlugs = new Set(
			githubStore.localRemotes.map((r) => r.fullName.toLowerCase())
		);

		const notLocal = githubStore.remoteRepos.filter((r) => {
			const slug = r.fullName.toLowerCase();
			const name = r.name.toLowerCase();
			return !localGithubSlugs.has(slug) && !localFolderNames.has(name);
		});

		const q = query.trim().toLowerCase();
		return q
			? notLocal.filter(
					(r) =>
						r.name.toLowerCase().includes(q) ||
						r.fullName.toLowerCase().includes(q) ||
						r.description?.toLowerCase().includes(q)
				)
			: notLocal;
	});

	// Lista unificata di tutti gli elementi selezionabili con tastiera
	type SelectableItem =
		| { type: 'local'; candidate: Candidate; localIndex: number }
		| { type: 'remote'; repo: GithubRemoteRepo; remoteIndex: number }
		| { type: 'browse' };

	const allItems = $derived.by((): SelectableItem[] => {
		const items: SelectableItem[] = [];
		filteredLocal.forEach((candidate, localIndex) => {
			items.push({ type: 'local', candidate, localIndex });
		});
		availableRemoteRepos.forEach((repo, remoteIndex) => {
			items.push({ type: 'remote', repo, remoteIndex });
		});
		items.push({ type: 'browse' });
		return items;
	});

	const browseItemIndex = $derived(filteredLocal.length + availableRemoteRepos.length);

	const selectedIndex = $derived(Math.max(0, Math.min(index, allItems.length - 1)));

	const openKeys = $derived(
		new Set(
			projectStore.projects
				.flatMap((p) => (p.canonicalProjectPath ? [p.canonicalProjectPath] : []))
				.map((path) => path.toLowerCase())
		)
	);

	async function loadCandidates() {
		error = null;
		try {
			const [entries, remotes] = await Promise.all([
				invoke<{ name: string; path: string; is_dir: boolean }[]>('tree_read', {
					projectPath: projectStore.projectRoot,
					rel: ''
				}),
				githubStore.detectLocalRemotes(projectStore.projectRoot)
			]);

			const remotesByPath = new Map<string, DetectedGithubRemote>();
			for (const r of remotes) {
				remotesByPath.set(r.path.toLowerCase().replace(/\\/g, '/'), r);
			}

			candidates = entries
				.filter((e) => e.is_dir && !e.name.startsWith('.'))
				.map((e) => {
					const fullPath = joinProjectPath(projectStore.projectRoot, e.name);
					const normalizedKey = fullPath.toLowerCase().replace(/\\/g, '/');
					return {
						name: e.name,
						path: fullPath,
						githubRemote: remotesByPath.get(normalizedKey)
					};
				});
		} catch (e) {
			candidates = [];
			error = String(e);
		}
	}

	$effect(() => {
		if (!open) return;
		query = '';
		index = 0;
		cloneError = null;
		void loadCandidates();
		if (githubStore.status.authenticated) {
			void githubStore.loadRemoteRepos();
		}
		inputEl?.focus();
	});

	async function pickItem(item: SelectableItem) {
		if (item.type === 'local') {
			projectStore.openProject(item.candidate.path);
			onClose?.();
		} else if (item.type === 'remote') {
			await handleCloneAndOpen(item.repo);
		} else if (item.type === 'browse') {
			await browse();
		}
	}

	async function handleCloneAndOpen(repo: GithubRemoteRepo) {
		if (isCloning) return;
		isCloning = true;
		cloningName = repo.fullName;
		cloneError = null;
		try {
			const targetUrl =
				settingsStore.github.cloneProtocol === 'ssh' && repo.sshUrl ? repo.sshUrl : repo.url;
			await githubStore.cloneRepo(targetUrl);
			onClose?.();
		} catch (e) {
			cloneError = `Clonazione non riuscita: ${String(e)}`;
		} finally {
			isCloning = false;
			cloningName = null;
		}
	}

	async function browse() {
		const sel = await openDialog({ directory: true, defaultPath: projectStore.projectRoot });
		if (typeof sel === 'string') {
			projectStore.openProject(sel);
			onClose?.();
		}
	}

	function onKeydown(e: KeyboardEvent) {
		const total = allItems.length;
		if (total === 0) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			index = selectedIndex >= total - 1 ? 0 : selectedIndex + 1;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			index = selectedIndex <= 0 ? total - 1 : selectedIndex - 1;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const currentItem = allItems[selectedIndex];
			if (currentItem) void pickItem(currentItem);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose?.();
		}
	}

	function openSettingsGithub() {
		settingsStore.openSection('github');
		onClose?.();
	}
</script>

{#if open}
	<button
		type="button"
		class="backdrop"
		onclick={() => onClose?.()}
		aria-label={m.project_picker_close_aria()}
		tabindex="-1"
	></button>
	<div
		class="palette"
		role="dialog"
		aria-modal="true"
		aria-label={m.project_picker_dialog_aria()}
		use:trapFocus={{ onEscape: () => onClose?.() }}
	>
		<div class="search-head">
			<input
				bind:this={inputEl}
				bind:value={query}
				onkeydown={onKeydown}
				placeholder="Cerca cartella locale o repository GitHub..."
				aria-label={m.project_picker_search_aria()}
				spellcheck="false"
				disabled={isCloning}
			/>
		</div>

		{#if isCloning}
			<div class="cloning-banner" role="status">
				<span class="spinner" aria-hidden="true"></span>
				<span>Clonazione di <strong>{cloningName}</strong> in corso...</span>
			</div>
		{/if}

		{#if cloneError}
			<div class="error" role="alert">{cloneError}</div>
		{/if}

		<div class="rows" role="listbox" aria-label={m.project_picker_list_aria()}>
			{#if error}
				<div class="error" role="alert">Impossibile leggere {projectStore.projectRoot}: {error}</div>
			{/if}

			<!-- SEZIONE 1: CARTELLE LOCALI -->
			<div class="section-label">
				<span>Cartelle locali ({filteredLocal.length})</span>
				<span class="section-hint">in {projectStore.projectRoot}</span>
			</div>

			{#if filteredLocal.length === 0}
				<div class="empty-row">Nessuna cartella locale trovata</div>
			{:else}
				{#each filteredLocal as c, i (c.path)}
					{@const itemIndex = i}
					{@const isSelected = selectedIndex === itemIndex}
					{@const isAlreadyOpen = openKeys.has(c.path.toLowerCase())}
					<button
						type="button"
						class="row"
						class:sel={isSelected}
						role="option"
						aria-selected={isSelected}
						aria-label={`${c.name} - ${c.path}${isAlreadyOpen ? m.ui_projectpicker_gia_aperto_c1ca() : ''}`}
						onmouseenter={() => (index = itemIndex)}
						onclick={() => pickItem({ type: 'local', candidate: c, localIndex: i })}
						disabled={isCloning}
					>
						<span class="row-icon"><IconFolderOpen /></span>
						<span class="name">{c.name}</span>
						{#if isAlreadyOpen}
							<span class="badge already-open">{m.project_picker_already_open()}</span>
						{/if}
						{#if c.githubRemote}
							<span class="badge gh-badge" title={`Collegato a https://github.com/${c.githubRemote.fullName}`}>
								<IconGithub /> {c.githubRemote.fullName}
							</span>
						{/if}
						<span class="path">{c.path}</span>
					</button>
				{/each}
			{/if}

			<!-- SEZIONE 2: REPOSITORY GITHUB -->
			<div class="section-divider"></div>
			<div class="section-label">
				<span class="with-icon"><IconGithub /> I tuoi repository su GitHub</span>
				{#if githubStore.status.authenticated}
					<span class="section-hint">disponibili per il clone</span>
				{/if}
			</div>

			{#if !githubStore.status.authenticated}
				<div class="gh-connect-prompt">
					<span>Collega GitHub per vedere e clonare qui i tuoi repository remoti.</span>
					<button type="button" class="btn-connect-gh" onclick={openSettingsGithub}>
						Configura GitHub
					</button>
				</div>
			{:else if githubStore.isLoadingRepos && availableRemoteRepos.length === 0}
				<div class="loading-row">
					<span class="spinner-small" aria-hidden="true"></span>
					<span>Caricamento repository GitHub...</span>
				</div>
			{:else if availableRemoteRepos.length === 0}
				<div class="empty-row">
					{query.trim()
						? 'Nessun repository remoto corrisponde alla ricerca'
						: 'Tutti i tuoi repository sono già presenti in locale'}
				</div>
			{:else}
				{#each availableRemoteRepos as r, j (r.fullName)}
					{@const itemIndex = filteredLocal.length + j}
					{@const isSelected = selectedIndex === itemIndex}
					<button
						type="button"
						class="row remote-row"
						class:sel={isSelected}
						role="option"
						aria-selected={isSelected}
						aria-label={`Clona repository GitHub ${r.fullName}`}
						onmouseenter={() => (index = itemIndex)}
						onclick={() => pickItem({ type: 'remote', repo: r, remoteIndex: j })}
						disabled={isCloning}
					>
						<span class="row-icon gh-icon"><IconGithub /></span>
						<span class="name">{r.name}</span>
						{#if r.isPrivate}
							<span class="badge private-badge" title="Repository privato">Privato</span>
						{/if}
						{#if r.description}
							<span class="repo-desc" title={r.description}>{r.description}</span>
						{/if}
						<span class="clone-btn-hint">Clona e apri</span>
					</button>
				{/each}
			{/if}

			<!-- OPZIONE: SFOGLIA FUORI DA PROJECT ROOT -->
			<div class="section-divider"></div>
			<button
				type="button"
				class="row browse"
				class:sel={selectedIndex === browseItemIndex}
				role="option"
				aria-selected={selectedIndex === browseItemIndex}
				aria-label={m.project_picker_browse_other_aria()}
				onmouseenter={() => (index = browseItemIndex)}
				onclick={() => pickItem({ type: 'browse' })}
				disabled={isCloning}
			>
				<span class="name">{m.project_picker_browse_btn()}</span>
				<span class="path">{m.ui_projectpicker_apri_una_cartella_fuori_da_fcbd()} {projectStore.projectRoot}</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-backdrop);
		background: transparent;
		border: none;
		padding: 0;
		cursor: default;
	}

	.palette {
		position: fixed;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		width: 620px;
		max-height: calc(100vh - 120px);
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		color: var(--ink);
	}

	.search-head {
		border-bottom: 1px solid var(--line);
	}

	input {
		width: 100%;
		background: transparent;
		border: none;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-md);
		padding: var(--space-3) var(--space-4);
		outline: none;
		box-sizing: border-box;
	}

	.cloning-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid color-mix(in srgb, var(--brand) 30%, transparent);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.spinner-small {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid var(--line);
		border-top-color: var(--ink);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.rows {
		flex: 0 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.section-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-2) 4px var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
	}

	.section-label .with-icon {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.section-hint {
		font-size: 0.72rem;
		text-transform: none;
		font-weight: 400;
		color: var(--ink-faint);
	}

	.section-divider {
		height: 1px;
		background: var(--line);
		margin: var(--space-2) 0;
	}

	.row {
		background: transparent;
		border: none;
		color: var(--ink);
		text-align: left;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-2);
		border-radius: var(--radius-sm);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: background 0.1s ease;
	}

	.row.sel {
		background: var(--bg-hover);
	}

	.row-icon {
		display: flex;
		align-items: center;
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.row-icon.gh-icon {
		color: var(--brand);
	}

	.name {
		font-weight: 500;
		flex: 0 0 auto;
	}

	.badge {
		flex: 0 0 auto;
		font-size: 0.72rem;
		border-radius: var(--radius-full);
		padding: 1px 6px;
	}

	.badge.already-open {
		color: var(--ink-faint);
		border: 1px solid var(--line);
	}

	.badge.gh-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: color-mix(in srgb, var(--brand) 10%, transparent);
		color: var(--brand);
		border: 1px solid color-mix(in srgb, var(--brand) 25%, transparent);
		font-family: var(--font-mono);
		font-size: 0.7rem;
	}

	.badge.private-badge {
		background: var(--surface-3, rgba(255, 255, 255, 0.08));
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.path {
		flex: 1 1 auto;
		text-align: right;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.repo-desc {
		flex: 1 1 auto;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.clone-btn-hint {
		flex: 0 0 auto;
		font-size: 0.74rem;
		font-weight: 500;
		color: var(--brand);
		background: color-mix(in srgb, var(--brand) 12%, transparent);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
	}

	.empty-row,
	.loading-row {
		padding: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.gh-connect-prompt {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		margin: var(--space-1) var(--space-2);
		background: var(--surface-2, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.btn-connect-gh {
		padding: 3px 8px;
		background: var(--brand);
		color: #ffffff;
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
	}

	.error {
		padding: var(--space-2) var(--space-4);
		font-size: var(--text-sm);
		color: var(--warn);
	}
</style>
