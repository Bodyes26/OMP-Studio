<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { invoke } from '#lib/backend/ipc.ts';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { projectStore, joinProjectPath, normalizeProjectPath, type ProjectColorMode } from '#lib/stores/projects.svelte.ts';
	import { githubStore, type GithubRemoteRepo, type DetectedGithubRemote } from '#lib/stores/github.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { trapFocus } from '#lib/focusTrap.ts';
	import { IconGithub, IconFolderOpen, IconPlus, IconGlobe, IconLock, IconArrowLeft } from '#lib/icons.ts';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import { LOCAL_MACHINE } from '#lib/backend/ipc.ts';
	import type { RemoteFolderList } from '$remote-protocol';
	import { projectOrder } from '#lib/stores/projectOrder.svelte.ts';
	import { provenance, copyDivergence, machineName } from '#lib/stores/projectMachines.svelte.ts';
	import {
		buildPickerEntries,
		filterPickerEntries,
		folderName,
		pickerKey,
		preferredClosedCopy,
		type PickerCopy,
		type PickerEntry,
		type PickerGroup,
		type PickerSource
	} from '#lib/stores/pickerEntries.ts';
	import MachineGlyph from '#lib/ui/MachineGlyph.svelte';

	let { open = false, onClose } = $props<{ open?: boolean; onClose?: () => void }>();

	interface Candidate {
		name: string;
		path: string;
		githubRemote?: DetectedGithubRemote;
		customName?: string;
		label?: string | null;
		hue?: number;
		colorMode?: ProjectColorMode;
	}

	let candidates = $state<Candidate[]>([]);
	/**
	 * Cartelle delle altre istanze collegate, una voce per macchina. Arrivano
	 * dalla stessa azione che usa Studio Remote (`list_project_folders`), quindi
	 * comprendono i progetti noti all'altra macchina ma non aperti in barra.
	 */
	let machineFolders = $state<{ id: string; name: string; folders: RemoteFolderList['folders'] }[]>([]);
	let error = $state<string | null>(null);
	let query = $state('');
	let index = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);
	let isCloning = $state(false);
	let cloningName = $state<string | null>(null);
	let cloneError = $state<string | null>(null);

	// Seconda schermata dello stesso palette: creazione di un progetto vuoto
	let view = $state<'list' | 'new'>('list');
	type NewVisibility = 'local' | 'public' | 'private';
	let newName = $state('');
	let newVisibility = $state<NewVisibility>('local');
	let isCreating = $state(false);
	let createError = $state<string | null>(null);
	let newNameEl = $state<HTMLInputElement | null>(null);

	const openKeys = $derived(
		new Set(
			projectStore.projects
				.filter((p) => !p.external)
				.flatMap((p) => (p.canonicalProjectPath ? [p.canonicalProjectPath] : []))
				.map((path) => path.toLowerCase())
		)
	);

	// Cartelle locali non ancora aperte nella barra dei progetti
	const unopenedCandidates = $derived(
		candidates.filter((c) => !openKeys.has(c.path.toLowerCase()))
	);

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

	/** Macchine da filtrare: vuoto = tutte (R-MI-21). */
	let machineFilter = $state<string[]>([]);
	const filterMachines = $derived([
		{ id: LOCAL_MACHINE, name: machineName(LOCAL_MACHINE), local: true, online: true },
		...linkStore.status.peers.map((peer) => ({ id: peer.id, name: peer.name, local: false, online: peer.online }))
	]);

	function repoOfPath(path: string | null | undefined): string | null {
		if (!path) return null;
		return githubStore.upstreamByPath[normalizeProjectPath(path).toLowerCase()]?.repoSlug ?? null;
	}

	/** Tessere della barra: una voce per gruppo di copie, tutte aperte. */
	const tileSources = $derived(
		projectOrder.unified
			.filter((p) => p.canonicalProjectPath && !p.labDraft && !p.external)
			.map((p) => {
				const view = provenance(p);
				const repo = view.copies.map((copy) => repoOfPath(copy.project.canonicalProjectPath)).find(Boolean) ?? null;
				return {
					id: p.id,
					key: pickerKey(repo, folderName(p.canonicalProjectPath!)),
					name: p.name,
					label: p.label,
					hue: p.colorMode === 'custom' ? p.hue : null,
					diverged: view.kind === 'copies' && copyDivergence(p) !== null,
					copies: view.copies.map((copy): PickerCopy => ({
						machineId: copy.machineId,
						machineName: copy.name,
						local: copy.local,
						online: copy.online,
						state: 'open',
						path: copy.project.canonicalProjectPath ?? '',
						projectId: copy.project.id
					}))
				};
			})
	);

	/**
	 * Aperti su un'altra macchina ma non in questa barra: le tessere nascoste
	 * (R-MI-20) e quelle che il riepilogo dell'host non ha ancora portato.
	 */
	const elsewhereSources = $derived.by((): PickerSource[] => {
		const sources: PickerSource[] = [];
		const shown = new Set<string>(projectStore.projects.map((p) => p.id));
		for (const [machine, snapshot] of Object.entries(linkStore.hosts)) {
			const peer = linkStore.machineFor(machine);
			const folders = machineFolders.find((entry) => entry.id === machine)?.folders ?? [];
			for (const host of snapshot.projects) {
				const id = `${machine}::${host.id}`;
				if (host.external || host.labDraft || !host.canonicalProjectPath || shown.has(id)) continue;
				const folder = folders.find((candidate) => candidate.openProjectId === host.id);
				sources.push({
					key: pickerKey(folder?.repo, folderName(host.canonicalProjectPath)),
					name: host.name,
					label: host.label,
					copy: {
						machineId: machine,
						machineName: peer?.name ?? machine,
						local: false,
						online: peer?.online ?? false,
						state: 'open',
						path: host.canonicalProjectPath,
						projectId: id
					}
				});
			}
		}
		return sources;
	});

	/** Cartelle note ma chiuse, qui e sulle altre macchine. */
	const closedSources = $derived.by((): PickerSource[] => {
		const local = unopenedCandidates.map((c): PickerSource => ({
			key: pickerKey(c.githubRemote?.fullName, c.name),
			name: c.customName || c.name,
			label: c.label ?? null,
			hue: c.colorMode === 'custom' ? (c.hue ?? null) : null,
			copy: { machineId: LOCAL_MACHINE, machineName: machineName(LOCAL_MACHINE), local: true, online: true, state: 'closed', path: c.path }
		}));
		const remote = machineFolders.flatMap((machine) =>
			machine.folders
				.filter((folder) => !folder.openProjectId)
				.map((folder): PickerSource => ({
					key: pickerKey(folder.repo, folder.name),
					name: folder.name,
					copy: { machineId: machine.id, machineName: machine.name, local: false, online: true, state: 'closed', path: folder.path }
				}))
		);
		return [...local, ...remote];
	});

	const GROUPS: PickerGroup[] = ['window', 'elsewhere', 'closed'];
	const entries = $derived.by(() => {
		const all = filterPickerEntries(
			buildPickerEntries(tileSources, elsewhereSources, closedSources),
			new Set(machineFilter),
			query
		);
		return GROUPS.flatMap((group) => all.filter((entry) => entry.group === group));
	});

	function groupLabel(group: PickerGroup): string {
		return group === 'window'
			? m.project_picker_group_window()
			: group === 'elsewhere'
				? m.project_picker_group_elsewhere()
				: m.project_picker_group_closed();
	}

	// Lista unificata di tutti gli elementi selezionabili con tastiera
	type SelectableItem =
		| { type: 'new' }
		| { type: 'entry'; entry: PickerEntry }
		| { type: 'remote'; repo: GithubRemoteRepo; remoteIndex: number }
		| { type: 'browse' };

	const allItems = $derived.by((): SelectableItem[] => {
		const items: SelectableItem[] = [{ type: 'new' }];
		for (const entry of entries) items.push({ type: 'entry', entry });
		availableRemoteRepos.forEach((repo, remoteIndex) => {
			items.push({ type: 'remote', repo, remoteIndex });
		});
		items.push({ type: 'browse' });
		return items;
	});

	const browseItemIndex = $derived(1 + entries.length + availableRemoteRepos.length);

	const selectedIndex = $derived(Math.max(0, Math.min(index, allItems.length - 1)));

	function toggleMachineFilter(id: string) {
		machineFilter = machineFilter.includes(id) ? machineFilter.filter((other) => other !== id) : [...machineFilter, id];
		index = 0;
	}

	/**
	 * Apre una copia: torna alla tessera se è in barra, rimette in barra una
	 * tessera nascosta, apre la cartella chiusa sulla sua macchina.
	 */
	async function openCopy(copy: PickerCopy) {
		if (copy.state === 'open' && copy.projectId) {
			if (projectStore.isHiddenRemote(copy.projectId)) {
				projectStore.showRemote(copy.projectId);
				const snapshot = linkStore.hosts[copy.machineId];
				if (snapshot) projectStore.syncRemoteProjects(copy.machineId, copy.machineName, snapshot);
			}
			if (projectStore.projects.some((p) => p.id === copy.projectId)) projectStore.setActive(copy.projectId);
			onClose?.();
			return;
		}
		if (copy.local) {
			projectStore.openProject(copy.path);
			onClose?.();
			return;
		}
		await openRemoteFolder(copy.machineId, copy.path);
	}

	async function openEntry(entry: PickerEntry) {
		if (entry.group === 'window' && entry.tileId) {
			projectStore.setActive(entry.tileId);
			onClose?.();
			return;
		}
		const target = entry.group === 'elsewhere'
			? entry.copies.find((copy) => copy.state === 'open')
			: preferredClosedCopy(entry);
		if (target) await openCopy(target);
	}

	/**
	 * Una macchina irraggiungibile o con troppa latenza non blocca l'elenco
	 * locale: sparisce solo la sua sezione, con il resto della palette pronto.
	 */
	async function loadMachineFolders() {
		machineFolders = [];
		const peers = linkStore.status.peers.filter((peer) => peer.online && peer.compatible);
		if (peers.length === 0) return;
		const results = await Promise.allSettled(peers.map(async (peer) => {
			const list = await linkStore.command<RemoteFolderList>(peer.id, { kind: 'list_project_folders' });
			return { id: peer.id, name: peer.name, folders: list.folders };
		}));
		machineFolders = results
			.filter((result): result is PromiseFulfilledResult<{ id: string; name: string; folders: RemoteFolderList['folders'] }> => result.status === 'fulfilled')
			.map((result) => result.value);
	}

	/** Apre la cartella sull'altra macchina: la targhetta arriva al prossimo stato. */
	async function openRemoteFolder(machineId: string, path: string) {
		try {
			await linkStore.command(machineId, { kind: 'open_project', path });
			onClose?.();
		} catch (e) {
			error = String(e);
		}
	}

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
					const meta = projectStore.getProjectMetadata(fullPath);
					return {
						name: e.name,
						path: fullPath,
						githubRemote: remotesByPath.get(normalizedKey),
						customName: meta?.name && meta.name !== e.name ? meta.name : undefined,
						label: meta?.label ?? null,
						hue: meta?.hue,
						colorMode: meta?.colorMode
					};
				});
		} catch (e) {
			candidates = [];
			error = String(e);
		}
	}

	// Il reset dipende solo da `open`: letture tracciate qui dentro (es. `inputEl`,
	// che diventa null quando la lista si smonta passando a `view = 'new'`)
	// rieseguirebbero l'effetto riportando subito la vista a 'list'.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			view = 'list';
			createError = null;
			query = '';
			index = 0;
			cloneError = null;
			void loadCandidates();
			void loadMachineFolders();
			if (githubStore.status.authenticated) {
				void githubStore.loadRemoteRepos();
			}
		});
	});

	// Il fuoco segue la vista: l'input giusto esiste solo dopo il montaggio
	$effect(() => {
		if (!open) return;
		(view === 'new' ? newNameEl : inputEl)?.focus();
	});

	function openNewProject() {
		newName = query.trim();
		newVisibility = 'local';
		createError = null;
		view = 'new';
	}

	async function createProject() {
		if (isCreating) return;
		const name = newName.trim();
		if (!name) {
			createError = m.project_picker_name_required();
			return;
		}
		isCreating = true;
		createError = null;
		try {
			const path = await invoke<string>('project_create_new', {
				parentDir: projectStore.projectRoot,
				name,
				visibility: newVisibility,
				useSsh: settingsStore.github.cloneProtocol === 'ssh'
			});
			projectStore.openProject(path);
			if (newVisibility !== 'local') void githubStore.detectLocalRemotes();
			onClose?.();
		} catch (e) {
			createError = String(e);
		} finally {
			isCreating = false;
		}
	}

	function onNewKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void createProject();
		}
	}

	async function pickItem(item: SelectableItem) {
		if (item.type === 'new') {
			openNewProject();
		} else if (item.type === 'entry') {
			await openEntry(item.entry);
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
			cloneError = m.project_picker_clone_failed({ error: String(e) });
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

{#snippet highlight(text: string, q: string)}
	{#if !q.trim()}
		{text}
	{:else}
		{@const lowerQ = q.trim().toLowerCase()}
		{@const lowerText = text.toLowerCase()}
		{@const idx = lowerText.indexOf(lowerQ)}
		{#if idx === -1}
			{text}
		{:else}
			{text.slice(0, idx)}<mark class="highlight-char">{text.slice(idx, idx + lowerQ.length)}</mark>{text.slice(idx + lowerQ.length)}
		{/if}
	{/if}
{/snippet}

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
		use:trapFocus={{ onEscape: () => (view === 'new' && !isCreating ? (view = 'list') : onClose?.()) }}
	>
		{#if view === 'new'}
			<div class="new-form">
				<div class="new-title">
					<button
						type="button"
						class="back-btn"
						onclick={() => (view = 'list')}
						disabled={isCreating}
						aria-label={m.project_picker_back_aria()}
					>
						<IconArrowLeft />
					</button>
					<span>{m.project_picker_new_title()}</span>
				</div>

				<label class="field-label" for="new-project-name">{m.project_picker_name_label()}</label>
				<input
					id="new-project-name"
					class="name-input"
					bind:this={newNameEl}
					bind:value={newName}
					onkeydown={onNewKeydown}
					placeholder={m.project_picker_name_placeholder()}
					spellcheck="false"
					autocomplete="off"
					disabled={isCreating}
				/>
				<div class="field-hint font-mono">
					{joinProjectPath(projectStore.projectRoot, newName.trim() || '…')}
				</div>

				<div class="field-label">{m.project_picker_repository_label()}</div>
				<div class="seg" role="radiogroup" aria-label={m.project_picker_visibility_aria()}>
					<button
						type="button"
						role="radio"
						aria-checked={newVisibility === 'local'}
						class:on={newVisibility === 'local'}
						onclick={() => (newVisibility = 'local')}
						disabled={isCreating}
					>
						<IconFolderOpen /> {m.project_picker_visibility_local()}
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={newVisibility === 'public'}
						class:on={newVisibility === 'public'}
						onclick={() => (newVisibility = 'public')}
						disabled={isCreating || !githubStore.status.authenticated}
					>
						<IconGlobe /> {m.project_picker_visibility_public()}
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={newVisibility === 'private'}
						class:on={newVisibility === 'private'}
						onclick={() => (newVisibility = 'private')}
						disabled={isCreating || !githubStore.status.authenticated}
					>
						<IconLock /> {m.project_picker_visibility_private()}
					</button>
				</div>
				{#if !githubStore.status.authenticated}
					<div class="field-hint">
						{m.project_picker_github_connect_before()}
						<button type="button" class="link-btn" onclick={openSettingsGithub}>{m.project_picker_github_connect_link()}</button>.
					</div>
				{:else if newVisibility !== 'local'}
					<div class="field-hint">
						{m.project_picker_github_create_before()} <code>origin</code>{m.project_picker_github_create_after()}
					</div>
				{/if}

				{#if createError}
					<div class="error" role="alert">{createError}</div>
				{/if}

				<div class="new-actions">
					<button type="button" class="btn-secondary" onclick={() => (view = 'list')} disabled={isCreating}>
						{m.project_picker_cancel()}
					</button>
					<button type="button" class="btn-primary" onclick={createProject} disabled={isCreating || !newName.trim()}>
						{#if isCreating}<span class="spinner" aria-hidden="true"></span>{/if}
						{isCreating ? m.project_picker_creating() : m.project_picker_create()}
					</button>
				</div>
			</div>
		{:else}
		<div class="search-head">
			<input
				bind:this={inputEl}
				bind:value={query}
				onkeydown={onKeydown}
				placeholder={m.project_picker_search_all_placeholder()}
				aria-label={m.project_picker_search_aria()}
				spellcheck="false"
				disabled={isCloning}
			/>
		</div>

		{#if isCloning}
			<div class="cloning-banner" role="status">
				<span class="spinner" aria-hidden="true"></span>
				<span>{m.project_picker_cloning_before()} <strong>{cloningName}</strong> {m.project_picker_cloning_after()}</span>
			</div>
		{/if}

		{#if cloneError}
			<div class="error" role="alert">{cloneError}</div>
		{/if}

		<div class="rows" role="listbox" aria-label={m.project_picker_list_aria()}>
			{#if error}
				<div class="error" role="alert">{m.project_picker_read_failed({ root: projectStore.projectRoot, error: String(error) })}</div>
			{/if}

			<button
				type="button"
				class="row new-row"
				class:sel={selectedIndex === 0}
				role="option"
				aria-selected={selectedIndex === 0}
				onmouseenter={() => (index = 0)}
				onclick={() => pickItem({ type: 'new' })}
				disabled={isCloning}
			>
				<span class="row-icon"><IconPlus /></span>
				<span class="name">{query.trim() ? m.project_picker_create_named({ name: query.trim() }) : m.project_picker_new_ellipsis()}</span>
				<span class="path">{m.project_picker_empty_folder_in({ root: projectStore.projectRoot })}</span>
			</button>
			<div class="section-divider"></div>

			<!-- Un elenco solo per tutte le macchine, in tre gruppi (R-MI-21, F23). -->
			{#if filterMachines.length > 1}
				<div class="machine-filters" role="group" aria-label={m.project_picker_list_aria()}>
					{#each filterMachines as machine (machine.id)}
						<button
							type="button"
							class="machine-filter"
							class:offline={!machine.online}
							aria-pressed={machineFilter.includes(machine.id)}
							aria-label={m.project_picker_machine_filter_aria({ machine: machine.name })}
							onclick={() => toggleMachineFilter(machine.id)}
						>
							<MachineGlyph kind={machine.local ? 'here' : machine.online ? 'remote' : 'offline'} size={11} />
							{machine.name}
						</button>
					{/each}
				</div>
			{/if}

			{#if entries.length === 0}
				<div class="empty-row">{m.project_picker_group_none()}</div>
			{/if}
			{#each GROUPS as group (group)}
				{@const groupEntries = entries.filter((entry) => entry.group === group)}
				{#if groupEntries.length > 0}
					<div class="section-label"><span>{groupLabel(group)} · {groupEntries.length}</span></div>
					{#each groupEntries as entry (entry.key)}
						{@const itemIndex = 1 + entries.indexOf(entry)}
						{@const isSelected = selectedIndex === itemIndex}
						<div
							class="row entry-row"
							class:sel={isSelected}
							role="option"
							tabindex="-1"
							aria-selected={isSelected}
							aria-label={`${entry.name} - ${entry.copies.map((copy) => copy.machineName).join(', ')}`}
							onmouseenter={() => (index = itemIndex)}
							onclick={() => void openEntry(entry)}
							onkeydown={(event) => { if (event.key === 'Enter') void openEntry(entry); }}
						>
							<span class="entry-code" style={entry.hue !== null ? `--proj-hue: ${entry.hue}` : undefined}>{entry.label ?? entry.name.slice(0, 2).toUpperCase()}</span>
							<span class="name">{@render highlight(entry.name, query)}</span>
							{#if entry.diverged}<span class="entry-diverged">{m.project_picker_diverged()}</span>{/if}
							<span class="entry-machines">
								{#each entry.copies as copy (copy.machineId)}
									{#if copy.state === 'closed' && copy.online}
										<button
											type="button"
											class="machine-tag closed"
											title={m.project_picker_open_on({ machine: copy.machineName })}
											aria-label={m.project_picker_open_on({ machine: copy.machineName })}
											onclick={(event) => { event.stopPropagation(); void openCopy(copy); }}
										>
											<MachineGlyph kind={copy.local ? 'here' : 'remote'} size={11} />{copy.machineName}
										</button>
									{:else}
										<span class="machine-tag" class:open={copy.state === 'open' && copy.online} class:offline={!copy.online}>
											<MachineGlyph kind={copy.local ? 'here' : copy.online ? 'remote' : 'offline'} size={11} />{copy.machineName}
										</span>
									{/if}
								{/each}
							</span>
						</div>
					{/each}
				{/if}
			{/each}

			<div class="section-divider"></div>
			<div class="section-label">
				<span class="with-icon"><IconGithub /> {m.project_picker_github_section()}</span>
				{#if githubStore.status.authenticated}
					<span class="section-hint">{m.project_picker_github_section_hint()}</span>
				{/if}
			</div>

			{#if !githubStore.status.authenticated}
				<div class="gh-connect-prompt">
					<span>{m.project_picker_github_connect_prompt()}</span>
					<button type="button" class="btn-connect-gh" onclick={openSettingsGithub}>
						{m.project_picker_github_configure()}
					</button>
				</div>
			{:else if githubStore.isLoadingRepos && availableRemoteRepos.length === 0}
				<div class="loading-row">
					<span class="spinner-small" aria-hidden="true"></span>
					<span>{m.project_picker_github_loading()}</span>
				</div>
			{:else if availableRemoteRepos.length === 0}
				<div class="empty-row">
					{query.trim()
						? m.project_picker_github_no_match()
						: m.project_picker_github_all_local()}
				</div>
			{:else}
				{#each availableRemoteRepos as r, j (r.fullName)}
					{@const itemIndex = 1 + entries.length + j}
					{@const isSelected = selectedIndex === itemIndex}
					<button
						type="button"
						class="row remote-row"
						class:sel={isSelected}
						role="option"
						aria-selected={isSelected}
						aria-label={m.project_picker_clone_aria({ name: r.fullName })}
						onmouseenter={() => (index = itemIndex)}
						onclick={() => pickItem({ type: 'remote', repo: r, remoteIndex: j })}
						disabled={isCloning}
					>
						<span class="row-icon gh-icon"><IconGithub /></span>
						<span class="name font-mono">{@render highlight(r.name, query)}</span>
						{#if r.isPrivate}
							<span class="badge private-badge" title={m.project_picker_private_title()}>{m.project_picker_private_badge()}</span>
						{/if}
						{#if r.description}
							<span class="repo-desc" title={r.description}>{@render highlight(r.description, query)}</span>
						{/if}
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
		{/if}
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
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		color: var(--ink);
		animation: rv-lift var(--dur-menu, 150ms) var(--ease-reveal);
		--dur: var(--dur-menu, 150ms);
		--blur: 3px;
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
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--ink);
		border-radius: var(--radius-full);
		animation: spin 900ms linear infinite;
	}

	.spinner-small {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--ink);
		border-radius: var(--radius-full);
		animation: spin 900ms linear infinite;
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
		font-size: var(--text-caption);
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
		padding: 7px var(--space-2);
		border-radius: var(--radius-md);
		font-family: var(--font-ui);
		font-size: var(--text-label);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
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
		color: var(--brand-ink);
	}

	.name {
		font-weight: 600;
		flex: 0 0 auto;
	}

	.name.font-mono {
		font-family: var(--font-mono);
	}

	/* Elenco unico (R-MI-21): sigla, nome e, a destra, le macchine dove esiste. */
	.machine-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 4px var(--space-2) var(--space-2);
	}
	.machine-filter {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 9px;
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--ink-muted);
		font: 500 var(--text-caption)/1 var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}
	.machine-filter:hover { background: var(--bg-hover); }
	.machine-filter[aria-pressed='true'] { color: var(--ink); background: var(--bg-active); border-color: var(--line-strong); }
	.machine-filter.offline { border-style: dashed; }
	.entry-row { min-height: 36px; }
	.entry-code {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 32px;
		height: 24px;
		padding: 0 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		font: 600 var(--text-caption)/1 var(--font-ui);
		color: var(--ink);
		flex-shrink: 0;
	}
	.entry-diverged { font-size: var(--text-caption); color: var(--warn); white-space: nowrap; }
	.entry-machines {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 4px;
		margin-left: auto;
	}
	.machine-tag {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 7px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-faint);
		font: 450 var(--text-caption)/1.2 var(--font-ui);
		white-space: nowrap;
	}
	.machine-tag.open { color: var(--ink); border-color: var(--line-strong); }
	.machine-tag.offline { border-style: dashed; }
	.machine-tag.closed { cursor: pointer; transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
	.machine-tag.closed:hover { background: var(--bg-hover); color: var(--ink); }

	.highlight-char {
		background: transparent;
		color: var(--ink);
		font-weight: 700;
		text-decoration: underline;
		text-decoration-color: var(--warn);
		text-decoration-thickness: 2px;
		text-underline-offset: 2px;
	}

	.badge {
		flex: 0 0 auto;
		font-size: var(--text-meta);
		border-radius: var(--radius-full);
		padding: 1px 6px;
	}
	.badge.private-badge {
		background: color-mix(in srgb, var(--ink) 8%, transparent);
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
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.btn-connect-gh {
		padding: 4px 10px;
		background: var(--brand);
		color: var(--on-brand);
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--text-caption);
		font-weight: 600;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.error {
		padding: var(--space-2) var(--space-4);
		font-size: var(--text-sm);
		color: var(--danger);
	}

	.new-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
	}

	.new-title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
		font-size: var(--text-md);
		margin-bottom: var(--space-2);
	}

	.back-btn {
		display: inline-flex;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		padding: 2px;
		border-radius: var(--radius-sm);
	}

	.back-btn:hover:not(:disabled) {
		color: var(--ink);
	}

	.field-label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
		margin-top: var(--space-2);
	}

	.name-input {
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--bg-input, transparent);
	}

	.name-input:focus {
		border-color: var(--brand);
	}

	.field-hint {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		overflow-wrap: anywhere;
	}

	.seg {
		display: flex;
		gap: 4px;
	}

	.seg button {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.seg button.on {
		color: var(--ink);
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 15%, transparent);
	}

	.seg button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.link-btn {
		background: none;
		border: none;
		padding: 0;
		color: var(--brand);
		cursor: pointer;
		font: inherit;
		text-decoration: underline;
	}

	.new-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	.new-actions button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--line-strong);
		color: var(--ink);
	}

	.btn-primary {
		background: var(--brand);
		border: 1px solid var(--brand);
		color: var(--on-brand, #fff);
	}

	.new-actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
