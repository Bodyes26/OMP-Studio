// Estensione omp <-> OMP Studio: tool "studio_diagram".
//
// L'agente lo usa al posto di disegnare diagrammi ASCII nel terminale:
// il sorgente Mermaid viene scritto in una cartella scambiata con Studio
// (%LOCALAPPDATA%/omp-studio/diagrams) e la GUI lo renderizza come
// whiteboard interattiva nella colonna centrale.
//
// Caricamento: Studio lancia omp con `-e <percorso di questo file>` (overlay
// --config gia' presente). Nessuna scrittura in ~/.omp: la cartella e' di
// Studio e cancellarla riporta tutto com'era (contratto PRODUCT.md §8).
//
// API verificate sul binario omp 17.x:
// - pi.registerTool({ name, label, description, parameters, approval, execute })
//   con schema TypeBox esposto come pi.typebox (alias P nel binario).
// - execute(toolCallId, params, signal?, onUpdate?, ctx?) -> { output, details? }
// - ctx.sessionManager.getCwd() / getSessionId() disponibili nel ctx dei tool.

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export default function studioDiagramExtension(pi) {
	const Type = pi.typebox;

	pi.registerTool({
		name: "studio_diagram",
		label: "Studio Diagram",
		description:
			"Render an interactive diagram on the OMP Studio whiteboard instead of printing ASCII art in the terminal. " +
			"Use this whenever the user asks to explain, visualize or evaluate a process, architecture, flow, state machine, " +
			"database schema or plan. Provide Mermaid syntax. Supported: flowchart, sequenceDiagram, classDiagram, " +
			"erDiagram, stateDiagram-v2, gantt, mindmap, timeline. The user sees the rendered diagram next to the editor; " +
			"the terminal only shows a short confirmation.",
		parameters: Type.Object({
			title: Type.String({
				description: "Short human title shown above the diagram, e.g. 'Auth flow'"
			}),
			mermaid: Type.String({
				description: "Mermaid diagram source, without ``` fences"
			})
		}),
		approval: "read",
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			const title = String(params.title || "Diagram").slice(0, 120);
			const mermaid = String(params.mermaid || "");
			if (!mermaid.trim()) {
				return { output: "Error: mermaid source is empty", isError: true };
			}

			// Cartella di scambio: %LOCALAPPDATA%/omp-studio/diagrams. Su altri
			// OS si ripiega su ~/.omp-studio/diagrams (l'app non esiste li', ma
			// l'estensione resta innocua).
			let base;
			if (process.platform === "win32" && process.env.LOCALAPPDATA) {
				base = `${process.env.LOCALAPPDATA}\\omp-studio\\diagrams`;
			} else if (process.env.HOME) {
				base = join(process.env.HOME, ".omp-studio", "diagrams");
			} else {
				return { output: "Error: cannot resolve exchange directory", isError: true };
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

			return {
				output: `Diagram "${title}" sent to OMP Studio whiteboard (${basename(file)}).`,
				details: { studioFile: file }
			};
		}
	});
}
