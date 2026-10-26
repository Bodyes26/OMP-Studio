import type { AvailableCommand } from '#lib/agent/wire.ts';
import type { TranscriptEntry } from '#lib/agent/session.svelte.ts';
// Il testo completo viaggia su richiesta: il monitor riceve soltanto il riferimento.
// L'identita' della sessione resta legata alla risposta letta, non alla selezione di Studio.
export interface CompanionConversationTarget {
	projectId: string;
	laneId: string;
	sessionId: string;
}

export interface CompanionAssistantReference {
	laneId: string;
	sessionId: string;
	messageId: string;
	at: number;
	// Letto nella finestra principale: la companion ha un proprio store, fermo
	// all'apertura, e senza questo dato vedeva "da leggere" una risposta gia' letta.
	seen?: boolean;
}

export interface CompanionAssistantMessage {
	id: string;
	text: string;
	at: number;
}

export interface CompanionConversationSnapshot {
	projectId: string;
	laneId: string;
	sessionId: string | null;
	message: CompanionAssistantMessage | null;
	canSend: boolean;
	sendBlockReason?: string;
	availableCommands?: AvailableCommand[];
	entries?: TranscriptEntry[];
}

export type CompanionConversationFailureCode =
	| 'not_found'
	| 'session_changed'
	| 'unavailable'
	| 'failed';

export class CompanionConversationError extends Error {
	readonly code: CompanionConversationFailureCode;

	constructor(
		code: CompanionConversationFailureCode,
		message: string
	) {
		super(message);
		this.code = code;
		this.name = 'CompanionConversationError';
	}
}
