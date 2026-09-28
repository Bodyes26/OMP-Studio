// Client RPC simulato per il banco di prova (chat-bench).
// Sostituisce il trasporto Tauri reale senza effettuare chiamate invoke su Rust.
// Risponde immediatamente a tutti i comandi attesi da AgentSession e permette
// al driver di replay di inviare frame con emit().

import { OmpRpcClient } from '../client';
import type {
	AgentSessionEvent,
	ExtensionUiResponse,
	LoginProviderInfo,
	RpcCommand,
	RpcSessionState
} from '../wire';

export class FakeOmpRpcClient extends OmpRpcClient {
	private _isOpen = true;
	private _id = 1001;
	private _epoch = 1;
	private _abortEpoch = 0;
	private _handler: ((event: AgentSessionEvent) => void) | null = null;

	public state: RpcSessionState = {
		sessionId: 'bench-session-1',
		sessionName: 'Chat Bench',
		isStreaming: false,
		model: {
			id: 'claude-3-7-sonnet',
			name: 'Claude 3.7 Sonnet',
			provider: 'anthropic',
			contextWindow: 200000
		},
		thinkingLevel: 'medium',
		contextUsage: {
			tokens: 1420,
			contextWindow: 200000,
			percent: 0.71
		},
		todoPhases: []
	};

	public onUiResponse?: (response: ExtensionUiResponse) => void;
	public onPrompt?: (command: RpcCommand & { type: 'prompt' }) => void;

	override get isOpen(): boolean {
		return this._isOpen;
	}

	override get id(): number | null {
		return this._id;
	}

	override get epoch(): number {
		return this._epoch;
	}

	override get currentAbortEpoch(): number {
		return this._abortEpoch;
	}

	override onEvent(handler: (event: AgentSessionEvent) => void): () => void {
		this._handler = handler;
		return () => {
			if (this._handler === handler) {
				this._handler = null;
			}
		};
	}

	override clearEventHandler() {
		this._handler = null;
	}

	override async open(): Promise<number> {
		this._isOpen = true;
		this._epoch++;
		return this._id;
	}

	override async openLab(): Promise<number> {
		this._isOpen = true;
		this._epoch++;
		return this._id;
	}

	override async close(): Promise<void> {
		this._isOpen = false;
	}

	override markExited() {
		this._isOpen = false;
	}

	override async abort(): Promise<void> {
		this._abortEpoch++;
	}

	override async forceKill(): Promise<void> {
		this._abortEpoch++;
		this._isOpen = false;
	}

	override async respondUi(response: ExtensionUiResponse): Promise<void> {
		this.onUiResponse?.(response);
	}

	override async getLoginProviders(): Promise<LoginProviderInfo[]> {
		return [];
	}

	override async login(providerId: string): Promise<{ providerId: string }> {
		return { providerId };
	}

	override async send<T = unknown>(command: RpcCommand): Promise<T> {
		switch (command.type) {
			case 'get_state':
				return { ...this.state } as T;

			case 'get_available_commands':
				return { commands: [] } as T;

			case 'get_session_stats':
				return {
					totalMessages: 12,
					userMessages: 4,
					assistantMessages: 8,
					toolCalls: 14,
					toolResults: 14,
					totalCost: 0.042,
					contextUsage: this.state.contextUsage
				} as T;

			case 'get_messages_page':
				return { messages: [], nextCursor: undefined } as T;

			case 'prompt':
				this.onPrompt?.(command);
				return { success: true } as T;

			case 'compact':
				return {
					summary: 'Compattazione di prova del contesto',
					shortSummary: 'Contesto ridotto',
					tokensBefore: 45000,
					tokensAfter: 8200
				} as T;

			case 'handoff':
			case 'new_session':
			case 'set_model':
			case 'set_thinking_level':
			case 'set_steering_mode':
			case 'set_follow_up_mode':
			case 'set_interrupt_mode':
			case 'set_subagent_subscription':
			case 'negotiate_capabilities':
			case 'abort':
			case 'abort_bash':
			default:
				return { success: true } as T;
		}
	}

	/** Invia un evento di sessione al riduttore di AgentSession */
	emit(event: AgentSessionEvent): void {
		if (event.type === 'ready') {
			this._isOpen = true;
		} else if (event.type === 'studio_exit') {
			this._isOpen = false;
		}
		this._handler?.(event);
	}

	/** Invia una riga JSON raw come evento */
	feedLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		try {
			const parsed = JSON.parse(trimmed) as AgentSessionEvent;
			this.emit(parsed);
		} catch (error) {
			console.error('Frame NDJSON illeggibile nel bench:', error, trimmed);
		}
	}

	/** Reimposta lo stato interno */
	reset(): void {
		this._isOpen = true;
		this._epoch++;
		this.state.todoPhases = [];
	}
}
