import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { projectStore, type Project } from './projects.svelte';
import { settingsStore } from './settings.svelte';
import { modelSettingsStore } from './modelSettings.svelte';
import { quotaStore, providersMatch } from './quota.svelte';
import { parseProjectTasksFile, serializeProjectTasksFile, type StudioTask, type StudioTaskOptions } from './taskSerialization';
import { createDirectiveSnapshot } from './taskDirectives';

export interface RecentChatMessage {
	role: 'user' | 'assistant' | 'tool';
	text: string;
	timestamp?: number;
}

export interface PendingUiPayload {
	kind: string;
	requestId: string;
	title?: string;
	message?: string;
	options?: string[];
	method?: 'select' | 'confirm' | 'input' | 'editor';
	questions?: unknown[];
	questionIndex?: number;
	totalQuestions?: number;
}

export interface AttentionRequest {
	projectId: string;
	projectName: string;
	projectHue: number;
	modelName?: string;
	recentMessages: RecentChatMessage[];
	pendingUi: PendingUiPayload;
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

export interface QuotaWarning {
	roleOrModel: string;
	provider: string;
	remainingPercent: number;
	resetsAt?: number | null;
	isExhausted: boolean;
}

class CompanionStore {
	isCompanionWindow = $state(false);
	isPinned = $state(false);
	attentionRequests = $state<AttentionRequest[]>([]);
	projects = $state<Project[]>([]);
	isParsingTask = $state(false);
	parseError = $state<string | null>(null);

	private unlisteners: UnlistenFn[] = [];
	private initialized = false;

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
	}

	/** Registra una richiesta di attenzione per un progetto (chiamata dalla finestra main). */
	setAttentionRequest(request: AttentionRequest) {
		const existingIndex = this.attentionRequests.findIndex((r) => r.projectId === request.projectId);
		if (existingIndex >= 0) {
			this.attentionRequests[existingIndex] = request;
		} else {
			this.attentionRequests.push(request);
		}
		this.broadcastState();
	}

	/** Rimuove la richiesta di attenzione quando risolta. */
	clearAttentionRequest(projectId: string) {
		const before = this.attentionRequests.length;
		this.attentionRequests = this.attentionRequests.filter((r) => r.projectId !== projectId);
		if (this.attentionRequests.length !== before) {
			this.broadcastState();
		}
	}

	/** Invia la risposta all'agente in background. */
	async respondUi(projectId: string, response: unknown) {
		this.clearAttentionRequest(projectId);
		await emit('studio-respond-ui', { projectId, response });
	}

	/** Commuta la modalita' tra Spotlight (effimera) e Widget (pinnata persistente). */
	async setPinned(pinned: boolean) {
		this.isPinned = pinned;
		try {
			let x: number | undefined;
			let y: number | undefined;
			let width: number | undefined;
			let height: number | undefined;

			if (this.isCompanionWindow) {
				const win = getCurrentWindow();
				const pos = await win.outerPosition();
				const size = await win.outerSize();
				x = pos.x;
				y = pos.y;
				width = size.width;
				height = size.height;
			}

			await invoke('save_companion_state', {
				state: {
					isPinned: pinned,
					x,
					y,
					width,
					height
				}
			});
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

			const roles = ['smol', 'default', 'slow', 'plan'];
			const catalogModels = modelSettingsStore.catalog.map((m) => m.selector || m.id || m.name);

			const parsed = await invoke<QuickTaskAiParsed>('parse_quick_task_ai', {
				input,
				projects: knownProjects,
				directives: knownDirectives,
				roles,
				catalogModels,
				modelSelector: undefined
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
	 * Verifica se il ruolo o modello assegnato ha quota esaurita o critica.
	 */
	checkQuota(roleOrModel: string | null | undefined): QuotaWarning | null {
		if (!roleOrModel) return null;
		const roleTrimmed = roleOrModel.trim();

		// Cerca il modello effettivo
		let modelSelector: string | undefined;
		if (['smol', 'default', 'slow', 'plan'].includes(roleTrimmed.toLowerCase())) {
			modelSelector = modelSettingsStore.config?.modelRoles?.[roleTrimmed.toLowerCase()];
		} else {
			modelSelector = roleTrimmed;
		}

		if (!modelSelector) return null;

		const model = modelSettingsStore.catalog.find(
			(m) => m.selector === modelSelector || m.id === modelSelector || m.name === modelSelector
		);
		if (!model) return null;

		const reports = quotaStore.reports.filter((r) => providersMatch(r.provider, model.provider));
		if (reports.length === 0) return null;

		const windows = reports.flatMap((report) =>
			(report.limits ?? []).flatMap((limit) => {
				const remaining = limit.amount?.remainingFraction ??
					(limit.amount?.usedFraction === undefined ? undefined : 1 - limit.amount.usedFraction);
				if (remaining === undefined) return [];
				const resetsAt = limit.window?.resetsAt ?? limit.resetsAt;
				return [{
					label: limit.label,
					remainingPercent: Math.round(Math.max(0, Math.min(1, remaining)) * 100),
					resetsAt
				}];
			})
		);

		if (windows.length === 0) return null;

		const minRemaining = Math.min(...windows.map((w) => w.remainingPercent));
		const lowestWindow = windows.find((w) => w.remainingPercent === minRemaining);

		return {
			roleOrModel: roleTrimmed,
			provider: model.provider,
			remainingPercent: minRemaining,
			resetsAt: lowestWindow?.resetsAt,
			isExhausted: minRemaining <= 0
		};
	}

	/**
	 * Salva il task interpretato direttamente nel file .omp/tasks.json del progetto target.
	 */
	async saveTask(parsed: QuickTaskAiParsed): Promise<boolean> {
		if (!parsed.projectPath || !parsed.taskPrompt) {
			this.parseError = 'Percorso progetto o prompt mancante';
			return false;
		}

		try {
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

			// Mappa le direttive selezionate
			const directiveSnapshots = settingsStore.taskDirectives
				.filter((d) => !d.hidden && parsed.directiveIds.includes(d.id))
				.map(createDirectiveSnapshot);

			const options: StudioTaskOptions = {
				role: (parsed.role as StudioTaskOptions['role']) || defaults.role,
				modelSelector: parsed.modelSelector || undefined,
				thinkingLevel: defaults.thinkingLevel,
				includeEditorContext: defaults.includeEditorContext,
				directives: directiveSnapshots.length > 0 ? directiveSnapshots : undefined
			};

			const now = Date.now();
			const newTask: StudioTask = {
				id: crypto.randomUUID(),
				projectPath: parsed.projectPath.toLowerCase(),
				prompt: parsed.taskPrompt,
				images: [],
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
