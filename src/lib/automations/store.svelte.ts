import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getLocale } from '#lib/paraglide/runtime.js';
import { pathKey } from '#lib/utils/paths.ts';
import {
	newAutomationDefinition,
	type AutomationContext,
	type AutomationDefinition,
	type AutomationDraft,
	type AutomationEvent,
	type AutomationOccurrence,
	type AutomationOutput,
	type AutomationPreview,
	type AutomationSettings,
	type AutomationSnapshot,
	type AutomationState
} from './types.ts';

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
function nativeAvailable(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

class AutomationsStore {
	snapshot = $state<AutomationSnapshot | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);
	opened = $state(false);
	projectFilter = $state<string | null>(null);
	selectedId = $state<string | null>(null);
	selectedRunId = $state<string | null>(null);
	editingDraft = $state<AutomationDraft | null>(null);
	createWithAi = $state(false);
	attentionOnly = $state(false);
	private initialized = false;
	private initialization: Promise<void> | null = null;
	private refreshing: Promise<AutomationSnapshot> | null = null;
	private refreshAgain = false;
	private refreshTimer: number | undefined;
	private unlisteners: UnlistenFn[] = [];
	private lastContext = '';
	private contextQueue: Promise<void> = Promise.resolve();

	get definitions(): AutomationDefinition[] { return this.snapshot?.definitions ?? []; }
	get drafts(): AutomationDraft[] { return this.snapshot?.drafts ?? []; }
	get runs(): AutomationOccurrence[] { return this.snapshot?.runs ?? []; }
	get selected(): AutomationDefinition | null {
		return this.definitions.find((definition) => definition.id === this.selectedId) ?? null;
	}

	async init(): Promise<void> {
		if (this.initialized) return;
		if (this.initialization) return this.initialization;
		this.initialization = this.initialize().finally(() => { this.initialization = null; });
		return this.initialization;
	}
	private async initialize(): Promise<void> {
		if (!nativeAvailable()) {
			this.error = getLocale() === 'it' ? 'Le automazioni richiedono l’app desktop di Studio.' : 'Automations require the Studio desktop app.';
			return;
		}
		this.loading = true;
		try {
			this.unlisteners.push(await listen('automations://changed', () => this.scheduleRefresh()));
			this.unlisteners.push(await listen<{ draftId: string }>('automations://review', (event) => {
				void this.openReview(event.payload.draftId).catch((error) => { this.error = errorText(error); });
			}));
			await this.refresh();
			this.initialized = true;
		} catch (error) {
			this.error = errorText(error);
			for (const unlisten of this.unlisteners.splice(0)) unlisten();
			throw error;
		} finally {
			this.loading = false;
		}
	}
	private scheduleRefresh(): void {
		if (this.refreshTimer !== undefined) return;
		// L'output arriva a blocchi: non serve una query SQLite per ciascun byte.
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refresh().catch((error) => { this.error = errorText(error); });
		}, 100);
	}
	async refresh(): Promise<AutomationSnapshot> {
		if (this.refreshing) {
			this.refreshAgain = true;
			return this.refreshing;
		}
		this.refreshing = (async () => {
			let snapshot: AutomationSnapshot;
			do {
				this.refreshAgain = false;
				snapshot = await invoke<AutomationSnapshot>('automations_snapshot');
				this.snapshot = snapshot;
				this.error = null;
			} while (this.refreshAgain);
			return snapshot;
		})().catch((error) => {
			this.error = errorText(error);
			throw error;
		}).finally(() => { this.refreshing = null; });
		return this.refreshing;
	}
	open(projectPath?: string): void {
		this.projectFilter = projectPath || null;
		this.opened = true;
		void this.init().catch((error) => { this.error = errorText(error); });
	}
	close(): void { this.opened = false; }
	newDraft(projectPath = ''): AutomationDraft {
		const now = Date.now();
		const draft: AutomationDraft = {
			id: crypto.randomUUID(), definition: newAutomationDefinition(projectPath),
			baseRevision: null, conversation: [], createdAt: now, updatedAt: now, source: 'user'
		};
		this.editingDraft = draft;
		this.createWithAi = false;
		this.open(projectPath);
		return draft;
	}
	edit(definition: AutomationDefinition): AutomationDraft {
		const existing = this.drafts.find((draft) => draft.definition.id === definition.id && draft.baseRevision === definition.revision);
		const now = Date.now();
		const draft = existing ? structuredClone($state.snapshot(existing)) : {
			id: crypto.randomUUID(), definition: structuredClone($state.snapshot(definition)),
			baseRevision: definition.revision, conversation: [], createdAt: now, updatedAt: now, source: 'user'
		};
		this.editingDraft = draft;
		this.createWithAi = false;
		this.selectedId = definition.id;
		this.opened = true;
		return draft;
	}
	async openReview(draftId: string): Promise<void> {
		const snapshot = await this.refresh();
		const draft = snapshot.drafts.find((candidate) => candidate.id === draftId);
		if (!draft) throw new Error(getLocale() === 'it' ? 'La bozza richiesta non è disponibile.' : 'The requested draft is unavailable.');
		this.editingDraft = structuredClone($state.snapshot(draft));
		this.createWithAi = false;
		this.opened = true;
	}
	private async mutate<T>(command: string, args: Record<string, unknown>): Promise<T> {
		try {
			const result = await invoke<T>(command, args);
			await this.refresh();
			return result;
		} catch (error) {
			this.error = errorText(error);
			throw error;
		}
	}
	async saveDraft(draft: AutomationDraft): Promise<AutomationDraft> {
		return this.mutate('automations_save_draft', { draft: $state.snapshot(draft) });
	}
	async activate(draftId: string, expectedRevision: number | null): Promise<AutomationDefinition> {
		const definition = await this.mutate<AutomationDefinition>('automations_activate', { draftId, expectedRevision });
		if (this.editingDraft?.id === draftId) this.editingDraft = null;
		this.selectedId = definition.id;
		return definition;
	}
	async setState(id: string, state: AutomationState): Promise<void> { await this.mutate('automations_set_state', { id, state }); }
	async remove(id: string, deleteHistory = false): Promise<void> {
		await this.mutate('automations_delete', { id, deleteHistory });
		if (this.selectedId === id) this.selectedId = null;
	}
	async runNow(id: string, targetPaths?: string[]): Promise<AutomationOccurrence> {
		return this.mutate('automations_run_now', { id, targetPaths: targetPaths ?? null });
	}
	async cancel(runId: string, executionId?: string): Promise<void> { await this.mutate('automations_cancel', { runId, executionId: executionId ?? null }); }
	async extendWait(runId: string, executionId: string, minutes: number): Promise<void> {
		await this.mutate('automations_extend_wait', { runId, executionId, minutes });
	}
	async acknowledge(runId: string, resolveUnknown = false): Promise<void> { await this.mutate('automations_acknowledge', { runId, resolveUnknown }); }
	async saveSettings(settings: AutomationSettings): Promise<void> { await this.mutate('automations_settings', { settings: $state.snapshot(settings) }); }
	async preview(definition: AutomationDefinition): Promise<AutomationPreview> {
		return invoke('automations_preview', { definition: $state.snapshot(definition) });
	}
	async getOutput(executionId: string, offset = 0, limit = 64 * 1024): Promise<AutomationOutput> {
		return invoke('automations_output', { executionId, offset, limit });
	}
	async exportDefinitions(ids: string[]): Promise<string> { return invoke('automations_export', { ids }); }
	async importDefinitions(json: string): Promise<AutomationDraft[]> { return this.mutate('automations_import', { json }); }
	async putSecret(id: string, value: string): Promise<void> { await invoke('automations_secret_put', { id, value }); }
	async deleteSecret(id: string): Promise<void> { await invoke('automations_secret_delete', { id }); }
	async emitEvent(event: AutomationEvent): Promise<void> {
		if (!nativeAvailable()) return;
		await invoke('automations_event', { event });
	}
	updateContext(context: AutomationContext): Promise<void> {
		const json = JSON.stringify(context);
		if (json === this.lastContext) return this.contextQueue;
		this.lastContext = json;
		// Snapshot ordinati anche se una risposta IPC precedente e' piu' lenta.
		this.contextQueue = this.contextQueue.catch(() => {}).then(async () => {
			await invoke('automations_update_context', { context });
		}).catch((error) => {
			if (this.lastContext === json) this.lastContext = '';
			this.error = errorText(error);
		});
		return this.contextQueue;
	}
	projectIsReserved(projectPath: string): boolean {
		const key = pathKey(projectPath);
		return this.runs.some((run) => run.executions.some((execution) =>
			(execution.state === 'running' || execution.state === 'needsInput') &&
			execution.targets.some((target) => target.kind === 'project' && pathKey(target.path) === key)
		));
	}
	activeRunsFor(projectPath: string): AutomationOccurrence[] {
		const key = pathKey(projectPath);
		return this.runs.filter((run) => run.executions.some((execution) =>
			(execution.state === 'running' || execution.state === 'needsInput') &&
			execution.targets.some((target) => target.kind === 'project' && pathKey(target.path) === key)
		));
	}
	destroy(): void {
		clearTimeout(this.refreshTimer);
		this.refreshTimer = undefined;
		for (const unlisten of this.unlisteners.splice(0)) unlisten();
		this.initialized = false;
		this.lastContext = '';
	}
}
export const automationsStore = new AutomationsStore();
