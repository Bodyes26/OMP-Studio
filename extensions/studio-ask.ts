// Ask HTML di Studio: riusa il tool nativo e il suo parser, sostituendo solo
// la superficie form sul contesto UI pubblico condiviso dal trasporto RPC.
// Il risultato resta una sola tool call, comprese le immagini dell'utente.
import { realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Nessun import statico da `@oh-my-pi`: quei moduli vivono solo dentro il
// runtime omp, cambiano percorso fra le versioni e non sono risolvibili dai
// test di Studio che caricano questo file con Node. Un import statico
// mancante fa fallire il caricamento dell'intera estensione, quindi `ask`
// sparirebbe dalla GUI. Tutto passa da import dinamici con cache (sotto).
// La copia estratta e' autonoma: questa busta JSON coincide con askForm.ts,
// mentre struttura dei campi e validazione rimangono quelle canoniche OMP.
type AskFormValue = string | number | string[];
type AskFormData = Record<string, AskFormValue>;

// Modello del form come lo espone il parser OMP (invariato da 18.18.3 a
// 19.2.x): tipi locali minimi, cosi' il file non dipende dai `.d.ts` del
// pacchetto installato, che non e' presente nel repo.
interface FormSpan { text: string; style?: "code" | "strong" | "em" }
interface ChoiceOption { value: string; label: FormSpan[]; checked: boolean; disabled: boolean }
interface ChoiceField {
	kind: "choice"; name: string; multi: boolean; select: boolean; other: boolean;
	label: FormSpan[]; options: ChoiceOption[]; required: boolean;
}
interface TextField {
	kind: "text"; name: string; type: string; multiline: boolean;
	label: FormSpan[]; value: string; placeholder: string; required: boolean;
	min?: number; max?: number; pattern?: string; minLength?: number; maxLength?: number; rows: number;
}
type FormField = ChoiceField | TextField;
type FormBlock =
	| { kind: "text"; spans: FormSpan[]; heading: boolean }
	| { kind: "list"; items: FormSpan[][]; ordered: boolean }
	| { kind: "pre"; text: string }
	| { kind: "table"; rows: FormSpan[][][]; headerRows: number }
	| { kind: "image"; src: string; alt: string }
	| { kind: "svg"; markup: string; alt: string }
	| { kind: "field"; field: FormField; optionsEnd?: number };
// `fieldset` esiste da 19.2: opzionale perche' il parser di 18/19.0 non lo manda.
interface FormSection { title: FormSpan[]; blocks: FormBlock[]; fieldset?: boolean }
/** Un form interpretato: cosa disegnare, i campi in ordine e gli `<input type="hidden">`. */
interface HtmlForm { sections: FormSection[]; fields: FormField[]; hidden: [name: string, value: string][] }

/** Import OMP risolti a runtime (percorso e firma cambiano fra le versioni). */
interface FormModules {
	parseHtmlForm(html: string): HtmlForm;
	defaultFormData(form: HtmlForm): AskFormData;
	fieldError(field: FormField, value: AskFormValue | undefined): string | undefined;
	fieldQuestions(form: HtmlForm): Map<FormField, string>;
	textValue(field: TextField, text: string): AskFormValue;
}
interface AskFormAnnotation { field: string; note: string; images: ImagePart[] }
interface AskFormSubmission { action: "submit" | "delegate"; data: AskFormData; annotations: AskFormAnnotation[] }
interface AskFormDraft {
	data: AskFormData;
	annotations: AskFormAnnotation[];
	other: Record<string, { enabled: boolean; text: string }>;
}
interface AskFormRequest {
	version: 1;
	toolCallId: string;
	title: string;
	html: string;
	form: HtmlForm & { questions: Record<string, string> };
	defaults: AskFormData;
	draft?: AskFormDraft;
	error?: string;
}

/** Stesso criterio di `src/lib/agent/askForm.ts` (`isAskImageData`). */
function normalizeAskImageData(data: string): string {
	return data.replace(/[ \t\r\n]+/g, "");
}

function isAskImageData(data: string): boolean {
	return data.length > 0 && /^[a-z\d+/]*={0,2}$/i.test(data);
}

const TITLE_PREFIX = "studio-ask-form:";
const IMAGE_BUDGET = 700_000;
const FORM_MEDIA_BYTES = 160_000;

/** Come `resizeImage` di OMP: bytes e MIME, con base64 gia' calcolato dal modulo. */
interface ResizedImage {
	buffer: Uint8Array;
	mimeType: string;
	data: string;
	decodeFailed?: boolean;
}
type ResizeImageInput = { bytes: Uint8Array; mimeType: string } | { type: "image"; data: string; mimeType: string };
type ResizeImage = (
	image: ResizeImageInput,
	options: { maxWidth?: number; maxHeight?: number; maxBytes?: number; excludeWebP?: boolean }
) => Promise<ResizedImage>;

/**
 * Il parser e le regole di validazione sono quelli canonici di OMP, ma il loro
 * percorso cambia: fino a 19.1 stavano in `@oh-my-pi/pi-tui/html-form/*`, da
 * 19.2 in `@oh-my-pi/pi-coding-agent/tools/html-form/*`. L'import non puo'
 * essere statico (vedi commento in testa al file): un modulo mancante fa
 * fallire l'intero caricamento dell'estensione. Il piu' recente ha la
 * precedenza; `resizeImage` e' rimasto in `utils/image-resize`.
 */
let formModules: Promise<FormModules> | undefined;
function loadFormModules(): Promise<FormModules> {
	if (!formModules) {
		formModules = (async () => {
			// Gli specificatori devono restare letterali: il loader delle estensioni
			// di OMP li riscrive nel sorgente per servire i moduli interni, e una
			// variabile non viene intercettata ("Cannot find package").
			try {
				const [parse, data] = await Promise.all([
					import("@oh-my-pi/pi-coding-agent/tools/html-form/parse") as Promise<{ parseHtmlForm: FormModules["parseHtmlForm"] }>,
					import("@oh-my-pi/pi-coding-agent/tools/html-form/data") as Promise<Omit<FormModules, "parseHtmlForm">>
				]);
				return { parseHtmlForm: parse.parseHtmlForm, ...data };
			} catch {
				// Fino a 19.1 gli stessi moduli vivevano in pi-tui.
			}
			try {
				const [parse, data] = await Promise.all([
					import("@oh-my-pi/pi-tui/html-form/parse") as Promise<{ parseHtmlForm: FormModules["parseHtmlForm"] }>,
					import("@oh-my-pi/pi-tui/html-form/data") as Promise<Omit<FormModules, "parseHtmlForm">>
				]);
				return { parseHtmlForm: parse.parseHtmlForm, ...data };
			} catch {
				throw new Error(tr("Parser HTML di OMP non disponibile", "OMP HTML parser is not available"));
			}
		})();
	}
	return formModules;
}

let resizeImageLoader: Promise<ResizeImage> | undefined;
function loadResizeImage(): Promise<ResizeImage> {
	if (!resizeImageLoader) {
		resizeImageLoader = (async () => {
			try {
				// Percorso scelto a runtime, come sopra: il pacchetto OMP non e' nel repo.
				const module = (await import("@oh-my-pi/pi-coding-agent/utils/image-resize")) as { resizeImage: ResizeImage };
				return module.resizeImage;
			} catch {
				throw new Error(tr("Ridimensionamento immagini di OMP non disponibile", "OMP image resizing is not available"));
			}
		})();
	}
	return resizeImageLoader;
}

/** Limite del caricatore di OMP per una singola immagine del form. */
const MAX_FORM_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_MIME = "image/svg+xml";

function decodeDataUri(uri: string): Uint8Array {
	const comma = uri.indexOf(",");
	if (comma === -1) throw new Error(tr("URI data: malformato", "Malformed data: URI"));
	const header = uri.slice(5, comma);
	const payload = uri.slice(comma + 1);
	if (/;base64$/i.test(header)) return Uint8Array.fromBase64(payload.replace(/\s+/g, ""));
	return new TextEncoder().encode(decodeURIComponent(payload));
}

/** Un `<svg>` come documento autonomo: namespace e dimensioni dal `viewBox`. */
function svgStandalone(markup: string): string {
	const open = /<svg\b[^>]*>/i.exec(markup)?.[0];
	if (!open) return markup;
	const added: string[] = [];
	if (!/\bxmlns\s*=/i.test(open)) added.push(`xmlns="${SVG_NAMESPACE}"`);
	const box = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(open);
	if (box && !/\swidth\s*=/i.test(open) && !/\sheight\s*=/i.test(open)) added.push(`width="${box[1]}"`, `height="${box[2]}"`);
	return added.length > 0 ? markup.replace(/<svg\b/i, `<svg ${added.join(" ")}`) : markup;
}

/** MIME di un raster dai primi byte, come `parseImageMetadata` di OMP. */
function rasterMime(bytes: Uint8Array): string | undefined {
	const ascii = (offset: number, text: string): boolean => {
		if (bytes.length < offset + text.length) return false;
		for (let index = 0; index < text.length; index++) if (bytes[offset + index] !== text.charCodeAt(index)) return false;
		return true;
	};
	if (bytes[0] === 0x89 && ascii(1, "PNG")) return "image/png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (ascii(0, "GIF8")) return "image/gif";
	if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
	return undefined;
}

/**
 * Un `<img>` disegnato dal form: http(s), data URI, `file:` o percorso locale.
 * Da omp 19.2 il caricatore TUI (`pi-tui/media`, prima
 * `pi-tui/html-form/media`) non e' piu' esportato: il comportamento equivalente
 * (stessi limiti, stessi MIME, SVG reso autonomo) e' qui, con node:fs e fetch.
 * Il confinamento al progetto e' applicato qui, non dal chiamante, cosi' non
 * esiste una strada che legga un file fuori dalla cartella del progetto.
 */
export async function loadFormImage(
	src: string,
	options: { cwd: string; signal?: AbortSignal }
): Promise<{ bytes: Uint8Array; mime: string }> {
	const source = imageSource(src, options.cwd);
	let bytes: Uint8Array;
	if (/^data:/i.test(source)) {
		bytes = decodeDataUri(source);
	} else if (/^https?:\/\//i.test(source)) {
		const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
		const response = await fetch(source, {
			signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const declared = Number(response.headers.get("content-length") ?? 0);
		if (declared > MAX_FORM_IMAGE_BYTES) throw new Error(tr("Immagine troppo grande", "Image is too large"));
		bytes = new Uint8Array(await response.arrayBuffer());
	} else {
		// La dimensione si controlla prima di leggere: un file enorme non deve
		// arrivare in memoria per poi essere scartato.
		const size = (await stat(source)).size;
		if (size > MAX_FORM_IMAGE_BYTES) throw new Error(tr("Immagine troppo grande", "Image is too large"));
		bytes = new Uint8Array(await readFile(source));
	}
	if (bytes.byteLength > MAX_FORM_IMAGE_BYTES) throw new Error(tr("Immagine troppo grande", "Image is too large"));
	const raster = rasterMime(bytes);
	if (raster) return { bytes, mime: raster };
	const text = new TextDecoder().decode(bytes.subarray(0, 4096));
	if (/<svg[\s>]/i.test(text)) return { bytes: new TextEncoder().encode(svgStandalone(text)), mime: SVG_MIME };
	throw new Error(tr("Non e' un'immagine PNG, JPEG, GIF, WebP o SVG", "Not a PNG, JPEG, GIF, WebP or SVG image"));
}

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image"; data: string; mimeType: string };
interface ToolResult {
	content: (TextPart | ImagePart)[];
	details?: Record<string, unknown>;
	isError?: boolean;
}
interface DialogOptions { signal?: AbortSignal; timeout?: number }
interface StudioUi {
	formDialog?: (html: string, options?: DialogOptions) => Promise<{ data: AskFormData; timedOut?: boolean } | undefined>;
	editor(title: string, prefill: string, options?: DialogOptions): Promise<string | undefined>;
}
interface ToolContext {
	hasUI?: boolean;
	cwd?: string;
	agent?: { kind: string };
	ui: StudioUi;
	models?: { current(): { input?: string[] } | undefined };
	model?: { input?: string[] };
	invokeTool?: (params: Record<string, unknown>, options?: { signal?: AbortSignal; onUpdate?: unknown }) => Promise<ToolResult>;
}
interface StringSchema { describe(text: string): StringSchema }
interface StudioApi {
	zod: { string(): StringSchema; object(shape: Record<string, StringSchema>): unknown };
	registerTool(definition: {
		name: string; label: string; description: string; parameters: unknown; approval: "read";
		strict: boolean; concurrency: "exclusive"; loadMode: "discoverable";
		execute(id: string, params: { html: string }, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ToolContext): Promise<ToolResult>;
	}): void;
}

function tr(it: string, en: string): string {
	return (process.env.OMP_STUDIO_LOCALE || "en").toLowerCase().startsWith("it") ? it : en;
}

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** I file del modello non possono espandere il perimetro del progetto via symlink. */
export function imageSource(src: string, cwd: string): string {
	if (/^data:/i.test(src)) return src;
	if (/^https?:\/\//i.test(src)) {
		const url = new URL(src);
		if (url.username || url.password) throw new Error(tr("URL immagine con credenziali non ammesso", "Image URLs with credentials are not allowed"));
		return url.href;
	}
	const candidate = /^file:/i.test(src) ? fileURLToPath(src) : resolve(cwd, src);
	const root = realpathSync(cwd);
	const file = realpathSync(candidate);
	const rel = relative(root, file);
	if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
		throw new Error(tr("Immagine fuori dalla cartella del progetto", "Image is outside the project directory"));
	}
	return file;
}

/** Le immagini arrivano ai client come dati, mai come percorsi del computer host. */
async function prepareForm(form: HtmlForm, cwd: string, signal?: AbortSignal): Promise<void> {
	const count = form.sections.reduce((total, section) => total + section.blocks.filter((block) => block.kind === "image").length, 0);
	if (!count) return;
	let remaining = FORM_MEDIA_BYTES;
	for (const section of form.sections) {
		for (let index = 0; index < section.blocks.length; index++) {
			const block = section.blocks[index];
			if (block.kind !== "image") continue;
			try {
				if (signal?.aborted) throw signal.reason;
				const loaded = await loadFormImage(block.src, { cwd, signal });
				if (loaded.mime === "image/svg+xml") {
					section.blocks[index] = { kind: "svg", markup: new TextDecoder().decode(loaded.bytes), alt: block.alt };
					continue;
				}
				const maxBytes = Math.max(1024, Math.min(remaining, Math.floor(FORM_MEDIA_BYTES / Math.max(1, count))));
				// Caricato qui, non prima del ciclo: un modulo assente deve
				// diventare il testo di ripiego di quella immagine, non far
				// fallire l'intero form.
				const resizeImage = await loadResizeImage();
				const picture = await resizeImage({ bytes: loaded.bytes, mimeType: loaded.mime }, {
					maxWidth: 1280, maxHeight: 1280, maxBytes, excludeWebP: true
				});
				if (picture.decodeFailed || picture.buffer.byteLength > remaining) throw new Error(tr("Immagine troppo grande per il modulo", "Image is too large for the form"));
				remaining -= picture.buffer.byteLength;
				block.src = `data:${picture.mimeType};base64,${picture.data}`;
			} catch (error) {
				if (signal?.aborted) throw error;
				section.blocks[index] = {
					kind: "text", heading: false,
					spans: [{ text: `${block.alt || tr("Immagine", "Image")}: ${error instanceof Error ? error.message : tr("non disponibile", "unavailable")}` }]
				};
			}
		}
	}
}

interface ParsedSubmission { submission: AskFormSubmission; other: AskFormDraft["other"] }

/** La busta non puo' inserire file, valori o associazioni estranei al form. */
function readSubmission(
	raw: string,
	form: HtmlForm,
	modules: FormModules,
	remember: (draft: AskFormDraft) => void
): ParsedSubmission {
	const value: unknown = JSON.parse(raw);
	if (!object(value) || (value.action !== "submit" && value.action !== "delegate") || !object(value.data) || !Array.isArray(value.annotations)) {
		throw new Error(tr("Risposta al modulo non valida", "Invalid form response"));
	}
	const names = new Set(form.fields.map((field) => field.name).filter(Boolean));
	const hidden = new Set(form.hidden.map(([name]) => name));
	const data: AskFormData = Object.create(null);
	for (const [name, input] of Object.entries(value.data)) {
		if (!names.has(name) && !hidden.has(name)) throw new Error(tr("La risposta contiene un campo estraneo", "The response contains an unknown field"));
		if (!(typeof input === "string" || (typeof input === "number" && Number.isFinite(input)) ||
			(Array.isArray(input) && input.every((entry) => typeof entry === "string")))) throw new Error(tr("Valore del campo non valido", "Invalid field value"));
		data[name] = input;
	}
	for (const [name, input] of form.hidden) {
		if (!names.has(name) || data[name] === undefined) data[name] = input;
	}
	const annotations: AskFormAnnotation[] = [];
	let imageLength = 0;
	const seen = new Set<string>();
	for (const entry of value.annotations) {
		if (!object(entry) || typeof entry.field !== "string" || !names.has(entry.field) || seen.has(entry.field) ||
			typeof entry.note !== "string" || !Array.isArray(entry.images)) throw new Error(tr("Annotazione del modulo non valida", "Invalid form annotation"));
		seen.add(entry.field);
		const images: ImagePart[] = [];
		for (const image of entry.images) {
			if (!object(image) || image.type !== "image" || typeof image.data !== "string" ||
				typeof image.mimeType !== "string" || !/^image\/(?:png|jpeg|webp|gif)$/i.test(image.mimeType)) {
				throw new Error(tr("Allegato immagine non valido", "Invalid image attachment"));
			}
			const imageData = normalizeAskImageData(image.data);
			if (!isAskImageData(imageData)) throw new Error(tr("Allegato immagine non valido", "Invalid image attachment"));
			imageLength += imageData.length;
			if (imageLength > IMAGE_BUDGET) throw new Error(tr("Gli allegati superano il limite della risposta", "Attachments exceed the response size limit"));
			images.push({ type: "image", data: imageData, mimeType: image.mimeType });
		}
		annotations.push({ field: entry.field, note: entry.note, images });
	}
	const other: AskFormDraft["other"] = Object.create(null);
	for (const field of form.fields) {
		if (!field.name) continue;
		let input = data[field.name];
		if (field.kind === "text") {
			if (input !== undefined && Array.isArray(input)) throw new Error(tr("Valore testuale non valido", "Invalid text value"));
			input = modules.textValue(field, input === undefined ? "" : String(input));
			data[field.name] = input;
		} else if (input !== undefined) {
			const multiple = field.multi && field.options.length > 1;
			if (multiple !== Array.isArray(input) || (!multiple && typeof input !== "string")) throw new Error(tr("Scelta non valida", "Invalid choice"));
			const chosen = Array.isArray(input) ? input : [String(input)];
			const hiddenFallback = form.hidden.some(([name, fallback]) => name === field.name && fallback === input);
			const extra = chosen.filter((item) => !field.options.some((option) => !option.disabled && option.value === item));
			if (extra.length && !hiddenFallback && (!field.other || extra.length > 1)) throw new Error(tr("Opzione non disponibile", "Unavailable option"));
			if (extra.length && !hiddenFallback) other[field.name] = { enabled: true, text: extra[0] };
		}
	}
	const draftData: AskFormData = { ...data };
	for (const field of form.fields) {
		if (field.kind !== "choice" || !other[field.name]?.enabled) continue;
		const input = draftData[field.name];
		if (Array.isArray(input)) {
			draftData[field.name] = input.filter((item) => field.options.some((option) => !option.disabled && option.value === item));
		} else delete draftData[field.name];
	}
	remember({ data: draftData, annotations, other });
	if (value.action === "submit") {
		const questions = modules.fieldQuestions(form);
		for (const field of form.fields) {
			if (!field.name) continue;
			const error = modules.fieldError(field, data[field.name]);
			if (error) throw new Error(`${questions.get(field) || field.name}: ${error}`);
		}
	}
	return { submission: { action: value.action, data, annotations }, other };
}

async function prepareAttachments(submission: AskFormSubmission, ctx: ToolContext): Promise<void> {
	const count = submission.annotations.reduce((total, annotation) => total + annotation.images.length, 0);
	if (!count) return;
	const model = ctx.models?.current() ?? ctx.model;
	if (!model?.input?.includes("image")) throw new Error(tr("Il modello attuale non supporta immagini. Cambia modello o rimuovi gli allegati.", "The current model does not support images. Change model or remove the attachments."));
	const resizeImage = await loadResizeImage();
	let total = 0;
	for (const annotation of submission.annotations) {
		for (let index = 0; index < annotation.images.length; index++) {
			const original = annotation.images[index];
			const image = await resizeImage(original, { maxBytes: Math.floor(IMAGE_BUDGET * 0.75 / count), excludeWebP: true });
			if (image.decodeFailed) throw new Error(tr("Impossibile leggere un allegato immagine", "An image attachment could not be decoded"));
			total += image.data.length;
			if (total > IMAGE_BUDGET) throw new Error(tr("Gli allegati superano il limite della risposta", "Attachments exceed the response size limit"));
			annotation.images[index] = { type: "image", data: image.data, mimeType: image.mimeType };
		}
	}
}

export default function studioAskExtension(pi: StudioApi): void {
	if (process.env.OMP_STUDIO_ASK !== "1") return;
	let active = false;
	pi.registerTool({
		name: "ask", label: "Ask", approval: "read", strict: true, concurrency: "exclusive", loadMode: "discoverable",
		description: "Ask the user to fill in one HTML <form>. Use semantic HTML: fieldset/legend, labels, radio and checkbox groups, selects, text/number/date/email/url inputs, and textareas. Every control needs a name. Preselect recommendations. Context may contain paragraphs, lists, tables, code, images (HTTP(S), data URI, or project-local file) and inline SVG. Do not add scripts, styles, submit buttons, or file inputs: Studio owns presentation and Submit/Cancel. Radio and checkbox groups automatically get a free-text Other answer. The user can add notes and screenshots to each section. Receive submitted named values as JSON, plus user annotations and actual image content in this same tool result. The form waits for explicit submission; it never submits defaults on inactivity.",
		parameters: pi.zod.object({ html: pi.zod.string().describe("One semantic HTML <form> with named controls") }),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.hasUI || ctx.agent?.kind === "sub" || !ctx.invokeTool) {
				throw new Error(tr("Il modulo richiede la sessione interattiva principale e OMP 18.18.3 o successivo.", "The form requires the main interactive session and OMP 18.18.3 or later."));
			}
			if (active) throw new Error(tr("Una domanda e' gia' aperta: attendi la risposta.", "A question is already open: wait for its answer."));
			active = true;
			// Da omp 19 il contesto UI RPC e' una classe con `formDialog` come getter
			// senza setter: l'assegnazione fallisce, una proprieta' propria lo copre.
			const previous = Object.getOwnPropertyDescriptor(ctx.ui, "formDialog");
			let accepted: AskFormSubmission | undefined;
			let opened = false;
			try {
				// RPC usa lo stesso oggetto pubblico per i tool e per le estensioni.
				// Il tool nativo conserva schema, cancel, steer e bookkeeping.
				const studioFormDialog: StudioUi["formDialog"] = async (html, options) => {
					opened = true;
					// Il parser canonico arriva a runtime: se manca, il tool nativo
					// ricade da solo sulla propria superficie e l'errore e' esplicito.
					const modules = await loadFormModules();
					const form = modules.parseHtmlForm(html);
					const questions = Object.fromEntries([...modules.fieldQuestions(form)].map(([field, question]) => [field.name, question]));
					await prepareForm(form, ctx.cwd || process.cwd(), options?.signal ?? signal);
					const request: AskFormRequest = {
						version: 1, toolCallId, title: tr("Domanda dell'agente", "Agent question"), html,
						form: { ...form, questions }, defaults: modules.defaultFormData(form)
					};
					for (;;) {
						const answer = await ctx.ui.editor(`${TITLE_PREFIX}${JSON.stringify({ version: 1, toolCallId })}`, JSON.stringify(request), { signal: options?.signal ?? signal });
						if (answer === undefined) return undefined;
						try {
							const parsed = readSubmission(answer, form, modules, (draft) => { request.draft = draft; });
							await prepareAttachments(parsed.submission, ctx);
							accepted = parsed.submission;
							return { data: accepted.data };
						} catch (error) {
							if ((options?.signal ?? signal)?.aborted) throw error;
							request.error = error instanceof Error ? error.message : tr("Risposta non valida", "Invalid response");
						}
					}
				};
				Object.defineProperty(ctx.ui, "formDialog", { value: studioFormDialog, writable: true, configurable: true, enumerable: true });
				const result = await ctx.invokeTool({ html: params.html }, { signal, onUpdate });
				if (!opened && !result.isError && !(Array.isArray(result.details?.answers) && result.details.answers.length === 0)) {
					throw new Error(tr("OMP non ha aperto la superficie form di Studio.", "OMP did not open Studio's form surface."));
				}
				if (!accepted) return result;
				const content: (TextPart | ImagePart)[] = accepted.action === "delegate"
					? [{ type: "text" as const, text: `The user explicitly delegates this decision to you. Current form values (not a completed confirmation):\n${JSON.stringify(accepted.data, null, 2)}` }]
					: [...result.content];
				const annotations: { field: string; note: string; imageCount: number; imageIndices: number[] }[] = [];
				for (const annotation of accepted.annotations) {
					const question = result.details && Array.isArray(result.details.answers)
						? (result.details.answers as { name: string; question: string }[]).find((answer) => answer.name === annotation.field)?.question
						: undefined;
					const caption = question || annotation.field;
					if (annotation.note.trim()) content.push({ type: "text", text: `User note — ${caption}:\n${annotation.note}` });
					const imageIndices: number[] = [];
					for (const image of annotation.images) {
						content.push({ type: "text", text: `User attachment — ${caption}` });
						imageIndices.push(content.length);
						content.push(image);
					}
					annotations.push({ field: annotation.field, note: annotation.note, imageCount: annotation.images.length, imageIndices });
				}
				return { ...result, content, details: { ...result.details, annotations, delegated: accepted.action === "delegate" } };
			} finally {
				// Prima lo sblocco: un ripristino fallito non deve lasciare la domanda aperta.
				active = false;
				if (previous) Object.defineProperty(ctx.ui, "formDialog", previous);
				else delete ctx.ui.formDialog;
			}
		}
	});
}
