/**
 * Tipi del modello dati della chat PWA (allineati a Studio).
 */
import type {
	RemoteChatMessage,
	RemoteToolCall,
	RemoteToolCategory,
	RemoteTodoItem
} from '../../../src/protocol.ts';

export type {
	RemoteChatMessage,
	RemoteToolCall,
	RemoteToolCategory,
	RemoteTodoItem
};

export interface ToolGroupSummary {
	totalCalls: number;
	durationMs: number;
	counts: Partial<Record<RemoteToolCategory, number>>;
	totalAdd: number;
	totalDel: number;
	failedCount: number;
	hasRunning: boolean;
}

export interface TurnDiffTotals {
	added: number;
	removed: number;
}

export interface TurnFooterData {
	assistantText: string;
	toolCallsCount: number;
	durationMs: number;
	model?: string;
	diff?: TurnDiffTotals;
}

export type DisplayItem =
	| { kind: 'user'; id: string; message: RemoteChatMessage }
	| { kind: 'assistant'; id: string; message: RemoteChatMessage }
	| {
			kind: 'tool-group';
			id: string;
			messages: RemoteChatMessage[];
			summary: ToolGroupSummary;
	  }
	| { kind: 'system'; id: string; message: RemoteChatMessage };

export interface DiffRow {
	sign: '+' | '-' | ' ';
	line: number | null;
	text: string;
}
