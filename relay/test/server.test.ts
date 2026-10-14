import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'bun:test';
import { loadConfig } from '../src/config.ts';
import { CLOSE_UNAUTHORIZED, startRelay, type RelayServer } from '../src/server.ts';

const TOKEN = 'a'.repeat(40);
const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 25_000;

let server: RelayServer;
let base: string;

beforeAll(() => {
	server = startRelay({
		port: 0,
		hostname: '127.0.0.1',
		adminToken: TOKEN,
		authTimeoutMs: AUTH_TIMEOUT_MS,
		heartbeatMs: HEARTBEAT_MS,
		maxDiagSessions: 2
	});
	base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
	server.stop(true);
});

afterEach(() => {
	vi.useRealTimers();
});

type Message = Record<string, unknown>;

function openDiag() {
	const ws = new WebSocket(`${base.replace('http', 'ws')}/v1/diag`);
	const inbox: Message[] = [];
	let waiters: Array<() => void> = [];
	ws.onmessage = (event) => {
		inbox.push(JSON.parse(String(event.data)) as Message);
		const pending = waiters;
		waiters = [];
		for (const wake of pending) wake();
	};
	const opened = new Promise<void>((resolve) => {
		ws.onopen = () => resolve();
	});
	const closed = new Promise<CloseEvent>((resolve) => {
		ws.onclose = (event) => resolve(event);
	});
	const next = (type: string) =>
		new Promise<Message>((resolve) => {
			const check = () => {
				const index = inbox.findIndex((message) => message.type === type);
				if (index === -1) {
					waiters.push(check);
					return;
				}
				resolve(inbox.splice(index, 1)[0]!);
			};
			check();
		});
	const send = (message: Message) => ws.send(JSON.stringify(message));
	return { ws, opened, closed, next, send };
}

describe('configurazione', () => {
	test('rifiuta un segreto assente o troppo corto', () => {
		expect(() => loadConfig({})).toThrow('RELAY_ADMIN_TOKEN');
		expect(() => loadConfig({ RELAY_ADMIN_TOKEN: 'x'.repeat(31) })).toThrow('RELAY_ADMIN_TOKEN');
	});

	test('rifiuta una porta non valida e usa 8787 se manca', () => {
		expect(() => loadConfig({ RELAY_ADMIN_TOKEN: TOKEN, RELAY_PORT: '70000' })).toThrow('RELAY_PORT');
		expect(loadConfig({ RELAY_ADMIN_TOKEN: TOKEN }).port).toBe(8787);
	});
});

describe('HTTP', () => {
	test('/healthz risponde ok senza autenticazione', async () => {
		const res = await fetch(`${base}/healthz`);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, service: 'omp-studio-relay' });
	});

	test('un percorso sconosciuto risponde 404', async () => {
		expect((await fetch(`${base}/v1/unknown`)).status).toBe(404);
	});
});

describe('diagnosi WebSocket', () => {
	test('un token errato chiude la connessione', async () => {
		const diag = openDiag();
		await diag.opened;
		diag.send({ type: 'auth', token: 'b'.repeat(40) });
		expect((await diag.closed).code).toBe(CLOSE_UNAUTHORIZED);
	});

	test('un primo messaggio diverso da auth chiude la connessione', async () => {
		const diag = openDiag();
		await diag.opened;
		diag.send({ type: 'echo', t: 1 });
		expect((await diag.closed).code).toBe(CLOSE_UNAUTHORIZED);
	});

	test('senza token entro il tempo concesso la connessione si chiude', async () => {
		vi.useFakeTimers();
		const diag = openDiag();
		await diag.opened;
		vi.advanceTimersByTime(AUTH_TIMEOUT_MS);
		expect((await diag.closed).code).toBe(CLOSE_UNAUTHORIZED);
	});

	test('con il token valido arrivano benvenuto, battito ed eco', async () => {
		vi.useFakeTimers();
		const diag = openDiag();
		await diag.opened;
		diag.send({ type: 'auth', token: TOKEN });
		expect(await diag.next('welcome')).toMatchObject({ heartbeatMs: HEARTBEAT_MS });
		vi.advanceTimersByTime(HEARTBEAT_MS);
		expect(await diag.next('ping')).toMatchObject({ seq: 1 });
		diag.send({ type: 'echo', t: 42 });
		expect(await diag.next('echo')).toMatchObject({ t: 42 });
		diag.ws.close();
		await diag.closed;
	});

	test('oltre il tetto di sessioni il relay rifiuta nuove connessioni', async () => {
		const first = openDiag();
		const second = openDiag();
		await Promise.all([first.opened, second.opened]);
		expect((await fetch(`${base}/v1/diag`)).status).toBe(429);
		first.ws.close();
		second.ws.close();
		await Promise.all([first.closed, second.closed]);
	});
});
