// Markdown del transcript: token, non HTML.
//
// `marked.lexer()` produce l'albero dei token e i componenti Svelte lo
// rendono. L'HTML grezzo che un modello puo' emettere non entra mai nel DOM,
// quindi non serve un sanitizer: e' una scelta di sicurezza, non di gusto.
// L'unico `{@html}` dell'intero percorso e' il risultato di
// `monaco.editor.colorize`, che produce markup nostro.

import * as monaco from 'monaco-editor';
import { marked, type Token, type Tokens } from 'marked';

export type { Token, Tokens };

/** Token di blocco che il transcript sa rendere; gli altri cadono su testo. */
export type BlockToken = Token;

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
 * Evidenzia un blocco di codice con Monaco, che e' gia' nel bundle: zero
 * dipendenze nuove per l'evidenziazione. Ritorna `null` quando il
 * linguaggio non e' registrato, cosi' il chiamante resta su testo grezzo
 * invece di mostrare markup vuoto.
 */
export async function colorizeCode(code: string, language: string | undefined): Promise<string | null> {
	const requested = (language ?? '').trim().toLowerCase();
	if (!requested) return null;
	const resolved = LANGUAGE_ALIASES[requested] ?? requested;
	const known = monaco.languages.getLanguages().some((entry) => entry.id === resolved);
	if (!known) return null;
	try {
		return await monaco.editor.colorize(code, resolved, { tabSize: 2 });
	} catch {
		return null;
	}
}
