import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	PEER_ONLY_COMMANDS,
	PROTOCOL,
	type HostSummary,
	type RelayToClientFrame,
	type RemoteCommand
} from '../src/protocol.ts';
import { startRelay, type RelayServer } from '../src/server.ts';
import { MAX_DEFERRED_PER_HOST } from '../src/store.ts';

const ADMIN_TOKEN = 'm'.repeat(40);
const HOST_ID = '22222222-3333-4444-8555-666666666666';
const OFFLINE_HOST_ID = '33333333-4444-4555-8666-777777777777';

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
	close: () => void;
}

function connectWs(path: string, headers: Record<string, string> = {}): WsHarness {
	const ws = new WebSocket(`${wsUrl}${path}`, { headers });
	const inbox: Record<string, unknown>[] = [];
	let listeners: Array<() => void> = [];

	ws.onmessage = (event) => {
		try {
			inbox.push(JSON.parse(String(event.data)) as Record<string, unknown>);
		} catch {
			// Frame non JSON: ignorato come fa la PWA.
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

	return {
		ws,
		opened,
		closed,
		next,
		send: (msg) => ws.send(JSON.stringify(msg)),
		close: () => ws.close()
	};
}

async function pairDevice(name: string): Promise<string> {
	const res = await fetch(`${baseUrl}/v1/pair/device`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, adminToken: ADMIN_TOKEN })
	});
	expect(res.status).toBe(200);
	return res.headers.get('set-cookie')!.split(';')[0]!;
}

async function pairHost(cookie: string, hostId: string, name: string): Promise<string> {
	const codeRes = await fetch(`${baseUrl}/v1/codes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: cookie },
		body: JSON.stringify({ kind: 'host' })
	});
	expect(codeRes.status).toBe(200);
	const { code } = (await codeRes.json()) as { code: string };
	const res = await fetch(`${baseUrl}/v1/pair/host`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, hostId, name, platform: 'macos', appVersion: '1.0.0' })
	});
	expect(res.status).toBe(200);
	return ((await res.json()) as { credential: string }).credential;
}

async function connectClient(cookie: string): Promise<WsHarness> {
	const client = connectWs('/v1/client', { Cookie: cookie, Origin: baseUrl });
	await client.opened;
	client.send({ type: 'hello', protocol: PROTOCOL });
	await client.next((m) => m.type === 'welcome');
	return client;
}

/** Chiude l'host e aspetta che il relay lo dichiari spento, invece di dormire. */
async function closeHostAndWaitOffline(
	host: WsHarness,
	client: WsHarness,
	hostId: string
): Promise<void> {
	host.close();
	await client.next(
		(m) =>
			m.type === 'host_status' &&
			(m.host as HostSummary).id === hostId &&
			(m.host as HostSummary).online === false
	);
}

async function connectHost(credential: string, features: string[] = ['task_edit', 'run_task']): Promise<WsHarness> {
	const host = connectWs('/v1/host', { Authorization: `Bearer ${credential}` });
	await host.opened;
	host.send({
		type: 'hello',
		protocol: PROTOCOL,
		features,
		host: { name: 'Mac', platform: 'macos', appVersion: '1.0.0' }
	});
	await host.next((m) => m.type === 'welcome');
	return host;
}

beforeAll(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'relay-multimachine-test-'));
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

describe('R-REM-24: comandi del collegamento fra computer rifiutati dal telefono', () => {
	test('ogni PEER_ONLY_COMMANDS torna unsupported e non arriva alla macchina', async () => {
		const cookie = await pairDevice('Phone24');
		const credential = await pairHost(cookie, HOST_ID, 'Mac24');
		const host = await connectHost(credential, ['projects', 'task_edit', 'run_task']);
		const client = await connectClient(cookie);

		// Un comando qualsiasi per assicurarsi che il canale funzioni.
		client.send({
			type: 'command',
			commandId: 'warmup',
			hostId: HOST_ID,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});
		const warmup = (await host.next((m) => m.type === 'command')) as { commandId: string };
		host.send({ type: 'command_result', commandId: warmup.commandId, ok: true });
		await client.next((m) => m.type === 'command_result' && m.commandId === 'warmup');

		const peerOnly: RemoteCommand[] = [
			{ kind: 'read_queue', projectPath: '/tmp/project' },
			{ kind: 'write_queue', projectPath: '/tmp/project', tasks: '[]' },
			{ kind: 'lane_action', projectId: 'p1', action: { op: 'create' } },
			{ kind: 'close_project', projectId: 'p1' },
			{ kind: 'set_auto_dispatch', projectId: 'p1', enabled: true }
		];
		for (const [index, command] of peerOnly.entries()) {
			expect(PEER_ONLY_COMMANDS[command.kind]).toBe(true);
			client.send({
				type: 'command',
				commandId: `peer-${index}`,
				hostId: HOST_ID,
				command
			});
			const result = await client.next((m) => m.type === 'command_result' && m.commandId === `peer-${index}`);
			expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } });
		}

		// Nessun frame `command` e' arrivato all'host: il prossimo comando che
		// riceve e' quello legittimo inviato adesso, non uno dei peer-only.
		client.send({
			type: 'command',
			commandId: 'after-peer',
			hostId: HOST_ID,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' }
		});
		const nextOnHost = (await host.next((m) => m.type === 'command')) as unknown as {
			commandId: string;
			command: RemoteCommand;
		};
		expect(nextOnHost.command.kind).toBe('run_task');
		host.send({ type: 'command_result', commandId: nextOnHost.commandId, ok: true });
		await client.next((m) => m.type === 'command_result' && m.commandId === 'after-peer');

		client.close();
		host.close();
	});

	test('un comando peer-only verso una macchina spenta resta rifiutato, non accodato', async () => {
		const cookie = await pairDevice('Phone24b');
		await pairHost(cookie, OFFLINE_HOST_ID, 'Mac24b');
		const client = await connectClient(cookie);

		client.send({
			type: 'command',
			commandId: 'peer-offline',
			hostId: OFFLINE_HOST_ID,
			command: { kind: 'write_queue', projectPath: '/tmp/p', tasks: '[]' },
			deferIfOffline: true
		});
		const result = await client.next((m) => m.type === 'command_result' && m.commandId === 'peer-offline');
		expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } });

		const hostsRes = await fetch(`${baseUrl}/v1/hosts`, { headers: { Cookie: cookie } });
		const { hosts } = (await hostsRes.json()) as { hosts: HostSummary[] };
		const target = hosts.find((h) => h.id === OFFLINE_HOST_ID);
		expect(target?.deferred ?? []).toHaveLength(0);

		client.close();
	});
});

describe('R-REM-22: outbox dei lavori per una macchina spenta', () => {
	test('deferIfOffline conserva il lavoro, lo elenca e lo consegna al ritorno', async () => {
		const cookie = await pairDevice('Phone22');
		const credential = await pairHost(cookie, HOST_ID, 'Mac22');

		// Il telefono c'e' prima della caduta, cosi' il relay puo' dirgli che la
		// macchina e' spenta invece di farci aspettare un tempo arbitrario.
		const client = await connectClient(cookie);
		const firstHost = await connectHost(credential);
		await closeHostAndWaitOffline(firstHost, client, HOST_ID);

		const taskCommand: Extract<RemoteCommand, { kind: 'create_task' }> = {
			kind: 'create_task',
			projectId: 'p1',
			prompt: 'Prepara il rilascio della nightly build di domani',
			schedule: null
		};
		client.send({
			type: 'command',
			commandId: 'deferred-1',
			hostId: HOST_ID,
			command: taskCommand,
			deferIfOffline: true
		});

		const accepted = await client.next(
			(m) => m.type === 'command_result' && m.commandId === 'deferred-1'
		);
		expect(accepted).toMatchObject({ ok: true, deferred: true });

		// Il riepilogo della macchina porta il lavoro in attesa (R-REM-22).
		const statusFrame = (await client.next(
			(m) =>
				m.type === 'host_status' &&
				(m.host as HostSummary).id === HOST_ID &&
				((m.host as HostSummary).deferred?.length ?? 0) === 1
		)) as unknown as Extract<RelayToClientFrame, { type: 'host_status' }>;
		expect(statusFrame.host.deferred).toHaveLength(1);
		expect(statusFrame.host.deferred?.[0]).toMatchObject({
			commandId: 'deferred-1',
			projectId: 'p1'
		});

		// La macchina torna: il lavoro arriva subito, senza che il telefono lo ripeta.
		const host = await connectHost(credential);
		const forwarded = (await host.next((m) => m.type === 'command')) as unknown as {
			commandId: string;
			command: RemoteCommand;
		};
		expect(forwarded.command.kind).toBe('create_task');
		expect(forwarded.command).toMatchObject({ projectId: 'p1' });

		host.send({
			type: 'command_result',
			commandId: forwarded.commandId,
			ok: true,
			data: { taskId: 'task-1' }
		});
		const delivered = await client.next(
			(m) => m.type === 'command_result' && m.commandId === 'deferred-1' && m.ok === true
		);
		expect(delivered).toMatchObject({ ok: true, data: { taskId: 'task-1' } });

		// Outbox vuota: consegnato vuol dire rimosso.
		const hostsRes = await fetch(`${baseUrl}/v1/hosts`, { headers: { Cookie: cookie } });
		const { hosts } = (await hostsRes.json()) as { hosts: HostSummary[] };
		expect(hosts.find((h) => h.id === HOST_ID)?.deferred ?? []).toHaveLength(0);

		client.close();
		host.close();
	});

	test('cancel_deferred toglie il lavoro e lo comunica alle altre PWA', async () => {
		const cookie = await pairDevice('Phone22b');
		const credential = await pairHost(cookie, HOST_ID, 'Mac22b');
		const client = await connectClient(cookie);
		const observer = await connectClient(cookie);
		const firstHost = await connectHost(credential);
		await closeHostAndWaitOffline(firstHost, client, HOST_ID);

		client.send({
			type: 'command',
			commandId: 'deferred-cancel',
			hostId: HOST_ID,
			command: { kind: 'create_task', projectId: 'p1', prompt: 'Lavoro da annullare', schedule: null },
			deferIfOffline: true
		});
		await client.next((m) => m.type === 'command_result' && m.commandId === 'deferred-cancel');
		await observer.next(
			(m) =>
				m.type === 'host_status' &&
				(m.host as HostSummary).id === HOST_ID &&
				((m.host as HostSummary).deferred?.length ?? 0) === 1
		);

		client.send({ type: 'cancel_deferred', hostId: HOST_ID, commandId: 'deferred-cancel' });
		const cancelled = await client.next(
			(m) => m.type === 'command_result' && m.commandId === 'deferred-cancel'
		);
		expect(cancelled).toMatchObject({ ok: true });

		// Anche un secondo dispositivo vede sparire la voce: outbox unica.
		const observerUpdate = (await observer.next(
			(m) =>
				m.type === 'host_status' &&
				(m.host as HostSummary).id === HOST_ID &&
				((m.host as HostSummary).deferred?.length ?? 0) === 0
		)) as unknown as Extract<RelayToClientFrame, { type: 'host_status' }>;
		expect(observerUpdate.host.deferred ?? []).toHaveLength(0);

		client.close();
		observer.close();
	});

	test('deferIfOffline fuori da create_task viene rifiutato', async () => {
		const cookie = await pairDevice('Phone22c');
		const credential = await pairHost(cookie, HOST_ID, 'Mac22c');
		const client = await connectClient(cookie);
		const firstHost = await connectHost(credential);
		await closeHostAndWaitOffline(firstHost, client, HOST_ID);
		client.send({
			type: 'command',
			commandId: 'bad-defer',
			hostId: HOST_ID,
			command: { kind: 'run_task', projectId: 'p1', taskId: 't1' },
			deferIfOffline: true
		});
		const result = await client.next((m) => m.type === 'command_result' && m.commandId === 'bad-defer');
		expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } });

		client.close();
	});

	test('outbox limitata per macchina e svuotata alla revoca', async () => {
		const cookie = await pairDevice('Phone22d');
		const credential = await pairHost(cookie, OFFLINE_HOST_ID, 'Mac22d');
		const client = await connectClient(cookie);
		const firstHost = await connectHost(credential);
		await closeHostAndWaitOffline(firstHost, client, OFFLINE_HOST_ID);
		for (let i = 0; i <= MAX_DEFERRED_PER_HOST; i++) {
			client.send({
				type: 'command',
				commandId: `cap-${i}`,
				hostId: OFFLINE_HOST_ID,
				command: { kind: 'create_task', projectId: 'p1', prompt: `Lavoro ${i}`, schedule: null },
				deferIfOffline: true
			});
		}
		for (let i = 0; i < MAX_DEFERRED_PER_HOST; i++) {
			const ok = await client.next((m) => m.type === 'command_result' && m.commandId === `cap-${i}`);
			expect(ok).toMatchObject({ ok: true, deferred: true });
		}
		const overflow = await client.next(
			(m) => m.type === 'command_result' && m.commandId === `cap-${MAX_DEFERRED_PER_HOST}`
		);
		expect(overflow).toMatchObject({ ok: false, error: { code: 'rejected' } });

		// Revoca: l'outbox non ha piu' destinatario e non resta sul disco.
		const del = await fetch(`${baseUrl}/v1/hosts/${OFFLINE_HOST_ID}`, {
			method: 'DELETE',
			headers: { Cookie: cookie, Origin: baseUrl }
		});
		expect(del.status).toBe(200);

		client.close();
	});
});
