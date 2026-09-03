// Markdown del transcript: token, non HTML.
//
// `marked.lexer()` produce l'albero dei token e i componenti Svelte lo
// rendono. L'HTML grezzo che un modello puo' emettere non entra mai nel DOM,
// quindi non serve un sanitizer: e' una scelta di sicurezza, non di gusto.
// L'unico `{@html}` dell'intero percorso e' il risultato di
// `monaco.editor.colorize`, che produce markup nostro.

import { marked, type Token, type Tokens } from 'marked';

export type { Token, Tokens };

/** Token di blocco che il transcript sa rendere; gli altri cadono su testo. */
export type BlockToken = Token;

/**
 * Dissolvenza della coda del testo in arrivo. Non e' un'animazione CSS: e' una
 * funzione della distanza dalla testa di lettura, quindi riparsare il markdown
 * non fa ripartire nulla e i caratteri non lampeggiano.
 */
export type StreamFade = {
	/** Di quanti caratteri la testa di lettura ha superato la fine del testo. */
	over: number;
	/** Ampiezza in caratteri della rampa di opacita'. */
	window: number;
};

/**
 * Tokenizza. `gfm` per tabelle e barrato, `breaks` perche' in chat un
 * ritorno a capo e' un ritorno a capo e non uno spazio.
 */
export function lexMarkdown(source: string): Token[] {
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
export async function colorizeCode(code: string, language: string | undefined): Promise<string | null> {
	const requested = (language ?? '').trim().toLowerCase();
	if (!requested) return null;
	const resolved = LANGUAGE_ALIASES[requested] ?? requested;
	const monaco = await import('monaco-editor');
	const known = monaco.languages.getLanguages().some((entry) => entry.id === resolved);
	if (!known) return null;
	try {
		return await monaco.editor.colorize(code, resolved, { tabSize: 2 });
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
