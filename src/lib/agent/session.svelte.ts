import { attachEditorContext, splitMessageAndEditorContext } from '$lib/editor/editorContext';
import { invoke } from '@tauri-apps/api/core';
import { orchestratePromptPreflight, type PromptPreflightDeps } from './promptPreflight';
import { settingsStore } from '$lib/stores/settings.svelte';
import { formatTokens } from '$lib/utils/format';
import { traceAgent } from '$lib/focusTracer';
import { notifyGitStatusRefresh } from '$lib/stores/gitDiff.svelte';
import { nameExistingPrototypeIfLong, nameLaneFromPrompt } from '$lib/lanes/laneNaming';
import { projectStore } from '$lib/stores/projects.svelte';
import { perfMark, perfSpan } from '$lib/perf';
import { generateSessionTitle } from '$lib/stores/sessionTitles';
import {
	agentHeadsUp,
	buildTurnDigest,
	collectTurnFacts,
	factsSentence,
	lastAssistantId,
	lastTurnEntries,
	resolveHeadsUp,
	turnKeyOf,
	wantsSmolHeadsUp,
	type HeadsUpFact,
	type HeadsUpPhrases,
	type TurnHeadsUp
} from './turnHeadsUp';

let firstComposerReadyMarked = false;
// Stato della superficie GUI: un'istanza per progetto.
//
// Il riduttore e' esplicito e volutamente noioso: ogni frame del protocollo
// ha una riga qui, e i frame sconosciuti cadono. La forma delle entry e' di
// Studio, non di omp: e' quello che permette a replay e diretta di passare
// dallo stesso rendering (`ricerca/TOOL-DETAILS.md`).

import { isAllowedExternalUrl } from '$lib/utils/externalUrl';
import { openExternalUrl } from '$lib/utils/openExternal';
import { OmpRpcClient } from './client';
import { isMissingSessionError, parseUnavailableResumeModel } from './resumeErrors';
import { laneStore } from '$lib/stores/lanes.svelte';
import type { LaneId, ProjectId } from '$lib/types/lanes';
import { splitModelSelector } from '$lib/stores/modelSettingsHelpers';
import { handOffPrewalk, isPrewalkHandOff, parsePrewalkNotice, reducePrewalkNotice, type PrewalkState } from './prewalk';
import {
	parseAskQuestions,
	normalizePromptAnswer,
	type AskQuestion,
	type PromptAnswer
} from './askAnswers';
import { AskStreamTracker, streamToAskQuestions, type StreamAskState } from './askStream';
import { queueChips } from './queueRestore';
import { canRestorePrompt, promptBus, type PromptRequest } from './promptBus';
import { laneSessionKey } from './sessionKeys';
import { SessionSuggestions } from './suggestions.svelte';
import { askQuestionText } from './askTitle';
import type { RecentChatMessage } from '$lib/stores/companion.svelte';
import {
	ACTIVITY_MAX_CHARS,
	RECENT_MESSAGE_MAX_CHARS,
	tailOfText
} from '$lib/stores/companionText';
import type { GuiGateSnapshot } from './automationGate';
import {
	emptyExtensionUi,
	reduceExtensionUi,
	type ExtensionStatusMap,
	type ExtensionWidgetMap
} from './extensionUi';
import {
	INITIAL_SETTLE,
	isBackgroundPending,
	isBackgroundYield,
	promptResultError,
	settleFromState,
	settleOnAgentStart,
	settleOnPromptResult,
	settleOnSessionSettled,
	settleOnYield,
	type SettleState
} from './settle';
import {
	AWAITING_RUN_TIMEOUT_MS,
	INITIAL_RUN_ACTIVITY,
	awaitingRunExpired,
	quietForMs,
	reduceRunActivity,
	runActivityOnPromptDropped,
	runActivityOnPromptSent,
	runActivityReset,
	verifyQuietSnapshot,
	type QuietVerdict,
	type RunActivity
} from './runActivity';
import {
	LOOP_CONTROL_COMMAND,
	LOOP_STATUS_KEY,
	controlLine,
	draftCommand,
	isLoopActive,
	isLoopPromptEcho,
	parseLoopSnapshot,
	type LoopDraft,
	type LoopProbe,
	type LoopState
} from './loopMode';
import {
	answerCurrent,
	canLaunch,
	currentQuestion,
	describeAnswer,
	goalMarkdown,
	mergeAgentSuggestions,
	parseAttemptCap,
	parseFreeAnswer,
	parseStudioGoalStatus,
	setIdea,
	shouldPauseForCap,
	skipCurrent,
	startInterview,
	STUDIO_GOAL_COMMAND,
	STUDIO_GOAL_STATUS_KEY,
	suggestCommand,
	type GoalAnswerValue,
	type GoalDraft,
	type GoalFieldKey,
	type GoalInterview
} from './guidedGoal';
import { getLocale } from '$lib/paraglide/runtime.js';
import {
	RENDER_WINDOW,
	clampVisibleCount,
	sliceVisibleEntries,
	hasEarlierEntries
} from './transcriptWindow';
import {
	ANSWERABLE_UI_METHODS,
	type AgentMessage,
	type AgentProgress,
	type AgentSessionEvent,
	type AgentToolResult,
	type AvailableCommand,
	type ContentBlock,
	type ContextUsage,
	type ImageContent,
	type LoginProviderInfo,
	type MessageUsage,
	type ModelInfo,
	type RpcSessionState,
	type SessionStats,
	type StreamingBehavior,
	type QueuedMessagesState,
	type QueuedMessageQueue,
	type RemoveQueuedMessageResult,
	type RestoredQueuedMessage,
	type ThinkingLevel,
	type TodoPhase,
	type FastModeResult,
	type Goal,
	type GoalModeState,
	type GoalResult,
	type UsageLimitState,
	type CacheWarmingPhase,
	type CacheWarmingOutcome,
	type CacheWarmingMode,
	type AskDialogAnswer,
	type AskDialogQuestion,
	type CancelSubagentResult,
	StreamBatcher
} from './wire';
import type { CacheWarmingInFlight, CacheWarmingLast } from './sessionModes';
import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
import { computeQuotaInfo } from '$lib/quota/projectQuota';
import {
	type BlockedQuotaState,
	classifyFailureReason,
	recommendRecoveryModel
} from './quotaRecovery';
import {
	STUDIO_BROWSER_LIVE_OFFER,
	browserLiveFrom,
	checkTicket,
	parseBrowserSessionIdentity,
	parseBrowserTabState,
	readAdvertisedCapabilities,
	shouldNegotiate,
	type BrowserFrameMeta,
	type BrowserInputEvent,
	type BrowserLiveClientMessage,
	type BrowserLiveEvent,
	type BrowserLiveNegotiation,
	type BrowserLiveStreamHandle,
	type BrowserLiveTicket,
	type BrowserRelayProbe,
	type BrowserRelayTarget,
	type BrowserSessionIdentity,
	type BrowserTabState,
	connectBrowserLive
} from './browser-live';
import { classifySystemMessage, noticeDedupKey, type JobResult, type ClassifiedNotice } from './notices';
import {
	OmpEntryCache,
	activePath,
	previousMessageEntryId,
	requestBranch,
	requestFork,
	resolveTurnEndEntryId,
	resolveUserEntryId,
	type BranchOutcome,
	type OmpEntriesPage,
	type OmpTreeSnapshot
} from './sessionTree';
import {
	isContextReportText,
	parseContextReport,
	type ContextReport
} from './contextReport';
import { m as messages } from '$lib/paraglide/messages.js';
import { PlanController } from './planController.svelte';
import { PLAN_STATUS_KEY, parsePlanReviewRequest, reanchorEntries } from './planMode';
import { SessionBtw } from './btwState.svelte';
/** Stato dell'agente per la barra dei progetti: stessa semantica del PTY. */
export type AgentSurfaceState = 'idle' | 'working' | 'attention' | 'unknown';

export type Block =
	| { type: 'text'; text: string }
	| { type: 'thinking'; text: string }
	| { type: 'image'; data: string; mimeType: string };

export interface SeededPrompt {
	id: number;
	content: string;
	images: { data: string; mimeType: string }[];
	createdAt: number;
}

export interface UserEntry {
	id: number;
	kind: 'user';
	content: string;
	images: { data: string; mimeType: string }[];
	attribution?: string;
	/**
	 * `message.timestamp` (ms) del messaggio omp: e' lo stesso valore che omp
	 * scrive nel file di sessione, quindi lega l'entry del transcript all'entry
	 * durevole di `get_entries` per diramare da questo punto.
	 */
	messageTs?: number;
	/** Prompt ripetuto dal loop: numero del giro (il transcript lo ripiega). */
	loopGiro?: number;
	/** Messaggio d'avvio di un /loop dalla GUI: id del loop, per la riga di riepilogo. */
	loopStart?: string;
}

export interface AssistantEntry {
	id: number;
	kind: 'assistant';
	blocks: Block[];
	usage?: MessageUsage;
	model?: string;
	stopReason?: string;
	/** Come `UserEntry.messageTs`; condiviso dai pezzi di uno stesso messaggio. */
	messageTs?: number;
}

export interface ToolEntry {
	id: number;
	kind: 'tool';
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	intent?: string;
	result?: AgentToolResult;
	running: boolean;
	startedAt: number;
	endedAt?: number;
}

export interface NoticeEntry {
	id: number;
	kind: 'notice';
	level: 'info' | 'warning' | 'error';
	message: string;
	source?: string;
	/** Righe di contesto (stderr di un processo morto, per esempio). */
	detail?: string[];
	/** Presente sugli avvisi che offrono il passaggio alla TUI. */
	offerTerminal?: boolean;
	/** Azione azionabile associata all'avviso (es. scelta modello). */
	action?: {
		label: string;
		title?: string;
		run: () => void;
	};
}

/**
 * Esito effimero di un comando di Studio: vive sopra il composer e non entra nel
 * transcript, cosi' una conferma (ruolo, thinking, copia) non cancella l'hero
 * di una chat vuota e non resta nello storico della sessione.
 */
export interface ComposerNotice {
	id: number;
	level: 'info' | 'warning' | 'error';
	message: string;
}

export interface CompactionEntry {
	id: number;
	kind: 'compaction';
	message: string;
	running: boolean;
	summary?: string;
	shortSummary?: string;
	tokensBefore?: number;
	tokensAfter?: number;
}

export interface RetryEntry {
	id: number;
	kind: 'retry';
	message: string;
}

export interface TtsrEntry {
	id: number;
	kind: 'ttsr';
	rules: string[];
}

/**
 * Risultato di uno o piu' job asincroni eseguiti in background (subagenti task,
 * comandi bash, script eval).
 */
export interface SubagentResultEntry {
	id: number;
	kind: 'subagent-result';
	jobs: JobResult[];
}

/** Messaggio del protocollo IRC tra agenti o auto-risposta. */
export interface IrcEntry {
	id: number;
	kind: 'irc';
	direction: 'in' | 'out';
	peer: string;
	body: string;
	replyTo?: string;
}

/**
 * Notifica di sistema compatta (chip), visibile normalmente o solo con
 * l'interruttore diagnostico per i messaggi interni upstream.
 */
export interface SystemChipEntry {
	id: number;
	kind: 'system-chip';
	customType: string;
	title: string;
	body: string;
	/** true per i messaggi che upstream marca `display: false`: la timeline li mostra solo con l'interruttore diagnostico attivo. */
	internal?: boolean;
}
/**
 * Risultato o stato di un'operazione di integrazione corsia (Lane Landing).
 * Lo stato vive nel servizio reattivo `laneLanding`, indicizzato per `landingId`.
 */
export interface LaneLandingEntry {
	id: number;
	kind: 'lane-landing';
	landingId: string;
}

/**
 * Voce del solo client per la modalita' Piano (Gate R36): riga d'entrata
 * o d'uscita, card del piano in revisione, card del passaggio di compito.
 * `refId` punta allo stato in `planCards`; `anchorTs` e `sessionId` la
 * rimettono al suo posto dopo una ricostruzione del transcript.
 */
export interface PlanEntry {
	id: number;
	kind: 'plan';
	variant: 'enter' | 'exit' | 'doc' | 'handoff';
	refId: string;
	anchorTs: number | null;
	sessionId: string | null;
}

/**
 * Passo dell'intervista dell'obiettivo guidato: vive solo in Studio (non va a
 * omp e non entra nel contesto). `draft` disegna la card della bozza leggendo
 * `session.guidedGoal` per `interviewId`.
 */
export interface GuidedGoalEntry {
	id: number;
	kind: 'guided-goal';
	part: 'command' | 'question' | 'answer' | 'draft' | 'started' | 'note';
	interviewId: string;
	text: string;
	field?: GoalFieldKey;
}

export type TranscriptEntry =
	| GuidedGoalEntry
	| UserEntry
	| AssistantEntry
	| ToolEntry
	| NoticeEntry
	| CompactionEntry
	| RetryEntry
	| TtsrEntry
	| SubagentResultEntry
	| IrcEntry
	| SystemChipEntry
	| LaneLandingEntry
	| PlanEntry;
/** Una voce della coda di omp: testo opaco del chip e coda di provenienza. */
export interface QueuedMessage {
	text: string;
	queue: QueuedMessageQueue;
}

export interface PendingAsk {
	kind: 'ask';
	requestId: string;
	/**
	 * Chiamata `ask` a cui la richiesta appartiene. Serve a legare la card e il
	 * piano di consegna alla chiamata invece che al singolo round del filo.
	 */
	toolCallId?: string;

	method: 'select' | 'confirm' | 'input' | 'editor' | 'ask';
	title: string;
	message?: string;
	options: string[];
	optionDetails: { description?: string }[];
	placeholder?: string;
	prefill?: string;
	/** Scadenza assoluta in ms; oltre, omp risolve da se' al default. */
	deadline?: number;
	/**
	 * Lista completa delle domande ricavata dagli argomenti del tool `ask`.
	 * Presente solo quando le opzioni di *questa* richiesta corrispondono
	 * davvero a quelle della domanda `questionIndex`: senza la verifica il
	 * wizard finirebbe per rispondere alla domanda sbagliata.
	 */
	questions?: AskQuestion[];
	/**
	 * Indice 0-based della domanda che omp sta chiedendo adesso. Ricavato dal
	 * titolo `(k/N)` e confermato dalle opzioni quando la lista c'e'.
	 */
	questionIndex?: number;
	/** Conteggio totale delle domande nella sequenza */
	totalQuestions?: number;
}

export type PendingUiRequest = PendingAsk;

/** Contenuto di una risposta a una `extension_ui_request`. */
type AskAnswerPayload =
	| { value: string }
	| { confirmed: boolean }
	| { cancelled: true; timedOut?: boolean }
	| { answers: AskDialogAnswer[] };

export { RENDER_WINDOW, clampVisibleCount, sliceVisibleEntries, hasEarlierEntries } from './transcriptWindow';

/** Tentativi di ricostruzione del transcript prima di arrendersi. */
const REBUILD_ATTEMPTS = 3;

/**
 * Ogni quanto si richiede `get_state` mentre si aspetta la quiete. E' solo la
 * rete per un `session_settled` perso: il segnale normale e' il frame.
 */
const SETTLE_POLL_MS = 15_000;

/**
 * Con un omp che non riporta la quiete, un run che ha ceduto senza un
 * `agent_end` terminale (continuazione annullata) resterebbe «vivo» per
 * sempre. Dopo questo tempo senza eventi `get_state` decide.
 */
const RUN_STALE_MS = 20_000;

function textOf(blocks: ContentBlock[] | string | undefined): string {
	if (!blocks) return '';
	// I messaggi `custom` di omp portano `content` come stringa: senza questo
	// ramo `.filter` esploderebbe su un frame perfettamente legittimo.
	if (typeof blocks === 'string') return blocks;
	if (!Array.isArray(blocks)) return '';
	return blocks
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text ?? '')
		.join('\n');
}

function imagesOf(blocks: ContentBlock[] | string | undefined): { data: string; mimeType: string }[] {
	if (!blocks || !Array.isArray(blocks)) return [];
	const images: { data: string; mimeType: string }[] = [];
	for (const block of blocks) {
		if (block.type !== 'image' || typeof block.data !== 'string') continue;
		images.push({ data: block.data, mimeType: block.mimeType ?? 'image/png' });
	}
	return images;
}

/** `i` e' l'intento, non un argomento: va nell'intestazione della card. */
function stripIntent(args: Record<string, unknown> | undefined): Record<string, unknown> {
	if (!args) return {};
	const { i: _intent, ...rest } = args;
	return rest;
}

/** Solo i blocchi di testo di una risposta: il pensiero e le immagini restano fuori. */
function assistantEntryText(entry: AssistantEntry): string {
	return entry.blocks
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.filter(Boolean)
		.join('\n')
		.trim();
}

/** Testi localizzati per la frase dei fatti dell'heads-up. */
function headsUpPhrases(): HeadsUpPhrases {
	return {
		failed: (command) => messages.headsup_fact_failed({ command }),
		failedTwo: (first, second) => messages.headsup_fact_failed_two({ first, second }),
		failedMany: (command, others) => messages.headsup_fact_failed_many({ command, count: others }),
		expiredQuestion: () => messages.headsup_fact_expired_question(),
		risky: (command) => messages.headsup_fact_risky({ command }),
		sensitive: (files) => messages.headsup_fact_sensitive({ files }),
		sensitiveMany: (files, others) => messages.headsup_fact_sensitive_many({ files, count: others }),
		and: messages.headsup_fact_and()
	};
}

export interface AgentSessionConfig {
	cwd: string;
	scope?: 'lane' | 'main';
	laneId?: string | null;
	projectKey?: string | null;
	observedRevisionId?: string | null;
	lab?: { prototypeId: string; projectPath: string | null };
	client?: OmpRpcClient;
}

export class AgentSession {
	readonly client: OmpRpcClient;
	readonly suggestions: SessionSuggestions = new SessionSuggestions(this);
	/**
	 * Domande a margine (`/btw`): riquadro sopra il composer, storico e
	 * citazione «Usa nel messaggio». Non toccano mai il transcript.
	 */
	readonly btw: SessionBtw = new SessionBtw({
		send: (command) => this.client.send(command),
		flash: (level, message) => this.flashNotice(level, message),
		notice: (level, message) => this.pushNotice(level, message, 'studio')
	});

	readonly scope: 'lane' | 'main';
	readonly laneId: string | null;
	readonly labConfig?: { prototypeId: string; projectPath: string | null };
	readonly projectKey: string;
	observedRevisionId = $state<string | null>(null);

	private composerInsertHandlers = new Set<(text: string) => void>();

	/** Compositori montati che sanno rimettersi in bozza l'input ritirato dalla coda. */
	private queueRestoreHandlers = new Set<(entries: readonly RestoredQueuedMessage[]) => void>();
	/** Input ritirato senza compositore montato: consegnato al primo che si registra. */
	private pendingQueueRestore: RestoredQueuedMessage[] = [];

	registerComposerInsertHandler(handler: (text: string) => void): () => void {
		this.composerInsertHandlers.add(handler);
		return () => this.composerInsertHandlers.delete(handler);
	}

	insertComposerText(text: string): void {
		for (const handler of this.composerInsertHandlers) {
			handler(text);
		}
	}

	get sessionKey(): string {
		return laneSessionKey(this.projectKey, this.laneId ?? 'main');
	}

	private openReadySpanEnd: ((outcome?: string) => void) | null = null;
	private readyWaiters: Array<(ready: boolean) => void> = [];

	get isOpen(): boolean {
		return this.client.isOpen;
	}

	get isOpening(): boolean {
		return this.opening !== null;
	}

	get hasPendingStartupPrompts(): boolean {
		return this.pendingStartupPrompts.length > 0;
	}

	/**
	 * Attende che la sessione sia pronta (frame `ready` ricevuto da omp), o che scada il timeout.
	 */
	async waitUntilReady(timeoutMs = 7000): Promise<boolean> {
		if (this.isReady) return true;
		if (this.exited) return false;
		return new Promise<boolean>((resolve) => {
			let timer: number | null = null;
			const done = (ready: boolean) => {
				if (timer !== null) {
					window.clearTimeout(timer);
					timer = null;
				}
				const idx = this.readyWaiters.indexOf(done);
				if (idx !== -1) this.readyWaiters.splice(idx, 1);
				resolve(ready);
			};
			timer = window.setTimeout(() => {
				const idx = this.readyWaiters.indexOf(done);
				if (idx !== -1) this.readyWaiters.splice(idx, 1);
				resolve(this.isReady);
			}, timeoutMs);
			this.readyWaiters.push(done);
		});
	}

	entries = $state<TranscriptEntry[]>([]);
	visibleCount = $state(RENDER_WINDOW);

	isStreaming = $state(false);
	// Cresce di uno a ogni `agent_end` terminale: e' la fine della richiesta
	// dell'utente. `isStreaming` non basta, perche `turn_end` lo spegne dopo
	// ogni giro di tool e resta spento fino alla riconciliazione.
	runEndSeq = $state(0);
	// Ancora del cronometro di attesa mostrato in chat; misura il turno intero,
	// non la singola tratta, perche l'indicatore appare e sparisce piu volte
	// mentre l'agente alterna pensiero, testo e tool.
	turnStartedAt: number | null = $state(null);
	isCompacting = $state(false);
	isReady = $state(false);
	isAttached = $state(false);
	isAttaching = $state(false);
	isRebuildingTranscript = $state(false);
	requestedResume = $state<string | null>(null);
	activeAssistantId = $state<number | null>(null);

	model = $state<ModelInfo | null>(null);
	thinkingLevel = $state<ThinkingLevel | null>(null);
	prewalk = $state<PrewalkState>({ state: 'off' });
	overlayEnabled = $state(false);
	prewalkBusy = $state(false);
	private prewalkRestarting = false;
	private prewalkGeneration = 0;
	private prewalkConfirmation: {
		expected: 'armed' | 'off';
		resolve: () => void;
		reject: (error: Error) => void;
		timer: number;
	} | null = null;
	private prewalkOverlayWrite: Promise<void> = Promise.resolve();
	/**
	 * Ultimo ruolo scelto da Studio (menu, `/role`, Ctrl+P). omp non espone il ruolo
	 * via RPC e piu' ruoli possono condividere lo stesso modello: senza ricordarlo
	 * il composer mostrerebbe il primo ruolo con quel modello. Vedi resolveActiveRole.
	 */
	lastPickedRole = $state<string | null>(null);
	contextUsage = $state<ContextUsage | null>(null);
	/**
	 * Ripartizione di `/context`. Resta null finche' omp non risponde, e il
	 * pannello non la mostra se i token non coincidono piu' con `contextUsage`.
	 */
	contextReport = $state<ContextReport | null>(null);
	/** Ultimo esito di un comando di Studio, mostrato sopra il composer. */
	composerNotice = $state<ComposerNotice | null>(null);
	private composerNoticeSeq = 0;
	private contextReportStamp = '';
	/**
	 * Ultimo stato gia' sondato con `/context`, riuscito o no. Se il rapporto
	 * non torna con `get_state` (omp conta in modo diverso) risondare lo
	 * stesso stato darebbe lo stesso esito e terrebbe occupata la coda RPC.
	 */
	private contextProbedStamp = '';
	private contextReportWanted = '';
	private contextReportInflight: Promise<void> | null = null;
	private capturingContextReport = false;
	private contextReportCapture: string | null = null;
	sessionId = $state<string | null>(null);
	sessionFile = $state<string | null>(null);
	sessionName = $state<string | null>(null);
	/** Modello richiesto come override per startup (--model) */
	private requestedModelOverride: string | null = null;
	/** Modello non disponibile rilevato su resume fallito */
	private unavailableResumeModel: string | null = null;
	/** Modello fallback applicato durante la ripresa automatica */
	private resumedFallbackModel: string | null = null;
	/** Flag per tentare il fallback automatico su modello default una sola volta */
	private resumeFallbackAttempted = false;
	/** Flag per indicare un cambio di sessione intenzionale (new, fork, handoff) */
	private expectingSessionTransition = false;
	/**
	 * Timestamp del messaggio assistente in streaming: i pezzi aperti dopo una
	 * chiamata tool appartengono allo stesso messaggio omp e lo ereditano.
	 */
	private liveAssistantTs: number | undefined = undefined;
	/** Pannello «Rami» aperto (da `/tree`, dal pin o dal menu della chat). */
	branchPanelOpen = $state(false);
	/** Una diramazione e' in corso: menu e pannello non ne accettano un'altra. */
	branchBusy = $state(false);
	/** Copia di `get_entries`, aggiornata in coda: serve a tradurre i messaggi in entry. */
	private readonly ompEntries = new OmpEntryCache();
	queuedMessageCount = $state(0);
	/**
	 * Coda di omp come la mostra la tray: chip preprint. Sorgente di verita' e'
	 * omp (`get_state.queuedMessages` e l'evento `queue_update`); qui non c'e'
	 * nessuno specchio locale, perche' ogni modifica passa da un comando.
	 */
	queuedMessages = $state<QueuedMessagesState>({ steering: [], followUp: [] });
	sessionCost = $state<number | null>(null);
	subagentCost = $state(0);

	/** Costo totale comprensivo della sessione principale e dei subagenti. */
	get totalCost(): number | null {
		if (this.sessionCost === null && this.subagentCost === 0) return null;
		return (this.sessionCost ?? 0) + this.subagentCost;
	}

	todoPhases = $state<TodoPhase[]>([]);
	subagents = $state<AgentProgress[]>([]);
	todoReminder = $state<{ attempt: number; max: number } | null>(null);
	availableCommands = $state<AvailableCommand[]>([]);
	pendingUi = $state<PendingUiRequest | null>(null);
	/** Solo anteprima: nessuna risposta parte finche' omp non emette extension_ui_request. */
	streamAsk = $state<{ toolCallId: string | null; state: StreamAskState } | null>(null);
	private readonly askTracker = new AskStreamTracker();
	/**
	 * Voci di stato delle estensioni (`setStatus`), per `statusKey`. Nella TUI
	 * stanno nel piede; qui nella riga di stato del composer.
	 */
	extensionStatus = $state<ExtensionStatusMap>({});
	/** Widget di testo delle estensioni (`setWidget`), sopra o sotto il composer. */
	extensionWidgets = $state<ExtensionWidgetMap>({});
	/**
	 * Quiete della sessione (`session_settled`): vedi `settle.ts`. Finche' omp
	 * non dimostra di riportarla, lo yield vale come fine del lavoro.
	 */
	settle = $state<SettleState>({ ...INITIAL_SETTLE });
	private settlePollTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Attivita' del run per l'avvio automatico della coda (`runActivity.ts`).
	 * Il record intero non e' reattivo (cambia a ogni delta); i due flag che
	 * il cancello legge sono rispecchiati in `awaitingRun` e `isRetrying`.
	 */
	private runActivity: RunActivity = { ...INITIAL_RUN_ACTIVITY };
	/** Prompt ammesso, `agent_start` non ancora arrivato. */
	awaitingRun = $state(false);
	/** omp aspetta per ritentare la chiamata al modello. */
	isRetrying = $state(false);
	private awaitingRunTimer: ReturnType<typeof setTimeout> | null = null;
	private runWatchTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * /loop della GUI (estensione `studio-loop.ts`): stato pubblicato con
	 * `setStatus("studio.loop")`. Resta dopo la fine finche' l'utente non
	 * preme «Chiudi», come il pannello del prototipo.
	 */
	loop = $state<LoopState | null>(null);
	/** Esito dell'ultimo «Prova ora» sul comando della condizione. */
	loopProbe = $state<LoopProbe | null>(null);
	/** Composer in modalita' ripetizione (pillole) prima dell'avvio. */
	loopSetup = $state<LoopDraft | null>(null);
	/** Id dei loop gia' annunciati con il messaggio d'avvio nel transcript. */
	private readonly announcedLoops = new Set<string>();
	/** `--between reset`: la sessione nuova per il giro e' gia' stata chiesta. */
	private loopResetFor: string | null = null;
	seededPrompt = $state<SeededPrompt | null>(null);
	startupPhase = $state<'idle' | 'starting' | 'ready'>('idle');
	exited = $state(false);

	fastModeEnabled = $state(false);
	fastModeActive = $state(false);
	slowModeSupported = $state(false);
	slowModeEnabled = $state(false);
	slowModeScope = $state<'session' | 'global' | null>(null);
	usageLimit = $state<UsageLimitState | null>(null);
	goal = $state<GoalModeState | null>(null);
	/** Modalita' Piano della chat GUI: revisione e passaggio di compito. */
	readonly plan: PlanController = new PlanController(this);
	/** Intervista dell'obiettivo guidato in corso (o appena conclusa). */
	guidedGoal = $state<GoalInterview | null>(null);
	/** Tentativi dell'obiettivo corrente contati da Studio (turni con l'obiettivo attivo). */
	goalAttempts = $state(0);
	/** Tetto di tentativi dell'obiettivo corrente (dal testo dell'obiettivo). */
	goalAttemptCap = $state<number | null>(null);
	private goalTrackedId: string | null = null;
	private goalAttemptOpen = false;
	private guidedGoalSeq = 0;
	private guidedGoalTimer: ReturnType<typeof setTimeout> | null = null;
	cacheWarmingInFlight = $state<CacheWarmingInFlight | null>(null);
	cacheWarmingLast = $state<CacheWarmingLast | null>(null);

	private preflightDeps: PromptPreflightDeps | null = null;

	/** Test seam per iniettare mock o configurazioni preflight */
	setPreflightDeps(deps: PromptPreflightDeps | null) {
		this.preflightDeps = deps;
	}

	/**
	 * Esito di `browser-live-v1` per questo processo: `null` finche' la
	 * capability non e' stata negoziata, ed e' esattamente cio' che tiene la
	 * superficie sul renderer screenshot del tool `browser`.
	 */
	browserLive = $state<BrowserLiveNegotiation | null>(null);
	/** Stato delle tab live, indirizzate da `browserSessionId + tabId`. */
	browserLiveTabs = $state<BrowserTabState[]>([]);
	#activeLiveHandles = new Map<string, BrowserLiveStreamHandle>();
	/** Stato per la tessera di progetto: derivato, non inventato. */
	agentState = $state<AgentSurfaceState>('unknown');
	/** Stato di blocco per esaurimento quota o errore irreversibile del provider. */
	blockedQuotaState = $state<BlockedQuotaState | null>(null);
	/** Attenzione dedotta dall'analisi semantica del turno (domanda/richiesta di conferma senza tool ask). */
	inferredAttention = $state<{ question: string; suggestions: string[] } | null>(null);
	/**
	 * Riga di attivita' per le superfici esterne (finestra companion).
	 *
	 * Aggiornata a eventi discreti -- inizio di un tool, fine del turno -- e
	 * mai a ogni token: un `$derived` sul transcript avrebbe invalidato
	 * l'effetto di trasmissione a ogni delta dello streaming.
	 */
	activityLine = $state<{ text: string; at: number; kind: 'intent' | 'assistant' } | null>(null);
	/**
	 * Heads-up dell'ultimo turno concluso (Gate R40): una frase, o
	 * null quando non c'e' niente che l'utente rischi di perdere. Si fissa a
	 * fine turno (fatti + agente) e si aggiorna una volta sola se il ripiego
	 * smol risponde; si azzera all'avvio del turno successivo.
	 */
	headsUp = $state<TurnHeadsUp | null>(null);
	private headsUpTurnKey: string | null = null;
	private headsUpFacts: HeadsUpFact[] = [];
	private headsUpAgent: { text: string; entryId: number } | null = null;
	private headsUpFallbackEntryId: number | null = null;
	private headsUpFactsText: string | null = null;

	private nextEntryId = 1;
	private assistantEntry: AssistantEntry | null = null;
	private readonly toolEntries = new Map<string, ToolEntry>();
	private renderedCustomKeys = new Set<string>();
	readonly cwd: string;
	private stateRefresh: Promise<void> | null = null;
	private opening: Promise<void> | null = null;
	/**
	 * Sessione che l'apertura in volo sta riprendendo (`null` = sessione
	 * nuova). Serve a distinguere «la stessa apertura, chiesta due volte» da
	 * «un'altra sessione, che deve prendere il posto di questa».
	 */
	private openTarget: string | null = null;
	private recoveredResume: string | null = null;
	private attachEventQueue: AgentSessionEvent[] = [];
	/**
	 * Generazione dell'insediamento. `close()`, `studio_exit` e ogni nuovo
	 * `attach()` la fanno avanzare: un insediamento superato, che riprende
	 * dopo i suoi `await`, non deve piu' toccare `isAttaching`/`isAttached`,
	 * o spegnerebbe la coda dell'insediamento vivo e marcherebbe collegato
	 * (o scollegato) il processo sbagliato.
	 */
	private attachGeneration = 0;
	/**
	 * Apertura del client (`client.epoch`) che ha gia' emesso `ready`. Un
	 * processo omp emette `ready` una sola volta: un secondo `ready` sulla
	 * stessa apertura non e' un processo nuovo, e trattarlo come tale
	 * scollegava a meta' turno una sessione che stava lavorando, lasciando
	 * la composer su «in avvio...» per sempre.
	 */
	private readyEpoch: number | null = null;
	private isAborting = false;
	/** Rete di sicurezza dello Stop: chiude l'interruzione se omp non manda `agent_end`. */
	private abortFallbackTimer: number | null = null;
	/** Prompt scritti subito dopo uno Stop che aspettano la fine dell'interruzione. */
	private abortSettledWaiters: Array<() => void> = [];
	/** Chi aspetta la fine del turno (passaggio di compito del Piano). */
	private idleWaiters: Array<() => void> = [];
	private unsubscribeEvent: (() => void) | null = null;
	private deltaBatcher = new StreamBatcher((items) => {
		for (const item of items) {
			this.applyBufferedDelta(item.kind, item.contentIndex, item.delta);
		}
	});
	/**
	 * Messaggio dell'utente gia' disegnato in attesa dell'eco di omp. Senza,
	 * il testo sparisce dal campo di scrittura e riappare solo al ritorno del
	 * frame `message_start`: mezzo secondo in cui la chat sembra ferma.
	 */
	private optimisticUser: UserEntry | null = null;
	private pendingStartupPrompts: {
		message: string;
		images: ImageContent[];
		behavior: StreamingBehavior;
		optimisticUser: UserEntry;
	}[] = [];

	/**
	 * Notifica che i prompt in attesa dell'insediamento sono stati buttati via
	 * perche' il processo omp e' morto prima di riceverli. Chi lancia i task
	 * ci rimette il lavoro in coda: il prompt esiste solo qui dentro, e il
	 * task e' gia' uscito dalla coda.
	 */
	onStartupPromptsDropped: (() => void) | null = null;

	get isStarting(): boolean {
		return !this.isAttached && !this.exited;
	}

	/** Vero quando la sessione e' in fase di apertura, collegamento o caricamento dello storico. */
	get isLoading(): boolean {
		return !this.exited && (!this.isAttached || this.isAttaching || this.isRebuildingTranscript);
	}

	/** Vero se la sessione corrente sta effettuando la ripresa da uno storico di sessione. */
	get isResuming(): boolean {
		return this.isLoading && (!!this.requestedResume || (this.entries.length === 0 && !this.isAttached));
	}

	/**
	 * Cio' che la coda dei task deve sapere per decidere se un nuovo lavoro
	 * puo' partire. Il confine e' qui perche' solo la sessione conosce la
	 * differenza tra le due attese: `pendingUi` sospende il processo omp
	 * (aspetta il frame di risposta su stdin) mentre `inferredAttention` e'
	 * una domanda dedotta a fine turno, con il processo libero. La seconda
	 * sospende l'auto-dispatch finche' l'utente non decide, ma non gli toglie
	 * la possibilita' di avviare manualmente un altro lavoro.
	 */
	get automationSnapshot(): GuiGateSnapshot {
		const quota = this.blockedQuotaState;
		return {
			ready: this.isReady,
			attached: this.isAttached,
			// Fra un turno e l'altro `isStreaming` torna falso mentre l'agente
			// continua: lo stato della sessione e' lo stesso che leggono badge
			// e routing, cosi' il cancello non dice "pronto" a un agente al lavoro.
			// Il lavoro in background tiene `working` ma ha un motivo suo.
			streaming: this.isStreaming || (this.agentState === 'working' && !this.backgroundPending),
			// Il run resta vivo da `agent_start` allo yield anche quando
			// `turn_end` ha spento `isStreaming` fra un giro di tool e l'altro,
			// durante l'attesa di un nuovo tentativo o una compattazione che
			// continua il run. Prima di questi campi il cancello diceva
			// "pronto" in quelle pause e l'auto-avvio spediva il task dopo.
			runActive: this.settle.running,
			awaitingRun: this.awaitingRun,
			retrying: this.isRetrying,
			compacting: this.isCompacting,
			nativeQueue: this.queuedMessageCount > 0,
			subagentsRunning:
				!this.settle.aware && this.subagents.some((sub) => sub.status === 'running' || sub.status === 'pending'),
			blockingQuestion: this.pendingUi ? askQuestionText(this.pendingUi) : null,
			goalHold: this.goalHoldsSession,
			quotaBlock: quota && !quota.dismissed ? quota.title : null,
			inferencePending: this.suggestions.isAnalyzing,
			inferredQuestion: this.inferredAttention?.question ?? null,
			backgroundWork: this.backgroundPending,
			loopActive: isLoopActive(this.loop)
		};
	}

	/** Millisecondi dall'ultimo evento del ciclo di vita del run. */
	quietForMs(now = Date.now()): number {
		return quietForMs(this.runActivity, now);
	}

	/**
	 * Ri-verifica autorevole prima di un avvio automatico: chiede `get_state`,
	 * lo applica (riallinea run, coda e quiete) e risponde se omp e' davvero
	 * fermo. Un errore vale «non fermo»: meglio un giro di attesa in piu' che
	 * un task spedito sopra un run.
	 */
	async verifyQuietForDispatch(): Promise<QuietVerdict> {
		if (!this.isReady || !this.isAttached || this.exited) return { quiet: false, reason: 'streaming' };
		try {
			const state = await this.client.send<RpcSessionState>({ type: 'get_state' });
			this.applyState(state);
			return verifyQuietSnapshot(state);
		} catch {
			return { quiet: false, reason: 'streaming' };
		}
	}

	/** Nessun lavoro che possa ancora risvegliare la sessione (vedi `settle.ts`). */
	get settled(): boolean {
		return this.settle.settled;
	}

	/**
	 * L'agente ha ceduto il turno ma omp ha ancora lavoro in background
	 * (subagenti asincroni, bash, coda) che puo' risvegliarlo. Sempre falso con
	 * un omp che non riporta la quiete.
	 */
	get backgroundPending(): boolean {
		return isBackgroundPending(this.settle, this.isStreaming || this.isCompacting);
	}
	constructor(config: AgentSessionConfig) {
		this.client = config.client ?? new OmpRpcClient();
		this.cwd = config.cwd;
		this.scope = config.scope ?? 'lane';
		this.laneId = config.laneId ?? 'main';
		this.labConfig = config.lab;
		this.projectKey = config.projectKey ?? config.cwd;
		this.observedRevisionId = config.observedRevisionId ?? null;
		this.unsubscribeEvent = this.client.onEvent((event) => this.reduce(event));
	}

	get visibleEntries(): TranscriptEntry[] {
		const visible = sliceVisibleEntries(this.entries, this.visibleCount);
		if (this.seededPrompt && !this.entries.some((e) => e.id === this.seededPrompt!.id)) {
			const seededUserEntry: UserEntry = {
				id: this.seededPrompt.id,
				kind: 'user',
				content: this.seededPrompt.content,
				images: this.seededPrompt.images
			};
			return [...visible, seededUserEntry];
		}
		return visible;
	}

	get hasEarlier(): boolean {
		return hasEarlierEntries(this.entries.length, this.visibleCount);
	}

	/**
	 * Mostra una finestra precedente di entry dello storico (di default RENDER_WINDOW = 300 entry),
	 * con clamp alla dimensione totale di `entries`.
	 */
	showEarlier(step = RENDER_WINDOW): void {
		if (!this.hasEarlier) return;
		this.visibleCount = clampVisibleCount(this.entries.length, this.visibleCount, step);
	}

	/**
	 * Ultimi messaggi utente e assistente per dare contesto alle richieste
	 * esterne (Companion / TopBar).
	 *
	 * Ogni testo e' limitato a `RECENT_MESSAGE_MAX_CHARS` dalla coda: questo
	 * elenco attraversa l'IPC a ogni aggiornamento di attenzione, e un
	 * messaggio da centinaia di kilobyte lo attraverserebbe per intero senza
	 * che nessuno lo legga. Si taglia la testa, non la coda: la conclusione e'
	 * la parte che serve a rispondere.
	 */
	get recentMessages(): RecentChatMessage[] {
		const result: RecentChatMessage[] = [];
		for (let i = this.entries.length - 1; i >= 0 && result.length < 10; i--) {
			const entry = this.entries[i];
			if (entry.kind === 'user') {
				result.unshift({
					role: 'user',
					text: tailOfText(entry.content, RECENT_MESSAGE_MAX_CHARS)
				});
			} else if (entry.kind === 'assistant') {
				const text = assistantEntryText(entry);
				if (text) {
					result.unshift({
						role: 'assistant',
						text: tailOfText(text, RECENT_MESSAGE_MAX_CHARS)
					});
				}
			}
		}
		return result;
	}

	/**
	 * Fissa nella riga di attivita' l'ultima cosa detta dall'agente a fine
	 * turno. E' il testo che la companion mostra sulle card "ha finito": senza
	 * di lui resta solo l'etichetta di stato, e per sapere se il risultato
	 * interessa bisogna comunque aprire la finestra principale.
	 */
	private captureAssistantActivity() {
		for (let i = this.entries.length - 1; i >= 0; i--) {
			const entry = this.entries[i];
			if (entry.kind !== 'assistant') continue;
			const text = assistantEntryText(entry);
			if (!text) continue;
			this.activityLine = {
				text: tailOfText(text, ACTIVITY_MAX_CHARS),
				at: Date.now(),
				kind: 'assistant'
			};
			return;
		}
	}

	/**
	 * Fissa l'heads-up del turno appena chiuso con le due fonti immediate:
	 * la frase dell'agente (`studio_headsup`) e i fatti certi. Il ripiego smol
	 * arriva dopo, da `SessionSuggestions`, solo se l'agente ha taciuto.
	 */
	private captureHeadsUp() {
		const turn = lastTurnEntries(this.entries);
		this.headsUpTurnKey = turnKeyOf(turn);
		this.headsUpFacts = collectTurnFacts(turn);
		this.headsUpAgent = agentHeadsUp(turn);
		this.headsUpFallbackEntryId = lastAssistantId(turn);
		this.headsUpFactsText = factsSentence(this.headsUpFacts, headsUpPhrases());
		this.headsUp = resolveHeadsUp({
			agent: this.headsUpAgent,
			smol: null,
			facts: this.headsUpFacts,
			factsText: this.headsUpFactsText,
			fallbackEntryId: this.headsUpFallbackEntryId
		});
	}

	/**
	 * Cosa chiedere alla chiamata post-turno: la frase smol serve solo se
	 * l'agente non ha parlato e il turno puo' nascondere qualcosa.
	 */
	headsUpRequest(): { turnKey: string; digest: string } | null {
		if (!this.headsUpTurnKey || this.headsUpAgent) return null;
		const turn = lastTurnEntries(this.entries);
		if (!wantsSmolHeadsUp(turn, this.headsUpFacts)) return null;
		return { turnKey: this.headsUpTurnKey, digest: buildTurnDigest(turn, this.headsUpFacts) };
	}

	/** Frase del ripiego smol per il turno `turnKey`; null lascia i fatti. */
	applySmolHeadsUp(turnKey: string, text: string | null) {
		if (turnKey !== this.headsUpTurnKey || this.headsUpAgent || this.isStreaming) return;
		this.headsUp = resolveHeadsUp({
			agent: null,
			smol: text,
			facts: this.headsUpFacts,
			factsText: this.headsUpFactsText,
			fallbackEntryId: this.headsUpFallbackEntryId
		});
	}

	private clearHeadsUp() {
		this.headsUp = null;
		this.headsUpTurnKey = null;
		this.headsUpFacts = [];
		this.headsUpAgent = null;
		this.headsUpFallbackEntryId = null;
		this.headsUpFactsText = null;
	}

	/**
	 * Garantisce un processo vivo senza cambiare quello che sta nascendo. E' la
	 * strada dell'`$effect` che tiene su le superfici GUI e di chi ha solo
	 * bisogno che la sessione sia pronta: un'apertura gia' in volo si attende,
	 * non si scavalca, o la sessione scelta dall'utente verrebbe sostituita
	 * dall'ultima sessione conosciuta.
	 */
	async ensureOpen(resume?: string | null) {
		if (this.client.isOpen) return;
		if (this.opening) {
			await this.opening;
			return;
		}
		await this.open(resume);
	}

	async open(resume?: string | null, opts?: { modelOverride?: string | null }) {
		if (this.client.isOpen) return;
		const requestedResume = resume ?? null;
		const modelOverride = opts?.modelOverride ?? null;
		this.requestedModelOverride = modelOverride;

		if (this.openTarget !== requestedResume) {
			this.resumeFallbackAttempted = false;
		}

		if (this.openReadySpanEnd) {
			this.openReadySpanEnd('sostituito');
			this.openReadySpanEnd = null;
		}
		const projectName = projectStore.projects.find((p) => p.id === this.projectKey)?.name ?? this.projectKey;
		const lane = this.laneId ?? 'main';
		this.openReadySpanEnd = perfSpan('session', `rpc_open->ready ${projectName} ${lane}`);

		if (this.opening) {
			// Stessa sessione e nessun override: una sola apertura basta.
			if (this.openTarget === requestedResume && !modelOverride) return this.opening;
			// Sessione diversa o override richiesto: vince la richiesta piu' recente.
			await this.close();
		}

		// `close()` stacca il riduttore dal canale: senza riagganciarlo qui il
		// frame `ready` del nuovo processo cadrebbe nel vuoto, `attach()` non
		// partirebbe mai e la superficie resterebbe vuota per sempre. E' il
		// percorso di ogni ripresa dallo storico (close + open sulla stessa
		// istanza) e di ogni cambio di superficie.
		this.unsubscribeEvent ??= this.client.onEvent((event) => this.reduce(event));

		const opening = (async () => {
			this.exited = false;
			this.requestedResume = requestedResume;
			this.clearPrewalkState();
			try {
				if (this.labConfig) {
					await this.client.openLab({
						workspacePath: this.cwd,
						projectPath: this.labConfig.projectPath,
						prototypeId: this.labConfig.prototypeId,
						projectId: this.projectKey,
						laneId: this.laneId ?? 'main',
						resume: requestedResume,
						continueLast: true,
						model: modelOverride
					});
					void nameExistingPrototypeIfLong(this.projectKey, this.laneId ?? 'main');
				} else {
					const project = projectStore.projects.find((p) => p.id === this.projectKey);
					const isWorktreeLane = Boolean(this.laneId && this.laneId !== 'main');
					const continueLast = isWorktreeLane && (project?.worktreeResumeChat ?? true);
					await this.client.open(this.cwd, requestedResume, {
						laneId: this.laneId ?? null,
						projectId: this.projectKey ?? null,
						continueLast,
						model: modelOverride
					});
				}
			} catch (error) {
				if (this.openReadySpanEnd) {
					this.openReadySpanEnd('errore');
					this.openReadySpanEnd = null;
				}
				const waiters = this.readyWaiters;
				this.readyWaiters = [];
				for (const w of waiters) w(false);
				if (this.requestedResume === requestedResume) this.requestedResume = null;
				throw error;
			}
			// `attach` parte dal frame `ready`: prima di quello `get_state`
			// risponderebbe su una sessione non ancora insediata.
		})();
		this.opening = opening;
		this.openTarget = requestedResume;
		try {
			await opening;
		} finally {
			if (this.opening === opening) this.opening = null;
		}
	}

	async close() {
		this.clearPrewalkState();
		this.unsubscribeEvent?.();
		this.unsubscribeEvent = null;
		// Un'apertura ancora in volo non deve piu' fare da guardia: senza
		// azzerarla, la `open()` successiva restituirebbe la promise della
		// sessione appena chiusa e la ripresa non aprirebbe nulla.
		this.opening = null;
		this.openTarget = null;
		// La chiusura e' osservabile dagli effetti: si marca la sessione non
		// pronta prima di invalidare l'analisi, altrimenti per un frame la coda
		// risulterebbe libera e l'auto-dispatch potrebbe correre contro close().
		if (this.openReadySpanEnd) {
			this.openReadySpanEnd('chiuso');
			this.openReadySpanEnd = null;
		}
		const waiters = this.readyWaiters;
		this.readyWaiters = [];
		for (const w of waiters) w(false);
		this.isReady = false;
		this.isAttached = false;
		this.isAttaching = false;
		this.attachGeneration++;
		this.isRebuildingTranscript = false;
		this.requestedResume = null;
		this.sessionId = null;
		this.sessionFile = null;
		this.requestedModelOverride = null;
		this.expectingSessionTransition = false;
		this.endAborting();
		this.pendingStartupPrompts = [];
		this.clearPendingUi();
		this.resetBrowserLive();
		this.btw.resetForProcess();
		// Analisi e domanda dedotta appartengono al transcript che si chiude:
		// precedente e terrebbe sospeso l'auto-dispatch del progetto nuovo.
		this.suggestions.invalidate();
		this.deltaBatcher.clear();
		this.resetProcessScopedState();
		await this.client.close();
	}

	/** Chiude ogni canale effimero del processo precedente e dimentica le sue capability. */
	private resetBrowserLive(): void {
		for (const handle of this.#activeLiveHandles.values()) handle.disconnect();
		this.#activeLiveHandles.clear();
		this.browserLive = null;
		this.browserLiveTabs = [];
	}

	/**
	 * Insediamento: stato, sottoscrizione ai subagent, poi ricostruzione del
	 * transcript. In quest'ordine, perche' la ricostruzione e' la parte che
	 * puo' fallire e le altre due servono comunque.
	 */
	private async attach() {
		if (this.isAttached) return;
		const generation = ++this.attachGeneration;
		this.isAttaching = true;
		this.attachEventQueue = [];
		const projectName = projectStore.projects.find((p) => p.id === this.projectKey)?.name ?? this.projectKey;
		const lane = this.laneId ?? 'main';
		const endAttachSpan = perfSpan('session', `attach ${projectName} ${lane}`);
		try {
			await Promise.all([
				this.refreshState(),
				this.client.send({ type: 'set_subagent_subscription', level: 'progress' }),
				this.client.send({ type: 'set_ask_dialog', enabled: true }).catch(() => {}),
				this.applyQueueModes(),
				this.applyCacheWarming()
			]);
			await this.rebuildTranscript();
			void this.refreshCost();
			// Dopo un resume o un riavvio di omp lo stato del loop si chiede
			// esplicitamente: il frame di `session_start` puo' arrivare prima
			// che la chat sia in ascolto.
			void this.refreshCommands().then(() => this.requestLoopStatus());
			// Sonda e storico insieme: un omp senza `/btw` nasconde il pulsante.
			void this.btw.loadHistory();
			endAttachSpan('ok');
		} catch (error) {
			endAttachSpan('errore');
			this.pushNotice('error', messages.ui_ts_session_insediamento_della_sessione_non_completato_value1_bce4({ value1: this.reason(error) }));
		}
		if (generation !== this.attachGeneration) return;

		// 1. Svuota e sincronizza in ordine FIFO la coda eventi accumulata durante l'insediamento
		this.isAttaching = false;
		const queuedEvents = this.attachEventQueue;
		this.attachEventQueue = [];
		for (const queuedEvent of queuedEvents) {
			// Un frame che il riduttore non sa applicare costa quel frame, non
			// l'insediamento: senza questa rete `isAttached` restava falso,
			// i prompt di avvio non partivano e la composer diceva «in avvio».
			try {
				this.reduce(queuedEvent);
			} catch (error) {
				console.error('Evento accodato durante l\u2019insediamento non applicato:', queuedEvent.type, error);
			}
		}
		// Il replay puo' contenere `studio_exit`: il processo e' gia' finito.
		if (generation !== this.attachGeneration) return;

		this.isAttached = true;
		if (this.unavailableResumeModel && this.resumedFallbackModel) {
			const failed = this.unavailableResumeModel;
			const fallback = this.resumedFallbackModel;
			this.unavailableResumeModel = null;
			this.resumedFallbackModel = null;
			this.pushNotice(
				'warning',
				(messages as Record<string, any>).ui_ts_session_modello_non_disponibile_ripresa_con?.({
					model: failed,
					fallback
				}) ?? `Il modello ${failed} non è più disponibile: sessione ripresa con ${fallback}.`,
				'session'
			);
		}
		if (!firstComposerReadyMarked) {
			firstComposerReadyMarked = true;
			perfMark('boot', `composer ready ${projectName}`);
		}
		if (!this.pendingUi) {
			const projectPrompts = promptBus.getPendingsForProject(this.projectKey);
				const owner = this.promptOwner();
			const matching = projectPrompts.filter((p) => {
				const targetLane = (this.laneId ?? 'main').toLowerCase();
				const promptLane = (p.laneId ?? 'main').toLowerCase();
				if (targetLane !== promptLane) return false;
				if (this.sessionId && p.sessionId && this.sessionId !== p.sessionId) return false;
				// Solo il processo che ha aperto la richiesta puo' riceverne la
				// risposta: quella di un processo precedente e' un fantasma.
				if (!owner || p.owner !== owner) return false;
				return true;
			});
			if (matching.length === 1) {
				this.restorePendingUiFromPrompt(matching[0]);
			}
		}

		const recoveredResume = this.recoveredResume;
		if (recoveredResume) {
			this.recoveredResume = null;
			this.pushNotice(
				'warning',
				messages.ui_ts_session_la_sessione_value1_non_e_piu_disponibile_49b9({ value1: recoveredResume })
			);
		}

		// 2. Svuota e invia i prompt di avvio in ordine FIFO
		await this.flushStartupPrompts();
	}


	async refreshState() {
		const state = await this.client.send<RpcSessionState>({ type: 'get_state' });
		this.applyState(state);
	}

	/**
	 * Chiede a omp il rapporto di `/context` e lo tiene se i token coincidono
	 * con `get_state`. Il comando e' locale: se omp lo tratta come un messaggio
	 * al modello, non si ritenta.
	 */
	async refreshContextReport(): Promise<void> {
		if (!this.canProbeContext()) return;
		const stamp = this.contextStamp();
		if (this.contextProbedStamp === stamp) return;
		this.contextReportWanted = stamp;
		if (this.contextReportInflight) return this.contextReportInflight;
		this.contextReportInflight = this.drainContextReport();
		return this.contextReportInflight;
	}

	private canProbeContext(): boolean {
		if (!this.isReady || !this.isAttached || this.exited) return false;
		if (this.isStreaming || this.isCompacting || this.isAborting || this.pendingUi) return false;
		return this.availableCommands.some(
			(command) => command.name === 'context' || command.aliases?.includes('context')
		);
	}

	private contextStamp(): string {
		const usage = this.contextUsage;
		return [this.sessionId ?? '', this.model?.id ?? '', usage?.contextWindow ?? '', usage?.tokens ?? ''].join(':');
	}

	private async drainContextReport(): Promise<void> {
		try {
			while (this.contextReportWanted) {
				if (!this.canProbeContext()) {
					this.contextReportWanted = '';
					return;
				}
				const stamp = this.contextReportWanted;
				if (this.contextProbedStamp === stamp) {
					this.contextReportWanted = '';
					return;
				}
				const sessionId = this.sessionId;
				await this.probeContextReport(stamp, sessionId);
				if (this.contextReportWanted === stamp) this.contextReportWanted = '';
			}
		} finally {
			this.contextReportInflight = null;
		}
	}

	private async probeContextReport(stamp: string, sessionId: string | null): Promise<void> {
		this.contextProbedStamp = stamp;
		this.contextReportCapture = null;
		this.capturingContextReport = true;
		try {
			const data = await this.client.send<{ agentInvoked?: boolean }>({
				type: 'prompt',
				message: '/context'
			});
			if (this.sessionId !== sessionId) return;
			if (data?.agentInvoked === true) {
				this.flashNotice('warning', messages.chat_v2_composer_context_probe_sent());
				return;
			}
			const parsed = this.contextReportCapture ? parseContextReport(this.contextReportCapture) : null;
			if (!parsed) return;
			this.contextReport = parsed;
			this.contextReportStamp = stamp;
		} catch {
			// Senza rapporto il pannello resta sulla cifra unica di get_state.
		} finally {
			this.capturingContextReport = false;
			this.contextReportCapture = null;
		}
	}

	/**
	 * Handshake `browser-live-v1` sul frame `ready`.
	 *
	 * Contro un runtime precedente il campo `capabilities` non esiste, il
	 * comando non parte affatto e `browserLive` resta `null`: la superficie
	 * continua a disegnare gli screenshot del tool `browser`. Anche un
	 * fallimento della risposta e' un no — non si tenta nessun endpoint che
	 * non sia stato negoziato.
	 */
	private async negotiateCapabilities(readyEvent: AgentSessionEvent) {
		const advertised = readAdvertisedCapabilities(readyEvent);
		if (!shouldNegotiate(advertised)) return;
		try {
			const data = await this.client.send<{ accepted?: unknown }>({
				type: 'negotiate_capabilities',
				capabilities: [STUDIO_BROWSER_LIVE_OFFER]
			});
			this.browserLive = browserLiveFrom(data?.accepted);
		} catch (error) {
			this.browserLive = null;
			console.warn('Negoziazione browser-live non riuscita:', error);
		}
	}

	/**
	 * Ticket monouso per il canale live di una tab gia' annunciata dal runtime.
	 *
	 * L'identita' non la inventa Studio: e' quella arrivata con
	 * `browser_live_tab_state`. Il ticket ricevuto viene comunque verificato
	 * (loopback, scadenza, identita') prima di poter essere usato.
	 */
	async requestBrowserLiveTicket(identity: BrowserSessionIdentity): Promise<BrowserLiveTicket | null> {
		if (!this.browserLive) return null;
		try {
			const data = await this.client.send<unknown>({ type: 'browser_live_ticket', ...identity });
			const check = checkTicket(data, identity);
			if (check.ok) return check.value;
			console.warn(`Ticket browser-live rifiutato (${check.code}): ${check.message}`);
			return null;
		} catch (error) {
			console.warn('Richiesta ticket browser-live non riuscita:', error);
			return null;
		}
	}

	/** Elenca soltanto i metadati minimi necessari al picker Relay. */
	async listBrowserRelayTargets(): Promise<{ probe: BrowserRelayProbe; targets: BrowserRelayTarget[] }> {
		if (!this.browserLive?.features.includes('chrome-relay')) {
			throw new Error('Chrome Relay non negoziato con questo runtime');
		}
		return await this.client.send<{ probe: BrowserRelayProbe; targets: BrowserRelayTarget[] }>({
			type: 'browser_relay_targets'
		});
	}

	/** Consuma il consenso per un target preciso; il runtime pubblica poi la tab live. */
	async authorizeBrowserRelayTarget(
		targetId: string
	): Promise<{ state: BrowserTabState; probe: BrowserRelayProbe }> {
		const result = await this.client.send<{ state: BrowserTabState; probe: BrowserRelayProbe }>({
			type: 'browser_relay_authorize',
			targetId
		});
		const state = parseBrowserTabState(result.state);
		if (!state || state.mode !== 'chrome-relay') throw new Error(messages.ui_ts_session_stato_relay_non_valido_ac32());
		const idx = this.browserLiveTabs.findIndex((tab) => tab.browserSessionId === state.browserSessionId);
		if (idx === -1) this.browserLiveTabs.push(state);
		else this.browserLiveTabs[idx] = state;
		return { state, probe: result.probe };
	}

	/** Revoca immediata: runtime disconnette CDP, live server chiude frame e input. */
	async revokeBrowserRelayTarget(browserSessionId: string): Promise<number> {
		const result = await this.client.send<{ revoked: number }>({
			type: 'browser_relay_revoke',
			browserSessionId
		});
		this.browserLiveTabs = this.browserLiveTabs.filter((tab) => tab.browserSessionId !== browserSessionId);
		return result.revoked;
	}

	/**
	 * Comunica al runtime la decisione dell'utente su un'origine remota.
	 * L'allow-list che l'agente rispetta vive nel broker: senza questa chiamata
	 * il consenso resterebbe una scrittura locale di Studio e la tab continuerebbe
	 * a essere `pending` per il runtime, cioe' il grant non sbloccherebbe nulla
	 * e la revoca non fermerebbe nulla. Il nuovo stato torna via `tab_state`.
	 */
	async setBrowserOriginDecision(
		projectId: string,
		origin: string,
		decision: 'grant' | 'revoke'
	): Promise<string[]> {
		const result = await this.client.send<{ allowedOrigins?: unknown }>({
			type: 'browser_origin_decision',
			projectId,
			origin,
			decision
		});
		return Array.isArray(result.allowedOrigins)
			? result.allowedOrigins.filter((value): value is string => typeof value === 'string')
			: [];
	}

	/**
	 * Connette lo stream live autenticato per la tab indicata.
	 * Restituisce la funzione di disconnessione o null se il live non e' negoziato.
	 */
	async connectLiveTab(
		identity: BrowserSessionIdentity,
		onFrame: (frame: { meta: BrowserFrameMeta; imageBase64: string }) => void,
		onInspectorEvent?: (event: BrowserLiveEvent) => void
	): Promise<BrowserLiveStreamHandle | null> {
		const key = `${identity.browserSessionId}::${identity.tabId}`;
		const previous = this.#activeLiveHandles.get(key);
		if (previous) {
			previous.disconnect();
			this.#activeLiveHandles.delete(key);
		}
		const ticket = await this.requestBrowserLiveTicket(identity);
		if (!ticket) return null;
		let handle: BrowserLiveStreamHandle;
		handle = await connectBrowserLive(ticket, (event) => {
			if (event.type === 'frame') {
				onFrame({ meta: event.meta, imageBase64: event.imageBase64 });
			} else if (event.type === 'tab_state') {
				const state = parseBrowserTabState(event.state);
				if (state) {
					const idx = this.browserLiveTabs.findIndex(
						(t) => t.browserSessionId === state.browserSessionId && t.tabId === state.tabId
					);
					if (idx !== -1) this.browserLiveTabs[idx] = state;
					else this.browserLiveTabs.push(state);
				}
			} else if (event.type === 'closed') {
				if (this.#activeLiveHandles.get(key) === handle) this.#activeLiveHandles.delete(key);
				this.browserLiveTabs = this.browserLiveTabs.filter(
					(t) => t.browserSessionId !== event.identity.browserSessionId || t.tabId !== event.identity.tabId
				);
			} else if (event.type === 'disconnected') {
				if (this.#activeLiveHandles.get(key) === handle) this.#activeLiveHandles.delete(key);
			}
			onInspectorEvent?.(event);
		});
		this.#activeLiveHandles.set(key, handle);
		return handle;
	}

	/** Richiede il takeover atomico del controllo della tab. */
	async requestTakeover(tab: BrowserTabState, input?: BrowserInputEvent): Promise<boolean> {
		const key = `${tab.browserSessionId}::${tab.tabId}`;
		const handle = this.#activeLiveHandles.get(key);
		if (!handle) return false;
		try {
			await handle.sendTakeover(tab.controlEpoch, input);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_requesttakeover_97f2(), err);
			return false;
		}
	}

	/** Invia un evento di input alla tab controllata dall'utente. */
	async sendTabInput(tab: BrowserTabState, input: BrowserInputEvent): Promise<boolean> {
		const key = `${tab.browserSessionId}::${tab.tabId}`;
		const handle = this.#activeLiveHandles.get(key);
		if (!handle) return false;
		try {
			await handle.sendInput(tab.controlEpoch, input);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_sendtabinput_97c3(), err);
			return false;
		}
	}

	/** Restituisce esplicitamente il controllo della tab all'agente. */
	async returnControl(tab: BrowserTabState): Promise<boolean> {
		const key = `${tab.browserSessionId}::${tab.tabId}`;
		const handle = this.#activeLiveHandles.get(key);
		if (!handle) return false;
		try {
			await handle.returnControl(tab.controlEpoch);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_returncontrol_d100(), err);
			return false;
		}
	}

	/** Imposta la modalita di privacy (takeover privato). */
	async setPrivacy(tab: BrowserTabState, privacy: 'normal' | 'private'): Promise<boolean> {
		const key = `${tab.browserSessionId}::${tab.tabId}`;
		const handle = this.#activeLiveHandles.get(key);
		if (!handle) return false;
		try {
			await handle.setPrivacy(privacy);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_setprivacy_3ae6(), err);
			return false;
		}
	}

	/** Richiede l'ispezione del nodo DOM al punto specificato. */
	async inspectPoint(tab: BrowserTabState, x: number, y: number): Promise<boolean> {
		const key = `${tab.browserSessionId}::${tab.tabId}`;
		const handle = this.#activeLiveHandles.get(key);
		if (!handle) return false;
		try {
			await handle.inspectPoint(x, y);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_inspectpoint_93d3(), err);
			return false;
		}
	}

	/** Richiede l'ispezione mirata di un elemento via selettore o punto. */
	async inspectElement(tab: BrowserTabState, selector?: string, point?: { x: number; y: number }): Promise<boolean> {
		const key = `${tab.browserSessionId}::${tab.tabId}`;
		const handle = this.#activeLiveHandles.get(key);
		if (!handle) return false;
		try {
			await handle.inspectElement(selector, point);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_inspectelement_5292(), err);
			return false;
		}
	}

	/** Abilita o disabilita lo streaming di console/rete per l'Inspector. */
	async setInspector(
		tab: BrowserTabState,
		enabled: boolean,
		options?: { console?: boolean; network?: boolean }
	): Promise<boolean> {
		const key = `${tab.browserSessionId}::${tab.tabId}`;
		const handle = this.#activeLiveHandles.get(key);
		if (!handle) return false;
		try {
			await handle.setInspector(enabled, options);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_setinspector_dbfd(), err);
			return false;
		}
	}

	/** Richiede il corpo della risposta di una richiesta di rete on-demand. */
	async requestNetworkBody(tab: BrowserTabState, requestId: string): Promise<boolean> {
		const key = `${tab.browserSessionId}::${tab.tabId}`;
		const handle = this.#activeLiveHandles.get(key);
		if (!handle) return false;
		try {
			await handle.requestNetworkBody(requestId);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_requestnetworkbody_35b5(), err);
			return false;
		}
	}

	/** Pulisce i buffer storici dell'Inspector. */
	async clearInspectorBuffer(
		tab: BrowserTabState,
		target: 'console' | 'network' | 'actions' | 'all'
	): Promise<boolean> {
		const key = `${tab.browserSessionId}::${tab.tabId}`;
		const handle = this.#activeLiveHandles.get(key);
		if (!handle) return false;
		try {
			await handle.clearBuffer(target);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_clearinspectorbuffer_49a7(), err);
			return false;
		}
	}

	/**
	 * Invia un controllo S45 (dialoghi, download, upload, capability, recording)
	 * sul canale live della tab. Un solo punto di uscita invece di una decina di
	 * wrapper identici: il messaggio e' gia' tipizzato dal contratto.
	 */
	async sendLiveMessage(tab: BrowserTabState, message: BrowserLiveClientMessage): Promise<boolean> {
		const handle = this.#activeLiveHandles.get(`${tab.browserSessionId}::${tab.tabId}`);
		if (!handle) return false;
		try {
			await handle.sendMessage(message);
			return true;
		} catch (err) {
			console.warn(messages.ui_ts_session_errore_durante_l_invio_del_messaggio_live_9512({ value1: message.type }), err);
			return false;
		}
	}

	/**
	 * Apre il selettore file nativo per un file input intercettato.
	 * Restituisce il numero di file autorizzati (0 = annullato).
	 */
	async pickUploadFiles(tab: BrowserTabState, chooserId: string, multiple: boolean): Promise<number> {
		const handle = this.#activeLiveHandles.get(`${tab.browserSessionId}::${tab.tabId}`);
		if (!handle) return 0;
		return await handle.pickUploadFiles(chooserId, multiple);
	}
	/**
	 * Riafferma le modalita' di coda e interruzione configurate nelle impostazioni.
	 * I modi di coda sono stato di sessione lato omp e si resettano a ogni chat:
	 * Studio li riafferma sia durante l'insediamento sia quando l'utente modifica
	 * le preferenze globali.
	 */
	async applyQueueModes(): Promise<void> {
		if (!this.isReady) return;
		try {
			const { steeringMode, followUpMode, interruptMode } = settingsStore.general;
			await Promise.all([
				this.client.send({ type: 'set_steering_mode', mode: steeringMode }),
				this.client.send({ type: 'set_follow_up_mode', mode: followUpMode }),
				this.client.send({ type: 'set_interrupt_mode', mode: interruptMode })
			]);
		} catch (error) {
			this.pushNotice('warning', messages.ui_ts_session_impossibile_sincronizzare_le_modalita_di_coda_value1_1e87({ value1: this.reason(error) }));
		}
	}

	/**
	 * Riafferma la modalita' di riscaldamento cache configurata nelle impostazioni.
	 * Studio la riafferma sia durante l'insediamento sia quando l'utente modifica
	 * la preferenza in Settings.
	 */
	async applyCacheWarming(mode?: CacheWarmingMode): Promise<void> {
		if (!this.isReady) return;
		try {
			const targetMode = mode ?? settingsStore.general.cacheWarming;
			await this.client.send({ type: 'set_cache_warming', mode: targetMode });
		} catch (error) {
			this.pushNotice('warning', messages.ui_ts_session_impossibile_sincronizzare_cache_warming_value1_e82a({ value1: this.reason(error) }));
		}
	}

	/**
	 * Rimuove una credenziale memorizzata per un provider tramite il comando RPC nativo logout.
	 */
	async logout(providerId: string, credentialId: number): Promise<{ remainingSource?: string }> {
		return this.client.send<{ remainingSource?: string }>({
			type: 'logout',
			providerId,
			credentialId
		});
	}
	async refreshCommands() {
		try {
			const res = await this.client.send<{ commands?: AvailableCommand[] }>({ type: 'get_available_commands' });
			if (res && Array.isArray(res.commands)) {
				this.availableCommands = res.commands;
			}
		} catch {
			// Fallback silente: i comandi restano quelli noti
		}
	}


	private applyState(state: RpcSessionState | null | undefined) {
		if (!state) return;
		if (state.model) this.model = state.model;
		if (state.thinkingLevel) this.thinkingLevel = state.thinkingLevel;
		if (state.contextUsage) this.contextUsage = state.contextUsage;
		const isInitialSession = this.sessionId === null;
		const sessionIdChanged = typeof state.sessionId === 'string' && state.sessionId !== this.sessionId;
		const sessionFileChanged =
			typeof state.sessionFile === 'string' &&
			this.sessionFile !== null &&
			state.sessionFile !== this.sessionFile;
		const involuntaryRelocation =
			!isInitialSession && (sessionIdChanged || sessionFileChanged) && !this.expectingSessionTransition;

		if (this.expectingSessionTransition) {
			this.expectingSessionTransition = false;
		}

		if (typeof state.sessionId === 'string' && state.sessionId !== this.sessionId) {
			// Lo storico `/btw` vive accanto al file di sessione: con la sessione cambia.
			if (this.sessionId !== null) this.btw.resetForSession();
			this.contextReport = null;
			this.contextReportStamp = '';
			this.contextReportWanted = '';
		}
		if (typeof state.sessionId === 'string') this.sessionId = state.sessionId;
		if (typeof state.sessionFile === 'string') {
			const changed = state.sessionFile !== this.sessionFile;
			this.sessionFile = state.sessionFile;
			if (changed) void this.refreshSubagentCost();
		}
		if (typeof state.sessionName === 'string') this.sessionName = state.sessionName;

		// Aggiorna la corsia persistita per qualunque cambio sessione (sia volontario che rilocalizzato)
		if (sessionIdChanged && this.projectKey && typeof state.sessionId === 'string') {
			const lane = this.laneId ?? 'main';
			void laneStore
				.updateLane(this.projectKey as ProjectId, lane as LaneId, {
					sessionId: state.sessionId
				})
				.catch((err) => console.warn('Aggiornamento sessionId corsia fallito:', err));
		}

		// Quando la sessione e' continuata in un nuovo file perche' un altro processo omp scriveva il file precedente
		if (involuntaryRelocation && typeof state.sessionId === 'string') {
			const newSessionId = state.sessionId;
			if (this.sessionName) {
				void invoke('session_title_save', {
					sessionId: newSessionId,
					title: this.sessionName
				}).catch((err) => console.warn('Copia titolo sessione fallita:', err));
			}

			if (typeof window !== 'undefined') {
				window.dispatchEvent(
					new CustomEvent('studio-sessions-refresh', {
						detail: { projectPath: this.cwd, sessionId: newSessionId }
					})
				);
			}

			this.pushNotice(
				'info',
				(messages as Record<string, any>).ui_ts_session_continua_in_nuovo_file?.() ??
					'La sessione continua in un nuovo file perché un altro processo omp la stava usando',
				'session-persistence'
			);
		}
		if (Array.isArray(state.todoPhases)) {
			this.todoPhases = state.todoPhases;
			if (!this.hasActiveTodos()) {
				this.todoReminder = null;
			}
		}
		// Prima la quiete: decide se uno snapshot fermo e' "finito" o "in background".
		const wasBackground = this.backgroundPending;
		this.settle = settleFromState(this.settle, state);
		// omp senza quiete: un run rimasto «vivo» senza eventi da tempo e che
		// `get_state` dice fermo e' una continuazione mai partita.
		if (
			typeof state.isSettled !== 'boolean' &&
			this.settle.running &&
			state.isStreaming === false &&
			state.isCompacting !== true &&
			this.quietForMs() >= RUN_STALE_MS
		) {
			this.settle = { ...this.settle, running: false };
		}
		if (typeof state.isStreaming === 'boolean') {
			this.isStreaming = state.isStreaming;
			if (!state.isStreaming && this.agentState === 'working' && !this.backgroundPending) {
				this.agentState = this.pendingUi ? 'attention' : 'idle';
				this.assistantEntry = null;
				this.activeAssistantId = null;
			}
		}
		if (wasBackground && !this.backgroundPending) this.onSettled();
		else if (this.backgroundPending) this.scheduleSettlePoll();
		if (typeof state.isCompacting === 'boolean') this.isCompacting = state.isCompacting;
		if (typeof state.queuedMessageCount === 'number') this.queuedMessageCount = state.queuedMessageCount;
		// Lo snapshot di `get_state` e' l'autorita' anche sui testi dei chip; se
		// manca (versione vecchia) restano quelli dell'ultimo `queue_update`.
		if (state.queuedMessages) this.applyQueuedMessages(state.queuedMessages);
		if ('fastModeEnabled' in state) this.fastModeEnabled = Boolean(state.fastModeEnabled);
		if ('fastModeActive' in state) this.fastModeActive = Boolean(state.fastModeActive);
		if ('slowModeSupported' in state) this.slowModeSupported = Boolean(state.slowModeSupported);
		if ('slowModeEnabled' in state) this.slowModeEnabled = Boolean(state.slowModeEnabled);
		if ('slowModeScope' in state) this.slowModeScope = state.slowModeScope ?? null;
		if ('usageLimit' in state) this.usageLimit = state.usageLimit ?? null;
		if ('goal' in state) {
			this.goal = state.goal ?? null;
			this.syncGoalTracking();
		}
	}

	/**
	 * Sostituisce i chip della coda con lo snapshot di omp. Il testo e' quello
	 * del chip, opaco: si rimanda identico a `remove_queued_message`. Il
	 * conteggio autorevole e' `queuedMessageCount`, che include anche voci non
	 * modificabili dall'utente (card advisor); i chip restano il sottoinsieme
	 * su cui i comandi agiscono.
	 */
	private applyQueuedMessages(queued: QueuedMessagesState | null | undefined) {
		this.queuedMessages = {
			steering: Array.isArray(queued?.steering) ? [...queued.steering] : [],
			followUp: Array.isArray(queued?.followUp) ? [...queued.followUp] : []
		};
	}

	/**
	 * Azzera il riflesso della coda: il processo che ne era la sorgente non c'e'
	 * piu', quindi i chip non vanno mostrati come se fossero vivi.
	 */
	private clearQueueState() {
		this.queuedMessageCount = 0;
		this.queuedMessages = { steering: [], followUp: [] };
	}

	private async refreshCost() {
		try {
			const stats = await this.client.send<SessionStats>({ type: 'get_session_stats' });
			if (!stats) return;
			// Le chiavi cambiano per versione: si prende la prima che c'e' e si
			// lascia il chip vuoto se non c'e' nessuna.
			const total =
				typeof stats.totalCost === 'number'
					? stats.totalCost
					: typeof stats.cost === 'number'
						? stats.cost
						: typeof stats.cost?.total === 'number'
							? stats.cost.total
							: stats.usage?.cost?.total;
			if (typeof total === 'number') this.sessionCost = total;
		} catch {
			// Le statistiche sono un chip, non un invariante.
		}
		await this.refreshSubagentCost();
	}

	/**
	 * Ricostruzione paginata. `get_messages` monolitico non e' un'opzione: un
	 * solo messaggio con immagini sfonda il frame fisico da 1 MiB.
	 */
	private async rebuildTranscript() {
		this.isRebuildingTranscript = true;
		try {
			for (let attempt = 1; attempt <= REBUILD_ATTEMPTS; attempt++) {
				const collected: AgentMessage[] = [];
				let cursor: string | undefined;
				let failed: string | null = null;

				do {
					try {
						const page = await this.client.send<{ messages?: AgentMessage[]; nextCursor?: string }>({
							type: 'get_messages_page',
							cursor,
							limit: 256
						});
						if (Array.isArray(page?.messages)) collected.push(...page.messages);
						cursor = typeof page?.nextCursor === 'string' ? page.nextCursor : undefined;
					} catch (error) {
						// `session_busy` e `stale_cursor` invalidano le pagine gia'
						// raccolte: mescolarle darebbe un transcript inventato.
						const code = error instanceof Error && 'code' in error ? error.code : undefined;
						failed = code === 'session_busy' || code === 'stale_cursor' ? code : 'fatal';
						break;
					}
				} while (cursor);

				if (failed === null) {
					// Le card del Piano non sono nella storia di omp: tornano al loro posto.
					const planEntries = this.entries.filter(
						(entry): entry is PlanEntry => entry.kind === 'plan' && entry.sessionId === this.sessionId
					);
					this.entries = reanchorEntries(this.mapHistory(collected), planEntries);
					// Le card ricostruite devono restare aggiornabili dalla diretta:
					// nella mappa vanno le istanze reattive, prese dopo l'assegnazione.
					this.toolEntries.clear();
					for (const entry of this.entries) {
						if (entry.kind === 'tool' && !entry.result) this.toolEntries.set(entry.toolCallId, entry);
					}
					this.optimisticUser = null;
					this.visibleCount = RENDER_WINDOW;
					this.restoreGuidedGoalEntries();
					return;
				}
				if (failed === 'fatal') break;
				const { promise, resolve } = Promise.withResolvers<void>();
				window.setTimeout(resolve, 400 * attempt);
				await promise;
			}
			this.pushNotice('warning', messages.ui_ts_session_transcript_storico_non_ricostruito_la_sessione_e_1030());
		} finally {
			this.isRebuildingTranscript = false;
		}
	}

	/** Storico -> entry. Stessa forma della diretta: nessun percorso separato. */
	private mapHistory(messages: AgentMessage[]): TranscriptEntry[] {
		this.renderedCustomKeys.clear();
		const entries: TranscriptEntry[] = [];
		const tools = new Map<string, ToolEntry>();
		this.toolEntries.clear();

		for (const message of messages) {
			if (message.role === 'compactionSummary' || (typeof message.summary === 'string' && !message.role)) {
				let msg = 'Contesto compattato';
				if (typeof message.tokensBefore === 'number' && typeof message.tokensAfter === 'number') {
					const saved = message.tokensBefore - message.tokensAfter;
					if (saved > 0) {
						msg = `Contesto compattato (${formatTokens(message.tokensBefore)} → ${formatTokens(message.tokensAfter)} token, -${formatTokens(saved)})`;
					} else {
						msg = `Contesto compattato (${formatTokens(message.tokensAfter)} token)`;
					}
				} else if (message.shortSummary) {
					msg = `Contesto compattato: ${message.shortSummary}`;
				}
				entries.push({
					id: this.nextEntryId++,
					kind: 'compaction',
					message: msg,
					running: false,
					summary: message.summary,
					shortSummary: message.shortSummary,
					tokensBefore: message.tokensBefore,
					tokensAfter: message.tokensAfter
				});
				continue;
			}
			if (message.role === 'user') {
				entries.push({
					id: this.nextEntryId++,
					kind: 'user',
					content: textOf(message.content),
					images: imagesOf(message.content),
					attribution: message.attribution,
					messageTs: message.timestamp
				});
				continue;
			}
			if (message.role === 'custom' || message.role === 'developer') {
				const entry = this.classifiedEntry(message);
				if (entry) {
					entries.push(entry);
				}
				continue;
			}
			if (message.role === 'assistant') {
				const currentBlocks: Block[] = [];
				const flushBlocks = (isLast: boolean) => {
					if (currentBlocks.length === 0) return;
					entries.push({
						id: this.nextEntryId++,
						kind: 'assistant',
						blocks: [...currentBlocks],
						model: message.model,
						usage: isLast ? message.usage : undefined,
						stopReason: isLast ? message.stopReason : undefined,
						messageTs: message.timestamp
					});
					currentBlocks.length = 0;
				};

				const content = Array.isArray(message.content) ? message.content : [];
				for (let i = 0; i < content.length; i++) {
					const block = content[i];
					if (block.type === 'text' && typeof block.text === 'string') {
						currentBlocks.push({ type: 'text', text: block.text });
					} else if (block.type === 'thinking' && typeof block.thinking === 'string') {
						currentBlocks.push({ type: 'thinking', text: block.thinking });
					} else if (block.type === 'image' && typeof block.data === 'string') {
						currentBlocks.push({ type: 'image', data: block.data, mimeType: block.mimeType ?? 'image/png' });
					} else if (block.type === 'toolCall' && typeof block.id === 'string' && typeof block.name === 'string') {
						const hasSubsequentBlocks = content
							.slice(i + 1)
							.some((b) => b.type === 'text' || b.type === 'thinking' || b.type === 'image');
						flushBlocks(!hasSubsequentBlocks);
						const entry: ToolEntry = {
							id: this.nextEntryId++,
							kind: 'tool',
							toolCallId: block.id,
							toolName: block.name,
							args: stripIntent(block.arguments),
							intent: block.intent ?? (typeof block.arguments?.i === 'string' ? block.arguments.i : undefined),
							running: false,
							startedAt: message.timestamp ?? 0
						};
						entries.push(entry);
						tools.set(block.id, entry);
					}
				}
				flushBlocks(true);
				continue;
			}
			if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
				const entry = tools.get(message.toolCallId);
				const result: AgentToolResult = {
					content: Array.isArray(message.content) ? message.content : undefined,
					details: message.details,
					isError: message.isError === true
				};
				if (entry) {
					entry.result = result;
					entry.endedAt = message.timestamp;
					continue;
				}
				// Risultato senza chiamata: la sessione e' stata compattata o
				// ramificata. Meglio una card orfana che un buco silenzioso.
				entries.push({
					id: this.nextEntryId++,
					kind: 'tool',
					toolCallId: message.toolCallId,
					toolName: message.toolName ?? 'tool',
					args: {},
					result,
					running: false,
					startedAt: message.timestamp ?? 0,
					endedAt: message.timestamp
				});
			}
		}
		return entries;
	}

	/* ------------------------------------------------------------ riduttore */
	private reduce(event: AgentSessionEvent) {
		// Protezione da eventi per sessioni/prototipi diversi o revisioni superate
		// ("un evento in ritardo non aggiorna l'oggetto sbagliato")


		// Se la sessione e' in fase di attach, accoda tutti gli eventi in ordine FIFO
		// tranne quelli di terminazione/errore critico che interrompono l'attach.
		if (this.isAttaching) {
			if (event.type === 'studio_exit' || event.type === 'studio_error') {
				this.isAttaching = false;
				this.attachEventQueue = [];
			} else {
				this.attachEventQueue.push(event);
				return;
			}
		}

		if (event.type !== 'studio_delta') {
			this.deltaBatcher.flush();
		}

		this.applyRunActivity(reduceRunActivity(this.runActivity, event, Date.now()));

		switch (event.type) {
			case 'ready':
				if (this.readyEpoch === this.client.epoch) {
					console.warn('Frame `ready` duplicato sulla stessa apertura: ignorato.');
					return;
				}
				this.readyEpoch = this.client.epoch;
				this.requestedResume = null;
				this.isReady = true;
				if (this.openReadySpanEnd) {
					this.openReadySpanEnd('ok');
					this.openReadySpanEnd = null;
				}
				const readyWaiters = this.readyWaiters;
				this.readyWaiters = [];
				for (const w of readyWaiters) w(true);
				this.endAborting();
				// `ready` e' l'handshake di un processo nuovo: l'insediamento
				// precedente non vale piu'. Senza azzerarlo `attach()` uscirebbe
				// subito e il transcript resterebbe quello del processo di
				// prima, che nella ripresa di una chat significa nessun
				// messaggio a schermo.
				this.isAttached = false;
				// Le capability appartengono al processo, non alla chat: un
				// runtime nuovo puo' sostituirne uno precedente e viceversa.
				this.resetBrowserLive();
				// Anche il supporto alla quiete e lo stato delle estensioni: un
				// processo nuovo puo' essere un omp di un'altra versione, e le
				// estensioni ripubblicano le loro voci all'avvio.
				this.resetProcessScopedState();
				this.btw.resetForProcess();
				void this.negotiateCapabilities(event);
				void this.attach();
				return;

			// `browser-live-v1`: fuori dalla negoziazione questi frame non
			// esistono. Cadere qui e' il fail-closed, non una svista.
			case 'browser_live_tab_state': {
				if (!this.browserLive) return;
				const state = parseBrowserTabState(event.state);
				if (!state) return;
				const index = this.browserLiveTabs.findIndex(
					(tab) => tab.browserSessionId === state.browserSessionId && tab.tabId === state.tabId
				);
				if (index === -1) this.browserLiveTabs.push(state);
				else this.browserLiveTabs[index] = state;
				return;
			}

			case 'browser_live_closed': {
				if (!this.browserLive) return;
				const identity = parseBrowserSessionIdentity(event.identity);
				if (!identity) return;
				this.browserLiveTabs = this.browserLiveTabs.filter(
					(tab) => tab.browserSessionId !== identity.browserSessionId || tab.tabId !== identity.tabId
				);
				return;
			}

			case 'studio_delta':
				this.applyDelta(event);
				return;

			// Domande a margine: fuori dal transcript, solo nel riquadro «A margine».
			case 'btw_record':
				this.btw.applyRecordFrame(event.record);
				return;
			case 'btw_delta':
				this.btw.applyDeltaFrame(event.recordId, event.delta);
				return;

			case 'message_start': {
				const message = this.asMessage(event.message);
				if (!message) return;
				if (message.role === 'user') {
					this.assistantEntry = null;
					this.activeAssistantId = null;
					const content = textOf(message.content);
					const pending = this.optimisticUser;
					this.optimisticUser = null;
					// Il prompt ripetuto dal loop e' un giro, non un nuovo messaggio:
					// lo stato del giro arriva prima del prompt (vedi l'estensione).
					const loopGiro =
						this.loop?.status === 'running' && isLoopPromptEcho(this.loop, content) ? this.loop.giro : undefined;
					// L'eco del messaggio appena spedito non va disegnata due
					// volte: si completa quella gia' a schermo.
					if (pending && pending.content === content) {
						pending.images = imagesOf(message.content);
						pending.attribution = message.attribution;
						pending.messageTs = message.timestamp;
						if (loopGiro !== undefined) pending.loopGiro = loopGiro;
						return;
					}
					this.push({
						id: this.nextEntryId++,
						kind: 'user',
						content,
						images: imagesOf(message.content),
						attribution: message.attribution,
						messageTs: message.timestamp,
						loopGiro
					});
				} else if (message.role === 'assistant') {
					if (!this.isStreaming || this.isAborting) return;
					// `push` restituisce l'istanza dentro l'array reattivo: tenere
					// l'oggetto grezzo significherebbe mutarlo fuori dal proxy di
					// Svelte e non far mai comparire il testo in streaming.
					this.liveAssistantTs = message.timestamp;
					this.assistantEntry = this.push({
						id: this.nextEntryId++,
						kind: 'assistant',
						blocks: [],
						messageTs: message.timestamp
					}) as AssistantEntry;
					this.activeAssistantId = this.assistantEntry.id;
				} else if (message.role === 'custom' || message.role === 'developer') {
					const entry = this.classifiedEntry(message);
					if (entry) {
						this.push(entry);
					}
				}
				return;
			}

			case 'message_update':
				this.applyAssistantEvent(event);
				return;

			case 'message_end': {
				const message = this.asMessage(event.message);
				if (!message || message.role !== 'assistant') return;
				this.liveAssistantTs = undefined;
				if (this.assistantEntry) {
					this.assistantEntry.usage = message.usage;
					this.assistantEntry.model = message.model;
					if (typeof message.timestamp === 'number') this.assistantEntry.messageTs = message.timestamp;
					if (!this.assistantEntry.stopReason) {
						this.assistantEntry.stopReason = message.stopReason;
					}
					this.assistantEntry = null;
				}
				this.activeAssistantId = null;
				return;
			}

			case 'tool_execution_start': {
				if (typeof event.toolCallId !== 'string' || typeof event.toolName !== 'string') return;
				if (!this.isStreaming || this.isAborting) return;
				traceAgent(`tool-start:${event.toolName}`);
				// Se un'entry assistant era ancora aperta, chiudila: l'esecuzione
				// del tool appartiene al passo successivo del flusso di esecuzione.
				this.assistantEntry = null;
				this.activeAssistantId = null;
				const entry: ToolEntry = {
					id: this.nextEntryId++,
					kind: 'tool',
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: stripIntent(event.args),
					intent: event.intent,
					running: true,
					startedAt: Date.now()
				};
				// Stessa ragione dell'entry assistant: nella mappa va l'istanza
				// reattiva, non quella grezza appena costruita.
				this.toolEntries.set(event.toolCallId, this.push(entry) as ToolEntry);
				this.markWorking();
				// Riga di attivita' per la companion: l'intento dichiarato dice
				// cosa sta facendo l'agente, il nome del tool e' il ripiego.
				this.activityLine = {
					text: event.intent?.trim() || event.toolName,
					at: Date.now(),
					kind: 'intent'
				};
				return;
			}

			case 'tool_execution_update': {
				const entry = typeof event.toolCallId === 'string' ? this.toolEntries.get(event.toolCallId) : undefined;
				if (!entry || !event.partialResult) return;
				if (!entry.running && entry.result?.isError) return;
				entry.result = event.partialResult;
				return;
			}

			case 'tool_execution_end': {
				const entry = typeof event.toolCallId === 'string' ? this.toolEntries.get(event.toolCallId) : undefined;
				if (entry) {
					if (event.result && (!entry.result || !entry.result.isError)) entry.result = event.result;
					entry.running = false;
					entry.endedAt = Date.now();
				}
				if (
					entry &&
					(entry.toolName === 'edit' || entry.toolName === 'write') &&
					entry.result?.isError !== true
				) {
					notifyGitStatusRefresh(this.cwd);
				}
				traceAgent(`tool-end:${entry?.toolName ?? '?'}`);
				if (entry?.toolName === 'ask' && this.streamAsk?.toolCallId === event.toolCallId) {
					this.clearStreamAsk();
				}
				if (!this.isStreaming) {
					const hasRunning = Array.from(this.toolEntries.values()).some((t) => t.running);
					if (!hasRunning) {
						this.agentState = this.pendingUi ? 'attention' : this.backgroundPending ? 'working' : 'idle';
					}
				}
				return;
			}

			case 'agent_start':
				if (this.isAborting) return;
				if (this.turnStartedAt === null) this.turnStartedAt = Date.now();
				this.suggestions.invalidate();
				this.settle = settleOnAgentStart(this.settle);
				this.stopSettlePoll();
				this.clearHeadsUp();
				this.isStreaming = true;
				this.markWorking();
				this.noteGoalAttemptStart();
				return;

			case 'agent_end': {
				const wasAborting = this.isAborting;
				this.endAborting();
				// `isTerminal: false` significa che la sessione riprendera' solo se non e' stato
				// richiesto un abort. Eccezione: una fine che aspetta solo un job in background
				// e' un turno concluso, se omp dira' poi quando la sessione e' quieta.
				if (event.isTerminal === false && !wasAborting && !isBackgroundYield(this.settle, event)) {
					this.scheduleRunWatch();
					return;
				}
				this.settle = settleOnYield(this.settle);
				this.clearStreamAsk();
				this.isStreaming = false;
				this.turnStartedAt = null;
				this.isCompacting = false;
				this.assistantEntry = null;
				this.activeAssistantId = null;
				this.runEndSeq += 1;
				this.agentState = this.resolveSettledState();
				this.releaseIdleWaiters();
				this.noteGoalAttemptEnd(wasAborting);
				void this.reconcile();
				this.captureAssistantActivity();
				notifyGitStatusRefresh(this.cwd);
				if (!wasAborting) this.captureHeadsUp();
				if (!this.pendingUi && !wasAborting) {
					this.suggestions.notifyTurnEnd();
				}
				if (this.backgroundPending) this.scheduleSettlePoll();
				return;
			}

			// omp 18.8+: la sessione e' quieta, nulla la risveglera'. E' qui, non
			// su `agent_end`, che il lavoro e' davvero finito.
			case 'session_settled': {
				this.settle = settleOnSessionSettled();
				this.onSettled();
				return;
			}

			// omp 18.8+: esito di un `prompt`. Porta la quiete al momento dello
			// yield e, in caso di errore del provider, il messaggio pulito.
			case 'prompt_result': {
				const wasSettled = this.settle.settled;
				this.settle = settleOnPromptResult(this.settle, event);
				if (!wasSettled && this.settle.settled) this.onSettled();
				const failure = promptResultError(event);
				// La quota ha gia' la sua riga nel vassoio con le azioni di recupero.
				if (failure && !(this.blockedQuotaState && !this.blockedQuotaState.dismissed)) {
					this.pushNotice('error', this.promptFailureText(failure), 'provider');
				}
				return;
			}
			case 'turn_start':
				if (this.isAborting) return;
				if (this.turnStartedAt === null) this.turnStartedAt = Date.now();
				this.suggestions.invalidate();
				this.markWorking();
				return;
			case 'turn_end':
				this.isStreaming = false;
				this.turnStartedAt = null;
				this.isCompacting = false;
				this.assistantEntry = null;
				this.activeAssistantId = null;
				this.agentState = this.resolveSettledState();
				this.scheduleRunWatch();
				void this.reconcile();
				this.captureAssistantActivity();
				notifyGitStatusRefresh(this.cwd);
				return;

			case 'notice': {
				const text = typeof event.message === 'string' ? event.message : '';
				if (!text) return;
				const level = this.noticeLevel(event.level);
				// Gli avvisi dei device xd:// (es. i tool MCP montati) arrivano all'avvio:
				// nel transcript toglierebbero l'hero di una chat vuota. L'annuncio del
				// mount e' rumore e si scarta; un problema va nell'etichetta del composer.
				if (event.source === 'xdev') {
					if (level !== 'info') this.flashNotice(level, text);
					return;
				}
				// Avviso di rilocalizzazione sessione da omp: forza get_state immediato e sopprime il notice inglese grezzo
				if (event.source === 'session-persistence') {
					void this.refreshState().catch(() => {});
					return;
				}
				const prewalkNotice = parsePrewalkNotice(event.source, event.level, text);
				if (prewalkNotice) {
					this.prewalk = reducePrewalkNotice(this.prewalk, prewalkNotice);
					if (prewalkNotice.kind === 'armed') this.prewalkRestarting = false;
					if (prewalkNotice.kind === 'error') {
						this.prewalkConfirmation?.reject(new Error(prewalkNotice.message));
					} else if (
						(prewalkNotice.kind === 'armed' && this.prewalkConfirmation?.expected === 'armed') ||
						(prewalkNotice.kind === 'disarmed' && this.prewalkConfirmation?.expected === 'off')
					) {
						this.prewalkConfirmation?.resolve();
					}
				}
				if (prewalkNotice?.kind === 'handedOff') this.resetHandedOffOverlay();
				this.pushNotice(level, text, typeof event.source === 'string' ? event.source : undefined);
				if (level === 'error') {
					const hasRunningTools = Array.from(this.toolEntries.values()).some((t) => t.running);
					if (!hasRunningTools && !this.assistantEntry) {
						this.isStreaming = false;
						this.turnStartedAt = null;
						this.agentState = this.pendingUi ? 'attention' : this.backgroundPending ? 'working' : 'idle';
					}
				}
				return;
			}

			case 'irc_message': {
				const message = this.asMessage(event.message);
				if (message) {
					const normalized: AgentMessage = {
						...message,
						role: message.role || 'custom'
					};
					const entry = this.classifiedEntry(normalized);
					if (entry) {
						this.push(entry);
					}
				}
				return;
			}

			case 'command_output': {
				const output =
					typeof event.text === 'string'
						? event.text
						: typeof event.output === 'string'
							? event.output
							: typeof event.message === 'string'
								? event.message
								: '';
				if (output && this.capturingContextReport && isContextReportText(output)) {
					this.contextReportCapture = output;
					return;
				}
				// Come gli esiti dei comandi di Studio: etichetta sopra il composer,
				// non voce del transcript.
				if (output) this.flashNotice('info', output);
				return;
			}

			case 'auto_compaction_start':
				this.isCompacting = true;
				this.push({ id: this.nextEntryId++, kind: 'compaction', message: messages.ui_ts_session_compattazione_del_contesto_in_corso_845b(), running: true });
				return;

			case 'auto_compaction_end': {
				this.isCompacting = false;
				const last = this.lastOfKind('compaction');
				if (last) {
					last.running = false;
					last.message = 'Contesto compattato';
				}
				if (!this.isStreaming) {
					this.agentState = this.resolveSettledState();
				}
				void this.refreshState();
				void this.rebuildTranscript();
				void this.refreshCost();
				return;
			}

			case 'auto_retry_start':
				this.push({
					id: this.nextEntryId++,
					kind: 'retry',
					message: this.retryText(event, messages.ui_ts_session_nuovo_tentativo_in_corso_7c38())
				});
				return;

			case 'auto_retry_end':
				if (event.success === false) {
					const failureReason =
						typeof event.finalError === 'string'
							? event.finalError
							: typeof event.errorMessage === 'string'
								? event.errorMessage
								: messages.ui_ts_session_tentativi_automatici_di_chiamata_al_modello_esauriti_0155();
					this.checkAndSetQuotaBlocked(failureReason, true);
				} else if (event.success === true && this.blockedQuotaState) {
					this.blockedQuotaState = null;
				}
				return;

			case 'retry_fallback_applied':
			case 'retry_fallback_succeeded':
				this.push({
					id: this.nextEntryId++,
					kind: 'retry',
					message: this.retryText(event, messages.ui_ts_session_modello_di_riserva_applicato_c194())
				});
				return;

			case 'ttsr_triggered': {
				const rules = Array.isArray(event.rules)
					? event.rules.filter((rule): rule is string => typeof rule === 'string')
					: [];
				this.push({ id: this.nextEntryId++, kind: 'ttsr', rules });
				return;
			}

			case 'todo_reminder':
				if (typeof event.attempt === 'number' && typeof event.maxAttempts === 'number') {
					this.todoReminder = { attempt: event.attempt, max: event.maxAttempts };
				}
				// `todo_reminder.todos` e' una lista piatta senza fasi: per le
				// fasi serve `get_state`, che e' l'unica fonte completa.
				void this.refreshState();
				return;

			case 'todo_auto_clear':
				this.todoPhases = [];
				this.todoReminder = null;
				return;

			case 'model_changed':
				if (event.model && typeof event.model === 'object') {
					this.model = event.model;
					if (!this.prewalkRestarting && isPrewalkHandOff(this.prewalk, event.model)) {
						this.prewalk = handOffPrewalk(this.prewalk, event.model);
						this.resetHandedOffOverlay();
					} else if (this.prewalk.state === 'handedOff') {
						this.prewalk = { ...this.prewalk, handedOffTo: event.model.name ?? event.model.id };
					}
					// fastModeActive e slowModeSupported dipendono dal modello attivo
					void this.refreshState().catch((error) => console.warn('Aggiornamento stato modello:', error));
				} else {
					// omp 18.4.10 emette solo il tipo; il notice switched conferma
					// il passaggio. get_state distingue anche un cambio manuale.
					void this.refreshState().then(() => {
						if (!this.prewalkRestarting && isPrewalkHandOff(this.prewalk, this.model)) {
							this.prewalk = handOffPrewalk(this.prewalk, this.model ?? undefined);
							this.resetHandedOffOverlay();
						} else if (this.prewalk.state === 'handedOff' && this.model) {
							this.prewalk = { ...this.prewalk, handedOffTo: this.model.name ?? this.model.id };
						}
					}).catch((error) => console.warn('Aggiornamento modello prewalk:', error));
				}
				return;

			case 'thinking_level_changed':
				if (typeof event.thinkingLevel === 'string') this.thinkingLevel = event.thinkingLevel;
				return;

			case 'config_update':
			case 'session_info_update':
				void this.refreshState();
				return;

			case 'goal_updated': {
				if (event.state !== undefined) {
					this.goal = event.state ?? null;
				} else if (event.goal !== undefined) {
					if (event.goal === null) {
						this.goal = null;
					} else {
						this.goal = {
							enabled: event.goal.status === 'active',
							mode: event.goal.status === 'dropped' ? 'exiting' : 'active',
							goal: event.goal
						};
					}
				}
				this.syncGoalTracking();
				return;
			}

			case 'cache_warming_start': {
				const phase = (event.phase as CacheWarmingPhase) ?? 'idle';
				const provider = typeof event.provider === 'string' ? event.provider : '';
				const model = typeof event.model === 'string' ? event.model : '';
				this.cacheWarmingInFlight = {
					phase,
					provider,
					model,
					since: Date.now()
				};
				return;
			}

			case 'cache_warming_end': {
				this.cacheWarmingInFlight = null;
				const outcome = (event.outcome as CacheWarmingOutcome) ?? 'hit';
				const phase = event.phase as CacheWarmingPhase | undefined;
				const provider = typeof event.provider === 'string' ? event.provider : undefined;
				const model = typeof event.model === 'string' ? event.model : undefined;
				const usage = event.usage as MessageUsage | undefined;
				const rawCost = (usage?.cost as { total?: number } | undefined)?.total ?? (typeof usage?.cost === 'number' ? usage.cost : undefined);
				const warmingStopReason = typeof event.warmingStopReason === 'string' ? event.warmingStopReason : undefined;
				this.cacheWarmingLast = {
					outcome,
					phase,
					provider,
					model,
					usage,
					cost: typeof rawCost === 'number' && Number.isFinite(rawCost) ? rawCost : undefined,
					warmingStopReason,
					at: Date.now()
				};
				return;
			}

			case 'available_commands_update':
				if (Array.isArray(event.commands)) this.availableCommands = event.commands;
				return;

			// `queue_update` e' uno snapshot che sostituisce lo stato precedente:
			// omp lo emette coalescendo i cambiamenti, quindi non serve confronto.
			case 'queue_update':
				this.applyQueuedMessages({ steering: event.steering ?? [], followUp: event.followUp ?? [] });
				return;

			case 'subagent_lifecycle':
			case 'subagent_progress':
				this.applySubagent(event);
				return;

			case 'extension_ui_request':
				this.applyUiRequest(event);
				return;

			case 'extension_error': {
				const path = typeof event.extensionPath === 'string' ? event.extensionPath : 'estensione';
				const detail = typeof event.error === 'string' ? event.error : messages.ui_ts_session_errore_non_descritto_567a();
				this.pushNotice('warning', `${path}: ${detail}`, 'estensione');
				return;
			}

			case 'studio_error': {
				this.resetBrowserLive();
				const msg = typeof event.message === 'string' ? event.message : messages.ui_ts_session_errore_del_trasporto_rpc_b9d7();
				this.endAborting();
				this.isStreaming = false;
				this.turnStartedAt = null;
				this.isCompacting = false;
				if (this.assistantEntry) {
					if (!this.assistantEntry.stopReason) {
						this.assistantEntry.stopReason = 'error';
					}
					this.assistantEntry = null;
				}
				this.activeAssistantId = null;
				for (const entry of this.toolEntries.values()) {
					if (entry.running) {
						entry.running = false;
						entry.endedAt = Date.now();
						if (!entry.result) {
							entry.result = { isError: true, content: [{ type: 'text', text: msg }] };
						}
					}
				}
				// Il trasporto e' caduto: nessun `session_settled` arrivera' da questo canale.
				this.stopSettlePoll();
				this.settle = { ...this.settle, settled: true, running: false };
				this.agentState = this.pendingUi ? 'attention' : 'idle';
				this.pushNotice('error', msg);
				void this.reconcile();
				return;
			}

			case 'error':
			case 'agent_error': {
				const msg =
					typeof event.error === 'string'
						? event.error
						: typeof event.message === 'string'
							? event.message
							: messages.ui_ts_session_errore_durante_l_esecuzione_di_omp_ac74();
				this.endAborting();
				this.isStreaming = false;
				this.turnStartedAt = null;
				this.isCompacting = false;
				if (this.assistantEntry) {
					if (!this.assistantEntry.stopReason) {
						this.assistantEntry.stopReason = 'error';
					}
					this.assistantEntry = null;
				}
				this.activeAssistantId = null;
				for (const entry of this.toolEntries.values()) {
					if (entry.running) {
						entry.running = false;
						entry.endedAt = Date.now();
						if (!entry.result) {
							entry.result = { isError: true, content: [{ type: 'text', text: msg }] };
						}
					}
				}
				this.checkAndSetQuotaBlocked(msg, false);
				// Come per `isStreaming`: per Studio il run e' finito. Se omp
				// continua davvero, `agent_start`/`get_state` lo riaccendono.
				if (this.settle.running) this.settle = { ...this.settle, running: false };
				this.agentState = this.resolveSettledState();
				this.pushNotice('error', msg);
				void this.reconcile();
				return;
			}

			case 'studio_exit': {
				this.clearPrewalkState();
				this.resetBrowserLive();
				const code = typeof event.code === 'number' ? event.code : null;
				const stderr = Array.isArray(event.stderr)
					? event.stderr.filter((line): line is string => typeof line === 'string')
					: [];
				const requestedResume = this.requestedResume;
				const resumeMissing =
					requestedResume !== null && isMissingSessionError(stderr, requestedResume);
				this.endAborting();
				this.isStreaming = false;
				this.turnStartedAt = null;
				this.isCompacting = false;
				this.activeAssistantId = null;
				this.assistantEntry = null;
				this.clearStreamAsk();
				this.clearQueueState();
				this.resetProcessScopedState();
				this.exited = true;
				this.isReady = false;
				const exitWaiters = this.readyWaiters;
				this.readyWaiters = [];
				for (const w of exitWaiters) w(false);
				this.isAttached = false;
				this.isAttaching = false;
				this.attachGeneration++;
				this.attachEventQueue = [];
				// Il processo che aspettava la risposta non c'e' piu': la voce sul
				// bus va chiusa, o la Companion e il prossimo insediamento la
				// riaprirebbero come domanda fantasma.
				this.clearPendingUi();
				this.agentState = 'idle';

				for (const entry of this.toolEntries.values()) {
					if (entry.running) {
						entry.running = false;
						entry.endedAt = Date.now();
						if (!entry.result) {
							entry.result = {
								isError: true,
								content: [{ type: 'text', text: 'Processo terminato' }]
							};
						}
					}
				}

				for (let i = 0; i < this.subagents.length; i++) {
					const sub = this.subagents[i];
					if (sub.status === 'running' || sub.status === 'pending') {
						this.subagents[i] = { ...sub, status: 'failed' };
					}
				}

				this.client.markExited();
				if (this.seededPrompt) {
					this.clearSeed();
				}

				if (this.pendingStartupPrompts.length > 0) {
					for (const pending of this.pendingStartupPrompts) {
						const idx = this.entries.indexOf(pending.optimisticUser);
						if (idx !== -1) this.entries.splice(idx, 1);
					}
					this.pendingStartupPrompts = [];
					this.pushNotice('error', messages.ui_ts_session_prompt_non_inviato_la_sessione_omp_e_f327());
					this.onStartupPromptsDropped?.();
				}
				if (resumeMissing) {
					this.requestedResume = null;
					this.recoveredResume = requestedResume;
					void this.recoverMissingResume();
					return;
				}
				const unavailableResumeModel =
					requestedResume !== null ? parseUnavailableResumeModel(stderr) : null;
				if (unavailableResumeModel && requestedResume !== null && !this.resumeFallbackAttempted) {
					this.resumeFallbackAttempted = true;
					this.unavailableResumeModel = unavailableResumeModel;
					this.requestedResume = null;
					void this.recoverUnavailableModelResume(requestedResume, unavailableResumeModel, stderr);
					return;
				}
				if (unavailableResumeModel) {
					this.requestedResume = null;
					this.unavailableResumeModel = null;
					this.resumedFallbackModel = null;
					this.push({
						id: this.nextEntryId++,
						kind: 'notice',
						level: 'error',
						message:
							(messages as Record<string, any>).ui_ts_session_modello_non_disponibile_errore?.({
								model: unavailableResumeModel
							}) ?? `Il modello ${unavailableResumeModel} non è disponibile per questa sessione.`,
						detail: stderr.slice(-12),
						offerTerminal: true,
						action: {
							label: (messages as Record<string, any>).ui_ts_session_scegli_modello?.() ?? 'Scegli modello',
							run: () => {
								modelSettingsStore.openForSelection(async (chosenSelector) => {
									const { base } = splitModelSelector(chosenSelector, modelSettingsStore.knownSelectors);
									await this.open(requestedResume, { modelOverride: base });
								});
							}
						}
					});
					return;
				}

				this.requestedResume = null;
				this.push({
					id: this.nextEntryId++,
					kind: 'notice',
					level: code === 0 ? 'info' : 'error',
					message:
						code === 0
							? messages.ui_ts_session_la_sessione_omp_e_terminata_58c0()
							: messages.ui_ts_session_la_sessione_omp_e_terminata_codice_value1_5c24({ value1: code ?? 'sconosciuto' }),
					detail: stderr.slice(-12),
					offerTerminal: code !== 0
				});
				return;
			}

			default:
				return;
		}
	}
	private async recoverMissingResume() {
		const opening = this.opening;
		if (opening) {
			try {
				await opening;
			} catch {
				// L'errore utile e' gia' nello stderr del processo terminato.
			}
		}
		try {
			await this.open();
		} catch (error) {
			this.recoveredResume = null;
			this.pushNotice('error', `Nuova chat non avviata: ${this.reason(error)}`, undefined, true);
		}
	}

	private async recoverUnavailableModelResume(sessionId: string, failedModel: string, stderr: string[]) {
		const opening = this.opening;
		if (opening) {
			try {
				await opening;
			} catch {
				// L'errore utile e' gia' nello stderr del processo terminato.
			}
		}
		let defaultModel: string | null = null;
		try {
			await modelSettingsStore.ensureConfigAndCatalog();
			const raw =
				modelSettingsStore.config?.modelRoles?.default ||
				modelSettingsStore.draftConfig?.modelRoles?.default;
			if (raw) {
				const base = splitModelSelector(raw, modelSettingsStore.knownSelectors).base.trim();
				if (base && base !== failedModel) {
					defaultModel = base;
				}
			}
		} catch (error) {
			console.warn('Risoluzione modello di default non riuscita:', error);
		}

		if (defaultModel) {
			this.resumedFallbackModel = defaultModel;
			try {
				await this.open(sessionId, { modelOverride: defaultModel });
				return;
			} catch (error) {
				console.warn('Tentativo di riapertura con modello default fallito:', error);
			}
		}

		// Se nessun modello di default o il retry fallisce, mostra l'avviso di errore con l'azione per scegliere il modello
		this.unavailableResumeModel = null;
		this.resumedFallbackModel = null;
		this.push({
			id: this.nextEntryId++,
			kind: 'notice',
			level: 'error',
			message:
				(messages as Record<string, any>).ui_ts_session_modello_non_disponibile_errore?.({
					model: failedModel
				}) ?? `Il modello ${failedModel} non è disponibile per questa sessione.`,
			detail: stderr.slice(-12),
			offerTerminal: true,
			action: {
				label: (messages as Record<string, any>).ui_ts_session_scegli_modello?.() ?? 'Scegli modello',
				run: () => {
					modelSettingsStore.openForSelection(async (chosenSelector) => {
						const { base } = splitModelSelector(chosenSelector, modelSettingsStore.knownSelectors);
						await this.open(sessionId, { modelOverride: base });
					});
				}
			}
		});
	}

	private asMessage(value: AgentMessage | string | undefined): AgentMessage | null {
		return value && typeof value === 'object' ? value : null;
	}

	/**
	 * Traduce un messaggio di sistema di `omp` nella entry che la timeline sa
	 * disegnare. Unico punto di verita': live e replay storico devono produrre
	 * la stessa cosa, altrimenti riprendere una sessione cambia quello che vedi.
	 */
	private classifiedEntry(message: AgentMessage): TranscriptEntry | null {
		const dedupKey = noticeDedupKey({
			role: message.role,
			customType: message.customType,
			timestamp: message.timestamp
		});
		if (dedupKey && this.renderedCustomKeys.has(dedupKey)) {
			return null;
		}

		const text = textOf(message.content);
		const classified = classifySystemMessage({
			role: message.role,
			customType: message.customType,
			display: message.display,
			details: message.details,
			text
		});

		if (!classified) {
			return null;
		}

		if (dedupKey) {
			this.renderedCustomKeys.add(dedupKey);
		}

		switch (classified.kind) {
			case 'subagent-result': {
				this.reconcileSubagentsFromJobs(classified.jobs);
				return {
					id: this.nextEntryId++,
					kind: 'subagent-result',
					jobs: classified.jobs
				};
			}

			case 'irc': {
				return {
					id: this.nextEntryId++,
					kind: 'irc',
					direction: classified.direction,
					peer: classified.peer,
					body: classified.body,
					replyTo: classified.replyTo
				};
			}

			case 'chip': {
				return {
					id: this.nextEntryId++,
					kind: 'system-chip',
					customType: classified.customType,
					title: classified.title,
					body: classified.body,
					internal: false
				};
			}

			case 'hidden': {
				return {
					id: this.nextEntryId++,
					kind: 'system-chip',
					customType: classified.customType,
					title: classified.title,
					body: classified.body,
					internal: true
				};
			}

			case 'todo-reminder': {
				if (typeof classified.attempt === 'number' && typeof classified.maxAttempts === 'number') {
					this.todoReminder = { attempt: classified.attempt, max: classified.maxAttempts };
				}
				return null;
			}
		}
	}

	/**
	 * Riconcilia lo stato dei subagenti nello store `subagents` con gli esiti
	 * arrivati nei job asincroni. Se il risultato arriva dopo la fine del turno,
	 * i conteggi di SubagentBar altrimenti resterebbero fermi a `running`.
	 */
	private reconcileSubagentsFromJobs(jobs: JobResult[]) {
		for (const job of jobs) {
			if (!job.envelope) continue;
			const env = job.envelope;
			const key = env.id;
			if (!key) continue;

			const mappedStatus: AgentProgress['status'] | undefined =
				env.statusKind === 'completed'
					? 'completed'
					: env.statusKind === 'failed'
						? 'failed'
						: env.statusKind === 'aborted'
							? 'aborted'
							: undefined;

			const existing = this.subagents.findIndex((candidate) => candidate.id === key);
			if (existing === -1) {
				const entry: AgentProgress = {
					id: key,
					agent: env.agent,
					status: mappedStatus ?? 'completed'
				};
				if (typeof job.durationMs === 'number') {
					entry.durationMs = job.durationMs;
				}
				this.subagents.push(entry);
			} else {
				const current = this.subagents[existing];
				this.subagents[existing] = {
					...current,
					status: mappedStatus ?? current.status,
					durationMs: typeof job.durationMs === 'number' ? job.durationMs : current.durationMs
				};
			}
		}
	}

	/**
	 * Verifica se ci sono ancora task pendenti o in corso nelle fasi dei todo.
	 */
	private hasActiveTodos(): boolean {
		return this.todoPhases.some((phase) =>
			Array.isArray(phase.tasks) &&
			phase.tasks.some((task) => task.status === 'pending' || task.status === 'in_progress')
		);
	}

	private noticeLevel(level: unknown): 'info' | 'warning' | 'error' {
		if (level === 'error') return 'error';
		if (level === 'warn' || level === 'warning') return 'warning';
		return 'info';
	}

	private retryText(event: AgentSessionEvent, fallback: string): string {
		const reason = event.reason ?? event.message ?? event.error;
		return typeof reason === 'string' && reason ? reason : fallback;
	}

	private resolveSettledState(): AgentSurfaceState {
		if (this.pendingUi) return 'attention';
		if (this.blockedQuotaState && !this.blockedQuotaState.dismissed) return 'attention';
		if (this.inferredAttention) return 'attention';
		// Turno ceduto ma lavoro ancora in volo: per la tessera e per le
		// notifiche l'agente non ha finito. `finished` arriva con la quiete.
		if (this.backgroundPending) return 'working';
		return 'idle';
	}

	/** Il lavoro in background e' finito: lo stato torna quello di un turno concluso. */
	private onSettled() {
		this.stopSettlePoll();
		if (this.isStreaming || this.isCompacting) return;
		if (this.agentState === 'working') this.agentState = this.resolveSettledState();
	}

	/**
	 * Rete di sicurezza per un `session_settled` perso (processo riavviato a
	 * meta', frame scartato): finche' si aspetta il background, `get_state` ogni
	 * tanto riporta `isSettled`. Un timer solo, mai sovrapposto.
	 */
	private scheduleSettlePoll() {
		if (this.settlePollTimer !== null || this.exited) return;
		this.settlePollTimer = setTimeout(() => {
			this.settlePollTimer = null;
			if (!this.backgroundPending || this.exited || !this.isReady) return;
			void this.reconcile().finally(() => {
				if (this.backgroundPending) this.scheduleSettlePoll();
			});
		}, SETTLE_POLL_MS);
	}

	private stopSettlePoll() {
		if (this.settlePollTimer === null) return;
		clearTimeout(this.settlePollTimer);
		this.settlePollTimer = null;
	}

	/**
	 * Rispecchia i flag reattivi solo quando cambiano: il record si aggiorna a
	 * ogni delta e scriverlo in una `$state` riaccenderebbe il cancello della
	 * coda a ogni token.
	 */
	private applyRunActivity(next: RunActivity) {
		this.runActivity = next;
		if (this.awaitingRun !== next.awaitingRun) this.awaitingRun = next.awaitingRun;
		if (this.isRetrying !== next.retrying) this.isRetrying = next.retrying;
		if (next.awaitingRun) this.armAwaitingRunTimer();
		else if (this.awaitingRunTimer !== null) {
			clearTimeout(this.awaitingRunTimer);
			this.awaitingRunTimer = null;
		}
	}

	/** Rete di sicurezza: un prompt ammesso che non avvia mai un run non blocca la coda per sempre. */
	private armAwaitingRunTimer() {
		if (this.awaitingRunTimer !== null) return;
		this.awaitingRunTimer = setTimeout(() => {
			this.awaitingRunTimer = null;
			if (!this.runActivity.awaitingRun) return;
			// La compattazione prima del prompt ha il suo stato: si aspetta ancora.
			if (this.isCompacting || !awaitingRunExpired(this.runActivity, Date.now())) {
				this.armAwaitingRunTimer();
				return;
			}
			this.applyRunActivity(runActivityOnPromptDropped(this.runActivity));
		}, AWAITING_RUN_TIMEOUT_MS);
	}

	/**
	 * omp senza quiete: se il run resta «vivo» senza eventi, `get_state` dopo
	 * `RUN_STALE_MS` decide (vedi `applyState`). Con la quiete serve a nulla:
	 * `session_settled` e `isSettled` chiudono gia' il run.
	 */
	private scheduleRunWatch() {
		if (this.settle.aware || this.runWatchTimer !== null || this.exited) return;
		this.runWatchTimer = setTimeout(() => {
			this.runWatchTimer = null;
			if (!this.settle.running || this.isStreaming || this.exited || !this.isReady) return;
			if (this.quietForMs() < RUN_STALE_MS) {
				this.scheduleRunWatch();
				return;
			}
			void this.reconcile().finally(() => {
				if (this.settle.running && !this.isStreaming) this.scheduleRunWatch();
			});
		}, RUN_STALE_MS);
	}

	private stopRunWatch() {
		if (this.runWatchTimer === null) return;
		clearTimeout(this.runWatchTimer);
		this.runWatchTimer = null;
	}

	/** Quiete e voci delle estensioni appartengono al processo omp, non alla chat. */
	private resetProcessScopedState() {
		this.stopSettlePoll();
		this.stopRunWatch();
		this.settle = { ...INITIAL_SETTLE };
		this.applyRunActivity(runActivityReset(this.runActivity, Date.now()));
		const empty = emptyExtensionUi();
		this.extensionStatus = empty.status;
		this.extensionWidgets = empty.widgets;
	}

	/** Messaggio d'errore di un `prompt_result`: provider, modello, HTTP e se si puo' riprovare. */
	private promptFailureText(failure: NonNullable<ReturnType<typeof promptResultError>>): string {
		const source = [failure.provider, failure.model].filter(Boolean).join(' · ');
		const http = failure.httpStatus !== undefined ? ` (HTTP ${failure.httpStatus})` : '';
		const head = source
			? messages.chat_v2_prompt_error_with_source({ source: `${source}${http}` })
			: messages.chat_v2_prompt_error({ http });
		const tail = failure.retryable ? messages.chat_v2_prompt_error_retryable() : '';
		return [`${head} ${failure.message}`, tail].filter(Boolean).join(' ');
	}

	/**
	 * Registra un'attenzione dedotta post-turno quando l'agente pone una domanda
	 * o attende conferma senza aver invocato il tool ask.
	 */
	setInferredAttention(question: string, suggestions: string[]) {
		this.inferredAttention = { question, suggestions };
		if (!this.isStreaming && !this.pendingUi) {
			this.agentState = 'attention';
		}
	}

	/**
	 * Azzera l'attenzione dedotta quando l'utente risponde o invia un nuovo prompt.
	 */
	clearInferredAttention() {
		if (this.inferredAttention) {
			this.inferredAttention = null;
			if (!this.isStreaming) {
				this.agentState = this.resolveSettledState();
			}
		}
	}

	private checkAndSetQuotaBlocked(rawError: string, force = false) {
		const currentModel = this.model;
		const provider = currentModel?.provider || '';
		const modelId = currentModel?.id || '';
		const qInfo = computeQuotaInfo(provider, modelId, undefined);
		const classification = classifyFailureReason(rawError, qInfo.status);

		// Se non e' un esaurimento effettivo di quota/crediti e non e' forzato
		// (ad esempio dal completamento dei tentativi automatici auto_retry_end),
		// non bloccare la quota del progetto: un semplice errore di esecuzione
		// o tool non deve congelare la coda ne' mostrare il banner di cambio modello.
		if (!force && classification.kind !== 'quota_exhausted') {
			return;
		}

		const recovery = recommendRecoveryModel({
			failedProvider: provider,
			failedModelId: modelId,
			config: modelSettingsStore.config,
			catalog: modelSettingsStore.catalog,
			knownSelectors: modelSettingsStore.knownSelectors,
			checkQuota: (p, m) => computeQuotaInfo(p, m, undefined).status
		});

		this.blockedQuotaState = {
			id: `quota-blocked-${Date.now()}`,
			reasonKind: classification.kind,
			title: classification.title,
			message: classification.summary,
			rawError,
			failedProvider: provider,
			failedModelId: modelId,
			failedSelector: provider && modelId ? `${provider}/${modelId}` : modelId,
			timestamp: Date.now(),
			dismissed: false,
			suggestedModel: recovery.primary,
			availableRecoveryModels: recovery.all
		};

		this.agentState = 'attention';
	}

	private applyAssistantEvent(event: AgentSessionEvent) {
		if (!this.isStreaming || !this.assistantEntry || this.isAborting) return;
		const inner = event.assistantMessageEvent;
		if (!inner) return;
		const index = inner.contentIndex ?? 0;
		if (inner.type === 'toolcall_start' || inner.type === 'toolcall_delta' || inner.type === 'toolcall_end') {
			this.applyAskToolDelta(inner);
			return;
		}

		// I `*_end` portano il testo autorevole: rimpiazzano il blocco e sanano
		// ogni delta perso.
		if (inner.type === 'text_end' && typeof inner.content === 'string') {
			this.setBlock(index, { type: 'text', text: inner.content });
			return;
		}
		if (inner.type === 'thinking_end' && typeof inner.content === 'string') {
			this.setBlock(index, { type: 'thinking', text: inner.content });
			return;
		}
		if (inner.type === 'image_end' && typeof inner.content === 'string') {
			this.setBlock(index, { type: 'image', data: inner.content, mimeType: inner.mimeType ?? 'image/png' });
			return;
		}
	}

	private clearStreamAsk() {
		this.streamAsk = null;
		this.askTracker.reset();
	}

	private applyAskToolDelta(inner: NonNullable<AgentSessionEvent['assistantMessageEvent']>) {
		const index = inner.contentIndex ?? 0;
		const call = inner.toolCall ?? (Array.isArray(inner.partial?.content)
			? inner.partial.content[index]
			: undefined);
		if (inner.type === 'toolcall_start') {
			if (this.askTracker.start(index, call)) this.streamAsk = this.askTracker.current;
			return;
		}
		if (inner.type === 'toolcall_end') {
			if (this.askTracker.end(index, call)) {
				this.streamAsk = this.askTracker.current;
			}
			return;
		}
		if (this.askTracker.delta(index, inner.delta ?? '', call)) this.streamAsk = this.askTracker.current;
	}

	private applyDelta(event: AgentSessionEvent) {
		if (!this.isStreaming || !this.assistantEntry || this.isAborting) return;
		const kind = event.kind ?? 'text';
		const delta = typeof event.delta === 'string' ? event.delta : '';
		const index = typeof event.contentIndex === 'number' ? event.contentIndex : 0;
		// Il backend ricompone anche i `toolcall_delta` in `studio_delta`: senza
		// questo ramo l'anteprima di `ask` restava vuota fino a `toolcall_end`.
		if (kind === 'toolcall') {
			if (this.askTracker.delta(index, delta)) this.streamAsk = this.askTracker.current;
			return;
		}
		if (kind !== 'text' && kind !== 'thinking') return;
		this.deltaBatcher.push(kind, index, delta);
	}

	private applyBufferedDelta(kind: string, index: number, delta: string) {
		if (!this.isStreaming || !this.assistantEntry || this.isAborting) return;
		if (kind !== 'text' && kind !== 'thinking') return;
		const entry = this.ensureAssistant();
		const existing = entry.blocks[index];
		if (existing && existing.type === kind) {
			existing.text += delta;
			return;
		}
		this.setBlock(index, { type: kind, text: delta });
	}

	private ensureAssistant(): AssistantEntry {
		if (this.assistantEntry) return this.assistantEntry;
		this.assistantEntry = this.push({
			id: this.nextEntryId++,
			kind: 'assistant',
			blocks: [],
			messageTs: this.liveAssistantTs
		}) as AssistantEntry;
		this.activeAssistantId = this.assistantEntry.id;
		return this.assistantEntry;
	}

	private setBlock(index: number, block: Block) {
		const entry = this.ensureAssistant();
		while (entry.blocks.length < index) entry.blocks.push({ type: 'text', text: '' });
		entry.blocks[index] = block;
	}

	private applySubagent(event: AgentSessionEvent) {
		const payload = event.payload;
		if (!payload) return;
		// `sessionFile` e `parentToolCallId` stanno alla radice del payload, non
		// dentro `progress`: prendere solo `progress` li perdeva, e senza
		// `sessionFile` il cassetto del subagent non sa cosa leggere.
		const base: Partial<AgentProgress> = {
			index: payload.index,
			id: payload.id,
			agent: payload.agent,
			agentSource: payload.agentSource,
			description: payload.description,
			sessionFile: payload.sessionFile,
			parentToolCallId: payload.parentToolCallId
		};
		const progress: AgentProgress = payload.progress
			? { ...base, ...payload.progress }
			: {
					...base,
					status:
						payload.status === 'started'
							? 'running'
							: payload.status === 'completed' || payload.status === 'failed' || payload.status === 'aborted'
								? payload.status
								: 'pending'
				};
		const key = progress.id ?? payload.id;
		if (!key) return;
		const existing = this.subagents.findIndex((candidate) => candidate.id === key);
		if (existing === -1) this.subagents.push({ ...progress, id: key });
		else this.subagents[existing] = { ...this.subagents[existing], ...progress, id: key };

		if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'aborted') {
			void this.refreshSubagentCost();
		}
	}

	/**
	 * Le `extension_ui_request` arrivano dal filo: i campi si restringono uno
	 * per uno. Non tutte sono domande — `setWidget` arriva da sola e non
	 * vuole risposta.
	 */
	private applyUiRequest(event: AgentSessionEvent) {
		const id = typeof event.id === 'string' ? event.id : null;
		const method = typeof event.method === 'string' ? event.method : '';
		if (!id || !method) return;
		const title = typeof event.title === 'string' ? event.title : undefined;
		const text = typeof event.message === 'string' ? event.message : undefined;

		if (method === 'cancel') {
			const target = typeof event.targetId === 'string' ? event.targetId : null;
			// Revisione del Piano ritirata da omp (turno interrotto): via la scheda.
			if (target && this.plan.closeReview(target)) {
				this.settleAttention();
				return;
			}
			if (!target || this.pendingUi?.requestId === target) {
				const cancelId = target ?? this.pendingUi?.requestId;
				if (cancelId && promptBus.hasPending(cancelId)) {
					// La cancellazione viene da omp: rimandargliela sarebbe un'eco.
					void promptBus.cancelRequest(cancelId, undefined, true);
				}
				this.clearPendingUi();
				this.pushNotice('info', messages.chat_v2_ask_withdrawn(), 'domande');
			}
			return;
		}
		if (method === 'notify') {
			const body = text ?? title;
			// omp manda il livello in `notifyType`; `level` resta per i frame vecchi.
			if (body) this.pushNotice(this.noticeLevel(event.notifyType ?? event.level), body, 'estensione');
			return;
		}
		// Le chiavi riservate di Studio portano stato strutturato (JSON) per la
		// GUI: si intercettano prima del ramo generico, cosi' non compaiono mai
		// come voce di stato o widget dell'estensione.
		if (method === 'setStatus' && event.statusKey === PLAN_STATUS_KEY) {
			// Lo stato del Piano arriva su una chiave sua: non e' testo per la riga di stato.
			this.plan.applyStatus(event.statusText);
			return;
		}
		if (method === 'setStatus' && event.statusKey === STUDIO_GOAL_STATUS_KEY) {
			// Risposta dell'estensione `studio-goal`: dati per l'intervista, non uno stato da mostrare.
			this.applyStudioGoalStatus(typeof event.statusText === 'string' ? event.statusText : undefined);
			return;
		}
		if (method === 'setStatus' && event.statusKey === LOOP_STATUS_KEY) {
			this.applyLoopStatus(event.statusText);
			return;
		}
		if (method === 'setStatus' || method === 'setWidget') {
			const next = reduceExtensionUi(
				{ status: this.extensionStatus, widgets: this.extensionWidgets },
				event
			);
			if (next) {
				this.extensionStatus = next.status;
				this.extensionWidgets = next.widgets;
			}
			return;
		}
		// `setTitle` e' il titolo del terminale (omp in RPC lo sopprime se non c'e'
		// PI_RPC_EMIT_TITLE=1): non e' il nome della sessione, che Studio genera
		// e salva da se'. Usarlo come titolo della scheda lo sovrascriverebbe con
		// testi di stato da terminale. Lo si ignora di proposito.
		if (method === 'setTitle') return;
		if (method === 'open_url') {
			// Il campo `launchUrl` esiste proprio per questo: quando c'e', e'
			// l'indirizzo da aprire davvero. L'evento arriva da un'estensione
			// dell'agente, quindi il protocollo va verificato prima di aprirlo.
			const target = typeof event.launchUrl === 'string' ? event.launchUrl : typeof event.url === 'string' ? event.url : null;
			if (target === null) return;
			if (!isAllowedExternalUrl(target)) {
				this.pushNotice('warning', `Apertura bloccata: ${target}`, 'estensione');
				return;
			}
			void openExternalUrl(target);
			return;
		}
		if (ANSWERABLE_UI_METHODS[method] !== true) return;

		// Revisione del Piano: `editor` con titolo `studio-plan-review:`. Non e'
		// una domanda generica: la decide la scheda di approvazione.
		if (method === 'editor') {
			const review = parsePlanReviewRequest(title, event.prefill);
			if (review) {
				this.plan.openReview(id, review);
				this.agentState = 'attention';
				return;
			}
		}

		if (method === 'ask') {
			const questions: AskQuestion[] = Array.isArray(event.questions)
				? (event.questions as AskDialogQuestion[]).map((q, idx) => ({
						id: typeof q.id === 'string' && q.id ? q.id : `q${idx + 1}`,
						question: typeof q.question === 'string' ? q.question : '',
						header: typeof q.header === 'string' ? q.header : undefined,
						options: Array.isArray(q.options)
							? q.options.map((opt) => ({
									label: typeof opt.label === 'string' ? opt.label : String(opt),
									description: typeof opt.description === 'string' ? opt.description : undefined,
									preview: typeof opt.preview === 'string' ? opt.preview : undefined
								}))
							: [],
						multi: q.multi === true,
						recommended: typeof q.recommended === 'number' ? q.recommended : undefined
					}))
				: [];

			const runningAsk = Array.from(this.toolEntries.values())
				.reverse()
				.find((t) => t.running && t.toolName === 'ask');

			this.pendingUi = {
				kind: 'ask',
				requestId: id,
				toolCallId: runningAsk?.toolCallId ?? this.streamAsk?.toolCallId ?? undefined,
				method: 'ask',
				title: questions[0]?.question ?? '',
				message: undefined,
				options: questions[0]?.options.map((o) => o.label) ?? [],
				optionDetails: questions[0]?.options.map((o) => ({ description: o.description })) ?? [],
				deadline: typeof event.timeout === 'number' ? Date.now() + event.timeout : undefined,
				questions,
				questionIndex: 0,
				totalQuestions: questions.length
			};
			this.agentState = 'attention';

			promptBus.registerRequest({
				requestId: id,
				projectId: this.projectKey,
				laneId: this.laneId ?? 'main',
				sessionId: this.sessionId,
				toolCallId: runningAsk?.toolCallId,
				owner: this.promptOwner(),
				kind: 'ask',
				method: 'ask',
				title: this.pendingUi.title,
				message: this.pendingUi.message,
				options: this.pendingUi.options,
				optionDetails: this.pendingUi.optionDetails,
				deadline: this.pendingUi.deadline,
				questions,
				questionIndex: 0,
				totalQuestions: questions.length,
				responder: async (answer) => {
					return this.handlePromptAnswer(id, answer);
				}
			});
			return;
		}

		const options = Array.isArray(event.options)
			? event.options.filter((option): option is string => typeof option === 'string')
			: [];
		const optionDetails = Array.isArray(event.optionDetails)
			? event.optionDetails.map((detail) => ({
					description:
						detail && typeof detail === 'object' && 'description' in detail && typeof detail.description === 'string'
							? detail.description
							: undefined
				}))
			: [];

		this.pendingUi = {
			kind: 'ask',
			requestId: id,
			toolCallId: undefined,
			method: method === 'confirm' || method === 'input' || method === 'editor' ? method : 'select',
			title: title ?? '',
			message: text,
			options,
			optionDetails,
			placeholder: typeof event.placeholder === 'string' ? event.placeholder : undefined,
			prefill: typeof event.prefill === 'string' ? event.prefill : undefined,
			deadline: typeof event.timeout === 'number' ? Date.now() + event.timeout : undefined
		};
		this.agentState = 'attention';

		promptBus.registerRequest({
			requestId: id,
			projectId: this.projectKey,
			laneId: this.laneId ?? 'main',
			sessionId: this.sessionId,
			owner: this.promptOwner(),
			kind: 'ask',
			method: this.pendingUi.method,
			title: this.pendingUi.title,
			message: this.pendingUi.message,
			options: this.pendingUi.options,
			optionDetails: this.pendingUi.optionDetails,
			placeholder: this.pendingUi.placeholder,
			prefill: this.pendingUi.prefill,
			deadline: this.pendingUi.deadline,
			responder: async (answer) => {
				return this.handlePromptAnswer(id, answer);
			}
		});
	}

	/**
	 * Bozza del wizard della domanda aperta (risposte, passo corrente). Sta
	 * qui e non nella card perche' la card ridotta nel vassoio viene smontata:
	 * un solo slot, legato alla richiesta e alla sua forma (domande note o no).
	 */
	private askDraft: { requestId: string; variant: string; value: unknown } | null = null;

	askWizardDraft<T>(requestId: string, variant: string, create: () => T): T {
		const current = this.askDraft;
		if (current && current.requestId === requestId && current.variant === variant) return current.value as T;
		const value = create();
		this.askDraft = { requestId, variant, value };
		return value;
	}

	private clearPendingUi() {
		const reqId = this.pendingUi?.requestId;
		this.pendingUi = null;
		this.askDraft = null;
		if (this.agentState === 'attention') this.agentState = this.isStreaming ? 'working' : 'idle';
		if (reqId && promptBus.hasPending(reqId)) {
			// Chiusura locale: il bus non deve richiamare il responder, che
			// risponderebbe `cancelled` a omp per una richiesta gia' chiusa.
			void promptBus.cancelRequest(reqId, undefined, true);
		}
	}

	/** Identita' del processo omp corrente per le voci del bus delle domande. */
	private promptOwner(): string | null {
		const id = this.client.id;
		return id === null ? null : `rpc:${id}`;
	}

	/**
	 * Passa a `working` solo se non c'e' una domanda aperta. Gli eventi del
	 * ciclo di vita (`tool_execution_start` di `ask`, `agent_start`,
	 * `turn_start`) possono arrivare dopo la richiesta interattiva, perche'
	 * omp scrive `extension_ui_request` per conto suo mentre gli altri eventi
	 * passano dallo stream dell'agent-loop: senza questa guardia lo stato
	 * tornerebbe "in esecuzione" mentre l'agente aspetta l'utente, spegnendo
	 * l'anello di attenzione nella barra progetti e l'allerta sull'icona.
	 */
	private markWorking() {
		if (this.pendingUi || this.plan.review) return;
		this.inferredAttention = null;
		this.blockedQuotaState = null;
		this.agentState = 'working';
	}

	/* --------------------------------------------------------- risposte UI */

	/**
	 * Invia una risposta e conferma lo stato solo se l'invio riesce. Su errore
	 * la richiesta torna all'utente cosi' com'era: perderla lascerebbe
	 * l'agente in attesa di qualcosa che non arrivera' mai.
	 */
	private async respond(
		pending: PendingUiRequest,
		answer: AskAnswerPayload
	): Promise<boolean> {
		const previousState = this.agentState;
		this.pendingUi = null;
		if (this.agentState === 'attention') this.agentState = this.isStreaming ? 'working' : 'idle';

		try {
			await this.client.respondUi(
				'cancelled' in answer
					? {
							type: 'extension_ui_response',
							id: pending.requestId,
							cancelled: true,
							...(answer.timedOut ? { timedOut: true } : {})
						}
					: 'answers' in answer
						? {
								type: 'extension_ui_response',
								id: pending.requestId,
								answers: answer.answers
							}
						: 'confirmed' in answer
							? {
									type: 'extension_ui_response',
									id: pending.requestId,
									confirmed: answer.confirmed
								}
							: {
									type: 'extension_ui_response',
									id: pending.requestId,
									value: answer.value
								}
			);
			if (promptBus.hasPending(pending.requestId)) {
				if ('cancelled' in answer) {
					void promptBus.cancelRequest(pending.requestId, undefined, true);
				} else {
					void promptBus.resolveRequest(pending.requestId, answer as PromptAnswer, undefined, true);
				}
			}
			return true;
		} catch (error) {
			this.pendingUi = pending;
			this.agentState = previousState;
			this.pushNotice('error', `Risposta non inviata: ${this.reason(error)}`);
			return false;
		}
	}

	async submitAskAnswers(answers: AskDialogAnswer[]) {
		if (answers.length === 0) {
			await this.cancelPendingUi();
			return;
		}
		const pending = this.pendingUi;
		if (!pending) return;
		await this.respond(pending, { answers });
	}

	async answerSelect(value: string) {
		const pending = this.pendingUi;
		if (!pending) return;
		await this.respond(pending, { value });
	}

	async answerConfirm(confirmed: boolean) {
		const pending = this.pendingUi;
		if (!pending) return;
		await this.respond(pending, { confirmed });
	}

	async cancelPendingUi(timedOut = false): Promise<boolean> {
		const pending = this.pendingUi;
		if (!pending) return true;
		return this.respond(pending, { cancelled: true, timedOut });
	}

	/**
	 * Ripristina lo stato di una richiesta pendente da PromptBus (es. dopo reload o riapertura).
	 */
	restorePendingUiFromPrompt(promptReq: PromptRequest) {
		this.pendingUi = {
			kind: 'ask',
			requestId: promptReq.requestId,
			toolCallId: promptReq.toolCallId ?? undefined,
			method: promptReq.method,
			title: promptReq.title,
			message: promptReq.message,
			options: [...promptReq.options],
			optionDetails: [...promptReq.optionDetails],
			placeholder: promptReq.placeholder,
			prefill: promptReq.prefill,
			deadline: promptReq.deadline,
			questions: promptReq.questions as AskQuestion[] | undefined,
			questionIndex: promptReq.questionIndex,
			totalQuestions: promptReq.totalQuestions
		};
		this.agentState = 'attention';
		promptBus.attachResponder(promptReq.requestId, async (answer) => {
			return this.handlePromptAnswer(promptReq.requestId, answer);
		});
	}

	/**
	 * Risponde a una richiesta interattiva instradata da PromptBus (da qualsiasi finestra).
	 */
	async handlePromptAnswer(requestId: string, answer: PromptAnswer): Promise<boolean> {
		if (!this.pendingUi || this.pendingUi.requestId !== requestId) {
			const stored = promptBus.getRequest(requestId);
			if (stored && canRestorePrompt(stored, {
				projectKey: this.projectKey,
				laneId: this.laneId,
				sessionId: this.sessionId,
				livePendingId: this.pendingUi?.requestId ?? null
			})) {
				this.restorePendingUiFromPrompt(stored);
			}
		}
		const current = this.pendingUi;
		if (!current || current.requestId !== requestId) return false;

		const normalized = normalizePromptAnswer(answer);
		if ((normalized.action === 'wizard' || normalized.action === 'ask') && normalized.answers) {
			await this.submitAskAnswers(normalized.answers);
			return true;
		}
		if (normalized.action === 'confirm' && typeof normalized.confirmed === 'boolean') {
			await this.answerConfirm(normalized.confirmed);
			return true;
		}
		if (normalized.action === 'cancel') {
			await this.cancelPendingUi();
			return true;
		}
		if (typeof normalized.value === 'string') {
			await this.answerSelect(normalized.value);
			return true;
		}
		return false;
	}

	/* ------------------------------------------------------------- comandi */

	/**
	 * Invio di un prompt. Durante lo streaming `streamingBehavior` e'
	 * obbligatorio: senza, il comando fallisce lato omp. Predefinito a 'steer'.
	 *
	 * L'esito e' parte del contratto: chi dipende dalla consegna (la coda dei
	 * task, che toglie il task dalla coda solo se il prompt e' partito) non
	 * puo' dedurla dal fatto che la chiamata sia ritornata. `sent` omp lo ha
	 * accettato, `deferred` parte alla fine dell'insediamento, `failed` omp
	 * lo ha rifiutato, `empty` non c'era niente da inviare.
	 */
	/**
	 * Semina preventivamente il prompt nella chat all'avvio del task dalla coda,
	 * prima che il processo omp sia pronto o inizializzato.
	 * Questo elimina la latenza percepita mostrando immediatamente il messaggio
	 * con la transizione fluida, con lo stesso ID che avra la entry finale.
	 */
	seedPrompt(content: string, images: ImageContent[] = []) {
		this.startupPhase = 'starting';
		this.seededPrompt = {
			id: this.nextEntryId++,
			content,
			images: images.map((image) => ({ data: image.data, mimeType: image.mimeType })),
			createdAt: Date.now()
		};
	}

	/** Revoca eventuali prompt di avvio accodati in attesa dell'aggancio. */
	clearPendingStartupPrompts() {
		this.pendingStartupPrompts = [];
		this.dropOptimisticUser();
	}

	/**
	 * Rimuove il prompt seminato e ripristina lo stato se il lancio del task fallisce.
	 */
	clearSeed() {
		this.seededPrompt = null;
		this.startupPhase = 'idle';
		this.clearPendingStartupPrompts();
	}

	private synthesizeLaneTitleOnFirstPrompt(message: string): void {
		nameLaneFromPrompt(this.projectKey, this.laneId ?? 'main', message);
	}

	/**
	 * In RPC omp non titola le sessioni: al primo messaggio il titolo lo genera
	 * Studio e lo consegna a omp, che lo scrive nel transcript e nel suo indice
	 * (cosi' compare anche nel `/resume` del terminale). I prototipi del
	 * Laboratorio hanno gia' il loro nome.
	 */
	private titleSessionFromFirstPrompt(message: string): void {
		const sessionId = this.sessionId;
		if (!sessionId || this.sessionName || this.labConfig || !settingsStore.taskTitles.autoGenerate) return;
		void generateSessionTitle(sessionId, message).then(async (title) => {
			// Durante la chiamata l'utente puo' aver cambiato sessione o usato /name.
			if (!title || this.sessionId !== sessionId || this.sessionName) return;
			try {
				await this.client.send({ type: 'set_session_name', name: title });
				this.sessionName = title;
			} catch (err) {
				console.warn('Titolo non consegnato a omp:', err);
			}
			window.dispatchEvent(new CustomEvent('studio-sessions-refresh', { detail: { projectPath: this.cwd } }));
		});
	}

	/** Chip della coda di omp: prima gli steer, poi i follow-up. */
	get queuedChips(): QueuedMessage[] {
		return queueChips(this.queuedMessages);
	}

	/** Ultimo messaggio in coda: prima i follow-up, poi gli steer (come la TUI). */
	lastQueuedMessage(): QueuedMessage | null {
		const { steering, followUp } = this.queuedMessages;
		const last = (text: string | undefined, queue: QueuedMessageQueue): QueuedMessage | null =>
			text === undefined ? null : { text, queue };
		return last(followUp.at(-1), 'followUp') ?? last(steering.at(-1), 'steering');
	}

	/**
	 * Ritira un chip dalla coda di omp: il testo e' quello opaco mostrato dal
	 * chip e va rimandato identico. Restituisce il contenuto da ripristinare
	 * nell'editor, o `null` se omp non ha trovato il messaggio.
	 */
	async removeQueuedMessage(text: string, queue: QueuedMessageQueue): Promise<RestoredQueuedMessage | null> {
		if (!this.isReady) return null;
		try {
			const result = await this.client.send<RemoveQueuedMessageResult>({
				type: 'remove_queued_message',
				message: text,
				queue
			});
			if (result?.imagesDropped) this.pushNotice('warning', messages.chat_v2_queue_images_dropped());
			if (!result?.removed) {
				// Il chip non c'era piu' (consumato da omp): si riallinea lo stato.
				void this.reconcile();
				return null;
			}
			return { text, images: result.images ?? [] };
		} catch (error) {
			this.pushNotice('error', messages.chat_v2_queue_edit_failed({ error: this.reason(error) }));
			return null;
		}
	}

	/** Sposta un follow-up in testa alla coda degli steer. */
	async promoteQueuedMessage(text: string): Promise<boolean> {
		if (!this.isReady) return false;
		try {
			const result = await this.client.send<{ promoted?: boolean }>({
				type: 'promote_queued_message',
				message: text
			});
			if (!result?.promoted) {
				void this.reconcile();
				return false;
			}
			return true;
		} catch (error) {
			this.pushNotice('error', messages.chat_v2_queue_edit_failed({ error: this.reason(error) }));
			return false;
		}
	}

	/**
	 * Consegna all'editor i messaggi ritirati dalla coda (Stop, modifica di un
	 * chip). I compositori montati si registrano qui: la sessione non conosce
	 * il DOM e il ripristino resta una sola implementazione. Senza compositore
	 * (una corsia che non ha ancora una Chat) il contenuto resta in attesa e
	 * viene consegnato appena uno si registra, invece di andare perso.
	 */
	registerQueueRestoreHandler(handler: (entries: readonly RestoredQueuedMessage[]) => void): () => void {
		this.queueRestoreHandlers.add(handler);
		if (this.pendingQueueRestore.length > 0) {
			const pending = this.pendingQueueRestore;
			this.pendingQueueRestore = [];
			handler(pending);
		}
		return () => this.queueRestoreHandlers.delete(handler);
	}

	private restoreQueueToComposer(entries: readonly RestoredQueuedMessage[]): void {
		const withContent = entries.filter((entry) => entry.text.trim().length > 0 || (entry.images?.length ?? 0) > 0);
		if (withContent.length === 0) return;
		if (this.queueRestoreHandlers.size === 0) {
			this.pendingQueueRestore.push(...withContent);
			return;
		}
		for (const handler of this.queueRestoreHandlers) handler(withContent);
	}

	/* ------------------------------------------------------------- /loop */

	/** Il motore del loop (estensione di Studio) e' caricato in questo omp. */
	get loopAvailable(): boolean {
		const name = LOOP_CONTROL_COMMAND.slice(1);
		return this.availableCommands.some((command) => command.name === name);
	}

	/** Il loop occupa la sessione: la coda non deve partire, il composer e' il pannello. */
	get loopActive(): boolean {
		return isLoopActive(this.loop);
	}

	private applyLoopStatus(raw: unknown): void {
		const snapshot = parseLoopSnapshot(raw);
		const loop = snapshot?.loop ?? null;
		this.loopProbe = snapshot?.probe ?? null;
		if (loop && !this.announcedLoops.has(loop.id) && loop.prompt && loop.giro <= 1 && !loop.restored) {
			// Il messaggio d'avvio: «/loop» + prompt + riepilogo delle opzioni.
			this.announcedLoops.add(loop.id);
			this.push({ id: this.nextEntryId++, kind: 'user', content: loop.prompt, images: [], loopStart: loop.id });
		} else if (loop) {
			this.announcedLoops.add(loop.id);
		}
		if (loop && isLoopActive(loop)) this.loopSetup = null;
		this.loop = loop;
		if (loop?.status === 'resetting' && this.loopResetFor !== `${loop.id}:${loop.giro}`) {
			// `--between reset`: le estensioni non aprono sessioni fuori dai
			// comandi, la apre Studio; il giro riparte su `session_switch`.
			this.loopResetFor = `${loop.id}:${loop.giro}`;
			void this.newSession().catch((error) =>
				this.pushNotice('error', messages.loop_reset_failed({ error: this.reason(error) }), 'loop')
			);
		}
	}

	/** Chiede all'estensione di ripubblicare lo stato (dopo l'insediamento). */
	async requestLoopStatus(): Promise<void> {
		if (!this.loopAvailable) return;
		await this.sendLoopLine(controlLine('status'), true);
	}

	/**
	 * Le righe del loop passano da `prompt`: l'handler `input` dell'estensione
	 * le consuma prima di qualunque altra cosa, anche a turno in corso, quindi
	 * non entrano mai nel transcript ne' nel contesto. Senza estensione non si
	 * invia nulla: il testo finirebbe al modello.
	 */
	private async sendLoopLine(line: string, quiet = false): Promise<boolean> {
		if (!this.isReady || !this.loopAvailable) {
			if (!quiet) this.flashNotice('warning', messages.loop_unavailable());
			return false;
		}
		try {
			await this.client.send({
				type: 'prompt',
				message: line,
				streamingBehavior: this.isStreaming ? 'steer' : undefined
			});
			return true;
		} catch (error) {
			if (!quiet) this.pushNotice('error', messages.loop_command_failed({ error: this.reason(error) }), 'loop');
			return false;
		}
	}

	openLoopSetup(draft?: LoopDraft): void {
		if (this.loopActive) return;
		if (!this.loopAvailable) {
			this.flashNotice('warning', messages.loop_unavailable());
			return;
		}
		// Un loop finito ancora a schermo lascia il posto alla nuova configurazione.
		if (this.loop) void this.dismissLoop();
		this.loopSetup = draft ?? this.loopSetup ?? {
			prompt: '',
			limit: { kind: 'iterations', count: 6 },
			condition: 'none',
			command: 'npm test',
			between: 'prompt'
		};
	}

	closeLoopSetup(): void {
		this.loopSetup = null;
		this.loopProbe = null;
	}

	/** «Avvia»: la riga `/loop …` della bozza va al motore. */
	async startLoop(draft: LoopDraft): Promise<boolean> {
		const line = draftCommand(draft);
		if (!line || !draft.prompt.trim()) return false;
		return this.startLoopCommand(line);
	}

	/** `/loop …` gia' composto (scritto nel composer o dalle pillole). */
	async startLoopCommand(line: string): Promise<boolean> {
		if (this.loopActive) {
			this.flashNotice('info', messages.loop_already_active());
			return false;
		}
		if (this.loop) await this.dismissLoop();
		return this.sendLoopLine(line);
	}

	pauseLoop(): Promise<boolean> {
		return this.sendLoopLine(controlLine('pause'));
	}

	resumeLoop(): Promise<boolean> {
		return this.sendLoopLine(controlLine('resume'));
	}

	stopLoop(): Promise<boolean> {
		return this.sendLoopLine(controlLine('stop'));
	}

	/** «Prova ora»: esegue il comando della condizione una volta. */
	probeLoopCondition(command: string): Promise<boolean> {
		const cmd = command.trim();
		if (!cmd) return Promise.resolve(false);
		this.loopProbe = { command: cmd, running: true, at: Date.now() };
		return this.sendLoopLine(controlLine('probe', cmd));
	}

	/** «Chiudi»: toglie il pannello di un loop finito. */
	async dismissLoop(): Promise<void> {
		if (this.loopActive) return;
		this.loop = null;
		this.loopProbe = null;
		await this.sendLoopLine(controlLine('dismiss'), true);
	}

	async prompt(
		message: string,
		images: ImageContent[] = [],
		behavior: StreamingBehavior = 'steer'
	): Promise<'sent' | 'deferred' | 'failed' | 'empty'> {
		const trimmed = message.trim();
		if (!trimmed && images.length === 0) return 'empty';
		// Subito dopo uno Stop omp sta ancora chiudendo il turno: decidere ora
		// tra prompt e steer leggerebbe uno streaming che sta per finire e il
		// messaggio verrebbe spedito come steer di un turno gia' interrotto.
		if (this.isAborting) await this.waitAbortSettled();
		const answeringAsk = this.pendingUi !== null;
		// In RPC "Chat about this" non e' disponibile. La richiesta bloccante
		// va chiusa prima del messaggio, altrimenti omp resta in attesa del filo UI.
		if (answeringAsk && !(await this.cancelPendingUi())) return 'failed';
		if (answeringAsk && this.isStreaming) behavior = 'followUp';
		if (this.laneId && this.laneId !== 'main') {
			this.synthesizeLaneTitleOnFirstPrompt(trimmed);
		}
		if (trimmed && !this.entries.some((entry) => entry.kind === 'user')) {
			this.titleSessionFromFirstPrompt(trimmed);
		}
		this.todoReminder = null;
		this.blockedQuotaState = null;
		this.suggestions.invalidate();
		const enriched = await orchestratePromptPreflight(
			trimmed,
			{ images, projectPath: this.cwd },
			this.preflightDeps ?? undefined
		);
		const fullMessage = attachEditorContext(enriched, this.cwd);

		const seed = this.seededPrompt;
		const entryId = seed ? seed.id : this.nextEntryId++;
		if (seed) {
			this.seededPrompt = null;
			this.startupPhase = 'ready';
		}

		// Se OMP e' ancora in fase di avvio, accoda il messaggio e mostra subito l'entry ottimistica
		if (!this.isReady || !this.isAttached) {
			const optimistic = this.push({
				id: entryId,
				kind: 'user',
				content: fullMessage,
				images: images.map((image) => ({ data: image.data, mimeType: image.mimeType }))
			}) as UserEntry;
			this.pendingStartupPrompts.push({
				message: fullMessage,
				images,
				behavior,
				optimisticUser: optimistic
			});
			return 'deferred';
		}

		// Durante lo streaming la coda e' di omp: il messaggio entra li' con il
		// comportamento scelto e il suo chip arriva da `queue_update`. Il testo
		// del transcript resta solo a chi avvia un turno.
		const streaming = this.isStreaming;
		if (!streaming) {
			this.optimisticUser = this.push({
				id: entryId,
				kind: 'user',
				content: fullMessage,
				images: images.map((image) => ({ data: image.data, mimeType: image.mimeType }))
			}) as UserEntry;
		}
		// Un prompt a sessione ferma avvia un run, ma omp risponde gia'
		// all'ammissione, prima di `agent_start`: fino ad allora la sessione
		// risulterebbe ferma e la coda potrebbe spedire il task dopo.
		if (!streaming) this.applyRunActivity(runActivityOnPromptSent(this.runActivity, Date.now()));
		try {
			const ack = await this.client.send<{ agentInvoked?: boolean } | undefined>({
				type: 'prompt',
				message: fullMessage,
				images: images.length > 0 ? images : undefined,
				streamingBehavior: streaming ? behavior : undefined
			});
			// Comando locale (slash builtin, estensione): nessun run partira'.
			if (ack?.agentInvoked === false) this.applyRunActivity(runActivityOnPromptDropped(this.runActivity));
		} catch (error) {
			this.applyRunActivity(runActivityOnPromptDropped(this.runActivity));
			this.dropOptimisticUser();
			this.pushNotice('error', `Prompt non accettato: ${this.reason(error)}`);
			return 'failed';
		}
		if (streaming) void this.reconcile();
		return 'sent';
	}

	private async flushStartupPrompts() {
		if (this.pendingStartupPrompts.length === 0) return;
		const queue = [...this.pendingStartupPrompts];
		this.pendingStartupPrompts = [];

		for (const pending of queue) {
			if (!this.entries.some((e) => e.id === pending.optimisticUser.id)) {
				this.entries.push(pending.optimisticUser);
			}
			this.optimisticUser = pending.optimisticUser;

			const streaming = this.isStreaming;
			if (!streaming) this.applyRunActivity(runActivityOnPromptSent(this.runActivity, Date.now()));
			try {
				const ack = await this.client.send<{ agentInvoked?: boolean } | undefined>({
					type: 'prompt',
					message: pending.message,
					images: pending.images.length > 0 ? pending.images : undefined,
					streamingBehavior: streaming ? pending.behavior : undefined
				});
				if (ack?.agentInvoked === false) this.applyRunActivity(runActivityOnPromptDropped(this.runActivity));
			} catch (error) {
				this.applyRunActivity(runActivityOnPromptDropped(this.runActivity));
				this.dropOptimisticUser();
				const idx = this.entries.findIndex((e) => e.id === pending.optimisticUser.id);
				if (idx !== -1) this.entries.splice(idx, 1);
				this.pushNotice('error', `Prompt non accettato: ${this.reason(error)}`);
				this.onStartupPromptsDropped?.();
				break;
			}
		}
	}

	/** Toglie il messaggio disegnato in anticipo quando l'invio fallisce. */
	private dropOptimisticUser() {
		const pending = this.optimisticUser;
		if (!pending) return;
		this.optimisticUser = null;
		const index = this.entries.indexOf(pending);
		if (index !== -1) this.entries.splice(index, 1);
	}


	dismissBlockedQuota() {
		if (this.blockedQuotaState) {
			this.blockedQuotaState.dismissed = true;
			this.blockedQuotaState = null;
			this.agentState = this.resolveSettledState();
		}
	}

	async applyQuotaRecovery(targetSelector?: string, thinkingLevel?: string): Promise<boolean> {
		const target = targetSelector || this.blockedQuotaState?.suggestedModel?.selector;
		if (!target) return false;
		const slashIdx = target.indexOf('/');
		const provider = slashIdx >= 0 ? target.slice(0, slashIdx) : '';
		const modelId = slashIdx >= 0 ? target.slice(slashIdx + 1) : target;
		if (!modelId) return false;

		try {
			await this.client.send({
				type: 'set_model',
				provider: provider || this.model?.provider || '',
				modelId
			});
			if (thinkingLevel && thinkingLevel !== 'auto') {
				await this.client.send({
					type: 'set_thinking_level',
					level: thinkingLevel as ThinkingLevel
				});
			}
			await this.refreshState();
			const delivery = await this.prompt('/retry');
			if (delivery !== 'sent' && delivery !== 'deferred') {
				return false;
			}
			if (this.blockedQuotaState) {
				this.blockedQuotaState.dismissed = true;
			}
			return true;
		} catch (err) {
			this.pushNotice('error', messages.ui_ts_session_errore_durante_il_cambio_modello_e_ripresa_1694({ value1: this.reason(err) }));
			return false;
		}
	}

	static readonly ABORT_FALLBACK_MS = 2500;

	/** Fine dell'interruzione: annulla la rete di sicurezza e sblocca i prompt in attesa. */
	private endAborting(): void {
		this.isAborting = false;
		if (this.abortFallbackTimer !== null) {
			window.clearTimeout(this.abortFallbackTimer);
			this.abortFallbackTimer = null;
		}
		const waiters = this.abortSettledWaiters;
		this.abortSettledWaiters = [];
		for (const resolve of waiters) resolve();
	}

	/** Si risolve al primo `agent_end` dopo lo Stop o alla scadenza della rete di sicurezza. */
	private waitAbortSettled(): Promise<void> {
		if (!this.isAborting) return Promise.resolve();
		return new Promise<void>((resolve) => this.abortSettledWaiters.push(resolve));
	}

	async abort() {
		// 1. Notifica lo stato di interruzione e blocca l'accettazione di nuovi delta/messaggi
		this.isAborting = true;
		this.suggestions.invalidate();
		this.turnStartedAt = null;
		this.isCompacting = false;
		this.deltaBatcher.clear();
		this.clearStreamAsk();

		if (this.assistantEntry) {
			if (!this.assistantEntry.stopReason) {
				this.assistantEntry.stopReason = 'aborted';
			}
			this.assistantEntry = null;
		}
		this.activeAssistantId = null;

		for (const entry of this.toolEntries.values()) {
			if (entry.running) {
				entry.running = false;
				entry.endedAt = Date.now();
				if (!entry.result) {
					entry.result = {
						isError: true,
						content: [{ type: 'text', text: 'Interrotto dall\u2019utente' }]
					};
				}
			}
		}

		for (let i = 0; i < this.subagents.length; i++) {
			const sub = this.subagents[i];
			if (sub.status === 'running' || sub.status === 'pending') {
				this.subagents[i] = { ...sub, status: 'aborted' };
			}
		}

		this.clearPendingUi();
		this.pendingStartupPrompts = [];
		this.attachEventQueue = [];
		this.dropOptimisticUser();

		// Fallback di sicurezza: se il backend non risponde entro la finestra di escalation,
		// disattiva lo streaming per non lasciare l'UI bloccata. Il primo `agent_end` lo annulla.
		if (this.abortFallbackTimer !== null) window.clearTimeout(this.abortFallbackTimer);
		this.abortFallbackTimer = window.setTimeout(() => {
			this.abortFallbackTimer = null;
			if (this.isAborting) {
				this.isStreaming = false;
				if (this.settle.running) this.settle = { ...this.settle, running: false };
				this.applyRunActivity(runActivityOnPromptDropped(this.runActivity));
				this.agentState = 'idle';
				this.endAborting();
			}
		}, AgentSession.ABORT_FALLBACK_MS);

		// 2. Interruzione con recupero della coda: omp ritira l'input accodato e
		// lo restituisce, cosi' lo Stop non lo perde. Lo `abort_bash` che ferma
		// il processo figlio viaggia dentro il comando del client.
		try {
			const restored = await this.client.abortAndRestoreQueue();
			// La coda di omp e' vuota per costruzione: lo specchio locale si
			// allinea subito, senza aspettare il prossimo evento.
			this.clearQueueState();
			if (!restored) {
				void this.reconcile();
				return;
			}
			if (restored.imagesDropped || restored.truncated) {
				this.pushNotice('warning', messages.chat_v2_queue_restore_partial());
			}
			// Dal piu' vecchio: prima gli steer, poi i follow-up, come li
			// rimette l'editor della TUI.
			this.restoreQueueToComposer([...restored.steering, ...restored.followUp]);
		} catch (error) {
			console.warn('Invio comando abort:', error);
		}
	}

	/**
	 * Fase 2 dell'escalation: forza l'arresto immediato del processo e dell'albero dei figli (SIGKILL).
	 */
	async forceKill() {
		this.clearPrewalkState();
		this.endAborting();
		this.isStreaming = false;
		this.turnStartedAt = null;
		this.isCompacting = false;
		this.agentState = 'idle';
		this.suggestions.invalidate();
		this.deltaBatcher.clear();
		this.clearStreamAsk();

		if (this.assistantEntry) {
			if (!this.assistantEntry.stopReason) {
				this.assistantEntry.stopReason = 'aborted';
			}
			this.assistantEntry = null;
		}
		this.activeAssistantId = null;

		for (const entry of this.toolEntries.values()) {
			if (entry.running) {
				entry.running = false;
				entry.endedAt = Date.now();
				if (!entry.result) {
					entry.result = {
						isError: true,
						content: [{ type: 'text', text: 'Arresto forzato (SIGKILL)' }]
					};
				}
			}
		}

		for (let i = 0; i < this.subagents.length; i++) {
			const sub = this.subagents[i];
			if (sub.status === 'running' || sub.status === 'pending') {
				this.subagents[i] = { ...sub, status: 'aborted' };
			}
		}

		this.clearPendingUi();
		this.clearQueueState();
		this.pendingStartupPrompts = [];
		this.attachEventQueue = [];
		this.dropOptimisticUser();

		try {
			await this.client.forceKill();
		} catch (error) {
			console.warn('Invio comando forceKill:', error);
		}
	}

	private resetHandedOffOverlay(): void {
		const generation = this.prewalkGeneration;
		void this.writePrewalkOverlay(false, generation).catch((error) => {
			if (generation === this.prewalkGeneration) this.pushNotice('error', String(error), 'prewalk');
		});
	}

	private async settlePrewalkOverlay(): Promise<void> {
		const { promise, resolve } = Promise.withResolvers<void>();
		window.setTimeout(resolve, 400);
		await promise;
	}

	private clearPrewalkState(): void {
		this.prewalkGeneration++;
		this.prewalkConfirmation?.reject(new Error(messages.prewalk_session_changed()));
		if (this.prewalkConfirmation) window.clearTimeout(this.prewalkConfirmation.timer);
		this.prewalkConfirmation = null;
		this.prewalk = { state: 'off' };
		this.overlayEnabled = false;
		this.prewalkBusy = false;
		this.prewalkRestarting = false;
	}

	private writePrewalkOverlay(enabled: boolean, generation: number): Promise<void> {
		const write = this.prewalkOverlayWrite.catch(() => {}).then(async () => {
			if (generation !== this.prewalkGeneration) throw new Error(messages.prewalk_session_changed());
			await this.client.setPrewalk(enabled);
			if (generation !== this.prewalkGeneration) throw new Error(messages.prewalk_session_changed());
			this.overlayEnabled = enabled;
		});
		this.prewalkOverlayWrite = write;
		return write;
	}

	private async confirmPrewalk(expected: 'armed' | 'off', operation: () => Promise<void>): Promise<void> {
		const { promise: confirmation, resolve, reject } = Promise.withResolvers<void>();
		const timer = window.setTimeout(() => reject(new Error(messages.prewalk_confirmation_timeout({
			action: expected === 'armed' ? messages.prewalk_arm() : messages.prewalk_disarm()
		}))), 5_000);
		const waiter = { expected, resolve, reject, timer };
		this.prewalkConfirmation = waiter;
		// Il notice puo' precedere la risposta IPC, incluso un errore del watcher.
		void confirmation.catch(() => {});
		try {
			await operation();
			await confirmation;
		} finally {
			window.clearTimeout(timer);
			if (this.prewalkConfirmation === waiter) this.prewalkConfirmation = null;
		}
	}

	private async runPrewalk(operation: (generation: number) => Promise<void>): Promise<void> {
		if (this.labConfig || !this.client.isOpen || !this.isReady) throw new Error(messages.prewalk_unavailable());
		if (this.prewalkBusy) throw new Error(messages.prewalk_operation_busy());
		const generation = this.prewalkGeneration;
		this.prewalkBusy = true;
		try {
			await operation(generation);
		} finally {
			if (generation === this.prewalkGeneration) {
				this.prewalkBusy = false;
				this.prewalkRestarting = false;
			}
		}
	}

	async armPrewalk(): Promise<void> {
		await this.runPrewalk(async (generation) => {
			// Il watcher reagisce al cambio, non alla riscrittura dello stesso valore.
			if (this.prewalk.state === 'armed') {
				if (!this.overlayEnabled) {
					await this.writePrewalkOverlay(true, generation);
					await this.settlePrewalkOverlay();
				}
				await this.confirmPrewalk('off', () => this.writePrewalkOverlay(false, generation));
			} else if (this.overlayEnabled) {
				await this.writePrewalkOverlay(false, generation);
				await this.settlePrewalkOverlay();
			}
			await this.confirmPrewalk('armed', () => this.writePrewalkOverlay(true, generation));
		});
	}

	async disarmPrewalk(): Promise<void> {
		await this.runPrewalk(async (generation) => {
			if (this.prewalk.state === 'armed') {
				if (!this.overlayEnabled) {
					await this.writePrewalkOverlay(true, generation);
					// Gia' armato via slash: true e' un no-op senza notice. Lascia al
					// watcher un intervallo prima di false, evitando eventi accorpati.
					await this.settlePrewalkOverlay();
				}
				await this.confirmPrewalk('off', () => this.writePrewalkOverlay(false, generation));
			} else {
				await this.writePrewalkOverlay(false, generation);
				await this.settlePrewalkOverlay();
				this.prewalk = { state: 'off' };
			}
		});
	}

	async restartPrewalk(): Promise<void> {
		await this.runPrewalk(async (generation) => {
			if (this.prewalk.state === 'armed') {
				if (!this.overlayEnabled) {
					await this.writePrewalkOverlay(true, generation);
					await this.settlePrewalkOverlay();
				}
				await this.confirmPrewalk('off', () => this.writePrewalkOverlay(false, generation));
			} else {
				await this.writePrewalkOverlay(false, generation);
				await this.settlePrewalkOverlay();
			}
			this.prewalkRestarting = true;
			await this.confirmPrewalk('armed', async () => {
				await this.client.send({ type: 'prompt', message: '/prewalk restart' });
			});
			await this.refreshState();
		});
	}

	private async resetPrewalk(): Promise<void> {
		// Niente da spegnere: aspettare `ready` o scrivere l'overlay rallenterebbe
		// (o bloccherebbe) una nuova chat per un prewalk mai armato.
		if (this.prewalk.state === 'off' && !this.overlayEnabled) {
			this.clearPrewalkState();
			return;
		}
		if (!this.isReady && !(await this.waitUntilReady())) throw new Error(messages.prewalk_unavailable());
		if (!this.labConfig) await this.disarmPrewalk();
		this.clearPrewalkState();
	}

	/**
	 * Lo spegnimento del prewalk fa da contorno alla nuova chat: se fallisce
	 * si avvisa e si prosegue, perche' l'utente ha chiesto una chat nuova, non
	 * un prewalk spento.
	 */
	private async resetPrewalkForNewChat(): Promise<void> {
		try {
			await this.resetPrewalk();
		} catch (error) {
			this.clearPrewalkState();
			this.flashNotice('warning', messages.chat_v2_prewalk_reset_failed({ error: this.reason(error) }));
		}
	}

	/**
	 * Stato vivo legato al processo e alla sessione di prima: va azzerato a
	 * ogni cambio di sessione voluto (nuova chat, fork, branch), qualunque cosa
	 * contenga la sessione di arrivo.
	 */
	private resetLiveSessionState(): void {
		this.plan.onSessionReset();
		this.entries = [];
		this.clearGuidedGoal();
		this.toolEntries.clear();
		this.clearStreamAsk();
		this.assistantEntry = null;
		this.activeAssistantId = null;
		this.liveAssistantTs = undefined;
		this.activityLine = null;
		this.clearHeadsUp();
		this.optimisticUser = null;
		this.subagents = [];
		this.todoPhases = [];
		this.todoReminder = null;
		this.renderedCustomKeys.clear();
		this.clearQueueState();
		this.isStreaming = false;
		this.turnStartedAt = null;
		this.isCompacting = false;
		this.agentState = 'idle';
		this.applyRunActivity(runActivityReset(this.runActivity, Date.now()));
		this.visibleCount = RENDER_WINDOW;
		this.ompEntries.invalidate();
	}

	/** Voce del Piano nel transcript, ancorata all'ultimo messaggio di omp. */
	pushPlanEntry(variant: PlanEntry['variant'], refId: string): PlanEntry {
		let anchorTs: number | null = null;
		for (let index = this.entries.length - 1; index >= 0; index--) {
			const entry = this.entries[index];
			if ((entry.kind === 'user' || entry.kind === 'assistant') && entry.messageTs !== undefined) {
				anchorTs = entry.messageTs;
				break;
			}
			// Un'altra voce del Piano ha gia' il suo ancoraggio: si va dopo di lei.
			if (entry.kind === 'plan') {
				anchorTs = entry.anchorTs;
				break;
			}
		}
		return this.push<PlanEntry>({
			id: this.nextEntryId++,
			kind: 'plan',
			variant,
			refId,
			anchorTs,
			sessionId: this.sessionId
		});
	}

	/** Si risolve quando il turno in corso finisce (o subito, a sessione ferma). */
	waitForIdle(timeoutMs = 60_000): Promise<boolean> {
		if (!this.isStreaming) return Promise.resolve(true);
		return new Promise<boolean>((resolve) => {
			const timer = window.setTimeout(() => {
				this.idleWaiters = this.idleWaiters.filter((waiter) => waiter !== done);
				resolve(false);
			}, timeoutMs);
			const done = () => {
				window.clearTimeout(timer);
				resolve(true);
			};
			this.idleWaiters.push(done);
		});
	}

	private releaseIdleWaiters(): void {
		const waiters = this.idleWaiters;
		this.idleWaiters = [];
		for (const resolve of waiters) resolve();
	}

	/** Chiusa una richiesta interattiva del Piano, l'anello d'attenzione si spegne. */
	settleAttention(): void {
		if (this.agentState === 'attention' && !this.pendingUi) {
			this.agentState = this.isStreaming ? 'working' : 'idle';
		}
	}

	async newSession(): Promise<string | null> {
		this.expectingSessionTransition = true;
		await this.resetPrewalkForNewChat();
		this.pendingStartupPrompts = [];
		this.attachEventQueue = [];
		this.endAborting();
		this.suggestions.invalidate();
		await this.client.send({ type: 'new_session' });
		this.resetLiveSessionState();
		await this.refreshState();
		return this.sessionId;
	}

	/* ---------------------------------------------------------- diramazioni */

	/**
	 * Le diramazioni partono solo a sessione ferma: omp rifiuta comunque `fork`
	 * con `session_busy`, ma `branch` no, e un ramo preso a meta' turno
	 * perderebbe la risposta in arrivo. Le corsie Laboratorio hanno una sola
	 * chat continua (Gate R30) e non diramano.
	 */
	get canBranch(): boolean {
		return (
			!this.labConfig &&
			this.isOpen &&
			!this.isStreaming &&
			!this.isCompacting &&
			!this.branchBusy &&
			this.pendingUi === null
		);
	}

	/** Perche' una diramazione non puo' partire adesso; `null` se puo'. */
	branchBlockedReason(): string | null {
		if (this.labConfig) return messages.branch_lab_unavailable();
		if (this.branchBusy) return messages.branch_in_progress();
		if (this.isStreaming || this.isCompacting || this.pendingUi !== null) return messages.branch_busy();
		if (!this.isOpen) return messages.branch_not_ready();
		return null;
	}

	/** Allinea la copia di `get_entries` (incrementale con `since`). */
	private async syncOmpEntries(): Promise<void> {
		await this.ompEntries.sync(
			(since) => this.client.send<OmpEntriesPage>(since ? { type: 'get_entries', since } : { type: 'get_entries' }),
			this.sessionFile ?? this.sessionId
		);
	}

	private ompActivePath() {
		return activePath((id) => this.ompEntries.get(id), this.ompEntries.leafId);
	}

	/** Albero grezzo della sessione per il pannello Rami. */
	async loadBranchTree(): Promise<OmpTreeSnapshot> {
		const snapshot = await this.client.send<OmpTreeSnapshot>({ type: 'get_tree' });
		return { tree: Array.isArray(snapshot?.tree) ? snapshot.tree : [], leafId: snapshot?.leafId ?? null };
	}

	/**
	 * Esegue una diramazione e, se omp la accetta, adotta la sessione nuova:
	 * stato, transcript ricostruito dalla cronologia copiata, costi, elenco
	 * sessioni. Un rifiuto (`session_busy`, veto di un'estensione) lascia la
	 * sessione di prima intatta, transcript compreso.
	 */
	private async runBranchTransition(
		request: () => Promise<BranchOutcome>,
		success: string
	): Promise<BranchOutcome> {
		const blocked = this.branchBlockedReason();
		if (blocked) {
			this.flashNotice('warning', blocked);
			return { kind: 'busy' };
		}
		this.branchBusy = true;
		try {
			// Come la nuova chat: con l'overlay prewalk vero il cambio di sessione
			// riarmerebbe il prewalk in silenzio (DECISIONS, Prewalk).
			await this.resetPrewalkForNewChat();
			this.expectingSessionTransition = true;
			const outcome = await request();
			if (outcome.kind !== 'done') {
				this.expectingSessionTransition = false;
				if (outcome.kind === 'busy') this.flashNotice('warning', messages.branch_busy());
				else if (outcome.kind === 'cancelled') this.flashNotice('warning', messages.branch_cancelled());
				else this.flashNotice('error', messages.page_slash_cmd_fork_error({ error: outcome.message }));
				return outcome;
			}
			this.pendingStartupPrompts = [];
			this.attachEventQueue = [];
			this.endAborting();
			this.suggestions.invalidate();
			this.resetLiveSessionState();
			await this.refreshState();
			await this.rebuildTranscript();
			void this.refreshCost();
			if (typeof window !== 'undefined') {
				window.dispatchEvent(
					new CustomEvent('studio-sessions-refresh', {
						detail: { projectPath: this.cwd, sessionId: this.sessionId ?? undefined }
					})
				);
			}
			this.flashNotice('info', success);
			return outcome;
		} catch (error) {
			this.expectingSessionTransition = false;
			this.flashNotice('error', messages.page_slash_cmd_fork_error({ error: this.reason(error) }));
			return { kind: 'error', message: this.reason(error) };
		} finally {
			this.branchBusy = false;
		}
	}

	/**
	 * `/fork`: copia l'intera sessione (con gli artefatti) in una nuova e ci
	 * resta sopra. Prima del 18.x Studio mandava `new_session` con il genitore,
	 * che apriva una chat vuota.
	 */
	async forkSession(): Promise<BranchOutcome> {
		return this.runBranchTransition(
			() => requestFork((command) => this.client.send(command)),
			messages.branch_fork_done()
		);
	}

	/** Diramazione su un'entry precisa di `get_entries` (pannello Rami, menu). */
	async forkAtEntry(entryId: string, success = messages.branch_fork_point_done()): Promise<BranchOutcome> {
		return this.runBranchTransition(
			() => requestFork((command) => this.client.send(command), entryId),
			success
		);
	}

	/**
	 * Ramo che riparte da *prima* di un messaggio utente (entry omp). Si usa
	 * `fork` sul messaggio precedente, che porta con se' gli artefatti citati
	 * dai risultati tool; per il primo messaggio non c'e' nulla da copiare e si
	 * usa `branch`, che apre la sessione vuota. Con `restore` il testo (e le
	 * immagini) del messaggio tornano nel composer: «Modifica e riprova».
	 */
	async branchBeforeUserEntry(
		entryId: string,
		restore: { text: string; images: { data: string; mimeType: string }[] } | null
	): Promise<BranchOutcome> {
		try {
			await this.syncOmpEntries();
		} catch (error) {
			this.flashNotice('error', messages.page_slash_cmd_fork_error({ error: this.reason(error) }));
			return { kind: 'error', message: this.reason(error) };
		}
		const previous = previousMessageEntryId((id) => this.ompEntries.get(id), entryId);
		const send = (command: Parameters<OmpRpcClient['send']>[0]) => this.client.send(command);
		const outcome = await this.runBranchTransition(
			() => (previous ? requestFork(send, previous) : requestBranch(send, entryId)),
			restore ? messages.branch_edit_done() : messages.branch_fork_point_done()
		);
		if (outcome.kind === 'done' && restore) {
			// Il blocco del contesto editor che Studio accoda al prompt non e'
			// testo dell'utente: al nuovo invio si ricalcola sul contesto attuale.
			const parsed = splitMessageAndEditorContext(restore.text);
			const text = parsed.context ? parsed.userMessage : restore.text;
			const images = restore.images.map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType }));
			this.restoreQueueToComposer([{ text, images }]);
		}
		return outcome;
	}

	/** Entry omp del messaggio utente `transcriptId`, o avviso se non si trova. */
	private async userEntryIdFor(transcriptId: number): Promise<string | null> {
		await this.syncOmpEntries();
		const found = resolveUserEntryId(this.entries, transcriptId, this.ompActivePath());
		if (!found) this.flashNotice('warning', messages.branch_unmapped());
		return found;
	}

	/** «Dirama da qui» / «Modifica e riprova» dal menu di un messaggio utente. */
	async branchFromUserMessage(transcriptId: number, mode: 'fork' | 'edit'): Promise<BranchOutcome> {
		const blocked = this.branchBlockedReason();
		if (blocked) {
			this.flashNotice('warning', blocked);
			return { kind: 'busy' };
		}
		const entry = this.entries.find((candidate) => candidate.id === transcriptId);
		if (!entry || entry.kind !== 'user') return { kind: 'error', message: 'not-a-user-message' };
		let entryId: string | null;
		try {
			entryId = await this.userEntryIdFor(transcriptId);
		} catch (error) {
			this.flashNotice('error', messages.page_slash_cmd_fork_error({ error: this.reason(error) }));
			return { kind: 'error', message: this.reason(error) };
		}
		if (!entryId) return { kind: 'error', message: 'unmapped' };
		return this.branchBeforeUserEntry(
			entryId,
			mode === 'edit' ? { text: entry.content, images: entry.images ?? [] } : null
		);
	}

	/** «Dirama da qui» sotto una risposta: nuova sessione che finisce con questo turno. */
	async forkAfterTurn(turn: { userTranscriptId: number | null; assistantTs: number | null }): Promise<BranchOutcome> {
		const blocked = this.branchBlockedReason();
		if (blocked) {
			this.flashNotice('warning', blocked);
			return { kind: 'busy' };
		}
		let entryId: string | null;
		try {
			await this.syncOmpEntries();
			entryId = resolveTurnEndEntryId(this.entries, turn, this.ompActivePath());
		} catch (error) {
			this.flashNotice('error', messages.page_slash_cmd_fork_error({ error: this.reason(error) }));
			return { kind: 'error', message: this.reason(error) };
		}
		if (!entryId) {
			this.flashNotice('warning', messages.branch_unmapped());
			return { kind: 'error', message: 'unmapped' };
		}
		return this.forkAtEntry(entryId);
	}

	/** Compatta la cronologia e il contesto della sessione attiva. */
	async compact(customInstructions?: string): Promise<boolean> {
		if (this.isCompacting) return false;
		this.isCompacting = true;
		const entryId = this.nextEntryId++;
		const entry = this.push<CompactionEntry>({
			id: entryId,
			kind: 'compaction',
			message: messages.ui_ts_session_compattazione_del_contesto_in_corso_5036(),
			running: true
		});

		try {
			const res = await this.client.send<{
				summary?: string;
				shortSummary?: string;
				tokensBefore?: number;
				tokensAfter?: number;
				firstKeptEntryId?: string;
			}>({
				type: 'compact',
				customInstructions: customInstructions || undefined
			});

			entry.running = false;
			let msg = 'Contesto compattato';
			if (typeof res?.tokensBefore === 'number' && typeof res?.tokensAfter === 'number') {
				const saved = res.tokensBefore - res.tokensAfter;
				if (saved > 0) {
					msg = `Contesto compattato (${formatTokens(res.tokensBefore)} → ${formatTokens(res.tokensAfter)} token, -${formatTokens(saved)})`;
				} else {
					msg = `Contesto compattato (${formatTokens(res.tokensAfter)} token)`;
				}
			} else if (res?.shortSummary) {
				msg = `Contesto compattato: ${res.shortSummary}`;
			}
			entry.message = msg;
			if (res?.summary) entry.summary = res.summary;
			if (res?.shortSummary) entry.shortSummary = res.shortSummary;
			if (typeof res?.tokensBefore === 'number') entry.tokensBefore = res.tokensBefore;
			if (typeof res?.tokensAfter === 'number') entry.tokensAfter = res.tokensAfter;

			await this.rebuildTranscript();
			await this.refreshState();
			void this.refreshCost();
			this.pushNotice('info', messages.ui_ts_session_compattazione_del_contesto_completata_con_successo_fb0e(), 'studio');
			return true;
		} catch (error) {
			const idx = this.entries.findIndex((e) => e.id === entryId);
			if (idx !== -1) {
				this.entries.splice(idx, 1);
			}
			const errStr = error instanceof Error ? error.message : String(error);
			if (errStr.includes('Nothing to compact') || errStr.includes('session too small') || errStr.includes('no messages')) {
				this.pushNotice('info', messages.ui_ts_session_nessun_contenuto_da_compattare_la_sessione_e_322e(), 'studio');
			} else {
				this.pushNotice('error', `Compattazione non riuscita: ${this.reason(error)}`, 'studio');
			}
			return false;
		} finally {
			this.isCompacting = false;
			if (!this.isStreaming) {
				this.agentState = this.pendingUi ? 'attention' : 'idle';
			}
		}
	}

	/** Esegue l'handoff della sessione, avviandone una nuova con il riassunto della precedente. */
	async handoff(customInstructions?: string): Promise<boolean> {
		if (this.isCompacting) return false;
		this.isCompacting = true;
		this.pushNotice('info', messages.ui_ts_session_passaggio_delle_consegne_handoff_in_corso_bce8(), 'studio');

		this.expectingSessionTransition = true;
		try {
			await this.client.send({
				type: 'handoff',
				customInstructions: customInstructions || undefined
			});

			this.entries = [];
			this.toolEntries.clear();
			this.clearStreamAsk();
			this.assistantEntry = null;
			this.activeAssistantId = null;
			this.activityLine = null;
			this.clearHeadsUp();
			this.optimisticUser = null;
			this.subagents = [];
			this.todoPhases = [];
			this.todoReminder = null;
			this.renderedCustomKeys.clear();
			this.clearQueueState();
			this.visibleCount = RENDER_WINDOW;

			await this.rebuildTranscript();
			await this.refreshState();
			void this.refreshCost();
			this.pushNotice('info', messages.ui_ts_session_handoff_completato_nuova_sessione_avviata_con_il_e2ff(), 'studio');
			return true;
		} catch (error) {
			const errStr = error instanceof Error ? error.message : String(error);
			if (errStr.includes('Nothing to hand off') || errStr.includes('no messages')) {
				this.pushNotice('info', messages.ui_ts_session_nessun_contenuto_per_l_handoff_la_sessione_129e(), 'studio');
			} else {
				this.pushNotice('error', `Handoff non riuscito: ${this.reason(error)}`, 'studio');
			}
			return false;
		} finally {
			this.isCompacting = false;
			if (!this.isStreaming) {
				this.agentState = this.pendingUi ? 'attention' : 'idle';
			}
		}
	}

	/** Provider OAuth disponibili per il login, con stato di autenticazione corrente. */
	async getLoginProviders(): Promise<LoginProviderInfo[]> {
		try {
			return await this.client.getLoginProviders();
		} catch (error) {
			this.pushNotice('error', `Impossibile recuperare i provider di login: ${this.reason(error)}`, 'studio');
			return [];
		}
	}

	/**
	 * Avvia il login OAuth per un provider sulla sessione RPC attiva. L'URL di
	 * autenticazione arriva come `open_url` extension_ui_request, gestita dal
	 * normale canale di richieste UI (apertura automatica se l'origine e'
	 * consentita).
	 */
	async login(providerId: string): Promise<boolean> {
		try {
			await this.client.login(providerId);
			this.pushNotice('info', messages.ui_ts_session_login_completato_per_il_provider_value1_796e({ value1: providerId }), 'studio');
			await this.refreshState();
			return true;
		} catch (error) {
			this.pushNotice('error', `Login non riuscito per "${providerId}": ${this.reason(error)}`, 'studio');
			return false;
		}
	}

	/** Riallinea i chip locali al conteggio autorevole del server. */
	private async reconcile() {
		if (this.stateRefresh) return;
		this.stateRefresh = (async () => {
			try {
				await this.refreshState();
			} catch {
				// Un get_state perso non e' un errore da mostrare: il prossimo
				// evento ne provoca un altro.
			} finally {
				this.stateRefresh = null;
			}
		})();
		await this.stateRefresh;
	}

	pushNotice(level: 'info' | 'warning' | 'error', message: string, source?: string, offerTerminal = false) {
		this.push({ id: this.nextEntryId++, kind: 'notice', level, message, source, offerTerminal });
	}

	/** Esito di un comando di Studio: sostituisce quello precedente sopra il composer. */
	flashNotice(level: ComposerNotice['level'], message: string) {
		this.composerNotice = { id: ++this.composerNoticeSeq, level, message };
	}

	/** Chiude l'esito indicato, oppure quello corrente se `id` manca. */
	dismissComposerNotice(id?: number) {
		if (id === undefined || this.composerNotice?.id === id) this.composerNotice = null;
	}

	/** Imposta la modalita veloce (fast mode) su omp. */
	async setFastMode(enabled: boolean): Promise<boolean> {
		try {
			const res = await this.client.send<FastModeResult>({ type: 'set_fast_mode', enabled });
			if (res) {
				this.fastModeEnabled = Boolean(res.enabled);
				this.fastModeActive = Boolean(res.active);
			}
			void this.refreshState();
			return true;
		} catch (error) {
			this.flashNotice('error', this.reason(error));
			return false;
		}
	}

	/** Imposta la modalita lenta (slow mode) su omp. */
	async setSlowMode(enabled: boolean): Promise<boolean> {
		try {
			const res = await this.client.send<{ enabled: boolean }>({ type: 'set_slow_mode', enabled });
			if (res && typeof res.enabled === 'boolean') {
				this.slowModeEnabled = res.enabled;
			}
			void this.refreshState();
			return true;
		} catch (error) {
			this.flashNotice('error', this.reason(error));
			return false;
		}
	}

	/** Esegue un'operazione sul goal corrente (pause, resume, drop). */
	async setGoalOp(op: 'pause' | 'resume' | 'drop'): Promise<boolean> {
		try {
			const res = await this.client.send<GoalResult>({ type: 'goal', op });
			if (res) {
				if (res.state !== undefined) {
					this.goal = res.state;
				} else if (res.goal !== undefined) {
					this.goal = res.goal
						? {
								enabled: res.goal.status === 'active',
								mode: res.goal.status === 'dropped' ? 'exiting' : 'active',
								goal: res.goal
							}
						: null;
				}
				this.syncGoalTracking();
			}
			void this.refreshState();
			return true;
		} catch (error) {
			this.flashNotice('error', this.reason(error));
			return false;
		}
	}

	pauseGoal(): Promise<boolean> {
		return this.setGoalOp('pause');
	}

	resumeGoal(): Promise<boolean> {
		return this.setGoalOp('resume');
	}

	dropGoal(): Promise<boolean> {
		return this.setGoalOp('drop');
	}

	// -----------------------------------------------------------------------
	// Obiettivo guidato (`/guided-goal`) e tentativi dell'obiettivo
	// -----------------------------------------------------------------------

	/**
	 * La sessione e' impegnata dall'obiettivo: attivo (omp prosegue da solo fra
	 * un turno e l'altro, quindi `isStreaming` falso non vuol dire libera) o in
	 * definizione (l'intervista occupa il composer). La coda non deve partire.
	 */
	get goalHoldsSession(): boolean {
		if (this.goal?.goal.status === 'active') return true;
		const phase = this.guidedGoal?.phase;
		return phase === 'idea' || phase === 'asking' || phase === 'draft' || phase === 'starting';
	}

	/** L'estensione `studio-goal` e' caricata: l'agente puo' proporre le risposte. */
	get goalSuggestionsAvailable(): boolean {
		return this.availableCommands.some((command) => command.name === STUDIO_GOAL_COMMAND);
	}

	/** Intervista ancora da concludere (domande o bozza da avviare). */
	get guidedGoalOpen(): boolean {
		const phase = this.guidedGoal?.phase;
		return phase === 'idea' || phase === 'asking' || phase === 'draft' || phase === 'starting';
	}

	private pushGuided(part: GuidedGoalEntry['part'], text: string, field?: GoalFieldKey): GuidedGoalEntry | null {
		const interview = this.guidedGoal;
		if (!interview) return null;
		return this.push<GuidedGoalEntry>({
			id: this.nextEntryId++,
			kind: 'guided-goal',
			part,
			interviewId: interview.id,
			text,
			field
		});
	}

	/** Mette nel transcript la domanda corrente (testo dell'agente se c'e'). */
	private askCurrentGuidedQuestion(intro = false): void {
		const interview = this.guidedGoal;
		if (!interview) return;
		if (interview.phase === 'idea') {
			this.pushGuided('question', messages.guided_goal_q_idea());
			return;
		}
		const question = currentQuestion(interview);
		if (!question) return;
		const text = intro ? `${messages.guided_goal_intro()} ${question.question}` : question.question;
		this.pushGuided('question', text, question.field);
	}

	/**
	 * Avvia l'intervista. Rifiutata con un obiettivo gia' presente (omp ne tiene
	 * uno per sessione) e in Laboratorio; un'intervista aperta resta quella.
	 */
	startGuidedGoal(idea: string): boolean {
		if (this.labConfig) {
			this.flashNotice('info', messages.guided_goal_lab_unavailable());
			return false;
		}
		if (this.goal && (this.goal.goal.status === 'active' || this.goal.goal.status === 'paused' || this.goal.goal.status === 'budget-limited')) {
			this.flashNotice('warning', messages.guided_goal_already_active());
			return false;
		}
		if (this.guidedGoalOpen) {
			this.flashNotice('info', messages.guided_goal_already_open());
			return false;
		}
		const id = `gg-${Date.now().toString(36)}-${++this.guidedGoalSeq}`;
		this.guidedGoal = startInterview(id, idea);
		this.pushGuided('command', idea.trim());
		this.askCurrentGuidedQuestion(true);
		this.requestGoalSuggestions();
		return true;
	}

	/** Proposte dell'agente con un turno a margine dell'estensione (facoltativo). */
	private requestGoalSuggestions(): void {
		const interview = this.guidedGoal;
		if (!interview || !this.goalSuggestionsAvailable || !this.isReady || this.exited) return;
		if (interview.phase !== 'asking') return; // senza idea non c'e' niente da proporre
		this.guidedGoal = { ...interview, agent: 'pending' };
		const command = suggestCommand(interview.id, interview.idea, getLocale());
		this.client.send({ type: 'prompt', message: command }).catch(() => {
			if (this.guidedGoal?.id === interview.id) this.guidedGoal = { ...this.guidedGoal, agent: 'failed' };
		});
		if (this.guidedGoalTimer) clearTimeout(this.guidedGoalTimer);
		// Il turno a margine puo' non arrivare mai (estensione vecchia, provider lento):
		// dopo un minuto l'intervista resta con le proposte fisse, senza attese.
		this.guidedGoalTimer = setTimeout(() => {
			this.guidedGoalTimer = null;
			if (this.guidedGoal?.id === interview.id && this.guidedGoal.agent === 'pending') {
				this.guidedGoal = { ...this.guidedGoal, agent: 'failed' };
			}
		}, 60_000);
	}

	private applyStudioGoalStatus(text: string | undefined): void {
		const status = parseStudioGoalStatus(text);
		const interview = this.guidedGoal;
		if (!status || !interview || status.requestId !== interview.id) return;
		if (this.guidedGoalTimer) {
			clearTimeout(this.guidedGoalTimer);
			this.guidedGoalTimer = null;
		}
		if (status.type === 'error') {
			this.guidedGoal = { ...interview, agent: 'failed' };
			return;
		}
		const merged = mergeAgentSuggestions(interview, status.suggestions);
		this.guidedGoal = merged;
		// La domanda corrente nel transcript prende il testo dell'agente.
		const question = currentQuestion(merged);
		if (question?.fromAgent) {
			for (let index = this.entries.length - 1; index >= 0; index--) {
				const entry = this.entries[index];
				if (entry.kind === 'guided-goal' && entry.interviewId === merged.id && entry.part === 'question') {
					if (entry.field === question.field) {
						const intro = merged.step === 0 ? `${messages.guided_goal_intro()} ` : '';
						entry.text = `${intro}${question.question}`;
					}
					break;
				}
			}
		}
	}

	/**
	 * Risposta alla domanda corrente: un'opzione proposta (`value`) o testo
	 * libero. Il testo libero che non si lascia interpretare resta comunque la
	 * risposta: la bozza segnala cosa manca prima dell'avvio.
	 */
	answerGuidedGoal(answer: GoalAnswerValue | string): void {
		let interview = this.guidedGoal;
		if (!interview) return;
		if (interview.phase === 'idea') {
			if (typeof answer !== 'string' || !answer.trim()) return;
			interview = setIdea(interview, answer);
			this.guidedGoal = interview;
			this.pushGuided('answer', answer.trim());
			this.askCurrentGuidedQuestion(true);
			this.requestGoalSuggestions();
			return;
		}
		const question = currentQuestion(interview);
		if (!question) return;
		let value: GoalAnswerValue | null;
		let shown: string;
		if (typeof answer === 'string') {
			const text = answer.trim();
			if (!text) return;
			value = parseFreeAnswer(question.field, text);
			shown = text;
		} else {
			value = answer;
			shown = describeAnswer(answer);
		}
		this.pushGuided('answer', shown, question.field);
		if (!value) {
			// Niente da ricavare (per esempio un tetto senza numeri): resta da sistemare nella bozza.
			this.guidedGoal = { ...skipCurrent(interview), answers: { ...interview.answers, [question.field]: shown } };
		} else {
			this.guidedGoal = answerCurrent(interview, value);
		}
		this.afterGuidedAnswer();
	}

	skipGuidedGoalQuestion(): void {
		const interview = this.guidedGoal;
		if (!interview || interview.phase !== 'asking') return;
		const question = currentQuestion(interview);
		this.pushGuided('answer', messages.guided_goal_skipped(), question?.field);
		this.guidedGoal = skipCurrent(interview);
		this.afterGuidedAnswer();
	}

	private afterGuidedAnswer(): void {
		const interview = this.guidedGoal;
		if (!interview) return;
		if (interview.phase === 'asking') {
			this.askCurrentGuidedQuestion();
			return;
		}
		if (interview.phase === 'draft') {
			this.pushGuided('question', messages.guided_goal_draft_intro());
			this.pushGuided('draft', '');
		}
	}

	/**
	 * La ricostruzione del transcript da omp non conosce l'intervista (vive solo
	 * in Studio): se e' ancora aperta, la domanda corrente o la bozza tornano in
	 * coda, altrimenti la bozza da avviare sparirebbe.
	 */
	private restoreGuidedGoalEntries(): void {
		const interview = this.guidedGoal;
		if (!interview || !this.guidedGoalOpen) return;
		if (interview.phase === 'draft' || interview.phase === 'starting') {
			this.pushGuided('question', messages.guided_goal_draft_intro());
			this.pushGuided('draft', '');
		} else {
			this.askCurrentGuidedQuestion();
		}
	}

	/** Correzioni fatte nella card della bozza. */
	updateGuidedGoalDraft(draft: GoalDraft): void {
		const interview = this.guidedGoal;
		if (!interview || interview.phase !== 'draft') return;
		this.guidedGoal = { ...interview, draft };
	}

	cancelGuidedGoal(): void {
		const interview = this.guidedGoal;
		if (!interview || !this.guidedGoalOpen || interview.phase === 'starting') return;
		this.pushGuided('note', messages.guided_goal_cancelled());
		this.guidedGoal = { ...interview, phase: 'cancelled' };
		if (this.guidedGoalTimer) {
			clearTimeout(this.guidedGoalTimer);
			this.guidedGoalTimer = null;
		}
	}

	private clearGuidedGoal(): void {
		if (this.guidedGoalTimer) clearTimeout(this.guidedGoalTimer);
		this.guidedGoalTimer = null;
		this.guidedGoal = null;
	}

	/** «Avvia»: crea l'obiettivo su omp solo se i controlli bloccanti sono passati. */
	async launchGuidedGoal(): Promise<boolean> {
		const interview = this.guidedGoal;
		if (!interview || interview.phase !== 'draft' || !canLaunch(interview.draft)) return false;
		this.guidedGoal = { ...interview, phase: 'starting' };
		const draft = interview.draft;
		const created = await this.createGoal(goalMarkdown(draft), draft.tokenBudget ?? undefined, draft.attempts);
		const current = this.guidedGoal;
		if (!current || current.id !== interview.id) return created;
		if (!created) {
			this.guidedGoal = { ...current, phase: 'draft' };
			return false;
		}
		this.guidedGoal = { ...current, phase: 'started' };
		this.pushGuided('started', draft.objective);
		return true;
	}

	/**
	 * `goal create` su omp. L'obiettivo prosegue da solo fra un turno e l'altro
	 * perche' l'overlay di Studio abilita `goal.continuationModes: rpc`.
	 */
	async createGoal(objective: string, tokenBudget?: number, attemptCap?: number | null): Promise<boolean> {
		const text = objective.trim();
		if (!text) return false;
		try {
			const res = await this.client.send<GoalResult>({
				type: 'goal',
				op: 'create',
				objective: text,
				token_budget: tokenBudget && tokenBudget > 0 ? Math.round(tokenBudget) : undefined
			});
			if (res?.state !== undefined) this.goal = res.state;
			this.syncGoalTracking();
			if (attemptCap !== undefined) this.goalAttemptCap = attemptCap ?? null;
			void this.refreshState();
			return true;
		} catch (error) {
			this.flashNotice('error', messages.guided_goal_create_failed({ error: this.reason(error) }));
			return false;
		}
	}

	/** Nuovo obiettivo (o nessuno): i tentativi ripartono da zero, il tetto si rilegge dal testo. */
	private syncGoalTracking(): void {
		const goal = this.goal?.goal ?? null;
		const id = goal?.id ?? null;
		if (id === this.goalTrackedId) return;
		this.goalTrackedId = id;
		this.goalAttempts = 0;
		this.goalAttemptOpen = false;
		this.goalAttemptCap = goal ? parseAttemptCap(goal.objective) : null;
	}

	/** Un tentativo e' un giro dell'agente con l'obiettivo attivo. */
	private noteGoalAttemptStart(): void {
		if (this.goal?.goal.status !== 'active' || this.goalAttemptOpen) return;
		this.goalAttemptOpen = true;
		this.goalAttempts += 1;
	}

	/**
	 * Fine del giro: al tetto di tentativi l'obiettivo va in pausa, perche' omp
	 * conosce solo il budget di token e altrimenti continuerebbe.
	 */
	private noteGoalAttemptEnd(aborted: boolean): void {
		if (!this.goalAttemptOpen) return;
		this.goalAttemptOpen = false;
		if (aborted) return;
		if (shouldPauseForCap(this.goalAttempts, this.goalAttemptCap, this.goal?.goal.status)) {
			void this.pauseGoal().then((paused) => {
				if (paused) {
					this.pushNotice('info', messages.goal_banner_cap_reached({ count: this.goalAttempts }), 'studio');
				}
			});
		}
	}

	/**
	 * Interrompe l'esecuzione di un singolo subagente senza abortire la sessione principale.
	 */
	async cancelSubagent(subagentId: string): Promise<boolean> {
		try {
			const res = await this.client.send<CancelSubagentResult>({
				type: 'cancel_subagent',
				subagentId
			});
			if (res && res.cancelled === false) {
				this.pushNotice('info', messages.subagent_notice_already_stopped({ id: subagentId }), 'subagent');
				return false;
			}
			return true;
		} catch (error) {
			this.pushNotice('error', messages.subagent_notice_cancel_failed({ id: subagentId, error: this.reason(error) }), 'subagent');
			return false;
		}
	}

	/**
	 * Invia un messaggio di steering a un subagente in esecuzione.
	 */
	async steerSubagent(subagentId: string, message: string): Promise<boolean> {
		try {
			await this.client.send({
				type: 'steer_subagent',
				subagentId,
				message
			});
			return true;
		} catch (error) {
			this.pushNotice('error', messages.subagent_notice_steer_failed({ id: subagentId, error: this.reason(error) }), 'subagent');
			return false;
		}
	}

	/**
	 * Legge via IPC il costo totale sostenuto dai subagenti scansionando i transcript su disco.
	 */
	async refreshSubagentCost() {
		const file = this.sessionFile;
		if (!file) return;
		try {
			const cost = await invoke<number>('session_subagent_cost', { sessionFile: file });
			if (typeof cost === 'number' && Number.isFinite(cost)) {
				this.subagentCost = cost;
			}
		} catch (error) {
			console.warn('Errore lettura costo subagenti:', error);
		}
	}

	/**
	 * Restituisce l'istanza **dentro** l'array reattivo, non quella passata:
	 * `$state` avvolge in un proxy cio' che entra nell'array, e mutare
	 * l'oggetto originale non emette alcun segnale. Chi deve aggiornare una
	 * entry piu' tardi (streaming, risultato di un tool) tiene questa.
	 */
	private push<T extends TranscriptEntry>(entry: T): T {
		this.entries.push(entry);
		return this.entries[this.entries.length - 1] as T;
	}

	/**
	 * Accoda una tessera di atterraggio corsia (Lane Landing) nel transcript.
	 */
	pushLaneLanding(landingId: string): LaneLandingEntry {
		return this.push<LaneLandingEntry>({
			id: this.nextEntryId++,
			kind: 'lane-landing',
			landingId
		});
	}

	private lastOfKind(kind: 'compaction'): CompactionEntry | null {
		for (let index = this.entries.length - 1; index >= 0; index--) {
			const entry = this.entries[index];
			if (entry.kind === kind) return entry;
		}
		return null;
	}

	private reason(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
}
