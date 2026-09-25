import { invoke } from '@tauri-apps/api/core';
import { projectStore, normalizeProjectPath, joinProjectPath } from './projects.svelte';

export interface GithubAuthStatus {
	installed: boolean;
	authenticated: boolean;
	username: string | null;
	name: string | null;
	avatarUrl: string | null;
	method: 'gh_cli' | 'token' | 'none';
	protocol: 'https' | 'ssh';
	error: string | null;
}

export interface DetectedGithubRemote {
	folderName: string;
	path: string;
	repoOwner: string;
	repoName: string;
	fullName: string;
	url: string;
}

export interface GithubRemoteRepo {
	name: string;
	fullName: string;
	isPrivate: boolean;
	description: string | null;
	url: string;
	sshUrl: string | null;
	defaultBranch: string;
	updatedAt: string;
}

export interface CommitSummary {
	hash: string;
	shortHash: string;
	subject: string;
	author: string;
	date: string;
}

export interface GitUpstreamStatus {
	isGit: boolean;
	branch: string;
	upstream: string | null;
	ahead: number;
	behind: number;
	incomingCommits: CommitSummary[];
	outgoingCommits: CommitSummary[];
	hasUncommitted: boolean;
}

export interface GithubActionRun {
	id: number;
	name: string;
	status: string; // 'completed' | 'in_progress' | 'queued'
	conclusion: string | null; // 'success' | 'failure' | 'cancelled' | null
	url: string;
	event: string;
	headSha: string;
	headBranch: string;
	createdAt: string;
}

class GithubStore {
	status = $state<GithubAuthStatus>({
		installed: false,
		authenticated: false,
		username: null,
		name: null,
		avatarUrl: null,
		method: 'none',
		protocol: 'https',
		error: null
	});

	isLoadingStatus = $state(false);
	isLoadingRepos = $state(false);
	isInstallingCli = $state(false);
	remoteRepos = $state<GithubRemoteRepo[]>([]);
	reposError = $state<string | null>(null);

	localRemotes = $state<DetectedGithubRemote[]>([]);
	isLoadingRemotes = $state(false);

	cloningRepoUrl = $state<string | null>(null);
	cloneError = $state<string | null>(null);

	upstreamByPath = $state<Record<string, GitUpstreamStatus>>({});
	isSyncingByPath = $state<Record<string, boolean>>({});

	actionsByPath = $state<Record<string, GithubActionRun[]>>({});
	isLoadingActionsByPath = $state<Record<string, boolean>>({});

	private upstreamUpdatedAt = new Map<string, number>();
	private upstreamPending = new Map<string, Promise<GitUpstreamStatus | null>>();
	private UPSTREAM_CACHE_TTL_MS = 5_000;

	private lastReposFetch = 0;
	private REPOS_CACHE_TTL_MS = 60_000;

	constructor() {
		void this.loadStatus();
	}

	async loadStatus(): Promise<GithubAuthStatus> {
		this.isLoadingStatus = true;
		try {
			const res = await invoke<GithubAuthStatus>('github_get_status');
			this.status = res;
			return res;
		} catch (e) {
			console.error('github_get_status', e);
			this.status = {
				installed: false,
				authenticated: false,
				username: null,
				name: null,
				avatarUrl: null,
				method: 'none',
				protocol: 'https',
				error: String(e)
			};
			return this.status;
		} finally {
			this.isLoadingStatus = false;
		}
	}

	async setToken(token: string): Promise<GithubAuthStatus> {
		this.isLoadingStatus = true;
		try {
			const res = await invoke<GithubAuthStatus>('github_set_token', { token });
			this.status = res;
			if (res.authenticated) {
				void this.loadRemoteRepos(true);
			}
			return res;
		} finally {
			this.isLoadingStatus = false;
		}
	}

	async logout(): Promise<void> {
		try {
			await invoke('github_logout');
			this.status = {
				installed: this.status.installed,
				authenticated: false,
				username: null,
				name: null,
				avatarUrl: null,
				method: 'none',
				protocol: 'https',
				error: null
			};
			this.remoteRepos = [];
		} catch (e) {
			console.error('github_logout', e);
		}
	}

	async installCli(): Promise<string> {
		this.isInstallingCli = true;
		try {
			const msg = await invoke<string>('github_install_cli');
			await this.loadStatus();
			return msg;
		} finally {
			this.isInstallingCli = false;
		}
	}

	async loadRemoteRepos(force = false): Promise<GithubRemoteRepo[]> {
		if (!this.status.authenticated) return [];
		const now = Date.now();
		if (!force && this.remoteRepos.length > 0 && now - this.lastReposFetch < this.REPOS_CACHE_TTL_MS) {
			return this.remoteRepos;
		}

		this.isLoadingRepos = true;
		this.reposError = null;
		try {
			const repos = await invoke<GithubRemoteRepo[]>('github_list_remote_repos', { limit: 100 });
			this.remoteRepos = repos;
			this.lastReposFetch = Date.now();
			return repos;
		} catch (e) {
			this.reposError = String(e);
			console.error('github_list_remote_repos', e);
			return [];
		} finally {
			this.isLoadingRepos = false;
		}
	}

	async detectLocalRemotes(projectRoot?: string): Promise<DetectedGithubRemote[]> {
		const root = projectRoot || projectStore.projectRoot;
		if (!root) return [];
		this.isLoadingRemotes = true;
		try {
			const list = await invoke<DetectedGithubRemote[]>('project_detect_github_remotes', {
				projectRoot: root
			});
			this.localRemotes = list;
			return list;
		} catch (e) {
			console.error('project_detect_github_remotes', e);
			return [];
		} finally {
			this.isLoadingRemotes = false;
		}
	}

	async cloneRepo(repoUrl: string, targetPath?: string): Promise<string> {
		this.cloningRepoUrl = repoUrl;
		this.cloneError = null;
		try {
			let destination = targetPath;
			if (!destination) {
				// Estrae nome cartella dall'URL
				const clean = repoUrl.trim().replace(/\.git$/, '');
				const folderName = clean.split('/').pop() || 'cloned-repo';
				destination = joinProjectPath(projectStore.projectRoot, folderName);
			}

			const clonedPath = await invoke<string>('github_clone_repo', {
				repoUrl,
				targetPath: destination
			});

			// Apri subito il progetto in Studio
			projectStore.openProject(clonedPath);
			void this.detectLocalRemotes();
			return clonedPath;
		} catch (e) {
			this.cloneError = String(e);
			throw e;
		} finally {
			this.cloningRepoUrl = null;
		}
	}

	/** Indica se lo stato upstream per il percorso e' stato aggiornato di recente. */
	wasUpstreamRefreshedRecently(projectPath: string, thresholdMs = this.UPSTREAM_CACHE_TTL_MS): boolean {
		const key = normalizeProjectPath(projectPath).toLowerCase();
		if (!key) return false;
		return Date.now() - (this.upstreamUpdatedAt.get(key) ?? 0) < thresholdMs;
	}

	/** Invalida la cache upstream per forzare una nuova verifica remota. */
	markUpstreamStale(projectPath?: string): void {
		if (projectPath) {
			const key = normalizeProjectPath(projectPath).toLowerCase();
			if (key) this.upstreamUpdatedAt.delete(key);
		} else {
			this.upstreamUpdatedAt.clear();
		}
	}

	/** Marca obsoleti gli upstream di tutti i progetti tranne quello indicato. */
	markOtherUpstreamsStale(exceptProjectPath: string): void {
		const keepKey = normalizeProjectPath(exceptProjectPath).toLowerCase();
		for (const key of this.upstreamUpdatedAt.keys()) {
			if (key !== keepKey) {
				this.upstreamUpdatedAt.delete(key);
			}
		}
	}

	async loadUpstreamStatus(projectPath: string, force = false): Promise<GitUpstreamStatus | null> {
		const key = normalizeProjectPath(projectPath).toLowerCase();
		if (!key) return null;

		const cachedAt = this.upstreamUpdatedAt.get(key) ?? 0;
		if (!force && Date.now() - cachedAt < this.UPSTREAM_CACHE_TTL_MS) {
			return this.upstreamByPath[key] ?? null;
		}

		const current = this.upstreamPending.get(key);
		if (current) return current;

		const request = (async () => {
			try {
				const status = await invoke<GitUpstreamStatus>('git_upstream_status', { projectPath });
				this.upstreamByPath[key] = status;
				this.upstreamUpdatedAt.set(key, Date.now());
				return status;
			} catch (e) {
				console.error('git_upstream_status', e);
				return null;
			} finally {
				this.upstreamPending.delete(key);
			}
		})();

		this.upstreamPending.set(key, request);
		return request;
	}

	async syncRepo(projectPath: string, action: 'pull' | 'push' | 'sync' | 'fetch'): Promise<string> {
		const key = normalizeProjectPath(projectPath).toLowerCase();
		this.isSyncingByPath[key] = true;
		try {
			const result = await invoke<string>('git_sync_repo', { projectPath, action });
			await this.loadUpstreamStatus(projectPath, true);
			return result;
		} catch (e) {
			console.error('git_sync_repo', e);
			throw e;
		} finally {
			this.isSyncingByPath[key] = false;
		}
	}

	async loadActionsStatus(projectPath: string, branch?: string): Promise<GithubActionRun[]> {
		const key = normalizeProjectPath(projectPath).toLowerCase();
		this.isLoadingActionsByPath[key] = true;
		try {
			const runs = await invoke<GithubActionRun[]>('github_get_actions_status', {
				projectPath,
				branch: branch || null
			});
			this.actionsByPath[key] = runs;
			return runs;
		} catch (e) {
			console.error('github_get_actions_status', e);
			return [];
		} finally {
			this.isLoadingActionsByPath[key] = false;
		}
	}
}

export const githubStore = new GithubStore();
