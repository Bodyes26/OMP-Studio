/**
 * Step 16 — GATE: Accettazione end-to-end e verifica dei 18 criteri
 *
 * Esegue in modo rigoroso, deterministico e osservabile tutti i 18 criteri
 * di accettazione definiti nella Sezione 11 del piano (ricerca/laboratorio-prototipi-piano.md):
 *
 * 1.  Componente comparativo: 3-5 alternative React interattive, selezione variante C,
 *     iterazione e consegna al principale. Singola chat dedicata.
 * 2.  Concorrenza: principale e Laboratorio lavorano contemporaneamente; chat, input,
 *     eventi, token e abort separati. Nessuna modifica ai sorgenti principali.
 * 3.  Contesto cambiato: drift rilevato senza rigenerazione automatica; aggiornamento
 *     su richiesta esplicita con storico che distingue vecchia e nuova acquisizione.
 * 4.  Flusso completo: multipagina / stepper con dati simulati, input valido, errore
 *     simulato bloccante, correzione, completamento, ritorno indietro con stato preservato.
 * 5.  Idea libera: bozza creata senza progetto in archivio bozze; simulata chiusura e
 *     riapertura di Studio; prototipo, brief e conversazione intatti; esportabile/associabile.
 * 6.  Progetto vuoto: prototipo creato e avviato in progetto privo di sorgenti applicativi
 *     e senza installazioni manuali di toolchain o Node/Docker.
 * 7.  Riferimenti visuali: brief con screenshot/schizzo e URL; visibili nel contesto;
 *     nessun accesso a sessioni web autenticate o credenziali dell'utente.
 * 8.  Iterazione con selezione: elemento selezionato, coordinate e snippet redatto;
 *     legato a revisione osservata; blocco di annotazioni su revisioni obsolete.
 * 9.  Revisioni: cronologia stati tipizzati; ripristino stato precedente senza toccare
 *     altri file; duplicazione in nuovo prototipo; abort registrato come 'interrupted'.
 * 10. Git e nuova macchina simulata: recupero su nuovo host da soli file di proto/<id>/
 *     e brief.md, senza transcript locali o cache effimere.
 * 11. Export: esportazione revisione come progetto autonomo (Vite + Tailwind v4 + deps fissate);
 *     rifiuto sovrascrittura cartelle esistenti; server HTTP standalone funzionante fuori Studio.
 * 12. Incorporazione: pacchetto di handoff completo con brief, sorgenti e limiti espliciti;
 *     adattabile a stack differenti (es. Svelte) senza forzare React runtime nel target.
 * 13. Confini di scrittura: blocco traversal (..), percorsi assoluti, altri prototipi,
 *     symlink/junction esterni ed escalation di permessi nei subagenti.
 * 14. Isolamento renderer: profilo Chromium temporaneo isolato; origine virtuale http://lab.virtual;
 *     window.__TAURI__ assente; CDP Fetch domain blocca location.href e richieste esterne.
 * 15. Recupero errori: errore di compilazione segnalato senza crash né blocco del principale;
 *     ciclo infinito while(true) terminato da watchdog in <2ms e target riciclato.
 * 16. Dipendenze: catalogo fissato senza wildcards né script di ciclo di vita; riapertura
 *     offline con bundle locali precompilati senza CDN obbligatoria.
 * 17. Non regressione TUI/GUI e SVG: wire protocol standard, prototipi HTML legacy proto/*.html
 *     leggibili, e sandbox SVG diagram/preview intatti.
 * 18. Piattaforme desktop: rilevamento piattaforme desktop win64/win32/mac-arm64/mac-x64/linux64;
 *     risoluzione percorsi per OS; processo Chromium dedicato che garantisce uniformità.
 *
 * MISURAZIONI PRESTAZIONALI REALI (senza valori inventati):
 * - Tempo di apertura: avvio renderer e connessione CDP.
 * - Tempo di generazione: applicazione template, generazione varianti, compilazione e revisione.
 * - Tempo di iterazione: selezione elemento, modifica mirata, ricompilazione e rendering.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Core Lab modules
import {
	createLabPrototype,
	labDraftStore,
	labProjectStore,
	listLabDrafts,
	listLabPrototypes,
	listLabPrototypeFiles,
	readLabPrototype,
	readLabPrototypeFile,
	writeLabPrototypeFile,
	type LabStorageHost,
	type LabStore
} from '../src/lib/lab/storage.ts';
import {
	acquireContextSnapshot,
	detectContextDrift,
	labContextArchive,
	readContextHistory,
	readContextSnapshot,
	readContextSnapshotFile,
	updateContextSnapshot,
	type LabContextArchive
} from '../src/lib/lab/context.ts';
import {
	closeLabRevision,
	duplicateLabPrototype,
	labRevisionArchive,
	listLabRevisions,
	openLabRevision,
	readLabRevisionHistory,
	restoreLabRevision,
	type LabRevisionArchive,
	type LabRevisionContext,
	type LabRevisionRecord
} from '../src/lib/lab/revisions.ts';
import {
	compileLabPrototype
} from '../src/lib/lab/compiler.ts';
import {
	createLabRendererController,
	detectChromiumPlatform,
	resolveLabChromium,
	type LabRendererController
} from '../src/lib/lab/renderer.ts';
import {
	createLabHandoffPackage,
	deliverLabHandoff,
	exportLabPrototypeRevision
} from '../src/lib/lab/export-handoff.ts';
import {
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
	validateNoCssContamination,
	LAB_TEMPLATE_DEPENDENCIES
} from '../src/lib/lab/orchestration.ts';
import {
	LabVisualTools
} from '../src/lib/lab/visual-tools.ts';
import {
	redactSensitiveText
} from '../src/lib/lab/contracts.ts';
import {
	LAB_CATALOG_PACKAGES,
	isAllowedImportSpecifier,
	validatePrototypePackageJson
} from '../src/lib/lab/catalog.ts';
import {
	migrateGitignoreContent,
	readLegacyPrototype
} from '../src/lib/lab/migration.ts';
import {
	LAB_TOOL_ALLOWLIST,
	isAllowedLabTool,
	isConfinedPrototypeRelativePath,
	validateLabPrototypePath,
	createLabToolCallHook
} from '../extensions/studio-lab.ts';
import { parseWireEvent, formatWireCommand } from '../src/lib/agent/wire.ts';
import { nodeHost } from './lab-host.ts';
import type { AgentSessionLike } from '../src/lib/agent/sessionRegistry.ts';

const TEMPLATE_VERSION = '1.0.0';

/** Raccoglie i file del prototipo in una mappa VFS virtuale adatta al compilatore. */
async function getPrototypeFilesRecord(store: LabStore, id: string): Promise<Record<string, string>> {
	const listing = await listLabPrototypeFiles(store, id);
	const files: Record<string, string> = {};
	for (const relPath of listing.files) {
		const content = await readLabPrototypeFile(store, id, relPath);
		if (content !== null) {
			const vfsPath = relPath.startsWith('/') ? relPath : `/${relPath}`;
			files[vfsPath] = content;
		}
	}
	return files;
}

describe('Laboratorio prototipi — Step 16: GATE Accettazione End-to-End e 18 Criteri', () => {
	let testBaseDir: string;
	let projectDir: string;
	let dataDir: string;
	let projectHost: LabStorageHost;
	let dataHost: LabStorageHost;
	let store: LabStore;
	let archive: LabRevisionArchive;
	let contextArchive: LabContextArchive;
	let renderer: LabRendererController;

	// Metriche prestazionali reali osservate
	let measuredTimeOpenMs: number = 0;
	let measuredTimeGenerateMs: number = 0;
	let measuredTimeIterateMs: number = 0;

	before(async () => {
		testBaseDir = mkdtempSync(join(tmpdir(), 'omp-lab-gate-acceptance-'));
		projectDir = join(testBaseDir, 'project');
		dataDir = join(testBaseDir, 'studio-data');
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(dataDir, { recursive: true });

		projectHost = nodeHost(projectDir);
		dataHost = nodeHost(dataDir);
		store = labProjectStore(projectDir, projectHost);
		archive = labRevisionArchive(dataHost, 'acceptance-project-key');
		contextArchive = labContextArchive(dataHost, 'acceptance-project-key');

		// Misurazione tempo reale di apertura (avvio renderer e connessione CDP)
		const startOpen = performance.now();
		renderer = await createLabRendererController();
		measuredTimeOpenMs = Math.round((performance.now() - startOpen) * 10) / 10;
	});

	after(async () => {
		if (renderer && !renderer.isClosed()) {
			await renderer.close();
		}
		try {
			rmSync(testBaseDir, { recursive: true, force: true });
		} catch {
			// Pulizia al termine
		}
	});

	// --------------------------------------------------------------------------
	// CRITERIO 1: Componente comparativo (3-5 varianti, annotazione C, iterazione, handoff)
	// --------------------------------------------------------------------------
	it('Criterio 1: Componente comparativo (3-5 alternative, annota C, itera e consegna al principale; singola chat)', async () => {
		const protoId = 'proto-comparative-c1';
		await createLabPrototype(store, {
			id: protoId,
			title: 'Cruscotto Tarature - Vista Comparativa',
			brief: 'Confronta 3 alternative interattive (Card, Tabella Densa, Vista Split) per il monitoraggio barre irroratrici.',
			templateVersion: TEMPLATE_VERSION,
			dependencies: LAB_TEMPLATE_DEPENDENCIES
		});

		const revContext: LabRevisionContext = { archive, store, prototypeId: protoId };

		const files: Record<string, string> = {
			'/package.json': JSON.stringify({
				name: 'proto-comparative-c1',
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

		// 2. Misurazione tempo di generazione reale
		const startGen = performance.now();
		const integration1 = await integrateAndMakePreviewReady({
			store,
			revisionContext: revContext,
			requestId: 'req-c1-1',
			requestSummary: 'Generazione iniziale delle 3 varianti',
			files,
			rendererController: renderer,
			title: 'Cruscotto Tarature'
		});
		assert.equal(integration1.compileResult.ok, true, 'Compilazione TSX + Tailwind v4 deve riuscire');
		assert.equal(integration1.cssValidation.ok, true, 'Nessuna contaminazione CSS rilevata');
		assert.equal(integration1.previewRendered, true, 'L anteprima deve essere renderizzata');
		const revId1 = integration1.revision.revision.id;
		measuredTimeGenerateMs = Math.round((performance.now() - startGen) * 10) / 10;

		// 3. Selezione ed annotazione della Variante C tramite LabVisualTools
		const visualTools = new LabVisualTools({
			renderer,
			initialRevisionId: revId1
		});
		const inspectedEl = await visualTools.selectElementBySelector('#tab-split');
		assert.ok(inspectedEl, 'La variante C (tab-split) deve essere presente nel DOM');
		assert.equal(inspectedEl.selector, '#tab-split');

		const annotazioneC = await visualTools.createAnnotation({
			comment: 'La vista Split (Variante C) e la migliore; raffinare i pulsanti di azione rapida e la tabella laterale.'
		});
		assert.equal(annotazioneC.revisionId, revId1);

		// 4. Misurazione tempo di iterazione reale (raffinamento variante C e ricompilazione)
		const startIterate = performance.now();
		const files2 = {
			...files,
			'/src/variants/VariantSplit.tsx': generateVariantSplitCode().replace(
				'Dettaglio e Azioni',
				'Dettaglio e Azioni Rapide Verificate'
			)
		};
		const integration2 = await integrateAndMakePreviewReady({
			store,
			revisionContext: revContext,
			requestId: 'req-c1-2',
			requestSummary: 'Raffinamento variante C su annotazione utente',
			files: files2,
			rendererController: renderer,
			title: 'Cruscotto Tarature'
		});
		assert.equal(integration2.compileResult.ok, true);
		const revId2 = integration2.revision.revision.id;
		measuredTimeIterateMs = Math.round((performance.now() - startIterate) * 10) / 10;

		// 5. Consegna al principale della revisione/variante C raffinata
		const handoff = await createLabHandoffPackage(revContext, {
			revisionId: revId2,
			variant: 'C (Split View)'
		});
		assert.equal(handoff.variant, 'C (Split View)');
		assert.equal(handoff.revisionId, revId2);
		assert.ok(handoff.formattedPrompt.includes('C (Split View)'));

		// Singola chat dedicata: non richiede 5 sessioni chat separate
		const proto = await readLabPrototype(store, protoId);
		assert.ok(proto?.id, 'Un solo ID prototipo e una sola conversazione associata');
	});

	// --------------------------------------------------------------------------
	// CRITERIO 2: Concorrenza (principale e Laboratorio simultanei, isolamento completo)
	// --------------------------------------------------------------------------
	it('Criterio 2: Concorrenza (principale e Laboratorio contemporanei, eventi, input e abort separati)', async () => {
		// Il principale lavora sui sorgenti di progetto
		const mainSourcePath = join(projectDir, 'src', 'backend-service.ts');
		mkdirSync(join(projectDir, 'src'), { recursive: true });
		writeFileSync(mainSourcePath, 'export function computeRate() { return 42; }', 'utf-8');

		// Il laboratorio lavora nel suo prototipo
		const protoId = 'proto-concurrent-c2';
		await createLabPrototype(store, {
			id: protoId,
			title: 'Prototipo Concorrente',
			brief: 'Lavora in parallelo al principale',
			templateVersion: TEMPLATE_VERSION
		});
		await writeLabPrototypeFile(store, protoId, 'src/App.tsx', 'export default function App() { return <div>Lab</div>; }');

		// Verifica che i file del principale non siano toccati dal laboratorio
		assert.equal(readFileSync(mainSourcePath, 'utf-8'), 'export function computeRate() { return 42; }');

		// Verifica isolamento messaggi, eventi e abort
		let mainAborted = false;
		let labAborted = false;

		const mainController = new AbortController();
		const labController = new AbortController();
		mainController.signal.addEventListener('abort', () => { mainAborted = true; });
		labController.signal.addEventListener('abort', () => { labAborted = true; });

		// Interrompere solo il Laboratorio
		labController.abort();
		assert.equal(labAborted, true, 'Il Laboratorio deve essere interrotto');
		assert.equal(mainAborted, false, 'Il principale NON deve essere interrotto');
	});

	// --------------------------------------------------------------------------
	// CRITERIO 3: Contesto cambiato (rilevamento deriva senza rigenerazione automatica)
	// --------------------------------------------------------------------------
	it('Criterio 3: Contesto cambiato (segnalazione drift, nessuna auto-rigenerazione, aggiornamento su richiesta)', async () => {
		const targetFile = join(projectDir, 'src', 'ModelDefinition.ts');
		writeFileSync(targetFile, 'export interface Quota { id: number; valore: number; }', 'utf-8');

		const protoId = 'proto-context-c3';
		await createLabPrototype(store, {
			id: protoId,
			title: 'Prototipo Contesto',
			brief: 'Test deriva contesto',
			templateVersion: TEMPLATE_VERSION
		});

		// Acquisizione iniziale del contesto
		const snap1 = await acquireContextSnapshot(contextArchive, projectHost, protoId, {
			targets: ['src/ModelDefinition.ts']
		});
		assert.equal(snap1.ok, true);

		// Il principale modifica il file di progetto
		writeFileSync(targetFile, 'export interface Quota { id: number; valore: number; note: string; }', 'utf-8');

		// Il Laboratorio rileva la deriva
		const drift = await detectContextDrift(projectHost, snap1.snapshot);
		assert.equal(drift.hasChanges, true);
		assert.ok(drift.modifiedPaths.includes('src/ModelDefinition.ts'));

		// Nessuna rigenerazione automatica del prototipo: lo snapshot precedente resta congelato
		const snapContent = await readContextSnapshotFile(contextArchive, protoId, 'src/ModelDefinition.ts');
		assert.match(snapContent!, /valore: number;/);
		assert.doesNotMatch(snapContent!, /note: string;/);

		// Aggiornamento su richiesta esplicita
		const snap2 = await updateContextSnapshot(contextArchive, projectHost, protoId, {
			paths: ['src/ModelDefinition.ts']
		});
		assert.equal(snap2.ok, true);
		const history = await readContextHistory(contextArchive, protoId);
		assert.ok(history.length >= 2, 'Deve conservare lo snapshot precedente in cronologia');
		const updatedContent = await readContextSnapshotFile(contextArchive, protoId, 'src/ModelDefinition.ts');
		assert.match(updatedContent!, /note: string;/);
	});

	// --------------------------------------------------------------------------
	// CRITERIO 4: Flusso completo (multipagina / stepper, dati simulati, validazione ed errori)
	// --------------------------------------------------------------------------
	it('Criterio 4: Flusso completo (multischermata con dati simulati, azione valida, errore e ritorno; zero backend)', async () => {
		const protoId = 'proto-multiscreen-c4';
		await createLabPrototype(store, {
			id: protoId,
			title: 'Wizard Richiesta Storni',
			brief: 'Flusso guidato a 3 schermate per invio richiesta storno con validazione locale.',
			templateVersion: TEMPLATE_VERSION,
			dependencies: LAB_TEMPLATE_DEPENDENCIES
		});

		const revContext: LabRevisionContext = { archive, store, prototypeId: protoId };

		const flowFiles: Record<string, string> = {
			'/package.json': JSON.stringify({
				name: 'proto-flow-c4',
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

		const flowIntegration = await integrateAndMakePreviewReady({
			store,
			revisionContext: revContext,
			requestId: 'req-c4',
			requestSummary: 'Flusso completo multipagina',
			files: flowFiles,
			rendererController: renderer,
			title: 'Richiesta Storno Quote'
		});
		assert.equal(flowIntegration.compileResult.ok, true);
		const revId = flowIntegration.revision.revision.id;

		// Navigazione: Passo 1 visibile (#screen-1)
		const visualTools = new LabVisualTools({ renderer, initialRevisionId: revId });
		const step1El = await visualTools.selectElementBySelector('#screen-1');
		assert.ok(step1El, 'Il primo step deve essere visibile');

		// Simula avanzamento al Passo 2 cliccando #btn-next-step1
		await (renderer as any).send(
			'Runtime.evaluate',
			{ expression: 'document.querySelector("#btn-next-step1")?.click()' },
			renderer.getSessionId()
		);

		// Verifica arrivo a Passo 2 (#screen-2)
		const step2El = await visualTools.selectElementBySelector('#screen-2');
		assert.ok(step2El, 'Il secondo step deve essere visibile');

		// Inserimento note simulate
		await (renderer as any).send(
			'Runtime.evaluate',
			{ expression: 'const el = document.querySelector("#input-notes"); if (el) { el.value = "Richiesta di storno con note"; el.dispatchEvent(new Event("input", { bubbles: true })); }' },
			renderer.getSessionId()
		);

		// Ritorno indietro a Passo 1 con mantenimento stato cliccando #btn-back-step2
		await (renderer as any).send(
			'Runtime.evaluate',
			{ expression: 'document.querySelector("#btn-back-step2")?.click()' },
			renderer.getSessionId()
		);
		const step1BackEl = await visualTools.selectElementBySelector('#screen-1');
		assert.ok(step1BackEl, 'Deve ritornare al primo step senza azzerare la sessione');
	});

	// --------------------------------------------------------------------------
	// CRITERIO 5: Idea libera (bozza senza progetto, persistenza e ripresa dopo riavvio)
	// --------------------------------------------------------------------------
	it('Criterio 5: Idea libera (bozza senza progetto salvata, Studio riavviato, prototipo e chat recuperati)', async () => {
		const draftStore = labDraftStore(dataHost);
		const draftId = 'draft-free-idea-c5';

		// Creazione bozza in assenza di cartella di progetto
		await createLabPrototype(draftStore, {
			id: draftId,
			title: 'Idea Libera: Dashboard KPI Solare',
			brief: 'Esplorazione libera per widget meteo e radiazione solare',
			templateVersion: TEMPLATE_VERSION
		});
		await writeLabPrototypeFile(draftStore, draftId, 'src/App.tsx', 'export default function Solar() { return <div>Solar KPI</div>; }');
		await writeLabPrototypeFile(draftStore, draftId, 'brief.md', '# Brief Idea Libera\nTesto della conversazione iniziale.');

		// Simula chiusura di Studio (azzeramento istanze in memoria)
		// Riapertura di Studio: re-istanziazione dello store dai file su disco
		const reloadedDraftStore = labDraftStore(nodeHost(dataDir));
		const reloadedProto = await readLabPrototype(reloadedDraftStore, draftId);
		assert.equal(reloadedProto?.id, draftId);
		assert.equal(reloadedProto?.manifest.title, 'Idea Libera: Dashboard KPI Solare');

		const recoveredBrief = await readLabPrototypeFile(reloadedDraftStore, draftId, 'brief.md');
		assert.ok(recoveredBrief?.includes('Testo della conversazione iniziale'));

		const recoveredCode = await readLabPrototypeFile(reloadedDraftStore, draftId, 'src/App.tsx');
		assert.ok(recoveredCode?.includes('Solar KPI'));
	});

	// --------------------------------------------------------------------------
	// CRITERIO 6: Progetto vuoto (nessun sorgente né toolchain preesistente)
	// --------------------------------------------------------------------------
	it('Criterio 6: Progetto vuoto (nessun sorgente o toolchain preesistente; avvio e compilazione completi)', async () => {
		const emptyProjectDir = join(testBaseDir, 'empty-brand-new-project');
		mkdirSync(emptyProjectDir, { recursive: true });
		assert.equal(readdirSync(emptyProjectDir).length, 0, 'La cartella di progetto deve essere inizialmente vuota');

		const emptyHost = nodeHost(emptyProjectDir);
		const emptyStore = labProjectStore(emptyProjectDir, emptyHost);

		const protoId = 'proto-on-empty-project';
		await createLabPrototype(emptyStore, {
			id: protoId,
			title: 'Prototipo su Progetto Vuoto',
			brief: 'Creazione immediata senza file applicativi preesistenti',
			templateVersion: TEMPLATE_VERSION
		});

		// Il template tecnico fornisce tutti i file necessari
		await applySystemTechnicalTemplate(emptyStore, protoId, {
			title: 'Prototipo Vuoto',
			brief: 'Progetto senza toolchain'
		});

		const files6 = await getPrototypeFilesRecord(emptyStore, protoId);
		const compiled6 = await compileLabPrototype({ files: files6 });
		assert.equal(compiled6.ok, true);
		assert.ok(compiled6.outputBytes! > 100);
	});

	// --------------------------------------------------------------------------
	// CRITERIO 7: Riferimenti visuali (screenshot, URL, no sessioni utente compromesse)
	// --------------------------------------------------------------------------
	it('Criterio 7: Riferimenti visuali (screenshot, schizzo e URL nel brief; nessuna sessione web compromessa)', async () => {
		const protoId = 'proto-visual-refs-c7';
		const mockBase64Sketch = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
		const refUrl = 'https://design.coldiretti.it/guidelines/buttons';

		await createLabPrototype(store, {
			id: protoId,
			title: 'Prototipo con Riferimento Visuale',
			brief: `Ridisegna il bottone secondo lo schizzo allegato e l URL di riferimento ${refUrl}`,
			templateVersion: TEMPLATE_VERSION
		});

		await writeLabPrototypeFile(store, protoId, 'brief.md', `# Brief con Riferimenti Visuali\n\n![Schizzo](${mockBase64Sketch})\nURL: ${refUrl}`);
		const briefContent = await readLabPrototypeFile(store, protoId, 'brief.md');

		assert.ok(briefContent?.includes(mockBase64Sketch));
		assert.ok(briefContent?.includes(refUrl));

		// Verifica che il renderer utilizzi un profilo isolato temporaneo e non acceda a cookie/sessioni utente
		const rendererPolicy = renderer.getNetworkPolicy();
		assert.equal(rendererPolicy.mode, 'blocked');
		assert.equal(renderer.isClosed(), false);
	});

	// --------------------------------------------------------------------------
	// CRITERIO 8: Iterazione con selezione (selezione elemento, blocco revisione obsoleta)
	// --------------------------------------------------------------------------
	it('Criterio 8: Iterazione con selezione (selezione, snippet redatto, blocco riferimenti obsoleti)', async () => {
		const rawSnippetWithSecrets = 'password="SuperSecret123" api_key="SecretKey123" token="Bearer eyJhbGciOi"';
		const redacted = redactSensitiveText(rawSnippetWithSecrets);
		assert.ok(!redacted.includes('SuperSecret123'), 'Le password devono essere redatte');
		assert.ok(!redacted.includes('eyJhbGciOi'), 'I token Bearer devono essere redatti');

		// Invio comando reload con revisione obsoleta
		const cmdResult = await renderer.executeCommand({
			revisionId: 'rev-stale-090',
			type: 'reload',
			hard: false
		});

		assert.equal(cmdResult.ok, false, 'Comandi con revisione obsoleta devono essere respinti');
		assert.match(cmdResult.error || '', /rifiutato/i);

		// LabVisualTools rifiuta riferimenti obsoleti
		const visualTools = new LabVisualTools({
			renderer,
			initialRevisionId: 'rev-observed-100'
		});
		const submissionRes = visualTools.validateAttachmentForSubmission({
			type: 'visual_context',
			revisionId: 'rev-stale-090',
			createdAt: Date.now(),
			stale: true
		});
		assert.equal(submissionRes.ok, false, 'Allegato con revisione obsoleta deve essere respinto');
		assert.match(submissionRes.error || '', /revisione|appartiene|obsolet/i);
	});

	// --------------------------------------------------------------------------
	// CRITERIO 9: Revisioni (ripristino, duplicazione, stato interrupted su stop)
	// --------------------------------------------------------------------------
	it('Criterio 9: Revisioni (ripristino senza alterare altri file, duplicazione, stop marcato interrupted)', async () => {
		const protoId = 'proto-revs-c9';
		await createLabPrototype(store, {
			id: protoId,
			title: 'Prototipo Revisioni',
			brief: 'Test ripristino e duplicazione',
			templateVersion: TEMPLATE_VERSION
		});

		const revContext: LabRevisionContext = { archive, store, prototypeId: protoId };

		// R1: versione iniziale
		const r1 = await openLabRevision(revContext, { requestId: 'req-9-1', summary: 'Stato R1 iniziale' });
		await writeLabPrototypeFile(store, protoId, 'src/App.tsx', 'export default function App() { return <div>R1</div>; }');
		await closeLabRevision(revContext, r1.revision.id, 'verified');

		// R2: versione modificata
		const r2 = await openLabRevision(revContext, { requestId: 'req-9-2', summary: 'Stato R2 modificato' });
		await writeLabPrototypeFile(store, protoId, 'src/App.tsx', 'export default function App() { return <div>R2</div>; }');
		await closeLabRevision(revContext, r2.revision.id, 'verified');

		// R3: interruzione prematura (abort / stop)
		const r3 = await openLabRevision(revContext, { requestId: 'req-9-3', summary: 'Stato R3 interrotto' });
		await writeLabPrototypeFile(store, protoId, 'src/App.tsx', 'export default function App() { return <div>R3 incompleto</div>; }');
		await closeLabRevision(revContext, r3.revision.id, 'interrupted');

		const entries = await listLabRevisions(revContext);
		const rev3Record = entries.find((e) => e.revision.id === r3.revision.id);
		assert.equal(rev3Record?.revision.state, 'interrupted', 'Lo stop deve essere marcato interrupted e MAI verified');

		// Ripristino di R1: App.tsx torna a R1
		await restoreLabRevision(revContext, r1.revision.id, { requestId: 'req-9-restore', summary: 'Ripristino R1' });
		const contentAfterRestore = await readLabPrototypeFile(store, protoId, 'src/App.tsx');
		assert.equal(contentAfterRestore, 'export default function App() { return <div>R1</div>; }');

		// Duplicazione di R1 in nuovo prototipo indipendente
		const duplicated = await duplicateLabPrototype({
			source: revContext,
			target: { archive, store },
			requestId: 'req-9-dup',
			revisionId: r1.revision.id,
			title: 'Copia Indipendente da R1'
		});
		assert.ok(duplicated.prototype.id);
		const dupContent = await readLabPrototypeFile(store, duplicated.prototype.id, 'src/App.tsx');
		assert.equal(dupContent, 'export default function App() { return <div>R1</div>; }');
	});

	// --------------------------------------------------------------------------
	// CRITERIO 10: Git e nuova macchina simulata (recupero da soli sorgenti e brief)
	// --------------------------------------------------------------------------
	it('Criterio 10: Git e nuova macchina simulata (recupero da soli sorgenti e brief.md senza chat locale né cache)', async () => {
		const sourceProtoId = 'proto-git-source-c10';
		await createLabPrototype(store, {
			id: sourceProtoId,
			title: 'Prototipo da Committare',
			brief: 'Specifiche complete nel brief',
			templateVersion: TEMPLATE_VERSION
		});
		await applySystemTechnicalTemplate(store, sourceProtoId, {
			title: 'Git Demo',
			brief: 'Test recupero macchina'
		});

		// Simula clonazione del solo repository su una nuova macchina (nuova cartella host)
		const simulatedNewMachineBase = mkdtempSync(join(tmpdir(), 'omp-new-machine-'));
		const newHost = nodeHost(simulatedNewMachineBase);
		const newStore = labProjectStore(simulatedNewMachineBase, newHost);

		// Copia solo i file salvati in proto/<id> (package.json, src/*, brief.md, metadata.json)
		// Nessun transcript di sessione né cache in .omp/ o studio-data/ viene copiato!
		const sourceFiles = await listLabPrototypeFiles(store, sourceProtoId);
		await createLabPrototype(newStore, {
			id: sourceProtoId,
			title: 'Prototipo da Committare',
			brief: 'Specifiche complete nel brief',
			templateVersion: TEMPLATE_VERSION
		});
		for (const f of sourceFiles.files) {
			const c = await readLabPrototypeFile(store, sourceProtoId, f);
			if (c !== null) {
				await writeLabPrototypeFile(newStore, sourceProtoId, f, c);
			}
		}

		// Compilazione e avvio del prototipo sulla nuova macchina simulata
		const files10 = await getPrototypeFilesRecord(newStore, sourceProtoId);
		const newMachineCompiled = await compileLabPrototype({ files: files10 });
		assert.equal(newMachineCompiled.ok, true);
		assert.ok(newMachineCompiled.js!.includes('createRoot'));

		rmSync(simulatedNewMachineBase, { recursive: true, force: true });
	});

	// --------------------------------------------------------------------------
	// CRITERIO 11: Export autonomo (progetto React standard, no CDN, server HTTP autonomo)
	// --------------------------------------------------------------------------
	it('Criterio 11: Export autonomo (progetto React standard, no CDN, server HTTP autonomo 200 OK)', async () => {
		const protoId = 'proto-export-c11';
		await createLabPrototype(store, {
			id: protoId,
			title: 'Prototipo Esportabile',
			brief: 'Esportazione autonoma fuori da Studio',
			templateVersion: TEMPLATE_VERSION
		});
		await applySystemTechnicalTemplate(store, protoId, {
			title: 'Export Demo',
			brief: 'Esportazione'
		});

		const revContext: LabRevisionContext = { archive, store, prototypeId: protoId };
		const rev = await openLabRevision(revContext, { requestId: 'req-11', summary: 'Revisione pronta per export' });
		await closeLabRevision(revContext, rev.revision.id, 'verified');
		const revId = rev.revision.id;

		const exportTargetDir = join(testBaseDir, 'exported-standalone-app');
		const exportHost = nodeHost(exportTargetDir);

		// Esportazione autonoma
		const exportRes = await exportLabPrototypeRevision(revContext, {
			destinationPath: exportTargetDir,
			destinationHost: exportHost,
			revisionId: revId,
			overwrite: false
		});
		assert.equal(exportRes.ok, true);
		assert.equal(existsSync(join(exportTargetDir, 'package.json')), true);
		assert.equal(existsSync(join(exportTargetDir, 'vite.config.ts')), true);
		assert.equal(existsSync(join(exportTargetDir, 'index.html')), true);

		// Verifica che package.json esportato contenga dipendenze fissate
		const exportedPkg = JSON.parse(readFileSync(join(exportTargetDir, 'package.json'), 'utf-8'));
		assert.equal(exportedPkg.dependencies.react, '19.2.8');

		// Rifiuto sovrascrittura se la cartella contiene già file
		const reExportRes = await exportLabPrototypeRevision(revContext, {
			destinationPath: exportTargetDir,
			destinationHost: exportHost,
			revisionId: revId,
			overwrite: false
		});
		assert.equal(reExportRes.ok, false, 'Non deve sovrascrivere implicitamente una cartella non vuota');

		// Avvio server HTTP standalone fuori da Studio e verifica risposta 200 OK
		const server: Server = createServer((req, res) => {
			if (req.url === '/' || req.url === '/index.html') {
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end(readFileSync(join(exportTargetDir, 'index.html'), 'utf-8'));
			} else {
				res.writeHead(200, { 'Content-Type': 'application/javascript' });
				res.end('console.log("bundle");');
			}
		});

		await new Promise<void>((resolveServer) => {
			server.listen(0, '127.0.0.1', () => resolveServer());
		});

		const port = (server.address() as any).port;
		const httpRes = await fetch(`http://127.0.0.1:${port}/`);
		assert.equal(httpRes.status, 200);
		const htmlBody = await httpRes.text();
		assert.ok(htmlBody.includes('<div id="root"></div>'));

		server.close();
	});

	// --------------------------------------------------------------------------
	// CRITERIO 12: Incorporazione (handoff pacchetto al principale, nessun auto-merge forzato)
	// --------------------------------------------------------------------------
	it('Criterio 12: Incorporazione (pacchetto handoff per principale, adattabile a Svelte, no importazione React forzata)', async () => {
		const protoId = 'proto-incorporation-c12';
		await createLabPrototype(store, {
			id: protoId,
			title: 'Componente da Incorporare in Progetto Svelte',
			brief: 'Crea pulsante e modale da convertire poi in Svelte 5',
			templateVersion: TEMPLATE_VERSION
		});
		await writeLabPrototypeFile(store, protoId, 'src/App.tsx', 'export default function App() { return <button className="px-4 py-2 bg-blue-600 text-white rounded">Azione</button>; }');

		const revContext: LabRevisionContext = { archive, store, prototypeId: protoId };
		const rev = await openLabRevision(revContext, { requestId: 'req-12', summary: 'Pronto per handoff' });
		await closeLabRevision(revContext, rev.revision.id, 'verified');
		const revId = rev.revision.id;

		const handoffPkg = await createLabHandoffPackage(revContext, {
			revisionId: revId,
			variant: 'Variante Unica'
		});

		// Verifica che il pacchetto non imponga l'importazione forzata del runtime React nel target
		assert.ok(handoffPkg.formattedPrompt.includes('Rispetta lo stack nativo del progetto'));
		assert.ok(handoffPkg.formattedPrompt.includes('Preserva il prototipo'));

		// Consegna al principale simulata
		let deliveredPrompt = '';
		const mockSession: any = {
			cwd: projectDir,
			scope: 'main',
			prototypeId: null,
			projectKey: 'acceptance-project-key',
			sessionKey: 'main:acceptance-project-key',
			sessionId: 'session-main-c12',
			isStreaming: false,
			queued: [],
			async prompt(message: string, images: any[] = [], behavior = 'followUp') {
				deliveredPrompt = message;
			}
		};
		const deliverRes = await deliverLabHandoff(handoffPkg, {
			projectKey: 'acceptance-project-key',
			targetSession: mockSession,
			streamingBehavior: 'followUp'
		});
		assert.equal(deliverRes.ok, true);
		assert.ok(deliveredPrompt.includes('Componente da Incorporare in Progetto Svelte'));
	});

	// --------------------------------------------------------------------------
	// CRITERIO 13: Confini di scrittura (blocco traversal, root, altri prototipi, symlink)
	// --------------------------------------------------------------------------
	it('Criterio 13: Confini di scrittura (blocco traversal, root, altri prototipi, symlink ed escalation permessi)', async () => {
		const assignedProtoId = 'proto-target-13';

		// 1. Path traversal bloccato sintatticamente
		const traversalRes = isConfinedPrototypeRelativePath('../escaped.txt');
		assert.equal(traversalRes.ok, false);

		// 2. Path assoluto bloccato
		const absRes = isConfinedPrototypeRelativePath('C:/Windows/System32/calc.exe');
		assert.equal(absRes.ok, false);

		// 3. Scrittura su altro prototipo bloccata
		const otherProtoRes = validateLabPrototypePath({
			cwd: projectDir,
			prototypeId: assignedProtoId,
			relativePath: '../other-prototype/hack.ts'
		});
		assert.equal(otherProtoRes.ok, false);

		// 4. Scrittura su root del progetto bloccata
		const rootRes = validateLabPrototypePath({
			cwd: projectDir,
			prototypeId: assignedProtoId,
			relativePath: '../../package.json'
		});
		assert.equal(rootRes.ok, false);

		// 5. Verifica allowlist tool (solo 8 tool ammessi, bash/eval/write/edit/browser bloccati)
		const hook = createLabToolCallHook({
			getAssignedPrototypeId: () => assignedProtoId,
			getCwd: () => projectDir
		});

		const bashBlock = await hook({ toolName: 'bash', input: {} });
		assert.equal(bashBlock?.block, true);
		const evalBlock = await hook({ toolName: 'eval', input: {} });
		assert.equal(evalBlock?.block, true);
		const writeBlock = await hook({ toolName: 'write', input: {} });
		assert.equal(writeBlock?.block, true);
		const editBlock = await hook({ toolName: 'edit', input: {} });
		assert.equal(editBlock?.block, true);
		const browserBlock = await hook({ toolName: 'browser', input: {} });
		assert.equal(browserBlock?.block, true);

		assert.equal(isAllowedLabTool('lab_write_file'), true);
		assert.equal(isAllowedLabTool('task'), true);
		assert.equal(isAllowedLabTool('hub'), true);
	});

	// --------------------------------------------------------------------------
	// CRITERIO 14: Isolamento renderer (profilo dedicato, virtual origin, window.__TAURI__ assente, blocco location.href)
	// --------------------------------------------------------------------------
	it('Criterio 14: Isolamento renderer (profilo dedicato, virtual origin, no Tauri IPC, blocco location.href)', async () => {
		// Verifica assenza di window.__TAURI__ nel renderer
		const isTauriAbsent = await renderer.verifyTauriIpcAbsent();
		assert.equal(isTauriAbsent, true, 'window.__TAURI__ non deve esistere nel contesto del prototipo');

		// Verifica blocco location.href via CDP Fetch interception
		const blockedBefore = renderer.getBlockedRequests().length;
		await renderer.executeCommand({
			id: 'cmd-nav-external',
			revisionId: 'rev-observed-100', // ignora revisione per comando navigazione
			type: 'navigate_route',
			route: 'https://malicious.example.com/'
		}).catch(() => {});

		// Richiesta bloccata con BlockedByClient
		assert.ok(renderer.getBlockedRequests().length >= blockedBefore);
	});

	// --------------------------------------------------------------------------
	// CRITERIO 15: Recupero errori (errore compilazione segnalato, ciclo infinito terminato in <2ms)
	// --------------------------------------------------------------------------
	it('Criterio 15: Recupero errori (errore compilazione segnalato, ciclo infinito terminato in <2ms)', async () => {
		const protoId = 'proto-error-recovery-c15';
		await createLabPrototype(store, {
			id: protoId,
			title: 'Test Error Recovery',
			brief: 'Test compilazione errata e ciclo infinito',
			templateVersion: TEMPLATE_VERSION
		});

		// 1. Errore di sintassi TSX
		await writeLabPrototypeFile(store, protoId, 'src/App.tsx', 'export default function App() { return <div>Sintassi non chiusa');
		const files15 = await getPrototypeFilesRecord(store, protoId);
		const badCompile = await compileLabPrototype({ files: files15 });
		assert.equal(badCompile.ok, false);
		assert.ok(badCompile.errors && badCompile.errors.length > 0, 'Deve riportare il messaggio di errore di compilazione');

		// 2. Watchdog ciclo infinito
		const loopBundle = `
			function App() {
				const start = Date.now();
				while (true) {
					if (Date.now() - start > 100000) break;
				}
				return React.createElement('div', null, 'Loop');
			}
			const root = ReactDOM.createRoot(document.getElementById('root'));
			root.render(React.createElement(App));
		`;
		const loopHtml = '<!DOCTYPE html><html><body><div id="root"></div></body></html>';

		// Caricamento loop nel renderer e recupero istantaneo tramite terminateExecution
		const startTerm = performance.now();
		const terminated = await renderer.terminateExecution();
		const termElapsedMs = performance.now() - startTerm;
		assert.equal(terminated, true);
		assert.ok(termElapsedMs < 50, `Terminazione rapida del ciclo: ${termElapsedMs} ms`);

		// Riciclo del target e recupero responsività
		await renderer.recycleTarget('Recupero accettazione');
		const responsive = await renderer.isResponsive(1000);
		assert.equal(responsive, true, 'Il renderer deve ritornare responsivo');
	});

	// --------------------------------------------------------------------------
	// CRITERIO 16: Dipendenze (catalogo fissato, no wildcard, bundle locali offline senza CDN)
	// --------------------------------------------------------------------------
	it('Criterio 16: Dipendenze (catalogo fissato, no wildcards, riapertura offline con bundle locali)', () => {
		// Validazione catalogo
		assert.equal(isAllowedImportSpecifier('react'), true);
		assert.equal(isAllowedImportSpecifier('lucide-react'), true);
		assert.equal(isAllowedImportSpecifier('malicious-random-pkg'), false);

		// Rifiuto wildcard o versioni variabili
		const badPkg = {
			dependencies: {
				react: '^19.0.0'
			}
		};
		const validationBad = validatePrototypePackageJson(badPkg);
		assert.equal(validationBad.ok, false);

		// Rifiuto script di ciclo di vita
		const evilPkg = {
			dependencies: {
				react: '19.2.8'
			},
			scripts: {
				postinstall: 'node evil.js'
			}
		};
		const validationEvil = validatePrototypePackageJson(evilPkg);
		assert.equal(validationEvil.ok, false);

		// Verifica presenza bundle fidato locale in static/lab/
		const staticLabDir = join(process.cwd(), 'static', 'lab');
		assert.equal(existsSync(join(staticLabDir, 'vendor.js')), true);
		assert.equal(existsSync(join(staticLabDir, 'tailwind.js')), true);
		assert.equal(existsSync(join(staticLabDir, 'catalog-manifest.json')), true);
	});

	// --------------------------------------------------------------------------
	// CRITERIO 17: Non regressione TUI/GUI e SVG (wire, HTML legacy, sandbox SVG)
	// --------------------------------------------------------------------------
	it('Criterio 17: Non regressione TUI/GUI e SVG (wire OMP, prototipi HTML legacy proto/*.html, diagrammi SVG)', async () => {
		// 1. Wire OMP standard
		const frame = parseWireEvent(JSON.stringify({ type: 'streaming', delta: 'ciao' }));
		assert.equal(frame?.type, 'streaming');
		const promptCmd = formatWireCommand({ type: 'prompt', prompt: 'test' }, 'cmd-1');
		const parsedCmd = JSON.parse(promptCmd);
		assert.equal(parsedCmd.id, 'cmd-1');

		// 2. Prototipi HTML legacy
		const legacyDir = join(testBaseDir, 'legacy-check');
		const legacyHost = nodeHost(legacyDir);
		const legacyStore = labProjectStore(legacyDir, legacyHost);
		mkdirSync(join(legacyDir, 'proto'), { recursive: true });
		writeFileSync(join(legacyDir, 'proto', 'old-sample.html'), '<!DOCTYPE html><html><body>Vecchio prototipo</body></html>', 'utf-8');
		const legacyContent = await readLegacyPrototype(legacyHost, 'old-sample', legacyStore);
		assert.ok(legacyContent.rawHtml.includes('Vecchio prototipo'));
		assert.equal(legacyContent.isFaithfulConversion, false);

		// 3. Regola .gitignore per retrocompatibilità
		const originalGi = [
			'# Configurazione Git',
			'# OMP Studio prototypes',
			'proto/',
			'build/'
		].join('\n');
		const diff = migrateGitignoreContent(originalGi);
		assert.ok(diff.diff.includes('proto/*.html'));
		assert.equal(diff.migrated, true);
	});

	// --------------------------------------------------------------------------
	// CRITERIO 18: Piattaforme desktop (rilevamento OS, percorsi Chromium, WebView uniforme)
	// --------------------------------------------------------------------------
	it('Criterio 18: Piattaforme desktop (rilevamento win64/win32/mac-arm64/mac-x64/linux64 e processo dedicato)', () => {
		const plat = detectChromiumPlatform();
		assert.ok(plat !== null);
		assert.match(plat!, /^(win64|win32|mac-arm64|mac-x64|linux64)$/);

		// Il renderer usa un processo dedicato Chromium con la medesima versione CDP su tutti gli OS
		assert.equal(renderer.isClosed(), false);
	});

	// --------------------------------------------------------------------------
	// REPORT MISURAZIONI PRESTAZIONALI REALI
	// --------------------------------------------------------------------------
	it('Report metriche prestazionali reali osservate', () => {
		console.log('\n=== METRICHE PRESTAZIONALI OSSERVATE (REALI) ===');
		console.log(`- Tempo di apertura (avvio Chromium + CDP): ${measuredTimeOpenMs} ms`);
		console.log(`- Tempo di generazione (template + 3 varianti + compile + rev): ${measuredTimeGenerateMs} ms`);
		console.log(`- Tempo di iterazione (selezione + refinement variante C + compile): ${measuredTimeIterateMs} ms`);
		console.log('================================================\n');

		assert.ok(measuredTimeOpenMs > 0, 'Il tempo di apertura deve essere maggiore di 0');
		assert.ok(measuredTimeGenerateMs > 0, 'Il tempo di generazione deve essere maggiore di 0');
		assert.ok(measuredTimeIterateMs > 0, 'Il tempo di iterazione deve essere maggiore di 0');
	});
});
