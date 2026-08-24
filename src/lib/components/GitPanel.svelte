<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';

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
	let branchBtnEl = $state<HTMLButtonElement | null>(null);
	let branchMenuEl = $state<HTMLDivElement | null>(null);
	let newBranchName = $state('');
	let workingFiles = $state<WorkingFile[]>([]);
	let lastCommit = $state<CommitInfo | null>(null);
	let commits = $state<CommitInfo[]>([]);
	let expandedCommit = $state<string | null>(null);
	let notRepo = $state(false);
	let refreshError = $state<string | null>(null);
	let sessions = $state<{ id: string; title: string; created_at: number }[]>([]);
	let actionError = $state<string | null>(null);
	function baseName(p: string): string {
		return p.split('/').pop() || p;
	}

	function dirName(p: string): string {
		const idx = p.lastIndexOf('/');
		return idx === -1 ? '' : p.slice(0, idx + 1);
	}

	function relTime(t: number): string {
		const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
		if (s < 60) return 'adesso';
		const m = Math.floor(s / 60);
		if (m < 60) return `${m} min`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} h`;
		const d = Math.floor(h / 24);
		if (d < 7) return `${d} g`;
		return new Date(t * 1000).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
	}

	async function refresh() {
		const targetPath = projectPath;
		if (!targetPath) return;
		refreshError = null;

		try {
			const [branchRes, statusRes, numstatRes, lastRes, recentRes] = await Promise.all([
				invoke('git_current_branch', { projectPath: targetPath }),
				invoke('project_git_status', { projectPath: targetPath }),
				invoke('git_working_numstat', { projectPath: targetPath }),
				invoke('git_last_commit', { projectPath: targetPath }),
				invoke('git_recent_commits', { projectPath: targetPath, limit: 10 })
			]);

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
			workingFiles = Object.entries(statuses)
				.map(([p, st]) => ({
					path: p,
					status: st,
					insertions: nums[p]?.insertions ?? null,
					deletions: nums[p]?.deletions ?? null
				}))
				.sort((a, b) => a.path.localeCompare(b.path));
			lastCommit = last;
			commits = rec;
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
		}
	}

	$effect(() => {
		if (!projectPath) return;
		void refresh();
		void loadBranches();
		void loadSessions();
		const onFocus = () => {
			void refresh();
			void loadBranches();
		};
		window.addEventListener('git-status-refresh', onFocus);
		window.addEventListener('focus', onFocus);
		// L'agente committa mentre la finestra e' gia' a fuoco: il solo evento
		// focus non basterebbe a raccogliere i suoi commit.
		const iv = setInterval(() => void refresh(), 15000);
		return () => {
			window.removeEventListener('git-status-refresh', onFocus);
			window.removeEventListener('focus', onFocus);
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
			const res = await invoke<{ id: string; title: string; created_at: number }[]>('sessions_list', { projectPath: targetPath });
			if (projectPath !== targetPath) return;
			sessions = res;
		} catch {
			// Se la lista sessioni fallisce, degrada a vuoto
			if (projectPath !== targetPath) return;
			sessions = [];
		}
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && branchMenuOpen) {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
				if (!branchMenuEl?.contains(t)) return;
			}
			branchMenuOpen = false;
			branchBtnEl?.focus();
		}
	}

	function handleWindowPointerDown(e: MouseEvent) {
		if (!branchMenuOpen) return;
		const target = e.target as Node | null;
		if (target && !branchMenuEl?.contains(target) && !branchBtnEl?.contains(target)) {
			branchMenuOpen = false;
		}
	}

	$effect(() => {
		if (branchMenuOpen) {
			window.addEventListener('pointerdown', handleWindowPointerDown);
			window.addEventListener('keydown', handleWindowKeydown);
			return () => {
				window.removeEventListener('pointerdown', handleWindowPointerDown);
				window.removeEventListener('keydown', handleWindowKeydown);
			};
		}
	});

	async function checkout(name: string) {
		actionError = null;
		try {
			await invoke('git_branch_checkout', { projectPath, name });
			branchMenuOpen = false;
			void refresh();
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
			void refresh();
		} catch (e) {
			actionError = String(e);
		}
	}
</script>

<div class="git-panel">
	{#if notRepo}
		<div class="empty">Nessun repository git in questo progetto</div>
	{:else if refreshError}
		<div class="git-error" role="alert">
			<span class="git-error-text" title={refreshError}>Errore git: {refreshError}</span>
			<button type="button" class="retry-btn" onclick={() => void refresh()}>Riprova</button>
		</div>
	{:else}
		<div class="branch-row" title="Branch corrente">
			<button
				bind:this={branchBtnEl}
				class="branch-btn"
				onclick={() => (branchMenuOpen = !branchMenuOpen)}
				title="Cambia branch"
				aria-haspopup="menu"
				aria-expanded={branchMenuOpen}
			>
				<span class="branch-icon" aria-hidden="true">⑂</span>
				<span class="branch-name">{branch || '—'}</span>
				<span class="branch-caret" aria-hidden="true">▾</span>
			</button>
		</div>

		<div class="section-label">
			Non committate
			{#if workingFiles.length > 0}<span class="count">{workingFiles.length}</span>{/if}
		</div>
		{#if workingFiles.length === 0}
			<div class="empty">Albero pulito</div>
		{:else}
			{#each workingFiles as f (f.path)}
				<button
					class="row"
					title="{f.path} — clicca per il diff con HEAD"
					onclick={() => onOpenWorkingDiff?.(f.path)}
				>
					<span class="badge st-{f.status}">{f.status}</span>
					<span class="name"><span class="dir">{dirName(f.path)}</span>{baseName(f.path)}</span>
					{#if f.insertions !== null || f.deletions !== null}
						<span class="nums">
							{#if f.insertions}<span class="ins">+{f.insertions}</span>{/if}
							{#if f.deletions}<span class="del">-{f.deletions}</span>{/if}
						</span>
					{/if}
				</button>
			{/each}
		{/if}

		<div class="section-label">Sessioni recenti</div>
		{#if sessions.length === 0}
			<div class="empty">Nessuna sessione</div>
		{:else}
			{#each sessions.slice(0, 8) as s (s.id)}
				<button
					class="row session-row"
					disabled={!canResume}
					title={canResume ? `${s.title} — clicca per riprendere questa sessione` : resumeReason}
					onclick={() => onResumeSession?.(s.id)}
				>
					<span class="badge session-badge" aria-hidden="true">◆</span>
					<span class="name">{s.title || 'Sessione senza titolo'}</span>
					<span class="nums"><span class="session-time">{relTime(s.created_at)}</span></span>
				</button>
			{/each}
		{/if}
		{#if branchMenuOpen}
			<div class="branch-menu" bind:this={branchMenuEl} role="menu">
				{#each branches as b (b.name)}
					<button
						class="branch-item"
						class:current={b.current}
						onclick={() => checkout(b.name)}
						disabled={b.current}
						title={b.current ? 'Branch attivo' : `Passa a ${b.name}`}
						role="menuitem"
					>
						<span class="branch-check">{b.current ? '●' : ''}</span>
						{b.name}
					</button>
				{/each}
				<div class="branch-new">
					<input
						class="branch-input"
						placeholder="feature/nuova-idea"
						bind:value={newBranchName}
						onkeydown={(e) => {
							if (e.key === 'Enter') void createBranch();
						}}
					/>
					<button class="branch-create" onclick={() => void createBranch()} title="Crea e passa al nuovo branch">+</button>
				</div>
			</div>
		{/if}
		{#if actionError}
			<div class="action-error" title={actionError}>{actionError}</div>
		{/if}
		{#if lastCommit}
			<div class="section-label">Ultimo commit</div>
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
						<span class="badge st-{f.status}">{f.status}</span>
						<span class="name"><span class="dir">{dirName(f.path)}</span>{baseName(f.path)}</span>
						{#if f.insertions !== null || f.deletions !== null}
							<span class="nums">
								{#if f.insertions}<span class="ins">+{f.insertions}</span>{/if}
								{#if f.deletions}<span class="del">-{f.deletions}</span>{/if}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		{#if commits.length > 1}
			<div class="section-label">Storico</div>
			{#each commits.slice(1) as c (c.hash)}
				<div class="commit-card">
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
								<span class="badge st-{f.status}">{f.status}</span>
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

	.branch-row {
		display: flex;
		align-items: center;
		padding: 0 var(--space-2);
	}

	.branch-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 26px;
		padding: 0 var(--space-1);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
	}

	.branch-btn:hover {
		background: var(--bg-hover);
	}

	.branch-caret {
		color: var(--ink-faint);
		font-size: 9px;
		margin-left: auto;
	}

	.branch-icon {
		color: var(--ink-faint);
		font-size: var(--text-base);
		line-height: 1;
	}

	.branch-name {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.section-label {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-3) var(--space-3) var(--space-1);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.branch-menu {
		margin: 0 var(--space-2) var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-overlay);
		padding: var(--space-1);
		max-height: 220px;
		overflow-y: auto;
	}

	.branch-item {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 24px;
		padding: 0 var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		cursor: pointer;
		text-align: left;
	}

	.branch-item:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.branch-item.current {
		color: var(--brand-ink);
		cursor: default;
	}

	.branch-check {
		width: 10px;
		flex-shrink: 0;
		font-size: 8px;
	}

	.branch-new {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: var(--space-1) var(--space-1) 0;
		border-top: 1px solid var(--line);
		margin-top: var(--space-1);
	}

	.branch-input {
		flex: 1;
		min-width: 0;
		height: 24px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 0 var(--space-2);
	}

	.branch-input:focus {
		outline: none;
		border-color: var(--brand-dim);
	}

	.branch-create {
		width: 24px;
		height: 24px;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		font-size: var(--text-md);
		line-height: 1;
	}

	.branch-create:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.action-error {
		margin: var(--space-1) var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: var(--bg-overlay);
		border-left: none;
		border-radius: var(--radius-sm);
		color: var(--git-deleted);
		font-size: var(--text-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.session-badge {
		color: var(--brand-ink);
		font-size: 8px;
	}

	.session-time {
		color: var(--ink-faint);
	}

	.count {
		font-family: var(--font-mono);
		background: var(--bg-active);
		color: var(--ink-muted);
		border-radius: var(--radius-full);
		padding: 0 6px;
		line-height: 16px;
		font-size: 10px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 22px;
		padding: 0 var(--space-3);
		background: transparent;
		border: none;
		color: var(--ink);
		font-size: var(--text-sm);
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
	}

	.row:hover {
		background: var(--bg-hover);
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

	.badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
		width: 14px;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.badge.st-M { color: var(--git-modified); }
	.badge.st-A { color: var(--git-added); }
	.badge.st-U { color: var(--git-untracked); }
	.badge.st-D { color: var(--git-deleted); }
	.badge.st-R { color: var(--git-renamed); }
	.badge.st-C { color: var(--git-conflict); }

	.nums {
		font-family: var(--font-mono);
		font-size: 10px;
		flex-shrink: 0;
		display: inline-flex;
		gap: 4px;
	}

	.ins { color: var(--git-added); }
	.del { color: var(--git-deleted); }

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
		font-size: var(--text-sm);
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
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty {
		padding: 2px var(--space-3);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.git-error {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-1) var(--space-2);
		padding: var(--space-2);
		background: var(--bg-overlay);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: var(--text-xs);
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
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		padding: 1px 6px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.git-error .retry-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}
</style>
