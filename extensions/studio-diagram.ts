// Estensione omp <-> OMP Studio: tool "studio_diagram" e "studio_preview".
//
// Fornisce due tool per l'agente:
// 1. `studio_diagram`: renderizza diagrammi Mermaid interattivi sulla whiteboard
//    nella colonna centrale di Studio al posto di stampare ASCII art nel terminale.
// 2. `studio_preview`: renderizza prototipi di componenti UI interattivi (React,
//    Tailwind CSS, Lucide) nella sandbox di Studio per vibecoding rapido.
//    Salva automaticamente i prototipi in 'proto/' (aggiunto a .gitignore) e
//    apre la live preview istantanea a fianco del terminale.
//
// Caricamento: Studio lancia omp con `-e <percorso di questo file>` (overlay
// --config gia' presente). Nessuna scrittura in ~/.omp: la cartella e' di
// Studio e cancellarla riporta tutto com'era (contratto PRODUCT.md §8).
//
// API verificate sul binario omp installato (probe: ricerca/probe-ext.ts):
// - pi.registerTool({ name, label, description, parameters, approval, execute })
//   con schema Zod-compatibile esposto come pi.zod (backend omptype).
//   NON usare pi.typebox: e' il namespace del modulo legacy ({ Type, default }),
//   non il costruttore, e pi.typebox.String non esiste piu'.
// - execute(toolCallId, params, signal?, onUpdate?, ctx?) -> AgentToolResult:
//   il risultato DEVE avere `content` come array di blocchi { type: "text", text }.
//   Un `{ output }` viene rifiutato con "Tool returned an invalid result".
// - ctx.sessionManager.getCwd() / getSessionId() disponibili nel ctx dei tool.
// - Descrizioni: usare `.optional().describe(...)`, non `.describe(...).optional()`:
//   su enum/union quest'ultimo ordine perde la description nello JSON Schema.

import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function isSubpath(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return !rel.startsWith("..") && !isAbsolute(rel);
}

// Stessa funzione di `src/lib/prototype/wrapper.ts` (questo file e' incorporato
// da solo nel binario e non puo' importarla): le modifiche vanno fatte in entrambi.
// Librerie a versione fissa: `lucide@latest` e' passato alla 1.x, che cambia il
// formato delle icone, e ha rotto da un giorno all'altro ogni prototipo con icone.
function wrapPrototypeCode(title: string, code: string): string {
	const raw = code.trim();
	const lower = raw.toLowerCase();
	if (lower.startsWith("<!doctype") || lower.startsWith("<html") || (lower.includes("<head") && lower.includes("<body"))) {
		return code;
	}

	// Gli import da `react` e `lucide-react` diventano le globali del documento;
	// gli altri non hanno un modulo da cui leggere e vengono tolti. Il codice
	// gira dentro un blocco: ridichiarare `useState` oscura quello del wrapper.
	let cleanedCode = code
		.replace(/^[ \t]*import\s+([^'";]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm, (_match, clause: string, source: string) => {
			const globalName = source === "react" ? "React" : source === "lucide-react" ? "LucideReact" : null;
			if (!globalName || clause.startsWith("type ")) return "";
			const declarations: string[] = [];
			const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
			if (namespace) declarations.push(`const ${namespace[1]} = ${globalName};`);
			const named = clause.match(/\{([\s\S]*?)\}/);
			if (named) {
				const specifiers = named[1]
					.split(",")
					.map((specifier) => specifier.trim())
					.filter((specifier) => specifier && !specifier.startsWith("type "))
					.map((specifier) => specifier.replace(/\s+as\s+/, ": "));
				if (specifiers.length) declarations.push(`const { ${specifiers.join(", ")} } = ${globalName};`);
			}
			return declarations.join(" ");
		})
		.replace(/^[ \t]*import\s+['"][^'"]+['"];?[ \t]*$/gm, "")
		.replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/g, "function $1")
		.replace(/export\s+default\s+/g, "const App = ")
		.replace(/export\s+(const|let|var|function|class)\s+/g, "$1 ");

	let compName = "App";
	const funcMatch = cleanedCode.match(/function\s+([A-Z][A-Za-z0-9_]*)/);
	const constMatch = cleanedCode.match(/(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/);
	if (funcMatch && funcMatch[1]) {
		compName = funcMatch[1];
	} else if (constMatch && constMatch[1]) {
		compName = constMatch[1];
	} else if (!cleanedCode.includes("function ") && !cleanedCode.includes("class ") && !cleanedCode.includes("=>")) {
		cleanedCode = `function App() {\n  return (\n    <>\n${cleanedCode}\n    </>\n  );\n}`;
		compName = "App";
	}

	return `<!DOCTYPE html>
<html lang="it" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com/3.4.17"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: "hsl(240 3.7% 15.9%)",
            background: "hsl(240 10% 3.9%)",
            foreground: "hsl(0 0% 98%)",
            muted: "hsl(240 3.7% 15.9%)",
            "muted-foreground": "hsl(240 5% 64.9%)",
            card: "hsl(240 10% 3.9%)",
            "card-foreground": "hsl(0 0% 98%)",
            primary: "hsl(0 0% 98%)",
            "primary-foreground": "hsl(240 5.9% 10%)",
            secondary: "hsl(240 3.7% 15.9%)",
            "secondary-foreground": "hsl(0 0% 98%)",
            accent: "hsl(240 3.7% 15.9%)",
            "accent-foreground": "hsl(0 0% 98%)",
            destructive: "hsl(0 62.8% 30.6%)",
            "destructive-foreground": "hsl(0 0% 98%)"
          }
        }
      }
    }
  </script>
  <script crossorigin="anonymous" src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
  <script crossorigin="anonymous" src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
  <script crossorigin="anonymous" src="https://unpkg.com/@babel/standalone@7.29.9/babel.min.js"></script>
  <script crossorigin="anonymous" src="https://unpkg.com/lucide@1.52.0/dist/umd/lucide.js"></script>
  <script>
    // Lo script inline non ha estensione .tsx: senza allExtensions/isTSX il preset
    // typescript lascia passare i generici (useState<string>) come confronti.
    Babel.registerPreset('tsx', { presets: [[Babel.availablePresets['typescript'], { allExtensions: true, isTSX: true }]] });
  </script>
  <style>
    body {
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #09090b;
      color: #f4f4f5;
    }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
  </style>
</head>
<body class="min-h-screen p-4 sm:p-6 md:p-8 flex flex-col items-center justify-start antialiased selection:bg-neutral-800">
  <div id="root" class="w-full max-w-5xl flex flex-col items-center"></div>
  <div id="error-boundary" class="hidden w-full max-w-2xl mt-4 p-4 rounded-xl border border-red-500/30 bg-red-950/40 text-red-200 text-sm"></div>

  <script type="text/babel" data-presets="react,tsx">
    const { useState, useEffect, useMemo, useRef, useCallback } = React;

    const LucideReact = new Proxy({}, {
      get: (_, iconName) => {
        return (props) => {
          const { size = 18, className = '', ...rest } = props || {};
          const kebab = iconName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
          const iconDef = window.lucide?.icons?.[iconName] || window.lucide?.icons?.[kebab];
          if (!iconDef) {
            return <span className={"inline-block text-xs " + className} {...rest}>[{iconName}]</span>;
          }
          // lucide 1.x espone solo i figli dell'svg: [[tag, attrs], ...].
          const svgAttrs = {
            xmlns: "http://www.w3.org/2000/svg",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            width: size,
            height: size,
            className: "inline-block align-middle " + className,
            ...rest
          };
          return React.createElement(
            'svg',
            svgAttrs,
            iconDef.map(([cTag, cAttrs], i) => React.createElement(cTag, { ...cAttrs, key: i }))
          );
        };
      }
    });
    window.LucideReact = LucideReact;

    window.addEventListener('error', (e) => {
      const eb = document.getElementById('error-boundary');
      if (eb) {
        eb.classList.remove('hidden');
        eb.textContent = 'Errore runtime: ' + (e.message || e.error || 'Errore sconosciuto');
      }
    });

    setTimeout(() => { if (window.lucide?.createIcons) window.lucide.createIcons(); }, 100);

    try {
      ${cleanedCode}

      const rootEl = document.getElementById('root');
      const Comp = typeof App !== 'undefined' ? App : (
        typeof ${compName} !== 'undefined' ? ${compName} : (
          typeof Prototype !== 'undefined' ? Prototype : null
        )
      );
      if (Comp) {
        ReactDOM.createRoot(rootEl).render(<Comp />);
      }
    } catch (err) {
      const eb = document.getElementById('error-boundary');
      if (eb) {
        eb.classList.remove('hidden');
        eb.textContent = 'Errore di inizializzazione: ' + (err.message || String(err));
      }
    }
  </script>
</body>
</html>`;
}

// Sottoinsieme tipizzato della superficie iniettata da omp: solo cio' che serve
// qui, cosi' un cambio di API si vede come errore di tipo e non a runtime.
interface ZodType {
	optional(): ZodType;
	describe(text: string): ZodType;
}

interface ZodBuilder {
	object(shape: Record<string, ZodType>): ZodType;
	string(): ZodType;
	boolean(): ZodType;
}

interface ToolContext {
	sessionManager?: {
		getCwd?: () => string;
		getSessionId?: () => string;
	};
}

interface TextPart {
	type: "text";
	text: string;
}

interface ImagePart {
	type: "image";
	data: string;
	mimeType: string;
}

type ToolContentPart = TextPart | ImagePart;

interface ToolResult {
	content: ToolContentPart[];
	details?: Record<string, unknown>;
	isError?: boolean;
}

function resolveProjectRoot(cwd: string): string {
	let dir = resolve(cwd);
	for (;;) {
		const dotGit = join(dir, ".git");
		let isDir: boolean | null = null;
		try {
			const stat = lstatSync(dotGit, { throwIfNoEntry: false });
			if (stat) isDir = stat.isDirectory();
		} catch {}
		if (isDir === true) return dir;
		if (isDir === false) {
			const main = worktreeMainRoot(dir, dotGit);
			if (main) return main;
			return cwd;
		}
		const parent = dirname(dir);
		if (parent === dir) return cwd;
		dir = parent;
	}
}

function worktreeMainRoot(dir: string, dotGitFile: string): string | null {
	try {
		const text = readFileSync(dotGitFile, "utf8");
		const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(text);
		if (!pointer) return null;
		const gitDir = resolve(dir, pointer[1]);
		const common = readFileSync(join(gitDir, "commondir"), "utf8").trim();
		if (!common) return null;
		const commonDir = resolve(gitDir, common);
		const norm = commonDir.replace(/\\/g, "/");
		if (!norm.endsWith("/.git")) return null;
		const root = dirname(commonDir);
		return existsSync(root) ? root : null;
	} catch {
		return null;
	}
}

function getLocaleLanguageName(): string {
	const code = (process.env.OMP_STUDIO_LOCALE || Intl.DateTimeFormat().resolvedOptions().locale || "en").toLowerCase();
	try {
		const dn = new Intl.DisplayNames(["en"], { type: "language" });
		const primary = code.split(/[-_]/)[0];
		return dn.of(primary) || (primary === "it" ? "Italian" : "English");
	} catch {
		return code.startsWith("it") ? "Italian" : "English";
	}
}

// Una corsia worktree senza copia propria (file non ancora committato) usa quella del progetto principale.
function resolveRulesFile(cwd: string): string {
	const wtFile = join(cwd, ".omp", "preview.md");
	if (existsSync(wtFile)) return wtFile;
	const mainRoot = process.env.OMP_STUDIO_PROJECT_ROOT || resolveProjectRoot(cwd);
	return join(mainRoot, ".omp", "preview.md");
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

interface StudioExtensionApi {
	zod: ZodBuilder;
	registerTool<TParams>(definition: ToolDefinition<TParams>): void;
}

function textResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details ? { content: [{ type: "text", text }], details } : { content: [{ type: "text", text }] };
}

function errorResult(text: string): ToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

interface DiagramParams {
	title: string;
	mermaid: string;
}

interface PreviewParams {
	title: string;
	code: string;
	name?: string;
	description?: string;
	snapshot?: boolean;
}

export default function studioExtension(pi: StudioExtensionApi) {
	const z = pi.zod;

	// 1. Tool per whiteboard diagrammi Mermaid
	pi.registerTool({
		name: "studio_diagram",
		label: "Studio Diagram",
		description:
			"Render an interactive diagram on the OMP Studio whiteboard instead of printing ASCII art in the terminal. " +
			"Use this whenever the user asks to explain, visualize or evaluate a process, architecture, flow, state machine, " +
			"database schema or plan. Provide Mermaid syntax. Supported: flowchart, sequenceDiagram, classDiagram, " +
			"erDiagram, stateDiagram-v2, gantt, mindmap, timeline. The user sees the rendered diagram next to the editor; " +
			"the terminal only shows a short confirmation.",
		parameters: z.object({
			title: z.string().describe("Short human title shown above the diagram, e.g. 'Auth flow'"),
			mermaid: z.string().describe("Mermaid diagram source, without ``` fences")
		}),
		approval: "read",
		async execute(toolCallId, params: DiagramParams, _signal, _onUpdate, ctx) {
			const title = String(params.title || "Diagram").slice(0, 120);
			const mermaid = String(params.mermaid || "");
			if (!mermaid.trim()) {
				return errorResult("Error: mermaid source is empty");
			}

			let base: string;
			if (process.platform === "win32" && process.env.LOCALAPPDATA) {
				base = `${process.env.LOCALAPPDATA}\\omp-studio\\diagrams`;
			} else if (process.env.HOME) {
				base = join(process.env.HOME, ".omp-studio", "diagrams");
			} else {
				return errorResult("Error: cannot resolve exchange directory");
			}

			try {
				mkdirSync(base, { recursive: true });
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Error creating exchange directory: ${msg}`);
			}

			const rawCwd = ctx?.sessionManager?.getCwd?.() ?? process.cwd();
			const cwd = resolve(rawCwd);
			const sessionId = ctx?.sessionManager?.getSessionId?.() ?? "unknown";
			const slug = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
			const file = join(base, `${slug}.json`);
			const tmpFile = join(base, `.${slug}.json.tmp.${process.pid}.${Date.now()}`);

			const laneId = process.env.OMP_LANE_ID?.trim() || undefined;
			const projectId = process.env.OMP_PROJECT_ID?.trim() || undefined;

			const payload = {
				version: 1,
				id: slug,
				title,
				mermaid,
				cwd,
				session_id: sessionId,
				lane_id: laneId,
				project_id: projectId,
				tool_call_id: toolCallId,
				created_at: new Date().toISOString()
			};
			try {
				writeFileSync(tmpFile, JSON.stringify(payload, null, 2), "utf8");
				try {
					renameSync(tmpFile, file);
				} catch {
					try {
						unlinkSync(file);
					} catch {}
					renameSync(tmpFile, file);
				}
			} catch (err: unknown) {
				try {
					unlinkSync(tmpFile);
				} catch {}
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Error writing diagram exchange file: ${msg}`);
			}

			return textResult(`Diagram "${title}" sent to OMP Studio whiteboard (${basename(file)}).`, {
				studioFile: file
			});
		}
	});

	// Il percorso si risolve al caricamento: Studio crea il file all'attivazione del progetto,
	// quindi puo' comparire dopo l'avvio della sessione; per questo non si dichiara mai assente.
	const rulesFile = resolveRulesFile(process.cwd());
	const localeLang = getLocaleLanguageName();

	// 2. Tool per anteprima live di componenti / prototipi UI
	pi.registerTool({
		name: "studio_preview",
		label: "Studio Preview",
		description:
			"Render a live interactive UI prototype in the OMP Studio preview, instead of only printing code. " +
			"Use it whenever the user asks for a component, card, mockup, table, dialog, dashboard, form, or visual flow. " +
			"The prototype is saved into the project's 'proto/' directory (gitignored) and opened in the Studio preview next to the terminal. Call it again as the user iterates.\n" +
			`- Before the first preview in a session, read the preview design rules at "${rulesFile}" and apply its tokens, fonts, icons, and rules (if the file is missing, use the project's DESIGN.md and PRODUCT.md).\n` +
			"- If those rules define design tokens, write plain HTML/CSS using them; otherwise React + Tailwind + Lucide is allowed.\n" +
			"- When redesigning existing UI, start from the real markup/CSS and show Current vs Proposal side by side or with a switch.\n" +
			`- Realistic demo data in ${localeLang}, never lorem ipsum.\n` +
			"- No decorative gradients, glassmorphism, emoji, colored side borders, or pill buttons unless the rules ask for them.\n" +
			"- Write real characters (\u00e0, \u20ac), never \\uXXXX escapes in JSX/HTML text.\n" +
			"- The tool result reports whether Studio rendered the preview and any JS errors. Do NOT open a browser, start a server, or take screenshots to check it: tell the user what to look at and ask for feedback. Set snapshot: true only when you genuinely need to see the layout.",
		parameters: z.object({
			title: z
				.string()
				.describe("Short human title shown above the preview, e.g. 'Quota Usage Card' or 'Billing Filter Dialog'"),
			code: z.string().describe("Component code: plain HTML/CSS when design tokens exist, or React TSX/JSX prototype"),
			name: z
				.string()
				.optional()
				.describe("Optional file slug name, e.g. 'quota-card'. Defaults to a slug from title."),
			description: z
				.string()
				.optional()
				.describe("Optional short summary of what the component does or interactive parts"),
			snapshot: z
				.boolean()
				.optional()
				.describe("When true, capture and return an image snapshot of the rendered preview. Use only when you genuinely need to see the visual layout.")
		}),
		approval: "write",
		async execute(toolCallId, params: PreviewParams, signal, _onUpdate, ctx) {
			const title = String(params.title || "Prototype").slice(0, 120);
			const code = String(params.code || "");
			if (!code.trim()) {
				return errorResult("Error: prototype code is empty");
			}

			const rawCwd = ctx?.sessionManager?.getCwd?.() ?? process.cwd();
			const cwd = resolve(rawCwd);
			let canonicalCwd: string;
			try {
				canonicalCwd = realpathSync(cwd);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Error resolving project working directory: ${msg}`);
			}

			const sessionId = ctx?.sessionManager?.getSessionId?.() ?? "unknown";

			const rawName = (params.name || title || "").trim();
			const baseCandidate = basename(rawName);
			let slug = baseCandidate
				.toLowerCase()
				.replace(/[^a-z0-9_-]+/g, "-")
				.replace(/^-+|-+$/g, "");
			if (!slug) {
				slug = "prototype";
			}

			// 1. Assicura che 'proto/' sia presente in .gitignore per non sporcare il working tree
			const gitignorePath = join(canonicalCwd, ".gitignore");
			let gitignoreExists = false;
			try {
				const stat = lstatSync(gitignorePath, { throwIfNoEntry: false });
				if (stat) {
					if (stat.isSymbolicLink()) {
						return errorResult("Error: .gitignore is a symbolic link or junction");
					}
					gitignoreExists = true;
				}
			} catch (err: unknown) {
				const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
				if (code !== "ENOENT") {
					const msg = err instanceof Error ? err.message : String(err);
					return errorResult(`Error checking .gitignore: ${msg}`);
				}
			}

			try {
				let gi = "";
				if (gitignoreExists) {
					gi = readFileSync(gitignorePath, "utf8");
				}
				if (!/(^|\n)\s*\/?proto(\/|\/\*\.html)?(\s*|\n|$)/i.test(gi) && !gi.includes('# OMP Studio prototypes')) {
					const prefix = gi && !gi.endsWith("\n") ? "\n" : "";
					const newContent = gi + prefix + "# OMP Studio prototypes\nproto/\n";
					const tmpGitignore = join(canonicalCwd, `.gitignore.tmp.${process.pid}.${Date.now()}`);
					writeFileSync(tmpGitignore, newContent, "utf8");
					try {
						renameSync(tmpGitignore, gitignorePath);
					} catch {
						try {
							unlinkSync(gitignorePath);
						} catch {}
						renameSync(tmpGitignore, gitignorePath);
					}
				}
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Error updating .gitignore: ${msg}`);
			}

			// 2. Assicura che la cartella proto/ esista nel progetto e non sia un symlink/junction
			const protoDir = join(canonicalCwd, "proto");
			try {
				const stat = lstatSync(protoDir, { throwIfNoEntry: false });
				if (stat) {
					if (stat.isSymbolicLink()) {
						return errorResult("Error: proto directory is a symbolic link or junction");
					}
					if (!stat.isDirectory()) {
						return errorResult("Error: proto exists but is not a directory");
					}
				} else {
					mkdirSync(protoDir, { recursive: true });
				}
			} catch (err: unknown) {
				const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
				if (code !== "ENOENT") {
					const msg = err instanceof Error ? err.message : String(err);
					return errorResult(`Error accessing proto directory: ${msg}`);
				}
			}

			let canonicalProtoDir: string;
			try {
				canonicalProtoDir = realpathSync(protoDir);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Error resolving proto directory: ${msg}`);
			}

			if (!isSubpath(canonicalCwd, canonicalProtoDir) || canonicalProtoDir === canonicalCwd) {
				return errorResult("Error: proto directory resolves outside of project root");
			}

			// 3. Verifica il file foglia prima della scrittura e salva in modo atomico
			const targetFile = join(canonicalProtoDir, `${slug}.html`);
			if (!isSubpath(canonicalProtoDir, targetFile)) {
				return errorResult("Error: target prototype path is outside of proto directory");
			}

			try {
				const stat = lstatSync(targetFile, { throwIfNoEntry: false });
				if (stat && stat.isSymbolicLink()) {
					return errorResult("Error: target prototype file is a symbolic link or junction");
				}
			} catch (err: unknown) {
				const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
				if (code !== "ENOENT") {
					const msg = err instanceof Error ? err.message : String(err);
					return errorResult(`Error checking target file: ${msg}`);
				}
			}

			const fullHtml = wrapPrototypeCode(title, code);
			const relPath = `proto/${slug}.html`;
			const tmpTargetFile = join(canonicalProtoDir, `.${slug}.html.tmp.${process.pid}.${Date.now()}`);

			try {
				writeFileSync(tmpTargetFile, fullHtml, "utf8");
				try {
					renameSync(tmpTargetFile, targetFile);
				} catch {
					try {
						unlinkSync(targetFile);
					} catch {}
					renameSync(tmpTargetFile, targetFile);
				}
			} catch (err: unknown) {
				try {
					unlinkSync(tmpTargetFile);
				} catch {}
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Error writing prototype file: ${msg}`);
			}

			// 4. Scrive la notifica per Studio in %LOCALAPPDATA%/omp-studio/previews
			let base: string;
			if (process.platform === "win32" && process.env.LOCALAPPDATA) {
				base = `${process.env.LOCALAPPDATA}\\omp-studio\\previews`;
			} else if (process.env.HOME) {
				base = join(process.env.HOME, ".omp-studio", "previews");
			} else {
				return errorResult("Error: cannot resolve preview exchange directory");
			}

			try {
				mkdirSync(base, { recursive: true });
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Error creating preview exchange directory: ${msg}`);
			}

			const exchangeSlug = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
			const exchangeFile = join(base, `${exchangeSlug}.json`);
			const tmpExchangeFile = join(base, `.${exchangeSlug}.json.tmp.${process.pid}.${Date.now()}`);

			const laneId = process.env.OMP_LANE_ID?.trim() || undefined;
			const projectId = process.env.OMP_PROJECT_ID?.trim() || undefined;

			const payload = {
				version: 1,
				id: exchangeSlug,
				title,
				file_path: relPath,
				cwd: canonicalCwd,
				session_id: sessionId,
				lane_id: laneId,
				project_id: projectId,
				snapshot: Boolean(params.snapshot),
				tool_call_id: toolCallId,
				created_at: new Date().toISOString()
			};
			try {
				writeFileSync(tmpExchangeFile, JSON.stringify(payload, null, 2), "utf8");
				try {
					renameSync(tmpExchangeFile, exchangeFile);
				} catch {
					try {
						unlinkSync(exchangeFile);
					} catch {}
					renameSync(tmpExchangeFile, exchangeFile);
				}
			} catch (err: unknown) {
				try {
					unlinkSync(tmpExchangeFile);
				} catch {}
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Error writing preview exchange file: ${msg}`);
			}

			// 5. Polling del file di ack generato dall'host di rendering di Studio (ANT-009, ANT-010)
			const ackFile = join(base, `${exchangeSlug}.ack.json`);
			const maxWaitMs = params.snapshot ? 15000 : 8000;
			const pollIntervalMs = 150;
			const startTime = Date.now();
			let ackData: {
				version: number;
				id: string;
				ok: boolean;
				errors?: Array<{ message: string; source?: string; line?: number; column?: number }>;
				width?: number;
				height?: number;
				snapshot?: { mimeType: string; data: string };
				snapshotError?: string;
			} | null = null;

			while (Date.now() - startTime < maxWaitMs) {
				if (signal?.aborted) break;
				if (existsSync(ackFile)) {
					try {
						const rawAck = readFileSync(ackFile, "utf8");
						ackData = JSON.parse(rawAck);
						break;
					} catch {}
				}
				try {
					await sleep(pollIntervalMs, undefined, { signal });
				} catch {
					break;
				}
			}

			if (existsSync(ackFile)) {
				try {
					unlinkSync(ackFile);
				} catch {}
			}

			if (!ackData) {
				return textResult(
					`Preview "${title}" saved to ${relPath}, but Studio did not confirm rendering within the timeout (e.g. app busy). Do not verify it in a browser or start a server; ask the user for feedback.`,
					{ filePath: relPath, timeout: true }
				);
			}

			const errors = Array.isArray(ackData.errors) ? ackData.errors : [];
			if (!ackData.ok || errors.length > 0) {
				const errorList = errors.length > 0
					? errors
							.map((e) => {
								const loc = e.line != null ? ` (line ${e.line}${e.column != null ? `:${e.column}` : ""})` : "";
								return `- ${e.message}${loc}`;
							})
							.join("\n")
					: "- Unknown rendering failure";
				const msg = `Preview "${title}" rendered with errors in Studio and saved to ${relPath}:\n${errorList}\nPlease fix the issues and call studio_preview again. Do not open a browser to check it.`;

				const content: ToolContentPart[] = [{ type: "text", text: msg }];
				if (ackData.snapshot?.data) {
					content.push({
						type: "image",
						data: ackData.snapshot.data,
						mimeType: ackData.snapshot.mimeType || "image/png"
					});
				}
				return {
					content,
					isError: true,
					details: { filePath: relPath, errors: ackData.errors }
				};
			}

			const w = Math.round(ackData.width || 0);
			const h = Math.round(ackData.height || 0);
			let okMsg = `Preview "${title}" rendered in Studio (${w}x${h}, no errors) and saved to ${relPath}. It is open for the user in Studio: do not verify it in a browser; tell the user what to look at.`;
			if (ackData.snapshotError) {
				okMsg += ` (Snapshot note: ${ackData.snapshotError})`;
			}
			const content: ToolContentPart[] = [{ type: "text", text: okMsg }];
			if (ackData.snapshot?.data) {
				content.push({
					type: "image",
					data: ackData.snapshot.data,
					mimeType: ackData.snapshot.mimeType || "image/png"
				});
			}
			return {
				content,
				details: {
					filePath: relPath,
					width: ackData.width,
					height: ackData.height,
					hasSnapshot: Boolean(ackData.snapshot?.data)
				}
			};
		}
	});
}
