import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilePathLine, detectFilePathBlock } from '../src/lib/agent/markdown.ts';

describe('Rilevamento percorsi file nei blocchi di codice Markdown', () => {
	describe('parseFilePathLine', () => {
		it('riconosce percorsi SQL con parentesi quadre nel nome (caso screenshot utente)', () => {
			const item = parseFilePathLine('sql/03_seed/[seed_CAI_ParametriConcordato_Racconigi2020].sql');
			assert.ok(item !== null);
			assert.equal(item.path, 'sql/03_seed/[seed_CAI_ParametriConcordato_Racconigi2020].sql');
			assert.equal(item.line, null);
		});

		it('riconosce percorsi con backslash in stile Windows', () => {
			const item = parseFilePathLine('sql\\03_seed\\[seed_CAI_ParametriConcordato_Racconigi2020].sql');
			assert.ok(item !== null);
			assert.equal(item.path, 'sql\\03_seed\\[seed_CAI_ParametriConcordato_Racconigi2020].sql');
			assert.equal(item.line, null);
		});

		it('estrae numeri di riga in vari formati (:42, :42:10, #L42)', () => {
			const item1 = parseFilePathLine('src/lib/editor/Editor.svelte:75');
			assert.ok(item1 !== null);
			assert.equal(item1.path, 'src/lib/editor/Editor.svelte');
			assert.equal(item1.line, 75);

			const item2 = parseFilePathLine('src/lib/editor/Editor.svelte:75:10');
			assert.ok(item2 !== null);
			assert.equal(item2.path, 'src/lib/editor/Editor.svelte');
			assert.equal(item2.line, 75);

			const item3 = parseFilePathLine('src/lib/editor/Editor.svelte#L120');
			assert.ok(item3 !== null);
			assert.equal(item3.path, 'src/lib/editor/Editor.svelte');
			assert.equal(item3.line, 120);
		});

		it('supporta percorsi racchiusi da backtick o virgolette', () => {
			const item1 = parseFilePathLine('`src/lib/agent/markdown.ts`');
			assert.ok(item1 !== null);
			assert.equal(item1.path, 'src/lib/agent/markdown.ts');

			const item2 = parseFilePathLine('"src/lib/agent/markdown.ts"');
			assert.ok(item2 !== null);
			assert.equal(item2.path, 'src/lib/agent/markdown.ts');
		});

		it('riconosce file isolati con estensioni note', () => {
			const item = parseFilePathLine('package.json');
			assert.ok(item !== null);
			assert.equal(item.path, 'package.json');
			assert.equal(item.line, null);
		});

		it('rifiuta comandi da terminale (CLI)', () => {
			assert.equal(parseFilePathLine('npm run build'), null);
			assert.equal(parseFilePathLine('git status --short'), null);
			assert.equal(parseFilePathLine('cd src/lib'), null);
			assert.equal(parseFilePathLine('cargo check'), null);
			assert.equal(parseFilePathLine('dotnet publish'), null);
		});

		it('rifiuta istruzioni di codice (SQL, JS, TS, ecc.)', () => {
			assert.equal(parseFilePathLine('SELECT * FROM users WHERE id = 1;'), null);
			assert.equal(parseFilePathLine('const count = 42;'), null);
			assert.equal(parseFilePathLine('import { foo } from "bar";'), null);
			assert.equal(parseFilePathLine('function test() { return true; }'), null);
			assert.equal(parseFilePathLine('public class Customer { }'), null);
		});

		it('rifiuta stringhe vuote o frasi discorsive', () => {
			assert.equal(parseFilePathLine(''), null);
			assert.equal(parseFilePathLine('   '), null);
			assert.equal(parseFilePathLine('Questo e un messaggio di prova.'), null);
			assert.equal(parseFilePathLine('Passaggi a tuo carico (Deploy)'), null);
		});
	});

	describe('detectFilePathBlock', () => {
		it('rileva un blocco a riga singola con percorso file', () => {
			const res = detectFilePathBlock('sql/03_seed/[seed_CAI_ParametriConcordato_Racconigi2020].sql', 'text');
			assert.ok(res !== null);
			assert.equal(res.length, 1);
			assert.equal(res[0].path, 'sql/03_seed/[seed_CAI_ParametriConcordato_Racconigi2020].sql');
		});

		it('rileva elenchi multi-riga di percorsi file', () => {
			const block = `
sql/01_tables/table.sql
sql/02_views/view.sql
sql/03_seed/seed.sql
`;
			const res = detectFilePathBlock(block, 'text');
			assert.ok(res !== null);
			assert.equal(res.length, 3);
			assert.equal(res[0].path, 'sql/01_tables/table.sql');
			assert.equal(res[1].path, 'sql/02_views/view.sql');
			assert.equal(res[2].path, 'sql/03_seed/seed.sql');
		});

		it('rifiuta blocchi misti dove non tutte le righe sono percorsi', () => {
			const block = `
sql/01_tables/table.sql
SELECT * FROM table;
`;
			const res = detectFilePathBlock(block, 'text');
			assert.equal(res, null);
		});

		it('rifiuta blocchi di codice puro', () => {
			const block = `
const a = 1;
const b = 2;
console.log(a + b);
`;
			const res = detectFilePathBlock(block, 'javascript');
			assert.equal(res, null);
		});
	});
});
