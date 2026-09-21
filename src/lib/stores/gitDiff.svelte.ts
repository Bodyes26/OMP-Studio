import { invoke } from '@tauri-apps/api/core';
import { pathKey } from '$lib/utils/paths';

export interface GitDiffStats {
	additions: number;
	deletions: number;
	files: number;
	isRepo: boolean;
}

export interface GitStatusRefreshDetail {
	projectPath?: string;
}

const CACHE_TTL_MS = 3_000;
const REFRESH_DEBOUNCE_MS = 180;
const EMPTY_STATS: GitDiffStats = Object.freeze({
	additions: 0,
	deletions: 0,
	files: 0,
	isRepo: false
});

class GitDiffStore {
	private statsByPath = $state<Record<string, GitDiffStats>>({});
	private updatedAt = new Map<string, number>();
	private pending = new Map<string, Promise<void>>();
	private queuedRefresh = new Set<string>();
	private refreshTimers = new Map<string, number>();

	forPath(projectPath: string): GitDiffStats {
		return this.statsByPath[pathKey(projectPath)] ?? EMPTY_STATS;
	}

	load(projectPath: string, force = false): Promise<void> {
		const key = pathKey(projectPath);
		if (!key) return Promise.resolve();

		const cachedAt = this.updatedAt.get(key) ?? 0;
		if (!force && Date.now() - cachedAt < CACHE_TTL_MS) return Promise.resolve();

		const current = this.pending.get(key);
		if (current) {
			if (force) this.queuedRefresh.add(key);
			return current;
		}

		const request = invoke<GitDiffStats>('git_diff_stats', { projectPath })
			.then((stats) => {
				this.statsByPath[key] = stats;
				this.updatedAt.set(key, Date.now());
			})
			.catch(() => {
				// Un repository temporaneamente occupato conserva l'ultimo valore
				// valido: azzerarlo farebbe lampeggiare il badge durante un commit.
				if (!this.updatedAt.has(key)) this.statsByPath[key] = EMPTY_STATS;
			})
			.finally(() => {
				this.pending.delete(key);
				if (this.queuedRefresh.delete(key)) void this.load(projectPath, true);
			});

		this.pending.set(key, request);
		return request;
	}

	loadMany(projectPaths: readonly string[], force = false): Promise<void[]> {
		return Promise.all(projectPaths.filter(Boolean).map((path) => this.load(path, force)));
	}

	requestRefresh(projectPath: string): void {
		const key = pathKey(projectPath);
		if (!key) return;
		clearTimeout(this.refreshTimers.get(key));
		this.refreshTimers.set(
			key,
			window.setTimeout(() => {
				this.refreshTimers.delete(key);
				void this.load(projectPath, true);
			}, REFRESH_DEBOUNCE_MS)
		);
	}
}

export const gitDiffStore = new GitDiffStore();

export function hasGitChanges(stats: GitDiffStats): boolean {
	return stats.additions > 0 || stats.deletions > 0;
}

export function notifyGitStatusRefresh(projectPath?: string): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(
		new CustomEvent<GitStatusRefreshDetail>('git-status-refresh', {
			detail: projectPath ? { projectPath } : undefined
		})
	);
}
