/**
 * Proiezione pura delle voci del transcript di Studio (TranscriptEntry) nei
 * messaggi canonici del controllo remoto (RemoteChatMessage) per PWA e relay.
 *
 * Unico mapper condiviso sia dallo storico (remoteChatHistory) sia dagli eventi
 * dal vivo (session.svelte.ts), garantendo che gli ID dei messaggi siano stabili
 * e identici in entrambi i contesti.
 */

import type {
	RemoteChatMessage,
	RemoteChatBlock,
	RemoteToolCall,
	RemoteTodoItem
} from '$remote-protocol';
import type {
	TranscriptEntry,
	UserEntry,
	AssistantEntry,
	ToolEntry
} from '#lib/agent/session.svelte.ts';
import { categorizeTool } from '#lib/agent/tools/categories.ts';
import { artifactForToolEntry } from './artifacts';
import { asRecord, resultText, str, recordList } from '#lib/agent/tools/types.ts';
import { extractPhasesFromCall } from '#lib/agent/todoTrace.ts';
import { stripEditorContext } from '#lib/editor/editorContextParsing.ts';

export const MAX_DIFF_LINES = 300;
export const MAX_DIFF_BYTES = 24 * 1024; // 24 KB
export const MAX_OUTPUT_LINES = 60;
export const MAX_OUTPUT_BYTES = 8 * 1024; // 8 KB
export const MAX_BLOCK_TEXT_CHARS = 30_000;
export const MAX_PROSE_TEXT_CHARS = 30_000;
export const MAX_META_TEXT_CHARS = 500;

/**
 * Tronca il diff omp a un massimo di righe e byte.
 */
export function truncateDiff(
	diff: string | null | undefined,
	maxLines = MAX_DIFF_LINES,
	maxBytes = MAX_DIFF_BYTES
): string | null {
	if (!diff || typeof diff !== 'string') return null;
	let text = diff;
	if (text.length > maxBytes) {
		text = text.slice(0, maxBytes);
	}
	const lines = text.split('\n');
	if (lines.length > maxLines) {
		return lines.slice(0, maxLines).join('\n') + '\n...';
	}
	return text;
}

/**
 * Tronca l'output prendendone la coda (tail) fino a un massimo di righe e byte.
 */
export function truncateTail(
	output: string | null | undefined,
	maxLines = MAX_OUTPUT_LINES,
	maxBytes = MAX_OUTPUT_BYTES
): string | null {
	if (!output || typeof output !== 'string') return null;
	const trimmed = output.trim();
	if (!trimmed) return null;
	let text = trimmed;
	if (text.length > maxBytes) {
		text = text.slice(-maxBytes);
	}
	const lines = text.split('\n');
	if (lines.length > maxLines) {
		return lines.slice(-maxLines).join('\n');
	}
	return text;
}

/**
 * Regola per gli identificatori dei messaggi remoti:
 * - I tool usano il `toolCallId` (stabile tra start, end e storico);
 * - Tutte le altre voci usano l'id numerico interno con prefisso `e_${id}`.
 */
export function remoteMessageId(entry: { id: number; kind: string; toolCallId?: string }): string {
	if (entry.kind === 'tool' && entry.toolCallId) {
		return entry.toolCallId;
	}
	return `e_${entry.id}`;
}

/**
 * Estrae l'elenco dei task per il tool `todo`.
 */
function extractRemoteTodos(entry: ToolEntry): RemoteTodoItem[] | null {
	let { phases } = extractPhasesFromCall({ args: entry.args, result: entry.result });
	if (phases.length === 0 && entry.args) {
		const flatItems = recordList(entry.args.items);
		if (flatItems.length > 0) {
			phases = [
				{
					name: str(entry.args.phase) ?? 'Attività',
					tasks: flatItems.map((t, idx) => ({
						content: str(t.task) ?? str(t.content) ?? (typeof t === 'string' ? t : `Attività ${idx + 1}`),
						status: 'pending'
					}))
				}
			];
		}
	}

	const todos: RemoteTodoItem[] = [];
	for (const phase of phases) {
		for (const task of phase.tasks) {
			let status: RemoteTodoItem['status'] = 'pending';
			if (task.status === 'completed' || task.status === 'in_progress' || task.status === 'abandoned') {
				status = task.status;
			}
			todos.push({
				text: task.content,
				status
			});
		}
	}
	return todos.length > 0 ? todos : null;
}

/**
 * Costruisce l'oggetto `RemoteToolCall` per un'entry di tipo tool.
 */
function buildRemoteToolCall(entry: ToolEntry): RemoteToolCall {
	const summary = categorizeTool({
		toolName: entry.toolName,
		args: entry.args,
		result: entry.result,
		running: entry.running
	});

	const isError = entry.result?.isError === true || summary.fail === true;
	const status: RemoteToolCall['status'] = entry.running ? 'running' : isError ? 'error' : 'ok';
	const errorReason = summary.errorReason ?? (isError ? (summary.meta || 'Errore') : null);

	const details = asRecord(entry.result?.details);
	const rawDiff = str(details?.diff);
	const diff = truncateDiff(rawDiff);

	// Output testuale: solo se non c'e' gia' un diff strutturato (per non duplicare)
	let output: string | null = null;
	if (!diff) {
		output = truncateTail(resultText(entry.result));
	}

	const todos = entry.toolName === 'todo' ? extractRemoteTodos(entry) : null;
	const artifact = artifactForToolEntry(entry);

	const now = Date.now();
	const startedAt = typeof entry.startedAt === 'number' ? entry.startedAt : now;
	const endedAt = entry.running ? null : typeof entry.endedAt === 'number' ? entry.endedAt : startedAt;

	return {
		category: summary.category,
		label: summary.label,
		detail: summary.detail ?? null,
		meta: summary.meta ?? null,
		intent: entry.intent?.trim() || null,
		status,
		errorReason,
		startedAt,
		endedAt,
		diffStats: summary.diff ?? null,
		diff,
		output,
		todos,
		// Solo quando c'e': i tool senza anteprima non pagano un campo in piu' per messaggio.
		...(artifact ? { artifact } : {})
	};
}

/**
 * Converte una TranscriptEntry di Studio in un RemoteChatMessage.
 * Restituisce `null` per le entry interne che non fanno parte della conversazione remota.
 */
export function entryToRemoteMessage(
	entry: TranscriptEntry,
	options: { live?: boolean } = {}
): RemoteChatMessage | null {
	const durableId = remoteMessageId(entry);

	if (entry.kind === 'user') {
		const user = entry as UserEntry;
		const imgCount = user.images?.length ?? 0;
		let imagePreviews: Array<{ data: string; mimeType: string }> | undefined = undefined;
		// imagePreviews vengono inclusi solo per eventi live, per proteggere il budget delle pagine chat_history
		if (options.live && user.images && user.images.length > 0) {
			const totalSize = user.images.reduce((acc, img) => acc + (img.data?.length ?? 0), 0);
			if (totalSize <= 250_000) {
				imagePreviews = user.images.map((img) => ({ data: img.data, mimeType: img.mimeType }));
			}
		}
		return {
			id: durableId,
			role: 'user',
			// Come UserMessage in Studio: [Source Hints], [Git Context] ed
			// [Editor Context] sono per il modello, non testo dell'utente.
			text: stripEditorContext(user.content ?? '').slice(0, MAX_PROSE_TEXT_CHARS),
			toolName: null,
			timestamp: user.messageTs ?? null,
			images: imgCount > 0 ? imgCount : undefined,
			imagePreviews
		};
	}

	if (entry.kind === 'assistant') {
		const assistant = entry as AssistantEntry;
		const rawBlocks = assistant.blocks ?? [];
		const blocks: RemoteChatBlock[] = [];
		for (const b of rawBlocks) {
			if (b.type === 'text' || b.type === 'thinking') {
				blocks.push({
					type: b.type,
					text: b.text.slice(0, MAX_BLOCK_TEXT_CHARS)
				});
			}
		}

		const joinedText = blocks
			.filter((b) => b.type === 'text')
			.map((b) => b.text)
			.filter(Boolean)
			.join('\n')
			.trim()
			.slice(0, MAX_PROSE_TEXT_CHARS);

		return {
			id: durableId,
			role: 'assistant',
			text: joinedText,
			toolName: null,
			timestamp: assistant.messageTs ?? null,
			blocks: blocks.length > 0 ? blocks : undefined,
			model: assistant.model ?? null
		};
	}

	if (entry.kind === 'tool') {
		const tool = entry as ToolEntry;
		const remoteTool = buildRemoteToolCall(tool);
		const summaryText =
			tool.intent?.trim() || remoteTool.detail || remoteTool.label || tool.toolName;

		return {
			id: durableId,
			role: 'tool',
			text: summaryText.slice(0, MAX_META_TEXT_CHARS),
			toolName: tool.toolName,
			timestamp: remoteTool.startedAt,
			tool: remoteTool
		};
	}

	if (entry.kind === 'system-chip' && !entry.internal) {
		return {
			id: durableId,
			role: 'system',
			text: `${entry.title}\n${entry.body}`.trim().slice(0, MAX_PROSE_TEXT_CHARS),
			toolName: null,
			timestamp: null
		};
	}

	if (entry.kind === 'notice' || entry.kind === 'compaction') {
		return {
			id: durableId,
			role: 'system',
			text: (entry.message ?? '').slice(0, MAX_META_TEXT_CHARS),
			toolName: null,
			timestamp: null
		};
	}

	return null;
}
