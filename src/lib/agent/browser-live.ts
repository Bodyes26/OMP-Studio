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

/* ------------------------------------------- inspector mirato types (S44) */

export interface InspectedElementData {
	tag: string;
	role?: string;
	accessibleName?: string;
	text?: string;
	selector: string;
	boundingBox: { x: number; y: number; width: number; height: number };
	computedStyles: Record<string, string>;
	component?: string;
	screenshotBase64?: string;
}

export interface ConsoleEntry {
	id: string;
	level: 'log' | 'info' | 'warn' | 'error' | 'debug';
	text: string;
	timestamp: number;
	count: number;
	stackTrace?: string;
	url?: string;
	line?: number;
}

export interface NetworkEntry {
	id: string;
	requestId: string;
	url: string;
	method: string;
	status: number;
	statusText: string;
	mimeType: string;
	resourceType: string;
	durationMs: number;
	timestamp: number;
	failed: boolean;
	errorText?: string;
	headers?: Record<string, string>;
	hasBody?: boolean;
	body?: string;
}

export type ActionKind =
	| 'navigation'
	| 'agent_action'
	| 'takeover'
	| 'privacy'
	| 'dialog'
	| 'download'
	| 'tab_change';

export interface ActionEntry {
	id: string;
	timestamp: number;
	kind: ActionKind;
	label: string;
	details?: string;
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
	| { type: 'takeover'; expectedEpoch: number; input?: BrowserInputEvent }
	| { type: 'input'; epoch: number; input: BrowserInputEvent }
	| { type: 'return_control'; epoch: number }
	| { type: 'set_privacy'; privacy: 'normal' | 'private' }
	| { type: 'inspect_point'; x: number; y: number }
	| { type: 'inspect_element'; selector?: string; point?: { x: number; y: number } }
	| { type: 'set_inspector'; enabled: boolean; console?: boolean; network?: boolean }
	| { type: 'request_network_body'; requestId: string }
	| { type: 'clear_buffer'; target: 'console' | 'network' | 'actions' | 'all' }
	| { type: 'ping' };

export type BrowserLiveServerMessage =
	| { type: 'redeemed'; identity: BrowserSessionIdentity; state: BrowserTabState }
	| { type: 'tab_state'; state: BrowserTabState }
	| { type: 'closed'; identity: BrowserSessionIdentity; reason: BrowserLiveCloseReason }
	| { type: 'error'; code: BrowserLiveErrorCode; message: string }
	| { type: 'control_interrupted'; epoch: number; reason: string }
	| { type: 'snapshot'; epoch: number; snapshot: unknown }
	| { type: 'inspected_element'; element: InspectedElementData }
	| { type: 'console_entry'; entry: ConsoleEntry }
	| { type: 'network_entry'; entry: NetworkEntry }
	| { type: 'network_body_response'; requestId: string; body?: string; error?: string }
	| { type: 'action_entry'; entry: ActionEntry }
	| { type: 'pong' };
export function parseBrowserInputEvent(value: unknown): BrowserInputEvent | null {
	const source = record(value);
	if (!source || typeof source.type !== 'string') return null;
	const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

	switch (source.type) {
		case 'mouse_move': {
			if (!isNum(source.x) || !isNum(source.y) || typeof source.buttons !== 'number') return null;
			return { type: 'mouse_move', x: source.x, y: source.y, buttons: source.buttons };
		}
		case 'mouse_down': {
			if (!isNum(source.x) || !isNum(source.y) || typeof source.button !== 'number' || typeof source.buttons !== 'number') return null;
			const clickCount = typeof source.clickCount === 'number' ? source.clickCount : 1;
			return { type: 'mouse_down', x: source.x, y: source.y, button: source.button, buttons: source.buttons, clickCount };
		}
		case 'mouse_up': {
			if (!isNum(source.x) || !isNum(source.y) || typeof source.button !== 'number' || typeof source.buttons !== 'number') return null;
			return { type: 'mouse_up', x: source.x, y: source.y, button: source.button, buttons: source.buttons };
		}
		case 'click': {
			if (!isNum(source.x) || !isNum(source.y) || typeof source.button !== 'number') return null;
			const detail = typeof source.detail === 'number' ? source.detail : 1;
			return { type: 'click', x: source.x, y: source.y, button: source.button, detail };
		}
		case 'double_click': {
			if (!isNum(source.x) || !isNum(source.y)) return null;
			return { type: 'double_click', x: source.x, y: source.y };
		}
		case 'wheel': {
			if (!isNum(source.x) || !isNum(source.y) || !isNum(source.deltaX) || !isNum(source.deltaY)) return null;
			return { type: 'wheel', x: source.x, y: source.y, deltaX: source.deltaX, deltaY: source.deltaY };
		}
		case 'drag_start':
		case 'drag_move':
		case 'drag_end': {
			if (!isNum(source.x) || !isNum(source.y)) return null;
			return { type: source.type, x: source.x, y: source.y };
		}
		case 'key_down':
		case 'key_up': {
			if (typeof source.key !== 'string' || typeof source.code !== 'string') return null;
			const mods = record(source.modifiers) ?? {};
			const modifiers = {
				alt: Boolean(mods.alt),
				ctrl: Boolean(mods.ctrl),
				meta: Boolean(mods.meta),
				shift: Boolean(mods.shift)
			};
			return { type: source.type, key: source.key, code: source.code, modifiers };
		}
		default:
			return null;
	}
}

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
	if (source.type === 'takeover') {
		const expectedEpoch = source.expectedEpoch;
		if (typeof expectedEpoch !== 'number' || !Number.isInteger(expectedEpoch) || expectedEpoch < 0) return null;
		const input = source.input ? parseBrowserInputEvent(source.input) : undefined;
		if (source.input && !input) return null;
		return { type: 'takeover', expectedEpoch, ...(input ? { input } : {}) };
	}
	if (source.type === 'input') {
		const epoch = source.epoch;
		if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) return null;
		const input = parseBrowserInputEvent(source.input);
		if (!input) return null;
		return { type: 'input', epoch, input };
	}
	if (source.type === 'return_control') {
		const epoch = source.epoch;
		if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) return null;
		return { type: 'return_control', epoch };
	}
	if (source.type === 'set_privacy') {
		const privacy = source.privacy === 'normal' || source.privacy === 'private' ? source.privacy : null;
		if (!privacy) return null;
		return { type: 'set_privacy', privacy };
	}
	if (source.type === 'inspect_point') {
		if (typeof source.x !== 'number' || typeof source.y !== 'number') return null;
		return { type: 'inspect_point', x: source.x, y: source.y };
	}
	if (source.type === 'inspect_element') {
		const selector = typeof source.selector === 'string' ? source.selector : undefined;
		const pt = record(source.point);
		const point = pt && typeof pt.x === 'number' && typeof pt.y === 'number' ? { x: pt.x, y: pt.y } : undefined;
		return { type: 'inspect_element', ...(selector ? { selector } : {}), ...(point ? { point } : {}) };
	}
	if (source.type === 'set_inspector') {
		const enabled = Boolean(source.enabled);
		const cons = typeof source.console === 'boolean' ? source.console : undefined;
		const net = typeof source.network === 'boolean' ? source.network : undefined;
		return { type: 'set_inspector', enabled, ...(cons !== undefined ? { console: cons } : {}), ...(net !== undefined ? { network: net } : {}) };
	}
	if (source.type === 'request_network_body') {
		const requestId = nonEmpty(source.requestId);
		if (!requestId) return null;
		return { type: 'request_network_body', requestId };
	}
	if (source.type === 'clear_buffer') {
		const target = member(source.target, ['console', 'network', 'actions', 'all'] as const);
		if (!target) return null;
		return { type: 'clear_buffer', target };
	}
	if (source.type === 'ping') {
		return { type: 'ping' };
	}
	return null;
}

export function parseInspectedElementData(value: unknown): InspectedElementData | null {
	const source = record(value);
	if (!source) return null;
	const tag = nonEmpty(source.tag);
	const selector = nonEmpty(source.selector);
	const bbox = record(source.boundingBox);
	if (!tag || !selector || !bbox) return null;
	if (
		typeof bbox.x !== 'number' ||
		typeof bbox.y !== 'number' ||
		typeof bbox.width !== 'number' ||
		typeof bbox.height !== 'number'
	) {
		return null;
	}
	const computedStyles = record(source.computedStyles) ?? {};
	const stringStyles: Record<string, string> = {};
	for (const [k, v] of Object.entries(computedStyles)) {
		if (typeof v === 'string') stringStyles[k] = v;
	}
	return {
		tag,
		role: typeof source.role === 'string' ? source.role : undefined,
		accessibleName: typeof source.accessibleName === 'string' ? source.accessibleName : undefined,
		text: typeof source.text === 'string' ? source.text : undefined,
		selector,
		boundingBox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
		computedStyles: stringStyles,
		component: typeof source.component === 'string' ? source.component : undefined,
		screenshotBase64: typeof source.screenshotBase64 === 'string' ? source.screenshotBase64 : undefined
	};
}

export function parseConsoleEntry(value: unknown): ConsoleEntry | null {
	const source = record(value);
	if (!source) return null;
	const id = nonEmpty(source.id);
	const level = member(source.level, ['log', 'info', 'warn', 'error', 'debug'] as const);
	if (!id || !level || typeof source.text !== 'string' || typeof source.timestamp !== 'number') return null;
	const count = typeof source.count === 'number' && Number.isInteger(source.count) && source.count > 0 ? source.count : 1;
	return {
		id,
		level,
		text: source.text,
		timestamp: source.timestamp,
		count,
		stackTrace: typeof source.stackTrace === 'string' ? source.stackTrace : undefined,
		url: typeof source.url === 'string' ? source.url : undefined,
		line: typeof source.line === 'number' ? source.line : undefined
	};
}

export function parseNetworkEntry(value: unknown): NetworkEntry | null {
	const source = record(value);
	if (!source) return null;
	const id = nonEmpty(source.id);
	const requestId = nonEmpty(source.requestId);
	if (!id || !requestId || typeof source.url !== 'string' || typeof source.method !== 'string') return null;
	const status = typeof source.status === 'number' ? source.status : 0;
	const statusText = typeof source.statusText === 'string' ? source.statusText : '';
	const mimeType = typeof source.mimeType === 'string' ? source.mimeType : '';
	const resourceType = typeof source.resourceType === 'string' ? source.resourceType : 'other';
	const durationMs = typeof source.durationMs === 'number' ? source.durationMs : 0;
	const timestamp = typeof source.timestamp === 'number' ? source.timestamp : Date.now();
	const failed = Boolean(source.failed);
	const rawHeaders = record(source.headers);
	const headers: Record<string, string> = {};
	if (rawHeaders) {
		for (const [k, v] of Object.entries(rawHeaders)) {
			if (typeof v === 'string') headers[k] = v;
		}
	}
	return {
		id,
		requestId,
		url: source.url,
		method: source.method,
		status,
		statusText,
		mimeType,
		resourceType,
		durationMs,
		timestamp,
		failed,
		errorText: typeof source.errorText === 'string' ? source.errorText : undefined,
		headers: Object.keys(headers).length > 0 ? headers : undefined,
		hasBody: Boolean(source.hasBody),
		body: typeof source.body === 'string' ? source.body : undefined
	};
}

export function parseActionEntry(value: unknown): ActionEntry | null {
	const source = record(value);
	if (!source) return null;
	const id = nonEmpty(source.id);
	const kind = member(source.kind, ['navigation', 'agent_action', 'takeover', 'privacy', 'dialog', 'download', 'tab_change'] as const);
	if (!id || !kind || typeof source.label !== 'string' || typeof source.timestamp !== 'number') return null;
	return {
		id,
		timestamp: source.timestamp,
		kind,
		label: source.label,
		details: typeof source.details === 'string' ? source.details : undefined
	};
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
	if (source.type === 'control_interrupted') {
		const epoch = source.epoch;
		if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) return null;
		const reason = typeof source.reason === 'string' ? source.reason : 'CONTROL_INTERRUPTED';
		return { type: 'control_interrupted', epoch, reason };
	}
	if (source.type === 'snapshot') {
		const epoch = source.epoch;
		if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) return null;
		return { type: 'snapshot', epoch, snapshot: source.snapshot };
	}
	if (source.type === 'inspected_element') {
		const element = parseInspectedElementData(source.element);
		if (!element) return null;
		return { type: 'inspected_element', element };
	}
	if (source.type === 'console_entry') {
		const entry = parseConsoleEntry(source.entry);
		if (!entry) return null;
		return { type: 'console_entry', entry };
	}
	if (source.type === 'network_entry') {
		const entry = parseNetworkEntry(source.entry);
		if (!entry) return null;
		return { type: 'network_entry', entry };
	}
	if (source.type === 'network_body_response') {
		const requestId = typeof source.requestId === 'string' ? source.requestId : '';
		const body = typeof source.body === 'string' ? source.body : undefined;
		const error = typeof source.error === 'string' ? source.error : undefined;
		return { type: 'network_body_response', requestId, body, error };
	}
	if (source.type === 'action_entry') {
		const entry = parseActionEntry(source.entry);
		if (!entry) return null;
		return { type: 'action_entry', entry };
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
	| { type: 'inspected_element'; element: InspectedElementData }
	| { type: 'console_entry'; entry: ConsoleEntry }
	| { type: 'network_entry'; entry: NetworkEntry }
	| { type: 'network_body_response'; requestId: string; body?: string; error?: string }
	| { type: 'action_entry'; entry: ActionEntry }
	| { type: 'disconnected' };

export type BrowserLiveStreamHandle = (() => void) & {
	disconnect: () => void;
	sendTakeover: (expectedEpoch: number, input?: BrowserInputEvent) => Promise<void>;
	sendInput: (epoch: number, input: BrowserInputEvent) => Promise<void>;
	returnControl: (epoch: number) => Promise<void>;
	setPrivacy: (privacy: 'normal' | 'private') => Promise<void>;
	inspectPoint: (x: number, y: number) => Promise<void>;
	inspectElement: (selector?: string, point?: { x: number; y: number }) => Promise<void>;
	setInspector: (enabled: boolean, options?: { console?: boolean; network?: boolean }) => Promise<void>;
	requestNetworkBody: (requestId: string) => Promise<void>;
	clearBuffer: (target: 'console' | 'network' | 'actions' | 'all') => Promise<void>;
	sendMessage: (msg: BrowserLiveClientMessage) => Promise<void>;
};

/**
 * Avvia lo stream live tramite il backend Rust (Tauri).
 * Il token segreto e l'endpoint loopback vengono gestiti e verificati dal backend
 * senza esporre endpoint CDP o segreti non protetti al webview.
 */
export async function startBrowserLiveTauriStream(
	ticket: BrowserLiveTicket,
	onEvent: (event: BrowserLiveEvent) => void
): Promise<BrowserLiveStreamHandle> {
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

	const disconnect = () => {
		void invoke('browser_live_disconnect', { sessionId }).catch(() => {});
	};

	const sendMessage = async (msg: BrowserLiveClientMessage): Promise<void> => {
		await invoke('browser_live_send_message', { sessionId, message: msg });
	};

	const sendTakeover = async (expectedEpoch: number, input?: BrowserInputEvent): Promise<void> => {
		await sendMessage({ type: 'takeover', expectedEpoch, ...(input ? { input } : {}) });
	};

	const sendInput = async (epoch: number, input: BrowserInputEvent): Promise<void> => {
		await sendMessage({ type: 'input', epoch, input });
	};

	const returnControl = async (epoch: number): Promise<void> => {
		await sendMessage({ type: 'return_control', epoch });
	};

	const setPrivacy = async (privacy: 'normal' | 'private'): Promise<void> => {
		await sendMessage({ type: 'set_privacy', privacy });
	};

	const inspectPoint = async (x: number, y: number): Promise<void> => {
		await sendMessage({ type: 'inspect_point', x, y });
	};

	const inspectElement = async (selector?: string, point?: { x: number; y: number }): Promise<void> => {
		await sendMessage({ type: 'inspect_element', selector, point });
	};

	const setInspector = async (enabled: boolean, options?: { console?: boolean; network?: boolean }): Promise<void> => {
		await sendMessage({ type: 'set_inspector', enabled, ...options });
	};

	const requestNetworkBody = async (requestId: string): Promise<void> => {
		await sendMessage({ type: 'request_network_body', requestId });
	};

	const clearBuffer = async (target: 'console' | 'network' | 'actions' | 'all'): Promise<void> => {
		await sendMessage({ type: 'clear_buffer', target });
	};

	const handle = Object.assign(disconnect, {
		disconnect,
		sendTakeover,
		sendInput,
		returnControl,
		setPrivacy,
		inspectPoint,
		inspectElement,
		setInspector,
		requestNetworkBody,
		clearBuffer,
		sendMessage
	});
	return handle;
}

/**
 * Stream WebSocket per ambienti di test / browser puro in cui Tauri non e' disponibile.
 */
export async function startBrowserLiveWebSocketStream(
	ticket: BrowserLiveTicket,
	onEvent: (event: BrowserLiveEvent) => void
): Promise<BrowserLiveStreamHandle> {
	const ws = new WebSocket(ticket.endpoint);
	onEvent({ type: 'connecting' });
	let closed = false;
	const disconnect = () => {
		if (closed) return;
		closed = true;
		ws.close();
		onEvent({ type: 'disconnected' });
	};

	const sendMessage = async (msg: BrowserLiveClientMessage): Promise<void> => {
		if (closed || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify(msg));
	};

	const sendTakeover = async (expectedEpoch: number, input?: BrowserInputEvent): Promise<void> => {
		await sendMessage({ type: 'takeover', expectedEpoch, ...(input ? { input } : {}) });
	};

	const sendInput = async (epoch: number, input: BrowserInputEvent): Promise<void> => {
		await sendMessage({ type: 'input', epoch, input });
	};

	const returnControl = async (epoch: number): Promise<void> => {
		await sendMessage({ type: 'return_control', epoch });
	};

	const setPrivacy = async (privacy: 'normal' | 'private'): Promise<void> => {
		await sendMessage({ type: 'set_privacy', privacy });
	};

	const inspectPoint = async (x: number, y: number): Promise<void> => {
		await sendMessage({ type: 'inspect_point', x, y });
	};

	const inspectElement = async (selector?: string, point?: { x: number; y: number }): Promise<void> => {
		await sendMessage({ type: 'inspect_element', selector, point });
	};

	const setInspector = async (enabled: boolean, options?: { console?: boolean; network?: boolean }): Promise<void> => {
		await sendMessage({ type: 'set_inspector', enabled, ...options });
	};

	const requestNetworkBody = async (requestId: string): Promise<void> => {
		await sendMessage({ type: 'request_network_body', requestId });
	};

	const clearBuffer = async (target: 'console' | 'network' | 'actions' | 'all'): Promise<void> => {
		await sendMessage({ type: 'clear_buffer', target });
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
			} else if (msg.type === 'inspected_element') {
				onEvent({ type: 'inspected_element', element: msg.element });
			} else if (msg.type === 'console_entry') {
				onEvent({ type: 'console_entry', entry: msg.entry });
			} else if (msg.type === 'network_entry') {
				onEvent({ type: 'network_entry', entry: msg.entry });
			} else if (msg.type === 'network_body_response') {
				onEvent({ type: 'network_body_response', requestId: msg.requestId, body: msg.body, error: msg.error });
			} else if (msg.type === 'action_entry') {
				onEvent({ type: 'action_entry', entry: msg.entry });
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

	const handle = Object.assign(disconnect, {
		disconnect,
		sendTakeover,
		sendInput,
		returnControl,
		setPrivacy,
		inspectPoint,
		inspectElement,
		setInspector,
		requestNetworkBody,
		clearBuffer,
		sendMessage
	});
	return handle;
}

/**
 * Connette lo stream live selezionando automaticamente il trasporto nativo Tauri
 * o il WebSocket loopback diretto in ambiente browser / test.
 */
export async function connectBrowserLive(
	ticket: BrowserLiveTicket,
	onEvent: (event: BrowserLiveEvent) => void
): Promise<BrowserLiveStreamHandle> {
	if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
		return startBrowserLiveTauriStream(ticket, onEvent);
	}
	return startBrowserLiveWebSocketStream(ticket, onEvent);
}

/* ------------------------------------------- mapping coordinate e input (S41) */

export interface ViewportPoint {
	/** Coordinata X in pixel CSS del viewport Chromium [0, viewportWidth] */
	x: number;
	/** Coordinata Y in pixel CSS del viewport Chromium [0, viewportHeight] */
	y: number;
}

export interface BoundingBoxRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Converte le coordinate client del DOM (mouse, touch, click, drag) in coordinate
 * esatte in pixel CSS del viewport Chromium usando i metadati del frame confermato.
 *
 * L'algoritmo calcola la posizione proporzionale [0..1] rispetto al rettangolo
 * visivo dell'immagine/canvas renderizzato sullo schermo e la proietta sulle dimensioni
 * del viewport dichiarato nei metadati del frame (`meta.viewportWidth`, `meta.viewportHeight`).
 *
 * Invariante rispetto a:
 * 1. Ridimensionamento della finestra o della colonna centrale;
 * 2. DPI scaling e zoom del browser/webview;
 * 3. Modalita responsive viewport (desktop / tablet / mobile);
 * 4. Scroll del contenitore.
 */
export function mapClientToViewportCoords(
	clientX: number,
	clientY: number,
	rect: BoundingBoxRect,
	meta: { viewportWidth: number; viewportHeight: number }
): ViewportPoint | null {
	if (rect.width <= 0 || rect.height <= 0 || meta.viewportWidth <= 0 || meta.viewportHeight <= 0) {
		return null;
	}
	const relX = (clientX - rect.left) / rect.width;
	const relY = (clientY - rect.top) / rect.height;
	const clampedX = Math.max(0, Math.min(meta.viewportWidth, relX * meta.viewportWidth));
	const clampedY = Math.max(0, Math.min(meta.viewportHeight, relY * meta.viewportHeight));
	return {
		x: Math.round(clampedX * 100) / 100,
		y: Math.round(clampedY * 100) / 100
	};
}

/**
 * Normalizza il delta di scroll della rotellina del mouse in pixel CSS.
 * Gestisce deltaMode: 0 (Pixel), 1 (Linee - standard ~16px per linea), 2 (Pagine).
 */
export function mapWheelToViewportScroll(
	deltaX: number,
	deltaY: number,
	deltaMode: number = 0
): { deltaX: number; deltaY: number } {
	let factor = 1;
	if (deltaMode === 1) {
		factor = 16;
	} else if (deltaMode === 2) {
		factor = 400;
	}
	return {
		deltaX: Math.round(deltaX * factor * 100) / 100,
		deltaY: Math.round(deltaY * factor * 100) / 100
	};
}

export type BrowserInputEvent =
	| { type: 'mouse_move'; x: number; y: number; buttons: number }
	| { type: 'mouse_down'; x: number; y: number; button: number; buttons: number; clickCount: number }
	| { type: 'mouse_up'; x: number; y: number; button: number; buttons: number }
	| { type: 'click'; x: number; y: number; button: number; detail: number }
	| { type: 'double_click'; x: number; y: number }
	| { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
	| { type: 'drag_start'; x: number; y: number }
	| { type: 'drag_move'; x: number; y: number }
	| { type: 'drag_end'; x: number; y: number }
	| {
			type: 'key_down';
			key: string;
			code: string;
			modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
	  }
	| {
			type: 'key_up';
			key: string;
			code: string;
			modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
	  };

/* ------------------------------------------- origin policy e redazione dati (S43) */

/**
 * Estrae l'origine normalizzata (schema + '//' + host + porta opzionale) da un URL.
 * Restituisce null se l'URL non e' valido.
 */
export function extractOrigin(url: string): string | null {
	if (!url || typeof url !== 'string') return null;
	const trimmed = url.trim();
	if (trimmed === 'about:blank' || trimmed.startsWith('about:')) return 'about:blank';
	if (trimmed.startsWith('data:')) return 'data:';
	if (trimmed.startsWith('blob:')) return 'blob:';
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol === 'about:' || parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
			return parsed.protocol === 'about:' ? 'about:blank' : parsed.protocol;
		}
		return parsed.origin.toLowerCase();
	} catch {
		return null;
	}
}

const LOCAL_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Verifica se un URL o origine punta a un ambiente locale/loopback.
 * Le origini locali sono autorizzate automaticamente senza richiesta di consenso.
 */
export function isLocalOrigin(urlOrOrigin: string): boolean {
	if (!urlOrOrigin || typeof urlOrOrigin !== 'string') return false;
	const trimmed = urlOrOrigin.trim().toLowerCase();
	if (
		trimmed === 'about:blank' ||
		trimmed.startsWith('about:') ||
		trimmed.startsWith('data:') ||
		trimmed.startsWith('blob:')
	) {
		return true;
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
	} catch {
		return false;
	}
	const host = parsed.hostname.toLowerCase();
	if (LOCAL_ORIGIN_HOSTS.has(host) || host.startsWith('127.')) {
		return true;
	}
	return false;
}

export type OriginClassification =
	| { type: 'local'; origin: string }
	| { type: 'remote'; origin: string }
	| { type: 'special'; origin: string };

export function classifyOrigin(url: string): OriginClassification {
	const origin = extractOrigin(url) ?? 'unknown';
	if (origin === 'about:blank' || origin === 'data:' || origin === 'blob:') {
		return { type: 'special', origin };
	}
	if (isLocalOrigin(origin)) {
		return { type: 'local', origin };
	}
	return { type: 'remote', origin };
}

/**
 * Rimuove le credenziali user:pass@ dagli URL per evitare che passino nei log o nel transcript.
 */
export function redactUrlCredentials(url: string): string {
	if (!url || typeof url !== 'string') return url;
	if (!url.includes('@') && !url.includes('//')) return url;
	return url.replace(/:\/\/([^:@\s]+)(?::([^@\s]*))?@/g, '://[REDACTED]@');
}

const SENSITIVE_HEADER_KEYS = new Set([
	'authorization',
	'cookie',
	'set-cookie',
	'x-api-key',
	'proxy-authorization',
	'sec-websocket-key',
	'x-auth-token'
]);

/**
 * Maschera gli header sensibili (Authorization, Cookie, Set-Cookie, API keys).
 */
export function redactSensitiveHeaders(
	headers: Record<string, string | string[] | undefined>
): Record<string, string | string[]> {
	const redacted: Record<string, string | string[]> = {};
	for (const [k, v] of Object.entries(headers)) {
		if (v === undefined) continue;
		const lowerKey = k.toLowerCase();
		if (SENSITIVE_HEADER_KEYS.has(lowerKey)) {
			redacted[k] = '[REDACTED]';
		} else {
			redacted[k] = v;
		}
	}
	return redacted;
}

/**
 * Maschera token, credenziali e chiavi sensibili da stringhe di log, errori o messaggi.
 */
export function redactSensitiveString(text: string): string {
	if (!text || typeof text !== 'string') return text;
	return text
		.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
		.replace(/(Basic\s+)[A-Za-z0-9+/]+=*/gi, '$1[REDACTED]')
		.replace(
			/((?:token|secret|password|api[_-]?key)\s*[:=]\s*["']?)[A-Za-z0-9\-._~+/]{6,}(["']?)/gi,
			'$1[REDACTED]$2'
		)
		.replace(/:\/\/([^:@\s]+):([^@\s]+)@/g, '://[REDACTED]:[REDACTED]@');
}

/* ------------------------------------------- ring buffer e diagnostica (S44) */

export class BoundedRingBuffer<T> {
	protected buffer: T[] = [];
	readonly capacity: number;

	constructor(capacity: number) {
		this.capacity = Math.max(1, capacity);
	}

	get items(): readonly T[] {
		return this.buffer;
	}

	get length(): number {
		return this.buffer.length;
	}

	push(item: T): void {
		if (this.buffer.length >= this.capacity) {
			this.buffer.shift();
		}
		this.buffer.push(item);
	}

	clear(): void {
		this.buffer = [];
	}

	filter(predicate: (item: T) => boolean): T[] {
		return this.buffer.filter(predicate);
	}
}

export class ConsoleRingBuffer extends BoundedRingBuffer<ConsoleEntry> {
	constructor(capacity: number = 500) {
		super(capacity);
	}

	/**
	 * Inserisce o deduplica una voce di console applicando la redazione dei dati.
	 */
	override push(raw: ConsoleEntry): void {
		const entry: ConsoleEntry = {
			id: raw.id,
			level: raw.level,
			text: redactSensitiveString(raw.text),
			timestamp: raw.timestamp,
			count: raw.count || 1,
			stackTrace: raw.stackTrace ? redactSensitiveString(raw.stackTrace) : undefined,
			url: raw.url ? redactUrlCredentials(raw.url) : undefined,
			line: raw.line
		};

		// Deduplica con l'ultimo messaggio se identico per livello, testo, url e riga
		const last = this.buffer[this.buffer.length - 1];
		if (
			last &&
			last.level === entry.level &&
			last.text === entry.text &&
			last.url === entry.url &&
			last.line === entry.line
		) {
			last.count += entry.count;
			last.timestamp = entry.timestamp;
			return;
		}

		super.push(entry);
	}
}

export class NetworkRingBuffer extends BoundedRingBuffer<NetworkEntry> {
	constructor(capacity: number = 200) {
		super(capacity);
	}

	/**
	 * Inserisce o aggiorna una voce di rete per requestId applicando la redazione.
	 */
	override push(raw: NetworkEntry): void {
		const entry: NetworkEntry = {
			id: raw.id,
			requestId: raw.requestId,
			url: redactUrlCredentials(raw.url),
			method: raw.method,
			status: raw.status,
			statusText: raw.statusText,
			mimeType: raw.mimeType,
			resourceType: raw.resourceType,
			durationMs: Math.round(raw.durationMs * 10) / 10,
			timestamp: raw.timestamp,
			failed: raw.failed,
			errorText: raw.errorText ? redactSensitiveString(raw.errorText) : undefined,
			headers: raw.headers ? redactSensitiveHeaders(raw.headers) as Record<string, string> : undefined,
			hasBody: raw.hasBody,
			body: raw.body ? redactSensitiveString(raw.body) : undefined
		};

		const existingIndex = this.buffer.findIndex((e) => e.requestId === entry.requestId);
		if (existingIndex !== -1) {
			const prev = this.buffer[existingIndex];
			this.buffer[existingIndex] = {
				...prev,
				...entry,
				headers: entry.headers || prev.headers,
				body: entry.body || prev.body
			};
			return;
		}

		super.push(entry);
	}

	/**
	 * Aggiorna il corpo della risposta per una richiesta specifica.
	 */
	setBody(requestId: string, body: string): void {
		const entry = this.buffer.find((e) => e.requestId === requestId);
		if (entry) {
			entry.body = redactSensitiveString(body);
			entry.hasBody = true;
		}
	}
}

export class ActionRingBuffer extends BoundedRingBuffer<ActionEntry> {
	constructor(capacity: number = 100) {
		super(capacity);
	}

	override push(raw: ActionEntry): void {
		const entry: ActionEntry = {
			id: raw.id,
			timestamp: raw.timestamp,
			kind: raw.kind,
			label: redactSensitiveString(raw.label),
			details: raw.details ? redactSensitiveString(raw.details) : undefined
		};
		super.push(entry);
	}
}

/* ------------------------------------------- formattazione contesto prompt (S44) */

export function formatElementContextForPrompt(el: InspectedElementData): string {
	const parts: string[] = [];
	parts.push(`### Contesto Elemento Ispezionato`);
	parts.push(`- **Elemento**: \`<${el.tag}>\` (Selettore: \`${el.selector}\`)`);
	if (el.role) parts.push(`- **Ruolo ARIA**: \`${el.role}\``);
	if (el.accessibleName) parts.push(`- **Nome accessibile**: "${el.accessibleName}"`);
	if (el.text) parts.push(`- **Testo visibile**: "${el.text.length > 120 ? el.text.slice(0, 120) + '…' : el.text}"`);
	if (el.component) parts.push(`- **Componente**: \`<${el.component}>\``);
	parts.push(`- **Bounding Box**: ${Math.round(el.boundingBox.width)}x${Math.round(el.boundingBox.height)} a (${Math.round(el.boundingBox.x)}, ${Math.round(el.boundingBox.y)})`);

	const styleKeys = Object.keys(el.computedStyles);
	if (styleKeys.length > 0) {
		const formattedStyles = styleKeys
			.map((k) => `${k}: ${el.computedStyles[k]}`)
			.join('; ');
		parts.push(`- **Stili CSS rilevanti**: \`${formattedStyles}\``);
	}

	return parts.join('\n');
}

export function formatConsoleErrorsForPrompt(entries: ConsoleEntry[]): string {
	const errors = entries.filter((e) => e.level === 'error' || e.level === 'warn');
	if (errors.length === 0) return '';
	const parts: string[] = [];
	parts.push(`### Errori/Avvisi Console (${errors.length})`);
	for (const err of errors.slice(0, 10)) {
		const loc = err.url ? ` at ${err.url}${err.line !== undefined ? `:${err.line}` : ''}` : '';
		const countStr = err.count > 1 ? ` (x${err.count})` : '';
		parts.push(`- [${err.level}] \`${err.text}\`${loc}${countStr}`);
		if (err.stackTrace) {
			const stackLines = err.stackTrace.split('\n').slice(0, 3).map((l) => `  ${l.trim()}`).join('\n');
			parts.push(`\`\`\`\n${stackLines}\n\`\`\``);
		}
	}
	return parts.join('\n');
}

export function formatFailedRequestsForPrompt(entries: NetworkEntry[]): string {
	const failed = entries.filter((e) => e.failed || e.status >= 400);
	if (failed.length === 0) return '';
	const parts: string[] = [];
	parts.push(`### Richieste di Rete Fallite (${failed.length})`);
	for (const req of failed.slice(0, 10)) {
		const statusStr = req.status > 0 ? `Status ${req.status} ${req.statusText}`.trim() : 'FALLITA (Errore di rete)';
		const errDetail = req.errorText ? ` - ${req.errorText}` : '';
		parts.push(`- \`${req.method} ${req.url}\` -> ${statusStr} (${req.durationMs}ms)${errDetail}`);
	}
	return parts.join('\n');
}

export function formatInspectorContextForPrompt(options: {
	element?: InspectedElementData | null;
	consoleEntries?: ConsoleEntry[];
	networkEntries?: NetworkEntry[];
}): string {
	const sections: string[] = [];
	if (options.element) {
		sections.push(formatElementContextForPrompt(options.element));
	}
	if (options.consoleEntries && options.consoleEntries.length > 0) {
		const consoleText = formatConsoleErrorsForPrompt(options.consoleEntries);
		if (consoleText) sections.push(consoleText);
	}
	if (options.networkEntries && options.networkEntries.length > 0) {
		const netText = formatFailedRequestsForPrompt(options.networkEntries);
		if (netText) sections.push(netText);
	}
	return sections.join('\n\n');
}

/**
 * Esegue il ritaglio client-side dell'elemento su canvas a partire dall'immagine JPEG/PNG base64.
 */
export async function cropImageElement(
	base64: string,
	rect: { x: number; y: number; width: number; height: number },
	viewport: { width: number; height: number }
): Promise<string> {
	if (typeof document === 'undefined' || typeof Image === 'undefined') return '';
	if (rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return '';

	const { promise, resolve } = Promise.withResolvers<string>();
	const img = new Image();
	img.onload = () => {
		try {
			const canvas = document.createElement('canvas');
			const scaleX = img.naturalWidth / viewport.width;
			const scaleY = img.naturalHeight / viewport.height;

			const srcX = Math.max(0, rect.x * scaleX);
			const srcY = Math.max(0, rect.y * scaleY);
			const srcW = Math.min(img.naturalWidth - srcX, rect.width * scaleX);
			const srcH = Math.min(img.naturalHeight - srcY, rect.height * scaleY);

			canvas.width = Math.max(1, Math.round(srcW));
			canvas.height = Math.max(1, Math.round(srcH));
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				resolve('');
				return;
			}
			ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
			const croppedData = canvas.toDataURL('image/png').split(',')[1] || '';
			resolve(croppedData);
		} catch {
			resolve('');
		}
	};
	img.onerror = () => resolve('');
	img.src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
	return promise;
}
