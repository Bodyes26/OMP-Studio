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
import { broadcastToWindows, listenFromWindows } from './windowBridge';
import type { ImageContent } from '$lib/agent/wire';
import { m as messages } from '$lib/paraglide/messages.js';
import { promptBus, type PromptRequest } from '$lib/agent/promptBus';
import type { PromptAnswer } from '$lib/agent/askAnswers';
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
	laneId?: string | null;
	title?: string;
	message?: string;
	options?: string[];
	optionDetails?: { description?: string }[];
	method?: 'select' | 'confirm' | 'input' | 'editor';
	placeholder?: string;
	prefill?: string;
	deadline?: number;
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
	laneId?: string | null;
	laneTitle?: string | null;
	projectName: string;
	projectHue: number;
	modelName?: string;
	recentMessages: RecentChatMessage[];
	pendingUi: PendingUiPayload;
}

/**
 * Modello e provider realmente in uso da un progetto, calcolati nella finestra
 * principale (l'unica che possiede le sessioni) e trasmessi alla companion.
 * Lo stato dell'agente viaggia dentro la corsia principale del progetto.
 */
export interface CompanionProjectRuntime {
	projectId: string;
	provider?: string;
	modelId?: string;
	modelLabel?: string;
	credentialPin?: string;
	/** True quando la finestra principale puo' avviare un task in coda. */
	canRunTask?: boolean;
	/** Motivo del blocco, se `canRunTask` e' falso. */
	runBlockReason?: string;
	/**
	 * Ultima riga di attivita' dell'agente: l'intento del tool in corso
	 * mentre lavora, l'estratto di cio' che ha detto quando ha finito. E' la
	 * differenza tra una card che dice "Completato" e una che dice cosa e'
	 * stato completato.
	 */
	activity?: { text: string; at: number; kind: 'intent' | 'assistant' };
}

export interface CompanionRunTaskPayload {
	projectId: string;
	taskId: string;
	follow?: boolean;
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
	/**
	 * Vero quando la finestra companion e' sullo schermo. Lo sa anche la
	 * finestra principale, che su questo decide se trasmettere: la riga di
	 * attivita' cambia a ogni tool e trasmetterla a una finestra nascosta e'
	 * lavoro pagato da chi sta compilando altrove.
	 */
	isCompanionVisible = $state(false);

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
			console.warn(messages.ui_ts_companion_companionstore_caricamento_stato_companion_fallito_5487(), err);
		}

		// Ascolta eventi sincronizzazione inter-finestra
		try {
			// I tre canali di stato viaggiano nella busta di `windowBridge`:
			// `emit` consegna anche al mittente, e la finestra principale --
			// che e' la sorgente -- si riapplicava il proprio payload. Passato
			// da JSON quel payload perde le chiavi con valore `undefined`,
			// quindi il confronto lo giudicava diverso dallo stato appena
			// pubblicato: l'effetto riscriveva, ritrasmetteva e la Companion
			// ridisegnava la card a ogni giro, senza fermarsi.
			const u1 = await listenFromWindows<AttentionRequest[]>(
				'studio-attention-update',
				(payload) => {
					this.attentionRequests = payload ?? [];
				}
			);
			if (u1) this.unlisteners.push(u1);

			const u2 = await listenFromWindows<Project[]>('studio-projects-update', (payload) => {
				this.projects = payload ?? [];
			});
			if (u2) this.unlisteners.push(u2);

			const u4 = await listenFromWindows<CompanionProjectRuntime[]>(
				'studio-project-runtime',
				(payload) => {
					this.projectRuntimes = payload ?? [];
				}
			);
			if (u4) this.unlisteners.push(u4);

			const u3 = await listen('studio-request-attention-sync', () => {
				if (!this.isCompanionWindow) {
					this.broadcastState();
				}
			});
			this.unlisteners.push(u3);

			// Il pin si comanda sia dalla TopBar sia dall'header della Companion:
			// l'evento arriva da Rust dopo la scrittura su disco, cosi' entrambe
			// le finestre mostrano lo stesso stato.
			const u5 = await listen<boolean>('companion-pinned-changed', (event) => {
				this.isPinned = event.payload === true;
			});
			this.unlisteners.push(u5);

			// Visibilita' della companion: Rust la annuncia a tutte le finestre
			// mostrandola (`companion-summon`) e nascondendola.
			const u6 = await listen('companion-summon', () => {
				this.isCompanionVisible = true;
			});
			this.unlisteners.push(u6);

			const u7 = await listen('companion-hidden', () => {
				this.isCompanionVisible = false;
			});
			this.unlisteners.push(u7);
			// Sincronizzazione continua con PromptBus
			const uPrompt = promptBus.subscribe((pendings) => {
				if (this.isCompanionWindow) {
					this.syncWithPromptBus(pendings);
				}
			});
			this.unlisteners.push(uPrompt);


			if (this.isCompanionWindow) {
				this.syncWithPromptBus(promptBus.getPendings());
				this.requestSync();
			} else {
				// La richiesta iniziale della Companion puo' arrivare mentre i
				// progetti persistiti sono ancora vuoti. A lettura completata
				// la finestra principale ribatte lo snapshot definitivo:
				// nessuna finestra resta dipendente dall'ordine dei listener.
				void projectStore.init().then(() => this.broadcastState());
			}
		} catch (err) {
			console.warn(messages.ui_ts_companion_companionstore_registrazione_listener_fallita_342a(), err);
		}
	}

	/** Chiede alla finestra principale lo snapshot inter-finestra corrente. */
	requestSync() {
		if (!this.isCompanionWindow) return;
		void emit('studio-request-attention-sync');
	}

	destroy() {
		for (const u of this.unlisteners) u();
		this.unlisteners = [];
	}

	/** Notifica a tutte le finestre lo stato attuale dei progetti e delle attenzioni. */
	broadcastState() {
		void broadcastToWindows('studio-attention-update', $state.snapshot(this.attentionRequests));
		void broadcastToWindows('studio-projects-update', $state.snapshot(projectStore.projects));
		void broadcastToWindows('studio-project-runtime', this.publishedRuntimes);
	}

	/**
	 * Pubblica modello e provider per progetto (solo finestra principale).
	 * L'elenco viene memorizzato perche' la companion, riaprendosi, chiede una
	 * risincronizzazione e deve ricevere anche i runtime, non solo le attenzioni.
	 */
	publishProjectRuntimes(list: CompanionProjectRuntime[]) {
		this.publishedRuntimes = list;
		this.projectRuntimes = list;
		void broadcastToWindows('studio-project-runtime', list);
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
	clearAttentionRequest(projectId: string, laneId?: string | null) {
		const next = removeAttentionRequest(this.attentionRequests, projectId, laneId);
		if (!next) return;
		this.attentionRequests = next;
		this.broadcastState();
	}

	/** Invia la risposta all'agente in background (tramite PromptBus o evento fallback). */
	async respondUi(
		projectId: string,
		response: unknown,
		laneId?: string | null,
		requestId?: string | null,
		sessionId?: string | null
	) {
		this.clearAttentionRequest(projectId, laneId);
		if (requestId && promptBus.hasPending(requestId)) {
			const handled = await promptBus.resolveRequest(requestId, response as PromptAnswer, {
				projectId,
				laneId: laneId ?? undefined,
				sessionId: sessionId ?? undefined
			});
			if (handled) return;
		}
		if (laneId) {
			const pendings = promptBus.getPendingsForLane(projectId, laneId);
			if (pendings.length === 1) {
				const handled = await promptBus.resolveRequest(pendings[0].requestId, response as PromptAnswer, {
					projectId,
					laneId,
					sessionId: sessionId ?? undefined
				});
				if (handled) return;
			}
		} else {
			const pendings = promptBus.getPendingsForProject(projectId);
			if (pendings.length === 1) {
				const handled = await promptBus.resolveRequest(pendings[0].requestId, response as PromptAnswer, {
					projectId,
					sessionId: sessionId ?? undefined
				});
				if (handled) return;
			}
		}
		await emit('studio-respond-ui', {
			projectId,
			laneId: laneId ?? undefined,
			requestId: requestId ?? undefined,
			sessionId: sessionId ?? undefined,
			response
		});
	}

	/** Invia la risposta all'agente tramite requestId esatto su PromptBus (first-response-wins). */
	async respondPrompt(requestId: string, answer: PromptAnswer, laneId?: string | null): Promise<boolean> {
		const req = promptBus.getRequest(requestId);
		if (req) {
			this.clearAttentionRequest(req.projectId, req.laneId ?? laneId);
		}
		return await promptBus.resolveRequest(requestId, answer, { laneId: laneId ?? undefined });
	}
	/** Invia la richiesta di cambio modello e ripresa (one-click) per quota bloccata. */
	async resolveQuotaBlocked(
		projectId: string,
		targetSelector?: string,
		thinkingLevel?: string,
		laneId?: string | null
	) {
		this.clearAttentionRequest(projectId, laneId);
		await emit('studio-resolve-quota-blocked', {
			projectId,
			laneId: laneId ?? undefined,
			targetSelector,
			thinkingLevel
		});
	}

	/** Archivia l'avviso di blocco quota senza eseguire switch o ripresa. */
	async dismissQuotaBlocked(projectId: string, laneId?: string | null) {
		this.clearAttentionRequest(projectId, laneId);
		await emit('studio-dismiss-quota-blocked', { projectId, laneId: laneId ?? undefined });
	}

	/**
	 * Sincronizza lo stato delle richieste di attenzione con i prompt pendenti sul PromptBus.
	 * Garantisce che all'apertura tardiva della Companion le domande pendenti siano
	 * immediatamente renderizzate, e che le domande risolte vengano rimosse.
	 */
	private syncWithPromptBus(pendings: PromptRequest[]) {
		if (pendings.length === 0) {
			const nonAsk = this.attentionRequests.filter((r) => r.pendingUi.kind !== 'ask');
			if (nonAsk.length !== this.attentionRequests.length) {
				this.attentionRequests = nonAsk;
			}
			return;
		}
		for (const p of pendings) {
			const pLane = (p.laneId ?? 'main').toLowerCase();
			const existing = this.attentionRequests.find(
				(r) =>
					r.projectId.toLowerCase() === p.projectId.toLowerCase() &&
					(r.laneId ?? 'main').toLowerCase() === pLane
			);
			if (!existing || existing.pendingUi.requestId !== p.requestId || existing.pendingUi.title !== p.title) {
				const project = this.projects.find((prj) => prj.id.toLowerCase() === p.projectId.toLowerCase()) ?? {
					id: p.projectId,
					name: p.projectId,
					hue: 200
				};
				const laneId = p.laneId ?? 'main';
				const attentionReq: AttentionRequest = {
					projectId: project.id,
					laneId,
					laneTitle: laneId !== 'main' ? laneId : 'Principale',
					projectName: project.name,
					projectHue: (project as Project).hue ?? 200,
					recentMessages: existing?.recentMessages ?? [],
					pendingUi: {
						kind: p.kind || 'ask',
						requestId: p.requestId,
						laneId,
						title: p.title,
						message: p.message,
						options: [...p.options],
						optionDetails: [...p.optionDetails],
						method: p.method,
						placeholder: p.placeholder,
						prefill: p.prefill,
						deadline: p.deadline,
						questions: p.questions,
						questionIndex: p.questionIndex,
						totalQuestions: p.totalQuestions
					}
				};
				const next = upsertAttentionRequest(this.attentionRequests, attentionReq);
				if (next) this.attentionRequests = next;
			}
		}

		const activeKeys = new Set(
			pendings.map((p) => `${p.projectId.toLowerCase()}\u0000${(p.laneId ?? 'main').toLowerCase()}`)
		);
		const filtered = this.attentionRequests.filter((r) => {
			if (r.pendingUi.kind !== 'ask') return true;
			const key = `${r.projectId.toLowerCase()}\u0000${(r.laneId ?? 'main').toLowerCase()}`;
			return activeKeys.has(key);
		});
		if (filtered.length !== this.attentionRequests.length) {
			this.attentionRequests = filtered;
		}
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
			console.warn(messages.ui_ts_companion_companionstore_salvataggio_stato_pinned_fallito_4cfb(), err);
		}
	}

	/** Apre o mostra la finestra companion. */
	async toggleCompanion() {
		try {
			await invoke('toggle_companion_window');
		} catch (err) {
			console.error(messages.ui_ts_companion_companionstore_toggle_finestra_companion_fallito_870b(), err);
		}
	}

	/** Nasconde la finestra companion. */
	async hideCompanion() {
		try {
			await invoke('hide_companion_window');
		} catch (err) {
			console.error(messages.ui_ts_companion_companionstore_chiusura_finestra_companion_fallita_4941(), err);
		}
	}

	/** Chiede alla finestra principale di avviare un task in coda. */
	async runTask(projectId: string, taskId: string, follow = false) {
		await emit('studio-run-task', { projectId, taskId, follow });
	}

	/**
	 * Porta la finestra principale in primo piano sul progetto indicato.
	 *
	 * Serve al caso che la sola coda non copriva: un agente che ha finito e'
	 * "fermo" esattamente come uno in attesa di un compito, ma nel primo caso
	 * quello che vuoi e' leggere il risultato, non far partire altro lavoro.
	 * In modalita' Spotlight la companion si ritira: ha finito il suo compito.
	 */
	async focusProject(projectId: string) {
		await emit('studio-focus-project', { projectId });
		if (!this.isPinned) await this.hideCompanion();
	}

	/**
	 * Adatta l'altezza della finestra al contenuto (solo Spotlight).
	 *
	 * Lato Rust il comando esce da solo quando la finestra e' pinnata: la
	 * geometria del widget la decide l'utente trascinandone il bordo.
	 */
	async fitToContent(height: number) {
		if (this.isPinned) return;
		try {
			await invoke('fit_companion_to_content', { height });
		} catch {
			// Finestra non ancora pronta o piattaforma senza ridimensionamento:
			// il layout resta valido, si perde solo l'adattamento.
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
				.flatMap((p) =>
					p.canonicalProjectPath
						? [{
								id: p.id,
								name: p.name,
								label: p.label,
								path: p.canonicalProjectPath
							}]
						: []
				);

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
			this.parseError = messages.ui_ts_companion_percorso_progetto_o_contenuto_del_task_mancante_085e();
			return false;
		}

		try {
			// Il salvataggio ha bisogno dei ruoli configurati e dei selettori
			// del catalogo: sono letture di `config.yml` e `models.db`.
			// `loadAll` avvia anche `omp models --json`, un processo da
			// secondi, e teneva il primo salvataggio in attesa per nulla.
			await Promise.all([settingsStore.init(), modelSettingsStore.ensureConfigAndCatalog()]);

			// Il file assente torna stringa vuota: un errore vero, invece, non
			// vale coda vuota, perche' la scrittura seguente la cancellerebbe.
			let existingTasks: StudioTask[] = [];
			try {
				const raw = await invoke<string>('project_tasks_read', { projectPath: parsed.projectPath });
				if (raw && raw.trim()) {
					existingTasks = parseProjectTasksFile(raw, parsed.projectPath.toLowerCase());
				}
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				this.parseError = messages.ui_ts_companion_salvataggio_task_fallito_value1_783d({ value1: detail });
				return false;
			}

			// Prepara opzioni task
			const project = (this.projects.length > 0 ? this.projects : projectStore.projects).find(
				(p) =>
					p.canonicalProjectPath &&
					p.canonicalProjectPath.toLowerCase() === parsed.projectPath!.toLowerCase()
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
			// Anche il mittente deve rileggere: questo percorso scrive il file
			// direttamente e non ha ancora aggiunto il task al proprio
			// `taskStore`. A differenza di `saveProjectImmediate`, quindi,
			// l'evento non porta `source` e non viene filtrato.
			await emit('project-tasks-changed', { projectPath: parsed.projectPath });
			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.parseError = messages.ui_ts_companion_salvataggio_task_fallito_value1_783d({ value1: msg });
			return false;
		}
	}
}

export const companionStore = new CompanionStore();
