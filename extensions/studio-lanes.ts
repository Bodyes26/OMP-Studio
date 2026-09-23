// Estensione OMP: Integrazione delle corsie git di Studio.
//
// Fornisce il tool agente `studio_lane_integrate` per permettere all'agente di
// integrare il lavoro di una corsia di Studio nel branch target tramite il bridge
// HTTP loopback esposto da Studio.

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

interface LaneToolParams {
	message: string;
	lane?: string;
}

function textResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details ? { content: [{ type: "text", text }], details } : { content: [{ type: "text", text }] };
}

function errorResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details
		? { content: [{ type: "text", text }], isError: true, details }
		: { content: [{ type: "text", text }], isError: true };
}

/**
 * Entrypoint dell'estensione OMP per l'integrazione delle corsie.
 */
export default function studioLanesExtension(pi: StudioLanesApi): void {
	const bridgeUrl = process.env.OMP_STUDIO_BRIDGE_URL;
	const bridgeToken = process.env.OMP_STUDIO_BRIDGE_TOKEN;

	// Registra il tool solo se la sessione corrente e' collegata a Studio tramite le variabili d'ambiente del bridge
	if (!bridgeUrl || !bridgeToken) {
		return;
	}

	const z = pi.zod;

	pi.registerTool({
		name: "studio_lane_integrate",
		label: "Studio Lane Integrate",
		description:
			"Integra il lavoro di una corsia di Studio nel branch target; Studio esegue commit, merge squash e pulizia. " +
			"Usalo solo quando l'utente chiede esplicitamente di integrare (fare il merge di) una corsia, mai di tua iniziativa a fine lavoro. " +
			"Se il merge e' pulito integra subito; se ci sono conflitti restituisce i file e il percorso del worktree: " +
			"risolverli in quei file, eseguire `git add` sui file risolti, NON committare, e poi richiamare questo tool. " +
			"Puo' rispondere 'in coda' o 'in attesa di conferma utente': non ritentare in loop. " +
			"Non usare git merge, git rebase o git commit manuali per integrare una corsia.",
		parameters: z.object({
			message: z
				.string()
				.describe("Messaggio del commit squash nel branch target: cosa cambia per l'utente."),
			lane: z
				.string()
				.optional()
				.describe("Identificativo della corsia da integrare. Necessario per l'agente principale se ci sono piu' corsie aperte; facoltativo se invocato all'interno della corsia.")
		}),
		approval: "write",
		async execute(_toolCallId, params: LaneToolParams, signal, _onUpdate, _ctx) {
			const message = typeof params?.message === "string" ? params.message.trim() : "";
			if (!message) {
				return errorResult("Errore: il parametro 'message' e' obbligatorio e non puo' essere vuoto.");
			}

			const lane = typeof params?.lane === "string" && params.lane.trim() ? params.lane.trim() : undefined;

			try {
				const endpoint = `${bridgeUrl.replace(/\/+$/, "")}/v1/lane/integrate`;
				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${bridgeToken}`,
						"Content-Type": "application/json"
					},
					body: JSON.stringify({
						laneId: lane,
						message
					}),
					signal
				});

				let data: { ok?: boolean; text?: string; details?: Record<string, unknown> };
				try {
					data = (await response.json()) as { ok?: boolean; text?: string; details?: Record<string, unknown> };
				} catch {
					return errorResult(
						`Errore di comunicazione: la risposta HTTP ${response.status} del bridge non e' un JSON valido.`
					);
				}

				const ok = Boolean(data?.ok);
				const text =
					data?.text ||
					(ok ? "Integrazione corsia completata con successo." : "Errore durante l'integrazione della corsia.");

				if (!ok) {
					return errorResult(text, data?.details);
				}
				return textResult(text, data?.details);
			} catch (err: unknown) {
				if (signal?.aborted) {
					return errorResult("Operazione di integrazione corsia annullata.");
				}
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Errore di rete durante la connessione al bridge di Studio: ${msg}`);
			}
		}
	});
}
