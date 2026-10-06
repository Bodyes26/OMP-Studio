/**
 * Smoke test per il sistema di menzione file fuzzy (@file) nel Composer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	isExcludedPath,
	rankFileCandidates,
	extractTouchedFilesFromTranscript,
	computeCaretAnchorLeft,
	loadProjectFiles
} from '../src/lib/agent/fileMention.ts';
import { findFileMentions } from '../src/lib/agent/fileMentionSyntax.ts';
import { lexMarkdownInlineWithMentions, type Token } from '../src/lib/agent/markdown.ts';

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
test('File mention: calcolo ancoraggio da caret Range rect', () => {
	const rootRect = { left: 100, width: 700 };

	// Cursore all'inizio dell'input: left deve essere 0
	const leftStart = computeCaretAnchorLeft({ left: 105 }, rootRect, 380);
	assert.equal(leftStart, 0);

	// Cursore a metà riga
	const leftMid = computeCaretAnchorLeft({ left: 300 }, rootRect, 380);
	// 300 - 100 - 12 = 188
	assert.equal(leftMid, 188);

	// Cursore verso la fine: bloccato entro i bordi per non sforare
	const leftEnd = computeCaretAnchorLeft({ left: 750 }, rootRect, 380);
	// maxLeft = 700 - 380 = 320
	assert.equal(leftEnd, 320);
});

test('File mention: le letture concorrenti dello stesso progetto condividono una sola chiamata', async () => {
	const globals = globalThis as { window?: unknown; __TAURI_INTERNALS__?: unknown };
	const previousWindow = globals.window;
	const previousInternals = globals.__TAURI_INTERNALS__;
	let calls = 0;
	let release: (files: string[]) => void = () => {};
	const internals = {
		invoke: (cmd: string) => {
			if (cmd !== 'project_files_list') return Promise.resolve(null);
			calls++;
			return new Promise<string[]>((resolve) => (release = resolve));
		},
		transformCallback: (fn: unknown) => fn
	};
	globals.window = { __TAURI_INTERNALS__: internals };
	globals.__TAURI_INTERNALS__ = internals;
	try {
		const project = `/progetto-${Date.now()}`;
		const first = loadProjectFiles(project);
		const second = loadProjectFiles(project);
		release(['src/a.ts', './b.ts']);
		assert.deepEqual(await first, ['src/a.ts', 'b.ts']);
		assert.deepEqual(await second, ['src/a.ts', 'b.ts']);
		assert.equal(calls, 1);
		// Poi la cache: nessuna chiamata nuova entro il TTL.
		assert.deepEqual(await loadProjectFiles(project), ['src/a.ts', 'b.ts']);
		assert.equal(calls, 1);
	} finally {
		globals.window = previousWindow;
		globals.__TAURI_INTERNALS__ = previousInternals;
	}
});
