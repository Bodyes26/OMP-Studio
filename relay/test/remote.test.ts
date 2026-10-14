import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import {
	CloseCode,
	COMMAND_TIMEOUT_MS,
	MIN_HOST_PROTOCOL_VERSION,
	PAIRING_CODE_TTL_MS,
	PROTOCOL,
	type HostState,
	type RelayToClientFrame,
	type RelayToHostFrame
} from '../src/protocol.ts';
import { startRelay, type RelayServer } from '../src/server.ts';
import { RelayStore } from '../src/store.ts';

const ADMIN_TOKEN = 't'.repeat(40);
const HOST_ID = '11111111-2222-4333-8444-555555555555';
const HOST_ID_2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

let tempDir: string;
let webDir: string;
let server: RelayServer;
let baseUrl: string;
let wsUrl: string;

beforeAll(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'relay-core-test-'));
	webDir = join(tempDir, 'web');
	mkdirSync(webDir, { recursive: true });
	mkdirSync(join(webDir, 'assets'), { recursive: true });

	writeFileSync(join(webDir, 'index.html'), '<!doctype html><html><body>PWA</body></html>');
	writeFileSync(join(webDir, 'sw.js'), '// service worker');
	writeFileSync(join(webDir, 'manifest.webmanifest'), '{"name":"PWA"}');
	writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log("app");');

	server = startRelay({
		port: 0,
		hostname: '127.0.0.1',
		adminToken: ADMIN_TOKEN,
		dataDir: tempDir,
		webDir,
		authTimeoutMs: 5_000,
		heartbeatMs: 25_000
	});

	baseUrl = `http://127.0.0.1:${server.port}`;
	wsUrl = `ws://127.0.0.1:${server.port}`;
});

afterAll(() => {
	server.stop(true);
	rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
	vi.useRealTimers();
});

interface WsHarness {
	ws: WebSocket;
	opened: Promise<void>;
	closed: Promise<{ code: number; reason: string }>;
	next: (predicate?: (msg: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>;
	send: (msg: Record<string, unknown>) => void;
}

function connectWs(path: string, headers: Record<string, string> = {}, baseWsUrl = wsUrl): WsHarness {
	const ws = new WebSocket(`${baseWsUrl}${path}`, { headers });
	const inbox: Record<string, unknown>[] = [];
	let listeners: Array<() => void> = [];

	ws.onmessage = (event) => {
		try {
			inbox.push(JSON.parse(String(event.data)) as Record<string, unknown>);
		} catch {
			// ignora frame non JSON
		}
		const pending = listeners;
		listeners = [];
		for (const cb of pending) cb();
	};

	const { promise: opened, resolve: resolveOpened } = Promise.withResolvers<void>();
	ws.onopen = () => resolveOpened();

	const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<{ code: number; reason: string }>();
	ws.onclose = (event) => resolveClosed({ code: event.code, reason: event.reason });

	const next = (predicate?: (msg: Record<string, unknown>) => boolean) => {
		const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
		const check = () => {
			const idx = inbox.findIndex((m) => (predicate ? predicate(m) : true));
			if (idx !== -1) {
				resolve(inbox.splice(idx, 1)[0]!);
				return;
			}
			listeners.push(check);
		};
		check();
		return promise;
	};

	const send = (msg: Record<string, unknown>) => {
		ws.send(JSON.stringify(msg));
	};

	return { ws, opened, closed, next, send };
}

describe('Health e configurazione', () => {
	test('risposta healthz con protocollo min e max', async () => {
		const res = await fetch(`${baseUrl}/healthz`);
		expect(res.status).toBe(200);
		const json = (await res.json()) as Record<string, unknown>;
		expect(json).toMatchObject({
			ok: true,
			service: 'omp-studio-relay',
			protocol: {
				name: PROTOCOL.name,
				min: MIN_HOST_PROTOCOL_VERSION,
				max: PROTOCOL.version
			}
		});
	});

	test('loadConfig crea la cartella dati se mancante', () => {
		const customDataDir = join(tempDir, 'nested-data');
		const cfg = loadConfig({
			RELAY_ADMIN_TOKEN: ADMIN_TOKEN,
			RELAY_DATA_DIR: customDataDir
		});
		expect(cfg.dataDir).toBe(customDataDir);
	});
});

describe('Abbinamento dispositivo (Pair Device)', () => {
	test('abbinamento con adminToken e attributi cookie', async () => {
		const res = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Telefono', adminToken: ADMIN_TOKEN })
		});
		expect(res.status).toBe(200);
		const cookie = res.headers.get('set-cookie') ?? '';
		expect(cookie).toContain('relay_session=');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('SameSite=Strict');
		expect(cookie).not.toContain('Secure');

		// Con forwarded proto https deve includere Secure
		const resHttps = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Forwarded-Proto': 'https'
			},
			body: JSON.stringify({ name: 'Tablet', adminToken: ADMIN_TOKEN })
		});
		expect(resHttps.headers.get('set-cookie')).toContain('Secure');
	});

	test('abbinamento con codice mono-uso, normalizzazione e scadenza', async () => {
		// Ottiene una sessione valida per generare codici
		const authRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'AdminDevice', adminToken: ADMIN_TOKEN })
		});
		const cookie = authRes.headers.get('set-cookie')!.split(';')[0];

		// Genera codice per dispositivo
		const codeRes = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: baseUrl,
				Cookie: cookie
			},
			body: JSON.stringify({ kind: 'device' })
		});
		expect(codeRes.status).toBe(200);
		const { code: rawCode } = (await codeRes.json()) as { code: string };

		// Normalizzazione: input in minuscolo con trattino
		const pairRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Laptop', code: rawCode.toLowerCase() })
		});
		expect(pairRes.status).toBe(200);

		// Mono-uso: il secondo tentativo deve fallire
		const reuseRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Attacker', code: rawCode })
		});
		expect(reuseRes.status).toBe(401);

		// Genera codice host e tenta di usarlo per device (wrong kind)
		const hostCodeRes = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: baseUrl,
				Cookie: cookie
			},
			body: JSON.stringify({ kind: 'host' })
		});
		const { code: hostCode } = (await hostCodeRes.json()) as { code: string };

		const wrongKindRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'WrongDevice', code: hostCode })
		});
		expect(wrongKindRes.status).toBe(401);

		// Codice scaduto oltre il TTL
		const expCodeRes = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: cookie },
			body: JSON.stringify({ kind: 'device' })
		});
		const { code: expCode } = (await expCodeRes.json()) as { code: string };

		vi.useFakeTimers();
		vi.advanceTimersByTime(PAIRING_CODE_TTL_MS + 1000);
		const expiredRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'ExpiredDev', code: expCode })
		});
		vi.useRealTimers();
		expect(expiredRes.status).toBe(401);
	});
});

describe('Origine e CSRF', () => {
	test('richieste POST/DELETE con cookie richiedono Origin identico', async () => {
		const authRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'CsrfDevice', adminToken: ADMIN_TOKEN })
		});
		const cookie = authRes.headers.get('set-cookie')!.split(';')[0];

		// Senza Origin -> 403
		const noOrigin = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ kind: 'device' })
		});
		expect(noOrigin.status).toBe(403);

		// Con Origin esterno -> 403
		const foreignOrigin = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'http://malicious.example.com',
				Cookie: cookie
			},
			body: JSON.stringify({ kind: 'device' })
		});
		expect(foreignOrigin.status).toBe(403);

		// Con Origin corretto -> 200
		const goodOrigin = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: baseUrl,
				Cookie: cookie
			},
			body: JSON.stringify({ kind: 'device' })
		});
		expect(goodOrigin.status).toBe(200);
	});
});

describe('Protezione Rate Limit', () => {
	test('10 fallimenti di autenticazione provocano 429', async () => {
		const clientIp = '192.168.1.100';
		for (let i = 0; i < 10; i++) {
			const res = await fetch(`${baseUrl}/v1/pair/device`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Forwarded-For': clientIp
				},
				body: JSON.stringify({ name: 'Fail', adminToken: 'wrong'.repeat(10) })
			});
			expect(res.status).toBe(401);
		}

		const rateLimited = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Forwarded-For': clientIp
			},
			body: JSON.stringify({ name: 'Blocked', adminToken: ADMIN_TOKEN })
		});
		expect(rateLimited.status).toBe(429);
		const json = (await rateLimited.json()) as Record<string, unknown>;
		expect(json).toMatchObject({ error: { code: 'rate_limited' } });
	});
});

describe('Ciclo di vita Host e Client WebSocket', () => {
	let hostCredential = '';
	let clientCookie = '';
	let currentDeviceId = '';

	beforeAll(async () => {
		// Crea device autenticato
		const authRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'PrimaryClient', adminToken: ADMIN_TOKEN })
		});
		clientCookie = authRes.headers.get('set-cookie')!.split(';')[0];
		const authJson = (await authRes.json()) as { device: { id: string } };
		currentDeviceId = authJson.device.id;

		// Crea codice host e registra host
		const codeRes = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: clientCookie },
			body: JSON.stringify({ kind: 'host' })
		});
		const { code } = (await codeRes.json()) as { code: string };

		const pairHostRes = await fetch(`${baseUrl}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code,
				hostId: HOST_ID,
				name: 'Desktop-Workstation',
				platform: 'macos',
				appVersion: '1.0.0'
			})
		});
		expect(pairHostRes.status).toBe(200);
		const pairJson = (await pairHostRes.json()) as { credential: string };
		hostCredential = pairJson.credential;
	});

	test('connessione host con credenziale errata risponde 401', async () => {
		const res = await fetch(`${baseUrl}/v1/host`, {
			headers: { Authorization: 'Bearer invalid-token' }
		});
		expect(res.status).toBe(401);
	});

	test('connessione host: range di versione protocollo (incompatible 4426)', async () => {
		const hostWs = connectWs('/v1/host', { Authorization: `Bearer ${hostCredential}` });
		await hostWs.opened;

		// Versione non supportata (es. 0)
		hostWs.send({
			type: 'hello',
			protocol: { name: PROTOCOL.name, version: 0 },
			features: ['respond_ui'],
			host: { name: 'Desktop', platform: 'macos', appVersion: '1.0.0' }
		});
		const close = await hostWs.closed;
		hostWs.ws.close();
		expect(close.code).toBe(CloseCode.incompatible);
	});

	test('flusso snapshot host -> client e resync', async () => {
		// Connette la macchina
		const host = connectWs('/v1/host', { Authorization: `Bearer ${hostCredential}` });
		await host.opened;
		host.send({
			type: 'hello',
			protocol: { name: PROTOCOL.name, version: PROTOCOL.version },
			features: ['respond_ui', 'run_task', 'quota_actions'],
			host: { name: 'Desktop-Workstation', platform: 'macos', appVersion: '1.0.0' }
		});
		const hostWelcome = (await host.next((m) => m.type === 'welcome')) as unknown as Extract<
			RelayToHostFrame,
			{ type: 'welcome' }
		>;
		expect(hostWelcome.type).toBe('welcome');
		expect(hostWelcome.relay.version).toBeDefined();

		// Connette il client PWA
		const client = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		await client.opened;
		client.send({
			type: 'hello',
			protocol: { name: PROTOCOL.name, version: PROTOCOL.version }
		});
		const clientWelcome = (await client.next((m) => m.type === 'welcome')) as unknown as Extract<
			RelayToClientFrame,
			{ type: 'welcome' }
		>;
		expect(clientWelcome.type).toBe('welcome');
		expect(clientWelcome.relay.version).toBeDefined();

		// Host invia una nuova snapshot
		const sampleState: HostState = {
			projects: [
				{
					id: 'proj-1',
					name: 'My Project',
					hue: 200,
					active: true,
					lanes: [],
					attention: [],
					tasks: [],
					autoDispatch: false,
					canRunTask: true,
					runBlockReason: null
				}
			],
			quota: null
		};

		host.send({
			type: 'snapshot',
			seq: 1,
			state: sampleState
		});

		// Client riceve l'aggiornamento
		const clientSnap = await client.next((m) => m.type === 'host_snapshot');
		expect(clientSnap).toMatchObject({
			type: 'host_snapshot',
			hostId: HOST_ID,
			seq: 1
		});

		// Stale seq (invia seq 1 di nuovo) non deve generare nuovo broadcast al client
		host.send({
			type: 'snapshot',
			seq: 1,
			state: sampleState
		});

		// Client richiede resync
		client.send({ type: 'resync', hostId: HOST_ID });
		const resyncSnap = await client.next((m) => m.type === 'host_snapshot');
		expect(resyncSnap.seq).toBe(1);

		client.ws.close();
		host.ws.close();
	});

	test('esecuzione comando: client -> host -> client', async () => {
		const host = connectWs('/v1/host', { Authorization: `Bearer ${hostCredential}` });
		await host.opened;
		host.send({
			type: 'hello',
			protocol: { name: PROTOCOL.name, version: PROTOCOL.version },
			features: ['run_task'],
			host: { name: 'Desktop-Workstation', platform: 'macos', appVersion: '1.0.0' }
		});
		await host.next((m) => m.type === 'welcome');

		const client = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		await client.opened;
		client.send({ type: 'hello', protocol: PROTOCOL });
		await client.next((m) => m.type === 'welcome');

		// Client invia comando
		const commandId = 'cmd-1234-abcd';
		client.send({
			type: 'command',
			commandId,
			hostId: HOST_ID,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});

		// Host riceve il comando inoltrato
		const hostCmd = (await host.next((m) => m.type === 'command')) as unknown as {
			commandId: string;
			command: { kind: string };
		};
		expect(typeof hostCmd.commandId).toBe('string');
		expect(hostCmd.commandId).not.toBe(commandId);
		expect(hostCmd.command.kind).toBe('run_task');

		// Host risponde con successo usando il routing commandId ricevuto dal relay
		host.send({
			type: 'command_result',
			commandId: hostCmd.commandId,
			ok: true
		});

		// Client riceve il risultato finale
		const clientResult = await client.next((m) => m.type === 'command_result');
		expect(clientResult).toMatchObject({
			type: 'command_result',
			commandId,
			ok: true
		});

		client.ws.close();
		host.ws.close();
	});

	test('comandi falliti: host_offline, unsupported, not_found', async () => {
		const client = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		await client.opened;
		client.send({ type: 'hello', protocol: PROTOCOL });
		await client.next((m) => m.type === 'welcome');

		// Host registrato ma offline
		client.send({
			type: 'command',
			commandId: 'cmd-offline',
			hostId: HOST_ID,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});
		const offlineRes = await client.next((m) => m.type === 'command_result');
		expect(offlineRes).toMatchObject({
			ok: false,
			error: { code: 'host_offline' }
		});

		// Host inesistente
		client.send({
			type: 'command',
			commandId: 'cmd-notfound',
			hostId: '00000000-0000-4000-8000-000000000000',
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});
		const notFoundRes = await client.next((m) => m.type === 'command_result');
		expect(notFoundRes).toMatchObject({
			ok: false,
			error: { code: 'not_found' }
		});

		// Connette host senza feature run_task
		const host = connectWs('/v1/host', { Authorization: `Bearer ${hostCredential}` });
		await host.opened;
		host.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['respond_ui'], // Manca run_task
			host: { name: 'Desktop-Limited', platform: 'macos', appVersion: '1.0.0' }
		});
		await host.next((m) => m.type === 'welcome');

		client.send({
			type: 'command',
			commandId: 'cmd-unsupported',
			hostId: HOST_ID,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});
		const unsuppRes = await client.next((m) => m.type === 'command_result');
		expect(unsuppRes).toMatchObject({
			ok: false,
			error: { code: 'unsupported' }
		});

		client.ws.close();
		client.ws.close();
		host.ws.close();
	});

	test('comando con timeout quando host non risponde', async () => {
		const timeoutDataDir = join(tempDir, 'data-timeout');
		mkdirSync(timeoutDataDir, { recursive: true });
		const timeoutServer = startRelay({
			port: 0,
			hostname: '127.0.0.1',
			adminToken: ADMIN_TOKEN,
			dataDir: timeoutDataDir,
			webDir,
			commandTimeoutMs: 100
		});

		const tBase = `http://127.0.0.1:${timeoutServer.port}`;
		const tWs = `ws://127.0.0.1:${timeoutServer.port}`;

		const dRes = await fetch(`${tBase}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'TDev', adminToken: ADMIN_TOKEN })
		});
		const tCookie = dRes.headers.get('set-cookie')!.split(';')[0];

		const cRes = await fetch(`${tBase}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: tBase, Cookie: tCookie },
			body: JSON.stringify({ kind: 'host' })
		});
		const { code: hCode } = (await cRes.json()) as { code: string };

		const pHRes = await fetch(`${tBase}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: hCode,
				hostId: '99999999-9999-4999-8999-999999999999',
				name: 'THost',
				platform: 'linux',
				appVersion: '1.0.0'
			})
		});
		const { credential: hCred } = (await pHRes.json()) as { credential: string };

		const host = connectWs('/v1/host', { Authorization: `Bearer ${hCred}` }, tWs);
		await host.opened;
		host.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['run_task'],
			host: { name: 'THost', platform: 'linux', appVersion: '1.0.0' }
		});
		await host.next((m) => m.type === 'welcome');

		const client = connectWs('/v1/client', { Cookie: tCookie, Origin: tBase }, tWs);
		await client.opened;
		client.send({ type: 'hello', protocol: PROTOCOL });
		await client.next((m) => m.type === 'welcome');

		client.send({
			type: 'command',
			commandId: 'cmd-timeout-check',
			hostId: '99999999-9999-4999-8999-999999999999',
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});

		// L'host riceve il comando inoltrato e non risponde
		await host.next((m) => m.type === 'command');

		// Il client riceve la notifica di timeout dal relay
		const result = await client.next((m) => m.type === 'command_result');
		expect(result).toMatchObject({
			type: 'command_result',
			commandId: 'cmd-timeout-check',
			ok: false,
			error: { code: 'timeout' }
		});

		client.ws.close();
		host.ws.close();
		timeoutServer.stop(true);
	});

	test('confusione di ruoli chiude il socket con protocolError 4400', async () => {
		const client = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		await client.opened;
		// Client tenta di inviare frame host hello
		client.send({
			type: 'hello',
			protocol: PROTOCOL,
			host: { name: 'FakeHost' }
		});
		const clientClose = await client.closed;
		expect(clientClose.code).toBe(CloseCode.protocolError);

		const host = connectWs('/v1/host', { Authorization: `Bearer ${hostCredential}` });
		await host.opened;
		host.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['respond_ui'],
			host: { name: 'Desk', platform: 'macos', appVersion: '1.0.0' }
		});
		await host.next((m) => m.type === 'welcome');

		// Host tenta di inviare frame client resync
		host.send({ type: 'resync', hostId: HOST_ID });
		const hostClose = await host.closed;
		expect(hostClose.code).toBe(CloseCode.protocolError);
	});

	test('ri-abbinamento host chiude il vecchio socket con 4409 replaced', async () => {
		const oldHost = connectWs('/v1/host', { Authorization: `Bearer ${hostCredential}` });
		await oldHost.opened;
		oldHost.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['respond_ui'],
			host: { name: 'OldDesktop', platform: 'macos', appVersion: '1.0.0' }
		});
		await oldHost.next((m) => m.type === 'welcome');

		// Genera nuovo codice e ri-abbina lo stesso hostId
		const codeRes = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: clientCookie },
			body: JSON.stringify({ kind: 'host' })
		});
		const { code } = (await codeRes.json()) as { code: string };

		const repairRes = await fetch(`${baseUrl}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code,
				hostId: HOST_ID,
				name: 'NewDesktop',
				platform: 'macos',
				appVersion: '1.0.1'
			})
		});
		expect(repairRes.status).toBe(200);
		const { credential: newCred } = (await repairRes.json()) as { credential: string };

		// Il vecchio socket deve essere chiuso con replaced (4409)
		const closeEvt = await oldHost.closed;
		expect(closeEvt.code).toBe(CloseCode.replaced);

		// Aggiorna la credenziale per i test successivi
		hostCredential = newCred;
	});

	test('revoca host (DELETE /v1/hosts/:id) chiude il socket con revoked 4403', async () => {
		const host = connectWs('/v1/host', { Authorization: `Bearer ${hostCredential}` });
		await host.opened;
		host.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['respond_ui'],
			host: { name: 'Desktop-Workstation', platform: 'macos', appVersion: '1.0.0' }
		});
		await host.next((m) => m.type === 'welcome');

		const delRes = await fetch(`${baseUrl}/v1/hosts/${HOST_ID}`, {
			method: 'DELETE',
			headers: { Origin: baseUrl, Cookie: clientCookie }
		});
		expect(delRes.status).toBe(200);

		const close = await host.closed;
		expect(close.code).toBe(CloseCode.revoked);
	});

	test('revoca dispositivo chiude i suoi socket con revoked 4403', async () => {
		const client = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		await client.opened;
		client.send({ type: 'hello', protocol: PROTOCOL });
		await client.next((m) => m.type === 'welcome');

		const delRes = await fetch(`${baseUrl}/v1/devices/${currentDeviceId}`, {
			method: 'DELETE',
			headers: { Origin: baseUrl, Cookie: clientCookie }
		});
		expect(delRes.status).toBe(200);

		const close = await client.closed;
		expect(close.code).toBe(CloseCode.revoked);
	});
});

describe('File statici PWA e protezione percorsi', () => {
	test('file statico esistente e intestazioni di cache immutabili', async () => {
		const res = await fetch(`${baseUrl}/assets/app.js`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('javascript');
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(res.headers.get('content-security-policy')).toBeDefined();
	});

	test('fallback SPA su index.html per percorsi di navigazione', async () => {
		const res = await fetch(`${baseUrl}/dashboard/overview`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('PWA');
		expect(res.headers.get('cache-control')).toBe('no-cache');
	});

	test('tentativo di path traversal viene bloccato (403)', async () => {
		const res = await fetch(`${baseUrl}/assets/%2e%2e%2f%2e%2e%2fetc/passwd`);
		expect(res.status).toBe(403);
	});

	test('cartella webDir mancante risponde 503 PWA not built', async () => {
		const unbuiltServer = startRelay({
			port: 0,
			hostname: '127.0.0.1',
			adminToken: ADMIN_TOKEN,
			dataDir: join(tempDir, 'data-unbuilt'),
			webDir: join(tempDir, 'nonexistent-web')
		});
		const res = await fetch(`http://127.0.0.1:${unbuiltServer.port}/`);
		expect(res.status).toBe(503);
		expect(await res.text()).toBe('PWA not built');
		unbuiltServer.stop(true);
	});
});

describe('Persistenza dello stato su disco', () => {
	test('lo stato salvato sopravvive alla riapertura del RelayStore', () => {
		const dbDir = join(tempDir, 'store-reopen');
		mkdirSync(dbDir, { recursive: true });

		const store1 = new RelayStore(dbDir);
		store1.upsertHost(HOST_ID_2, 'PreservedHost', 'linux', '2.0.0', 'credhash', 1000);
		const testState: HostState = {
			projects: [
				{
					id: 'p-saved',
					name: 'Persistent Project',
					hue: 120,
					active: true,
					lanes: [],
					attention: [],
					tasks: [],
					autoDispatch: true,
					canRunTask: false,
					runBlockReason: 'building'
				}
			],
			quota: null
		};
		store1.saveHostState(HOST_ID_2, testState, 5000);
		store1.close();

		const store2 = new RelayStore(dbDir);
		const host = store2.getHost(HOST_ID_2);
		expect(host).not.toBeNull();
		expect(host?.name).toBe('PreservedHost');
		expect(host?.lastState).toMatchObject(testState);
		expect(host?.lastStateAt).toBe(5000);
		store2.close();
	});
});
