import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CloseCode,
	PROTOCOL,
	type CreateCodeResponse,
	type PairDeviceResponse,
	type PairHostResponse
} from '../src/protocol.ts';
import { startRelay, type RelayServer } from '../src/server.ts';
import {
	MAX_CLIENT_SOCKETS_PER_DEVICE,
	MAX_PENDING_COMMANDS_PER_DEVICE
} from '../src/sockets.ts';
import { MAX_ACTIVE_CODES_PER_DEVICE, RelayStore } from '../src/store.ts';

const ADMIN_TOKEN = 'h'.repeat(40);
const HOST_1_ID = '12345678-1234-4234-8234-123456789abc';
const HOST_2_ID = '87654321-4321-4321-8321-cba987654321';

let tempDir: string;
let webDir: string;
let server: RelayServer;
let baseUrl: string;
let wsUrl: string;

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
			// Ignora frame non conformi a JSON
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

beforeAll(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'relay-hardening-test-'));
	webDir = join(tempDir, 'web');
	mkdirSync(webDir, { recursive: true });
	writeFileSync(join(webDir, 'index.html'), '<!doctype html><html><body>PWA</body></html>');

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

describe('Verifica sei finding di sicurezza (Gate R44 hardening)', () => {
	test('1. pre-hello socket closed on re-pair and on revoke and cannot hello with a stale credential', async () => {
		// Crea prima un dispositivo amministratore per poter emettere i codici di abbinamento
		const pairDevRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'AdminDevice1', adminToken: ADMIN_TOKEN })
		});
		expect(pairDevRes.status).toBe(200);
		const cookie = pairDevRes.headers.get('set-cookie')!.split(';')[0]!;

		// Emette codice di abbinamento per l'host
		const codeRes1 = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'host' })
		});
		expect(codeRes1.status).toBe(200);
		const code1Data = (await codeRes1.json()) as CreateCodeResponse;
		const code1 = code1Data.code;

		// Abbina l'host H1 ottenendo la credenziale A
		const pairHostRes1 = await fetch(`${baseUrl}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: code1,
				hostId: HOST_1_ID,
				name: 'HostAlpha',
				platform: 'linux',
				appVersion: '1.0.0'
			})
		});
		expect(pairHostRes1.status).toBe(200);
		const pairHost1Data = (await pairHostRes1.json()) as PairHostResponse;
		const credA = pairHost1Data.credential;

		// Connette un socket pre-hello con la credenziale A (non invia hello)
		const preHelloSocketA = connectWs('/v1/host', { Authorization: `Bearer ${credA}` });
		await preHelloSocketA.opened;

		// Emette un secondo codice e ri-abbina lo stesso host (rotazione credenziale)
		const codeRes2 = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'host' })
		});
		const code2Data = (await codeRes2.json()) as CreateCodeResponse;
		const code2 = code2Data.code;

		const pairHostRes2 = await fetch(`${baseUrl}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: code2,
				hostId: HOST_1_ID,
				name: 'HostAlpha',
				platform: 'linux',
				appVersion: '1.0.1'
			})
		});
		expect(pairHostRes2.status).toBe(200);
		const pairHost2Data = (await pairHostRes2.json()) as PairHostResponse;
		const credB = pairHost2Data.credential;

		// Il socket pre-hello della credenziale precedente deve chiudersi con CloseCode.replaced
		const closeA = await preHelloSocketA.closed;
		expect(closeA.code).toBe(CloseCode.replaced);

		// Connette un nuovo socket pre-hello con la credenziale B valida (non invia hello)
		const preHelloSocketB = connectWs('/v1/host', { Authorization: `Bearer ${credB}` });
		await preHelloSocketB.opened;

		// Revoca l'host cancellandolo
		const deleteHostRes = await fetch(`${baseUrl}/v1/hosts/${HOST_1_ID}`, {
			method: 'DELETE',
			headers: { Cookie: cookie, Origin: baseUrl }
		});
		expect(deleteHostRes.status).toBe(200);

		// Il socket pre-hello deve chiudersi con CloseCode.revoked
		const closeB = await preHelloSocketB.closed;
		expect(closeB.code).toBe(CloseCode.revoked);

		// Verifica che un socket aperto con credenziale obsoleta non possa superare hello
		// Registra un nuovo host con credenziale C
		const codeRes3 = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'host' })
		});
		const code3Data = (await codeRes3.json()) as CreateCodeResponse;
		const code3 = code3Data.code;

		const pairHostRes3 = await fetch(`${baseUrl}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: code3,
				hostId: HOST_2_ID,
				name: 'HostBeta',
				platform: 'linux',
				appVersion: '1.0.0'
			})
		});
		expect(pairHostRes3.status).toBe(200);
		const pairHost3Data = (await pairHostRes3.json()) as PairHostResponse;
		const credC = pairHost3Data.credential;

		// Apre socket C pre-hello
		const socketC = connectWs('/v1/host', { Authorization: `Bearer ${credC}` });
		await socketC.opened;

		// Ri-abbina l'host con nuova credenziale prima che socket C mandi hello
		const codeRes4 = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'host' })
		});
		const code4Data = (await codeRes4.json()) as CreateCodeResponse;
		const code4 = code4Data.code;

		await fetch(`${baseUrl}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: code4,
				hostId: HOST_2_ID,
				name: 'HostBeta',
				platform: 'linux',
				appVersion: '1.0.1'
			})
		});
		const closeC = await socketC.closed;
		expect(closeC.code).toBe(CloseCode.replaced);
	});

	test('2. code from a revoked issuer rejected and revoke invalidates codes', async () => {
		// Dispositivo emittente abbinato con adminToken
		const devRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'IssuerDevice', adminToken: ADMIN_TOKEN })
		});
		expect(devRes.status).toBe(200);
		const devCookie = devRes.headers.get('set-cookie')!.split(';')[0]!;
		const devData = (await devRes.json()) as PairDeviceResponse;
		const devId = devData.device.id;

		// Il dispositivo emette un codice per un altro dispositivo
		const codeRes = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: devCookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'device' })
		});
		expect(codeRes.status).toBe(200);
		const codeData = (await codeRes.json()) as CreateCodeResponse;
		const issuedCode = codeData.code;

		// Revoca il dispositivo emittente prima che il codice sia consumato
		const revokeRes = await fetch(`${baseUrl}/v1/devices/${devId}`, {
			method: 'DELETE',
			headers: { Cookie: devCookie, Origin: baseUrl }
		});
		expect(revokeRes.status).toBe(200);

		// Tentativo di abbinare un nuovo dispositivo con il codice dell'emittente revocato
		const pairWithRevokedCodeRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'RecipientDevice', code: issuedCode })
		});
		// Deve essere rifiutato con 401 perche' l'emittente e' revocato e i suoi codici sono invalidati
		expect(pairWithRevokedCodeRes.status).toBe(401);

		// Inoltre una richiesta di emissione codice con sessione revocata fallisce con 401
		const mintAfterRevokeRes = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: devCookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'device' })
		});
		expect(mintAfterRevokeRes.status).toBe(401);
	});

	test('3. concurrent bad pairing requests beyond the limit get 429 (start N fetches before any resolves)', async () => {
		// IP dedicato per isolare il contatore client del rate limiter
		const clientIp = '198.51.100.77';

		// Avvia 15 richieste di abbinamento errate simultanee prima che qualunque di esse si risolva
		const requests = Array.from({ length: 15 }, () =>
			fetch(`${baseUrl}/v1/pair/device`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Forwarded-For': clientIp
				},
				body: JSON.stringify({ name: 'BadDevice', adminToken: 'wrong-token-value' })
			})
		);

		const responses = await Promise.all(requests);
		const statuses = responses.map((r) => r.status);

		// Le prime 10 richieste ricevono 401 (MAX_CLIENT_FAILURES), le restanti 5 ricevono 429
		const count401 = statuses.filter((s) => s === 401).length;
		const count429 = statuses.filter((s) => s === 429).length;

		expect(count401).toBe(10);
		expect(count429).toBe(5);
	});

	test('4. a valid host and a valid client can still connect after 100+ anonymous failures from many keys while pairing is limited', async () => {
		const test4Dir = join(tempDir, 'test4-isolation');
		mkdirSync(test4Dir, { recursive: true });
		const s4 = startRelay({
			port: 0,
			hostname: '127.0.0.1',
			adminToken: ADMIN_TOKEN,
			dataDir: test4Dir,
			webDir,
			authTimeoutMs: 5_000,
			heartbeatMs: 25_000
		});
		const b4 = `http://127.0.0.1:${s4.port}`;
		const w4 = `ws://127.0.0.1:${s4.port}`;

		// Registra prima un dispositivo valido e un host valido con credenziali funzionanti
		const devRes = await fetch(`${b4}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'LegitClient', adminToken: ADMIN_TOKEN })
		});
		expect(devRes.status).toBe(200);
		const legitClientCookie = devRes.headers.get('set-cookie')!.split(';')[0]!;

		const codeRes = await fetch(`${b4}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: legitClientCookie, Origin: b4 },
			body: JSON.stringify({ kind: 'host' })
		});
		const codeData = (await codeRes.json()) as CreateCodeResponse;
		const legitCode = codeData.code;

		const validHostId = randomUUID();
		const pairHostRes = await fetch(`${b4}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: legitCode,
				hostId: validHostId,
				name: 'LegitHost',
				platform: 'linux',
				appVersion: '1.0.0'
			})
		});
		expect(pairHostRes.status).toBe(200);
		const pairHostData = (await pairHostRes.json()) as PairHostResponse;
		const legitHostCred = pairHostData.credential;

		// Genera oltre 100 fallimenti di abbinamento anonimi da chiavi client diverse per saturare il tetto globale
		for (let i = 0; i < 105; i++) {
			await fetch(`${b4}/v1/pair/device`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Forwarded-For': `10.200.${Math.floor(i / 250)}.${(i % 250) + 1}`
				},
				body: JSON.stringify({ name: 'AttackerAttempt', adminToken: 'wrong' })
			});
		}

		// Verifica che l'endpoint di abbinamento sia ora bloccato globalmente (429) anche per nuovi IP
		const blockedPair = await fetch(`${b4}/v1/pair/device`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Forwarded-For': '192.0.2.123'
			},
			body: JSON.stringify({ name: 'NewPairing', adminToken: ADMIN_TOKEN })
		});
		expect(blockedPair.status).toBe(429);

		// Nonostante il blocco globale degli abbinamenti, la macchina legittima con credenziale valida si connette senza problemi
		const hostWs = connectWs('/v1/host', { Authorization: `Bearer ${legitHostCred}` }, w4);
		await hostWs.opened;
		hostWs.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['run_task'],
			host: { name: 'LegitHost', platform: 'linux', appVersion: '1.0.0' }
		});
		const hostWelcome = await hostWs.next((m) => m.type === 'welcome');
		expect(hostWelcome.type).toBe('welcome');

		// Anche il client legittimo con cookie di sessione valido si connette regolarmente
		const clientWs = connectWs('/v1/client', { Cookie: legitClientCookie, Origin: b4 }, w4);
		await clientWs.opened;
		clientWs.send({ type: 'hello', protocol: PROTOCOL });
		const clientWelcome = await clientWs.next((m) => m.type === 'welcome');
		expect(clientWelcome.type).toBe('welcome');

		hostWs.ws.close();
		clientWs.ws.close();
		s4.stop(true);
	});

	test('5. command result from a different host is ignored and the right client gets its own commandId', async () => {
		// Registra un client e due host distinti
		const devRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'CmdClient', adminToken: ADMIN_TOKEN })
		});
		const clientCookie = devRes.headers.get('set-cookie')!.split(';')[0]!;

		// Registra host primario
		const codeRes1 = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: clientCookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'host' })
		});
		const code1Data = (await codeRes1.json()) as CreateCodeResponse;
		const h1Code = code1Data.code;
		const h1Id = randomUUID();
		const pHost1 = await fetch(`${baseUrl}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: h1Code, hostId: h1Id, name: 'H1', platform: 'linux', appVersion: '1.0.0' })
		});
		const pHost1Data = (await pHost1.json()) as PairHostResponse;
		const h1Cred = pHost1Data.credential;

		// Registra host secondario
		const codeRes2 = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: clientCookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'host' })
		});
		const code2Data = (await codeRes2.json()) as CreateCodeResponse;
		const h2Code = code2Data.code;
		const h2Id = randomUUID();
		const pHost2 = await fetch(`${baseUrl}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: h2Code, hostId: h2Id, name: 'H2', platform: 'linux', appVersion: '1.0.0' })
		});
		const pHost2Data = (await pHost2.json()) as PairHostResponse;
		const h2Cred = pHost2Data.credential;

		// Connette e autentica host 1
		const host1Ws = connectWs('/v1/host', { Authorization: `Bearer ${h1Cred}` });
		await host1Ws.opened;
		host1Ws.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['run_task'],
			host: { name: 'H1', platform: 'linux', appVersion: '1.0.0' }
		});
		await host1Ws.next((m) => m.type === 'welcome');

		// Connette e autentica host 2
		const host2Ws = connectWs('/v1/host', { Authorization: `Bearer ${h2Cred}` });
		await host2Ws.opened;
		host2Ws.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['run_task'],
			host: { name: 'H2', platform: 'linux', appVersion: '1.0.0' }
		});
		await host2Ws.next((m) => m.type === 'welcome');

		// Connette e autentica client
		const clientWs = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		await clientWs.opened;
		clientWs.send({ type: 'hello', protocol: PROTOCOL });
		await clientWs.next((m) => m.type === 'welcome');

		// Client invia comando destinato a H1 con un proprio commandId arbitrario
		const clientCmdId = 'orig-client-cmd-999';
		clientWs.send({
			type: 'command',
			commandId: clientCmdId,
			hostId: h1Id,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});

		// H1 riceve il comando: l'ID inoltrato e' il routing ID generato dal relay, non clientCmdId
		const forwardedToH1 = await host1Ws.next((m) => m.type === 'command');
		const relayRoutingId = typeof forwardedToH1.commandId === 'string' ? forwardedToH1.commandId : '';
		expect(relayRoutingId).not.toBe(clientCmdId);

		// Host 2 tenta di inviare una risposta per quel comando: il relay deve ignorarla
		host2Ws.send({
			type: 'command_result',
			commandId: relayRoutingId,
			ok: false,
			error: { code: 'failed', message: 'Spoofed result from wrong host' }
		});

		// Host 1 invia la risposta legittima
		host1Ws.send({
			type: 'command_result',
			commandId: relayRoutingId,
			ok: true
		});

		// Il client riceve la risposta con il proprio commandId originale e l'esito di H1
		const clientRes = await clientWs.next((m) => m.type === 'command_result');
		expect(clientRes).toMatchObject({
			type: 'command_result',
			hostId: h1Id,
			commandId: clientCmdId,
			ok: true
		});

		// Test rifiuto comando duplicato con lo stesso commandId mentre e' ancora pendente
		const dupCmdId = 'dup-test-cmd-444';
		clientWs.send({
			type: 'command',
			commandId: dupCmdId,
			hostId: h1Id,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});
		// Invia subito un duplicato con lo stesso ID prima della risposta di H1
		clientWs.send({
			type: 'command',
			commandId: dupCmdId,
			hostId: h1Id,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});

		const rejectedDupRes = await clientWs.next((m) => m.type === 'command_result' && m.commandId === dupCmdId);
		expect(rejectedDupRes).toMatchObject({
			type: 'command_result',
			commandId: dupCmdId,
			ok: false,
			error: { code: 'rejected' }
		});

		host1Ws.ws.close();
		host2Ws.ws.close();
		clientWs.ws.close();
	});

	test('6. caps enforced and expired/used codes removed', async () => {
		// Crea un dispositivo client dedicato per i test delle quote
		const devRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'QuotaDevice', adminToken: ADMIN_TOKEN })
		});
		const quotaCookie = devRes.headers.get('set-cookie')!.split(';')[0]!;
		const quotaDevData = (await devRes.json()) as PairDeviceResponse;
		const quotaDevId = quotaDevData.device.id;

		// 6a: Tetto socket client per singolo dispositivo (MAX_CLIENT_SOCKETS_PER_DEVICE = 5)
		const sockets: WsHarness[] = [];
		for (let i = 0; i < MAX_CLIENT_SOCKETS_PER_DEVICE; i++) {
			const s = connectWs('/v1/client', { Cookie: quotaCookie, Origin: baseUrl });
			await s.opened;
			s.send({ type: 'hello', protocol: PROTOCOL });
			await s.next((m) => m.type === 'welcome');
			sockets.push(s);
		}

		// Il 6° socket provoca la chiusura con replaced del socket piu' vecchio (il primo)
		const sixthSocket = connectWs('/v1/client', { Cookie: quotaCookie, Origin: baseUrl });
		await sixthSocket.opened;

		const oldestClose = await sockets[0]!.closed;
		expect(oldestClose.code).toBe(CloseCode.replaced);

		// Chiude i restanti socket client
		for (let i = 1; i < sockets.length; i++) {
			sockets[i]!.ws.close();
		}
		sixthSocket.ws.close();

		// 6b: Tetto codici attivi per dispositivo (MAX_ACTIVE_CODES_PER_DEVICE = 10)
		for (let i = 0; i < MAX_ACTIVE_CODES_PER_DEVICE; i++) {
			const res = await fetch(`${baseUrl}/v1/codes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: quotaCookie, Origin: baseUrl },
				body: JSON.stringify({ kind: 'device' })
			});
			expect(res.status).toBe(200);
		}

		// L'11° codice viene respinto con 429 rate_limited
		const eleventhCodeRes = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: quotaCookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'device' })
		});
		expect(eleventhCodeRes.status).toBe(429);

		// 6c: Pulizia codici scaduti o usati
		const store = new RelayStore(tempDir);
		// Inserisce un codice scaduto direttamente nello store
		store.createPairingCode('hash-expired', 'device', quotaDevId, Date.now() - 5000);
		const pruned = store.prunePairingCodes(Date.now());
		expect(pruned).toBeGreaterThanOrEqual(1);
		store.close();

		// 6d: Tetto comandi pendenti per dispositivo (MAX_PENDING_COMMANDS_PER_DEVICE = 20)
		// Registra un dispositivo ausiliario per emettere il codice dell'host
		const creatorDevRes = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'HostCreatorDevice', adminToken: ADMIN_TOKEN })
		});
		const creatorCookie = creatorDevRes.headers.get('set-cookie')!.split(';')[0]!;

		const hCodeRes = await fetch(`${baseUrl}/v1/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: creatorCookie, Origin: baseUrl },
			body: JSON.stringify({ kind: 'host' })
		});
		const hCodeData = (await hCodeRes.json()) as CreateCodeResponse;
		const hHostId = randomUUID();
		const pHRes = await fetch(`${baseUrl}/v1/pair/host`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: hCodeData.code,
				hostId: hHostId,
				name: 'QuotaHost',
				platform: 'linux',
				appVersion: '1.0.0'
			})
		});
		const pHData = (await pHRes.json()) as PairHostResponse;
		const hCred = pHData.credential;

		const qHostWs = connectWs('/v1/host', { Authorization: `Bearer ${hCred}` });
		await qHostWs.opened;
		qHostWs.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['run_task'],
			host: { name: 'QuotaHost', platform: 'linux', appVersion: '1.0.0' }
		});
		await qHostWs.next((m) => m.type === 'welcome');

		const qClientWs = connectWs('/v1/client', { Cookie: quotaCookie, Origin: baseUrl });
		await qClientWs.opened;
		qClientWs.send({ type: 'hello', protocol: PROTOCOL });
		await qClientWs.next((m) => m.type === 'welcome');

		// Invia 20 comandi senza che l'host risponda
		for (let i = 0; i < MAX_PENDING_COMMANDS_PER_DEVICE; i++) {
			qClientWs.send({
				type: 'command',
				commandId: `cmd-quota-${i}`,
				hostId: hHostId,
				command: { kind: 'run_task', projectId: 'p1', taskId: `t-${i}` }
			});
			await qHostWs.next((m) => m.type === 'command');
		}

		// Il 21° comando supera la quota per dispositivo e viene respinto con rejected
		qClientWs.send({
			type: 'command',
			commandId: 'cmd-quota-overflow',
			hostId: hHostId,
			command: { kind: 'run_task', projectId: 'p1', taskId: 'overflow' }
		});

		const overflowRes = await qClientWs.next((m) => m.type === 'command_result' && m.commandId === 'cmd-quota-overflow');
		expect(overflowRes).toMatchObject({
			type: 'command_result',
			commandId: 'cmd-quota-overflow',
			ok: false,
			error: { code: 'rejected' }
		});

		qHostWs.ws.close();
		qClientWs.ws.close();
	});
});
