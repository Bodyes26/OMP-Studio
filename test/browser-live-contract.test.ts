import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	BLF1_MAGIC,
	BROWSER_LIVE_CAPABILITY_NAME,
	BROWSER_LIVE_ERROR_CODES,
	BROWSER_LIVE_EVENT_TYPES,
	BROWSER_LIVE_VERSION,
	STUDIO_BROWSER_LIVE_OFFER,
	browserLiveFrom,
	checkTicket,
	decodeBinaryFrame,
	encodeBinaryFrame,
	isBrowserLiveEventType,
	isLoopbackWebSocketEndpoint,
	negotiateCapabilities,
	parseBrowserFrameMeta,
	parseBrowserLiveClientMessage,
	parseBrowserLiveServerMessage,
	parseBrowserSessionIdentity,
	parseBrowserTabState,
	readAdvertisedCapabilities,
	shouldNegotiate,
	type BrowserFrameMeta,
	type BrowserSessionIdentity,
	type BrowserTabState,
	type RpcCapability
} from '../src/lib/agent/browser-live.ts';
import { resultImages } from '../src/lib/agent/tools/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(ROOT, 'test', 'fixtures', 'browser-live-v1.json');

/**
 * Copia del runtime OMP della stessa fixture. Non e' un percorso inventato: il
 * contratto vive in due repository e la fixture e' l'unico artefatto condiviso,
 * quindi quando il checkout separato e' presente la si confronta byte a byte.
 */
const UPSTREAM_FIXTURE = join(
	process.env.OMP_UPSTREAM_ROOT ?? join(ROOT, '..', 'oh-my-pi-upstream'),
	'packages',
	'coding-agent',
	'test',
	'fixtures',
	'browser-live-v1.json'
);

interface BrowserLiveFixture {
	contract: string;
	revision: string;
	capability: RpcCapability;
	fallback: { toolEvents: string[]; toolName: string; screenshotDetailsKey: string };
	eventTypes: string[];
	closeReasons: string[];
	errorCodes: string[];
	ticket: { ttlMs: number; transport: string; singlePresentation: boolean };
	readyFrames: { legacyRuntime: Record<string, unknown>; liveRuntime: Record<string, unknown> };
	negotiations: {
		case: string;
		offered: RpcCapability[];
		requested: unknown;
		accepted: RpcCapability[];
		browserLive: boolean;
	}[];
	endpoints: { endpoint: string; loopback: boolean }[];
	identity: BrowserSessionIdentity;
	tabState: { valid: BrowserTabState; invalid: { why: string; patch: Record<string, unknown> }[] };
	ticketRedemption: { case: string; expected: string }[];
	ticketRequest: { case: string; expected: string }[];
	binaryFrames: {
		magic: string;
		magicBytes: number[];
		headerLength: number;
		sampleMeta: BrowserFrameMeta;
	};
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as BrowserLiveFixture;

describe('Contratto browser-live-v1', () => {
	describe('fixture condivisa fra i due repository', () => {
		it('dichiara le stesse costanti del modulo Studio', () => {
			assert.equal(fixture.contract, 'browser-live-v1');
			assert.equal(fixture.capability.name, BROWSER_LIVE_CAPABILITY_NAME);
			assert.equal(fixture.capability.version, BROWSER_LIVE_VERSION);
			assert.deepEqual(fixture.eventTypes, [...BROWSER_LIVE_EVENT_TYPES]);
			assert.deepEqual(fixture.errorCodes, [...BROWSER_LIVE_ERROR_CODES]);
		});

		it("l'offerta di Studio coincide con la capability canonica", () => {
			assert.deepEqual(STUDIO_BROWSER_LIVE_OFFER, fixture.capability);
		});

		it(
			'la copia nel checkout del runtime OMP e identica byte a byte',
			{ skip: existsSync(UPSTREAM_FIXTURE) ? false : `checkout runtime assente: ${UPSTREAM_FIXTURE}` },
			() => {
				const studio = createHash('sha256').update(readFileSync(FIXTURE_PATH)).digest('hex');
				const runtime = createHash('sha256').update(readFileSync(UPSTREAM_FIXTURE)).digest('hex');
				assert.equal(runtime, studio, 'la fixture del runtime e quella di Studio sono divergenti');
			}
		);
	});

	describe('negoziazione delle capability', () => {
		for (const entry of fixture.negotiations) {
			it(`caso: ${entry.case}`, () => {
				const accepted = negotiateCapabilities(entry.offered, entry.requested);
				assert.deepEqual(accepted, entry.accepted);
				assert.equal(browserLiveFrom(accepted) !== null, entry.browserLive);
			});
		}

		it('un runtime precedente non annuncia capability e Studio non manda il comando', () => {
			const advertised = readAdvertisedCapabilities(fixture.readyFrames.legacyRuntime);
			assert.deepEqual(advertised, []);
			assert.equal(shouldNegotiate(advertised), false);
			assert.equal(browserLiveFrom(negotiateCapabilities(advertised, [STUDIO_BROWSER_LIVE_OFFER])), null);
		});

		it('un runtime nuovo annuncia browser-live e Studio negozia', () => {
			const advertised = readAdvertisedCapabilities(fixture.readyFrames.liveRuntime);
			assert.deepEqual(advertised, [fixture.capability]);
			assert.equal(shouldNegotiate(advertised), true);

			const accepted = negotiateCapabilities(advertised, [STUDIO_BROWSER_LIVE_OFFER]);
			const negotiated = browserLiveFrom(accepted);
			assert.ok(negotiated);
			assert.equal(negotiated.version, BROWSER_LIVE_VERSION);
			assert.equal(negotiated.transport, 'local-websocket');
			assert.deepEqual(negotiated.features, fixture.capability.features);
		});

		it('uno Studio precedente non manda nulla e il runtime non accetta nulla', () => {
			assert.deepEqual(negotiateCapabilities([fixture.capability], []), []);
		});

		it('un trasporto sconosciuto a questa build non abilita il live', () => {
			const exotic: RpcCapability = {
				name: BROWSER_LIVE_CAPABILITY_NAME,
				version: BROWSER_LIVE_VERSION,
				transports: ['quantum-tunnel'],
				features: []
			};
			assert.equal(browserLiveFrom([exotic]), null);
		});

		it('capability malformate o campi non array non fanno lanciare la negoziazione', () => {
			assert.deepEqual(readAdvertisedCapabilities(null), []);
			assert.deepEqual(readAdvertisedCapabilities({ capabilities: 'browser-live' }), []);
			assert.deepEqual(negotiateCapabilities([fixture.capability], 'browser-live'), []);
			assert.equal(browserLiveFrom(undefined), null);
		});
	});

	describe('endpoint loopback', () => {
		for (const entry of fixture.endpoints) {
			it(`classifica ${entry.endpoint || '(vuoto)'} come loopback=${entry.loopback}`, () => {
				assert.equal(isLoopbackWebSocketEndpoint(entry.endpoint), entry.loopback);
			});
		}
	});

	describe('identita e stato della tab', () => {
		it('accetta identita e stato validi della fixture', () => {
			assert.deepEqual(parseBrowserSessionIdentity(fixture.identity), fixture.identity);
			assert.deepEqual(parseBrowserTabState(fixture.tabState.valid), fixture.tabState.valid);
		});

		for (const entry of fixture.tabState.invalid) {
			it(`scarta lo stato non valido: ${entry.why}`, () => {
				assert.equal(parseBrowserTabState({ ...fixture.tabState.valid, ...entry.patch }), null);
			});
		}

		it('riconosce solo i tipi di evento del contratto', () => {
			for (const type of fixture.eventTypes) assert.equal(isBrowserLiveEventType(type), true);
			for (const type of fixture.fallback.toolEvents) assert.equal(isBrowserLiveEventType(type), false);
		});
	});

	describe('verifica del ticket lato Studio', () => {
		const identity = fixture.identity;
		const validTicket = {
			ticketId: 't-1',
			token: 'tok-1',
			endpoint: 'ws://127.0.0.1:53411/browser-live/v1',
			transport: 'local-websocket',
			identity,
			runtimePid: 4242,
			issuedAtMs: 1000,
			expiresAtMs: 1000 + fixture.ticket.ttlMs
		};

		it('accetta un ticket integro, loopback e non scaduto', () => {
			const check = checkTicket(validTicket, identity, 1500);
			assert.equal(check.ok, true);
			if (check.ok) assert.equal(check.value.endpoint, validTicket.endpoint);
		});

		it('rifiuta un endpoint non loopback', () => {
			const check = checkTicket({ ...validTicket, endpoint: 'ws://example.com/live' }, identity, 1500);
			assert.equal(check.ok, false);
			if (!check.ok) assert.equal(check.code, 'ENDPOINT_NOT_LOOPBACK');
		});

		it('rifiuta un ticket scaduto', () => {
			const check = checkTicket(validTicket, identity, validTicket.expiresAtMs);
			assert.equal(check.ok, false);
			if (!check.ok) assert.equal(check.code, 'TICKET_EXPIRED');
		});

		it("rifiuta un ticket emesso per un'altra chat", () => {
			const check = checkTicket(validTicket, { ...identity, chatSessionId: 'chat-altra' }, 1500);
			assert.equal(check.ok, false);
			if (!check.ok) assert.equal(check.code, 'TICKET_IDENTITY_MISMATCH');
		});

		it('rifiuta ticket incompleti, illeggibili o con trasporto ignoto', () => {
			for (const candidate of [null, 'ticket', {}, { ...validTicket, token: '' }]) {
				const check = checkTicket(candidate, identity, 1500);
				assert.equal(check.ok, false);
				if (!check.ok) assert.equal(check.code, 'TICKET_INVALID');
			}
			const wrongTransport = checkTicket({ ...validTicket, transport: 'shared-memory' }, identity, 1500);
			assert.equal(wrongTransport.ok, false);
			if (!wrongTransport.ok) assert.equal(wrongTransport.code, 'TICKET_INVALID');
		});
	});

	describe('fallback screenshot quando il live non e negoziato', () => {
		it('gli eventi di lifecycle del tool restano quelli attuali', () => {
			assert.deepEqual(fixture.fallback.toolEvents, [
				'tool_execution_start',
				'tool_execution_update',
				'tool_execution_end'
			]);
			assert.equal(fixture.fallback.toolName, 'browser');
		});

		it('il renderer continua a ricavare le immagini dal risultato del tool', () => {
			const details: Record<string, unknown> = {
				action: 'open',
				name: 'main',
				url: 'http://localhost:5173/',
				[fixture.fallback.screenshotDetailsKey]: [{ data: 'AAAA', mimeType: 'image/jpeg' }]
			};
			const result = {
				content: [
					{ type: 'text' as const, text: 'ok' },
					{ type: 'image' as const, data: 'AAAA', mimeType: 'image/jpeg' }
				],
				details
			};
			assert.deepEqual(resultImages(result), [{ data: 'AAAA', mimeType: 'image/jpeg' }]);
			assert.ok(Array.isArray(details[fixture.fallback.screenshotDetailsKey]));
		});
	});

	describe('wire format binario BLF1 (S40)', () => {
		it('dichiara header e magic coerenti con la fixture', () => {
			assert.equal(fixture.binaryFrames.magic, 'BLF1');
			assert.deepEqual([...BLF1_MAGIC], fixture.binaryFrames.magicBytes);
			assert.equal(fixture.binaryFrames.headerLength, 8);
		});

		it('codifica e decodifica frame binari senza perdita', () => {
			const sampleImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
			const encoded = encodeBinaryFrame(fixture.binaryFrames.sampleMeta, sampleImage);
			assert.ok(encoded.length > sampleImage.length + 8);

			const decoded = decodeBinaryFrame(encoded);
			assert.ok(decoded);
			assert.deepEqual(decoded.meta, fixture.binaryFrames.sampleMeta);
			assert.deepEqual(decoded.image, sampleImage);
		});

		it('rifiuta magic number corrotto o header tronco', () => {
			const sampleImage = new Uint8Array([1, 2, 3]);
			const encoded = encodeBinaryFrame(fixture.binaryFrames.sampleMeta, sampleImage);
			encoded[0] = 0x00;
			assert.equal(decodeBinaryFrame(encoded), null);
			assert.equal(decodeBinaryFrame(new Uint8Array([66, 76])), null);
		});

		it('rifiuta metadati malformati o lunghezze fuori range', () => {
			const sampleImage = new Uint8Array([1, 2, 3]);
			const encoded = encodeBinaryFrame(fixture.binaryFrames.sampleMeta, sampleImage);
			const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
			view.setUint32(4, 999999, false);
			assert.equal(decodeBinaryFrame(encoded), null);
		});

		it('parsa correttamente i messaggi di controllo client/server', () => {
			const clientRedeem = parseBrowserLiveClientMessage({
				type: 'redeem',
				token: 'tok-123',
				identity: fixture.identity
			});
			assert.ok(clientRedeem && clientRedeem.type === 'redeem');

			const clientAck = parseBrowserLiveClientMessage({ type: 'ack', sequence: 5 });
			assert.ok(clientAck && clientAck.type === 'ack' && clientAck.sequence === 5);

			const serverRedeemed = parseBrowserLiveServerMessage({
				type: 'redeemed',
				identity: fixture.identity,
				state: fixture.tabState.valid
			});
			assert.ok(serverRedeemed && serverRedeemed.type === 'redeemed');

			const serverError = parseBrowserLiveServerMessage({
				type: 'error',
				code: 'TICKET_INVALID',
				message: 'Token invalido'
			});
			assert.ok(serverError && serverError.type === 'error' && serverError.code === 'TICKET_INVALID');
		});
	});
});
