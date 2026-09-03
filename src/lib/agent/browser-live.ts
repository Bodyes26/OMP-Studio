// Mirror del contratto `browser-live-v1` fra runtime OMP e Studio.
//
// Perche' un mirror scritto a mano e non un pacchetto condiviso: vale la
// stessa regola di `wire.ts`. Generare i tipi dal repo di `omp` legherebbe
// Studio a una versione precisa del runtime, mentre qui la compatibilita' e'
// negoziata a runtime. La sorgente autoritativa e' `docs/BROWSER-STUDIO.md`;
// l'implementazione runtime vive in
// `packages/coding-agent/src/modes/rpc/browser-live.ts` del checkout separato
// di `can1357/oh-my-pi`, e le due parti condividono la fixture
// `test/fixtures/browser-live-v1.json`.
//
// Regola non negoziabile: **si fallisce chiusi**. Finche' la capability non e'
// negoziata Studio non tenta nessun endpoint, non interpreta nessun frame live
// e resta sul renderer screenshot alimentato da
// `tool_execution_start/update/end`.

import { Channel, invoke } from '@tauri-apps/api/core';

/* ------------------------------------------------------------- capability */

export interface RpcCapability {
	name: string;
	version: number;
	/** Trasporti supportati. Assente o vuoto significa inutilizzabile. */
	transports?: string[];
	/** Estensioni opzionali: un'intersezione vuota e' comunque valida. */
	features?: string[];
}

export const BROWSER_LIVE_CAPABILITY_NAME = 'browser-live';
export const BROWSER_LIVE_VERSION = 1;

export type BrowserLiveTransport = 'local-websocket';

export type BrowserLiveFeature =
	| 'binary-frames'
	| 'control-epochs'
	| 'private-takeover'
	| 'inspector'
	| 'chrome-relay';

/** Cio' che Studio sa fare oggi: e' l'offerta mandata in `negotiate_capabilities`. */
export const STUDIO_BROWSER_LIVE_OFFER: RpcCapability = {
	name: BROWSER_LIVE_CAPABILITY_NAME,
	version: BROWSER_LIVE_VERSION,
	transports: ['local-websocket'],
	features: ['binary-frames', 'control-epochs', 'private-takeover', 'inspector', 'chrome-relay']
};

function isCapabilityShape(value: unknown): value is RpcCapability {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	if (typeof record.name !== 'string' || record.name.length === 0) return false;
	if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) return false;
	if (record.transports !== undefined && !Array.isArray(record.transports)) return false;
	if (record.features !== undefined && !Array.isArray(record.features)) return false;
	return true;
}

/** Intersezione nell'ordine dell'offerente: il risultato non dipende dall'ordine del richiedente. */
function intersect(offered: unknown, requested: unknown): string[] {
	if (!Array.isArray(offered) || !Array.isArray(requested)) return [];
	const wanted = new Set(requested);
	const out: string[] = [];
	for (const entry of offered) {
		if (typeof entry !== 'string' || !wanted.has(entry) || out.includes(entry)) continue;
		out.push(entry);
	}
	return out;
}

/**
 * Intersezione delle capability. Stesso algoritmo, riga per riga, del runtime:
 * nome e versione devono coincidere esattamente e almeno un trasporto deve
 * essere condiviso. Tutto il resto viene scartato in silenzio.
 *
 * Studio la esegue anche in locale sul frame `ready` per decidere se vale la
 * pena mandare `negotiate_capabilities`; la parola definitiva resta la
 * risposta del runtime.
 */
export function negotiateCapabilities(offered: readonly RpcCapability[], requested: unknown): RpcCapability[] {
	const wanted = Array.isArray(requested) ? requested : [];
	const accepted: RpcCapability[] = [];
	const seen = new Set<string>();
	for (const want of wanted) {
		if (!isCapabilityShape(want)) continue;
		if (seen.has(want.name)) continue;
		const have = offered.find((entry) => entry.name === want.name && entry.version === want.version);
		if (!have) continue;
		const transports = intersect(have.transports, want.transports);
		if (transports.length === 0) continue;
		seen.add(want.name);
		accepted.push({
			name: have.name,
			version: have.version,
			transports,
			features: intersect(have.features, want.features)
		});
	}
	return accepted;
}

/** Capability annunciate nel frame `ready`. Un runtime precedente non manda il campo. */
export function readAdvertisedCapabilities(readyFrame: unknown): RpcCapability[] {
	if (!readyFrame || typeof readyFrame !== 'object') return [];
	const raw = (readyFrame as Record<string, unknown>).capabilities;
	if (!Array.isArray(raw)) return [];
	return raw.filter(isCapabilityShape);
}

/** Esito della negoziazione lato Studio: `null` = nessun live, si resta agli screenshot. */
export interface BrowserLiveNegotiation {
	version: number;
	transport: BrowserLiveTransport;
	features: BrowserLiveFeature[];
}

const KNOWN_TRANSPORTS: readonly BrowserLiveTransport[] = ['local-websocket'];
const KNOWN_FEATURES: readonly BrowserLiveFeature[] = [
	'binary-frames',
	'control-epochs',
	'private-takeover',
	'inspector',
	'chrome-relay'
];

/**
 * Legge `accepted` (dalla risposta del runtime, o dal calcolo locale) e
 * produce la negoziazione effettiva. Un trasporto sconosciuto a questa build
 * non e' un trasporto: si torna al fallback.
 */
export function browserLiveFrom(accepted: unknown): BrowserLiveNegotiation | null {
	if (!Array.isArray(accepted)) return null;
	const entry = accepted.filter(isCapabilityShape).find((candidate) => candidate.name === BROWSER_LIVE_CAPABILITY_NAME);
	if (!entry || entry.version !== BROWSER_LIVE_VERSION) return null;
	const transport = (entry.transports ?? []).find((candidate): candidate is BrowserLiveTransport =>
		(KNOWN_TRANSPORTS as readonly string[]).includes(candidate)
	);
	if (!transport) return null;
	return {
		version: entry.version,
		transport,
		features: (entry.features ?? []).filter((candidate): candidate is BrowserLiveFeature =>
			(KNOWN_FEATURES as readonly string[]).includes(candidate)
		)
	};
}

/**
 * Vale la pena spedire `negotiate_capabilities`? Solo se il runtime ha
 * annunciato qualcosa che Studio sa usare: contro un runtime precedente il
 * comando non parte affatto, e nessuna risposta di errore finisce nei log.
 */
export function shouldNegotiate(advertised: readonly RpcCapability[]): boolean {
	return negotiateCapabilities(advertised, [STUDIO_BROWSER_LIVE_OFFER]).length > 0;
}

/* -------------------------------------------------------------- identita' */

export interface BrowserSessionIdentity {
	projectId: string;
	chatSessionId: string;
	browserSessionId: string;
	tabId: string;
}

export type BrowserMode = 'managed' | 'chrome-relay';
export type BrowserController = 'agent' | 'user' | 'private-user';
export type BrowserOriginPermission = 'local' | 'granted' | 'pending' | 'denied';
export type BrowserStreamState = 'detached' | 'connecting' | 'live' | 'private' | 'failed';

export interface BrowserViewport {
	width: number;
	height: number;
	deviceScaleFactor: number;
}

export interface BrowserTabState extends BrowserSessionIdentity {
	mode: BrowserMode;
	controller: BrowserController;
	controlEpoch: number;
	url: string;
	title: string;
	loading: boolean;
	originPermission: BrowserOriginPermission;
	viewport: BrowserViewport;
	streamState: BrowserStreamState;
}

/** Metadati di ogni frame live. Viaggiano sul canale dedicato, mai sull'RPC. */
export interface BrowserFrameMeta {
	sequence: number;
	browserSessionId: string;
	tabId: string;
	timestampMs: number;
	viewportWidth: number;
	viewportHeight: number;
	deviceScaleFactor: number;
	scrollX: number;
	scrollY: number;
	controlEpoch: number;
	privacy: 'normal' | 'private';
	mimeType: 'image/jpeg' | 'image/png';
}

const MODES: readonly BrowserMode[] = ['managed', 'chrome-relay'];
const CONTROLLERS: readonly BrowserController[] = ['agent', 'user', 'private-user'];
const ORIGIN_PERMISSIONS: readonly BrowserOriginPermission[] = ['local', 'granted', 'pending', 'denied'];
const STREAM_STATES: readonly BrowserStreamState[] = ['detached', 'connecting', 'live', 'private', 'failed'];

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nonEmpty(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T | null {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function positive(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function parseBrowserSessionIdentity(value: unknown): BrowserSessionIdentity | null {
	const source = record(value);
	if (!source) return null;
	const projectId = nonEmpty(source.projectId);
	const chatSessionId = nonEmpty(source.chatSessionId);
	const browserSessionId = nonEmpty(source.browserSessionId);
	const tabId = nonEmpty(source.tabId);
	if (!projectId || !chatSessionId || !browserSessionId || !tabId) return null;
	return { projectId, chatSessionId, browserSessionId, tabId };
}

export function sameIdentity(a: BrowserSessionIdentity, b: BrowserSessionIdentity): boolean {
	return (
		a.projectId === b.projectId &&
		a.chatSessionId === b.chatSessionId &&
		a.browserSessionId === b.browserSessionId &&
		a.tabId === b.tabId
	);
}

/**
 * Parsing severo: a differenza dei `details` dei tool, qui un valore fuori
 * dall'enum non e' un campo mancante da ignorare ma uno stato che Studio non
 * sa disegnare. Meglio scartare il frame che mostrare un controller sbagliato.
 */
export function parseBrowserTabState(value: unknown): BrowserTabState | null {
	const identity = parseBrowserSessionIdentity(value);
	const source = record(value);
	if (!identity || !source) return null;
	const mode = member(source.mode, MODES);
	const controller = member(source.controller, CONTROLLERS);
	const originPermission = member(source.originPermission, ORIGIN_PERMISSIONS);
	const streamState = member(source.streamState, STREAM_STATES);
	const viewport = record(source.viewport);
	if (!mode || !controller || !originPermission || !streamState || !viewport) return null;
	const width = positive(viewport.width);
	const height = positive(viewport.height);
	const deviceScaleFactor = positive(viewport.deviceScaleFactor);
	if (width === null || height === null || deviceScaleFactor === null) return null;
	const controlEpoch = source.controlEpoch;
	if (typeof controlEpoch !== 'number' || !Number.isInteger(controlEpoch) || controlEpoch < 0) return null;
	if (typeof source.url !== 'string' || typeof source.title !== 'string') return null;
	if (typeof source.loading !== 'boolean') return null;
	return {
		...identity,
		mode,
		controller,
		controlEpoch,
		url: source.url,
		title: source.title,
		loading: source.loading,
		originPermission,
		viewport: { width, height, deviceScaleFactor },
		streamState
	};
}

/* ------------------------------------------------------- eventi ed errori */

export type BrowserLiveCloseReason = 'closed' | 'session-ended' | 'runtime-shutdown' | 'revoked' | 'failed';

export const BROWSER_LIVE_EVENT_TYPES = ['browser_live_tab_state', 'browser_live_closed'] as const;

export type BrowserLiveEventType = (typeof BROWSER_LIVE_EVENT_TYPES)[number];

export function isBrowserLiveEventType(type: unknown): type is BrowserLiveEventType {
	return typeof type === 'string' && (BROWSER_LIVE_EVENT_TYPES as readonly string[]).includes(type);
}

export const BROWSER_LIVE_ERROR_CODES = [
	'BROWSER_LIVE_UNAVAILABLE',
	'BROWSER_LIVE_NOT_NEGOTIATED',
	'TICKET_INVALID',
	'TICKET_EXPIRED',
	'TICKET_ALREADY_REDEEMED',
	'TICKET_IDENTITY_MISMATCH',
	'ENDPOINT_NOT_LOOPBACK',
	'SESSION_NOT_FOUND',
	'TAB_NOT_FOUND',
	'CONTROL_INTERRUPTED',
	'PRIVATE_TAKEOVER_ACTIVE',
	'ORIGIN_NOT_ALLOWED'
] as const;

export type BrowserLiveErrorCode = (typeof BROWSER_LIVE_ERROR_CODES)[number];

/* ---------------------------------------------------------------- ticket */

export interface BrowserLiveTicket {
	ticketId: string;
	/** Segreto monouso: non finisce in log, transcript, prompt o artifact. */
	token: string;
	endpoint: string;
	transport: BrowserLiveTransport;
	identity: BrowserSessionIdentity;
	runtimePid: number;
	issuedAtMs: number;
	expiresAtMs: number;
}

const LOOPBACK_HOSTS: Record<string, true> = { '127.0.0.1': true, localhost: true, '[::1]': true, '::1': true };

/** L'endpoint di un ticket e' un WebSocket in chiaro su loopback: nient'altro. */
export function isLoopbackWebSocketEndpoint(endpoint: unknown): boolean {
	if (typeof endpoint !== 'string' || endpoint.length === 0) return false;
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	if (url.protocol !== 'ws:') return false;
	return LOOPBACK_HOSTS[url.hostname] === true || LOOPBACK_HOSTS[`[${url.hostname}]`] === true;
}

export type BrowserLiveCheck<T> = { ok: true; value: T } | { ok: false; code: BrowserLiveErrorCode; message: string };

/**
 * Controllo lato Studio prima di aprire il canale live. Non sostituisce la
 * verifica del runtime al momento del riscatto: e' la meta' del fail-closed
 * che impedisce di connettersi a un endpoint che non e' loopback o a un
 * ticket che non appartiene a questa chat.
 */
export function checkTicket(
	value: unknown,
	expected: BrowserSessionIdentity,
	nowMs: number = Date.now()
): BrowserLiveCheck<BrowserLiveTicket> {
	const source = record(value);
	if (!source) return { ok: false, code: 'TICKET_INVALID', message: 'Ticket browser-live illeggibile' };
	const ticketId = nonEmpty(source.ticketId);
	const token = nonEmpty(source.token);
	const endpoint = nonEmpty(source.endpoint);
	const identity = parseBrowserSessionIdentity(source.identity);
	const runtimePid = positive(source.runtimePid);
	const issuedAtMs = source.issuedAtMs;
	const expiresAtMs = source.expiresAtMs;
	if (
		!ticketId ||
		!token ||
		!endpoint ||
		!identity ||
		runtimePid === null ||
		typeof issuedAtMs !== 'number' ||
		typeof expiresAtMs !== 'number'
	)
		return { ok: false, code: 'TICKET_INVALID', message: 'Ticket browser-live incompleto' };
	if (source.transport !== 'local-websocket')
		return { ok: false, code: 'TICKET_INVALID', message: 'Trasporto del ticket non supportato' };
	if (!isLoopbackWebSocketEndpoint(endpoint))
		return { ok: false, code: 'ENDPOINT_NOT_LOOPBACK', message: `Endpoint non loopback rifiutato: ${endpoint}` };
	if (nowMs >= expiresAtMs) return { ok: false, code: 'TICKET_EXPIRED', message: 'Ticket browser-live scaduto' };
	if (!sameIdentity(identity, expected))
		return { ok: false, code: 'TICKET_IDENTITY_MISMATCH', message: 'Ticket browser-live di un\u2019altra sessione' };
	return {
		ok: true,
		value: { ticketId, token, endpoint, transport: 'local-websocket', identity, runtimePid, issuedAtMs, expiresAtMs }
	};
}

/* --------------------------------------------------- wire format binario (S40) */

export const BLF1_MAGIC = new Uint8Array([0x42, 0x4c, 0x46, 0x31]); // "BLF1"

export function parseBrowserFrameMeta(value: unknown): BrowserFrameMeta | null {
	const source = record(value);
	if (!source) return null;
	const sequence = source.sequence;
	if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0) return null;
	const browserSessionId = nonEmpty(source.browserSessionId);
	const tabId = nonEmpty(source.tabId);
	if (!browserSessionId || !tabId) return null;
	const timestampMs = source.timestampMs;
	if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs)) return null;
	const viewportWidth = positive(source.viewportWidth);
	const viewportHeight = positive(source.viewportHeight);
	const deviceScaleFactor = positive(source.deviceScaleFactor);
	if (viewportWidth === null || viewportHeight === null || deviceScaleFactor === null) return null;
	const scrollX = typeof source.scrollX === 'number' && Number.isFinite(source.scrollX) ? source.scrollX : null;
	const scrollY = typeof source.scrollY === 'number' && Number.isFinite(source.scrollY) ? source.scrollY : null;
	if (scrollX === null || scrollY === null) return null;
	const controlEpoch = source.controlEpoch;
	if (typeof controlEpoch !== 'number' || !Number.isInteger(controlEpoch) || controlEpoch < 0) return null;
	const privacy = source.privacy === 'normal' || source.privacy === 'private' ? source.privacy : null;
	const mimeType = source.mimeType === 'image/jpeg' || source.mimeType === 'image/png' ? source.mimeType : null;
	if (!privacy || !mimeType) return null;
	return {
		sequence,
		browserSessionId,
		tabId,
		timestampMs,
		viewportWidth,
		viewportHeight,
		deviceScaleFactor,
		scrollX,
		scrollY,
		controlEpoch,
		privacy,
		mimeType
	};
}

export function encodeBinaryFrame(meta: BrowserFrameMeta, imageBytes: Uint8Array): Uint8Array {
	const metaJson = JSON.stringify(meta);
	const metaBytes = new TextEncoder().encode(metaJson);
	const totalLength = 8 + metaBytes.length + imageBytes.length;
	const out = new Uint8Array(totalLength);
	out.set(BLF1_MAGIC, 0);
	const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
	view.setUint32(4, metaBytes.length, false);
	out.set(metaBytes, 8);
	out.set(imageBytes, 8 + metaBytes.length);
	return out;
}

export function decodeBinaryFrame(data: Uint8Array): { meta: BrowserFrameMeta; image: Uint8Array } | null {
	if (data.length < 8) return null;
	if (
		data[0] !== BLF1_MAGIC[0] ||
		data[1] !== BLF1_MAGIC[1] ||
		data[2] !== BLF1_MAGIC[2] ||
		data[3] !== BLF1_MAGIC[3]
	) {
		return null;
	}
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const metaLen = view.getUint32(4, false);
	if (8 + metaLen > data.length) return null;
	const metaBytes = data.subarray(8, 8 + metaLen);
	const metaJson = new TextDecoder().decode(metaBytes);
	let parsed: unknown;
	try {
		parsed = JSON.parse(metaJson);
	} catch {
		return null;
	}
	const meta = parseBrowserFrameMeta(parsed);
	if (!meta) return null;
	const image = data.subarray(8 + metaLen);
	return { meta, image };
}

export type BrowserLiveClientMessage =
	| { type: 'redeem'; token: string; identity: BrowserSessionIdentity }
	| { type: 'ack'; sequence: number }
	| { type: 'ping' };

export type BrowserLiveServerMessage =
	| { type: 'redeemed'; identity: BrowserSessionIdentity; state: BrowserTabState }
	| { type: 'tab_state'; state: BrowserTabState }
	| { type: 'closed'; identity: BrowserSessionIdentity; reason: BrowserLiveCloseReason }
	| { type: 'error'; code: BrowserLiveErrorCode; message: string }
	| { type: 'pong' };

export function parseBrowserLiveClientMessage(value: unknown): BrowserLiveClientMessage | null {
	const source = record(value);
	if (!source || typeof source.type !== 'string') return null;
	if (source.type === 'redeem') {
		const token = nonEmpty(source.token);
		const identity = parseBrowserSessionIdentity(source.identity);
		if (!token || !identity) return null;
		return { type: 'redeem', token, identity };
	}
	if (source.type === 'ack') {
		const sequence = source.sequence;
		if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0) return null;
		return { type: 'ack', sequence };
	}
	if (source.type === 'ping') {
		return { type: 'ping' };
	}
	return null;
}

export function parseBrowserLiveServerMessage(value: unknown): BrowserLiveServerMessage | null {
	const source = record(value);
	if (!source || typeof source.type !== 'string') return null;
	if (source.type === 'redeemed') {
		const identity = parseBrowserSessionIdentity(source.identity);
		const state = parseBrowserTabState(source.state);
		if (!identity || !state) return null;
		return { type: 'redeemed', identity, state };
	}
	if (source.type === 'tab_state') {
		const state = parseBrowserTabState(source.state);
		if (!state) return null;
		return { type: 'tab_state', state };
	}
	if (source.type === 'closed') {
		const identity = parseBrowserSessionIdentity(source.identity);
		const reason = typeof source.reason === 'string' ? (source.reason as BrowserLiveCloseReason) : null;
		if (!identity || !reason) return null;
		return { type: 'closed', identity, reason };
	}
	if (source.type === 'error') {
		const code = typeof source.code === 'string' ? (source.code as BrowserLiveErrorCode) : null;
		const message = typeof source.message === 'string' ? source.message : '';
		if (!code) return null;
		return { type: 'error', code, message };
	}
	if (source.type === 'pong') {
		return { type: 'pong' };
	}
	return null;
}

/* ------------------------------------------- stream live ed eventi Tauri (S40) */

export type BrowserLiveEvent =
	| { type: 'connecting' }
	| { type: 'connected'; identity: BrowserSessionIdentity; state: unknown }
	| { type: 'frame'; meta: BrowserFrameMeta; imageBase64: string }
	| { type: 'tab_state'; state: unknown }
	| { type: 'closed'; identity: BrowserSessionIdentity; reason: string }
	| { type: 'error'; code: string; message: string }
	| { type: 'disconnected' };

/**
 * Avvia lo stream live tramite il backend Rust (Tauri).
 * Il token segreto e l'endpoint loopback vengono gestiti e verificati dal backend
 * senza esporre endpoint CDP o segreti non protetti al webview.
 */
export async function startBrowserLiveTauriStream(
	ticket: BrowserLiveTicket,
	onEvent: (event: BrowserLiveEvent) => void
): Promise<() => void> {
	const channel = new Channel<BrowserLiveEvent>();
	channel.onmessage = (event) => {
		onEvent(event);
	};
	const sessionId = await invoke<number>('browser_live_connect', {
		endpoint: ticket.endpoint,
		token: ticket.token,
		identity: ticket.identity,
		onEvent: channel
	});
	return () => {
		void invoke('browser_live_disconnect', { sessionId }).catch(() => {});
	};
}

/**
 * Stream WebSocket per ambienti di test / browser puro in cui Tauri non e' disponibile.
 */
export async function startBrowserLiveWebSocketStream(
	ticket: BrowserLiveTicket,
	onEvent: (event: BrowserLiveEvent) => void
): Promise<() => void> {
	const ws = new WebSocket(ticket.endpoint);
	onEvent({ type: 'connecting' });
	let closed = false;
	const disconnect = () => {
		if (closed) return;
		closed = true;
		ws.close();
		onEvent({ type: 'disconnected' });
	};

	ws.onopen = () => {
		if (closed) return;
		const redeemMsg: BrowserLiveClientMessage = {
			type: 'redeem',
			token: ticket.token,
			identity: ticket.identity
		};
		ws.send(JSON.stringify(redeemMsg));
	};

	ws.onmessage = (ev) => {
		if (closed) return;
		if (typeof ev.data === 'string') {
			let parsed: unknown;
			try {
				parsed = JSON.parse(ev.data);
			} catch {
				return;
			}
			const msg = parseBrowserLiveServerMessage(parsed);
			if (!msg) return;
			if (msg.type === 'redeemed') {
				onEvent({ type: 'connected', identity: msg.identity, state: msg.state });
			} else if (msg.type === 'tab_state') {
				onEvent({ type: 'tab_state', state: msg.state });
			} else if (msg.type === 'closed') {
				onEvent({ type: 'closed', identity: msg.identity, reason: msg.reason });
			} else if (msg.type === 'error') {
				onEvent({ type: 'error', code: msg.code, message: msg.message });
			}
			return;
		}

		// Binary frame
		const buf = ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data as ArrayBuffer);
		const decoded = decodeBinaryFrame(buf);
		if (!decoded) return;

		let binaryString = '';
		const chunkSize = 8192;
		for (let i = 0; i < decoded.image.length; i += chunkSize) {
			const chunk = decoded.image.subarray(i, i + chunkSize);
			binaryString += String.fromCharCode.apply(null, chunk as unknown as number[]);
		}
		const base64 = btoa(binaryString);

		onEvent({
			type: 'frame',
			meta: decoded.meta,
			imageBase64: base64
		});

		// Backpressure: ack al server
		const ackMsg: BrowserLiveClientMessage = {
			type: 'ack',
			sequence: decoded.meta.sequence
		};
		ws.send(JSON.stringify(ackMsg));
	};

	ws.onerror = () => {
		if (!closed) {
			onEvent({
				type: 'error',
				code: 'BROWSER_LIVE_UNAVAILABLE',
				message: 'Errore connessione WebSocket live'
			});
		}
	};

	ws.onclose = () => {
		if (!closed) {
			closed = true;
			onEvent({ type: 'disconnected' });
		}
	};

	return disconnect;
}

/**
 * Connette lo stream live selezionando automaticamente il trasporto nativo Tauri
 * o il WebSocket loopback diretto in ambiente browser / test.
 */
export async function connectBrowserLive(
	ticket: BrowserLiveTicket,
	onEvent: (event: BrowserLiveEvent) => void
): Promise<() => void> {
	if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
		return startBrowserLiveTauriStream(ticket, onEvent);
	}
	return startBrowserLiveWebSocketStream(ticket, onEvent);
}
