/**
 * Persistenza dei prototipi del Laboratorio su un filesystem reale.
 *
 * L'host Node di questo file e' l'implementazione di riferimento della porta
 * `LabStorageHost`: crea file esclusivi, sostituisce la destinazione in un
 * solo passo ed elenca le cartelle. Serve a verificare sul disco cio' che
 * conta davvero: creazione, rilettura, elenco, spostamento del progetto,
 * confinamento delle scritture e assenza di sovrascritture fra prototipi.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	existsSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	LAB_BRIEF_FILE,
	LAB_DRAFT_ARCHIVE_DIRECTORY,
	LAB_MANIFEST_FILE,
	LAB_MANIFEST_SCHEMA_VERSION,
	LabStorageError,
	allocateLabPrototypeId,
	createLabPrototype,
	isConfinedPrototypePath,
	isLabTemporaryName,
	labDraftStore,
	labProjectStore,
	labPrototypeDirectory,
	listLabDrafts,
	listLabPrototypes,
	readLabPrototype,
	readLabPrototypeFile,
	rebindLabPrototypes,
	saveLabPrototype,
	slugifyPrototypeTitle,
	writeLabPrototypeFile,
	type LabStorageHost
} from '../src/lib/lab/storage.ts';
import { nodeHost } from './lab-host.ts';

const TEMPLATE_VERSION = '1.0.0';

function creation(title: string, brief: string) {
	return {
		title,
		brief,
		templateVersion: TEMPLATE_VERSION,
		dependencies: [
			{ name: 'react', version: '19.2.8' },
			{ name: '@tailwindcss/browser', version: '4.3.3' }
		]
	};
}

function storageCode(error: unknown): string | undefined {
	return error instanceof LabStorageError ? error.code : undefined;
}

describe('Persistenza Laboratorio — prototipi di progetto', () => {
	let base: string;
	let projectRoot: string;

	before(() => {
		base = mkdtempSync(join(tmpdir(), 'omp-studio-lab-proto-'));
		projectRoot = join(base, 'progetto');
		mkdirSync(projectRoot);
	});

	after(() => {
		try {
			rmSync(base, { recursive: true, force: true });
		} catch {
			// pulizia best-effort
		}
	});

	it('crea il prototipo in proto/<id> con manifest, brief, src e assets', async () => {
		const store = labProjectStore(projectRoot, nodeHost(projectRoot));
		const created = await createLabPrototype(
			store,
			creation('Tabella pratiche PSR', 'Confronto fra tre densita di tabella.')
		);

		assert.equal(created.id, 'tabella-pratiche-psr');
		assert.deepEqual(created.location, {
			kind: 'project',
			projectKey: projectRoot,
			relativePath: 'proto/tabella-pratiche-psr'
		});

		const directory = join(projectRoot, 'proto', 'tabella-pratiche-psr');
		assert.ok(existsSync(join(directory, LAB_MANIFEST_FILE)));
		assert.ok(existsSync(join(directory, LAB_BRIEF_FILE)));
		assert.ok(existsSync(join(directory, 'src')));
		assert.ok(existsSync(join(directory, 'assets')));
		assert.equal(
			readFileSync(join(directory, LAB_BRIEF_FILE), 'utf8'),
			'Confronto fra tre densita di tabella.\n'
		);

		// Nessun temporaneo residuo: la scrittura atomica ha completato lo scambio.
		assert.deepEqual(readdirSync(directory).filter(isLabTemporaryName), []);
	});

	it('rilegge il prototipo e prende il brief da brief.md', async () => {
		const store = labProjectStore(projectRoot, nodeHost(projectRoot));
		const read = await readLabPrototype(store, 'tabella-pratiche-psr');

		assert.ok(read, 'il prototipo appena creato deve essere rileggibile');
		assert.equal(read.manifest.title, 'Tabella pratiche PSR');
		assert.equal(read.manifest.brief, 'Confronto fra tre densita di tabella.');
		assert.equal(read.manifest.templateVersion, TEMPLATE_VERSION);
		assert.deepEqual(read.manifest.dependencies, [
			{ name: 'react', version: '19.2.8' },
			{ name: '@tailwindcss/browser', version: '4.3.3' }
		]);

		// Il brief modificato dall'editor e' autoritativo: nessuna copia divergente
		// dentro prototype.json.
		const briefPath = join(projectRoot, 'proto', 'tabella-pratiche-psr', LAB_BRIEF_FILE);
		writeFileSync(briefPath, 'Brief riscritto a mano.\n', 'utf8');
		const reread = await readLabPrototype(store, 'tabella-pratiche-psr');
		assert.equal(reread?.manifest.brief, 'Brief riscritto a mano.');
	});

	it('non scrive percorsi assoluti ne la chiave del progetto nel manifest', async () => {
		const raw = readFileSync(
			join(projectRoot, 'proto', 'tabella-pratiche-psr', LAB_MANIFEST_FILE),
			'utf8'
		);
		const parsed = JSON.parse(raw) as Record<string, unknown>;

		assert.equal(parsed.schemaVersion, LAB_MANIFEST_SCHEMA_VERSION);
		assert.equal(parsed.id, 'tabella-pratiche-psr');
		assert.deepEqual(Object.keys(parsed).sort(), [
			'dependencies',
			'id',
			'schemaVersion',
			'templateVersion',
			'title'
		]);
		assert.ok(!raw.includes(projectRoot), 'il manifest non deve contenere il percorso assoluto');
		assert.ok(!raw.includes(tmpdir()), 'il manifest non deve contenere la radice temporanea');
	});

	it('alloca id distinti e rifiuta di sovrascrivere un prototipo esistente', async () => {
		const store = labProjectStore(projectRoot, nodeHost(projectRoot));
		const secondo = await createLabPrototype(
			store,
			creation('Tabella pratiche PSR', 'Seconda esplorazione, stesso titolo.')
		);
		assert.equal(secondo.id, 'tabella-pratiche-psr-2');

		await writeLabPrototypeFile(store, 'tabella-pratiche-psr', 'src/App.tsx', 'export default 1;');
		await writeLabPrototypeFile(store, 'tabella-pratiche-psr-2', 'src/App.tsx', 'export default 2;');

		assert.equal(
			await readLabPrototypeFile(store, 'tabella-pratiche-psr', 'src/App.tsx'),
			'export default 1;'
		);
		assert.equal(
			await readLabPrototypeFile(store, 'tabella-pratiche-psr-2', 'src/App.tsx'),
			'export default 2;'
		);

		const collisione = await createLabPrototype(store, {
			...creation('Tabella pratiche PSR', 'Tentativo di sovrascrittura.'),
			id: 'tabella-pratiche-psr'
		}).then(
			() => null,
			(error: unknown) => error
		);
		assert.equal(storageCode(collisione), 'already-exists');

		// Il prototipo bersaglio e' rimasto quello di prima.
		const superstite = await readLabPrototype(store, 'tabella-pratiche-psr');
		assert.equal(superstite?.manifest.brief, 'Brief riscritto a mano.');
		assert.equal(
			await readLabPrototypeFile(store, 'tabella-pratiche-psr', 'src/App.tsx'),
			'export default 1;'
		);
	});

	it('elenca i prototipi del progetto e segnala quelli illeggibili', async () => {
		const store = labProjectStore(projectRoot, nodeHost(projectRoot));
		const listing = await listLabPrototypes(store);

		assert.deepEqual(
			listing.prototypes.map((prototype) => prototype.id),
			['tabella-pratiche-psr', 'tabella-pratiche-psr-2']
		);
		assert.deepEqual(listing.unreadable, []);

		// Un manifest corrotto non deve nascondere gli altri prototipi.
		const rotto = join(projectRoot, 'proto', 'flusso-prenotazione');
		mkdirSync(rotto, { recursive: true });
		writeFileSync(join(rotto, LAB_MANIFEST_FILE), '{ "schemaVersion": 1, "id":', 'utf8');

		const dopo = await listLabPrototypes(store);
		assert.deepEqual(
			dopo.prototypes.map((prototype) => prototype.id),
			['tabella-pratiche-psr', 'tabella-pratiche-psr-2']
		);
		assert.deepEqual(
			dopo.unreadable.map((entry) => entry.name),
			['flusso-prenotazione']
		);
		await assert.rejects(
			() => readLabPrototype(store, 'flusso-prenotazione'),
			(error: unknown) => storageCode(error) === 'invalid-manifest'
		);

		rmSync(rotto, { recursive: true, force: true });
	});

	it('aggiorna manifest e brief in modo atomico, senza toccare i sorgenti', async () => {
		const store = labProjectStore(projectRoot, nodeHost(projectRoot));
		const before = await readLabPrototype(store, 'tabella-pratiche-psr-2');
		assert.ok(before);

		const salvato = await saveLabPrototype(store, {
			...before.manifest,
			title: 'Tabella pratiche PSR — variante C',
			brief: 'Brief aggiornato dopo la revisione.',
			dependencies: [{ name: 'react', version: '19.2.8' }]
		});
		assert.equal(salvato.manifest.title, 'Tabella pratiche PSR — variante C');

		const riletto = await readLabPrototype(store, 'tabella-pratiche-psr-2');
		assert.equal(riletto?.manifest.brief, 'Brief aggiornato dopo la revisione.');
		assert.deepEqual(riletto?.manifest.dependencies, [{ name: 'react', version: '19.2.8' }]);
		assert.equal(
			await readLabPrototypeFile(store, 'tabella-pratiche-psr-2', 'src/App.tsx'),
			'export default 2;'
		);

		const directory = join(projectRoot, 'proto', 'tabella-pratiche-psr-2');
		assert.deepEqual(readdirSync(directory).filter(isLabTemporaryName), []);
	});

	it('lascia intatta la versione precedente se la sostituzione fallisce', async () => {
		const host = nodeHost(projectRoot);
		const guasto: LabStorageHost = {
			...host,
			async replaceFile(temp, target) {
				if (target.endsWith(LAB_MANIFEST_FILE)) throw new Error('sostituzione interrotta');
				return host.replaceFile(temp, target);
			}
		};
		const store = labProjectStore(projectRoot, guasto);
		const before = await readLabPrototype(store, 'tabella-pratiche-psr-2');
		assert.ok(before);

		const errore = await saveLabPrototype(store, {
			...before.manifest,
			title: 'Titolo che non deve arrivare su disco'
		}).then(
			() => null,
			(error: unknown) => error
		);
		assert.equal(storageCode(errore), 'host-failure');

		const riletto = await readLabPrototype(labProjectStore(projectRoot, host), 'tabella-pratiche-psr-2');
		assert.equal(riletto?.manifest.title, 'Tabella pratiche PSR — variante C');

		const directory = join(projectRoot, 'proto', 'tabella-pratiche-psr-2');
		assert.deepEqual(
			readdirSync(directory).filter(isLabTemporaryName),
			[],
			'il temporaneo va rimosso quando la sostituzione fallisce'
		);
	});

	it('rifiuta ogni scrittura fuori dalla cartella del prototipo', async () => {
		const store = labProjectStore(projectRoot, nodeHost(projectRoot));
		const rifiutati = [
			'../fuori.txt',
			'../../fuori.txt',
			'src/../../fuori.txt',
			'/etc/passwd',
			'C:/Windows/System32/drivers/etc/hosts',
			'src\\..\\..\\fuori.txt',
			'.git/config',
			'.gitignore',
			'src//App.tsx',
			'src/con.tsx',
			'',
			'src/App.tsx\u0000.png'
		];

		for (const path of rifiutati) {
			assert.equal(isConfinedPrototypePath(path), false, `deve essere rifiutato: ${path}`);
			const errore = await writeLabPrototypeFile(
				store,
				'tabella-pratiche-psr',
				path,
				'contenuto ostile'
			).then(
				() => null,
				(error: unknown) => error
			);
			assert.equal(storageCode(errore), 'invalid-path', `deve essere rifiutato: ${path}`);
		}

		// Il manifest non si aggiorna come file libero: passa dalla validazione.
		const manifest = await writeLabPrototypeFile(
			store,
			'tabella-pratiche-psr',
			LAB_MANIFEST_FILE,
			'{}'
		).then(
			() => null,
			(error: unknown) => error
		);
		assert.equal(storageCode(manifest), 'invalid-path');
		assert.ok((await readLabPrototype(store, 'tabella-pratiche-psr'))?.manifest.id);

		// Un id non valido non diventa un percorso.
		for (const id of ['../altro', 'proto/x', 'CON', 'Maiuscolo']) {
			assert.throws(() => labPrototypeDirectory(store, id), (error: unknown) =>
				storageCode(error) === 'invalid-id'
			);
		}

		// Niente e' comparso fuori dal prototipo.
		assert.deepEqual(readdirSync(projectRoot), ['proto']);
		assert.deepEqual(readdirSync(base).sort(), ['progetto']);
		assert.deepEqual(readdirSync(join(projectRoot, 'proto')).sort(), [
			'tabella-pratiche-psr',
			'tabella-pratiche-psr-2'
		]);
	});

	it('conserva i prototipi quando il progetto viene rinominato o spostato', async () => {
		const primaHost = nodeHost(projectRoot);
		const primaStore = labProjectStore(projectRoot, primaHost);
		const prima = await listLabPrototypes(primaStore);

		// Spostamento reale del progetto: nuova cartella, nuovo percorso assoluto.
		const spostato = join(base, 'progetto-rinominato');
		renameSync(projectRoot, spostato);
		projectRoot = spostato;

		const dopoStore = labProjectStore(spostato, nodeHost(spostato));
		const dopo = await listLabPrototypes(dopoStore);

		assert.deepEqual(
			dopo.prototypes.map((prototype) => prototype.id),
			prima.prototypes.map((prototype) => prototype.id)
		);
		assert.deepEqual(
			dopo.prototypes.map((prototype) => prototype.manifest),
			prima.prototypes.map((prototype) => prototype.manifest)
		);
		assert.deepEqual(dopo.prototypes, rebindLabPrototypes(prima.prototypes, spostato));
		assert.equal(
			await readLabPrototypeFile(dopoStore, 'tabella-pratiche-psr', 'src/App.tsx'),
			'export default 1;'
		);

		// L'archivio precedente non esiste piu': l'identita' non dipendeva dal percorso.
		const vecchio = await listLabPrototypes(primaStore);
		assert.deepEqual(vecchio.prototypes, []);
	});
});

describe('Persistenza Laboratorio — bozze senza progetto', () => {
	let dataDir: string;

	before(() => {
		dataDir = mkdtempSync(join(tmpdir(), 'omp-studio-lab-draft-'));
	});

	after(() => {
		try {
			rmSync(dataDir, { recursive: true, force: true });
		} catch {
			// pulizia best-effort
		}
	});

	it('conserva la bozza nella cartella dati locale e la ritrova nell elenco', async () => {
		const host = nodeHost(dataDir);
		const store = labDraftStore(host);
		const bozza = await createLabPrototype(
			store,
			creation('Idea libera: onboarding', 'Tre schermate collegate, dati simulati.')
		);

		assert.deepEqual(bozza.location, { kind: 'draft', archiveKey: bozza.id });
		const directory = join(dataDir, ...LAB_DRAFT_ARCHIVE_DIRECTORY.split('/'), bozza.id);
		assert.ok(existsSync(join(directory, LAB_MANIFEST_FILE)));
		assert.ok(existsSync(join(directory, 'src')));

		await writeLabPrototypeFile(store, bozza.id, 'src/App.tsx', 'export default 3;');

		// Riapertura con un host nuovo: e' lo scenario "chiudo e riapro Studio".
		const listing = await listLabDrafts(nodeHost(dataDir));
		assert.deepEqual(
			listing.prototypes.map((prototype) => prototype.id),
			[bozza.id]
		);
		assert.equal(listing.prototypes[0]?.manifest.brief, 'Tre schermate collegate, dati simulati.');
		assert.equal(
			await readLabPrototypeFile(labDraftStore(nodeHost(dataDir)), bozza.id, 'src/App.tsx'),
			'export default 3;'
		);
	});

	it('non mescola le bozze con i prototipi di un progetto', async () => {
		const store = labDraftStore(nodeHost(dataDir));
		const seconda = await createLabPrototype(
			store,
			creation('Idea libera: onboarding', 'Variante piu compatta.')
		);
		assert.equal(seconda.id, 'idea-libera-onboarding-2');

		const listing = await listLabDrafts(nodeHost(dataDir));
		assert.deepEqual(
			listing.prototypes.map((prototype) => prototype.id).sort(),
			['idea-libera-onboarding', 'idea-libera-onboarding-2']
		);
		assert.deepEqual(readdirSync(dataDir), ['lab']);
	});
});

describe('Persistenza Laboratorio — id derivati dal titolo', () => {
	it('deriva id sicuri e ricade su un nome valido quando il titolo non basta', () => {
		assert.equal(slugifyPrototypeTitle('Tabella pratiche PSR'), 'tabella-pratiche-psr');
		assert.equal(slugifyPrototypeTitle('Città  —  Anagrafiche!'), 'citta-anagrafiche');
		assert.equal(slugifyPrototypeTitle('  ../..  '), null);
		assert.equal(slugifyPrototypeTitle('C'), null);
		assert.equal(slugifyPrototypeTitle('CON'), null);
	});

	it('alloca il primo id libero anche senza cartella dell archivio', async () => {
		const root = mkdtempSync(join(tmpdir(), 'omp-studio-lab-id-'));
		try {
			const store = labProjectStore(root, nodeHost(root));
			assert.equal(await allocateLabPrototypeId(store, '???'), 'prototipo');
			assert.equal(await allocateLabPrototypeId(store, 'Nuovo flusso'), 'nuovo-flusso');
			await createLabPrototype(store, creation('Nuovo flusso', 'Primo.'));
			assert.equal(await allocateLabPrototypeId(store, 'Nuovo flusso'), 'nuovo-flusso-2');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
