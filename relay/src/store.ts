import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
	Feature,
	HostState,
	PairingKind,
	Platform,
	RemoteCommand,
	RemoteDeferredTask
} from './protocol.ts';
export const MAX_ACTIVE_CODES_PER_DEVICE = 10;
export const PAIRING_CODE_SWEEP_MS = 60_000;
export const MAX_PUSH_SUBSCRIPTIONS_PER_DEVICE = 5;
/** Tetto dei lavori in attesa per una macchina spenta: evita una crescita senza fine dell'outbox. */
export const MAX_DEFERRED_PER_HOST = 20;
/** Anteprima del prompt mostrata nella PWA per un lavoro in attesa. */
export const DEFERRED_PROMPT_PREVIEW = 200;

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

export interface PushSubscriptionRecord {
	id: string;
	deviceId: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	userAgent: string | null;
	/** Lingua dichiarata dal dispositivo per le notifiche; `null` per i client vecchi (inglese). */
	language: string | null;
	createdAt: number;
	lastUsedAt: number | null;
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

interface RawDeferredRow {
	host_id: string;
	command_id: string;
	device_id: string;
	kind: string;
	command: string;
	project_id: string;
	prompt_preview: string;
	created_at: number;
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
		if (currentVersion < 1) {
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
		if (currentVersion < 2) {
			this.db.run(`
				CREATE TABLE IF NOT EXISTS vapid_keys (
					id TEXT PRIMARY KEY,
					public_key TEXT NOT NULL,
					private_key TEXT NOT NULL,
					created_at INTEGER NOT NULL
				);
				CREATE TABLE IF NOT EXISTS push_subscriptions (
					id TEXT PRIMARY KEY,
					device_id TEXT NOT NULL,
					endpoint TEXT NOT NULL UNIQUE,
					p256dh TEXT NOT NULL,
					auth TEXT NOT NULL,
					user_agent TEXT,
					created_at INTEGER NOT NULL,
					last_used_at INTEGER
				);
				CREATE INDEX IF NOT EXISTS idx_push_subs_device ON push_subscriptions (device_id);
				CREATE INDEX IF NOT EXISTS idx_push_subs_endpoint ON push_subscriptions (endpoint);
			`);
			this.db.run('PRAGMA user_version = 2;');
		}
		if (currentVersion < 3) {
			// Lingua delle notifiche per dispositivo: `NULL` per le sottoscrizioni
			// registrate prima di questo campo, che ricevono l'inglese.
			const columns = this.db
				.query<{ name: string }, []>('PRAGMA table_info(push_subscriptions);')
				.all();
			if (!columns.some((column) => column.name === 'language')) {
				this.db.run('ALTER TABLE push_subscriptions ADD COLUMN language TEXT;');
			}
			this.db.run('PRAGMA user_version = 3;');
		}
		if (currentVersion < 4) {
			// Outbox dei `create_task` rinviati a macchina spenta (R-REM-22). Il
			// comando intero sta in JSON: al ritorno dell'host va inoltrato cosi'
			// com'e', con il `commandId` scelto dal telefono come chiave.
			this.db.run(`
				CREATE TABLE IF NOT EXISTS deferred_commands (
					host_id TEXT NOT NULL,
					command_id TEXT NOT NULL,
					device_id TEXT NOT NULL,
					kind TEXT NOT NULL,
					command TEXT NOT NULL,
					project_id TEXT NOT NULL,
					prompt_preview TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					PRIMARY KEY (host_id, command_id)
				);
				CREATE INDEX IF NOT EXISTS idx_deferred_host ON deferred_commands (host_id, created_at);
			`);
			this.db.run('PRAGMA user_version = 4;');
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
			// Rimuove anche le sottoscrizioni push associate al dispositivo revocato
			this.db.query('DELETE FROM push_subscriptions WHERE device_id = ?;').run(id);
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

	/** Elimina una macchina, il suo stato e i lavori che aspettavano il suo ritorno. */
	deleteHost(hostId: string): boolean {
		const res = this.db.query('DELETE FROM hosts WHERE id = ?;').run(hostId);
		// Alla revoca l'outbox non ha piu' destinatario: senza questa pulizia le
		// righe resterebbero per sempre (R-REM-22).
		this.db.query('DELETE FROM deferred_commands WHERE host_id = ?;').run(hostId);
		return res.changes > 0;
	}

	// -------------------------------------------------------------------------
	// Outbox dei lavori rinviati (R-REM-22)
	// -------------------------------------------------------------------------

	/**
	 * Conserva un `create_task` per una macchina spenta. Oltre il tetto per host
	 * rifiuta il nuovo invece di scartare un lavoro gia' accettato: il telefono
	 * riceve `rejected` e lo puo' dire, senza perdite silenziose.
	 * Restituisce `false` anche per un `commandId` gia' presente.
	 */
	saveDeferredCommand(
		hostId: string,
		commandId: string,
		deviceId: string,
		kind: string,
		command: RemoteCommand,
		now: number
	): boolean {
		if (this.closed) return false;
		const existing = this.db
			.query<{ command_id: string }, [string, string]>(
				'SELECT command_id FROM deferred_commands WHERE host_id = ? AND command_id = ? LIMIT 1;'
			)
			.get(hostId, commandId);
		if (existing) return false;
		if (this.countDeferredForHost(hostId) >= MAX_DEFERRED_PER_HOST) return false;

		const projectId =
			'projectId' in command && typeof command.projectId === 'string' ? command.projectId : '';
		const prompt =
			'prompt' in command && typeof command.prompt === 'string' ? command.prompt : '';
		this.db
			.query(
				`INSERT INTO deferred_commands (host_id, command_id, device_id, kind, command, project_id, prompt_preview, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
			)
			.run(
				hostId,
				commandId,
				deviceId,
				kind,
				JSON.stringify(command),
				projectId,
				prompt.slice(0, DEFERRED_PROMPT_PREVIEW),
				now
			);
		return true;
	}

	/** Lavori rinviati di una macchina, dal piu' vecchio: l'ordine di consegna. */
	listDeferredForHost(hostId: string): Array<{
		commandId: string;
		deviceId: string;
		kind: string;
		command: RemoteCommand;
	}> {
		if (this.closed) return [];
		const rows = this.db
			.query<RawDeferredRow, [string]>(
				'SELECT * FROM deferred_commands WHERE host_id = ? ORDER BY created_at ASC, rowid ASC;'
			)
			.all(hostId);
		const out: Array<{ commandId: string; deviceId: string; kind: string; command: RemoteCommand }> = [];
		for (const row of rows) {
			try {
				out.push({
					commandId: row.command_id,
					deviceId: row.device_id,
					kind: row.kind,
					command: JSON.parse(row.command) as RemoteCommand
				});
			} catch {
				// Riga illeggibile: la si scarta invece di bloccare la consegna delle altre.
				this.db
					.query('DELETE FROM deferred_commands WHERE host_id = ? AND command_id = ?;')
					.run(row.host_id, row.command_id);
			}
		}
		return out;
	}

	/** Riepilogo per la PWA: cosa aspetta una macchina spenta. */
	listDeferredSummaries(hostId: string): RemoteDeferredTask[] {
		if (this.closed) return [];
		const rows = this.db
			.query<RawDeferredRow, [string]>(
				'SELECT * FROM deferred_commands WHERE host_id = ? ORDER BY created_at ASC, rowid ASC;'
			)
			.all(hostId);
		return rows.map((row) => ({
			commandId: row.command_id,
			projectId: row.project_id,
			prompt: row.prompt_preview,
			createdAt: row.created_at,
			deviceId: row.device_id
		}));
	}

	countDeferredForHost(hostId: string): number {
		if (this.closed) return 0;
		const row = this.db
			.query<{ count: number }, [string]>(
				'SELECT COUNT(*) as count FROM deferred_commands WHERE host_id = ?;'
			)
			.get(hostId);
		return row?.count ?? 0;
	}

	/** Rimuove un lavoro rinviato: consegnato o annullato dal telefono. */
	deleteDeferredCommand(hostId: string, commandId: string): RemoteCommand | null {
		if (this.closed) return null;
		const row = this.db
			.query<RawDeferredRow, [string, string]>(
				'SELECT * FROM deferred_commands WHERE host_id = ? AND command_id = ? LIMIT 1;'
			)
			.get(hostId, commandId);
		if (!row) return null;
		this.db
			.query('DELETE FROM deferred_commands WHERE host_id = ? AND command_id = ?;')
			.run(hostId, commandId);
		try {
			return JSON.parse(row.command) as RemoteCommand;
		} catch {
			return null;
		}
	}

	/** Svuota l'outbox di una macchina: alla revoca i lavori non hanno piu' destinatario. */
	deleteDeferredForHost(hostId: string): number {
		if (this.closed) return 0;
		const res = this.db.query('DELETE FROM deferred_commands WHERE host_id = ?;').run(hostId);
		return res.changes;
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


	/** Recupera la coppia di chiavi VAPID salvata in SQLite. */
	getVapidKeys(): { publicKey: string; privateKey: string } | null {
		if (this.closed) return null;
		const row = this.db
			.query<{ public_key: string; private_key: string }, [string]>(
				'SELECT public_key, private_key FROM vapid_keys WHERE id = ? LIMIT 1;'
			)
			.get('default');
		if (!row) return null;
		return { publicKey: row.public_key, privateKey: row.private_key };
	}

	/** Salva o aggiorna la coppia di chiavi VAPID in SQLite. */
	saveVapidKeys(publicKey: string, privateKey: string, now: number): void {
		if (this.closed) return;
		this.db
			.query(
				'INSERT OR REPLACE INTO vapid_keys (id, public_key, private_key, created_at) VALUES (?, ?, ?, ?);'
			)
			.run('default', publicKey, privateKey, now);
	}

	/** Salva una sottoscrizione push per un dispositivo rispettando il tetto per dispositivo. */
	savePushSubscription(
		deviceId: string,
		endpoint: string,
		p256dh: string,
		auth: string,
		userAgent: string | null,
		language: string | null,
		now: number
	): string {
		const existing = this.db
			.query<{ id: string }, [string]>('SELECT id FROM push_subscriptions WHERE endpoint = ? LIMIT 1;')
			.get(endpoint);

		if (existing) {
			this.db
				.query(
					'UPDATE push_subscriptions SET device_id = ?, p256dh = ?, auth = ?, user_agent = ?, language = ?, last_used_at = ? WHERE id = ?;'
				)
				.run(deviceId, p256dh, auth, userAgent, language, now, existing.id);
			return existing.id;
		}

		// Controllo quota per dispositivo: rimuove la piu' vecchia se eccede il tetto
		const countRow = this.db
			.query<{ count: number }, [string]>(
				'SELECT COUNT(*) as count FROM push_subscriptions WHERE device_id = ?;'
			)
			.get(deviceId);
		if ((countRow?.count ?? 0) >= MAX_PUSH_SUBSCRIPTIONS_PER_DEVICE) {
			this.db
				.query(
					`DELETE FROM push_subscriptions WHERE id IN (
						SELECT id FROM push_subscriptions WHERE device_id = ? ORDER BY created_at ASC LIMIT 1
					);`
				)
				.run(deviceId);
		}

		const id = randomUUID();
		this.db
			.query(
				'INSERT INTO push_subscriptions (id, device_id, endpoint, p256dh, auth, user_agent, language, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);'
			)
			.run(id, deviceId, endpoint, p256dh, auth, userAgent, language, now, now);
		return id;
	}

	/** Elimina una specifica sottoscrizione push tramite l'endpoint. */
	deletePushSubscription(endpoint: string): boolean {
		if (this.closed) return false;
		const res = this.db.query('DELETE FROM push_subscriptions WHERE endpoint = ?;').run(endpoint);
		return res.changes > 0;
	}

	/** Elimina le sottoscrizioni push di un dispositivo (opzionalmente filtrando per endpoint). */
	deletePushSubscriptionsForDevice(deviceId: string, endpoint?: string): number {
		if (this.closed) return 0;
		if (endpoint) {
			const res = this.db
				.query('DELETE FROM push_subscriptions WHERE device_id = ? AND endpoint = ?;')
				.run(deviceId, endpoint);
			return res.changes;
		}
		const res = this.db.query('DELETE FROM push_subscriptions WHERE device_id = ?;').run(deviceId);
		return res.changes;
	}

	/** Elenca tutte le sottoscrizioni push attive per un dato dispositivo. */
	getPushSubscriptionsForDevice(deviceId: string): PushSubscriptionRecord[] {
		if (this.closed) return [];
		return this.db
			.query<
				PushSubscriptionRecord,
				[string]
			>(
				'SELECT id, device_id as deviceId, endpoint, p256dh, auth, user_agent as userAgent, language, created_at as createdAt, last_used_at as lastUsedAt FROM push_subscriptions WHERE device_id = ?;'
			)
			.all(deviceId);
	}

	/** Elenca tutte le sottoscrizioni push di tutti i dispositivi non revocati. */
	getAllPushSubscriptions(): PushSubscriptionRecord[] {
		if (this.closed) return [];
		return this.db
			.query<PushSubscriptionRecord, []>(
				`SELECT p.id, p.device_id as deviceId, p.endpoint, p.p256dh, p.auth, p.user_agent as userAgent, p.language, p.created_at as createdAt, p.last_used_at as lastUsedAt
				 FROM push_subscriptions p
				 INNER JOIN devices d ON d.id = p.device_id
				 WHERE d.revoked = 0;`
			)
			.all();
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
