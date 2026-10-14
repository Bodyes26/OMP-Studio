import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Feature, HostState, PairingKind, Platform } from './protocol.ts';
export const MAX_ACTIVE_CODES_PER_DEVICE = 10;
export const PAIRING_CODE_SWEEP_MS = 60_000;


export interface HostRecord {
	id: string;
	name: string;
	platform: Platform;
	appVersion: string;
	features: Feature[];
	pairedAt: number;
	lastSeenAt: number | null;
	credentialHash: string;
	lastState: HostState | null;
	lastStateAt: number | null;
}

export interface DeviceRecord {
	id: string;
	name: string;
	createdAt: number;
	lastSeenAt: number | null;
	sessionHash: string;
	revoked: boolean;
}

interface RawHostRow {
	id: string;
	name: string;
	platform: string;
	app_version: string;
	features: string;
	paired_at: number;
	last_seen_at: number | null;
	credential_hash: string;
	last_state: string | null;
	last_state_at: number | null;
}

interface RawDeviceRow {
	id: string;
	name: string;
	created_at: number;
	last_seen_at: number | null;
	session_hash: string;
	revoked: number;
}

/**
 * Gestore della persistenza SQLite per dispositivi, macchine, codici e comandi.
 * Utilizza WAL per consentire letture concorrenti senza bloccare le scritture.
 */
export class RelayStore {
	private readonly db: Database;
	private closed = false;
	private sweepTimer?: Timer;
	constructor(dataDir: string) {
		const dbPath = join(dataDir, 'relay.db');
		this.db = new Database(dbPath);
		this.db.exec('PRAGMA journal_mode = WAL;');
		this.initSchema();
		// Pulizia periodica dei codici di abbinamento scaduti o consumati
		this.sweepTimer = setInterval(() => {
			this.prunePairingCodes(Date.now());
		}, PAIRING_CODE_SWEEP_MS);
		this.sweepTimer.unref?.();
	}

	private initSchema(): void {
		const versionRow = this.db.query<{ user_version: number }, []>('PRAGMA user_version;').get();
		const currentVersion = versionRow?.user_version ?? 0;
		if (currentVersion === 0) {
			this.db.run(`
				CREATE TABLE IF NOT EXISTS devices (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					last_seen_at INTEGER,
					session_hash TEXT NOT NULL,
					revoked INTEGER NOT NULL DEFAULT 0
				);
				CREATE TABLE IF NOT EXISTS hosts (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					platform TEXT NOT NULL,
					app_version TEXT NOT NULL,
					features TEXT NOT NULL,
					paired_at INTEGER NOT NULL,
					last_seen_at INTEGER,
					credential_hash TEXT NOT NULL,
					last_state TEXT,
					last_state_at INTEGER
				);
				CREATE TABLE IF NOT EXISTS pairing_codes (
					code_hash TEXT PRIMARY KEY,
					kind TEXT NOT NULL,
					created_by_device TEXT,
					expires_at INTEGER NOT NULL,
					used_at INTEGER
				);
				CREATE TABLE IF NOT EXISTS command_log (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					at INTEGER NOT NULL,
					device_id TEXT NOT NULL,
					host_id TEXT NOT NULL,
					kind TEXT NOT NULL,
					outcome TEXT NOT NULL
				);
				CREATE INDEX IF NOT EXISTS idx_devices_session ON devices (session_hash);
				CREATE INDEX IF NOT EXISTS idx_hosts_credential ON hosts (credential_hash);
				CREATE INDEX IF NOT EXISTS idx_pairing_codes_lookup ON pairing_codes (kind, expires_at);
			`);
			this.db.run('PRAGMA user_version = 1;');
		}
	}

	/** Registra un nuovo dispositivo client abbinato. */
	createDevice(name: string, sessionHash: string, now: number): { id: string; name: string } {
		const id = randomUUID();
		this.db
			.query(
				'INSERT INTO devices (id, name, created_at, last_seen_at, session_hash, revoked) VALUES (?, ?, ?, ?, ?, 0);'
			)
			.run(id, name, now, now, sessionHash);
		return { id, name };
	}

	/** Cerca un dispositivo attivo tramite l'impronta del token di sessione. */
	findDeviceBySessionHash(sessionHash: string): DeviceRecord | null {
		const row = this.db
			.query<RawDeviceRow, [string]>('SELECT * FROM devices WHERE session_hash = ? LIMIT 1;')
			.get(sessionHash);
		if (!row) return null;
		return {
			id: row.id,
			name: row.name,
			createdAt: row.created_at,
			lastSeenAt: row.last_seen_at,
			sessionHash: row.session_hash,
			revoked: row.revoked === 1
		};
	}

	/** Aggiorna il timestamp di ultima attivita' del dispositivo. */
	touchDevice(id: string, now: number): void {
		if (this.closed) return;
		this.db.query('UPDATE devices SET last_seen_at = ? WHERE id = ?;').run(now, id);
	}

	/** Revoca un dispositivo impedendo future autenticazioni. */
	revokeDevice(id: string): boolean {
		const res = this.db.query('UPDATE devices SET revoked = 1 WHERE id = ? AND revoked = 0;').run(id);
		if (res.changes > 0) {
			// Invalida e rimuove immediatamente i codici non utilizzati emessi dal dispositivo revocato
			this.db.query('DELETE FROM pairing_codes WHERE created_by_device = ? AND used_at IS NULL;').run(id);
			return true;
		}
		return false;
	}

	/** Elenca tutti i dispositivi non revocati. */
	listDevices(): Array<{ id: string; name: string; createdAt: number; lastSeenAt: number | null }> {
		const rows = this.db
			.query<RawDeviceRow, []>(
				'SELECT id, name, created_at, last_seen_at, session_hash, revoked FROM devices WHERE revoked = 0 ORDER BY created_at ASC;'
			)
			.all();
		return rows.map((r) => ({
			id: r.id,
			name: r.name,
			createdAt: r.created_at,
			lastSeenAt: r.last_seen_at
		}));
	}

	/** Registra una macchina o ne aggiorna le credenziali preservando lo stato precedente. */
	upsertHost(
		hostId: string,
		name: string,
		platform: Platform,
		appVersion: string,
		credentialHash: string,
		now: number
	): void {
		const existing = this.db.query<{ id: string }, [string]>('SELECT id FROM hosts WHERE id = ?;').get(hostId);
		if (existing) {
			this.db
				.query('UPDATE hosts SET name = ?, platform = ?, app_version = ?, credential_hash = ? WHERE id = ?;')
				.run(name, platform, appVersion, credentialHash, hostId);
		} else {
			this.db
				.query(
					'INSERT INTO hosts (id, name, platform, app_version, features, paired_at, credential_hash) VALUES (?, ?, ?, ?, ?, ?, ?);'
				)
				.run(hostId, name, platform, appVersion, '[]', now, credentialHash);
		}
	}

	/** Cerca una macchina registrata tramite l'impronta del token di autenticazione. */
	getHostByCredentialHash(credentialHash: string): HostRecord | null {
		const row = this.db
			.query<RawHostRow, [string]>('SELECT * FROM hosts WHERE credential_hash = ? LIMIT 1;')
			.get(credentialHash);
		return row ? this.mapHost(row) : null;
	}

	/** Recupera una macchina per identificativo UUID. */
	getHost(hostId: string): HostRecord | null {
		if (this.closed) return null;
		const row = this.db.query<RawHostRow, [string]>('SELECT * FROM hosts WHERE id = ? LIMIT 1;').get(hostId);
		return row ? this.mapHost(row) : null;
	}

	/** Aggiorna i metadati dichiarati dalla macchina all'apertura del socket hello. */
	updateHostHello(
		hostId: string,
		name: string,
		platform: Platform,
		appVersion: string,
		features: Feature[],
		now: number
	): void {
		this.db
			.query('UPDATE hosts SET name = ?, platform = ?, app_version = ?, features = ?, last_seen_at = ? WHERE id = ?;')
			.run(name, platform, appVersion, JSON.stringify(features), now, hostId);
	}

	/** Persiste l'istantanea di stato dell'host. */
	saveHostState(hostId: string, state: HostState, now: number): void {
		if (this.closed) return;
		this.db
			.query('UPDATE hosts SET last_state = ?, last_state_at = ?, last_seen_at = ? WHERE id = ?;')
			.run(JSON.stringify(state), now, now, hostId);
	}

	/** Aggiorna il timestamp di ultima attivita' della macchina. */
	touchHost(hostId: string, now: number): void {
		if (this.closed) return;
		this.db.query('UPDATE hosts SET last_seen_at = ? WHERE id = ?;').run(now, hostId);
	}

	/** Elenca tutte le macchine abbinate. */
	listHosts(): HostRecord[] {
		if (this.closed) return [];
		const rows = this.db.query<RawHostRow, []>('SELECT * FROM hosts ORDER BY paired_at ASC;').all();
		return rows.map((r) => this.mapHost(r));
	}

	/** Elimina una macchina e il suo stato associato. */
	deleteHost(hostId: string): boolean {
		const res = this.db.query('DELETE FROM hosts WHERE id = ?;').run(hostId);
		return res.changes > 0;
	}

	/** Salva un codice di abbinamento temporaneo. */
	createPairingCode(codeHash: string, kind: PairingKind, createdByDevice: string | null, expiresAt: number): void {
		this.db
			.query('INSERT INTO pairing_codes (code_hash, kind, created_by_device, expires_at) VALUES (?, ?, ?, ?);')
			.run(codeHash, kind, createdByDevice, expiresAt);
	}

	/** Consuma un codice di abbinamento verificando tipo, validita' temporale e unicita'. */
	consumePairingCode(codeHash: string, kind: PairingKind, now: number): boolean {
		// Controllo atomico con subquery: richiede che il dispositivo emittente esista e non sia revocato
		const res = this.db
			.query(
				`UPDATE pairing_codes
				 SET used_at = ?
				 WHERE code_hash = ?
				   AND kind = ?
				   AND used_at IS NULL
				   AND expires_at > ?
				   AND (created_by_device IS NULL OR created_by_device IN (SELECT id FROM devices WHERE revoked = 0));`
			)
			.run(now, codeHash, kind, now);
		return res.changes > 0;
	}

	/** Rimuove i codici di abbinamento gia' utilizzati o scaduti. */
	prunePairingCodes(now: number): number {
		if (this.closed) return 0;
		const res = this.db.query('DELETE FROM pairing_codes WHERE used_at IS NOT NULL OR expires_at <= ?;').run(now);
		return res.changes;
	}

	/** Conta i codici non scaduti e non ancora utilizzati emessi da un dispositivo. */
	countActiveCodesForDevice(deviceId: string, now: number): number {
		if (this.closed) return 0;
		const row = this.db
			.query<{ count: number }, [string, number]>(
				'SELECT COUNT(*) as count FROM pairing_codes WHERE created_by_device = ? AND used_at IS NULL AND expires_at > ?;'
			)
			.get(deviceId, now);
		return row?.count ?? 0;
	}

	/** Registra l'esito di un comando mantenendo le ultime 500 righe. */
	logCommand(at: number, deviceId: string, hostId: string, kind: string, outcome: string): void {
		if (this.closed) return;
		this.db
			.query('INSERT INTO command_log (at, device_id, host_id, kind, outcome) VALUES (?, ?, ?, ?, ?);')
			.run(at, deviceId, hostId, kind, outcome);
		// Mantiene la tabella entro il tetto di 500 eventi per evitare crescita indefinita del database.
		this.db
			.query(
				'DELETE FROM command_log WHERE id NOT IN (SELECT id FROM command_log ORDER BY id DESC LIMIT 500);'
			)
			.run();
	}

	close(): void {
		this.closed = true;
		clearInterval(this.sweepTimer);
		this.db.close();
	}
	private mapHost(row: RawHostRow): HostRecord {
		let features: Feature[] = [];
		try {
			const parsed = JSON.parse(row.features);
			if (Array.isArray(parsed)) features = parsed as Feature[];
		} catch {
			features = [];
		}

		let lastState: HostState | null = null;
		if (row.last_state) {
			try {
				lastState = JSON.parse(row.last_state) as HostState;
			} catch {
				lastState = null;
			}
		}

		return {
			id: row.id,
			name: row.name,
			platform: row.platform as Platform,
			appVersion: row.app_version,
			features,
			pairedAt: row.paired_at,
			lastSeenAt: row.last_seen_at,
			credentialHash: row.credential_hash,
			lastState,
			lastStateAt: row.last_state_at
		};
	}
}
