import type { Server } from 'bun';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import { handleRequest } from './api.ts';
import { loadConfig, type RelayConfig, type RelayConfigInput } from './config.ts';
import { MAX_FRAME_BYTES } from './protocol.ts';
import { RateLimiter } from './ratelimit.ts';
import { CLOSE_UNAUTHORIZED, SocketHub, type RelayWsData } from './sockets.ts';
import { RelayStore } from './store.ts';

export { CLOSE_UNAUTHORIZED };

export type RelayServer = Server<RelayWsData>;

/**
 * Avvia il server relay Bun con supporto per WebSocket di diagnostica, macchine e client PWA.
 */
export function startRelay(config: RelayConfigInput): RelayServer {
	const dataDir = config.dataDir ?? resolve(process.cwd(), './data');
	mkdirSync(dataDir, { recursive: true });

	const webDir = config.webDir ?? fileURLToPath(new URL('../web/dist/', import.meta.url));
	const version = config.version ?? pkg.version;

	const resolvedConfig: RelayConfig = {
		port: config.port ?? 8787,
		hostname: config.hostname ?? '0.0.0.0',
		adminToken: config.adminToken,
		authTimeoutMs: config.authTimeoutMs ?? 5_000,
		heartbeatMs: config.heartbeatMs ?? 25_000,
		maxDiagSessions: config.maxDiagSessions ?? 8,
		dataDir,
		webDir,
		version,
		commandTimeoutMs: config.commandTimeoutMs
	};

	const store = new RelayStore(dataDir);
	const rateLimiter = new RateLimiter();
	const socketHub = new SocketHub(resolvedConfig, store);

	const server = Bun.serve<RelayWsData>({
		port: resolvedConfig.port,
		hostname: resolvedConfig.hostname,
		fetch(req, s) {
			return handleRequest(req, s, resolvedConfig, store, rateLimiter, socketHub);
		},
		websocket: {
			maxPayloadLength: MAX_FRAME_BYTES,
			idleTimeout: 120,
			sendPings: true,
			open(ws) {
				socketHub.handleOpen(ws);
			},
			message(ws, raw) {
				socketHub.handleMessage(ws, raw);
			},
			close(ws, code, reason) {
				socketHub.handleClose(ws, code, reason);
			}
		}
	});

	const originalStop = server.stop.bind(server);
	server.stop = (closeActive?: boolean) => {
		socketHub.stop();
		store.close();
		return originalStop(closeActive);
	};

	return server;
}

if (import.meta.main) {
	let config: RelayConfig;
	try {
		config = loadConfig(process.env);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	const server = startRelay(config);
	console.log(`omp-studio-relay ${config.version} listening on ${config.hostname}:${server.port}`);
	const stop = () => {
		server.stop(true);
		process.exit(0);
	};
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
}
