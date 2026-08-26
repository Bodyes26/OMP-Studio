// Client del canale RPC: un processo `omp --mode rpc-ui` per istanza.
//
// Il trasporto vero sta in Rust (`src-tauri/src/rpc/mod.rs`), che riassembla
// i `rpc_chunk`, negozia il protocollo v2 e coalesce i delta di streaming.
// Qui restano tre cose: correlare le risposte, non lasciare promise appese, e
// consegnare i frame non-risposta a chi li riduce.

import { Channel, invoke } from '@tauri-apps/api/core';
import {
	type AgentSessionEvent,
	type ExtensionUiResponse,
	type RpcCommand,
	type RpcResponse
} from './wire';

/** Timeout di default per richiesta. Un comando che non risponde entro un
 *  minuto e' un comando perso: senza timeout la promise resterebbe appesa. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** `compact` e `handoff` fanno una chiamata al modello e `bash` esegue un
 *  comando arbitrario: per tutti e tre il minuto non basta. Una build o una
 *  suite di test superano regolarmente i 60 s, e il rigetto anticipato
 *  lascerebbe il comando in esecuzione senza nessuno che ne raccoglie l'esito. */
const SLOW_COMMAND_TIMEOUT_MS = 300_000;
const SLOW_COMMANDS: Record<string, true> = { compact: true, handoff: true, bash: true };

/** `abort` e `abort_bash` hanno priorita' massima e non devono mai attendere il
 *  timeout di un minuto: l'interruzione deve agire subito. */
const FAST_COMMAND_TIMEOUT_MS = 4_000;
const FAST_COMMANDS: Record<string, true> = { abort: true, abort_bash: true };
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


export class OmpRpcClient {
	private rpcId: number | null = null;
	private seq = 0;
	private readonly pending = new Map<string, Pending>();
	private eventHandler: ((event: AgentSessionEvent) => void) | null = null;
	private closed = false;
	private abortEpoch = 0;
	get currentAbortEpoch(): number {
		return this.abortEpoch;
	}

	get id(): number | null {
		return this.rpcId;
	}
	get isOpen(): boolean {
		return this.rpcId !== null && !this.closed;
	}

	onEvent(handler: (event: AgentSessionEvent) => void): () => void {
		this.eventHandler = handler;
		return () => {
			if (this.eventHandler === handler) {
				this.eventHandler = null;
			}
		};
	}

	clearEventHandler() {
		this.eventHandler = null;
	}

	async open(cwd: string, resume?: string | null): Promise<number> {
		const channel = new Channel<string>();
		channel.onmessage = (line) => this.receive(line);
		this.rpcId = null;
		this.closed = false;
		const rpcId = await invoke<number>('rpc_open', {
			cwd,
			resume: resume ?? null,
			onEvent: channel
		});
		// Un processo che fallisce in avvio puo' emettere `studio_exit` prima
		// che la Promise di `rpc_open` venga risolta. Non rianimare quell'id.
		if (this.closed) {
			void invoke('rpc_close', { rpcId }).catch(() => {});
			return rpcId;
		}
		this.rpcId = rpcId;
		return rpcId;
	}

	/**
	 * Manda un comando e risolve con il suo `data`. La correlazione e' per
	 * `id`, mai per ordine: `bash` e' dispatchato in concorrenza e l'ordine di
	 * emissione non e' garantito dal protocollo.
	 */
	async send<T = unknown>(command: RpcCommand): Promise<T> {
		if (this.rpcId === null || this.closed) throw rpcError('Sessione RPC non aperta', command.type);
		const id = `s${++this.seq}`;
		const timeoutMs =
			SLOW_COMMANDS[command.type] === true
				? SLOW_COMMAND_TIMEOUT_MS
				: FAST_COMMANDS[command.type] === true
					? FAST_COMMAND_TIMEOUT_MS
					: DEFAULT_TIMEOUT_MS;
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

	/**
	 * Interrompe l'agente con priorita' massima:
	 * 1. Fa fallire immediatamente tutte le richieste in volo non-abort,
	 *    sbloccando i chiamanti senza attendere timeout di rete o del modello.
	 * 2. Invia i comandi `abort` e `abort_bash` a omp su stdin.
	 */
	async abort(): Promise<void> {
		if (this.rpcId === null || this.closed) return;
		this.abortEpoch++;
		this.abortPendingRequests('Interrotto dall\u2019utente');
		const rpcId = this.rpcId;
		const abortId = `s${++this.seq}`;
		const abortBashId = `s${++this.seq}`;
		try {
			await Promise.allSettled([
				invoke('rpc_send', { rpcId, line: JSON.stringify({ id: abortId, type: 'abort' }) }),
				invoke('rpc_send', { rpcId, line: JSON.stringify({ id: abortBashId, type: 'abort_bash' }) })
			]);
		} catch (error) {
			console.warn('Errore invio frame abort su RPC:', error);
		}
	}

	/** Fa fallire tutte le richieste ordinarie in volo con stato abortito. */
	abortPendingRequests(reason: string) {
		for (const [id, entry] of this.pending.entries()) {
			if (FAST_COMMANDS[entry.command] === true) continue;
			window.clearTimeout(entry.timer);
			this.pending.delete(id);
			entry.reject(rpcError(reason, entry.command, 'aborted'));
		}
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
		// `command: "parse"`. La correlazione si fa sul nome del comando, mai
		// sull'anzianita': rigettare la richiesta piu' vecchia significava far
		// fallire un `prompt` legittimo ancora in volo per colpa di un frame
		// malformato che non lo riguardava. Se nessuna richiesta in sospeso
		// porta quel nome, si lascia decidere al timeout: e' l'unica rete che
		// non inventa una vittima.
		if (typeof response.id !== 'string') {
			const orphan = typeof response.command === 'string' ? this.oldestPendingOf(response.command) : null;
			if (!orphan) {
				console.warn(
					'Risposta RPC senza id non correlabile:',
					response.command,
					response.error
				);
				return;
			}
			this.pending.delete(orphan.id);
			window.clearTimeout(orphan.timer);
			orphan.reject(
				rpcError(
					response.error ?? `Comando "${orphan.command}" non riconosciuto da omp`,
					orphan.command,
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

	/** La piu' vecchia richiesta in sospeso con quel nome di comando. */
	private oldestPendingOf(command: string): Pending | null {
		let oldest: Pending | null = null;
		for (const entry of this.pending.values()) {
			if (entry.command !== command) continue;
			if (oldest === null || entry.sentAt < oldest.sentAt) oldest = entry;
		}
		return oldest;
	}
}
