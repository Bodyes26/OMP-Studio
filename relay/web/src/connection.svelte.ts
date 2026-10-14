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
	type RelayInfo
} from '../../src/protocol.ts';
import { calculateBackoffDelay, OFFLINE_BANNER_THRESHOLD } from './backoff.ts';

export type AppConnectionStatus = 'checking' | 'unpaired' | 'connecting' | 'connected' | 'disconnected';

export interface PendingCommandState {
	commandId: string;
	hostId: string;
	command: RemoteCommand;
	startedAt: number;
	resolve: () => void;
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

	init(): void {
		if (typeof window === 'undefined') return;

		this.checkSession();

		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible' && this.status !== 'connected' && this.status !== 'unpaired') {
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
				break;
			}
			case 'hosts': {
				this.hosts = frame.hosts;
				break;
			}
			case 'host_status': {
				const idx = this.hosts.findIndex((h) => h.id === frame.host.id);
				if (idx >= 0) {
					this.hosts[idx] = frame.host;
					this.hosts = [...this.hosts];
				} else {
					this.hosts = [...this.hosts, frame.host];
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
						pending.resolve();
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

	async sendCommand(hostId: string, command: RemoteCommand): Promise<void> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw { code: 'host_offline', message: 'Relay non connesso' } as CommandError;
		}

		const commandId = crypto.randomUUID();

		return new Promise<void>((resolve, reject) => {
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
				resolve: () => {
					clearTimeout(timeoutTimer);
					resolve();
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
}

export const connection = new RemoteConnectionManager();
