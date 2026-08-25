import { attachEditorContext } from '$lib/editor/editorContext';
// Stato della superficie GUI: un'istanza per progetto.
//
// Il riduttore e' esplicito e volutamente noioso: ogni frame del protocollo
// ha una riga qui, e i frame sconosciuti cadono. La forma delle entry e' di
// Studio, non di omp: e' quello che permette a replay e diretta di passare
// dallo stesso rendering (`ricerca/TOOL-DETAILS.md`).

import { openUrl } from '@tauri-apps/plugin-opener';
import { OmpRpcClient } from './client';
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
	type MessageUsage,
	type ModelInfo,
	type RpcSessionState,
	type SessionStats,
	type StreamingBehavior,
	type ThinkingLevel,
	type TodoPhase
} from './wire';

/** Stato dell'agente per la barra dei progetti: stessa semantica del PTY. */
export type AgentSurfaceState = 'idle' | 'working' | 'attention' | 'unknown';

export type Block =
	| { type: 'text'; text: string }
	| { type: 'thinking'; text: string }
	| { type: 'image'; data: string; mimeType: string };

export interface UserEntry {
	id: number;
	kind: 'user';
	content: string;
	images: { data: string; mimeType: string }[];
	attribution?: string;
}

export interface AssistantEntry {
	id: number;
	kind: 'assistant';
	blocks: Block[];
	usage?: MessageUsage;
	model?: string;
	stopReason?: string;
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
}

export interface CompactionEntry {
	id: number;
	kind: 'compaction';
	message: string;
	running: boolean;
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

export type TranscriptEntry =
	| UserEntry
	| AssistantEntry
	| ToolEntry
	| NoticeEntry
	| CompactionEntry
	| RetryEntry
	| TtsrEntry;

export interface QueuedMessage {
	id: number;
	text: string;
	behavior: StreamingBehavior;
}

export interface PendingAsk {
	kind: 'ask';
	requestId: string;
	method: 'select' | 'confirm' | 'input' | 'editor';
	title: string;
	message?: string;
	options: string[];
	optionDetails: { description?: string }[];
	placeholder?: string;
	prefill?: string;
	/** Scadenza assoluta in ms; oltre, omp risolve da se' al default. */
	deadline?: number;
}

export type PendingUiRequest = PendingAsk;

/** Numero massimo di entry renderizzate: oltre, si scopre a blocchi. */
const RENDER_WINDOW = 300;

/** Tentativi di ricostruzione del transcript prima di arrendersi. */
const REBUILD_ATTEMPTS = 3;

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

export class AgentSession {
	readonly client = new OmpRpcClient();

	entries = $state<TranscriptEntry[]>([]);
	visibleCount = $state(RENDER_WINDOW);

	isStreaming = $state(false);
	isCompacting = $state(false);
	isReady = $state(false);
	isAttached = $state(false);
	activeAssistantId = $state<number | null>(null);

	model = $state<ModelInfo | null>(null);
	thinkingLevel = $state<ThinkingLevel | null>(null);
	contextUsage = $state<ContextUsage | null>(null);
	sessionId = $state<string | null>(null);
	sessionFile = $state<string | null>(null);
	sessionName = $state<string | null>(null);
	queuedMessageCount = $state(0);
	sessionCost = $state<number | null>(null);

	todoPhases = $state<TodoPhase[]>([]);
	subagents = $state<AgentProgress[]>([]);
	availableCommands = $state<AvailableCommand[]>([]);
	queued = $state<QueuedMessage[]>([]);
	pendingUi = $state<PendingUiRequest | null>(null);
	statusText = $state<string | null>(null);
	exited = $state(false);

	/** Stato per la tessera di progetto: derivato, non inventato. */
	agentState = $state<AgentSurfaceState>('unknown');

	private nextEntryId = 1;
	private nextQueueId = 1;
	private assistantEntry: AssistantEntry | null = null;
	private readonly toolEntries = new Map<string, ToolEntry>();
	private readonly cwd: string;
	private stateRefresh: Promise<void> | null = null;
	private opening: Promise<void> | null = null;
	private requestedResume: string | null = null;
	private recoveredResume: string | null = null;
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

	get isStarting(): boolean {
		return !this.isAttached && !this.exited;
	}
	constructor(cwd: string) {
		this.cwd = cwd;
		this.client.onEvent((event) => this.reduce(event));
	}

	get visibleEntries(): TranscriptEntry[] {
		if (this.entries.length <= this.visibleCount) return this.entries;
		return this.entries.slice(this.entries.length - this.visibleCount);
	}

	get hasEarlier(): boolean {
		return this.entries.length > this.visibleCount;
	}

	showEarlier() {
		this.visibleCount += RENDER_WINDOW;
	}

	/* ------------------------------------------------------------ apertura */

	async open(resume?: string | null) {
		if (this.client.isOpen) return;
		if (this.opening) return this.opening;

		const requestedResume = resume ?? null;
		const opening = (async () => {
			this.exited = false;
			this.requestedResume = requestedResume;
			try {
				await this.client.open(this.cwd, requestedResume);
			} catch (error) {
				if (this.requestedResume === requestedResume) this.requestedResume = null;
				throw error;
			}
			// `attach` parte dal frame `ready`: prima di quello `get_state`
			// risponderebbe su una sessione non ancora insediata.
		})();
		this.opening = opening;
		try {
			await opening;
		} finally {
			if (this.opening === opening) this.opening = null;
		}
	}

	async close() {
		await this.client.close();
		this.isReady = false;
		this.isAttached = false;
		this.pendingStartupPrompts = [];
	}

	/**
	 * Insediamento: stato, sottoscrizione ai subagent, poi ricostruzione del
	 * transcript. In quest'ordine, perche' la ricostruzione e' la parte che
	 * puo' fallire e le altre due servono comunque.
	 */
	private async attach() {
		if (this.isAttached) return;
		this.isAttached = true;
		try {
			await this.refreshState();
			await this.client.send({ type: 'set_subagent_subscription', level: 'progress' });
			await this.rebuildTranscript();
			void this.refreshCost();
		} catch (error) {
			this.pushNotice('error', `Insediamento della sessione non completato: ${this.reason(error)}`);
		}
		const recoveredResume = this.recoveredResume;
		if (recoveredResume) {
			this.recoveredResume = null;
			this.pushNotice(
				'warning',
				`La sessione ${recoveredResume} non è più disponibile. È stata avviata una nuova chat.`
			);
		}
		await this.flushStartupPrompts();
	}


	async refreshState() {
		const state = await this.client.send<RpcSessionState>({ type: 'get_state' });
		this.applyState(state);
	}

	private applyState(state: RpcSessionState | null | undefined) {
		if (!state) return;
		if (state.model) this.model = state.model;
		if (state.thinkingLevel) this.thinkingLevel = state.thinkingLevel;
		if (state.contextUsage) this.contextUsage = state.contextUsage;
		if (typeof state.sessionId === 'string') this.sessionId = state.sessionId;
		if (typeof state.sessionFile === 'string') this.sessionFile = state.sessionFile;
		if (typeof state.sessionName === 'string') this.sessionName = state.sessionName;
		if (Array.isArray(state.todoPhases)) this.todoPhases = state.todoPhases;
		if (typeof state.isStreaming === 'boolean') this.isStreaming = state.isStreaming;
		if (typeof state.isCompacting === 'boolean') this.isCompacting = state.isCompacting;
		if (typeof state.queuedMessageCount === 'number') {
			this.queuedMessageCount = state.queuedMessageCount;
			// Il conteggio del server e' l'autorita': i chip locali sono uno
			// specchio, e uno specchio piu' lungo dell'originale e' un errore.
			if (this.queued.length > state.queuedMessageCount) {
				this.queued = this.queued.slice(this.queued.length - state.queuedMessageCount);
			}
		}
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
	}

	/**
	 * Ricostruzione paginata. `get_messages` monolitico non e' un'opzione: un
	 * solo messaggio con immagini sfonda il frame fisico da 1 MiB.
	 */
	private async rebuildTranscript() {
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
				this.entries = this.mapHistory(collected);
				// Le card ricostruite devono restare aggiornabili dalla diretta:
				// nella mappa vanno le istanze reattive, prese dopo l'assegnazione.
				this.toolEntries.clear();
				for (const entry of this.entries) {
					if (entry.kind === 'tool' && !entry.result) this.toolEntries.set(entry.toolCallId, entry);
				}
				this.optimisticUser = null;
				this.visibleCount = RENDER_WINDOW;
				return;
			}
			if (failed === 'fatal') break;
			const { promise, resolve } = Promise.withResolvers<void>();
			window.setTimeout(resolve, 400 * attempt);
			await promise;
		}
		this.pushNotice('warning', 'Transcript storico non ricostruito: la sessione e\u2019 occupata');
	}

	/** Storico -> entry. Stessa forma della diretta: nessun percorso separato. */
	private mapHistory(messages: AgentMessage[]): TranscriptEntry[] {
		const entries: TranscriptEntry[] = [];
		const tools = new Map<string, ToolEntry>();
		this.toolEntries.clear();

		for (const message of messages) {
			if (message.role === 'user') {
				entries.push({
					id: this.nextEntryId++,
					kind: 'user',
					content: textOf(message.content),
					images: imagesOf(message.content),
					attribution: message.attribution
				});
				continue;
			}
			if (message.role === 'custom' || message.role === 'developer') {
				// Esiti dei job in background e promemoria dei todo: nello
				// storico valgono quanto in diretta, altrimenti riprendendo una
				// sessione sparirebbero.
				const text = textOf(message.content);
				if (text && !this.isNoiseNotice(text, message.role === 'custom' ? 'sistema' : 'promemoria')) {
					entries.push({
						id: this.nextEntryId++,
						kind: 'notice',
						level: 'info',
						message: text,
						source: message.role === 'custom' ? 'sistema' : 'promemoria'
					});
				}
				continue;
			}
			if (message.role === 'assistant') {
				const blocks: Block[] = [];
				const calls: ToolEntry[] = [];
				for (const block of Array.isArray(message.content) ? message.content : []) {
					if (block.type === 'text' && typeof block.text === 'string') {
						blocks.push({ type: 'text', text: block.text });
					} else if (block.type === 'thinking' && typeof block.thinking === 'string') {
						blocks.push({ type: 'thinking', text: block.thinking });
					} else if (block.type === 'image' && typeof block.data === 'string') {
						blocks.push({ type: 'image', data: block.data, mimeType: block.mimeType ?? 'image/png' });
					} else if (block.type === 'toolCall' && typeof block.id === 'string' && typeof block.name === 'string') {
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
						calls.push(entry);
						tools.set(block.id, entry);
					}
				}
				if (blocks.length > 0) {
					entries.push({
						id: this.nextEntryId++,
						kind: 'assistant',
						blocks,
						usage: message.usage,
						model: message.model,
						stopReason: message.stopReason
					});
				}
				entries.push(...calls);
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
		switch (event.type) {
			case 'ready':
				this.requestedResume = null;
				this.isReady = true;
				void this.attach();
				return;

			case 'studio_delta':
				this.applyDelta(event);
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
					// L'eco del messaggio appena spedito non va disegnata due
					// volte: si completa quella gia' a schermo.
					if (pending && pending.content === content) {
						pending.images = imagesOf(message.content);
						pending.attribution = message.attribution;
						return;
					}
					this.push({
						id: this.nextEntryId++,
						kind: 'user',
						content,
						images: imagesOf(message.content),
						attribution: message.attribution
					});
				} else if (message.role === 'assistant') {
					// `push` restituisce l'istanza dentro l'array reattivo: tenere
					// l'oggetto grezzo significherebbe mutarlo fuori dal proxy di
					// Svelte e non far mai comparire il testo in streaming.
					this.assistantEntry = this.push({
						id: this.nextEntryId++,
						kind: 'assistant',
						blocks: []
					}) as AssistantEntry;
					this.activeAssistantId = this.assistantEntry.id;
				} else if (message.role === 'custom' || message.role === 'developer') {
					// Esiti dei job in background e promemoria: senza questo ramo
					// il completamento di un subagent non lascia traccia.
					const text = textOf(message.content);
					if (text && !this.isNoiseNotice(text, message.role === 'custom' ? 'sistema' : 'promemoria')) {
						this.pushNotice('info', text, message.role === 'custom' ? 'sistema' : 'promemoria');
					}
				}
				return;
			}

			case 'message_update':
				this.applyAssistantEvent(event);
				return;

			case 'message_end': {
				const message = this.asMessage(event.message);
				if (!message || message.role !== 'assistant' || !this.assistantEntry) return;
				this.assistantEntry.usage = message.usage;
				this.assistantEntry.model = message.model;
				this.assistantEntry.stopReason = message.stopReason;
				this.assistantEntry = null;
				this.activeAssistantId = null;
				return;
			}

			case 'tool_execution_start': {
				if (typeof event.toolCallId !== 'string' || typeof event.toolName !== 'string') return;
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
				return;
			}

			case 'tool_execution_update': {
				const entry = typeof event.toolCallId === 'string' ? this.toolEntries.get(event.toolCallId) : undefined;
				if (!entry || !event.partialResult) return;
				entry.result = event.partialResult;
				return;
			}

			case 'tool_execution_end': {
				const entry = typeof event.toolCallId === 'string' ? this.toolEntries.get(event.toolCallId) : undefined;
				if (!entry) return;
				if (event.result) entry.result = event.result;
				entry.running = false;
				entry.endedAt = Date.now();
				return;
			}

			case 'agent_start':
				this.isStreaming = true;
				this.agentState = 'working';
				return;

			case 'agent_end':
				// `isTerminal: false` significa che la sessione riprendera': non
				// e' la fine del turno e non cambia stato.
				if (event.isTerminal === false) return;
				this.isStreaming = false;
				this.assistantEntry = null;
				this.activeAssistantId = null;
				this.agentState = this.pendingUi ? 'attention' : 'idle';
				void this.reconcile();
				return;

			case 'turn_start':
				// Nessuno stato da toccare: `agent_start` ha gia' acceso lo
				// streaming. Esplicito per non finire nel ramo predefinito.
				return;

			case 'turn_end':
				void this.reconcile();
				return;

			case 'notice': {
				const text = typeof event.message === 'string' ? event.message : '';
				if (!text || this.isNoiseNotice(text, typeof event.source === 'string' ? event.source : undefined)) return;
				this.pushNotice(this.noticeLevel(event.level), text, typeof event.source === 'string' ? event.source : undefined);
				return;
			}

			case 'irc_message': {
				const text = typeof event.message === 'string' ? event.message : '';
				if (text) this.pushNotice('info', text, 'irc');
				return;
			}

			case 'command_output': {
				const output = typeof event.output === 'string' ? event.output : typeof event.message === 'string' ? event.message : '';
				if (output) this.pushNotice('info', output, 'comando');
				return;
			}

			case 'auto_compaction_start':
				this.isCompacting = true;
				this.push({ id: this.nextEntryId++, kind: 'compaction', message: 'Compattazione del contesto in corso', running: true });
				return;

			case 'auto_compaction_end': {
				this.isCompacting = false;
				const last = this.lastOfKind('compaction');
				if (last) {
					last.running = false;
					last.message = 'Contesto compattato';
				}
				void this.refreshState();
				return;
			}

			case 'auto_retry_start':
				this.push({
					id: this.nextEntryId++,
					kind: 'retry',
					message: this.retryText(event, 'Nuovo tentativo in corso')
				});
				return;

			case 'auto_retry_end':
				return;

			case 'retry_fallback_applied':
			case 'retry_fallback_succeeded':
				this.push({
					id: this.nextEntryId++,
					kind: 'retry',
					message: this.retryText(event, 'Modello di riserva applicato')
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
				// `todo_reminder.todos` e' una lista piatta senza fasi: per le
				// fasi serve `get_state`, che e' l'unica fonte completa.
				void this.refreshState();
				return;

			case 'todo_auto_clear':
				this.todoPhases = [];
				return;

			case 'model_changed':
				if (event.model && typeof event.model === 'object') this.model = event.model;
				else void this.refreshState();
				return;

			case 'thinking_level_changed':
				if (typeof event.thinkingLevel === 'string') this.thinkingLevel = event.thinkingLevel;
				return;

			case 'config_update':
			case 'session_info_update':
				void this.refreshState();
				return;

			case 'available_commands_update':
				if (Array.isArray(event.commands)) this.availableCommands = event.commands;
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
				const detail = typeof event.error === 'string' ? event.error : 'errore non descritto';
				this.pushNotice('warning', `${path}: ${detail}`, 'estensione');
				return;
			}

			case 'studio_error':
				this.pushNotice('error', typeof event.message === 'string' ? event.message : 'Errore del trasporto RPC');
				return;

			case 'studio_exit': {
				const code = typeof event.code === 'number' ? event.code : null;
				const stderr = Array.isArray(event.stderr)
					? event.stderr.filter((line): line is string => typeof line === 'string')
					: [];
				const requestedResume = this.requestedResume;
				const resumeMissing =
					requestedResume !== null
					&& stderr.some((line) => line.includes(`Session "${requestedResume}" not found.`));
				this.isStreaming = false;
				this.activeAssistantId = null;
				this.exited = true;
				this.isReady = false;
				this.isAttached = false;
				this.agentState = 'idle';
				this.pendingUi = null;
				this.client.markExited();

				if (this.pendingStartupPrompts.length > 0) {
					for (const pending of this.pendingStartupPrompts) {
						const idx = this.entries.indexOf(pending.optimisticUser);
						if (idx !== -1) this.entries.splice(idx, 1);
					}
					this.pendingStartupPrompts = [];
					this.pushNotice('error', 'Prompt non inviato: la sessione OMP e\u2019 terminata prima del completamento dell’avvio');
				}
				if (resumeMissing) {
					this.requestedResume = null;
					this.recoveredResume = requestedResume;
					void this.recoverMissingResume();
					return;
				}

				this.requestedResume = null;
				this.push({
					id: this.nextEntryId++,
					kind: 'notice',
					level: code === 0 ? 'info' : 'error',
					message:
						code === 0
							? 'La sessione omp e\u2019 terminata'
							: `La sessione omp e\u2019 terminata (codice ${code ?? 'sconosciuto'})`,
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

	private asMessage(value: AgentMessage | string | undefined): AgentMessage | null {
		return value && typeof value === 'object' ? value : null;
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

	private applyAssistantEvent(event: AgentSessionEvent) {
		const inner = event.assistantMessageEvent;
		if (!inner) return;
		const index = inner.contentIndex ?? 0;

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
		// `toolcall_end` non produce niente sul transcript: la card nasce da
		// `tool_execution_start`, che porta gli argomenti normalizzati.
	}

	private applyDelta(event: AgentSessionEvent) {
		const kind = event.kind;
		const delta = typeof event.delta === 'string' ? event.delta : '';
		if (!delta || (kind !== 'text' && kind !== 'thinking')) return;
		const index = typeof event.contentIndex === 'number' ? event.contentIndex : 0;
		const entry = this.ensureAssistant();
		const existing = entry.blocks[index];
		if (existing && existing.type === kind) {
			existing.text += delta;
			return;
		}
		this.setBlock(index, kind === 'text' ? { type: 'text', text: delta } : { type: 'thinking', text: delta });
	}

	private ensureAssistant(): AssistantEntry {
		if (this.assistantEntry) return this.assistantEntry;
		this.assistantEntry = this.push({
			id: this.nextEntryId++,
			kind: 'assistant',
			blocks: []
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
			if (!target || this.pendingUi?.requestId === target) this.clearPendingUi();
			return;
		}
		if (method === 'notify') {
			const body = text ?? title;
			if (body) this.pushNotice(this.noticeLevel(event.level), body, 'estensione');
			return;
		}
		if (method === 'setStatus') {
			this.statusText = text ?? title ?? null;
			return;
		}
		if (method === 'open_url') {
			// Il campo `launchUrl` esiste proprio per questo: quando c'e', e'
			// l'indirizzo da aprire davvero.
			const target = typeof event.launchUrl === 'string' ? event.launchUrl : typeof event.url === 'string' ? event.url : null;
			if (target) void openUrl(target);
			return;
		}
		if (ANSWERABLE_UI_METHODS[method] !== true) return;

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
	}

	private clearPendingUi() {
		this.pendingUi = null;
		if (this.agentState === 'attention') this.agentState = this.isStreaming ? 'working' : 'idle';
	}

	/* --------------------------------------------------------- risposte UI */

	async answerSelect(value: string) {
		const pending = this.pendingUi;
		if (!pending) return;
		this.clearPendingUi();
		await this.client.respondUi({ type: 'extension_ui_response', id: pending.requestId, value });
	}

	async answerConfirm(confirmed: boolean) {
		const pending = this.pendingUi;
		if (!pending) return;
		this.clearPendingUi();
		await this.client.respondUi({ type: 'extension_ui_response', id: pending.requestId, confirmed });
	}

	async cancelPendingUi() {
		const pending = this.pendingUi;
		if (!pending) return;
		this.clearPendingUi();
		await this.client.respondUi({ type: 'extension_ui_response', id: pending.requestId, cancelled: true });
	}

	/* ------------------------------------------------------------- comandi */

	/**
	 * Invio di un prompt. Durante lo streaming `streamingBehavior` e'
	 * obbligatorio: senza, il comando fallisce lato omp. Predefinito a 'steer'.
	 */
	async prompt(message: string, images: ImageContent[] = [], behavior: StreamingBehavior = 'steer') {
		const trimmed = message.trim();
		if (!trimmed && images.length === 0) return;
		const fullMessage = attachEditorContext(trimmed, this.cwd);

		// Se OMP e' ancora in fase di avvio, accoda il messaggio e mostra subito l'entry ottimistica
		if (!this.isReady || !this.isAttached) {
			const optimistic = this.push({
				id: this.nextEntryId++,
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
			return;
		}

		const streaming = this.isStreaming;
		if (streaming) {
			this.queued.push({ id: this.nextQueueId++, text: fullMessage, behavior });
		} else {
			// Fuori dallo streaming il messaggio compare subito: l'eco di omp
			// lo completera' invece di duplicarlo. Durante lo streaming il
			// posto del messaggio e' il chip della coda, non il transcript.
			this.optimisticUser = this.push({
				id: this.nextEntryId++,
				kind: 'user',
				content: fullMessage,
				images: images.map((image) => ({ data: image.data, mimeType: image.mimeType }))
			}) as UserEntry;
		}
		try {
			await this.client.send({
				type: 'prompt',
				message: fullMessage,
				images: images.length > 0 ? images : undefined,
				streamingBehavior: streaming ? behavior : undefined
			});
		} catch (error) {
			if (streaming) this.queued = this.queued.filter((entry) => entry.text !== fullMessage);
			this.dropOptimisticUser();
			this.pushNotice('error', `Prompt non accettato: ${this.reason(error)}`);
			return;
		}
		if (streaming) void this.reconcile();
	}

	private async flushStartupPrompts() {
		if (this.pendingStartupPrompts.length === 0) return;
		const queue = [...this.pendingStartupPrompts];
		this.pendingStartupPrompts = [];

		for (const pending of queue) {
			if (!this.entries.includes(pending.optimisticUser)) {
				this.entries.push(pending.optimisticUser);
			}
			this.optimisticUser = pending.optimisticUser;

			try {
				await this.client.send({
					type: 'prompt',
					message: pending.message,
					images: pending.images.length > 0 ? pending.images : undefined,
					streamingBehavior: this.isStreaming ? pending.behavior : undefined
				});
			} catch (error) {
				this.dropOptimisticUser();
				const idx = this.entries.indexOf(pending.optimisticUser);
				if (idx !== -1) this.entries.splice(idx, 1);
				this.pushNotice('error', `Prompt non accettato: ${this.reason(error)}`);
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
	/** Modifica il comportamento di un messaggio in coda (steer / follow-up). */
	setQueuedBehavior(id: number, behavior: StreamingBehavior) {
		const target = this.queued.find((item) => item.id === id);
		if (target) {
			target.behavior = behavior;
		}
	}

	private isNoiseNotice(text: string, source?: string): boolean {
		if (!text) return false;
		if (text.startsWith('xd://: mounted') || text.startsWith('xd:// mounted')) return true;
		if (text.includes('mounted mcp__')) return true;
		if (source === 'xd://' && text.includes('mounted')) return true;
		return false;
	}

	async abort() {
		try {
			await this.client.send({ type: 'abort' });
		} catch (error) {
			this.pushNotice('warning', `Interruzione non riuscita: ${this.reason(error)}`);
		}
	}

	async newSession(): Promise<string | null> {
		this.pendingStartupPrompts = [];
		await this.client.send({ type: 'new_session' });
		this.entries = [];
		this.toolEntries.clear();
		this.assistantEntry = null;
		this.activeAssistantId = null;
		this.optimisticUser = null;
		this.subagents = [];
		this.todoPhases = [];
		this.queued = [];
		this.visibleCount = RENDER_WINDOW;
		await this.refreshState();
		return this.sessionId;
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
