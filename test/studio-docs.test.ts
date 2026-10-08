/**
 * Diario di progetto (Gate R3X-diario): estensione `studio-docs`, manifest,
 * scrittura del diario con le fonti, protezione delle righe scritte a mano,
 * spostamento fuori da git e riga nel prompt solo dove il diario e' attivo.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import studioDocsExtension, {
	PROMPT_LINE,
	appendDiary,
	defaultManifest,
	detectExistingMappings,
	initProject,
	initPrompt,
	isJournalActive,
	loadManifest,
	loadState,
	normalizeSource,
	resolveProjectRoot,
	runProjectDocs,
	saveState,
	searchDocs,
	splitSections,
	switchStorage,
	updateDoc,
	withSource
} from '../extensions/studio-docs.ts';

const NOW = new Date(2026, 9, 8, 15, 30);
const LATER = new Date(2026, 9, 9, 9, 0);

let root: string;

function write(rel: string, text: string) {
	mkdirSync(join(root, rel, '..'), { recursive: true });
	writeFileSync(join(root, rel), text);
}

function read(rel: string): string {
	return readFileSync(join(root, rel), 'utf8');
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'omp-studio-docs-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('Diario: manifest e inizializzazione', () => {
	it('senza manifest ne\' cartelle il diario non e\' attivo', () => {
		assert.equal(loadManifest(root).source, 'none');
		assert.equal(isJournalActive(root), false);
	});

	it('riconosce un diario avviato dalle cartelle di default anche senza manifest', () => {
		write('docs/diario/2026-10.md', '# Diario 2026-10\n');
		const { manifest, source } = loadManifest(root);
		assert.equal(source, 'detected');
		assert.equal(manifest.storage, 'repo');
		assert.equal(manifest.docs.scopo, 'docs/progetto/scopo.md');
	});

	it('init mappa i documenti esistenti, crea gli altri e il mese corrente', () => {
		write('docs/PRODUCT.md', '# Prodotto\n');
		write('docs/DECISIONS.md', '# Decisioni\n');
		assert.deepEqual(detectExistingMappings(root), { scopo: 'docs/PRODUCT.md', decisioni: 'docs/DECISIONS.md' });
		const init = initProject(root, 'repo', NOW);
		assert.equal(init.manifest.docs.scopo, 'docs/PRODUCT.md');
		assert.equal(init.manifest.docs.decisioni, 'docs/DECISIONS.md');
		assert.deepEqual(init.created.sort(), [
			'docs/diario/2026-10.md',
			'docs/progetto/domande-aperte.md',
			'docs/progetto/storia.md',
			'docs/progetto/uso.md'
		]);
		assert.equal(read('docs/PRODUCT.md'), '# Prodotto\n', 'il documento dell\'utente non si tocca');
		assert.match(read('.omp/.gitignore'), /progetto-stato\.json/);
		assert.doesNotMatch(read('.omp/.gitignore'), /progetto\//);
		const manifest = JSON.parse(read('.omp/progetto.json'));
		assert.equal(manifest.storage, 'repo');
		assert.equal(manifest.initializedAt, '2026-10-08');
		// Idempotente
		assert.deepEqual(initProject(root, 'repo', NOW).created, []);
	});

	it('init locale mette tutto in .omp/progetto e lo esclude da git', () => {
		const init = initProject(root, 'local', NOW);
		assert.equal(init.manifest.diaryDir, '.omp/progetto/diario');
		assert.ok(existsSync(join(root, '.omp/progetto/scopo.md')));
		const ignore = read('.omp/.gitignore');
		assert.match(ignore, /^progetto\/$/m);
		assert.match(ignore, /^progetto\.json$/m);
	});
});

describe('Diario: voci con fonte', () => {
	it('aggiunge punti elenco sotto il giorno, con la fonte su ogni riga', () => {
		const manifest = initProject(root, 'repo', NOW).manifest;
		appendDiary(root, manifest, 'Aggiunto heads-up\n- Deciso: una frase sola', 'sessione 5b90c1a2', NOW);
		appendDiary(root, manifest, 'Corretto il test [commit 41aa0d1]', 'sessione 5b90c1a2', NOW);
		appendDiary(root, manifest, 'Nuovo giorno', 'commit abcdef1', LATER);
		const text = read('docs/diario/2026-10.md');
		assert.equal(
			text,
			[
				'# Diario 2026-10',
				'',
				'## 2026-10-08',
				'- Aggiunto heads-up [sessione 5b90c1a2]',
				'- Deciso: una frase sola [sessione 5b90c1a2]',
				'- Corretto il test [commit 41aa0d1]',
				'',
				'## 2026-10-09',
				'- Nuovo giorno [commit abcdef1]',
				''
			].join('\n')
		);
	});

	it('normalizza le fonti', () => {
		assert.equal(normalizeSource(undefined, '5b90c1a2-dead-beef'), 'sessione 5b90c1a2');
		assert.equal(normalizeSource('commit 41aa0d1ffee', undefined), 'commit 41aa0d1');
		assert.equal(normalizeSource('41aa0d1ffee', undefined), 'commit 41aa0d1');
		assert.equal(normalizeSource('[session abcdef123456]', undefined), 'sessione abcdef12');
		assert.equal(withSource('riga [commit 1234567]', 'sessione x'), 'riga [commit 1234567]');
	});
});

describe('Diario: documenti e righe scritte a mano', () => {
	it('add_section, append e replace_section su una sezione dell\'agente', () => {
		const manifest = initProject(root, 'repo', NOW).manifest;
		const state = loadState(root);
		let out = updateDoc(root, manifest, { role: 'decisioni', mode: 'add_section', section: 'Formato heads-up', text: 'Una frase sola.', source: 'sessione aaaa1111' }, state);
		assert.ok(out.ok, out.message);
		out = updateDoc(root, manifest, { role: 'decisioni', mode: 'append', section: 'Formato heads-up', text: 'Niente elenchi.', source: 'sessione aaaa1111' }, state);
		assert.ok(out.ok, out.message);
		out = updateDoc(root, manifest, { role: 'decisioni', mode: 'replace_section', section: 'Formato heads-up', text: 'Una frase, solo se serve.', source: 'commit 1234567' }, state);
		assert.ok(out.ok, out.message);
		const text = read('docs/progetto/decisioni.md');
		assert.match(text, /## Formato heads-up\n\nUna frase, solo se serve\. \[commit 1234567\]\n/);
		assert.doesNotMatch(text, /Niente elenchi/);
	});

	it('non riscrive una sezione modificata a mano, salvo conferma (force)', () => {
		const manifest = initProject(root, 'repo', NOW).manifest;
		const state = loadState(root);
		updateDoc(root, manifest, { role: 'uso', mode: 'add_section', section: 'Avvio', text: 'Si apre dal menu.', source: 'sessione a' }, state);
		saveState(root, state);
		// L'utente modifica la riga a mano
		const path = 'docs/progetto/uso.md';
		write(path, read(path).replace('Si apre dal menu.', 'Si apre dal menu o con Ctrl+K.'));
		const reloaded = loadState(root);
		const refused = updateDoc(root, manifest, { role: 'uso', mode: 'replace_section', section: 'Avvio', text: 'Si apre dalla barra.', source: 'sessione b' }, reloaded);
		assert.equal(refused.ok, false);
		assert.match(refused.message, /modificato a mano/);
		assert.match(refused.current ?? '', /Ctrl\+K/);
		assert.match(read(path), /Ctrl\+K/, 'il file resta com\'era');
		// append e' sempre ammesso, ma non adotta la sezione dell'utente
		const appended = updateDoc(root, manifest, { role: 'uso', mode: 'append', section: 'Avvio', text: 'Anche dalla companion.', source: 'sessione b' }, reloaded);
		assert.ok(appended.ok);
		assert.equal(updateDoc(root, manifest, { role: 'uso', mode: 'replace_section', section: 'Avvio', text: 'x', source: 'sessione b' }, reloaded).ok, false);
		const forced = updateDoc(root, manifest, { role: 'uso', mode: 'replace_section', section: 'Avvio', text: 'Si apre dalla barra.', source: 'sessione b', force: true }, reloaded);
		assert.ok(forced.ok);
		assert.doesNotMatch(read(path), /Ctrl\+K/);
	});

	it('un documento preesistente dell\'utente e\' protetto fin da subito', () => {
		write('docs/DECISIONS.md', '# Decisioni\n\n## Gate R1\n\nTesto scritto da Maurizio.\n');
		const manifest = initProject(root, 'repo', NOW).manifest;
		const state = loadState(root);
		const out = updateDoc(root, manifest, { role: 'decisioni', mode: 'replace_section', section: 'Gate R1', text: 'altro', source: 'sessione c' }, state);
		assert.equal(out.ok, false);
	});

	it('il segnaposto dello scheletro si puo\' sostituire', () => {
		const manifest = initProject(root, 'repo', NOW).manifest;
		const out = updateDoc(root, manifest, { role: 'storia', mode: 'replace_section', section: 'Storia', text: 'Nato a ottobre 2026.', source: 'sessione d' }, loadState(root));
		assert.ok(out.ok, out.message);
		assert.equal(read('docs/progetto/storia.md'), '# Storia\n\nNato a ottobre 2026. [sessione d]\n');
	});

	it('splitSections ignora i titoli dentro i blocchi di codice', () => {
		const sections = splitSections(['# A', '```', '# non titolo', '```', '## B', 'x']);
		assert.deepEqual(
			sections.map((s) => s.heading),
			['A', 'B']
		);
	});

	it('cerca nei documenti e nel diario', () => {
		const manifest = initProject(root, 'repo', NOW).manifest;
		appendDiary(root, manifest, 'Scelto SQLite per lo storico', 'sessione e', NOW);
		const hits = searchDocs(root, manifest, 'perché sqlite?');
		assert.equal(hits.length, 1);
		assert.equal(hits[0].rel, 'docs/diario/2026-10.md');
		assert.equal(hits[0].section, '2026-10-08');
	});
});

describe('Diario: fuori o dentro git', () => {
	it('sposta i file di default e lascia al loro posto quelli mappati', () => {
		write('docs/DECISIONS.md', '# Decisioni\n');
		const manifest = initProject(root, 'repo', NOW).manifest;
		appendDiary(root, manifest, 'voce', 'sessione f', NOW);
		const { manifest: local, moved } = switchStorage(root, 'local');
		assert.equal(local.storage, 'local');
		assert.equal(local.docs.decisioni, 'docs/DECISIONS.md');
		assert.equal(local.docs.uso, '.omp/progetto/uso.md');
		assert.ok(existsSync(join(root, '.omp/progetto/diario/2026-10.md')));
		assert.ok(!existsSync(join(root, 'docs/progetto/uso.md')));
		assert.ok(moved.length >= 5);
		assert.match(read('.omp/.gitignore'), /^progetto\/$/m);
		const back = switchStorage(root, 'repo').manifest;
		assert.equal(back.docs.uso, 'docs/progetto/uso.md');
		assert.ok(existsSync(join(root, 'docs/diario/2026-10.md')));
		assert.doesNotMatch(read('.omp/.gitignore'), /^progetto\/$/m);
		assert.match(read('.omp/.gitignore'), /progetto-stato\.json/);
	});
});

describe('Diario: tool project_docs', () => {
	it('rifiuta letture e scritture finche\' il diario non e\' attivo', async () => {
		const res = await runProjectDocs(root, { action: 'list' });
		assert.equal(res.isError, true);
		assert.match(res.content[0].text, /\/diario init/);
	});

	it('init, update del diario con la sessione corrente, read e list', async () => {
		await runProjectDocs(root, { action: 'init' }, 'sess1234abcd', NOW);
		const up = await runProjectDocs(root, { action: 'update', doc: 'diario', text: 'Prima voce' }, 'sess1234abcd', NOW);
		assert.equal(up.isError, undefined);
		const readRes = await runProjectDocs(root, { action: 'read', doc: 'diario:2026-10' }, undefined, NOW);
		assert.match(readRes.content[0].text, /- Prima voce \[sessione sess1234\]/);
		const docUp = await runProjectDocs(root, { action: 'update', doc: 'purpose', mode: 'add_section', section: 'Per chi', text: 'Per Maurizio.' }, 'sess1234abcd', NOW);
		assert.equal(docUp.isError, undefined, docUp.content[0].text);
		const sec = await runProjectDocs(root, { action: 'read', doc: 'scopo', section: 'Per chi' });
		assert.match(sec.content[0].text, /Per Maurizio\. \[sessione sess1234\]/);
		const list = await runProjectDocs(root, { action: 'list' });
		assert.match(list.content[0].text, /scopo: docs\/progetto\/scopo\.md/);
		const bad = await runProjectDocs(root, { action: 'read', doc: 'boh' });
		assert.equal(bad.isError, true);
	});

	it('sources elenca documentazione e git senza scrivere niente', async () => {
		write('README.md', '# Progetto\n');
		write('docs/guida.md', '# Guida\n');
		const res = await runProjectDocs(root, { action: 'sources' });
		assert.match(res.content[0].text, /README\.md/);
		assert.match(res.content[0].text, /docs\/guida\.md/);
		assert.ok(!existsSync(join(root, '.omp')), 'sources non crea file');
	});
});

describe('Diario: corsie e prompt', () => {
	it('in una corsia (worktree) il diario e\' quello del checkout principale', () => {
		const git = (args: string[], cwd = root) =>
			execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
		git(['init', '-q']);
		write('a.txt', 'x');
		git(['add', '.']);
		git(['commit', '-qm', 'init']);
		const lane = join(root, '..', `${root.split(/[\\/]/).pop()}-lane`);
		git(['worktree', 'add', '-q', lane]);
		try {
			const resolved = resolveProjectRoot(lane).replace(/\\/g, '/');
			assert.equal(resolved.replace(/\/+$/, ''), root.replace(/\\/g, '/').replace(/\/+$/, ''));
		} finally {
			rmSync(lane, { recursive: true, force: true });
		}
	});

	it('fuori da git la radice e\' la cartella stessa', () => {
		assert.equal(resolveProjectRoot(root), root);
	});

	it('il prompt di init fa l\'intervista su un progetto vuoto e legge le fonti altrimenti', () => {
		const init = initProject(root, 'repo', NOW);
		const empty = initPrompt({ init, docs: [], git: null, sessions: 0, prompts: 0 });
		assert.match(empty, /INTERVISTA/);
		assert.match(empty, /Una domanda per messaggio/);
		const full = initPrompt({ init, docs: ['README.md'], git: { commits: 40 }, sessions: 12, prompts: 80 });
		assert.match(full, /action 'sources'/);
		assert.match(full, /SOLA LETTURA/);
		assert.doesNotMatch(full, /INTERVISTA/);
	});

	it('registra tool e comando, e aggiunge una riga al prompt solo col diario attivo', async () => {
		const tools = new Map<string, { approval: string; description: string }>();
		const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
		let hook: ((event: { systemPrompt: string[] }, ctx: { cwd?: string }) => unknown) | null = null;
		const sent: string[] = [];
		const notes: string[] = [];
		const zod: Record<string, unknown> = {};
		for (const k of ['object', 'string', 'boolean', 'enum', 'optional', 'describe']) zod[k] = () => zod;
		studioDocsExtension({
			zod: zod as never,
			registerTool: (def: unknown) => {
				const d = def as { name: string; approval: string; description: string };
				tools.set(d.name, d);
			},
			registerCommand: (name, cmd) => commands.set(name, cmd as never),
			on: (_event, handler) => {
				hook = handler;
			},
			sendUserMessage: (text) => sent.push(text)
		});
		assert.equal(tools.get('project_docs')?.approval, 'read');
		assert.match(tools.get('project_docs')?.description ?? '', /without asking/);
		assert.ok(hook);
		assert.equal(hook!({ systemPrompt: ['base'] }, { cwd: root }), undefined, 'niente riga senza diario');

		const ctx = { cwd: root, ui: { notify: (m: string) => notes.push(m) } };
		await commands.get('diario')!.handler('aggiorna', ctx);
		assert.match(notes.pop() ?? '', /\/diario init/);
		await commands.get('diario')!.handler('init', ctx);
		assert.equal(sent.length, 1);
		assert.match(sent[0], /INTERVISTA/);
		assert.ok(existsSync(join(root, '.omp/progetto.json')));

		const result = hook!({ systemPrompt: ['base'] }, { cwd: root }) as { systemPrompt: string[] };
		assert.deepEqual(result.systemPrompt, ['base', PROMPT_LINE]);
		assert.ok(PROMPT_LINE.length < 400, 'una riga sola');

		await commands.get('diario')!.handler('perché abbiamo scelto Tauri?', ctx);
		assert.match(sent[1], /perché abbiamo scelto Tauri\?/);
		await commands.get('diario')!.handler('locale', ctx);
		assert.match(notes.pop() ?? '', /fuori da git/);
		assert.equal(loadManifest(root).manifest.storage, 'local');
		assert.equal(defaultManifest('local').diaryDir, loadManifest(root).manifest.diaryDir);
	});
});
