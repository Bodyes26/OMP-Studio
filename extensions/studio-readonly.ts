// Estensione OMP: Confinamento sola lettura per automazioni e assistente.
//
// Realizza il perimetro di sicurezza fail-closed concordato nel contratto di implementazione:
// blocco rigoroso di qualsiasi tool di scrittura o esecuzione e controllo sui percorsi autorizzati.

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

interface ToolCallEvent {
	toolName: string;
	input?: Record<string, unknown>;
}

interface ToolCallHookResult {
	block?: boolean;
	reason?: string;
}

interface ExtensionApi {
	on?(
		eventName: "tool_call",
		handler: (event: ToolCallEvent) => Promise<ToolCallHookResult | undefined> | ToolCallHookResult | undefined
	): void;
}

/**
 * Testo scelto secondo la lingua della UI: il processo omp riceve
 * `OMP_STUDIO_LOCALE` da Studio, il bundle della GUI ricade su `<html lang>`.
 * Senza lingua nota si usa l'inglese, il default di Studio. Letta a ogni
 * chiamata: la lingua puo' cambiare durante la vita del processo.
 */
function tr(it: string, en: string): string {
	const host = globalThis as {
		process?: { env?: Record<string, string | undefined> };
		document?: { documentElement?: { lang?: string } };
	};
	const code = (host.process?.env?.OMP_STUDIO_LOCALE || host.document?.documentElement?.lang || "en").toLowerCase();
	return code.startsWith("it") ? it : en;
}

/** Motivo del blocco per tool: [italiano, inglese]. */
const FORBIDDEN_WRITE_TOOLS: Record<string, [string, string]> = {
	write: ["Scrittura file non consentita in modalità sola lettura", "file writes are not allowed in read-only mode"],
	edit: ["Modifica file non consentita in modalità sola lettura", "file edits are not allowed in read-only mode"],
	ast_edit: [
		"Modifica strutturale file non consentita in modalità sola lettura",
		"structural file edits are not allowed in read-only mode"
	],
	bash: [
		"Esecuzione shell/comandi non consentita in modalità sola lettura",
		"shell command execution is not allowed in read-only mode"
	],
	eval: ["Interpreti host (eval) non consentiti in modalità sola lettura", "host interpreters (eval) are not allowed in read-only mode"],
	terminal: [
		"Terminale interattivo non consentito in modalità sola lettura",
		"an interactive terminal is not allowed in read-only mode"
	]
};

const ALLOWED_READ_SCHEMES: Record<string, true> = {
	"http": true,
	"https": true,
	"local": true,
	"skill": true,
	"rule": true,
	"artifact": true,
	"history": true,
	"agent": true
};

const DENIED_FILE_PATTERNS: RegExp[] = [
	/(?:^|[\\/])\.git(?:[\\/]|$)/i,
	/(?:^|[\\/])\.env(?:\.[^\\/]+)?$/i,
	/(?:^|[\\/])parametri\.ini$/i,
	/(?:^|[\\/])appsettings(?:\.[^\\/]+)?\.json$/i,
	/(?:^|[\\/])[^\\/]+\.pem$/i,
	/(?:^|[\\/])[^\\/]+\.key$/i,
	/(?:^|[\\/])id_rsa(?:[^\\/]+)?$/i
];

function isDeniedSensitivePath(path: string): boolean {
	const normalized = path.replace(/\\/g, "/");
	return DENIED_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function resolveNearestRealPath(path: string): string {
	try {
		let current = resolve(path);
		while (!existsSync(current)) {
			const parent = resolve(current, "..");
			if (parent === current) break;
			current = parent;
		}
		return existsSync(current) ? realpathSync(current) : resolve(path);
	} catch {
		return resolve(path);
	}
}

function isWithinRoot(childPath: string, rootPath: string): boolean {
	const realChild = resolveNearestRealPath(childPath);
	const realRoot = resolveNearestRealPath(rootPath);
	const rel = relative(realRoot, realChild);
	const isWindows = process.platform === "win32";
	if (isWindows) {
		const lowerRel = rel.toLowerCase();
		return !lowerRel.startsWith("..") && !isAbsolute(rel);
	}
	return !rel.startsWith("..") && !isAbsolute(rel);
}

function stripSelector(path: string): string {
	// Rimuove selettori :N-M o #TAG
	const hashIdx = path.indexOf("#");
	let cleaned = hashIdx !== -1 ? path.slice(0, hashIdx) : path;
	cleaned = cleaned.replace(/:\d+(?:-\d+|\+.*)?$/g, "");
	return cleaned.trim();
}

export function parseAllowedRoots(): string[] {
	const raw = process.env.OMP_AUTOMATION_ROOTS;
	if (!raw || !raw.trim()) {
		return [process.cwd()];
	}
	try {
		if (raw.startsWith("[")) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
		}
	} catch {
		// fallback split su ;
	}
	return raw.split(";").map((p) => p.trim()).filter(Boolean);
}

export function createReadonlyHook(allowedRoots = parseAllowedRoots()) {
	return function handleToolCall(event: ToolCallEvent): ToolCallHookResult | undefined {
		const toolName = event.toolName;
		const input = event.input || {};

		// 1. Blocco immediato di tool di scrittura o esecuzione
		const forbidden = FORBIDDEN_WRITE_TOOLS[toolName];
		if (forbidden) {
			return {
				block: true,
				reason: tr(`Operazione negata: ${forbidden[0]}.`, `Operation denied: ${forbidden[1]}.`)
			};
		}

		// 2. Controllo percorsi per tool di lettura
		if (toolName === "read" || toolName === "glob" || toolName === "grep") {
			const rawPath = typeof input.path === "string" ? input.path.trim() : "";
			if (!rawPath && toolName === "read") {
				return {
					block: true,
					reason: tr(
						"Tool 'read' bloccato: parametro 'path' mancante o vuoto.",
						"Tool 'read' blocked: the 'path' parameter is missing or empty."
					)
				};
			}

			if (rawPath) {
				const urlMatch = rawPath.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
				if (urlMatch) {
					const scheme = urlMatch[1].toLowerCase();
					if (ALLOWED_READ_SCHEMES[scheme] === true) {
						return undefined;
					}
					return {
						block: true,
						reason: tr(
							`Lettura negata: schema URL '${scheme}://' non consentito in sessione protetta.`,
							`Read denied: URL scheme '${scheme}://' is not allowed in a protected session.`
						)
					};
				}

				const clean = stripSelector(rawPath);
				if (isDeniedSensitivePath(clean)) {
					return {
						block: true,
						reason: tr(`Accesso negato al file sensibile: '${clean}'.`, `Access to the sensitive file denied: '${clean}'.`)
					};
				}

				if (allowedRoots.length > 0) {
					const inAnyRoot = allowedRoots.some((root) => isWithinRoot(clean, root));
					if (!inAnyRoot) {
						return {
							block: true,
							reason: tr(
								`Accesso negato: il percorso '${clean}' è al di fuori delle cartelle consentite.`,
								`Access denied: the path '${clean}' is outside the allowed folders.`
							)
						};
					}
				}
			}
		}

		return undefined;
	};
}

export default function studioReadonlyExtension(pi: ExtensionApi): void {
	if (typeof pi.on === "function") {
		const hook = createReadonlyHook();
		pi.on("tool_call", (event) => hook(event));
	}
}
