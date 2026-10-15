/**
 * Chat dal vivo per il controllo remoto (Gate R44, R6): storico della corsia
 * e flusso degli eventi verso le corsie seguite dai dispositivi client.
 */

import type {
	RemoteChatBlock,
	RemoteChatEvent,
	RemoteChatMessage,
	RemoteChatPage,
	RemoteLaneRef
} from '$remote-protocol';
import { projectStore } from '$lib/stores/projects.svelte';
import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import { remoteBridge } from './bridge';
import { RemoteCommandFailure } from './commands';
import { remoteStore } from './remoteStore.svelte';
import { entryToRemoteMessage } from './chatProjection';
import type { TranscriptEntry } from '$lib/agent/session.svelte';

export interface PendingDelta {
	projectId: string;
	laneId: string;
	messageId: string;
	block: RemoteChatBlock['type'];
	index: number;
	text: string;
	timer: number | NodeJS.Timeout | null;
}

const watchedLanes = new Map<string, () => void>();
const pendingDeltas = new Map<string, PendingDelta>();

function deltaKey(
	projectId: string,
	laneId: string,
	messageId: string,
	block: RemoteChatBlock['type'],
	index: number
): string {
	return `${projectId}:${laneId}:${messageId}:${block}:${index}`;
}

export function flushDeltaByKey(key: string): void {
	const pending = pendingDeltas.get(key);
	if (!pending) return;
	if (pending.timer !== null) {
		clearTimeout(pending.timer);
		pending.timer = null;
	}
	pendingDeltas.delete(key);
	if (pending.text.length > 0) {
		void remoteBridge.publishChatEvent(pending.projectId, pending.laneId, {
			kind: 'delta',
			messageId: pending.messageId,
			text: pending.text,
			block: pending.block,
			index: pending.index
		});
	}
}

export function flushDeltasForMessage(projectId: string, laneId: string, messageId: string): void {
	const prefix = `${projectId}:${laneId}:${messageId}:`;
	for (const key of Array.from(pendingDeltas.keys())) {
		if (key.startsWith(prefix)) {
			flushDeltaByKey(key);
		}
	}
}

export function flushAllDeltasForLane(projectId: string, laneId: string): void {
	const prefix = `${projectId}:${laneId}:`;
	for (const key of Array.from(pendingDeltas.keys())) {
		if (key.startsWith(prefix)) {
			flushDeltaByKey(key);
		}
	}
}

export function clearAllWatchersAndDeltas(): void {
	for (const unlisten of watchedLanes.values()) {
		unlisten();
	}
	watchedLanes.clear();
	for (const pending of pendingDeltas.values()) {
		if (pending.timer !== null) {
			clearTimeout(pending.timer);
			pending.timer = null;
		}
	}
	pendingDeltas.clear();
}

export function queueDelta(
	projectId: string,
	laneId: string,
	messageId: string,
	text: string,
	block: RemoteChatBlock['type'] = 'text',
	index = 0
): void {
	// Delta thinking inviati solo se il relay dichiara chat_rich
	if (block === 'thinking' && !remoteStore.status.relayFeatures?.includes('chat_rich')) {
		return;
	}

	const key = deltaKey(projectId, laneId, messageId, block, index);
	let pending = pendingDeltas.get(key);
	if (!pending) {
		pending = {
			projectId,
			laneId,
			messageId,
			block,
			index,
			text: '',
			timer: null
		};
		pendingDeltas.set(key, pending);
	}
	pending.text += text;
	if (pending.timer === null) {
		pending.timer = setTimeout(() => {
			flushDeltaByKey(key);
		}, 150);
	}
}

function attachSessionWatcher(projectId: string, laneId: string): () => void {
	const effectiveLaneId = (!laneId || laneId === 'main') ? 'main' : laneId;
	const session = effectiveLaneId === 'main'
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session || typeof session.subscribeRemoteChat !== 'function') {
		return () => {};
	}

	return session.subscribeRemoteChat((event: RemoteChatEvent) => {
		if (event.kind === 'delta') {
			queueDelta(
				projectId,
				effectiveLaneId,
				event.messageId,
				event.text,
				event.block ?? 'text',
				event.index ?? 0
			);
			return;
		}

		if (event.kind === 'message') {
			// Se ci sono delta accumulati per questo messaggio, inviali prima del messaggio conclusivo
			flushDeltasForMessage(projectId, effectiveLaneId, event.message.id);
			void remoteBridge.publishChatEvent(projectId, effectiveLaneId, event);
			return;
		}

		if (event.kind === 'reset') {
			flushAllDeltasForLane(projectId, effectiveLaneId);
			void remoteBridge.publishChatEvent(projectId, effectiveLaneId, event);
		}
	});
}

function syncWatchedLanes(lanes: RemoteLaneRef[]): void {
	const targetKeys = new Set<string>();
	for (const l of lanes) {
		const effLane = (!l.laneId || l.laneId === 'main') ? 'main' : l.laneId;
		targetKeys.add(`${l.projectId}:${effLane}`);
	}

	// Disattiva corsie non piu' seguite
	for (const [key, unlisten] of Array.from(watchedLanes.entries())) {
		if (!targetKeys.has(key)) {
			unlisten();
			watchedLanes.delete(key);
			const [pId, lId] = key.split(':');
			flushAllDeltasForLane(pId, lId);
		}
	}

	// Attiva nuove corsie seguite
	for (const l of lanes) {
		const effLane = (!l.laneId || l.laneId === 'main') ? 'main' : l.laneId;
		const key = `${l.projectId}:${effLane}`;
		if (!watchedLanes.has(key)) {
			const unlisten = attachSessionWatcher(l.projectId, effLane);
			watchedLanes.set(key, unlisten);
		}
	}
}

/**
 * Avvia l'ascolto di `chat_watch` dal bridge Rust e collega le corsie osservate.
 */
export async function initRemoteChat(): Promise<() => void> {
	const unlistenWatch = await remoteBridge.onChatWatch(({ lanes }) => {
		syncWatchedLanes(lanes);
	});

	// Se la connessione cade, viene disabilitata o revocata, pulisci watcher e timer pendenti (#12)
	const unlistenStatus = await remoteBridge.onStatus((status) => {
		if (!status.enabled || !status.paired || status.connection !== 'connected') {
			clearAllWatchersAndDeltas();
		}
	});

	// Se una nuova sessione viene creata mentre la corsia e' tra quelle seguite, collegala
	const unlistenCreated = sessionRegistry.onSessionCreated((session) => {
		const laneId = session.laneId ?? 'main';
		const key = `${session.projectKey}:${laneId}`;
		if (watchedLanes.has(key)) {
			// Ricollega watcher con la nuova istanza di sessione
			const prevUnlisten = watchedLanes.get(key);
			prevUnlisten?.();
			const newUnlisten = attachSessionWatcher(session.projectKey, laneId);
			watchedLanes.set(key, newUnlisten);
		}
	});

	return () => {
		unlistenWatch();
		unlistenStatus();
		unlistenCreated();
		clearAllWatchersAndDeltas();
	};
}



/**
 * Restituisce una pagina di storico della chat per una corsia, limitata
 * sia per numero che per budget di byte (max 200 KB) per rimanere sempre sotto MAX_FRAME_BYTES (#8).
 */
export async function remoteChatHistory(
	projectId: string,
	laneId: string | null,
	before: string | null,
	limit: number
): Promise<RemoteChatPage> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	// Risolvi corsia e superficie in modo canonico (#3)
	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure('not_found', `Corsia "${laneId}" non trovata nel progetto "${projectId}"`);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			"Lo storico della chat non e' disponibile per le corsie aperte su terminale (passa alla vista GUI in Studio per abilitarlo)."
		);
	}

	const session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session || !session.entries || session.entries.length === 0) {
		return { messages: [], before: null };
	}

	const allMessages: RemoteChatMessage[] = [];
	for (const entry of session.entries) {
		const msg = entryToRemoteMessage(entry);
		if (msg) allMessages.push(msg);
	}

	const clampedLimit = Math.max(1, Math.min(limit || 50, 100));
	const MAX_PAGE_BYTES = 200 * 1024; // 200 KB per restare ben sotto il tetto di 512 KB

	let endIndex = allMessages.length;
	if (before !== null) {
		const targetIndex = allMessages.findIndex((m) => m.id === before);
		if (targetIndex <= 0) {
			return { messages: [], before: null };
		}
		endIndex = targetIndex;
	}

	// Scansiona all'indietro conteggiando sia il limite messaggi che i byte serializzati
	let startIndex = endIndex;
	let currentBytes = 0;
	while (startIndex > 0 && (endIndex - startIndex) < clampedLimit) {
		const candidate = allMessages[startIndex - 1];
		const candidateBytes = JSON.stringify(candidate).length + 2;
		if (currentBytes + candidateBytes > MAX_PAGE_BYTES && startIndex < endIndex) {
			break;
		}
		currentBytes += candidateBytes;
		startIndex--;
	}

	const page = allMessages.slice(startIndex, endIndex);
	const nextBefore = startIndex > 0 ? page[0].id : null;
	return { messages: page, before: nextBefore };
}
