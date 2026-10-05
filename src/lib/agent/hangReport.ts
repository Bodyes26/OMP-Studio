// Rapporto di blocco del trasporto RPC.
//
// Il sintomo che vede l'utente (chat ferma, barra "in esecuzione", prompt
// rifiutato dopo 60 s) e' lo stesso per guasti in punti diversi della catena
// omp -> stdout -> Rust -> Channel Tauri -> WebView. Il rapporto mette uno
// accanto all'altro i contatori dei due lati e ne deduce dove la catena si e'
// fermata: senza, ogni blocco si potrebbe solo raccontare, non localizzare.

/** Frame consegnato dal Channel al client, nell'ordine di consegna. */
export interface ReceivedFrame {
	index: number;
	at: number;
	/** Lunghezza in caratteri UTF-16, non in byte: basta a riconoscere i frame grandi. */
	chars: number;
	type: string;
}

export interface ClientTally {
	/** Frame consegnati da questo Channel: e' anche l'indice del prossimo atteso. */
	count: number;
	lastAt: number;
	recent: ReceivedFrame[];
}

export const RECENT_RECEIVED_FRAMES = 48;

export function newTally(): ClientTally {
	return { count: 0, lastAt: 0, recent: [] };
}

export function noteReceived(tally: ClientTally, index: number, chars: number, type: string, at: number) {
	tally.recent.push({ index, at, chars, type });
	if (tally.recent.length > RECENT_RECEIVED_FRAMES) tally.recent.shift();
}

/** Etichetta del frame, uguale a quella della scatola nera in Rust: una
 *  `response` porta comando e id, cosi' i due elenchi si confrontano a vista. */
export function frameLabel(frame: { type?: unknown; command?: unknown; id?: unknown }): string {
	const type = typeof frame.type === 'string' ? frame.type : '?';
	if (type !== 'response') return type;
	const command = typeof frame.command === 'string' ? frame.command : '?';
	const id = typeof frame.id === 'string' ? frame.id : '-';
	return `response:${command}#${id}`;
}

/** Forma di `rpc_diagnostics` (src-tauri/src/rpc/mod.rs + rpc/diag.rs). */
export interface BackendDiagnostics {
	rpcId: number;
	pid: number | null;
	childAlive: boolean | null;
	killed: boolean;
	protocol: number;
	sessionId: string | null;
	transport: {
		nowMs: number;
		stdoutLines: number;
		stdoutBytes: number;
		lastStdoutMs: number;
		framesSent: number;
		tauriFetchPathFrames: number;
		sendErrors: number;
		lastSentMs: number;
		stdinWrites: number;
		lastStdinMs: number;
		stdinWriteSinceMs: number | null;
		readerExited: boolean;
		recentFrames: { index: number; atMs: number; bytes: number; kind: string; tauriFetchPath: boolean }[];
	};
	processTree: { cpuMsInLast500ms: number; totalCpuMs: number; activeProcesses: number } | null;
	stderrTail: string[];
}

export interface HangInput {
	now: number;
	commandId: string;
	command: string;
	sentAt: number;
	timeoutMs: number;
	client: ClientTally;
	pending: { id: string; command: string; sentAt: number }[];
	backend: BackendDiagnostics | null;
	backendError: string | null;
}

/** Una scrittura su stdin ferma da piu' di cosi' non e' lentezza: omp non legge. */
const STDIN_STUCK_MS = 5_000;
/** CPU oltre questa quota del mezzo secondo campionato: omp sta calcolando, non aspettando. */
const BUSY_CPU_MS = 250;
/** Un frame spedito da meno di cosi' puo' essere ancora in viaggio verso il WebView. */
const IN_FLIGHT_MS = 2_000;
/** Righe stdout medie oltre questa taglia sono istantanee del messaggio, non delta. */
const SNAPSHOT_LINE_BYTES = 16 * 1024;

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;

/**
 * Dove si e' fermata la catena, in ordine dal guasto piu' a valle (WebView)
 * a quello piu' a monte (omp). La prima voce e' la diagnosi; le altre sono
 * osservazioni che la qualificano.
 */
export function diagnoseHang(input: HangInput): string[] {
	const { now, client, backend } = input;
	if (!backend) {
		return [
			`Il backend di Studio non ha risposto a rpc_diagnostics (${input.backendError ?? 'nessun dettaglio'}): ` +
				'si e\u2019 fermato l\u2019IPC Tauri o il processo di Studio, non omp.'
		];
	}
	const findings: string[] = [];
	const t = backend.transport;
	const responseLabel = `response:${input.command}#${input.commandId}`;
	const responseFrame = t.recentFrames.find((frame) => frame.kind === responseLabel);

	if (backend.childAlive === false || t.readerExited) {
		findings.push('Il processo omp e\u2019 terminato o il lettore di stdout si e\u2019 chiuso, ma la sessione e\u2019 ancora aperta.');
	}

	// Un frame mancante spedito da pochi istanti e' solo in viaggio: il
	// Channel e' fermo quando il primo frame non consegnato e' vecchio.
	const missing = t.recentFrames.find((frame) => frame.index === client.count);
	const gap = t.framesSent - client.count;
	const stalled = gap > 0 && (!missing || now - missing.atMs > IN_FLIGHT_MS);
	if (stalled) {
		const detail = missing
			? ` Primo frame mancante: indice ${missing.index}, "${missing.kind}", ${missing.bytes} byte` +
				(missing.tauriFetchPath ? ', consegnato da Tauri via fetch (>= 8192 byte).' : ', consegnato da Tauri via eval.')
			: ` Primo frame mancante: indice ${client.count}, fuori dagli ultimi ${t.recentFrames.length} registrati.`;
		findings.push(
			`Channel Tauri fermo: Rust ha spedito ${t.framesSent} frame, il WebView ne ha consegnati ${client.count}.` +
				` Il Channel consegna solo in ordine, quindi tutti i ${gap} successivi restano in coda.` +
				detail
		);
		if (responseFrame) {
			findings.push(`La risposta a "${input.command}" (${input.commandId}) e\u2019 arrivata a Rust (frame ${responseFrame.index}) ma non al client.`);
		}
		if (t.sendErrors > 0) findings.push(`Invii falliti sul Channel lato Rust: ${t.sendErrors}.`);
	}

	if (t.stdinWriteSinceMs !== null && now - t.stdinWriteSinceMs > STDIN_STUCK_MS) {
		findings.push(`omp non legge stdin: una scrittura e\u2019 ferma da ${seconds(now - t.stdinWriteSinceMs)}.`);
	}

	if (!stalled) {
		if (t.lastStdoutMs < input.sentAt) {
			findings.push(
				t.lastStdoutMs === 0
					? 'omp muto: non ha mai scritto su stdout.'
					: `omp muto: nessuna riga su stdout da ${seconds(now - t.lastStdoutMs)}, cioe\u2019 da prima dell\u2019invio del comando.`
			);
		} else if (responseFrame) {
			findings.push(`La risposta a "${input.command}" e\u2019 stata consegnata al client: il blocco e\u2019 nella correlazione delle risposte.`);
		} else {
			const avgLine = t.stdoutLines > 0 ? t.stdoutBytes / t.stdoutLines : 0;
			findings.push(
				avgLine >= SNAPSHOT_LINE_BYTES
					? `omp scrive su stdout e il client riceve tutto, ma le righe sono in media di ${Math.round(avgLine / 1024)} KB: ` +
						'omp spedisce l\u2019istantanea intera del messaggio a ogni delta, accumula l\u2019output in arretrato ' +
						`e la risposta a "${input.command}" e\u2019 ancora in coda dietro i frame vecchi.`
					: `omp scrive su stdout (ultima riga ${seconds(now - t.lastStdoutMs)} fa) e il client riceve tutto, ` +
						`ma non ha mai risposto a "${input.command}": il comando e\u2019 fermo dentro omp.`
			);
		}
	}

	const tree = backend.processTree;
	if (tree) {
		findings.push(
			tree.cpuMsInLast500ms >= BUSY_CPU_MS
				? `L\u2019albero di omp consuma CPU (${tree.cpuMsInLast500ms} ms su 500): sta calcolando, non aspettando.`
				: `L\u2019albero di omp e\u2019 quasi fermo (${tree.cpuMsInLast500ms} ms di CPU su 500): sta aspettando qualcosa.`
		);
		if (tree.activeProcesses > 1) {
			findings.push(`Processi attivi nell\u2019albero di omp: ${tree.activeProcesses} (omp piu\u2019 tool o figli ancora in corso).`);
		}
	}
	return findings;
}

/** Rapporto completo da scrivere su disco: diagnosi in testa, dati grezzi sotto. */
export function buildHangReport(input: HangInput) {
	return {
		kind: 'omp-studio-rpc-hang',
		at: new Date(input.now).toISOString(),
		verdict: diagnoseHang(input),
		command: { id: input.commandId, type: input.command, sentAt: input.sentAt, timeoutMs: input.timeoutMs },
		pending: input.pending.map((entry) => ({ ...entry, ageMs: input.now - entry.sentAt })),
		client: {
			framesReceived: input.client.count,
			lastFrameAt: input.client.lastAt,
			msSinceLastFrame: input.client.lastAt ? input.now - input.client.lastAt : null,
			recentFrames: input.client.recent
		},
		backend: input.backend,
		backendError: input.backendError
	};
}
