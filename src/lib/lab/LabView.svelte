<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import {
		IconLab,
		IconTerminal,
		IconClose,
		IconPlus,
		IconCheck,
		IconRefresh,
		IconHistory,
		IconViewCode,
		IconContextWindow,
		IconSubagents,
		IconFolderOpen,
		IconCopy,
		IconUndo,
		IconSparkles,
		IconSend,
		IconWarning,
		IconDownload,
		IconArrowRight
	} from '$lib/icons';
	import type { Project } from '$lib/stores/projects.svelte';
	import { sessionRegistry } from '$lib/agent/sessionRegistry';
	import type { AgentSession } from '$lib/agent/session.svelte';
	import {
		isLabPrototypeId,
		type LabContextSnapshot,
		type LabPrototypeId,
		type LabPrototypeManifest,
		type LabVisualContextAttachment,
		type LabExportResult,
		type LabHandoffPackage
	} from './contracts';
	import {
		buildStandardExportPackage,
		exportLabPrototypeRevision,
		createLabHandoffPackage,
		deliverLabHandoff
	} from './export-handoff';
	import {
		createLabPrototype,
		labDraftStore,
		labProjectStore,
		listLabDrafts,
		listLabPrototypes,
		readLabPrototype,
		readLabPrototypeFile,
		type LabStore,
		type LabStoredPrototype
	} from './storage';
	import { createLabStorageHost } from './storage-host';
	import {
		labRevisionArchive,
		readLabRevisionHistory,
		restoreLabRevision,
		type LabRevisionArchive,
		type LabRevisionContext,
		type LabRevisionEntry
	} from './revisions';
	import {
		applySystemTechnicalTemplate,
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
		type LabAuthorSubagentTask,
		type LabExecutionStrategy,
		type LabTargetKind
	} from './orchestration';
	import { compileLabPrototype } from './compiler';
	import {
		createIframeRendererAdapter,
		LabVisualTools,
		type LabActiveSelection,
		type LabInteractionMode,
		type LabViewportConfig
	} from './visual-tools';
	import LabVisualToolbar from './LabVisualToolbar.svelte';
	import LabContextPanel from './LabContextPanel.svelte';
	import { buildLabPreviewHtml } from './preview-builder';
	import { onDestroy, onMount } from 'svelte';
	import {
		inspectProjectGitignore,
		listLegacyPrototypes,
		migrateProjectGitignore,
		readLegacyPrototype,
		reconstructLegacyPrototypeBrief,
		rollbackProjectGitignore
	} from './migration';
	import type { GitignoreInspectionResult, LabLegacyPrototype } from './contracts';

	let {
		projectPath = '',
		projectKey = '',
		projectName = m.ui_labview_progetto_corrente_cf11(),
		agentState = 'idle',
		onBackToMain,
		onClose,
		initialPrototypeId
	}: {
		projectPath?: string;
		projectKey?: string;
		projectName?: string;
		agentState?: Project['agentState'];
		onBackToMain?: () => void;
		onClose?: () => void;
		initialPrototypeId?: string;
	} = $props();

	// Stato collocazione: 'project' se collegato a un percorso valido, altrimenti 'draft'
	const isDraft = $derived(!projectPath || projectPath.trim() === '');
	const host = $derived(createLabStorageHost(projectPath || 'lab/drafts'));
	const store = $derived<LabStore>(
		isDraft ? labDraftStore(host) : labProjectStore(projectKey || projectPath, host)
	);
	const revisionArchive = $derived<LabRevisionArchive>(
		labRevisionArchive(host, isDraft ? 'drafts' : projectKey || projectPath)
	);

	// Prototipi recuperabili e prototipo attivo
	let prototypes = $state<LabStoredPrototype[]>([]);
	let activePrototype = $state<LabStoredPrototype | null>(null);
	let loadingPrototypes = $state(true);
	const revisionContext = $derived<LabRevisionContext | null>(
		activePrototype
			? {
					archive: revisionArchive,
					store,
					prototypeId: activePrototype.id
				}
			: null
	);


	// Revisioni e codice
	let revisions = $state<LabRevisionEntry[]>([]);
	let observedRevisionId = $state<string>('rev-initial');
	let prototypeFiles = $state<Record<string, string>>({});
	let selectedFileForViewing = $state<string>('src/App.tsx');
	let selectedFileContent = $state<string>('');

	// Compilazione e anteprima
	let previewHtml = $state<string>('');
	let isCompiling = $state(false);
	let compileError = $state<string | null>(null);
	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let canvasTheme = $state<'light' | 'dark' | 'neutral'>('light');

	// Strumenti visuali (Step 10)
	let visualTools = $state<LabVisualTools | null>(null);
	let activeSelection = $state<LabActiveSelection | null>(null);
	let interactionMode = $state<LabInteractionMode>('interact');
	let currentViewport = $state<LabViewportConfig>({
		width: 1280,
		height: 800,
		deviceScaleFactor: 1,
		label: 'Desktop (1280x800)'
	});

	// Chat del prototipo
	let chatMessages = $state<
		Array<{
			id: string;
			sender: 'user' | 'assistant' | 'system';
			text: string;
			timestamp: number;
			attachment?: LabVisualContextAttachment;
			status?: 'sending' | 'delivered';
		}>
	>([]);
	let chatInput = $state('');
	let pendingAttachment = $state<LabVisualContextAttachment | null>(null);
	let isGenerating = $state(false);

	// Inspector laterale a comparsa (Codice, Revisioni, Contesto, Subagenti)
	type InspectorTab = 'none' | 'code' | 'revisions' | 'context' | 'subagents';
	let activeInspectorTab = $state<InspectorTab>('none');

	// Contesto stabile (Step 11)
	let contextSnapshot = $state<LabContextSnapshot | null>(null);

	// Subagenti pianificati (Step 12)
	let plannedSubagents = $state<readonly LabAuthorSubagentTask[]>([]);

	// Dialog / Modal Nuovo Prototipo
	let showPrototypeDialog = $state(false);
	let dialogMode = $state<'list' | 'create'>('list');
	let newProtoTitle = $state('Confronto Tabelle Pratiche');
	let newProtoBrief = $state(
		'Ridisegna la tabella delle pratiche PSR proponendo tre interpretazioni visive (Densa, Card, Split) con gli stessi dati simulati ma stili isolati.'
	);
	let newProtoTarget = $state<LabTargetKind>('component_variants');
	let newProtoStrategy = $state<LabExecutionStrategy>('proceed_immediately');
	let isCreatingPrototype = $state(false);
	let creationError = $state<string | null>(null);

	// Feedback visivo azioni
	let flashToast = $state<string | null>(null);
	let copyFeedback = $state(false);

	function showToast(msg: string) {
		flashToast = msg;
		setTimeout(() => {
			if (flashToast === msg) flashToast = null;
		}, 3200);
	}

	// Export autonomo e Handoff al principale (Step 14)
	let showExportDialog = $state(false);
	let exportRevisionId = $state<string>('');
	let exportDestinationPath = $state<string>('');
	let exportOverwrite = $state(false);
	let isExporting = $state(false);
	let exportResult = $state<LabExportResult | null>(null);
	let exportError = $state<string | null>(null);

	let showHandoffDialog = $state(false);
	let handoffRevisionId = $state<string>('');
	let handoffVariant = $state<string>('');
	let isDeliveringHandoff = $state(false);
	let handoffResult = $state<{ ok: boolean; enqueued: boolean; message: string } | null>(null);
	let handoffError = $state<string | null>(null);
	let handoffPackagePreview = $state<LabHandoffPackage | null>(null);

	// Migrazione del preesistente e compatibilità legacy (Step 15)
	let legacyPrototypes = $state<LabLegacyPrototype[]>([]);
	let gitignoreInspection = $state<GitignoreInspectionResult | null>(null);
	let gitignoreMigrating = $state(false);

	function startReconstructLegacy(legacy: LabLegacyPrototype) {
		const recon = reconstructLegacyPrototypeBrief(legacy);
		newProtoTitle = recon.suggestedPrototypeTitle;
		newProtoBrief = recon.brief;
		dialogMode = 'create';
		showToast(`Brief di ricostruzione non fedele preparato per '${legacy.fileName}'.`);
	}

	async function handleMigrateGitignore() {
		gitignoreMigrating = true;
		try {
			const res = await migrateProjectGitignore(host);
			if (res.success) {
				showToast('Regola .gitignore migrata: i prototipi in proto/<id>/ ora sono versionabili in Git.');
				gitignoreInspection = await inspectProjectGitignore(host);
			} else {
				showToast(res.error || 'Migrazione .gitignore non riuscita');
			}
		} catch (err) {
			showToast(m.ui_labview_errore_migrazione_gitignore_value1_13ad({ value1: String(err) }));
		} finally {
			gitignoreMigrating = false;
		}
	}

	async function handleRollbackGitignore() {
		gitignoreMigrating = true;
		try {
			const res = await rollbackProjectGitignore(host);
			if (res.success) {
				showToast('Regola .gitignore ripristinata: proto/ nuovamente escluso da Git.');
				gitignoreInspection = await inspectProjectGitignore(host);
			} else {
				showToast(res.error || 'Rollback .gitignore non riuscito');
			}
		} catch (err) {
			showToast(m.ui_labview_errore_rollback_gitignore_value1_f6fe({ value1: String(err) }));
		} finally {
			gitignoreMigrating = false;
		}
	}

	function openExportDialog(revId?: string) {
		const targetRev = revId || observedRevisionId || (revisions[revisions.length - 1]?.revision.id ?? 'rev-1');
		exportRevisionId = targetRev;
		exportError = null;
		exportResult = null;
		if (!exportDestinationPath && activePrototype) {
			exportDestinationPath = projectPath
				? `${projectPath}/exported-${activePrototype.id}`
				: `exported-${activePrototype.id}`;
		}
		showExportDialog = true;
	}

	async function handleRunExport() {
		if (!exportDestinationPath.trim()) {
			exportError = 'Inserisci un percorso di destinazione valido.';
			return;
		}
		if (!revisionContext) {
			exportError = 'Contesto revisioni non inizializzato.';
			return;
		}

		isExporting = true;
		exportError = null;
		exportResult = null;

		try {
			const destHost = createLabStorageHost(exportDestinationPath.trim());
			const res = await exportLabPrototypeRevision(revisionContext, {
				destinationPath: exportDestinationPath.trim(),
				destinationHost: destHost,
				revisionId: exportRevisionId,
				overwrite: exportOverwrite
			});

			if (res.ok) {
				exportResult = res;
				showToast(`Progetto React esportato con successo in '${exportDestinationPath}'!`);
			} else {
				exportError = res.error || m.ui_labview_errore_durante_l_esportazione_bd77();
			}
		} catch (err) {
			exportError = err instanceof Error ? err.message : String(err);
		} finally {
			isExporting = false;
		}
	}

	async function openHandoffDialog(revId?: string) {
		const targetRev = revId || observedRevisionId || (revisions[revisions.length - 1]?.revision.id ?? 'rev-1');
		handoffRevisionId = targetRev;
		handoffVariant = '';
		handoffError = null;
		handoffResult = null;
		handoffPackagePreview = null;
		showHandoffDialog = true;

		if (revisionContext) {
			try {
				handoffPackagePreview = await createLabHandoffPackage(revisionContext, {
					revisionId: targetRev,
					variant: handoffVariant.trim() || undefined
				});
			} catch {
				// anteprima generata al volo
			}
		}
	}

	async function updateHandoffPreview() {
		if (!revisionContext) return;
		try {
			handoffPackagePreview = await createLabHandoffPackage(revisionContext, {
				revisionId: handoffRevisionId,
				variant: handoffVariant.trim() || undefined
			});
		} catch (err) {
			handoffError = err instanceof Error ? err.message : String(err);
		}
	}

	async function handleDeliverHandoff() {
		if (!revisionContext) {
			handoffError = 'Contesto revisioni non inizializzato.';
			return;
		}

		isDeliveringHandoff = true;
		handoffError = null;
		handoffResult = null;

		try {
			const pkg = await createLabHandoffPackage(revisionContext, {
				revisionId: handoffRevisionId,
				variant: handoffVariant.trim() || undefined
			});

			const targetKey = projectKey || projectPath || '';
			const res = await deliverLabHandoff(pkg, {
				projectKey: targetKey
			});

			if (res.ok) {
				handoffResult = {
					ok: true,
					enqueued: res.enqueued,
					message: res.enqueued
						? m.ui_labview_la_consegna_e_stata_accodata_nella_sessione_76af()
						: m.ui_labview_la_consegna_e_stata_inviata_con_successo_84a1()
				};
				showToast(m.ui_labview_consegna_al_principale_completata_91b5());
			} else {
				handoffError = res.error || m.ui_labview_errore_durante_la_consegna_al_principale_f48a();
			}
		} catch (err) {
			handoffError = err instanceof Error ? err.message : String(err);
		} finally {
			isDeliveringHandoff = false;
		}
	}

	// Inizializza visual tools per l'anteprima
	function setupVisualTools() {
		const adapter = createIframeRendererAdapter(
			() => iframeEl,
			() => observedRevisionId
		);
		visualTools = new LabVisualTools({
			renderer: adapter,
			initialRevisionId: observedRevisionId,
			onModeChange: (m) => {
				interactionMode = m;
				// Invia l'evento all'iframe
				if (iframeEl?.contentWindow) {
					iframeEl.contentWindow.postMessage(
						{ source: 'lab-parent-bridge', type: 'set_mode', mode: m },
						'*'
					);
				}
			},
			onSelectionChange: (sel) => {
				activeSelection = sel;
			},
			onViewportChange: (vp) => {
				currentViewport = vp;
			}
		});
	}

	// Carica i prototipi disponibili nello store
	async function loadPrototypes() {
		loadingPrototypes = true;
		try {
			const listing = isDraft ? await listLabDrafts(host) : await listLabPrototypes(store);
			prototypes = listing.prototypes;
			if (!isDraft) {
				legacyPrototypes = await listLegacyPrototypes(host, store);
				gitignoreInspection = await inspectProjectGitignore(host);
			} else {
				legacyPrototypes = [];
				gitignoreInspection = null;
			}

			if (prototypes.length > 0) {
				const target =
					initialPrototypeId && prototypes.find((p) => p.id === initialPrototypeId)
						? prototypes.find((p) => p.id === initialPrototypeId)!
						: prototypes[0];
				await selectPrototype(target.id);
			} else {
				// Nessun prototipo esistente: apre la dialog per crearne uno o crea il default
				activePrototype = null;
				showPrototypeDialog = true;
				dialogMode = 'create';
			}
		} catch (err) {
			console.error(m.ui_labview_errore_caricamento_prototipi_9cb6(), err);
		} finally {
			loadingPrototypes = false;
		}
	}

	// Seleziona un prototipo attivo
	async function selectPrototype(id: LabPrototypeId) {
		try {
			const stored = await readLabPrototype(store, id);
			if (!stored) return;
			activePrototype = stored;

			// Carica cronologia revisioni
			await refreshRevisionHistory(id);

			// Carica i file correnti del prototipo
			await loadPrototypeFiles(id);

			// Pianifica subagenti in base all'obiettivo per visualizzarli nell'inspector
			const interpretation = interpretBrief(stored.manifest.brief, {
				title: stored.manifest.title,
				strategy: 'proceed_immediately'
			});
			plannedSubagents = planAuthorSubagents({
				dataModelInterface: 'OrderItem',
				mockDataConstantName: 'MOCK_ORDERS',
				mockItemCount: 4,
				sharedTypesFilePath: '/src/types.ts',
				sharedDataFilePath: '/src/data.ts',
				variants: [
					{
						id: 'dense',
						name: 'Variante A (Densa)',
						visualDirection: 'Compatta tabellare',
						uxDensity: 'compact',
						themeToken: 'slate',
						assignedFilePath: '/src/variants/VariantDense.tsx',
						authorSubagentName: 'author-dense'
					},
					{
						id: 'cards',
						name: 'Variante B (Card)',
						visualDirection: 'Visuale a tessere',
						uxDensity: 'spacious',
						themeToken: 'indigo',
						assignedFilePath: '/src/variants/VariantCards.tsx',
						authorSubagentName: 'author-cards'
					},
					{
						id: 'split',
						name: 'Variante C (Split)',
						visualDirection: 'Master-detail split con drawer',
						uxDensity: 'balanced',
						themeToken: 'slate',
						assignedFilePath: '/src/variants/VariantSplit.tsx',
						authorSubagentName: 'author-split'
					}
				]
			});

			// Setup chat iniziale
			if (chatMessages.length === 0) {
				chatMessages = [
					{
						id: 'init-msg',
						sender: 'assistant',
						text: m.ui_labview_ho_predisposto_l_ambiente_per_il_prototipo_1c07({ value1: stored.manifest.title }),
						timestamp: Date.now()
					}
				];
			}

			setupVisualTools();
			await compileAndRender();
			showPrototypeDialog = false;
		} catch (err) {
			console.error(m.ui_labview_errore_selezione_prototipo_value1_20b8({ value1: id }), err);
		}
	}

	async function refreshRevisionHistory(id: LabPrototypeId) {
		try {
			const revContext: LabRevisionContext = { prototypeId: id, archive: revisionArchive, store };
			const history = await readLabRevisionHistory(revContext);
			revisions = history.entries;
			if (revisions.length > 0) {
				observedRevisionId = revisions[0].revision.id;
			} else {
				observedRevisionId = 'rev-1-initial';
			}
		} catch {
			revisions = [];
			observedRevisionId = 'rev-1-initial';
		}
	}

	async function loadPrototypeFiles(id: LabPrototypeId) {
		const files: Record<string, string> = {};
		const candidates = [
			'src/App.tsx',
			'src/main.tsx',
			'src/index.css',
			'src/types.ts',
			'src/data.ts',
			'src/variants/VariantDense.tsx',
			'src/variants/VariantCards.tsx',
			'src/variants/VariantSplit.tsx',
			'package.json',
			'brief.md',
			'prototype.json'
		];

		for (const rel of candidates) {
			try {
				const content = await readLabPrototypeFile(store, id, rel);
				if (content !== null) {
					files[rel] = content;
				}
			} catch {}
		}

		prototypeFiles = files;
		if (files[selectedFileForViewing]) {
			selectedFileContent = files[selectedFileForViewing];
		} else if (files['src/App.tsx']) {
			selectedFileForViewing = 'src/App.tsx';
			selectedFileContent = files['src/App.tsx'];
		}
	}

	// Compila i sorgenti e genera l'anteprima
	async function compileAndRender() {
		if (!activePrototype) return;
		isCompiling = true;
		compileError = null;

		try {
			// Prepara VFS files
			const vfsFiles: Record<string, string> = {};
			for (const [rel, content] of Object.entries(prototypeFiles)) {
				vfsFiles[rel.startsWith('/') ? rel : '/' + rel] = content;
			}

			// Se mancano file chiave, genera template
			if (!vfsFiles['/src/App.tsx']) {
				vfsFiles['/src/App.tsx'] = generateComponentVariantsAppCode();
			}
			if (!vfsFiles['/src/main.tsx']) {
				vfsFiles['/src/main.tsx'] = `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
`;
			}
			if (!vfsFiles['/src/data.ts']) {
				vfsFiles['/src/data.ts'] = generateSharedMockDataCode();
			}
			if (!vfsFiles['/src/types.ts']) {
				vfsFiles['/src/types.ts'] = `export interface OrderItem {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  status: 'completed' | 'processing' | 'pending' | 'draft';
  date: string;
  priority: 'high' | 'medium' | 'low';
}
`;
			}
			if (!vfsFiles['/src/variants/VariantDense.tsx']) {
				vfsFiles['/src/variants/VariantDense.tsx'] = generateVariantDenseCode();
			}
			if (!vfsFiles['/src/variants/VariantCards.tsx']) {
				vfsFiles['/src/variants/VariantCards.tsx'] = generateVariantCardsCode();
			}
			if (!vfsFiles['/src/variants/VariantSplit.tsx']) {
				vfsFiles['/src/variants/VariantSplit.tsx'] = generateVariantSplitCode();
			}

			const res = await compileLabPrototype({
				files: vfsFiles,
				entryPoint: '/src/main.tsx'
			});

			if (!res.ok) {
				compileError = res.errors?.join('\n') || m.ui_labview_errore_di_compilazione_sconosciuto_a08f();
				return;
			}

			// Genera il documento HTML con reset isolato
			previewHtml = buildLabPreviewHtml({
				title: activePrototype.manifest.title,
				js: res.js || '',
				css: res.css || '',
				canvasBackground: canvasTheme
			});
		} catch (err) {
			compileError = `Guasto durante la compilazione: ${String(err)}`;
		} finally {
			isCompiling = false;
		}
	}

	// Creazione di un nuovo prototipo
	async function handleCreatePrototype() {
		creationError = null;
		if (!newProtoTitle.trim()) {
			creationError = 'Il titolo del prototipo non puo essere vuoto.';
			return;
		}
		isCreatingPrototype = true;

		try {
			const interpretation = interpretBrief(newProtoBrief, {
				title: newProtoTitle,
				strategy: newProtoStrategy
			});
			// 1. Crea il prototipo su storage
			const created = await createLabPrototype(store, {
				title: newProtoTitle,
				brief: newProtoBrief,
				templateVersion: '1.0.0'
			});

			// 2. Applica template e genera file iniziali
			const templateFiles = getSystemTechnicalTemplate({
				title: newProtoTitle,
				brief: newProtoBrief
			});
			const appCode =
				newProtoTarget === 'multi_screen_flow'
					? generateMultiScreenFlowAppCode()
					: generateComponentVariantsAppCode();

			const initialFiles: Record<string, string> = {
				...templateFiles,
				'/src/App.tsx': appCode,
				'/src/main.tsx': `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
`,
				'/src/types.ts': `export interface OrderItem {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  status: 'completed' | 'processing' | 'pending' | 'draft';
  date: string;
  priority: 'high' | 'medium' | 'low';
}
`,
				'/src/data.ts': generateSharedMockDataCode(),
				'/src/variants/VariantDense.tsx': generateVariantDenseCode(),
				'/src/variants/VariantCards.tsx': generateVariantCardsCode(),
				'/src/variants/VariantSplit.tsx': generateVariantSplitCode()
			};

			const revContext: LabRevisionContext = {
				prototypeId: created.id,
				archive: revisionArchive,
				store
			};

			// 3. Integra e scatta la prima revisione
			await integrateAndMakePreviewReady({
				store,
				revisionContext: revContext,
				requestId: 'req-init',
				requestSummary: 'Inizializzazione prototipo da brief',
				files: initialFiles,
				title: created.manifest.title
			});

			// 4. Ricarica e seleziona
			await loadPrototypes();
			await selectPrototype(created.id);
			showToast(`Prototipo '${created.manifest.title}' creato con successo!`);
		} catch (err) {
			creationError = m.ui_labview_creazione_fallita_value1_1c7e({ value1: String(err) });
		} finally {
			isCreatingPrototype = false;
		}
	}

	// Ripristino di una revisione precedente
	async function handleRestoreRevision(rev: LabRevisionEntry) {
		if (!activePrototype) return;
		try {
			const revContext: LabRevisionContext = {
				prototypeId: activePrototype.id,
				archive: revisionArchive,
				store
			};
			await restoreLabRevision(revContext, rev.revision.id, {
				requestId: `req-restore-${Date.now()}`,
				summary: `Ripristino revisione ${rev.revision.id}`
			});
			await refreshRevisionHistory(activePrototype.id);
			await loadPrototypeFiles(activePrototype.id);
			await compileAndRender();
			observedRevisionId = rev.revision.id;
			showToast(`Ripristinata con successo la revisione ${rev.revision.id}`);
		} catch (err) {
			console.error(m.ui_labview_errore_ripristino_revisione_value1_75f7({ value1: rev.revision.id }), err);
			showToast(m.ui_labview_errore_durante_il_ripristino_value1_673a({ value1: String(err) }));
		}
	}

	// Invio messaggio nella chat del prototipo
	async function handleSendMessage() {
		const text = chatInput.trim();
		if (!text && !pendingAttachment) return;
		if (!activePrototype) return;

		const userMsg = {
			id: `user-${Date.now()}`,
			sender: 'user' as const,
			text: text || 'Richiesta di revisione visuale con annotazione',
			timestamp: Date.now(),
			attachment: pendingAttachment ?? undefined,
			status: 'delivered' as const
		};

		chatMessages = [...chatMessages, userMsg];
		chatInput = '';
		const currentAttachment = pendingAttachment;
		pendingAttachment = null;
		isGenerating = true;

		// Notifica visiva della richiesta di iterazione
		try {
			// Simula o inoltra la richiesta all'agente del prototipo
			const session = sessionRegistry.getOrCreateLabSession(
				{ id: projectKey, path: projectPath },
				activePrototype.id
			);

			// Invia l'iterazione: genera una nuova revisione con la modifica richiesta
			setTimeout(async () => {
				const nextRevNum = revisions.length + 1;
				const newRevId = `rev-${nextRevNum}-iteration`;

				// Modifica simulata dell'applicazione in base al testo
				let updatedApp = prototypeFiles['src/App.tsx'] || generateComponentVariantsAppCode();
				if (text.toLowerCase().includes('card') || text.toLowerCase().includes('b')) {
					updatedApp = updatedApp.replace(
						"useState<'dense' | 'cards' | 'split' | 'compare'>('dense')",
						"useState<'dense' | 'cards' | 'split' | 'compare'>('cards')"
					);
				} else if (text.toLowerCase().includes('split') || text.toLowerCase().includes('c')) {
					updatedApp = updatedApp.replace(
						"useState<'dense' | 'cards' | 'split' | 'compare'>('dense')",
						"useState<'dense' | 'cards' | 'split' | 'compare'>('split')"
					);
				}

				prototypeFiles['src/App.tsx'] = updatedApp;
				const revContext: LabRevisionContext = {
					prototypeId: activePrototype!.id,
					archive: revisionArchive,
					store
				};

				const sourceFiles: Record<string, string> = {};
				for (const [k, v] of Object.entries(prototypeFiles)) {
					if (k !== 'prototype.json' && k !== 'brief.md') {
						sourceFiles[k] = v;
					}
				}
				sourceFiles['src/App.tsx'] = updatedApp;

				const res = await integrateAndMakePreviewReady({
					store,
					revisionContext: revContext,
					requestId: `req-${Date.now()}`,
					requestSummary: text || 'Iterazione da feedback visuale',
					files: sourceFiles,
					title: activePrototype!.manifest.title
				});

				await refreshRevisionHistory(activePrototype!.id);
				observedRevisionId = res.revision.revision.id;
				await compileAndRender();

				chatMessages = [
					...chatMessages,
					{
						id: `asst-${Date.now()}`,
						sender: 'assistant',
						text: m.ui_labview_ho_applicato_la_modifica_richiesta_alla_nuova_e14c({ value1: newRevId }),
						timestamp: Date.now()
					}
				];
				isGenerating = false;
				showToast(`Nuova revisione ${newRevId} renderizzata nell'anteprima!`);
			}, 900);
		} catch (err) {
			console.error(m.ui_labview_errore_invio_messaggio_652a(), err);
			isGenerating = false;
		}
	}

	// Ricezione allegato dalla toolbar visuale
	function handleVisualAttachment(att: LabVisualContextAttachment) {
		pendingAttachment = att;
		const elemTag = att.element?.tagName || 'elemento';
		const elemSel = att.element?.selector || '';
		const comment = att.comment || '';
		const hint = `[Annotazione visuale su <${elemTag}> (${elemSel}) nella revisione ${att.revisionId}]: ${comment}`;
		chatInput = chatInput ? `${chatInput}\n\n${hint}` : hint;
		showToast(m.ui_labview_annotazione_visuale_inserita_nel_messaggio_25a5());
	}

	// Copia codice selezionato negli appunti
	async function handleCopyCode() {
		if (!selectedFileContent) return;
		try {
			await navigator.clipboard.writeText(selectedFileContent);
			copyFeedback = true;
			setTimeout(() => {
				copyFeedback = false;
			}, 2000);
		} catch {}
	}

	// Ascolto messaggi dall'iframe del renderer
	function handleWindowMessage(e: MessageEvent) {
		if (!e.data || e.data.source !== 'lab-renderer-bridge') return;
		if (e.data.type === 'element_selected' && e.data.element) {
			const el = e.data.element;
			activeSelection = {
				revisionId: observedRevisionId,
				element: el,
				selectedAt: Date.now()
			};
			if (visualTools) {
				visualTools.selectElementBySelector(el.selector);
			}
			showToast(`Selezionato: <${el.tagName}> (${el.selector})`);
		}
	}

	onMount(() => {
		window.addEventListener('message', handleWindowMessage);
		void loadPrototypes();
	});

	onDestroy(() => {
		window.removeEventListener('message', handleWindowMessage);
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && !showPrototypeDialog) {
			onBackToMain?.();
		}
	}}
/>

<div class="lab-root" role="region" aria-label={m.lab_root_aria()}>
	<!-- HEADER DELLA VISTA DEDICATA -->
	<header class="lab-topbar">
		<div class="topbar-left">
			<div class="lab-logo" title={m.ui_labview_laboratorio_prototipi_studio_d064()}>
				<IconLab />
				<span class="logo-text">{m.lab_logo_text()}</span>
			</div>

			<!-- Indicatore collocazione: Progetto attivo, Progetto vuoto o Bozze -->
			<div class="location-chip" class:draft={isDraft}>
				{#if isDraft}
					<span class="location-badge draft">Bozza locale</span>
					<span class="location-name">{m.ui_labview_archivio_senza_progetto_66e7()}</span>
				{:else}
					<span class="location-badge project">{m.topbar_tab_project()}</span>
					<span class="location-name" title={projectPath}>{projectName}</span>
				{/if}
			</div>

			<!-- Selettore del prototipo attivo -->
			<div class="prototype-selector">
				<button
					type="button"
					class="btn-proto-select"
					onclick={() => {
						showPrototypeDialog = true;
						dialogMode = 'list';
					}}
					title={m.ui_labview_seleziona_o_crea_prototipo_00bf()}
					aria-label="Selettore prototipo: {activePrototype?.manifest.title || 'Nessuno'}"
				>
					<span class="proto-label">{m.lab_proto_label()}</span>
					<strong class="proto-title">{activePrototype?.manifest.title || m.ui_labview_seleziona_81f2()}</strong>
					<span class="proto-badge">{observedRevisionId}</span>
				</button>
			</div>
		</div>

		<!-- INDICATORE CHE IL PRINCIPALE CONTINUA A LAVORARE E PASSAGGIO RAPIDO -->
		<div class="topbar-center">
			{#if !isDraft}
				<div
					class="main-agent-indicator"
					class:working={agentState === 'working'}
					class:attention={agentState === 'attention'}
				>
					<span class="agent-dot" aria-hidden="true"></span>
					<span class="agent-label">
						{#if agentState === 'working'}
							Principale al lavoro...
						{:else if agentState === 'attention'}
							{m.ui_labview_principale_richiede_risposta_6762()}
						{:else}
							{m.ui_labview_principale_in_attesa_7628()}
						{/if}
					</span>

					<button
						type="button"
						class="btn-switch-main"
						onclick={onBackToMain}
						title="Passa alla vista principale senza interrompere il lavoro (Esc)"
						aria-label={m.ui_labview_torna_al_progetto_principale_861a()}
					>
						<IconTerminal />
						<span>{m.lab_back_to_main()}</span>
					</button>
				</div>
			{/if}
		</div>

		<!-- AZIONI IN TESTATA: TOGGLE INSPECTOR E CHIUSURA -->
		<div class="topbar-right">
			<!-- Azioni di Uscita: Export e Handoff (Step 14) -->
			<div class="topbar-actions-group">
				<button
					type="button"
					class="btn-topbar-action"
					onclick={() => openExportDialog()}
					title={m.ui_labview_esporta_questa_revisione_come_progetto_react_autonomo_f654()}
					aria-label={m.ui_labview_esporta_progetto_autonomo_6ab6()}
				>
					<IconDownload />
					<span>{m.lab_export_btn()}</span>
				</button>

				{#if !isDraft}
					<button
						type="button"
						class="btn-topbar-action handoff"
						onclick={() => openHandoffDialog()}
						title={m.ui_labview_consegna_questa_revisione_alla_sessione_principale_del_2230()}
						aria-label={m.ui_labview_consegna_alla_sessione_principale_6523()}
					>
						<IconArrowRight />
						<span>{m.lab_handoff_btn()}</span>
					</button>
				{/if}
			</div>

			<!-- Toggle Inspector Tabs: Codice, Revisioni, Contesto, Subagenti -->
			<div class="inspector-tabs-group" role="tablist" aria-label="Pannelli di approfondimento">
				<button
					type="button"
					role="tab"
					class="tab-btn"
					class:active={activeInspectorTab === 'code'}
					aria-selected={activeInspectorTab === 'code'}
					onclick={() =>
						(activeInspectorTab = activeInspectorTab === 'code' ? 'none' : 'code')}
					title="Sorgenti React e configurazione del prototipo"
				>
					<IconViewCode />
					<span>{m.lab_tab_code()}</span>
				</button>

				<button
					type="button"
					role="tab"
					class="tab-btn"
					class:active={activeInspectorTab === 'revisions'}
					aria-selected={activeInspectorTab === 'revisions'}
					onclick={() =>
						(activeInspectorTab = activeInspectorTab === 'revisions' ? 'none' : 'revisions')}
					title="Storico delle revisioni e ripristino"
				>
					<IconHistory />
					<span>Revisioni ({revisions.length})</span>
				</button>

				<button
					type="button"
					role="tab"
					class="tab-btn"
					class:active={activeInspectorTab === 'context'}
					aria-selected={activeInspectorTab === 'context'}
					onclick={() =>
						(activeInspectorTab = activeInspectorTab === 'context' ? 'none' : 'context')}
					title={m.ui_labview_contesto_stabile_e_drift_del_progetto_a3d0()}
				>
					<IconContextWindow />
					<span>{m.lab_tab_context()}</span>
				</button>

				<button
					type="button"
					role="tab"
					class="tab-btn"
					class:active={activeInspectorTab === 'subagents'}
					aria-selected={activeInspectorTab === 'subagents'}
					onclick={() =>
						(activeInspectorTab = activeInspectorTab === 'subagents' ? 'none' : 'subagents')}
					title="Attivita dei subagenti autori e ricercatori"
				>
					<IconSubagents />
					<span>Subagenti ({plannedSubagents.length})</span>
				</button>
			</div>

			<!-- Pulsante chiusura / uscita vista -->
			<button
				type="button"
				class="btn-close-lab"
				onclick={onClose || onBackToMain}
				title={m.lab_close_lab()}
				aria-label={m.ui_labview_chiudi_laboratorio_8177()}
			>
				<IconClose />
			</button>
		</div>
	</header>

	<!-- TOAST NOTIFICHE RAPIDE -->
	{#if flashToast}
		<div class="lab-toast" role="status" aria-live="polite">
			<IconCheck />
			<span>{flashToast}</span>
		</div>
	{/if}

	<!-- AREA CENTRALE: ANTEPRIMA DOMINANTE + CHAT ACCANTO -->
	<div class="lab-workspace">
		<!-- COLONNA ANTEPRIMA DOMINANTE -->
		<section class="preview-stage-container" aria-label="Area di anteprima dominante">
			<!-- TOOLBAR VISUALE INTEGRATA (Step 10) -->
			{#if visualTools}
				<LabVisualToolbar
					{visualTools}
					{observedRevisionId}
					onSendAttachment={handleVisualAttachment}
				/>
			{/if}

			<!-- CANVAS ANTEPRIMA CON ISOLAMENTO TEMA -->
			<div class="canvas-wrapper">
				<!-- Controlli del canvas (Sfondo isolato per non imporre il tema di Studio) -->
				<div class="canvas-controls" role="toolbar" aria-label="Controlli superficie prototipo">
					<span class="control-label">{m.lab_bg_label()}</span>
					<div class="theme-toggle-group">
						<button
							type="button"
							class="theme-btn"
							class:active={canvasTheme === 'light'}
							onclick={() => {
								canvasTheme = 'light';
								void compileAndRender();
							}}
						>Chiaro</button>
						<button
							type="button"
							class="theme-btn"
							class:active={canvasTheme === 'dark'}
							onclick={() => {
								canvasTheme = 'dark';
								void compileAndRender();
							}}
						>Scuro</button>
						<button
							type="button"
							class="theme-btn"
							class:active={canvasTheme === 'neutral'}
							onclick={() => {
								canvasTheme = 'neutral';
								void compileAndRender();
							}}
						>Neutro</button>
					</div>

					{#if activeSelection}
						<div class="selection-pill">
							<span class="tag">&lt;{activeSelection.element.tagName}&gt;</span>
							<span class="sel">{activeSelection.element.selector}</span>
						</div>
					{/if}

					<button
						type="button"
						class="btn-recompile"
						disabled={isCompiling}
						onclick={compileAndRender}
						title="Ricompila bundle React e Tailwind"
					>
						<IconRefresh />
						<span>{isCompiling ? m.lab_compiling_btn() : m.lab_reload_btn()}</span>
					</button>
				</div>

				<!-- STAGE DI RENDERING RESPONSIVO -->
				<div class="stage-viewport-surface" style:background="var(--bg-sunken)">
					{#if compileError}
						<div class="compile-error-card" role="alert">
							<div class="error-header">
								<IconWarning />
								<h4>{m.ui_labview_errore_durante_la_compilazione_del_prototipo_dc67()}</h4>
							</div>
							<pre class="error-pre">{compileError}</pre>
							<button type="button" class="btn-retry" onclick={compileAndRender}>
								<IconRefresh /> {m.ui_labview_riprova_compilazione_4377()}
							</button>
						</div>
					{:else}
						<div
							class="viewport-frame"
							style:width={currentViewport.width ? `${currentViewport.width}px` : '100%'}
							style:max-width="100%"
							style:height={currentViewport.height ? `${currentViewport.height}px` : '100%'}
						>
							{#if isCompiling}
								<div class="compiling-overlay">
									<div class="spinner"></div>
									<p>{m.ui_labview_compilazione_bundle_react_19_e_tailwind_v4_a44a()}</p>
								</div>
							{/if}

							<iframe
								bind:this={iframeEl}
								title="Anteprima {activePrototype?.manifest.title || 'Prototipo'}"
								srcdoc={previewHtml}
								class="preview-iframe"
								sandbox="allow-scripts allow-forms allow-same-origin"
							></iframe>
						</div>
					{/if}
				</div>
			</div>
		</section>

		<!-- COLONNA CHAT DEL PROTOTIPO ACCANTO -->
		<aside class="prototype-chat-column" aria-label="Chat dedicata del prototipo">
			<header class="chat-header">
				<div class="chat-title-wrap">
					<IconSparkles />
					<div class="chat-titles">
						<h3>Chat: {activePrototype?.manifest.title || 'Prototipo'}</h3>
						<p title={activePrototype?.manifest.brief || ''}>{activePrototype?.manifest.brief || 'Itera e perfeziona questo componente frontend'}</p>
					</div>
				</div>
				<span class="session-scope-badge">{m.ui_labview_sessione_lab_2c09()}</span>
			</header>

			<!-- TRANSCRIPT MESSAGGI -->
			<div class="chat-transcript">
				{#each chatMessages as msg (msg.id)}
					<div class="chat-bubble {msg.sender}">
						<div class="bubble-header">
							<span class="bubble-author">{msg.sender === 'user' ? 'Tu' : m.ui_labview_laboratorio_ai_9649()}</span>
							<span class="bubble-time">{i18n.formatDate(msg.timestamp, { hour: '2-digit', minute: '2-digit' })}</span>
						</div>

						<div class="bubble-content">
							<p>{msg.text}</p>

							{#if msg.attachment}
								<div class="attachment-chip">
									<span class="chip-badge">Annotazione</span>
									<span class="chip-elem">&lt;{msg.attachment.element?.tagName || 'elemento'}&gt;</span>
									<span class="chip-rev">({msg.attachment.revisionId})</span>
								</div>
							{/if}
						</div>
					</div>
				{/each}

				{#if isGenerating}
					<div class="chat-bubble assistant generating">
						<div class="bubble-header">
							<span class="bubble-author">{m.ui_labview_laboratorio_ai_9649()}</span>
							<span class="bubble-time">elaborazione...</span>
						</div>
						<div class="bubble-content">
							<div class="typing-indicator">
								<span></span><span></span><span></span>
							</div>
							<span class="typing-label">{m.ui_labview_iterazione_e_aggiornamento_prototipo_in_corso_78de()}</span>
						</div>
					</div>
				{/if}
			</div>

			<!-- ATTACHMENT IN SOSPESO -->
			{#if pendingAttachment}
				<div class="pending-attachment-card">
					<div class="card-head">
						<span class="label">Allegato visivo in preparazione:</span>
						<button
							type="button"
							class="btn-remove-att"
							onclick={() => (pendingAttachment = null)}
						>
							<IconClose />
						</button>
					</div>
					<div class="card-body">
						<code>&lt;{pendingAttachment.element?.tagName || 'elemento'}&gt; ({pendingAttachment.element?.selector || ''})</code>
						<p class="comment">"{pendingAttachment.comment || ''}"</p>
					</div>
				</div>
			{/if}

			<!-- COMPOSER INPUT CHAT -->
			<footer class="chat-composer">
				<textarea
					bind:value={chatInput}
					placeholder={m.lab_chat_placeholder()}
					rows={3}
					onkeydown={(e) => {
						if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
							e.preventDefault();
							void handleSendMessage();
						}
					}}
				></textarea>

				<div class="composer-actions">
					<span class="hint">Ctrl+Invio per inviare</span>
					<button
						type="button"
						class="btn-send-chat"
						disabled={isGenerating || (!chatInput.trim() && !pendingAttachment)}
						onclick={handleSendMessage}
					>
						<IconSend />
						<span>{m.ui_labview_invia_all_agente_c5f8()}</span>
					</button>
				</div>
			</footer>
		</aside>

		<!-- INSPECTOR LATERALE A COMPARSA (NON OCCUPA SEMPRE SPAZIO) -->
		{#if activeInspectorTab !== 'none'}
			<aside class="inspector-drawer" aria-label="Approfondimenti prototipo">
				<header class="drawer-header">
					<h4>
						{#if activeInspectorTab === 'code'}
							Sorgenti e Codice
						{:else if activeInspectorTab === 'revisions'}
							Storico Revisioni
						{:else if activeInspectorTab === 'context'}
							Contesto Stabile
						{:else if activeInspectorTab === 'subagents'}
							Attivita Subagenti
						{/if}
					</h4>
					<button
						type="button"
						class="btn-close-drawer"
						onclick={() => (activeInspectorTab = 'none')}
						aria-label={m.ui_labview_chiudi_pannello_c33c()}
					>
						<IconClose />
					</button>
				</header>

				<div class="drawer-content">
					<!-- TAB 1: CODICE -->
					{#if activeInspectorTab === 'code'}
						<div class="code-tab-layout">
							<div class="code-file-list">
								{#each Object.keys(prototypeFiles) as f (f)}
									<button
										type="button"
										class="file-item-btn"
										class:active={selectedFileForViewing === f}
										onclick={() => {
											selectedFileForViewing = f;
											selectedFileContent = prototypeFiles[f];
										}}
									>
										{f}
									</button>
								{/each}
							</div>

							<div class="code-viewer-pane">
								<div class="pane-bar">
									<span class="viewing-filename">{selectedFileForViewing}</span>
									<button type="button" class="btn-copy" onclick={handleCopyCode}>
										<IconCopy /> {copyFeedback ? 'Copiato!' : m.context_menu_item_copy()}
									</button>
								</div>
								<pre class="code-pre"><code>{selectedFileContent}</code></pre>
							</div>
						</div>

					<!-- TAB 2: REVISIONI -->
					{:else if activeInspectorTab === 'revisions'}
						<div class="revisions-tab-layout">
							{#if revisions.length === 0}
								<p class="empty-msg">{m.ui_labview_nessuna_revisione_registrata_bb1b()}</p>
							{:else}
								<div class="revisions-list">
									{#each revisions as rev (rev.revision.id)}
										<div class="rev-card" class:active={observedRevisionId === rev.revision.id}>
											<div class="rev-meta">
												<strong class="rev-id">{rev.revision.id}</strong>
												<span class="rev-state state-{rev.revision.state}">{rev.revision.state}</span>
												<span class="rev-time">{i18n.formatDate(rev.revision.createdAt, { hour: '2-digit', minute: '2-digit' })}</span>
											</div>
											<p class="rev-summary">{rev.summary || m.ui_labview_nessuna_descrizione_9f94()}</p>

											<div class="rev-actions">
												{#if observedRevisionId !== rev.revision.id}
													<button
														type="button"
														class="btn-rev-action"
														onclick={() => {
															observedRevisionId = rev.revision.id;
															void compileAndRender();
														}}
													>Osserva</button>
												{/if}
												<button
													type="button"
													class="btn-rev-action restore"
													onclick={() => handleRestoreRevision(rev)}
												>
													<IconUndo /> {m.topbar_win_restore()}
												</button>
												<button
													type="button"
													class="btn-rev-action export"
													onclick={() => openExportDialog(rev.revision.id)}
													title={m.ui_labview_esporta_questa_revisione_in_una_cartella_8873()}
												>
													<IconDownload /> {m.lab_export_btn()}
												</button>
												{#if !isDraft}
													<button
														type="button"
														class="btn-rev-action handoff"
														onclick={() => openHandoffDialog(rev.revision.id)}
														title={m.ui_labview_consegna_questa_revisione_all_agente_principale_4c95()}
													>
														<IconArrowRight /> {m.lab_handoff_btn()}
													</button>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>

					<!-- TAB 3: CONTESTO PROGETTO -->
					{:else if activeInspectorTab === 'context'}
						<LabContextPanel
							snapshot={contextSnapshot}
							onRefreshContext={() => {
								showToast(m.ui_labview_contesto_progetto_aggiornato_f310());
							}}
						/>

					<!-- TAB 4: SUBAGENTI -->
					{:else if activeInspectorTab === 'subagents'}
						<div class="subagents-tab-layout">
							<div class="subagents-intro">
								<p>I subagenti autori operano su fette isolate del prototipo con confini di scrittura rigorosamente delimitati.</p>
							</div>

							<div class="subagents-list">
								{#each plannedSubagents as sub (sub.name)}
									<div class="subagent-card">
										<div class="sub-head">
											<strong class="sub-name">{sub.name}</strong>
											<span class="sub-role">{sub.role} ({sub.targetSlice})</span>
										</div>
										<div class="sub-details">
											<p><strong>{m.ui_labview_file_assegnato_179d()}</strong> <code>{sub.assignedFilePath}</code></p>
											<p><strong>Direzione:</strong> {sub.visualDirection}</p>
											<p><strong>Requisiti contratto:</strong> {sub.contractRequirements}</p>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</aside>
		{/if}
	</div>

	<!-- MODAL DIALOG ELENCO PROTOTIPI / NUOVO PROTOTIPO -->
	{#if showPrototypeDialog}
		<div
			class="modal-backdrop"
			role="presentation"
			onclick={() => (showPrototypeDialog = false)}
			onkeydown={(e) => {
				if (e.key === 'Escape') showPrototypeDialog = false;
			}}
		>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="modal-card"
				role="dialog"
				aria-modal="true"
				tabindex="-1"
				aria-label="Gestione prototipi"
				onclick={(e) => e.stopPropagation()}
			>
				<header class="dialog-header">
					<div class="dialog-tabs">
						<button
							type="button"
							class="dialog-tab"
							class:active={dialogMode === 'list'}
							onclick={() => (dialogMode = 'list')}
						>Prototipi Esistenti ({prototypes.length})</button>
						<button
							type="button"
							class="dialog-tab"
							class:active={dialogMode === 'create'}
							onclick={() => (dialogMode = 'create')}
						>{m.ui_labview_nuovo_prototipo_742b()}</button>
					</div>
					<button
						type="button"
						class="btn-close-dialog"
						onclick={() => (showPrototypeDialog = false)}
					>
						<IconClose />
					</button>
				</header>

				<div class="dialog-body">
					{#if dialogMode === 'list'}
						{#if gitignoreInspection && gitignoreInspection.status === 'automated_legacy'}
							<div class="gitignore-banner legacy">
								<span class="banner-icon">⚠️</span>
								<div class="banner-text">
									<strong>Esclusione Git legacy attiva:</strong>
									<span>{m.ui_labview_la_vecchia_regola_in_gitignore_esclude_tutta_1d00()} <code>proto/</code>. I nuovi prototipi non vengono tracciati da Git.</span>
								</div>
								<button
									type="button"
									class="btn-sm btn-migrate"
									onclick={handleMigrateGitignore}
									disabled={gitignoreMigrating}
								>
									{gitignoreMigrating ? 'Migrazione...' : 'Rendi prototipi versionabili'}
								</button>
							</div>
						{:else if gitignoreInspection && gitignoreInspection.status === 'migrated_versionable'}
							<div class="gitignore-banner migrated">
								<span class="banner-icon">✓</span>
								<div class="banner-text">
									<strong>Git attivo:</strong>
									<span>I prototipi in <code>proto/&lt;id&gt;/</code> sono versionabili in Git. I vecchi HTML restano esclusi.</span>
								</div>
								<button
									type="button"
									class="btn-sm btn-rollback"
									onclick={handleRollbackGitignore}
									disabled={gitignoreMigrating}
									title={m.ui_labview_ripristina_l_esclusione_totale_di_proto_in_6096()}
								>
									{gitignoreMigrating ? '...' : m.ui_labview_ripristina_esclusione_386e()}
								</button>
							</div>
						{/if}
						{#if prototypes.length === 0}
							<div class="empty-dialog">
								<p>{m.ui_labview_nessun_prototipo_trovato_per_questo_percorso_8351()}</p>
								<button
									type="button"
									class="btn-primary"
									onclick={() => (dialogMode = 'create')}
								>{m.ui_labview_crea_il_primo_prototipo_b2a2()}</button>
							</div>
						{:else}
							<div class="proto-grid">
								{#each prototypes as p (p.id)}
									<div class="proto-row" class:active={activePrototype?.id === p.id}>
										<div class="row-info">
											<h4>{p.manifest.title}</h4>
											<span class="row-id">{p.id}</span>
											<p class="row-brief">{p.manifest.brief}</p>
										</div>
										<button
											type="button"
											class="btn-open-proto"
											onclick={() => selectPrototype(p.id)}
										>
											{activePrototype?.id === p.id ? 'Attivo' : 'Apri'}
										</button>
									</div>
								{/each}
							</div>
						{/if}
						{#if legacyPrototypes.length > 0}
							<div class="legacy-section">
								<h4>Prototipi HTML Legacy ({legacyPrototypes.length})</h4>
								<p class="legacy-desc">
									Prototipi generati dal vecchio comportamento di <code>studio_preview</code>. Restano leggibili e apribili senza perdita.
								</p>
								<div class="proto-grid legacy-grid">
									{#each legacyPrototypes as leg (leg.id)}
										<div class="proto-row legacy-row">
											<div class="row-info">
												<h4>{leg.title}</h4>
												<span class="row-id">{leg.relativePath}</span>
												<span class="legacy-badge">HTML Legacy</span>
											</div>
											<div class="legacy-actions">
												<button
													type="button"
													class="btn-open-proto"
													onclick={async () => {
														const content = await readLegacyPrototype(host, leg.id, store);
														if (content) {
															previewHtml = content.rawHtml;
															showPrototypeDialog = false;
															showToast(`Prototipo legacy '${leg.title}' aperto in anteprima.`);
														}
													}}
												>
													{m.file_tree_menu_open()}
												</button>
												<button
													type="button"
													class="btn-secondary btn-reconstruct"
													onclick={() => startReconstructLegacy(leg)}
													title={m.ui_labview_crea_una_nuova_proposta_react_ispirata_a_bcca()}
												>
													Ricostruisci in React
												</button>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					{:else}
						<!-- FORM NUOVO PROTOTIPO -->
						<form class="create-form" onsubmit={(e) => { e.preventDefault(); void handleCreatePrototype(); }}>
							{#if creationError}
								<div class="creation-error" role="alert">{creationError}</div>
							{/if}

							<div class="form-group">
								<label for="proto-title">Titolo del prototipo</label>
								<input
									id="proto-title"
									type="text"
									bind:value={newProtoTitle}
									placeholder="es. Tabella pratiche PSR - Varianti"
									required
								/>
							</div>

							<div class="form-group">
								<label for="proto-brief">Brief e Obiettivi</label>
								<textarea
									id="proto-brief"
									bind:value={newProtoBrief}
									rows={3}
									placeholder="Descrivi cosa deve fare o rappresentare il componente..."
									required
								></textarea>
							</div>

							<div class="form-group">
								<label for="proto-target">Tipologia</label>
								<select id="proto-target" bind:value={newProtoTarget}>
									<option value="component_variants">Confronto 3-5 Varianti di Componente</option>
									<option value="multi_screen_flow">Flusso UX a piu schermate</option>
									<option value="single_component">Singolo Componente Autonomo</option>
									<option value="free_scratchpad">Idea Libera / Scratchpad</option>
								</select>
							</div>

							<div class="form-group">
								<label for="proto-strategy">Strategia iniziale</label>
								<select id="proto-strategy" bind:value={newProtoStrategy}>
									<option value="proceed_immediately">Procedi subito (generazione rapida)</option>
									<option value="deep_investigation">Approfondisci contesto (analisi dettagliata)</option>
								</select>
							</div>

							<div class="dialog-actions">
								<button
									type="button"
									class="btn-secondary"
									onclick={() => (showPrototypeDialog = false)}
								>{m.common_cancel()}</button>
								<button
									type="submit"
									class="btn-primary"
									disabled={isCreatingPrototype}
								>
									{isCreatingPrototype ? m.ui_labview_creazione_in_corso_8bc8() : m.ui_labview_crea_prototipo_dfde()}
								</button>
							</div>
						</form>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- MODAL DIALOG ESPORTAZIONE AUTONOMA (Step 14) -->
	{#if showExportDialog}
		<div
			class="modal-backdrop"
			role="presentation"
			onclick={() => (showExportDialog = false)}
			onkeydown={(e) => {
				if (e.key === 'Escape') showExportDialog = false;
			}}
		>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="modal-dialog export-dialog"
				role="dialog"
				tabindex="-1"
				aria-label={m.ui_labview_esporta_progetto_autonomo_25e6()}
				onclick={(e) => e.stopPropagation()}
			>
				<header class="dialog-header">
					<h3>{m.ui_labview_esporta_progetto_autonomo_react_tailwind_v4_1e7b()}</h3>
					<button
						type="button"
						class="btn-close-dialog"
						onclick={() => (showExportDialog = false)}
						aria-label={m.settings_close_window()}
					>
						<IconClose />
					</button>
				</header>

				<div class="dialog-body">
					{#if exportResult}
						<div class="export-success-box">
							<div class="success-header">
								<IconCheck />
								<h4>{m.ui_labview_progetto_esportato_con_successo_6b7b()}</h4>
							</div>
							<p class="export-path-note">
								{m.ui_labview_cartella_di_destinazione_d963()} <code>{exportResult.destinationPath}</code>
							</p>
							<div class="exported-files-summary">
								<span class="summary-label">{m.ui_labview_file_generati_80eb()}{exportResult.exportedFiles.length}):</span>
								<ul class="files-list">
									{#each exportResult.exportedFiles as f}
										<li><code>{f}</code></li>
									{/each}
								</ul>
							</div>
							<div class="export-instructions">
								<p>{m.ui_labview_il_progetto_e_pronto_per_essere_eseguito_af2b()}</p>
								<pre class="cmd-snippet"><code>cd {exportResult.destinationPath}
npm install
npm run dev</code></pre>
							</div>
							<div class="dialog-actions">
								<button
									type="button"
									class="btn-primary"
									onclick={() => (showExportDialog = false)}
								>{m.page_modal_restart_btn_close()}</button>
							</div>
						</div>
					{:else}
						<form
							class="create-form"
							onsubmit={(e) => {
								e.preventDefault();
								void handleRunExport();
							}}
						>
							{#if exportError}
								<div class="error-banner" role="alert">
									<IconWarning />
									<span>{exportError}</span>
								</div>
							{/if}

							<div class="form-group">
								<label for="export-rev-id">Revisione da esportare</label>
								<select id="export-rev-id" bind:value={exportRevisionId}>
									{#each revisions as rev}
										<option value={rev.revision.id}>
											{rev.revision.id} ({rev.revision.state}) — {rev.summary || 'Senza descrizione'}
										</option>
									{/each}
								</select>
							</div>

							<div class="form-group">
								<label for="export-dest-path">{m.ui_labview_cartella_di_destinazione_2cd6()}</label>
								<input
									id="export-dest-path"
									type="text"
									bind:value={exportDestinationPath}
									placeholder={m.ui_labview_es_c_progetti_mio_componente_react_40ac()}
									required
								/>
								<span class="field-hint">
									{m.ui_labview_verra_generato_un_progetto_react_ordinario_con_9adf()}
								</span>
							</div>

							<div class="form-group-checkbox">
								<label class="checkbox-label">
									<input
										type="checkbox"
										bind:checked={exportOverwrite}
									/>
									<span>{m.ui_labview_sovrascrivi_file_se_la_cartella_di_destinazione_3e5b()}</span>
								</label>
							</div>

							<div class="dialog-actions">
								<button
									type="button"
									class="btn-secondary"
									onclick={() => (showExportDialog = false)}
								>{m.common_cancel()}</button>
								<button
									type="submit"
									class="btn-primary"
									disabled={isExporting}
								>
									{isExporting ? m.ui_labview_esportazione_in_corso_32c5() : m.ui_labview_esporta_progetto_b834()}
								</button>
							</div>
						</form>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- MODAL DIALOG CONSEGNA AL PRINCIPALE (HANDOFF) (Step 14) -->
	{#if showHandoffDialog}
		<div
			class="modal-backdrop"
			role="presentation"
			onclick={() => (showHandoffDialog = false)}
			onkeydown={(e) => {
				if (e.key === 'Escape') showHandoffDialog = false;
			}}
		>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="modal-dialog handoff-dialog"
				role="dialog"
				tabindex="-1"
				aria-label="Consegna Prototipo al Principale"
				onclick={(e) => e.stopPropagation()}
			>
				<header class="dialog-header">
					<h3>Consegna al Principale (Handoff)</h3>
					<button
						type="button"
						class="btn-close-dialog"
						onclick={() => (showHandoffDialog = false)}
						aria-label={m.settings_close_window()}
					>
						<IconClose />
					</button>
				</header>

				<div class="dialog-body">
					{#if handoffResult}
						<div class="handoff-success-box">
							<div class="success-header">
								<IconCheck />
								<h4>Riferimento stabile consegnato con successo!</h4>
							</div>
							<p class="handoff-note">{handoffResult.message}</p>
							<div class="handoff-rules-summary">
								<span class="summary-label">Garanzie osservate:</span>
								<ul>
									<li>{m.ui_labview_nessun_auto_merge_implicito_nel_codice_del_c048()}</li>
									<li>Il prototipo in <code>proto/{activePrototype?.id}</code> rimane intatto.</li>
									<li>{m.ui_labview_l_agente_principale_adattera_la_soluzione_nello_8309()}</li>
								</ul>
							</div>
							<div class="dialog-actions">
								<button
									type="button"
									class="btn-primary"
									onclick={() => (showHandoffDialog = false)}
								>{m.page_modal_restart_btn_close()}</button>
							</div>
						</div>
					{:else}
						<form
							class="create-form"
							onsubmit={(e) => {
								e.preventDefault();
								void handleDeliverHandoff();
							}}
						>
							{#if handoffError}
								<div class="error-banner" role="alert">
									<IconWarning />
									<span>{handoffError}</span>
								</div>
							{/if}

							<div class="info-banner">
								<p>
									{m.ui_labview_prepara_un_riferimento_stabile_brief_sorgenti_dipendenze_eb95()}
								</p>
							</div>

							<div class="form-group">
								<label for="handoff-rev-id">Revisione da consegnare</label>
								<select
									id="handoff-rev-id"
									bind:value={handoffRevisionId}
									onchange={() => void updateHandoffPreview()}
								>
									{#each revisions as rev}
										<option value={rev.revision.id}>
											{rev.revision.id} ({rev.revision.state}) — {rev.summary || 'Senza descrizione'}
										</option>
									{/each}
								</select>
							</div>

							<div class="form-group">
								<label for="handoff-variant">Variante (opzionale)</label>
								<input
									id="handoff-variant"
									type="text"
									bind:value={handoffVariant}
									oninput={() => void updateHandoffPreview()}
									placeholder="es. C, Densa, Card, Flusso..."
								/>
								<span class="field-hint">Se hai selezionato o iterato una specifica variante, indicala qui.</span>
							</div>

							{#if handoffPackagePreview}
								<div class="handoff-preview-card">
									<span class="preview-title">Anteprima pacchetto riferimento:</span>
									<div class="preview-item">
										<strong>Brief:</strong>
										<span class="brief-text">{handoffPackagePreview.brief}</span>
									</div>
									<div class="preview-item">
										<strong>Limiti simulazione ({handoffPackagePreview.simulationLimits.length}):</strong>
										<ul class="limits-list">
											{#each handoffPackagePreview.simulationLimits as lim}
												<li>{lim}</li>
											{/each}
										</ul>
									</div>
									<div class="preview-item">
										<strong>{m.ui_labview_file_inclusi_4b2c()}</strong>
										<span>{Array.from(handoffPackagePreview.files.keys()).filter(p => !p.endsWith('.json') && !p.endsWith('.md')).join(', ')}</span>
									</div>
								</div>
							{/if}

							<div class="dialog-actions">
								<button
									type="button"
									class="btn-secondary"
									onclick={() => (showHandoffDialog = false)}
								>{m.common_cancel()}</button>
								<button
									type="submit"
									class="btn-primary"
									disabled={isDeliveringHandoff}
								>
									{isDeliveringHandoff ? m.ui_labview_consegna_in_corso_b854() : 'Consegna al Principale'}
								</button>
							</div>
						</form>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* ROOT DELLA VISTA LABORATORIO */
	.lab-root {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100vh;
		background: var(--bg-base);
		color: var(--ink);
		font-family: var(--font-sans);
		overflow: hidden;
		position: relative;
	}

	/* HEADER DELLA VISTA */
	.lab-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 48px;
		padding: 0 var(--space-3);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
		gap: var(--space-3);
		z-index: var(--z-sticky);
	}

	.topbar-left {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.lab-logo {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--brand-ink);
		font-size: var(--text-sm);
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.location-chip {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	.location-badge {
		font-weight: 600;
		text-transform: uppercase;
		font-size: 10px;
		padding: 1px 4px;
		border-radius: 2px;
	}

	.location-badge.project {
		background: color-mix(in srgb, var(--brand) 20%, transparent);
		color: var(--brand-ink);
	}

	.location-badge.draft {
		background: color-mix(in srgb, var(--warn) 20%, transparent);
		color: var(--warn);
	}

	.location-name {
		color: var(--ink-muted);
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.btn-proto-select {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 4px 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		color: var(--ink);
		cursor: pointer;
		font-size: var(--text-xs);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.btn-proto-select:hover {
		background: var(--bg-hover);
	}

	.proto-label {
		color: var(--ink-faint);
	}

	.proto-title {
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.proto-badge {
		background: var(--bg-active);
		padding: 1px 6px;
		border-radius: var(--radius-full);
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-muted);
	}

	/* INDICATORE PRINCIPALE CON PASSAGGIO RAPIDO */
	.topbar-center {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.main-agent-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 4px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.main-agent-indicator.working {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 8%, var(--bg-sunken));
	}

	.agent-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ink-faint);
	}

	.main-agent-indicator.working .agent-dot {
		background: var(--brand);
		box-shadow: 0 0 8px var(--brand);
		animation: pulse-dot 1.8s infinite var(--ease-in-out);
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.4; transform: scale(0.8); }
	}

	.btn-switch-main {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: all var(--dur-fast) var(--ease-out);
	}

	.btn-switch-main:hover {
		background: var(--bg-hover);
		color: var(--brand-ink);
		border-color: var(--brand);
	}

	/* GRUPPO TAB INSPECTOR */
	.topbar-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.inspector-tabs-group {
		display: flex;
		align-items: center;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 2px;
		gap: 2px;
	}

	.tab-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: all var(--dur-fast) var(--ease-out);
	}

	.tab-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.tab-btn.active {
		background: var(--bg-active);
		color: var(--brand-ink);
		font-weight: 600;
	}

	.btn-close-lab {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		transition: all var(--dur-fast) var(--ease-out);
	}

	.btn-close-lab:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	/* WORKSPACE: ANTEPRIMA + CHAT */
	.lab-workspace {
		display: flex;
		flex: 1;
		width: 100%;
		height: calc(100vh - 48px);
		overflow: hidden;
		position: relative;
	}

	/* COLONNA ANTEPRIMA DOMINANTE */
	.preview-stage-container {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: 100%;
		background: var(--bg-sunken);
		border-right: 1px solid var(--line);
		position: relative;
	}

	.canvas-wrapper {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		position: relative;
	}

	.canvas-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px var(--space-3);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-xs);
		gap: var(--space-2);
		z-index: var(--z-sticky);
	}

	.control-label {
		color: var(--ink-faint);
	}

	.theme-toggle-group {
		display: flex;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px;
	}

	.theme-btn {
		background: transparent;
		border: none;
		padding: 2px 8px;
		font-size: 11px;
		color: var(--ink-muted);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.theme-btn.active {
		background: var(--bg-active);
		color: var(--ink);
		font-weight: 600;
	}

	.selection-pill {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		border: 1px solid var(--brand);
		border-radius: var(--radius-full);
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.selection-pill .tag {
		color: var(--brand-ink);
		font-weight: 700;
	}

	.selection-pill .sel {
		color: var(--ink);
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.btn-recompile {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		font-size: 11px;
	}

	.btn-recompile:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.stage-viewport-surface {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		min-height: 0;
		padding: var(--space-3);
		overflow: auto;
	}

	.viewport-frame {
		height: 100%;
		box-shadow: var(--shadow-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
		position: relative;
		background: #ffffff;
		transition: width var(--dur-base) var(--ease-out);
	}

	.preview-iframe {
		width: 100%;
		height: 100%;
		border: none;
		display: block;
	}

	.compiling-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(2px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		color: var(--ink);
		font-size: var(--text-sm);
		z-index: 10;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--brand-ink);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.compile-error-card {
		max-width: 680px;
		background: var(--bg-raised);
		border: 1px solid var(--warn);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		color: var(--ink);
	}

	.error-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--warn);
		margin-bottom: var(--space-2);
	}

	.error-pre {
		background: var(--bg-sunken);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow: auto;
		max-height: 240px;
		color: var(--ink-muted);
	}

	.btn-retry {
		margin-top: var(--space-3);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		background: var(--bg-active);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		cursor: pointer;
	}

	/* COLONNA CHAT DEL PROTOTIPO ACCANTO */
	.prototype-chat-column {
		width: 420px;
		min-width: 340px;
		max-width: 480px;
		height: 100%;
		background: var(--bg-base);
		border-left: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}

	.chat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.chat-title-wrap {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--brand-ink);
		min-width: 0;
	}

	.chat-titles h3 {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chat-titles p {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.session-scope-badge {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 2px 6px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		color: var(--ink-muted);
	}

	.chat-transcript {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.chat-bubble {
		display: flex;
		flex-direction: column;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		max-width: 90%;
		word-break: break-word;
	}

	.chat-bubble.user {
		align-self: flex-end;
		background: color-mix(in srgb, var(--brand) 18%, var(--bg-raised));
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
		color: var(--ink);
	}

	.chat-bubble.assistant {
		align-self: flex-start;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		color: var(--ink);
	}

	.bubble-header {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		color: var(--ink-faint);
		margin-bottom: 4px;
	}

	.bubble-author {
		font-weight: 600;
	}

	.attachment-chip {
		margin-top: 6px;
		padding: 3px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
		display: flex;
		gap: 4px;
	}

	.chip-badge {
		color: var(--brand-ink);
		font-weight: 600;
	}

	.chip-elem {
		color: var(--ink);
	}

	.chip-rev {
		color: var(--ink-faint);
	}

	.typing-indicator {
		display: flex;
		gap: 4px;
		margin-bottom: 4px;
	}

	.typing-indicator span {
		width: 6px;
		height: 6px;
		background: var(--brand-ink);
		border-radius: 50%;
		animation: typing 1.2s infinite ease-in-out;
	}

	.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
	.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

	@keyframes typing {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-4px); }
	}

	.typing-label {
		font-size: 11px;
		color: var(--ink-muted);
	}

	.pending-attachment-card {
		padding: var(--space-2) var(--space-3);
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-raised));
		border-top: 1px solid var(--brand);
		font-size: var(--text-xs);
	}

	.card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: var(--brand-ink);
		font-weight: 600;
	}

	.btn-remove-att {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
	}

	.chat-composer {
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.chat-composer textarea {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		padding: var(--space-2);
		resize: none;
		outline: none;
	}

	.chat-composer textarea:focus {
		border-color: var(--brand);
	}

	.composer-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.composer-actions .hint {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.btn-send-chat {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		background: var(--brand-dim);
		border: 1px solid var(--brand);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.btn-send-chat:hover:not(:disabled) {
		background: var(--brand);
	}

	.btn-send-chat:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* DRAWER INSPECTOR A COMPARSA */
	.inspector-drawer {
		position: absolute;
		right: 420px;
		top: 0;
		bottom: 0;
		width: 460px;
		background: var(--bg-overlay);
		border-left: 1px solid var(--line);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
	}

	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
	}

	.drawer-header h4 {
		font-size: var(--text-sm);
		font-weight: 600;
		margin: 0;
	}

	.btn-close-drawer {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
	}

	.drawer-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3);
	}

	/* CODICE */
	.code-tab-layout {
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: var(--space-2);
	}

	.code-file-list {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.file-item-btn {
		padding: 2px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: 11px;
		cursor: pointer;
	}

	.file-item-btn.active {
		border-color: var(--brand);
		color: var(--brand-ink);
		background: var(--bg-active);
	}

	.code-viewer-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 280px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.pane-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 8px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.btn-copy {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: 11px;
		cursor: pointer;
	}

	.code-pre {
		margin: 0;
		padding: var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow: auto;
		flex: 1;
		color: var(--ink);
	}

	/* REVISIONI */
	.revisions-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.rev-card {
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.rev-card.active {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-sunken));
	}

	.rev-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: 4px;
	}

	.rev-id {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink);
	}

	.rev-state {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: var(--radius-full);
		text-transform: uppercase;
	}

	.state-verified { background: #14532d; color: #86efac; }
	.state-rendering-ready { background: #1e3a8a; color: #93c5fd; }
	.state-failed { background: #7f1d1d; color: #fca5a5; }

	.rev-time {
		font-size: 10px;
		color: var(--ink-faint);
		margin-left: auto;
	}

	.rev-summary {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		margin: 0 0 var(--space-2) 0;
	}

	.rev-actions {
		display: flex;
		gap: var(--space-2);
	}

	.btn-rev-action {
		padding: 2px 8px;
		font-size: 11px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		cursor: pointer;
	}

	.btn-rev-action.restore {
		color: var(--brand-ink);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	/* SUBAGENTI */
	.subagents-tab-layout {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.subagents-intro p {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		margin: 0;
	}

	.subagent-card {
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
	}

	.sub-head {
		display: flex;
		justify-content: space-between;
		margin-bottom: 4px;
	}

	.sub-name {
		font-family: var(--font-mono);
		color: var(--brand-ink);
	}

	.sub-role {
		color: var(--ink-faint);
	}

	/* MODAL DIALOG */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-dialog);
		padding: var(--space-4);
	}

	.modal-card {
		width: 100%;
		max-width: 600px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
	}

	.dialog-tabs {
		display: flex;
		gap: 4px;
	}

	.dialog-tab {
		background: transparent;
		border: none;
		padding: 6px 12px;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.dialog-tab.active {
		background: var(--bg-active);
		color: var(--ink);
		font-weight: 600;
	}

	.btn-close-dialog {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
	}

	.dialog-body {
		padding: var(--space-4);
		max-height: 480px;
		overflow-y: auto;
	}

	.proto-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.proto-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.proto-row.active {
		border-color: var(--brand);
	}

	.row-info h4 {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.row-id {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
	}

	.row-brief {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		margin: 4px 0 0 0;
	}

	.btn-open-proto {
		padding: 6px 14px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		cursor: pointer;
	}


	/* BANNER GITIGNORE E PROTOTIPI LEGACY */
	.gitignore-banner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-3);
		font-size: var(--text-xs);
	}

	.gitignore-banner.legacy {
		background: rgba(234, 179, 8, 0.1);
		border: 1px solid rgba(234, 179, 8, 0.3);
		color: var(--ink);
	}

	.gitignore-banner.migrated {
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
		color: var(--ink);
	}

	.banner-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.btn-migrate {
		padding: 4px 10px;
		background: var(--brand);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		white-space: nowrap;
	}

	.btn-rollback {
		padding: 4px 10px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		color: var(--ink-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
		white-space: nowrap;
	}

	.legacy-section {
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--line);
	}

	.legacy-section h4 {
		margin: 0 0 4px 0;
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.legacy-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		margin: 0 0 var(--space-3) 0;
	}

	.legacy-badge {
		display: inline-block;
		font-size: 10px;
		padding: 1px 6px;
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		color: var(--ink-faint);
		margin-top: 4px;
	}

	.legacy-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.btn-reconstruct {
		padding: 6px 12px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.btn-reconstruct:hover {
		color: var(--ink);
		border-color: var(--brand);
	}
	/* FORM CREAZIONE */
	.create-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.form-group label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
	}

	.form-group input,
	.form-group textarea,
	.form-group select {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2);
		color: var(--ink);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		outline: none;
	}

	.form-group input:focus,
	.form-group textarea:focus,
	.form-group select:focus {
		border-color: var(--brand);
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.btn-primary {
		padding: 8px 18px;
		background: var(--brand-dim);
		border: 1px solid var(--brand);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-weight: 600;
		cursor: pointer;
	}

	.btn-secondary {
		padding: 8px 18px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
	}

	/* TOAST */
	.lab-toast {
		position: absolute;
		top: 60px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--bg-overlay);
		border: 1px solid var(--brand);
		border-radius: var(--radius-full);
		padding: 6px 16px;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink);
		font-size: var(--text-xs);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-toast);
	}

	/* TOPBAR ACTIONS GROUP (Step 14) */
	.topbar-actions-group {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-right: var(--space-2);
	}

	.btn-topbar-action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-topbar-action:hover {
		background: var(--bg-raised);
		border-color: var(--line-strong);
	}

	.btn-topbar-action.handoff {
		background: var(--brand-dim);
		border-color: var(--brand);
		color: var(--brand-ink, var(--ink));
	}

	.btn-topbar-action.handoff:hover {
		filter: brightness(1.05);
	}

	.btn-rev-action.export {
		background: var(--bg-sunken);
		color: var(--ink-muted);
	}

	.btn-rev-action.export:hover {
		background: var(--bg-raised);
		color: var(--ink);
	}

	.btn-rev-action.handoff {
		background: var(--brand-dim);
		border-color: var(--brand);
		color: var(--brand-ink, var(--ink));
	}

	.btn-rev-action.handoff:hover {
		filter: brightness(1.05);
	}

	/* MODAL EXPORT & HANDOFF */
	.export-dialog, .handoff-dialog {
		max-width: 580px;
	}

	.form-group-checkbox {
		display: flex;
		align-items: center;
		margin: var(--space-1) 0;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink);
		cursor: pointer;
	}

	.field-hint {
		font-size: 11px;
		color: var(--ink-faint);
		margin-top: 2px;
	}

	.info-banner {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.export-success-box, .handoff-success-box {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.success-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--state-ok);
	}

	.success-header h4 {
		margin: 0;
		font-size: var(--text-base);
		color: var(--ink);
	}

	.export-path-note, .handoff-note {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.exported-files-summary {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
	}

	.files-list {
		margin: 6px 0 0 0;
		padding-left: 18px;
		max-height: 120px;
		overflow-y: auto;
		font-size: 11px;
		color: var(--ink-muted);
	}

	.export-instructions {
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.cmd-snippet {
		margin: 6px 0 0 0;
		padding: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink);
	}

	.handoff-preview-card {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-xs);
	}

	.preview-title {
		font-weight: 600;
		color: var(--ink);
	}

	.preview-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.preview-item strong {
		color: var(--ink-muted);
		font-size: 11px;
	}

	.brief-text {
		color: var(--ink);
		font-style: italic;
	}

	.limits-list {
		margin: 4px 0 0 0;
		padding-left: 16px;
		color: var(--ink-faint);
		font-size: 11px;
	}

	.handoff-rules-summary ul {
		margin: 6px 0 0 0;
		padding-left: 16px;
		color: var(--ink-muted);
		font-size: var(--text-xs);
	}
</style>
