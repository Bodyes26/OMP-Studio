import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { projectStore, type Project } from './projects.svelte';
import { settingsStore } from './settings.svelte';
import { modelSettingsStore, STANDARD_ROLES, splitModelSelector } from './modelSettings.svelte';
import { quotaStore, providersMatch } from './quota.svelte';
import { parseProjectTasksFile, serializeProjectTasksFile, type StudioTask, type StudioTaskOptions } from './taskSerialization';
import { createDirectiveSnapshot } from './taskDirectives';
import { removeAttentionRequest, upsertAttentionRequest } from './companionAttention';
import type { ImageContent } from '$lib/agent/wire';

export interface RecentChatMessage {
	role: 'user' | 'assistant' | 'tool';
	text: string;
	timestamp?: number;
}

/**
 * Richiesta interattiva cosi' come viaggia verso la finestra companion.
 *
 * Ricalca i campi di `extension_ui_request` che servono a rispondere senza
 * tornare nella finestra principale: la domanda sta in `title` (con i
 * marcatori `(k/N)`), `message` e' il dettaglio facoltativo, `optionDetails`
 * porta le descrizioni delle opzioni e `placeholder`/`prefill` servono ai
 * metodi `input` ed `editor`, che si rispondono con testo libero.
 */
export interface PendingUiPayload {
	kind: string;
	requestId: string;
	title?: string;
	message?: string;
	options?: string[];
	optionDetails?: { description?: string }[];
	method?: 'select' | 'confirm' | 'input' | 'editor';
	placeholder?: string;
	prefill?: string;
	questions?: unknown[];
	questionIndex?: number;
	totalQuestions?: number;
	blockedQuota?: {
		reasonKind: 'quota_exhausted' | 'provider_error';
		rawError?: string;
		failedProvider?: string;
		failedModelId?: string;
		failedSelector?: string;
		suggestedModel?: {
			selector: string;
			modelName: string;
			roleLabel?: string;
			provider: string;
			modelId: string;
		} | null;
		availableRecoveryModels?: Array<{
			selector: string;
			modelName: string;
			roleLabel?: string;
			provider: string;
			modelId: string;
		}>;
	};
}

export interface AttentionRequest {
	projectId: string;
	projectName: string;
	projectHue: number;
	modelName?: string;
	recentMessages: RecentChatMessage[];
	pendingUi: PendingUiPayload;
}

/**
 * Modello e provider realmente in uso da un progetto, calcolati nella finestra
 * principale (l'unica che possiede le sessioni) e trasmessi alla companion.
 * Lo stato dell'agente viaggia gia' dentro `Project.agentState`.
 */
export interface CompanionProjectRuntime {
	projectId: string;
	provider?: string;
	modelId?: string;
	modelLabel?: string;
	credentialPin?: string;
}

export interface CompanionStateDto {
	isPinned: boolean;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}

export interface QuickTaskAiParsed {
	projectPath?: string | null;
	projectName?: string | null;
	taskPrompt: string;
	role?: string | null;
	modelSelector?: string | null;
	directiveIds: string[];
	ambiguities: string[];
}

class CompanionStore {
	isCompanionWindow = $state(false);
	isPinned = $state(false);
	attentionRequests = $state<AttentionRequest[]>([]);
	projects = $state<Project[]>([]);
	projectRuntimes = $state<CompanionProjectRuntime[]>([]);
	isParsingTask = $state(false);
	parseError = $state<string | null>(null);

	private unlisteners: UnlistenFn[] = [];
	private initialized = false;
	/** Ultimo elenco pubblicato dalla finestra principale, ritrasmesso alle risincronizzazioni. */
	private publishedRuntimes: CompanionProjectRuntime[] = [];

	constructor() {
		if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
			try {
				const current = getCurrentWindow();
				this.isCompanionWindow = current.label === 'companion';
			} catch {
				this.isCompanionWindow = false;
			}
			void this.init();
		}
	}

	async init() {
		if (this.initialized) return;
		this.initialized = true;

		// Carica stato salvato (pinnato o no)
		try {
			const saved = await invoke<CompanionStateDto>('get_companion_state');
			if (saved) {
				this.isPinned = saved.isPinned ?? false;
			}
		} catch (err) {
			console.warn('[companionStore] Caricamento stato companion fallito:', err);
		}

		// Ascolta eventi sincronizzazione inter-finestra
		try {
			const u1 = await listen<AttentionRequest[]>('studio-attention-update', (event) => {
				this.attentionRequests = event.payload ?? [];
			});
			this.unlisteners.push(u1);

			const u2 = await listen<Project[]>('studio-projects-update', (event) => {
				this.projects = event.payload ?? [];
			});
			this.unlisteners.push(u2);

			const u4 = await listen<CompanionProjectRuntime[]>('studio-project-runtime', (event) => {
				this.projectRuntimes = event.payload ?? [];
			});
			this.unlisteners.push(u4);

			const u3 = await listen('studio-request-attention-sync', () => {
				if (!this.isCompanionWindow) {
					this.broadcastState();
				}
			});
			this.unlisteners.push(u3);

			if (this.isCompanionWindow) {
				// Chiede alla finestra principale lo stato attuale
				void emit('studio-request-attention-sync');
			}
		} catch (err) {
			console.warn('[companionStore] Registrazione listener fallita:', err);
		}
	}

	destroy() {
		for (const u of this.unlisteners) u();
		this.unlisteners = [];
	}

	/** Notifica a tutte le finestre lo stato attuale dei progetti e delle attenzioni. */
	broadcastState() {
		void emit('studio-attention-update', $state.snapshot(this.attentionRequests));
		void emit('studio-projects-update', $state.snapshot(projectStore.projects));
		void emit('studio-project-runtime', this.publishedRuntimes);
	}

	/**
	 * Pubblica modello e provider per progetto (solo finestra principale).
	 * L'elenco viene memorizzato perche' la companion, riaprendosi, chiede una
	 * risincronizzazione e deve ricevere anche i runtime, non solo le attenzioni.
	 */
	publishProjectRuntimes(list: CompanionProjectRuntime[]) {
		this.publishedRuntimes = list;
		this.projectRuntimes = list;
		void emit('studio-project-runtime', list);
	}

	/**
	 * Registra una richiesta di attenzione per un progetto (chiamata dalla finestra main).
	 *
	 * Il chiamante e' un `$effect` che rilegge `attentionRequests`: si scrive
	 * solo quando lo stato cambia davvero, altrimenti l'effetto invaliderebbe
	 * la propria dipendenza e si richiamerebbe all'infinito.
	 */
	setAttentionRequest(request: AttentionRequest) {
		const next = upsertAttentionRequest(this.attentionRequests, request);
		if (!next) return;
		this.attentionRequests = next;
		this.broadcastState();
	}

	/** Rimuove la richiesta di attenzione quando risolta. Converge come `setAttentionRequest`. */
	clearAttentionRequest(projectId: string) {
		const next = removeAttentionRequest(this.attentionRequests, projectId);
		if (!next) return;
		this.attentionRequests = next;
		this.broadcastState();
	}

	/** Invia la risposta all'agente in background. */
	async respondUi(projectId: string, response: unknown) {
		this.clearAttentionRequest(projectId);
		await emit('studio-respond-ui', { projectId, response });
	}

	/** Invia la richiesta di cambio modello e ripresa (one-click) per quota bloccata. */
	async resolveQuotaBlocked(projectId: string, targetSelector?: string, thinkingLevel?: string) {
		this.clearAttentionRequest(projectId);
		await emit('studio-resolve-quota-blocked', { projectId, targetSelector, thinkingLevel });
	}

	/** Archivia l'avviso di blocco quota senza eseguire switch o ripresa. */
	async dismissQuotaBlocked(projectId: string) {
		this.clearAttentionRequest(projectId);
		await emit('studio-dismiss-quota-blocked', { projectId });
	}

	/**
	 * Commuta la modalita' tra Spotlight (effimera) e Widget (pinnata persistente).
	 *
	 * Non invia geometria: la legge Rust dalla finestra vera. Inviarla da qui
	 * significava perderla ogni volta che il pin partiva dalla TopBar della
	 * finestra principale, che non conosce le dimensioni della Companion.
	 */
	async setPinned(pinned: boolean) {
		this.isPinned = pinned;
		try {
			await invoke('set_companion_pinned', { pinned });
		} catch (err) {
			console.warn('[companionStore] Salvataggio stato pinned fallito:', err);
		}
	}

	/** Apre o mostra la finestra companion. */
	async toggleCompanion() {
		try {
			await invoke('toggle_companion_window');
		} catch (err) {
			console.error('[companionStore] Toggle finestra companion fallito:', err);
		}
	}

	/** Nasconde la finestra companion. */
	async hideCompanion() {
		try {
			await invoke('hide_companion_window');
		} catch (err) {
			console.error('[companionStore] Chiusura finestra companion fallita:', err);
		}
	}

	/**
	 * Esegue il parsing in linguaggio naturale di una riga di testo per creare un task.
	 */
	async parseQuickTask(input: string): Promise<QuickTaskAiParsed | null> {
		this.isParsingTask = true;
		this.parseError = null;

		try {
			await settingsStore.init();
			await modelSettingsStore.loadAll();

			// Prepara metadati progetti noti
			const knownProjects = (this.projects.length > 0 ? this.projects : projectStore.projects)
				.filter((p) => p.path)
				.map((p) => ({
					id: p.id,
					name: p.name,
					label: p.label,
					path: p.path
				}));

			// Prepara direttive note
			const knownDirectives = settingsStore.taskDirectives
				.filter((d) => !d.hidden)
				.map((d) => ({
					id: d.id,
					name: d.name,
					tag: d.tag,
					description: d.description
				}));

			const config = modelSettingsStore.config;
			const roles = STANDARD_ROLES
				.filter((role) => Boolean(config?.modelRoles?.[role.id]?.trim()))
				.map((role) => role.id);

			// Il catalogo completo vale decine di migliaia di caratteri: spedirlo intero
			// gonfiava il contesto del parser senza aggiungere nulla, perche' un task puo'
			// citare solo modelli che l'utente ha davvero configurato. Restano i modelli
			// assegnati ai ruoli, quelli del ciclo rapido e quelli delle catene di fallback.
			const catalogModels = [
				...Object.values(config?.modelRoles ?? {}),
				...(config?.cycleOrder ?? []),
				...Object.values(config?.fallbackChains ?? {}).flat()
			]
				.map((selector) => selector?.trim())
				.filter((selector): selector is string => Boolean(selector))
				.filter((selector, index, all) => all.indexOf(selector) === index);

			// Il parser e' un'estrazione JSON da una frase: gira sul modello del ruolo
			// `smol`, non su quello buono.
			const parserModel = config?.modelRoles?.smol?.trim() || undefined;

			const parsed = await invoke<QuickTaskAiParsed>('parse_quick_task_ai', {
				input,
				projects: knownProjects,
				directives: knownDirectives,
				roles,
				catalogModels,
				modelSelector: parserModel
			});

			return parsed;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.parseError = msg;
			return null;
		} finally {
			this.isParsingTask = false;
		}
	}

	/**
	 * Salva il task interpretato direttamente nel file .omp/tasks.json del progetto target.
	 */
	async saveTask(parsed: QuickTaskAiParsed, images: ImageContent[] = []): Promise<boolean> {
		if (!parsed.projectPath || (!parsed.taskPrompt.trim() && images.length === 0)) {
			this.parseError = 'Percorso progetto o contenuto del task mancante';
			return false;
		}

		try {
			await settingsStore.init();
			if (!modelSettingsStore.config) {
				await modelSettingsStore.loadAll();
			}

			// Leggi file esistente o inizializza
			let existingTasks: StudioTask[] = [];
			try {
				const raw = await invoke<string>('project_tasks_read', { projectPath: parsed.projectPath });
				if (raw && raw.trim()) {
					existingTasks = parseProjectTasksFile(raw, parsed.projectPath.toLowerCase());
				}
			} catch {
				existingTasks = [];
			}

			// Prepara opzioni task
			const project = (this.projects.length > 0 ? this.projects : projectStore.projects).find(
				(p) => p.path && p.path.toLowerCase() === parsed.projectPath!.toLowerCase()
			);
			const defaults = { ...settingsStore.taskDefaults, ...(project?.taskDefaults ?? {}) };
			const config = modelSettingsStore.config;
			const configuredRoleSelector = parsed.role
				? config?.modelRoles?.[parsed.role]?.trim() ?? ''
				: '';
			const knownModelSelectors = new Set(modelSettingsStore.catalog.map((model) => model.selector));
			const configuredRole = splitModelSelector(configuredRoleSelector, knownModelSelectors);
			const explicitModelSelector = parsed.modelSelector?.trim() || '';

			// Mappa le direttive selezionate
			const directiveSnapshots = settingsStore.taskDirectives
				.filter((d) => !d.hidden && parsed.directiveIds.includes(d.id))
				.map(createDirectiveSnapshot);

			const options: StudioTaskOptions = {
				role: explicitModelSelector ? 'custom' : parsed.role || defaults.role,
				modelSelector: explicitModelSelector || configuredRole.base || undefined,
				thinkingLevel: explicitModelSelector
					? defaults.thinkingLevel
					: configuredRole.thinking || defaults.thinkingLevel,
				includeEditorContext: defaults.includeEditorContext,
				directives: directiveSnapshots.length > 0 ? directiveSnapshots : undefined
			};

			const now = Date.now();
			const newTask: StudioTask = {
				id: crypto.randomUUID(),
				projectPath: parsed.projectPath.toLowerCase(),
				prompt: parsed.taskPrompt,
				images: [...images],
				options,
				position: existingTasks.length,
				createdAt: now,
				updatedAt: now,
				status: 'queued'
			};

			existingTasks.push(newTask);

			// Scrivi file su disco
			const content = serializeProjectTasksFile(existingTasks);
			await invoke('project_tasks_write', { projectPath: parsed.projectPath, content });

			// Notifica il cambio a tutti i watcher
			await emit('project-tasks-changed', { projectPath: parsed.projectPath });
			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.parseError = `Salvataggio task fallito: ${msg}`;
			return false;
		}
	}
}

export const companionStore = new CompanionStore();
