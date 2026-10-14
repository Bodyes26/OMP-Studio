import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };

export interface RelayConfig {
	port: number;
	hostname: string;
	adminToken: string;
	/** Tempo concesso a una WebSocket per presentare il token prima di essere chiusa. */
	authTimeoutMs: number;
	/** Intervallo del battito applicativo: deve restare sotto i timeout d'inattivita' di proxy e CDN. */
	heartbeatMs: number;
	/** Tetto alle sessioni di diagnosi aperte insieme: la pagina e' pubblica, il costo no. */
	maxDiagSessions: number;
	/** Cartella dove vive il database SQLite e lo stato persistente. */
	dataDir: string;
	/** Cartella dei file statici della PWA compilata. */
	webDir: string;
	/** Versione del servizio relay esposta in healthz e nei messaggi di benvenuto. */
	version: string;
	/** Timeout di risposta ai comandi in millisecondi (default 30_000). */
	commandTimeoutMs?: number;
}

export type RelayConfigInput = Partial<RelayConfig> & Pick<RelayConfig, 'adminToken'>;

export const MIN_ADMIN_TOKEN_LENGTH = 32;
const DEFAULT_PORT = 8787;

export function loadConfig(env: Record<string, string | undefined>): RelayConfig {
	const adminToken = env.RELAY_ADMIN_TOKEN?.trim() ?? '';
	if (adminToken.length < MIN_ADMIN_TOKEN_LENGTH) {
		throw new Error(
			`RELAY_ADMIN_TOKEN is missing or shorter than ${MIN_ADMIN_TOKEN_LENGTH} characters (generate one with \`openssl rand -hex 32\`).`
		);
	}

	const rawDataDir = env.RELAY_DATA_DIR?.trim() || './data';
	const dataDir = resolve(process.cwd(), rawDataDir);
	// La cartella dati viene creata subito se non esiste, cosi' il database SQLite trova il percorso pronto.
	mkdirSync(dataDir, { recursive: true });

	const defaultWebDir = fileURLToPath(new URL('../web/dist/', import.meta.url));
	const rawWebDir = env.RELAY_WEB_DIR?.trim();
	const webDir = rawWebDir ? resolve(process.cwd(), rawWebDir) : defaultWebDir;

	const version = env.RELAY_VERSION?.trim() || pkg.version;

	return {
		port: parsePort(env.RELAY_PORT),
		hostname: env.RELAY_HOSTNAME?.trim() || '0.0.0.0',
		adminToken,
		authTimeoutMs: 5_000,
		heartbeatMs: 25_000,
		maxDiagSessions: 8,
		dataDir,
		webDir,
		version
	};
}

function parsePort(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`RELAY_PORT must be an integer between 1 and 65535, got "${raw}".`);
	}
	return port;
}
