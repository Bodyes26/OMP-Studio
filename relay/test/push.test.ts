import { describe, expect, it, vi } from 'bun:test';
import type { Server } from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest } from '../src/api.ts';
import { hashSecret } from '../src/auth.ts';
import type { RelayConfig } from '../src/config.ts';
import {
	API,
	SESSION_COOKIE,
	type HostState,
	type PushNotificationPayload,
	type RemoteProject
} from '../src/protocol.ts';
import { decryptPushPayload, encryptPushPayload } from '../src/pushCrypto.ts';
import { PushSender } from '../src/pushSender.ts';
import { RateLimiter } from '../src/ratelimit.ts';
import { SocketHub } from '../src/sockets.ts';
import type { RelayWsData } from '../src/sockets.ts';

const dummyServer = {
	requestIP: () => ({ address: '127.0.0.1' }),
	upgrade: () => false
} as unknown as Server<RelayWsData>;
import { RelayStore } from '../src/store.ts';
import { HostSnapshotTriggerDetector } from '../src/triggers.ts';
import {
	createVapidHeaders,
	getOrCreateVapidKeys,
	isValidAuth,
	isValidP256dh,
	isValidPushEndpoint
} from '../src/vapid.ts';

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function mockConfig(dataDir: string): RelayConfig {
	return {
		port: 8787,
		hostname: '127.0.0.1',
		adminToken: 'test-admin-secret-0123456789abcdef0123456789',
		authTimeoutMs: 5000,
		heartbeatMs: 25000,
		maxDiagSessions: 4,
		dataDir,
		webDir: '/tmp',
		version: '1.0.0'
	};
}

describe('Web Push Cryptography (RFC 8291)', () => {
	it('riproduce esattamente il vettore di test RFC 8291 Appendice A', async () => {
		// Dati del vettore di test ufficiale RFC 8291
		const uaPublic = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
		const uaPrivate = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';
		const asPublic = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
		const asPrivate = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
		const salt = Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url');
		const authSecret = 'BTBZMqHH6r4Tts7J_aSIgg';
		const plaintext = 'When I grow up, I want to be a watermelon';

		const asPubBuf = Buffer.from(asPublic, 'base64url');
		const senderKeyPair = {
			publicKey: asPubBuf,
			privateKeyJwk: {
				kty: 'EC',
				crv: 'P-256',
				x: Buffer.from(asPubBuf.subarray(1, 33)).toString('base64url'),
				y: Buffer.from(asPubBuf.subarray(33, 65)).toString('base64url'),
				d: asPrivate
			}
		};

		const encrypted = await encryptPushPayload(plaintext, { p256dh: uaPublic, auth: authSecret }, {
			salt,
			senderKeyPair
		});

		// Verifica che l'intero corpo HTTP corrisponda al vettore RFC 8291 Sezione 5
		const expectedBody = Buffer.from(
			'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
			'base64url'
		);
		expect(encrypted.equals(expectedBody)).toBe(true);

		// Decifra con le credenziali del ricevitore
		const decrypted = await decryptPushPayload(encrypted, {
			p256dh: uaPublic,
			auth: authSecret,
			privateKey: uaPrivate
		});
		expect(decrypted.toString('utf8')).toBe(plaintext);
	});

	it('esegue round-trip di cifratura e decifratura con chiavi generate dinamicamente', async () => {
		const uaKeys = await crypto.subtle.generateKey(
			{ name: 'ECDH', namedCurve: 'P-256' },
			true,
			['deriveBits']
		);
		const uaPubRaw = Buffer.from(await crypto.subtle.exportKey('raw', uaKeys.publicKey));
		const uaJwk = (await crypto.subtle.exportKey('jwk', uaKeys.privateKey)) as { d: string };
		const authSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');

		const receiver = {
			p256dh: uaPubRaw.toString('base64url'),
			auth: authSecret,
			privateKey: uaJwk.d
		};

		const message = JSON.stringify({
			title: 'Macchina 1 · Progetto A',
			body: 'domanda dell agente',
			data: { hostId: 'h1', projectId: 'p1' }
		});

		const encrypted = await encryptPushPayload(message, receiver);
		expect(encrypted.length).toBeGreaterThan(86 + 16);

		const decrypted = await decryptPushPayload(encrypted, receiver);
		expect(decrypted.toString('utf8')).toBe(message);
	});
});

describe('VAPID e Persistenza SQLite', () => {
	it('genera e persiste la coppia di chiavi VAPID su SQLite sopravvivendo al riavvio', async () => {
		const dir = createTempDir('push-vapid-test-');
		try {
			const store1 = new RelayStore(dir);
			const vapid1 = await getOrCreateVapidKeys(store1);
			expect(vapid1.publicKey.length).toBeGreaterThan(40);
			store1.close();

			// Riapre lo store SQLite dalla stessa cartella
			const store2 = new RelayStore(dir);
			const vapid2 = await getOrCreateVapidKeys(store2);
			store2.close();

			// La chiave pubblica e' la medesima
			expect(vapid2.publicKey).toBe(vapid1.publicKey);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('crea intestazioni VAPID corrette secondo RFC 8292', async () => {
		const dir = createTempDir('push-headers-test-');
		try {
			const store = new RelayStore(dir);
			const vapid = await getOrCreateVapidKeys(store);
			store.close();

			const headers = await createVapidHeaders('https://fcm.googleapis.com/fcm/send/sub123', vapid, {
				ttlSeconds: 120,
				urgency: 'high'
			});

			expect(headers.TTL).toBe('120');
			expect(headers.Urgency).toBe('high');
			expect(headers.Authorization.startsWith('vapid t=')).toBe(true);
			expect(headers.Authorization.includes(`, k=${vapid.publicKey}`)).toBe(true);

			const match = headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
			expect(match).not.toBeNull();
			const token = match![1];
			const [headerB64, payloadB64, sigB64] = token.split('.');
			expect(headerB64).toBeDefined();
			expect(payloadB64).toBeDefined();
			expect(sigB64).toBeDefined();

			const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
			expect(payload.aud).toBe('https://fcm.googleapis.com');
			expect(payload.sub).toBe('mailto:admin@omp.local');
			expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('valida formato endpoint con allowlist anti-SSRF, p256dh e auth', () => {
		// Servizi push ufficiali ammessi
		expect(isValidPushEndpoint('https://fcm.googleapis.com/fcm/send/123')).toBe(true);
		expect(isValidPushEndpoint('https://android.googleapis.com/gcm/send/123')).toBe(true);
		expect(isValidPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/123')).toBe(true);
		expect(isValidPushEndpoint('https://web.push.apple.com/QN41...')).toBe(true);
		expect(isValidPushEndpoint('https://wns2-sn1p.notify.windows.com/w/?token=123')).toBe(true);

		// Rifiuta domini non consentiti o indirizzi IP / interni (prevenzione SSRF)
		expect(isValidPushEndpoint('https://evil.attacker.com/leak')).toBe(false);
		expect(isValidPushEndpoint('https://192.168.1.1/admin')).toBe(false);
		expect(isValidPushEndpoint('https://169.254.169.254/latest/meta-data/')).toBe(false);
		expect(isValidPushEndpoint('http://fcm.googleapis.com/test')).toBe(false);
		expect(isValidPushEndpoint('not-a-url')).toBe(false);

		// p256dh deve essere 65 byte con prefisso 0x04
		const validKey = Buffer.alloc(65);
		validKey[0] = 0x04;
		expect(isValidP256dh(validKey.toString('base64url'))).toBe(true);

		const invalidKeyShort = Buffer.alloc(32);
		expect(isValidP256dh(invalidKeyShort.toString('base64url'))).toBe(false);

		const invalidKeyPrefix = Buffer.alloc(65);
		invalidKeyPrefix[0] = 0x02;
		expect(isValidP256dh(invalidKeyPrefix.toString('base64url'))).toBe(false);

		// auth deve essere 16 byte
		expect(isValidAuth(Buffer.alloc(16).toString('base64url'))).toBe(true);
		expect(isValidAuth(Buffer.alloc(15).toString('base64url'))).toBe(false);
	});
});

describe('API Sottoscrizioni Push e Autorizzazione', () => {
	it('rifiuta richieste non autenticate o senza Origin corretto', async () => {
		const dir = createTempDir('push-api-auth-');
		try {
			const config = mockConfig(dir);
			const store = new RelayStore(dir);
			const rateLimiter = new RateLimiter();
			const socketHub = new SocketHub(config, store);
			const vapid = await getOrCreateVapidKeys(store);

			// 1. GET vapid-public-key senza cookie di sessione
			const req1 = new Request(`http://127.0.0.1:8787${API.pushVapidPublicKey}`);
			const res1 = await handleRequest(req1, dummyServer, config, store, rateLimiter, socketHub, vapid);
			expect(res1.status).toBe(401);

			// 2. POST subscriptions senza Origin
			const token = 'session-token-test-1234567890abcdef';
			const dev = store.createDevice('iPhone', hashSecret(token), Date.now());

			const req2 = new Request(`http://127.0.0.1:8787${API.pushSubscriptions}`, {
				method: 'POST',
				headers: {
					cookie: `${SESSION_COOKIE}=${token}`
				},
				body: JSON.stringify({ subscription: { endpoint: 'https://push.example.com' } })
			});
			const res2 = await handleRequest(req2, dummyServer, config, store, rateLimiter, socketHub, vapid);
			expect(res2.status).toBe(403);

			socketHub.stop();
			store.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('salva, elenca, applica tetto per dispositivo ed elimina sottoscrizioni', async () => {
		const dir = createTempDir('push-api-crud-');
		try {
			const config = mockConfig(dir);
			const store = new RelayStore(dir);
			const rateLimiter = new RateLimiter();
			const socketHub = new SocketHub(config, store);
			const vapid = await getOrCreateVapidKeys(store);

			const token = 'session-token-test-1234567890abcdef';
			const dev = store.createDevice('iPhone', hashSecret(token), Date.now());

			// GET VAPID key autenticata
			const reqKey = new Request(`http://127.0.0.1:8787${API.pushVapidPublicKey}`, {
				headers: { cookie: `${SESSION_COOKIE}=${token}` }
			});
			const resKey = await handleRequest(reqKey, dummyServer, config, store, rateLimiter, socketHub, vapid);
			expect(resKey.status).toBe(200);
			const keyJson = (await resKey.json()) as { publicKey: string };
			expect(keyJson.publicKey).toBe(vapid.publicKey);

			// Chiavi valide
			const p256buf = Buffer.alloc(65);
			p256buf[0] = 0x04;
			const p256dh = p256buf.toString('base64url');
			const auth = Buffer.alloc(16).toString('base64url');

			// Salva 5 sottoscrizioni
			for (let i = 1; i <= 5; i++) {
				const reqSub = new Request(`http://127.0.0.1:8787${API.pushSubscriptions}`, {
					method: 'POST',
					headers: {
						cookie: `${SESSION_COOKIE}=${token}`,
						origin: 'http://127.0.0.1:8787',
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						subscription: {
							endpoint: `https://fcm.googleapis.com/sub/${i}`,
							keys: { p256dh, auth }
						}
					})
				});
				const resSub = await handleRequest(reqSub, dummyServer, config, store, rateLimiter, socketHub, vapid);
				expect(resSub.status).toBe(200);
			}

			expect(store.getPushSubscriptionsForDevice(dev.id).length).toBe(5);

			// La 6a sottoscrizione provoca l'eliminazione della prima (tetto massimo 5)
			const reqSub6 = new Request(`http://127.0.0.1:8787${API.pushSubscriptions}`, {
				method: 'POST',
				headers: {
					cookie: `${SESSION_COOKIE}=${token}`,
					origin: 'http://127.0.0.1:8787',
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					subscription: {
						endpoint: `https://fcm.googleapis.com/sub/6`,
						keys: { p256dh, auth }
					}
				})
			});
			const resSub6 = await handleRequest(reqSub6, dummyServer, config, store, rateLimiter, socketHub, vapid);
			expect(resSub6.status).toBe(200);
			const subsAfter6 = store.getPushSubscriptionsForDevice(dev.id);
			expect(subsAfter6.length).toBe(5);
			expect(subsAfter6.some((s) => s.endpoint === 'https://fcm.googleapis.com/sub/1')).toBe(false);
			expect(subsAfter6.some((s) => s.endpoint === 'https://fcm.googleapis.com/sub/6')).toBe(true);

			// Eliminazione di una specifica sottoscrizione
			const reqDelOne = new Request(`http://127.0.0.1:8787${API.pushSubscriptions}`, {
				method: 'DELETE',
				headers: {
					cookie: `${SESSION_COOKIE}=${token}`,
					origin: 'http://127.0.0.1:8787',
					'content-type': 'application/json'
				},
				body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/sub/6' })
			});
			const resDelOne = await handleRequest(reqDelOne, dummyServer, config, store, rateLimiter, socketHub, vapid);
			expect(resDelOne.status).toBe(200);
			expect(store.getPushSubscriptionsForDevice(dev.id).length).toBe(4);

			// Revoca del dispositivo rimuove tutte le sue sottoscrizioni
			store.revokeDevice(dev.id);
			expect(store.getPushSubscriptionsForDevice(dev.id).length).toBe(0);

			socketHub.stop();
			store.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('Rilevamento Trigger (HostSnapshotTriggerDetector)', () => {
	function makeState(projects: RemoteProject[]): HostState {
		return {
			projects,
			quota: null
		};
	}

	it('non emette notifiche al primo avvio se lo stato e identico all ultimo persistito in SQLite', () => {
		const dir = createTempDir('trigger-restart-');
		try {
			const store = new RelayStore(dir);
			const hostId = '00000000-0000-4000-8000-000000000001';
			const initialProject: RemoteProject = {
				id: 'p1',
				name: 'Progetto Alpha',
				hue: 200,
				active: true,
				lanes: [
					{
						id: 'main',
						title: 'Principale',
						kind: 'main',
						agent: {
							state: 'idle',
							surface: 'gui',
							provider: null,
							modelId: null,
							modelLabel: null,
							activity: null,
							headsUp: null
						}
					}
				],
				attention: [
					{
						requestId: 'req-initial-1',
						laneId: 'main',
						laneTitle: 'Principale',
						method: 'confirm',
						title: 'Confermi azione?',
						message: null,
						options: [],
						placeholder: null,
						prefill: null,
						questions: [],
						deadline: null,
						quotaBlocked: null,
						recentMessages: []
					}
				],
				tasks: [],
				autoDispatch: false,
				canRunTask: true,
				runBlockReason: null
			};

			const state1 = makeState([initialProject]);
			store.upsertHost(hostId, 'MacBook Pro', 'macos', '1.0.0', 'hash', Date.now());
			store.saveHostState(hostId, state1, Date.now());

			const fired: PushNotificationPayload[] = [];
			const detector = new HostSnapshotTriggerDetector(store, {
				debounceMs: 50,
				onNotification(p) {
					fired.push(p);
				}
			});

			// Primo snapshot identico a quello persistito prima del riavvio
			detector.processSnapshot(hostId, 'MacBook Pro', state1);

			// Nessuna notifica deve essere emessa (no-spam al riavvio)
			expect(fired.length).toBe(0);

			detector.destroy();
			store.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('rileva nuova richiesta di attenzione, deduplica per requestId e nomina la macchina', () => {
		const dir = createTempDir('trigger-attention-');
		try {
			const store = new RelayStore(dir);
			const hostId = '00000000-0000-4000-8000-000000000001';
			store.upsertHost(hostId, 'MacBook Pro', 'macos', '1.0.0', 'hash', Date.now());

			const fired: PushNotificationPayload[] = [];
			const detector = new HostSnapshotTriggerDetector(store, {
				debounceMs: 50,
				onNotification(p) {
					fired.push(p);
				}
			});

			const emptyProject: RemoteProject = {
				id: 'p1',
				name: 'Progetto Alpha',
				hue: 200,
				active: true,
				lanes: [],
				attention: [],
				tasks: [],
				autoDispatch: false,
				canRunTask: true,
				runBlockReason: null
			};

			// Stato 1: vuoto
			detector.processSnapshot(hostId, 'MacBook Pro', makeState([emptyProject]));
			expect(fired.length).toBe(0);

			// Stato 2: nuova richiesta di attenzione
			const projectWithAttention: RemoteProject = {
				...emptyProject,
				attention: [
					{
						requestId: 'req-new-question',
						laneId: 'main',
						laneTitle: 'Principale',
						method: 'ask',
						title: 'Procedere con l eliminazione?',
						message: null,
						options: [],
						placeholder: null,
						prefill: null,
						questions: [],
						deadline: null,
						quotaBlocked: null,
						recentMessages: []
					}
				]
			};

			detector.processSnapshot(hostId, 'MacBook Pro', makeState([projectWithAttention]));
			expect(fired.length).toBe(1);
			expect(fired[0].title).toBe('MacBook Pro · Progetto Alpha');
			expect(fired[0].body).toContain('Procedere con l eliminazione?');
			expect(fired[0].data?.requestId).toBe('req-new-question');

			// Stato 3: stesso snapshot con la stessa richiesta (dedupe)
			detector.processSnapshot(hostId, 'MacBook Pro', makeState([projectWithAttention]));
			expect(fired.length).toBe(1); // non viene duplicata

			detector.destroy();
			store.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('consente a un fornitore di quota tornato disponibile di notificare nuovamente quando si esaurisce di nuovo', () => {
		const dir = createTempDir('trigger-quota-recovery-');
		try {
			const store = new RelayStore(dir);
			const hostId = '00000000-0000-4000-8000-000000000001';
			store.upsertHost(hostId, 'Mac Studio', 'macos', '1.0.0', 'hash', Date.now());

			const fired: PushNotificationPayload[] = [];
			const detector = new HostSnapshotTriggerDetector(store, {
				onNotification(p) {
					fired.push(p);
				}
			});

			const makeQuotaState = (status: 'ok' | 'exhausted'): HostState => ({
				projects: [],
				quota: {
					fetchedAt: Date.now(),
					providers: [
						{
							provider: 'anthropic',
							account: 'main',
							status,
							windows: []
						}
					]
				}
			});

			// 1. Stato iniziale: ok
			detector.processSnapshot(hostId, 'Mac Studio', makeQuotaState('ok'));
			expect(fired.length).toBe(0);

			// 2. Transizione a exhausted -> notifica
			detector.processSnapshot(hostId, 'Mac Studio', makeQuotaState('exhausted'));
			expect(fired.length).toBe(1);
			expect(fired[0].title).toBe('Mac Studio');
			expect(fired[0].body).toContain('Quota esaurita per anthropic');

			// 3. Stesso stato exhausted -> dedupe, non notifica di nuovo
			detector.processSnapshot(hostId, 'Mac Studio', makeQuotaState('exhausted'));
			expect(fired.length).toBe(1);

			// 4. Ripristino a ok -> stato recuperato
			detector.processSnapshot(hostId, 'Mac Studio', makeQuotaState('ok'));
			expect(fired.length).toBe(1);

			// 5. Nuova transizione a exhausted -> deve notificare di nuovo
			detector.processSnapshot(hostId, 'Mac Studio', makeQuotaState('exhausted'));
			expect(fired.length).toBe(2);

			detector.destroy();
			store.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('rileva transizione della corsia working -> idle con debounce anti-flapping', () => {
		vi.useFakeTimers();
		const dir = createTempDir('trigger-debounce-');
		try {
			const store = new RelayStore(dir);
			const hostId = '00000000-0000-4000-8000-000000000001';
			store.upsertHost(hostId, 'Studio Mac', 'macos', '1.0.0', 'hash', Date.now());

			const fired: PushNotificationPayload[] = [];
			const detector = new HostSnapshotTriggerDetector(store, {
				debounceMs: 60,
				onNotification(p) {
					fired.push(p);
				}
			});

			const makeLaneState = (agentState: 'working' | 'idle') =>
				makeState([
					{
						id: 'p1',
						name: 'App',
						hue: 120,
						active: true,
						lanes: [
							{
								id: 'lane-1',
								title: 'Rifattorizzazione',
								kind: 'worktree',
								agent: {
									state: agentState,
									surface: 'gui',
									provider: null,
									modelId: null,
									modelLabel: null,
									activity: null,
									headsUp: null
								}
							}
						],
						attention: [],
						tasks: [],
						autoDispatch: false,
						canRunTask: true,
						runBlockReason: null
					}
				]);

			// 1. Stato iniziale: corsia sta lavorando
			detector.processSnapshot(hostId, 'Studio Mac', makeLaneState('working'));
			expect(fired.length).toBe(0);

			// 2. Transizione a idle: avvia debounce
			detector.processSnapshot(hostId, 'Studio Mac', makeLaneState('idle'));
			expect(fired.length).toBe(0); // non ancora emessa perche' debounced

			// Attende che scada il debounce (60ms)
			vi.advanceTimersByTime(80);
			expect(fired.length).toBe(1);
			expect(fired[0].title).toBe('Studio Mac · App');
			expect(fired[0].body).toContain('ha finito');

			// 3. Test cancellazione debounce su flapping: working -> idle -> working prima dello scadere
			detector.processSnapshot(hostId, 'Studio Mac', makeLaneState('working'));
			detector.processSnapshot(hostId, 'Studio Mac', makeLaneState('idle'));
			// Torna subito a working
			detector.processSnapshot(hostId, 'Studio Mac', makeLaneState('working'));

			vi.advanceTimersByTime(80);
			// Nessuna nuova notifica emessa
			expect(fired.length).toBe(1);

			detector.destroy();
			store.close();
		} finally {
			vi.useRealTimers();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('PushSender e Gestione 404/410', () => {
	it('invia il payload cifrato al servizio push e rimuove automaticamente le sottoscrizioni 404/410', async () => {
		const dir = createTempDir('sender-test-');
		try {
			const store = new RelayStore(dir);
			const vapid = await getOrCreateVapidKeys(store);

			const dev1 = store.createDevice('iPhone', 'h1', Date.now());
			const dev2 = store.createDevice('Pixel', 'h2', Date.now());

			const realEcKey = await crypto.subtle.generateKey(
				{ name: 'ECDH', namedCurve: 'P-256' },
				true,
				['deriveBits']
			);
			const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', realEcKey.publicKey)).toString('base64url');
			const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
			store.savePushSubscription(dev1.id, 'https://fcm.googleapis.com/sub/valid', p256dh, auth, 'UA1', Date.now());
			store.savePushSubscription(dev2.id, 'https://fcm.googleapis.com/sub/expired', p256dh, auth, 'UA2', Date.now());

			let capturedRedirect: string | undefined;
			const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
				capturedRedirect = init?.redirect;
				const urlStr = url.toString();
				if (urlStr.includes('/valid')) {
					return new Response(null, { status: 201 });
				}
				if (urlStr.includes('/expired')) {
					return new Response('Not found', { status: 410 });
				}
				return new Response(null, { status: 500 });
			};

			const sender = new PushSender(store, vapid, mockFetch as unknown as typeof fetch);

			const result = await sender.send({
				title: 'MacBook · Project',
				body: 'Attenzione richiesta'
			});

			expect(result.sent).toBe(1);
			expect(capturedRedirect).toBe('error');
			expect(result.dropped).toBe(1);

			// La sottoscrizione 410 e' stata rimossa dallo store
			const remainingDev2 = store.getPushSubscriptionsForDevice(dev2.id);
			expect(remainingDev2.length).toBe(0);

			// Quella valida e' rimasta
			const remainingDev1 = store.getPushSubscriptionsForDevice(dev1.id);
			expect(remainingDev1.length).toBe(1);

			store.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('consegna a tutte le sottoscrizioni dello stesso dispositivo senza bloccare la seconda per rate limit', async () => {
		const dir = createTempDir('sender-multisub-');
		try {
			const store = new RelayStore(dir);
			const vapid = await getOrCreateVapidKeys(store);
			const dev = store.createDevice('iPad', 'h1', Date.now());

			const realEcKey = await crypto.subtle.generateKey(
				{ name: 'ECDH', namedCurve: 'P-256' },
				true,
				['deriveBits']
			);
			const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', realEcKey.publicKey)).toString('base64url');
			const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');

			store.savePushSubscription(dev.id, 'https://fcm.googleapis.com/sub/tab1', p256dh, auth, 'UA1', Date.now());
			store.savePushSubscription(dev.id, 'https://fcm.googleapis.com/sub/tab2', p256dh, auth, 'UA2', Date.now());

			let fetchCount = 0;
			const mockFetch = async (): Promise<Response> => {
				fetchCount++;
				return new Response(null, { status: 201 });
			};

			const sender = new PushSender(store, vapid, mockFetch as unknown as typeof fetch);

			// Primo invio: entrambe le sottoscrizioni del dispositivo devono essere recapitate
			const result1 = await sender.send({
				title: 'MacBook · Project',
				body: 'Domanda 1'
			});

			expect(result1.sent).toBe(2);
			expect(result1.rateLimited).toBe(0);
			expect(fetchCount).toBe(2);

			// Secondo invio immediato: il dispositivo viene rate-limited una sola volta
			const result2 = await sender.send({
				title: 'MacBook · Project',
				body: 'Domanda 2'
			});

			expect(result2.sent).toBe(0);
			expect(result2.rateLimited).toBe(1);
			expect(fetchCount).toBe(2);

			store.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('blocca tentativi SSRF all invio e rimuove l endpoint non consentito', async () => {
		const dir = createTempDir('sender-ssrf-');
		try {
			const store = new RelayStore(dir);
			const vapid = await getOrCreateVapidKeys(store);
			const dev = store.createDevice('AttackerPhone', 'h1', Date.now());

			const realEcKey = await crypto.subtle.generateKey(
				{ name: 'ECDH', namedCurve: 'P-256' },
				true,
				['deriveBits']
			);
			const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', realEcKey.publicKey)).toString('base64url');
			const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');

			// Sottoscrizione inserita direttamente
			store.savePushSubscription(dev.id, 'https://169.254.169.254/latest/meta-data', p256dh, auth, 'UA', Date.now());

			let fetchCalled = false;
			const mockFetch = async (): Promise<Response> => {
				fetchCalled = true;
				return new Response(null, { status: 200 });
			};

			const sender = new PushSender(store, vapid, mockFetch as unknown as typeof fetch);
			const result = await sender.send({ title: 'T', body: 'B' });

			expect(fetchCalled).toBe(false);
			expect(result.dropped).toBe(1);
			expect(result.sent).toBe(0);
			expect(store.getPushSubscriptionsForDevice(dev.id).length).toBe(0);

			store.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
