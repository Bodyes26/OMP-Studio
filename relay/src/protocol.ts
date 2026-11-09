/**
 * Contratto del controllo remoto (Gate R44): relay, PWA e Studio importano
 * questo modulo e nessun altro definisce frame, stato o API.
 *
 * Modulo puro: niente Bun, DOM o Tauri, cosi' compila in tutti e tre.
 * Il bridge Rust di Studio ripete solo nome, versione e funzioni del
 * protocollo (`src-tauri/src/remote/`): una versione diversa la ferma il relay
 * con `CloseCode.incompatible`, non un errore silenzioso.
 */

import type { RemoteContextSnapshot } from '../../src/lib/agent/contextPanelState';
export type { RemoteContextSnapshot };

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
 * Una funzione nuova non chiede di alzare `PROTOCOL.version`: le macchine che
 * non la dichiarano non ricevono i suoi comandi ne' i suoi frame.
 *
 * - `task_edit`: creare, modificare, programmare, spostare ed eliminare task;
 * - `session_control`: interrompere l'agente e scrivere alla sessione;
 * - `chat`: storico della conversazione e flusso dal vivo (`chat_*`);
 * - `projects`: elenco delle cartelle dei progetti, apertura e creazione;
 * - `chat_rich`: la PWA servita dal relay disegna i blocchi `thinking` in
 *   streaming. Studio manda i delta di ragionamento solo se il `welcome` la
 *   elenca: una PWA vecchia li accoderebbe al testo della risposta;
 * - `lane_config`: nuova chat, ruolo, modello e ragionamento della corsia, e
 *   catalogo del composer (comandi, skill, modelli, ruoli);
 * - `artifacts`: anteprime dei tool (`RemoteToolCall.artifact`) e comando
 *   `get_artifact` per i contenuti oltre il tetto inline;
 * - `task_options`: lavori in coda completi (Gate R48): ruolo, modello,
 *   ragionamento, direttive e immagini in `RemoteTask`, `get_task`, opzioni e
 *   immagini in `create_task`/`update_task`, avvio con destinazione;
 * - `dispatch_confirm`: conferme di avvio in un nuovo worktree pubblicate in
 *   `RemoteProject.dispatchConfirmations` e risolte con `respond_dispatch`;
 * - `quota_refresh`: aggiornamento delle quote dal dispositivo.
 */
export const FEATURES = [
	'respond_ui',
	'run_task',
	'quota_actions',
	'task_edit',
	'session_control',
	'chat',
	'projects',
	'chat_rich',
	'lane_config',
	'fleet',
	'artifacts',
	'task_options',
	'dispatch_confirm',
	'quota_refresh'
] as const;
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
	/** Ruolo attivo della sessione (`default`, `plan`...). Assente dagli host precedenti. */
	role?: string | null;
	/** Livello di ragionamento della sessione (`off`...`max`). Assente dagli host precedenti. */
	thinkingLevel?: string | null;
	/** Dati osservati della finestra di contesto e della cache; null sul terminale. */
	context?: RemoteContextSnapshot | null;
}

export interface RemoteLane {
	/** `main` per la Principale. */
	id: string;
	title: string;
	kind: 'main' | 'worktree' | 'lab';
	agent: RemoteAgent;
	session?: RemoteSessionSnapshot | null;
}

export interface RemoteSessionSnapshot {
	id: string | null;
	title: string | null;
	updatedAt: number | null;
	completion: { id: string; at: number; seen: boolean } | null;
	progress: { done: number; total: number; items: Array<{ content: string; status: string }> } | null;
	subagents: Array<{ id: string; name: string; task: string | null; status: string }>;
	jobs: Array<{ id: string; label: string; status: string }>;
}

export interface RemoteSessionSummary {
	sessionId: string;
	title: string | null;
	prompt: string;
	createdAt: number;
	laneId: string | null;
	laneTitle: string | null;
}

export interface RemoteSessionPage {
	sessions: RemoteSessionSummary[];
	before: string | null;
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

/** Direttiva salvata nel task: istantanea del catalogo al momento della scelta. */
export interface RemoteTaskDirective {
	id: string;
	name: string;
}

export interface RemoteTask {
	id: string;
	/** Titolo sintetico, o l'inizio del prompt quando manca. */
	title: string;
	/** Anteprima del prompt, troncata a 4.000 caratteri: il testo completo arriva con `get_task`. */
	prompt: string;
	status: RemoteTaskStatus;
	position: number;
	schedule: RemoteTaskSchedule | null;
	/** Voce di ripresa creata da un blocco di quota. */
	resume: boolean;
	/** Il prossimo che l'arbitro avvierebbe. */
	next: boolean;
	/**
	 * Campi `task_options`, assenti dagli host precedenti. `role` null = ruolo
	 * predefinito del progetto; `modelSelector` (`provider/id`) e
	 * `thinkingLevel` null = quelli del ruolo.
	 */
	role?: string | null;
	modelSelector?: string | null;
	thinkingLevel?: string | null;
	directives?: RemoteTaskDirective[];
	/** Immagini allegate: solo il conteggio, i dati arrivano con `get_task`. */
	imageCount?: number;
}

/** Immagine di un lavoro in coda restituita da `get_task`. */
export interface RemoteTaskImage {
	mimeType: string;
	/** Base64; `null` quando supera il tetto di `get_task`: l'immagine resta nel lavoro ma non si vede. */
	data: string | null;
}

/** Lavoro in coda completo, per il pannello di modifica. */
export interface RemoteTaskDetail {
	id: string;
	/** Testo completo, senza troncamento. */
	prompt: string;
	role: string | null;
	modelSelector: string | null;
	thinkingLevel: string | null;
	directives: RemoteTaskDirective[];
	/** Nell'ordine del task: gli indici servono a `update_task.images.keep`. */
	images: RemoteTaskImage[];
	schedule: RemoteTaskSchedule | null;
}

/** Tetto dei dati immagine restituiti da `get_task`: resta sotto `MAX_FRAME_BYTES`. */
export const TASK_DETAIL_MAX_BYTES = 384 * 1024;

/**
 * Conferma chiesta da Studio prima di aprire un nuovo worktree (Gate R48):
 * - `concurrency`: gli agenti attivi superano la soglia;
 * - `local_files`: file locali non versionati da copiare nel worktree, decisione
 *   ricordata nel profilo del progetto.
 * Una sola fonte di verita': rispondere da Studio o da Remote chiude la stessa
 * conferma su entrambe le superfici.
 */
export type RemoteDispatchConfirmation =
	| {
			id: string;
			kind: 'concurrency';
			taskId: string;
			taskTitle: string;
			activeLanes: Array<{ laneId: string; title: string; modelLabel: string | null; state: RemoteAgentState }>;
	  }
	| {
			id: string;
			kind: 'local_files';
			taskId: string;
			taskTitle: string;
			files: Array<{ path: string; category: string; bytes: number | null; suggested: boolean }>;
	  };

/** Esito dell'avvio di un lavoro da remoto. */
export type RemoteDispatchOutcome =
	| { status: 'started'; laneId: string }
	/** Serve una conferma: e' gia' pubblicata in `RemoteProject.dispatchConfirmations`. */
	| { status: 'confirm'; confirmationId: string };

/**
 * Dove avviare un lavoro: `auto` segue le regole della coda di Studio
 * (Principale se libera, altrimenti un worktree nuovo, senza chiedere);
 * `new_lane` apre sempre un worktree nuovo.
 */
export type RemoteDispatchDestination = 'auto' | 'new_lane';

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
	/** Cartella del progetto sulla macchina: serve a riaprirlo con `open_project`. Assente dagli host precedenti. */
	path?: string | null;
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
	/** Conferme di avvio in sospeso (`dispatch_confirm`). */
	dispatchConfirmations?: RemoteDispatchConfirmation[];
}

/**
 * Ancore del tema di Studio (`src/lib/theme.ts`, `ThemeAnchors`): la PWA ne
 * deriva gli stessi token, cosi' il telefono ha i colori della macchina.
 */
export interface RemoteTheme {
	/** Superficie dell'app, colore CSS. */
	bgBase: string;
	/** Pozzo di terminale ed editor, colore CSS. */
	bgSunken: string;
	brandH: number;
	brandC: number;
	warnH: number;
	warnC: number;
	isLight: boolean;
}

export interface HostState {
	projects: RemoteProject[];
	quota: RemoteQuota | null;
	/** Assente dagli host pubblicati prima del campo. */
	theme?: RemoteTheme | null;
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

/**
 * Programmazione scelta da remoto. Il provider del reset lo risolve Studio dal
 * ruolo o dal modello del task, come quando la scelta si fa nella GUI.
 */
export type RemoteScheduleChoice = { kind: 'reset' } | { kind: 'at'; notBefore: number };

/**
 * Impostazioni di un lavoro in coda scelte da remoto (`task_options`). Campo
 * assente = invariato; `null` = torna al valore del ruolo o del progetto.
 * Prewalk, contesto editor e avvio solo manuale non passano da qui e
 * restano quelli del task.
 */
export interface RemoteTaskOptions {
	role?: string | null;
	modelSelector?: string | null;
	thinkingLevel?: string | null;
	/** Id del catalogo `RemoteComposerCatalog.directives`, nell'ordine scelto. */
	directiveIds?: string[];
}

/** Risposta a una conferma di avvio. */
export type RemoteDispatchAnswer =
	| { action: 'cancel' }
	/** `concurrency`: avvia comunque. */
	| { action: 'confirm' }
	/** `local_files`: file da copiare (anche nessuno). */
	| { action: 'files'; accepted: string[] };

/** Corsia di un progetto: `main` per la Principale. */
export interface RemoteLaneRef {
	projectId: string;
	laneId: string;
}

export type RemoteCommand =
	| { kind: 'respond_ui'; projectId: string; laneId: string | null; requestId: string; answer: RemoteAnswer }
	/** `destination` (`task_options`) assente = `auto`. Risultato: `RemoteDispatchOutcome`. */
	| { kind: 'run_task'; projectId: string; taskId: string; destination?: RemoteDispatchDestination }
	| { kind: 'wait_quota_reset'; projectId: string; laneId: string | null }
	| { kind: 'dismiss_quota_blocked'; projectId: string; laneId: string | null }
	/**
	 * Task in coda in fondo. Senza `options` usa le impostazioni predefinite del
	 * progetto. `images` con `path` restituiti da `stage_attachment`. Con
	 * `start` il lavoro parte subito: il risultato porta anche `dispatch`.
	 */
	| {
			kind: 'create_task';
			projectId: string;
			prompt: string;
			schedule: RemoteScheduleChoice | null;
			options?: RemoteTaskOptions;
			images?: RemotePromptImage[];
			start?: { destination: RemoteDispatchDestination };
	  }
	/** Campo assente = invariato; `schedule: null` toglie la programmazione. Solo task in coda. */
	| {
			kind: 'update_task';
			projectId: string;
			taskId: string;
			prompt?: string;
			schedule?: RemoteScheduleChoice | null;
			options?: RemoteTaskOptions;
			/** `keep`: indici delle immagini attuali da conservare; `add`: nuove, in coda. */
			images?: { keep: number[]; add: RemotePromptImage[] };
	  }
	| { kind: 'delete_task'; projectId: string; taskId: string }
	/** `toIndex` e' la posizione fra i task in coda del progetto, da 0. */
	| { kind: 'move_task'; projectId: string; taskId: string; toIndex: number }
	/** Lavoro in coda completo (`task_options`). */
	| { kind: 'get_task'; projectId: string; taskId: string }
	/** Risponde a una conferma di avvio; risultato `RemoteDispatchOutcome` (puo' chiederne un'altra). */
	| { kind: 'respond_dispatch'; projectId: string; confirmationId: string; answer: RemoteDispatchAnswer }
	/** Rilegge le quote di tutti i provider configurati. */
	| { kind: 'refresh_quota' }
	/** Come Stop in Studio: interrompe il turno della corsia. */
	| { kind: 'abort'; projectId: string; laneId: string | null }
	/**
	 * Messaggio alla sessione della corsia. Ad agente fermo e' un nuovo turno;
	 * mentre lavora entra nella coda di `omp` come `steer` o `follow_up`.
	 */
	| {
			kind: 'send_prompt';
			projectId: string;
			laneId: string | null;
			text: string;
			whileBusy: 'steer' | 'follow_up';
			images?: RemotePromptImage[];
			attachments?: Array<{ path: string; name: string }>;
	  }
	/** Pagina di storico, dalla piu' recente indietro; `before` e' il cursore della pagina precedente. */
	| { kind: 'chat_history'; projectId: string; laneId: string | null; before: string | null; limit: number }
	| { kind: 'list_project_folders' }
	/** Solo cartelle sotto la radice dei progetti di Studio, come nel selettore della GUI. */
	| { kind: 'open_project'; path: string }
	/** Cartella nuova sotto la radice, `git init`, repository GitHub facoltativo. */
	| { kind: 'create_project'; name: string; github: { visibility: 'private' | 'public' } | null }
	/** Comandi, skill, modelli e ruoli per il composer della corsia (vedi `RemoteComposerCatalog`). */
	| { kind: 'composer_catalog'; projectId: string; laneId: string | null }
	/** Applica alla sessione il modello e il ragionamento assegnati al ruolo. */
	| { kind: 'set_lane_role'; projectId: string; laneId: string | null; roleId: string }
	| { kind: 'set_lane_model'; projectId: string; laneId: string | null; provider: string; modelId: string }
	| { kind: 'set_lane_thinking'; projectId: string; laneId: string | null; level: string }
	| {
			kind: 'stage_attachment';
			projectId: string;
			laneId: string | null;
			fileName: string;
			data: string;
			chunkIndex?: number;
			totalChunks?: number;
			stageId?: string;
	  }
	| { kind: 'refresh_context'; projectId: string; laneId: string | null; force?: boolean }
	| { kind: 'compact_context'; projectId: string; laneId: string | null }
	| { kind: 'list_sessions'; projectId: string; before: string | null; limit: number; query?: string }
	| { kind: 'session_history'; projectId: string; sessionId: string; before: string | null; limit: number }
	| { kind: 'mark_session_seen'; projectId: string; laneId: string | null; sessionId: string; completionId: string }
	/** Contenuto completo dell'anteprima del messaggio `messageId` (tool con `artifact.content: null`). */
	| { kind: 'get_artifact'; projectId: string; laneId: string | null; messageId: string };

/** Funzione che una macchina deve dichiarare perche' il comando le arrivi. */
export const COMMAND_FEATURE: Record<RemoteCommand['kind'], Feature> = {
	respond_ui: 'respond_ui',
	run_task: 'run_task',
	wait_quota_reset: 'quota_actions',
	dismiss_quota_blocked: 'quota_actions',
	create_task: 'task_edit',
	update_task: 'task_edit',
	delete_task: 'task_edit',
	move_task: 'task_edit',
	get_task: 'task_options',
	respond_dispatch: 'dispatch_confirm',
	refresh_quota: 'quota_refresh',
	abort: 'session_control',
	send_prompt: 'session_control',
	chat_history: 'chat',
	list_project_folders: 'projects',
	open_project: 'projects',
	create_project: 'projects',
	composer_catalog: 'lane_config',
	set_lane_role: 'lane_config',
	set_lane_model: 'lane_config',
	set_lane_thinking: 'lane_config',
	stage_attachment: 'session_control',
	refresh_context: 'session_control',
	compact_context: 'session_control',
	list_sessions: 'fleet',
	session_history: 'fleet',
	mark_session_seen: 'fleet',
	get_artifact: 'artifacts'
};

export interface RemoteChatMessage {
	/** Stabile nella sessione: un evento `message` con lo stesso id sostituisce il precedente. */
	id: string;
	role: 'user' | 'assistant' | 'tool' | 'system';
	/** Markdown per utente e assistente; riassunto di una riga per i tool. */
	text: string;
	toolName: string | null;
	timestamp: number | null;
	/**
	 * Campi ricchi: assenti dagli host pubblicati prima, che la PWA disegna
	 * con `text` e `toolName`. Assistente: blocchi nell'ordine del messaggio.
	 */
	blocks?: RemoteChatBlock[];
	/** Assistente: modello che ha risposto. */
	model?: string | null;
	/** Utente: immagini allegate (conteggio per fallback). */
	images?: number;
	/** Miniature base64 delle immagini inviate dall'utente per rendering fedele nel transcript. */
	imagePreviews?: Array<{ data: string; mimeType: string }>;
	tool?: RemoteToolCall;
}

export interface RemoteChatBlock {
	type: 'text' | 'thinking';
	text: string;
}

/** Categorie visuali dei tool di Studio (`src/lib/agent/tools/categories.ts`). */
export type RemoteToolCategory =
	| 'read'
	| 'search'
	| 'run'
	| 'edit'
	| 'web'
	| 'think'
	| 'wait'
	| 'other'
	| 'task'
	| 'todo'
	| 'ask';

export interface RemoteTodoItem {
	text: string;
	status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
}

export interface RemoteToolCall {
	category: RemoteToolCategory;
	/** Verbo gia' nella lingua di Studio («Modifica», «Cerca»...). */
	label: string;
	/** Oggetto della chiamata: percorso, comando, pattern, url. */
	detail: string | null;
	/** Esito sintetico: «5 in 2 file», «28 righe», «exit 1». */
	meta: string | null;
	/** Intento dichiarato dall'agente. */
	intent: string | null;
	status: 'running' | 'ok' | 'error';
	errorReason: string | null;
	startedAt: number;
	endedAt: number | null;
	/** Righe aggiunte e rimosse dalle modifiche. */
	diffStats: [number, number] | null;
	/** Diff nel formato di omp (`<segno><riga>|<testo>`), troncato. */
	diff: string | null;
	/** Coda dell'output testuale, troncata. */
	output: string | null;
	/** Tool `todo`: lista aggiornata dopo la chiamata. */
	todos: RemoteTodoItem[] | null;
	/** Anteprima prodotta dal tool (diagramma, SVG, prototipo): vedi `RemoteArtifact`. */
	artifact?: RemoteArtifact | null;
}

/** Tipi di anteprima che la PWA sa aprire nella superficie dedicata. */
export type RemoteArtifactKind = 'mermaid' | 'svg' | 'html';

/** Oltre questa dimensione il contenuto non viaggia nel messaggio: va chiesto con `get_artifact`. */
export const ARTIFACT_INLINE_MAX_BYTES = 24 * 1024;
/** Tetto assoluto di un contenuto servito da `get_artifact`: resta sotto `MAX_FRAME_BYTES`. */
export const ARTIFACT_MAX_BYTES = 384 * 1024;

/**
 * Anteprima visuale di una chiamata a tool. `mermaid`: sorgente del diagramma
 * (`studio_diagram`, file `.mmd`); `svg`: markup (file `.svg`, da sanificare
 * lato PWA); `html`: codice HTML/TSX di un prototipo (`studio_preview`), che la
 * PWA avvolge e pubblica sul relay (`POST /v1/preview`) per mostrarlo in un
 * iframe isolato.
 */
export interface RemoteArtifact {
	kind: RemoteArtifactKind;
	title: string;
	/** Dimensione in byte UTF-8 del contenuto completo. */
	bytes: number;
	/** `null` quando supera `ARTIFACT_INLINE_MAX_BYTES`: la PWA lo chiede con `get_artifact`. */
	content: string | null;
}

export interface RemoteChatPage {
	/** In ordine cronologico. */
	messages: RemoteChatMessage[];
	/** Cursore per la pagina precedente; `null` all'inizio della sessione. */
	before: string | null;
}

/**
 * Evento dal vivo della corsia seguita:
 * - `message`: messaggio nuovo o completato (sostituisce per `id`);
 * - `delta`: testo in streaming da accodare al messaggio `messageId`. `block`
 *   e `index` dicono a quale blocco dell'assistente va (assenti: testo); i
 *   delta `thinking` arrivano solo con la funzione `chat_rich`;
 * - `reset`: la corsia ha cambiato sessione, lo storico va riletto.
 */
export type RemoteChatEvent =
	| { kind: 'message'; message: RemoteChatMessage }
	| { kind: 'delta'; messageId: string; text: string; block?: RemoteChatBlock['type']; index?: number }
	| { kind: 'reset' };

export interface RemoteFolder {
	name: string;
	/** Percorso assoluto sulla macchina. */
	path: string;
	/** Progetto gia' aperto in Studio su quella cartella. */
	openProjectId: string | null;
	git: boolean;
}

export interface RemoteFolderList {
	/** Radice dei progetti configurata in Studio; `null` se manca. */
	root: string | null;
	folders: RemoteFolder[];
	/** GitHub autenticato su questa macchina (Gate R44 R7). */
	githubAvailable?: boolean;
}

/**
 * Comando del composer che la sessione esegue se arriva come testo del prompt:
 * i comandi di `omp` e delle sue estensioni e le skill. Quelli che Studio
 * gestisce in casa (`/loop`, `/goal`...) restano fuori, perche' `send_prompt`
 * li manderebbe al modello come testo.
 */
export interface RemoteSlashCommand {
	/** Senza `/`; per le skill il nome da scrivere dopo `/skill:`. */
	name: string;
	kind: 'command' | 'skill';
	description: string | null;
	/** Suggerimento per l'argomento, se il comando ne prende uno. */
	hint: string | null;
}

export interface RemoteModelOption {
	provider: string;
	id: string;
	name: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	thinking?: boolean | string[] | { mode?: string; efforts?: string[] };
	input?: string[];
	promptCache?: boolean;
}

export interface RemoteRoleOption {
	/** `default`, `plan`, `smol`, `slow`, ... */
	id: string;
	label: string;
	/** Modello assegnato (`provider/id`), `null` se il ruolo non ne ha. */
	model: string | null;
	modelLabel: string | null;
	thinking: string | null;
}

/** Direttiva del catalogo di Studio assegnabile a un lavoro (`task_options`). */
export interface RemoteDirectiveOption {
	id: string;
	name: string;
	description: string | null;
}

export interface RemoteComposerCatalog {
	commands: RemoteSlashCommand[];
	/** Modelli assegnabili: provider configurati con credenziali valide. */
	models: RemoteModelOption[];
	roles: RemoteRoleOption[];
	/** Livelli di ragionamento supportati dal modello attuale, dal piu' basso. */
	thinkingLevels: string[];
	/** Direttive visibili del catalogo dei task; assente dagli host senza `task_options`. */
	directives?: RemoteDirectiveOption[];
}

/** Dati restituiti in `command_result.data` dai comandi che ne hanno. */
export interface RemoteCommandData {
	/** `dispatch` solo con `start`. */
	create_task: { taskId: string; dispatch?: RemoteDispatchOutcome };
	/** Dagli host senza `task_options` nessun dato. */
	run_task: RemoteDispatchOutcome;
	get_task: RemoteTaskDetail;
	respond_dispatch: RemoteDispatchOutcome;
	chat_history: RemoteChatPage;
	list_project_folders: RemoteFolderList;
	open_project: { projectId: string };
	create_project: { projectId: string };
	composer_catalog: RemoteComposerCatalog;
	stage_attachment: { path: string; name: string; size: number };
	refresh_context: { success: true };
	compact_context: { success: true };
	list_sessions: RemoteSessionPage;
	session_history: RemoteChatPage;
	mark_session_seen: { success: true };
	get_artifact: { artifact: RemoteArtifact };
}

export interface RemotePromptImage {
	type: 'image';
	data?: string;
	path?: string;
	mimeType: string;
}

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
	/** `data` segue `RemoteCommandData` per il tipo del comando. */
	| { type: 'command_result'; commandId: string; ok: boolean; error?: CommandError; data?: unknown }
	/** Solo per le corsie elencate nell'ultimo `chat_watch`. */
	| { type: 'chat_event'; projectId: string; laneId: string; event: RemoteChatEvent }
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
	/**
	 * Corsie che almeno un dispositivo segue adesso; sostituisce l'elenco precedente.
	 * Lo ricevono solo le macchine con `chat`: le altre non conoscono il frame.
	 */
	| { type: 'chat_watch'; lanes: RemoteLaneRef[] }
	| { type: 'ping'; seq: number; t: number };

/** PWA -> relay, su `API.clientSocket` con il cookie di sessione. */
export type ClientFrame =
	| { type: 'hello'; protocol: ProtocolId }
	/** `commandId` lo genera il client (UUID) e torna nel risultato. */
	| { type: 'command'; commandId: string; hostId: string; command: RemoteCommand }
	| { type: 'resync'; hostId: string }
	/** Inizia o smette di seguire la chat di una corsia (`laneId` `main` per la Principale). */
	| { type: 'chat_subscribe'; hostId: string; projectId: string; laneId: string }
	| { type: 'chat_unsubscribe'; hostId: string; projectId: string; laneId: string }
	| { type: 'pong'; seq: number }
	| { type: 'visibility'; visible: boolean };

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
	| {
			type: 'command_result';
			hostId: string;
			commandId: string;
			ok: boolean;
			error?: CommandError;
			data?: unknown;
	  }
	| { type: 'chat_event'; hostId: string; projectId: string; laneId: string; event: RemoteChatEvent }
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
	clientSocket: '/v1/client',
	pushVapidPublicKey: '/v1/push/vapid-public-key',
	pushSubscriptions: '/v1/push/subscriptions',
	preview: '/v1/preview'
} as const;

/** Percorso con cui il relay serve un prototipo pubblicato: `/p/<id>/`. */
export const PREVIEW_PATH_PREFIX = '/p/';

/** Tetto del documento HTML di un prototipo pubblicato con `POST /v1/preview`, in byte UTF-8. */
export const PREVIEW_MAX_HTML_BYTES = 1024 * 1024;

export interface PublishPreviewRequest {
	html: string;
}

export interface PublishPreviewResponse {
	/** Percorso relativo da mettere in un `<iframe sandbox="allow-scripts">`. */
	url: string;
}

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

// ---------------------------------------------------------------------------
// Notifiche Web Push (Gate R44 - R9)
// ---------------------------------------------------------------------------

export interface VapidPublicKeyResponse {
	publicKey: string;
}

export interface PushSubscriptionKeys {
	p256dh: string;
	auth: string;
}

export interface PushSubscriptionData {
	endpoint: string;
	keys: PushSubscriptionKeys;
	expirationTime?: number | null;
}

export interface SavePushSubscriptionRequest {
	subscription: PushSubscriptionData;
	userAgent?: string;
	/**
	 * Lingua della UI del dispositivo: il relay localizza titolo e corpo delle
	 * notifiche. Assente (client vecchi) vale l'inglese.
	 */
	language?: 'it' | 'en';
}

export interface SavePushSubscriptionResponse {
	ok: boolean;
	subscriptionId: string;
}

export interface DeletePushSubscriptionRequest {
	endpoint?: string;
}

export interface PushNotificationPayload {
	title: string;
	body: string;
	icon?: string;
	badge?: string;
	tag?: string;
	data?: {
		hostId?: string;
		projectId?: string;
		laneId?: string;
		requestId?: string;
		type?: 'attention' | 'quota' | 'idle' | string;
		url?: string;
		/**
		 * Contenuto strutturato della notifica: il relay lo ricompone nella lingua
		 * dichiarata dalla sottoscrizione al momento dell'invio (`pushText.ts`).
		 * `title`/`body` restano la resa inglese predefinita per i client vecchi.
		 */
		text?: PushNotificationText;
	};
}

/** Contenuto strutturato di una notifica, sufficiente a comporla in ogni lingua. */
export interface PushNotificationText {
	kind: 'attention' | 'quota_blocked' | 'quota_provider_exhausted' | 'lane_idle';
	hostName: string;
	projectName?: string | null;
	/** Titolo o messaggio della richiesta in attesa. */
	question?: string | null;
	/** `quota_exhausted` oppure un errore del fornitore. */
	reason?: string | null;
	provider?: string | null;
	account?: string | null;
	laneTitle?: string | null;
}
