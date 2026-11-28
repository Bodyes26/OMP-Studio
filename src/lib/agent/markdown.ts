// Markdown del transcript: token, non HTML.
//
// `marked.lexer()` produce l'albero dei token e i componenti Svelte lo
// rendono. L'HTML grezzo che un modello puo' emettere non entra mai nel DOM,
// quindi non serve un sanitizer: e' una scelta di sicurezza, non di gusto.
// L'unico `{@html}` dell'intero percorso e' il risultato di
// `monaco.editor.colorize`, che produce markup nostro.

import { Marked, marked, type Token, type Tokens } from 'marked';
import { findFileMentions, matchFileMentionAt } from './fileMentionSyntax.ts';

export type { Token, Tokens };

/** Token di blocco che il transcript sa rendere; gli altri cadono su testo. */
export type BlockToken = Token;

/**
 * Dimensione massima della cache LRU dei token markdown.
 * Evita ricalcoli sincroni ripetuti nel template per i blocchi di testo statici
 * mantenendo l'occupazione di memoria contenuta (~500 messaggi recenti).
 */
const MAX_LEX_CACHE_SIZE = 500;
const lexCache = new Map<string, Token[]>();

/**
 * Ultimo risultato della lessicazione incrementale, con il testo a cui si
 * riferisce. Nello stesso tick lo chiedono il template (`throttledTokens`) e
 * `parseReveal` (via `lexMarkdown`): senza questa voce singola il secondo
 * rifarebbe il lex completo appena evitato. E' chiavata sul testo esatto,
 * quindi una risposta sbagliata non e' possibile; non entra nella LRU perche'
 * ogni frame la sostituirebbe, spingendo fuori i blocchi statici.
 */
let lastStreamedLex: { source: string; tokens: Token[] } | null = null;

function lexMarkdownUncached(source: string): Token[] {
	if (!source) return [];
	try {
		return marked.lexer(source, { gfm: true, breaks: true });
	} catch {
		// Markdown malformato durante lo streaming: meglio un paragrafo unico
		// che un buco.
		return [{ type: 'paragraph', raw: source, text: source, tokens: [] } as Tokens.Paragraph];
	}
}

/**
 * Tokenizza con cache LRU limitata a 500 voci. `gfm` per tabelle e barrato,
 * `breaks` perche' in chat un ritorno a capo e' un ritorno a capo e non uno spazio.
 */
export function lexMarkdown(source: string): Token[] {
	if (!source) return [];
	// Testo appena lessicato in streaming: `parseReveal` lo richiede nello
	// stesso giro, e rifare il lex completo annullerebbe il risparmio (S5-04).
	if (lastStreamedLex !== null && lastStreamedLex.source === source) return lastStreamedLex.tokens;
	const cached = lexCache.get(source);
	if (cached !== undefined) {
		// Promuove in fondo per la politica LRU di Map
		lexCache.delete(source);
		lexCache.set(source, cached);
		return cached;
	}

	const tokens = lexMarkdownUncached(source);
	if (lexCache.size >= MAX_LEX_CACHE_SIZE) {
		const oldest = lexCache.keys().next().value;
		if (oldest !== undefined) {
			lexCache.delete(oldest);
		}
	}
	lexCache.set(source, tokens);
	return tokens;
}

/**
 * Token del testo in crescita dello streaming: si rilessa solo la coda dopo
 * l'ultimo confine stabile e si riusano i token dei blocchi chiusi (S5-04).
 * `lexer` va tenuto dal chiamante, uno per blocco di testo.
 */
export function lexMarkdownStreaming(lexer: IncrementalMarkdownLexer, source: string): Token[] {
	if (!source) return [];
	const tokens = lexer.lex(source);
	lastStreamedLex = { source, tokens };
	return tokens;
}

/* --------------------------------------------- lessicazione incrementale ---
 *
 * Durante lo streaming il testo cresce di pochi caratteri per volta, ma un
 * lex completo riparte da zero. Qui si riconosce il prefisso "stabile" del
 * testo (l'ultima riga vuota che chiude un blocco senza ambiguita') e si
 * lessica solo la coda: i token dei blocchi chiusi non si ricalcolano e
 * restano nell'istanza invece di finire nella LRU, le cui 500 voci si
 * riempivano di copie quasi identiche del messaggio in crescita.
 *
 * Le condizioni per cui una riga vuota NON chiude un blocco (marked la
 * leggerebbe insieme a quanto segue): dentro una recinzione aperta, dentro un
 * commento o un contenitore raw (`<pre>`, `<script>`, `<style>`, `<textarea>`),
 * prima di una riga indentata (codice o continuazione di lista), prima di un
 * altro elemento della stessa lista (una lista "larga" si fonde) e prima di una
 * sottolineatura Setext (`---` trasforma il paragrafo precedente in titolo).
 * Difetti di definizione dei link e ritorni indietro del testo fanno scattare
 * la via di ripiego: lex completo, come prima.
 */

/** Contenitori HTML che marked legge fino al tag di chiusura. */
const RAW_HTML_CONTAINER = /^<(pre|script|style|textarea)(?:\s|>|$)/i;
const RAW_CONTAINER_CLOSE: Record<string, RegExp> = {
	pre: /<\/pre\s*>/i,
	script: /<\/script\s*>/i,
	style: /<\/style\s*>/i,
	textarea: /<\/textarea\s*>/i
};
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t\r]*$/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
/* `\r` ammesso in coda: un testo arrivato dal filo puo' avere fine riga CRLF, e
   una recinzione di chiusura non riconosciuta lascerebbe aperto il blocco. */
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t\r]*$/;
/** Una definizione `[x]: …` vale per tutto il documento: il prefisso non e' piu' indipendente. */
const LINK_DEFINITION = /(^|\n)[ \t]{0,3}\[[^\]\n]+\]:/;
/** Quanti caratteri di coda del prefisso stabile si ricontrollano a ogni aggiornamento. */
const PREFIX_PROBE = 64;

/**
 * Ultima posizione in cui il testo puo' essere spezzato in due documenti
 * markdown indipendenti: un confine di blocco la cui continuazione non
 * cambierebbe il significato di quanto precede. `from` se non ce n'e' nessuno.
 */
export function stableMarkdownPrefix(source: string, from = 0): number {
	let pos = from;
	let blockStart = from;
	let fence = '';
	let container: string | null = null;
	let inComment = false;
	let listBlock = false;

	while (pos < source.length) {
		const lineEnd = source.indexOf('\n', pos);
		if (lineEnd === -1) break; // ultima riga senza a capo: mai stabile
		const line = source.slice(pos, lineEnd);
		const next = lineEnd + 1;
		const lead = line.trimStart();

		if (fence) {
			const close = FENCE_CLOSE.exec(lead);
			if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = '';
			pos = next;
			continue;
		}
		if (container) {
			if (RAW_CONTAINER_CLOSE[container].test(line)) container = null;
			pos = next;
			continue;
		}
		if (inComment) {
			if (lead.includes('-->')) inComment = false;
			pos = next;
			continue;
		}
		const opened = FENCE_OPEN.exec(lead);
		if (opened) {
			fence = opened[1];
			pos = next;
			continue;
		}

		if (line.trim() === '') {
			// Il confine e' valido solo guardando la prossima riga piena: una
			// continuazione di lista o un blocco indentato assorbono anche la riga vuota.
			let scan = next;
			let nextStart = -1;
			let nextLine = '';
			while (scan < source.length) {
				const end = source.indexOf('\n', scan);
				if (end === -1) break;
				const candidate = source.slice(scan, end);
				if (candidate.trim() !== '') {
					nextStart = scan;
					nextLine = candidate;
					break;
				}
				scan = end + 1;
			}
			if (nextStart === -1) break; // coda incompleta: nessun confine
			const nextLead = nextLine.trimStart();
			const indented = /^[ \t]/.test(nextLine);
			const startsList = LIST_MARKER.test(nextLead);
			const rawTag = RAW_HTML_CONTAINER.test(nextLead) || nextLead.startsWith('<!--');
			const safe = !indented && !startsList && !listBlock && !rawTag && !SETEXT_UNDERLINE.test(nextLead);
			if (safe) return nextStart;
			blockStart = nextStart;
			listBlock = false;
			pos = nextStart;
			continue;
		}

		if (pos === blockStart) listBlock = LIST_MARKER.test(lead);
		const tag = RAW_HTML_CONTAINER.exec(lead);
		if (tag) {
			const name = tag[1].toLowerCase();
			if (!RAW_CONTAINER_CLOSE[name].test(line)) container = name;
		}
		if (lead.startsWith('<!--') && !lead.includes('-->')) inComment = true;
		pos = next;
	}
	return from;
}

/**
 * Lessicatore incrementale di un testo che cresce (un messaggio in streaming).
 * Un'istanza per blocco di testo: quando il testo non e' piu' un'estensione di
 * quello gia' visto (nuovo blocco, riscrittura) riparte da zero.
 */
export class IncrementalMarkdownLexer {
	#stable = '';
	#tokens: Token[] = [];

	/** Token del testo dato, riusando quelli dei blocchi gia' chiusi. */
	lex(source: string): Token[] {
		if (!source) {
			this.#stable = '';
			this.#tokens = [];
			return [];
		}
		if (!source.startsWith(this.#stable)) {
			this.#stable = '';
			this.#tokens = [];
		}
		// Una definizione di link vale per tutto il documento: nessun prefisso e'
		// indipendente dalla coda, quindi si torna al lex completo.
		if (LINK_DEFINITION.test(source)) {
			this.#stable = '';
			this.#tokens = [];
			return lexMarkdown(source);
		}
		if (this.#stable) {
			const probe = Math.min(PREFIX_PROBE, this.#stable.length);
			if (source.slice(this.#stable.length - probe, this.#stable.length) !== this.#stable.slice(-probe)) {
				this.#stable = '';
				this.#tokens = [];
			}
		}
		const boundary = stableMarkdownPrefix(source, this.#stable.length);
		if (boundary > this.#stable.length) {
			const chunk = source.slice(this.#stable.length, boundary);
			if (chunk) this.#tokens = this.#tokens.concat(lexMarkdownUncached(chunk));
			this.#stable = source.slice(0, boundary);
		}
		const tail = source.slice(this.#stable.length);
		if (!tail) return this.#tokens;
		// La coda si rilessa sempre: e' l'unica parte che puo' cambiare, e la sua
		// lessicazione non deve sporcare la LRU con testi parziali.
		return this.#tokens.concat(lexMarkdownUncached(tail));
	}
}

/**
 * Tokenizza testo inline per messaggi utente o frammenti brevi.
 */
export function lexMarkdownInline(source: string): Token[] {
	if (!source) return [];
	try {
		return marked.Lexer.lexInline(source, { gfm: true, breaks: true });
	} catch {
		return [{ type: 'text', raw: source, text: source } as Tokens.Text];
	}
}

/** Menzione `@percorso` riconosciuta nel testo scritto dall'utente. */
export interface FileMentionToken {
	type: 'fileMention';
	raw: string;
	path: string;
}

/** Menzione `/comando` o `/skill` riconosciuta nel testo scritto dall'utente. */
export interface CommandMentionToken {
	type: 'commandMention';
	raw: string;
	name: string;
}

// Istanza separata: le menzioni valgono solo nel testo scritto dall'utente
// (bolle, anteprime dei task), non nelle risposte del modello o dei tool.
// Come estensione di marked, e non come passata sul testo, la menzione vince
// sull'enfasi: `@src/__init__.py` resta un percorso e non diventa grassetto.
const mentionMarked = new Marked({
	gfm: true,
	breaks: true,
	extensions: [
		{
			name: 'fileMention',
			level: 'inline',
			start: (src: string) => findFileMentions(src)[0]?.start,
			tokenizer(src: string, tokens: Token[]): FileMentionToken | undefined {
				// La @ vale solo a inizio testo o dopo uno spazio (niente email).
				const previous = tokens.at(-1)?.raw;
				if (previous && !/\s$/.test(previous)) return undefined;
				const match = matchFileMentionAt(src);
				return match ? { type: 'fileMention', raw: match.raw, path: match.path } : undefined;
			}
		},
		{
			name: 'commandMention',
			level: 'inline',
			start: (src: string) => {
				const match = /(?:^|\s)\/([a-zA-Z][a-zA-Z0-9_:-]*)/.exec(src);
				if (!match) return undefined;
				return match.index + (match[0].startsWith('/') ? 0 : 1);
			},
			tokenizer(src: string, tokens: Token[]): CommandMentionToken | undefined {
				if (src.charCodeAt(0) !== 47 /* / */) return undefined;
				const previous = tokens.at(-1)?.raw;
				if (previous && !/\s$/.test(previous)) return undefined;
				const match = /^\/([a-zA-Z][a-zA-Z0-9_:-]*)/.exec(src);
				return match ? { type: 'commandMention', raw: match[0], name: match[1] } : undefined;
			}
		}
	]
});

const mentionInlineLexCache = new Map<string, Token[]>();

/** Come `lexMarkdownInline`, con le menzioni `@file` come token `fileMention`. Con cache LRU. */
export function lexMarkdownInlineWithMentions(source: string): Token[] {
	if (!source) return [];
	const cached = mentionInlineLexCache.get(source);
	if (cached !== undefined) {
		mentionInlineLexCache.delete(source);
		mentionInlineLexCache.set(source, cached);
		return cached;
	}

	let tokens: Token[];
	try {
		tokens = mentionMarked.Lexer.lexInline(source, mentionMarked.defaults);
	} catch {
		tokens = [{ type: 'text', raw: source, text: source } as Tokens.Text];
	}

	if (mentionInlineLexCache.size >= MAX_LEX_CACHE_SIZE) {
		const oldest = mentionInlineLexCache.keys().next().value;
		if (oldest !== undefined) {
			mentionInlineLexCache.delete(oldest);
		}
	}
	mentionInlineLexCache.set(source, tokens);
	return tokens;
}

const mentionLexCache = new Map<string, Token[]>();

/**
 * Come `lexMarkdown`, con supporto ai blocchi completi e alle menzioni `@file` e `/comando`.
 * Utilizzato per anteprime e lettura dettagliata dei prompt nella coda dei task.
 */
export function lexMarkdownWithMentions(source: string): Token[] {
	if (!source) return [];
	const cached = mentionLexCache.get(source);
	if (cached !== undefined) {
		mentionLexCache.delete(source);
		mentionLexCache.set(source, cached);
		return cached;
	}

	let tokens: Token[];
	try {
		tokens = mentionMarked.lexer(source);
	} catch {
		tokens = [{ type: 'paragraph', raw: source, text: source, tokens: [] } as Tokens.Paragraph];
	}

	if (mentionLexCache.size >= MAX_LEX_CACHE_SIZE) {
		const oldest = mentionLexCache.keys().next().value;
		if (oldest !== undefined) {
			mentionLexCache.delete(oldest);
		}
	}
	mentionLexCache.set(source, tokens);
	return tokens;
}

/** Alias dei linguaggi verso gli id che Monaco conosce. */
const LANGUAGE_ALIASES: Record<string, string> = {
	ts: 'typescript',
	tsx: 'typescript',
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	py: 'python',
	rs: 'rust',
	sh: 'shell',
	bash: 'shell',
	zsh: 'shell',
	ps1: 'powershell',
	powershell: 'powershell',
	yml: 'yaml',
	md: 'markdown',
	'c#': 'csharp',
	cs: 'csharp',
	vb: 'vb',
	html: 'html',
	svelte: 'html',
	json: 'json',
	sql: 'sql',
	toml: 'ini',
	ini: 'ini',
	diff: 'diff',
	dockerfile: 'dockerfile',
	go: 'go',
	java: 'java',
	kt: 'kotlin',
	rb: 'ruby',
	php: 'php',
	xml: 'xml',
	css: 'css',
	scss: 'scss'
};

/**
 * Evidenzia un blocco di codice con Monaco.
 *
 * L'import statico qui non puo' funzionare come confine di caricamento: il
 * modulo del markdown viene caricato all'avvio della chat e trascinerebbe con
 * se' i 4 MB di Monaco anche quando nessun messaggio contiene codice. Il
 * caricamento dinamico e' l'unico modo di tenerli fuori dal primo frame.
 */
const MAX_COLORIZE_CACHE = 200;
let themeWatched = false;
const colorizeCache = new Map<string, string>();

/**
 * Ritorna l'HTML evidenziato in cache LRU se gia' presente, evitando attese asincrone.
 */
export function getCachedColorizedCode(code: string, language: string | undefined): string | null {
	const requested = (language ?? '').trim().toLowerCase();
	if (!requested) return null;
	const resolved = LANGUAGE_ALIASES[requested] ?? requested;
	const cacheKey = `${resolved}:${code}`;
	const cached = colorizeCache.get(cacheKey);
	if (cached !== undefined) {
		colorizeCache.delete(cacheKey);
		colorizeCache.set(cacheKey, cached);
		return cached;
	}
	return null;
}

export async function colorizeCode(code: string, language: string | undefined): Promise<string | null> {
	const requested = (language ?? '').trim().toLowerCase();
	if (!requested) return null;
	const resolved = LANGUAGE_ALIASES[requested] ?? requested;
	const cacheKey = `${resolved}:${code}`;
	const cached = colorizeCache.get(cacheKey);
	if (cached !== undefined) {
		colorizeCache.delete(cacheKey);
		colorizeCache.set(cacheKey, cached);
		return cached;
	}

	// Caricamento dinamico: Monaco pesa diversi megabyte e non deve essere
	// caricato nel frame iniziale prima che un messaggio contenga codice.
	const monaco = await import('monaco-editor');
	const { ensureMonacoTheme } = await import('#lib/editor/monaco.ts');
	if (!themeWatched) {
		themeWatched = true;
		// Le classi mtkN dipendono dalla mappa colori del tema: l'HTML in cache
		// colorato col tema precedente andrebbe rimappato male.
		const { onThemeChange } = await import('#lib/theme.ts');
		onThemeChange(() => colorizeCache.clear());
	}
	ensureMonacoTheme();
	const known = monaco.languages.getLanguages().some((entry) => entry.id === resolved);
	if (!known) return null;
	try {
		const html = await monaco.editor.colorize(code, resolved, { tabSize: 2 });
		if (colorizeCache.size >= MAX_COLORIZE_CACHE) {
			const oldest = colorizeCache.keys().next().value;
			if (oldest !== undefined) {
				colorizeCache.delete(oldest);
			}
		}
		colorizeCache.set(cacheKey, html);
		return html;
	} catch {
		return null;
	}
}

export type FilePathItem = {
	raw: string;
	path: string;
	line: number | null;
};

/** Estensioni file comuni per riconoscimento percorsi senza slash. */
const KNOWN_FILE_EXTENSIONS = new Set([
	'sql', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'svelte', 'rs', 'toml',
	'json', 'jsonc', 'md', 'mdx', 'txt', 'html', 'css', 'scss', 'yaml', 'yml',
	'ini', 'env', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'py', 'rb', 'php',
	'java', 'kt', 'go', 'c', 'cpp', 'h', 'hpp', 'cs', 'vb', 'xml', 'svg',
	'lock', 'log'
]);

/** Prefissi di comandi CLI comuni da escludere. */
const CLI_COMMAND_PREFIXES = [
	'git ', 'npm ', 'bun ', 'cargo ', 'pnpm ', 'yarn ', 'cd ', 'mkdir ',
	'rm ', 'cp ', 'mv ', 'cat ', 'ls ', 'dir ', 'echo ', 'curl ', 'wget ',
	'node ', 'python ', 'pip ', 'docker ', 'gh ', 'dotnet ', 'npx '
];

/** Parole chiave che iniziano uno statement di codice o query (seguite da spazio o parentesi). */
const CODE_STATEMENT_START_RE = /^(?:select|insert|update|delete|create|drop|alter|exec|execute|begin|commit|rollback|where|from|order\s+by|group\s+by|having|join|inner\s+join|left\s+join|right\s+join|values|set|import|export|function|class|const|let|var|return|interface|def|public|private|protected|package|namespace)(?:\s+|\()/i;
/**
 * Analizza una singola riga di testo per verificare se rappresenta un percorso file.
 * Supporta percorsi relativi o assoluti (POSIX/Windows), numeri di riga (:42 o #L42),
 * nomi con parentesi quadre (es. [seed_...].sql) e virgolette di delimitazione.
 */
export function parseFilePathLine(rawLine: string): FilePathItem | null {
	if (!rawLine) return null;
	let trimmed = rawLine.trim();
	if (!trimmed || trimmed.includes('\n')) return null;

	// Rimuovi eventuali delimitatori esterni di quotatura o parentesi
	if (
		(trimmed.startsWith('`') && trimmed.endsWith('`')) ||
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'")) ||
		(trimmed.startsWith('<') && trimmed.endsWith('>'))
	) {
		trimmed = trimmed.slice(1, -1).trim();
	}

	if (!trimmed) return null;

	// Escludi comandi da terminale
	const lower = trimmed.toLowerCase();
	for (const prefix of CLI_COMMAND_PREFIXES) {
		if (lower.startsWith(prefix)) return null;
	}

	// Escludi istruzioni di codice che iniziano con parole chiave evidenti
	if (CODE_STATEMENT_START_RE.test(trimmed)) return null;

	// Escludi operatori e caratteri tipici di codice non compatibili con percorsi
	// Nota: [ e ] sono ammessi nei nomi di file (es. [seed_...].sql o [id].svelte)
	if (/[{};=><!+*&|^~?]|\/\*|\*\/|\/\/|::/.test(trimmed)) return null;

	// Estrai numero di riga se presente (:42, :42:10, #L42, #42, :42-80)
	let line: number | null = null;
	let pathCandidate = trimmed;

	const lineColonMatch = pathCandidate.match(/:(\d+)(?::\d+|-?\d*)?$/);
	if (lineColonMatch && typeof lineColonMatch.index === 'number') {
		const parsed = parseInt(lineColonMatch[1], 10);
		if (!Number.isNaN(parsed) && parsed > 0) {
			line = parsed;
			pathCandidate = pathCandidate.slice(0, lineColonMatch.index).trim();
		}
	} else {
		const hashMatch = pathCandidate.match(/#(?:L)?(\d+)(?:-\d+)?$/i);
		if (hashMatch && typeof hashMatch.index === 'number') {
			const parsed = parseInt(hashMatch[1], 10);
			if (!Number.isNaN(parsed) && parsed > 0) {
				line = parsed;
				pathCandidate = pathCandidate.slice(0, hashMatch.index).trim();
			}
		}
	}

	if (!pathCandidate) return null;

	// Deve avere slash/backslash OPPURE un'estensione nota/riconoscibile
	const hasSlash = pathCandidate.includes('/') || pathCandidate.includes('\\');
	const extMatch = pathCandidate.match(/\.([a-zA-Z0-9_-]{1,10})$/);
	const ext = extMatch ? extMatch[1].toLowerCase() : null;

	if (hasSlash) {
		// Non deve essere una cartella nuda che finisce con slash senza nome file
		if (pathCandidate.endsWith('/') || pathCandidate.endsWith('\\')) return null;
		// Se contiene spazi, non deve sembrare una frase (non più di 1 spazio consecutivo e max 3 parole)
		if (pathCandidate.includes(' ') && pathCandidate.split(/\s+/).length > 3) return null;
		return { raw: rawLine.trim(), path: pathCandidate, line };
	}

	// Se non ha slash, deve avere un'estensione valida (o nota) e niente spazi
	if (ext && !pathCandidate.includes(' ')) {
		if (KNOWN_FILE_EXTENSIONS.has(ext) || ext.length >= 2) {
			// Evita falsi positivi con abbreviazioni come e.g., i.e.
			if (pathCandidate === 'e.g.' || pathCandidate === 'i.e.') return null;
			return { raw: rawLine.trim(), path: pathCandidate, line };
		}
	}

	return null;
}

/**
 * Verifica se un intero blocco di codice rappresenta una lista di percorsi file.
 * Ritorna l'array di percorsi solo se TUTTE le righe non vuote sono percorsi validi.
 */
export function detectFilePathBlock(text: string, _lang?: string): FilePathItem[] | null {
	if (!text) return null;
	const rawLines = text.split('\n');
	const items: FilePathItem[] = [];

	for (const rawLine of rawLines) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue; // Ignora righe vuote interne o finali
		const parsed = parseFilePathLine(trimmed);
		if (!parsed) return null; // Se anche una sola riga non e' un percorso, non e' un blocco file
		items.push(parsed);
	}

	return items.length > 0 ? items : null;
}
