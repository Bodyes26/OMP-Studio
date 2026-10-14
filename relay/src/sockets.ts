import { randomUUID } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import { tokensMatch } from './auth.ts';
import type { RelayConfig } from './config.ts';
import {
	CloseCode,
	COMMAND_FEATURE,
	COMMAND_TIMEOUT_MS,
	FEATURES,
	HELLO_TIMEOUT_MS,
	HEARTBEAT_TIMEOUT_MS,
	MIN_HOST_PROTOCOL_VERSION,
	PROTOCOL,
	type CommandError,
	type DeviceInfo,
	type Feature,
	type HostState,
	type HostSummary,
	type Platform,
	type RelayToClientFrame,
	type RelayToHostFrame,
	type RemoteCommand
} from './protocol.ts';
import type { RelayStore } from './store.ts';

export const CLOSE_UNAUTHORIZED = 4401;
export const MAX_CLIENT_SOCKETS_PER_DEVICE = 5;
export const MAX_TOTAL_CLIENT_SOCKETS = 100;
export const MAX_PENDING_COMMANDS_PER_DEVICE = 20;
export const MAX_GLOBAL_PENDING_COMMANDS = 500;


export interface DiagSession {
	kind: 'diag';
	authed: boolean;
	authedAt: number;
	seq: number;
	authTimer?: Timer;
	heartbeat?: Timer;
}

export interface HostWsSession {
	kind: 'host';
	hostId: string;
	credentialHash: string;
	lastInboundAt: number;
	authed: boolean;
	helloReceived: boolean;
	firstSnapshotReceived: boolean;
	lastAcceptedSeq: number;
	features: Feature[];
	latestState: HostState | null;
	stateReceivedAt: number | null;
	lastPersistedAt: number;
	dirty: boolean;
	pingSeq: number;
	helloTimer?: Timer;
}

export interface ClientWsSession {
	kind: 'client';
	deviceId: string;
	deviceName: string;
	lastInboundAt: number;
	authed: boolean;
	helloReceived: boolean;
	pingSeq: number;
	helloTimer?: Timer;
}

export type RelayWsData = DiagSession | HostWsSession | ClientWsSession;

interface PendingCommand {
	relayCommandId: string;
	clientCommandId: string;
	hostId: string;
	deviceId: string;
	kind: RemoteCommand['kind'];
	clientWs: ServerWebSocket<RelayWsData>;
	timer: Timer;
}

function parseJson(raw: string | Buffer): Record<string, unknown> | null {
	if (typeof raw !== 'string') return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * Gestisce il ciclo di vita delle connessioni WebSocket: sessioni di diagnostica,
 * socket macchine (Studio) e socket client (PWA), con instradamento comandi e battito.
 */
export class SocketHub {
	private readonly hostSockets = new Map<string, Set<ServerWebSocket<RelayWsData>>>();
	private readonly activeHosts = new Map<string, ServerWebSocket<RelayWsData>>();
	private readonly activeClients = new Set<ServerWebSocket<RelayWsData>>();
	private readonly pendingCommands = new Map<string, PendingCommand>();
	private diagSessions = 0;
	private heartbeatInterval?: Timer;

	constructor(
		private readonly config: RelayConfig,
		private readonly store: RelayStore
	) {
		this.startHeartbeat();
	}

	getDiagSessionsCount(): number {
		return this.diagSessions;
	}
	/** Chiude il battito globale e tutti i socket aperti. */
	stop(): void {
		clearInterval(this.heartbeatInterval);
		for (const pending of this.pendingCommands.values()) {
			clearTimeout(pending.timer);
		}
		this.pendingCommands.clear();
	}

	// ---------------------------------------------------------------------------
	// Eventi WebSocket
	// ---------------------------------------------------------------------------

	handleOpen(ws: ServerWebSocket<RelayWsData>): void {
		const data = ws.data;
		if (data.kind === 'diag') {
			this.diagSessions += 1;
			data.authTimer = setTimeout(() => {
				ws.close(CLOSE_UNAUTHORIZED, 'auth timeout');
			}, this.config.authTimeoutMs);
			data.authTimer.unref?.();
			return;
		}

		if (data.kind === 'host') {
			// Traccia ogni socket host fin dall'apertura per gestire revoche e rotazioni
			let sockets = this.hostSockets.get(data.hostId);
			if (!sockets) {
				sockets = new Set();
				this.hostSockets.set(data.hostId, sockets);
			}
			sockets.add(ws);

			data.helloTimer = setTimeout(() => {
				if (!data.helloReceived) {
					ws.close(CloseCode.protocolError, 'hello timeout');
				}
			}, HELLO_TIMEOUT_MS);
			data.helloTimer.unref?.();
			return;
		}

		if (data.kind === 'client') {
			// Tetto globale dei socket client
			if (this.activeClients.size >= MAX_TOTAL_CLIENT_SOCKETS) {
				ws.close(CloseCode.replaced, 'total client socket quota reached');
				return;
			}

			// Tetto per singolo dispositivo client: se raggiunto, chiude la sessione piu' vecchia
			const deviceSockets: ServerWebSocket<RelayWsData>[] = [];
			for (const clientWs of this.activeClients) {
				const clientData = clientWs.data as ClientWsSession;
				if (clientData.deviceId === data.deviceId) {
					deviceSockets.push(clientWs);
				}
			}
			if (deviceSockets.length >= MAX_CLIENT_SOCKETS_PER_DEVICE) {
				const oldest = deviceSockets[0];
				if (oldest) {
					oldest.close(CloseCode.replaced, 'replaced: device client socket quota reached');
					this.activeClients.delete(oldest);
				}
			}

			this.activeClients.add(ws);
			data.helloTimer = setTimeout(() => {
				if (!data.helloReceived) {
					ws.close(CloseCode.protocolError, 'hello timeout');
				}
			}, HELLO_TIMEOUT_MS);
			data.helloTimer.unref?.();
		}
	}

	handleMessage(ws: ServerWebSocket<RelayWsData>, raw: string | Buffer): void {
		const data = ws.data;
		if (data.kind === 'diag') {
			this.handleDiagMessage(ws, data, raw);
			return;
		}
		if (data.kind === 'host') {
			this.handleHostMessage(ws, data, raw);
			return;
		}
		if (data.kind === 'client') {
			this.handleClientMessage(ws, data, raw);
		}
	}

	handleClose(ws: ServerWebSocket<RelayWsData>, code: number, reason: string): void {
		const data = ws.data;
		if (data.kind === 'diag') {
			this.diagSessions -= 1;
			clearTimeout(data.authTimer);
			clearInterval(data.heartbeat);
			return;
		}

		if (data.kind === 'host') {
			clearTimeout(data.helloTimer);
			const sockets = this.hostSockets.get(data.hostId);
			if (sockets) {
				sockets.delete(ws);
				if (sockets.size === 0) {
					this.hostSockets.delete(data.hostId);
				}
			}

			if (data.dirty && data.latestState) {
				this.store.saveHostState(data.hostId, data.latestState, Date.now());
			}
			this.store.touchHost(data.hostId, Date.now());

			const currentActive = this.activeHosts.get(data.hostId);
			if (currentActive === ws) {
				this.activeHosts.delete(data.hostId);

				// Notifica il fallimento di eventuali comandi in attesa su questa macchina.
				for (const [relayCommandId, pending] of Array.from(this.pendingCommands.entries())) {
					if (pending.hostId === data.hostId) {
						clearTimeout(pending.timer);
						this.pendingCommands.delete(relayCommandId);
						this.sendToClient(pending.clientWs, {
							type: 'command_result',
							hostId: data.hostId,
							commandId: pending.clientCommandId,
							ok: false,
							error: { code: 'host_offline', message: 'Host disconnected' }
						});
						this.store.logCommand(Date.now(), pending.deviceId, data.hostId, pending.kind, 'host_offline');
					}
				}

				const summary = this.getHostSummary(data.hostId);
				if (summary) {
					this.broadcastToClients({ type: 'host_status', host: summary });
				}
			}
			return;
		}

		if (data.kind === 'client') {
			clearTimeout(data.helloTimer);
			this.activeClients.delete(ws);

			// Pulisce i comandi pendenti originati da questa sessione client.
			for (const [relayCommandId, pending] of Array.from(this.pendingCommands.entries())) {
				if (pending.clientWs === ws) {
					clearTimeout(pending.timer);
					this.pendingCommands.delete(relayCommandId);
				}
			}

			// Se il client era gia' autenticato, aggiorna l'elenco dei dispositivi connessi verso le macchine.
			if (data.helloReceived) {
				this.broadcastClientsToHosts();
			}
		}
	}
	// ---------------------------------------------------------------------------
	// Gestione Host (Studio)
	// ---------------------------------------------------------------------------

	private handleHostMessage(
		ws: ServerWebSocket<RelayWsData>,
		conn: HostWsSession,
		raw: string | Buffer
	): void {
		const msg = parseJson(raw);
		if (!msg || typeof msg.type !== 'string') {
			ws.close(CloseCode.protocolError, 'malformed frame');
			return;
		}

		conn.lastInboundAt = Date.now();

		if (!conn.helloReceived) {
			if (msg.type !== 'hello') {
				ws.close(CloseCode.protocolError, 'expected hello frame');
				return;
			}
			this.processHostHello(ws, conn, msg);
			return;
		}

		// Rifiuta frame non pertinenti al canale host (es. comandi da client).
		if (msg.type === 'hello') {
			ws.close(CloseCode.protocolError, 'duplicate hello');
			return;
		}

		if (msg.type === 'snapshot') {
			this.processHostSnapshot(ws, conn, msg);
			return;
		}

		if (msg.type === 'command_result') {
			this.processHostCommandResult(ws, conn, msg);
			return;
		}

		if (msg.type === 'pong') {
			return;
		}

		ws.close(CloseCode.protocolError, `unexpected frame type: ${msg.type}`);
	}

	private processHostHello(
		ws: ServerWebSocket<RelayWsData>,
		conn: HostWsSession,
		msg: Record<string, unknown>
	): void {
		const protocol = msg.protocol as { name?: unknown; version?: unknown } | undefined;
		if (
			!protocol ||
			protocol.name !== PROTOCOL.name ||
			typeof protocol.version !== 'number' ||
			protocol.version < MIN_HOST_PROTOCOL_VERSION ||
			protocol.version > PROTOCOL.version
		) {
			clearTimeout(conn.helloTimer);
			ws.close(
				CloseCode.incompatible,
				`Incompatible protocol: expected ${PROTOCOL.name} v${MIN_HOST_PROTOCOL_VERSION}..${PROTOCOL.version}, got ${String(protocol?.name)} v${String(protocol?.version)}`
			);
			return;
		}

		const hostInfo = msg.host as { name?: unknown; platform?: unknown; appVersion?: unknown } | undefined;
		if (
			!hostInfo ||
			typeof hostInfo.name !== 'string' ||
			typeof hostInfo.platform !== 'string' ||
			typeof hostInfo.appVersion !== 'string'
		) {
			clearTimeout(conn.helloTimer);
			ws.close(CloseCode.protocolError, 'invalid host payload in hello');
			return;
		}

		// Re-verifica che la credenziale del socket sia ancora valida al momento di hello
		const currentHost = this.store.getHost(conn.hostId);
		if (!currentHost || currentHost.credentialHash !== conn.credentialHash) {
			clearTimeout(conn.helloTimer);
			ws.close(CloseCode.revoked, 'host credential revoked or replaced');
			return;
		}

		clearTimeout(conn.helloTimer);
		conn.helloReceived = true;

		const declaredFeatures = Array.isArray(msg.features) ? msg.features : [];
		conn.features = declaredFeatures.filter((f): f is Feature => FEATURES.includes(f as Feature));

		const now = Date.now();
		this.store.updateHostHello(
			conn.hostId,
			hostInfo.name,
			hostInfo.platform as Platform,
			hostInfo.appVersion,
			conn.features,
			now
		);

		// Chiude l'eventuale connessione precedente della stessa macchina (vince l'ultima).
		const previous = this.activeHosts.get(conn.hostId);
		if (previous && previous !== ws) {
			previous.close(CloseCode.replaced, 'replaced by new connection');
		}
		this.activeHosts.set(conn.hostId, ws);

		const welcome: RelayToHostFrame = {
			type: 'welcome',
			protocol: PROTOCOL,
			relay: {
				version: this.config.version,
				protocol: {
					name: PROTOCOL.name,
					min: MIN_HOST_PROTOCOL_VERSION,
					max: PROTOCOL.version
				}
			},
			features: conn.features,
			heartbeatMs: this.config.heartbeatMs,
			clients: this.getConnectedDeviceInfos()
		};
		ws.send(JSON.stringify(welcome));

		const summary = this.getHostSummary(conn.hostId);
		if (summary) {
			this.broadcastToClients({ type: 'host_status', host: summary });
		}
	}

	private processHostSnapshot(
		ws: ServerWebSocket<RelayWsData>,
		conn: HostWsSession,
		msg: Record<string, unknown>
	): void {
		if (typeof msg.seq !== 'number' || !msg.state || typeof msg.state !== 'object') {
			ws.close(CloseCode.protocolError, 'invalid snapshot frame');
			return;
		}

		const seq = msg.seq;
		const state = msg.state as HostState;

		let accepted = false;
		if (!conn.firstSnapshotReceived) {
			conn.firstSnapshotReceived = true;
			conn.lastAcceptedSeq = seq;
			accepted = true;
		} else if (seq > conn.lastAcceptedSeq) {
			conn.lastAcceptedSeq = seq;
			accepted = true;
		}

		if (!accepted) {
			return;
		}

		conn.latestState = state;
		conn.stateReceivedAt = Date.now();

		const now = Date.now();
		// Persiste lo stato al massimo una volta ogni 2 secondi per evitare scritture eccessive su disco.
		if (now - conn.lastPersistedAt >= 2000) {
			this.store.saveHostState(conn.hostId, state, now);
			conn.lastPersistedAt = now;
			conn.dirty = false;
		} else {
			conn.dirty = true;
		}

		this.broadcastToClients({
			type: 'host_snapshot',
			hostId: conn.hostId,
			seq,
			receivedAt: conn.stateReceivedAt,
			state
		});
	}

	private processHostCommandResult(
		ws: ServerWebSocket<RelayWsData>,
		conn: HostWsSession,
		msg: Record<string, unknown>
	): void {
		if (typeof msg.commandId !== 'string' || typeof msg.ok !== 'boolean') {
			ws.close(CloseCode.protocolError, 'invalid command_result frame');
			return;
		}

		const pending = this.pendingCommands.get(msg.commandId);
		if (!pending) return;

		// Accetta il risultato solo dall'host a cui il comando era stato originariamente inoltrato
		if (pending.hostId !== conn.hostId) {
			return;
		}

		clearTimeout(pending.timer);
		this.pendingCommands.delete(msg.commandId);

		// Restituisce al client il suo commandId originale
		this.sendToClient(pending.clientWs, {
			type: 'command_result',
			hostId: conn.hostId,
			commandId: pending.clientCommandId,
			ok: msg.ok,
			error: msg.error as CommandError | undefined
		});

		const outcome = msg.ok ? 'ok' : ((msg.error as CommandError | undefined)?.code ?? 'failed');
		this.store.logCommand(Date.now(), pending.deviceId, conn.hostId, pending.kind, outcome);
	}

	// ---------------------------------------------------------------------------
	// Gestione Client (PWA)
	// ---------------------------------------------------------------------------

	private handleClientMessage(
		ws: ServerWebSocket<RelayWsData>,
		conn: ClientWsSession,
		raw: string | Buffer
	): void {
		const msg = parseJson(raw);
		if (!msg || typeof msg.type !== 'string') {
			ws.close(CloseCode.protocolError, 'malformed frame');
			return;
		}

		conn.lastInboundAt = Date.now();

		// Protezione da confusione di ruolo: i frame della macchina non sono ammessi sul canale client.
		if (msg.type === 'snapshot' || msg.type === 'command_result' || 'host' in msg) {
			ws.close(CloseCode.protocolError, 'host-only frame on client socket');
			return;
		}

		if (!conn.helloReceived) {
			if (msg.type !== 'hello') {
				ws.close(CloseCode.protocolError, 'expected hello frame');
				return;
			}
			this.processClientHello(ws, conn, msg);
			return;
		}

		if (msg.type === 'hello') {
			ws.close(CloseCode.protocolError, 'duplicate hello');
			return;
		}

		if (msg.type === 'command') {
			this.processClientCommand(ws, conn, msg);
			return;
		}

		if (msg.type === 'resync') {
			this.processClientResync(ws, msg);
			return;
		}

		if (msg.type === 'pong') {
			return;
		}

		ws.close(CloseCode.protocolError, `unexpected frame type: ${msg.type}`);
	}

	private processClientHello(
		ws: ServerWebSocket<RelayWsData>,
		conn: ClientWsSession,
		msg: Record<string, unknown>
	): void {
		const protocol = msg.protocol as { name?: unknown; version?: unknown } | undefined;
		if (!protocol || protocol.name !== PROTOCOL.name || protocol.version !== PROTOCOL.version) {
			clearTimeout(conn.helloTimer);
			ws.close(
				CloseCode.incompatible,
				`Incompatible protocol: expected ${PROTOCOL.name} v${PROTOCOL.version}, got ${String(protocol?.name)} v${String(protocol?.version)}`
			);
			return;
		}
		clearTimeout(conn.helloTimer);
		conn.helloReceived = true;
		this.store.touchDevice(conn.deviceId, Date.now());

		const welcome: RelayToClientFrame = {
			type: 'welcome',
			protocol: PROTOCOL,
			relay: {
				version: this.config.version,
				protocol: {
					name: PROTOCOL.name,
					min: MIN_HOST_PROTOCOL_VERSION,
					max: PROTOCOL.version
				}
			},
			heartbeatMs: this.config.heartbeatMs,
			device: { id: conn.deviceId, name: conn.deviceName },
			hosts: this.getAllHostSummaries()
		};
		ws.send(JSON.stringify(welcome));

		// Spedisce subito lo stato salvato di tutte le macchine registrate.
		for (const host of this.store.listHosts()) {
			const activeWs = this.activeHosts.get(host.id);
			const activeData = activeWs?.data as HostWsSession | undefined;
			const state = activeData?.latestState ?? host.lastState;
			const receivedAt = activeData?.stateReceivedAt ?? host.lastStateAt;
			const seq = activeData?.lastAcceptedSeq ?? 0;
			if (state && receivedAt !== null) {
				const frame: RelayToClientFrame = {
					type: 'host_snapshot',
					hostId: host.id,
					seq,
					receivedAt,
					state
				};
				ws.send(JSON.stringify(frame));
			}
		}

		this.broadcastClientsToHosts();
	}

	private processClientCommand(
		ws: ServerWebSocket<RelayWsData>,
		conn: ClientWsSession,
		msg: Record<string, unknown>
	): void {
		const commandId = msg.commandId;
		const hostId = msg.hostId;
		const command = msg.command as RemoteCommand | undefined;

		if (
			typeof commandId !== 'string' ||
			typeof hostId !== 'string' ||
			!command ||
			typeof command !== 'object' ||
			typeof command.kind !== 'string'
		) {
			ws.close(CloseCode.protocolError, 'invalid command frame');
			return;
		}

		const hostRecord = this.store.getHost(hostId);
		if (!hostRecord) {
			this.sendToClient(ws, {
				type: 'command_result',
				hostId,
				commandId,
				ok: false,
				error: { code: 'not_found', message: 'Host not found' }
			});
			this.store.logCommand(Date.now(), conn.deviceId, hostId, command.kind, 'not_found');
			return;
		}

		const hostWs = this.activeHosts.get(hostId);
		const hostData = hostWs?.data as HostWsSession | undefined;
		if (!hostWs || !hostData || !hostData.helloReceived) {
			this.sendToClient(ws, {
				type: 'command_result',
				hostId,
				commandId,
				ok: false,
				error: { code: 'host_offline', message: 'Host is offline' }
			});
			this.store.logCommand(Date.now(), conn.deviceId, hostId, command.kind, 'host_offline');
			return;
		}

		const requiredFeature = COMMAND_FEATURE[command.kind];
		if (!requiredFeature || !hostData.features.includes(requiredFeature)) {
			this.sendToClient(ws, {
				type: 'command_result',
				hostId,
				commandId,
				ok: false,
				error: { code: 'unsupported', message: `Host does not support feature "${requiredFeature}"` }
			});
			this.store.logCommand(Date.now(), conn.deviceId, hostId, command.kind, 'unsupported');
			return;
		}

		// Tetto globale dei comandi in attesa per prevenire accumulo incontrollato in memoria
		if (this.pendingCommands.size >= MAX_GLOBAL_PENDING_COMMANDS) {
			this.sendToClient(ws, {
				type: 'command_result',
				hostId,
				commandId,
				ok: false,
				error: { code: 'rejected', message: 'Global pending command quota reached' }
			});
			this.store.logCommand(Date.now(), conn.deviceId, hostId, command.kind, 'rejected');
			return;
		}

		// Tetto comandi in attesa per singolo dispositivo client
		let devicePendingCount = 0;
		for (const pending of this.pendingCommands.values()) {
			if (pending.deviceId === conn.deviceId) {
				devicePendingCount++;
			}
		}
		if (devicePendingCount >= MAX_PENDING_COMMANDS_PER_DEVICE) {
			this.sendToClient(ws, {
				type: 'command_result',
				hostId,
				commandId,
				ok: false,
				error: { code: 'rejected', message: 'Device pending command quota reached' }
			});
			this.store.logCommand(Date.now(), conn.deviceId, hostId, command.kind, 'rejected');
			return;
		}

		// Rifiuta comandi duplicati in attesa dalla stessa sessione client
		for (const pending of this.pendingCommands.values()) {
			if (pending.clientWs === ws && pending.clientCommandId === commandId) {
				this.sendToClient(ws, {
					type: 'command_result',
					hostId,
					commandId,
					ok: false,
					error: { code: 'rejected', message: 'Duplicate pending commandId' }
				});
				this.store.logCommand(Date.now(), conn.deviceId, hostId, command.kind, 'rejected');
				return;
			}
		}

		// Il relay assegna un proprio UUID di routing unico per l'inoltro all'host
		const relayCommandId = randomUUID();
		const forwardFrame: RelayToHostFrame = {
			type: 'command',
			commandId: relayCommandId,
			device: { id: conn.deviceId, name: conn.deviceName },
			command
		};
		hostWs.send(JSON.stringify(forwardFrame));

		const commandTimeout = this.config.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
		const pendingEntry: PendingCommand = {
			relayCommandId,
			clientCommandId: commandId,
			hostId,
			deviceId: conn.deviceId,
			kind: command.kind,
			clientWs: ws,
			timer: undefined as unknown as Timer
		};

		const timer = setTimeout(() => {
			const current = this.pendingCommands.get(relayCommandId);
			if (current !== pendingEntry) return;
			this.pendingCommands.delete(relayCommandId);
			this.sendToClient(ws, {
				type: 'command_result',
				hostId,
				commandId: pendingEntry.clientCommandId,
				ok: false,
				error: { code: 'timeout', message: 'Command timed out' }
			});
			this.store.logCommand(Date.now(), conn.deviceId, hostId, command.kind, 'timeout');
		}, commandTimeout);
		timer.unref?.();
		pendingEntry.timer = timer;

		this.pendingCommands.set(relayCommandId, pendingEntry);
	}

	private processClientResync(ws: ServerWebSocket<RelayWsData>, msg: Record<string, unknown>): void {
		const hostId = msg.hostId;
		if (typeof hostId !== 'string') {
			ws.close(CloseCode.protocolError, 'invalid resync frame');
			return;
		}

		const hostWs = this.activeHosts.get(hostId);
		const hostData = hostWs?.data as HostWsSession | undefined;
		let state: HostState | null = hostData?.latestState ?? null;
		let receivedAt: number | null = hostData?.stateReceivedAt ?? null;
		let seq = hostData?.lastAcceptedSeq ?? 0;

		if (!state) {
			const record = this.store.getHost(hostId);
			if (record?.lastState) {
				state = record.lastState;
				receivedAt = record.lastStateAt;
				seq = 0;
			}
		}

		if (state && receivedAt !== null) {
			const frame: RelayToClientFrame = {
				type: 'host_snapshot',
				hostId,
				seq,
				receivedAt,
				state
			};
			ws.send(JSON.stringify(frame));
		}
	}

	// ---------------------------------------------------------------------------
	// Diagnostica
	// ---------------------------------------------------------------------------

	private handleDiagMessage(
		ws: ServerWebSocket<RelayWsData>,
		session: DiagSession,
		raw: string | Buffer
	): void {
		const msg = parseJson(raw);
		if (!session.authed) {
			clearTimeout(session.authTimer);
			const token = msg?.type === 'auth' ? msg.token : undefined;
			if (typeof token !== 'string' || !tokensMatch(token, this.config.adminToken)) {
				ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
				return;
			}
			session.authed = true;
			session.authedAt = Date.now();
			ws.send(
				JSON.stringify({
					type: 'welcome',
					heartbeatMs: this.config.heartbeatMs,
					serverTime: session.authedAt
				})
			);
			session.heartbeat = setInterval(() => {
				session.seq += 1;
				ws.send(JSON.stringify({ type: 'ping', seq: session.seq, t: Date.now() }));
			}, this.config.heartbeatMs);
			return;
		}

		if (msg?.type === 'echo') {
			ws.send(JSON.stringify({ type: 'echo', t: msg.t, serverTime: Date.now() }));
		}
	}

	// ---------------------------------------------------------------------------
	// Battito periodico ed emissioni
	// ---------------------------------------------------------------------------

	private startHeartbeat(): void {
		this.heartbeatInterval = setInterval(() => {
			const now = Date.now();

			// Battito verso le macchine.
			for (const [hostId, ws] of this.activeHosts.entries()) {
				const data = ws.data as HostWsSession;
				if (now - data.lastInboundAt > HEARTBEAT_TIMEOUT_MS) {
					ws.close(CloseCode.protocolError, 'heartbeat timeout');
					continue;
				}
				data.pingSeq += 1;
				const frame: RelayToHostFrame = { type: 'ping', seq: data.pingSeq, t: now };
				ws.send(JSON.stringify(frame));
			}

			// Battito verso i client PWA.
			for (const ws of this.activeClients) {
				const data = ws.data as ClientWsSession;
				if (data.helloReceived) {
					if (now - data.lastInboundAt > HEARTBEAT_TIMEOUT_MS) {
						ws.close(CloseCode.protocolError, 'heartbeat timeout');
						continue;
					}
					data.pingSeq += 1;
					const frame: RelayToClientFrame = { type: 'ping', seq: data.pingSeq, t: now };
					ws.send(JSON.stringify(frame));
				}
			}
		}, this.config.heartbeatMs);
		this.heartbeatInterval.unref?.();
	}

	/** Notifica a tutti i client collegati un frame. */
	broadcastToClients(frame: RelayToClientFrame): void {
		const payload = JSON.stringify(frame);
		for (const ws of this.activeClients) {
			const data = ws.data as ClientWsSession;
			if (data.helloReceived) {
				ws.send(payload);
			}
		}
	}

	/** Invia a tutte le macchine connesse l'elenco dei dispositivi attualmente online. */
	broadcastClientsToHosts(): void {
		const clients = this.getConnectedDeviceInfos();
		const frame: RelayToHostFrame = { type: 'clients', clients };
		const payload = JSON.stringify(frame);
		for (const ws of this.activeHosts.values()) {
			ws.send(payload);
		}
	}

	private sendToClient(ws: ServerWebSocket<RelayWsData>, frame: RelayToClientFrame): void {
		try {
			ws.send(JSON.stringify(frame));
		} catch {
			// Il client potrebbe essersi disconnesso nel frattempo.
		}
	}

	/** Restituisce l'elenco dei dispositivi unici attualmente collegati al relay. */
	getConnectedDeviceInfos(): DeviceInfo[] {
		const seen = new Set<string>();
		const list: DeviceInfo[] = [];
		for (const ws of this.activeClients) {
			const data = ws.data as ClientWsSession;
			if (data.helloReceived && !seen.has(data.deviceId)) {
				seen.add(data.deviceId);
				list.push({ id: data.deviceId, name: data.deviceName });
			}
		}
		return list;
	}

	/** Verifica se un dispositivo ha almeno una connessione WebSocket aperta. */
	isDeviceOnline(deviceId: string): boolean {
		for (const ws of this.activeClients) {
			const data = ws.data as ClientWsSession;
			if (data.deviceId === deviceId && data.helloReceived) return true;
		}
		return false;
	}

	/** Verifica se una macchina ha una connessione WebSocket aperta. */
	isHostOnline(hostId: string): boolean {
		return this.activeHosts.has(hostId);
	}

	/** Restituisce il riepilogo di una macchina registrata. */
	getHostSummary(hostId: string): HostSummary | null {
		const record = this.store.getHost(hostId);
		if (!record) return null;
		const activeWs = this.activeHosts.get(hostId);
		const activeData = activeWs?.data as HostWsSession | undefined;
		return {
			id: record.id,
			name: record.name,
			platform: record.platform,
			appVersion: record.appVersion,
			features: activeData?.features ?? record.features,
			online: this.isHostOnline(hostId),
			pairedAt: record.pairedAt,
			lastSeenAt: record.lastSeenAt
		};
	}

	/** Elenca il riassunto di tutte le macchine registrate. */
	getAllHostSummaries(): HostSummary[] {
		return this.store.listHosts().map((h) => ({
			id: h.id,
			name: h.name,
			platform: h.platform,
			appVersion: h.appVersion,
			features: (this.activeHosts.get(h.id)?.data as HostWsSession | undefined)?.features ?? h.features,
			online: this.isHostOnline(h.id),
			pairedAt: h.pairedAt,
			lastSeenAt: h.lastSeenAt
		}));
	}

	// ---------------------------------------------------------------------------
	// Azioni esterne di revoca e sostituzione
	// ---------------------------------------------------------------------------

	/** Chiude tutti i socket di una macchina (pre-hello e post-hello) su revoca o sostituzione. */
	closeHostIfConnected(hostId: string, code: number, reason: string): void {
		const sockets = this.hostSockets.get(hostId);
		if (sockets) {
			for (const ws of Array.from(sockets)) {
				ws.close(code, reason);
			}
			this.hostSockets.delete(hostId);
		}
		const active = this.activeHosts.get(hostId);
		if (active) {
			active.close(code, reason);
			this.activeHosts.delete(hostId);
		}
	}

	/** Chiude tutti i socket di un dispositivo revocato. */
	revokeDeviceSockets(deviceId: string): void {
		for (const ws of this.activeClients) {
			const data = ws.data as ClientWsSession;
			if (data.deviceId === deviceId) {
				ws.close(CloseCode.revoked, 'device revoked');
			}
		}
		this.broadcastClientsToHosts();
	}
}
