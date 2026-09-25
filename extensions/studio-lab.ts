// Estensione OMP: Laboratorio prototipi — Confinamento runtime e allowlist fail-closed.
//
// Questa estensione realizza il perimetro di sicurezza insuperabile dell'agente Lab
// concordato nel contratto di implementazione (ricerca/lab-lane-contratti.md § 6).
//
// ============================================================================
// DOCUMENTAZIONE TOOL CONSENTITI E MOTIVAZIONI DI SICUREZZA
// ============================================================================
//
// 1. Tool ammessi senza controlli sui percorsi:
//    - `task`: subagenti per compiti paralleli o scomposizione del lavoro.
//    - `hub`, `wait`: messaggistica e coordinamento asincrono tra agenti.
//    - `todo`: tracciamento passaggi di lavoro in memoria/sessione.
//    - `ask`: chiarimenti interattivi con l'utente nella GUI.
//    - `web_search`: consultazione documentazione pubblica online.
//    - `lab_preview_status`: stato della compilazione/runtime dell'anteprima.
//    - `lab_set_summary`: salvataggio metadati (titolo e riepilogo) del prototipo.
//
// 2. Tool di lettura file (`read`, `grep`, `glob`):
//    - Consentiti esclusivamente dentro il workspace del prototipo (OMP_LAB_WORKSPACE)
//      e dentro la cartella del progetto associato (OMP_LAB_PROJECT_PATH, se presente).
//    - Accesso bloccato per file sensibili o credenziali:
//      `.git/`, `.env*`, `web.config`, `Parametri.ini`, `appsettings*.json`,
//      `*.pem`, `*.key`, `id_rsa*`.
//    - Schemi URL in lettura: ammessi URL interni (`skill://`, `rule://`, `artifact://`,
//      `agent://`, `local://`, `history://`) e `http(s)://`; altri schemi negati.
//
// 3. Tool di scrittura e modifica file (`write`, `edit`, `ast_edit`):
//    - Scrittura consentita ESCLUSIVAMENTE dentro il workspace del prototipo (OMP_LAB_WORKSPACE).
//    - Il progetto originale e' in SOLA LETTURA (nessuna modifica al codice sorgente dell'app).
//    - Cartella `.git/` interna protetta: nessuna scrittura o modifica consentita in `.git/`.
//    - `write` ammette lo schema interno `local://` e il canale QA `xd://report_issue`;
//      altri schemi URL sono negati.
//    - Per `edit`, vengono analizzate sia le intestazioni hashline `[PATH#TAG]` sia le
//      righe di rename `MV DEST` e l'eventuale `path` nei parametri. Se nessun percorso
//      e' riconoscibile nel testo, l'operazione viene bloccata per difetto.
//
// 4. Tool `browser`:
//    - L'agente Lab puo' usare il browser ESCLUSIVAMENTE per ispezionare l'anteprima locale.
//    - Vietati parametri pericolosi: `app`, `relay`, `cdp_url`.
//    - Ogni URL richiesta nel browser deve tassativamente iniziare con l'URL dell'anteprima
//      attiva ricavata da `.lab/preview-status.json`. Se non c'e' anteprima pubblicata,
//      qualsiasi richiesta URL viene bloccata.
//
// 5. Tool negati per difetto (fail-closed):
//    - `bash`, `eval`, interpreti host, shell, debugger (`debug`, `lsp`), `ssh`,
//      server MCP (`mcp__*`) e qualsiasi tool sconosciuto: negati.
//
// 6. Protezione contro junction e symlink:
//    - Tutti i percorsi vengono validati ricavando il percorso reale (`realpath`)
//      del piu' vicino antenato esistente su disco prima di verificare l'inclusione
//      nel perimetro consentito.
//    - Su piattaforma Windows il confronto dei percorsi e' insensibile alle maiuscole/minuscole.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

/* ------------------------------------------------------------- interfacce */

export interface LabHookEnvironment {
	workspaceDir?: string;
	projectDir?: string | null;
	getCwd?: () => string;
}

export interface ToolCallEvent {
	toolName: string;
	input?: Record<string, unknown>;
}

export interface ToolCallHookResult {
	block?: boolean;
	reason?: string;
}

export interface LabPreviewError {
	kind: "compile" | "runtime";
	message: string;
	file?: string | null;
	line?: number | null;
	column?: number | null;
}

export interface LabPreviewStatus {
	url: string | null;
	compiledAt: number;
	sourceStamp: number;
	ok: boolean;
	errors: LabPreviewError[];
}

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
	parameters?: ZodType | unknown;
	approval?: "none" | "read" | "write" | "exec";
	execute(
		toolCallId: string,
		params: TParams,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ToolContext | undefined
	): Promise<ToolResult>;
}

export interface ExtensionApi {
	zod?: ZodBuilder;
	registerTool<TParams = Record<string, unknown>>(definition: ToolDefinition<TParams>): void;
	on?(
		eventName: "tool_call",
		handler: (
			event: ToolCallEvent,
			ctx?: unknown
		) => Promise<ToolCallHookResult | undefined> | ToolCallHookResult | undefined
	): void;
}

function textResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details ? { content: [{ type: "text", text }], details } : { content: [{ type: "text", text }] };
}

function errorResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details
		? { content: [{ type: "text", text }], isError: true, details }
		: { content: [{ type: "text", text }], isError: true };
}

/* -------------------------------------------------- costanti allowlist */

const FREE_TOOLS: Record<string, true> = {
	task: true,
	hub: true,
	todo: true,
	ask: true,
	web_search: true,
	wait: true,
	lab_preview_status: true,
	lab_set_summary: true
};

const ALLOWED_READ_SCHEMES: Record<string, true> = {
	skill: true,
	rule: true,
	artifact: true,
	agent: true,
	local: true,
	history: true,
	http: true,
	https: true
};

/* ---------------------------------------------------- risoluzione percorsi */

/**
 * Risolve il percorso reale su disco anche per file o sottocartelle non ancora create,
 * risalendo fino al primo antenato realmente esistente e calcolandone il `realpathSync`
 * per neutralizzare junction e symlink verso l'esterno.
 */
export function resolveNearestRealPath(targetPath: string): string {
	let current = resolve(targetPath);
	const trail: string[] = [];

	while (true) {
		if (existsSync(current)) {
			try {
				const real = realpathSync(current);
				return trail.length === 0 ? real : resolve(real, ...trail.reverse());
			} catch {
				return resolve(current, ...trail.reverse());
			}
		}
		const parent = dirname(current);
		if (parent === current) {
			return resolve(current, ...trail.reverse());
		}
		trail.push(basename(current));
		current = parent;
	}
}

/**
 * Verifica se `child` e' contenuto all'interno di `parent` (o coincide con esso).
 * Su Windows applica il confronto case-insensitive per evitare bypass con maiuscole/minuscole.
 */
export function isSubpath(parent: string, child: string): boolean {
	const isWin = process.platform === "win32";
	const normParent = isWin ? resolve(parent).toLowerCase() : resolve(parent);
	const normChild = isWin ? resolve(child).toLowerCase() : resolve(child);
	const rel = relative(normParent, normChild);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && rel !== "..");
}

/**
 * Rileva se un percorso tocca direttamente la cartella interna `.git`.
 */
export function isGitPath(targetPath: string): boolean {
	const normalized = targetPath.replace(/\\/g, "/");
	const segments = normalized.split("/").filter(Boolean);
	return segments.some((seg) => seg.toLowerCase() === ".git");
}

/**
 * Verifica se un percorso richiesto o risolto corrisponde a file sensibili protetti:
 * `.git/`, `.env*`, `web.config`, `Parametri.ini`, `appsettings*.json`, `*.pem`, `*.key`, `id_rsa*`.
 */
export function isDeniedSensitivePath(targetPath: string): { denied: boolean; pattern?: string } {
	const normalized = targetPath.replace(/\\/g, "/");
	const segments = normalized.split("/").filter(Boolean);

	for (const seg of segments) {
		const s = seg.toLowerCase();
		if (s === ".git") return { denied: true, pattern: ".git" };
		if (s.startsWith(".env")) return { denied: true, pattern: ".env*" };
		if (s === "web.config" || s.startsWith("web.config.")) return { denied: true, pattern: "web.config" };
		if (s === "parametri.ini" || s.startsWith("parametri.ini.")) return { denied: true, pattern: "Parametri.ini" };
		if (s.startsWith("appsettings") && s.endsWith(".json")) return { denied: true, pattern: "appsettings*.json" };
		if (s.endsWith(".pem")) return { denied: true, pattern: "*.pem" };
		if (s.endsWith(".key")) return { denied: true, pattern: "*.key" };
		if (s.startsWith("id_rsa")) return { denied: true, pattern: "id_rsa*" };
	}

	const base = basename(targetPath).toLowerCase();
	if (base === ".git") return { denied: true, pattern: ".git" };
	if (base.startsWith(".env")) return { denied: true, pattern: ".env*" };
	if (base === "web.config" || base.startsWith("web.config.")) return { denied: true, pattern: "web.config" };
	if (base === "parametri.ini" || base.startsWith("parametri.ini.")) return { denied: true, pattern: "Parametri.ini" };
	if (base.startsWith("appsettings") && base.endsWith(".json")) return { denied: true, pattern: "appsettings*.json" };
	if (base.endsWith(".pem")) return { denied: true, pattern: "*.pem" };
	if (base.endsWith(".key")) return { denied: true, pattern: "*.key" };
	if (base.startsWith("id_rsa")) return { denied: true, pattern: "id_rsa*" };

	return { denied: false };
}

/**
 * Rimuove selettori di riga/formato tipici di OMP (`:50-100`, `:raw`, ecc.)
 * preservando le lettere di unita' Windows (`C:\`).
 */
export function stripSelector(raw: string): string {
	let pathPart = raw.trim();
	if (pathPart.includes("://")) {
		return pathPart;
	}

	let prefix = "";
	if (/^[a-zA-Z]:[\\/]/.test(pathPart) || /^[a-zA-Z]:$/.test(pathPart)) {
		prefix = pathPart.slice(0, 2);
		pathPart = pathPart.slice(2);
	}

	const colonIdx = pathPart.indexOf(":");
	if (colonIdx !== -1) {
		pathPart = pathPart.slice(0, colonIdx);
	}

	return prefix + pathPart;
}

/**
 * Estrae la porzione iniziale di directory da un pattern glob prima dei caratteri jolly.
 */
export function stripWildcards(raw: string): string {
	const idx = raw.search(/[*?[]/);
	if (idx === -1) return raw;
	return raw.slice(0, idx);
}

/**
 * Estrae tutti i percorsi di destinazione presenti nel testo del tool `edit`:
 * - Intestazioni hashline `[PATH#TAG]`
 * - Comandi di spostamento `MV DEST`
 * - Parametro `path`, `filePath` o `file` esplicito nell'oggetto parametri
 */
export function extractEditPaths(input: unknown, params?: Record<string, unknown>): string[] {
	const paths: string[] = [];

	if (params && typeof params.path === "string" && params.path.trim()) {
		paths.push(params.path.trim());
	}
	if (params && typeof params.filePath === "string" && params.filePath.trim()) {
		paths.push(params.filePath.trim());
	}
	if (params && typeof params.file === "string" && params.file.trim()) {
		paths.push(params.file.trim());
	}

	if (typeof input === "string") {
		const lines = input.split(/\r?\n/);
		for (const rawLine of lines) {
			const line = rawLine.trim();

			// Intestazione [PATH#TAG] o [PATH]
			const headerMatch = line.match(/^\[(.*?)(?:#[0-9a-fA-F]{4,})?\]$/);
			if (headerMatch) {
				let p = headerMatch[1].trim();
				if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
					p = p.slice(1, -1).trim();
				}
				if (p) paths.push(p);
				continue;
			}

			// MV DEST (con o senza virgolette)
			const mvMatch = line.match(/^MV\s+(.+)$/);
			if (mvMatch) {
				let dest = mvMatch[1].trim();
				if ((dest.startsWith('"') && dest.endsWith('"')) || (dest.startsWith("'") && dest.endsWith("'"))) {
					dest = dest.slice(1, -1).trim();
				}
				if (dest) paths.push(dest);
				continue;
			}
		}
	}

	return paths;
}

/**
 * Valida i parametri di invocazione del browser verificando:
 * 1. Assenza di parametri vietati (`app`, `relay`, `cdp_url`);
 * 2. Che qualsiasi URL indicata inizi con l'URL dell'anteprima attiva.
 */
export function inspectBrowserInput(
	input: unknown,
	previewUrl: string | null
): { blocked: boolean; reason?: string } {
	function checkForbiddenKeys(obj: unknown): string | null {
		if (!obj || typeof obj !== "object") return null;
		for (const key of Object.keys(obj as Record<string, unknown>)) {
			const lower = key.toLowerCase();
			if (lower === "app" || lower === "relay" || lower === "cdp_url" || lower === "cdpurl" || lower === "cdp-url") {
				return `Parametro vietato '${key}' presente nell'input del browser: nel Laboratorio il browser non puo' usare app, relay o cdp_url.`;
			}
			const val = (obj as Record<string, unknown>)[key];
			if (typeof val === "object" && val !== null) {
				const nested = checkForbiddenKeys(val);
				if (nested) return nested;
			}
		}
		return null;
	}

	const forbidden = checkForbiddenKeys(input);
	if (forbidden) {
		return { blocked: true, reason: forbidden };
	}

	function collectUrls(obj: unknown): string[] {
		const urls: string[] = [];
		if (!obj || typeof obj !== "object") return urls;
		for (const val of Object.values(obj as Record<string, unknown>)) {
			if (typeof val === "string") {
				if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(val.trim())) {
					urls.push(val.trim());
				}
			} else if (typeof val === "object" && val !== null) {
				urls.push(...collectUrls(val));
			}
		}
		return urls;
	}

	const urls = collectUrls(input);
	if (urls.length > 0) {
		if (!previewUrl || typeof previewUrl !== "string") {
			return {
				blocked: true,
				reason: "Browser negato: nessuna anteprima pubblicata in .lab/preview-status.json. Esegui prima una compilazione o verifica lab_preview_status."
			};
		}

		const normPreview = previewUrl.replace(/\/+$/, "");
		for (const u of urls) {
			const normU = u.replace(/\/+$/, "");
			const startsWith = u.startsWith(normPreview) || normU.startsWith(normPreview);
			if (!startsWith) {
				return {
					blocked: true,
					reason: `Accesso all'URL '${u}' negato: nel Laboratorio il browser e' vincolato esclusivamente all'URL dell'anteprima ('${previewUrl}').`
				};
			}
		}
	}

	return { blocked: false };
}

/**
 * Calcola l'epoca millisecondi della modifica piu' recente fra tutti i file sorgente
 * del workspace, escludendo `.git`, `.lab`, `node_modules` e `dist`.
 */
export function getLatestSourceMtime(workspaceDir: string): number {
	let maxMtime = 0;
	const ignored: Record<string, true> = { ".git": true, ".lab": true, node_modules: true, dist: true };

	function walk(current: string): void {
		if (!existsSync(current)) return;
		try {
			const entries = readdirSync(current, { withFileTypes: true });
			for (const entry of entries) {
				if (ignored[entry.name] === true) continue;
				const fullPath = join(current, entry.name);
				if (entry.isDirectory()) {
					walk(fullPath);
				} else if (entry.isFile()) {
					try {
						const stat = statSync(fullPath);
						if (stat.mtimeMs > maxMtime) {
							maxMtime = stat.mtimeMs;
						}
					} catch {}
				}
			}
		} catch {}
	}

	walk(workspaceDir);
	return maxMtime;
}

/* ---------------------------------------------------- hook tool_call gate */

/**
 * Crea la funzione hook `tool_call` per l'estensione Laboratorio con politica fail-closed.
 */
export function createLabToolCallHook(env?: LabHookEnvironment) {
	return async function handleLabToolCall(
		event: ToolCallEvent
	): Promise<ToolCallHookResult | undefined> {
		try {
			const toolName = event.toolName;
			const input = event.input || {};

			// 1. Tool liberi consentiti senza vincoli di percorso
			if (FREE_TOOLS[toolName] === true) {
				return undefined;
			}

			// Determinazione cartelle di lavoro
			const cwd = env?.getCwd ? env.getCwd() : process.cwd();
			const workspaceDir = env?.workspaceDir || process.env.OMP_LAB_WORKSPACE || cwd;
			const rawProjectDir = env?.projectDir !== undefined ? env.projectDir : (process.env.OMP_LAB_PROJECT_PATH || null);
			const projectDir = rawProjectDir && rawProjectDir.trim() ? rawProjectDir.trim() : null;

			const realWorkspace = resolveNearestRealPath(workspaceDir);
			const realProject = projectDir ? resolveNearestRealPath(projectDir) : null;

			// 2. Tool di lettura: `read`
			if (toolName === "read") {
				const rawPath = typeof input.path === "string" ? input.path.trim() : "";
				if (!rawPath) {
					return {
						block: true,
						reason: "Tool 'read' bloccato: parametro 'path' mancante o non valido."
					};
				}

				// Controllo schemi URL ammessi in lettura
				const urlMatch = rawPath.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
				if (urlMatch) {
					const scheme = urlMatch[1].toLowerCase();
					if (ALLOWED_READ_SCHEMES[scheme] === true) {
						return undefined;
					}
					return {
						block: true,
						reason: `Lettura negata: lo schema URL '${scheme}://' non e' autorizzato nel Laboratorio.`
					};
				}

				const cleanPath = stripSelector(rawPath);

				const sens = isDeniedSensitivePath(cleanPath);
				if (sens.denied) {
					return {
						block: true,
						reason: `Lettura negata: accesso a file o pattern protetto '${sens.pattern}'.`
					};
				}

				const targetAbs = resolve(workspaceDir, cleanPath);
				const realPath = resolveNearestRealPath(targetAbs);

				const sensReal = isDeniedSensitivePath(realPath);
				if (sensReal.denied) {
					return {
						block: true,
						reason: `Lettura negata: il percorso risolto tocca il pattern protetto '${sensReal.pattern}'.`
					};
				}

				const inWorkspace = isSubpath(realWorkspace, realPath);
				const inProject = realProject ? isSubpath(realProject, realPath) : false;

				if (!inWorkspace && !inProject) {
					return {
						block: true,
						reason: `Lettura negata: il percorso '${cleanPath}' si trova al di fuori del workspace del prototipo e del progetto.`
					};
				}

				return undefined;
			}

			// 3. Tool di ricerca testuale: `grep`
			if (toolName === "grep") {
				const rawPath = typeof input.path === "string" && input.path.trim() ? input.path.trim() : ".";
				const parts = rawPath.split(";").map((p) => p.trim()).filter(Boolean);
				if (parts.length === 0) {
					parts.push(".");
				}

				for (const part of parts) {
					const urlMatch = part.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
					if (urlMatch) {
						const scheme = urlMatch[1].toLowerCase();
						if (ALLOWED_READ_SCHEMES[scheme] !== true) {
							return {
								block: true,
								reason: `Grep negato: lo schema URL '${scheme}://' non e' autorizzato nel Laboratorio.`
							};
						}
						continue;
					}

					const cleanPart = stripSelector(part);
					const sens = isDeniedSensitivePath(cleanPart);
					if (sens.denied) {
						return {
							block: true,
							reason: `Grep negato: accesso al pattern protetto '${sens.pattern}'.`
						};
					}

					const targetBase = stripWildcards(cleanPart);
					const targetAbs = resolve(workspaceDir, targetBase || ".");
					const realPath = resolveNearestRealPath(targetAbs);

					const sensReal = isDeniedSensitivePath(realPath);
					if (sensReal.denied) {
						return {
							block: true,
							reason: `Grep negato: il percorso risolto tocca il pattern protetto '${sensReal.pattern}'.`
						};
					}

					const inWorkspace = isSubpath(realWorkspace, realPath);
					const inProject = realProject ? isSubpath(realProject, realPath) : false;

					if (!inWorkspace && !inProject) {
						return {
							block: true,
							reason: `Grep negato: il percorso '${part}' si trova al di fuori del workspace e del progetto.`
						};
					}
				}

				return undefined;
			}

			// 4. Tool di esplorazione file: `glob`
			if (toolName === "glob") {
				const rawPath = typeof input.path === "string" && input.path.trim() ? input.path.trim() : ".";
				const parts = rawPath.split(";").map((p) => p.trim()).filter(Boolean);
				if (parts.length === 0) {
					parts.push(".");
				}

				for (const part of parts) {
					const sens = isDeniedSensitivePath(part);
					if (sens.denied) {
						return {
							block: true,
							reason: `Glob negato: accesso al pattern protetto '${sens.pattern}'.`
						};
					}

					const targetBase = stripWildcards(part);
					const targetAbs = resolve(workspaceDir, targetBase || ".");
					const realPath = resolveNearestRealPath(targetAbs);

					const sensReal = isDeniedSensitivePath(realPath);
					if (sensReal.denied) {
						return {
							block: true,
							reason: `Glob negato: il percorso risolto tocca il pattern protetto '${sensReal.pattern}'.`
						};
					}

					const inWorkspace = isSubpath(realWorkspace, realPath);
					const inProject = realProject ? isSubpath(realProject, realPath) : false;

					if (!inWorkspace && !inProject) {
						return {
							block: true,
							reason: `Glob negato: il percorso '${part}' si trova al di fuori del workspace e del progetto.`
						};
					}
				}

				return undefined;
			}

			// 5. Tool di scrittura diretta: `write`
			if (toolName === "write") {
				const rawPath = typeof input.path === "string" ? input.path.trim() : "";
				if (!rawPath) {
					return {
						block: true,
						reason: "Tool 'write' bloccato: parametro 'path' mancante o non valido."
					};
				}

				// Scritture su local:// ammesse per artifact interni
				if (rawPath.toLowerCase().startsWith("local://")) {
					return undefined;
				}

				// Canale QA di omp per segnalare anomalie dei tool: non tocca file.
				// Solo questo device: gli altri xd:// (ast_edit, debug, ...) eseguono
				// operazioni che scavalcherebbero il confinamento del workspace.
				if (rawPath.toLowerCase() === "xd://report_issue") {
					return undefined;
				}

				// Altri schemi URL negati
				if (rawPath.includes("://")) {
					return {
						block: true,
						reason: "Scrittura negata: gli schemi URL esterni o speciali non sono consentiti nel Laboratorio."
					};
				}

				if (isGitPath(rawPath)) {
					return {
						block: true,
						reason: "Scrittura negata: la cartella .git/ e' protetta."
					};
				}

				const targetAbs = resolve(workspaceDir, rawPath);
				const realPath = resolveNearestRealPath(targetAbs);

				if (isGitPath(realPath)) {
					return {
						block: true,
						reason: "Scrittura negata: il percorso risolto si trova dentro .git/."
					};
				}

				if (!isSubpath(realWorkspace, realPath)) {
					return {
						block: true,
						reason: `Scrittura negata: il percorso '${rawPath}' e' esterno al workspace del prototipo.`
					};
				}

				return undefined;
			}

			// 6. Tool di modifica a blocchi hashline: `edit`
			if (toolName === "edit") {
				const extractedPaths = extractEditPaths(input.input, input);
				if (extractedPaths.length === 0) {
					return {
						block: true,
						reason: "Tool 'edit' bloccato: nessun percorso riconoscibile nell'input (mancano intestazioni [PATH#TAG] o MV DEST)."
					};
				}

				for (const p of extractedPaths) {
					if (p.includes("://")) {
						return {
							block: true,
							reason: `Modifica negata: percorsi con schema URL ('${p}') non ammessi per il tool 'edit'.`
						};
					}

					if (isGitPath(p)) {
						return {
							block: true,
							reason: "Modifica negata: i percorsi dentro .git/ sono protetti."
						};
					}

					const targetAbs = resolve(workspaceDir, p);
					const realPath = resolveNearestRealPath(targetAbs);

					if (isGitPath(realPath)) {
						return {
							block: true,
							reason: "Modifica negata: il percorso risolto tocca la cartella protetta .git/."
						};
					}

					if (!isSubpath(realWorkspace, realPath)) {
						return {
							block: true,
							reason: `Modifica negata: il percorso '${p}' e' esterno al workspace del prototipo.`
						};
					}
				}

				return undefined;
			}

			// 7. Tool di modifica strutturale: `ast_edit`
			if (toolName === "ast_edit") {
				const rawPath = typeof input.path === "string" && input.path.trim()
					? input.path.trim()
					: typeof input.filePath === "string" && input.filePath.trim()
					? input.filePath.trim()
					: typeof input.file === "string" && input.file.trim()
					? input.file.trim()
					: "";

				if (!rawPath) {
					return {
						block: true,
						reason: "Tool 'ast_edit' bloccato: nessun percorso file specificato."
					};
				}

				if (rawPath.includes("://")) {
					return {
						block: true,
						reason: "Tool 'ast_edit' bloccato: schemi URL non ammessi."
					};
				}

				if (isGitPath(rawPath)) {
					return {
						block: true,
						reason: "Modifica AST negata: la cartella .git/ e' protetta."
					};
				}

				const targetAbs = resolve(workspaceDir, rawPath);
				const realPath = resolveNearestRealPath(targetAbs);

				if (isGitPath(realPath)) {
					return {
						block: true,
						reason: "Modifica AST negata: il percorso risolto tocca .git/."
					};
				}

				if (!isSubpath(realWorkspace, realPath)) {
					return {
						block: true,
						reason: `Modifica AST negata: il percorso '${rawPath}' e' esterno al workspace del prototipo.`
					};
				}

				return undefined;
			}

			// 8. Tool di ispezione visuale: `browser`
			if (toolName === "browser") {
				let previewUrl: string | null = null;
				const previewStatusFile = join(workspaceDir, ".lab", "preview-status.json");
				if (existsSync(previewStatusFile)) {
					try {
						const raw = readFileSync(previewStatusFile, "utf8");
						const parsed = JSON.parse(raw);
						if (typeof parsed?.url === "string" && parsed.url.trim()) {
							previewUrl = parsed.url.trim();
						}
					} catch {}
				}

				const inspection = inspectBrowserInput(input, previewUrl);
				if (inspection.blocked) {
					return {
						block: true,
						reason: inspection.reason || "Uso del browser non autorizzato nel Laboratorio."
					};
				}

				return undefined;
			}

			// 9. Tool esplicitamente negati con messaggio motivato
			if (toolName === "bash" || toolName === "exec") {
				return {
					block: true,
					reason: "Tool 'bash' non consentito nel Laboratorio: l'esecuzione di comandi shell e' vietata per isolamento del runtime."
				};
			}
			if (toolName === "eval" || toolName === "python") {
				return {
					block: true,
					reason: `Tool '${toolName}' non consentito nel Laboratorio: l'esecuzione di interpreti host e' vietata.`
				};
			}
			if (toolName === "lsp" || toolName === "debug" || toolName === "ssh") {
				return {
					block: true,
					reason: `Tool '${toolName}' non consentito nella sessione Laboratorio.`
				};
			}
			if (toolName.startsWith("mcp__")) {
				return {
					block: true,
					reason: `Tool MCP '${toolName}' non consentito nel Laboratorio: le integrazioni e i server esterni sono disattivati.`
				};
			}

			// 10. Politica fail-closed per qualsiasi tool sconosciuto o non autorizzato
			return {
				block: true,
				reason: `Tool '${toolName}' non autorizzato nel Laboratorio (politica fail-closed: sono consentiti solo i tool autorizzati).`
			};
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				block: true,
				reason: `Blocco di sicurezza fail-closed nel Laboratorio: errore inatteso durante la verifica del tool '${event.toolName}': ${msg}`
			};
		}
	};
}

/* ---------------------------------------------------- entry point estensione */

/**
 * Entrypoint dell'estensione OMP per il Laboratorio.
 * Registra i due tool dedicati (`lab_preview_status` e `lab_set_summary`) e l'hook fail-closed `tool_call`.
 */
export default function studioLabExtension(pi: ExtensionApi): void {
	const workspaceDir = process.env.OMP_LAB_WORKSPACE || process.cwd();
	const projectDir = process.env.OMP_LAB_PROJECT_PATH || null;

	const env: LabHookEnvironment = {
		workspaceDir,
		projectDir,
		getCwd: () => process.cwd()
	};

	// 1. Registrazione dell'hook `tool_call`
	if (typeof pi.on === "function") {
		const hook = createLabToolCallHook(env);
		pi.on("tool_call", async (event) => {
			return await hook(event);
		});
	}

	const z = pi.zod;

	// 2. Registrazione tool `lab_preview_status`
	const previewParams = z ? z.object({}) : undefined;
	pi.registerTool({
		name: "lab_preview_status",
		label: "Stato anteprima Laboratorio",
		description:
			"Legge lo stato attuale della compilazione e dell'anteprima da .lab/preview-status.json. " +
			"Attende fino a 8 secondi che l'anteprima sia ricompilata dopo le ultime modifiche ai sorgenti. " +
			"Restituisce l'URL dell'anteprima, l'esito (OK o errori) e l'elenco degli errori di compilazione o runtime.",
		parameters: previewParams,
		approval: "read",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const activeWorkspace = ctx?.sessionManager?.getCwd?.() || workspaceDir;
			const maxWaitMs = 8000;
			const pollIntervalMs = 150;
			const startTime = Date.now();

			let status: LabPreviewStatus | null = null;
			let latestSourceMtime = 0;
			let isStale = true;

			while (Date.now() - startTime < maxWaitMs) {
				latestSourceMtime = getLatestSourceMtime(activeWorkspace);
				const statusFile = join(activeWorkspace, ".lab", "preview-status.json");
				if (existsSync(statusFile)) {
					try {
						const raw = readFileSync(statusFile, "utf8");
						status = JSON.parse(raw) as LabPreviewStatus;
						if (typeof status.compiledAt === "number" && status.compiledAt >= latestSourceMtime) {
							isStale = false;
							break;
						}
					} catch {}
				}
				await sleep(pollIntervalMs);
			}

			if (isStale) {
				latestSourceMtime = getLatestSourceMtime(activeWorkspace);
				const statusFile = join(activeWorkspace, ".lab", "preview-status.json");
				if (existsSync(statusFile)) {
					try {
						const raw = readFileSync(statusFile, "utf8");
						status = JSON.parse(raw) as LabPreviewStatus;
						if (typeof status.compiledAt === "number" && status.compiledAt >= latestSourceMtime) {
							isStale = false;
						}
					} catch {}
				}
			}

			if (!status) {
				return textResult(
					"Anteprima non ancora disponibile: il file .lab/preview-status.json non e' presente nel workspace del prototipo dopo 8 secondi di attesa.",
					{
						ok: false,
						url: null,
						errors: [],
						stale: true,
						latestSourceMtime
					}
				);
			}

			const lines: string[] = [];
			lines.push(`URL anteprima: ${status.url || "nessun URL (non pubblicata)"}`);
			lines.push(`Esito compilazione: ${status.ok ? "SUCCESSO (OK)" : "ERRORI RILEVATI"}`);
			if (isStale) {
				lines.push("Stato: VECCHIO (la compilazione non ha ancora recepito l'ultima modifica ai sorgenti)");
			} else {
				lines.push("Stato: AGGIORNATO");
			}

			if (Array.isArray(status.errors) && status.errors.length > 0) {
				lines.push(`\nErrori riscontrati (${status.errors.length}):`);
				for (const err of status.errors) {
					const loc = [err.file || "file", err.line ?? "?", err.column ?? "?"].join(":");
					lines.push(`- [${err.kind || "errore"}] ${loc}: ${err.message}`);
				}
			} else {
				lines.push("\nNessun errore di compilazione o runtime.");
			}

			return textResult(lines.join("\n"), {
				ok: status.ok,
				url: status.url,
				errors: status.errors || [],
				stale: isStale,
				compiledAt: status.compiledAt,
				latestSourceMtime
			});
		}
	});

	// 3. Registrazione tool `lab_set_summary`
	const summaryParams = z
		? z.object({
				title: z.string().describe("Titolo sintetico del prototipo (massimo 80 caratteri)."),
				summary: z
					.string()
					.describe("Riepilogo in 2-3 righe dello scopo e delle funzionalita' del prototipo (massimo 400 caratteri).")
		  })
		: undefined;

	pi.registerTool<{ title?: string; summary?: string }>({
		name: "lab_set_summary",
		label: "Salvataggio riepilogo prototipo",
		description:
			"Salva titolo e riepilogo del prototipo nel file atomico .lab/meta.json. " +
			"Chiamalo non appena il prototipo prende forma o quando il suo scopo cambia: " +
			"l'agente principale del progetto usa questo riepilogo per ritrovare e comprendere il prototipo.",
		parameters: summaryParams,
		approval: "write",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const activeWorkspace = ctx?.sessionManager?.getCwd?.() || workspaceDir;
			const title = typeof params?.title === "string" ? params.title.trim() : "";
			const summary = typeof params?.summary === "string" ? params.summary.trim() : "";

			if (!title) {
				return errorResult("Errore: il parametro 'title' e' obbligatorio e non puo' essere vuoto.");
			}
			if (title.length > 80) {
				return errorResult(`Errore: il titolo supera il limite massimo di 80 caratteri (lunghezza: ${title.length}).`);
			}
			if (!summary) {
				return errorResult("Errore: il parametro 'summary' e' obbligatorio e non puo' essere vuoto.");
			}
			if (summary.length > 400) {
				return errorResult(
					`Errore: il riepilogo supera il limite massimo di 400 caratteri (lunghezza: ${summary.length}).`
				);
			}

			const labDir = join(activeWorkspace, ".lab");
			mkdirSync(labDir, { recursive: true });

			const metaPayload = {
				title,
				summary,
				updatedAt: new Date().toISOString()
			};

			const metaJson = JSON.stringify(metaPayload, null, 2);
			const tempFile = join(labDir, `meta.${randomUUID()}.tmp`);

			try {
				writeFileSync(tempFile, metaJson, "utf8");
				renameSync(tempFile, join(labDir, "meta.json"));
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Errore durante la scrittura di .lab/meta.json: ${msg}`);
			}

			return textResult(
				`Riepilogo prototipo aggiornato con successo:\nTitolo: "${title}"\nRiepilogo: "${summary}"`,
				metaPayload
			);
		}
	});
}
