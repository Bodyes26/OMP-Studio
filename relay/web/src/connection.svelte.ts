/**
 * Gestore reattivo della connessione WebSocket e dello stato del relay (Svelte 5 runes).
 */

import {
	API,
	PROTOCOL,
	CloseCode,
	HEARTBEAT_TIMEOUT_MS,
	COMMAND_TIMEOUT_MS,
	type ClientFrame,
	type RelayToClientFrame,
	type DeviceInfo,
	type DeviceListItem,
	type HostSummary,
	type HostState,
	type RemoteCommand,
	type CommandError,
	type CreateCodeResponse,
	type PairingKind,
	type RelayInfo,
	type RemoteChatEvent
} from '../../src/protocol.ts';
import { calculateBackoffDelay, OFFLINE_BANNER_THRESHOLD } from './backoff.ts';

export type AppConnectionStatus = 'checking' | 'unpaired' | 'connecting' | 'connected' | 'disconnected';

export interface PendingCommandState {
	commandId: string;
	hostId: string;
	command: RemoteCommand;
	startedAt: number;
	resolve: (data: unknown) => void;
	reject: (err: CommandError) => void;
}

class RemoteConnectionManager {
	status = $state<AppConnectionStatus>('checking');
	device = $state<DeviceInfo | null>(null);
	relayInfo = $state<RelayInfo | null>(null);
	hosts = $state<HostSummary[]>([]);
	hostStates = $state<Record<string, { seq: number; receivedAt: number; state: HostState }>>({});
	failedAttempts = $state<number>(0);
	lastError = $state<string | null>(null);
	pendingCommands = $state<Record<string, { hostId: string; command: RemoteCommand }>>({});

	get isOffline(): boolean {
		return this.failedAttempts >= OFFLINE_BANNER_THRESHOLD && this.status !== 'connected';
	}
	private ws: WebSocket | null = null;
	private watchdogTimer: number | null = null;
	private backoffTimer: number | null = null;
	private pendingMap = new Map<string, PendingCommandState>();
	private chatListeners = new Map<string, Set<(event: RemoteChatEvent) => void>>();
	private activeChatSubscriptions = new Set<string>();
	init(): void {
		if (typeof window === 'undefined') return;

		this.checkSession();

		document.addEventListener('visibilitychange', () => {
			const isVisible = document.visibilityState === 'visible';
			this.sendVisibility(isVisible);
			if (isVisible && this.status !== 'connected' && this.status !== 'unpaired') {
				this.reconnectImmediate();
			}
		});

		window.addEventListener('online', () => {
			if (this.status !== 'connected' && this.status !== 'unpaired') {
				this.reconnectImmediate();
			}
		});
	}

	async checkSession(): Promise<void> {
		this.status = 'checking';
		try {
			const res = await fetch(API.session);
			if (res.ok) {
				const data = (await res.json()) as { device: DeviceInfo };
				this.device = data.device;
				this.connectSocket();
			} else if (res.status === 401) {
				this.status = 'unpaired';
			} else {
				this.status = 'disconnected';
				this.scheduleReconnect();
			}
		} catch {
			this.status = 'disconnected';
			this.scheduleReconnect();
		}
	}

	async pairDevice(name: string, code?: string, adminToken?: string): Promise<{ ok: boolean; error?: string; status?: number }> {
		try {
			const res = await fetch(API.pairDevice, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, code, adminToken })
			});

			if (res.ok) {
				const data = (await res.json()) as { device: DeviceInfo };
				this.device = data.device;
				this.failedAttempts = 0;
				this.connectSocket();
				return { ok: true };
			}

			const errJson = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
			return {
				ok: false,
				status: res.status,
				error: errJson?.error?.message || `Errore HTTP ${res.status}`
			};
		} catch (e) {
			return { ok: false, error: (e as Error).message };
		}
	}

	async logout(): Promise<void> {
		try {
			await fetch(API.logout, { method: 'POST' });
		} catch {
			// ignora errori di rete su logout
		}
		this.device = null;
		this.status = 'unpaired';
		this.hosts = [];
		this.hostStates = {};
		this.closeSocket();
	}

	private connectSocket(): void {
		if (this.ws) {
			this.closeSocket();
		}

		this.status = 'connecting';
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${proto}//${location.host}${API.clientSocket}`;

		try {
			const socket = new WebSocket(url);
			this.ws = socket;

			socket.onopen = () => {
				if (this.ws !== socket) return;
				const helloFrame: ClientFrame = {
					type: 'hello',
					protocol: PROTOCOL
				};
				socket.send(JSON.stringify(helloFrame));
				this.resetWatchdog();
			};

			socket.onmessage = (event) => {
				if (this.ws !== socket) return;
				this.resetWatchdog();
				try {
					const frame = JSON.parse(event.data as string) as RelayToClientFrame;
					this.handleFrame(frame);
				} catch (err) {
					console.warn('Frame non interpretabile:', err);
				}
			};

			socket.onclose = (event) => {
				if (this.ws !== socket) return;
				this.ws = null;
				this.clearWatchdog();

				if (event.code === CloseCode.unauthorized || event.code === CloseCode.revoked) {
					this.device = null;
					this.status = 'unpaired';
					return;
				}

				if (event.code === CloseCode.incompatible) {
					const reloaded = sessionStorage.getItem('omp_version_reloaded');
					if (!reloaded) {
						sessionStorage.setItem('omp_version_reloaded', '1');
						location.reload();
						return;
					}
					this.lastError = 'Versione protocollo non compatibile. Ricarica la pagina.';
					this.status = 'disconnected';
					return;
				}

				this.failedAttempts++;
				this.status = 'disconnected';
				this.scheduleReconnect();
			};

			socket.onerror = () => {
				// Il fallimento scatenera' onclose
			};
		} catch {
			this.failedAttempts++;
			this.status = 'disconnected';
			this.scheduleReconnect();
		}
	}

	private handleFrame(frame: RelayToClientFrame): void {
		switch (frame.type) {
			case 'welcome': {
				this.status = 'connected';
				this.failedAttempts = 0;
				this.device = frame.device;
				this.relayInfo = frame.relay;
				this.hosts = frame.hosts;
				sessionStorage.removeItem('omp_version_reloaded');
				this.sendVisibility(typeof document !== 'undefined' ? document.visibilityState === 'visible' : true);
				this.resubscribeChat();
				break;
			}
			case 'hosts': {
				this.hosts = frame.hosts;
				break;
			}
			case 'host_status': {
				const prevHost = this.hosts.find((h) => h.id === frame.host.id);
				const wasOffline = prevHost && !prevHost.online;
				const idx = this.hosts.findIndex((h) => h.id === frame.host.id);
				if (idx >= 0) {
					this.hosts[idx] = frame.host;
					this.hosts = [...this.hosts];
				} else {
					this.hosts = [...this.hosts, frame.host];
				}
				if (wasOffline && frame.host.online) {
					this.notifyChatResetForHost(frame.host.id);
				}
				break;
			}
			case 'host_snapshot': {
				this.hostStates[frame.hostId] = {
					seq: frame.seq,
					receivedAt: frame.receivedAt,
					state: frame.state
				};
				break;
			}
			case 'command_result': {
				const pending = this.pendingMap.get(frame.commandId);
				if (pending) {
					this.pendingMap.delete(frame.commandId);
					delete this.pendingCommands[frame.commandId];
					if (frame.ok) {
						pending.resolve(frame.data);
					} else {
						pending.reject(frame.error || { code: 'failed', message: 'Comando fallito' });
					}
				}
				break;
			}
			case 'ping': {
				if (this.ws && this.ws.readyState === WebSocket.OPEN) {
					const pongFrame: ClientFrame = { type: 'pong', seq: frame.seq };
					this.ws.send(JSON.stringify(pongFrame));
				}
				break;
			}
			case 'chat_event': {
				const key = `${frame.hostId}\0${frame.projectId}\0${frame.laneId}`;
				const listeners = this.chatListeners.get(key);
				if (listeners) {
					for (const listener of listeners) {
						try {
							listener(frame.event);
						} catch {
							// ignora errori nei listener
						}
					}
				}
				break;
			}
		}
	}

	private resetWatchdog(): void {
		this.clearWatchdog();
		this.watchdogTimer = window.setTimeout(() => {
			if (this.ws) {
				this.ws.close();
			}
		}, HEARTBEAT_TIMEOUT_MS) as unknown as number;
	}

	private clearWatchdog(): void {
		if (this.watchdogTimer) {
			clearTimeout(this.watchdogTimer);
			this.watchdogTimer = null;
		}
	}

	private scheduleReconnect(): void {
		if (this.backoffTimer) return;
		const delay = calculateBackoffDelay(this.failedAttempts);
		this.backoffTimer = window.setTimeout(() => {
			this.backoffTimer = null;
			this.connectSocket();
		}, delay) as unknown as number;
	}

	reconnectImmediate(): void {
		if (this.backoffTimer) {
			clearTimeout(this.backoffTimer);
			this.backoffTimer = null;
		}
		this.connectSocket();
	}

	private closeSocket(): void {
		this.clearWatchdog();
		if (this.backoffTimer) {
			clearTimeout(this.backoffTimer);
			this.backoffTimer = null;
		}
		if (this.ws) {
			const s = this.ws;
			this.ws = null;
			s.close();
		}
	}

	/**
	 * Esito del comando: si risolve con `data` (vedi `RemoteCommandData`), che i
	 * comandi senza dati lasciano `undefined`.
	 */
	async sendCommand(hostId: string, command: RemoteCommand): Promise<unknown> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw { code: 'host_offline', message: 'Relay non connesso' } as CommandError;
		}

		const commandId = crypto.randomUUID();

		return new Promise<unknown>((resolve, reject) => {
			const timeoutTimer = setTimeout(() => {
				this.pendingMap.delete(commandId);
				delete this.pendingCommands[commandId];
				reject({ code: 'timeout', message: 'Nessuna risposta entro 30s' } as CommandError);
			}, COMMAND_TIMEOUT_MS);

			this.pendingMap.set(commandId, {
				commandId,
				hostId,
				command,
				startedAt: Date.now(),
				resolve: (data) => {
					clearTimeout(timeoutTimer);
					resolve(data);
				},
				reject: (err) => {
					clearTimeout(timeoutTimer);
					reject(err);
				}
			});

			this.pendingCommands[commandId] = { hostId, command };

			const frame: ClientFrame = {
				type: 'command',
				commandId,
				hostId,
				command
			};

			this.ws?.send(JSON.stringify(frame));
		});
	}

	async fetchDevices(): Promise<DeviceListItem[]> {
		const res = await fetch(API.devices);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as { devices: DeviceListItem[] };
		return data.devices;
	}

	async revokeDevice(deviceId: string): Promise<void> {
		const res = await fetch(`${API.devices}/${deviceId}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
	}

	async revokeHost(hostId: string): Promise<void> {
		const res = await fetch(`${API.hosts}/${hostId}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
	}

	async createPairingCode(kind: PairingKind): Promise<CreateCodeResponse> {
		const res = await fetch(API.codes, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ kind })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()) as CreateCodeResponse;
	}

	sendVisibility(visible: boolean): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			const frame: ClientFrame = { type: 'visibility', visible };
			try {
				this.ws.send(JSON.stringify(frame));
			} catch {}
		}
	}

	async fetchVapidPublicKey(): Promise<string> {
		const res = await fetch(API.pushVapidPublicKey);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as { publicKey: string };
		return data.publicKey;
	}

	async savePushSubscription(subscription: PushSubscription, userAgent?: string): Promise<string> {
		const rawKey = subscription.getKey('p256dh');
		const rawAuth = subscription.getKey('auth');
		if (!rawKey || !rawAuth) {
			throw new Error('Sottoscrizione priva di chiavi crittografiche');
		}

		const p256dh = btoa(String.fromCharCode(...new Uint8Array(rawKey)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
		const auth = btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');

		const res = await fetch(API.pushSubscriptions, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				subscription: {
					endpoint: subscription.endpoint,
					keys: { p256dh, auth }
				},
				userAgent
			})
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as { ok: boolean; subscriptionId: string };
		return data.subscriptionId;
	}

	async deletePushSubscription(endpoint?: string): Promise<void> {
		const res = await fetch(API.pushSubscriptions, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ endpoint })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
	}

	subscribeChat(
		hostId: string,
		projectId: string,
		laneId: string,
		listener: (event: RemoteChatEvent) => void
	): () => void {
		const key = `${hostId}\0${projectId}\0${laneId}`;
		let set = this.chatListeners.get(key);
		if (!set) {
			set = new Set();
			this.chatListeners.set(key, set);
		}
		set.add(listener);

		if (!this.activeChatSubscriptions.has(key)) {
			this.activeChatSubscriptions.add(key);
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				const frame: ClientFrame = {
					type: 'chat_subscribe',
					hostId,
					projectId,
					laneId
				};
				this.ws.send(JSON.stringify(frame));
			}
		}

		return () => {
			const listeners = this.chatListeners.get(key);
			if (listeners) {
				listeners.delete(listener);
				if (listeners.size === 0) {
					this.chatListeners.delete(key);
					this.activeChatSubscriptions.delete(key);
					if (this.ws && this.ws.readyState === WebSocket.OPEN) {
						const frame: ClientFrame = {
							type: 'chat_unsubscribe',
							hostId,
							projectId,
							laneId
						};
						this.ws.send(JSON.stringify(frame));
					}
				}
			}
		};
	}

	private resubscribeChat(): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		for (const key of this.activeChatSubscriptions) {
			const parts = key.split('\0');
			if (parts.length === 3) {
				const frame: ClientFrame = {
					type: 'chat_subscribe',
					hostId: parts[0],
					projectId: parts[1],
					laneId: parts[2]
				};
				this.ws.send(JSON.stringify(frame));

				// Dopo una riconnessione la chat aperta deve rileggere lo storico (#10)
				const listeners = this.chatListeners.get(key);
				if (listeners) {
					for (const listener of listeners) {
						try {
							listener({ kind: 'reset' });
						} catch {
							// ignora errori nei listener
						}
					}
				}
			}
		}
	}

	private notifyChatResetForHost(hostId: string): void {
		const prefix = `${hostId}\0`;
		for (const [key, listeners] of this.chatListeners.entries()) {
			if (key.startsWith(prefix)) {
				for (const listener of listeners) {
					try {
						listener({ kind: 'reset' });
					} catch {
						// ignora errori nei listener
					}
				}
			}
		}
	}
}

export const connection = new RemoteConnectionManager();
