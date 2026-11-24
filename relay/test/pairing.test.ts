/**
 * R-MI-55, R-MI-56, R-REM-25, R-MI-52: gli endpoint che il desktop usa per il
 * codice corto, per il «Server di collegamento» e per i telefoni.
 *
 * Il relay non deve mai vedere il codice completo: qui si verifica che il
 * deposito si ritiri una volta sola, scada, e che senza la credenziale
 * dell'host non si depositi ne' si generino codici.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRelay, type RelayServer } from '../src/server.ts';

const ADMIN_TOKEN = 'p'.repeat(40);
const HOST_ID = '44444444-5555-4666-8777-888888888888';
const IROH = 'https://iroh-relay.example.com';

let tempDir: string;
let server: RelayServer;
let baseUrl: string;
/** Credenziale di un host abbinato: la stessa forma cifrata del socket. */
let credential: string;
/** Impronta SHA-256 esadecimale di un codice corto: e' l'indice del deposito. */
const MAILBOX_ID = 'a'.repeat(64);
const PAYLOAD = 'c2FsdG5vbmNlY2lwaGVydGV4dC1jaWZydXRvLWNvbi11bi1jb2RpY2UtY29ydG8=';


/** Il corpo JSON di una risposta, verificato prima di leggerne i campi. */
async function readJson(res: Response): Promise<Record<string, unknown>> {
	const value: unknown = await res.json();
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('risposta non oggetto');
	return value as Record<string, unknown>;
}

/** Codice di abbinamento da una risposta (telefono o host). */
async function readCode(res: Response): Promise<string> {
	const body = await readJson(res);
	if (typeof body.code !== 'string') throw new Error('codice assente');
	return body.code;
}

async function pairHost(): Promise<string> {
	const cookieRes = await fetch(`${baseUrl}/v1/pair/device`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'Mac', adminToken: ADMIN_TOKEN })
	});
	expect(cookieRes.status).toBe(200);
	const cookie = cookieRes.headers.get('set-cookie')!.split(';')[0]!;
	const codeRes = await fetch(`${baseUrl}/v1/codes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: cookie },
		body: JSON.stringify({ kind: 'host' })
	});
	expect(codeRes.status).toBe(200);
	const code = await readCode(codeRes);
	const res = await fetch(`${baseUrl}/v1/pair/host`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, hostId: HOST_ID, name: 'Mac', platform: 'macos', appVersion: '1.0.0' })
	});
	expect(res.status).toBe(200);
	const paired = await readJson(res);
	if (typeof paired.credential !== 'string') throw new Error('il relay non ha restituito la credenziale');
	return paired.credential;
}

function deposit(headers: Record<string, string>, id = MAILBOX_ID, payload = PAYLOAD) {
	return fetch(`${baseUrl}/v1/host/mailbox`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify({ id, payload })
	});
}

beforeAll(async () => {
	tempDir = mkdtempSync(join(tmpdir(), 'relay-pairing-test-'));
	const webDir = join(tempDir, 'web');
	mkdirSync(webDir, { recursive: true });
	writeFileSync(join(webDir, 'index.html'), '<!doctype html><html><body>PWA</body></html>');
	server = startRelay({
		port: 0,
		hostname: '127.0.0.1',
		adminToken: ADMIN_TOKEN,
		dataDir: tempDir,
		webDir,
		authTimeoutMs: 5_000,
		heartbeatMs: 25_000,
		irohRelay: IROH
	});
	baseUrl = `http://127.0.0.1:${server.port}`;
	credential = await pairHost();
});

afterAll(() => {
	server.stop(true);
	rmSync(tempDir, { recursive: true, force: true });
});

describe('R-MI-56 — server di collegamento', () => {
	test('GET /v1/host/info richiede la credenziale dell\'host', async () => {
		const anonymous = await fetch(`${baseUrl}/v1/host/info`);
		expect(anonymous.status).toBe(401);
		const wrong = await fetch(`${baseUrl}/v1/host/info`, { headers: { Authorization: `Bearer ${'x'.repeat(64)}` } });
		expect(wrong.status).toBe(401);
	});

	test('GET /v1/host/info dichiara il relay iroh a chi si autentica', async () => {
		const res = await fetch(`${baseUrl}/v1/host/info`, { headers: { Authorization: `Bearer ${credential}` } });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ irohRelay: IROH });
	});

	test('senza RELAY_IROH_RELAY_URL il server risponde null', async () => {
		const other = startRelay({
			port: 0,
			hostname: '127.0.0.1',
			adminToken: ADMIN_TOKEN,
			dataDir: mkdtempSync(join(tmpdir(), 'relay-pairing-noiroh-')),
			webDir: join(tempDir, 'web'),
			authTimeoutMs: 5_000,
			heartbeatMs: 25_000
		});
		try {
			const base = `http://127.0.0.1:${other.port}`;
			const cookieRes = await fetch(`${base}/v1/pair/device`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'PC', adminToken: ADMIN_TOKEN })
			});
			const cookie = cookieRes.headers.get('set-cookie')!.split(';')[0]!;
			const codeRes = await fetch(`${base}/v1/codes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
				body: JSON.stringify({ kind: 'host' })
			});
			const code = await readCode(codeRes);
			const hostId = '55555555-6666-4777-8888-999999999999';
			const paired = await fetch(`${base}/v1/pair/host`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code, hostId, name: 'PC', platform: 'windows', appVersion: '1.0.0' })
			});
			const pairedBody = await readJson(paired);
			const local = String(pairedBody.credential);
			const info = await fetch(`${base}/v1/host/info`, { headers: { Authorization: `Bearer ${local}` } });
			expect(await info.json()).toEqual({ irohRelay: null });
		} finally {
			other.stop(true);
		}
	});
});

describe('R-MI-55 — deposito del codice corto', () => {
	test('il deposito richiede la credenziale dell\'host', async () => {
		expect((await deposit({})).status).toBe(401);
		expect((await deposit({ Authorization: `Bearer ${'z'.repeat(64)}` })).status).toBe(401);
	});

	test('rifiuta un indice che non e\' un\'impronta', async () => {
		const res = await deposit({ Authorization: `Bearer ${credential}` }, 'not-a-hash');
		expect(res.status).toBe(400);
	});

	test('il ritiro funziona una volta sola e non richiede autenticazione', async () => {
		const id = 'b'.repeat(64);
		const saved = await deposit({ Authorization: `Bearer ${credential}` }, id);
		expect(saved.status).toBe(200);
		const savedBody = await readJson(saved);
		const expiresAt = Number(savedBody.expiresAt);
		expect(expiresAt).toBeGreaterThan(Date.now());

		const first = await fetch(`${baseUrl}/v1/mailbox/${id}`);
		expect(first.status).toBe(200);
		// Il relay restituisce esattamente il cifrato: non lo legge e non lo cambia.
		expect(await first.json()).toEqual({ payload: PAYLOAD });

		const second = await fetch(`${baseUrl}/v1/mailbox/${id}`);
		expect(second.status).toBe(404);
	});

	test('un deposito scaduto non si ritira', async () => {
		// Il TTL si prova col tempo finto del database: un indice mai depositato
		// e uno depositato si comportano allo stesso modo dopo la scadenza.
		const id = 'c'.repeat(64);
		await deposit({ Authorization: `Bearer ${credential}` }, id);
		const originalNow = Date.now;
		try {
			Date.now = () => originalNow() + 11 * 60_000;
			const expired = await fetch(`${baseUrl}/v1/mailbox/${id}`);
			expect(expired.status).toBe(404);
		} finally {
			Date.now = originalNow;
		}
	});

	test('un nuovo deposito dello stesso indice sostituisce il precedente', async () => {
		const id = 'd'.repeat(64);
		await deposit({ Authorization: `Bearer ${credential}` }, id, PAYLOAD);
		const newer = 'bmV3LWNpZmF0by1wZXItbG8tc3Rlc3NvLWNvZGljZS1jb3J0by1yaWdlbmVyYXRv';
		await deposit({ Authorization: `Bearer ${credential}` }, id, newer);
		const res = await fetch(`${baseUrl}/v1/mailbox/${id}`);
		expect(await res.json()).toEqual({ payload: newer });
	});

	test('un indice non valido non si ritira', async () => {
		expect((await fetch(`${baseUrl}/v1/mailbox/..%2Fetc`)).status).toBe(400);
	});

	test('i tentativi falliti di un indirizzo non bloccano gli altri', async () => {
		// R-MI-55: il limite e' per indirizzo. Chi prova codici a caso non deve
		// poter fermare l'abbinamento delle altre macchine.
		const guessing = { 'X-Forwarded-For': '203.0.113.9' };
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const miss = await fetch(`${baseUrl}/v1/mailbox/${String(attempt).padStart(64, 'e')}`, {
				headers: guessing
			});
			expect(miss.status).toBe(404);
		}
		// L'undicesimo tentativo dello stesso indirizzo e' limitato...
		const blocked = await fetch(`${baseUrl}/v1/mailbox/${'f'.repeat(64)}`, { headers: guessing });
		expect(blocked.status).toBe(429);
		// ...ma un indirizzo legittimo con un deposito valido ritira lo stesso.
		const id = '9'.repeat(64);
		await deposit({ Authorization: `Bearer ${credential}` }, id);
		const valid = await fetch(`${baseUrl}/v1/mailbox/${id}`, { headers: { 'X-Forwarded-For': '198.51.100.7' } });
		expect(valid.status).toBe(200);
	});
});

describe('R-REM-25 e R-MI-52 — codice del telefono e revoca', () => {
	test('il codice del telefono si genera solo con la credenziale dell\'host', async () => {
		expect((await fetch(`${baseUrl}/v1/host/codes`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'device' })
		})).status).toBe(401);
		const res = await fetch(`${baseUrl}/v1/host/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
			body: JSON.stringify({ kind: 'device' })
		});
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.kind).toBe('device');
		expect(String(body.code)).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
		expect(Number(body.expiresAt)).toBeGreaterThan(Date.now());
		// L'host non puo' creare codici per le macchine: quello spetta ai telefoni.
		const hostKind = await fetch(`${baseUrl}/v1/host/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
			body: JSON.stringify({ kind: 'host' })
		});
		expect(hostKind.status).toBe(400);
	});

	test('il telefono che usa il codice compare e l\'host lo revoca', async () => {
		const codeRes = await fetch(`${baseUrl}/v1/host/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
			body: JSON.stringify({ kind: 'device' })
		});
		const code = await readCode(codeRes);
		const paired = await fetch(`${baseUrl}/v1/pair/device`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'iPhone', code })
		});
		expect(paired.status).toBe(200);
		const cookie = paired.headers.get('set-cookie')!.split(';')[0]!;
		// Il telefono conosce se stesso.
		const session = await fetch(`${baseUrl}/v1/session`, { headers: { Cookie: cookie } });
		const sessionBody = await readJson(session);
		const deviceValue = sessionBody.device;
		if (!deviceValue || typeof deviceValue !== 'object' || !('id' in deviceValue) || typeof deviceValue.id !== 'string') {
			throw new Error('sessione senza dispositivo');
		}
		const deviceId = deviceValue.id;

		// Un host qualsiasi non puo' revocare il dispositivo di un altro: per lui non esiste.
		expect((await fetch(`${baseUrl}/v1/host/devices/${deviceId}`, {
			method: 'DELETE', headers: { Authorization: `Bearer ${'q'.repeat(64)}` }
		})).status).toBe(401);
		// Il suo host si'.
		const revoked = await fetch(`${baseUrl}/v1/host/devices/${deviceId}`, {
			method: 'DELETE', headers: { Authorization: `Bearer ${credential}` }
		});
		expect(revoked.status).toBe(200);
		// Da qui la sessione del telefono non vale piu'.
		expect((await fetch(`${baseUrl}/v1/session`, { headers: { Cookie: cookie } })).status).toBe(401);
	});
});
