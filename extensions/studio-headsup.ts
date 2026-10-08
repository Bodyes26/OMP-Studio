// Estensione OMP: heads-up di fine turno per OMP Studio (Gate R3X-heads-up).
//
// Fornisce il tool `studio_headsup`: l'agente lo chiama con UNA frase solo
// quando nel turno e' successo qualcosa che l'utente rischia di perdere
// leggendo la risposta (verifica fallita, test non eseguiti, modifica
// delicata, decisione presa da solo, domanda rimasta a meta' messaggio).
//
// Il tool non fa nulla: restituisce subito «ok». La frase vive negli
// argomenti della chiamata, quindi resta nel `.jsonl` della sessione e
// Studio la ritrova anche dopo una ripresa; nella TUI si vede come una
// normale chiamata di tool. Nessuna istruzione nel prompt di sistema: la
// regola d'uso sta tutta nella descrizione del tool.

interface ZodType {
	optional(): ZodType;
	describe(text: string): ZodType;
}

interface ZodBuilder {
	object(shape: Record<string, ZodType>): ZodType;
	string(): ZodType;
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
		ctx: unknown
	): Promise<ToolResult>;
}

export interface StudioHeadsUpApi {
	zod: ZodBuilder;
	registerTool<TParams>(definition: ToolDefinition<TParams>): void;
}

export interface HeadsUpParams {
	text: string;
}

/** Tetto della frase: oltre, Studio la taglia comunque in visualizzazione. */
export const HEADS_UP_TEXT_MAX = 220;

export const HEADS_UP_TOOL_DESCRIPTION =
	"Segnala all'utente, in UNA sola frase, qualcosa di importante successo in questo turno che rischia di perdersi a meta' della risposta. " +
	"Chiamalo al massimo una volta per turno, subito prima della risposta finale, e SOLO se vale almeno una di queste: " +
	"un comando di verifica (test, build, typecheck) e' fallito e non l'hai risolto; hai modificato codice senza poter eseguire test o build; " +
	"hai fatto una modifica delicata (schema del database, API pubblica, dipendenze, migrazioni, configurazione, CI); " +
	"hai preso una decisione al posto dell'utente; c'e' una domanda per l'utente in mezzo alla risposta. " +
	"Scrivi in linguaggio naturale, in terza persona, nella lingua dell'utente, max 200 caratteri, senza elenchi " +
	"(es. \"Ha cambiato lo schema del DB e non ha eseguito i test; ti chiede se tenere la vecchia API.\"). " +
	"NON chiamarlo per riassumere il lavoro, quando tutto e' andato come previsto, ne' per ripetere l'ultima riga della risposta.";

/** Frase normalizzata: una riga, al massimo HEADS_UP_TEXT_MAX caratteri. */
export function normalizeHeadsUpText(raw: unknown): string {
	if (typeof raw !== "string") return "";
	const flat = raw.replace(/\s+/g, " ").trim();
	return flat.length > HEADS_UP_TEXT_MAX ? `${flat.slice(0, HEADS_UP_TEXT_MAX - 1).trimEnd()}…` : flat;
}

export default function studioHeadsUpExtension(pi: StudioHeadsUpApi): void {
	const z = pi.zod;
	pi.registerTool<HeadsUpParams>({
		name: "studio_headsup",
		label: "Heads up",
		description: HEADS_UP_TOOL_DESCRIPTION,
		parameters: z.object({
			text: z
				.string()
				.describe("Una sola frase (max 200 caratteri) con la cosa che l'utente non deve perdersi.")
		}),
		approval: "read",
		async execute(_toolCallId, params) {
			const text = normalizeHeadsUpText(params?.text);
			if (!text) {
				return {
					content: [{ type: "text", text: "Errore: 'text' e' obbligatorio. Se non c'e' niente da segnalare, non chiamare questo tool." }],
					isError: true
				};
			}
			return { content: [{ type: "text", text: "ok" }], details: { text } };
		}
	});
}
