import {
	CompanionConversationError,
	type CompanionAssistantMessage,
	type CompanionAssistantReference,
	type CompanionConversationSnapshot,
	type CompanionConversationTarget,
	type CompanionConversationFailureCode
} from './conversation';
import type { TranscriptEntry, AssistantEntry } from '$lib/agent/session.svelte';
import type { SessionRegistry, AgentSessionLike } from '$lib/agent/sessionRegistry';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import { projectStore } from '$lib/stores/projects.svelte';
import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface CompanionHostOptions {
	registry?: SessionRegistry;
	onSlashCommand?: (projectId: string, laneId: string, raw: string) => boolean;
	emitFn?: <T>(event: string, payload: T) => Promise<void>;
	listenFn?: <T>(event: string, handler: (event: { payload: T }) => void) => Promise<UnlistenFn>;
}

export interface CompanionSendOptions {
	registry?: SessionRegistry;
	onSlashCommand?: (projectId: string, laneId: string, raw: string) => boolean;
}

function isPlanHandingOff(session: unknown): boolean {
	if (!session || typeof session !== 'object' || !('plan' in session)) return false;
	const plan = session.plan;
	if (!plan || typeof plan !== 'object' || !('handingOff' in plan)) return false;
	return Boolean((plan as { handingOff?: unknown }).handingOff);
}

function isSessionClosed(session: unknown): boolean {
	if (!session || typeof session !== 'object' || !('isOpen' in session)) return false;
	return (session as { isOpen?: unknown }).isOpen === false;
}

function latestConcludedAssistant(
	entries: readonly TranscriptEntry[],
	isStreaming = false,
	agentState?: string
): AssistantEntry | null {
	if (isStreaming || agentState === 'working') return null;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.kind === 'user') return null;
		if (entry.kind !== 'assistant') continue;
		if (entry.stopReason === 'error' || entry.stopReason === 'aborted' ||
			entry.stopReason === 'toolUse' || entry.stopReason === 'tool_use') return null;
		return entry.blocks.some((block) => block.type === 'text' && /\S/.test(block.text)) ? entry : null;
	}
	return null;
}

function assistantIdentity(entry: AssistantEntry): string {
	// mapHistory riassegna gli id locali; il timestamp del messaggio sopravvive al rebuild.
	return entry.messageTs && entry.messageTs > 0 ? `ts:${entry.messageTs}` : `entry:${entry.id}`;
}

/** Testo completo solo su richiesta, senza thinking, tool intermedi o turni interrotti. */
export function extractLatestAssistantMessage(
	entries: readonly TranscriptEntry[],
	isStreaming = false,
	agentState?: string
): { message: CompanionAssistantMessage; reference: CompanionAssistantReference } | null {
	const entry = latestConcludedAssistant(entries, isStreaming, agentState);
	if (!entry) return null;
	const message = {
		id: assistantIdentity(entry),
		at: entry.messageTs && entry.messageTs > 0 ? entry.messageTs : 0,
		text: entry.blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
	};
	return {
		message,
		reference: { laneId: '', sessionId: '', messageId: message.id, at: message.at }
	};
}

/** Il digest frequente legge solo i metadati: non ricopia la risposta completa. */
export function resolveLatestAssistantReference(session: {
	entries?: readonly TranscriptEntry[];
	isStreaming?: boolean;
	agentState?: string;
	laneId?: string | null;
	sessionId?: string | null;
}): CompanionAssistantReference | undefined {
	if (!session.sessionId || !session.entries) return undefined;
	const entry = latestConcludedAssistant(session.entries, session.isStreaming, session.agentState);
	if (!entry) return undefined;
	return {
		laneId: session.laneId ?? 'main',
		sessionId: session.sessionId,
		messageId: assistantIdentity(entry),
		at: entry.messageTs && entry.messageTs > 0 ? entry.messageTs : 0
	};
}

function assertLiveConversation(
	registry: SessionRegistry,
	projectId: string,
	laneId: string,
	sessionId: string,
	session: AgentSessionLike
) {
	if (registry.getLaneSession(projectId, laneId) !== session || session.sessionId !== sessionId) {
		throw new CompanionConversationError('session_changed', "La conversazione attiva e' cambiata. Ricaricala prima di inviare.");
	}
	if (session.pendingUi) {
		throw new CompanionConversationError('unavailable', 'Rispondi alla domanda in attesa prima di inviare un altro messaggio.');
	}
	if (isPlanHandingOff(session)) {
		throw new CompanionConversationError('unavailable', 'Passaggio di compito in corso');
	}
}

/**
 * Legge lo snapshot della conversazione per una specifica corsia/progetto direttamente
 * dal registro delle sessioni attivo nella finestra principale di Studio.
 */
export async function readConversationSnapshot(
	projectId: string,
	laneId: string = 'main',
	registry: SessionRegistry = sessionRegistry
): Promise<CompanionConversationSnapshot> {
	const project = projectStore.projects.find((p) => p.id.toLowerCase() === projectId.toLowerCase());
	if (!project) {
		throw new CompanionConversationError('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId.toLowerCase() === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new CompanionConversationError(
			'not_found',
			`Corsia "${effectiveLaneId}" non trovata nel progetto "${project.id}"`
		);
	}

	const surface = project.lane.laneId === effectiveLaneId ? project.lane.surface : (lane?.surface ?? 'gui');

	const session = registry.getLaneSession(project.id, effectiveLaneId);
	const sessionId = session?.sessionId ?? null;

	let canSend = Boolean(sessionId);
	let sendBlockReason: string | undefined = sessionId ? undefined : 'Nessuna sessione attiva per questo progetto.';

	if (surface === 'terminal') {
		canSend = false;
		sendBlockReason = "L'invio di messaggi non e' disponibile per corsie su terminale.";
	} else if (session?.pendingUi) {
		canSend = false;
		sendBlockReason = 'In attesa di risposta alla domanda';
	} else if (isPlanHandingOff(session)) {
		canSend = false;
		sendBlockReason = 'Passaggio di compito in corso';
	}

	let message: CompanionAssistantMessage | null = null;
	if (session && session.entries) {
		const extracted = extractLatestAssistantMessage(session.entries, session.isStreaming, session.agentState);
		message = extracted?.message ?? null;
	}

	return {
		projectId: project.id,
		laneId: effectiveLaneId,
		sessionId,
		message,
		canSend,
		sendBlockReason
	};
}

/**
 * Invia un messaggio o comando alla sessione della corsia indicata, garantendo la corrispondenza
 * rigorosa dell'identita' di sessione (fail-closed se la sessione e' cambiata o ambigua).
 */
export async function sendConversationToSession(
	target: CompanionConversationTarget,
	text: string,
	options: CompanionSendOptions = {}
): Promise<void> {
	const trimmed = (text ?? '').trim();
	if (!trimmed) {
		throw new CompanionConversationError('failed', "Il messaggio non puo' essere vuoto");
	}

	const project = projectStore.projects.find((p) => p.id.toLowerCase() === target.projectId.toLowerCase());
	if (!project) {
		throw new CompanionConversationError('not_found', `Progetto "${target.projectId}" non trovato`);
	}

	const isMain = !target.laneId || target.laneId.toLowerCase() === 'main';
	const effectiveLaneId = isMain ? 'main' : target.laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new CompanionConversationError(
			'not_found',
			`Corsia "${target.laneId}" non trovata nel progetto "${project.id}"`
		);
	}

	const surface = project.lane.laneId === effectiveLaneId ? project.lane.surface : (lane?.surface ?? 'gui');
	if (surface === 'terminal') {
		throw new CompanionConversationError(
			'unavailable',
			"L'invio di messaggi non e' disponibile per corsie su terminale."
		);
	}

	if (lane?.kind === 'lab' && !lane.labPrototypeId) {
		throw new CompanionConversationError('failed', 'La corsia Laboratorio non ha un prototipo associato valido.');
	}

	const registry = options.registry ?? sessionRegistry;
	const session = registry.getLaneSession(project.id, effectiveLaneId);
	if (!session) {
		throw new CompanionConversationError(
			'not_found',
			`Nessuna sessione trovata per la corsia "${effectiveLaneId}" nel progetto "${project.id}"`
		);
	}

	// Verifica rigorosa identita' prima di qualsiasi await
	if (!session.sessionId || session.sessionId !== target.sessionId) {
		throw new CompanionConversationError(
			'session_changed',
			`La sessione attiva (${session.sessionId ?? 'nessuna'}) non corrisponde alla sessione letta (${target.sessionId})`
		);
	}
	assertLiveConversation(registry, project.id, effectiveLaneId, target.sessionId, session);

	// Se la sessione e' chiusa, prova ad aprirla verificando l'identita' prima e dopo l'apertura
	if (isSessionClosed(session)) {
		if (typeof session.open === 'function') {
			await session.open(target.sessionId);
			// Controllo identita' post-await: nessun rebind silenzioso a un'altra sessione
			if (session.sessionId !== target.sessionId) {
				throw new CompanionConversationError(
					'session_changed',
					`La sessione e' cambiata durante l'apertura (${session.sessionId ?? 'nessuna'} != ${target.sessionId})`
				);
			}
		} else {
			throw new CompanionConversationError('unavailable', 'Sessione chiusa e non riapribile');
		}
	}
	assertLiveConversation(registry, project.id, effectiveLaneId, target.sessionId, session);

	// Verifica se e' un comando slash gestito dalla superficie GUI di Studio
	if (trimmed.startsWith('/')) {
		if (options.onSlashCommand) {
			const handled = options.onSlashCommand(project.id, effectiveLaneId, trimmed);
			if (handled) {
				return;
			}
		}
	}

	// Slash custom (come /pubblica-progetto adesso) o testo normale: inoltra a session.prompt
	if (typeof session.prompt !== 'function') {
		throw new CompanionConversationError('unavailable', "La sessione non supporta l'invio di messaggi");
	}

	// Controllo identita' prima della consegna
	if (session.sessionId !== target.sessionId) {
		throw new CompanionConversationError(
			'session_changed',
			`La sessione e' cambiata prima dell'invio (${session.sessionId ?? 'nessuna'} != ${target.sessionId})`
		);
	}

	const behavior = session.isStreaming ? 'steer' : 'followUp';
	try {
		const result = await session.prompt(trimmed, [], behavior);
		if (result === 'failed') {
			throw new CompanionConversationError('failed', 'Impossibile inviare il messaggio alla sessione');
		}
		if (result === 'empty') {
			throw new CompanionConversationError('failed', 'Messaggio vuoto non accettato dalla sessione');
		}
	} catch (err) {
		if (err instanceof CompanionConversationError) {
			throw err;
		}
		throw new CompanionConversationError(
			'failed',
			`Errore durante l'invio: ${err instanceof Error ? err.message : String(err)}`
		);
	}
}

/**
 * Registra gli handler host per gestire le richieste IPC provenienti dalla finestra Companion.
 * Restituisce una funzione di pulizia (unlisten).
 */
export function setupCompanionConversationHost(options: CompanionHostOptions = {}): () => void {
	const registry = options.registry ?? sessionRegistry;
	const emitEvent = options.emitFn ?? emit;
	const listenEvent = options.listenFn ?? listen;

	const unlisteners: UnlistenFn[] = [];
	let disposed = false;

	// Richiesta di snapshot della conversazione da Companion
	void listenEvent<{ correlationId: string; projectId: string; laneId?: string }>(
		'companion-load-conversation-req',
		async (event) => {
			if (disposed || !event.payload?.correlationId) return;
			const { correlationId, projectId, laneId } = event.payload;
			try {
				const snapshot = await readConversationSnapshot(projectId, laneId, registry);
				if (disposed) return;
				await emitEvent('companion-load-conversation-res', {
					correlationId,
					snapshot
				});
			} catch (err) {
				if (disposed) return;
				const failure =
					err instanceof CompanionConversationError
						? err
						: new CompanionConversationError('failed', err instanceof Error ? err.message : String(err));
				await emitEvent('companion-load-conversation-res', {
					correlationId,
					error: {
						code: failure.code,
						message: failure.message
					}
				});
			}
		}
	).then((unlisten) => {
		if (disposed) unlisten();
		else unlisteners.push(unlisten);
	});

	// Richiesta di invio messaggio a una specifica sessione da Companion
	void listenEvent<{ correlationId: string; target: CompanionConversationTarget; text: string }>(
		'companion-send-conversation-req',
		async (event) => {
			if (disposed || !event.payload?.correlationId) return;
			const { correlationId, target, text } = event.payload;
			try {
				await sendConversationToSession(target, text, {
					registry,
					onSlashCommand: options.onSlashCommand
				});
				if (disposed) return;
				await emitEvent('companion-send-conversation-res', {
					correlationId,
					ok: true
				});
			} catch (err) {
				if (disposed) return;
				const failure =
					err instanceof CompanionConversationError
						? err
						: new CompanionConversationError('failed', err instanceof Error ? err.message : String(err));
				await emitEvent('companion-send-conversation-res', {
					correlationId,
					error: {
						code: failure.code,
						message: failure.message
					}
				});
			}
		}
	).then((unlisten) => {
		if (disposed) unlisten();
		else unlisteners.push(unlisten);
	});

	return () => {
		disposed = true;
		for (const u of unlisteners) {
			u();
		}
		unlisteners.length = 0;
	};
}
