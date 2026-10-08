// Estensione OMP: proposte dell'agente per l'obiettivo guidato di Studio.
//
// L'intervista di `/guided-goal` nella chat GUI e' di Studio e funziona anche
// senza questa estensione (domande e risposte proposte fisse). Qui l'agente
// rende le proposte specifiche del progetto, senza toccare la sessione:
//
// 1. Studio invia il prompt `/studio-goal suggest {"requestId","idea","locale"}`.
//    In RPC i comandi delle estensioni partono prima di tutto il resto, anche
//    durante un turno, e non entrano nel transcript.
// 2. L'estensione legge i comandi del progetto (script di `package.json`,
//    `Cargo.toml`) e fa un turno a margine senza strumenti
//    (`ctx.runEphemeralTurn`, lo stesso di `/btw`): il modello vede il contesto
//    della sessione ma la risposta non entra nella storia.
// 3. La risposta torna a Studio come `setStatus("studio.goal", json)`, che in
//    rpc-ui diventa un frame `extension_ui_request`; subito dopo lo stato si
//    azzera, cosi' nel terminale non resta nulla nella riga di stato.
//
// Se il turno a margine non e' disponibile (omp vecchio) o fallisce, Studio
// riceve comunque i comandi del progetto, oppure un errore e resta sulle
// proposte fisse.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const STATUS_KEY = "studio.goal";
export const COMMAND_NAME = "studio-goal";

export interface SuggestRequest {
	requestId: string;
	idea: string;
	locale: string;
}

export interface ProjectHints {
	testCommand?: string;
	checkCommand?: string;
	lintCommand?: string;
}

interface EphemeralTurnResult {
	replyText: string;
}

interface StudioGoalContext {
	cwd?: string;
	sessionManager?: { getCwd?: () => string };
	ui?: {
		setStatus?: (key: string, text: string | undefined) => void;
		notify?: (message: string, level?: "info" | "warning" | "error") => void;
	};
	runEphemeralTurn?: (options: {
		promptText: string;
		tools?: false;
		maxTokens?: number;
		replyMaxBytes?: number;
	}) => Promise<EphemeralTurnResult>;
}

interface StudioGoalApi {
	registerCommand(
		name: string,
		command: { description: string; handler: (args: string, ctx: StudioGoalContext) => Promise<void> }
	): void;
}

/** `suggest {json}` → richiesta; `null` per qualunque altra cosa. */
export function parseSuggestArgs(args: string): SuggestRequest | null {
	const trimmed = args.trim();
	if (!trimmed.toLowerCase().startsWith("suggest")) return null;
	const json = trimmed.slice("suggest".length).trim();
	try {
		const value = JSON.parse(json) as Record<string, unknown>;
		const requestId = typeof value.requestId === "string" ? value.requestId : "";
		const idea = typeof value.idea === "string" ? value.idea.trim() : "";
		const locale = typeof value.locale === "string" && value.locale ? value.locale : "it";
		if (!requestId || !idea) return null;
		return { requestId, idea, locale };
	} catch {
		return null;
	}
}

/** Gestore di pacchetti dal lockfile: i comandi proposti devono girare davvero. */
function packageRunner(cwd: string): { test: string; run: (script: string) => string } {
	if (existsSync(join(cwd, "pnpm-lock.yaml"))) return { test: "pnpm test", run: (s) => `pnpm run ${s}` };
	if (existsSync(join(cwd, "yarn.lock"))) return { test: "yarn test", run: (s) => `yarn ${s}` };
	if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) {
		// Nei progetti con bun gli script npm restano lo standard di questo repository.
		if (existsSync(join(cwd, "package-lock.json"))) return { test: "npm test", run: (s) => `npm run ${s}` };
		return { test: "bun run test", run: (s) => `bun run ${s}` };
	}
	return { test: "npm test", run: (s) => `npm run ${s}` };
}

/** Comandi di verifica del progetto, senza eseguirli. */
export function detectProjectHints(cwd: string): ProjectHints {
	const hints: ProjectHints = {};
	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, unknown> };
			const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
			const runner = packageRunner(cwd);
			if (typeof scripts.test === "string" && !/no test specified/i.test(scripts.test)) hints.testCommand = runner.test;
			if (typeof scripts.check === "string") hints.checkCommand = runner.run("check");
			else if (typeof scripts.typecheck === "string") hints.checkCommand = runner.run("typecheck");
			if (typeof scripts.lint === "string") hints.lintCommand = runner.run("lint");
		} catch {
			// package.json illeggibile: nessun suggerimento, non un errore.
		}
	}
	if (!hints.testCommand) {
		if (existsSync(join(cwd, "Cargo.toml"))) hints.testCommand = "cargo test";
		else if (existsSync(join(cwd, "go.mod"))) hints.testCommand = "go test ./...";
		else if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "pytest.ini"))) hints.testCommand = "pytest";
	}
	return hints;
}

function languageName(locale: string): string {
	return locale.toLowerCase().startsWith("it") ? "Italian" : "English";
}

/** Prompt del turno a margine: solo JSON, cinque campi come l'intervista di omp. */
export function buildSuggestPrompt(request: SuggestRequest, hints: ProjectHints): string {
	const commands = [hints.testCommand, hints.checkCommand, hints.lintCommand].filter(Boolean).join(", ") || "none detected";
	return [
		"The user is defining a goal for goal mode (an autonomous objective you will pursue over several turns).",
		"Studio will interview them with five questions, one at a time: success criteria, verification, cap, boundaries, stop conditions.",
		"Using what you know about this project from the conversation, propose project-specific questions and answers.",
		"",
		`Rough objective from the user: ${JSON.stringify(request.idea)}`,
		`Project commands detected: ${commands}`,
		"",
		"Reply with JSON only, no prose and no code fences, in this exact shape:",
		'{"objective":"short measurable restatement of the goal",',
		' "questions":[',
		'  {"field":"criteria","question":"...","options":[{"label":"binary measurable criterion","description":"why","recommended":true}, ...]},',
		'  {"field":"verification","question":"...","options":[{"label":"short label","items":["exact shell command"],"description":"..."}, ...]},',
		'  {"field":"cap","question":"...","options":[{"label":"5 attempts · 400k tokens","attempts":5,"tokenBudget":400000}, ...]},',
		'  {"field":"boundaries","question":"...","options":[{"label":"...","allowed":["paths or areas"],"forbidden":["..."]}, ...]},',
		'  {"field":"stop","question":"...","options":[{"label":"when to stop and ask the user"}, ...]}',
		" ]}",
		"",
		"Rules: exactly 3 options per question and exactly one with \"recommended\":true.",
		"Every success criterion must be checkable with a yes or a no (a threshold, an exit code, a passing test): never \"faster\" or \"cleaner\" without a number.",
		"Verification items must be real commands for this project; prefer the detected ones.",
		`Write every question, label and description in ${languageName(request.locale)}. Keep labels under 80 characters.`
	].join("\n");
}

/** Il primo oggetto JSON della risposta (tollera recinti ``` e testo attorno). */
export function extractJson(text: string): unknown {
	const unfenced = text.replace(/```(?:json)?/gi, "");
	const start = unfenced.indexOf("{");
	const end = unfenced.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(unfenced.slice(start, end + 1));
	} catch {
		return null;
	}
}

function report(ctx: StudioGoalContext, payload: Record<string, unknown>): void {
	const setStatus = ctx.ui?.setStatus;
	if (!setStatus) return;
	setStatus(STATUS_KEY, JSON.stringify(payload));
	// Lo stato e' un canale, non un'etichetta: si libera subito.
	setTimeout(() => setStatus(STATUS_KEY, undefined), 0);
}

export async function runSuggest(request: SuggestRequest, ctx: StudioGoalContext): Promise<Record<string, unknown>> {
	const cwd = ctx.sessionManager?.getCwd?.() ?? ctx.cwd ?? process.cwd();
	const hints = detectProjectHints(cwd);
	if (!ctx.runEphemeralTurn) {
		return Object.keys(hints).length
			? { type: "suggestions", requestId: request.requestId, suggestions: { questions: [], hints } }
			: { type: "error", requestId: request.requestId, message: "side turns unavailable" };
	}
	try {
		const result = await ctx.runEphemeralTurn({
			promptText: buildSuggestPrompt(request, hints),
			tools: false,
			maxTokens: 2500,
			replyMaxBytes: 64 * 1024
		});
		const parsed = extractJson(result.replyText);
		if (!parsed || typeof parsed !== "object") {
			return Object.keys(hints).length
				? { type: "suggestions", requestId: request.requestId, suggestions: { questions: [], hints } }
				: { type: "error", requestId: request.requestId, message: "no JSON in reply" };
		}
		return { type: "suggestions", requestId: request.requestId, suggestions: { ...(parsed as object), hints } };
	} catch (error) {
		return {
			type: "error",
			requestId: request.requestId,
			message: error instanceof Error ? error.message : String(error)
		};
	}
}

export default function studioGoalExtension(pi: StudioGoalApi): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Proposte dell'agente per l'obiettivo guidato di OMP Studio (uso interno della GUI)",
		handler: async (args, ctx) => {
			const request = parseSuggestArgs(args);
			if (!request) {
				ctx.ui?.notify?.("Comando interno di OMP Studio: usa /guided-goal nella chat di Studio.", "info");
				return;
			}
			// Il turno a margine puo' durare decine di secondi: il comando torna
			// subito, cosi' il prompt RPC di Studio non resta appeso (e non tiene
			// in coda i prompt successivi). Parte dopo la fine del gestore: un
			// turno legato al suo segnale verrebbe annullato quando il gestore chiude.
			setTimeout(() => {
				void runSuggest(request, ctx).then((payload) => report(ctx, payload));
			}, 50);
		}
	});
}
