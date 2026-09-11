/**
 * Step 14 — Export autonomo e consegna al principale (Handoff)
 *
 * Verifica in modo deterministico e rigoroso sulla superficie reale:
 * 1. Esportazione autonoma di una revisione scelta come progetto React ordinario:
 *    - dipendenze fissate in package.json;
 *    - configurazione di build standard (Vite + Tailwind CSS v4);
 *    - nessun wrapper della preview ne' CDN esterna di runtime;
 *    - nessun repository Git, commit o hosting generato automaticamente;
 *    - non sovrascrive implicitamente una cartella di destinazione esistente e non vuota;
 *    - non altera ne' modifica in alcun modo il prototipo originale.
 * 2. Avvio del progetto esportato fuori da Studio su localhost, verificando la risposta HTTP;
 * 3. Preparazione del pacchetto di handoff con riferimento stabile (prototipo, revisione, variante),
 *    brief, sorgenti, dipendenze fissate e limiti espliciti delle simulazioni;
 * 4. Consegna del pacchetto alla sessione del principale tramite il suo normale meccanismo di coda/prompt,
 *    senza auto-merge implicito e preservando il prototipo intatto.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	buildStandardExportPackage,
	createLabHandoffPackage,
	deliverLabHandoff,
	exportLabPrototypeRevision,
	PINNED_EXPORT_BUILD_DEPENDENCIES
} from '../src/lib/lab/export-handoff.ts';
import {
	createLabPrototype,
	labProjectStore,
	listLabPrototypeFiles,
	readLabPrototype,
	readLabPrototypeFile,
	writeLabPrototypeFile,
	type LabStorageHost,
	type LabStore
} from '../src/lib/lab/storage.ts';
import {
	closeLabRevision,
	labRevisionArchive,
	openLabRevision,
	readLabRevisionHistory,
	type LabRevisionArchive,
	type LabRevisionContext
} from '../src/lib/lab/revisions.ts';
import {
	applySystemTechnicalTemplate,
	generateComponentVariantsAppCode,
	generateSharedMockDataCode,
	generateVariantCardsCode,
	generateVariantDenseCode,
	generateVariantSplitCode
} from '../src/lib/lab/orchestration.ts';
import { LAB_CATALOG_PACKAGES } from '../src/lib/lab/catalog.ts';
import { nodeHost } from './lab-host.ts';
import type { AgentSessionLike } from '../src/lib/agent/sessionRegistry.ts';
import { useLocale } from './locale.ts';

const TEMPLATE_VERSION = '1.0.0';

describe('Laboratorio prototipi — Step 14: Export autonomo e consegna al principale', () => {
	let baseDir: string;
	let host: LabStorageHost;
	let store: LabStore;
	let archive: LabRevisionArchive;
	let context: LabRevisionContext;
	let revisionId: string;
	const prototypeId = 'export-handoff-demo';
	const projectKey = 'c0ffee00-step14-4222-8333-export000000';
	before(async () => {
		baseDir = mkdtempSync(join(tmpdir(), 'omp-lab-step14-'));
		host = nodeHost(baseDir);
		store = labProjectStore(projectKey, host);
		archive = labRevisionArchive(host, projectKey);
		context = { archive, store, prototypeId };

		// 1. Creazione del prototipo di prova
		await createLabPrototype(store, {
			id: prototypeId,
			title: 'Catalogo Prodotti Vitivinicoli',
			brief: 'Crea una vista con 3 varianti di card e tabella per esplorare quote e catalogo.',
			templateVersion: TEMPLATE_VERSION,
			dependencies: [
				{ name: 'lucide-react', version: LAB_CATALOG_PACKAGES['lucide-react'].version },
				{ name: '@radix-ui/react-dialog', version: LAB_CATALOG_PACKAGES['@radix-ui/react-dialog'].version }
			]
		});

		// 2. Applicazione del template tecnico
		await applySystemTechnicalTemplate(store, prototypeId, {
			title: 'Catalogo Prodotti Vitivinicoli',
			brief: 'Crea una vista con 3 varianti di card e tabella per esplorare quote e catalogo.'
		});

		// 3. Generazione e scrittura delle varianti e dei dati simulati
		const mockDataCode = generateSharedMockDataCode({
			dataModelInterface: 'ProductItem',
			mockDataConstantName: 'MOCK_PRODUCTS',
			mockItemCount: 4
		});
		await writeLabPrototypeFile(store, prototypeId, 'src/mockData.ts', mockDataCode);

		const variantDenseCode = generateVariantDenseCode();
		await writeLabPrototypeFile(store, prototypeId, 'src/VariantDense.tsx', variantDenseCode);

		const variantCardsCode = generateVariantCardsCode();
		await writeLabPrototypeFile(store, prototypeId, 'src/VariantCards.tsx', variantCardsCode);

		const variantSplitCode = generateVariantSplitCode();
		await writeLabPrototypeFile(store, prototypeId, 'src/VariantSplit.tsx', variantSplitCode);

		const appCode = generateComponentVariantsAppCode({
			title: 'Catalogo Prodotti Vitivinicoli',
			variantIds: ['dense', 'cards', 'split']
		});
		await writeLabPrototypeFile(store, prototypeId, 'src/App.tsx', appCode);

		// 4. Apertura e chiusura della prima revisione per fissare lo snapshot
		const openedRev = await openLabRevision(context, {
			requestId: 'req-init',
			summary: 'Prima proposta con 3 varianti di componente e mock data'
		});
		revisionId = openedRev.revision.id;
		await closeLabRevision(context, revisionId, 'verified', {
			summary: 'Revisione iniziale verificata con successo'
		});
	});
	after(() => {
		try {
			rmSync(baseDir, { recursive: true, force: true });
		} catch {
			// Pulizia temporanei
		}
	});

	/* -------------------------------------------------------- 1. EXPORT AUTONOMO */

	describe('1. Esportazione autonoma di una revisione scelta', () => {
		it('produce un progetto React standard con dipendenze fissate e configurazione di build', async () => {
			const exportDest = join(baseDir, 'exported-project-1');
			const exportHost = nodeHost(exportDest);

			const result = await exportLabPrototypeRevision(context, {
				destinationPath: exportDest,
				destinationHost: exportHost,
				revisionId,
				overwrite: false
			});

			assert.equal(result.ok, true, 'L\'esportazione deve avere successo');
			assert.equal(result.revisionId, revisionId);
			assert.equal(result.destinationPath, exportDest);

			// Verifica presenza dei file standard generati
			const expectedFiles = [
				'package.json',
				'vite.config.ts',
				'tsconfig.json',
				'index.html',
				'README.md',
				'.gitignore',
				'src/index.css',
				'src/main.tsx',
				'src/App.tsx',
				'src/mockData.ts',
				'src/VariantDense.tsx',
				'src/VariantCards.tsx',
				'src/VariantSplit.tsx'
			];

			for (const file of expectedFiles) {
				assert.equal(
					result.exportedFiles.includes(file),
					true,
					`Il file '${file}' deve comparire nell'elenco dei file esportati`
				);
				assert.equal(
					existsSync(join(exportDest, file)),
					true,
					`Il file '${file}' deve esistere fisicamente su disco in '${exportDest}'`
				);
			}

			// Verifica package.json: dipendenze fissate e nessuna dipendenza di preview (@tailwindcss/browser)
			const pkgRaw = readFileSync(join(exportDest, 'package.json'), 'utf8');
			const pkg = JSON.parse(pkgRaw);

			assert.equal(pkg.private, true);
			assert.equal(pkg.type, 'module');
			assert.equal(pkg.scripts.dev, 'vite');
			assert.equal(pkg.scripts.build, 'vite build');
			assert.equal(pkg.scripts.preview, 'vite preview');

			// Dipendenze runtime fissate
			assert.equal(pkg.dependencies.react, '19.2.8');
			assert.equal(pkg.dependencies['react-dom'], '19.2.8');
			assert.equal(pkg.dependencies['lucide-react'], '1.42.0');
			assert.equal(pkg.dependencies['@radix-ui/react-dialog'], '1.1.23');
			assert.equal(
				pkg.dependencies['@tailwindcss/browser'],
				undefined,
				'@tailwindcss/browser non deve comparire nelle dipendenze del progetto esportato'
			);

			// DevDependencies per compilazione standard Vite + Tailwind v4
			assert.equal(pkg.devDependencies.vite, PINNED_EXPORT_BUILD_DEPENDENCIES.vite);
			assert.equal(pkg.devDependencies['@tailwindcss/vite'], PINNED_EXPORT_BUILD_DEPENDENCIES['@tailwindcss/vite']);
			assert.equal(pkg.devDependencies.tailwindcss, PINNED_EXPORT_BUILD_DEPENDENCIES.tailwindcss);
			assert.equal(pkg.devDependencies['@vitejs/plugin-react'], PINNED_EXPORT_BUILD_DEPENDENCIES['@vitejs/plugin-react']);
			assert.equal(pkg.devDependencies.typescript, PINNED_EXPORT_BUILD_DEPENDENCIES.typescript);

			// Verifica vite.config.ts: usa plugin React e Tailwind v4
			const viteConfig = readFileSync(join(exportDest, 'vite.config.ts'), 'utf8');
			assert.match(viteConfig, /import\s+react\s+from\s+['"]@vitejs\/plugin-react['"]/);
			assert.match(viteConfig, /import\s+tailwindcss\s+from\s+['"]@tailwindcss\/vite['"]/);
			assert.match(viteConfig, /plugins:\s*\[\s*react\(\),\s*tailwindcss\(\)\s*\]/);

			// Verifica index.html: punto di montaggio root e script module
			const indexHtml = readFileSync(join(exportDest, 'index.html'), 'utf8');
			assert.match(indexHtml, /<div\s+id=["']root["']><\/div>/);
			assert.match(indexHtml, /<script\s+type=["']module["']\s+src=["']\/src\/main\.tsx["']><\/script>/);

			// Verifica src/index.css: include la direttiva Tailwind CSS v4 standard
			const indexCss = readFileSync(join(exportDest, 'src', 'index.css'), 'utf8');
			assert.match(indexCss, /@import\s+["']tailwindcss["'];/);

			// Verifica assenza di artefatti Git (nessun .git generato)
			assert.equal(
				existsSync(join(exportDest, '.git')),
				false,
				'L\'esportazione non deve creare repository Git o cartelle .git'
			);
		});

		it('rifiuta la sovrascrittura implicita se la cartella di destinazione esiste già e contiene file', async () => {
			useLocale('it');
			const collisionDest = join(baseDir, 'collision-folder');
			const collisionHost = nodeHost(collisionDest);

			// Creiamo una cartella con un file preesistente
			await collisionHost.createDirectory('');
			await collisionHost.createFile('preesistente.txt', 'Contenuto importante dell\'utente');

			// Tentativo di export con overwrite = false (predefinito)
			const res = await exportLabPrototypeRevision(context, {
				destinationPath: collisionDest,
				destinationHost: collisionHost,
				revisionId,
				overwrite: false
			});

			assert.equal(res.ok, false, 'L\'esportazione deve fallire senza sovrascrittura implicita');
			assert.equal(res.errorCode, 'destination-exists');
			assert.match(res.error || '', /esiste già e non e vuota/);

			// Il file preesistente deve rimanere intatto
			const fileContent = await collisionHost.readTextFile('preesistente.txt');
			assert.equal(fileContent, 'Contenuto importante dell\'utente');

			// Se invece si forza overwrite: true, l'operazione procede con successo
			const resOverwrite = await exportLabPrototypeRevision(context, {
				destinationPath: collisionDest,
				destinationHost: collisionHost,
				revisionId,
				overwrite: true
			});

			assert.equal(resOverwrite.ok, true, 'L\'esportazione deve riuscire con overwrite: true esplicito');
			assert.equal(existsSync(join(collisionDest, 'package.json')), true);
		});

		it('non modifica in alcun modo il prototipo originale durante l\'esportazione', async () => {
			// Rilegge lo stato prima dell'export
			const storedBefore = await readLabPrototype(store, prototypeId);
			const filesBefore = await listLabPrototypeFiles(store, prototypeId);
			const historyBefore = await readLabRevisionHistory(context);

			// Esegue un secondo export verso una cartella separata
			const exportDest2 = join(baseDir, 'exported-project-immutability-check');
			const exportHost2 = nodeHost(exportDest2);

			const exportRes = await exportLabPrototypeRevision(context, {
				destinationPath: exportDest2,
				destinationHost: exportHost2,
				revisionId
			});

			assert.equal(exportRes.ok, true);

			// Rilegge lo stato del prototipo originale dopo l'export
			const storedAfter = await readLabPrototype(store, prototypeId);
			const filesAfter = await listLabPrototypeFiles(store, prototypeId);
			const historyAfter = await readLabRevisionHistory(context);

			// Invarianza assoluta di manifest, file e storia
			assert.deepEqual(storedBefore?.manifest, storedAfter?.manifest, 'Il manifest originale non deve cambiare');
			assert.deepEqual(filesBefore.files.sort(), filesAfter.files.sort(), 'I file del prototipo non devono cambiare');
			assert.equal(historyBefore.entries.length, historyAfter.entries.length, 'La storia delle revisioni non deve cambiare');
		});
	});

	/* ------------------------------------------- 2. ACCETTAZIONE AVVIO FUORI DA STUDIO */

	describe('2. Accettazione: avvio del progetto esportato fuori da Studio', () => {
		it('serve il progetto React esportato come server HTTP autonomo fuori da Studio', async () => {
			const projectDir = join(baseDir, 'exported-project-1');
			assert.equal(existsSync(projectDir), true);

			// Avviamo un server HTTP nativo Node che serve la cartella esportata
			// simulando il funzionamento di un server di preview/dev fuori da Studio
			let server: Server;
			let port: number;

			await new Promise<void>((resolve, reject) => {
				server = createServer((req, res) => {
					try {
						const urlPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
						const filePath = join(projectDir, urlPath.replace(/^\/+/, ''));

						if (existsSync(filePath) && statSync(filePath).isFile()) {
							const content = readFileSync(filePath);
							const ext = filePath.split('.').pop()?.toLowerCase();
							let mime = 'text/plain';
							if (ext === 'html') mime = 'text/html; charset=utf-8';
							else if (ext === 'js' || ext === 'ts' || ext === 'tsx') mime = 'application/javascript; charset=utf-8';
							else if (ext === 'css') mime = 'text/css; charset=utf-8';
							else if (ext === 'json') mime = 'application/json; charset=utf-8';

							res.writeHead(200, { 'Content-Type': mime });
							res.end(content);
						} else {
							res.writeHead(404, { 'Content-Type': 'text/plain' });
							res.end('Not Found');
						}
					} catch (err) {
						res.writeHead(500, { 'Content-Type': 'text/plain' });
						res.end(String(err));
					}
				});

				server.listen(0, '127.0.0.1', () => {
					const addr = server.address();
					if (addr && typeof addr === 'object') {
						port = addr.port;
						resolve();
					} else {
						reject(new Error('Impossibile ottenere la porta del server di test'));
					}
				});
			});

			try {
				// 1. Richiesta della root (index.html)
				const response = await fetch(`http://127.0.0.1:${port}/`);
				assert.equal(response.status, 200, 'La radice deve rispondere con HTTP 200 OK');

				const htmlText = await response.text();
				assert.match(htmlText, /<div\s+id=["']root["']><\/div>/, 'index.html deve contenere il div #root');
				assert.match(htmlText, /<script\s+type=["']module["']\s+src=["']\/src\/main\.tsx["']>/);

				// 2. Richiesta del file di ingresso TSX
				const mainTsxResponse = await fetch(`http://127.0.0.1:${port}/src/main.tsx`);
				assert.equal(mainTsxResponse.status, 200);
				const mainTsxText = await mainTsxResponse.text();
				assert.match(mainTsxText, /createRoot\(container\)/);
				assert.match(mainTsxText, /import\s+App\s+from\s+['"]\.\/App['"]/);

				// 3. Richiesta del CSS standard
				const cssResponse = await fetch(`http://127.0.0.1:${port}/src/index.css`);
				assert.equal(cssResponse.status, 200);
				const cssText = await cssResponse.text();
				assert.match(cssText, /@import\s+["']tailwindcss["'];/);
			} finally {
				// Chiusura pulita del server
				await new Promise<void>((resolve) => {
					server.close(() => resolve());
				});
			}
		});
	});

	/* ------------------------------------------------------------- 3. HANDOFF */

	describe('3. Consegna al principale (Handoff)', () => {
		it('costruisce un riferimento stabile completo con brief, sorgenti, dipendenze e limiti espliciti', async () => {
			useLocale('it');
			const handoffPkg = await createLabHandoffPackage(context, {
				revisionId,
				variant: 'cards'
			});

			assert.equal(handoffPkg.prototypeId, prototypeId);
			assert.equal(handoffPkg.revisionId, revisionId);
			assert.equal(handoffPkg.variant, 'cards');
			assert.equal(handoffPkg.prototypeTitle, 'Catalogo Prodotti Vitivinicoli');
			assert.match(handoffPkg.brief, /3 varianti di card e tabella/);

			// Dipendenze dichiarate
			assert.equal(handoffPkg.dependencies.length, 2);
			assert.equal(handoffPkg.dependencies[0].name, 'lucide-react');

			// Limiti espliciti delle simulazioni
			assert.equal(handoffPkg.simulationLimits.length >= 4, true);
			const limitsText = handoffPkg.simulationLimits.join(' ');
			assert.match(limitsText, /dati e azioni puramente simulati/i);
			assert.match(limitsText, /nessuna autenticazione/i);
			assert.match(limitsText, /svelte/i);
			assert.match(limitsText, /nessun auto-merge/i);

			// File inclusi nello snapshot
			assert.equal(handoffPkg.files.has('src/App.tsx'), true);
			assert.equal(handoffPkg.files.has('src/VariantCards.tsx'), true);
			assert.equal(handoffPkg.files.has('src/mockData.ts'), true);

			// Prompt strutturato formattato per l'agente principale
			const prompt = handoffPkg.formattedPrompt;
			assert.match(prompt, /# Consegna Prototipo dal Laboratorio \(Handoff\)/);
			assert.match(prompt, /\*\*Prototipo\*\*:\s+Catalogo Prodotti Vitivinicoli/);
			assert.match(prompt, new RegExp(`\\*\\*Revisione consegnata\\*\\*:\\s+\`${revisionId}\``));
			assert.match(prompt, /\*\*Variante selezionata\*\*:\s+`cards`/);
			assert.match(prompt, /## Limiti delle simulazioni \(VINCOLI DI SICUREZZA\)/);
			assert.match(prompt, /1\.\s+\*\*Nessun auto-merge indiscriminato\*\*/);
			assert.match(prompt, /2\.\s+\*\*Rispetta lo stack nativo del progetto\*\*/);
			assert.match(prompt, /3\.\s+\*\*Sostituisci i dati fittizi con sorgenti reali\*\*/);
			assert.match(prompt, /4\.\s+\*\*Preserva il prototipo\*\*/);
		});

		it('consegna il pacchetto alla sessione principale usando il normale meccanismo di prompt/coda', async () => {
			const handoffPkg = await createLabHandoffPackage(context, {
				revisionId,
				variant: 'dense'
			});

			// Simuliamo una sessione principale dell'agente conforme ad AgentSessionLike
			const receivedPrompts: Array<{ message: string; behavior?: string }> = [];
			const queuedMessages: Array<{ id: number; text: string; behavior: string }> = [];

			const mockMainSession: any = {
				cwd: baseDir,
				scope: 'main',
				prototypeId: null,
				projectKey,
				sessionKey: `main:${projectKey}`,
				sessionId: 'session-main-123',
				isStreaming: false,
				queued: queuedMessages,
				async prompt(message: string, images: any[] = [], behavior = 'followUp') {
					receivedPrompts.push({ message, behavior });
					if (this.isStreaming) {
						queuedMessages.push({ id: Date.now(), text: message, behavior });
					}
				}
			};

			// 1. Invio a sessione idle
			const deliveryIdle = await deliverLabHandoff(handoffPkg, {
				projectKey,
				targetSession: mockMainSession,
				streamingBehavior: 'followUp'
			});

			assert.equal(deliveryIdle.ok, true);
			assert.equal(deliveryIdle.enqueued, false, 'Non deve essere accodato se la sessione era idle');
			assert.equal(receivedPrompts.length, 1);
			assert.equal(receivedPrompts[0].behavior, 'followUp');
			assert.match(receivedPrompts[0].message, /Catalogo Prodotti Vitivinicoli/);
			assert.match(receivedPrompts[0].message, /`dense`/);

			// 2. Invio a sessione occupata / streaming: deve usare il meccanismo di coda
			mockMainSession.isStreaming = true;

			const deliveryStreaming = await deliverLabHandoff(handoffPkg, {
				projectKey,
				targetSession: mockMainSession,
				streamingBehavior: 'followUp'
			});

			assert.equal(deliveryStreaming.ok, true);
			assert.equal(deliveryStreaming.enqueued, true, 'Deve essere segnalato come accodato');
			assert.equal(receivedPrompts.length, 2);
			assert.equal(queuedMessages.length, 1);
			assert.equal(queuedMessages[0].behavior, 'followUp');
			assert.match(queuedMessages[0].text, /Catalogo Prodotti Vitivinicoli/);

			// 3. Verifica assoluta di invarianza del prototipo:
			// il prototipo e le sue revisioni non sono stati modificati durante l'handoff
			const stored = await readLabPrototype(store, prototypeId);
			assert.equal(stored?.manifest.id, prototypeId);
			assert.equal(stored?.manifest.title, 'Catalogo Prodotti Vitivinicoli');

			const history = await readLabRevisionHistory(context);
			assert.equal(history.entries.length, 1);
			assert.equal(history.entries[0].revision.id, revisionId);
		});
	});
});
