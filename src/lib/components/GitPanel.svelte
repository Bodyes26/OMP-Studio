<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { fetchSessionsList, type SessionEntry } from '$lib/agent/sessionsList';
	import {
		IconArrowDown,
		IconArrowUp,
		IconCheck,
		IconChevronDown,
		IconClose,
		IconCloud,
		IconDiamond,
		IconExternalLink,
		IconGitBranch,
		IconPlus
	} from '$lib/icons';
	import { chatReveal } from '$lib/agent/motion';
	import GitStatusMark from '$lib/ui/GitStatusMark.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { perfSpan } from '$lib/perf';
	import { notifyGitStatusRefresh, type GitStatusRefreshDetail } from '$lib/stores/gitDiff.svelte';
	import { githubStore } from '$lib/stores/github.svelte';
	import { normalizeProjectPath } from '$lib/stores/projects.svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';

	let {
		projectPath,
		agentState,
		onOpenWorkingDiff,
		onOpenCommitDiff,
		onResumeSession,
		canResume = true,
		resumeReason = ''
	}: {
		projectPath: string;
		agentState?: string;
		onOpenWorkingDiff?: (path: string) => void;
		onOpenCommitDiff?: (path: string, hash: string, short: string) => void;
		onResumeSession?: (sessionId: string) => void;
		canResume?: boolean;
		resumeReason?: string;
	} = $props();

	interface CommitFileEntry {
		path: string;
		status: string;
		insertions: number | null;
		deletions: number | null;
	}

	interface CommitInfo {
		hash: string;
		short: string;
		author: string;
		time: number;
		subject: string;
		files: CommitFileEntry[];
	}

	interface WorkingFile {
		path: string;
		status: string;
		insertions: number | null;
		deletions: number | null;
	}

	let branch = $state('');
	let branches = $state<{ name: string; current: boolean }[]>([]);
	let branchMenuOpen = $state(false);
	let newBranchName = $state('');
	let workingFiles = $state<WorkingFile[]>([]);
	let lastCommit = $state<CommitInfo | null>(null);
	let commits = $state<CommitInfo[]>([]);
	let expandedCommit = $state<string | null>(null);
	let notRepo = $state(false);
	let refreshError = $state<string | null>(null);
	let isRefreshing = $state(false);
	let sessions = $state<SessionEntry[]>([]);
	let actionError = $state<string | null>(null);
	let syncMessage = $state<string | null>(null);
	let showIncomingCommits = $state(false);

	// Righe nuove: chatReveal solo per le chiavi comparse dopo la prima lettura.
	// Montaggio, cambio scheda e cambio progetto ({#key}) restano fermi
	// (Still-Room Rule); il polling non rianima le righe gia' presenti.
	let knownWorking: Set<string> | null = null;
	let knownCommits: Set<string> | null = null;
	let freshKeys = $state(new Set<string>());

	function trackFresh(known: Set<string> | null, keys: string[], fresh: Set<string>): Set<string> {
		if (known) {
			for (const key of keys) if (!known.has(key)) fresh.add(key);
		}
		return new Set(keys);
	}

	const normalizedKey = $derived(normalizeProjectPath(projectPath).toLowerCase());
	const upstream = $derived(githubStore.upstreamByPath[normalizedKey] ?? null);
	const isSyncing = $derived(githubStore.isSyncingByPath[normalizedKey] ?? false);
	const actionsRuns = $derived(githubStore.actionsByPath[normalizedKey] ?? []);
	const latestAction = $derived(actionsRuns.length > 0 ? actionsRuns[0] : null);

	async function handleSync(action: 'pull' | 'push' | 'sync' | 'fetch') {
		syncMessage = null;
		actionError = null;
		try {
			const res = await githubStore.syncRepo(projectPath, action);
			syncMessage = res;
			await refresh();
			notifyGitStatusRefresh(projectPath);
		} catch (e) {
			actionError = String(e);
		}
	}
	function baseName(p: string): string {
		return p.split('/').pop() || p;
	}

	function dirName(p: string): string {
		const idx = p.lastIndexOf('/');
		return idx === -1 ? '' : p.slice(0, idx + 1);
	}

	function relTime(t: number): string {
		const seconds = Math.max(0, Math.floor(Date.now() / 1000 - t));
		if (seconds < 60) return i18n.formatRelativeTime(0, 'second');
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return i18n.formatRelativeTime(-minutes, 'minute');
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return i18n.formatRelativeTime(-hours, 'hour');
		const days = Math.floor(hours / 24);
		if (days < 7) return i18n.formatRelativeTime(-days, 'day');
		return i18n.formatDate(t * 1000, { day: '2-digit', month: 'short' });
	}

	let lastRefreshedAt = 0;

	async function refresh(
		reason: 'interval' | 'focus' | 'visible' | 'event' | 'boot' = 'boot',
		force = false
	) {
		const targetPath = projectPath;
		if (!targetPath) return;

		// Se non forzato, rispetta la soglia di 5 s per evitare tempeste di spawn git
		if (!force && Date.now() - lastRefreshedAt < 5000) {
			return;
		}

		const projectName = targetPath.split(/[/\\]/).filter(Boolean).pop() || targetPath;
		const end = perfSpan('poll', `gitpanel ${projectName} reason=${reason}`);
		refreshError = null;
		isRefreshing = true;
		try {
			const [branchRes, statusRes, numstatRes, lastRes, recentRes] = await Promise.all([
				invoke('git_current_branch', { projectPath: targetPath }),
				invoke('project_git_status', { projectPath: targetPath }),
				invoke('git_working_numstat', { projectPath: targetPath }),
				invoke('git_last_commit', { projectPath: targetPath }),
				invoke('git_recent_commits', { projectPath: targetPath, limit: 10 })
			]);

			lastRefreshedAt = Date.now();

			// Scarta i risultati se nel frattempo e' stato selezionato un altro progetto
			if (projectPath !== targetPath) return;

			const b = (branchRes as string) || '';
			const statuses = ((statusRes as { statuses: Record<string, string> })?.statuses) || {};
			const nums = (numstatRes ?? {}) as Record<string, { insertions: number | null; deletions: number | null }>;
			const last = (lastRes as CommitInfo | null) ?? null;
			const rec = (recentRes as CommitInfo[]) ?? [];

			// Se non c'e' branch e non ci sono commit ne' modifiche, la cartella non e' un repository
			if (!b && Object.keys(statuses).length === 0 && !last && rec.length === 0) {
				notRepo = true;
				branch = '';
				workingFiles = [];
				lastCommit = null;
				commits = [];
				return;
			}

			notRepo = false;
			branch = b;
			const nextWorking = Object.entries(statuses)
				.map(([p, st]) => ({
					path: p,
					status: st,
					insertions: nums[p]?.insertions ?? null,
					deletions: nums[p]?.deletions ?? null
				}))
				.sort((a, b) => a.path.localeCompare(b.path));
			const fresh = new Set<string>();
			knownWorking = trackFresh(knownWorking, nextWorking.map((f) => f.path), fresh);
			knownCommits = trackFresh(knownCommits, rec.map((c) => c.hash), fresh);
			freshKeys = fresh;
			workingFiles = nextWorking;
			lastCommit = last;
			commits = rec;
			void githubStore.loadUpstreamStatus(targetPath, force);
			void githubStore.loadActionsStatus(targetPath, b || undefined);
		} catch (e) {
			if (projectPath !== targetPath) return;
			const msg = String(e);
			if (msg.toLowerCase().includes('not a git repository') || msg.toLowerCase().includes('non e\' un repository')) {
				notRepo = true;
				refreshError = null;
			} else {
				notRepo = false;
				refreshError = msg;
			}
		} finally {
			if (projectPath === targetPath) isRefreshing = false;
			end();
		}
	}

	$effect(() => {
		if (!projectPath) return;
		void refresh('boot', true);
		void loadBranches();
		void loadSessions();

		const onFocus = () => {
			const wasRecent = Date.now() - lastRefreshedAt < 5000;
			void refresh('focus', false);
			if (!wasRecent) {
				void loadBranches();
			}
		};

		const onGitRefresh = (event: Event) => {
			const target = (event as CustomEvent<GitStatusRefreshDetail>).detail?.projectPath;
			if (
				target &&
				normalizeProjectPath(target).toLowerCase() !== normalizeProjectPath(projectPath).toLowerCase()
			) {
				return;
			}
			void refresh('event', true);
			void loadBranches();
		};

		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				void refresh('visible', false);
			}
		};

		// L'agente committa mentre la finestra e' gia' a fuoco: il solo evento
		// focus non basterebbe a raccogliere i suoi commit.
		// Salta i tick quando la finestra e' nascosta o ridotta a icona.
		const iv = setInterval(() => {
			if (document.visibilityState === 'hidden') return;
			void refresh('interval', false);
		}, 15000);

		window.addEventListener('git-status-refresh', onGitRefresh);
		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			window.removeEventListener('git-status-refresh', onGitRefresh);
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			clearInterval(iv);
		};
	});

	function toggleCommit(hash: string) {
		expandedCommit = expandedCommit === hash ? null : hash;
	}

	async function loadBranches() {
		const targetPath = projectPath;
		if (!targetPath) return;
		try {
			const res = await invoke<{ name: string; current: boolean }[]>('git_branch_list', { projectPath: targetPath });
			if (projectPath !== targetPath) return;
			branches = res;
			const cur = branches.find((b) => b.current);
			if (cur) branch = cur.name;
		} catch {
			// Se il branch list fallisce o non e' git, svuotiamo la lista
			if (projectPath !== targetPath) return;
			branches = [];
		}
	}

	async function loadSessions() {
		const targetPath = projectPath;
		if (!targetPath) return;
		try {
			const res = await fetchSessionsList(targetPath);
			if (projectPath !== targetPath) return;
			sessions = res;
		} catch {
			// Se la lista sessioni fallisce, degrada a vuoto
			if (projectPath !== targetPath) return;
			sessions = [];
		}
	}


	async function checkout(name: string) {
		actionError = null;
		try {
			await invoke('git_branch_checkout', { projectPath, name });
			branchMenuOpen = false;
			notifyGitStatusRefresh(projectPath);
		} catch (e) {
			actionError = String(e);
		}
	}

	async function createBranch() {
		const name = newBranchName.trim();
		if (!name) return;
		actionError = null;
		try {
			await invoke('git_branch_create', { projectPath, name });
			newBranchName = '';
			branchMenuOpen = false;
			notifyGitStatusRefresh(projectPath);
		} catch (e) {
			actionError = String(e);
		}
	}
</script>

<div class="git-panel">
	{#if notRepo}
		<div class="empty">{m.git_no_repo()}</div>
	{:else if refreshError}
		<div class="git-error" role="alert">
			<span class="git-error-text" title={refreshError}>{m.ui_gitpanel_errore_git_dc97()} {refreshError}</span>
			<button type="button" class="retry-btn" onclick={() => void refresh()}>{m.git_btn_retry()}</button>
		</div>
	{:else}
		<div class="branch-row">
			<MenuButton
				open={branchMenuOpen}
				ariaLabel={`${m.git_change_branch()}: ${branch || '—'}`}
				tooltip={m.git_change_branch()}
				width="260px"
				className="branch-trigger"
				onToggle={() => (branchMenuOpen = !branchMenuOpen)}
				onClose={() => (branchMenuOpen = false)}
			>
				{#snippet trigger()}
					<span class="branch-icon" aria-hidden="true"><IconGitBranch /></span>
					<span class="branch-name">{branch || '—'}</span>
					<span class="branch-caret" aria-hidden="true"><IconChevronDown /></span>
				{/snippet}
				{#each branches as b (b.name)}
					<button
						type="button"
						class="branch-item"
						role="menuitemradio"
						aria-checked={b.current}
						disabled={b.current}
						onclick={() => checkout(b.name)}
					>
						<span class="branch-check" aria-hidden="true">{#if b.current}<IconCheck />{/if}</span>
						<span class="branch-item-name">{b.name}</span>
					</button>
				{/each}
				<div class="branch-new">
					<input
						class="ui-input branch-input"
						placeholder={m.ui_gitpanel_feature_nuova_idea_d0a3()}
						aria-label={m.git_btn_create_branch()}
						bind:value={newBranchName}
						onkeydown={(e) => {
							if (e.key === 'Enter') void createBranch();
						}}
					/>
					<Tooltip text={m.git_btn_create_branch()}>
						<button
							type="button"
							class="ui-button ui-button-secondary branch-create"
							aria-label={m.git_btn_create_branch()}
							onclick={() => void createBranch()}
						>
							<IconPlus />
						</button>
					</Tooltip>
				</div>
			</MenuButton>
		</div>

		<!-- Sezione GitHub Sync & Upstream -->
		{#if upstream && upstream.isGit}
			<div class="sync-card">
				<div class="sync-status-row">
					<div class="sync-info">
						{#if upstream.upstream}
							<span class="upstream-name" title={`Traccia ${upstream.upstream}`}>
								<span class="upstream-icon" aria-hidden="true"><IconCloud /></span>
								{upstream.upstream}
							</span>
						{:else}
							<span class="upstream-none">Nessun upstream</span>
						{/if}
						{#if upstream.ahead > 0 || upstream.behind > 0}
							<div class="divergence-pills">
								{#if upstream.behind > 0}
									<button
										type="button"
										class="div-pill clickable"
										aria-expanded={showIncomingCommits}
										onclick={() => (showIncomingCommits = !showIncomingCommits)}
										title={m.topbar_upstream_behind_tooltip({ count: upstream.behind })}
									>
										<IconArrowDown />{upstream.behind}
									</button>
								{/if}
								{#if upstream.ahead > 0}
									<span class="div-pill" title={m.topbar_upstream_ahead_tooltip({ count: upstream.ahead })}>
										<IconArrowUp />{upstream.ahead}
									</span>
								{/if}
							</div>
						{:else if upstream.upstream}
							<span class="sync-aligned"><IconCheck />{m.git_upstream_aligned()}</span>
						{/if}
					</div>

					<div class="sync-actions">
						{#if upstream.behind > 0 && upstream.ahead === 0}
							<button
								type="button"
								class="ui-button ui-button-primary btn-sync"
								onclick={() => handleSync('pull')}
								disabled={isSyncing}
								title="Scarica i commit da GitHub (pull rebase)"
							>
								{isSyncing ? '…' : 'Pull'}
							</button>
						{:else if upstream.ahead > 0 && upstream.behind === 0}
							<button
								type="button"
								class="ui-button ui-button-primary btn-sync"
								onclick={() => handleSync('push')}
								disabled={isSyncing}
								title="Invia i commit a GitHub (push)"
							>
								{isSyncing ? '…' : 'Push'}
							</button>
						{:else if upstream.ahead > 0 && upstream.behind > 0}
							<button
								type="button"
								class="ui-button ui-button-primary btn-sync"
								onclick={() => handleSync('sync')}
								disabled={isSyncing}
								title="Pull e push combinati"
							>
								{isSyncing ? '…' : 'Sync'}
							</button>
						{:else}
							<button
								type="button"
								class="ui-button ui-button-secondary btn-sync"
								onclick={() => handleSync('fetch')}
								disabled={isSyncing}
								title="Controlla nuovi commit su GitHub (fetch)"
							>
								{isSyncing ? '…' : 'Fetch'}
							</button>
						{/if}
					</div>
				</div>

				{#if syncMessage}
					<div class="sync-feedback">{syncMessage}</div>
				{/if}

				<!-- Commit in arrivo espandibili -->
				{#if showIncomingCommits && upstream.incomingCommits.length > 0}
					<div class="incoming-commits-list">
						<div class="incoming-head">{m.git_incoming_commits()}</div>
						{#each upstream.incomingCommits as c (c.hash)}
							<div class="incoming-commit-row" title={`${c.author} · ${c.date}`}>
								<span class="commit-hash">{c.shortHash}</span>
								<span class="commit-subject">{c.subject}</span>
								<span class="commit-date">{c.date}</span>
							</div>
						{/each}
					</div>
				{/if}

				<!-- GitHub Actions CI Status: esito con icona e testo, senza fondo -->
				{#if latestAction}
					{@const ci =
						latestAction.conclusion === 'success'
							? 'success'
							: latestAction.conclusion === 'failure'
								? 'failure'
								: 'running'}
					<div class="actions-status-row">
						<span class="ci-label">CI</span>
						<span class="ci-outcome {ci}">
							{#if ci === 'success'}
								<IconCheck />{m.git_ci_success()}
							{:else if ci === 'failure'}
								<IconClose />{m.git_ci_failure()}
							{:else}
								<StatusMark status="running" />{m.git_ci_running()}
							{/if}
						</span>
						<span class="ci-name" title={latestAction.name}>{latestAction.name}</span>
						<Tooltip text="Apri su GitHub">
							<button
								type="button"
								class="ci-link"
								aria-label="Apri su GitHub"
								onclick={() => void openUrl(latestAction!.url)}
							>
								<IconExternalLink />
							</button>
						</Tooltip>
					</div>
				{/if}
			</div>
		{/if}

		<div class="section-label">
			{m.git_uncommitted()}
			{#if isRefreshing}<StatusMark status="running" />{/if}
			{#if workingFiles.length > 0}<span class="count">{workingFiles.length}</span>{/if}
		</div>
		{#if workingFiles.length === 0}
			<div class="empty">{m.git_clean_tree()}</div>
		{:else}
			{#each workingFiles as f (f.path)}
				<button
					class="row"
					in:chatReveal={{ duration: freshKeys.has(f.path) ? undefined : 0 }}
					title="{f.path} — clicca per il diff con HEAD"
					onclick={() => onOpenWorkingDiff?.(f.path)}
				>
					<GitStatusMark status={f.status} />
					<span class="name"><span class="dir">{dirName(f.path)}</span>{baseName(f.path)}</span>
					{#if f.insertions !== null || f.deletions !== null}
						<span class="nums">
							{#if f.insertions}<span class="ins">+{f.insertions}</span>{/if}
							{#if f.deletions}<span class="del">−{f.deletions}</span>{/if}
						</span>
					{/if}
				</button>
			{/each}
		{/if}

		<div class="section-label">{m.git_recent_sessions()}</div>
		{#if sessions.length === 0}
			<div class="empty">{m.git_no_sessions()}</div>
		{:else}
			{#each sessions.slice(0, 8) as s (s.id)}
				<button
					class="row session-row"
					disabled={!canResume}
					title={canResume ? m.ui_gitpanel_value1_clicca_per_riprendere_questa_sessione_968c({ value1: s.title ?? s.prompt }) : resumeReason}
					onclick={() => onResumeSession?.(s.id)}
				>
					<span class="session-badge" aria-hidden="true"><IconDiamond /></span>
					<span class="name">{s.title || s.prompt || m.session_list_untitled()}</span>
					<span class="nums"><span class="session-time">{relTime(s.created_at)}</span></span>
				</button>
			{/each}
		{/if}
		{#if actionError}
			<div class="action-error" title={actionError}>{actionError}</div>
		{/if}
		{#if lastCommit}
			<div class="section-label">{m.git_last_commit()}</div>
			<div class="commit-card">
				<button class="commit-head" title={lastCommit.hash} onclick={() => toggleCommit(lastCommit!.hash)}>
					<span class="subject">{lastCommit.subject}</span>
					<span class="meta">{lastCommit.short} · {lastCommit.author} · {relTime(lastCommit.time)}</span>
				</button>
				{#each lastCommit.files as f (f.path)}
					<button
						class="row sub"
						title="{f.path} — diff di questo commit"
						onclick={() => onOpenCommitDiff?.(f.path, lastCommit!.hash, lastCommit!.short)}
					>
						<GitStatusMark status={f.status} />
						<span class="name"><span class="dir">{dirName(f.path)}</span>{baseName(f.path)}</span>
						{#if f.insertions !== null || f.deletions !== null}
							<span class="nums">
								{#if f.insertions}<span class="ins">+{f.insertions}</span>{/if}
								{#if f.deletions}<span class="del">−{f.deletions}</span>{/if}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		{#if commits.length > 1}
			<div class="section-label">{m.git_history()}</div>
			{#each commits.slice(1) as c (c.hash)}
				<div class="commit-card" in:chatReveal={{ duration: freshKeys.has(c.hash) ? undefined : 0 }}>
					<button class="commit-head" title={c.hash} onclick={() => toggleCommit(c.hash)}>
						<span class="dot" aria-hidden="true"></span>
						<span class="subject">{c.subject}</span>
						<span class="meta">{c.short} · {relTime(c.time)}</span>
					</button>
					{#if expandedCommit === c.hash}
						{#each c.files as f (f.path)}
							<button
								class="row sub"
								title="{f.path} — diff di questo commit"
								onclick={() => onOpenCommitDiff?.(f.path, c.hash, c.short)}
							>
								<GitStatusMark status={f.status} />
								<span class="name"><span class="dir">{dirName(f.path)}</span>{baseName(f.path)}</span>
							</button>
						{/each}
					{/if}
				</div>
			{/each}
		{/if}
	{/if}
</div>

<style>
	.git-panel {
		padding: var(--space-2) 0 var(--space-4);
		font-family: var(--font-ui);
	}

	/* Il trigger del menu branch occupa tutta la riga: MenuButton e Tooltip
	   nascono inline, qui si allargano. */
	.branch-row {
		display: flex;
		align-items: center;
		padding: 0 var(--space-2);
	}

	.branch-row :global(.tooltip-wrapper),
	.branch-row :global(.menu-button-container) {
		flex: 1;
		min-width: 0;
	}

	.branch-row :global(.branch-trigger) {
		width: 100%;
		min-width: 0;
		height: 26px;
		padding: 0 var(--space-1);
		color: var(--ink);
	}

	.branch-icon,
	.branch-caret {
		display: inline-flex;
		color: var(--ink-faint);
	}

	.branch-caret {
		--icon-size: 12px;
		margin-left: auto;
	}

	.branch-name {
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Etichetta di sezione in frase: niente maiuscolo spaziato sotto le schede. */
	.section-label {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-3) var(--space-3) var(--space-1);
		color: var(--ink-muted);
		font-size: var(--text-label);
		font-weight: 500;
	}

	.count {
		background: var(--bg-active);
		color: var(--ink-muted);
		border-radius: var(--radius-full);
		padding: 0 6px;
		line-height: 16px;
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	/* Righe del menu branch: stesso passo delle righe di MenuButton. */
	.branch-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 7px 8px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		cursor: pointer;
		text-align: left;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.branch-item:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.branch-item:disabled {
		cursor: default;
	}

	.branch-item-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.branch-check {
		display: inline-flex;
		width: 12px;
		flex-shrink: 0;
		--icon-size: 12px;
		color: var(--brand-ink);
	}

	.branch-new {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-1) 0;
		border-top: 1px solid var(--line);
		margin-top: var(--space-1);
	}

	.branch-input {
		flex: 1;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
	}

	.branch-create {
		height: 30px;
		padding: 0 var(--space-2);
	}

	/* Errore d'azione: esito in testo meta, senza fondo. */
	.action-error {
		margin: var(--space-1) var(--space-3);
		color: var(--danger);
		font-size: var(--text-meta);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.session-badge {
		display: inline-flex;
		width: 14px;
		justify-content: center;
		flex-shrink: 0;
		color: var(--brand-ink);
		--icon-size: 12px;
	}

	.session-time {
		color: var(--ink-faint);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 24px;
		padding: 0 var(--space-3);
		background: transparent;
		border: none;
		color: var(--ink);
		font-size: var(--text-body);
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
	}

	/* Le righe stanno in un contenitore che taglia: l'anello va all'interno. */
	.row:focus-visible,
	.commit-head:focus-visible {
		outline-offset: -2px;
	}

	.row:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.row:disabled {
		cursor: default;
	}

	.row.sub {
		padding-left: var(--space-4);
	}

	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dir {
		color: var(--ink-faint);
	}

	.nums {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
		display: inline-flex;
		gap: 4px;
	}

	/* Esito del diff: verde e rosso sempre con il segno + e −. */
	.ins { color: var(--success); }
	.del { color: var(--danger); }

	.commit-card {
		margin: 0 var(--space-2) var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.commit-head {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 1px;
		width: 100%;
		padding: 5px var(--space-2);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.commit-head:hover {
		background: var(--bg-hover);
	}

	.subject {
		color: var(--ink);
		font-size: var(--text-body);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		flex-shrink: 0;
	}

	.meta {
		color: var(--ink-faint);
		font-size: var(--text-meta);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty {
		padding: 2px var(--space-3);
		color: var(--ink-faint);
		font-size: var(--text-caption);
	}

	.git-error {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-1) var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--danger);
		font-size: var(--text-meta);
	}

	.git-error-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.git-error .retry-btn {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		padding: 1px 6px;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.git-error .retry-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	/* Scheda di sincronizzazione: superficie neutra, solo il bordo la separa. */
	.sync-card {
		margin: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.sync-status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.sync-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		min-width: 0;
	}

	.upstream-name {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-muted);
		--icon-size: 12px;
	}

	.upstream-icon {
		display: inline-flex;
		color: var(--ink-faint);
	}

	.upstream-none {
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-style: italic;
	}

	.sync-aligned {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-meta);
		color: var(--ink-muted);
		--icon-size: 12px;
	}

	.divergence-pills {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	/* Conteggi ahead/behind neutri: la freccia dice la direzione. */
	.div-pill {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 18px;
		padding: 0 6px 0 4px;
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		--icon-size: 12px;
	}

	.div-pill.clickable {
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.div-pill.clickable:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.btn-sync {
		white-space: nowrap;
	}

	.sync-feedback {
		font-size: var(--text-meta);
		color: var(--ink-muted);
		line-height: 1.3;
	}

	.incoming-commits-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding-top: var(--space-1);
		border-top: 1px solid var(--line);
	}

	.incoming-head {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.incoming-commit-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-meta);
	}

	.commit-hash {
		font-family: var(--font-mono);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.commit-subject {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
	}

	.commit-date {
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}

	.actions-status-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-top: var(--space-1);
		border-top: 1px solid var(--line);
		font-size: var(--text-meta);
	}

	.ci-label {
		font-weight: 500;
		color: var(--ink-muted);
	}

	/* Esito CI come testo con icona, mai una pillola piena. */
	.ci-outcome {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		--icon-size: 12px;
	}

	.ci-outcome.success { color: var(--success); }
	.ci-outcome.failure { color: var(--danger); }
	.ci-outcome.running { color: var(--ink-muted); }

	.ci-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
	}

	.ci-link {
		display: flex;
		align-items: center;
		padding: 2px;
		background: none;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.ci-link:hover {
		color: var(--ink);
	}
</style>
