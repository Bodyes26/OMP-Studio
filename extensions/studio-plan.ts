// Estensione OMP: modalita' Piano per la chat GUI di Studio (`--mode rpc-ui`).
//
// Il `/plan` di omp esiste solo nella TUI (nessun comando RPC, nessun campo in
// `get_state`): Studio intercetta `/plan` e `/plan-review` scritti nel composer
// e chiede a questa estensione di fare cio' che farebbe omp:
//
// 1. comando `/studio-plan on|off|status|review` (il nome diverso da `plan` e'
//    voluto: nel Terminale resta il `/plan` nativo, e qui l'estensione e' inerte);
// 2. hook `before_agent_start`: aggiunge al prompt di sistema la copia adattata di
//    `plan-mode-active.md` (subagenti: `plan-mode-subagent.md`);
// 3. hook `tool_call`: blocca `write`/`edit`/`ast_edit` fuori da `local://` e da
//    `.omp/plans/`, e sempre rinomina ed eliminazione;
// 4. strumento `studio_plan_submit({slug, title})`: legge `local://<slug>-plan.md`
//    e apre la revisione di Studio con una `extension_ui_request` di tipo `editor`
//    il cui titolo inizia con `studio-plan-review:` (meta JSON) e il cui testo
//    precompilato e' il piano. La risposta e' la decisione JSON di Studio.
//
// Il passaggio (nuova sessione, corsia, compattazione, ruolo) lo orchestra Studio
// con i comandi RPC esistenti: qui si spegne solo la guardia e si archivia il
// piano in `.omp/plans/`.
//
// I testi dei prompt sono adattati da oh-my-pi (MIT, Copyright (c) 2025 Mario
// Zechner, (c) 2025-2026 Can Boluk, (c) 2026 Stencil Labs, Inc.):
// packages/coding-agent/src/prompts/system/plan-mode-active.md e
// plan-mode-subagent.md, versione 18.8.4. Vanno riallineati quando upstream li
// cambia (controllo di release dei comandi, docs/COMMANDS.md).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

/* ------------------------------------------------------------------ costanti */

/** Prefisso del titolo della richiesta di revisione: Studio lo riconosce. */
export const PLAN_REVIEW_TITLE_PREFIX = "studio-plan-review:";
/** Chiave di `setStatus` con lo stato JSON del Piano per Studio. */
export const PLAN_STATUS_KEY = "studio-plan";
/** customType della voce di sessione che fa sopravvivere il modo a un resume. */
export const PLAN_STATE_ENTRY = "studio-plan-state";
export const PLAN_SUBMIT_TOOL = "studio_plan_submit";

/** Strumenti che scrivono file: fuori da `local://` e `.omp/plans/` sono bloccati. */
const WRITE_TOOLS: Record<string, true> = {
	write: true,
	edit: true,
	ast_edit: true,
	notebook: true,
	notebook_edit: true,
	apply_patch: true
};

const WINDOWS_LOCAL_ROOT_MAX_CHARS = 180;

/* ------------------------------------------------------------------- prompt */

export const PLAN_MODE_ACTIVE_PROMPT = `<critical>
Plan mode active (OMP Studio).
- Working tree/system read-only: NEVER create, edit, delete, or rename working-tree files; NEVER run state-changing commands (\`git commit\`, \`npm install\`, migrations) or otherwise change the system.
- \`local://\`: session-local planning artifacts; MAY create/update only when explicitly requested or needed for the plan; NEVER delete/rename.
- Canonical plan: MUST write \`local://<slug>-plan.md\`.

Submitting: call \`${PLAN_SUBMIT_TOOL}\` with \`slug\` (MUST match \`local://<slug>-plan.md\`; letters, numbers, underscores, hyphens) and a short human \`title\`. The user then reviews the plan in OMP Studio and selects an execution option; full write access is restored by Studio.

NEVER ask user to exit plan mode or request approval in prose or with \`ask\`; approval ONLY via \`${PLAN_SUBMIT_TOOL}\`.
</critical>

## What a plan is

Plan: execution spec, not design doc. Approval may clear/compact the conversation; another engineer/fresh agent implements solely from the file. A competent implementer unfamiliar with the conversation MUST execute top-to-bottom with ZERO design decisions; file contains every choice.

Detail removes implementer decisions, not padding. Decision-completeness > brevity.

## Plan file

Choose short kebab-case task \`<slug>\`; create \`local://<slug>-plan.md\` (e.g. \`local://auth-token-refresh-plan.md\`). If a plan for the same task already exists, read it and update it incrementally. File NEVER renamed on approval; submit this same \`<slug>\`.

Use \`##\` headings for the sections below: OMP Studio shows each \`##\` section as a reviewable block (comment, edit, delete). Write the file incrementally while learning; NEVER defer all writing to the end.

## Ground every claim

Resolve unknowns by discovery, not questions.

- Discoverable facts (locations, behavior, signatures, configs): MUST discover with \`glob\`, \`grep\`, \`read\`, or parallel read-only \`scout\` subagents via \`task\`. Every asserted path, symbol, signature, behavior: actually read this session. Unconfirmed: mark inline \`unverified — confirm first\`.
- Preferences/tradeoffs (intent, UX, scope edges): ask early via \`ask\` with 2–4 mutually exclusive options and a recommended default. Unanswered → use default; record under Assumptions.

Every question MUST alter the plan or resolve a load-bearing choice; batch questions. NEVER ask what exploration answers.

## Workflow

1. **Understand**: request and supporting code; find reusable code before proposing new. Spawn read-only scouts for wide scopes.
2. **Design**: draft the approach from findings, weigh tradeoffs briefly, commit.
3. **Review**: read intended files; validate approach against code and literal request.
4. **Write**: plan per **Plan contents**, then submit with \`${PLAN_SUBMIT_TOOL}\`.

## Plan contents

Scannable markdown; depth follows change.

- **Context**: literal ask, need, intended end state; 2–4 sentences.
- **Approach**: load-bearing ordered change steps, grouped by behavior, never by file. Each step: concrete edit (verb, exact target, new behavior); existing functions to reuse; exact signatures/literals for new symbols; every callsite for renames/removals; error and empty-state handling.
- **Critical files**: at most 5 files disambiguating non-obvious work: path, symbol/region, one-line reason.
- **Verification**: end-to-end proof with at least one new-behavior check (concrete input → expected observable output) and exact commands.
- **Assumptions**: only user-overridable decisions, each with a pre-decided fallback.

NEVER include Non-Goals, Alternatives Considered, Risks, Future Work, changelog/doc chores, or references to the planning conversation.

<critical>
Before submitting: an engineer unfamiliar with the conversation can execute every step without a design decision and determine success at each step.

Turn ends ONLY by:
1. \`ask\` to gather requirements or choose approaches; OR
2. \`${PLAN_SUBMIT_TOOL}\` with the plan slug and title.

If \`${PLAN_SUBMIT_TOOL}\` returns requested changes: update the same plan file, then submit again. If it says the plan was approved or saved: stop immediately with one short sentence; OMP Studio continues.
</critical>`;

export const PLAN_MODE_SUBAGENT_PROMPT = `<critical>
Plan mode active. You MUST perform READ-ONLY operations only.

You NEVER:
- Create, edit, delete, move, or copy files
- Run state-changing commands (git, build system, package manager, migrations)
- Make any changes to the system
</critical>

<role>
Software architect and planning specialist for the main agent.
You MUST explore the codebase and report findings. The main agent updates the plan file.
</role>

<output>
End response with:

### Critical Files for Implementation

List 3-5 files most critical for implementing this plan:
- \`path/to/file1.ts\` — Brief reason
</output>`;

/* -------------------------------------------------------------- stato del modo */

export interface StudioPlanState {
	enabled: boolean;
	/** `local://<slug>-plan.md` dell'ultimo piano proposto. */
	planFilePath: string | null;
	/** Titolo dell'ultimo piano proposto. */
	title: string | null;
}

// Lo stato vive a livello di processo: in `rpc-ui` c'e' una sola sessione
// principale per processo omp, e i subagenti (stesso processo) devono vedere la
// stessa guardia. Solo la sessione principale lo cambia.
const STATE_SYMBOL = Symbol.for("omp-studio.plan-state");
type GlobalWithPlan = typeof globalThis & { [STATE_SYMBOL]?: StudioPlanState };

export function planState(): StudioPlanState {
	const g = globalThis as GlobalWithPlan;
	if (!g[STATE_SYMBOL]) g[STATE_SYMBOL] = { enabled: false, planFilePath: null, title: null };
	return g[STATE_SYMBOL]!;
}

export function resetPlanState(next?: Partial<StudioPlanState>): StudioPlanState {
	const state = planState();
	state.enabled = next?.enabled ?? false;
	state.planFilePath = next?.planFilePath ?? null;
	state.title = next?.title ?? null;
	return state;
}

/* ------------------------------------------------------------------ guardia */

export interface ToolCallLike {
	toolName: string;
	input?: Record<string, unknown>;
}

export interface GuardResult {
	block: true;
	reason: string;
}

const READ_ONLY_REASON =
	"Plan mode (OMP Studio): the working tree is read-only. Write your plan to a local://<slug>-plan.md file instead.";

/** Toglie l'involucro hashline `[path#TAG]` come la guardia nativa. */
function unwrapHashline(raw: string): string {
	const trimmed = raw.trim();
	const match = /^\[(.+?)(?:#[0-9A-Fa-f]{4})?\]$/.exec(trimmed);
	return match ? match[1] : trimmed;
}

/**
 * Vero se `target` resta in un'area scrivibile durante il Piano: lo spazio di
 * sessione `local://` oppure `<cwd>/.omp/plans/`.
 */
export function isPlanWritablePath(target: string, cwd: string): boolean {
	const path = unwrapHashline(target);
	if (!path) return false;
	if (/^local:\/\//i.test(path)) return !path.includes("..");
	// Ogni altro schema interno (`skill://`, `memory://`, ...) resta fuori.
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false;
	const plansDir = resolve(cwd, ".omp", "plans");
	const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
	const rel = relative(plansDir, absolute);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Percorsi toccati da una chiamata di scrittura; `rename`/`delete` sempre vietati. */
export function collectWriteTargets(input: Record<string, unknown>): { paths: string[]; forbidden: string | null } {
	const paths: string[] = [];
	let forbidden: string | null = null;
	for (const key of ["path", "file", "file_path", "filePath", "target"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) paths.push(value);
	}
	if (input.delete === true || input.op === "delete") forbidden = "delete";
	if (typeof input.rename === "string" || typeof input.move === "string") forbidden = "rename";
	const edits = Array.isArray(input.edits) ? input.edits : [];
	for (const edit of edits) {
		if (!edit || typeof edit !== "object") continue;
		const record = edit as Record<string, unknown>;
		if (typeof record.path === "string" && record.path.trim()) paths.push(record.path);
		if (record.op === "delete") forbidden = "delete";
		if (typeof record.rename === "string" || typeof record.move === "string") forbidden = "rename";
	}
	// `apply_patch`: i file stanno nelle intestazioni della patch.
	const patch = typeof input.input === "string" ? input.input : typeof input.patch === "string" ? input.patch : "";
	if (patch) {
		for (const line of patch.split(/\r?\n/)) {
			const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line.trim());
			if (header) {
				paths.push(header[2].trim());
				if (header[1] === "Delete") forbidden = "delete";
			}
			if (/^\*\*\* Move to: /.test(line.trim())) forbidden = "rename";
		}
	}
	return { paths, forbidden };
}

/**
 * Decisione della guardia per una chiamata: `undefined` lascia passare.
 * Fail-closed: uno strumento di scrittura senza un percorso riconoscibile viene
 * bloccato, meglio un tentativo in piu' dell'agente che un file toccato.
 */
export function evaluatePlanToolCall(event: ToolCallLike, cwd: string, enabled: boolean): GuardResult | undefined {
	if (!enabled) return undefined;
	if (WRITE_TOOLS[event.toolName] !== true) return undefined;
	const { paths, forbidden } = collectWriteTargets(event.input ?? {});
	if (forbidden === "rename") return { block: true, reason: "Plan mode (OMP Studio): renaming files is not allowed." };
	if (forbidden === "delete") return { block: true, reason: "Plan mode (OMP Studio): deleting files is not allowed." };
	if (paths.length === 0) return { block: true, reason: READ_ONLY_REASON };
	for (const path of paths) {
		if (!isPlanWritablePath(path, cwd)) return { block: true, reason: READ_ONLY_REASON };
	}
	return undefined;
}

/* ------------------------------------------------------------ file del piano */

/** Stesso schema di `normalizePlanTitle` di omp: solo lettere, cifre, `_` e `-`. */
export function normalizePlanSlug(raw: string): string | null {
	const slug = raw
		.trim()
		.replace(/^local:\/\//i, "")
		.replace(/\.md$/i, "")
		.replace(/-plan$/i, "")
		.replace(/\s+/g, "-")
		.replace(/[^A-Za-z0-9_-]/g, "")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug ? slug : null;
}

/** Copia di `planSaveFileName` di omp (`plan-autosave.ts`): `<TITOLO>_PLAN.md`. */
export function planSaveFileName(title: string): string {
	let stem = title
		.normalize("NFC")
		.replace(/[^\p{L}\p{N}]+/gu, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();
	if (stem.length > 32) {
		const cut = stem.lastIndexOf("_", 32);
		stem = cut > 0 ? stem.slice(0, cut) : stem.slice(0, 32);
	}
	if (!stem || stem === "PLAN") return "PLAN.md";
	return `${stem.endsWith("_PLAN") ? stem : `${stem}_PLAN`}.md`;
}

/** Radice di `local://` come `resolveLocalRoot` di omp. */
export function resolveLocalRoot(
	artifactsDir: string | null | undefined,
	sessionId: string | null | undefined,
	platform: string = process.platform
): string {
	const safeId = (sessionId ?? "session").replace(/[^a-zA-Z0-9_.-]/g, "_") || "session";
	if (artifactsDir) {
		const candidate = resolve(artifactsDir, "local");
		if (platform === "win32" && candidate.length >= WINDOWS_LOCAL_ROOT_MAX_CHARS) {
			return join(tmpdir(), "omp-local", safeId);
		}
		return candidate;
	}
	return join(tmpdir(), "omp-local", safeId);
}

/**
 * Scrive una copia in `.omp/plans/` senza sovrascrivere (come l'autosave di omp:
 * `<stem>-<n>.md` se il nome e' gia' preso). Restituisce il percorso relativo.
 */
export function savePlanCopy(cwd: string, title: string, content: string): string {
	const dir = join(cwd, ".omp", "plans");
	mkdirSync(dir, { recursive: true });
	const fileName = planSaveFileName(title);
	const dot = fileName.lastIndexOf(".");
	const stem = fileName.slice(0, dot);
	for (let index = 0; index < 1000; index++) {
		const name = index === 0 ? fileName : `${stem}-${index}.md`;
		const target = join(dir, name);
		try {
			writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
			return `.omp/plans/${name}`;
		} catch (error) {
			if ((error as { code?: string }).code !== "EEXIST") throw error;
		}
	}
	const fallback = `${Date.now()}-${fileName}`;
	writeFileSync(join(dir, fallback), content, { encoding: "utf8", flag: "wx" });
	return `.omp/plans/${fallback}`;
}

/* ------------------------------------------------------- decisione di Studio */

export type PlanExecMode = "fresh" | "lane" | "compact" | "keep";

export interface PlanReviewDecision {
	action: "approve" | "refine" | "save" | "cancel";
	mode?: PlanExecMode;
	role?: string;
	autosave?: boolean;
	feedback?: string;
	/** Piano riscritto da Studio (sezioni modificate o eliminate). */
	content?: string;
}

export function parseDecision(raw: string | undefined): PlanReviewDecision {
	if (!raw) return { action: "cancel" };
	try {
		const parsed = JSON.parse(raw) as Partial<PlanReviewDecision>;
		const action =
			parsed.action === "approve" || parsed.action === "refine" || parsed.action === "save" ? parsed.action : "cancel";
		const mode =
			parsed.mode === "fresh" || parsed.mode === "lane" || parsed.mode === "compact" || parsed.mode === "keep"
				? parsed.mode
				: undefined;
		return {
			action,
			mode,
			role: typeof parsed.role === "string" ? parsed.role : undefined,
			autosave: parsed.autosave !== false,
			feedback: typeof parsed.feedback === "string" ? parsed.feedback : undefined,
			content: typeof parsed.content === "string" ? parsed.content : undefined
		};
	} catch {
		// Testo libero: lo si tratta come richiesta di modifiche.
		return raw.trim() ? { action: "refine", feedback: raw.trim() } : { action: "cancel" };
	}
}

/** Testo che l'agente riceve come risultato di `studio_plan_submit`. */
export function decisionResultText(decision: PlanReviewDecision, planFilePath: string, savedPath: string | null): string {
	switch (decision.action) {
		case "refine":
			return [
				"The user reviewed the plan in OMP Studio and requested changes:",
				"",
				decision.feedback?.trim() || "(no comment: re-check the plan for completeness)",
				"",
				`Update ${planFilePath} accordingly (plan mode is still active), then submit it again with ${PLAN_SUBMIT_TOOL}.`
			].join("\n");
		case "approve":
			return [
				`Plan approved in OMP Studio${savedPath ? ` (copy saved to ${savedPath})` : ""}.`,
				"Plan mode is off. OMP Studio now hands the plan to the executor: STOP NOW. Reply with one short sentence and do not call any other tool."
			].join("\n");
		case "save":
			return [
				`The user chose "Save and quit"${savedPath ? `: plan saved to ${savedPath}` : ""}.`,
				"Plan mode is off and nothing will be executed. STOP NOW with one short sentence."
			].join("\n");
		default:
			return [
				"The user closed the plan review without a decision. Plan mode is still active.",
				"STOP NOW and wait: the user can reopen the review with /plan-review or send new instructions."
			].join("\n");
	}
}

/* -------------------------------------------------------------- tipi di omp */

interface ZodType {
	optional(): ZodType;
	describe(text: string): ZodType;
}

interface ZodBuilder {
	object(shape: Record<string, ZodType>): ZodType;
	string(): ZodType;
}

interface PlanUi {
	editor(title: string, prefill?: string, dialogOptions?: { signal?: AbortSignal }): Promise<string | undefined>;
	setStatus(key: string, text: string | undefined): void;
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

interface PlanContext {
	ui?: PlanUi;
	hasUI?: boolean;
	mode?: string;
	cwd?: string;
	agent?: { kind?: "main" | "sub" };
	localProtocolOptions?: { getArtifactsDir?: () => string | null; getSessionId?: () => string | null };
	sessionManager?: {
		getCwd?: () => string;
		getArtifactsDir?: () => string | null;
		getSessionId?: () => string | null;
		getBranch?: () => unknown[];
		getEntries?: () => unknown[];
	};
}

interface ToolResult {
	content: { type: "text"; text: string }[];
	details?: Record<string, unknown>;
	isError?: boolean;
}

interface PlanToolParams {
	slug?: string;
	title?: string;
}

interface StudioPlanApi {
	zod: ZodBuilder;
	registerTool(definition: {
		name: string;
		label: string;
		description: string;
		parameters: ZodType;
		approval: "read" | "write" | "exec";
		execute(
			toolCallId: string,
			params: PlanToolParams,
			signal: AbortSignal | undefined,
			onUpdate: unknown,
			ctx: PlanContext | undefined
		): Promise<ToolResult>;
	}): void;
	registerCommand(
		name: string,
		command: { description: string; handler: (args: string, ctx: PlanContext) => Promise<void> }
	): void;
	on(event: string, handler: (event: Record<string, unknown>, ctx: PlanContext) => unknown): void;
	appendEntry?(customType: string, data?: unknown): void;
	sendUserMessage?(content: string): void;
	getActiveTools?(): string[];
	setActiveTools?(names: string[]): Promise<void>;
}

/* ----------------------------------------------------------------- utilita' */

function text(value: string, details?: Record<string, unknown>, isError = false): ToolResult {
	const result: ToolResult = { content: [{ type: "text", text: value }] };
	if (details) result.details = details;
	if (isError) result.isError = true;
	return result;
}

function contextCwd(ctx: PlanContext | undefined): string {
	return ctx?.sessionManager?.getCwd?.() ?? ctx?.cwd ?? process.cwd();
}

function localRootOf(ctx: PlanContext | undefined): string {
	const options = ctx?.localProtocolOptions;
	const artifacts = options?.getArtifactsDir?.() ?? ctx?.sessionManager?.getArtifactsDir?.() ?? null;
	const sessionId = options?.getSessionId?.() ?? ctx?.sessionManager?.getSessionId?.() ?? null;
	return resolveLocalRoot(artifacts, sessionId);
}

/**
 * Solo per `rpc-ui`/`rpc`: nella TUI resta il `/plan` nativo e l'estensione tace.
 * Studio marca il processo GUI con `OMP_STUDIO_PLAN=gui` (rpc/mod.rs); `--mode`
 * resta come riserva se la variabile si perde.
 */
export function isGuiHost(
	argv: readonly string[] = process.argv,
	env: Record<string, string | undefined> = process.env
): boolean {
	if (env.OMP_STUDIO_PLAN === "gui") return true;
	if (env.OMP_STUDIO_PLAN === "off") return false;
	const index = argv.indexOf("--mode");
	if (index >= 0) return argv[index + 1] === "rpc-ui" || argv[index + 1] === "rpc";
	return argv.some((arg) => arg === "--mode=rpc-ui" || arg === "--mode=rpc");
}

/** Ultimo stato salvato nella sessione (voce custom `studio-plan-state`). */
export function restoreFromEntries(entries: unknown[] | undefined): StudioPlanState {
	let found: StudioPlanState = { enabled: false, planFilePath: null, title: null };
	for (const entry of entries ?? []) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry as { type?: unknown; customType?: unknown; data?: unknown };
		if (record.type !== "custom" || record.customType !== PLAN_STATE_ENTRY) continue;
		const data = (record.data ?? {}) as Partial<StudioPlanState>;
		found = {
			enabled: data.enabled === true,
			planFilePath: typeof data.planFilePath === "string" ? data.planFilePath : null,
			title: typeof data.title === "string" ? data.title : null
		};
	}
	return found;
}

/* -------------------------------------------------------------- entrypoint */

export default function studioPlanExtension(pi: StudioPlanApi): void {
	if (!isGuiHost()) return;
	const z = pi.zod;

	const publish = (ctx: PlanContext | undefined) => {
		const state = planState();
		try {
			ctx?.ui?.setStatus(PLAN_STATUS_KEY, JSON.stringify(state));
		} catch {
			// Nessuna UI (stampa, json): lo stato resta comunque nella sessione.
		}
	};

	const persist = () => {
		try {
			pi.appendEntry?.(PLAN_STATE_ENTRY, { ...planState() });
		} catch {
			// Sessione effimera (`--no-session`): niente resume da proteggere.
		}
	};

	const syncTools = async () => {
		if (!pi.getActiveTools || !pi.setActiveTools) return;
		try {
			const active = pi.getActiveTools();
			const enabled = planState().enabled;
			const next = active.filter((name) => name !== PLAN_SUBMIT_TOOL);
			if (enabled) {
				next.push(PLAN_SUBMIT_TOOL);
				// Come omp: `write` serve a scrivere il piano, anche se era spento.
				if (!next.includes("write")) next.push("write");
			}
			if (next.length !== active.length || next.some((name, index) => name !== active[index])) {
				await pi.setActiveTools(next);
			}
		} catch {
			// L'elenco degli strumenti non e' essenziale: lo strumento rifiuta da solo fuori dal Piano.
		}
	};

	const setEnabled = async (ctx: PlanContext | undefined, enabled: boolean) => {
		const state = planState();
		if (state.enabled === enabled) {
			publish(ctx);
			return;
		}
		state.enabled = enabled;
		persist();
		await syncTools();
		publish(ctx);
	};

	const restore = async (ctx: PlanContext) => {
		if (ctx?.agent?.kind === "sub") return;
		const entries = ctx?.sessionManager?.getBranch?.() ?? ctx?.sessionManager?.getEntries?.();
		const restored = restoreFromEntries(entries);
		resetPlanState(restored);
		await syncTools();
		publish(ctx);
	};

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_switch", (_event, ctx) => restore(ctx));

	pi.on("before_agent_start", (event, ctx) => {
		if (!planState().enabled) return undefined;
		const base = Array.isArray(event.systemPrompt) ? (event.systemPrompt as string[]) : [];
		const addition = ctx?.agent?.kind === "sub" ? PLAN_MODE_SUBAGENT_PROMPT : PLAN_MODE_ACTIVE_PROMPT;
		return { systemPrompt: [...base, addition] };
	});

	pi.on("tool_call", (event, ctx) => {
		const toolName = typeof event.toolName === "string" ? event.toolName : "";
		const input = event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
		return evaluatePlanToolCall({ toolName, input }, contextCwd(ctx), planState().enabled);
	});

	/**
	 * Apre la revisione in Studio e applica la decisione. Condivisa fra lo
	 * strumento (turno in corso) e `/studio-plan review` (sessione ferma).
	 */
	const review = async (
		ctx: PlanContext | undefined,
		slug: string,
		title: string,
		signal?: AbortSignal
	): Promise<
		| { decision: PlanReviewDecision; planFilePath: string; savedPath: string | null; content: string }
		| { error: string }
	> => {
		const planFilePath = `local://${slug}-plan.md`;
		const localPath = join(localRootOf(ctx), `${slug}-plan.md`);
		if (!existsSync(localPath)) {
			return { error: `Plan file not found: ${planFilePath}. Write the plan there first, then submit again.` };
		}
		const content = readFileSync(localPath, "utf8");
		if (!content.trim()) return { error: `Plan file is empty: ${planFilePath}.` };
		if (!ctx?.ui) return { error: "No OMP Studio UI is attached to this session." };

		const state = planState();
		state.planFilePath = planFilePath;
		state.title = title;
		persist();
		publish(ctx);

		const meta = { v: 1, slug, title, planFilePath, localPath };
		const raw = await ctx.ui.editor(`${PLAN_REVIEW_TITLE_PREFIX}${JSON.stringify(meta)}`, content, { signal });
		const decision = parseDecision(raw);

		// Le modifiche fatte in revisione arrivano subito su disco, come in omp.
		if (decision.content !== undefined && decision.content !== content && decision.content.trim()) {
			writeFileSync(localPath, decision.content, "utf8");
		}
		// Senza modifiche nella card si rilegge il file: «Apri nell'editor» puo'
		// averlo cambiato mentre la revisione era aperta.
		let finalContent = content;
		if (decision.content?.trim()) finalContent = decision.content;
		else {
			try {
				finalContent = readFileSync(localPath, "utf8") || content;
			} catch {
				finalContent = content;
			}
		}

		let savedPath: string | null = null;
		if (decision.action === "approve" || decision.action === "save") {
			if (decision.action === "save" || decision.autosave !== false) {
				try {
					savedPath = savePlanCopy(contextCwd(ctx), title, finalContent);
				} catch (error) {
					ctx.ui.notify(
						`Copia del piano in .omp/plans non riuscita: ${error instanceof Error ? error.message : String(error)}`,
						"warning"
					);
				}
			}
			await setEnabled(ctx, false);
		}
		return { decision, planFilePath, savedPath, content: finalContent };
	};

	pi.registerTool({
		name: PLAN_SUBMIT_TOOL,
		label: "Studio Plan Submit",
		description:
			"Submit the plan written to local://<slug>-plan.md for review in OMP Studio. Only available while Studio plan mode is active. " +
			"Blocks until the user decides: returns requested changes (update the plan and submit again) or approval (stop immediately).",
		parameters: z.object({
			slug: z.string().describe("Plan slug: the <slug> of local://<slug>-plan.md (letters, numbers, _ and -)."),
			title: z.string().optional().describe("Short human-readable plan title shown to the user.")
		}),
		approval: "read",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!planState().enabled) {
				return text("Studio plan mode is not active: there is nothing to submit.", undefined, true);
			}
			const slug = normalizePlanSlug(typeof params?.slug === "string" ? params.slug : "");
			if (!slug) return text("Invalid slug: use letters, numbers, underscores or hyphens.", undefined, true);
			const title = (typeof params?.title === "string" && params.title.trim()) || slug.replace(/[-_]+/g, " ");
			const outcome = await review(ctx, slug, title, signal);
			if ("error" in outcome) return text(outcome.error, undefined, true);
			return text(decisionResultText(outcome.decision, outcome.planFilePath, outcome.savedPath), {
				action: outcome.decision.action,
				mode: outcome.decision.mode,
				role: outcome.decision.role,
				planFilePath: outcome.planFilePath,
				savedPath: outcome.savedPath,
				// `details` non va al modello: Studio ci legge il piano finale.
				planContent: outcome.decision.action === "approve" ? outcome.content : undefined
			});
		}
	});

	pi.registerCommand("studio-plan", {
		description: "OMP Studio: modalita' Piano della chat GUI (on|off|status|review)",
		handler: async (args, ctx) => {
			const op = args.trim().split(/\s+/)[0]?.toLowerCase() || "status";
			if (op === "on") {
				await setEnabled(ctx, true);
				return;
			}
			if (op === "off") {
				await setEnabled(ctx, false);
				return;
			}
			if (op === "review") {
				// Sessione ferma: la revisione non deve tenere bloccata la risposta
				// di `prompt`, quindi parte senza attendere e applica l'esito dopo.
				const state = planState();
				const slug = normalizePlanSlug(state.planFilePath ?? "");
				if (!slug) {
					ctx?.ui?.notify("Nessun piano da rivedere in questa sessione.", "info");
					return;
				}
				const title = state.title ?? slug;
				void review(ctx, slug, title).then((outcome) => {
					if ("error" in outcome) {
						ctx?.ui?.notify(outcome.error, "warning");
						return;
					}
					if (outcome.decision.action === "refine") {
						// Il commento dell'utente apre la bolla (Studio la marca «Piano»);
						// l'istruzione per l'agente segue su una riga a parte.
						const feedback = outcome.decision.feedback?.trim() || decisionResultText(outcome.decision, outcome.planFilePath, null);
						pi.sendUserMessage?.(
							`${feedback}\n\n(Update ${outcome.planFilePath} and submit it again with ${PLAN_SUBMIT_TOOL}.)`
						);
					}
				});
				return;
			}
			publish(ctx);
		}
	});
}
