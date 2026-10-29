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

const FORBIDDEN_WRITE_TOOLS: Record<string, string> = {
	write: "Scrittura file non consentita in modalità sola lettura",
	edit: "Modifica file non consentita in modalità sola lettura",
	ast_edit: "Modifica strutturale file non consentita in modalità sola lettura",
	bash: "Esecuzione shell/comandi non consentita in modalità sola lettura",
	eval: "Interpreti host (eval) non consentiti in modalità sola lettura",
	terminal: "Terminale interattivo non consentito in modalità sola lettura"
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
		if (FORBIDDEN_WRITE_TOOLS[toolName]) {
			return {
				block: true,
				reason: `Operazione negata: ${FORBIDDEN_WRITE_TOOLS[toolName]}.`
			};
		}

		// 2. Controllo percorsi per tool di lettura
		if (toolName === "read" || toolName === "glob" || toolName === "grep") {
			const rawPath = typeof input.path === "string" ? input.path.trim() : "";
			if (!rawPath && toolName === "read") {
				return {
					block: true,
					reason: "Tool 'read' bloccato: parametro 'path' mancante o vuoto."
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
						reason: `Lettura negata: schema URL '${scheme}://' non consentito in sessione protetta.`
					};
				}

				const clean = stripSelector(rawPath);
				if (isDeniedSensitivePath(clean)) {
					return {
						block: true,
						reason: `Accesso negato al file sensibile: '${clean}'.`
					};
				}

				if (allowedRoots.length > 0) {
					const inAnyRoot = allowedRoots.some((root) => isWithinRoot(clean, root));
					if (!inAnyRoot) {
						return {
							block: true,
							reason: `Accesso negato: il percorso '${clean}' è al di fuori delle cartelle consentite.`
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
