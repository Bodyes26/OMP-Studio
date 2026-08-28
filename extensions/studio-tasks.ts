// Estensione OMP: Gestione interattiva dei task di progetto per GUI e TUI.
//
// Fornisce:
// 1. Tool agente `project_tasks`:
//    Consente all'agente di consultare, aggiungere, aggiornare, riordinare
//    ed eliminare i task del progetto memorizzati in `.omp/tasks.json`.
// 2. Slash command `/tasks`:
//    Apre un overlay interattivo a tutto schermo nel terminale TUI di OMP
//    con navigazione a frecce, toggle rapido dello stato, aggiunta ed
//    esecuzione immediata nella sessione corrente.

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface TaskOptions {
	role?: string;
	thinkingLevel?: string;
	planMode?: boolean;
	discussionMode?: boolean;
	minimalMode?: boolean;
	researchMode?: boolean;
}

export interface ProjectTask {
	id: string;
	prompt: string;
	position: number;
	status: "queued" | "in_progress" | "completed" | "abandoned";
	createdAt: number;
	updatedAt: number;
	options?: TaskOptions;
}

export interface ProjectTaskPayload {
	version: 1;
	tasks: ProjectTask[];
}

interface StudioTaskConfigCommandContext {
	ui: {
		notify: (message: string, level: "info" | "error") => void;
	};
	models: {
		resolve: (selector: string) => { provider: string; id: string } | undefined;
	};
}

function parseStudioTaskConfig(raw: string): { modelSelector: string; thinkingLevel: string } | null {
	try {
		const parsed: unknown = JSON.parse(decodeURIComponent(raw.trim()));
		if (!parsed || typeof parsed !== "object") return null;
		if (!("modelSelector" in parsed) || typeof parsed.modelSelector !== "string") return null;
		const thinkingLevel =
			"thinkingLevel" in parsed && typeof parsed.thinkingLevel === "string"
				? parsed.thinkingLevel
				: "auto";
		return {
			modelSelector: parsed.modelSelector.trim(),
			thinkingLevel: thinkingLevel.trim() || "auto"
		};
	} catch {
		return null;
	}
}

/**
 * Assicura che la directory `.omp` esista e che `.omp/.gitignore` escluda `tasks.json`.
 */
export function ensureProjectOmpDir(cwd: string): string {
	const ompDir = join(cwd, ".omp");
	try {
		mkdirSync(ompDir, { recursive: true });
	} catch {
		// ignora se già esistente
	}

	const gitignorePath = join(ompDir, ".gitignore");
	let needsIgnore = true;
	try {
		const existing = readFileSync(gitignorePath, "utf8");
		if (existing.split(/\r?\n/).some((line) => {
			const t = line.trim();
			return t === "tasks.json" || t === "/tasks.json" || t === "*";
		})) {
			needsIgnore = false;
		}
	} catch {
		needsIgnore = true;
	}

	if (needsIgnore) {
		try {
			const entry = "\n# OMP Studio: task locali non versionati\ntasks.json\ntasks.json.tmp*\n";
			writeFileSync(gitignorePath, entry, { flag: "a", encoding: "utf8" });
		} catch {
			// ignora errori di scrittura gitignore
		}
	}

	return ompDir;
}

/**
 * Legge e valida i task da `.omp/tasks.json`.
 */
export function loadProjectTasks(cwd: string): ProjectTask[] {
	const filePath = join(cwd, ".omp", "tasks.json");
	try {
		const raw = readFileSync(filePath, "utf8");
		if (!raw.trim()) return [];
		const parsed = JSON.parse(raw);
		const list: unknown[] = Array.isArray(parsed)
			? parsed
			: parsed && typeof parsed === "object" && Array.isArray(parsed.tasks)
				? parsed.tasks
				: [];

		return list
			.filter((t): t is ProjectTask => {
				if (!t || typeof t !== "object") return false;
				const cand = t as Record<string, unknown>;
				return (
					typeof cand.id === "string" &&
					typeof cand.prompt === "string" &&
					typeof cand.position === "number"
				);
			})
			.map((t, idx) => ({
				id: t.id,
				prompt: t.prompt,
				position: typeof t.position === "number" ? t.position : idx,
				status: (["queued", "in_progress", "completed", "abandoned"].includes(t.status)
					? t.status
					: "queued") as ProjectTask["status"],
				createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
				updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
				options: t.options && typeof t.options === "object" ? t.options : undefined
			}))
			.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
	} catch {
		return [];
	}
}

/**
 * Salva i task in `.omp/tasks.json` in modo atomico.
 */
export function saveProjectTasks(cwd: string, tasks: ProjectTask[]): void {
	const ompDir = ensureProjectOmpDir(cwd);
	const targetPath = join(ompDir, "tasks.json");
	const tempPath = join(ompDir, `tasks.json.tmp.${process.pid}.${Date.now()}`);

	const payload: ProjectTaskPayload = {
		version: 1,
		tasks: tasks.map((t, idx) => ({
			...t,
			position: idx
		}))
	};

	const content = JSON.stringify(payload, null, 2);
	writeFileSync(tempPath, content, "utf8");

	try {
		renameSync(tempPath, targetPath);
	} catch {
		// Fallback per file bloccati su Windows
		try {
			unlinkSync(targetPath);
		} catch {
			// ignora
		}
		renameSync(tempPath, targetPath);
	}
}

/**
 * Tronca una stringa alla larghezza massima specificata.
 */
function fitWidth(str: string, max: number): string {
	if (str.length <= max) return str;
	return str.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * Componente TUI per l'interfaccia interattiva `/tasks`.
 */
class TasksTuiOverlay {
	private tui: any;
	private theme: any;
	private keybindings: any;
	private done: (value: void) => void;
	private cwd: string;
	private pi: any;
	private tasks: ProjectTask[] = [];
	private selectedIndex = 0;
	private isAdding = false;
	private newPromptBuffer = "";
	private statusMessage = "";

	constructor(tui: any, theme: any, keybindings: any, done: (value: void) => void, cwd: string, pi: any) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.done = done;
		this.cwd = cwd;
		this.pi = pi;
		this.refreshTasks();
	}

	private refreshTasks() {
		this.tasks = loadProjectTasks(this.cwd);
		if (this.selectedIndex >= this.tasks.length && this.tasks.length > 0) {
			this.selectedIndex = this.tasks.length - 1;
		}
	}

	private saveAndRefresh() {
		saveProjectTasks(this.cwd, this.tasks);
		this.refreshTasks();
		this.tui?.requestRender?.();
	}

	render(width: number): readonly string[] {
		const lines: string[] = [];
		const c = this.theme;

		// Intestazione
		const total = this.tasks.length;
		const completed = this.tasks.filter((t) => t.status === "completed").length;
		const inProgress = this.tasks.filter((t) => t.status === "in_progress").length;

		lines.push(c.fg("accent", "━".repeat(width)));
		const title = ` TASK DI PROGETTO (.omp/tasks.json) — [${completed}/${total} completati${inProgress > 0 ? `, ${inProgress} in corso` : ""}] `;
		const pad = Math.max(0, Math.floor((width - title.length) / 2));
		lines.push(" ".repeat(pad) + c.bold(title));
		lines.push(c.fg("accent", "━".repeat(width)));
		lines.push("");

		if (this.isAdding) {
			lines.push(c.fg("accent", " [NUOVO TASK] Scrivi il prompt e premi INVIO (ESC per annullare):"));
			lines.push(` > ${this.newPromptBuffer}█`);
			lines.push("");
		} else if (this.tasks.length === 0) {
			lines.push(c.fg("muted", "  Nessun task presente in coda per questo progetto."));
			lines.push(c.fg("muted", "  Premi [A] per aggiungere il primo task."));
			lines.push("");
		} else {
			const maxVisible = 18;
			let startIdx = 0;
			if (this.selectedIndex >= maxVisible) {
				startIdx = this.selectedIndex - maxVisible + 1;
			}
			const endIdx = Math.min(this.tasks.length, startIdx + maxVisible);

			for (let i = startIdx; i < endIdx; i++) {
				const task = this.tasks[i];
				const isSelected = i === this.selectedIndex;

				let glyph = "○";
				let glyphColor = "muted";
				if (task.status === "in_progress") {
					glyph = "●";
					glyphColor = "accent";
				} else if (task.status === "completed") {
					glyph = "✓";
					glyphColor = "success";
				} else if (task.status === "abandoned") {
					glyph = "✕";
					glyphColor = "muted";
				}

				const prefix = isSelected ? c.fg("accent", "► ") : "  ";
				const num = c.fg("muted", `#${i + 1} `);
				const glyphStr = c.fg(glyphColor, glyph) + " ";

				// Dettagli opzioni speciali (ruolo, thinking)
				const optBadges: string[] = [];
				if (task.options?.role && task.options.role !== "default") {
					optBadges.push(`[${task.options.role}]`);
				}
				if (task.options?.planMode) optBadges.push("[plan]");
				if (task.options?.discussionMode) optBadges.push("[discuss]");
				if (task.options?.minimalMode) optBadges.push("[ponytail]");
				const badgeStr = optBadges.length > 0 ? " " + c.fg("accent", optBadges.join(" ")) : "";

				const firstLine = task.prompt.split(/\r?\n/).find((l) => l.trim())?.trim() || "(prompt vuoto)";
				const availWidth = Math.max(10, width - 20 - optBadges.join(" ").length);
				let text = fitWidth(firstLine, availWidth);

				if (task.status === "completed" || task.status === "abandoned") {
					text = c.fg("muted", text);
				} else if (isSelected) {
					text = c.bold(text);
				}

				lines.push(`${prefix}${num}${glyphStr}${text}${badgeStr}`);
			}
			lines.push("");
		}

		// Barra comandi / Footer
		if (this.statusMessage) {
			lines.push(c.fg("accent", ` ${this.statusMessage}`));
		}
		lines.push(c.fg("muted", " [↑/↓ o j/k] Seleziona • [Spazio] Cambia stato • [A] Aggiungi • [D] Elimina"));
		lines.push(c.fg("muted", " [J/K o Alt+↑/↓] Riordina • [Invio] Avvia subito • [Esc/Q] Chiudi"));
		lines.push(c.fg("accent", "━".repeat(width)));

		return lines.map((l) => (l.length > width ? fitWidth(l, width) : l));
	}

	handleInput(data: string): void {
		// Modalità inserimento nuovo prompt
		if (this.isAdding) {
			if (data === "\x1b") {
				// Annulla aggiunta
				this.isAdding = false;
				this.newPromptBuffer = "";
				this.tui?.requestRender?.();
				return;
			}
			if (data === "\r" || data === "\n") {
				// Salva nuovo task
				const prompt = this.newPromptBuffer.trim();
				if (prompt) {
					const newTask: ProjectTask = {
						id: randomUUID(),
						prompt,
						position: this.tasks.length,
						status: "queued",
						createdAt: Date.now(),
						updatedAt: Date.now()
					};
					this.tasks.push(newTask);
					this.selectedIndex = this.tasks.length - 1;
					this.statusMessage = "Task aggiunto con successo!";
					this.saveAndRefresh();
				}
				this.isAdding = false;
				this.newPromptBuffer = "";
				return;
			}
			if (data === "\x7f" || data === "\x08") {
				// Backspace
				this.newPromptBuffer = this.newPromptBuffer.slice(0, -1);
				this.tui?.requestRender?.();
				return;
			}
			// Accetta caratteri stampabili
			if (data.length === 1 && data >= " ") {
				this.newPromptBuffer += data;
				this.tui?.requestRender?.();
				return;
			}
			return;
		}

		// Modalità normale di navigazione
		this.statusMessage = "";

		// Chiusura overlay
		if (data === "\x1b" || data === "q" || data === "Q" || this.keybindings.matches(data, "app.interrupt")) {
			this.done();
			return;
		}

		// Navigazione frecce o j/k
		if (data === "\x1b[A" || data === "k") {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.tui?.requestRender?.();
			}
			return;
		}
		if (data === "\x1b[B" || data === "j") {
			if (this.selectedIndex < this.tasks.length - 1) {
				this.selectedIndex++;
				this.tui?.requestRender?.();
			}
			return;
		}

		// Spazio: cicla lo stato
		if (data === " ") {
			const current = this.tasks[this.selectedIndex];
			if (current) {
				const nextStatus: Record<ProjectTask["status"], ProjectTask["status"]> = {
					queued: "in_progress",
					in_progress: "completed",
					completed: "queued",
					abandoned: "queued"
				};
				current.status = nextStatus[current.status] || "queued";
				current.updatedAt = Date.now();
				this.statusMessage = `Stato aggiornato a: ${current.status}`;
				this.saveAndRefresh();
			}
			return;
		}

		// A: nuovo task
		if (data === "a" || data === "A") {
			this.isAdding = true;
			this.newPromptBuffer = "";
			this.tui?.requestRender?.();
			return;
		}

		// D: elimina task
		if (data === "d" || data === "D") {
			if (this.tasks.length > 0 && this.tasks[this.selectedIndex]) {
				const removed = this.tasks.splice(this.selectedIndex, 1)[0];
				if (this.selectedIndex >= this.tasks.length && this.selectedIndex > 0) {
					this.selectedIndex = this.tasks.length - 1;
				}
				this.statusMessage = `Task #${this.selectedIndex + 1} eliminato`;
				this.saveAndRefresh();
			}
			return;
		}

		// Riordino con J/K o Alt+Freccia
		if (data === "K" || data === "\x1b[1;3A" || data === "\x1b\x1b[A") {
			// Sposta su
			if (this.selectedIndex > 0) {
				const [moved] = this.tasks.splice(this.selectedIndex, 1);
				this.selectedIndex--;
				this.tasks.splice(this.selectedIndex, 0, moved);
				this.saveAndRefresh();
			}
			return;
		}
		if (data === "J" || data === "\x1b[1;3B" || data === "\x1b\x1b[B") {
			// Sposta giù
			if (this.selectedIndex < this.tasks.length - 1) {
				const [moved] = this.tasks.splice(this.selectedIndex, 1);
				this.selectedIndex++;
				this.tasks.splice(this.selectedIndex, 0, moved);
				this.saveAndRefresh();
			}
			return;
		}

		// Invio: avvia subito il task nella sessione corrente
		if (data === "\r" || data === "\n") {
			const task = this.tasks[this.selectedIndex];
			if (task) {
				task.status = "in_progress";
				task.updatedAt = Date.now();
				saveProjectTasks(this.cwd, this.tasks);

				// Invia il prompt a OMP
				try {
					if (typeof this.pi?.sendMessage === "function") {
						this.pi.sendMessage(task.prompt, { triggerTurn: true });
					}
				} catch (err) {
					console.error("Errore invio prompt da TUI /tasks:", err);
				}

				this.done();
			}
			return;
		}
	}

	dispose(): void {
		// Nessun timer da distruggere
	}
}

/**
 * Entrypoint dell'estensione OMP.
 */
export default function studioTasksExtension(pi: any): void {
	const Type = pi.typebox;

	// 1. Registrazione del Tool `project_tasks` per l'Agente
	pi.registerTool({
		name: "project_tasks",
		label: "Project Tasks",
		description:
			"Manage and track persistent project tasks in '.omp/tasks.json'. " +
			"Use this tool to view the project queue, add new tasks discovered during planning/execution, " +
			"update task status (queued, in_progress, completed, abandoned), reorder, or delete tasks. " +
			"Changes are automatically saved to disk and synchronized with OMP Studio GUI and TUI in real time.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("list"),
				Type.Literal("add"),
				Type.Literal("update"),
				Type.Literal("delete"),
				Type.Literal("reorder"),
				Type.Literal("get")
			], { description: "The action to perform on the project tasks." }),
			taskId: Type.Optional(Type.String({ description: "Unique task ID (required for update, delete, get, reorder)." })),
			prompt: Type.Optional(Type.String({ description: "Prompt or description of the task." })),
			status: Type.Optional(Type.Union([
				Type.Literal("queued"),
				Type.Literal("in_progress"),
				Type.Literal("completed"),
				Type.Literal("abandoned")
			], { description: "Current execution status of the task." })),
			role: Type.Optional(Type.String({ description: "Optional role assignment (e.g. 'plan', 'smol', 'slow')." })),
			thinkingLevel: Type.Optional(Type.String({ description: "Optional reasoning level (e.g. 'auto', 'low', 'high')." })),
			planMode: Type.Optional(Type.Boolean({ description: "Enable plan mode directive (/plan)." })),
			discussionMode: Type.Optional(Type.Boolean({ description: "Enable discussion mode directive (/grill-me)." })),
			minimalMode: Type.Optional(Type.Boolean({ description: "Enable minimal mode directive (/ponytail)." })),
			researchMode: Type.Optional(Type.Boolean({ description: "Enable online research mode." })),
			targetPosition: Type.Optional(Type.Number({ description: "Target index position for reordering." }))
		}),
		approval: "read",
		async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
			const cwd = ctx?.sessionManager?.getCwd?.() ?? process.cwd();
			const tasks = loadProjectTasks(cwd);
			const action = String(params.action || "list");

			switch (action) {
				case "list": {
					const total = tasks.length;
					const completed = tasks.filter((t) => t.status === "completed").length;
					const inProgress = tasks.filter((t) => t.status === "in_progress").length;
					const queued = tasks.filter((t) => t.status === "queued").length;

					return {
						output: `Project tasks (${total} total: ${completed} completed, ${inProgress} in progress, ${queued} queued):\n` +
							tasks.map((t, idx) => `[${idx}] [${t.status}] ${t.id}: ${t.prompt.split("\n")[0]}`).join("\n"),
						details: { tasks, total, completed, inProgress, queued }
					};
				}

				case "get": {
					const id = String(params.taskId || "");
					const found = tasks.find((t) => t.id === id);
					if (!found) {
						return { output: `Error: Task with ID '${id}' not found.`, isError: true };
					}
					return {
						output: `Task ${found.id}:\nStatus: ${found.status}\nPrompt: ${found.prompt}\nOptions: ${JSON.stringify(found.options || {})}`,
						details: { task: found }
					};
				}

				case "add": {
					const prompt = String(params.prompt || "").trim();
					if (!prompt) {
						return { output: "Error: Prompt cannot be empty for adding a task.", isError: true };
					}
					const options: TaskOptions = {};
					if (params.role) options.role = String(params.role);
					if (params.thinkingLevel) options.thinkingLevel = String(params.thinkingLevel);
					if (params.planMode) options.planMode = true;
					if (params.discussionMode) options.discussionMode = true;
					if (params.minimalMode) options.minimalMode = true;
					if (params.researchMode) options.researchMode = true;

					const newTask: ProjectTask = {
						id: randomUUID(),
						prompt,
						position: tasks.length,
						status: params.status || "queued",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						options: Object.keys(options).length > 0 ? options : undefined
					};

					tasks.push(newTask);
					saveProjectTasks(cwd, tasks);

					return {
						output: `Task created successfully (ID: ${newTask.id}, position: ${newTask.position}).`,
						details: { task: newTask }
					};
				}

				case "update": {
					const id = String(params.taskId || "");
					const task = tasks.find((t) => t.id === id);
					if (!task) {
						return { output: `Error: Task with ID '${id}' not found.`, isError: true };
					}

					if (params.prompt !== undefined) task.prompt = String(params.prompt);
					if (params.status !== undefined) task.status = params.status;
					if (task.options || params.role || params.thinkingLevel || params.planMode || params.discussionMode || params.minimalMode || params.researchMode) {
						task.options = task.options || {};
						if (params.role !== undefined) task.options.role = String(params.role);
						if (params.thinkingLevel !== undefined) task.options.thinkingLevel = String(params.thinkingLevel);
						if (params.planMode !== undefined) task.options.planMode = Boolean(params.planMode);
						if (params.discussionMode !== undefined) task.options.discussionMode = Boolean(params.discussionMode);
						if (params.minimalMode !== undefined) task.options.minimalMode = Boolean(params.minimalMode);
						if (params.researchMode !== undefined) task.options.researchMode = Boolean(params.researchMode);
					}
					task.updatedAt = Date.now();
					saveProjectTasks(cwd, tasks);

					return {
						output: `Task '${id}' updated successfully (status: ${task.status}).`,
						details: { task }
					};
				}

				case "delete": {
					const id = String(params.taskId || "");
					const idx = tasks.findIndex((t) => t.id === id);
					if (idx === -1) {
						return { output: `Error: Task with ID '${id}' not found.`, isError: true };
					}
					const [removed] = tasks.splice(idx, 1);
					saveProjectTasks(cwd, tasks);

					return {
						output: `Task '${id}' deleted successfully.`,
						details: { deletedTaskId: id, promptExcerpt: removed.prompt.slice(0, 50) }
					};
				}

				case "reorder": {
					const id = String(params.taskId || "");
					const targetPos = typeof params.targetPosition === "number" ? params.targetPosition : -1;
					const idx = tasks.findIndex((t) => t.id === id);
					if (idx === -1) {
						return { output: `Error: Task with ID '${id}' not found.`, isError: true };
					}
					if (targetPos < 0 || targetPos >= tasks.length) {
						return { output: `Error: Target position ${targetPos} out of bounds (0-${tasks.length - 1}).`, isError: true };
					}

					const [moved] = tasks.splice(idx, 1);
					tasks.splice(targetPos, 0, moved);
					saveProjectTasks(cwd, tasks);

					return {
						output: `Task '${id}' moved from position ${idx} to ${targetPos}.`,
						details: { taskId: id, from: idx, to: targetPos }
					};
				}

				default:
					return { output: `Error: Unknown action '${action}'.`, isError: true };
			}
		}
	});

	// Comando interno usato dal composer di Studio prima di inviare un task
	// alla TUI. Passa da ExtensionAPI invece di pilotare menu e scorciatoie,
	// che l'utente puo' rimappare e che cambiano tra versioni di omp.
	pi.registerCommand("studio-task-config", {
		description: "Applica modello e thinking a un task avviato da OMP Studio",
		handler: async (args: string, ctx: StudioTaskConfigCommandContext) => {
			const config = parseStudioTaskConfig(args);
			if (!config) {
				ctx.ui.notify("Configurazione task non valida", "error");
				return;
			}

			const { modelSelector, thinkingLevel } = config;
			const model = ctx.models.resolve(modelSelector);
			if (!model) {
				ctx.ui.notify(`Modello task non disponibile: ${modelSelector}`, "error");
				return;
			}

			const applied = await pi.setModel(model);
			if (!applied) {
				ctx.ui.notify(`Credenziali non disponibili per ${modelSelector}`, "error");
				return;
			}
			if (thinkingLevel !== "auto") {
				pi.setThinkingLevel(thinkingLevel);
			}
			ctx.ui.notify(
				`Task: ${model.provider}/${model.id} · thinking ${thinkingLevel}`,
				"info"
			);
		}
	});

	// 2. Registrazione dello Slash Command `/tasks` per TUI
	pi.registerCommand("tasks", {
		description: "Apri il gestore interattivo dei task del progetto (.omp/tasks.json)",
		handler: async (_args: string, ctx: any) => {
			const cwd = ctx?.sessionManager?.getCwd?.() ?? process.cwd();

			if (!ctx.hasUI) {
				// Modalità non interattiva: stampa sommario testuale
				const tasks = loadProjectTasks(cwd);
				if (tasks.length === 0) {
					ctx.ui.notify("Nessun task in coda in .omp/tasks.json", "info");
					return;
				}
				const summary = tasks.map((t, idx) => `[${idx + 1}] [${t.status}] ${t.prompt.split("\n")[0]}`).join("\n");
				ctx.ui.notify(`Task di progetto:\n${summary}`, "info");
				return;
			}

			// Modalità interattiva TUI a tutto schermo
			await ctx.ui.custom((tui: any, theme: any, keybindings: any, done: (value: void) => void) => {
				return new TasksTuiOverlay(tui, theme, keybindings, done, cwd, pi);
			}, { overlay: true });
		}
	});
}
