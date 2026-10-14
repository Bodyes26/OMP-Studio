import type { Server } from 'bun';
import { hashSecret, generateSecret, tokensMatch, generatePairingCode } from './auth.ts';
import type { RelayConfig } from './config.ts';
import {
	API,
	CloseCode,
	formatPairingCode,
	MIN_HOST_PROTOCOL_VERSION,
	normalizePairingCode,
	PAIRING_CODE_TTL_MS,
	PROTOCOL,
	SESSION_COOKIE,
	type HealthResponse,
	type PairDeviceRequest,
	type PairDeviceResponse,
	type PairHostRequest,
	type PairHostResponse,
	type CreateCodeRequest,
	type CreateCodeResponse,
	type SessionResponse,
	type DevicesResponse,
	type HostsResponse,
	type PairingKind,
	type Platform,
	type SavePushSubscriptionRequest,
	type SavePushSubscriptionResponse,
	type DeletePushSubscriptionRequest,
	type VapidPublicKeyResponse
} from './protocol.ts';
import { isValidAuth, isValidP256dh, isValidPushEndpoint, type VapidKeyPair } from './vapid.ts';
import { extractClientKey, type RateLimiter } from './ratelimit.ts';
import type { RelayWsData, SocketHub } from './sockets.ts';
import { servePwa } from './static.ts';
import { MAX_ACTIVE_CODES_PER_DEVICE, type DeviceRecord, type RelayStore } from './store.ts';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BASE_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'Cache-Control': 'no-store'
};

const PUBLIC_DIR = new URL('../public/', import.meta.url);

const DIAG_ASSETS: Record<string, { file: string; type: string }> = {
	'/diag': { file: 'diag.html', type: 'text/html; charset=utf-8' },
	'/diag.js': { file: 'diag.js', type: 'text/javascript; charset=utf-8' },
	'/diag.css': { file: 'diag.css', type: 'text/css; charset=utf-8' }
};

const HOST_PATTERN = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;

function pageCsp(host: string | null): string {
	const sockets = host && HOST_PATTERN.test(host) ? ` wss://${host} ws://${host}` : '';
	return [
		"default-src 'none'",
		"script-src 'self'",
		"style-src 'self'",
		`connect-src 'self'${sockets}`,
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'"
	].join('; ');
}

export function apiError(code: string, message: string, status: number): Response {
	return Response.json(
		{ error: { code, message } },
		{ status, headers: BASE_HEADERS }
	);
}

function getRelayOrigin(req: Request): string {
	const url = new URL(req.url);
	const forwardedProto = req.headers.get('x-forwarded-proto')?.trim();
	const scheme = forwardedProto ? forwardedProto.split(',')[0].trim() : url.protocol.replace(':', '');
	const host = req.headers.get('host')?.trim() || url.host;
	return `${scheme}://${host}`.toLowerCase();
}

function isSameOrigin(req: Request): boolean {
	const origin = req.headers.get('origin');
	if (!origin) return false;
	return origin.toLowerCase() === getRelayOrigin(req);
}

function isRequestHttps(req: Request): boolean {
	if (req.url.startsWith('https:')) return true;
	const proto = req.headers.get('x-forwarded-proto');
	return proto ? proto.split(',')[0].trim() === 'https' : false;
}

function parseCookies(header: string | null): Record<string, string> {
	const cookies: Record<string, string> = {};
	if (!header) return cookies;
	for (const part of header.split(';')) {
		const [k, v] = part.trim().split('=');
		if (k && v) {
			cookies[k] = decodeURIComponent(v);
		}
	}
	return cookies;
}

async function parseBody<T>(req: Request): Promise<T | null> {
	try {
		return (await req.json()) as T;
	} catch {
		return null;
	}
}

/**
 * Gestore principale di tutte le richieste HTTP e degli upgrade WebSocket del relay.
 */
export async function handleRequest(
	req: Request,
	server: Server<RelayWsData>,
	config: RelayConfig,
	store: RelayStore,
	rateLimiter: RateLimiter,
	socketHub: SocketHub,
	vapidKeys?: VapidKeyPair
): Promise<Response> {
	const url = new URL(req.url);
	const pathname = url.pathname;

	// Endpoint di sanita' pubblico per monitoraggio e verifica compatibilita' delle versioni.
	if (pathname === '/healthz') {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		}
		const health: HealthResponse = {
			ok: true,
			service: 'omp-studio-relay',
			version: config.version,
			protocol: {
				name: PROTOCOL.name,
				min: MIN_HOST_PROTOCOL_VERSION,
				max: PROTOCOL.version
			}
		};
		return Response.json(health, { headers: BASE_HEADERS });
	}

	// Pagine e risorse della console di diagnostica esistente.
	const diagAsset = DIAG_ASSETS[pathname];
	if (diagAsset) {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		}
		return new Response(Bun.file(new URL(diagAsset.file, PUBLIC_DIR)), {
			headers: {
				...BASE_HEADERS,
				'Content-Type': diagAsset.type,
				'Content-Security-Policy': pageCsp(req.headers.get('host'))
			}
		});
	}

	// Upgrade WebSocket per la console di diagnostica.
	if (pathname === '/v1/diag') {
		if (socketHub.getDiagSessionsCount() >= config.maxDiagSessions) {
			return new Response('Too many diagnostic sessions', { status: 429, headers: BASE_HEADERS });
		}
		const upgraded = server.upgrade(req, {
			data: {
				kind: 'diag',
				authed: false,
				authedAt: 0,
				seq: 0
			}
		});
		return upgraded ? (undefined as unknown as Response) : new Response('Expected a WebSocket upgrade', { status: 426, headers: BASE_HEADERS });
	}

	// Upgrade WebSocket per la macchina (Studio).
	if (pathname === API.hostSocket) {
		const clientKey = extractClientKey(req, server.requestIP(req)?.address);
		const now = Date.now();

		// Verifica credenziale PRIMA di qualunque limite (segreti a 256 bit): una valida passa sempre
		const auth = req.headers.get('authorization');
		const credential = auth && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
		const host = credential ? store.getHostByCredentialHash(hashSecret(credential)) : null;

		if (!host) {
			if (rateLimiter.isWsRateLimited(clientKey, now)) {
				return apiError('rate_limited', 'Too many authentication failures', 429);
			}
			rateLimiter.recordWsFailure(clientKey, now);
			return apiError('unauthorized', 'Missing or invalid host credential', 401);
		}

		const upgraded = server.upgrade(req, {
			data: {
				kind: 'host',
				hostId: host.id,
				credentialHash: host.credentialHash,
				lastInboundAt: now,
				authed: true,
				helloReceived: false,
				firstSnapshotReceived: false,
				lastAcceptedSeq: 0,
				features: [],
				latestState: null,
				stateReceivedAt: null,
				lastPersistedAt: 0,
				dirty: false,
				pingSeq: 0
			}
		});
		return upgraded ? (undefined as unknown as Response) : new Response('Expected a WebSocket upgrade', { status: 426, headers: BASE_HEADERS });
	}

	// Upgrade WebSocket per il client (PWA).
	if (pathname === API.clientSocket) {
		if (!isSameOrigin(req)) {
			return apiError('forbidden_origin', 'Invalid or missing Origin header', 403);
		}

		const clientKey = extractClientKey(req, server.requestIP(req)?.address);
		const now = Date.now();

		// Verifica sessione PRIMA di qualunque limite: un dispositivo valido passa sempre
		const cookies = parseCookies(req.headers.get('cookie'));
		const token = cookies[SESSION_COOKIE];
		const device = token ? store.findDeviceBySessionHash(hashSecret(token)) : null;

		if (!device || device.revoked) {
			if (rateLimiter.isWsRateLimited(clientKey, now)) {
				return apiError('rate_limited', 'Too many authentication failures', 429);
			}
			rateLimiter.recordWsFailure(clientKey, now);
			return apiError('unauthorized', 'Session missing, expired or revoked', 401);
		}

		const upgraded = server.upgrade(req, {
			data: {
				kind: 'client',
				deviceId: device.id,
				deviceName: device.name,
				lastInboundAt: now,
				authed: true,
				helloReceived: false,
				pingSeq: 0
			}
		});
		return upgraded ? (undefined as unknown as Response) : new Response('Expected a WebSocket upgrade', { status: 426, headers: BASE_HEADERS });
	}

	// ---------------------------------------------------------------------------
	// API HTTP REST
	// ---------------------------------------------------------------------------

	// Abbinamento dispositivo client.
	if (pathname === API.pairDevice) {
		if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });

		const origin = req.headers.get('origin');
		if (origin && origin.toLowerCase() !== getRelayOrigin(req)) {
			return apiError('forbidden_origin', 'Invalid Origin header', 403);
		}

		const body = await parseBody<PairDeviceRequest>(req);
		if (!body || typeof body.name !== 'string' || !body.name.trim()) {
			return apiError('bad_request', 'Missing or invalid device name', 400);
		}

		// Controllo limiti ed esecuzione autenticazione nello stesso tick sincrono post-body
		const clientKey = extractClientKey(req, server.requestIP(req)?.address);
		const now = Date.now();
		if (rateLimiter.isPairingRateLimited(clientKey, now)) {
			return apiError('rate_limited', 'Too many authentication failures', 429);
		}

		let authed = false;
		if (typeof body.adminToken === 'string' && body.adminToken) {
			authed = tokensMatch(body.adminToken, config.adminToken);
		} else if (typeof body.code === 'string' && body.code) {
			const normalized = normalizePairingCode(body.code);
			if (normalized) {
				authed = store.consumePairingCode(hashSecret(normalized), 'device', now);
			}
		}

		if (!authed) {
			rateLimiter.recordPairingFailure(clientKey, now);
			return apiError('unauthorized', 'Invalid admin token or pairing code', 401);
		}

		const sessionToken = generateSecret();
		const device = store.createDevice(body.name.trim(), hashSecret(sessionToken), now);

		const isHttps = isRequestHttps(req);
		let cookie = `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
		if (isHttps) cookie += '; Secure';

		const resBody: PairDeviceResponse = { device };
		return Response.json(resBody, {
			headers: {
				...BASE_HEADERS,
				'Set-Cookie': cookie
			}
		});
	}

	// Abbinamento macchina host.
	if (pathname === API.pairHost) {
		if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });

		const origin = req.headers.get('origin');
		if (origin && origin.toLowerCase() !== getRelayOrigin(req)) {
			return apiError('forbidden_origin', 'Invalid Origin header', 403);
		}

		const body = await parseBody<PairHostRequest>(req);
		if (
			!body ||
			typeof body.hostId !== 'string' ||
			!UUID_REGEX.test(body.hostId) ||
			typeof body.name !== 'string' ||
			!body.name.trim() ||
			typeof body.platform !== 'string' ||
			!['windows', 'macos', 'linux'].includes(body.platform) ||
			typeof body.appVersion !== 'string' ||
			!body.appVersion.trim()
		) {
			return apiError('bad_request', 'Invalid host registration parameters', 400);
		}

		// Controllo limiti e verifica codice nello stesso tick sincrono post-body
		const clientKey = extractClientKey(req, server.requestIP(req)?.address);
		const now = Date.now();
		if (rateLimiter.isPairingRateLimited(clientKey, now)) {
			return apiError('rate_limited', 'Too many authentication failures', 429);
		}

		const normalized = typeof body.code === 'string' ? normalizePairingCode(body.code) : null;
		if (!normalized || !store.consumePairingCode(hashSecret(normalized), 'host', now)) {
			rateLimiter.recordPairingFailure(clientKey, now);
			return apiError('unauthorized', 'Invalid or expired host pairing code', 401);
		}

		const credential = generateSecret();
		socketHub.closeHostIfConnected(body.hostId, CloseCode.replaced, 're-paired with new credential');
		store.upsertHost(
			body.hostId,
			body.name.trim(),
			body.platform as Platform,
			body.appVersion.trim(),
			hashSecret(credential),
			now
		);

		socketHub.broadcastToClients({ type: 'hosts', hosts: socketHub.getAllHostSummaries() });

		const resBody: PairHostResponse = { hostId: body.hostId, credential };
		return Response.json(resBody, { headers: BASE_HEADERS });
	}

	// Recupero sessione dispositivo corrente.
	if (pathname === API.session) {
		if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		const device = authenticateDevice(req, store);
		if (!device) return apiError('unauthorized', 'Unauthorized session', 401);

		store.touchDevice(device.id, Date.now());
		const resBody: SessionResponse = { device: { id: device.id, name: device.name } };
		return Response.json(resBody, { headers: BASE_HEADERS });
	}

	// Logout e revoca del dispositivo corrente.
	if (pathname === API.logout) {
		if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		if (!isSameOrigin(req)) return apiError('forbidden_origin', 'Invalid Origin header', 403);

		const device = authenticateDevice(req, store);
		if (!device) return apiError('unauthorized', 'Unauthorized session', 401);

		store.revokeDevice(device.id);
		socketHub.revokeDeviceSockets(device.id);

		const isHttps = isRequestHttps(req);
		let cookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
		if (isHttps) cookie += '; Secure';

		return Response.json({ ok: true }, { headers: { ...BASE_HEADERS, 'Set-Cookie': cookie } });
	}

	// Creazione di un codice di abbinamento temporaneo.
	if (pathname === API.codes) {
		if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		if (!isSameOrigin(req)) return apiError('forbidden_origin', 'Invalid Origin header', 403);

		const body = await parseBody<CreateCodeRequest>(req);
		if (!body || (body.kind !== 'device' && body.kind !== 'host')) {
			return apiError('bad_request', 'Invalid pairing kind', 400);
		}

		// Autenticazione sincrona post-body: se il dispositivo e' stato revocato durante il parsing, la richiesta fallisce
		const device = authenticateDevice(req, store);
		if (!device) return apiError('unauthorized', 'Unauthorized session', 401);

		const now = Date.now();
		// Elimina codici usati o scaduti prima di valutare la quota attiva
		store.prunePairingCodes(now);

		if (store.countActiveCodesForDevice(device.id, now) >= MAX_ACTIVE_CODES_PER_DEVICE) {
			return apiError('rate_limited', 'Too many active pairing codes for device', 429);
		}

		const rawCode = generatePairingCode();
		const normalized = normalizePairingCode(rawCode);
		if (!normalized) return apiError('bad_request', 'Failed to generate code', 400);
		const expiresAt = now + PAIRING_CODE_TTL_MS;
		store.createPairingCode(hashSecret(normalized), body.kind as PairingKind, device.id, expiresAt);

		const resBody: CreateCodeResponse = {
			code: formatPairingCode(normalized),
			kind: body.kind,
			expiresAt
		};
		return Response.json(resBody, { headers: BASE_HEADERS });
	}

	// Elenco dei dispositivi registrati.
	if (pathname === API.devices) {
		if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		const currentDevice = authenticateDevice(req, store);
		if (!currentDevice) return apiError('unauthorized', 'Unauthorized session', 401);

		const devices = store.listDevices().map((d) => ({
			id: d.id,
			name: d.name,
			createdAt: d.createdAt,
			lastSeenAt: d.lastSeenAt,
			current: d.id === currentDevice.id,
			online: socketHub.isDeviceOnline(d.id)
		}));

		const resBody: DevicesResponse = { devices };
		return Response.json(resBody, { headers: BASE_HEADERS });
	}

	// Revoca di un dispositivo specifico.
	if (pathname.startsWith('/v1/devices/')) {
		if (req.method !== 'DELETE') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		if (!isSameOrigin(req)) return apiError('forbidden_origin', 'Invalid Origin header', 403);

		const currentDevice = authenticateDevice(req, store);
		if (!currentDevice) return apiError('unauthorized', 'Unauthorized session', 401);

		const targetId = pathname.slice('/v1/devices/'.length);
		const revoked = store.revokeDevice(targetId);
		if (!revoked) return apiError('not_found', 'Device not found', 404);

		socketHub.revokeDeviceSockets(targetId);
		return Response.json({ ok: true }, { headers: BASE_HEADERS });
	}

	// Elenco delle macchine registrate.
	if (pathname === API.hosts) {
		if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		const currentDevice = authenticateDevice(req, store);
		if (!currentDevice) return apiError('unauthorized', 'Unauthorized session', 401);

		const resBody: HostsResponse = { hosts: socketHub.getAllHostSummaries() };
		return Response.json(resBody, { headers: BASE_HEADERS });
	}

	// Eliminazione e revoca di una macchina registrata.
	if (pathname.startsWith('/v1/hosts/')) {
		if (req.method !== 'DELETE') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		if (!isSameOrigin(req)) return apiError('forbidden_origin', 'Invalid Origin header', 403);

		const currentDevice = authenticateDevice(req, store);
		if (!currentDevice) return apiError('unauthorized', 'Unauthorized session', 401);

		const targetId = pathname.slice('/v1/hosts/'.length);
		socketHub.closeHostIfConnected(targetId, CloseCode.revoked, 'host deleted');
		const deleted = store.deleteHost(targetId);
		if (!deleted) return apiError('not_found', 'Host not found', 404);

		socketHub.broadcastToClients({ type: 'hosts', hosts: socketHub.getAllHostSummaries() });
		return Response.json({ ok: true }, { headers: BASE_HEADERS });
	}

	// Recupero chiave pubblica VAPID per Web Push.
	if (pathname === API.pushVapidPublicKey) {
		if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
		const device = authenticateDevice(req, store);
		if (!device) return apiError('unauthorized', 'Unauthorized session', 401);

		if (!vapidKeys) {
			return apiError('service_unavailable', 'VAPID keys not ready', 503);
		}

		const resBody: VapidPublicKeyResponse = { publicKey: vapidKeys.publicKey };
		return Response.json(resBody, { headers: BASE_HEADERS });
	}

	// Registrazione di una sottoscrizione Web Push.
	if (pathname === API.pushSubscriptions && req.method === 'POST') {
		if (!isSameOrigin(req)) return apiError('forbidden_origin', 'Invalid Origin header', 403);

		const device = authenticateDevice(req, store);
		if (!device) return apiError('unauthorized', 'Unauthorized session', 401);

		const body = await parseBody<SavePushSubscriptionRequest>(req);
		if (
			!body ||
			!body.subscription ||
			!isValidPushEndpoint(body.subscription.endpoint) ||
			!isValidP256dh(body.subscription.keys?.p256dh) ||
			!isValidAuth(body.subscription.keys?.auth)
		) {
			return apiError('bad_request', 'Invalid push subscription parameters', 400);
		}

		const userAgent = typeof body.userAgent === 'string'
			? body.userAgent.slice(0, 500)
			: (req.headers.get('user-agent')?.slice(0, 500) ?? null);

		const subscriptionId = store.savePushSubscription(
			device.id,
			body.subscription.endpoint,
			body.subscription.keys.p256dh,
			body.subscription.keys.auth,
			userAgent,
			Date.now()
		);

		const resBody: SavePushSubscriptionResponse = { ok: true, subscriptionId };
		return Response.json(resBody, { headers: BASE_HEADERS });
	}

	// Cancellazione di una o tutte le sottoscrizioni Web Push del dispositivo.
	if (pathname === API.pushSubscriptions && req.method === 'DELETE') {
		if (!isSameOrigin(req)) return apiError('forbidden_origin', 'Invalid Origin header', 403);

		const device = authenticateDevice(req, store);
		if (!device) return apiError('unauthorized', 'Unauthorized session', 401);

		const body = await parseBody<DeletePushSubscriptionRequest>(req);
		store.deletePushSubscriptionsForDevice(device.id, body?.endpoint);

		return Response.json({ ok: true }, { headers: BASE_HEADERS });
	}

	// Qualsiasi percorso sotto /v1/ non gestito e' un endpoint API sconosciuto.
	if (pathname.startsWith('/v1/')) {
		return apiError('not_found', 'Not found', 404);
	}

	// Tutto cio' che non e' API viene servito come file statico PWA o fallback SPA.
	return servePwa(req, config.webDir);
}

function authenticateDevice(req: Request, store: RelayStore): DeviceRecord | null {
	const cookies = parseCookies(req.headers.get('cookie'));
	const token = cookies[SESSION_COOKIE];
	if (!token) return null;
	const device = store.findDeviceBySessionHash(hashSecret(token));
	if (!device || device.revoked) return null;
	return device;
}
