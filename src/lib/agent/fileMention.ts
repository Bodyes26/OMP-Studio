import { matchesLooseQuery } from '../looseSearch.ts';
import { invoke } from '@tauri-apps/api/core';

/**
 * Directory di compilazione, cache e rumore da escludere categoricamente
 * dalla ricerca e dai suggerimenti dei file del progetto.
 */
export const EXCLUDED_DIRS: Record<string, true> = {
	'.git': true,
	node_modules: true,
	bin: true,
	obj: true,
	dist: true,
	target: true,
	'.vs': true,
	packages: true,
	'.svelte-kit': true,
	'.next': true,
	'.nuxt': true,
	build: true,
	'.cache': true
};

export function isExcludedPath(path: string): boolean {
	const normalized = path.replace(/\\/g, '/');
	const segments = normalized.split('/');
	return segments.some((segment) => Boolean(EXCLUDED_DIRS[segment.toLowerCase()]));
}

export interface FileMentionMatch {
	query: string;
	startIndex: number;
	endIndex: number;
}

/**
 * Rileva il token di menzione file ('@...') alla posizione corrente del cursore.
 * Riconosce '@' solo se:
 * 1. Si trova a inizio testo o preceduto da spazio/a capo (evita indirizzi email o decoratori).
 * 2. Non contiene ritorni a capo o spazi tra '@' e la posizione del cursore.
 */
export function extractFileMentionAtCursor(
	text: string,
	cursorPos: number
): FileMentionMatch | null {
	if (cursorPos < 0 || cursorPos > text.length) return null;
	const beforeCursor = text.slice(0, cursorPos);
	const lastAtIndex = beforeCursor.lastIndexOf('@');
	if (lastAtIndex === -1) return null;

	// Verifica che '@' sia a inizio riga/testo o preceduto da whitespace
	if (lastAtIndex > 0) {
		const charBefore = text[lastAtIndex - 1];
		if (!charBefore || !/\s/.test(charBefore)) {
			return null;
		}
	}

	// Non deve attraversare a capo tra '@' e il cursore
	const betweenAtAndCursor = beforeCursor.slice(lastAtIndex);
	if (betweenAtAndCursor.includes('\n') || betweenAtAndCursor.includes('\r')) {
		return null;
	}

	// Se l'utente ha digitato uno spazio dopo '@', la menzione e' conclusa
	const query = beforeCursor.slice(lastAtIndex + 1);
	if (query.includes(' ') || query.includes('\t')) {
		return null;
	}

	// Calcola l'indice di fine token dopo il cursore (fino al prossimo whitespace o fine testo)
	let endIndex = cursorPos;
	while (endIndex < text.length && !/\s/.test(text[endIndex])) {
		endIndex++;
	}

	return {
		query,
		startIndex: lastAtIndex,
		endIndex
	};
}

/**
 * Sostituisce il token '@query' alla posizione del cursore con il percorso relativo del file.
 * Aggiunge uno spazio successivo se non già presente per facilitare la continuazione della digitazione.
 */
export function insertFileMentionAtCursor(
	text: string,
	startIndex: number,
	endIndex: number,
	filePath: string
): { newText: string; newCursorPos: number } {
	const before = text.slice(0, startIndex);
	const after = text.slice(endIndex);
	const normalizedPath = filePath.replace(/\\/g, '/');
	const mentionText = `@${normalizedPath} `;
	const newText = before + mentionText + after;
	const newCursorPos = before.length + mentionText.length;
	return {
		newText,
		newCursorPos
	};
}

/**
 * Estrae i file recentemente toccati dall'agente (lettura, scrittura, edit)
 * a ritroso dalla cronologia dei tool della sessione.
 */
export function extractTouchedFilesFromTranscript(
	entries: Array<{ kind: string; args?: unknown }>
): string[] {
	const touched: string[] = [];
	const seen = new Set<string>();

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.kind !== 'tool' || !entry.args || typeof entry.args !== 'object') continue;
		const args = entry.args as Record<string, unknown>;

		const candidates: string[] = [];
		if (typeof args.path === 'string' && args.path) {
			candidates.push(args.path);
		}
		if (typeof args.file === 'string' && args.file) {
			candidates.push(args.file);
		}
		if (Array.isArray(args.paths)) {
			for (const p of args.paths) {
				if (typeof p === 'string' && p) candidates.push(p);
			}
		}

		for (const raw of candidates) {
			const norm = raw.replace(/\\/g, '/').replace(/^\.?\//, '').trim();
			if (!norm || seen.has(norm) || isExcludedPath(norm)) continue;
			seen.add(norm);
			touched.push(norm);
		}
	}

	return touched;
}

export type FilePriority = 'active' | 'open' | 'touched' | 'project';

export interface RankedFileItem {
	path: string;
	name: string;
	dir: string;
	priority: FilePriority;
	score: number;
}

export interface FileRankingContext {
	activeFile?: string | null;
	openFiles?: readonly string[];
	touchedFiles?: readonly string[];
}

/**
 * Filtra e ordina i file candidati usando looseSearch.ts, dando priorita
 * a file attivo Monaco, file aperti, file toccati dall'agente, e rilevanza della query.
 */
export function rankFileCandidates(
	query: string,
	allFiles: readonly string[],
	context: FileRankingContext,
	limit = 8
): RankedFileItem[] {
	const q = query.trim();
	const cleanQ = q.toLowerCase();

	const activeNorm = context.activeFile?.replace(/\\/g, '/').replace(/^\.?\//, '') ?? null;
	const openList = (context.openFiles ?? []).map((f) => f.replace(/\\/g, '/').replace(/^\.?\//, ''));
	const touchedList = (context.touchedFiles ?? []).map((f) => f.replace(/\\/g, '/').replace(/^\.?\//, ''));

	// Set di tutti i file noti (inclusi prioritari non ancora presenti nel catalogo su disco)
	const seenPaths = new Set<string>();
	const candidates: string[] = [];

	// Prima aggiungi i prioritari
	if (activeNorm && !isExcludedPath(activeNorm)) {
		seenPaths.add(activeNorm);
		candidates.push(activeNorm);
	}
	for (const f of openList) {
		if (f && !seenPaths.has(f) && !isExcludedPath(f)) {
			seenPaths.add(f);
			candidates.push(f);
		}
	}
	for (const f of touchedList) {
		if (f && !seenPaths.has(f) && !isExcludedPath(f)) {
			seenPaths.add(f);
			candidates.push(f);
		}
	}
	// Poi aggiungi i restanti file di progetto
	for (const f of allFiles) {
		const norm = f.replace(/\\/g, '/').replace(/^\.?\//, '');
		if (norm && !seenPaths.has(norm) && !isExcludedPath(norm)) {
			seenPaths.add(norm);
			candidates.push(norm);
		}
	}

	const ranked: RankedFileItem[] = [];

	for (const filePath of candidates) {
		const lastSlash = filePath.lastIndexOf('/');
		const name = lastSlash !== -1 ? filePath.slice(lastSlash + 1) : filePath;
		const dir = lastSlash !== -1 ? filePath.slice(0, lastSlash) : '';

		// Filtro con il modulo fuzzy di Studio: looseSearch
		if (q && !matchesLooseQuery(q, name, filePath)) {
			continue;
		}

		let priority: FilePriority = 'project';
		let score = 0;

		if (activeNorm && filePath === activeNorm) {
			priority = 'active';
			score += 1000;
		} else {
			const openIdx = openList.indexOf(filePath);
			if (openIdx !== -1) {
				priority = 'open';
				score += Math.max(400, 600 - openIdx * 15);
			} else {
				const touchedIdx = touchedList.indexOf(filePath);
				if (touchedIdx !== -1) {
					priority = 'touched';
					score += Math.max(150, 300 - touchedIdx * 10);
				}
			}
		}

		// Rilevanza della query sul nome file e sul percorso
		if (cleanQ.length > 0) {
			const nameLower = name.toLowerCase();
			const pathLower = filePath.toLowerCase();

			// Corrispondenza esatta o esatta senza estensione
			if (nameLower === cleanQ || nameLower.startsWith(cleanQ + '.')) {
				score += 300;
			} else if (nameLower.startsWith(cleanQ)) {
				score += 200;
			} else if (nameLower.includes(cleanQ)) {
				score += 100;
			} else if (pathLower.startsWith(cleanQ)) {
				score += 60;
			} else if (pathLower.includes(cleanQ)) {
				score += 30;
			}

			// Penalita' per annidamento profondo
			const depth = dir ? dir.split('/').length : 0;
			score -= Math.min(40, depth * 4);
		}

		ranked.push({
			path: filePath,
			name,
			dir,
			priority,
			score
		});
	}

	// Ordina decrescente per punteggio, poi alfabetico sul nome
	ranked.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.name.localeCompare(b.name);
	});

	return ranked.slice(0, limit);
}

// Cache in memoria dei file di progetto per percorso con TTL di 10 secondi
interface CachedCatalog {
	files: string[];
	timestamp: number;
}
const projectFilesCache = new Map<string, CachedCatalog>();
const CACHE_TTL_MS = 10_000;

/**
 * Carica e memorizza nella cache l'elenco dei file del progetto attivo.
 */
export async function loadProjectFiles(
	projectPath: string,
	force = false
): Promise<string[]> {
	if (!projectPath) return [];

	const now = Date.now();
	const cached = projectFilesCache.get(projectPath);
	if (!force && cached && now - cached.timestamp < CACHE_TTL_MS) {
		return cached.files;
	}

	try {
		const files = await invoke<string[]>('project_files_list', {
			projectPath,
			limit: 3000
		});
		const normalized = (files || [])
			.map((f) => f.replace(/\\/g, '/').replace(/^\.?\//, ''))
			.filter((f) => Boolean(f) && !isExcludedPath(f));

		projectFilesCache.set(projectPath, {
			files: normalized,
			timestamp: now
		});
		return normalized;
	} catch {
		// In ambiente non Tauri o mock, ritorna la cache esistente o vuoto
		return cached?.files ?? [];
	}
}

/**
 * Invalida la cache dei file del progetto (es. dopo creazione/cancellazione).
 */
export function invalidateProjectFilesCache(projectPath?: string) {
	if (projectPath) {
		projectFilesCache.delete(projectPath);
	} else {
		projectFilesCache.clear();
	}
}
