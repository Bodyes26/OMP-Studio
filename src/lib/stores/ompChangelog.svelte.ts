import { invoke } from '@tauri-apps/api/core';

export interface OmpChangelogStatus {
	hasUnseen: boolean;
	currentVersion: string;
	lastSeenVersion: string | null;
	changeCount: number;
	releaseCount: number;
	unseenMarkdown: string;
	fullMarkdown: string;
}

/**
 * Gestisce lo stato delle novita' e del changelog del binario omp.
 * Condivide il file marker ~/.omp/agent/last-changelog-version con la TUI di omp
 * cosi' la notifica non viene mostrata due volte su superfici diverse.
 */
class OmpChangelogStore {
	hasUnseenUpdate = $state(false);
	currentVersion = $state('');
	lastSeenVersion = $state<string | null>(null);
	changeCount = $state(0);
	releaseCount = $state(0);
	unseenMarkdown = $state('');
	fullMarkdown = $state('');
	isModalOpen = $state(false);
	showFull = $state(false);
	isLoading = $state(false);

	#inflight: Promise<void> | null = null;

	/** Verifica se ci sono release di omp con modifiche non ancora viste. */
	checkStatus(force = false): Promise<void> {
		if (this.#inflight && !force) return this.#inflight;

		this.#inflight = (async () => {
			this.isLoading = true;
			try {
				const status = await invoke<OmpChangelogStatus>('get_omp_changelog_status');
				this.hasUnseenUpdate = status.hasUnseen;
				this.currentVersion = status.currentVersion;
				this.lastSeenVersion = status.lastSeenVersion;
				this.changeCount = status.changeCount;
				this.releaseCount = status.releaseCount;
				this.unseenMarkdown = status.unseenMarkdown;
				this.fullMarkdown = status.fullMarkdown;
			} catch (e) {
				console.warn('Verifica changelog OMP fallita:', e);
			} finally {
				this.isLoading = false;
				this.#inflight = null;
			}
		})();

		return this.#inflight;
	}

	/**
	 * Apre il modale del changelog e contrassegna la versione come vista,
	 * cosi' il banner nell'empty chat scompare immediatamente.
	 */
	async openModal(full = false): Promise<void> {
		this.showFull = full;
		this.isModalOpen = true;

		// Se le entry non sono state ancora caricate, prova a rileggerle
		if (!this.fullMarkdown && !this.unseenMarkdown) {
			void this.checkStatus(true);
		}

		// Segna come visto sia sul marker di omp che nello store
		await this.markSeen();
	}

	closeModal(): void {
		this.isModalOpen = false;
	}

	/**
	 * Aggiorna il marker ~/.omp/agent/last-changelog-version alla versione corrente.
	 */
	async markSeen(): Promise<void> {
		this.hasUnseenUpdate = false;
		this.lastSeenVersion = this.currentVersion;

		try {
			await invoke('mark_omp_changelog_seen', { version: this.currentVersion });
		} catch (e) {
			console.warn('Aggiornamento marker last-changelog-version fallito:', e);
		}
	}
}

export const ompChangelogStore = new OmpChangelogStore();
