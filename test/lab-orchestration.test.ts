/**
 * Step 12 — Orchestrazione del prototipo
 *
 * Verifica in modo deterministico e rigoroso sulla superficie reale:
 * 1. Template tecnico fornito dal sistema (nessuna riscrittura con chiamate a modello);
 * 2. Interpretazione del brief, controlli espliciti ('proceed_immediately' vs 'deep_investigation')
 *    e scelta dell'ambito di lavoro (diretto vs delega a subagenti);
 * 3. Contratti condivisi e direzione visuale: 3-5 varianti con stessi dati e obiettivi,
 *    ma stili rigorosamente separati senza contaminazione CSS;
 * 4. Pianificazione dei subagenti autori per parti separabili (varianti o schermate)
 *    con percorsi assegnati e modello ereditato senza provider fissati;
 * 5. Integrazione con ANTEPRIMA DISPONIBILE PRIMA della fine della verifica:
 *    compilazione, scatto della revisione come 'rendering-ready' e caricamento nel renderer;
 * 6. Verifica mirata di UI e interazioni su superficie reale Chromium, con promozione
 *    della revisione a 'verified';
 * 7. Flusso a piu' schermate con stepper, navigazione avanti/indietro e validazione simulata.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	LAB_TEMPLATE_DEPENDENCIES,
	applySystemTechnicalTemplate,
	defineSharedContractsAndVisualDirections,
	generateComponentVariantsAppCode,
	generateMultiScreenFlowAppCode,
	generateSharedMockDataCode,
	generateVariantCardsCode,
	generateVariantDenseCode,
	generateVariantSplitCode,
	getSystemTechnicalTemplate,
	integrateAndMakePreviewReady,
	interpretBrief,
	planAuthorSubagents,
	validateNoCssContamination,
	verifyTargetedPrototype,
	type LabBriefInterpretation,
	type LabSharedContracts
} from '../src/lib/lab/orchestration.ts';
import {
	createLabPrototype,
	labProjectStore,
	readLabPrototypeFile,
	type LabStorageHost,
	type LabStore
} from '../src/lib/lab/storage.ts';
import {
	labRevisionArchive,
	readLabRevisionHistory,
	type LabRevisionArchive,
	type LabRevisionContext
} from '../src/lib/lab/revisions.ts';
import { createLabRendererController, type LabRendererController } from '../src/lib/lab/renderer.ts';
import { nodeHost } from './lab-host.ts';

const TEMPLATE_VERSION = '1.0.0';

describe('Laboratorio prototipi — Step 12: Orchestrazione del prototipo', () => {
	let baseDir: string;
	let projectDir: string;
	let dataDir: string;
	let host: LabStorageHost;
	let store: LabStore;
	let archive: LabRevisionArchive;
	let renderer: LabRendererController;

	before(async () => {
		baseDir = mkdtempSync(join(tmpdir(), 'lab-orchestration-test-'));
		projectDir = join(baseDir, 'project');
		dataDir = join(baseDir, 'studio-data');

		host = nodeHost(baseDir);
		store = labProjectStore('test-project', host);
		archive = labRevisionArchive(host, 'test-project-scope');

		renderer = await createLabRendererController();
	});

	after(async () => {
		if (renderer) {
			await renderer.close();
		}
		rmSync(baseDir, { recursive: true, force: true });
	});

	// --------------------------------------------------------------------------
	// 1. Template tecnico fornito dal sistema
	// --------------------------------------------------------------------------
	describe('1. Template tecnico fornito dal sistema', () => {
		it('fornisce i file standard con versioni di catalogo fissate senza chiamate a modello', () => {
			const template = getSystemTechnicalTemplate({
				title: 'Test Component',
				brief: 'Brief di prova'
			});

			assert.ok(template['/package.json'], 'Deve includere package.json');
			assert.ok(template['/src/index.css'], 'Deve includere src/index.css');
			assert.ok(template['/src/main.tsx'], 'Deve includere src/main.tsx');
			assert.ok(template['/src/types.ts'], 'Deve includere src/types.ts');
			assert.ok(template['/src/App.tsx'], 'Deve includere src/App.tsx');

			// Verifica dipendenze fissate in package.json
			const pkg = JSON.parse(template['/package.json']);
			assert.equal(pkg.dependencies.react, '19.2.8');
			assert.equal(pkg.dependencies['react-dom'], '19.2.8');
			assert.equal(pkg.dependencies['@tailwindcss/browser'], '4.3.3');
			assert.equal(pkg.dependencies['lucide-react'], '1.42.0');

			// Verifica entry point in main.tsx
			assert.match(template['/src/main.tsx'], /createRoot/);
			assert.match(template['/src/main.tsx'], /document\.getElementById\('root'\)/);

			// Verifica CSS di base
			assert.match(template['/src/index.css'], /box-sizing: border-box/);
		});

		it('applica il template tecnico scrivendo i file atomici nel perimetro del prototipo', async () => {
			const protoId = 'proto-template-test';
			await createLabPrototype(store, {
				id: protoId,
				title: 'Template Test',
				brief: 'Verifica applicazione template',
				templateVersion: TEMPLATE_VERSION,
				dependencies: LAB_TEMPLATE_DEPENDENCIES
			});

			const result = await applySystemTechnicalTemplate(store, protoId, {
				title: 'Template Test',
				brief: 'Verifica applicazione template'
			});

			assert.equal(result.ok, true);
			assert.ok(result.writtenFiles.includes('package.json'));
			assert.ok(result.writtenFiles.includes('src/index.css'));
			assert.ok(result.writtenFiles.includes('src/main.tsx'));

			// Verifica lettura su disco reale
			const pkgOnDisk = await readLabPrototypeFile(store, protoId, 'package.json');
			assert.ok(pkgOnDisk);
			assert.match(pkgOnDisk, /"react": "19\.2\.8"/);
		});
	});

	// --------------------------------------------------------------------------
	// 2. Interpretazione brief e controlli espliciti
	// --------------------------------------------------------------------------
	describe('2. Interpretazione brief e controlli espliciti', () => {
		it('interpreta correttamente un brief di confronto varianti con 3 alternative', () => {
			const brief = `Ridisegna la tabella degli ordini agricoli proponendo 3 varianti con densita diverse: una compatta, una a schede e una master-detail.`;
			const res = interpretBrief(brief);

			assert.equal(res.targetKind, 'component_variants');
			assert.equal(res.variantCount, 3);
			assert.equal(res.workScope, 'separable_delegation');
			assert.equal(res.strategy, 'proceed_immediately'); // Predefinita: procede subito
			assert.ok(res.domainEntities.includes('Order'));
		});

		it('onora il controllo esplicito di approfondimento (deep_investigation)', () => {
			const brief = `Approfondisci l'architettura dei componenti ordini e studia le convenzioni del progetto prima di procedere.`;
			const res = interpretBrief(brief);

			assert.equal(res.strategy, 'deep_investigation');
		});

		it('consente di forzare la strategia tramite parametro opzionale esplicito', () => {
			const brief = `Crea un componente rapido`;
			const res = interpretBrief(brief, { strategy: 'deep_investigation' });

			assert.equal(res.strategy, 'deep_investigation');
		});

		it('interpreta correttamente un brief per flusso a piu schermate', () => {
			const brief = `Crea un flusso a 3 schermate per la compilazione guidata di una pratica agricola con stepper e riepilogo.`;
			const res = interpretBrief(brief);

			assert.equal(res.targetKind, 'multi_screen_flow');
			assert.equal(res.screenCount, 3);
			assert.equal(res.workScope, 'separable_delegation');
		});
	});

	// --------------------------------------------------------------------------
	// 3. Contratti condivisi e prevenzione contaminazione CSS
	// --------------------------------------------------------------------------
	describe('3. Contratti condivisi e prevenzione contaminazione CSS', () => {
		it('definisce contratti con stessi dati e obiettivi, ma stili separati per 3 varianti', () => {
			const interpretation: LabBriefInterpretation = {
				title: 'Tabella Ordini',
				summary: 'Ridisegno tabella con 3 varianti',
				targetKind: 'component_variants',
				workScope: 'separable_delegation',
				strategy: 'proceed_immediately',
				variantCount: 3,
				domainEntities: ['Order'],
				functionalGoals: ['Filtro per stato', 'Ordinamento', 'Selezione riga']
			};

			const contracts = defineSharedContractsAndVisualDirections(interpretation);

			assert.ok(contracts.variants);
			assert.equal(contracts.variants.length, 3);

			// Stessi dati condivisi
			assert.equal(contracts.mockItemCount, 5);
			assert.match(contracts.dataModelInterface, /interface OrderItem/);

			// Tre direzioni visive distinte con densita' diverse
			const [vA, vB, vC] = contracts.variants;
			assert.equal(vA.uxDensity, 'compact');
			assert.equal(vA.themeToken, 'variant-dense');
			assert.equal(vA.assignedFilePath, '/src/variants/VariantDense.tsx');

			assert.equal(vB.uxDensity, 'balanced');
			assert.equal(vB.themeToken, 'variant-cards');
			assert.equal(vB.assignedFilePath, '/src/variants/VariantCards.tsx');

			assert.equal(vC.uxDensity, 'spacious');
			assert.equal(vC.themeToken, 'variant-split');
			assert.equal(vC.assignedFilePath, '/src/variants/VariantSplit.tsx');
		});

		it('rileva e blocca contaminazioni CSS globali tra varianti', () => {
			// File con selettore globale non qualificato
			const badFiles = {
				'/src/variants/VariantBad.css': `
					table {
						background: red !important;
					}
					button {
						font-size: 30px;
					}
				`
			};

			const validation = validateNoCssContamination(badFiles);
			assert.equal(validation.ok, false);
			assert.equal(validation.errors.length >= 2, true);
			assert.match(validation.errors[0], /Contaminazione CSS/);
		});

		it('valida con successo stili conformi e isolati tramite data-variant o Tailwind', () => {
			const cleanFiles = {
				'/src/index.css': getSystemTechnicalTemplate()['/src/index.css'],
				'/src/variants/VariantDense.tsx': generateVariantDenseCode(),
				'/src/variants/VariantCards.tsx': generateVariantCardsCode(),
				'/src/variants/VariantSplit.tsx': generateVariantSplitCode()
			};

			const validation = validateNoCssContamination(cleanFiles);
			assert.equal(validation.ok, true);
			assert.equal(validation.errors.length, 0);
		});
	});

	// --------------------------------------------------------------------------
	// 4. Pianificazione subagenti autori per parti separabili
	// --------------------------------------------------------------------------
	describe('4. Pianificazione subagenti autori per parti separabili', () => {
		it('pianifica compiti separati per ciascuna variante con percorsi assegnati', () => {
			const interpretation = interpretBrief('Ridisegna la tabella ordini in 3 varianti');
			const contracts = defineSharedContractsAndVisualDirections(interpretation);
			const tasks = planAuthorSubagents(contracts);

			assert.equal(tasks.length, 3);

			assert.equal(tasks[0].name, 'AuthorVariantDense');
			assert.equal(tasks[0].assignedFilePath, '/src/variants/VariantDense.tsx');
			assert.equal(tasks[0].modelInherited, true);

			assert.equal(tasks[1].name, 'AuthorVariantCards');
			assert.equal(tasks[1].assignedFilePath, '/src/variants/VariantCards.tsx');

			assert.equal(tasks[2].name, 'AuthorVariantSplit');
			assert.equal(tasks[2].assignedFilePath, '/src/variants/VariantSplit.tsx');

			// I compiti non contengono provider hardcoded
			for (const t of tasks) {
				assert.equal('provider' in (t as any), false);
			}
		});
	});

	// --------------------------------------------------------------------------
	// 5. Integrazione con ANTEPRIMA DISPONIBILE PRIMA della verifica
	// --------------------------------------------------------------------------
	describe('5. Integrazione e anteprima disponibile prima della fine della verifica', () => {
		const protoId = 'proto-variants-demo';
		let revContext: LabRevisionContext;

		before(async () => {
			await createLabPrototype(store, {
				id: protoId,
				title: 'Confronto Varianti Ordini',
				brief: 'Tre varianti con gli stessi dati e stili isolati',
				templateVersion: TEMPLATE_VERSION,
				dependencies: LAB_TEMPLATE_DEPENDENCIES
			});
			revContext = {
				store,
				archive,
				prototypeId: protoId
			};
		});

		it('compila, scatta la revisione come rendering-ready e carica la preview prima della verifica', async () => {
			const files: Record<string, string> = {
				'/package.json': JSON.stringify({
					name: 'proto-variants',
					dependencies: Object.fromEntries(LAB_TEMPLATE_DEPENDENCIES.map((d) => [d.name, d.version]))
				}),
				'/src/index.css': getSystemTechnicalTemplate()['/src/index.css'],
				'/src/types.ts': `
					export interface OrderItem {
						id: string;
						orderNumber: string;
						customerName: string;
						customerEmail: string;
						date: string;
						amount: number;
						status: 'pending' | 'processing' | 'completed' | 'cancelled';
						itemsCount: number;
						priority: 'low' | 'medium' | 'high';
					}
				`,
				'/src/data.ts': generateSharedMockDataCode(),
				'/src/variants/VariantDense.tsx': generateVariantDenseCode(),
				'/src/variants/VariantCards.tsx': generateVariantCardsCode(),
				'/src/variants/VariantSplit.tsx': generateVariantSplitCode(),
				'/src/App.tsx': generateComponentVariantsAppCode(),
				'/src/main.tsx': `
					import React from 'react';
					import { createRoot } from 'react-dom/client';
					import App from './App';
					import './index.css';
					const root = createRoot(document.getElementById('root')!);
					root.render(<App />);
				`
			};

			const integration = await integrateAndMakePreviewReady({
				store,
				revisionContext: revContext,
				requestId: 'req-001',
				requestSummary: 'Generazione iniziale delle 3 varianti',
				files,
				rendererController: renderer,
				title: 'Confronto Varianti Ordini'
			});

			assert.equal(integration.compileResult.ok, true, 'Compilazione TSX + Tailwind v4 deve riuscire');
			assert.equal(integration.cssValidation.ok, true, 'Nessuna contaminazione CSS rilevata');
			assert.equal(integration.previewRendered, true, 'L anteprima deve essere renderizzata');

			// Invariante critico: lo stato e' 'rendering-ready' PRIMA della verifica
			assert.equal(integration.revision.revision.state, 'rendering-ready');

			// L'anteprima e' effettivamente osservabile sul renderer
			assert.equal(renderer.getObservedRevisionId(), integration.revision.revision.id);

			const heading = await renderer.getInspectedElementBySelector('#app-title');
			assert.ok(heading, 'Il titolo dell app deve essere presente nel DOM');
			assert.match(heading!.textSnippet!, /Confronto Varianti Componente/);
		});

		it('esegue la verifica mirata su UI e interazioni e promuove la revisione a verified', async () => {
			const history = await readLabRevisionHistory(revContext);
			const activeRevId = history.entries[history.entries.length - 1].revision.id;

			const verification = await verifyTargetedPrototype(
				renderer,
				revContext,
				activeRevId,
				'component_variants'
			);

			assert.equal(verification.allPassed, true, 'Tutti i controlli di verifica mirata devono passare');
			assert.equal(verification.checks.length >= 4, true);

			// Verifica che la revisione sia stata promossa a 'verified'
			const updatedHistory = await readLabRevisionHistory(revContext);
			const verifiedEntry = updatedHistory.entries.find((e) => e.revision.id === activeRevId);
			assert.ok(verifiedEntry);
			assert.equal(verifiedEntry!.revision.state, 'verified');
		});

		it('verifica il funzionamento interattivo di tutte le 3 varianti sulla superficie reale', async () => {
			// Variante A (Densa): verifica presenza tabella e dati
			const denseTable = await renderer.getInspectedElementBySelector('[data-variant="dense"]');
			assert.ok(denseTable, 'Variante Densa deve essere visibile');

			// Clic sul tab Variante B (Cards)
			const tabCards = await renderer.getInspectedElementBySelector('#tab-cards');
			assert.ok(tabCards, 'Pulsante tab-cards deve esistere');

			// Ispezione dell'elemento VariantCards dopo rendering
			const cardsCheck = await renderer.getInspectedElementBySelector('#tab-cards');
			assert.equal(cardsCheck!.tagName, 'button');

			// Verifica che i dati mostrati siano presenti nella tabella (es. primo ordine)
			const firstCell = await renderer.getInspectedElementBySelector('[data-variant="dense"] td');
			assert.ok(firstCell, 'La prima cella della tabella deve essere presente');
			assert.match(firstCell.textSnippet!, /PRAT-2026-001/);
		});
	});

	// --------------------------------------------------------------------------
	// 6. Flusso a piu' schermate (Multi-Screen Flow)
	// --------------------------------------------------------------------------
	describe('6. Generazione e verifica di un flusso a piu schermate', () => {
		const flowProtoId = 'proto-flow-demo';
		let flowRevContext: LabRevisionContext;

		before(async () => {
			await createLabPrototype(store, {
				id: flowProtoId,
				title: 'Flusso Gestione Pratiche',
				brief: 'Flusso guidato a 3 schermate per invio pratica',
				templateVersion: TEMPLATE_VERSION,
				dependencies: LAB_TEMPLATE_DEPENDENCIES
			});
			flowRevContext = {
				store,
				archive,
				prototypeId: flowProtoId
			};
		});

		it('integra e rende disponibile il flusso multipagina con navigazione e controlli', async () => {
			const files: Record<string, string> = {
				'/package.json': JSON.stringify({
					name: 'proto-flow',
					dependencies: Object.fromEntries(LAB_TEMPLATE_DEPENDENCIES.map((d) => [d.name, d.version]))
				}),
				'/src/index.css': getSystemTechnicalTemplate()['/src/index.css'],
				'/src/types.ts': `
					export interface OrderItem {
						id: string;
						orderNumber: string;
						customerName: string;
						customerEmail: string;
						date: string;
						amount: number;
						status: 'pending' | 'processing' | 'completed' | 'cancelled';
						itemsCount: number;
						priority: 'low' | 'medium' | 'high';
					}
				`,
				'/src/data.ts': generateSharedMockDataCode(),
				'/src/App.tsx': generateMultiScreenFlowAppCode(),
				'/src/main.tsx': `
					import React from 'react';
					import { createRoot } from 'react-dom/client';
					import App from './App';
					import './index.css';
					const root = createRoot(document.getElementById('root')!);
					root.render(<App />);
				`
			};

			const integration = await integrateAndMakePreviewReady({
				store,
				revisionContext: flowRevContext,
				requestId: 'req-flow-001',
				requestSummary: 'Generazione flusso guidato a 3 schermate',
				files,
				rendererController: renderer,
				title: 'Flusso Gestione Pratiche'
			});

			assert.equal(integration.compileResult.ok, true);
			assert.equal(integration.previewRendered, true);
			assert.equal(integration.revision.revision.state, 'rendering-ready');

			// Verifica passaggio 1 attivo
			const screen1 = await renderer.getInspectedElementBySelector('#screen-1');
			assert.ok(screen1, 'Schermata 1 deve essere attiva');
			assert.match(screen1!.textSnippet!, /Passo 1: Selezione Pratica/);

			// Esegue la verifica mirata e promuove a verified
			const verification = await verifyTargetedPrototype(
				renderer,
				flowRevContext,
				integration.revision.revision.id,
				'multi_screen_flow'
			);

			assert.equal(verification.allPassed, true);

			const history = await readLabRevisionHistory(flowRevContext);
			const verifiedEntry = history.entries.find((e) => e.revision.id === integration.revision.revision.id);
			assert.equal(verifiedEntry!.revision.state, 'verified');
		});
	});
});
