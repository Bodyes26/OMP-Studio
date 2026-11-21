// Estensione OMP: corsie di Studio guidate dall'agente.
//
// Un tool per verbo (`corsia_avvia`, `corsia_stato`, `corsia_risultato`,
// `corsia_integra`, `corsia_chiudi`, `corsia_scarta`, `corsia_consegna`,
// `corsia_fatto`, `corsia_proponi`). L'agente dice COSA vuole; il COME (branch,
// worktree, commit, merge, pulizia) resta a Studio, che riusa gli stessi flussi
// della GUI tramite il bridge HTTP loopback `/v1/corsie/<verbo>`.
//
// Chi vede quali tool:
// - Principale: tutti tranne `corsia_fatto`;
// - agente dentro una corsia worktree: `corsia_fatto` e `corsia_stato`;
// - agente del Laboratorio: solo `corsia_fatto` (l'hook fail-closed di
//   `studio-lab.ts` blocca tutto il resto).
// Il bridge applica comunque gli stessi permessi in Rust: l'elenco qui serve a
// non mostrare al modello strumenti che non potrebbe usare.

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

// Sottoinsieme tipizzato della superficie iniettata da omp (allineato a studio-tasks.ts).
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
	array(item: ZodType): ZodType;
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

interface StudioLanesApi {
	zod: ZodBuilder;
	registerTool<TParams>(definition: ToolDefinition<TParams>): void;
}

export type CorsiaVerbo =
	| "avvia"
	| "stato"
	| "risultato"
	| "integra"
	| "chiudi"
	| "scarta"
	| "consegna"
	| "fatto"
	| "proponi";

export type CorsiaToolName = `corsia_${CorsiaVerbo}`;

/** Ambiente da cui dipende l'elenco dei tool: separato per i test. */
export interface CorsieEnvironment {
	bridgeUrl?: string;
	bridgeToken?: string;
	laneId?: string;
	labSession?: boolean;
}

function readEnvironment(): CorsieEnvironment {
	return {
		bridgeUrl: process.env.OMP_STUDIO_BRIDGE_URL,
		bridgeToken: process.env.OMP_STUDIO_BRIDGE_TOKEN,
		laneId: process.env.OMP_LANE_ID,
		labSession: process.env.OMP_LAB_SESSION === "1"
	};
}

/**
 * Tool visibili per la sessione. Senza bridge nessuno: fuori da Studio i
 * verbi non avrebbero nessuno a cui rivolgersi.
 */
export function corsiaToolsFor(env: CorsieEnvironment): CorsiaToolName[] {
	if (!env.bridgeUrl || !env.bridgeToken) return [];
	if (env.labSession) return ["corsia_fatto"];
	const lane = (env.laneId ?? "").trim();
	if (lane && lane !== "main") return ["corsia_fatto", "corsia_stato"];
	return [
		"corsia_avvia",
		"corsia_stato",
		"corsia_risultato",
		"corsia_integra",
		"corsia_chiudi",
		"corsia_scarta",
		"corsia_consegna",
		"corsia_proponi"
	];
}

function textResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details ? { content: [{ type: "text", text }], details } : { content: [{ type: "text", text }] };
}

function errorResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details
		? { content: [{ type: "text", text }], isError: true, details }
		: { content: [{ type: "text", text }], isError: true };
}

function cleanText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Corpo della risposta del frontend, inoltrato da Rust cosi' com'e'. */
interface BridgeReply {
	ok?: boolean;
	text?: string;
	details?: Record<string, unknown>;
}

/**
 * Chiamata al bridge. Gli esiti "attesi" (in coda, serve l'utente, conflitti)
 * arrivano con `ok: true` e un testo che dice all'agente cosa fare: solo un
 * errore vero diventa `isError`.
 */
export async function callBridge(
	env: CorsieEnvironment,
	verbo: CorsiaVerbo,
	body: Record<string, unknown>,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch = fetch
): Promise<ToolResult> {
	return postBridge(env, `/v1/corsie/${verbo}`, `corsia_${verbo}`, { verbo }, body, signal, fetchImpl);
}

export type MacchinaVerbo = "elenco" | "esegui" | "stato" | "risultato" | "annulla";

/** Verbi di «Esegui su macchina» (R-MI-36), gestiti da Rust nel bridge. */
export async function callMachines(
	env: CorsieEnvironment,
	verbo: MacchinaVerbo,
	body: Record<string, unknown>,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch = fetch
): Promise<ToolResult> {
	return postBridge(env, `/v1/macchine/${verbo}`, `macchina_${verbo}`, { verbo }, body, signal, fetchImpl);
}

async function postBridge(
	env: CorsieEnvironment,
	path: string,
	tool: string,
	extra: Record<string, unknown>,
	body: Record<string, unknown>,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch
): Promise<ToolResult> {
	const base = (env.bridgeUrl ?? "").replace(/\/+$/, "");
	try {
		const response = await fetchImpl(`${base}${path}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.bridgeToken ?? ""}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body),
			signal
		});
		let data: BridgeReply;
		try {
			data = (await response.json()) as BridgeReply;
		} catch {
			return errorResult(
				tr(
					`Errore di comunicazione: la risposta HTTP ${response.status} del bridge non e' un JSON valido.`,
					`Communication error: the bridge HTTP response ${response.status} is not valid JSON.`
				)
			);
		}
		const details = { ...(data?.details ?? {}), ...extra };
		const text =
			data?.text ||
			(data?.ok ? tr("Fatto.", "Done.") : tr(`Studio ha rifiutato ${tool}.`, `Studio refused ${tool}.`));
		return data?.ok ? textResult(text, details) : errorResult(text, details);
	} catch (err: unknown) {
		if (signal?.aborted) return errorResult(tr(`${tool} annullato.`, `${tool} cancelled.`));
		const msg = err instanceof Error ? err.message : String(err);
		return errorResult(tr(`Errore di rete verso il bridge di Studio: ${msg}`, `Network error towards the Studio bridge: ${msg}`));
	}
}

/**
 * Tool di «Esegui su macchina»: in ogni sessione di Studio col bridge, corsie
 * comprese (i test sull'altra macchina servono anche li'), non nel Laboratorio.
 */
export function macchinaToolsFor(env: CorsieEnvironment): string[] {
	if (!env.bridgeUrl || !env.bridgeToken || env.labSession) return [];
	return ["macchina_esegui", "macchina_stato", "macchina_risultato", "macchina_annulla"];
}

const NO_GIT =
	"Non usare mai git per gestire le corsie (niente branch, worktree, merge, rebase o commit manuali): lo fa Studio.";

/**
 * Entrypoint dell'estensione OMP per le corsie.
 */
export default function studioLanesExtension(pi: StudioLanesApi, envOverride?: CorsieEnvironment): void {
	const env = envOverride ?? readEnvironment();
	const enabled = new Set<string>([...corsiaToolsFor(env), ...macchinaToolsFor(env)]);
	if (enabled.size === 0) return;

	const z = pi.zod;
	const register = <TParams>(definition: ToolDefinition<TParams>) => {
		if (enabled.has(definition.name)) pi.registerTool(definition);
	};

	register<{ obiettivo?: string; tipo?: string; profilo?: string; macchina?: string }>({
		name: "corsia_avvia",
		label: tr("Avvia corsia", "Start lane"),
		description:
			"Apre una corsia di Studio e le affida un obiettivo come primo compito: Studio crea il worktree isolato (tipo 'worktree') " +
			"o un prototipo del Laboratorio (tipo 'lab') e ci fa partire un agente dedicato. " +
			"Usalo solo se l'utente ha chiesto esplicitamente una corsia o ha accettato una proposta di corsia_proponi: mai di tua iniziativa e mai in silenzio. " +
			"Oltre il limite di agenti simultanei la richiesta resta 'in coda' e parte da sola quando si libera un posto: non ritentare. " +
			"Restituisce l'id della corsia da usare con gli altri tool corsia_*. " +
			NO_GIT,
		parameters: z.object({
			obiettivo: z
				.string()
				.describe("Cosa deve fare l'agente della corsia, scritto come un compito completo e autosufficiente."),
			tipo: z
				.enum(["worktree", "lab"])
				.describe("'worktree' per lavoro sul codice del progetto, 'lab' per un prototipo UI nel Laboratorio."),
			profilo: z
				.string()
				.optional()
				.describe("Ruolo modello dell'agente della corsia (es. 'default', 'plan', 'smol', 'slow'). Ometti per il predefinito del progetto."),
			macchina: z.string().optional().describe("Nome o ID della macchina con una copia del progetto. Se omessa, usa la macchina della sessione.")
		}),
		approval: "write",
		async execute(_id, params, signal) {
			const obiettivo = cleanText(params?.obiettivo);
			if (!obiettivo) return errorResult(tr("Il parametro 'obiettivo' e' obbligatorio.", "The 'obiettivo' parameter is required."));
			const tipo = params?.tipo === "lab" ? "lab" : "worktree";
			const macchina = cleanText(params?.macchina);
			return callBridge(env, "avvia", { obiettivo, tipo, profilo: cleanText(params?.profilo), ...(macchina ? { macchina } : {}) }, signal);
		}
	});

	register<Record<string, never>>({
		name: "corsia_stato",
		label: tr("Stato corsie", "Lane status"),
		description:
			"Elenca le corsie del progetto con il loro stato (in corso, finita, bloccata, in coda), i file toccati e il diffstat. " +
			"Usalo per sapere a che punto sono le corsie prima di leggerne il risultato o integrarle.",
		parameters: z.object({}),
		approval: "read",
		async execute(_id, _params, signal) {
			return callBridge(env, "stato", {}, signal);
		}
	});

	register<{ corsia?: string }>({
		name: "corsia_risultato",
		label: tr("Risultato corsia", "Lane result"),
		description:
			"Legge il riassunto che l'agente della corsia ha lasciato con corsia_fatto, piu' il diffstat; " +
			"per un prototipo del Laboratorio l'ultima revisione e lo stato dell'anteprima.",
		parameters: z.object({
			corsia: z.string().describe("Id (o titolo) della corsia, come restituito da corsia_avvia o corsia_stato.")
		}),
		approval: "read",
		async execute(_id, params, signal) {
			const corsia = cleanText(params?.corsia);
			if (!corsia) return errorResult(tr("Il parametro 'corsia' e' obbligatorio.", "The 'corsia' parameter is required."));
			return callBridge(env, "risultato", { corsia }, signal);
		}
	});

	register<{ corsia?: string; messaggio?: string }>({
		name: "corsia_integra",
		label: tr("Integra corsia", "Merge lane"),
		description:
			"Integra il lavoro di una corsia worktree nel branch di destinazione. Se il merge e' pulito Studio integra subito " +
			"(un solo commit squash) e chiude la corsia, senza chiedere conferma. Se ci sono conflitti NON li risolvi tu: " +
			"Studio restituisce l'elenco dei file in conflitto, segna la corsia come in attesa dell'utente e gli apre la revisione; " +
			"riferisci all'utente e non ritentare. Puo' rispondere 'in coda' se il branch di destinazione e' occupato: riparte da solo. " +
			"Usalo solo quando l'utente chiede di integrare, mai di tua iniziativa a fine lavoro. " +
			NO_GIT,
		parameters: z.object({
			corsia: z.string().describe("Id (o titolo) della corsia da integrare."),
			messaggio: z.string().describe("Messaggio del commit squash nel branch di destinazione: cosa cambia per l'utente.")
		}),
		approval: "write",
		async execute(_id, params, signal) {
			const messaggio = cleanText(params?.messaggio);
			if (!messaggio) return errorResult(tr("Il parametro 'messaggio' e' obbligatorio.", "The 'messaggio' parameter is required."));
			return callBridge(env, "integra", { corsia: cleanText(params?.corsia), messaggio }, signal);
		}
	});

	register<{ corsia?: string }>({
		name: "corsia_chiudi",
		label: tr("Chiudi corsia", "Close lane"),
		description:
			"Chiude una corsia in modo reversibile: ferma il suo agente e i processi, la toglie dalla barra e conserva branch e cartella " +
			"(l'utente puo' riaprirla). Per i prototipi del Laboratorio chiude la scheda e lascia intatte le revisioni.",
		parameters: z.object({
			corsia: z.string().describe("Id (o titolo) della corsia da chiudere.")
		}),
		approval: "write",
		async execute(_id, params, signal) {
			const corsia = cleanText(params?.corsia);
			if (!corsia) return errorResult(tr("Il parametro 'corsia' e' obbligatorio.", "The 'corsia' parameter is required."));
			return callBridge(env, "chiudi", { corsia }, signal);
		}
	});

	register<{ corsia?: string }>({
		name: "corsia_scarta",
		label: tr("Scarta corsia", "Discard lane"),
		description:
			"Elimina definitivamente una corsia (worktree e branch, o il prototipo del Laboratorio). Se la corsia contiene lavoro " +
			"mai integrato, o e' un prototipo, Studio non cancella nulla: avvisa e chiede conferma all'utente nella sua finestra. " +
			"In quel caso riferisci all'utente e non ritentare.",
		parameters: z.object({
			corsia: z.string().describe("Id (o titolo) della corsia da scartare.")
		}),
		approval: "write",
		async execute(_id, params, signal) {
			const corsia = cleanText(params?.corsia);
			if (!corsia) return errorResult(tr("Il parametro 'corsia' e' obbligatorio.", "The 'corsia' parameter is required."));
			return callBridge(env, "scarta", { corsia }, signal);
		}
	});

	register<{ prototipo?: string }>({
		name: "corsia_consegna",
		label: tr("Consegna prototipo", "Hand off prototype"),
		description:
			"Consegna alla Principale un prototipo del Laboratorio: restituisce il pacchetto di handoff (revisione, file, " +
			"riepilogo, limiti delle simulazioni) da cui implementare la funzionalita' nello stack nativo del progetto, " +
			"senza importare il runtime React del prototipo.",
		parameters: z.object({
			prototipo: z.string().describe("Id del prototipo (p-AAAAMMGG-xxxxxx), della sua corsia (lab-...) o titolo.")
		}),
		approval: "write",
		async execute(_id, params, signal) {
			const prototipo = cleanText(params?.prototipo);
			if (!prototipo) return errorResult(tr("Il parametro 'prototipo' e' obbligatorio.", "The 'prototipo' parameter is required."));
			return callBridge(env, "consegna", { prototipo }, signal);
		}
	});

	register<{ riassunto?: string }>({
		name: "corsia_fatto",
		label: tr("Corsia finita", "Lane done"),
		description:
			"Segnala a Studio che il compito di questa corsia e' finito e lascia il riassunto per la Principale " +
			"(cosa hai fatto, file principali, verifiche eseguite, cosa resta aperto). Chiamalo una sola volta alla fine. " +
			"Non integrare, non fare merge e non committare: l'integrazione la decide l'utente.",
		parameters: z.object({
			riassunto: z.string().describe("Riassunto per la Principale: esito, file toccati, verifiche, punti aperti.")
		}),
		approval: "read",
		async execute(_id, params, signal) {
			const riassunto = cleanText(params?.riassunto);
			if (!riassunto) return errorResult(tr("Il parametro 'riassunto' e' obbligatorio.", "The 'riassunto' parameter is required."));
			return callBridge(env, "fatto", { riassunto }, signal);
		}
	});

	register<{ motivo?: string; obiettivo?: string }>({
		name: "corsia_proponi",
		label: tr("Proponi corsia", "Propose lane"),
		description:
			"Prima di un'operazione pericolosa o sperimentale sul working tree (refactoring esteso, cancellazioni, migrazioni, " +
			"aggiornamenti di dipendenze, prove distruttive) chiedi all'utente se spostare il lavoro in un worktree isolato. " +
			"Studio mostra una card con due scelte e il tool ATTENDE il clic: 'Crea nuovo worktree' crea la corsia e ci sposta il lavoro " +
			"(ricevi l'id; con 'obiettivo' l'agente della corsia parte subito, senza la corsia si apre vuota all'utente: in entrambi i casi " +
			"tu NON esegui l'operazione sulla Principale), 'No, resta su main' risponde 'resta su main' e prosegui qui. " +
			"Non creare mai corsie in silenzio: questa e' la strada per proporle. " +
			NO_GIT,
		parameters: z.object({
			motivo: z.string().describe("Perche' l'operazione e' rischiosa, in una o due frasi per l'utente."),
			obiettivo: z
				.string()
				.optional()
				.describe("Compito completo da affidare all'agente della corsia se l'utente accetta. Fortemente consigliato.")
		}),
		approval: "read",
		async execute(toolCallId, params, signal) {
			const motivo = cleanText(params?.motivo);
			if (!motivo) return errorResult(tr("Il parametro 'motivo' e' obbligatorio.", "The 'motivo' parameter is required."));
			return callBridge(
				env,
				"proponi",
				{ motivo, obiettivo: cleanText(params?.obiettivo), toolCallId },
				signal
			);
		}
	});

	register<{ comando?: string; macchina?: string; artefatti?: string[] }>({
		name: "macchina_esegui",
		label: tr("Esegui su macchina", "Run on machine"),
		description:
			"Lancia un comando di shell su un'altra macchina abbinata a Studio (es. `npm test` o `cargo test` sul PC Windows dal Mac), " +
			"nella copia dello stesso progetto, in una cartella di lavoro dedicata spostata all'ultimo commit di qui: " +
			"le modifiche non committate NON viaggiano, committale prima se servono. La copia dove lavora l'utente sull'altra macchina non viene toccata. " +
			"Restituisce l'id del job da usare con macchina_stato, macchina_risultato e macchina_annulla. " +
			"Uno alla volta per progetto su quella macchina: gli altri attendono in fila. Usalo per provare il codice su un altro sistema operativo, " +
			"non per lavori che puoi fare qui.",
		parameters: z.object({
			comando: z.string().describe("Comando di shell da eseguire nella radice del progetto (cmd.exe su Windows, shell di login su macOS/Linux)."),
			macchina: z
				.string()
				.optional()
				.describe("Nome della macchina come in Studio. Ometti se ce n'e' una sola in linea; macchina_stato senza job le elenca."),
			artefatti: z
				.array(z.string())
				.optional()
				.describe("Glob relativi alla radice del progetto dei file da riportare qui a fine job (es. 'test-results/*.xml').")
		}),
		approval: "exec",
		async execute(_id, params, signal) {
			const comando = cleanText(params?.comando);
			if (!comando) return errorResult(tr("Il parametro 'comando' e' obbligatorio.", "The 'comando' parameter is required."));
			const artefatti = Array.isArray(params?.artefatti) ? params.artefatti.filter((value) => typeof value === "string") : [];
			return callMachines(env, "esegui", { comando, macchina: cleanText(params?.macchina), artefatti }, signal);
		}
	});

	register<{ job?: string }>({
		name: "macchina_stato",
		label: tr("Stato job remoto", "Remote job status"),
		description:
			"Con un job: stato (in fila, in preparazione, in esecuzione, finito con codice d'uscita) e coda del log. " +
			"Senza job: elenca le macchine abbinate e se sono in linea.",
		parameters: z.object({
			job: z.string().optional().describe("Id del job restituito da macchina_esegui.")
		}),
		approval: "read",
		async execute(_id, params, signal) {
			const job = cleanText(params?.job);
			return job ? callMachines(env, "stato", { job }, signal) : callMachines(env, "elenco", {}, signal);
		}
	});

	register<{ job?: string; attesaSecondi?: number }>({
		name: "macchina_risultato",
		label: tr("Risultato job remoto", "Remote job result"),
		description:
			"Aspetta la fine del job (di base fino a 30 minuti) e restituisce codice d'uscita, coda del log e i percorsi locali degli artefatti " +
			"scaricati e verificati. Se l'attesa scade il job continua: richiamalo. Se fermi questo tool il job remoto viene annullato.",
		parameters: z.object({
			job: z.string().describe("Id del job restituito da macchina_esegui."),
			attesaSecondi: z.number().optional().describe("Attesa massima in secondi (fino a 14400).")
		}),
		approval: "read",
		async execute(_id, params, signal) {
			const job = cleanText(params?.job);
			if (!job) return errorResult(tr("Il parametro 'job' e' obbligatorio.", "The 'job' parameter is required."));
			const result = await callMachines(env, "risultato", { job, attesaSecondi: params?.attesaSecondi }, signal);
			// Stop dell'agente durante l'attesa: il job remoto si ferma con lui (R-MI-36).
			if (signal?.aborted) await callMachines(env, "annulla", { job }, undefined);
			return result;
		}
	});

	register<{ job?: string }>({
		name: "macchina_annulla",
		label: tr("Annulla job remoto", "Cancel remote job"),
		description: "Ferma un job lanciato con macchina_esegui, con tutti i suoi processi sull'altra macchina.",
		parameters: z.object({
			job: z.string().describe("Id del job restituito da macchina_esegui.")
		}),
		approval: "write",
		async execute(_id, params, signal) {
			const job = cleanText(params?.job);
			if (!job) return errorResult(tr("Il parametro 'job' e' obbligatorio.", "The 'job' parameter is required."));
			return callMachines(env, "annulla", { job }, signal);
		}
	});
}
