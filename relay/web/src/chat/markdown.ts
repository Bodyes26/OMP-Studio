/**
 * Markdown lexer per il transcript della chat PWA.
 * Produce token marked senza mai ricorrere a {@html} per il testo del modello.
 * Cache LRU a 500 elementi per evitare ricalcoli inutili durante lo scroll.
 */
import { marked, type Token, type Tokens } from 'marked';

export type { Token, Tokens };

const MAX_LEX_CACHE_SIZE = 500;
const lexCache = new Map<string, Token[]>();
const inlineLexCache = new Map<string, Token[]>();

function lexMarkdownUncached(source: string): Token[] {
	if (!source) return [];
	try {
		return marked.lexer(source, { gfm: true, breaks: true });
	} catch {
		return [
			{
				type: 'paragraph',
				raw: source,
				text: source,
				tokens: [{ type: 'text', raw: source, text: source }]
			} as unknown as Token
		];
	}
}

/**
 * Tokenizza il markdown a blocchi (paragrafi, elenchi, tabelle, intestazioni, codice).
 */
export function lexMarkdown(source: string): Token[] {
	if (!source) return [];
	const cached = lexCache.get(source);
	if (cached !== undefined) {
		lexCache.delete(source);
		lexCache.set(source, cached);
		return cached;
	}

	const tokens = lexMarkdownUncached(source);
	if (lexCache.size >= MAX_LEX_CACHE_SIZE) {
		const oldest = lexCache.keys().next().value;
		if (oldest !== undefined) lexCache.delete(oldest);
	}
	lexCache.set(source, tokens);
	return tokens;
}

/**
 * Tokenizza il testo inline (grassetto, corsivo, codice in linea, link).
 */
export function lexMarkdownInline(source: string): Token[] {
	if (!source) return [];
	const cached = inlineLexCache.get(source);
	if (cached !== undefined) {
		inlineLexCache.delete(source);
		inlineLexCache.set(source, cached);
		return cached;
	}

	let tokens: Token[];
	try {
		tokens = marked.Lexer.lexInline(source, { gfm: true, breaks: true });
	} catch {
		tokens = [{ type: 'text', raw: source, text: source } as unknown as Token];
	}

	if (inlineLexCache.size >= MAX_LEX_CACHE_SIZE) {
		const oldest = inlineLexCache.keys().next().value;
		if (oldest !== undefined) inlineLexCache.delete(oldest);
	}
	inlineLexCache.set(source, tokens);
	return tokens;
}
