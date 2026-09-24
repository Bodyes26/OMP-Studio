// Runtime reattivo per corsia Laboratorio (Svelte 5 runes).
//
// Governa il ciclo di vita dell'anteprima:
//  - Watcher del filesystem con debounce a 150 ms;
//  - Compilazione esbuild su Web Worker e pubblicazione sul server loopback Rust;
//  - Aggiornamento continuo di .lab/preview-status.json con errori di compilazione e runtime;
//  - Chiusura revisione git (commit automatico) a fine turno agente e sync titolo/indice;
//  - Consultazione storica e ripristino di revisioni precedenti.

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { syncLabTitle } from '$lib/lanes/laneActions';
import type { AgentSession } from '$lib/agent/session.svelte';
import { labApi } from './api';
import { compileLabPrototypeInWorker } from './compiler';
import { buildLabPreviewHtml } from './preview-builder';
import { ensureSharedVendorPublished } from './sharedVendor';
import {
	LAB_CHANGED_EVENT,
	type LabChangedEvent,
	type LabIndexPatch,
	type LabPreviewError,
	type LabServedFile
} from './types';

export interface LabLaneRuntimeConfig {
	projectId: string;
	laneId: string;
	prototypeId: string;
	workspacePath: string;
	projectPath: string | null;
	session: AgentSession;
}

export class LabLaneRuntime {
	readonly projectId: string;
	readonly laneId: string;
	readonly prototypeId: string;
	readonly workspacePath: string;
	readonly projectPath: string | null;
	readonly session: AgentSession;

	readonly watchKey: string;

	// Stato reattivo
	url = $state<string | null>(null);
	isCompiling = $state(false);
	isInitialLoading = $state(true);
	compileErrors = $state<LabPreviewError[]>([]);
	runtimeErrors = $state<LabPreviewError[]>([]);
	activeRevisionSha = $state<string | null>(null);
	isViewingHistorical = $state(false);

	private lastCompiledAt = 0;
	private lastSourceStamp = 0;
	private debounceTimer: number | null = null;
	private unlistenFn: UnlistenFn | null = null;
	private isStarted = false;

	constructor(config: LabLaneRuntimeConfig) {
		this.projectId = config.projectId;
		this.laneId = config.laneId;
		this.prototypeId = config.prototypeId;
		this.workspacePath = config.workspacePath;
		this.projectPath = config.projectPath;
		this.session = config.session;
		this.watchKey = `${this.projectId}:${this.laneId}`;
	}

	get allErrors(): LabPreviewError[] {
		return [...this.compileErrors, ...this.runtimeErrors];
	}

	get hasErrors(): boolean {
		return this.allErrors.length > 0;
	}

	async start(): Promise<void> {
		if (this.isStarted) return;
		this.isStarted = true;

		try {
			await ensureSharedVendorPublished();
			await labApi.watchStart(this.workspacePath, this.watchKey);

			this.unlistenFn = await listen<LabChangedEvent>(LAB_CHANGED_EVENT, (event) => {
				if (event.payload.key === this.watchKey) {
					this.scheduleRecompile();
				}
			});

			await this.recompileAndPublish();
		} catch (err) {
			console.error('Errore durante l\'avvio del runtime Lab:', err);
		}
	}

	stop(): void {
		if (!this.isStarted) return;
		this.isStarted = false;

		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		if (this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
		}

		void labApi.watchStop(this.watchKey).catch(() => {});
	}

	scheduleRecompile(): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			void this.recompileAndPublish();
		}, 150);
	}

	async recompileAndPublish(key = this.prototypeId): Promise<void> {
		this.isCompiling = true;
		try {
			await ensureSharedVendorPublished();
			const files = await labApi.snapshot(this.workspacePath);
			const sourceStamp = Date.now();
			const result = await compileLabPrototypeInWorker(files);
			this.compileErrors = result.errors;
			this.runtimeErrors = [];

			if (!result.ok) {
				await labApi.writePreviewStatus(this.workspacePath, {
					url: this.url,
					compiledAt: Date.now(),
					sourceStamp,
					ok: false,
					errors: result.errors
				});
				return;
			}

			const html = buildLabPreviewHtml({
				importMap: result.importMap,
				compiledCss: result.compiledCss
			});

			const servedFiles: LabServedFile[] = [
				{
					path: 'index.html',
					content: html,
					contentType: 'text/html'
				},
				{
					path: 'app.js',
					content: result.compiledJs,
					contentType: 'application/javascript'
				}
			];

			const published = await labApi.publish(key, servedFiles);
			this.url = published.url;
			this.lastCompiledAt = Date.now();
			this.lastSourceStamp = sourceStamp;

			await labApi.writePreviewStatus(this.workspacePath, {
				url: published.url,
				compiledAt: this.lastCompiledAt,
				sourceStamp,
				ok: true,
				errors: []
			});
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			this.compileErrors = [{ kind: 'compile', message: errMsg }];
			await labApi.writePreviewStatus(this.workspacePath, {
				url: this.url,
				compiledAt: Date.now(),
				sourceStamp: Date.now(),
				ok: false,
				errors: this.compileErrors
			});
		} finally {
			this.isCompiling = false;
			this.isInitialLoading = false;
		}
	}

	reportRuntimeError(error: LabPreviewError): void {
		// Evita duplicati identici
		if (this.runtimeErrors.some((e) => e.message === error.message)) return;
		this.runtimeErrors = [...this.runtimeErrors, error];

		void labApi
			.writePreviewStatus(this.workspacePath, {
				url: this.url,
				compiledAt: this.lastCompiledAt,
				sourceStamp: this.lastSourceStamp,
				ok: false,
				errors: this.allErrors
			})
			.catch(() => {});
	}

	clearRuntimeErrors(): void {
		this.runtimeErrors = [];
	}

	async handleAgentTurnEnd(): Promise<void> {
		try {
			// Ricava la prima riga del messaggio utente per la descrizione del commit
			const lastUserEntry = [...this.session.entries].reverse().find((e) => e.kind === 'user');
			let commitMsg = 'Modifiche prototipo';
			if (lastUserEntry) {
				const text = lastUserEntry.content ?? '';
				const firstLine = text.trim().split('\n')[0]?.trim();
				if (firstLine) {
					commitMsg = firstLine.slice(0, 72);
				}
			}

			const rev = await labApi.commit(this.workspacePath, commitMsg);
			if (rev) {
				const meta = await labApi.readMeta(this.workspacePath);
				const patch: LabIndexPatch = {
					lastRevision: rev
				};
				if (meta?.title) patch.title = meta.title;
				if (meta?.summary) patch.summary = meta.summary;

				await labApi.updateIndex(this.projectPath, this.prototypeId, patch);
				if (meta?.title) {
					syncLabTitle(this.projectId, this.laneId, meta.title);
				}
			}
		} catch (err) {
			console.error('Errore durante il salvataggio a fine turno del prototipo:', err);
		}
	}

	async viewRevision(sha: string): Promise<void> {
		this.isCompiling = true;
		try {
			await ensureSharedVendorPublished();
			const files = await labApi.filesAt(this.workspacePath, sha);
			const result = await compileLabPrototypeInWorker(files);
			if (!result.ok) {
				this.compileErrors = result.errors;
				return;
			}
			const html = buildLabPreviewHtml({
				importMap: result.importMap,
				compiledCss: result.compiledCss
			});
			const key = `${this.prototypeId}@${sha}`;
			const published = await labApi.publish(key, [
				{ path: 'index.html', content: html, contentType: 'text/html' },
				{ path: 'app.js', content: result.compiledJs, contentType: 'application/javascript' }
			]);
			this.url = published.url;
			this.activeRevisionSha = sha;
			this.isViewingHistorical = true;
		} finally {
			this.isCompiling = false;
		}
	}

	async restoreRevision(sha: string): Promise<void> {
		this.isCompiling = true;
		try {
			await labApi.restore(this.workspacePath, sha);
			this.isViewingHistorical = false;
			this.activeRevisionSha = null;
			await this.recompileAndPublish();
		} finally {
			this.isCompiling = false;
		}
	}

	async returnToCurrent(): Promise<void> {
		this.isViewingHistorical = false;
		this.activeRevisionSha = null;
		await this.recompileAndPublish();
	}
}

const runtimes = new Map<string, LabLaneRuntime>();

export function getOrCreateLabRuntime(config: LabLaneRuntimeConfig): LabLaneRuntime {
	const key = `${config.projectId}:${config.laneId}`;
	let runtime = runtimes.get(key);
	if (!runtime) {
		runtime = new LabLaneRuntime(config);
		runtimes.set(key, runtime);
	}
	return runtime;
}

export function disposeLabRuntime(projectId: string, laneId: string): void {
	const key = `${projectId}:${laneId}`;
	const runtime = runtimes.get(key);
	if (runtime) {
		runtime.stop();
		runtimes.delete(key);
	}
}
