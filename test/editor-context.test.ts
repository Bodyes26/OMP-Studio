import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	EDITOR_CONTEXT_MARKER,
	formatEditorContext,
	parseEditorContext,
	splitMessageAndEditorContext,
	stripEditorContext
} from '../src/lib/editor/editorContextParsing.ts';

describe('Editor Context: parsing, split e formattazione', () => {
	describe('formatEditorContext', () => {
		it('ritorna null se non ci sono file aperti né file attivo', () => {
			assert.equal(formatEditorContext([], null), null);
		});

		it('formatta solo i file aperti', () => {
			const res = formatEditorContext(['src/app.ts', 'src/lib.ts'], null);
			assert.ok(res?.includes(EDITOR_CONTEXT_MARKER));
			assert.ok(res?.includes('- Open files: `src/app.ts`, `src/lib.ts`'));
			assert.ok(!res?.includes('- Active file:'));
		});

		it('formatta file attivo con posizione cursore', () => {
			const res = formatEditorContext(['src/app.ts'], 'src/app.ts', { line: 42, column: 10 });
			assert.ok(res?.includes('- Active file: `src/app.ts` (line 42, col 10)'));
		});

		it('formatta selezione attiva con codice e range di righe', () => {
			const res = formatEditorContext(
				['src/app.ts'],
				'src/app.ts',
				{ line: 10 },
				{ text: 'const answer = 42;', startLine: 10, endLine: 12 }
			);
			assert.ok(res?.includes('- Active selection in `src/app.ts` (lines 10-12):'));
			assert.ok(res?.includes('```\nconst answer = 42;\n```'));
		});
	});

	describe('parseEditorContext', () => {
		it('parsa correttamente open files, file attivo e selezione', () => {
			const raw = `${EDITOR_CONTEXT_MARKER}
- Open files: \`src/main.rs\`, \`src/lib.rs\`
- Active file: \`src/main.rs\` (line 42, col 10)
- Active selection in \`src/main.rs\` (lines 40-50):
\`\`\`
fn main() {
    println!("hello");
}
\`\`\``;
			const parsed = parseEditorContext(raw);
			assert.ok(parsed);
			assert.deepEqual(parsed.openFiles, ['src/main.rs', 'src/lib.rs']);
			assert.equal(parsed.activeFile, 'src/main.rs');
			assert.deepEqual(parsed.cursor, { line: 42, column: 10 });
			assert.ok(parsed.selection);
			assert.equal(parsed.selection.file, 'src/main.rs');
			assert.equal(parsed.selection.lineRange, 'lines 40-50');
			assert.equal(parsed.selection.startLine, 40);
			assert.equal(parsed.selection.text, 'fn main() {\n    println!("hello");\n}');
		});

		it('gestisce backtick all\'interno del codice selezionato', () => {
			const raw = `${EDITOR_CONTEXT_MARKER}
- Active file: \`src/test.ts\` (line 12, col 1)
- Active selection in \`src/test.ts\` (line 12):
\`\`\`ts
const x = \`hello \${world}\`;
\`\`\``;
			const parsed = parseEditorContext(raw);
			assert.ok(parsed);
			assert.equal(parsed.activeFile, 'src/test.ts');
			assert.ok(parsed.selection);
			assert.equal(parsed.selection.text, 'const x = `hello ${world}`;');
		});

		it('supporta ritorni a capo Windows CRLF', () => {
			const raw = `${EDITOR_CONTEXT_MARKER}\r\n- Open files: \`index.html\`\r\n- Active file: \`index.html\` (line 1)\r\n`;
			const parsed = parseEditorContext(raw);
			assert.ok(parsed);
			assert.deepEqual(parsed.openFiles, ['index.html']);
			assert.equal(parsed.activeFile, 'index.html');
			assert.deepEqual(parsed.cursor, { line: 1, column: undefined });
		});

		it('restituisce null se non contiene elementi validi', () => {
			assert.equal(parseEditorContext(''), null);
			assert.equal(parseEditorContext('[Editor Context]\nnessun dato valido'), null);
		});
	});

	describe('splitMessageAndEditorContext', () => {
		it('preserva messaggi senza marcatore di contesto', () => {
			const text = 'Ciao, come stai?';
			const res = splitMessageAndEditorContext(text);
			assert.equal(res.userMessage, text);
			assert.equal(res.context, null);
			assert.equal(res.rawContext, null);
		});

		it('separa il messaggio utente dal contesto editor', () => {
			const text = `Come rifattorizzo questa funzione?

${EDITOR_CONTEXT_MARKER}
- Open files: \`src/auth.ts\`
- Active file: \`src/auth.ts\` (line 20)
- Active selection in \`src/auth.ts\` (lines 20-30):
\`\`\`
export function login() {}
\`\`\``;
			const res = splitMessageAndEditorContext(text);
			assert.equal(res.userMessage, 'Come rifattorizzo questa funzione?');
			assert.ok(res.context);
			assert.equal(res.context.activeFile, 'src/auth.ts');
			assert.equal(res.context.selection?.text, 'export function login() {}');
		});

		it('gestisce prompt contenente solo contesto editor', () => {
			const text = `${EDITOR_CONTEXT_MARKER}\n- Open files: \`test.py\``;
			const res = splitMessageAndEditorContext(text);
			assert.equal(res.userMessage, '');
			assert.ok(res.context);
			assert.deepEqual(res.context.openFiles, ['test.py']);
		});
	});

	describe('stripEditorContext', () => {
		it('rimuove il blocco di contesto lasciando solo il messaggio utente', () => {
			const text = `Domanda utente\n\n${EDITOR_CONTEXT_MARKER}\n- Open files: \`a.ts\``;
			assert.equal(stripEditorContext(text), 'Domanda utente');
		});

		it('non altera messaggi privi del marcatore', () => {
			const text = 'Messaggio semplice';
			assert.equal(stripEditorContext(text), 'Messaggio semplice');
		});
	});
});
