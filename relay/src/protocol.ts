/**
 * Contratto del controllo remoto (Gate R44): relay, PWA e Studio importano
 * questo modulo e nessun altro definisce frame, stato o API.
 *
 * Modulo puro: niente Bun, DOM o Tauri, cosi' compila in tutti e tre.
 * Il bridge Rust di Studio ripete solo nome, versione e funzioni del
 * protocollo (`src-tauri/src/remote/`): una versione diversa la ferma il relay
 * con `CloseCode.incompatible`, non un errore silenzioso.
 */

export const PROTOCOL = { name: 'omp-studio-remote', version: 1 } as const;

/**
 * Il relay accetta macchine con versione di protocollo fra questa e
 * `PROTOCOL.version`. Piu' macchine si aggiornano in momenti diversi (una in
 * Nightly, una in stabile): quando la versione sale, il relay continua ad
 * accettare la precedente per almeno un rilascio stabile. La PWA invece e'
 * servita dal relay stesso e parla sempre `PROTOCOL.version`.
 */
export const MIN_HOST_PROTOCOL_VERSION = 1;

export interface ProtocolId {
	name: string;
	version: number;
}

/**
 * Funzioni facoltative: ogni macchina dichiara le sue nel `hello`, il relay
 * tiene l'intersezione con le proprie e la PWA mostra solo i comandi coperti.
 */
export const FEATURES = ['respond_ui', 'run_task', 'quota_actions'] as const;
export type Feature = (typeof FEATURES)[number];

/** Battito del relay verso entrambi i lati; resta sotto i timeout di proxy e CDN. */
export const HEARTBEAT_MS = 25_000;
/** Chi non riceve nulla per tanto considera la connessione morta e si ricollega. */
export const HEARTBEAT_TIMEOUT_MS = 70_000;
/** Oltre questo tempo il relay risponde al client `timeout` al posto della macchina. */
export const COMMAND_TIMEOUT_MS = 30_000;
/** Tempo concesso dopo l'apertura per mandare `hello`. */
export const HELLO_TIMEOUT_MS = 5_000;
/** Tetto di un frame JSON, in byte. Uno stato di macchina resta molto sotto. */
export const MAX_FRAME_BYTES = 512 * 1024;

export const CloseCode = {
	normal: 1000,
	protocolError: 4400,
	unauthorized: 4401,
	/** Dispositivo o macchina revocati: non ritentare. */
	revoked: 4403,
	/** La stessa macchina si e' ricollegata altrove: vince l'ultima connessione. */
	replaced: 4409,
	/** Versione del protocollo diversa: aggiornare Studio o il relay. */
	incompatible: 4426
} as const;
export type CloseCodeValue = (typeof CloseCode)[keyof typeof CloseCode];

// ---------------------------------------------------------------------------
// Identita'
// ---------------------------------------------------------------------------

export type Platform = 'windows' | 'macos' | 'linux';

export interface DeviceInfo {
	id: string;
	name: string;
}

export interface HostSummary {
	/** UUID generato da Studio all'installazione: stabile fra riavvii e riabbinamenti. */
	id: string;
	name: string;
	platform: Platform;
	appVersion: string;
	/** Intersezione fra funzioni dichiarate dalla macchina e funzioni del relay. */
	features: Feature[];
	online: boolean;
	pairedAt: number;
	lastSeenAt: number | null;
}

// ---------------------------------------------------------------------------
// Stato di una macchina: istantanea completa, pochi KB
// ---------------------------------------------------------------------------

/**
 * - `offline`: nessun processo omp per la corsia;
 * - `idle`: sessione pronta, niente in corso;
 * - `working`: turno in corso;
 * - `background`: turno ceduto, lavoro in background non ancora quieto;
 * - `attention`: l'agente aspetta l'utente;
 * - `error`: ultimo turno finito in errore.
 */
export type RemoteAgentState = 'offline' | 'idle' | 'working' | 'background' | 'attention' | 'error';

export interface RemoteActivity {
	text: string;
	at: number;
	kind: 'intent' | 'assistant';
}

export interface RemoteAgent {
	state: RemoteAgentState;
	surface: 'gui' | 'terminal' | null;
	provider: string | null;
	modelId: string | null;
	modelLabel: string | null;
	activity: RemoteActivity | null;
	/** Heads-up dell'ultimo turno (Gate R40), finche' non e' visto. */
	headsUp: string | null;
}

export interface RemoteLane {
	/** `main` per la Principale. */
	id: string;
	title: string;
	kind: 'main' | 'worktree' | 'lab';
	agent: RemoteAgent;
}

export interface RemoteAskQuestion {
	id: string;
	question: string;
	header: string | null;
	options: { label: string; description: string | null }[];
	multi: boolean;
	/** Indice in `options` della scelta consigliata. */
	recommended: number | null;
}

export interface RemoteChatLine {
	role: 'user' | 'assistant' | 'tool';
	text: string;
	timestamp: number | null;
}

/** Una richiesta dell'agente che aspetta l'utente: domanda, conferma, testo o blocco di quota. */
export interface RemoteAttention {
	requestId: string;
	laneId: string | null;
	laneTitle: string | null;
	method: 'ask' | 'select' | 'confirm' | 'input' | 'editor';
	/** Domanda per `select`, `confirm`, `input`, `editor`. */
	title: string;
	message: string | null;
	/** Opzioni di `select`. */
	options: { label: string; description: string | null }[];
	placeholder: string | null;
	prefill: string | null;
	/** Domande di `ask` (una richiesta, una o piu' domande). */
	questions: RemoteAskQuestion[];
	/** Scadenza assoluta (epoch ms), se l'agente ne ha data una. */
	deadline: number | null;
	/** Avviso di quota esaurita: si risolve con i comandi `quota_actions`, non con una risposta. */
	quotaBlocked: { reason: 'quota_exhausted' | 'provider_error'; provider: string | null; modelId: string | null } | null;
	/** Ultime righe della conversazione, per capire la domanda senza aprire la chat. */
	recentMessages: RemoteChatLine[];
}

export type RemoteTaskStatus = 'queued' | 'dispatching' | 'in_progress';

export interface RemoteTaskSchedule {
	kind: 'reset' | 'at';
	/** `at`: orario scelto. `reset`: reset stimato, se noto. */
	notBefore: number | null;
	provider: string | null;
	/** Il momento e' passato a Studio chiuso: aspetta una decisione e non parte da solo. */
	missed: boolean;
}

export interface RemoteTask {
	id: string;
	/** Titolo sintetico, o l'inizio del prompt quando manca. */
	title: string;
	/** Prompt troncato a 4.000 caratteri. */
	prompt: string;
	status: RemoteTaskStatus;
	position: number;
	schedule: RemoteTaskSchedule | null;
	/** Voce di ripresa creata da un blocco di quota. */
	resume: boolean;
	/** Il prossimo che l'arbitro avvierebbe. */
	next: boolean;
}

export interface RemoteQuotaWindow {
	id: string;
	label: string;
	/** 0..1, null se il provider non lo dice. */
	usedFraction: number | null;
	resetsAt: number | null;
}

export interface RemoteQuotaProvider {
	provider: string;
	/**
	 * Account del provider (email, organizzazione o id). Con piu' account dello stesso
	 * provider `provider` si ripete: e' l'account a distinguerli. Assente dagli host
	 * pubblicati prima del campo, quindi opzionale.
	 */
	account?: string | null;
	status: 'ok' | 'warning' | 'exhausted' | 'unknown';
	windows: RemoteQuotaWindow[];
}

export interface RemoteQuota {
	fetchedAt: number | null;
	providers: RemoteQuotaProvider[];
}

export interface RemoteProject {
	id: string;
	name: string;
	/** Tinta d'identita' del progetto (0..360). */
	hue: number;
	/** Il progetto aperto in primo piano in Studio. */
	active: boolean;
	/** La Principale per prima. */
	lanes: RemoteLane[];
	attention: RemoteAttention[];
	/** Solo task attivi, in ordine di coda. */
	tasks: RemoteTask[];
	autoDispatch: boolean;
	canRunTask: boolean;
	runBlockReason: string | null;
}

export interface HostState {
	projects: RemoteProject[];
	quota: RemoteQuota | null;
}

// ---------------------------------------------------------------------------
// Comandi
// ---------------------------------------------------------------------------

/** Sottoinsieme canonico di `PromptAnswer` (`src/lib/agent/askAnswers.ts`). */
export type RemoteAnswer =
	| { action: 'select'; value: string }
	| { action: 'confirm'; confirmed: boolean }
	| { action: 'input' | 'editor'; value: string }
	| { action: 'ask'; answers: { id: string; selectedOptions: string[]; customInput?: string }[] }
	| { action: 'cancel' };

export type RemoteCommand =
	| { kind: 'respond_ui'; projectId: string; laneId: string | null; requestId: string; answer: RemoteAnswer }
	| { kind: 'run_task'; projectId: string; taskId: string }
	| { kind: 'wait_quota_reset'; projectId: string; laneId: string | null }
	| { kind: 'dismiss_quota_blocked'; projectId: string; laneId: string | null };

/** Funzione che una macchina deve dichiarare perche' il comando le arrivi. */
export const COMMAND_FEATURE: Record<RemoteCommand['kind'], Feature> = {
	respond_ui: 'respond_ui',
	run_task: 'run_task',
	wait_quota_reset: 'quota_actions',
	dismiss_quota_blocked: 'quota_actions'
};

export type CommandErrorCode =
	| 'host_offline'
	| 'timeout'
	| 'unsupported'
	| 'not_found'
	| 'rejected'
	| 'disabled'
	| 'failed';

export interface CommandError {
	code: CommandErrorCode;
	message: string;
}

// ---------------------------------------------------------------------------
// Frame WebSocket
// ---------------------------------------------------------------------------

/** Studio -> relay, su `API.hostSocket` con `Authorization: Bearer <credential>`. */
export type HostFrame =
	| {
			type: 'hello';
			protocol: ProtocolId;
			features: string[];
			host: { name: string; platform: Platform; appVersion: string };
	  }
	/** `seq` cresce dentro una connessione; il relay accetta la prima istantanea di ogni connessione. */
	| { type: 'snapshot'; seq: number; state: HostState }
	| { type: 'command_result'; commandId: string; ok: boolean; error?: CommandError }
	| { type: 'pong'; seq: number };

/** Relay -> Studio. */
export type RelayToHostFrame =
	| {
			type: 'welcome';
			protocol: ProtocolId;
			relay: RelayInfo;
			features: Feature[];
			heartbeatMs: number;
			clients: DeviceInfo[];
	  }
	/** Dispositivi collegati in questo momento: alimentano l'indicatore di Studio. */
	| { type: 'clients'; clients: DeviceInfo[] }
	| { type: 'command'; commandId: string; device: DeviceInfo; command: RemoteCommand }
	| { type: 'ping'; seq: number; t: number };

/** PWA -> relay, su `API.clientSocket` con il cookie di sessione. */
export type ClientFrame =
	| { type: 'hello'; protocol: ProtocolId }
	/** `commandId` lo genera il client (UUID) e torna nel risultato. */
	| { type: 'command'; commandId: string; hostId: string; command: RemoteCommand }
	| { type: 'resync'; hostId: string }
	| { type: 'pong'; seq: number };

/** Relay -> PWA. */
export type RelayToClientFrame =
	| {
			type: 'welcome';
			protocol: ProtocolId;
			relay: RelayInfo;
			heartbeatMs: number;
			device: DeviceInfo;
			hosts: HostSummary[];
	  }
	/** Elenco cambiato: macchina abbinata, rinominata o revocata. */
	| { type: 'hosts'; hosts: HostSummary[] }
	| { type: 'host_status'; host: HostSummary }
	| { type: 'host_snapshot'; hostId: string; seq: number; receivedAt: number; state: HostState }
	| { type: 'command_result'; hostId: string; commandId: string; ok: boolean; error?: CommandError }
	| { type: 'ping'; seq: number; t: number };

// ---------------------------------------------------------------------------
// API HTTP
// ---------------------------------------------------------------------------

/** Versione del relay installato: Studio e PWA la mostrano e la confrontano. */
export interface RelayInfo {
	version: string;
	/** Versioni di protocollo accettate dalle macchine. */
	protocol: { name: string; min: number; max: number };
}

/**
 * Risposta pubblica di `/healthz`. Studio la legge quando il relay lo chiude
 * con `CloseCode.incompatible`, per dire chi va aggiornato: Studio o il relay.
 */
export interface HealthResponse {
	ok: true;
	service: 'omp-studio-relay';
	version: string;
	protocol: { name: string; min: number; max: number };
}

export const API = {
	pairDevice: '/v1/pair/device',
	pairHost: '/v1/pair/host',
	session: '/v1/session',
	logout: '/v1/session/logout',
	codes: '/v1/codes',
	devices: '/v1/devices',
	hosts: '/v1/hosts',
	hostSocket: '/v1/host',
	clientSocket: '/v1/client'
} as const;

/** Cookie di sessione dei dispositivi: `HttpOnly`, `SameSite=Strict`, `Secure` in HTTPS. */
export const SESSION_COOKIE = 'relay_session';

/** Validita' di un codice di abbinamento. */
export const PAIRING_CODE_TTL_MS = 10 * 60_000;

/** Primo dispositivo con `adminToken`, gli altri con un `code` emesso da un dispositivo abbinato. */
export interface PairDeviceRequest {
	name: string;
	code?: string;
	adminToken?: string;
}
export interface PairDeviceResponse {
	device: DeviceInfo;
}

/** Chiamata dal bridge Rust di Studio; la credenziale si vede solo qui. */
export interface PairHostRequest {
	code: string;
	hostId: string;
	name: string;
	platform: Platform;
	appVersion: string;
}
export interface PairHostResponse {
	hostId: string;
	credential: string;
}

export type PairingKind = 'device' | 'host';
export interface CreateCodeRequest {
	kind: PairingKind;
}
export interface CreateCodeResponse {
	code: string;
	kind: PairingKind;
	expiresAt: number;
}

export interface SessionResponse {
	device: DeviceInfo;
}

export interface DeviceListItem extends DeviceInfo {
	createdAt: number;
	lastSeenAt: number | null;
	current: boolean;
	online: boolean;
}
export interface DevicesResponse {
	devices: DeviceListItem[];
}
export interface HostsResponse {
	hosts: HostSummary[];
}

/**
 * Corpo degli errori HTTP. Codici: `bad_request` 400, `unauthorized` 401,
 * `forbidden_origin` 403, `not_found` 404, `rate_limited` 429.
 */
export interface ApiError {
	error: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Codici di abbinamento
// ---------------------------------------------------------------------------

/** Alfabeto di Crockford: niente I, L, O, U, per poterli dettare e trascrivere. */
export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 8;

/**
 * Riporta un codice digitato alla forma canonica: maiuscole, senza trattini
 * e spazi, con le lettere ambigue lette come cifre. `null` se non e' un codice.
 */
export function normalizePairingCode(input: string): string | null {
	const code = input
		.toUpperCase()
		.replace(/[\s-]/g, '')
		.replace(/O/g, '0')
		.replace(/[IL]/g, '1');
	if (code.length !== PAIRING_CODE_LENGTH) return null;
	for (const char of code) {
		if (!PAIRING_ALPHABET.includes(char)) return null;
	}
	return code;
}

/** `ABCD1234` -> `ABCD-1234`, per mostrarlo e dettarlo. */
export function formatPairingCode(code: string): string {
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}
