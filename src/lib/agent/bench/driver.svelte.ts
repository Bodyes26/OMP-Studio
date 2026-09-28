// Driver di replay per il banco di prova Chat v2 (chat-bench).
// Coordina l'esecuzione di scenari, il controllo di riproduzione (play/pause/restart/speed),
// l'emissione temporizzata di eventi wire e la risposta interattiva a domande (ask) e prompt.

import type { AgentSession } from '../session.svelte';
import type { FakeOmpRpcClient } from './fakeClient';
import {
	type BenchAnswers,
	type BenchPart,
	type BenchQuestion,
	type BenchScenario,
	type BenchSubAgent,
	type BenchTool,
	buildTodoPhases
} from './dsl';
import type { AgentSessionEvent, ExtensionUiResponse } from '../wire';

export type DriverStatus = 'idle' | 'playing' | 'paused' | 'waiting_ui' | 'completed';

export class BenchReplayDriver {
	status = $state<DriverStatus>('idle');
	scenario = $state<BenchScenario | null>(null);
	currentPartIndex = $state(0);
	totalParts = $state(0);
	speed = $state(1.0);
	answers = $state<BenchAnswers>({});
	elapsedMs = $state(0);

	private session: AgentSession;
	private client: FakeOmpRpcClient;
	private abortController = new AbortController();
	private resumeResolver: (() => void) | null = null;
	private uiResponseResolver: ((resp: ExtensionUiResponse) => void) | null = null;
	private timerInterval: number | null = null;
	private currentPlanItems: string[] = [];
	private nextToolId = 1;

	constructor(session: AgentSession, client: FakeOmpRpcClient) {
		this.session = session;
		this.client = client;

		// Connette la risposta interattiva di AskCard al driver
		this.client.onUiResponse = (resp) => {
			this.handleUiResponse(resp);
		};

		// Gestisce prompt inviati dall'utente nel Composer durante il benchmark
		this.client.onPrompt = (cmd) => {
			this.handleUserPrompt(cmd.message);
		};
	}

	/** Imposta la velocità di riproduzione (0.25x - 4x) */
	setSpeed(newSpeed: number): void {
		this.speed = Math.max(0.1, Math.min(10, newSpeed));
	}

	/** Carica uno scenario e lo avvia */
	async loadScenario(scenario: BenchScenario, autoPlay = true): Promise<void> {
		this.stopCurrentRun();
		this.scenario = scenario;
		this.totalParts = scenario.parts.length;
		this.currentPartIndex = 0;
		this.answers = {};
		this.elapsedMs = 0;
		this.currentPlanItems = [];

		this.resetSession();

		if (scenario.preloadHistoryCount && scenario.preloadHistoryCount > 0) {
			this.preloadHistory(scenario.preloadHistoryCount);
		}

		if (autoPlay) {
			await this.play();
		} else {
			this.status = 'paused';
		}
	}

	/** Avvia o riprende l'esecuzione dello scenario */
	async play(): Promise<void> {
		if (this.status === 'paused' && this.resumeResolver) {
			this.status = 'playing';
			const res = this.resumeResolver;
			this.resumeResolver = null;
			res();
			return;
		}

		if (!this.scenario) return;

		this.status = 'playing';
		this.startTimer();
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		try {
			await this.runScenario(this.scenario, signal);
			if (!signal.aborted) {
				this.status = 'completed';
			}
		} catch (error) {
			if (!signal.aborted) {
				console.error('Errore durante l\u2019esecuzione dello scenario:', error);
				this.status = 'idle';
			}
		} finally {
			this.stopTimer();
		}
	}

	/** Mette in pausa l'esecuzione dello scenario */
	pause(): void {
		if (this.status === 'playing') {
			this.status = 'paused';
			this.stopTimer();
		}
	}

	/** Riavvia lo scenario corrente dall'inizio */
	async restart(): Promise<void> {
		if (!this.scenario) return;
		await this.loadScenario(this.scenario, true);
	}

	/** Attesa temporizzata sensibile alla velocità e alla pausa */
	private async delay(ms: number, signal: AbortSignal): Promise<void> {
		if (signal.aborted) return;
		const adjustedMs = ms / this.speed;
		const startTime = Date.now();
		let remaining = adjustedMs;

		while (remaining > 0) {
			if (signal.aborted) return;

			if (this.status === 'paused') {
				const { promise, resolve } = Promise.withResolvers<void>();
				this.resumeResolver = resolve;
				await promise;
				if (signal.aborted) return;
			}

			const chunk = Math.min(50, remaining);
			const { promise: delayPromise, resolve: delayResolve } = Promise.withResolvers<void>();
			setTimeout(delayResolve, chunk);
			await delayPromise;
			remaining = adjustedMs - (Date.now() - startTime);
		}
	}

	/** Interrompe l'esecuzione corrente */
	private stopCurrentRun(): void {
		this.abortController.abort();
		if (this.resumeResolver) {
			const res = this.resumeResolver;
			this.resumeResolver = null;
			res();
		}
		if (this.uiResponseResolver) {
			const res = this.uiResponseResolver;
			this.uiResponseResolver = null;
			res({ type: 'extension_ui_response', id: 'aborted', cancelled: true });
		}
		this.stopTimer();
		this.status = 'idle';
	}

	/** Reset pulito dello stato della sessione */
	private resetSession(): void {
		this.client.reset();
		this.session.entries = [];
		this.session.subagents = [];
		this.session.todoPhases = [];
		this.session.todoReminder = null;
		this.session.isStreaming = false;
		this.session.isCompacting = false;
		this.session.activeAssistantId = null;
		this.session.agentState = 'idle';
		this.session.visibleCount = 300;
	}

	/** Precarica uno storico di N entry per stress test di rendering / virtualizzazione */
	private preloadHistory(count: number): void {
		const pairs = Math.floor(count / 2);
		for (let i = 1; i <= pairs; i++) {
			this.client.emit({
				type: 'message_start',
				message: {
					role: 'user',
					content: [{ type: 'text', text: `Domanda storica #${i}: come ottimizzare il modulo ${i}?` }]
				}
			});
			this.client.emit({ type: 'message_end', message: { role: 'user' } });

			this.client.emit({
				type: 'message_start',
				message: { role: 'assistant' }
			});
			this.client.emit({
				type: 'studio_delta',
				kind: 'text',
				contentIndex: 0,
				delta: `Risposta storica dell\u2019agente #${i}: ho analizzato il modulo e applicato le configurazioni necessarie.`
			});
			this.client.emit({
				type: 'message_end',
				message: { role: 'assistant' }
			});
		}
	}

	/** Esegue la sequenza di parti dello scenario */
	private async runScenario(scenario: BenchScenario, signal: AbortSignal): Promise<void> {
		if (scenario.ndjsonRaw) {
			await this.runNdjsonScenario(scenario.ndjsonRaw, signal);
			return;
		}

		// Handshake iniziale di avvio turno
		this.client.emit({ type: 'ready' });
		this.client.emit({ type: 'agent_start' });
		await this.delay(100, signal);

		// Messaggio iniziale dell'utente
		this.client.emit({
			type: 'message_start',
			message: {
				role: 'user',
				content: [{ type: 'text', text: scenario.prompt }]
			}
		});
		this.client.emit({ type: 'message_end', message: { role: 'user' } });
		await this.delay(200, signal);

		for (let idx = 0; idx < scenario.parts.length; idx++) {
			if (signal.aborted) return;
			this.currentPartIndex = idx + 1;
			const part = scenario.parts[idx];
			await this.executePart(part, signal);
		}

		if (signal.aborted) return;
		this.client.emit({ type: 'agent_end', isTerminal: true });
	}

	/** Esegue un flusso NDJSON reale registrato su RPC */
	private async runNdjsonScenario(raw: string, signal: AbortSignal): Promise<void> {
		const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
		this.totalParts = lines.length;

		for (let i = 0; i < lines.length; i++) {
			if (signal.aborted) return;
			this.currentPartIndex = i + 1;
			const line = lines[i];

			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}

			if (!parsed || typeof parsed !== 'object') continue;
			const event = parsed as Record<string, unknown>;

			if (event.type === 'extension_ui_request' && typeof event.method === 'string') {
				const method = event.method;
				if (method === 'select' || method === 'confirm' || method === 'input' || method === 'editor') {
					this.status = 'waiting_ui';
					this.client.emit(event as unknown as AgentSessionEvent);
					const { promise: userPromise, resolve: userResolve } = Promise.withResolvers<ExtensionUiResponse>();
					this.uiResponseResolver = userResolve;
					await userPromise;

					if (signal.aborted) return;
					this.status = 'playing';
					await this.delay(120, signal);
					continue;
				}
			}

			this.client.emit(event as unknown as AgentSessionEvent);
			if (event.type === 'studio_delta' || event.type === 'message_update') {
				await this.delay(18, signal);
			} else if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
				await this.delay(120, signal);
			} else {
				await this.delay(50, signal);
			}
		}
	}

	/** Esegue una singola parte dello scenario */
	private async executePart(part: BenchPart, signal: AbortSignal): Promise<void> {
		switch (part.type) {
			case 'tools':
				await this.executeToolsGroup(part.tools, signal);
				break;

			case 'text':
				await this.executeText(part.text, signal);
				break;

			case 'thinking':
				await this.executeThinking(part.text, part.ms ?? 600, signal);
				break;

			case 'ask':
				await this.executeAsk(part.questions, signal);
				break;

			case 'plan':
				this.executePlan(part.items);
				await this.delay(150, signal);
				break;

			case 'step':
				this.executeStep(part.index);
				await this.delay(150, signal);
				break;

			case 'agents':
				await this.executeAgents(part.agents, signal);
				break;

			case 'compaction':
				await this.executeCompaction(signal);
				break;

			case 'notice':
				this.client.emit({
					type: 'notice',
					level: part.level,
					message: part.message,
					source: part.source ?? 'studio'
				});
				await this.delay(100, signal);
				break;
		}
	}

	/** Esegue un gruppo di tool con supporto a chiamate parallele */
	private async executeToolsGroup(tools: BenchTool[], signal: AbortSignal): Promise<void> {
		let i = 0;
		while (i < tools.length) {
			if (signal.aborted) return;

			// Raggruppa chiamate parallele consecutive
			const batch: BenchTool[] = [tools[i]];
			while (i + 1 < tools.length && tools[i + 1].par === true) {
				batch.push(tools[i + 1]);
				i++;
			}
			i++;

			if (batch.length === 1) {
				await this.executeSingleTool(batch[0], signal);
			} else {
				await Promise.all(batch.map((tool) => this.executeSingleTool(tool, signal)));
			}
		}
	}

	/** Esegue un singolo tool con start, update e end */
	private async executeSingleTool(tool: BenchTool, signal: AbortSignal): Promise<void> {
		if (tool.kind === 'think') {
			await this.executeThinking(tool.label, tool.ms, signal);
			return;
		}

		const callId = `call_${this.nextToolId++}_${tool.name}`;
		this.client.emit({
			type: 'tool_execution_start',
			toolCallId: callId,
			toolName: tool.name,
			args: tool.args,
			intent: tool.intent ?? tool.label
		});

		if (tool.partial) {
			await this.delay(tool.ms * 0.4, signal);
			this.client.emit({
				type: 'tool_execution_update',
				toolCallId: callId,
				toolName: tool.name,
				partialResult: {
					content: [{ type: 'text', text: tool.partial }]
				}
			});
			await this.delay(tool.ms * 0.6, signal);
		} else {
			await this.delay(tool.ms, signal);
		}

		if (signal.aborted) return;

		this.client.emit({
			type: 'tool_execution_end',
			toolCallId: callId,
			toolName: tool.name,
			result: {
				content: [{ type: 'text', text: tool.resultData?.content ?? 'Esecuzione completata' }],
				details: tool.resultData?.details,
				isError: tool.fail === true
			}
		});
	}

	/** Emette testo in streaming tramite delta frames */
	private async executeText(
		textOrFn: string | ((answers: BenchAnswers) => string),
		signal: AbortSignal
	): Promise<void> {
		const fullText = typeof textOrFn === 'function' ? textOrFn(this.answers) : textOrFn;
		this.client.emit({
			type: 'message_start',
			message: { role: 'assistant' }
		});

		// Suddivide il testo in frammenti realistici per lo streaming
		const chunkSize = 24;
		for (let pos = 0; pos < fullText.length; pos += chunkSize) {
			if (signal.aborted) return;
			const delta = fullText.slice(pos, pos + chunkSize);
			this.client.emit({
				type: 'studio_delta',
				kind: 'text',
				contentIndex: 0,
				delta
			});
			await this.delay(22, signal);
		}

		this.client.emit({
			type: 'message_end',
			message: {
				role: 'assistant',
				usage: { totalTokens: Math.ceil(fullText.length / 4) }
			}
		});
		await this.delay(100, signal);
	}

	/** Emette pensiero in streaming tramite delta frames */
	private async executeThinking(text: string, ms: number, signal: AbortSignal): Promise<void> {
		this.client.emit({
			type: 'message_start',
			message: { role: 'assistant' }
		});

		const chunkSize = 18;
		const chunksCount = Math.ceil(text.length / chunkSize);
		const interval = Math.max(15, ms / chunksCount);

		for (let pos = 0; pos < text.length; pos += chunkSize) {
			if (signal.aborted) return;
			const delta = text.slice(pos, pos + chunkSize);
			this.client.emit({
				type: 'studio_delta',
				kind: 'thinking',
				contentIndex: 0,
				delta
			});
			await this.delay(interval, signal);
		}

		await this.delay(50, signal);
	}

	/** Gestisce la sequenza di domande con attesa della risposta dell'utente */
	private async executeAsk(questions: BenchQuestion[], signal: AbortSignal): Promise<void> {
		if (questions.length === 0) return;

		const callId = `call_${this.nextToolId++}_ask`;
		this.client.emit({
			type: 'tool_execution_start',
			toolCallId: callId,
			toolName: 'ask',
			args: { questions }
		});

		for (let qIdx = 0; qIdx < questions.length; qIdx++) {
			if (signal.aborted) return;
			const q = questions[qIdx];
			const reqId = `ask_req_${callId}_${q.id}`;
			const title = q.header
				? `${q.header} (${qIdx + 1}/${questions.length})`
				: `Domanda (${qIdx + 1}/${questions.length})`;

			this.status = 'waiting_ui';

			// Invia la richiesta interattiva al riduttore di AgentSession
			this.client.emit({
				type: 'extension_ui_request',
				id: reqId,
				method: 'select',
				title,
				message: q.question,
				options: q.options.map((opt) => opt.label),
				optionDetails: q.options.map((opt) => ({ description: opt.description }))
			});

			// Attende la risposta inviata dall'utente nella card AskCard
			const { promise: userPromise, resolve: userResolve } = Promise.withResolvers<ExtensionUiResponse>();
			this.uiResponseResolver = userResolve;
			const userResp = await userPromise;

			if (signal.aborted) return;
			this.status = 'playing';

			// Registra la risposta per l'uso nel testo finale dello scenario
			if ('value' in userResp && typeof userResp.value === 'string') {
				const choiceIndex = q.options.findIndex((opt) => userResp.value.includes(opt.label));
				this.answers[q.id] = {
					choices: choiceIndex >= 0 ? [choiceIndex] : [q.recommended ?? 0],
					other: choiceIndex < 0 ? userResp.value : undefined
				};
			} else {
				this.answers[q.id] = {
					choices: [q.recommended ?? 0],
					skipped: true
				};
			}

			await this.delay(100, signal);
		}

		// Completa il tool ask
		this.client.emit({
			type: 'tool_execution_end',
			toolCallId: callId,
			toolName: 'ask',
			result: {
				content: [{ type: 'text', text: 'Scelte registrate dall\u2019utente' }],
				details: { questions, answers: this.answers }
			}
		});
	}

	/** Inizializza il piano todo */
	private executePlan(items: string[]): void {
		this.currentPlanItems = [...items];
		const phases = buildTodoPhases(items, 0);
		this.client.state.todoPhases = phases;
		this.client.emit({ type: 'session_info_update' });
	}

	/** Avanza al passo indicato del piano */
	private executeStep(index: number): void {
		const phases = buildTodoPhases(this.currentPlanItems, index);
		this.client.state.todoPhases = phases;
		this.client.emit({ type: 'session_info_update' });
	}

	/** Esegue subagenti in parallelo */
	private async executeAgents(agents: BenchSubAgent[], signal: AbortSignal): Promise<void> {
		const callId = `call_${this.nextToolId++}_task`;
		this.client.emit({
			type: 'tool_execution_start',
			toolCallId: callId,
			toolName: 'task',
			args: {
				tasks: agents.map((a) => ({ name: a.name, task: a.task }))
			}
		});

		// Avvia tutti i subagenti contemporaneamente
		await Promise.all(
			agents.map(async (agent, idx) => {
				const saId = `sa_${idx + 1}_${agent.name}`;
				this.client.emit({
					type: 'subagent_lifecycle',
					payload: {
						id: saId,
						agent: agent.name,
						description: agent.task,
						status: 'started'
					}
				});

				for (let tIdx = 0; tIdx < agent.tools.length; tIdx++) {
					if (signal.aborted) return;
					const tool = agent.tools[tIdx];

					// Se il subagente deve porre una domanda intermedia (es. scenario 6)
					if (agent.ask && tIdx === agent.ask.after) {
						await this.executeAsk(agent.ask.questions, signal);
					}

					await this.delay(tool.ms, signal);

					this.client.emit({
						type: 'subagent_progress',
						payload: {
							id: saId,
							agent: agent.name,
							progress: {
								status: 'running',
								task: agent.task,
								toolCount: tIdx + 1,
								lastIntent: tool.label,
								recentTools: [
									{
										tool: tool.name,
										args: tool.detail ?? tool.name,
										endMs: tool.ms
									}
								]
							}
						}
					});
				}

				if (signal.aborted) return;

				this.client.emit({
					type: 'subagent_lifecycle',
					payload: {
						id: saId,
						agent: agent.name,
						description: agent.result,
						status: 'completed',
						progress: {
							status: 'completed',
							toolCount: agent.tools.length,
							lastIntent: agent.result
						}
					}
				});
			})
		);

		if (signal.aborted) return;

		this.client.emit({
			type: 'tool_execution_end',
			toolCallId: callId,
			toolName: 'task',
			result: {
				content: [{ type: 'text', text: 'Tutti i subagenti hanno completato la loro esecuzione.' }]
			}
		});
	}

	/** Simula una compattazione automatica del contesto */
	private async executeCompaction(signal: AbortSignal): Promise<void> {
		this.client.emit({ type: 'auto_compaction_start' });
		await this.delay(500, signal);
		if (signal.aborted) return;
		this.client.emit({ type: 'auto_compaction_end' });
		await this.delay(200, signal);
	}

	/** Risoluzione della risposta proveniente dall'UI */
	private handleUiResponse(resp: ExtensionUiResponse): void {
		if (this.uiResponseResolver) {
			const res = this.uiResponseResolver;
			this.uiResponseResolver = null;
			res(resp);
		}
	}

	/** Gestione di prompt inviati dall'utente nel composer */
	private handleUserPrompt(msg: string): void {
		// Risponde con un breve eco se inviato durante il benchmark
		this.client.emit({ type: 'agent_start' });
		this.client.emit({
			type: 'message_start',
			message: {
				role: 'user',
				content: [{ type: 'text', text: msg }]
			}
		});
		this.client.emit({ type: 'message_end', message: { role: 'user' } });

		setTimeout(() => {
			this.client.emit({
				type: 'message_start',
				message: { role: 'assistant' }
			});
			this.client.emit({
				type: 'studio_delta',
				kind: 'text',
				contentIndex: 0,
				delta: `Ho ricevuto la tua richiesta: “${msg}”. In questo banco di prova le azioni sono guidate dagli scenari registrati.`
			});
			this.client.emit({
				type: 'message_end',
				message: { role: 'assistant' }
			});
			this.client.emit({ type: 'agent_end', isTerminal: true });
		}, 300);
	}

	private startTimer(): void {
		if (this.timerInterval !== null) return;
		const start = Date.now() - this.elapsedMs;
		this.timerInterval = window.setInterval(() => {
			if (this.status === 'playing') {
				this.elapsedMs = Date.now() - start;
			}
		}, 100);
	}

	private stopTimer(): void {
		if (this.timerInterval !== null) {
			window.clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
	}
}
