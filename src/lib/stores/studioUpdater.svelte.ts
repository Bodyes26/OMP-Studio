import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { load, type Store } from '@tauri-apps/plugin-store';
import { openUrl } from '@tauri-apps/plugin-opener';

export interface StudioReleaseAsset {
	name: string;
	size: number;
	download_url: string;
	content_type?: string;
	sha256?: string | null;
}

export type StudioUpdateChannel = 'stable' | 'nightly';

export interface StudioUpdateInfo {
	current_version: string;
	latest_version: string;
	tag_name: string;
	release_name: string;
	release_notes: string;
	published_at?: string;
	html_url: string;
	has_update: boolean;
	asset?: StudioReleaseAsset | null;
	release_channel: StudioUpdateChannel;
	ahead_of_channel: boolean;
}

export interface StudioDownloadProgress {
	status: 'downloading' | 'finished' | 'error' | 'cancelled';
	downloaded_bytes: number;
	total_bytes: number;
	percentage: number;
	speed_bytes_per_sec: number;
	error?: string | null;
}

export function formatBytes(bytes: number, decimals = 1): string {
	if (!bytes || bytes === 0) return '0 B';
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
	if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
	return `${formatBytes(bytesPerSec, 1)}/s`;
}

function extractErrorMessage(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
		return error.message;
	}
	return 'Errore imprevisto';
}

class StudioUpdaterStore {
	channel = $state<StudioUpdateChannel>('stable');
	currentVersion = $state<string | null>(null);
	isChecking = $state<boolean>(false);
	isDownloading = $state<boolean>(false);
	isInstalling = $state<boolean>(false);
	showModal = $state<boolean>(false);
	updateInfo = $state<StudioUpdateInfo | null>(null);
	hasUpdate = $state<boolean>(false);
	updateBadge = $state<string | null>(null);
	badgeType = $state<'info' | 'success' | 'warn' | 'error'>('info');
	downloadProgress = $state<StudioDownloadProgress | null>(null);
	errorMessage = $state<string | null>(null);

	private unlistenProgress: UnlistenFn | null = null;
	private initialized = false;
	private badgeTimeout: number | null = null;
	private settingsStore: Store | null = null;

	async init() {
		if (this.initialized) return;
		this.initialized = true;

		try {
			this.settingsStore = await load('settings.json', { autoSave: false });
			const storedChannel = await this.settingsStore.get<unknown>('studioUpdateChannel');
			if (storedChannel === 'stable' || storedChannel === 'nightly') {
				this.channel = storedChannel;
			}
		} catch (e) {
			this.settingsStore = null;
			console.error('Impossibile caricare il canale aggiornamenti', e);
		}

		try {
			const ver = await invoke<string>('get_studio_version');
			this.currentVersion = ver;
		} catch (e) {
			console.error('Impossibile ottenere la versione di Studio', e);
		}

		try {
			this.unlistenProgress = await listen<StudioDownloadProgress>('studio_update_progress', (event) => {
				const data = event.payload;
				this.downloadProgress = data;

				if (data.status === 'downloading') {
					this.isDownloading = true;
				} else if (data.status === 'finished') {
					this.isDownloading = false;
					this.errorMessage = null;
					this.setBadge('Scaricato', 'success', 6000);
				} else if (data.status === 'error') {
					this.isDownloading = false;
					this.errorMessage = data.error || 'Errore sconosciuto durante il download';
					this.setBadge('Errore download', 'error', 5000);
				} else if (data.status === 'cancelled') {
					this.isDownloading = false;
					this.downloadProgress = null;
					this.setBadge(null);
				}
			});
		} catch (e) {
			console.error('Impossibile registrare listener per download aggiornamenti', e);
		}

		// Controllo silenzioso iniziale in background
		this.checkUpdate(false);
	}

	setBadge(text: string | null, type: 'info' | 'success' | 'warn' | 'error' = 'info', autoClearMs = 0) {
		clearTimeout(this.badgeTimeout ?? undefined);
		this.badgeTimeout = null;
		this.updateBadge = text;
		this.badgeType = type;
		if (text && autoClearMs > 0) {
			this.badgeTimeout = window.setTimeout(() => {
				if (!this.hasUpdate) {
					this.updateBadge = null;
				} else {
					this.updateBadge = `v${this.updateInfo?.latest_version || ''}`;
					this.badgeType = 'warn';
				}
			}, autoClearMs);
		}
	}


	get channelChangeDisabled(): boolean {
		return this.isChecking
			|| this.isDownloading
			|| this.isInstalling
			|| this.downloadProgress?.status === 'finished';
	}

	async setChannel(channel: StudioUpdateChannel) {
		if (channel === this.channel || this.channelChangeDisabled) return;

		this.channel = channel;
		this.updateInfo = null;
		this.hasUpdate = false;
		this.errorMessage = null;
		this.setBadge(null);

		try {
			await this.settingsStore?.set('studioUpdateChannel', channel);
			await this.settingsStore?.save();
		} catch (e) {
			console.error('Impossibile salvare il canale aggiornamenti', e);
		}

		await this.checkUpdate(true);
	}
	async checkUpdate(manual = true) {
		if (this.isChecking || this.isDownloading) return;
		this.isChecking = true;
		this.errorMessage = null;

		if (manual) {
			this.setBadge('Verifica...', 'info');
		}

		try {
			const info = await invoke<StudioUpdateInfo>('check_studio_update', { channel: this.channel });
			this.updateInfo = info;
			this.currentVersion = info.current_version;
			this.hasUpdate = info.has_update;

			if (info.has_update) {
				this.setBadge(`v${info.latest_version}`, 'warn');
				if (manual) {
					this.showModal = true;
				}
			} else {
				if (manual) {
					this.setBadge('Aggiornato', 'success', 3500);
					this.showModal = true;
				} else {
					this.updateBadge = null;
				}
			}
		} catch (e: unknown) {
			console.error('Verifica aggiornamenti Studio fallita', e);
			const errStr = extractErrorMessage(e);
			this.errorMessage = errStr;
			if (manual) {
				this.setBadge('Errore', 'error', 4000);
				this.showModal = true;
			}
		} finally {
			this.isChecking = false;
		}
	}

	async startDownload() {
		if (!this.updateInfo?.asset?.download_url) {
			this.errorMessage = 'Nessun installer scaricabile trovato negli asset di questa release.';
			return;
		}

		if (!this.updateInfo.asset.sha256) {
			this.errorMessage = 'Checksum SHA256 non disponibile per questa release: installazione non sicura rifiutata.';
			this.setBadge('Non verificato', 'error', 4000);
			return;
		}

		this.isDownloading = true;
		this.errorMessage = null;
		this.downloadProgress = {
			status: 'downloading',
			downloaded_bytes: 0,
			total_bytes: this.updateInfo.asset.size || 0,
			percentage: 0,
			speed_bytes_per_sec: 0,
			error: null
		};

		try {
			await invoke('start_studio_update_download', {
				downloadUrl: this.updateInfo.asset.download_url,
				filename: this.updateInfo.asset.name,
				expectedSha256: this.updateInfo.asset.sha256
			});
		} catch (e: unknown) {
			this.isDownloading = false;
			const errStr = extractErrorMessage(e);
			this.errorMessage = errStr;
			this.downloadProgress = null;
			this.setBadge('Errore', 'error', 4000);
		}
	}

	async cancelDownload() {
		try {
			await invoke('cancel_studio_update_download');
		} catch (e) {
			console.error('Errore durante cancellazione download', e);
		}
		this.isDownloading = false;
		this.downloadProgress = null;
		this.setBadge(null);
	}
	async installAndRestart() {
		this.isInstalling = true;
		this.errorMessage = null;
		try {
			await invoke('install_studio_update_and_restart');
		} catch (e: unknown) {
			this.isInstalling = false;
			const errStr = extractErrorMessage(e);
			this.errorMessage = errStr;
		}
	}

	async openReleaseInBrowser() {
		if (this.updateInfo?.html_url) {
			try {
				await openUrl(this.updateInfo.html_url);
			} catch (e) {
				console.error('Impossibile aprire URL release', e);
			}
		}
	}

	openModal() {
		this.showModal = true;
	}

	closeModal() {
		this.showModal = false;
	}

	destroy() {
		if (this.unlistenProgress) {
			this.unlistenProgress();
			this.unlistenProgress = null;
		}
		clearTimeout(this.badgeTimeout ?? undefined);
	}
}

export const studioUpdaterStore = new StudioUpdaterStore();
