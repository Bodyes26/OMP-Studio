import { invoke, LOCAL_MACHINE, type MachineId } from '#lib/backend/ipc.ts';
import { projectStore, normalizeProjectPath, joinProjectPath } from './projects.svelte';
import { settingsStore } from './settings.svelte';
import { notificationManager } from './notifications.svelte';
import { m } from '#lib/paraglide/messages.js';
import { ActionsPollGate } from './actionsPollGate';
import { machineFeedback } from './machineFeedback.svelte';

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
	/** `owner/repo` in minuscolo: lo stesso valore su ogni copia (R-MI-12). */
	repoSlug?: string | null;
	/** Primo commit: identifica le copie senza origin condiviso. */
	rootCommit?: string | null;
	/** Commit corrente: due copie sullo stesso branch con HEAD diversi divergono (R-MI-22). */
	headCommit?: string | null;
	/** File con modifiche non committate; assente dagli host precedenti. */
	changedFiles?: number;
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
	remoteErrorByPath = $state<Record<string, string | null>>({});

	actionsByPath = $state<Record<string, GithubActionRun[]>>({});
	/** Ultime esecuzioni lette per progetto+branch, chiave come `ActionsPollGate`. */
	private actionsByBranch = new Map<string, GithubActionRun[]>();
	isLoadingActionsByPath = $state<Record<string, boolean>>({});

	private upstreamUpdatedAt = new Map<string, number>();
	/**
	 * Macchina che ha prodotto lo stato in `upstreamByPath` per ogni percorso.
	 * La mappa resta indicizzata per percorso (la leggono pannelli e badge), ma
	 * l'identità va letta solo dalla copia che possiede davvero quel percorso:
	 * senza questo due macchine con `C:\dev\omp` si scambiavano il repository
	 * (R-MI-45).
	 */
	private upstreamOwner = new Map<string, MachineId>();
	private upstreamPending = new Map<string, Promise<GitUpstreamStatus | null>>();
	private UPSTREAM_CACHE_TTL_MS = 5_000;
	private remoteCheckedAt = new Map<string, number>();
	private remotePending = new Map<string, Promise<void>>();
	private notifiedIncoming = new Map<string, string>();
	private REMOTE_CHECK_INTERVAL_MS = 5 * 60_000;

	private actionsGate = new ActionsPollGate();

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

	/**
	 * Collega Studio alla GitHub CLI: annulla un precedente «Disconnetti solo
	 * Studio», dopo il quale il backend ignora gh, e rilegge lo stato.
	 */
	async useGhCli(): Promise<GithubAuthStatus> {
		this.isLoadingStatus = true;
		try {
			const res = await invoke<GithubAuthStatus>('github_use_gh_cli');
			this.status = res;
			if (res.authenticated) {
				void this.loadRemoteRepos(true);
			}
			return res;
		} catch (e) {
			console.error('github_use_gh_cli', e);
			return await this.loadStatus();
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

	/**
	 * Scollega Studio da GitHub. `alsoGhCli` esegue anche `gh auth logout`:
	 * l'account di gh e' condiviso con terminale e altri strumenti, quindi lo si
	 * tocca solo su richiesta esplicita.
	 */
	async logout(opts: { alsoGhCli?: boolean } = {}): Promise<void> {
		try {
			await invoke('github_logout', { alsoGhCli: opts.alsoGhCli ?? false });
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

	/**
	 * Stato upstream del percorso solo se l'ultima lettura l'ha fatta la
	 * macchina indicata: la mappa è per percorso, quindi due macchine con
	 * `C:\dev\omp` condividerebbero la chiave. `null` = non ancora letto da
	 * quella macchina, e chi fonde le tessere usa l'identità nota (R-MI-45).
	 */
	upstreamFor(machine: MachineId | null | undefined, projectPath: string | null | undefined): GitUpstreamStatus | null {
		const key = normalizeProjectPath(projectPath ?? '').toLowerCase();
		if (!key) return null;
		if ((this.upstreamOwner.get(key) ?? LOCAL_MACHINE) !== (machine || LOCAL_MACHINE)) return null;
		return this.upstreamByPath[key] ?? null;
	}

	async loadUpstreamStatus(projectPath: string, force = false, machine?: MachineId): Promise<GitUpstreamStatus | null> {
		const key = normalizeProjectPath(projectPath).toLowerCase();
		if (!key) return null;
		// La macchina che possiede il percorso decide l'identità: se il
		// chiamante la conosce (una tessera remota) va usata, perché
		// `machineOfPath` preferisce la copia locale a parità di percorso.
		const owner = machine ?? projectStore.machineOfPath(projectPath);

		const cachedAt = this.upstreamUpdatedAt.get(key) ?? 0;
		if (!force && Date.now() - cachedAt < this.UPSTREAM_CACHE_TTL_MS && this.upstreamOwner.get(key) === owner) {
			return this.upstreamByPath[key] ?? null;
		}

		// La richiesta in corso è per macchina+percorso: la stessa cartella su
		// due macchine sono due letture diverse (R-MI-45).
		const pendingKey = `${owner}\u0000${key}`;
		const current = this.upstreamPending.get(pendingKey);
		if (current) return current;

		const request = (async () => {
			try {
				const status = await invoke<GitUpstreamStatus>('git_upstream_status', { projectPath }, { machine: owner });
				// La macchina prima del valore: chi legge la mappa deve trovare
				// già coerenti stato e proprietario.
				this.upstreamOwner.set(key, owner);
				this.upstreamByPath[key] = status;
				this.upstreamUpdatedAt.set(key, Date.now());
				// Lo stato git è la conferma dell'identità: vale subito e, per le
				// copie locali, resta nel record per il prossimo avvio (R-MI-45).
				projectStore.rememberGitIdentity(owner, projectPath, status);
				return status;
			} catch (e) {
				console.error('git_upstream_status', e);
				return null;
			} finally {
				this.upstreamPending.delete(pendingKey);
			}
		})();

		this.upstreamPending.set(pendingKey, request);
		return request;
	}

	/** Il controllo remoto non tocca il checkout e non apre prompt di credenziali. */
	async checkRemote(projectPath: string, force = false): Promise<void> {
		await settingsStore.init();
		const key = normalizeProjectPath(projectPath).toLowerCase();
		if (!key || !settingsStore.backgroundJobs.enabled || !settingsStore.backgroundJobs.jobs.gitFetch.enabled) return;
		const pending = this.remotePending.get(key);
		if (pending) return pending;
		if (
			!force && (
				this.isSyncingByPath[key] ||
				Date.now() - (this.remoteCheckedAt.get(key) ?? 0) < this.REMOTE_CHECK_INTERVAL_MS
			)
		) return;

		this.remoteCheckedAt.set(key, Date.now());
		const owner = projectStore.machineOfPath(projectPath);
		const request = (async () => {
			try {
				const before = await this.loadUpstreamStatus(projectPath, false, owner);
				if (!before) throw new Error(m.git_remote_status_error());
				if (!before.isGit || !settingsStore.backgroundJobs.enabled || !settingsStore.backgroundJobs.jobs.gitFetch.enabled) return;
				await this.syncRepo(projectPath, 'fetch-background');
				const status = this.upstreamByPath[key];
				if (!status?.behind) {
					this.notifiedIncoming.delete(key);
					return;
				}
				// Il tip remoto distingue nuovi commit da un pull parziale che riduce il conteggio.
				const signature = JSON.stringify([
					status.branch, status.upstream,
					status.incomingCommits[0]?.hash ?? status.behind
				]);
				if (this.notifiedIncoming.get(key) === signature) return;
				const project = projectStore.projects.find((candidate) =>
					candidate.canonicalProjectPath &&
					normalizeProjectPath(candidate.canonicalProjectPath).toLowerCase() === key
				);
				if (!project || !settingsStore.backgroundJobs.enabled || !settingsStore.backgroundJobs.jobs.gitFetch.enabled) return;
				this.notifiedIncoming.set(key, signature);
				await notificationManager.notifyGitUpdates(project, status.behind);
			} catch (error) {
				this.remoteErrorByPath[key] = String(error);
			} finally {
				this.remotePending.delete(key);
			}
		})();
		this.remotePending.set(key, request);
		return request;
	}

	async syncRepo(projectPath: string, action: 'pull' | 'push' | 'sync' | 'fetch' | 'fetch-background' | 'pull-ff'): Promise<string> {
		const key = normalizeProjectPath(projectPath).toLowerCase();
		if (this.isSyncingByPath[key]) throw new Error(m.git_remote_operation_busy());
		this.isSyncingByPath[key] = true;
		const owner = projectStore.machineOfPath(projectPath);
		// Su un'altra macchina l'esito di git è la sua risposta, non il nostro
		// stato: finché non torna, l'operazione è in attesa (IMP-006).
		const remote = owner !== LOCAL_MACHINE;
		const feedback = remote ? machineFeedback.begin({ kind: 'git', machineId: owner }) : null;
		try {
			const result = await invoke<string>('git_sync_repo', { projectPath, action }, { machine: owner });
			if (feedback !== null) machineFeedback.confirm(feedback);
			// Un polling locale partito prima del fetch non deve ripubblicare lo stato vecchio.
			await this.upstreamPending.get(`${owner}\u0000${key}`);
			const status = await this.loadUpstreamStatus(projectPath, true, owner);
			if (!status) throw new Error(m.git_remote_status_error());
			this.remoteErrorByPath[key] = null;
			return result;
		} catch (e) {
			console.error('git_sync_repo', e);
			if (feedback !== null) machineFeedback.fail(feedback, e instanceof Error ? e.message : String(e));
			throw e;
		} finally {
			this.isSyncingByPath[key] = false;
		}
	}

	/**
	 * Legge le ultime esecuzioni di GitHub Actions. Senza `force` rispetta la
	 * cadenza di `ActionsPollGate` e restituisce i dati gia' in memoria.
	 */
	async loadActionsStatus(
		projectPath: string,
		branch?: string,
		opts: { force?: boolean } = {}
	): Promise<GithubActionRun[]> {
		const key = normalizeProjectPath(projectPath).toLowerCase();
		const gateKey = `${key}\n${branch ?? ''}`;
		if (!this.actionsGate.tryAcquire(gateKey, Date.now(), opts.force ?? false)) {
			// Cadenza rispettata, ma con i dati del branch richiesto: tornando su
			// un branch letto da poco il pannello non deve mostrare la CI dell'altro.
			const cached = this.actionsByBranch.get(gateKey);
			if (cached) this.actionsByPath[key] = cached;
			return cached ?? this.actionsByPath[key] ?? [];
		}
		this.isLoadingActionsByPath[key] = true;
		try {
			const runs = await invoke<GithubActionRun[]>('github_get_actions_status', {
				projectPath,
				branch: branch || null
			});
			this.actionsByBranch.set(gateKey, runs);
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
