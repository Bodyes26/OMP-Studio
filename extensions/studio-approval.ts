// Estensione ponte omp <-> OMP Studio: gate di approvazione strutturato.
//
// Perche' esiste. Il gate nativo di omp chiede l'approvazione con una select
// il cui titolo e' il prompt intero, testo libero: una card decente non puo'
// nascere parsando quel testo. L'evento RPC `tool_approval_requested` porta
// solo `toolName`/`toolCallId`/`reason`, senza gli argomenti della chiamata.
// Questo hook intercetta `tool_call` (che invece porta `input` completo) e
// chiede con una select il cui titolo e' JSON: Studio lo riconosce dalla
// sentinella, lo parsa e rende comando, diff o percorso con la primitiva
// giusta.
//
// Caricamento: solo nel percorso GUI (`--mode rpc-ui`), passata con `-e`.
// Nella TUI produrrebbe titoli di select con la sentinella grezza dentro,
// quindi `pty/mod.rs` NON la passa.
//
// L'overlay GUI mette `tools.approvalMode: yolo`: senza, ci sarebbero due
// prompt per ogni chiamata (questo e quello nativo). Conseguenza dichiarata
// nell'interfaccia: gli override argomento-dipendenti di omp non scattano,
// per questo la policy di default e' `ask-writes`, che mette `bash` ed
// `eval` dietro una card.
//
// Policy: %LOCALAPPDATA%/omp-studio/approval.json (Windows) oppure
// ~/.omp-studio/approval.json. Mai dentro ~/.omp (contratto PRODUCT.md §8).

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Sentinella: distingue le nostre select da quelle di omp. NUL non compare
// mai in un titolo generato da omp.
const SENTINEL = "\u0000studio-approval\u0000";

type ApprovalMode = "yolo" | "ask-writes" | "ask-all";

interface Policy {
	mode: ApprovalMode;
	allow: string[];
	deny: string[];
}

/** Sottoinsieme di `HookAPI` usato qui: l'API completa vive in omp. */
interface HookApi {
	on(
		event: "tool_call",
		handler: (event: ToolCallEvent, ctx: HookContext) => Promise<ToolCallDecision>
	): void;
}

interface ToolCallEvent {
	toolName?: string;
	toolCallId?: string;
	input?: Record<string, unknown>;
}

interface HookContext {
	hasUI?: boolean;
	ui: { select(title: string, options: string[]): Promise<string | undefined> };
}

type ToolCallDecision = { block: true; reason: string } | undefined;

// Con `ask-writes` si chiede per i tool che toccano il mondo fuori dalla
// sessione: filesystem, shell, processi, rete in scrittura.
const WRITE_TOOLS: Record<string, true> = {
	write: true,
	edit: true,
	ast_edit: true,
	bash: true,
	eval: true,
	browser: true,
	computer: true,
	debug: true,
	task: true,
	manage_skill: true,
	security_scan: true,
	generate_image: true,
	github: true,
	tts: true,
};

// Con `ask-all` si chiede per tutto tranne la lettura e il lavoro interno
// alla sessione: chiedere per `read` renderebbe la modalita' inusabile.
const ALWAYS_ALLOWED: Record<string, true> = {
	read: true,
	grep: true,
	glob: true,
	ast_grep: true,
	todo: true,
	ask: true,
	recall: true,
	reflect: true,
	web_search: true,
	inspect_image: true,
};

const DEFAULT_POLICY: Policy = { mode: "ask-writes", allow: [], deny: [] };

let cachedPolicy: Policy = DEFAULT_POLICY;
let cachedMtime = -1;
let cachedPath: string | null = null;

/** Filtra una lista che arriva da JSON esterno: tutto cio' che non e' stringa cade. */
function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

// Rilettura solo quando mtime cambia: l'hook gira prima di ogni tool call e
// una lettura di file per chiamata sarebbe uno spreco misurabile.
function readPolicy(): Policy {
	if (cachedPath === null) {
		const base = process.platform === "win32" ? process.env.LOCALAPPDATA : process.env.HOME;
		cachedPath = base ? join(base, process.platform === "win32" ? "omp-studio" : ".omp-studio", "approval.json") : "";
	}
	if (!cachedPath) return DEFAULT_POLICY;

	let mtime: number;
	try {
		mtime = statSync(cachedPath).mtimeMs;
	} catch {
		// File assente: default dichiarato, e nessun tentativo di scriverlo.
		cachedMtime = -1;
		cachedPolicy = DEFAULT_POLICY;
		return cachedPolicy;
	}
	if (mtime === cachedMtime) return cachedPolicy;
	cachedMtime = mtime;

	try {
		const parsed: unknown = JSON.parse(readFileSync(cachedPath, "utf8"));
		const raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
		const mode = raw.mode;
		cachedPolicy = {
			mode: mode === "yolo" || mode === "ask-all" || mode === "ask-writes" ? mode : DEFAULT_POLICY.mode,
			allow: stringList(raw.allow),
			deny: stringList(raw.deny),
		};
	} catch {
		// JSON rotto: non e' il momento di indovinare. Si torna al default,
		// che chiede invece di eseguire.
		cachedPolicy = DEFAULT_POLICY;
	}
	return cachedPolicy;
}

export default function studioApproval(pi: HookApi): void {
	pi.on("tool_call", async (event, ctx) => {
		const toolName = typeof event.toolName === "string" ? event.toolName : "";
		if (!toolName) return;

		const policy = readPolicy();
		if (policy.deny.includes(toolName)) {
			return { block: true, reason: `Tool "${toolName}" negato dalla policy di OMP Studio` };
		}
		if (policy.mode === "yolo") return;
		if (policy.allow.includes(toolName)) return;

		const gated = policy.mode === "ask-all" ? ALWAYS_ALLOWED[toolName] !== true : WRITE_TOOLS[toolName] === true;
		if (!gated) return;

		if (ctx.hasUI !== true) {
			return { block: true, reason: "Approvazione richiesta ma nessuna UI disponibile" };
		}

		const payload =
			SENTINEL +
			JSON.stringify({
				v: 1,
				tool: toolName,
				toolCallId: event.toolCallId ?? null,
				input: event.input ?? {},
			});

		let choice: string | undefined;
		try {
			choice = await ctx.ui.select(payload, ["Approve", "Deny"]);
		} catch (error) {
			// Il canale UI e' caduto mentre si chiedeva: fail-closed, come fa
			// il wrapper nativo quando un handler lancia.
			return { block: true, reason: `Approvazione non completata: ${String(error)}` };
		}
		if (choice !== "Approve") {
			return { block: true, reason: "Negato in OMP Studio" };
		}
	});
}
