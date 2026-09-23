import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildProjectMetadata,
	createProjectMetadataMap,
	resolveProjectTabInfo,
	pruneProjectMetadata,
	type StoredProjectMetadata
} from '../src/lib/stores/projectTabHelpers.ts';
import { pathKey } from '../src/lib/utils/paths.ts';

describe('Persistenza modifiche schede progetto (tab customizations)', () => {
	describe('buildProjectMetadata', () => {
		it('costruisce metadati completi da un progetto con percorso canonico', () => {
			const meta = buildProjectMetadata({
				id: 'proj-1',
				name: '  Mio Progetto  ',
				label: '  MP  ',
				canonicalProjectPath: 'C:/Users/test/source/repos/MioProgetto',
				hue: 135,
				colorMode: 'custom',
				layout: { left: 300, center: 0.6, leftSection: 'sessions', editorOpen: false },
				lastOpened: 123456789,
				autoDispatch: true,
				taskDefaults: { role: 'writer', thinkingLevel: 'high', includeEditorContext: false },
				browserAllowedOrigins: ['https://example.com']
			});

			assert.ok(meta);
			assert.equal(meta!.id, 'proj-1');
			assert.equal(meta!.name, 'Mio Progetto');
			assert.equal(meta!.label, 'MP');
			assert.equal(meta!.hue, 135);
			assert.equal(meta!.colorMode, 'custom');
			assert.equal(meta!.autoDispatch, true);
			assert.deepEqual(meta!.taskDefaults, {
				role: 'writer',
				thinkingLevel: 'high',
				includeEditorContext: false
			});
			assert.deepEqual(meta!.browserAllowedOrigins, ['https://example.com']);
			assert.deepEqual(meta!.layout, {
				left: 300,
				center: 0.6,
				leftSection: 'sessions',
				editorOpen: false
			});
		});

		it('ritorna null se canonicalProjectPath e null (Scratchpad)', () => {
			const meta = buildProjectMetadata({
				id: 'scratchpad-id',
				name: 'Scratchpad',
				label: null,
				canonicalProjectPath: null,
				hue: 0,
				colorMode: 'auto'
			});

			assert.equal(meta, null);
		});

		it('normalizza label vuota o con soli spazi a null', () => {
			const meta = buildProjectMetadata({
				id: 'proj-2',
				name: 'Progetto Due',
				label: '   ',
				canonicalProjectPath: '/home/user/dev/due',
				hue: 60,
				colorMode: 'auto'
			});
			assert.ok(meta);
			assert.equal(meta!.label, null);
		});
	});

	describe('createProjectMetadataMap', () => {
		it('indicizza i metadati per chiave normalizzata e case-insensitive su Windows', () => {
			const list: StoredProjectMetadata[] = [
				{
					id: 'p1',
					path: 'C:\\Users\\test\\repos\\cruscotto-psr',
					name: 'PSR',
					label: 'PSR',
					hue: 220,
					colorMode: 'custom',
					lastOpened: 100
				},
				{
					id: 'p2',
					path: 'c:/users/test/repos/cruscotto-psr/',
					name: 'PSR Aggiornato',
					label: 'PSR2',
					hue: 265,
					colorMode: 'custom',
					lastOpened: 200
				}
			];

			const map = createProjectMetadataMap(list);
			const key = pathKey('C:/Users/test/repos/cruscotto-psr');
			assert.ok(map.has(key));
			const entry = map.get(key);
			assert.equal(entry?.name, 'PSR Aggiornato');
			assert.equal(entry?.label, 'PSR2');
			assert.equal(entry?.hue, 265);
		});

		it('gestisce array vuoto o nullo senza errori', () => {
			const m1 = createProjectMetadataMap(null);
			assert.equal(m1.size, 0);

			const m2 = createProjectMetadataMap([]);
			assert.equal(m2.size, 0);
		});
	});

	describe('resolveProjectTabInfo', () => {
		it('ripristina nome, sigla e colore personalizzati se presenti nei metadati', () => {
			const meta: StoredProjectMetadata = {
				id: 'saved-id',
				path: 'C:/repos/cruscotto-psr',
				name: 'Cruscotto PSR Coldiretti',
				label: 'PSR',
				hue: 355,
				colorMode: 'custom',
				layout: { left: 320, center: 0.4, leftSection: 'files', editorOpen: true },
				autoDispatch: true,
				taskDefaults: { role: 'writer' }
			};

			const resolved = resolveProjectTabInfo('C:/repos/cruscotto-psr', meta, 60);

			assert.equal(resolved.id, 'saved-id');
			assert.equal(resolved.name, 'Cruscotto PSR Coldiretti');
			assert.equal(resolved.label, 'PSR');
			assert.equal(resolved.hue, 355);
			assert.equal(resolved.autoDispatch, true);
			assert.deepEqual(resolved.taskDefaults, { role: 'writer' });
			assert.equal(resolved.layout.left, 320);
		});

		it('usa i default di fabbrica se non ci sono metadati pregressi', () => {
			const resolved = resolveProjectTabInfo('C:/repos/mio-nuovo-progetto', undefined, 175);

			assert.equal(resolved.name, 'mio-nuovo-progetto');
			assert.equal(resolved.label, null);
			assert.equal(resolved.hue, 175);
			assert.equal(resolved.colorMode, 'auto');
			assert.equal(resolved.autoDispatch, false);
			assert.equal(resolved.taskDefaults, null);
			assert.equal(resolved.layout.left, 260);
			assert.equal(resolved.layout.editorOpen, true);
		});

		it('mantiene colorMode auto se lutente aveva scelto la modalita automatica', () => {
			const meta: StoredProjectMetadata = {
				path: 'C:/repos/progetto-auto',
				name: 'Progetto Auto',
				colorMode: 'auto'
			};

			const resolved = resolveProjectTabInfo('C:/repos/progetto-auto', meta, 220);
			assert.equal(resolved.colorMode, 'auto');
			assert.equal(resolved.hue, 220);
		});
	});

	describe('pruneProjectMetadata', () => {
		it('limita il numero massimo di progetti conservando i piu recenti', () => {
			const items: StoredProjectMetadata[] = [
				{ path: '/p1', name: 'P1', lastOpened: 10 },
				{ path: '/p2', name: 'P2', lastOpened: 50 },
				{ path: '/p3', name: 'P3', lastOpened: 30 }
			];

			const pruned = pruneProjectMetadata(items, 2);
			assert.equal(pruned.length, 2);
			assert.equal(pruned[0].path, '/p2');
			assert.equal(pruned[1].path, '/p3');
		});
	});

	describe('Simulazione ciclo di vita: apri -> personalizza tab -> chiudi -> riapri', () => {
		it('riaprendo lo stesso percorso dopo la chiusura ritrova le stesse personalizzazioni', () => {
			const metadataStore = new Map<string, StoredProjectMetadata>();
			const projectPath = 'C:/Users/coldiretti/source/repos/Cruscotto PSR';

			// 1. Prima apertura (nessun metadato pregresso)
			const key = pathKey(projectPath);
			const initialMeta = metadataStore.get(key);
			const opened1 = resolveProjectTabInfo(projectPath, initialMeta, 60);
			assert.equal(opened1.name, 'Cruscotto PSR');
			assert.equal(opened1.label, null);
			assert.equal(opened1.colorMode, 'auto');

			// 2. L'utente personalizza la tab del progetto: nome, sigla e colore
			const customizedProj = {
				id: 'uuid-1',
				name: 'PSR Cuneo',
				label: 'PSR',
				canonicalProjectPath: projectPath,
				hue: 305,
				colorMode: 'custom' as const,
				layout: { left: 280, center: 0.5, leftSection: 'files' as const, editorOpen: true },
				lastOpened: Date.now(),
				autoDispatch: false,
				taskDefaults: null
			};
			const savedMeta = buildProjectMetadata(customizedProj);
			assert.ok(savedMeta);
			metadataStore.set(key, savedMeta);

			// 3. L'utente chiude la tab del progetto.
			// La scheda non e piu attiva, ma metadataStore conserva i dati.
			assert.ok(metadataStore.has(key));

			// 4. L'utente riapre il progetto (ad esempio tramite ProjectPicker o Sfoglia)
			const reloadedMeta = metadataStore.get(key);
			const opened2 = resolveProjectTabInfo(projectPath, reloadedMeta, 60);

			// 5. Verifica: le informazioni della scheda coincidono esattamente con quelle personalizzate!
			assert.equal(opened2.name, 'PSR Cuneo');
			assert.equal(opened2.label, 'PSR');
			assert.equal(opened2.hue, 305);
			assert.equal(opened2.colorMode, 'custom');
			assert.equal(opened2.layout.left, 280);
		});
	});
});
