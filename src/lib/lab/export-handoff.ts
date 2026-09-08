// Export autonomo e Handoff al principale del Laboratorio prototipi (Step 14).
//
// Questo modulo realizza le due uscite concordate (ricerca/laboratorio-prototipi-piano.md §§ 2, 5.5, 9):
//
// 1. Export autonomo:
//    - Copia una revisione scelta in una cartella indicata dall'utente;
//    - Produce un progetto React ordinario con dipendenze fissate e configurazione di build standard (Vite + Tailwind v4);
//    - Non dipende dal wrapper della preview ne' da CDN in produzione;
//    - Non crea Git, commit o hosting;
//    - Non sovrascrive una destinazione esistente in modo implicito;
//    - Non modifica il prototipo originale.
//
// 2. Consegna al principale (Handoff):
//    - Prepara un riferimento stabile (prototipo, revisione, eventuale variante) con brief, sorgenti,
//      dipendenze e limiti espliciti delle simulazioni;
//    - Consegna il riferimento alla sessione del principale usando il suo normale meccanismo di coda/prompt;
//    - Nessun auto-merge implicito nel codice del progetto ospite;
//    - Il prototipo originale rimane invariato.

import {
	LAB_DEFAULT_SIMULATION_LIMITS,
	isLabPrototypeId,
	type LabDependency,
	type LabExportErrorCode,
	type LabExportOptions,
	type LabExportResult,
	type LabHandoffDeliveryResult,
	type LabHandoffPackage,
	type LabHandoffReference,
	type LabPrototypeId,
	type LabPrototypeManifest,
	type LabRevisionId
} from './contracts.ts';
import {
	LAB_BRIEF_FILE,
	LAB_MANIFEST_FILE,
	isConfinedPrototypePath,
	listLabPrototypeFiles,
	readLabPrototype,
	readLabPrototypeFile,
	type LabStorageHost,
	type LabStore
} from './storage.ts';
import {
	findLabRevisionEntry,
	readLabRevisionHistory,
	type LabRevisionArchive,
	type LabRevisionContext,
	type LabRevisionEntry,
	type LabRevisionSnapshot
} from './revisions.ts';
import { LAB_CATALOG_PACKAGES } from './catalog.ts';
import {
	sessionRegistry,
	mainSessionKey,
	type AgentSessionLike,
	type SessionRegistry
} from '../agent/sessionRegistry.ts';

/* ------------------------------------------------------------- costanti build */

/** Versioni devDependencies fissate per la build standard Vite + React + Tailwind v4 */
export const PINNED_EXPORT_BUILD_DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze({
	vite: '6.2.0',
	'@vitejs/plugin-react': '4.3.4',
	'@tailwindcss/vite': '4.0.9',
	tailwindcss: '4.0.9',
	typescript: '5.7.3',
	'@types/react': '19.0.10',
	'@types/react-dom': '19.0.4'
});

/* --------------------------------------------------------- costruttore package */

function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'lab-prototype';
}

/**
 * Genera la struttura completa di un progetto React ordinario e autonomo.
 * Non dipende da wrapper di preview, Babel in-browser ne' da CDN di runtime.
 */
export function buildStandardExportPackage(
	manifest: LabPrototypeManifest,
	sourceFiles: ReadonlyMap<string, string>
): Map<string, string> {
	const output = new Map<string, string>();

	// 1. package.json con dipendenze fissate
	const runtimeDependencies: Record<string, string> = {
		react: LAB_CATALOG_PACKAGES.react.version,
		'react-dom': LAB_CATALOG_PACKAGES['react-dom'].version
	};

	// Aggiunge le librerie dichiarate dal prototipo (escluso @tailwindcss/browser che serve solo in preview)
	for (const dep of manifest.dependencies) {
		if (dep.name === '@tailwindcss/browser') continue;
		runtimeDependencies[dep.name] = dep.version;
	}

	const packageJsonContent = `${JSON.stringify(
		{
			name: slugify(manifest.id),
			private: true,
			version: '0.1.0',
			type: 'module',
			scripts: {
				dev: 'vite',
				build: 'vite build',
				preview: 'vite preview'
			},
			dependencies: runtimeDependencies,
			devDependencies: { ...PINNED_EXPORT_BUILD_DEPENDENCIES }
		},
		null,
		2
	)}\n`;
	output.set('package.json', packageJsonContent);

	// 2. vite.config.ts standard con plugin React e Tailwind v4
	const viteConfigContent = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Configurazione standard per build ed esecuzione fuori da Studio
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ]
});
`;
	output.set('vite.config.ts', viteConfigContent);

	// 3. tsconfig.json standard
	const tsconfigContent = `${JSON.stringify(
		{
			compilerOptions: {
				target: 'ES2022',
				useDefineForClassFields: true,
				lib: ['ES2022', 'DOM', 'DOM.Iterable'],
				module: 'ESNext',
				skipLibCheck: true,
				moduleResolution: 'bundler',
				allowImportingTsExtensions: true,
				resolveJsonModule: true,
				isolatedModules: true,
				noEmit: true,
				jsx: 'react-jsx',
				strict: true
			},
			include: ['src']
		},
		null,
		2
	)}\n`;
	output.set('tsconfig.json', tsconfigContent);

	// 4. index.html con punto di montaggio standard
	const indexHtmlContent = `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(manifest.title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
	output.set('index.html', indexHtmlContent);

	// 5. README.md descrittivo
	const readmeContent = `# ${manifest.title}

> ${manifest.brief.split('\n')[0] || 'Progetto esportato dal Laboratorio prototipi.'}

Progetto frontend React autonomo esportato dal Laboratorio prototipi di OMP Studio.
Questo codice utilizza una configurazione di compilazione ordinaria basata su Vite e Tailwind CSS v4,
senza dipendere dal runtime privato del Laboratorio né da CDN esterne in produzione.

## Comandi canonici

\`\`\`bash
# Installazione delle dipendenze fissate
npm install

# Avvio del server di sviluppo locale
npm run dev

# Compilazione per la produzione
npm run build

# Anteprima locale della build di produzione
npm run preview
\`\`\`
`;
	output.set('README.md', readmeContent);

	// 6. .gitignore standard per il progetto esportato
	const gitignoreContent = `node_modules
dist
dist-ssr
*.local
.DS_Store
`;
	output.set('.gitignore', gitignoreContent);

	// 7. Copia dei file sorgente del prototipo con normalizzazione Tailwind
	let hasIndexCss = false;
	let hasMainTsx = false;
	let hasAppTsx = false;

	for (const [rawPath, content] of sourceFiles.entries()) {
		const cleanPath = rawPath.replace(/^\/+/, '');

		// Ignora file di configurazione interni del Laboratorio
		if (cleanPath === LAB_MANIFEST_FILE || cleanPath === LAB_BRIEF_FILE || cleanPath === 'package.json') {
			continue;
		}

		if (cleanPath === 'src/index.css') {
			hasIndexCss = true;
			// Assicura la direttiva @import "tailwindcss"; per la compilazione standard con @tailwindcss/vite
			const normalizedCss = ensureTailwindDirective(content);
			output.set(cleanPath, normalizedCss);
		} else {
			if (cleanPath === 'src/main.tsx') hasMainTsx = true;
			if (cleanPath === 'src/App.tsx') hasAppTsx = true;
			output.set(cleanPath, content);
		}
	}

	// Fallback di sicurezza se mancano i file cardine
	if (!hasIndexCss) {
		output.set('src/index.css', `@import "tailwindcss";\n\nbody {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n}\n`);
	}

	if (!hasMainTsx) {
		output.set(
			'src/main.tsx',
			`import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\n\nconst container = document.getElementById('root');\nif (container) {\n  const root = createRoot(container);\n  root.render(<App />);\n}\n`
		);
	}

	if (!hasAppTsx && !output.has('src/App.tsx')) {
		output.set(
			'src/App.tsx',
			`import React from 'react';\n\nexport default function App() {\n  return (\n    <div className="p-8">\n      <h1 className="text-2xl font-bold">${escapeJs(manifest.title)}</h1>\n    </div>\n  );\n}\n`
		);
	}

	return output;
}

function ensureTailwindDirective(css: string): string {
	if (/@import\s+['"]tailwindcss['"]/i.test(css)) {
		return css;
	}
	return `@import "tailwindcss";\n\n${css}`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeJs(text: string): string {
	return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/* ------------------------------------------------------------- export autonomo */

async function loadFilesFromRevision(
	context: LabRevisionContext,
	revisionId: LabRevisionId
): Promise<{ manifest: LabPrototypeManifest; files: Map<string, string> }> {
	const history = await readLabRevisionHistory(context);
	const entry = findLabRevisionEntry(history, revisionId);

	if (!entry) {
		throw new Error(`Revisione '${revisionId}' assente dalla storia del prototipo '${context.prototypeId}'.`);
	}

	if (entry.snapshot) {
		const files = new Map<string, string>();
		for (const file of entry.snapshot.files) {
			const blobPath = `${context.archive.host.label ? '' : ''}lab/revisions/${context.archive.scope}/${context.prototypeId}/blobs/${file.fingerprint.slice('sha256:'.length)}.blob`;
			// Lettura tramite host dell'archivio
			const content = await context.archive.host.readTextFile(
				`lab/revisions/${context.archive.scope}/${context.prototypeId}/blobs/${file.fingerprint.slice('sha256:'.length)}.blob`
			);
			if (content === null) {
				throw new Error(`Blob '${file.fingerprint}' assente per il file '${file.path}'.`);
			}
			files.set(file.path, content);
		}
		return { manifest: entry.snapshot.manifest, files };
	}

	// Se la revisione è aperta o manca lo snapshot ma è la revisione attiva, leggiamo i file dal prototipo
	const stored = await readLabPrototype(context.store, context.prototypeId);
	if (!stored) {
		throw new Error(`Prototipo '${context.prototypeId}' non trovato nel filesystem.`);
	}
	const fileListing = await listLabPrototypeFiles(context.store, context.prototypeId);
	const files = new Map<string, string>();
	for (const relPath of fileListing.files) {
		const content = await readLabPrototypeFile(context.store, context.prototypeId, relPath);
		if (content !== null) {
			files.set(relPath, content);
		}
	}
	return { manifest: stored.manifest, files };
}

/**
 * Esporta una revisione scelta in una cartella indicata.
 *
 * Invarianti garantiti:
 * 1. Non sovrascrive una cartella di destinazione esistente e non vuota se overwrite è false;
 * 2. Non tocca ne' modifica in alcun modo i file del prototipo originale;
 * 3. Non inizializza Git, non esegue commit o hosting;
 * 4. Genera file React standard con dipendenze fissate.
 */
export async function exportLabPrototypeRevision(
	context: LabRevisionContext,
	options: {
		destinationPath: string;
		destinationHost: LabStorageHost;
		revisionId: LabRevisionId;
		overwrite?: boolean;
	}
): Promise<LabExportResult> {
	const { destinationPath, destinationHost, revisionId, overwrite = false } = options;

	if (!destinationPath || typeof destinationPath !== 'string' || destinationPath.trim().length === 0) {
		return {
			ok: false,
			destinationPath: destinationPath ?? '',
			revisionId,
			exportedFiles: [],
			manifest: { id: context.prototypeId, title: '', brief: '', templateVersion: '1.0.0', dependencies: [] },
			errorCode: 'invalid-destination',
			error: 'Il percorso di destinazione specificato non e valido.'
		};
	}

	// 1. Controllo di collisione cartella esistente (nessuna sovrascrittura implicita)
	const existingEntries = await destinationHost.listDirectory('');
	if (existingEntries !== null && existingEntries.length > 0 && !overwrite) {
		return {
			ok: false,
			destinationPath,
			revisionId,
			exportedFiles: [],
			manifest: { id: context.prototypeId, title: '', brief: '', templateVersion: '1.0.0', dependencies: [] },
			errorCode: 'destination-exists',
			error: `La cartella di destinazione '${destinationPath}' esiste già e non e vuota. Per sovrascriverla e necessario confermare esplicitamente.`
		};
	}

	// 2. Recupero file e manifest della revisione
	let revisionData: { manifest: LabPrototypeManifest; files: Map<string, string> };
	try {
		revisionData = await loadFilesFromRevision(context, revisionId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const isNotFound = message.includes('assente');
		return {
			ok: false,
			destinationPath,
			revisionId,
			exportedFiles: [],
			manifest: { id: context.prototypeId, title: '', brief: '', templateVersion: '1.0.0', dependencies: [] },
			errorCode: isNotFound ? 'revision-not-found' : 'no-snapshot',
			error: message
		};
	}

	// 3. Costruzione del pacchetto di export standard
	const exportPackage = buildStandardExportPackage(revisionData.manifest, revisionData.files);

	// 4. Scrittura nella cartella di destinazione
	const writtenPaths: string[] = [];
	try {
		// Crea la directory base se non esiste
		await destinationHost.createDirectory('');

		for (const [relPath, content] of exportPackage.entries()) {
			// Crea le eventuali sottocartelle
			const slashIdx = relPath.lastIndexOf('/');
			if (slashIdx > 0) {
				const parentDir = relPath.slice(0, slashIdx);
				await destinationHost.createDirectory(parentDir);
			}
			// Se la sovrascrittura e consentita e il file esiste, usa replaceFile o createFile
			const exists = (await destinationHost.readTextFile(relPath)) !== null;
			if (exists && overwrite) {
				// Crea temporaneo e sostituisce
				const tempName = `${relPath}.tmp-${Date.now()}`;
				await destinationHost.createFile(tempName, content);
				await destinationHost.replaceFile(tempName, relPath);
			} else {
				await destinationHost.createFile(relPath, content);
			}
			writtenPaths.push(relPath);
		}
	} catch (error) {
		return {
			ok: false,
			destinationPath,
			revisionId,
			exportedFiles: writtenPaths,
			manifest: revisionData.manifest,
			errorCode: 'export-failed',
			error: `Scrittura dei file nella cartella di destinazione fallita: ${error instanceof Error ? error.message : String(error)}`
		};
	}

	return {
		ok: true,
		destinationPath,
		revisionId,
		exportedFiles: writtenPaths,
		manifest: revisionData.manifest
	};
}

/* ------------------------------------------------------------- handoff */

/**
 * Prepara il riferimento stabile per la consegna alla sessione principale.
 * Raccoglie brief, sorgenti, dipendenze, variante ed esplicita i limiti delle simulazioni.
 */
export async function createLabHandoffPackage(
	context: LabRevisionContext,
	options: {
		revisionId: LabRevisionId;
		variant?: string;
		simulationLimits?: readonly string[];
	}
): Promise<LabHandoffPackage> {
	const { revisionId, variant, simulationLimits = LAB_DEFAULT_SIMULATION_LIMITS } = options;

	const revisionData = await loadFilesFromRevision(context, revisionId);
	const now = Date.now();

	const formattedPrompt = formatHandoffPrompt({
		prototypeId: context.prototypeId,
		prototypeTitle: revisionData.manifest.title,
		revisionId,
		variant,
		brief: revisionData.manifest.brief,
		dependencies: revisionData.manifest.dependencies,
		simulationLimits,
		files: revisionData.files,
		createdAt: now
	});

	return {
		prototypeId: context.prototypeId,
		prototypeTitle: revisionData.manifest.title,
		revisionId,
		variant,
		brief: revisionData.manifest.brief,
		dependencies: revisionData.manifest.dependencies,
		simulationLimits,
		files: revisionData.files,
		createdAt: now,
		formattedPrompt
	};
}

/**
 * Genera il prompt strutturato per l'agente principale, descrivendo il prototipo,
 * i file, i limiti delle simulazioni e vietando auto-merge o alterazioni del prototipo.
 */
export function formatHandoffPrompt(ref: LabHandoffReference): string {
	const sections: string[] = [];

	sections.push('# Consegna Prototipo dal Laboratorio (Handoff)');
	sections.push(
		`L'utente ha selezionato e consegnato questo prototipo dal Laboratorio affinché venga valutato e incorporato nel progetto ordinario.`
	);

	sections.push('## Riferimento stabile');
	sections.push(`- **Prototipo**: ${ref.prototypeTitle} (\`${ref.prototypeId}\`)`);
	sections.push(`- **Revisione consegnata**: \`${ref.revisionId}\``);
	if (ref.variant) {
		sections.push(`- **Variante selezionata**: \`${ref.variant}\``);
	}
	sections.push(`- **Data di consegna**: ${new Date(ref.createdAt).toISOString()}`);

	sections.push('## Brief originale del prototipo');
	sections.push(ref.brief || 'Nessun brief fornito.');

	sections.push('## Limiti delle simulazioni (VINCOLI DI SICUREZZA)');
	sections.push(
		'Il codice del prototipo contiene simulazioni di frontend che NON devono essere usate come codice di produzione as-is:'
	);
	for (const limit of ref.simulationLimits) {
		sections.push(`- ${limit}`);
	}

	sections.push('## Dipendenze dichiarate dal prototipo');
	if (ref.dependencies.length === 0) {
		sections.push('Nessuna dipendenza esterna dichiarata.');
	} else {
		for (const dep of ref.dependencies) {
			sections.push(`- \`${dep.name}@${dep.version}\``);
		}
	}

	sections.push(`## Sorgenti della revisione ${ref.revisionId}`);
	sections.push('I seguenti file compongono l\'esperimento approvato dall\'utente:');
	for (const [path, content] of ref.files.entries()) {
		// Mostra solo i file del codice (src/ e config)
		if (path === LAB_MANIFEST_FILE || path === LAB_BRIEF_FILE) continue;
		sections.push(`\n### \`${path}\`\n\`\`\`tsx\n${content}\n\`\`\``);
	}

	sections.push('## Regole e istruzioni per l\'agente principale:');
	sections.push(
		'1. **Nessun auto-merge indiscriminato**: Esamina i file attuali del progetto prima di qualsiasi modifica.'
	);
	sections.push(
		'2. **Rispetta lo stack nativo del progetto**: Se il progetto corrente usa Svelte / SvelteKit (o altro), adatta e converti i componenti e la logica nello stack del progetto; NON importare React nel progetto se non e gia un progetto React.'
	);
	sections.push(
		'3. **Sostituisci i dati fittizi con sorgenti reali**: Collega le API, gli store, le query e le azioni del backend vero del progetto al posto dei mock del prototipo.'
	);
	sections.push(
		'4. **Preserva il prototipo**: I file sotto `proto/` e le revisioni del Laboratorio devono restare intatti e non essere sovrascritti o cancellati.'
	);

	return sections.join('\n\n');
}

/**
 * Consegna il pacchetto di handoff alla sessione dell'agente principale,
 * utilizzando il suo normale meccanismo di prompt/coda.
 * Se la sessione principale e impegnata (streaming), il messaggio viene accodato
 * in modalità followUp senza interrompere il lavoro in corso ne' causare auto-merge.
 */
export async function deliverLabHandoff(
	handoffPackage: LabHandoffPackage,
	options: {
		projectKey: string;
		sessionRegistry?: SessionRegistry<any>;
		targetSession?: AgentSessionLike & {
			prompt?: (message: string, images?: any[], behavior?: string) => Promise<void>;
			queued?: Array<{ id: number; text: string; behavior: string }>;
		};
		streamingBehavior?: 'followUp' | 'steer';
	}
): Promise<LabHandoffDeliveryResult> {
	const { projectKey, sessionRegistry: registry = sessionRegistry, streamingBehavior = 'followUp' } = options;

	let mainSession = options.targetSession;
	if (!mainSession) {
		mainSession = registry.getMainSession(projectKey);
	}

	if (!mainSession) {
		// Se non esiste ancora, proviamo a crearla tramite la factory del registro se disponibile
		try {
			mainSession = registry.getOrCreateMainSession({ id: projectKey, path: projectKey });
		} catch {
			// Nessuna sessione disponibile
		}
	}

	if (!mainSession) {
		return {
			ok: false,
			targetSessionKey: mainSessionKey(projectKey),
			deliveredPrompt: handoffPackage.formattedPrompt,
			enqueued: false,
			error: `Nessuna sessione principale attiva o registrabile trovata per il progetto '${projectKey}'.`
		};
	}

	const isStreaming = Boolean(mainSession.isStreaming);

	try {
		if (typeof mainSession.prompt === 'function') {
			// Invio tramite il normale metodo prompt della sessione
			await mainSession.prompt(handoffPackage.formattedPrompt, [], streamingBehavior);
		} else {
			// Mock o sessione semplificata per test
			if (!mainSession.queued) {
				(mainSession as any).queued = [];
			}
			mainSession.queued?.push({
				id: Date.now(),
				text: handoffPackage.formattedPrompt,
				behavior: streamingBehavior
			});
		}

		return {
			ok: true,
			targetSessionKey: mainSession.sessionKey || mainSessionKey(projectKey),
			deliveredPrompt: handoffPackage.formattedPrompt,
			enqueued: isStreaming
		};
	} catch (error) {
		return {
			ok: false,
			targetSessionKey: mainSession.sessionKey || mainSessionKey(projectKey),
			deliveredPrompt: handoffPackage.formattedPrompt,
			enqueued: false,
			error: `Invio del prompt di handoff al principale fallito: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}
