/**
 * Revisioni locali del Laboratorio su filesystem reale.
 *
 * Lo scenario di accettazione dello step: tre revisioni con file diversi,
 * ripristino della prima, storia che resta intera, duplicazione del prototipo.
 * Le verifiche che contano sono due confini: l'originale non cambia quando si
 * duplica, e nessun file fuori dalla cartella del prototipo viene toccato —
 * la storia vive nell'archivio locale, non nel repository.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
	LAB_MANIFEST_FILE,
	createLabPrototype,
	labProjectStore,
	listLabPrototypeFiles,
	readLabPrototype,
	readLabPrototypeFile,
	removeLabPrototypeFile,
	writeLabPrototypeFile,
	type LabStore
} from '../src/lib/lab/storage.ts';
import {
	LAB_PROVENANCE_FILE,
	LAB_REVISION_ARCHIVE_DIRECTORY,
	LAB_REVISION_INDEX_FILE,
	LabRevisionError,
	closeLabRevision,
	duplicateLabPrototype,
	isOpenLabRevision,
	labRevisionArchive,
	labRevisionDirectory,
	listLabRevisions,
	openLabRevision,
	readLabPrototypeProvenance,
	readLabRevisionHistory,
	restoreLabRevision,
	type LabRevisionArchive,
	type LabRevisionContext
} from '../src/lib/lab/revisions.ts';
import { nodeHost } from './lab-host.ts';

const TEMPLATE_VERSION = '1.0.0';
/** Chiave stabile dell'archivio: in Studio e' `Project.id`, non il percorso. */
const SCOPE = 'c0ffee00-1111-4222-8333-444455556666';

function revisionCode(error: unknown): string | undefined {
	return error instanceof LabRevisionError ? error.code : undefined;
}

/** Inventario ricorsivo di una radice reale: percorso relativo e dimensione. */
function treeOf(root: string): Map<string, number> {
	const found = new Map<string, number>();
	const pending = [root];
	while (pending.length > 0) {
		const current = pending.pop()!;
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const absolute = join(current, entry.name);
			if (entry.isDirectory()) {
				pending.push(absolute);
				continue;
			}
			found.set(relative(root, absolute).split(sep).join('/'), statSync(absolute).size);
		}
	}
	return found;
}

async function contentsOf(store: LabStore, id: string): Promise<Record<string, string>> {
	const listing = await listLabPrototypeFiles(store, id);
	const out: Record<string, string> = {};
	for (const path of listing.files) {
		out[path] = (await readLabPrototypeFile(store, id, path)) ?? '';
	}
	return out;
}

/** Una richiesta di modifica: apre, scrive, chiude con l'esito dichiarato. */
async function revise(
	context: LabRevisionContext,
	request: string,
	summary: string,
	state: 'rendering-ready' | 'verified' | 'failed' | 'interrupted',
	write: () => Promise<void>
) {
	const opened = await openLabRevision(context, { requestId: request, summary });
	await write();
	return closeLabRevision(context, opened.revision.id, state);
}

describe('Revisioni Laboratorio — storia, ripristino e duplicazione', () => {
	let base: string;
	let projectRoot: string;
	let dataDir: string;
	let store: LabStore;
	let archive: LabRevisionArchive;
	let context: LabRevisionContext;

	before(async () => {
		base = mkdtempSync(join(tmpdir(), 'omp-studio-lab-rev-'));
		projectRoot = join(base, 'progetto');
		dataDir = join(base, 'dati-studio');
		mkdirSync(projectRoot);
		mkdirSync(dataDir);

		// File del progetto estranei al prototipo: non devono essere toccati.
		mkdirSync(join(projectRoot, 'src'));
		writeFileSync(join(projectRoot, 'src', 'App.svelte'), '<h1>progetto</h1>\n', 'utf8');
		writeFileSync(join(projectRoot, 'package.json'), '{ "name": "progetto" }\n', 'utf8');

		store = labProjectStore(projectRoot, nodeHost(projectRoot));
		archive = labRevisionArchive(nodeHost(dataDir), SCOPE);
		const created = await createLabPrototype(store, {
			title: 'Tabella pratiche',
			brief: 'Tre densita di tabella a confronto.',
			templateVersion: TEMPLATE_VERSION,
			dependencies: [{ name: 'react', version: '19.2.8' }]
		});
		context = { archive, store, prototypeId: created.id };
	});

	after(() => {
		try {
			rmSync(base, { recursive: true, force: true });
		} catch {
			// pulizia best-effort
		}
	});

	it('apre una revisione per richiesta e la chiude con il suo esito', async () => {
		const prima = await revise(
			context,
			'req-1',
			'Prima proposta: tre varianti di densita.',
			'rendering-ready',
			async () => {
				await writeLabPrototypeFile(store, context.prototypeId, 'src/App.tsx', 'export const v = 1;\n');
				await writeLabPrototypeFile(store, context.prototypeId, 'src/Tabella.tsx', 'export const densita = "comoda";\n');
			}
		);

		assert.equal(prima.revision.sequence, 1);
		assert.equal(prima.revision.state, 'rendering-ready');
		assert.equal(prima.revision.requestId, 'req-1');
		assert.equal(prima.summary, 'Prima proposta: tre varianti di densita.');
		assert.equal(isOpenLabRevision(prima), false);
		assert.deepEqual(
			prima.snapshot?.files.map((file) => file.path),
			['src/App.tsx', 'src/Tabella.tsx']
		);
		assert.ok(prima.snapshot?.files.every((file) => file.fingerprint.startsWith('sha256:')));
		assert.equal(prima.snapshot?.manifest.brief, 'Tre densita di tabella a confronto.');

		// La storia vive nell'archivio locale, non nel prototipo versionato.
		const directory = join(dataDir, ...labRevisionDirectory(archive, context.prototypeId).split('/'));
		assert.ok(existsSync(join(directory, LAB_REVISION_INDEX_FILE)));
		assert.deepEqual(readdirSync(join(projectRoot, 'proto', context.prototypeId)).sort(), [
			'assets',
			'brief.md',
			LAB_MANIFEST_FILE,
			'src'
		]);
	});

	it('rifiuta una seconda revisione aperta e una richiesta senza riferimento', async () => {
		const aperta = await openLabRevision(context, { requestId: 'req-x', summary: 'Ritocco in corso.' });
		const doppia = await openLabRevision(context, { requestId: 'req-y', summary: 'Altro ritocco.' }).then(
			() => null,
			(error: unknown) => error
		);
		assert.equal(revisionCode(doppia), 'revision-open');

		// Un contenuto non testo (es. byte nullo) fa fallire una revisione renderable
		// ma viene registrato come motivo se si chiude come interrotta.
		const binario = join(projectRoot, 'proto', context.prototypeId, 'assets', 'immagine.png');
		writeFileSync(binario, 'GIF89a\u0000corrotto', 'utf8');
		const fallimento = await closeLabRevision(context, aperta.revision.id, 'rendering-ready').then(
			() => null,
			(error: unknown) => error
		);
		assert.equal(revisionCode(fallimento), 'unsupported-content');

		try {
			// Chiudendola come interrotta, l'errore viene registrato e la storia va avanti.
			const chiusa = await closeLabRevision(context, aperta.revision.id, 'interrupted');
			assert.equal(chiusa.revision.state, 'interrupted');
			assert.equal(chiusa.snapshot, undefined);
			assert.ok(chiusa.snapshotIssue?.includes("non e' testo"));
		} finally {
			rmSync(binario, { force: true });
		}
		assert.equal(
			revisionCode(await closeLabRevision(context, aperta.revision.id, 'verified').then(() => null, (e: unknown) => e)),
			'not-open'
		);
		const senzaTesto = await openLabRevision(context, { requestId: 'req-z', summary: '   ' }).then(
			() => null,
			(error: unknown) => error
		);
		assert.equal(revisionCode(senzaTesto), 'invalid-request');
	});

	it('conserva tre revisioni con stati distinti dei file', async () => {
		await revise(context, 'req-2', 'Variante compatta e grafico.', 'verified', async () => {
			await writeLabPrototypeFile(store, context.prototypeId, 'src/App.tsx', 'export const v = 2;\n');
			await writeLabPrototypeFile(store, context.prototypeId, 'src/Grafico.tsx', 'export const grafico = true;\n');
			await removeLabPrototypeFile(store, context.prototypeId, 'src/Tabella.tsx');
		});
		await revise(context, 'req-3', 'Terza iterazione: solo App.', 'rendering-ready', async () => {
			await writeLabPrototypeFile(store, context.prototypeId, 'src/App.tsx', 'export const v = 3;\n');
		});

		const entries = await listLabRevisions(context);
		assert.deepEqual(
			entries.map((entry) => [entry.revision.sequence, entry.revision.requestId, entry.revision.state]),
			[
				[1, 'req-1', 'rendering-ready'],
				[2, 'req-x', 'interrupted'],
				[3, 'req-2', 'verified'],
				[4, 'req-3', 'rendering-ready']
			]
		);
		// La revisione interrotta senza fotografia non e' ripristinabile: lo dichiara.
		assert.equal(entries[1].snapshot, undefined);
		assert.equal(typeof entries[1].snapshotIssue, 'string');
		assert.deepEqual(
			entries[3].snapshot?.files.map((file) => file.path),
			['src/App.tsx', 'src/Grafico.tsx']
		);
	});

	it('ripristina la prima revisione senza cancellare la storia successiva', async () => {
		const prima = (await listLabRevisions(context))[0];
		const ripristino = await restoreLabRevision(context, prima.revision.id, {
			requestId: 'req-4',
			summary: 'Torniamo alla prima proposta.'
		});

		// I file sono quelli della prima revisione: reintrodotti e ripuliti.
		assert.deepEqual(await contentsOf(store, context.prototypeId), {
			'src/App.tsx': 'export const v = 1;\n',
			'src/Tabella.tsx': 'export const densita = "comoda";\n'
		});
		assert.equal(
			await readLabPrototypeFile(store, context.prototypeId, 'src/Grafico.tsx'),
			null,
			'i file comparsi dopo la revisione scelta non restano sul disco'
		);

		// La storia e' cresciuta: il ripristino e' un fatto in piu', non una riscrittura.
		const entries = await listLabRevisions(context);
		assert.equal(entries.length, 5);
		assert.deepEqual(
			entries.map((entry) => entry.revision.sequence),
			[1, 2, 3, 4, 5]
		);
		assert.equal(entries[4].revision.id, ripristino.revision.id);
		assert.equal(entries[4].revision.parentId, prima.revision.id);
		assert.equal(entries[4].origin, 'restore');
		assert.equal(entries[4].revision.requestId, 'req-4');
		assert.deepEqual(
			entries.slice(0, 4).map((entry) => [entry.revision.id, entry.revision.state]),
			[
				[prima.revision.id, 'rendering-ready'],
				['r0002', 'interrupted'],
				['r0003', 'verified'],
				['r0004', 'rendering-ready']
			]
		);

		// La revisione interrotta non e' ripristinabile e il rifiuto e' esplicito.
		assert.equal(
			revisionCode(
				await restoreLabRevision(context, 'r0002', { requestId: 'req-5', summary: 'Prova.' }).then(
					() => null,
					(error: unknown) => error
				)
			),
			'no-snapshot'
		);
	});

	it('duplica il prototipo con provenienza, lasciando intatto l originale', async () => {
		const primaTree = treeOf(projectRoot);
		const primaStoria = await readLabRevisionHistory(context);
		const primaContenuti = await contentsOf(store, context.prototypeId);
		const primaManifest = await readLabPrototype(store, context.prototypeId);

		const duplicato = await duplicateLabPrototype({
			source: context,
			target: { archive, store },
			requestId: 'req-6',
			revisionId: 'r0003',
			title: 'Tabella pratiche variante C'
		});

		assert.equal(duplicato.prototype.id, 'tabella-pratiche-variante-c');
		assert.notEqual(duplicato.prototype.id, context.prototypeId);
		assert.equal(duplicato.revision.revision.sequence, 1);
		assert.equal(duplicato.revision.origin, 'duplicate');
		assert.equal(duplicato.revision.revision.parentId, 'r0003');
		// `verified` non si eredita: la verifica riguardava l'originale.
		assert.equal(duplicato.revision.revision.state, 'rendering-ready');

		// I file duplicati sono quelli della revisione scelta, non quelli attuali.
		assert.deepEqual(await contentsOf(store, duplicato.prototype.id), {
			'src/App.tsx': 'export const v = 2;\n',
			'src/Grafico.tsx': 'export const grafico = true;\n'
		});
		assert.equal(duplicato.prototype.manifest.title, 'Tabella pratiche variante C');
		assert.equal(duplicato.prototype.manifest.brief, primaManifest?.manifest.brief);

		// Provenienza registrata fuori da Git, con archivio, prototipo e revisione.
		const provenienza = await readLabPrototypeProvenance({
			archive,
			store,
			prototypeId: duplicato.prototype.id
		});
		assert.deepEqual(provenienza, {
			sourceScope: SCOPE,
			sourcePrototypeId: context.prototypeId,
			sourceRevisionId: 'r0003',
			sourceLocation: {
				kind: 'project',
				projectKey: projectRoot,
				relativePath: `proto/${context.prototypeId}`
			},
			duplicatedAt: provenienza?.duplicatedAt ?? 0
		});
		assert.ok(
			existsSync(
				join(
					dataDir,
					...labRevisionDirectory(archive, duplicato.prototype.id).split('/'),
					LAB_PROVENANCE_FILE
				)
			)
		);

		// L'originale non e' cambiato: file, manifest e storia identici.
		assert.deepEqual(await contentsOf(store, context.prototypeId), primaContenuti);
		assert.deepEqual((await readLabPrototype(store, context.prototypeId))?.manifest, primaManifest?.manifest);
		assert.deepEqual(await readLabRevisionHistory(context), primaStoria);

		// Fuori dal nuovo prototipo il progetto e' bit per bit quello di prima.
		const dopoTree = treeOf(projectRoot);
		const nuovo = `proto/${duplicato.prototype.id}/`;
		assert.deepEqual(
			[...dopoTree].filter(([path]) => !path.startsWith(nuovo)).sort(),
			[...primaTree].sort(),
			'la duplicazione non deve toccare nessun file fuori dal prototipo creato'
		);
		assert.ok([...dopoTree.keys()].some((path) => path.startsWith(nuovo)));

		// Nel progetto non compare nulla dell'archivio locale delle revisioni.
		assert.equal(
			[...dopoTree.keys()].some((path) => path.startsWith(`${LAB_REVISION_ARCHIVE_DIRECTORY}/`)),
			false
		);
		assert.deepEqual(readdirSync(projectRoot).sort(), ['package.json', 'proto', 'src']);
	});
});
