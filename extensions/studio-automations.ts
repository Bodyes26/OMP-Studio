// Estensione OMP: Gestione e proposta di automazioni Studio per l'agente.
//
// Fornisce il tool strutturato `studio_automations` accessibile tramite il bridge
// HTTP loopback nativo (/v1/automations/{list, get, runs, propose_create, propose_update}).
//
// Regole di sicurezza e scope (AUT-086, AUT-106, ACC-27):
// - Nessuna rotta diretta di activate, run o disable esposta all'agente:
//   qualsiasi creazione o modifica passa esclusivamente per una proposta di bozza
//   (draft) salvata nel database SQLite nativo con stato di revisione ('review').
// - L'utente riceve l'evento nativo di review e convalida la bozza dalla GUI.
// - Sessioni di Laboratorio prototipi e agenti helper/readonly non possono accedere
//   o scalare privilegi verso le automazioni (fail-closed).
// - Scope dei progetti ed esclusioni verificati dal token bridge del processo.

import { randomUUID } from "node:crypto";

/* ------------------------------------------------------------------ tipi --- */

interface ZodType {
	optional(): ZodType;
	describe(text: string): ZodType;
}

interface ZodBuilder {
	object(shape: Record<string, ZodType>): ZodType;
	string(): ZodType;
	number(): ZodType;
	boolean(): ZodType;
	enum(values: readonly string[]): ZodType;
	array(item: ZodType): ZodType;
	record(value: ZodType): ZodType;
}

interface ToolContext {
	sessionManager?: {
		getCwd?: () => string;
	};
}

interface ToolResult {
	content: { type: "text"; text: string }[];
	details?: Record<string, unknown>;
	isError?: boolean;
}

interface ToolDefinition<TParams> {
	name: string;
	label: string;
	description: string;
	parameters: ZodType;
	approval: "read" | "write" | "exec";
	execute(
		toolCallId: string,
		params: TParams,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ToolContext | undefined
	): Promise<ToolResult>;
}

interface StudioAutomationsApi {
	zod: ZodBuilder;
	registerTool<TParams>(definition: ToolDefinition<TParams>): void;
	on?(eventName: string, handler: (event: unknown, ctx?: unknown) => unknown): void;
}

export type AutomationActionKind =
	| "list"
	| "get"
	| "runs"
	| "propose_create"
	| "propose_update"
	| "projects";
export interface AutomationsEnvironment {
	bridgeUrl?: string;
	bridgeToken?: string;
	laneId?: string;
	labSession?: boolean;
	readOnly?: boolean;
	projectId?: string;
}

export interface TriggerParam {
	kind: string;
	time?: string;
	weekdays?: number[];
	intervalMinutes?: number;
	at?: number;
	branches?: string[];
	includePatterns?: string[];
	excludePatterns?: string[];
	roots?: string[];
}

export interface TargetsParam {
	source?: "selected" | "open" | "registered" | "studio" | "directory";
	projectPaths?: string[];
	excludePaths?: string[];
	includeStudio?: boolean;
	mode?: "each" | "aggregate";
	cwd?: string;
}

export interface PolicyParam {
	timeoutMinutes?: number;
	timezone?: string;
	missed?: "notify" | "ignore" | "recover";
	notifySuccess?: boolean;
	recoveryMinutes?: number;
	overlap?: "coalesce" | "skip";
}

export interface StudioAutomationsParams {
	action: AutomationActionKind;
	id?: string;
	name?: string;
	description?: string;
	actionKind?: "command" | "prompt";
	command?: string;
	args?: string[];
	interpreter?: string;
	prompt?: string;
	modelMode?: "role" | "model";
	model?: string;
	allowPayAsYouGo?: boolean;
	maxCostUsd?: number;
	triggers?: TriggerParam[];
	targets?: TargetsParam;
	policy?: PolicyParam;
	message?: string;
	limit?: number;
	offset?: number;
	rawDefinition?: Record<string, unknown>;
	projectOperation?: "list" | "open" | "close";
	projectPath?: string;
}

interface BridgeReply {
	ok?: boolean;
	text?: string;
	details?: Record<string, unknown>;
}

/* ------------------------------------------------------------- ambiente --- */

export function readEnvironment(): AutomationsEnvironment {
	return {
		bridgeUrl: process.env.OMP_STUDIO_BRIDGE_URL,
		bridgeToken: process.env.OMP_STUDIO_BRIDGE_TOKEN,
		laneId: process.env.OMP_LANE_ID,
		labSession: process.env.OMP_LAB_SESSION === "1",
		readOnly:
			process.env.OMP_READONLY === "1" ||
			process.env.OMP_AUTOMATION_READONLY === "1",
		projectId: process.env.OMP_PROJECT_ID
	};
}

export function isAutomationsToolEnabled(env: AutomationsEnvironment): boolean {
	if (!env.bridgeUrl || !env.bridgeToken) return false;
	// Sessioni di Laboratorio confinate: nessun accesso alle automazioni
	if (env.labSession) return false;
	// Sessioni readonly/helper: nessuna facoltà di proporre o gestire automazioni
	if (env.readOnly) return false;
	const lane = (env.laneId ?? "").trim();
	if (lane.startsWith("lab-") || lane === "lab") return false;
	return true;
}

function textResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details
		? { content: [{ type: "text", text }], details }
		: { content: [{ type: "text", text }] };
}

function errorResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details
		? { content: [{ type: "text", text }], isError: true, details }
		: { content: [{ type: "text", text }], isError: true };
}

function cleanString(val: unknown): string | undefined {
	return typeof val === "string" && val.trim() ? val.trim() : undefined;
}

/* ------------------------------------------------------- chiamata bridge --- */

export async function callBridge(
	env: AutomationsEnvironment,
	action: AutomationActionKind,
	body: Record<string, unknown>,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch = fetch
): Promise<ToolResult> {
	const base = (env.bridgeUrl ?? "").replace(/\/+$/, "");
	try {
		const response = await fetchImpl(`${base}/v1/automations/${action}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.bridgeToken ?? ""}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body),
			signal
		});
		let data: BridgeReply;
		try {
			data = (await response.json()) as BridgeReply;
		} catch {
			return errorResult(
				`Errore di comunicazione: la risposta HTTP ${response.status} del bridge automazioni non e' un JSON valido.`
			);
		}
		const details = { ...(data?.details ?? {}), action };
		const text =
			data?.text ||
			(data?.ok
				? "Operazione sulle automazioni completata con successo."
				: `Studio ha rifiutato l'operazione automazioni: ${action}`);
		return data?.ok ? textResult(text, details) : errorResult(text, details);
	} catch (err: unknown) {
		if (signal?.aborted) return errorResult(`Operazione automazione '${action}' annullata.`);
		const msg = err instanceof Error ? err.message : String(err);
		return errorResult(`Errore di rete verso il bridge di Studio: ${msg}`);
	}
}

export interface AgentEndMessage {
	role?: string;
	stopReason?: string;
	error?: unknown;
	content?: unknown;
}

export interface AgentEndEvent {
	willContinue?: boolean;
	isTerminal?: boolean;
	awaitingAsyncWork?: boolean;
	messages?: AgentEndMessage[];
	error?: unknown;
}

export interface AsyncJobItem {
	id?: string;
	status?: string;
	running?: boolean;
	active?: boolean;
}

export interface AsyncJobSnapshot {
	jobs?: AsyncJobItem[];
	activeCount?: number;
	runningCount?: number;
	pendingDelivery?: number | boolean | unknown[];
	hasPendingAsyncWake?: boolean;
}

export interface SessionModesSnapshot {
	plan?: "inactive" | "active" | "paused";
	vibe?: "inactive" | "active";
	loop?: "inactive" | "active" | "paused";
	goal?: "inactive" | "active" | "paused";
}

export interface ExtensionContext {
	cwd?: string;
	mode?: "tui" | "rpc" | "json" | "print";
	agent?: {
		kind?: "main" | "sub";
		id?: string;
		name?: string;
		depth?: number;
	};
	sessionManager?: {
		getCwd?: () => string;
		getSessionId?: () => string;
	};
	isIdle?(): boolean;
	hasPendingMessages?(): boolean;
	getAsyncJobSnapshot?(): AsyncJobSnapshot | null;
	sessionModes?: {
		getState(): SessionModesSnapshot;
	};
	setTimeout?(callback: () => void, ms: number): unknown;
	clearTimer?(handle: unknown): void;
}

export function hasActiveAsyncWork(snap: AsyncJobSnapshot | null | undefined): boolean {
	if (!snap) return false;
	if (snap.hasPendingAsyncWake === true) return true;
	if (typeof snap.activeCount === "number" && snap.activeCount > 0) return true;
	if (typeof snap.runningCount === "number" && snap.runningCount > 0) return true;
	if (typeof snap.pendingDelivery === "number" && snap.pendingDelivery > 0) return true;
	if (Array.isArray(snap.pendingDelivery) && snap.pendingDelivery.length > 0) return true;
	if (snap.pendingDelivery === true) return true;
	if (Array.isArray(snap.jobs)) {
		return snap.jobs.some((j) => {
			if (j.running === true || j.active === true) return true;
			if (j.status === "running" || j.status === "pending") return true;
			return false;
		});
	}
	return false;
}

export function hasActiveSessionMode(ctx: ExtensionContext | undefined): boolean {
	if (!ctx?.sessionModes?.getState) return false;
	try {
		const modes = ctx.sessionModes.getState();
		if (modes?.loop === "active") return true;
		if (modes?.goal === "active") return true;
	} catch {}
	return false;
}

/**
 * Verifica se la sessione agente e' effettivamente quieta e priva di lavoro asincrono pendente.
 * Riferimenti API primari:
 * - omp://sdk.md:243-253 (isTerminal, awaitingAsyncWork, yielded, willContinue)
 * - omp://extensions.md:335-386 (isIdle, hasPendingMessages, getAsyncJobSnapshot, agent.kind, sessionModes)
 * - AUT-014: "La fine di un turno con subagenti attivi non equivale a fine lavoro".
 */
export function isSessionQuiet(ctx: ExtensionContext | undefined, event: AgentEndEvent): boolean {
	// 1. Vincoli esatti dall'evento agent_end (omp://sdk.md:243-253)
	// 'Subscribers that use agent_end as a completion signal MUST wait for isTerminal !== false'
	if (event.isTerminal === false) return false;
	// 'awaitingAsyncWork marks a non-terminal end whose only possible wake is a background-job result'
	if (event.awaitingAsyncWork === true) return false;
	// 'yielded distinguishes an agent that finished its work from one continuing through retry, compaction...'
	if (event.yielded === false) return false;
	if (event.willContinue === true) return false;

	// 2. Controllo predicati autorevoli documentati in omp://extensions.md:335-386
	if (ctx) {
		// AUT-014: solo main agent, mai subagenti (/tan, task spawns, advisor; doc374)
		if (ctx.agent?.kind && ctx.agent.kind !== "main") {
			return false;
		}

		// isIdle() deve risultare true (omp://extensions.md:356)
		if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
			return false;
		}

		// hasPendingMessages() non deve avere messaggi in coda (omp://extensions.md:356)
		if (typeof ctx.hasPendingMessages === "function" && ctx.hasPendingMessages()) {
			return false;
		}

		// getAsyncJobSnapshot(): snapshot read-only dei job asincroni (omp://extensions.md:354)
		if (typeof ctx.getAsyncJobSnapshot === "function") {
			if (hasActiveAsyncWork(ctx.getAsyncJobSnapshot())) {
				return false;
			}
		}

		// sessionModes: loop o goal attivi continuano tra i turni (omp://extensions.md:360-370)
		if (hasActiveSessionMode(ctx)) {
			return false;
		}

		// Se isTerminal e' assente (runtime precedenti), pretendiamo isIdle() esplicito da ctx
		if (event.isTerminal === undefined) {
			if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
				return false;
			}
		}
	} else if (event.isTerminal !== true) {
		// Senza ExtensionContext e senza isTerminal === true esplicito, fail-closed
		return false;
	}

	return true;
}

/**
 * Ispeziona un evento terminale di fine turno per rilevare il risultato (AUT-014).
 * Ritorna null se l'evento non e' terminale, se ci sono subagenti/lavori in background,
 * o se la sessione e' in attesa di input utente (esclusa da AUT-014).
 */
export function detectAgentOutcome(
	event: AgentEndEvent,
	ctx?: ExtensionContext
): {
	kind: "agentFinished" | "agentQuota" | "agentError";
	detail?: string;
} | null {
	if (event.willContinue === true) {
		return null;
	}

	// 1. Rileva prima errori e blocchi quota (priorità AUT-014)
	if (event.error) {
		const errStr = typeof event.error === "string" ? event.error : JSON.stringify(event.error);
		if (/quota|credit|rate\s*limit|balance|exhausted|429/i.test(errStr)) {
			return { kind: "agentQuota", detail: errStr };
		}
		return { kind: "agentError", detail: errStr };
	}

	if (Array.isArray(event.messages)) {
		for (let i = event.messages.length - 1; i >= 0; i--) {
			const msg = event.messages[i];
			if (msg && msg.role === "assistant") {
				if (msg.stopReason === "quota") {
					const detail = typeof msg.error === "string" ? msg.error : "Quota o crediti esauriti";
					return { kind: "agentQuota", detail };
				}
				if (msg.stopReason === "error") {
					const detail = typeof msg.error === "string" ? msg.error : "Errore durante l'esecuzione dell'assistente";
					if (/quota|credit|rate\s*limit|balance|exhausted|429/i.test(detail)) {
						return { kind: "agentQuota", detail };
					}
					return { kind: "agentError", detail };
				}
				if (msg.error) {
					const detail = typeof msg.error === "string" ? msg.error : JSON.stringify(msg.error);
					if (/quota|credit|rate\s*limit|balance|exhausted|429/i.test(detail)) {
						return { kind: "agentQuota", detail };
					}
					return { kind: "agentError", detail };
				}
				// Richiesta di risposta utente (ask / question / prompt): AUT-014 esclude espressamente richiesta risposta
				if (msg.stopReason === "ask" || msg.stopReason === "question") {
					return null;
				}
			}
		}
	}

	// 2. Per agentFinished, verifica rigorosa di effettiva fine lavoro e quiete (AUT-014)
	if (!isSessionQuiet(ctx, event)) {
		return null;
	}

	return { kind: "agentFinished" };
}

/**
 * Invia un evento del ciclo di vita agente al native bridge per lo scheduler (AUT-014).
 */
export async function emitAgentEvent(
	env: AutomationsEnvironment,
	kind: "agentFinished" | "agentQuota" | "agentError",
	detail?: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	if (!env.bridgeUrl || !env.bridgeToken) return;
	if (env.labSession || env.readOnly) return;
	const lane = (env.laneId ?? "").trim();
	if (lane.startsWith("lab-") || lane === "lab") return;

	try {
		const base = env.bridgeUrl.replace(/\/+$/, "");
		await fetchImpl(`${base}/v1/automations/event`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.bridgeToken}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({ kind, detail })
		});
	} catch {}
}

/* ------------------------------------------------ condensazione bozze --- */

/**
 * Condensa una richiesta dalla chat in una bozza strutturata compatibile con AutomationDefinition.
 */
export function condenseCreatePayload(
	params: StudioAutomationsParams,
	cwd: string
): Record<string, unknown> {
	if (params.rawDefinition && typeof params.rawDefinition === "object") {
		const raw = params.rawDefinition;
		const rawAction =
			raw && typeof raw === "object" && "action" in raw && raw.action && typeof raw.action === "object"
				? (raw.action as Record<string, unknown>)
				: null;
		const rawTargets =
			raw && typeof raw === "object" && "targets" in raw && raw.targets && typeof raw.targets === "object"
				? (raw.targets as Record<string, unknown>)
				: null;
		const rawPolicy =
			raw && typeof raw === "object" && "policy" in raw && raw.policy && typeof raw.policy === "object"
				? (raw.policy as Record<string, unknown>)
				: null;

		const def = {
			id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
			revision: typeof raw.revision === "number" ? raw.revision : 0,
			name: cleanString(raw.name) || cleanString(params.name) || "Nuova automazione",
			description: cleanString(raw.description) || cleanString(params.description) || "",
			state: (cleanString(raw.state) as string) || "draft",
			action: rawAction ?? {
				kind: "prompt",
				prompt: cleanString(params.prompt) || cleanString(params.message) || "",
				modelMode: "role",
				model: "smol",
				allowPayAsYouGo: false,
				maxCostUsd: null
			},
			targets: rawTargets ?? {
				source: cwd ? "selected" : "directory",
				projectPaths: cwd ? [cwd] : [],
				excludePaths: [],
				includeStudio: false,
				mode: "each",
				cwd,
				filters: []
			},
			triggers: Array.isArray(raw.triggers) ? raw.triggers : [{ id: randomUUID(), kind: "manual" }],
			branches: Array.isArray(raw.branches) ? raw.branches : [],
			policy: rawPolicy ?? {
				timezone: "UTC",
				maxWaitMinutes: 60,
				timeoutMinutes: 60,
				humanWaitMinutes: 60,
				missed: "notify",
				recoveryMinutes: 15,
				overlap: "coalesce",
				quota: { shortPct: 10, weeklyPct: 10, otherPct: 10, windows: {} },
				notifySuccess: false,
				fileQuietSeconds: 2,
				fileMaxWaitSeconds: 30
			},
			createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
			updatedAt: Date.now(),
			origin: typeof raw.origin === "string" ? raw.origin : "user"
		};
		return {
			definition: def,
			message: cleanString(params.message) ?? "Proposta automazione dall'agente"
		};
	}

	const name = cleanString(params.name) || cleanString(params.description) || "Nuova automazione";
	const description = cleanString(params.description) || cleanString(params.message) || "";

	const actionKind = params.actionKind || (params.command ? "command" : "prompt");
	let action: Record<string, unknown>;
	const isWin = process.platform === "win32";

	if (actionKind === "command") {
		const command = cleanString(params.command) || "";
		action = {
			kind: "command",
			mode: "shell",
			command,
			args: Array.isArray(params.args) ? params.args : [],
			interpreter: cleanString(params.interpreter) || (isWin ? "cmd.exe" : "/bin/sh"),
			platforms: [isWin ? "windows" : process.platform === "darwin" ? "macos" : "linux"],
			variants: {},
			environment: {},
			secretRefs: {},
			scriptPolicy: "review",
			approvedFiles: {},
			watchedFiles: []
		};
	} else {
		action = {
			kind: "prompt",
			prompt: cleanString(params.prompt) || cleanString(params.message) || "",
			modelMode: params.modelMode === "model" ? "model" : "role",
			model: cleanString(params.model) || "smol",
			allowPayAsYouGo: Boolean(params.allowPayAsYouGo),
			maxCostUsd: typeof params.maxCostUsd === "number" ? params.maxCostUsd : null
		};
	}

	let triggers = params.triggers;
	if (!triggers || !Array.isArray(triggers) || triggers.length === 0) {
		triggers = [{ kind: "manual" }];
	}
	const formattedTriggers = triggers.map((t) => ({
		id: randomUUID(),
		kind: t.kind,
		time: cleanString(t.time),
		weekdays: Array.isArray(t.weekdays) ? t.weekdays : undefined,
		intervalMinutes: typeof t.intervalMinutes === "number" ? t.intervalMinutes : undefined,
		at: typeof t.at === "number" ? t.at : undefined,
		branches: Array.isArray(t.branches) ? t.branches : [],
		includePatterns: Array.isArray(t.includePatterns) ? t.includePatterns : [],
		excludePatterns: Array.isArray(t.excludePatterns) ? t.excludePatterns : [],
		roots: Array.isArray(t.roots) ? t.roots : []
	}));

	const targetCwd = cleanString(params.targets?.cwd) || cwd;
	const targets = {
		source: params.targets?.source || (targetCwd ? "selected" : "directory"),
		projectPaths: Array.isArray(params.targets?.projectPaths)
			? params.targets.projectPaths
			: targetCwd
				? [targetCwd]
				: [],
		excludePaths: Array.isArray(params.targets?.excludePaths) ? params.targets.excludePaths : [],
		includeStudio: Boolean(params.targets?.includeStudio),
		mode: params.targets?.mode === "aggregate" ? "aggregate" : "each",
		cwd: targetCwd,
		filters: []
	};

	let timezone = "UTC";
	try {
		timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {}

	const policy = {
		timezone: cleanString(params.policy?.timezone) || timezone,
		maxWaitMinutes: 60,
		timeoutMinutes: typeof params.policy?.timeoutMinutes === "number" ? params.policy.timeoutMinutes : 60,
		humanWaitMinutes: 60,
		missed: params.policy?.missed || "notify",
		recoveryMinutes: typeof params.policy?.recoveryMinutes === "number" ? params.policy.recoveryMinutes : 15,
		overlap: params.policy?.overlap || "coalesce",
		quota: { shortPct: 10, weeklyPct: 10, otherPct: 10, windows: {} },
		notifySuccess: Boolean(params.policy?.notifySuccess),
		fileQuietSeconds: 2,
		fileMaxWaitSeconds: 30
	};

	const now = Date.now();
	const definition = {
		id: randomUUID(),
		revision: 0,
		name,
		description,
		state: "draft",
		action,
		targets,
		triggers: formattedTriggers,
		branches: [],
		policy,
		createdAt: now,
		updatedAt: now,
		origin: "user"
	};

	return {
		definition,
		message: cleanString(params.message) || `Creazione automazione "${name}" proposta dall'agente`
	};
}

/**
 * Unisce una patch di modifica sopra una definizione esistente completa recuperata dal database,
 * preservando tutti i campi non toccati (segreti, policy, hash, modello, varianti).
 */
export function mergeUpdatePayload(
	existing: Record<string, unknown>,
	params: StudioAutomationsParams
): Record<string, unknown> {
	const merged: Record<string, unknown> = JSON.parse(JSON.stringify(existing));

	if (params.name) merged.name = cleanString(params.name) ?? merged.name;
	if (params.description !== undefined) {
		merged.description = cleanString(params.description) ?? merged.description;
	}

	const isWin = process.platform === "win32";
	if (params.actionKind === "command" || params.command) {
		let existingCmd: Record<string, unknown> = {};
		if (
			merged.action &&
			typeof merged.action === "object" &&
			"kind" in merged.action &&
			merged.action.kind === "command"
		) {
			existingCmd = merged.action as Record<string, unknown>;
		}
		merged.action = {
			kind: "command",
			mode: "shell",
			command: cleanString(params.command) || cleanString(existingCmd.command) || "",
			args: Array.isArray(params.args)
				? params.args
				: Array.isArray(existingCmd.args)
					? existingCmd.args
					: [],
			interpreter:
				cleanString(params.interpreter) ||
				cleanString(existingCmd.interpreter) ||
				(isWin ? "cmd.exe" : "/bin/sh"),
			platforms: Array.isArray(existingCmd.platforms)
				? existingCmd.platforms
				: [isWin ? "windows" : process.platform === "darwin" ? "macos" : "linux"],
			variants:
				existingCmd.variants && typeof existingCmd.variants === "object"
					? existingCmd.variants
					: {},
			environment:
				existingCmd.environment && typeof existingCmd.environment === "object"
					? existingCmd.environment
					: {},
			secretRefs:
				existingCmd.secretRefs && typeof existingCmd.secretRefs === "object"
					? existingCmd.secretRefs
					: {},
			scriptPolicy: cleanString(existingCmd.scriptPolicy) || "review",
			approvedFiles:
				existingCmd.approvedFiles && typeof existingCmd.approvedFiles === "object"
					? existingCmd.approvedFiles
					: {},
			watchedFiles: Array.isArray(existingCmd.watchedFiles) ? existingCmd.watchedFiles : []
		};
	} else if (params.actionKind === "prompt" || params.prompt) {
		let existingPrompt: Record<string, unknown> = {};
		if (
			merged.action &&
			typeof merged.action === "object" &&
			"kind" in merged.action &&
			merged.action.kind === "prompt"
		) {
			existingPrompt = merged.action as Record<string, unknown>;
		}
		merged.action = {
			kind: "prompt",
			prompt: cleanString(params.prompt) || cleanString(existingPrompt.prompt) || "",
			modelMode:
				params.modelMode === "model" ? "model" : cleanString(existingPrompt.modelMode) || "role",
			model: cleanString(params.model) || cleanString(existingPrompt.model) || "smol",
			allowPayAsYouGo:
				params.allowPayAsYouGo !== undefined
					? Boolean(params.allowPayAsYouGo)
					: Boolean(existingPrompt.allowPayAsYouGo),
			maxCostUsd:
				typeof params.maxCostUsd === "number"
					? params.maxCostUsd
					: typeof existingPrompt.maxCostUsd === "number"
						? existingPrompt.maxCostUsd
						: null
		};
	}

	if (Array.isArray(params.triggers) && params.triggers.length > 0) {
		merged.triggers = params.triggers.map((t) => ({
			id: randomUUID(),
			kind: t.kind,
			time: cleanString(t.time),
			weekdays: Array.isArray(t.weekdays) ? t.weekdays : undefined,
			intervalMinutes: typeof t.intervalMinutes === "number" ? t.intervalMinutes : undefined,
			at: typeof t.at === "number" ? t.at : undefined,
			branches: Array.isArray(t.branches) ? t.branches : [],
			includePatterns: Array.isArray(t.includePatterns) ? t.includePatterns : [],
			excludePatterns: Array.isArray(t.excludePatterns) ? t.excludePatterns : [],
			roots: Array.isArray(t.roots) ? t.roots : []
		}));
	}

	if (params.targets && typeof params.targets === "object") {
		const existingTargets: Record<string, unknown> =
			merged.targets && typeof merged.targets === "object"
				? (merged.targets as Record<string, unknown>)
				: {};
		merged.targets = {
			source: params.targets.source || existingTargets.source || "selected",
			projectPaths: Array.isArray(params.targets.projectPaths)
				? params.targets.projectPaths
				: Array.isArray(existingTargets.projectPaths)
					? existingTargets.projectPaths
					: [],
			excludePaths: Array.isArray(params.targets.excludePaths)
				? params.targets.excludePaths
				: Array.isArray(existingTargets.excludePaths)
					? existingTargets.excludePaths
					: [],
			includeStudio:
				params.targets.includeStudio !== undefined
					? Boolean(params.targets.includeStudio)
					: Boolean(existingTargets.includeStudio),
			mode: params.targets.mode || existingTargets.mode || "each",
			cwd: cleanString(params.targets.cwd) || cleanString(existingTargets.cwd) || "",
			filters: Array.isArray(existingTargets.filters) ? existingTargets.filters : []
		};
	}

	if (params.policy && typeof params.policy === "object") {
		const existingPolicy: Record<string, unknown> =
			merged.policy && typeof merged.policy === "object"
				? (merged.policy as Record<string, unknown>)
				: {};
		merged.policy = {
			...existingPolicy,
			timezone: cleanString(params.policy.timezone) || cleanString(existingPolicy.timezone) || "UTC",
			timeoutMinutes:
				typeof params.policy.timeoutMinutes === "number"
					? params.policy.timeoutMinutes
					: typeof existingPolicy.timeoutMinutes === "number"
						? existingPolicy.timeoutMinutes
						: 60,
			missed: params.policy.missed || existingPolicy.missed || "notify",
			recoveryMinutes:
				typeof params.policy.recoveryMinutes === "number"
					? params.policy.recoveryMinutes
					: typeof existingPolicy.recoveryMinutes === "number"
						? existingPolicy.recoveryMinutes
						: 15,
			overlap: params.policy.overlap || existingPolicy.overlap || "coalesce",
			notifySuccess:
				params.policy.notifySuccess !== undefined
					? Boolean(params.policy.notifySuccess)
					: Boolean(existingPolicy.notifySuccess)
		};
	}

	if (params.rawDefinition && typeof params.rawDefinition === "object") {
		Object.assign(merged, params.rawDefinition);
	}

	merged.id = existing.id;
	merged.revision = typeof existing.revision === "number" ? existing.revision : 0;
	merged.state = "draft";
	merged.updatedAt = Date.now();

	return merged;
}

/* ---------------------------------------------------------- entrypoint --- */

/**
 * Entrypoint dell'estensione OMP per le automazioni di Studio.
 */
export default function studioAutomationsExtension(
	pi: StudioAutomationsApi,
	envOverride?: AutomationsEnvironment
): void {
	const env = envOverride ?? readEnvironment();
	if (!isAutomationsToolEnabled(env)) return;

	const z = pi.zod;

	pi.registerTool<StudioAutomationsParams>({
		name: "studio_automations",
		label: "Automazioni Studio",
		description:
			"Gestisce e propone automazioni di OMP Studio via native bridge. " +
			"Azioni disponibili: " +
			"- 'list': elenca le automazioni configurate con stato e prossime esecuzioni; " +
			"- 'get': visualizza i dettagli completi di una specifica automazione tramite ID; " +
			"- 'runs': consulta lo storico delle occorrenze ed esecuzioni; " +
			"- 'propose_create': propone una nuova automazione trasformando la richiesta della chat in una bozza (draft); Studio salva la bozza e apre la scheda di revisione nella GUI affinche' l'utente possa revisionarla e confermarla; " +
			"- 'propose_update': propone modifiche a un'automazione esistente creando una nuova revisione bozza con revisione richiesta dell'utente; " +
			"- 'projects': consulta lo stato dei progetti ('list') o richiede l'apertura ('open') o la chiusura ('close') di un progetto secondo le autorizzazioni AUT-086. " +
			"Nota: Per sicurezza, l'attivazione ('activate'), l'esecuzione forzata ('run') e la disattivazione richiedono sempre l'azione diretta dell'utente nella GUI e non possono essere scavalcate via tool.",
		parameters: z.object({
			action: z
				.enum(["list", "get", "runs", "propose_create", "propose_update", "projects"])
				.describe("Azione da eseguire: 'list', 'get', 'runs', 'propose_create', 'propose_update', 'projects'."),
			id: z
				.string()
				.optional()
				.describe("ID dell'automazione (obbligatorio per 'get' e 'propose_update', filtro opzionale per 'runs')."),
			name: z.string().optional().describe("Nome descrittivo dell'automazione (per propose_create/propose_update)."),
			description: z.string().optional().describe("Spiegazione testuale delle finalita' dell'automazione."),
			actionKind: z
				.enum(["command", "prompt"])
				.optional()
				.describe("Tipo di azione: 'command' per comandi/script di sistema, 'prompt' per sessioni AI autonome."),
			command: z
				.string()
				.optional()
				.describe("Per azioni command: riga di comando shell o percorso eseguibile (es. 'npm test', './deploy.sh')."),
			args: z.array(z.string()).optional().describe("Argomenti del comando per l'azione command."),
			interpreter: z
				.string()
				.optional()
				.describe("Interprete shell/script per command (es. 'cmd.exe', '/bin/sh', 'bash')."),
			prompt: z
				.string()
				.optional()
				.describe("Per azioni prompt: istruzioni operative per l'agente autonomo."),
			modelMode: z.enum(["role", "model"]).optional().describe("Modalita' modello per prompt: 'role' o 'model'."),
			model: z.string().optional().describe("Ruolo (smol, default, slow, plan) o ID esatto del modello."),
			allowPayAsYouGo: z
				.boolean()
				.optional()
				.describe("Consente l'uso di crediti API a consumo per l'agente se la quota e' esaurita."),
			maxCostUsd: z.number().optional().describe("Limite opzionale di costo massimo in USD per singola esecuzione."),
			triggers: z
				.array(
					z.object({
						kind: z
							.string()
							.describe(
								"Tipo di trigger: 'daily', 'interval', 'once', 'manual', 'gitCommit', 'gitBranch', 'file', 'projectOpened', 'studioStarted'."
							),
						time: z.string().optional().describe("Per daily: orario locale 'HH:MM'."),
						weekdays: z
							.array(z.number())
							.optional()
							.describe("Per daily: giorni della settimana [1..7] dove 1 e' lunedi'."),
						intervalMinutes: z
							.number()
							.optional()
							.describe("Per interval: ripeti ogni N minuti (minimo 1 minuto)."),
						at: z.number().optional().describe("Per once: timestamp epoch ms dell'esecuzione singola."),
						branches: z.array(z.string()).optional().describe("Per gitBranch: nomi dei rami monitorati."),
						includePatterns: z.array(z.string()).optional().describe("Per file watcher: pattern glob inclusi."),
						excludePatterns: z.array(z.string()).optional().describe("Per file watcher: pattern glob esclusi.")
					})
				)
				.optional()
				.describe("Trigger schedulati o a eventi che attivano l'automazione."),
			targets: z
				.object({
					source: z
						.enum(["selected", "open", "registered", "studio", "directory"])
						.optional()
						.describe("Ambito target: 'selected', 'open', 'registered', 'studio', 'directory'."),
					projectPaths: z.array(z.string()).optional().describe("Percorsi delle directory di progetto target."),
					excludePaths: z.array(z.string()).optional().describe("Percorsi esclusi dall'esecuzione."),
					includeStudio: z.boolean().optional().describe("Includi cartella di configurazione Studio."),
					mode: z.enum(["each", "aggregate"]).optional().describe("'each' (un'esecuzione per target) o 'aggregate'."),
					cwd: z.string().optional().describe("Working directory esplicita.")
				})
				.optional()
				.describe("Destinatari e cartelle target dell'automazione."),
			policy: z
				.object({
					timeoutMinutes: z.number().optional().describe("Timeout massimo di esecuzione in minuti."),
					timezone: z.string().optional().describe("Fuso orario IANA (es. 'Europe/Rome')."),
					missed: z
						.enum(["notify", "ignore", "recover"])
						.optional()
						.describe("Politica per esecuzioni mancate: 'notify', 'ignore', 'recover'."),
					notifySuccess: z.boolean().optional().describe("Invia notifica anche in caso di successo.")
				})
				.optional()
				.describe("Politiche di esecuzione, timeout e recupero."),
			message: z
				.string()
				.optional()
				.describe("Testo naturale della richiesta utente o spiegazione contestuale da salvare nella bozza."),
			projectOperation: z
				.enum(["list", "open", "close"])
				.optional()
				.describe("Operazione per l'azione 'projects': 'list' (elenco progetti), 'open' (apri progetto), 'close' (chiudi progetto)."),
			projectPath: z
				.string()
				.optional()
				.describe("Percorso assoluto o relativo della cartella di progetto per open o close."),
			limit: z.number().optional().describe("Numero massimo di elementi da restituire per 'list' o 'runs'."),
			offset: z.number().optional().describe("Offset per la paginazione di 'list' o 'runs'.")
		}),
		approval: "write",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const action = params.action;
			const cwd = ctx?.sessionManager?.getCwd?.() ?? process.cwd();

			switch (action) {
				case "list": {
					const body = {
						limit: typeof params.limit === "number" ? params.limit : 50,
						offset: typeof params.offset === "number" ? params.offset : 0
					};
					return callBridge(env, "list", body, signal);
				}

				case "get": {
					const id = cleanString(params.id);
					if (!id) {
						return errorResult("Il parametro 'id' e' obbligatorio per l'azione 'get'.");
					}
					return callBridge(env, "get", { id }, signal);
				}

				case "runs": {
					const body: Record<string, unknown> = {
						limit: typeof params.limit === "number" ? params.limit : 20,
						offset: typeof params.offset === "number" ? params.offset : 0
					};
					if (params.id) body.id = cleanString(params.id);
					return callBridge(env, "runs", body, signal);
				}

				case "propose_create": {
					const payload = condenseCreatePayload(params, cwd);
					return callBridge(env, "propose_create", payload, signal);
				}

				case "propose_update": {
					const id = cleanString(params.id);
					if (!id) {
						return errorResult("Il parametro 'id' e' obbligatorio per l'azione 'propose_update'.");
					}

					// 1. Fetch get per recuperare la definizione esistente completa
					const getRes = await callBridge(env, "get", { id }, signal);
					let existing: Record<string, unknown> | null = null;
					if (getRes.details && typeof getRes.details === "object") {
						if (
							"details" in getRes.details &&
							getRes.details.details &&
							typeof getRes.details.details === "object"
						) {
							existing = getRes.details.details as Record<string, unknown>;
						} else {
							existing = getRes.details as Record<string, unknown>;
						}
					}

					if (!existing || typeof existing !== "object") {
						return errorResult(
							`Impossibile recuperare l'automazione esistente con ID '${id}' per la modifica.`
						);
					}

					// 2. Unione patch validata sull'esistente senza azzerare campi non toccati
					const updatedDef = mergeUpdatePayload(existing, params);

					// 3. Invio con wire format { id, definition } conforme a NativeCore
					const payload = {
						id,
						definition: updatedDef,
						message:
							cleanString(params.message) ||
							`Aggiornamento automazione "${updatedDef.name}" proposto dall'agente`
					};
					return callBridge(env, "propose_update", payload, signal);
				}

				case "projects": {
					const operation = params.projectOperation || "list";
					const path = cleanString(params.projectPath) || cleanString(params.targets?.cwd) || (operation !== "list" ? cwd : undefined);
					if ((operation === "open" || operation === "close") && !path) {
						return errorResult(`Il parametro 'projectPath' e' obbligatorio per l'operazione '${operation}'.`);
					}
					const body: Record<string, unknown> = {
						operation,
						path
					};
					return callBridge(env, "projects", body, signal);
				}

				default: {
					return errorResult(
						`Azione non supportata: '${action}'. Azioni consentite: list, get, runs, propose_create, propose_update, projects.`
					);
				}
			}
		}
	});

	// Registrazione hook ciclo di vita per producer eventi PTY autenticati (AUT-014)
	// Riferimenti: omp://extensions.md:507-508 (agent_start, agent_end e session_stop)
	if (typeof pi.on === "function") {
		const isAutomationProcess = Boolean(process.env.OMP_AUTOMATION_EXECUTION_ID);
		if (!env.labSession && !env.readOnly && !isAutomationProcess) {
			let currentGeneration = 0;
			let lastEmittedGeneration = -1;

			// Generazione incrementata ad ogni avvio reale di turno (evita dedup basati su timer fissi)
			pi.on("agent_start", () => {
				currentGeneration++;
			});

			const handleSettled = (
				kind: "agentFinished" | "agentQuota" | "agentError",
				detail?: string
			) => {
				if (currentGeneration === lastEmittedGeneration) {
					return;
				}
				lastEmittedGeneration = currentGeneration;
				emitAgentEvent(env, kind, detail);
			};

			const deferSettledCheck = (
				c: ExtensionContext | undefined,
				event: AgentEndEvent,
				delayMs: number = 80
			) => {
				const scheduleTimer = (fn: () => void, ms: number) => {
					if (c && typeof c.setTimeout === "function") {
						return c.setTimeout(fn, ms);
					}
					return setTimeout(fn, ms);
				};

				scheduleTimer(() => {
					// All'uscita dell'handler sincrono la sessione ha concluso il turno e isIdle() / hasPendingMessages() riflettono lo stato reale
					const outcome = detectAgentOutcome(event, c);
					if (outcome) {
						handleSettled(outcome.kind, outcome.detail);
					}
				}, delayMs);
			};

			pi.on("agent_end", (event: unknown, ctx?: unknown) => {
				const eventObj = event && typeof event === "object" ? (event as AgentEndEvent) : {};
				const ctxObj = ctx && typeof ctx === "object" ? (ctx as ExtensionContext) : undefined;
				deferSettledCheck(ctxObj, eventObj, 80);
			});

			// omp://extensions.md:507-508: 'session_stop — main-session stop hook, awaited before settle ... defers until agent-owned background jobs are fully idle'
			pi.on("session_stop", (_event: unknown, ctx?: unknown) => {
				const ctxObj = ctx && typeof ctx === "object" ? (ctx as ExtensionContext) : undefined;
				if (ctxObj?.agent?.kind === "main" || !ctxObj?.agent) {
					deferSettledCheck(ctxObj, { isTerminal: true, willContinue: false }, 80);
				}
			});
		}
	}
}
