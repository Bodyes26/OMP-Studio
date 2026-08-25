// Mirror scritti a mano dei soli campi del protocollo RPC che Studio consuma.
//
// Perche' a mano e non generati dal repo di `omp`: generarli vincolerebbe
// Studio a una versione precisa del CLI, e il contratto qui e' esplicitamente
// tollerante — ogni campo opzionale e' un campo che una versione diversa puo'
// non mandare. La forma di `details` per tool e' documentata in
// `ricerca/TOOL-DETAILS.md`, rilevata sul filo e non dedotta.

/* ---------------------------------------------------------------- comandi */

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type StreamingBehavior = 'steer' | 'followUp';
export type QueueMode = 'all' | 'one-at-a-time';
export type InterruptMode = 'immediate' | 'wait';
export type SubagentSubscription = 'off' | 'progress' | 'events';

/** Immagine sul filo: `data` e' base64 **nudo**, non un data-URL. */
export interface ImageContent {
	type: 'image';
	data: string;
	mimeType: string;
	detail?: 'low' | 'high' | 'auto';
}

/** Sottoinsieme di `RpcCommand` usato da Studio. */
export type RpcCommand =
	| { type: 'prompt'; message: string; images?: ImageContent[]; streamingBehavior?: StreamingBehavior }
	| { type: 'abort' }
	| { type: 'new_session'; parentSession?: string }
	| { type: 'get_state' }
	| { type: 'get_available_commands' }
	| { type: 'get_messages_page'; cursor?: string; limit?: number }
	| { type: 'get_session_stats' }
	| { type: 'get_available_models' }
	| { type: 'set_model'; provider: string; modelId: string }
	| { type: 'cycle_model' }
	| { type: 'set_thinking_level'; level: ThinkingLevel }
	| { type: 'set_steering_mode'; mode: QueueMode }
	| { type: 'set_follow_up_mode'; mode: QueueMode }
	| { type: 'set_interrupt_mode'; mode: InterruptMode }
	| { type: 'set_subagent_subscription'; level: SubagentSubscription }
	| { type: 'get_subagents' }
	| { type: 'get_subagent_messages'; subagentId?: string; sessionFile?: string; fromByte?: number }
	| { type: 'compact'; customInstructions?: string }
	| { type: 'handoff'; customInstructions?: string }
	| { type: 'set_session_name'; name: string }
	| { type: 'bash'; command: string }
	| { type: 'abort_bash' };

/** Risposta a un comando: `code` e' presente sui fallimenti tipizzati. */
export interface RpcResponse {
	id?: string;
	type: 'response';
	command: string;
	success: boolean;
	data?: unknown;
	error?: string;
	code?: string;
}

/* ------------------------------------------------------------------ stato */

export interface ModelInfo {
	id?: string;
	name?: string;
	provider?: string;
	contextWindow?: number;
}

export interface ContextUsage {
	tokens?: number;
	contextWindow?: number;
	/** Scala 0-100, non 0-1. */
	percent?: number;
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';

export interface TodoItem {
	id?: string;
	content: string;
	status: TodoStatus;
	blocker?: string;
}

export interface TodoPhase {
	id?: string;
	name: string;
	tasks: TodoItem[];
}

export interface RpcSessionState {
	model?: ModelInfo;
	thinkingLevel?: ThinkingLevel;
	isStreaming?: boolean;
	isCompacting?: boolean;
	steeringMode?: QueueMode;
	followUpMode?: QueueMode;
	interruptMode?: InterruptMode;
	sessionFile?: string;
	sessionId?: string;
	sessionName?: string;
	messageCount?: number;
	queuedMessageCount?: number;
	todoPhases?: TodoPhase[];
	contextUsage?: ContextUsage;
	autoCompactionEnabled?: boolean;
}

export interface AvailableCommand {
	name: string;
	description?: string;
	aliases?: string[];
	source?: string;
	input?: { hint?: string };
	subcommands?: { name: string; description?: string }[];
}

/* --------------------------------------------------------------- messaggi */

export interface UsageCost {
	total?: number;
}

export interface MessageUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: UsageCost;
}

/**
 * Blocco di contenuto. Tipo di confine deliberatamente permissivo: ogni
 * campo e' opzionale perche' quale campo esista dipende da `type`, e una
 * unione discriminata qui costringerebbe a un cast per ogni lettura di un
 * campo che una versione diversa di omp potrebbe non mandare.
 *
 * `type` osservati: `text`, `thinking`, `image`, `toolCall`, `toolResult`.
 */
export interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	thinkingSignature?: string;
	/** `image`: base64 nudo. */
	data?: string;
	mimeType?: string;
	/** `toolCall` */
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
	intent?: string;
	/** `toolResult` */
	toolCallId?: string;
	content?: ContentBlock[];
	details?: unknown;
	isError?: boolean;
}

export interface AgentMessage {
	role: 'user' | 'assistant' | 'toolResult' | 'developer' | 'custom' | string;
	/** I messaggi `custom` portano una stringa, non blocchi. */
	content?: ContentBlock[] | string;
	model?: string;
	usage?: MessageUsage;
	stopReason?: string;
	timestamp?: number;
	attribution?: string;
	/** Presente sui messaggi `toolResult`: identifica la card da riempire. */
	toolCallId?: string;
	toolName?: string;
	details?: unknown;
	isError?: boolean;
	synthetic?: boolean;
	steering?: boolean;
}

/**
 * Statistiche di sessione, verificate su omp 17.2.1: `cost` e' un numero al
 * primo livello. Le chiavi restano opzionali perche' cambiano per versione e
 * il chip del costo non e' un invariante.
 */
export interface SessionStats {
	sessionId?: string;
	sessionFile?: string;
	totalMessages?: number;
	userMessages?: number;
	assistantMessages?: number;
	toolCalls?: number;
	toolResults?: number;
	premiumRequests?: number;
	tokens?: Record<string, number>;
	contextUsage?: ContextUsage;
	totalCost?: number;
	cost?: number | UsageCost;
	usage?: MessageUsage;
}

export interface AgentToolResult {
	content?: ContentBlock[];
	details?: unknown;
	isError?: boolean;
}

/* ------------------------------------------------------------------ eventi */

export interface AssistantMessageEvent {
	type: string;
	contentIndex?: number;
	/** Presente sui frame `*_end`: e' il testo autorevole del blocco. */
	content?: string;
	/** Presente su `image_end`: il tipo reale, non sempre PNG. */
	mimeType?: string;
	toolCall?: { id: string; name: string; arguments?: Record<string, unknown> };
}

export interface AgentProgress {
	index?: number;
	id?: string;
	agent?: string;
	agentSource?: string;
	modelRole?: string;
	resolvedModel?: string;
	status?: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
	task?: string;
	assignment?: string;
	description?: string;
	lastIntent?: string;
	recentTools?: { tool?: string; args?: string; endMs?: number }[];
	recentOutput?: string[];
	toolCount?: number;
	requests?: number;
	tokens?: number;
	cost?: number;
	durationMs?: number;
	/** Radice del payload, non di `progress`: serve al cassetto per leggere. */
	sessionFile?: string;
	parentToolCallId?: string;
}

export interface SubagentLifecyclePayload {
	id?: string;
	agent?: string;
	agentSource?: string;
	parentToolCallId?: string;
	detached?: boolean;
	description?: string;
	status?: string;
	sessionFile?: string;
	index?: number;
}

export interface SubagentProgressPayload extends SubagentLifecyclePayload {
	task?: string;
	assignment?: string;
	progress?: AgentProgress;
}

/**
 * Frame in uscita da `omp`, piu' i due coniati dal trasporto di Studio.
 * Volutamente aperto: una versione di `omp` che aggiunge un frame non deve
 * rompere il client, e il riduttore ignora quello che non conosce.
 */
export interface AgentSessionEvent {
	type: string;
	/** `message_update` */
	assistantMessageEvent?: AssistantMessageEvent;
	/**
	 * `message_*` e `turn_end` portano un `AgentMessage`; `notice`,
	 * `irc_message` e `command_output` portano una stringa sulla stessa
	 * chiave. Il riduttore restringe caso per caso invece di fidarsi.
	 */
	message?: AgentMessage | string;
	messages?: AgentMessage[];
	/** `agent_end`: terminale quando `!== false`. */
	isTerminal?: boolean;
	/** `tool_execution_*` */
	toolCallId?: string;
	toolName?: string;
	args?: Record<string, unknown>;
	intent?: string;
	result?: AgentToolResult;
	partialResult?: AgentToolResult;
	/** `notice` */
	level?: string;
	source?: string;
	/** `todo_reminder` */
	todos?: TodoItem[];
	/** `model_changed`, `thinking_level_changed` */
	model?: ModelInfo | string;
	thinkingLevel?: ThinkingLevel;
	/** `subagent_*` */
	payload?: SubagentProgressPayload;
	/** `available_commands_update` */
	commands?: AvailableCommand[];
	[key: string]: unknown;
}

/* --------------------------------------------------------- UI estensioni */

export type ExtensionUiMethod =
	| 'select'
	| 'confirm'
	| 'input'
	| 'editor'
	| 'cancel'
	| 'notify'
	| 'setStatus'
	| 'setWidget'
	| 'setTitle'
	| 'set_editor_text'
	| 'open_url';

export interface ExtensionUiRequest {
	type: 'extension_ui_request';
	id: string;
	method: ExtensionUiMethod;
	title?: string;
	message?: string;
	options?: string[];
	optionDetails?: { description?: string }[];
	placeholder?: string;
	prefill?: string;
	timeout?: number;
	/** `cancel`: chiude la richiesta indicata senza risposta. */
	targetId?: string;
	/** `open_url` */
	url?: string;
	launchUrl?: string;
	widgetKey?: string;
	content?: unknown;
	level?: string;
}

export type ExtensionUiResponse =
	| { type: 'extension_ui_response'; id: string; value: string }
	| { type: 'extension_ui_response'; id: string; confirmed: boolean }
	| { type: 'extension_ui_response'; id: string; cancelled: true; timedOut?: boolean };

/** I soli metodi che vogliono una risposta: `setWidget` & co. arrivano da soli. */
export const ANSWERABLE_UI_METHODS: Record<string, true> = {
	select: true,
	confirm: true,
	input: true,
	editor: true
};

/* ------------------------------------------------------- frame di Studio */

/**
 * Delta coniato dal trasporto: sostituisce i `message_update` di streaming,
 * che porterebbero il messaggio intero a ogni token.
 */
export interface StudioDeltaFrame {
	type: 'studio_delta';
	kind: 'text' | 'thinking' | 'toolcall';
	contentIndex: number;
	delta: string;
}

/** Morte del processo, con le ultime righe di stderr come causa. */
export interface StudioExitFrame {
	type: 'studio_exit';
	code: number | null;
	stderr: string[];
}

/** Errore del trasporto stesso (sequenza di chunk rotta, frame illeggibile). */
export interface StudioErrorFrame {
	type: 'studio_error';
	message: string;
}

