/**
 * Comandi remoti per l'accesso allo storico delle sessioni (Gate R44 / Fleet).
 *
 * Implementa list_sessions e session_history in modalita' di sola lettura:
 * - list_sessions: unifica sessioni della Principale, worktree attivi e storico dei lanci task;
 * - session_history: recupera i messaggi di una sessione verificando che appartenga
 *   al progetto prima della lettura, senza aprire ne' alterare l'AgentSession attiva.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
	RemoteChatMessage,
	RemoteChatPage,
	RemoteSessionPage,
	RemoteSessionSummary
} from '$remote-protocol';
import { projectStore } from '#lib/stores/projects.svelte.ts';
import { laneStore } from '#lib/stores/lanes.svelte.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { taskStore, type TaskSessionOrigin } from '#lib/stores/tasks.svelte.ts';
import { fetchSessionsList, type SessionEntry } from '#lib/agent/sessionsList.ts';
import { classifySystemMessage } from '#lib/agent/notices.ts';
import { RemoteCommandFailure } from './commands';
import { entryToRemoteMessage } from './chatProjection';
import type { ProjectId } from '#lib/types/lanes.ts';
import type {
	TranscriptEntry,
	UserEntry,
	AssistantEntry,
	ToolEntry,
	CompactionEntry,
	NoticeEntry,
	SubagentResultEntry,
	SystemChipEntry,
	Block
} from '#lib/agent/session.svelte.ts';
import type { AgentToolResult, MessageUsage } from '#lib/agent/wire.ts';
import { paginateRemoteMessages } from './chatPaging';
function textOf(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((c) => {
				if (c && typeof c === 'object' && 'type' in c && c.type === 'text' && typeof c.text === 'string') {
					return c.text;
				}
				return '';
			})
			.filter(Boolean)
			.join('\n');
	}
	return '';
}

function imagesOf(content: unknown): Array<{ data: string; mimeType: string }> {
	if (!Array.isArray(content)) return [];
	const images: Array<{ data: string; mimeType: string }> = [];
	for (const item of content) {
		if (item && typeof item === 'object' && item.type === 'image' && typeof item.data === 'string') {
			images.push({
				data: item.data,
				mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'image/png'
			});
		}
	}
	return images;
}

/**
 * Converte i messaggi grezzi letti dal transcript JSONL in TranscriptEntry
 * per consentire a entryToRemoteMessage di proiettarli in RemoteChatMessage.
 */
export function rawMessagesToTranscriptEntries(
	rawMessages: Array<Record<string, unknown>>
): TranscriptEntry[] {
	let nextId = 1;
	const entries: TranscriptEntry[] = [];
	const toolsMap = new Map<string, ToolEntry>();

	for (const msg of rawMessages) {
		const role = typeof msg.role === 'string' ? msg.role : '';

		if (role === 'user') {
			const userEntry: UserEntry = {
				id: nextId++,
				kind: 'user',
				content: textOf(msg.content),
				images: imagesOf(msg.content),
				attribution: typeof msg.attribution === 'string' ? msg.attribution : undefined,
				messageTs: typeof msg.timestamp === 'number' ? msg.timestamp : undefined
			};
			entries.push(userEntry);
			continue;
		}

		if (role === 'assistant') {
			const content = Array.isArray(msg.content) ? msg.content : [];
			const currentBlocks: Block[] = [];
			const flush = (isLast: boolean) => {
				if (currentBlocks.length === 0) return;
				const assistantEntry: AssistantEntry = {
					id: nextId++,
					kind: 'assistant',
					blocks: [...currentBlocks],
					model: typeof msg.model === 'string' ? msg.model : undefined,
					usage: isLast ? (msg.usage as MessageUsage | undefined) : undefined,
					stopReason: isLast ? (typeof msg.stopReason === 'string' ? msg.stopReason : undefined) : undefined,
					messageTs: typeof msg.timestamp === 'number' ? msg.timestamp : undefined
				};
				entries.push(assistantEntry);
				currentBlocks.length = 0;
			};

			for (let i = 0; i < content.length; i++) {
				const b = content[i];
				if (b && typeof b === 'object') {
					if (b.type === 'text' && typeof b.text === 'string') {
						currentBlocks.push({ type: 'text', text: b.text });
					} else if (b.type === 'thinking' && typeof b.thinking === 'string') {
						currentBlocks.push({ type: 'thinking', text: b.thinking });
					} else if (b.type === 'image' && typeof b.data === 'string') {
						currentBlocks.push({
							type: 'image',
							data: b.data,
							mimeType: typeof b.mimeType === 'string' ? b.mimeType : 'image/png'
						});
					} else if (b.type === 'toolCall' && typeof b.id === 'string' && typeof b.name === 'string') {
						const hasSubsequent = content
							.slice(i + 1)
							.some((sub) => sub && typeof sub === 'object' && (sub.type === 'text' || sub.type === 'thinking' || sub.type === 'image'));
						flush(!hasSubsequent);
						const toolEntry: ToolEntry = {
							id: nextId++,
							kind: 'tool',
							toolCallId: b.id,
							toolName: b.name,
							args: b.arguments && typeof b.arguments === 'object' ? (b.arguments as Record<string, unknown>) : {},
							intent:
								typeof b.intent === 'string'
									? b.intent
									: b.arguments && typeof b.arguments === 'object' && typeof (b.arguments as Record<string, unknown>).i === 'string'
										? ((b.arguments as Record<string, unknown>).i as string)
										: undefined,
							running: false,
							startedAt: typeof msg.timestamp === 'number' ? msg.timestamp : 0
						};
						entries.push(toolEntry);
						toolsMap.set(b.id, toolEntry);
					}
				}
			}
			flush(true);
			continue;
		}

		if (role === 'toolResult' && typeof msg.toolCallId === 'string') {
			const existing = toolsMap.get(msg.toolCallId);
			const result: AgentToolResult = {
				content: Array.isArray(msg.content) ? msg.content : undefined,
				details: msg.details,
				isError: msg.isError === true
			};
			if (existing) {
				existing.result = result;
				existing.endedAt = typeof msg.timestamp === 'number' ? msg.timestamp : undefined;
			} else {
				const orphanEntry: ToolEntry = {
					id: nextId++,
					kind: 'tool',
					toolCallId: msg.toolCallId,
					toolName: typeof msg.toolName === 'string' ? msg.toolName : 'tool',
					args: {},
					result,
					running: false,
					startedAt: typeof msg.timestamp === 'number' ? msg.timestamp : 0,
					endedAt: typeof msg.timestamp === 'number' ? msg.timestamp : undefined
				};
				entries.push(orphanEntry);
			}
			continue;
		}

		if (role === 'compactionSummary' || (typeof msg.summary === 'string' && !msg.role) || msg.type === 'compaction') {
			let summaryText = 'Contesto compattato';
			if (typeof msg.tokensBefore === 'number' && typeof msg.tokensAfter === 'number') {
				const saved = msg.tokensBefore - msg.tokensAfter;
				summaryText = saved > 0
					? `Contesto compattato (-${saved} token)`
					: `Contesto compattato (${msg.tokensAfter} token)`;
			} else if (typeof msg.shortSummary === 'string' && msg.shortSummary.trim()) {
				summaryText = `Contesto compattato: ${msg.shortSummary.trim()}`;
			} else if (typeof msg.summary === 'string' && msg.summary.trim()) {
				summaryText = `Contesto compattato: ${msg.summary.trim()}`;
			}
			const compactionEntry: CompactionEntry = {
				id: nextId++,
				kind: 'compaction',
				message: summaryText,
				running: false,
				summary: typeof msg.summary === 'string' ? msg.summary : undefined,
				shortSummary: typeof msg.shortSummary === 'string' ? msg.shortSummary : undefined,
				tokensBefore: typeof msg.tokensBefore === 'number' ? msg.tokensBefore : undefined,
				tokensAfter: typeof msg.tokensAfter === 'number' ? msg.tokensAfter : undefined
			};
			entries.push(compactionEntry);
			continue;
		}

		if (role === 'custom' || role === 'developer' || role === 'system') {
			const text = textOf(msg.content) || (typeof msg.data === 'string' ? msg.data : '');
			const classified = classifySystemMessage({
				role,
				customType: typeof msg.customType === 'string' ? msg.customType : undefined,
				display: typeof msg.display === 'boolean' ? msg.display : undefined,
				details: msg.details,
				text
			});
			if (classified) {
				if (classified.kind === 'subagent-result') {
					const subEntry: SubagentResultEntry = {
						id: nextId++,
						kind: 'subagent-result',
						jobs: classified.jobs
					};
					entries.push(subEntry);
				} else if (classified.kind === 'chip') {
					const chipEntry: SystemChipEntry = {
						id: nextId++,
						kind: 'system-chip',
						customType: classified.customType,
						title: classified.title,
						body: classified.body,
						internal: false
					};
					entries.push(chipEntry);
				}
			} else if (text.trim()) {
				const noticeEntry: NoticeEntry = {
					id: nextId++,
					kind: 'notice',
					level: 'info',
					message: text.trim()
				};
				entries.push(noticeEntry);
			}
		}
	}

	return entries;
}

/**
 * Restituisce l'elenco paginato delle sessioni di un progetto, includendo
 * la Principale, i worktree attivi e le sessioni persistite dei task storici.
 */
export async function listRemoteSessions(
	projectId: string,
	before: string | null,
	limit: number,
	query?: string
): Promise<RemoteSessionPage> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const canonicalPath = project.canonicalProjectPath || project.id;

	// Raccogli tutte le radici note (principale + worktree attivi e storici)
	const worktreePaths = new Set<string>();
	const projectLanes = laneStore.lanesFor(project.id as ProjectId);
	for (const lane of projectLanes) {
		// Le corsie worktree hanno kind === 'git' e laneId diverso da 'main'
		if (lane.kind === 'git' && lane.laneId !== 'main' && lane.workspacePath) {
			worktreePaths.add(lane.workspacePath);
		}
	}
	const taskOrigins = taskStore.originsFor(canonicalPath);
	for (const origin of taskOrigins) {
		if (origin.workspacePath) {
			worktreePaths.add(origin.workspacePath);
		}
	}

	const trimmedQuery = query?.trim() || '';
	const sessionsMap = new Map<string, { entry?: SessionEntry; origin?: TaskSessionOrigin }>();

	// 1. Sessioni del percorso principale
	try {
		const mainEntries = trimmedQuery
			? await invoke<SessionEntry[]>('sessions_search', { query: trimmedQuery, projectPath: canonicalPath })
			: await fetchSessionsList(canonicalPath);
		for (const e of mainEntries) {
			sessionsMap.set(e.id, { entry: e });
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RemoteCommandFailure('failed', `Errore lettura sessioni principali: ${msg}`);
	}

	// 2. Sessioni dei worktree noti
	for (const wtPath of worktreePaths) {
		try {
			const wtEntries = trimmedQuery
				? await invoke<SessionEntry[]>('sessions_search', { query: trimmedQuery, projectPath: wtPath })
				: await fetchSessionsList(wtPath);
			for (const e of wtEntries) {
				const existing = sessionsMap.get(e.id);
				if (existing) {
					if (!existing.entry) existing.entry = e;
				} else {
					sessionsMap.set(e.id, { entry: e });
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new RemoteCommandFailure('failed', `Errore lettura sessioni del worktree "${wtPath}": ${msg}`);
		}
	}

	// 3. Task origins persistiti
	for (const origin of taskOrigins) {
		if (trimmedQuery) {
			const lowerQ = trimmedQuery.toLowerCase();
			const matchTitle = origin.title.toLowerCase().includes(lowerQ);
			const matchPrompt = origin.prompt?.toLowerCase().includes(lowerQ);
			if (!matchTitle && !matchPrompt) continue;
		}
		const existing = sessionsMap.get(origin.sessionId);
		if (existing) {
			existing.origin = origin;
		} else {
			sessionsMap.set(origin.sessionId, { origin });
		}
	}

	// Costruisci i summary
	const summaries: RemoteSessionSummary[] = [];
	for (const [sessionId, data] of sessionsMap.entries()) {
		const entry = data.entry;
		const origin = data.origin;
		const run = taskStore.taskRunFor(canonicalPath, sessionId);
		const laneRecord = projectLanes.find((l) => l.sessionId === sessionId);

		const createdAt = origin?.launchedAt ?? (entry ? entry.created_at * 1000 : Date.now());
		const title = entry?.title ?? origin?.title ?? null;
		const prompt = entry?.prompt ?? origin?.prompt ?? '';
		const laneId = run?.laneId ?? origin?.laneId ?? laneRecord?.laneId ?? null;
		const laneTitle = run?.laneTitle ?? origin?.laneTitle ?? laneRecord?.title ?? null;

		summaries.push({
			sessionId,
			title,
			prompt,
			createdAt,
			laneId,
			laneTitle
		});
	}

	// Ordina dalla piu' recente alla piu' vecchia
	summaries.sort((a, b) => b.createdAt - a.createdAt);

	// Paginazione con cursore before
	const clampedLimit = Math.max(1, Math.min(limit || 20, 100));
	let startIndex = 0;
	if (before !== null) {
		const targetIndex = summaries.findIndex((s) => s.sessionId === before);
		if (targetIndex < 0) {
			throw new RemoteCommandFailure('rejected', "L'elenco delle sessioni e cambiato. Ricarica lo storico.");
		}
		startIndex = targetIndex + 1;
	}

	const page = summaries.slice(startIndex, startIndex + clampedLimit);
	const nextBefore =
		startIndex + clampedLimit < summaries.length && page.length > 0
			? page[page.length - 1].sessionId
			: null;

	return {
		sessions: page,
		before: nextBefore
	};
}

/**
 * Restituisce una pagina di storico dei messaggi per una sessione persistita.
 * Non apre ne' altera la sessione attiva di Studio.
 */
export async function remoteSessionHistory(
	projectId: string,
	sessionId: string,
	before: string | null,
	limit: number
): Promise<RemoteChatPage> {
	if (!sessionId || typeof sessionId !== 'string') {
		throw new RemoteCommandFailure('not_found', 'Identificatore di sessione non valido');
	}

	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const canonicalPath = project.canonicalProjectPath || project.id;
	const worktreePaths = new Set<string>();
	const projectLanes = laneStore.lanesFor(project.id as ProjectId);
	for (const lane of projectLanes) {
		if (lane.kind === 'git' && lane.laneId !== 'main' && lane.workspacePath) {
			worktreePaths.add(lane.workspacePath);
		}
	}
	const taskOrigins = taskStore.originsFor(canonicalPath);
	for (const origin of taskOrigins) {
		if (origin.workspacePath) {
			worktreePaths.add(origin.workspacePath);
		}
	}

	// Controlla se la sessione richiesta e' quella attualmente aperta in memoria
	let activeEntries: TranscriptEntry[] | null = null;
	const activeMain = sessionRegistry.getMainSession(projectId);
	if (activeMain && activeMain.sessionId === sessionId && activeMain.entries) {
		activeEntries = activeMain.entries;
	} else {
		for (const lane of projectLanes) {
			const laneSession = sessionRegistry.getLaneSession(projectId, lane.laneId);
			if (laneSession && laneSession.sessionId === sessionId && laneSession.entries) {
				activeEntries = laneSession.entries;
				break;
			}
		}
	}

	let allEntries: TranscriptEntry[] = [];
	if (activeEntries) {
		allEntries = activeEntries;
	} else {
		// Recupero in sola lettura da Rust backend con autorizzazione rigorosa
		try {
			const rawMessages = await invoke<Array<Record<string, unknown>>>('read_historical_session_messages', {
				projectPath: canonicalPath,
				sessionId,
				knownWorktreePaths: Array.from(worktreePaths)
			});
			allEntries = rawMessagesToTranscriptEntries(rawMessages);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new RemoteCommandFailure('failed', `Lettura della sessione "${sessionId}" fallita: ${message}`);
		}
	}

	const allMessages: RemoteChatMessage[] = [];
	for (const entry of allEntries) {
		const msg = entryToRemoteMessage(entry);
		if (msg) allMessages.push(msg);
	}

	return paginateRemoteMessages(allMessages, before, limit);
}
