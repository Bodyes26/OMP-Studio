import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CloseCode,
	PROTOCOL,
	type RemoteChatEvent,
	type RelayToClientFrame,
	type RelayToHostFrame
} from '../src/protocol.ts';
import { startRelay, type RelayServer } from '../src/server.ts';

const ADMIN_TOKEN = 't'.repeat(40);
const HOST_ID_CHAT = '11111111-2222-4333-8444-555555555555';
const HOST_ID_NO_CHAT = '22222222-3333-4444-8555-666666666666';

let tempDir: string;
let webDir: string;
let server: RelayServer;
let wsUrl: string;
let baseUrl: string;

let clientCookie: string;
let clientCookie2: string;
let hostCredentialChat: string;
let hostCredentialNoChat: string;

interface WsHarness {
	ws: WebSocket;
	opened: Promise<void>;
	closed: Promise<{ code: number; reason: string }>;
	next: (predicate?: (msg: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>;
	send: (msg: Record<string, unknown>) => void;
}

function connectWs(path: string, headers: Record<string, string> = {}): WsHarness {
	const ws = new WebSocket(`${wsUrl}${path}`, { headers });
	const inbox: Record<string, unknown>[] = [];
	const waiters: Array<{
		predicate?: (msg: Record<string, unknown>) => boolean;
		resolve: (msg: Record<string, unknown>) => void;
	}> = [];

	const { promise: opened, resolve: resolveOpened } = Promise.withResolvers<void>();
	ws.onopen = () => resolveOpened();

	const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<{ code: number; reason: string }>();
	ws.onclose = (event) => resolveClosed({ code: event.code, reason: event.reason });

	ws.onmessage = (event) => {
		try {
			const parsed = JSON.parse(String(event.data)) as Record<string, unknown>;
			const idx = waiters.findIndex((w) => !w.predicate || w.predicate(parsed));
			if (idx >= 0) {
				const [waiter] = waiters.splice(idx, 1);
				waiter.resolve(parsed);
			} else {
				inbox.push(parsed);
			}
		} catch {
			// ignora frame non JSON
		}
	};

	const next = (predicate?: (msg: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
		const idx = inbox.findIndex((m) => !predicate || predicate(m));
		if (idx >= 0) {
			const [msg] = inbox.splice(idx, 1);
			return Promise.resolve(msg);
		}
		const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
		waiters.push({ predicate, resolve });
		return promise;
	};

	const send = (msg: Record<string, unknown>): void => {
		ws.send(JSON.stringify(msg));
	};

	return { ws, opened, closed, next, send };
}

beforeAll(async () => {
	tempDir = mkdtempSync(join(tmpdir(), 'relay-chat-test-'));
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

	// Dispositivo 1
	const authRes1 = await fetch(`${baseUrl}/v1/pair/device`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'Client1', adminToken: ADMIN_TOKEN })
	});
	clientCookie = authRes1.headers.get('set-cookie')!.split(';')[0];

	// Dispositivo 2
	const authRes2 = await fetch(`${baseUrl}/v1/pair/device`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'Client2', adminToken: ADMIN_TOKEN })
	});
	clientCookie2 = authRes2.headers.get('set-cookie')!.split(';')[0];

	// Registra Host con chat
	const codeRes1 = await fetch(`${baseUrl}/v1/codes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: clientCookie },
		body: JSON.stringify({ kind: 'host' })
	});
	const { code: code1 } = (await codeRes1.json()) as { code: string };

	const pairHost1 = await fetch(`${baseUrl}/v1/pair/host`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			code: code1,
			hostId: HOST_ID_CHAT,
			name: 'ChatHost',
			platform: 'macos',
			appVersion: '1.0.0'
		})
	});
	const pair1Json = (await pairHost1.json()) as { credential: string };
	hostCredentialChat = pair1Json.credential;

	// Registra Host senza chat
	const codeRes2 = await fetch(`${baseUrl}/v1/codes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: clientCookie },
		body: JSON.stringify({ kind: 'host' })
	});
	const { code: code2 } = (await codeRes2.json()) as { code: string };

	const pairHost2 = await fetch(`${baseUrl}/v1/pair/host`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			code: code2,
			hostId: HOST_ID_NO_CHAT,
			name: 'NoChatHost',
			platform: 'macos',
			appVersion: '1.0.0'
		})
	});
	const pair2Json = (await pairHost2.json()) as { credential: string };
	hostCredentialNoChat = pair2Json.credential;
});

afterAll(() => {
	server.stop(true);
	rmSync(tempDir, { recursive: true, force: true });
});

describe('Relay Chat Subscriptions e Routing', () => {
	test('host senza feature chat non riceve chat_watch', async () => {
		const host = connectWs('/v1/host', { Authorization: `Bearer ${hostCredentialNoChat}` });
		await host.opened;
		host.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['respond_ui'],
			host: { name: 'NoChatHost', platform: 'macos', appVersion: '1.0.0' }
		});
		await host.next((m) => m.type === 'welcome');

		// Client si iscrive a una corsia di NoChatHost
		const client = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		await client.opened;
		client.send({ type: 'hello', protocol: PROTOCOL });
		await client.next((m) => m.type === 'welcome');

		client.send({
			type: 'chat_subscribe',
			hostId: HOST_ID_NO_CHAT,
			projectId: 'proj-1',
			laneId: 'main'
		});

		// Attende brevemente: l'host non deve ricevere chat_watch
		let receivedChatWatch = false;
		const checkPromise = host.next((m) => m.type === 'chat_watch').then(() => {
			receivedChatWatch = true;
		});

		await Promise.race([checkPromise, new Promise((r) => setTimeout(r, 200))]);
		expect(receivedChatWatch).toBe(false);

		client.ws.close();
		host.ws.close();
	});

	test('validazione payload chat_subscribe / chat_unsubscribe chiude il socket per protocol_error', async () => {
		const client = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		await client.opened;
		client.send({ type: 'hello', protocol: PROTOCOL });
		await client.next((m) => m.type === 'welcome');

		// ID vuoto
		client.send({
			type: 'chat_subscribe',
			hostId: '',
			projectId: 'p',
			laneId: 'main'
		});

		const closed = await client.closed;
		expect(closed.code).toBe(CloseCode.protocolError);
	});

	test('tetto massimo di 4 corsie per socket client', async () => {
		const host = connectWs('/v1/host', { Authorization: `Bearer ${hostCredentialChat}` });
		await host.opened;
		host.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['chat'],
			host: { name: 'ChatHost', platform: 'macos', appVersion: '1.0.0' }
		});
		await host.next((m) => m.type === 'welcome');

		const client = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		await client.opened;
		client.send({ type: 'hello', protocol: PROTOCOL });
		await client.next((m) => m.type === 'welcome');

		// Sottoscrivi a 4 corsie
		for (let i = 1; i <= 4; i++) {
			client.send({
				type: 'chat_subscribe',
				hostId: HOST_ID_CHAT,
				projectId: 'proj-cap',
				laneId: `lane-${i}`
			});
		}

		// Attende chat_watch con 4 corsie
		const watch4 = (await host.next(
			(m) => m.type === 'chat_watch' && Array.isArray(m.lanes) && (m.lanes as unknown[]).length === 4
		)) as unknown as RelayToHostFrame;
		expect(watch4.type).toBe('chat_watch');

		// Prova a sottoscrivere la 5a corsia
		client.send({
			type: 'chat_subscribe',
			hostId: HOST_ID_CHAT,
			projectId: 'proj-cap',
			laneId: 'lane-5'
		});

		let got5th = false;
		const check5 = host.next((m) => m.type === 'chat_watch' && (m.lanes as unknown[]).length === 5).then(() => {
			got5th = true;
		});
		await Promise.race([check5, new Promise((r) => setTimeout(r, 200))]);
		expect(got5th).toBe(false);

		client.ws.close();
		host.ws.close();
	});

	test('aggregazione per host, inoltro eventi, drop per corsie non seguite e pulizia alla chiusura', async () => {
		// Connette host con chat
		const host = connectWs('/v1/host', { Authorization: `Bearer ${hostCredentialChat}` });
		await host.opened;
		host.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['chat'],
			host: { name: 'ChatHost', platform: 'macos', appVersion: '1.0.0' }
		});
		await host.next((m) => m.type === 'welcome');
		const initialWatch = await host.next((m) => m.type === 'chat_watch');
		expect(initialWatch.lanes).toEqual([]);

		// Due client
		const client1 = connectWs('/v1/client', { Cookie: clientCookie, Origin: baseUrl });
		const client2 = connectWs('/v1/client', { Cookie: clientCookie2, Origin: baseUrl });
		await Promise.all([client1.opened, client2.opened]);

		client1.send({ type: 'hello', protocol: PROTOCOL });
		client2.send({ type: 'hello', protocol: PROTOCOL });
		await Promise.all([client1.next((m) => m.type === 'welcome'), client2.next((m) => m.type === 'welcome')]);

		// Client 1 segue proj-a/lane-1
		client1.send({
			type: 'chat_subscribe',
			hostId: HOST_ID_CHAT,
			projectId: 'proj-a',
			laneId: 'lane-1'
		});

		const watch1 = (await host.next((m) => m.type === 'chat_watch')) as unknown as Extract<
			RelayToHostFrame,
			{ type: 'chat_watch' }
		>;
		expect(watch1.lanes).toEqual([{ projectId: 'proj-a', laneId: 'lane-1' }]);

		// Client 2 segue anch'esso proj-a/lane-1 e proj-a/lane-2
		client2.send({
			type: 'chat_subscribe',
			hostId: HOST_ID_CHAT,
			projectId: 'proj-a',
			laneId: 'lane-1'
		});
		client2.send({
			type: 'chat_subscribe',
			hostId: HOST_ID_CHAT,
			projectId: 'proj-a',
			laneId: 'lane-2'
		});

		const watch2 = (await host.next(
			(m) => m.type === 'chat_watch' && Array.isArray(m.lanes) && (m.lanes as unknown[]).length === 2
		)) as unknown as Extract<RelayToHostFrame, { type: 'chat_watch' }>;
		expect(watch2.lanes.length).toBe(2);

		// Host emette evento su proj-a/lane-1: entrambi i client devono riceverlo
		const event1: RemoteChatEvent = {
			kind: 'message',
			message: {
				id: 'msg-1',
				role: 'assistant',
				text: 'Ciao da Studio',
				toolName: null,
				timestamp: Date.now()
			}
		};
		host.send({
			type: 'chat_event',
			projectId: 'proj-a',
			laneId: 'lane-1',
			event: event1
		});

		const [c1Ev, c2Ev] = (await Promise.all([
			client1.next((m) => m.type === 'chat_event'),
			client2.next((m) => m.type === 'chat_event')
		])) as unknown as [
			Extract<RelayToClientFrame, { type: 'chat_event' }>,
			Extract<RelayToClientFrame, { type: 'chat_event' }>
		];

		expect(c1Ev.projectId).toBe('proj-a');
		expect(c1Ev.laneId).toBe('lane-1');
		expect(c1Ev.event).toEqual(event1);
		expect(c2Ev.event).toEqual(event1);

		// Host emette evento su proj-a/lane-2: solo client2 deve riceverlo
		const event2: RemoteChatEvent = {
			kind: 'delta',
			messageId: 'msg-2',
			text: 'streaming chunk'
		};
		host.send({
			type: 'chat_event',
			projectId: 'proj-a',
			laneId: 'lane-2',
			event: event2
		});

		const c2Ev2 = (await client2.next((m) => m.type === 'chat_event')) as unknown as Extract<
			RelayToClientFrame,
			{ type: 'chat_event' }
		>;
		expect(c2Ev2.laneId).toBe('lane-2');
		expect(c2Ev2.event).toEqual(event2);

		// Host emette evento su corsia non seguita: scartato
		host.send({
			type: 'chat_event',
			projectId: 'proj-unwatched',
			laneId: 'lane-x',
			event: { kind: 'reset' }
		});

		let droppedReceived = false;
		const checkDrop = client1.next((m) => m.type === 'chat_event' && m.projectId === 'proj-unwatched').then(() => {
			droppedReceived = true;
		});
		await Promise.race([checkDrop, new Promise((r) => setTimeout(r, 150))]);
		expect(droppedReceived).toBe(false);

		// Chiudi client 2: le sottoscrizioni di client 2 devono essere rimosse, resta solo lane-1 di client 1
		client2.ws.close();

		const watchAfterClose = (await host.next(
			(m) => m.type === 'chat_watch' && Array.isArray(m.lanes) && (m.lanes as unknown[]).length === 1
		)) as unknown as Extract<RelayToHostFrame, { type: 'chat_watch' }>;
		expect(watchAfterClose.lanes).toEqual([{ projectId: 'proj-a', laneId: 'lane-1' }]);

		// Riconnessione host: ri-riceve chat_watch con la corsia ancora seguita
		host.ws.close();
		const host2 = connectWs('/v1/host', { Authorization: `Bearer ${hostCredentialChat}` });
		await host2.opened;
		host2.send({
			type: 'hello',
			protocol: PROTOCOL,
			features: ['chat'],
			host: { name: 'ChatHost', platform: 'macos', appVersion: '1.0.0' }
		});
		await host2.next((m) => m.type === 'welcome');

		const watchOnReconnect = (await host2.next((m) => m.type === 'chat_watch')) as unknown as Extract<
			RelayToHostFrame,
			{ type: 'chat_watch' }
		>;
		expect(watchOnReconnect.lanes).toEqual([{ projectId: 'proj-a', laneId: 'lane-1' }]);

		// Client 1 disiscrive lane-1: host riceve chat_watch vuoto
		client1.send({
			type: 'chat_unsubscribe',
			hostId: HOST_ID_CHAT,
			projectId: 'proj-a',
			laneId: 'lane-1'
		});

		const watchEmpty = (await host2.next(
			(m) => m.type === 'chat_watch' && Array.isArray(m.lanes) && (m.lanes as unknown[]).length === 0
		)) as unknown as Extract<RelayToHostFrame, { type: 'chat_watch' }>;
		expect(watchEmpty.lanes).toEqual([]);

		client1.ws.close();
		host2.ws.close();
	});
});
