// Runtime reattivo per corsia Laboratorio (Svelte 5 runes).
//
// Governa il ciclo di vita dell'anteprima:
//  - Watcher del filesystem con debounce a 150 ms;
//  - Compilazione esbuild su Web Worker e pubblicazione sul server loopback Rust;
//  - Aggiornamento continuo di .lab/preview-status.json con errori di compilazione e runtime;
//  - Chiusura revisione git (commit automatico) a fine turno agente e sync titolo/indice;
//  - Consultazione storica e ripristino di revisioni precedenti.

import type { UnlistenFn } from '#lib/backend/ipc.ts';
import type { AgentSession } from '#lib/agent/session.svelte.ts';
import { labApi as localLabApi, type LabApi } from './api';
import { compileLabPrototypeInWorker } from './compiler';
import { buildLabPreviewHtml } from './preview-builder';
import { ensureSharedVendorPublished } from './sharedVendor';
import { m } from '#lib/paraglide/messages.js';
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
	/**
	 * Comandi del Laboratorio della superficie (S3-link-front-05): su un
	 * progetto di un'altra macchina leggono e scrivono li'. Assente = questa.
	 */
	api?: LabApi;
}

export class LabLaneRuntime {
	readonly projectId: string;
	readonly laneId: string;
	readonly prototypeId: string;
	readonly workspacePath: string;
	readonly projectPath: string | null;
	readonly session: AgentSession;
	readonly api: LabApi;

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
	/** Chiave pubblicata per la revisione storica mostrata: si toglie quando si esce. */
	private historicalKey: string | null = null;

	constructor(config: LabLaneRuntimeConfig) {
		this.projectId = config.projectId;
		this.laneId = config.laneId;
		this.prototypeId = config.prototypeId;
		this.workspacePath = config.workspacePath;
		this.projectPath = config.projectPath;
		this.session = config.session;
		this.api = config.api ?? localLabApi;
		// Chiave del watcher indipendente dalla macchina: l'id di progetto e'
		// gia' unico, e `disposeLabRuntime` la ricostruisce senza sapere dove
		// gira il Laboratorio.
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
			await this.api.watchStart(this.workspacePath, this.watchKey);
			if (stopped()) {
				// Un avvio piu' recente usa la stessa chiave: il suo watcher non va toccato.
				if (!this.isStarted) await this.api.watchStop(this.watchKey).catch(() => {});
				return;
			}

			// L'ascolto passa dal backend della superficie: su un progetto di
			// un'altra macchina l'evento arriva instradato (S3-link-front-05).
			const unlisten = await this.api.backend.listen<LabChangedEvent>(LAB_CHANGED_EVENT, (event) => {
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

		await this.api.watchStop(this.watchKey).catch(() => {});
		// Anche la revisione storica pubblicata esce dal server (S8-17).
		await this.dropHistoricalPublish();
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
			const files = await this.api.snapshot(this.workspacePath);
			const sourceStamp = Date.now();
			const result = await compileLabPrototypeInWorker(files);
			this.compileErrors = result.errors;
			this.runtimeErrors = [];

			if (!result.ok) {
				await this.api.writePreviewStatus(this.workspacePath, {
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

			const published = await this.api.publish(key, servedFiles);
			this.url = published.url;
			this.publishSeq += 1;
			this.lastCompiledAt = Date.now();
			this.lastSourceStamp = sourceStamp;

			await this.api.writePreviewStatus(this.workspacePath, {
				url: published.url,
				compiledAt: this.lastCompiledAt,
				sourceStamp,
				ok: true,
				errors: []
			});
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			this.compileErrors = [{ kind: 'compile', message: errMsg }];
			await this.api.writePreviewStatus(this.workspacePath, {
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

		void this.api
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
			let commitMsg: string = m.l10n_lab_remote_commit_default_message();
			if (lastUserEntry) {
				const text = lastUserEntry.content ?? '';
				const firstLine = text.trim().split('\n')[0]?.trim();
				if (firstLine) {
					commitMsg = firstLine.slice(0, 72);
				}
			}

			const rev = await this.api.commit(this.workspacePath, commitMsg);
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
			this.api.readMeta(this.workspacePath),
			this.api.listIndex(this.projectPath)
		]);
		const entry = index.find((e) => e.id === this.prototypeId);
		const patch: LabIndexPatch = {};
		if (rev) patch.lastRevision = rev;
		if (meta?.summary && meta.summary !== entry?.summary) patch.summary = meta.summary;
		if (Object.keys(patch).length === 0) return;

		await this.api.updateIndex(this.projectPath, this.prototypeId, patch);
	}

	async viewRevision(sha: string): Promise<void> {
		this.isCompiling = true;
		try {
			await ensureSharedVendorPublished();
			const files = await this.api.filesAt(this.workspacePath, sha);
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
			// La revisione aperta prima esce dal server: senza, ogni revisione
			// guardata restava in memoria fino all'uscita (S8-17).
			await this.dropHistoricalPublish();
			const published = await this.api.publish(key, [
				{ path: 'index.html', content: html, contentType: 'text/html' },
				{ path: 'app.js', content: result.compiledJs, contentType: 'application/javascript' }
			]);
			this.historicalKey = key;
			this.url = published.url;
			this.publishSeq += 1;
			this.activeRevisionSha = sha;
			this.isViewingHistorical = true;
		} finally {
			this.isCompiling = false;
		}
	}

	/**
	 * Il server di anteprima tiene in memoria ogni chiave pubblicata: le
	 * revisioni storiche restavano li' fino all'uscita (S8-17). Si toglie la
	 * precedente quando se ne apre un'altra, e tutte all'uscita dalla storia.
	 */
	private async dropHistoricalPublish(): Promise<void> {
		const key = this.historicalKey;
		if (!key) return;
		this.historicalKey = null;
		await this.api.unpublish(key).catch(() => undefined);
	}

	async restoreRevision(sha: string): Promise<void> {
		this.isCompiling = true;
		try {
			await this.api.restore(this.workspacePath, sha);
			this.isViewingHistorical = false;
			this.activeRevisionSha = null;
			await this.dropHistoricalPublish();
			await this.recompileAndPublish();
		} finally {
			this.isCompiling = false;
		}
	}

	async returnToCurrent(): Promise<void> {
		this.isViewingHistorical = false;
		this.activeRevisionSha = null;
		await this.dropHistoricalPublish();
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

/**
 * Anteprima di una corsia Lab senza crearne il runtime: `null` se in questa
 * sessione di Studio l'anteprima non e' mai stata montata. Serve ai tool
 * `corsia_risultato`/`corsia_consegna`, che leggono e non devono avviare nulla.
 */
export function peekLabRuntime(projectId: string, laneId: string): { url: string | null; errors: number } | null {
	const runtime = runtimes.get(`${projectId}:${laneId}`);
	if (!runtime) return null;
	return { url: runtime.url, errors: runtime.allErrors.length };
}
