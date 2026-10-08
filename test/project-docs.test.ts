/**
 * Diario di progetto lato Studio (Gate R41): lettura del manifest e del
 * diario, contesto per «Chiedi al diario», contratto con l'estensione e
 * caricamento con `-e`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	DOC_ROLES,
	buildAskContext,
	chunkMarkdown,
	defaultManifest,
	diaryRelFor,
	isDefaultDoc,
	latestEntries,
	parseDiary,
	parseManifest,
	previousMonth
} from '../src/lib/projectDocs/projectDocs.ts';
import * as ext from '../extensions/studio-docs.ts';
import { AGENT_VIEWS } from '../src/lib/stores/taskSerialization.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('Diario lato Studio: contratto con l\'estensione', () => {
	it('stessi ruoli, stessi percorsi di default e stesso manifest', () => {
		assert.deepEqual([...DOC_ROLES], [...ext.DOC_ROLES]);
		assert.deepEqual(defaultManifest('repo'), ext.defaultManifest('repo'));
		assert.deepEqual(defaultManifest('local'), ext.defaultManifest('local'));
		const date = new Date(2026, 0, 5);
		assert.equal(diaryRelFor(defaultManifest('repo'), date), ext.diaryRelFor(ext.defaultManifest('repo'), date));
	});

	it('legge il diario scritto dall\'estensione', () => {
		const root = mkdtempSync(join(tmpdir(), 'omp-studio-pd-'));
		try {
			const now = new Date(2026, 9, 8);
			const manifest = ext.initProject(root, 'repo', now).manifest;
			ext.appendDiary(root, manifest, 'Scelto Tauri per il guscio\nAperta la questione Windows ARM', 'sessione 5b90c1a2', now);
			ext.appendDiary(root, manifest, 'Rilasciata la 1.8 [commit 41aa0d1]', 'sessione 5b90c1a2', new Date(2026, 9, 9));
			const parsedManifest = parseManifest(readFileSync(join(root, '.omp/progetto.json'), 'utf8'));
			assert.deepEqual(parsedManifest?.docs, manifest.docs);
			const entries = parseDiary(readFileSync(join(root, diaryRelFor(parsedManifest!, now)), 'utf8'));
			assert.equal(entries.length, 3);
			assert.deepEqual(entries[0], {
				date: '2026-10-08',
				text: 'Scelto Tauri per il guscio',
				sources: [{ kind: 'sessione', id: '5b90c1a2', label: 'sessione 5b90c1a2' }]
			});
			assert.equal(entries[2].sources[0].label, 'commit 41aa0d1');
			assert.equal(latestEntries(entries, 1)[0].text, 'Rilasciata la 1.8');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('Diario lato Studio: manifest', () => {
	it('completa i ruoli mancanti e riconosce i documenti mappati', () => {
		const manifest = parseManifest('{"storage":"repo","docs":{"decisioni":"docs/DECISIONS.md"}}');
		assert.ok(manifest);
		assert.equal(manifest.docs.decisioni, 'docs/DECISIONS.md');
		assert.equal(manifest.docs.uso, 'docs/progetto/uso.md');
		assert.equal(isDefaultDoc(manifest, 'decisioni'), false);
		assert.equal(isDefaultDoc(manifest, 'uso'), true);
		assert.equal(parseManifest('non json'), null);
		assert.equal(parseManifest('{"storage":"local"}')?.diaryDir, '.omp/progetto/diario');
	});

	it('il mese precedente attraversa l\'anno', () => {
		assert.equal(diaryRelFor(defaultManifest(), previousMonth(new Date(2026, 0, 3))), 'docs/diario/2025-12.md');
	});
});

describe('Diario lato Studio: chiedi al diario', () => {
	it('sceglie le sezioni pertinenti e resta sotto il tetto', () => {
		const files = [
			{ rel: 'docs/progetto/decisioni.md', text: '# Decisioni\n\n## Guscio\n\nScelto Tauri invece di Electron per il peso.\n\n## Colori\n\nNeutri.' },
			{ rel: 'docs/progetto/uso.md', text: '# Uso\n\nSi apre dal menu.' },
			{ rel: 'docs/diario/2026-10.md', text: '# Diario\n\n## 2026-10-08\n- Rilasciata la 1.8', diary: true }
		];
		const context = buildAskContext('Perché abbiamo scelto Tauri?', files);
		assert.match(context, /docs\/progetto\/decisioni\.md › Guscio/);
		assert.match(context, /docs\/diario\/2026-10\.md/, 'il diario recente entra sempre');
		assert.doesNotMatch(context, /Colori/);
		assert.doesNotMatch(context, /Si apre dal menu/);
		const small = buildAskContext('tauri', files, 40);
		assert.ok(small.length <= 40);
	});

	it('chunkMarkdown ignora i titoli nei blocchi di codice', () => {
		const chunks = chunkMarkdown('a.md', '# A\ntesto\n```\n# no\n```\n## B\naltro');
		assert.deepEqual(
			chunks.map((c) => c.heading),
			['A', 'B']
		);
	});
});

describe('Diario lato Studio: integrazione', () => {
	it('la scheda Progetto e\' una vista del pannello Agente', () => {
		assert.ok((AGENT_VIEWS as readonly string[]).includes('project'));
	});

	it('Studio carica studio-docs con -e nel PTY e in RPC, ed espone project_docs_ask', () => {
		const pty = readFileSync(join(ROOT, 'src-tauri/src/pty/mod.rs'), 'utf8');
		const rpc = readFileSync(join(ROOT, 'src-tauri/src/rpc/mod.rs'), 'utf8');
		const lib = readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
		assert.match(pty, /include_str!\("\.\.\/\.\.\/\.\.\/extensions\/studio-docs\.ts"\)/);
		assert.equal((pty.match(/&docs_extension_arg/g) ?? []).length, 2, 'Windows e Unix');
		assert.match(rpc, /write_extension\("studio-docs\.ts", crate::pty::DOCS_EXTENSION_TS\)/);
		assert.match(lib, /project_docs_ask,/);
	});
});
