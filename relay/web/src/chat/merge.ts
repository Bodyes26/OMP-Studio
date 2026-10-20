/**
 * Logica pura di fusione dei messaggi, gestione eventi in streaming e raggruppamento
 * dei turni/strumenti per la PWA (allineata alla grammatica di Studio).
 */
import type {
	RemoteChatEvent,
	RemoteChatMessage,
	RemoteChatPage,
	RemoteToolCall,
	RemoteToolCategory
} from '../../../src/protocol.ts';
import type {
	DisplayItem,
	ToolGroupSummary,
	TurnDiffTotals,
	TurnFooterData
} from './types.ts';

const TOOL_CATEGORY_BY_NAME: Record<string, RemoteToolCategory> = {
	read: 'read',
	cat: 'read',
	view: 'read',
	file: 'read',
	grep: 'search',
	glob: 'search',
	search: 'search',
	find: 'search',
	bash: 'run',
	sh: 'run',
	cmd: 'run',
	exec: 'run',
	terminal: 'run',
	edit: 'edit',
	write: 'edit',
	patch: 'edit',
	web_search: 'web',
	fetch: 'web',
	browser: 'web',
	think: 'think',
	task: 'task',
	todo: 'todo',
	ask: 'ask'
};

/**
 * Deduce la categoria visuale di uno strumento dal nome (per host precedenti).
 */
export function deduceToolCategory(toolName: string | null | undefined): RemoteToolCategory {
	if (!toolName) return 'other';
	const lower = toolName.toLowerCase();
	return TOOL_CATEGORY_BY_NAME[lower] ?? 'other';
}

/**
 * Normalizza un messaggio per compatibilita' con host vecchi privi di campi ricchi (`blocks`, `tool`).
 */
export function normalizeMessage(message: RemoteChatMessage): RemoteChatMessage {
	let normalized = message;

	// Assistente senza blocchi: crea blocco 'text' iniziale
	if (message.role === 'assistant' && (!message.blocks || message.blocks.length === 0)) {
		normalized = {
			...normalized,
			blocks: message.text ? [{ type: 'text', text: message.text }] : []
		};
	}

	// Tool senza dettagli ricchi: crea sintesi minima da toolName e text
	if (message.role === 'tool' && !message.tool) {
		const category = deduceToolCategory(message.toolName);
		const label = message.toolName ?? 'Strumento';
		const syntheticTool: RemoteToolCall = {
			category,
			label,
			detail: message.text || null,
			meta: null,
			intent: null,
			status: 'ok',
			errorReason: null,
			startedAt: message.timestamp ?? Date.now(),
			endedAt: message.timestamp ?? Date.now(),
			diffStats: null,
			diff: null,
			output: null,
			todos: null
		};
		normalized = {
			...normalized,
			tool: syntheticTool
		};
	}

	return normalized;
}

/**
 * Applica un evento chat alla lista corrente di messaggi (sostituzione o delta stream).
 */
export function applyChatEvent(
	messages: RemoteChatMessage[],
	event: RemoteChatEvent
): RemoteChatMessage[] {
	if (event.kind === 'message') {
		const norm = normalizeMessage(event.message);
		const idx = messages.findIndex((m) => m.id === norm.id);
		if (idx >= 0) {
			const next = [...messages];
			next[idx] = norm;
			return next;
		}
		return [...messages, norm];
	}

	if (event.kind === 'delta') {
		const idx = messages.findIndex((m) => m.id === event.messageId);
		const blockType = event.block ?? 'text';

		if (idx < 0) {
			// Messaggio assistente nuovo iniziato via delta
			const newMsg: RemoteChatMessage = {
				id: event.messageId,
				role: 'assistant',
				text: blockType === 'text' ? event.text : '',
				toolName: null,
				timestamp: Date.now(),
				blocks: [{ type: blockType, text: event.text }]
			};
			return [...messages, newMsg];
		}

		const existing = messages[idx];
		const blocks = existing.blocks ? [...existing.blocks] : [];

		if (event.index !== undefined) {
			// Indice di blocco esplicito
			while (blocks.length <= event.index) {
				blocks.push({ type: blockType, text: '' });
			}
			const target = blocks[event.index];
			blocks[event.index] = {
				type: target.type || blockType,
				text: target.text + event.text
			};
		} else if (blocks.length > 0 && blocks[blocks.length - 1].type === blockType) {
			// Accoda all'ultimo blocco se dello stesso tipo
			const lastIdx = blocks.length - 1;
			blocks[lastIdx] = {
				type: blockType,
				text: blocks[lastIdx].text + event.text
			};
		} else {
			// Nuovo blocco distinto
			blocks.push({ type: blockType, text: event.text });
		}

		// Aggiorna anche il testo complessivo (solo parti text)
		const newText = blocks
			.filter((b) => b.type === 'text')
			.map((b) => b.text)
			.join('');

		const updated: RemoteChatMessage = {
			...existing,
			text: newText,
			blocks
		};

		const next = [...messages];
		next[idx] = updated;
		return next;
	}

	// reset gestito dal chiamante ricaricando lo storico
	return messages;
}

/**
 * Applica una pagina di storico ricevuta da `chat_history`.
 */
export function applyChatPage(
	existing: RemoteChatMessage[],
	page: RemoteChatPage,
	mode: 'replace' | 'prepend'
): { messages: RemoteChatMessage[]; before: string | null } {
	const normalizedPage = (page.messages || []).map(normalizeMessage);

	if (mode === 'replace') {
		return {
			messages: normalizedPage,
			before: page.before
		};
	}

	// prepend: preserva i messaggi gia' presenti evitando duplicati
	const existingIds = new Set(existing.map((m) => m.id));
	const older = normalizedPage.filter((m) => !existingIds.has(m.id));

	return {
		messages: [...older, ...existing],
		before: page.before
	};
}

/**
 * Calcola le statistiche di sintesi per un gruppo di strumenti consecutivi.
 */
export function calculateToolGroupSummary(messages: RemoteChatMessage[]): ToolGroupSummary {
	let totalCalls = 0;
	let minStarted = Infinity;
	let maxEnded = 0;
	const counts: Partial<Record<RemoteToolCategory, number>> = {};
	let totalAdd = 0;
	let totalDel = 0;
	let failedCount = 0;
	let hasRunning = false;

	for (const msg of messages) {
		const tool = msg.tool;
		if (!tool) {
			totalCalls++;
			continue;
		}
		totalCalls++;
		const cat = tool.category || 'other';
		counts[cat] = (counts[cat] ?? 0) + 1;

		if (tool.status === 'running') hasRunning = true;
		if (tool.status === 'error') failedCount++;

		if (tool.diffStats) {
			totalAdd += tool.diffStats[0] ?? 0;
			totalDel += tool.diffStats[1] ?? 0;
		}

		if (typeof tool.startedAt === 'number' && tool.startedAt < minStarted) {
			minStarted = tool.startedAt;
		}
		if (typeof tool.endedAt === 'number' && tool.endedAt > maxEnded) {
			maxEnded = tool.endedAt;
		}
	}

	const durationMs = maxEnded > minStarted && minStarted !== Infinity ? maxEnded - minStarted : 0;

	return {
		totalCalls,
		durationMs,
		counts,
		totalAdd,
		totalDel,
		failedCount,
		hasRunning
	};
}

/**
 * Messaggio dell'assistente senza testo per l'utente: solo ragionamento, oppure
 * niente del tutto (il passo che contiene solo chiamate ai tool). Non spezza il
 * gruppo di strumenti: altrimenti ogni chiamata, preceduta dal suo passo vuoto,
 * diventava un gruppo a se' da «1 chiamata».
 */
function isSilentAssistant(message: RemoteChatMessage): boolean {
	if (message.role !== 'assistant') return false;
	if (message.text && message.text.trim().length > 0) return false;
	return (message.blocks ?? []).every((b) => b.type === 'thinking' || !b.text.trim());
}

/**
 * Raggruppa i messaggi lineari in elementi visuali (tool-group, turni, system, assistant, user)
 * calcolando metadati del piè di turno (`turnFootersByIndex`).
 */
export function groupMessages(messages: RemoteChatMessage[]): {
	items: DisplayItem[];
	turnFootersByIndex: Map<number, TurnFooterData>;
} {
	const items: DisplayItem[] = [];
	let currentToolBatch: RemoteChatMessage[] = [];

	function flushToolBatch() {
		if (currentToolBatch.length === 0) return;
		const summary = calculateToolGroupSummary(currentToolBatch);
		items.push({
			kind: 'tool-group',
			id: `tg-${currentToolBatch[0].id}`,
			messages: [...currentToolBatch],
			summary
		});
		currentToolBatch = [];
	}

	for (const raw of messages) {
		const msg = normalizeMessage(raw);

		if (msg.role === 'tool') {
			currentToolBatch.push(msg);
			continue;
		}
		if (isSilentAssistant(msg)) {
			// Il ragionamento resta nel gruppo come in Studio; il passo vuoto non si disegna.
			if (msg.blocks?.some((b) => b.type === 'thinking' && b.text.trim())) currentToolBatch.push(msg);
			continue;
		}

		flushToolBatch();

		if (msg.role === 'user') {
			items.push({ kind: 'user', id: msg.id, message: msg });
		} else if (msg.role === 'assistant') {
			items.push({ kind: 'assistant', id: msg.id, message: msg });
		} else if (msg.role === 'system') {
			items.push({ kind: 'system', id: msg.id, message: msg });
		}
	}

	flushToolBatch();

	// Calcola i piè di turno (TurnFooter) su ciascun intervallo utente -> contenuti -> nuovo utente / fine
	const turnFootersByIndex = new Map<number, TurnFooterData>();
	if (items.length === 0) return { items, turnFootersByIndex };

	let currentTurnStartIndex = -1;
	let currentTurnAssistantTexts: string[] = [];
	let currentTurnToolCalls = 0;
	let currentTurnModel: string | undefined;
	let currentTurnStartMs = 0;
	let currentTurnEndMs = 0;
	let currentTurnDiff: TurnDiffTotals = { added: 0, removed: 0 };

	function recordItem(item: DisplayItem) {
		if (item.kind === 'assistant') {
			if (item.message.text?.trim()) {
				currentTurnAssistantTexts.push(item.message.text.trim());
			}
			if (item.message.model) {
				currentTurnModel = item.message.model;
			}
			if (typeof item.message.timestamp === 'number') {
				if (!currentTurnStartMs || item.message.timestamp < currentTurnStartMs) {
					currentTurnStartMs = item.message.timestamp;
				}
				if (item.message.timestamp > currentTurnEndMs) {
					currentTurnEndMs = item.message.timestamp;
				}
			}
		} else if (item.kind === 'tool-group') {
			currentTurnToolCalls += item.summary.totalCalls;
			currentTurnDiff.added += item.summary.totalAdd;
			currentTurnDiff.removed += item.summary.totalDel;
			for (const m of item.messages) {
				if (m.tool) {
					if (m.tool.startedAt && (!currentTurnStartMs || m.tool.startedAt < currentTurnStartMs)) {
						currentTurnStartMs = m.tool.startedAt;
					}
					if (m.tool.endedAt && m.tool.endedAt > currentTurnEndMs) {
						currentTurnEndMs = m.tool.endedAt;
					}
				}
			}
		}
	}

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item.kind === 'user') {
			if (
				currentTurnStartIndex >= 0 &&
				(currentTurnAssistantTexts.length > 0 || currentTurnToolCalls > 0)
			) {
				const duration = currentTurnEndMs > currentTurnStartMs ? currentTurnEndMs - currentTurnStartMs : 0;
				turnFootersByIndex.set(i - 1, {
					assistantText: currentTurnAssistantTexts.join('\n\n'),
					toolCallsCount: currentTurnToolCalls,
					durationMs: duration,
					model: currentTurnModel,
					diff:
						currentTurnDiff.added > 0 || currentTurnDiff.removed > 0
							? { ...currentTurnDiff }
							: undefined
				});
			}
			currentTurnStartIndex = i;
			currentTurnAssistantTexts = [];
			currentTurnToolCalls = 0;
			currentTurnModel = undefined;
			currentTurnStartMs = 0;
			currentTurnEndMs = 0;
			currentTurnDiff = { added: 0, removed: 0 };
		} else {
			if (currentTurnStartIndex === -1) {
				currentTurnStartIndex = i;
			}
			recordItem(item);
		}
	}

	// Chiude l'ultimo turno se presente contenuto assistente o tool
	if (
		currentTurnStartIndex >= 0 &&
		(currentTurnAssistantTexts.length > 0 || currentTurnToolCalls > 0)
	) {
		const duration = currentTurnEndMs > currentTurnStartMs ? currentTurnEndMs - currentTurnStartMs : 0;
		turnFootersByIndex.set(items.length - 1, {
			assistantText: currentTurnAssistantTexts.join('\n\n'),
			toolCallsCount: currentTurnToolCalls,
			durationMs: duration,
			model: currentTurnModel,
			diff:
				currentTurnDiff.added > 0 || currentTurnDiff.removed > 0
					? { ...currentTurnDiff }
					: undefined
		});
	}

	return { items, turnFootersByIndex };
}

/**
 * Formatta i millisecondi come 'X,Y s' (italiano) o 'X.Y s' (inglese).
 */
export function formatDurationSecs(ms: number, lang: 'it' | 'en' = 'it'): string {
	if (ms <= 0) return lang === 'it' ? '0,0 s' : '0.0 s';
	const secs = (ms / 1000).toFixed(1);
	return lang === 'it' ? `${secs.replace('.', ',')} s` : `${secs} s`;
}
