// Client del canale RPC: un processo `omp --mode rpc-ui` per istanza.
//
// Il trasporto vero sta in Rust (`src-tauri/src/rpc/mod.rs`), che riassembla
// i `rpc_chunk`, negozia il protocollo v2 e coalesce i delta di streaming.
// Qui restano tre cose: correlare le risposte, non lasciare promise appese, e
// consegnare i frame non-risposta a chi li riduce.

import { Channel, invoke } from '@tauri-apps/api/core';
import {
	APPROVAL_SENTINEL,
	type AgentSessionEvent,
	type ApprovalRequestPayload,
	type ExtensionUiResponse,
	type RpcCommand,
	type RpcResponse
} from './wire';

/** Timeout di default per richiesta. Un comando che non risponde entro un
 *  minuto e' un comando perso: senza timeout la promise resterebbe appesa. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** `compact` e `handoff` fanno una chiamata al modello: il minuto non basta. */
const SLOW_COMMAND_TIMEOUT_MS = 300_000;
const SLOW_COMMANDS: Record<string, true> = { compact: true, handoff: true };

export interface RpcError extends Error {
	code?: string;
	command?: string;
}

interface Pending {
	id: string;
	command: string;
	resolve: (data: unknown) => void;
	reject: (error: RpcError) => void;
	timer: number;
	sentAt: number;
}

function rpcError(message: string, command?: string, code?: string): RpcError {
	const error = new Error(message) as RpcError;
	error.command = command;
	error.code = code;
	return error;
}

/**
 * Riconosce le select coniate da `extensions/studio-approval.ts` e ne estrae
 * il payload. Le altre select restano generiche: il testo di un prompt
 * nativo non va mai parsato.
 */
export function parseApprovalRequest(title: string | undefined): ApprovalRequestPayload | null {
	if (!title || !title.startsWith(APPROVAL_SENTINEL)) return null;
	try {
		const parsed: unknown = JSON.parse(title.slice(APPROVAL_SENTINEL.length));
		if (!parsed || typeof parsed !== 'object') return null;
		const raw = parsed as Record<string, unknown>;
		if (typeof raw.tool !== 'string') return null;
		return {
			v: typeof raw.v === 'number' ? raw.v : 1,
			tool: raw.tool,
			toolCallId: typeof raw.toolCallId === 'string' ? raw.toolCallId : null,
			input: raw.input && typeof raw.input === 'object' ? (raw.input as Record<string, unknown>) : {}
		};
	} catch {
		return null;
	}
}

export class OmpRpcClient {
	private rpcId: number | null = null;
	private seq = 0;
	private readonly pending = new Map<string, Pending>();
	private eventHandler: ((event: AgentSessionEvent) => void) | null = null;
	private closed = false;

	get id(): number | null {
		return this.rpcId;
	}

	get isOpen(): boolean {
		return this.rpcId !== null && !this.closed;
	}

	onEvent(handler: (event: AgentSessionEvent) => void) {
		this.eventHandler = handler;
	}

	async open(cwd: string, resume?: string | null): Promise<number> {
		const channel = new Channel<string>();
		channel.onmessage = (line) => this.receive(line);
		this.rpcId = await invoke<number>('rpc_open', {
			cwd,
			resume: resume ?? null,
			onEvent: channel
		});
		this.closed = false;
		return this.rpcId;
	}

	/**
	 * Manda un comando e risolve con il suo `data`. La correlazione e' per
	 * `id`, mai per ordine: `bash` e' dispatchato in concorrenza e l'ordine di
	 * emissione non e' garantito dal protocollo.
	 */
	async send<T = unknown>(command: RpcCommand): Promise<T> {
		if (this.rpcId === null || this.closed) throw rpcError('Sessione RPC non aperta', command.type);
		const id = `s${++this.seq}`;
		const timeoutMs = SLOW_COMMANDS[command.type] === true ? SLOW_COMMAND_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();

		const timer = window.setTimeout(() => {
			this.pending.delete(id);
			reject(rpcError(`Nessuna risposta a "${command.type}" entro ${timeoutMs / 1000}s`, command.type, 'timeout'));
		}, timeoutMs);

		this.pending.set(id, { id, command: command.type, resolve, reject, timer, sentAt: Date.now() });
		try {
			await invoke('rpc_send', { rpcId: this.rpcId, line: JSON.stringify({ id, ...command }) });
		} catch (error) {
			window.clearTimeout(timer);
			this.pending.delete(id);
			throw rpcError(error instanceof Error ? error.message : String(error), command.type, 'transport');
		}
		return (await promise) as T;
	}

	/** Risposta a una `extension_ui_request`: fuori dal canale delle risposte. */
	async respondUi(response: ExtensionUiResponse): Promise<void> {
		if (this.rpcId === null || this.closed) return;
		await invoke('rpc_send', { rpcId: this.rpcId, line: JSON.stringify(response) });
	}

	async stderrTail(): Promise<string[]> {
		if (this.rpcId === null) return [];
		try {
			return await invoke<string[]>('rpc_stderr', { rpcId: this.rpcId });
		} catch {
			// La sessione e' gia' fuori dalla mappa: le righe sono arrivate
			// dentro `studio_exit`.
			return [];
		}
	}

	async close(): Promise<void> {
		const rpcId = this.rpcId;
		this.closed = true;
		this.rpcId = null;
		this.failAllPending('Sessione RPC chiusa');
		if (rpcId === null) return;
		await invoke('rpc_close', { rpcId });
	}

	/** Chiamata dal riduttore quando arriva `studio_exit`. */
	markExited() {
		this.closed = true;
		this.rpcId = null;
		this.failAllPending('Il processo omp e\u2019 terminato');
	}

	private failAllPending(reason: string) {
		for (const entry of this.pending.values()) {
			window.clearTimeout(entry.timer);
			entry.reject(rpcError(reason, entry.command, 'closed'));
		}
		this.pending.clear();
	}

	private receive(line: string) {
		let frame: unknown;
		try {
			frame = JSON.parse(line);
		} catch (error) {
			console.error('Frame RPC illeggibile:', error, line.slice(0, 400));
			return;
		}
		if (!frame || typeof frame !== 'object') return;
		const event = frame as AgentSessionEvent;

		if (event.type === 'response') {
			this.settle(frame as RpcResponse);
			return;
		}
		this.eventHandler?.(event);
	}

	private settle(response: RpcResponse) {
		// Le risposte senza `id` esistono per contratto: comando ignoto e
		// `command: "parse"`. Senza questo ramo un errore di parse lascerebbe
		// una promise appesa per sempre.
		if (typeof response.id !== 'string') {
			const oldest = this.oldestPending();
			if (!oldest) {
				console.warn('Risposta RPC senza id e senza richieste in sospeso:', response.command, response.error);
				return;
			}
			this.pending.delete(oldest.id);
			window.clearTimeout(oldest.timer);
			console.warn(
				`Risposta RPC senza id (${response.command}): rigettata la richiesta piu' vecchia "${oldest.command}"`,
				response.error
			);
			oldest.reject(
				rpcError(
					response.error ?? `Comando "${oldest.command}" non riconosciuto da omp`,
					oldest.command,
					'uncorrelated'
				)
			);
			return;
		}

		const entry = this.pending.get(response.id);
		if (!entry) {
			// La negoziazione del protocollo la fa il trasporto in Rust con un
			// id suo: la sua risposta arriva qui e non ha padrone.
			return;
		}
		this.pending.delete(response.id);
		window.clearTimeout(entry.timer);
		if (response.success) entry.resolve(response.data);
		else entry.reject(rpcError(response.error ?? 'Comando fallito', response.command, response.code));
	}

	private oldestPending(): Pending | null {
		let oldest: Pending | null = null;
		for (const entry of this.pending.values()) {
			if (oldest === null || entry.sentAt < oldest.sentAt) oldest = entry;
		}
		return oldest;
	}
}
