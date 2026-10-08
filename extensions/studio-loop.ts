// Estensione OMP: /loop nella chat GUI di Studio (rpc-ui).
//
// In omp `/loop` vive solo nella TUI (`InteractiveMode`): via RPC il testo
// arriverebbe al modello come prompt normale. Questa estensione ne replica la
// semantica per la GUI, usando i soli ganci pubblici delle estensioni:
// - l'handler `input` gira prima dei builtin anche in RPC e consuma `/loop …`
//   e i comandi di controllo `/studio-loop …` che la GUI invia (pausa, stop…);
// - `agent_end` chiude un giro, `sendUserMessage` avvia il successivo dopo
//   800 ms (come la TUI, che lascia il tempo di fermarsi);
// - la condizione `--until/--while` gira in una shell separata (`pi.exec`),
//   cosi' non sporca la shell dell'agente ne' il contesto;
// - lo stato va alla GUI con `ctx.ui.setStatus("studio.loop", json)` e resta
//   nel file di sessione con `appendEntry` (sopravvive al resume).
//
// Nel Terminale (TUI) l'estensione non fa nulla: li' resta il /loop nativo.
//
// Le funzioni pure (parser, shell, verdetti, motore) sono esportate per i test
// e per la GUI, che riusa il parser: niente import di moduli Node a livello di
// file, il modulo deve restare caricabile anche nel bundle del frontend.

/* ------------------------------------------------------------------------ */
/* Tipi                                                                      */
/* ------------------------------------------------------------------------ */

export type LoopLimitConfig =
	| { kind: "iterations"; iterations: number }
	| { kind: "duration"; durationMs: number };

export type LoopLimitRuntime =
	| { kind: "iterations"; initial: number; remaining: number }
	| { kind: "duration"; durationMs: number; deadlineMs: number };

/** `until: true` = continua finche' il comando fallisce (`--until`). */
export interface LoopConditionConfig {
	command: string;
	until: boolean;
}

/** Cosa fare tra un giro e l'altro (`loop.mode` di omp). */
export type LoopBetween = "prompt" | "compact" | "reset";

export interface ParsedLoopArgs {
	limit?: LoopLimitConfig;
	condition?: LoopConditionConfig;
	between?: LoopBetween;
	prompt?: string;
}

export type LoopStatus =
	| "armed" // attivo, aspetta il prompt (`/loop 5` senza testo)
	| "running" // giro in corso
	| "checking" // condizione in esecuzione
	| "waiting" // pausa di 800 ms tra due giri
	| "resetting" // aspetta la sessione nuova (`--between reset`)
	| "paused"
	| "done"
	| "stopped"
	| "error";

export type LoopEndReason =
	| "limit"
	| "duration"
	| "condition"
	| "stopped"
	| "condition-error"
	| "condition-timeout";

export interface LoopCheck {
	exit: number | null;
	/** Ultima riga significativa dell'output, troncata. */
	out: string;
	at: number;
}

export interface LoopGiro {
	n: number;
	startedAt: number;
	endedAt?: number;
	/** Giro interrotto (Stop o abort). */
	aborted?: boolean;
	/** Controllo eseguito dopo questo giro, prima del successivo. */
	check?: LoopCheck;
}

export interface LoopState {
	id: string;
	prompt?: string;
	limit?: LoopLimitRuntime;
	condition?: LoopConditionConfig;
	between: LoopBetween;
	status: LoopStatus;
	/** Pausa chiesta durante un giro: scatta a fine giro. */
	pauseRequested: boolean;
	giro: number;
	startedAt: number;
	endedAt?: number;
	giri: LoopGiro[];
	end?: { reason: LoopEndReason; exit?: number | null; detail?: string };
	/** Ripristinato da un resume: messo in pausa per non ripartire da solo. */
	restored?: boolean;
}

export interface LoopProbe {
	command: string;
	running: boolean;
	exit?: number | null;
	out?: string;
	timedOut?: boolean;
	error?: string;
	at: number;
}

/** Quello che la GUI riceve con `setStatus("studio.loop", …)`. */
export interface LoopSnapshot {
	v: 1;
	loop: LoopState | null;
	probe: LoopProbe | null;
}

export const LOOP_STATUS_KEY = "studio.loop";
export const LOOP_ENTRY_TYPE = "studio-loop";
export const LOOP_CONTROL_COMMAND = "/studio-loop";
/** Attesa fra un giro e l'altro, come `#deferLoopAutoSubmit` della TUI. */
export const LOOP_GAP_MS = 800;
/** Default di `loop.conditionTimeoutMs` in omp. */
export const LOOP_CONDITION_TIMEOUT_MS = 30_000;
const MAX_KEPT_GIRI = 200;

/* ------------------------------------------------------------------------ */
/* Parser (compatibile con `modes/loop-limit.ts` di omp)                     */
/* ------------------------------------------------------------------------ */

const TIME_UNITS_MS = new Map<string, number>([
	["s", 1_000],
	["sec", 1_000],
	["secs", 1_000],
	["second", 1_000],
	["seconds", 1_000],
	["m", 60_000],
	["min", 60_000],
	["mins", 60_000],
	["minute", 60_000],
	["minutes", 60_000],
	["h", 3_600_000],
	["hr", 3_600_000],
	["hrs", 3_600_000],
	["hour", 3_600_000],
	["hours", 3_600_000]
]);

export const LOOP_USAGE =
	"Usage: /loop [count|duration] [--while|--until '<command>'] [--between prompt|compact|reset] [prompt]";

/**
 * Legge una parola shell all'inizio di `input` (apici singoli, doppi, `\`).
 * `undefined` se non c'e' nulla, `"unterminated"` per un apice aperto.
 */
export function readShellWord(input: string): { value: string; rest: string } | "unterminated" | undefined {
	let i = 0;
	while (i < input.length && /\s/.test(input[i])) i++;
	if (i >= input.length) return undefined;
	let value = "";
	while (i < input.length && !/\s/.test(input[i])) {
		const ch = input[i];
		if (ch === "'") {
			const end = input.indexOf("'", i + 1);
			if (end === -1) return "unterminated";
			value += input.slice(i + 1, end);
			i = end + 1;
		} else if (ch === '"') {
			i++;
			let closed = false;
			while (i < input.length) {
				const c = input[i];
				if (c === "\\" && i + 1 < input.length && /["\\$`]/.test(input[i + 1])) {
					value += input[i + 1];
					i += 2;
					continue;
				}
				if (c === '"') {
					closed = true;
					i++;
					break;
				}
				value += c;
				i++;
			}
			if (!closed) return "unterminated";
		} else if (ch === "\\" && i + 1 < input.length) {
			value += input[i + 1];
			i += 2;
		} else {
			value += ch;
			i++;
		}
	}
	return { value, rest: input.slice(i).trim() };
}

/** Quota per la shell: apici singoli, `'` come `'\''`. */
export function quoteShellWord(value: string): string {
	if (value && /^[A-Za-z0-9_./:=@%+,-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function makeIterations(text: string): LoopLimitConfig | string {
	const amount = Number(text);
	if (!Number.isSafeInteger(amount) || amount <= 0) return "Loop count must be a positive integer.";
	return { kind: "iterations", iterations: amount };
}

function makeDuration(text: string, unitMs: number): LoopLimitConfig | string {
	const amount = Number(text);
	if (!Number.isSafeInteger(amount) || amount <= 0) return "Loop duration must be positive.";
	return { kind: "duration", durationMs: amount * unitMs };
}

function parseCompoundDuration(token: string): LoopLimitConfig | string | undefined {
	if (!/^(?:\d+[a-z]+)+$/.test(token)) return undefined;
	const segments = token.match(/\d+[a-z]+/g);
	if (!segments) return undefined;
	let total = 0;
	for (const segment of segments) {
		const match = /^(\d+)([a-z]+)$/.exec(segment);
		if (!match) return LOOP_USAGE;
		const unit = TIME_UNITS_MS.get(match[2]);
		if (unit === undefined) return "Loop duration unit must be seconds, minutes, or hours.";
		const amount = Number(match[1]);
		if (!Number.isSafeInteger(amount) || amount <= 0) return "Loop duration must be positive.";
		total += amount * unit;
	}
	if (total <= 0) return "Loop duration must be positive.";
	return { kind: "duration", durationMs: total };
}

function takeLimit(input: string): { limit?: LoopLimitConfig; rest: string } | string {
	const firstSpace = input.search(/\s/);
	const first = firstSpace === -1 ? input : input.slice(0, firstSpace);
	const rest = firstSpace === -1 ? "" : input.slice(firstSpace + 1).trim();
	const token = first.toLowerCase();
	if (!/^[+-]?\d/.test(token)) return { rest: input };
	if (/^\d+$/.test(token)) {
		if (rest) {
			const unitToken = /^\S+/.exec(rest)?.[0] ?? "";
			const unitMs = TIME_UNITS_MS.get(unitToken.toLowerCase());
			if (unitMs !== undefined) {
				const limit = makeDuration(token, unitMs);
				if (typeof limit === "string") return limit;
				return { limit, rest: rest.slice(unitToken.length).trim() };
			}
		}
		const limit = makeIterations(token);
		if (typeof limit === "string") return limit;
		return { limit, rest };
	}
	const duration = parseCompoundDuration(token);
	if (duration !== undefined) {
		if (typeof duration === "string") return duration;
		return { limit: duration, rest };
	}
	return LOOP_USAGE;
}

/**
 * `/loop` di omp piu' `--between` (solo Studio: in omp e' l'impostazione
 * `loop.mode`). Un token che sembra un limite o un flag ma non si legge e' un
 * errore, non testo del prompt: un refuso non deve diventare un loop infinito.
 * Restituisce il messaggio d'errore quando non si legge.
 */
export function parseLoopArgs(args: string): ParsedLoopArgs | string {
	const trimmed = args.trim();
	if (!trimmed) return {};
	const limitResult = takeLimit(trimmed);
	if (typeof limitResult === "string") return limitResult;
	let rest = limitResult.rest.trim();
	let condition: LoopConditionConfig | undefined;
	let between: LoopBetween | undefined;
	while (rest.startsWith("--")) {
		const name = /^(--[a-z][a-z-]*)(?=[\s=]|$)/.exec(rest)?.[1];
		if (name !== "--while" && name !== "--until" && name !== "--between") {
			return `Unknown /loop flag ${name ?? rest.split(/\s+/, 1)[0]}. ${LOOP_USAGE}`;
		}
		const after = rest.slice(name.length);
		const valueText = after.startsWith("=") ? after.slice(1) : after;
		const word = readShellWord(valueText);
		if (word === "unterminated") return `${name} has an unterminated quote.`;
		if (name === "--between") {
			const mode = word?.value.trim().toLowerCase();
			if (mode !== "prompt" && mode !== "compact" && mode !== "reset") {
				return "--between must be prompt, compact or reset.";
			}
			if (between) return "Use --between only once.";
			between = mode;
			rest = word ? word.rest : "";
			continue;
		}
		if (condition) return "Use only one of --while or --until.";
		if (word === undefined || !word.value.trim() || valueText.trim().startsWith("-")) {
			return `${name} needs a shell command. Quote it when it contains spaces: /loop ${name} 'npm test'.`;
		}
		condition = { command: word.value.trim(), until: name === "--until" };
		rest = word.rest;
	}
	const out: ParsedLoopArgs = {};
	if (limitResult.limit) out.limit = limitResult.limit;
	if (condition) out.condition = condition;
	if (between) out.between = between;
	if (rest) out.prompt = rest;
	return out;
}

/** Durata compatta per riga di comando: `90m` -> `1h30m`. */
export function formatDurationToken(ms: number): string {
	let seconds = Math.max(1, Math.round(ms / 1000));
	const h = Math.floor(seconds / 3600);
	seconds -= h * 3600;
	const m = Math.floor(seconds / 60);
	seconds -= m * 60;
	return `${h ? `${h}h` : ""}${m ? `${m}m` : ""}${seconds ? `${seconds}s` : ""}`;
}

/** L'inverso di `parseLoopArgs`: la riga `/loop …` che la GUI mostra e invia. */
export function formatLoopCommand(args: ParsedLoopArgs): string {
	const parts = ["/loop"];
	if (args.limit?.kind === "iterations") parts.push(String(args.limit.iterations));
	else if (args.limit?.kind === "duration") parts.push(formatDurationToken(args.limit.durationMs));
	if (args.condition) {
		parts.push(args.condition.until ? "--until" : "--while", quoteShellWord(args.condition.command));
	}
	if (args.between && args.between !== "prompt") parts.push("--between", args.between);
	if (args.prompt?.trim()) parts.push(args.prompt.trim());
	return parts.join(" ");
}

/* ------------------------------------------------------------------------ */
/* Limite e condizione                                                       */
/* ------------------------------------------------------------------------ */

export function createLimitRuntime(config: LoopLimitConfig | undefined, now: number): LoopLimitRuntime | undefined {
	if (!config) return undefined;
	if (config.kind === "iterations") {
		return { kind: "iterations", initial: config.iterations, remaining: config.iterations };
	}
	return { kind: "duration", durationMs: config.durationMs, deadlineMs: now + config.durationMs };
}

export function isLimitExhausted(limit: LoopLimitRuntime | undefined, now: number): boolean {
	if (!limit) return false;
	if (limit.kind === "duration") return now >= limit.deadlineMs;
	return limit.remaining <= 0;
}

export type ConditionVerdict =
	| { kind: "continue" }
	| { kind: "halt" }
	| { kind: "error"; reason: "condition-error" | "condition-timeout" }
	| { kind: "aborted" };

export interface ConditionRun {
	exit: number | null;
	out: string;
	timedOut: boolean;
	aborted: boolean;
	error?: string;
}

/**
 * Stessa tabella di `modes/loop-condition.ts`: exit 0/1 sono risposte, il
 * resto (127, 2, nessuno stato, timeout, mancato avvio) e' la condizione rotta.
 */
export function conditionVerdict(condition: LoopConditionConfig, run: ConditionRun): ConditionVerdict {
	if (run.timedOut) return { kind: "error", reason: "condition-timeout" };
	if (run.aborted) return { kind: "aborted" };
	if (run.error !== undefined) return { kind: "error", reason: "condition-error" };
	if (run.exit === 0) return condition.until ? { kind: "halt" } : { kind: "continue" };
	if (run.exit === 1) return condition.until ? { kind: "continue" } : { kind: "halt" };
	return { kind: "error", reason: "condition-error" };
}

/** Ultima riga non vuota dell'output, senza escape ANSI, al massimo `max` caratteri. */
export function summarizeOutput(output: string, max = 140): string {
	// biome-ignore lint: escape ANSI
	const clean = output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
	const lines = clean
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const last = lines[lines.length - 1] ?? "";
	return last.length > max ? `${last.slice(0, max - 1)}\u2026` : last;
}

/* ------------------------------------------------------------------------ */
/* Shell della condizione                                                    */
/* ------------------------------------------------------------------------ */

export interface ShellChoice {
	shell: string;
	args: (command: string) => string[];
}

function joinWin(...parts: string[]): string {
	return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, ""))).join("\\");
}

/**
 * La stessa ricerca di `resolveWindowsShell` di omp (Git Bash nei percorsi
 * noti, poi bash/sh sul PATH, infine cmd.exe), cosi' la condizione gira nella
 * shell che userebbe l'agente. Su POSIX: `$SHELL` se bash/zsh, altrimenti `sh`.
 */
export function resolveConditionShell(
	platform: string,
	env: Record<string, string | undefined>,
	exists: (path: string) => boolean,
	which: (name: string) => string | null
): ShellChoice {
	const posixArgs = (command: string) => ["-c", command];
	if (platform !== "win32") {
		const user = env.SHELL;
		if (user && (user.includes("bash") || user.includes("zsh")) && exists(user)) {
			return { shell: user, args: posixArgs };
		}
		return { shell: exists("/bin/bash") ? "/bin/bash" : "sh", args: posixArgs };
	}
	const roots = [
		env.ProgramFiles && joinWin(env.ProgramFiles, "Git"),
		env["ProgramFiles(x86)"] && joinWin(env["ProgramFiles(x86)"] as string, "Git"),
		env.LOCALAPPDATA && joinWin(env.LOCALAPPDATA, "Programs", "Git"),
		env.GIT_INSTALL_ROOT,
		env.SCOOP && joinWin(env.SCOOP, "apps", "git", "current"),
		env.USERPROFILE && joinWin(env.USERPROFILE, "scoop", "apps", "git", "current")
	];
	for (const root of roots) {
		if (!root) continue;
		const candidate = joinWin(root, "bin", "bash.exe");
		if (exists(candidate)) return { shell: candidate, args: posixArgs };
	}
	const bash = which("bash.exe") ?? which("bash");
	if (bash) return { shell: bash, args: posixArgs };
	const sh = which("sh.exe");
	if (sh) {
		const sibling = joinWin(sh.replace(/[\\/][^\\/]*$/, ""), "bash.exe");
		return { shell: exists(sibling) ? sibling : sh, args: posixArgs };
	}
	return {
		shell: env.ComSpec || env.COMSPEC || "C:\\Windows\\System32\\cmd.exe",
		args: (command: string) => ["/d", "/s", "/c", command]
	};
}

interface BunLike {
	which?: (name: string) => string | null;
}

/** Accesso al file system senza import statici: il modulo resta caricabile nel browser. */
function hostExists(path: string): boolean {
	try {
		const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
		const fs = proc?.getBuiltinModule?.("node:fs") as { existsSync?: (p: string) => boolean } | undefined;
		return fs?.existsSync?.(path) === true;
	} catch {
		return false;
	}
}

function hostWhich(name: string): string | null {
	const bun = (globalThis as { Bun?: BunLike }).Bun;
	try {
		return bun?.which?.(name) ?? null;
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------------ */
/* Motore                                                                    */
/* ------------------------------------------------------------------------ */

export interface LoopEngineDeps {
	now(): number;
	setTimer(callback: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
	newId(): string;
	isIdle(): boolean;
	abort(): void;
	sendPrompt(text: string): void;
	compact(): Promise<void>;
	runCondition(command: string, signal: AbortSignal): Promise<ConditionRun>;
	publish(snapshot: LoopSnapshot): void;
	persist(loop: LoopState | null): void;
}

export type ControlResult = { ok: true } | { ok: false; error: string };

function isLive(status: LoopStatus | undefined): boolean {
	return status !== undefined && status !== "done" && status !== "stopped" && status !== "error";
}

/**
 * Macchina a stati del loop, senza omp: i test la guidano con orologio e
 * timer finti. Ordine dei controlli prima di un giro (come la TUI): limite,
 * poi condizione, poi compattazione/sessione nuova, poi consumo del giro.
 */
export class LoopEngine {
	loop: LoopState | null = null;
	probe: LoopProbe | null = null;
	private timer: unknown = null;
	private conditionAbort: AbortController | null = null;
	private probeAbort: AbortController | null = null;
	private stopRequested = false;
	private readonly deps: LoopEngineDeps;

	constructor(deps: LoopEngineDeps) {
		this.deps = deps;
	}

	snapshot(): LoopSnapshot {
		return { v: 1, loop: this.loop, probe: this.probe };
	}

	get active(): boolean {
		return isLive(this.loop?.status);
	}

	private emit(persist = false): void {
		this.deps.publish(this.snapshot());
		if (persist) this.deps.persist(this.loop);
	}

	private clearTimer(): void {
		if (this.timer !== null) {
			this.deps.clearTimer(this.timer);
			this.timer = null;
		}
	}

	private abortCondition(): void {
		this.conditionAbort?.abort();
		this.conditionAbort = null;
	}

	/** `/loop …` dalla GUI. Senza prompt resta armato: il prossimo messaggio diventa il prompt. */
	start(parsed: ParsedLoopArgs): ControlResult {
		if (this.active) return { ok: false, error: "A loop is already active. Stop it first." };
		// Il primo giro e' un prompt nuovo: a turno in corso diventerebbe uno steer.
		if (parsed.prompt?.trim() && !this.deps.isIdle()) {
			return { ok: false, error: "The agent is busy: start the loop when the turn is over." };
		}
		const now = this.deps.now();
		this.clearTimer();
		this.abortCondition();
		this.stopRequested = false;
		this.loop = {
			id: this.deps.newId(),
			prompt: parsed.prompt?.trim() || undefined,
			limit: createLimitRuntime(parsed.limit, now),
			condition: parsed.condition,
			between: parsed.between ?? "prompt",
			status: "armed",
			pauseRequested: false,
			giro: 0,
			startedAt: now,
			giri: []
		};
		if (this.loop.prompt) {
			// Il primo giro parte sempre: la condizione si valuta dal secondo.
			this.beginGiro();
		} else {
			this.emit(true);
		}
		return { ok: true };
	}

	/** Un loop armato senza prompt adotta il primo messaggio normale come prompt. */
	adoptPrompt(text: string): boolean {
		const loop = this.loop;
		if (!loop || loop.status !== "armed" || !text.trim()) return false;
		loop.prompt = text.trim();
		this.beginGiro(false);
		return true;
	}

	private beginGiro(send = true): void {
		const loop = this.loop;
		if (!loop?.prompt) return;
		if (loop.limit?.kind === "iterations") loop.limit.remaining -= 1;
		loop.giro += 1;
		loop.giri.push({ n: loop.giro, startedAt: this.deps.now() });
		if (loop.giri.length > MAX_KEPT_GIRI) loop.giri.splice(0, loop.giri.length - MAX_KEPT_GIRI);
		loop.status = "running";
		loop.pauseRequested = false;
		loop.restored = undefined;
		// Lo stato parte prima del prompt: la GUI marca il messaggio come giro n.
		this.emit(true);
		if (send) this.deps.sendPrompt(loop.prompt);
	}

	private lastGiro(): LoopGiro | undefined {
		const giri = this.loop?.giri;
		return giri?.[giri.length - 1];
	}

	/** Fine di un turno dell'agente. `aborted`: il turno e' stato interrotto. */
	onAgentEnd(aborted: boolean): void {
		const loop = this.loop;
		if (!loop || loop.status !== "running") return;
		const giro = this.lastGiro();
		if (giro && giro.endedAt === undefined) {
			giro.endedAt = this.deps.now();
			if (aborted) giro.aborted = true;
		}
		if (this.stopRequested) return;
		if (aborted || loop.pauseRequested) {
			// Esc/Stop di omp a meta' giro: come la TUI, il loop resta e si mette in pausa.
			loop.status = "paused";
			loop.pauseRequested = false;
			this.emit(true);
			return;
		}
		loop.status = "waiting";
		this.emit(true);
		this.schedule(() => void this.advance(), LOOP_GAP_MS);
	}

	private schedule(callback: () => void, ms: number): void {
		this.clearTimer();
		this.timer = this.deps.setTimer(() => {
			this.timer = null;
			callback();
		}, ms);
	}

	private finish(status: "done" | "stopped" | "error", reason: LoopEndReason, extra: { exit?: number | null; detail?: string } = {}): void {
		const loop = this.loop;
		if (!loop) return;
		this.clearTimer();
		this.abortCondition();
		loop.status = status;
		loop.pauseRequested = false;
		loop.endedAt = this.deps.now();
		loop.end = { reason, ...extra };
		this.emit(true);
	}

	/** Prossimo giro: limite, condizione, azione tra i giri, poi il prompt. */
	async advance(): Promise<void> {
		const loop = this.loop;
		if (!loop || (loop.status !== "waiting" && loop.status !== "paused")) return;
		if (!this.deps.isIdle()) {
			// Un turno e' partito nel frattempo (coda, job in background): si riprova.
			loop.status = "waiting";
			this.schedule(() => void this.advance(), LOOP_GAP_MS);
			return;
		}
		const now = this.deps.now();
		if (isLimitExhausted(loop.limit, now)) {
			this.finish("done", loop.limit?.kind === "duration" ? "duration" : "limit");
			return;
		}
		if (loop.condition) {
			loop.status = "checking";
			this.emit();
			const controller = new AbortController();
			this.abortCondition();
			this.conditionAbort = controller;
			let run: ConditionRun;
			try {
				run = await this.deps.runCondition(loop.condition.command, controller.signal);
			} catch (error) {
				run = { exit: null, out: "", timedOut: false, aborted: false, error: String(error) };
			}
			if (this.conditionAbort === controller) this.conditionAbort = null;
			// Pausa, Stop o un nuovo loop durante il comando: il verdetto e' vecchio.
			if (this.loop !== loop || loop.status !== "checking") return;
			const giro = this.lastGiro();
			const check: LoopCheck = { exit: run.exit, out: run.error ? summarizeOutput(run.error) : run.out, at: this.deps.now() };
			if (giro) giro.check = check;
			const verdict = conditionVerdict(loop.condition, run);
			if (verdict.kind === "aborted") return;
			if (verdict.kind === "halt") {
				this.finish("done", "condition", { exit: run.exit });
				return;
			}
			if (verdict.kind === "error") {
				this.finish("error", verdict.reason, { exit: run.exit, detail: check.out });
				return;
			}
			if (!this.deps.isIdle()) {
				loop.status = "waiting";
				this.schedule(() => void this.advance(), LOOP_GAP_MS);
				return;
			}
		}
		if (loop.between === "compact") {
			loop.status = "waiting";
			this.emit();
			try {
				await this.deps.compact();
			} catch {
				// Una compattazione fallita non ferma il loop: si prosegue nel contesto attuale.
			}
			if (this.loop !== loop || loop.status !== "waiting") return;
		} else if (loop.between === "reset") {
			// La sessione nuova la apre la GUI (`new_session`): le estensioni
			// non hanno `newSession` fuori dai comandi. Il giro riparte quando
			// arriva `session_switch` con motivo `new`.
			loop.status = "resetting";
			this.emit(true);
			return;
		}
		this.beginGiro();
	}

	/** La sessione nuova chiesta da `--between reset` e' pronta. */
	onResetDone(): void {
		const loop = this.loop;
		if (!loop || loop.status !== "resetting") return;
		this.beginGiro();
	}

	pause(): ControlResult {
		const loop = this.loop;
		if (!loop || !this.active) return { ok: false, error: "No active loop." };
		if (loop.status === "running") {
			// Durante un giro la pausa scatta a fine giro; un secondo clic la annulla.
			loop.pauseRequested = !loop.pauseRequested;
			this.emit();
			return { ok: true };
		}
		if (loop.status === "paused") return { ok: true };
		this.clearTimer();
		this.abortCondition();
		loop.status = "paused";
		loop.pauseRequested = false;
		this.emit(true);
		return { ok: true };
	}

	resume(): ControlResult {
		const loop = this.loop;
		if (!loop || loop.status !== "paused") return { ok: false, error: "The loop is not paused." };
		if (!loop.prompt) {
			loop.status = "armed";
			this.emit(true);
			return { ok: true };
		}
		// Riprendi rifa' il controllo e prosegue, come un giro normale.
		void this.advance();
		return { ok: true };
	}

	/** Stop immediato: interrompe anche il turno in corso. */
	stop(): ControlResult {
		const loop = this.loop;
		if (!loop || !this.active) return { ok: false, error: "No active loop." };
		this.stopRequested = true;
		const giro = this.lastGiro();
		if (giro && giro.endedAt === undefined) {
			giro.endedAt = this.deps.now();
			giro.aborted = loop.status === "running";
		}
		const wasRunning = loop.status === "running";
		this.finish("stopped", "stopped");
		if (wasRunning && !this.deps.isIdle()) this.deps.abort();
		return { ok: true };
	}

	/** «Chiudi»: toglie il pannello di un loop finito. */
	dismiss(): ControlResult {
		if (this.active) return { ok: false, error: "Stop the loop before closing it." };
		this.loop = null;
		this.probe = null;
		this.emit(true);
		return { ok: true };
	}

	/** «Prova ora»: esegue il comando una volta e riporta l'esito, senza toccare il loop. */
	async runProbe(command: string): Promise<void> {
		const cmd = command.trim();
		if (!cmd) return;
		this.probeAbort?.abort();
		const controller = new AbortController();
		this.probeAbort = controller;
		this.probe = { command: cmd, running: true, at: this.deps.now() };
		this.emit();
		let run: ConditionRun;
		try {
			run = await this.deps.runCondition(cmd, controller.signal);
		} catch (error) {
			run = { exit: null, out: "", timedOut: false, aborted: false, error: String(error) };
		}
		if (this.probeAbort !== controller) return;
		this.probeAbort = null;
		this.probe = {
			command: cmd,
			running: false,
			exit: run.exit,
			out: run.error ? summarizeOutput(run.error) : run.out,
			timedOut: run.timedOut || undefined,
			error: run.error,
			at: this.deps.now()
		};
		this.emit();
	}

	/** Stato salvato nella sessione: un loop vivo torna in pausa, mai in corsa da solo. */
	restore(saved: LoopState | null): void {
		this.clearTimer();
		this.abortCondition();
		this.stopRequested = false;
		if (!saved) {
			this.loop = null;
			this.emit();
			return;
		}
		const loop: LoopState = { ...saved, giri: Array.isArray(saved.giri) ? saved.giri.map((g) => ({ ...g })) : [] };
		if (isLive(loop.status) && loop.status !== "armed") {
			// Un giro lasciato a meta' dalla chiusura di Studio conta come interrotto.
			const giro = loop.giri[loop.giri.length - 1];
			if (giro && giro.endedAt === undefined) giro.aborted = true;
			loop.status = "paused";
			loop.pauseRequested = false;
			loop.restored = true;
		}
		this.loop = loop;
		this.emit();
	}

	/** Ripubblica lo stato (la GUI lo chiede dopo un riavvio del suo stato). */
	republish(): void {
		this.emit();
	}

	/** Cambio di sessione non chiesto dal loop: lo stato vive nel file della sessione lasciata. */
	detach(): void {
		this.clearTimer();
		this.abortCondition();
		this.loop = null;
		this.probe = null;
	}
}

/** Ultimo stato salvato fra le entry della sessione (`appendEntry`). */
export function findSavedLoop(entries: readonly unknown[]): LoopState | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; customType?: string; data?: { loop?: LoopState | null } } | null;
		if (entry?.type === "custom" && entry.customType === LOOP_ENTRY_TYPE) {
			const loop = entry.data?.loop;
			return loop && typeof loop === "object" && typeof loop.id === "string" ? loop : null;
		}
	}
	return null;
}

/**
 * Riga di controllo inviata dalla GUI: `/studio-loop pause|resume|stop|dismiss|status`
 * oppure `/studio-loop probe <comando>`.
 */
export function parseControl(text: string): { op: string; arg: string } | null {
	const trimmed = text.trim();
	if (!trimmed.toLowerCase().startsWith(LOOP_CONTROL_COMMAND)) return null;
	const rest = trimmed.slice(LOOP_CONTROL_COMMAND.length);
	if (rest && !/^\s/.test(rest)) return null;
	const body = rest.trim();
	const space = body.search(/\s/);
	const op = (space === -1 ? body : body.slice(0, space)).toLowerCase();
	const arg = space === -1 ? "" : body.slice(space + 1).trim();
	return { op: op || "status", arg };
}

/** `/loop` (o `/loop …`) all'inizio del testo: restituisce gli argomenti. */
export function matchLoopCommand(text: string): string | null {
	const match = /^\/loop(?:\s+([\s\S]*))?$/i.exec(text.trim());
	return match ? (match[1] ?? "").trim() : null;
}

/* ------------------------------------------------------------------------ */
/* Aggancio a omp                                                            */
/* ------------------------------------------------------------------------ */

interface LoopUi {
	setStatus(key: string, text: string | undefined): void;
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

interface LoopContext {
	ui: LoopUi;
	mode?: string;
	cwd?: string;
	agent?: { depth?: number };
	isIdle(): boolean;
	abort(): void;
	compact(instructions?: string): Promise<void>;
	sessionManager?: { getEntries?: () => readonly unknown[]; getCwd?: () => string };
}

interface ExecResultLike {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

interface LoopApi {
	registerCommand?(
		name: string,
		options: { description?: string; handler: (args: string, ctx: LoopContext) => Promise<void> }
	): void;
	on(event: string, handler: (event: Record<string, unknown>, ctx: LoopContext) => unknown): void;
	sendUserMessage(content: string): unknown;
	appendEntry(customType: string, data?: unknown): void;
	exec(command: string, args: string[], options?: { signal?: AbortSignal; timeout?: number; cwd?: string }): Promise<ExecResultLike>;
}

function lastAssistantAborted(messages: unknown): boolean {
	if (!Array.isArray(messages)) return false;
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as { role?: string; stopReason?: string } | null;
		if (message?.role === "assistant") return message.stopReason === "aborted";
	}
	return false;
}

/** Il processo e' la chat GUI di Studio (`omp --mode rpc-ui`), non il Terminale. */
export function isGuiProcess(argv: readonly string[]): boolean {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--mode" && (argv[i + 1] === "rpc-ui" || argv[i + 1] === "rpc")) return true;
		if (argv[i] === "--mode=rpc-ui" || argv[i] === "--mode=rpc") return true;
	}
	return false;
}

export default function studioLoopExtension(pi: LoopApi): void {
	// Nel Terminale l'estensione non registra nulla: li' vale il /loop nativo.
	const argv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? [];
	if (!isGuiProcess(argv)) return;

	let ctxRef: LoopContext | null = null;
	let shell: ShellChoice | null = null;
	// Solo la sessione principale in rpc-ui: nella TUI c'e' il /loop nativo, e le
	// estensioni vengono rilegate anche alle sessioni dei subagenti (mode "print").
	const isGui = (ctx: LoopContext | null | undefined) =>
		ctx?.mode === "rpc" && (ctx.agent?.depth ?? 0) === 0;

	const engine = new LoopEngine({
		now: () => Date.now(),
		setTimer: (callback, ms) => setTimeout(callback, ms),
		clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
		newId: () => `loop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
		isIdle: () => ctxRef?.isIdle() ?? true,
		abort: () => ctxRef?.abort(),
		sendPrompt: (text) => {
			// Fuori dal giro di `input`: l'invio non deve aspettare il cancello dell'input RPC.
			setTimeout(() => {
				try {
					void Promise.resolve(pi.sendUserMessage(text)).catch((error: unknown) =>
						ctxRef?.ui.notify(`Loop: prompt not sent (${String(error)})`, "error")
					);
				} catch (error) {
					ctxRef?.ui.notify(`Loop: prompt not sent (${String(error)})`, "error");
				}
			}, 0);
		},
		compact: async () => {
			await ctxRef?.compact();
		},
		runCondition: async (command, signal) => {
			const host = (globalThis as { process?: { platform?: string; env?: Record<string, string | undefined> } }).process;
			shell ??= resolveConditionShell(host?.platform ?? "linux", host?.env ?? {}, hostExists, hostWhich);
			const cwd = ctxRef?.sessionManager?.getCwd?.() ?? ctxRef?.cwd;
			const started = Date.now();
			try {
				const result = await pi.exec(shell.shell, shell.args(command), {
					signal,
					timeout: LOOP_CONDITION_TIMEOUT_MS,
					cwd
				});
				const aborted = signal.aborted;
				const timedOut = result.killed && !aborted && Date.now() - started >= LOOP_CONDITION_TIMEOUT_MS - 50;
				return {
					exit: result.killed ? null : result.code,
					out: summarizeOutput(`${result.stdout}\n${result.stderr}`),
					timedOut,
					aborted,
					error: result.killed && !aborted && !timedOut ? "killed" : undefined
				};
			} catch (error) {
				return { exit: null, out: "", timedOut: false, aborted: signal.aborted, error: String(error) };
			}
		},
		publish: (snapshot) => {
			if (!isGui(ctxRef)) return;
			ctxRef?.ui.setStatus(LOOP_STATUS_KEY, snapshot.loop || snapshot.probe ? JSON.stringify(snapshot) : undefined);
		},
		persist: (loop) => {
			try {
				pi.appendEntry(LOOP_ENTRY_TYPE, { loop });
			} catch {
				// Senza file di sessione (chat temporanea) lo stato resta solo in memoria.
			}
		}
	});

	const loadFromSession = (ctx: LoopContext) => {
		const entries = ctx.sessionManager?.getEntries?.() ?? [];
		engine.restore(findSavedLoop(entries));
	};

	pi.on("session_start", (_event, ctx) => {
		if (!isGui(ctx)) return;
		ctxRef = ctx;
		loadFromSession(ctx);
	});

	pi.on("session_switch", (event, ctx) => {
		if (!isGui(ctx)) return;
		ctxRef = ctx;
		if (event.reason === "new" && engine.loop?.status === "resetting") {
			engine.onResetDone();
			return;
		}
		engine.detach();
		loadFromSession(ctx);
	});

	pi.on("session_branch", (_event, ctx) => {
		if (!isGui(ctx)) return;
		ctxRef = ctx;
		engine.detach();
		loadFromSession(ctx);
	});

	pi.on("agent_end", (event, ctx) => {
		if (!isGui(ctx)) return;
		ctxRef = ctx;
		if (event.willContinue === true) return;
		engine.onAgentEnd(lastAssistantAborted(event.messages));
	});

	// Il comando serve alla GUI per sapere che il motore c'e' (compare in
	// `get_available_commands`) prima di inviare `/loop`: senza estensione il
	// testo finirebbe al modello. Le righe vere le consuma l'handler `input`.
	pi.registerCommand?.(LOOP_CONTROL_COMMAND.slice(1), {
		description: "Studio: /loop engine for the GUI chat (internal)",
		handler: async (_args, ctx) => {
			if (!isGui(ctx)) return;
			ctxRef = ctx;
			engine.republish();
		}
	});

	pi.on("input", async (event, ctx) => {
		// Solo la GUI: nel Terminale `/loop` resta quello nativo della TUI.
		if (event.source !== "rpc" || !isGui(ctx)) return undefined;
		ctxRef = ctx;
		const text = typeof event.text === "string" ? event.text : "";
		const control = parseControl(text);
		if (control) {
			let result: ControlResult = { ok: true };
			switch (control.op) {
				case "pause":
					result = engine.pause();
					break;
				case "resume":
					result = engine.resume();
					break;
				case "stop":
					result = engine.stop();
					break;
				case "dismiss":
					result = engine.dismiss();
					break;
				case "probe":
					void engine.runProbe(control.arg);
					break;
				default:
					engine.republish();
			}
			if (!result.ok) ctx.ui.notify(`Loop: ${result.error}`, "warning");
			return { handled: true };
		}
		const loopArgs = matchLoopCommand(text);
		if (loopArgs !== null) {
			// Come la TUI: `/loop` con un loop attivo lo spegne.
			if (engine.active) {
				engine.stop();
				return { handled: true };
			}
			const parsed = parseLoopArgs(loopArgs);
			if (typeof parsed === "string") {
				ctx.ui.notify(`Loop: ${parsed}`, "error");
				return { handled: true };
			}
			const result = engine.start(parsed);
			if (!result.ok) ctx.ui.notify(`Loop: ${result.error}`, "warning");
			return { handled: true };
		}
		// `/loop 5` senza testo: il prossimo messaggio e' il prompt e passa com'e'.
		if (engine.loop?.status === "armed" && text.trim() && !text.trim().startsWith("/")) {
			engine.adoptPrompt(text);
		}
		return undefined;
	});
}
