/**
 * Smoke test per il sistema di menzione file fuzzy (@file) nel Composer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	extractFileMentionAtCursor,
	insertFileMentionAtCursor,
	isExcludedPath,
	rankFileCandidates,
	extractTouchedFilesFromTranscript
} from '../src/lib/agent/fileMention.ts';
import { extractSlashQueryAtCursor } from '../src/lib/agent/commands.ts';
import { findFileMentions } from '../src/lib/agent/fileMentionSyntax.ts';
import { lexMarkdownInlineWithMentions, type Token } from '../src/lib/agent/markdown.ts';

test('File mention: intercettazione del carattere @ al cursore', () => {
	// A inizio testo
	assert.deepEqual(extractFileMentionAtCursor('@', 1), {
		query: '',
		startIndex: 0,
		endIndex: 1
	});
	assert.deepEqual(extractFileMentionAtCursor('@auth', 5), {
		query: 'auth',
		startIndex: 0,
		endIndex: 5
	});

	// Preceduto da spazio
	assert.deepEqual(extractFileMentionAtCursor('controlla @src/lib/auth.ts', 18), {
		query: 'src/lib',
		startIndex: 10,
		endIndex: 26
	});

	// Preceduto da newline
	assert.deepEqual(extractFileMentionAtCursor('riga1\n@test', 11), {
		query: 'test',
		startIndex: 6,
		endIndex: 11
	});

	// Rifiuta indirizzi email (preceduto da caratteri non-whitespace)
	assert.equal(extractFileMentionAtCursor('utente@email.com', 10), null);
	assert.equal(extractFileMentionAtCursor('foo@bar', 4), null);

	// Rifiuta se c'e' spazio dopo l'@ (menzione completata o chiusa)
	assert.equal(extractFileMentionAtCursor('@auth ', 6), null);
	assert.equal(extractFileMentionAtCursor('@auth test', 8), null);

	// Rifiuta se c'e' ritorno a capo tra @ e il cursore
	assert.equal(extractFileMentionAtCursor('@auth\npippo', 8), null);
});

test('File mention: inserimento del percorso relativo nel testo al cursore', () => {
	const res1 = insertFileMentionAtCursor('esamina @aut e correggi', 8, 12, 'src/lib/auth.ts');
	assert.equal(res1.newText, 'esamina @src/lib/auth.ts  e correggi');
	assert.equal(res1.newCursorPos, 25);

	// A inizio testo
	const res2 = insertFileMentionAtCursor('@', 0, 1, 'src/main.ts');
	assert.equal(res2.newText, '@src/main.ts ');
	assert.equal(res2.newCursorPos, 13);
});

test('File mention: percorsi con spazi tra virgolette, andata e ritorno', () => {
	const res = insertFileMentionAtCursor('apri @def', 5, 9, 'Cruscotto PSR\\Default.aspx');
	assert.equal(res.newText, 'apri @"Cruscotto PSR/Default.aspx" ');
	// Quello che si inserisce deve tornare a essere lo stesso percorso quando lo si rilegge.
	assert.deepEqual(findFileMentions(res.newText).map((m) => m.path), ['Cruscotto PSR/Default.aspx']);
});

test('File mention: solo cio che sembra un percorso diventa menzione', () => {
	const text = 'vedi @src/a_b_.ts e @README.md. poi @Main, pippo@esempio.it, x@a.ts, @1.5 e @v1.2.3';
	assert.deepEqual(findFileMentions(text).map((m) => m.path), ['src/a_b_.ts', 'README.md']);
});

test('File mention: nel markdown della bolla la menzione vince sull\'enfasi', () => {
	const paths = (tokens: Token[]): string[] =>
		tokens.flatMap((t) => (t.type === 'fileMention' ? [t.path] : 'tokens' in t && t.tokens ? paths(t.tokens) : []));
	assert.deepEqual(paths(lexMarkdownInlineWithMentions('@src/__init__.py e **@lib/x.ts** e `@y.ts`')), [
		'src/__init__.py',
		'lib/x.ts'
	]);
	assert.deepEqual(paths(lexMarkdownInlineWithMentions('scrivi a pippo@esempio.it')), []);
});

test('File mention: esclusione categorica directory di rumore e build', () => {
	assert.equal(isExcludedPath('.git/HEAD'), true);
	assert.equal(isExcludedPath('node_modules/svelte/index.js'), true);
	assert.equal(isExcludedPath('bin/Debug/app.exe'), true);
	assert.equal(isExcludedPath('obj/Release/app.dll'), true);
	assert.equal(isExcludedPath('dist/index.html'), true);
	assert.equal(isExcludedPath('target/release/omp-studio'), true);
	assert.equal(isExcludedPath('.svelte-kit/generated/root.svelte'), true);

	// File legittimi del progetto
	assert.equal(isExcludedPath('src/lib/auth.ts'), false);
	assert.equal(isExcludedPath('package.json'), false);
	assert.equal(isExcludedPath('Cargo.toml'), false);
});

test('File mention: ranking fuzzy con priorita Monaco e cronologia agente', () => {
	const allFiles = [
		'src/lib/auth.ts',
		'src/lib/api.ts',
		'src/lib/agent/components/Composer.svelte',
		'src/lib/looseSearch.ts',
		'node_modules/fake.ts', // Deve essere escluso
		'docs/PLAN.md',
		'src/routes/+page.svelte'
	];

	const context = {
		activeFile: 'src/lib/looseSearch.ts',
		openFiles: ['src/lib/looseSearch.ts', 'src/lib/auth.ts'],
		touchedFiles: ['src/lib/api.ts']
	};

	// Query vuota (appena digitato '@'): propone per primi i file attivi, aperti e toccati
	const emptyQueryResults = rankFileCandidates('', allFiles, context, 8);
	assert.equal(emptyQueryResults[0].path, 'src/lib/looseSearch.ts');
	assert.equal(emptyQueryResults[0].priority, 'active');
	assert.equal(emptyQueryResults[1].path, 'src/lib/auth.ts');
	assert.equal(emptyQueryResults[1].priority, 'open');
	assert.equal(emptyQueryResults[2].path, 'src/lib/api.ts');
	assert.equal(emptyQueryResults[2].priority, 'touched');

	// Nessun file node_modules presente
	assert.ok(!emptyQueryResults.some((r) => r.path.includes('node_modules')));

	// Ricerca fuzzy "auth"
	const authResults = rankFileCandidates('auth', allFiles, context, 8);
	assert.equal(authResults.length, 1);
	assert.equal(authResults[0].path, 'src/lib/auth.ts');
	assert.equal(authResults[0].name, 'auth.ts');

	// Ricerca fuzzy tokenizzata "comp svelte"
	const compResults = rankFileCandidates('comp svelte', allFiles, context, 8);
	assert.equal(compResults.length, 1);
	assert.equal(compResults[0].path, 'src/lib/agent/components/Composer.svelte');
});

test('File mention: estrazione file toccati dal transcript della sessione', () => {
	const entries = [
		{ kind: 'user', text: 'avvia fix' },
		{
			kind: 'tool',
			args: { path: 'src/lib/auth.ts' }
		},
		{
			kind: 'tool',
			args: { file: 'package.json' }
		},
		{
			kind: 'tool',
			args: { paths: ['src/lib/utils.ts', 'node_modules/bad.ts'] }
		}
	];

	const touched = extractTouchedFilesFromTranscript(entries);
	// Ordine più recente per primo
	assert.deepEqual(touched, ['src/lib/utils.ts', 'package.json', 'src/lib/auth.ts']);
});
test('File mention: coesistenza indipendente con i comandi slash', () => {
	const promptWithBoth = '/review @src/lib/auth.ts';

	// Cursore dentro il comando slash "/rev"
	const slashMatch = extractSlashQueryAtCursor(promptWithBoth, 4);
	const mentionAtSlash = extractFileMentionAtCursor(promptWithBoth, 4);
	assert.ok(slashMatch !== null);
	assert.equal(slashMatch?.query, 'rev');
	assert.equal(mentionAtSlash, null);

	// Cursore dentro la menzione file "@src/lib"
	const slashMatchAtMention = extractSlashQueryAtCursor(promptWithBoth, 16);
	const fileMentionMatch = extractFileMentionAtCursor(promptWithBoth, 16);
	assert.equal(slashMatchAtMention, null);
	assert.ok(fileMentionMatch !== null);
	assert.equal(fileMentionMatch?.query, 'src/lib');
});

test('File mention: supporto a menzioni multiple nello stesso testo', () => {
	const multiPrompt = 'confronta @src/lib/auth.ts con @src/lib/api.ts';

	// Cursore sulla prima menzione (dopo 'src/lib')
	const match1 = extractFileMentionAtCursor(multiPrompt, 18);
	assert.ok(match1 !== null);
	assert.equal(match1?.query, 'src/lib');
	assert.equal(match1?.startIndex, 10);

	// Cursore sulla seconda menzione (dopo 'src/lib')
	const match2 = extractFileMentionAtCursor(multiPrompt, 39);
	assert.ok(match2 !== null);
	assert.equal(match2?.query, 'src/lib');
	assert.equal(match2?.startIndex, 31);
});
