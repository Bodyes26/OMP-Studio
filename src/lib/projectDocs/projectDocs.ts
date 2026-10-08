/**
 * Diario di progetto lato Studio (Gate R3X-diario): funzioni pure.
 *
 * Il formato dei file e del manifest e' quello dell'estensione
 * `extensions/studio-docs.ts`, che li scrive. L'estensione gira dentro omp e
 * usa `node:fs`, quindi non si importa nel webview: le poche regole condivise
 * (ruoli, percorsi di default, lettura del manifest) sono ripetute qui e un
 * test di contratto verifica che restino allineate.
 */

export const DOC_ROLES = ['scopo', 'uso', 'decisioni', 'storia', 'domande-aperte'] as const;
export type DocRole = (typeof DOC_ROLES)[number];
export type DocsStorage = 'repo' | 'local';

export interface ProjectDocsManifest {
	version: 1;
	storage: DocsStorage;
	diaryDir: string;
	docs: Record<DocRole, string>;
	initializedAt?: string;
}

export const MANIFEST_REL = '.omp/progetto.json';

/** Token nel prompt per ogni turno: la riga aggiunta dall'estensione (stima). */
export const PROMPT_LINE_TOKENS = 60;

function toPosix(path: string): string {
	return path.replace(/\\/g, '/');
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

export function defaultManifest(storage: DocsStorage = 'repo'): ProjectDocsManifest {
	const base = storage === 'local' ? '.omp/progetto' : 'docs/progetto';
	const docs = {} as Record<DocRole, string>;
	for (const role of DOC_ROLES) docs[role] = `${base}/${role}.md`;
	return { version: 1, storage, diaryDir: storage === 'local' ? '.omp/progetto/diario' : 'docs/diario', docs };
}

/** Manifest letto da `.omp/progetto.json`; null se illeggibile. */
export function parseManifest(text: string): ProjectDocsManifest | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object') return null;
	const rec = raw as Record<string, unknown>;
	const storage: DocsStorage = rec.storage === 'local' ? 'local' : 'repo';
	const base = defaultManifest(storage);
	const rawDocs = rec.docs && typeof rec.docs === 'object' ? (rec.docs as Record<string, unknown>) : {};
	const docs = { ...base.docs };
	for (const role of DOC_ROLES) {
		const value = rawDocs[role];
		if (typeof value === 'string' && value.trim()) docs[role] = toPosix(value.trim());
	}
	return {
		version: 1,
		storage,
		diaryDir: typeof rec.diaryDir === 'string' && rec.diaryDir.trim() ? toPosix(rec.diaryDir.trim()) : base.diaryDir,
		docs,
		initializedAt: typeof rec.initializedAt === 'string' ? rec.initializedAt : undefined
	};
}

export function diaryRelFor(manifest: ProjectDocsManifest, date: Date): string {
	return `${manifest.diaryDir}/${date.getFullYear()}-${pad(date.getMonth() + 1)}.md`;
}

/** Mese precedente: le ultime voci possono stare li' nei primi giorni del mese. */
export function previousMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

/** Documento di default (non mappato su un file dell'utente). */
export function isDefaultDoc(manifest: ProjectDocsManifest, role: DocRole): boolean {
	return manifest.docs[role] === defaultManifest(manifest.storage).docs[role];
}

/* ---------------------------------------------------------------- diario */

export interface DiarySource {
	kind: 'sessione' | 'commit' | 'altro';
	id: string;
	label: string;
}

export interface DiaryEntry {
	date: string;
	text: string;
	sources: DiarySource[];
}

const SOURCE_RE = /\[(sessione|session|commit)\s+([^\]]+)\]/gi;

function parseSources(line: string): { text: string; sources: DiarySource[] } {
	const sources: DiarySource[] = [];
	const text = line
		.replace(SOURCE_RE, (_m, kind: string, id: string) => {
			const k = /^commit$/i.test(kind) ? 'commit' : 'sessione';
			sources.push({ kind: k, id: id.trim(), label: `${k} ${id.trim()}` });
			return '';
		})
		.replace(/\s+/g, ' ')
		.trim();
	return { text, sources };
}

/** Voci del diario mensile: un punto elenco sotto `## AAAA-MM-GG` e' una voce. */
export function parseDiary(md: string): DiaryEntry[] {
	const entries: DiaryEntry[] = [];
	let date = '';
	for (const line of md.split(/\r?\n/)) {
		const heading = /^##\s+(\d{4}-\d{2}-\d{2})\b/.exec(line);
		if (heading) {
			date = heading[1];
			continue;
		}
		const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
		if (bullet && date) {
			const { text, sources } = parseSources(bullet[1]);
			if (text) entries.push({ date, text, sources });
		}
	}
	return entries;
}

/** Le ultime `count` voci, dalla piu' recente. */
export function latestEntries(entries: readonly DiaryEntry[], count: number): DiaryEntry[] {
	return entries.slice(-count).reverse();
}

/* ------------------------------------------------------- chiedi al diario */

export interface DocChunk {
	rel: string;
	heading: string;
	body: string;
}

/** Spezza un markdown in sezioni per titolo (fuori dai blocchi di codice). */
export function chunkMarkdown(rel: string, md: string): DocChunk[] {
	const chunks: DocChunk[] = [];
	let heading = '';
	let body: string[] = [];
	let inFence = false;
	const flush = () => {
		const text = body.join('\n').trim();
		if (text) chunks.push({ rel, heading, body: text });
		body = [];
	};
	for (const line of md.split(/\r?\n/)) {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
		const match = !inFence ? /^#{1,6}\s+(.*)$/.exec(line) : null;
		if (match) {
			flush();
			heading = match[1].trim();
		} else {
			body.push(line);
		}
	}
	flush();
	return chunks;
}

function words(text: string): string[] {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 4);
}

/**
 * Contesto per la domanda: le sezioni con piu' parole in comune con la
 * domanda, piu' sempre le ultime voci del diario, entro `maxChars`. Non si
 * manda tutto: il costo resta quello di qualche sezione.
 */
export function buildAskContext(
	question: string,
	files: readonly { rel: string; text: string; diary?: boolean }[],
	maxChars = 16000
): string {
	const q = new Set(words(question));
	const scored: { chunk: DocChunk; score: number; order: number }[] = [];
	let order = 0;
	for (const file of files) {
		for (const chunk of chunkMarkdown(file.rel, file.text)) {
			const ws = words(`${chunk.heading} ${chunk.body}`);
			let score = 0;
			for (const w of ws) if (q.has(w)) score += 1;
			// Le voci recenti del diario contano sempre un po': «cosa e' successo» spesso non ripete le parole.
			if (file.diary) score += 0.5;
			scored.push({ chunk, score, order: order++ });
		}
	}
	const picked = scored
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score || b.order - a.order);
	const parts: string[] = [];
	let used = 0;
	for (const { chunk } of picked) {
		const block = `## ${chunk.rel}${chunk.heading ? ` › ${chunk.heading}` : ''}\n${chunk.body}\n`;
		if (used + block.length > maxChars) {
			if (used === 0) parts.push(block.slice(0, maxChars));
			break;
		}
		parts.push(block);
		used += block.length;
	}
	return parts.join('\n');
}

/** Stima grezza dei token di un testo (circa 4 caratteri per token). */
export function estimateTokens(chars: number): number {
	return Math.round(chars / 4);
}
