/**
 * Stato della scheda «Progetto» (Gate R41): legge manifest, documenti e
 * diario del mese con `file_read` e risponde a «Chiedi al diario» con una
 * chiamata effimera (`project_docs_ask`). Non scrive mai: i file li mantiene
 * l'agente con il tool `project_docs`, o l'utente a mano nell'editor.
 */
import { invoke } from '@tauri-apps/api/core';
import { settingsStore } from '$lib/stores/settings.svelte';
import {
	DOC_ROLES,
	MANIFEST_REL,
	buildAskContext,
	defaultManifest,
	diaryRelFor,
	estimateTokens,
	parseDiary,
	parseManifest,
	previousMonth,
	type DiaryEntry,
	type DocRole,
	type ProjectDocsManifest
} from './projectDocs';

export interface ProjectDocInfo {
	role: DocRole;
	rel: string;
	lines: number;
	exists: boolean;
}

export interface ProjectDocsView {
	status: 'loading' | 'none' | 'ready' | 'error';
	manifest: ProjectDocsManifest | null;
	docs: ProjectDocInfo[];
	entries: DiaryEntry[];
	diaryRel: string | null;
	/** Caratteri totali di documenti e diario del mese (letti solo su richiesta). */
	totalChars: number;
	error?: string;
}

export interface AskState {
	question: string;
	answer: string | null;
	busy: boolean;
	error: string | null;
}

async function readRel(projectPath: string, rel: string): Promise<string | null> {
	try {
		const res = await invoke<{ content: string }>('file_read', { projectPath, rel });
		return res.content;
	} catch {
		return null;
	}
}

class ProjectDocsStore {
	views = $state<Record<string, ProjectDocsView>>({});
	asks = $state<Record<string, AskState>>({});
	private texts = new Map<string, { rel: string; text: string; diary?: boolean }[]>();
	private loading = new Map<string, Promise<void>>();

	view(projectPath: string): ProjectDocsView {
		return (
			this.views[projectPath] ?? {
				status: 'loading',
				manifest: null,
				docs: [],
				entries: [],
				diaryRel: null,
				totalChars: 0
			}
		);
	}

	ask(projectPath: string): AskState {
		return this.asks[projectPath] ?? { question: '', answer: null, busy: false, error: null };
	}

	/** Rilegge tutto; le chiamate concorrenti per lo stesso progetto si accodano alla prima. */
	load(projectPath: string): Promise<void> {
		const inflight = this.loading.get(projectPath);
		if (inflight) return inflight;
		const run = this.doLoad(projectPath).finally(() => this.loading.delete(projectPath));
		this.loading.set(projectPath, run);
		return run;
	}

	private async doLoad(projectPath: string) {
		if (!this.views[projectPath]) {
			this.views[projectPath] = this.view(projectPath);
		}
		try {
			const manifestText = await readRel(projectPath, MANIFEST_REL);
			let manifest = manifestText ? parseManifest(manifestText) : null;
			const now = new Date();
			if (!manifest) {
				// Senza manifest (per esempio .omp/ ignorato da git su un clone
				// nuovo) basta il diario nelle cartelle di default.
				for (const storage of ['repo', 'local'] as const) {
					const candidate = defaultManifest(storage);
					const probe =
						(await readRel(projectPath, diaryRelFor(candidate, now))) ??
						(await readRel(projectPath, candidate.docs.scopo));
					if (probe !== null) {
						manifest = candidate;
						break;
					}
				}
			}
			if (!manifest) {
				this.texts.delete(projectPath);
				this.views[projectPath] = { status: 'none', manifest: null, docs: [], entries: [], diaryRel: null, totalChars: 0 };
				return;
			}

			const files: { rel: string; text: string; diary?: boolean }[] = [];
			const docs: ProjectDocInfo[] = [];
			for (const role of DOC_ROLES) {
				const rel = manifest.docs[role];
				const text = await readRel(projectPath, rel);
				docs.push({ role, rel, lines: text ? text.split(/\r?\n/).length : 0, exists: text !== null });
				if (text) files.push({ rel, text });
			}
			const diaryRel = diaryRelFor(manifest, now);
			const prevRel = diaryRelFor(manifest, previousMonth(now));
			const current = await readRel(projectPath, diaryRel);
			const previous = await readRel(projectPath, prevRel);
			if (previous) files.push({ rel: prevRel, text: previous, diary: true });
			if (current) files.push({ rel: diaryRel, text: current, diary: true });
			const entries = [...(previous ? parseDiary(previous) : []), ...(current ? parseDiary(current) : [])];

			this.texts.set(projectPath, files);
			this.views[projectPath] = {
				status: 'ready',
				manifest,
				docs,
				entries,
				diaryRel: current !== null ? diaryRel : previous !== null ? prevRel : diaryRel,
				totalChars: files.reduce((sum, f) => sum + f.text.length, 0)
			};
		} catch (error) {
			this.views[projectPath] = {
				...this.view(projectPath),
				status: 'error',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	documentTokens(projectPath: string): number {
		return estimateTokens(this.view(projectPath).totalChars);
	}

	setQuestion(projectPath: string, question: string) {
		this.asks[projectPath] = { ...this.ask(projectPath), question };
	}

	clearAnswer(projectPath: string) {
		this.asks[projectPath] = { ...this.ask(projectPath), answer: null, error: null };
	}

	/** Risposta effimera: nessuna sessione, nessuna scrittura. */
	async submitQuestion(projectPath: string): Promise<void> {
		const state = this.ask(projectPath);
		const question = state.question.trim();
		if (!question || state.busy) return;
		this.asks[projectPath] = { ...state, busy: true, answer: null, error: null };
		try {
			await this.load(projectPath);
			const context = buildAskContext(question, this.texts.get(projectPath) ?? []);
			const modelSelector = settingsStore.suggestions.modelSelector.trim() || null;
			const answer = await invoke<string | null>('project_docs_ask', { question, context, modelSelector });
			this.asks[projectPath] = { ...this.ask(projectPath), busy: false, answer: answer ?? null, error: answer ? null : 'empty' };
		} catch (error) {
			this.asks[projectPath] = {
				...this.ask(projectPath),
				busy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
}

export const projectDocsStore = new ProjectDocsStore();
