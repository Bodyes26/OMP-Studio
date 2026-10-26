import { remoteBridge, type RemoteStatus } from '#lib/remote/bridge.ts';
import { normalizePairingCode } from '$remote-protocol';
import type { UnlistenFn } from '@tauri-apps/api/event';

const DEFAULT_REMOTE_STATUS: RemoteStatus = {
	enabled: false,
	relayUrl: null,
	machineName: '',
	hostId: '',
	paired: false,
	connection: 'disabled',
	lastError: null,
	retryAt: null,
	clients: [],
	relayVersion: null,
	relayProtocol: null,
	updateNeeded: null,
	relayFeatures: []
};

/**
 * Stato reattivo del controllo remoto per la WebView di Studio (Gate R44).
 * Si collega a Rust tramite `remoteBridge`, incapsula comandi di abbinamento
 * ed e' tollerante all'assenza del comando backend durante la transizione.
 */
export class RemoteStore {
	status = $state<RemoteStatus>(DEFAULT_REMOTE_STATUS);
	loading = $state(false);
	actionError = $state<string | null>(null);

	hasRelayFeature(name: string): boolean {
		return this.status.relayFeatures?.includes(name) ?? false;
	}

	private unlisten: UnlistenFn | null = null;
	private initGeneration = 0;
	private initialized = false;
	private bridge: typeof remoteBridge;

	constructor(bridge: typeof remoteBridge = remoteBridge) {
		this.bridge = bridge;
	}
	async init(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		const generation = ++this.initGeneration;

		try {
			const initial = await this.bridge.status();
			if (generation !== this.initGeneration) return;
			if (initial) {
				this.status = initial;
			}
		} catch (err) {
			if (generation !== this.initGeneration) return;
			// Se il backend Rust e' in fase di implementazione o il comando non risponde,
			// mantieni disabled e registra l'avviso.
			console.warn('[remote] remote_get_status non disponibile:', err);
		}

		try {
			const unlisten = await this.bridge.onStatus((status) => {
				if (generation !== this.initGeneration) return;
				if (status) {
					this.status = status;
				}
			});

			// Se nel frattempo e' avvenuto destroy() o una nuova generazione, disiscrivi subito
			if (generation !== this.initGeneration) {
				unlisten();
				return;
			}

			// Disiscrive eventuale handle precedente per evitare di sovrascriverlo perdendo il riferimento
			if (this.unlisten) {
				this.unlisten();
			}
			this.unlisten = unlisten;
		} catch (err) {
			if (generation !== this.initGeneration) return;
			console.warn('[remote] ascoltatore remote://status non registrato:', err);
		}
	}

	async setEnabled(enabled: boolean): Promise<boolean> {
		this.loading = true;
		this.actionError = null;
		try {
			const updated = await this.bridge.setEnabled(enabled);
			if (updated) this.status = updated;
			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[remote] setEnabled fallito:', err);
			this.actionError = msg;
			return false;
		} finally {
			this.loading = false;
		}
	}

	async setMachineName(machineName: string): Promise<boolean> {
		this.loading = true;
		this.actionError = null;
		try {
			const updated = await this.bridge.setMachineName(machineName);
			if (updated) this.status = updated;
			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[remote] setMachineName fallito:', err);
			this.actionError = msg;
			return false;
		} finally {
			this.loading = false;
		}
	}

	async pair(relayUrl: string, code: string, machineName: string): Promise<boolean> {
		this.loading = true;
		this.actionError = null;
		const cleanCode = normalizePairingCode(code);
		if (!cleanCode) {
			this.actionError = 'Codice di abbinamento non valido';
			this.loading = false;
			return false;
		}
		try {
			const updated = await this.bridge.pair(relayUrl.trim(), cleanCode, machineName.trim());
			if (updated) this.status = updated;
			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[remote] pair fallito:', err);
			this.actionError = msg;
			return false;
		} finally {
			this.loading = false;
		}
	}

	async unpair(): Promise<boolean> {
		this.loading = true;
		this.actionError = null;
		try {
			const updated = await this.bridge.unpair();
			if (updated) this.status = updated;
			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[remote] unpair fallito:', err);
			this.actionError = msg;
			return false;
		} finally {
			this.loading = false;
		}
	}

	async openMachinesWindow(): Promise<boolean> {
		this.actionError = null;
		try {
			await this.bridge.openMachinesWindow();
			return true;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.actionError = message;
			return false;
		}
	}

	destroy(): void {
		// Invalida qualsiasi init() in volo per impedire l'installazione di ascoltatori orfani
		this.initGeneration++;
		if (this.unlisten) {
			this.unlisten();
			this.unlisten = null;
		}
		this.initialized = false;
	}
}

export const remoteStore = new RemoteStore();
