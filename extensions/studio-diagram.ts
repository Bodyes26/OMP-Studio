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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

function wrapPrototypeCode(title: string, code: string): string {
	const raw = code.trim();
	if (raw.startsWith("<!DOCTYPE") || raw.startsWith("<html") || (raw.includes("<head") && raw.includes("<body"))) {
		return code;
	}

	let cleanedCode = code
		.replace(/^import\s+.*?;\s*$/gm, "")
		.replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?\s*$/gm, "")
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
	}

	return `<!DOCTYPE html>
<html lang="it" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
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
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
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

  <script type="text/babel" data-presets="react,typescript">
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
          const [tag, attrs, children] = iconDef;
          const svgAttrs = {
            ...attrs,
            width: size,
            height: size,
            className: "inline-block align-middle " + className,
            ...rest
          };
          return React.createElement(
            'svg',
            svgAttrs,
            (children || []).map(([cTag, cAttrs], i) => React.createElement(cTag, { ...cAttrs, key: i }))
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
}

interface ToolContext {
	sessionManager?: {
		getCwd?: () => string;
		getSessionId?: () => string;
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

			mkdirSync(base, { recursive: true });

			const cwd = ctx?.sessionManager?.getCwd?.() ?? process.cwd();
			const sessionId = ctx?.sessionManager?.getSessionId?.() ?? "unknown";
			const slug = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
			const file = join(base, `${slug}.json`);

			const payload = {
				version: 1,
				id: slug,
				title,
				mermaid,
				cwd,
				session_id: sessionId,
				tool_call_id: toolCallId,
				created_at: new Date().toISOString()
			};
			writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");

			return textResult(`Diagram "${title}" sent to OMP Studio whiteboard (${basename(file)}).`, {
				studioFile: file
			});
		}
	});

	// 2. Tool per anteprima live di componenti / prototipi UI (vibecoding)
	pi.registerTool({
		name: "studio_preview",
		label: "Studio Preview",
		description:
			"Render a live interactive UI component prototype in the OMP Studio sandbox instead of only printing code. " +
			"Use this whenever the user asks for a component, card, mockup, table, dialog, dashboard, form, or visual flow (vibecoding). " +
			"Provide modern React + Tailwind CSS + Lucide component code (TSX/JSX or full HTML). " +
			"Interactive state (useState), animations, and responsive layout are fully supported. " +
			"The prototype is automatically saved into the project's 'proto/' directory (added to .gitignore so it never litters git) " +
			"and opened immediately in the Studio preview window next to the terminal. Call this repeatedly as the user iterates.",
		parameters: z.object({
			title: z
				.string()
				.describe("Short human title shown above the preview, e.g. 'Quota Usage Card' or 'Billing Filter Dialog'"),
			code: z.string().describe("React TSX/JSX component code or full HTML prototype"),
			name: z
				.string()
				.optional()
				.describe("Optional file slug name, e.g. 'quota-card'. Defaults to a slug from title."),
			description: z
				.string()
				.optional()
				.describe("Optional short summary of what the component does or interactive parts")
		}),
		approval: "read",
		async execute(toolCallId, params: PreviewParams, _signal, _onUpdate, ctx) {
			const title = String(params.title || "Prototype").slice(0, 120);
			const code = String(params.code || "");
			if (!code.trim()) {
				return errorResult("Error: prototype code is empty");
			}

			const cwd = ctx?.sessionManager?.getCwd?.() ?? process.cwd();
			const sessionId = ctx?.sessionManager?.getSessionId?.() ?? "unknown";

			const slug = (params.name || title)
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/(^-|-$)/g, "") || "prototype";

			// 1. Assicura che la cartella proto/ esista nel progetto
			const protoDir = join(cwd, "proto");
			try {
				mkdirSync(protoDir, { recursive: true });
			} catch (e) {
				// Se non possiamo creare la cartella nel progetto, continuiamo comunque con la sandbox
			}

			// 2. Assicura che 'proto/' sia presente in .gitignore per non sporcare il working tree
			const gitignorePath = join(cwd, ".gitignore");
			try {
				let gi = "";
				try {
					gi = readFileSync(gitignorePath, "utf8");
				} catch {}
				if (!/(^|\n)\s*\/?proto\/?(\s*|\n|$)/i.test(gi)) {
					const prefix = gi && !gi.endsWith("\n") ? "\n" : "";
					writeFileSync(gitignorePath, gi + prefix + "# OMP Studio prototypes\nproto/\n", "utf8");
				}
			} catch {}

			// 3. Salva il file HTML autonomo in proto/<slug>.html
			const fullHtml = wrapPrototypeCode(title, code);
			const relPath = `proto/${slug}.html`;
			const targetFile = join(cwd, "proto", `${slug}.html`);
			try {
				writeFileSync(targetFile, fullHtml, "utf8");
			} catch {}

			// 4. Scrive la notifica per Studio in %LOCALAPPDATA%/omp-studio/previews
			let base: string;
			if (process.platform === "win32" && process.env.LOCALAPPDATA) {
				base = `${process.env.LOCALAPPDATA}\\omp-studio\\previews`;
			} else if (process.env.HOME) {
				base = join(process.env.HOME, ".omp-studio", "previews");
			} else {
				return textResult(`Prototype "${title}" saved to ${relPath}.`, { filePath: relPath });
			}

			mkdirSync(base, { recursive: true });
			const exchangeSlug = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
			const exchangeFile = join(base, `${exchangeSlug}.json`);

			const payload = {
				version: 1,
				id: exchangeSlug,
				title,
				file_path: relPath,
				cwd,
				session_id: sessionId,
				tool_call_id: toolCallId,
				created_at: new Date().toISOString()
			};
			writeFileSync(exchangeFile, JSON.stringify(payload, null, 2), "utf8");

			return textResult(
				`Prototype "${title}" rendered live in OMP Studio preview sandbox and saved to ${relPath}.`,
				{ filePath: relPath, studioFile: exchangeFile }
			);
		}
	});
}
