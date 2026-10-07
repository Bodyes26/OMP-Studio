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
	const base = (env.bridgeUrl ?? "").replace(/\/+$/, "");
	try {
		const response = await fetchImpl(`${base}/v1/corsie/${verbo}`, {
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
				`Errore di comunicazione: la risposta HTTP ${response.status} del bridge non e' un JSON valido.`
			);
		}
		const details = { ...(data?.details ?? {}), verbo };
		const text = data?.text || (data?.ok ? "Fatto." : `Studio ha rifiutato corsia_${verbo}.`);
		return data?.ok ? textResult(text, details) : errorResult(text, details);
	} catch (err: unknown) {
		if (signal?.aborted) return errorResult(`corsia_${verbo} annullato.`);
		const msg = err instanceof Error ? err.message : String(err);
		return errorResult(`Errore di rete verso il bridge di Studio: ${msg}`);
	}
}

const NO_GIT =
	"Non usare mai git per gestire le corsie (niente branch, worktree, merge, rebase o commit manuali): lo fa Studio.";

/**
 * Entrypoint dell'estensione OMP per le corsie.
 */
export default function studioLanesExtension(pi: StudioLanesApi, envOverride?: CorsieEnvironment): void {
	const env = envOverride ?? readEnvironment();
	const enabled = new Set<string>(corsiaToolsFor(env));
	if (enabled.size === 0) return;

	const z = pi.zod;
	const register = <TParams>(definition: ToolDefinition<TParams>) => {
		if (enabled.has(definition.name)) pi.registerTool(definition);
	};

	register<{ obiettivo?: string; tipo?: string; profilo?: string }>({
		name: "corsia_avvia",
		label: "Avvia corsia",
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
				.describe("Ruolo modello dell'agente della corsia (es. 'default', 'plan', 'smol', 'slow'). Ometti per il predefinito del progetto.")
		}),
		approval: "write",
		async execute(_id, params, signal) {
			const obiettivo = cleanText(params?.obiettivo);
			if (!obiettivo) return errorResult("Il parametro 'obiettivo' e' obbligatorio.");
			const tipo = params?.tipo === "lab" ? "lab" : "worktree";
			return callBridge(env, "avvia", { obiettivo, tipo, profilo: cleanText(params?.profilo) }, signal);
		}
	});

	register<Record<string, never>>({
		name: "corsia_stato",
		label: "Stato corsie",
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
		label: "Risultato corsia",
		description:
			"Legge il riassunto che l'agente della corsia ha lasciato con corsia_fatto, piu' il diffstat; " +
			"per un prototipo del Laboratorio l'ultima revisione e lo stato dell'anteprima.",
		parameters: z.object({
			corsia: z.string().describe("Id (o titolo) della corsia, come restituito da corsia_avvia o corsia_stato.")
		}),
		approval: "read",
		async execute(_id, params, signal) {
			const corsia = cleanText(params?.corsia);
			if (!corsia) return errorResult("Il parametro 'corsia' e' obbligatorio.");
			return callBridge(env, "risultato", { corsia }, signal);
		}
	});

	register<{ corsia?: string; messaggio?: string }>({
		name: "corsia_integra",
		label: "Integra corsia",
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
			if (!messaggio) return errorResult("Il parametro 'messaggio' e' obbligatorio.");
			return callBridge(env, "integra", { corsia: cleanText(params?.corsia), messaggio }, signal);
		}
	});

	register<{ corsia?: string }>({
		name: "corsia_chiudi",
		label: "Chiudi corsia",
		description:
			"Chiude una corsia in modo reversibile: ferma il suo agente e i processi, la toglie dalla barra e conserva branch e cartella " +
			"(l'utente puo' riaprirla). Per i prototipi del Laboratorio chiude la scheda e lascia intatte le revisioni.",
		parameters: z.object({
			corsia: z.string().describe("Id (o titolo) della corsia da chiudere.")
		}),
		approval: "write",
		async execute(_id, params, signal) {
			const corsia = cleanText(params?.corsia);
			if (!corsia) return errorResult("Il parametro 'corsia' e' obbligatorio.");
			return callBridge(env, "chiudi", { corsia }, signal);
		}
	});

	register<{ corsia?: string }>({
		name: "corsia_scarta",
		label: "Scarta corsia",
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
			if (!corsia) return errorResult("Il parametro 'corsia' e' obbligatorio.");
			return callBridge(env, "scarta", { corsia }, signal);
		}
	});

	register<{ prototipo?: string }>({
		name: "corsia_consegna",
		label: "Consegna prototipo",
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
			if (!prototipo) return errorResult("Il parametro 'prototipo' e' obbligatorio.");
			return callBridge(env, "consegna", { prototipo }, signal);
		}
	});

	register<{ riassunto?: string }>({
		name: "corsia_fatto",
		label: "Corsia finita",
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
			if (!riassunto) return errorResult("Il parametro 'riassunto' e' obbligatorio.");
			return callBridge(env, "fatto", { riassunto }, signal);
		}
	});

	register<{ motivo?: string; obiettivo?: string }>({
		name: "corsia_proponi",
		label: "Proponi corsia",
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
			if (!motivo) return errorResult("Il parametro 'motivo' e' obbligatorio.");
			return callBridge(
				env,
				"proponi",
				{ motivo, obiettivo: cleanText(params?.obiettivo), toolCallId },
				signal
			);
		}
	});
}
