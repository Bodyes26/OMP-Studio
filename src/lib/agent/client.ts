// Client del canale RPC: un processo `omp --mode rpc-ui` per istanza.
//
// Il trasporto vero sta in Rust (`src-tauri/src/rpc/mod.rs`), che riassembla
// i `rpc_chunk`, negozia il protocollo v2 e coalesce i delta di streaming.
// Qui restano tre cose: correlare le risposte, non lasciare promise appese, e
// consegnare i frame non-risposta a chi li riduce.

import { Channel, invoke } from '@tauri-apps/api/core';
import type {
	AbortAndRestoreQueueResult,
	AgentSessionEvent,
	ExtensionUiResponse,
	LoginProviderInfo,
	RpcCommand,
	RpcResponse
} from './wire';
import {
	buildHangReport,
	frameLabel,
	newTally,
	noteReceived,
	type BackendDiagnostics,
	type ClientTally
} from './hangReport';

/** Timeout di default per richiesta. Un comando che non risponde entro un
 *  minuto e' un comando perso: senza timeout la promise resterebbe appesa. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** `compact` e `handoff` fanno una chiamata al modello e `bash` esegue un
 *  comando arbitrario: per tutti e tre il minuto non basta. Una build o una
 *  suite di test superano regolarmente i 60 s, e il rigetto anticipato
 *  lascerebbe il comando in esecuzione senza nessuno che ne raccoglie l'esito. */
const SLOW_COMMAND_TIMEOUT_MS = 300_000;
const SLOW_COMMANDS: Record<string, true> = { compact: true, handoff: true, bash: true };

/** `login` puo' restare in attesa di un intero flusso OAuth interattivo nel
 *  browser dell'utente: ne' il timeout standard ne' quello "lento" bastano.
 *  Stesso valore del client RPC di riferimento di omp. */
const LOGIN_TIMEOUT_MS = 600_000;

/** `abort`, `abort_bash` e `abort_and_restore_queue` hanno priorita' massima e
 *  non devono mai attendere il timeout di un minuto: l'interruzione deve agire
 *  subito, e se omp e' bloccato la risposta di ripristino va persa in fretta
 *  (l'escalation a `forceKill` resta comunque disponibile).
 *  `negotiate_capabilities` sta nella stessa lista per il motivo opposto: e'
 *  un handshake locale che o risponde subito o non e' supportato, e non deve
 *  ne' tenere aperta la sessione ne' cadere con l'abort dell'utente. */
const FAST_COMMAND_TIMEOUT_MS = 4_000;
const FAST_COMMANDS: Record<string, true> = {
	abort: true,
	abort_bash: true,
	abort_and_restore_queue: true,
	negotiate_capabilities: true
};

/** Un rapporto di blocco al massimo ogni tanto: un blocco fa scadere in
 *  cascata tutte le richieste in volo, e basta fotografarlo una volta. */
const HANG_REPORT_MIN_INTERVAL_MS = 30_000;
/** Tetto alle `invoke` del rapporto: se anche l'IPC e' fermo, l'errore al
 *  chiamante non deve aspettare oltre. */
const HANG_REPORT_INVOKE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`nessuna risposta entro ${ms / 1000}s`)), ms))
	]);
}
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
	/**
	 * Generazione dell'apertura corrente. Un `open()` piu' recente (o un
	 * `close()`) rende stale quello in volo: i suoi frame non vanno ridotti e
	 * il suo processo, se nasce comunque, va chiuso. Senza questo contatore
	 * due processi omp restavano vivi sullo stesso progetto e spingevano
	 * entrambi i loro eventi nello stesso riduttore.
	 */
	private openEpoch = 0;
	private seq = 0;
	private readonly pending = new Map<string, Pending>();
	private eventHandler: ((event: AgentSessionEvent) => void) | null = null;
	private closed = false;
	private abortEpoch = 0;
	/** Frame consegnati dal Channel dell'apertura corrente: confrontati con
	 *  quelli spediti da Rust dicono se il Channel si e' fermato. */
	private tally: ClientTally = newTally();
	private lastHangReportAt = 0;
	get currentAbortEpoch(): number {
		return this.abortEpoch;
	}

	get id(): number | null {
		return this.rpcId;
	}
	/** Generazione dell'apertura: ogni processo omp ne ha una sua, mai riusata. */
	get epoch(): number {
		return this.openEpoch;
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

	async open(
		cwd: string,
		resume?: string | null,
		opts?: { laneId?: string | null; projectId?: string | null; continueLast?: boolean; model?: string | null }
	): Promise<number> {
		const epoch = ++this.openEpoch;
		const channel = new Channel<string>();
		const tally = (this.tally = newTally());
		channel.onmessage = (line) => {
			const index = tally.count++;
			tally.lastAt = Date.now();
			// Frame di un processo superato: la sessione ne sta aprendo un
			// altro. Ridurli significherebbe insediarsi sul primo processo
			// pronto invece che su quello richiesto, e con una sessione nuova
			// e vuota il transcript ricostruito resta vuoto per sempre.
			if (epoch !== this.openEpoch) return;
			this.receive(line, index);
		};
		this.rpcId = null;
		this.closed = false;
		const rpcId = await invoke<number>('rpc_open', {
			cwd,
			resume: resume ?? null,
			laneId: opts?.laneId ?? null,
			projectId: opts?.projectId ?? null,
			continueLast: opts?.continueLast ?? false,
			model: opts?.model ?? null,
			onEvent: channel
		});
		// Un processo che fallisce in avvio puo' emettere `studio_exit` prima
		// che la Promise di `rpc_open` venga risolta. Non rianimare quell'id.
		// Stesso trattamento per un'apertura superata: il processo e' nato ed
		// e' vivo, e senza questa chiusura resterebbe a tenere la sessione.
		if (this.closed || epoch !== this.openEpoch) {
			void invoke('rpc_close', { rpcId }).catch(() => {});
			return rpcId;
		}
		this.rpcId = rpcId;
		return rpcId;
	}

	async openLab(opts: {
		workspacePath: string;
		projectPath: string | null;
		prototypeId: string;
		projectId?: string | null;
		laneId?: string | null;
		resume?: string | null;
		continueLast?: boolean;
		model?: string | null;
	}): Promise<number> {
		const epoch = ++this.openEpoch;
		const channel = new Channel<string>();
		const tally = (this.tally = newTally());
		channel.onmessage = (line) => {
			const index = tally.count++;
			tally.lastAt = Date.now();
			if (epoch !== this.openEpoch) return;
			this.receive(line, index);
		};
		this.rpcId = null;
		this.closed = false;
		const rpcId = await invoke<number>('rpc_open_lab', {
			workspacePath: opts.workspacePath,
			projectPath: opts.projectPath ?? null,
			prototypeId: opts.prototypeId,
			projectId: opts.projectId ?? null,
			laneId: opts.laneId ?? null,
			resume: opts.resume ?? null,
			continueLast: opts.continueLast ?? false,
			model: opts.model ?? null,
			onEvent: channel
		});
		if (this.closed || epoch !== this.openEpoch) {
			void invoke('rpc_close', { rpcId }).catch(() => {});
			return rpcId;
		}
		this.rpcId = rpcId;
		return rpcId;
	}

	/** L'overlay appartiene al processo, non alla configurazione globale di omp. */
	async setPrewalk(enabled: boolean): Promise<void> {
		if (this.rpcId === null || this.closed) throw rpcError('Sessione RPC non aperta', 'prewalk');
		await invoke('rpc_set_prewalk', { rpcId: this.rpcId, enabled });
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
			command.type === 'login'
				? LOGIN_TIMEOUT_MS
				: SLOW_COMMANDS[command.type] === true
					? SLOW_COMMAND_TIMEOUT_MS
					: FAST_COMMANDS[command.type] === true
						? FAST_COMMAND_TIMEOUT_MS
						: DEFAULT_TIMEOUT_MS;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const sentAt = Date.now();

		const timer = window.setTimeout(() => {
			this.pending.delete(id);
			const message = `Nessuna risposta a "${command.type}" entro ${timeoutMs / 1000}s`;
			void this.reportHang(id, command.type, sentAt, timeoutMs).then((path) =>
				reject(rpcError(path ? `${message}. Rapporto diagnostico: ${path}` : message, command.type, 'timeout'))
			);
		}, timeoutMs);

		this.pending.set(id, { id, command: command.type, resolve, reject, timer, sentAt });
		try {
			await invoke('rpc_send', { rpcId: this.rpcId, line: JSON.stringify({ id, ...command }) });
		} catch (error) {
			window.clearTimeout(timer);
			this.pending.delete(id);
			throw rpcError(error instanceof Error ? error.message : String(error), command.type, 'transport');
		}
		return (await promise) as T;
	}

	/** Elenco dei provider OAuth disponibili per il login, con stato di autenticazione corrente. */
	async getLoginProviders(): Promise<LoginProviderInfo[]> {
		const data = await this.send<{ providers: LoginProviderInfo[] }>({ type: 'get_login_providers' });
		return data.providers;
	}

	/**
	 * Avvia il login OAuth per un provider. Il server risponde emettendo una
	 * `open_url` extension_ui_request per l'URL di autenticazione (ed
	 * eventualmente una `input` per il codice incollato): entrambe arrivano
	 * come normali frame sul canale eventi, gestite dal riduttore di sessione.
	 */
	async login(providerId: string): Promise<{ providerId: string }> {
		return this.send({ type: 'login', providerId });
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
			await invoke('rpc_abort', { rpcId }).catch(() =>
				Promise.allSettled([
					invoke('rpc_send', { rpcId, line: JSON.stringify({ id: abortId, type: 'abort' }) }),
					invoke('rpc_send', { rpcId, line: JSON.stringify({ id: abortBashId, type: 'abort_bash' }) })
				])
			);
		} catch (error) {
			console.warn('Errore invio frame abort su RPC:', error);
		}
	}

	/**
	 * Forza l'arresto immediato dell'agente e dell'intero albero di processi figli (SIGKILL / taskkill).
	 */
	async forceKill(): Promise<void> {
		if (this.rpcId === null || this.closed) return;
		this.abortEpoch++;
		this.abortPendingRequests('Arresto forzato immediato (SIGKILL)');
		const rpcId = this.rpcId;
		try {
			await invoke('rpc_force_kill', { rpcId }).catch(() =>
				invoke('force_kill_session', { rpcId })
			);
		} catch (error) {
			console.warn('Errore invocazione force kill su RPC:', error);
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

	/**
	 * Stop con recupero della coda. `abort_and_restore_queue` e' l'unico comando
	 * la cui risposta ci serve: `abortPendingRequests` cancella tutto il resto
	 * PRIMA dell'invio (come `abort`), poi la richiesta parte dal percorso
	 * normale e si attende con il suo timeout. Cosi' le altre promise in volo si
	 * sbloccano subito senza rischiare di uccidere l'unica risposta utile, e se
	 * il processo e' bloccato la richiesta scade mentre `forceKill` (una `invoke`
	 * a se') resta comunque disponibile.
	 *
	 * Un omp piu' vecchio del 18.4.4 non conosce il comando: in quel caso si
	 * ripiega sull'`abort` semplice, che ferma il turno ma non restituisce la
	 * coda. Il ripiego e' innocuo anche quando la risposta si e' solo persa,
	 * perche' l'abort di omp e' idempotente.
	 */
	async abortAndRestoreQueue(): Promise<AbortAndRestoreQueueResult | null> {
		if (this.rpcId === null || this.closed) return null;
		this.abortEpoch++;
		this.abortPendingRequests('Interrotto dall\u2019utente');
		const rpcId = this.rpcId;
		// `abort_and_restore_queue` fa l'abort del turno, `abort_bash` ferma il
		// processo figlio in corso e sblocca i buffer di delta lato Rust.
		void invoke('rpc_send', { rpcId, line: JSON.stringify({ id: `s${++this.seq}`, type: 'abort_bash' }) }).catch(
			() => {}
		);
		try {
			const data = await this.send<AbortAndRestoreQueueResult>({ type: 'abort_and_restore_queue' });
			return data ?? null;
		} catch (error) {
			console.warn('abort_and_restore_queue non disponibile, ripiego su abort:', error);
			void this.abort();
			return null;
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
		// Un'apertura ancora in volo non ha ancora un `rpcId` da chiudere: la
		// generazione la invalida, e il processo verra' chiuso appena nasce.
		this.openEpoch++;
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

	/**
	 * Fotografa il trasporto quando un comando resta senza risposta e scrive
	 * il rapporto nella cartella dei log. Restituisce il percorso, o `null` se
	 * il rapporto e' stato saltato o non si e' potuto scrivere. Non rigetta mai:
	 * chi la chiama deve comunque far fallire il comando.
	 */
	private async reportHang(commandId: string, command: string, sentAt: number, timeoutMs: number): Promise<string | null> {
		const rpcId = this.rpcId;
		const started = Date.now();
		if (rpcId === null || started - this.lastHangReportAt < HANG_REPORT_MIN_INTERVAL_MS) return null;
		this.lastHangReportAt = started;
		// Copia ora: mentre si attende il backend possono arrivare altri frame.
		const client: ClientTally = { ...this.tally, recent: [...this.tally.recent] };
		const pending = [...this.pending.values()].map((entry) => ({ id: entry.id, command: entry.command, sentAt: entry.sentAt }));
		let backend: BackendDiagnostics | null = null;
		let backendError: string | null = null;
		try {
			backend = await withTimeout(invoke<BackendDiagnostics>('rpc_diagnostics', { rpcId }), HANG_REPORT_INVOKE_TIMEOUT_MS);
		} catch (error) {
			backendError = error instanceof Error ? error.message : String(error);
		}
		const report = buildHangReport({
			// L'istante del backend, se c'e': e' quello dei suoi contatori.
			now: backend?.transport.nowMs ?? Date.now(),
			commandId,
			command,
			sentAt,
			timeoutMs,
			client,
			pending,
			backend,
			backendError
		});
		console.error('[rpc-hang]', report.verdict.join(' | '));
		try {
			return await withTimeout(
				invoke<string>('rpc_write_hang_report', { report: JSON.stringify(report, null, 2) }),
				HANG_REPORT_INVOKE_TIMEOUT_MS
			);
		} catch (error) {
			console.error('[rpc-hang] scrittura del rapporto fallita:', error, report);
			return null;
		}
	}

	private receive(line: string, index: number) {
		if (this.closed) return;
		let frame: unknown;
		try {
			frame = JSON.parse(line);
		} catch (error) {
			noteReceived(this.tally, index, line.length, '<illeggibile>', Date.now());
			console.error('Frame RPC illeggibile:', error, line.slice(0, 400));
			return;
		}
		if (!frame || typeof frame !== 'object') return;
		const event = frame as AgentSessionEvent;
		noteReceived(this.tally, index, line.length, frameLabel(event), Date.now());

		if (event.type === 'response') {
			this.settle(frame as RpcResponse);
			return;
		}
		if (event.type === 'studio_exit') {
			this.closed = true;
			this.rpcId = null;
			this.abortPendingRequests('Sessione OMP terminata');
		}
		try {
			this.eventHandler?.(event);
		} catch (error) {
			// Channel avanza l'indice solo dopo il ritorno di onmessage:
			// propagare qui un errore del riduttore bloccherebbe per sempre
			// anche gli eventi successivi e le risposte ai comandi.
			// Rilanciarlo fuori dalla callback preserva errore e stack nei
			// diagnostici del WebView senza avvelenare il trasporto.
			queueMicrotask(() => { throw error; });
		}
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
