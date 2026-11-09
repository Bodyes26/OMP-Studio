// Rapporto di blocco del trasporto RPC.
//
// Il sintomo che vede l'utente (chat ferma, barra "in esecuzione", prompt
// rifiutato dopo 60 s) e' lo stesso per guasti in punti diversi della catena
// omp -> stdout -> Rust -> Channel Tauri -> WebView. Il rapporto mette uno
// accanto all'altro i contatori dei due lati e ne deduce dove la catena si e'
// fermata: senza, ogni blocco si potrebbe solo raccontare, non localizzare.

import { m as msg } from '#lib/paraglide/messages.js';

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
	recent: (ReceivedFrame | undefined)[];
	/** Indice della prossima scrittura nel ring buffer (0..47) */
	recentHead: number;
}

export const RECENT_RECEIVED_FRAMES = 48;

export function newTally(): ClientTally {
	return { count: 0, lastAt: 0, recent: new Array(RECENT_RECEIVED_FRAMES), recentHead: 0 };
}

export function noteReceived(tally: ClientTally, index: number, chars: number, type: string, at: number) {
	const slot = tally.recent[tally.recentHead];
	if (slot) {
		slot.index = index;
		slot.at = at;
		slot.chars = chars;
		slot.type = type;
	} else {
		tally.recent[tally.recentHead] = { index, at, chars, type };
	}
	tally.recentHead = (tally.recentHead + 1) % RECENT_RECEIVED_FRAMES;
}

/**
 * Estrae i frame recenti in ordine cronologico (dal piu' vecchio al piu' recente).
 * Supporta sia il ring buffer a indice fisso sia eventuali array piatti (es. mock di test).
 */
export function getRecentFrames(tally: ClientTally): ReceivedFrame[] {
	if (!tally.recent || tally.recent.length === 0) return [];
	if (tally.recentHead === undefined) {
		return (tally.recent as (ReceivedFrame | undefined)[]).filter((f): f is ReceivedFrame => f !== undefined);
	}
	const result: ReceivedFrame[] = [];
	const total = Math.min(tally.count, RECENT_RECEIVED_FRAMES);
	const start = (tally.recentHead - total + RECENT_RECEIVED_FRAMES) % RECENT_RECEIVED_FRAMES;
	for (let i = 0; i < total; i++) {
		const frame = tally.recent[(start + i) % RECENT_RECEIVED_FRAMES];
		if (frame) {
			result.push({ ...frame });
		}
	}
	return result;
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
			msg.l10n_agent_hang_backend_unavailable({
				error: input.backendError ?? msg.l10n_agent_hang_no_detail()
			})
		];
	}
	const findings: string[] = [];
	const t = backend.transport;
	const responseLabel = `response:${input.command}#${input.commandId}`;
	const responseFrame = t.recentFrames.find((frame) => frame.kind === responseLabel);

	if (backend.childAlive === false || t.readerExited) {
		findings.push(msg.l10n_agent_hang_omp_exited());
	}

	// Un frame mancante spedito da pochi istanti e' solo in viaggio: il
	// Channel e' fermo quando il primo frame non consegnato e' vecchio.
	const missing = t.recentFrames.find((frame) => frame.index === client.count);
	const gap = t.framesSent - client.count;
	const stalled = gap > 0 && (!missing || now - missing.atMs > IN_FLIGHT_MS);
	if (stalled) {
		const detail = missing
			? ' ' +
				msg.l10n_agent_hang_missing_frame_index({
					index: missing.index,
					kind: missing.kind,
					bytes: missing.bytes
				}) +
				(missing.tauriFetchPath
					? msg.l10n_agent_hang_via_fetch()
					: msg.l10n_agent_hang_via_eval())
			: ' ' +
				msg.l10n_agent_hang_missing_frame_outside({
					index: client.count,
					count: t.recentFrames.length
				});
		findings.push(
			msg.l10n_agent_hang_channel_stalled({ sent: t.framesSent, delivered: client.count }) +
				' ' +
				msg.l10n_agent_hang_channel_queue({ gap }) +
				detail
		);
		if (responseFrame) {
			findings.push(
				msg.l10n_agent_hang_response_stuck_rust({
					command: input.command,
					commandId: input.commandId,
					frame: responseFrame.index
				})
			);
		}
		if (t.sendErrors > 0) findings.push(msg.l10n_agent_hang_send_errors({ count: t.sendErrors }));
	}

	if (t.stdinWriteSinceMs !== null && now - t.stdinWriteSinceMs > STDIN_STUCK_MS) {
		findings.push(msg.l10n_agent_hang_stdin_stuck({ seconds: seconds(now - t.stdinWriteSinceMs) }));
	}

	if (!stalled) {
		if (t.lastStdoutMs < input.sentAt) {
			findings.push(
				t.lastStdoutMs === 0
					? msg.l10n_agent_hang_omp_silent_never()
					: msg.l10n_agent_hang_omp_silent_since({ seconds: seconds(now - t.lastStdoutMs) })
			);
		} else if (responseFrame) {
			findings.push(msg.l10n_agent_hang_response_delivered({ command: input.command }));
		} else {
			const avgLine = t.stdoutLines > 0 ? t.stdoutBytes / t.stdoutLines : 0;
			findings.push(
				avgLine >= SNAPSHOT_LINE_BYTES
					? msg.l10n_agent_hang_snapshot_lines({
							kb: Math.round(avgLine / 1024),
							command: input.command
						})
					: msg.l10n_agent_hang_writes_no_reply({
							seconds: seconds(now - t.lastStdoutMs),
							command: input.command
						})
			);
		}
	}

	const tree = backend.processTree;
	if (tree) {
		findings.push(
			tree.cpuMsInLast500ms >= BUSY_CPU_MS
				? msg.l10n_agent_hang_tree_busy({ cpu: tree.cpuMsInLast500ms })
				: msg.l10n_agent_hang_tree_idle({ cpu: tree.cpuMsInLast500ms })
		);
		if (tree.activeProcesses > 1) {
			findings.push(msg.l10n_agent_hang_tree_processes({ count: tree.activeProcesses }));
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
			recentFrames: getRecentFrames(input.client)
		},
		backend: input.backend,
		backendError: input.backendError
	};
}
