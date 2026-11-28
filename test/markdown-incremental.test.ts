import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import {
	IncrementalMarkdownLexer,
	lexMarkdown,
	lexMarkdownStreaming,
	stableMarkdownPrefix
} from '../src/lib/agent/markdown.ts';
import { parseReveal, type RevealResult } from '../src/lib/agent/reveal.ts';

/**
 * Un testo che cresce deve produrre, a ogni prefisso, gli stessi token del lex
 * completo: e' il contratto della lessicazione incrementale dello streaming
 * (S5-04). Confrontiamo i token interi (non solo i tipi): un confine scelto
 * male cambia il contenuto di un blocco, e a schermo si vedrebbe come una
 * tabella che diventa paragrafo a meta' frase.
 */
function fullLex(text: string) {
	return marked.lexer(text, { gfm: true, breaks: true });
}

function assertSameTokens(actual: unknown, expected: unknown, where: string): void {
	assert.deepEqual(
		JSON.parse(JSON.stringify(actual)),
		JSON.parse(JSON.stringify(expected)),
		where
	);
}

const CASES: Record<string, string> = {
	paragrafi: 'Prima frase. Seconda frase con `codice`.\n\nNuovo paragrafo *corsivo*.\n\n# Titolo\n\nAltro testo.',
	fence: 'Ecco il codice:\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nFine del blocco.',
	fenceNonChiusa: 'Apro:\n\n```js\nfunction x() {\n  return 1;\n}\n',
	listeAnnidate: 'Punti:\n\n- uno\n  - annidato\n  - altro\n- due\n\n1. primo\n2. secondo\n\nTesto dopo.',
	listaSciolta: '- a\n\n- b\n\n- c\n\ntesto finale',
	tabelle: 'Tabella:\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nDopo la tabella.',
	blockquote: '> citazione\n> seconda riga\n\nTesto.\n\n> altra\n\n- elenco\n- qui',
	html: '<div class="x">\n\nTesto dentro.\n\n</div>\n\nDopo.',
	htmlPre: '<pre>\n\nriga\n\nriga2\n\n</pre>\n\ndopo',
	commentoHtml: '<!-- nota\n\nancora -->\n\nTesto.',
	setext: 'Titolo\n===\n\nTesto\n---\n\ndopo',
	codiceIndentato: '    primo\n\n    secondo\n\ntesto',
	definizioniLink: 'Vedi [a] e [b].\n\n[a]: https://example.com\n[b]: https://example.org\n\ndopo',
	regole: '---\n\n***\n\ntesto',
	misto:
		'# H1\n\nPara uno.\n\n## H2\n\n1. primo\n2. secondo\n\n```py\nprint(1)\n```\n\n> nota\n\nUltimo.'
};

describe('lessicazione markdown incrementale (S5-04)', () => {
	for (const [name, text] of Object.entries(CASES)) {
		it(`carattere per carattere coincide col lex completo: ${name}`, () => {
			const lexer = new IncrementalMarkdownLexer();
			for (let i = 0; i <= text.length; i++) {
				const part = text.slice(0, i);
				assertSameTokens(lexer.lex(part), fullLex(part), `${name} a ${i} caratteri`);
			}
		});
	}

	it('conferma che il percorso completo e quello incrementale rendono la stessa rivelazione', () => {
		// Il testo finale deve dare lo stesso albero di rivelazione: `parseReveal`
		// riceve i token dal percorso incrementale e non deve accorgersene.
		for (const [name, text] of Object.entries(CASES)) {
			const lexer = new IncrementalMarkdownLexer();
			const incremental = parseReveal(text, true, lexMarkdownStreaming(lexer, text));
			const complete = parseReveal(text, true, fullLex(text));
			// `pendingChars` e' una funzione: la si valuta prima del confronto.
			const shape = (result: RevealResult) => ({
				blocks: result.blocks,
				units: result.units,
				totalUnits: result.totalUnits,
				completeUnits: result.completeUnits,
				tailComplete: result.tailComplete,
				hasOpenCodeFence: result.hasOpenCodeFence,
				pending: result.pendingChars(0)
			});
			assertSameTokens(shape(incremental), shape(complete), name);
		}
	});

	it('non ripete il lex completo quando parseReveal chiede gli stessi token', () => {
		// Nello stesso giro il template mostra `throttledTokens` e `parseReveal`
		// rilegge il testo: il secondo lex completo annullerebbe il risparmio.
		const lexer = new IncrementalMarkdownLexer();
		const text = 'Uno.\n\n```js\nconst a = 1;\n```\n\nDue.';
		const streamed = lexMarkdownStreaming(lexer, text);
		assert.equal(lexMarkdown(text), streamed);
	});

	it('riparte da zero quando il testo non e piu\' un\'estensione del precedente', () => {
		const lexer = new IncrementalMarkdownLexer();
		const first = 'Primo testo.\n\nSecondo paragrafo.';
		lexer.lex(first);
		const rewritten = 'Tutt\'altro testo, riscritto da capo.\n\nCon un secondo blocco.';
		assertSameTokens(lexer.lex(rewritten), fullLex(rewritten), 'testo riscritto');
		// Anche un testo piu' corto dello stabile gia' visto deve ripartire.
		assertSameTokens(lexer.lex('Corto.'), fullLex('Corto.'), 'testo accorciato');
	});

	it('non taglia prima di una lista che continua o di un blocco indentato', () => {
		// I casi in cui una riga vuota non chiude il blocco: il confine deve
		// restare indietro, altrimenti marked legge due documenti diversi.
		for (const text of ['- a\n\n- b\n', '- a\n\n  continuazione\n', '> a\nlazy\n', 'Titolo\n\n===\n']) {
			const cut = stableMarkdownPrefix(text);
			assert.ok(cut <= text.length, `confine oltre la fine per ${JSON.stringify(text)}`);
			assertSameTokens(fullLex(text.slice(0, cut)), fullLex(text.slice(0, cut)), text);
			// Il prefisso scelto deve essere indipendente dalla coda: lexare
			// prefisso e coda separatemente deve dare il documento intero.
			const joined = [...fullLex(text.slice(0, cut)), ...fullLex(text.slice(cut))];
			assertSameTokens(joined, fullLex(text), `prefisso+coda per ${JSON.stringify(text)}`);
		}
	});

	it('non trattiene memoria: due documenti diversi non si mescolano', () => {
		const lexer = new IncrementalMarkdownLexer();
		lexer.lex('```\nonA\n```\n\nfine\n');
		const other = 'Nuovo documento.\n\n- elenco\n- qui';
		assertSameTokens(lexer.lex(other), fullLex(other), 'secondo documento');
	});
});
