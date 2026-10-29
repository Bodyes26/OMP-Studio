/**
 * Runtime AI per le Automazioni di OMP Studio (AUT-000/000A, AUT-025–AUT-028, AUT-041–AUT-044, AUT-105).
 *
 * Gestisce:
 * 1. Ascolto e reidratazione delle richieste AI native (`automations://ai-request`, `automations_ai_pending`).
 * 2. Sessioni isolate nuove per-esecuzione anche su progetti chiusi, senza aprire tab o rubare focus.
 * 3. Aggiornamenti bidirezionali verso il motore nativo (`automations_ai_update`).
 * 4. Rilevamento della reale conclusione dell'occorrenza (non il solo `turn_end`, che spegne lo streaming fra i tool).
 * 5. Gestione domande interattive (`needsInput`), rilascio dello slot attivo con mantenimento del lock di progetto,
 *    e ripresa dell'esecuzione con risposta umana (`resumeAutomationExecution`).
 * 6. Interruzione/annullamento pulito (`cancelAutomationExecution` / abort).
 * 7. Factory `createAutomationAgent` con reale confinamento sola lettura per l'assistente (WizardAssistant).
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { AgentSession } from '#lib/agent/session.svelte.ts';
import type { AgentSessionEvent } from '#lib/agent/wire.ts';
import type {
	AutomationAiRequest,
	AutomationAiUpdate,
	AutomationExecution,
	AutomationOccurrence,
	AutomationSnapshot,
	PromptAction
} from './types';
import { rawMessagesToTranscriptEntries } from '#lib/remote/historicalCommands.ts';
import { buildAutomationPrompt, resolveActionModel } from './runtimeHelpers';
import { promptResultError } from '#lib/agent/settle.ts';

class AutomationRuntimeManager {
	private activeSessions = new Map<string, AgentSession>();
	private activeRequests = new Map<string, AutomationAiRequest>();
	private sessionCleanups = new Map<string, Array<() => void>>();
	private static readonly MAX_COMPLETED_SESSIONS = 20;
	private completedSessions = new Map<string, AgentSession>();
	private hostEpoch = crypto.randomUUID();
	private unlistenAiRequest: UnlistenFn | null = null;
	private running = $state(false);

	private cacheCompletedSession(executionId: string, session: AgentSession): void {
		if (this.completedSessions.has(executionId)) {
			this.completedSessions.delete(executionId);
		} else if (this.completedSessions.size >= AutomationRuntimeManager.MAX_COMPLETED_SESSIONS) {
			const oldestKey = this.completedSessions.keys().next().value;
			if (oldestKey) {
				this.completedSessions.delete(oldestKey);
			}
		}
		this.completedSessions.set(executionId, session);
	}

	/** Numero di esecuzioni AI attualmente attive (per gate e lock). */
	get activeCount(): number {
		return this.activeSessions.size;
	}

	/** Indica se il listener del runtime AI e' attivo. */
	get isRunning(): boolean {
		return this.running;
	}

	/**
	 * Avvia il runtime AI delle automazioni.
	 * Registra il listener degli eventi nativi e reidrata eventuali richieste rimaste
	 * pending nel motore nativo prima dell'avvio della UI.
	 */
	async start(): Promise<() => void> {
		if (this.running) {
			return () => this.stop();
		}

		this.running = true;
		// 1. Handshake epoch host con NativeCore e chiusura sessioni orfane del precedente host
		try {
			await invoke('rpc_cleanup_automation_sessions').catch(() => {});
			const reconciled = await invoke<string[]>('automations_host_handshake', {
				hostEpoch: this.hostEpoch
			});
			if (Array.isArray(reconciled) && reconciled.length > 0) {
				console.warn(
					`[automations-runtime] Riconciliate ${reconciled.length} esecuzioni orfane da host precedente:`,
					reconciled
				);
			}
		} catch (err) {
			console.warn('[automations-runtime] Handshake host_epoch non completato:', err);
		}

		// 2. Sottoscrizione all'evento nativo per nuove richieste di esecuzione AI
		this.unlistenAiRequest = await listen<AutomationAiRequest>(
			'automations://ai-request',
			(event) => {
				void this.handleAiRequest(event.payload, false);
			}
		);

		// 3. Reidratazione richieste pending all'avvio (AUT-025, contratto riga 10)
		try {
			const pending = await invoke<AutomationAiRequest[]>('automations_ai_pending');
			if (Array.isArray(pending)) {
				for (const req of pending) {
					void this.handleAiRequest(req, true);
				}
			}
		} catch (err) {
			console.warn('[automations-runtime] Impossibile recuperare richieste AI pendenti all\'avvio:', err);
		}

		return () => this.stop();
	}

	/**
	 * Arresta il runtime e interrompe le sessioni aperte.
	 */
	stop(): void {
		this.running = false;
		if (this.unlistenAiRequest) {
			this.unlistenAiRequest();
			this.unlistenAiRequest = null;
		}

		// Interruzione ordinata di tutte le sessioni di automazione attive
		for (const [execId, session] of this.activeSessions.entries()) {
			try {
				void session.abort();
				void session.close();
			} catch {
				// chiusura best-effort
			}
			this.cleanupSession(execId);
		}
		this.activeSessions.clear();
		this.activeRequests.clear();
		for (const session of this.completedSessions.values()) {
			try {
				void session.close();
			} catch {
				// chiusura best-effort
			}
		}
		this.completedSessions.clear();
	}

	/**
	 * Restituisce l'AgentSession associata a una data esecuzione, se presente.
	 * Utilizzato da parent e viste per montare chat e transcript dedicati.
	 */
	getSession(executionId: string): AgentSession | undefined {
		return this.activeSessions.get(executionId) ?? this.completedSessions.get(executionId);
	}

	/**
	 * Carica l'AgentSession per una specifica esecuzione:
	 * restituisce la sessione live se attiva o in cache, altrimenti reidrata lo storico
	 * dal sessionId persistito leggendo i messaggi tramite read_historical_session_messages
	 * SENZA avviare alcun processo omp o chiamare il modello.
	 */
	async loadSession(executionId: string): Promise<AgentSession | undefined> {
		const active = this.activeSessions.get(executionId);
		if (active) return active;

		const cached = this.completedSessions.get(executionId);
		if (cached) return cached;

		try {
			const snapshot = await invoke<AutomationSnapshot>('automations_snapshot');
			let targetExec: AutomationExecution | undefined;
			let targetOcc: AutomationOccurrence | undefined;

			for (const run of snapshot.runs) {
				const found = run.executions.find((e) => e.id === executionId);
				if (found) {
					targetExec = found;
					targetOcc = run;
					break;
				}
			}

			if (!targetExec || !targetExec.sessionId) {
				return undefined;
			}

			const projectPath =
				targetExec.targets[0]?.path ||
				targetOcc?.definition.targets.cwd ||
				'';

			const rawMessages = await invoke<Array<Record<string, unknown>>>(
				'read_historical_session_messages',
				{
					projectPath,
					sessionId: targetExec.sessionId,
					knownWorktreePaths: []
				}
			);

			const entries = rawMessagesToTranscriptEntries(rawMessages);
			const session = new AgentSession({
				cwd: projectPath,
				scope: 'main',
				laneId: `hist-${executionId}`,
				projectKey: projectPath,
				automation: {
					id: targetOcc?.automationId,
					executionId,
					runId: targetExec.runId,
					readOnly: true,
					projectPaths: targetExec.targets.map((t) => t.path),
					model: targetExec.model ?? undefined
				}
			});

			session.entries = entries;
			session.sessionId = targetExec.sessionId;
			session.isReady = true;

			this.cacheCompletedSession(executionId, session);
			return session;
		} catch (err) {
			console.warn(`[automations-runtime] Impossibile caricare sessione storica per ${executionId}:`, err);
			return undefined;
		}
	}

	/**
	 * Mappa di tutte le sessioni di automazione attive.
	 */
	getAllSessions(): ReadonlyMap<string, AgentSession> {
		return this.activeSessions;
	}

	/**
	 * Riprende un'esecuzione AI che si trovava nello stato `needsInput`
	 * consegnando la risposta dell'utente alla domanda posta dall'agente.
	 */
	async resumeExecution(executionId: string, message: string): Promise<boolean> {
		const session = this.activeSessions.get(executionId);
		if (!session) {
			console.warn(`[automations-runtime] Sessione non trovata per ripresa: ${executionId}`);
			return false;
		}

		try {
			// 1. Riacquisisce prima atomicamente slot AI e quota tramite NativeCore (AUT-044)
			const admitted = await invoke<boolean>('automations_resume_admission', { executionId });
			if (!admitted) {
				console.warn(
					`[automations-runtime] Ripresa non ammessa per ${executionId}: slot AI occupato o quota insufficiente`
				);
				// Non invia alla sessione: la domanda resta in attesa senza perdita della risposta
				return false;
			}

			// 2. Se c'e' una pendingUi attiva (tool `ask`), risponde a quella
			if (session.pendingUi) {
				const reqId = session.pendingUi.requestId;
				await session.handlePromptAnswer(reqId, { value: message });
			} else {
				// Altrimenti invia come prompt ordinario di continuazione
				await session.prompt(message);
			}

			// Notifica il motore nativo che l'esecuzione e' tornata attiva
			await this.sendUpdate({
				executionId,
				state: 'running',
				sessionId: session.sessionId ?? undefined
			});

			return true;
		} catch (err) {
			console.error(`[automations-runtime] Errore durante la ripresa di ${executionId}:`, err);
			try {
				await invoke('automations_resume_release', { executionId });
			} catch {
				// ignora errore su rilascio fallback
			}
			return false;
		}
	}


	/**
	 * Annulla un'esecuzione AI attiva, inviando abort e chiudendo il processo RPC.
	 */
	async cancelExecution(executionId: string): Promise<boolean> {
		const session = this.activeSessions.get(executionId);
		if (!session) return false;

		try {
			await session.abort();
			await session.close();
		} catch {
			// ignora errori durante abort
		}

		await this.sendUpdate({
			executionId,
			state: 'interrupted',
			reason: 'Annullato dall\'utente'
		});

		this.cleanupSession(executionId);
		this.activeSessions.delete(executionId);
		this.activeRequests.delete(executionId);
		return true;
	}

	/**
	 * Gestisce una richiesta di esecuzione AI proveniente dal motore nativo.
	 */
	private async handleAiRequest(request: AutomationAiRequest, isRehydration = false): Promise<void> {
		const executionId = request.executionId;
		if (this.activeSessions.has(executionId)) {
			return; // gia' in gestione
		}

		if (isRehydration) {
			// In reidratazione non riemettere prompt cieco su esecuzioni già terminali o riconciliate
			const snapshot = await invoke<AutomationSnapshot>('automations_snapshot').catch(() => null);
			if (snapshot) {
				const occ = snapshot.runs.find((r) => r.executions.some((e) => e.id === executionId));
				const exec = occ?.executions.find((e) => e.id === executionId);
				if (exec && (exec.state === 'completed' || exec.state === 'error' || exec.state === 'unknown' || exec.state === 'interrupted')) {
					return;
				}
			}
		}

		const action = request.definition.action;
		if (action.kind !== 'prompt') {
			console.warn(`[automations-runtime] Ricevuta richiesta AI per azione non prompt: ${action.kind}`);
			return;
		}

		// 1. Risoluzione modello e controllo Pay-As-You-Go
		const { model, preventPayg, maxCostUsd } = resolveActionModel(action);

		// 2. Costruzione prompt multiprogetto con preservazione skill/conferme
		const promptText = buildAutomationPrompt(request.definition, request.targets);

		// 3. Creazione sessione RPC isolata dedicata (AUT-025)
		// Nessun tab aperto, nessun focus rubato all'utente.
		const session = new AgentSession({
			cwd: request.cwd,
			scope: 'main',
			laneId: `auto-${executionId}`,
			projectKey: request.targets[0]?.path ?? request.cwd,
			automation: {
				id: request.definition.id,
				executionId,
				runId: request.runId,
				readOnly: false,
				projectPaths: request.targets.map((t) => t.path),
				allowedRoots: request.targets.map((t) => t.path),
				maxCostUsd,
				preventPayg,
				origin: request.definition.origin || 'automation',
				model
			}
		});

		this.activeSessions.set(executionId, session);
		this.activeRequests.set(executionId, request);
		const cleanups: Array<() => void> = [];
		this.sessionCleanups.set(executionId, cleanups);

		// 4. Apertura sessione RPC
		try {
			await session.open(null, { modelOverride: model });
			await session.waitUntilReady(10000);

			// Invia stato iniziale 'running' al motore nativo
			await this.sendUpdate({
				executionId,
				state: 'running',
				sessionId: session.sessionId ?? undefined,
				model: session.model?.id ?? model
			});
		} catch (openErr) {
			console.error(`[automations-runtime] Apertura sessione fallita per ${executionId}:`, openErr);
			await this.sendUpdate({
				executionId,
				state: 'error',
				reason: openErr instanceof Error ? openErr.message : String(openErr)
			});
			this.activeSessions.delete(executionId);
			this.activeRequests.delete(executionId);
			return;
		}

		// 5. Monitoraggio eventi per rilevamento fine reale, errori provider e domande utente
		let completedOrErrored = false;
		let lastPromptError: string | null = null;
		let wasAborted = false;

		const unsubscribeEvent = session.subscribeSessionEvent((event: AgentSessionEvent) => {
			if (completedOrErrored) return;

			// Rilevamento domande utente (tool `ask`) -> stato `needsInput` (AUT-028, AUT-044)
			if (event.type === 'extension_ui_request' || session.pendingUi) {
				const questionText = session.blockingQuestionText || 'In attesa di chiarimento dall\'utente';
				void this.sendUpdate({
					executionId,
					state: 'needsInput',
					question: questionText,
					sessionId: session.sessionId ?? undefined
				});
				return;
			}

			// omp://rpc.md:350–368: prompt_result porta lo status/error/cost_cap reale del modello
			if (event.type === 'prompt_result') {
				if (event.status === 'aborted') {
					wasAborted = true;
				} else if (event.status === 'error') {
					const failure = promptResultError(event);
					const rawErr = (event as Record<string, unknown>).error as Record<string, unknown> | undefined;
					const code = typeof rawErr?.code === 'string' ? rawErr.code : undefined;
					const msg = failure?.message || (typeof rawErr?.message === 'string' ? rawErr.message : 'Errore del provider');
					lastPromptError = code === 'cost_cap' ? `Tetto di spesa massimo raggiunto: ${msg}` : msg;
				}
			}

			// Rilevamento esito terminale effettivo (session_settled o agent_end terminale con quiete)
			// NOTA: turn_end NON e' la fine dell'occorrenza (AUT-041 / ACC-12).
			// provider failure produce normale terminal agent_end, ma errore registrato su prompt_result (AUT-088).
			if (event.type === 'session_settled') {
				if (session.pendingUi) return; // e' in attesa dell'utente
				completedOrErrored = true;

				if (wasAborted || session.exited) {
					void this.sendUpdate({
						executionId,
						state: 'interrupted',
						reason: 'Annullato dall\'utente',
						sessionId: session.sessionId ?? undefined
					}).then(() => this.finalizeSession(executionId, session));
					return;
				}

				if (lastPromptError) {
					void this.sendUpdate({
						executionId,
						state: 'error',
						reason: lastPromptError,
						sessionId: session.sessionId ?? undefined
					}).then(() => this.finalizeSession(executionId, session));
					return;
				}

				const resultText = session.lastAssistantText || undefined;
				void this.sendUpdate({
					executionId,
					state: 'completed',
					result: resultText,
					sessionId: session.sessionId ?? undefined
				}).then(() => this.finalizeSession(executionId, session));
				return;
			}

			if (event.type === 'agent_end' && event.isTerminal !== false) {
				// Se non c'e' lavoro residuo in background e non aspetta UI, verifica quiete
				if (!session.backgroundPending && !session.pendingUi) {
					setTimeout(() => {
						if (completedOrErrored || session.pendingUi || session.isStreaming) return;
						completedOrErrored = true;

						if (wasAborted || session.exited) {
							void this.sendUpdate({
								executionId,
								state: 'interrupted',
								reason: 'Annullato dall\'utente',
								sessionId: session.sessionId ?? undefined
							}).then(() => this.finalizeSession(executionId, session));
							return;
						}

						if (lastPromptError) {
							void this.sendUpdate({
								executionId,
								state: 'error',
								reason: lastPromptError,
								sessionId: session.sessionId ?? undefined
							}).then(() => this.finalizeSession(executionId, session));
							return;
						}

						const resultText = session.lastAssistantText || undefined;
						void this.sendUpdate({
							executionId,
							state: 'completed',
							result: resultText,
							sessionId: session.sessionId ?? undefined
						}).then(() => this.finalizeSession(executionId, session));
					}, 800);
				}
				return;
			}

			// Rilevamento errori di processo o crash
			if (event.type === 'studio_error' || (event.type === 'studio_exit' && event.exitCode !== 0)) {
				completedOrErrored = true;
				const reason = event.type === 'studio_error' ? event.error : `Processo terminato con codice ${event.exitCode}`;
				void this.sendUpdate({
					executionId,
					state: 'error',
					reason,
					sessionId: session.sessionId ?? undefined
				}).then(() => this.finalizeSession(executionId, session));
			}
		});

		cleanups.push(unsubscribeEvent);

		// 6. Titolo sessione wire prima del prompt secondo AUT-094 (regola + data, senza ulteriore AI)
		const sessionTitle = `${request.definition.name || 'Automazione'} - ${new Date().toLocaleString()}`;
		await session.setSessionName(sessionTitle);

		// 7. Invio prompt di avvio
		try {
			await session.prompt(promptText);
		} catch (promptErr) {
			console.error(`[automations-runtime] Invio prompt fallito per ${executionId}:`, promptErr);
			await this.sendUpdate({
				executionId,
				state: 'error',
				reason: promptErr instanceof Error ? promptErr.message : String(promptErr),
				sessionId: session.sessionId ?? undefined
			});
			this.finalizeSession(executionId, session);
		}
	}

	private finalizeSession(executionId: string, session: AgentSession) {
		void session.close();
		this.cleanupSession(executionId);
		this.activeSessions.delete(executionId);
		this.activeRequests.delete(executionId);
		this.cacheCompletedSession(executionId, session);
	}

	private cleanupSession(executionId: string) {
		const cleanups = this.sessionCleanups.get(executionId);
		if (cleanups) {
			for (const cleanup of cleanups) {
				try {
					cleanup();
				} catch {
					// ignora errori di cleanup
				}
			}
			this.sessionCleanups.delete(executionId);
		}
	}

	/**
	 * Invia un aggiornamento al motore nativo tramite il comando Tauri `automations_ai_update`.
	 */
	private async sendUpdate(update: AutomationAiUpdate): Promise<void> {
		try {
			await invoke('automations_ai_update', { update });
		} catch (err) {
			console.warn('[automations-runtime] Invio update fallito:', update, err);
		}
	}
}

// Singleton runtime
const runtimeInstance = new AutomationRuntimeManager();

// ============================================================================
// API PUBBLICHE DEL CONTRATTO (AUT-000A, Contratto riga 24)
// ============================================================================

/**
 * Avvia il runtime AI delle automazioni.
 */
export async function startAutomationRuntime(): Promise<() => void> {
	return await runtimeInstance.start();
}

/**
 * Ferma il runtime AI delle automazioni.
 */
export function stopAutomationRuntime(): void {
	runtimeInstance.stop();
}

/**
 * Recupera l'AgentSession di un'esecuzione specifica.
 */
export function getAutomationSession(executionId: string): AgentSession | undefined {
	return runtimeInstance.getSession(executionId);
}

/**
 * Carica la sessione per un'esecuzione (live se presente o reidratata dallo storico persistito).
 */
export async function loadAutomationSession(executionId: string): Promise<AgentSession | undefined> {
	return await runtimeInstance.loadSession(executionId);
}

/**
 * Mappa di tutte le sessioni di automazione in corso.
 */
export function getAllAutomationSessions(): ReadonlyMap<string, AgentSession> {
	return runtimeInstance.getAllSessions();
}

/**
 * Risponde a una domanda pendente riprendendo l'esecuzione AI.
 */
export async function resumeAutomationExecution(executionId: string, message: string): Promise<boolean> {
	return await runtimeInstance.resumeExecution(executionId, message);
}

/**
 * Annulla l'esecuzione AI indicata.
 */
export async function cancelAutomationExecution(executionId: string): Promise<boolean> {
	return await runtimeInstance.cancelExecution(executionId);
}

/**
 * Factory per creare agenti di automazione.
 * Supporta la modalità sola lettura (`readOnly: true`) utilizzata dall'assistente
 * di configurazione (WizardAssistant) per impedire scritture o esecuzioni arbitrarie.
 */
export function createAutomationAgent(options: {
	id?: string;
	cwd: string;
	projectPaths: string[];
	model: string;
	readOnly: boolean;
	maxCostUsd?: number;
	preventPayg?: boolean;
}): AgentSession {
	const primaryPath = options.projectPaths[0] ?? options.cwd;

	return new AgentSession({
		cwd: options.cwd,
		scope: 'main',
		laneId: options.id ? `helper-${options.id}` : `helper-${crypto.randomUUID()}`,
		projectKey: primaryPath,
		automation: {
			id: options.id,
			readOnly: options.readOnly,
			projectPaths: options.projectPaths,
			allowedRoots: options.projectPaths,
			maxCostUsd: options.maxCostUsd,
			preventPayg: options.preventPayg,
			origin: options.readOnly ? 'assistant' : 'automation',
			model: options.model
		}
	});
}

/**
 * Numero di esecuzioni AI attualmente attive (utile per gate e indicatori).
 */
export function getActiveAutomationAiCount(): number {
	return runtimeInstance.activeCount;
}

/**
 * Indica se il runtime AI e' in ascolto e operativo.
 */
export function isAutomationRuntimeRunning(): boolean {
	return runtimeInstance.isRunning;
}

/**
 * Verifica se un progetto e' attualmente occupato da una sessione AI di automazione attiva.
 */
export function isProjectActiveInAutomation(projectPath: string, excludingExecutionId?: string): boolean {
	const norm = projectPath.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
	for (const [execId, session] of runtimeInstance.getAllSessions().entries()) {
		if (excludingExecutionId && execId === excludingExecutionId) continue;
		const roots = session.automationConfig?.allowedRoots ?? [session.cwd];
		for (const root of roots) {
			const normRoot = root.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
			if (normRoot === norm) return true;
		}
	}
	return false;
}
