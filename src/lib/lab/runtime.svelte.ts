// Runtime reattivo per corsia Laboratorio (Svelte 5 runes).
//
// Governa il ciclo di vita dell'anteprima:
//  - Watcher del filesystem con debounce a 150 ms;
//  - Compilazione esbuild su Web Worker e pubblicazione sul server loopback Rust;
//  - Aggiornamento continuo di .lab/preview-status.json con errori di compilazione e runtime;
//  - Chiusura revisione git (commit automatico) a fine turno agente e sync titolo/indice;
//  - Consultazione storica e ripristino di revisioni precedenti.

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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
	type LabRevision,
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
	// Cresce a ogni pubblicazione riuscita. Il server riusa lo stesso URL per
	// la stessa chiave, quindi e' questo contatore a dire all'iframe di ricaricarsi.
	publishSeq = $state(0);
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
	private startGeneration = 0;

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
		const generation = ++this.startGeneration;
		// `stop()` puo' arrivare durante uno qualsiasi degli await (corsia
		// smontata mentre il runtime nasceva): da li' in poi cio' che questo
		// avvio registra va smontato subito, o watcher e listener restano vivi.
		const stopped = () => !this.isStarted || generation !== this.startGeneration;

		try {
			await ensureSharedVendorPublished();
			if (stopped()) return;
			await labApi.watchStart(this.workspacePath, this.watchKey);
			if (stopped()) {
				// Un avvio piu' recente usa la stessa chiave: il suo watcher non va toccato.
				if (!this.isStarted) await labApi.watchStop(this.watchKey).catch(() => {});
				return;
			}

			const unlisten = await listen<LabChangedEvent>(LAB_CHANGED_EVENT, (event) => {
				if (event.payload.key === this.watchKey) {
					this.scheduleRecompile();
				}
			});
			if (stopped()) {
				unlisten();
				return;
			}
			this.unlistenFn = unlisten;

			await this.recompileAndPublish();
			if (stopped()) return;
			// Recupera titolo e riepilogo di una fine richiesta persa (Studio
			// chiuso o corsia smontata mentre l'agente lavorava).
			await this.syncMeta(null);
		} catch (err) {
			console.error('Errore durante l\'avvio del runtime Lab:', err);
		}
	}

	/** Smonta timer, listener e watcher; la promessa si risolve a watcher fermo. */
	async stop(): Promise<void> {
		if (!this.isStarted) return;
		this.isStarted = false;
		this.startGeneration += 1;

		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		if (this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
		}

		await labApi.watchStop(this.watchKey).catch(() => {});
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
			this.publishSeq += 1;
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
			await this.syncMeta(rev);
		} catch (err) {
			console.error('Errore durante il salvataggio a fine turno del prototipo:', err);
		}
	}

	/**
	 * Riporta il riepilogo di `.lab/meta.json` sull'indice del prototipo.
	 * Non sincronizza piu' il titolo: la titolazione e' gestita da smol / rinomina manuale.
	 */
	private async syncMeta(rev: LabRevision | null): Promise<void> {
		const [meta, index] = await Promise.all([
			labApi.readMeta(this.workspacePath),
			labApi.listIndex(this.projectPath)
		]);
		const entry = index.find((e) => e.id === this.prototypeId);
		const patch: LabIndexPatch = {};
		if (rev) patch.lastRevision = rev;
		if (meta?.summary && meta.summary !== entry?.summary) patch.summary = meta.summary;
		if (Object.keys(patch).length === 0) return;

		await labApi.updateIndex(this.projectPath, this.prototypeId, patch);
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
			this.publishSeq += 1;
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

/** La promessa si risolve a watcher fermo: chi cancella il workspace la attende. */
export async function disposeLabRuntime(projectId: string, laneId: string): Promise<void> {
	const key = `${projectId}:${laneId}`;
	const runtime = runtimes.get(key);
	if (runtime) {
		runtimes.delete(key);
		await runtime.stop();
	}
}
