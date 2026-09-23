import { isWindows, normalizeProjectPath, pathKey } from '../utils/paths.ts';
import type { TaskDefaults } from './settings.svelte.ts';

export type ProjectColorMode = 'auto' | 'custom';

export interface ProjectLayout {
	left: number;
	center: number;
	leftSection: 'files' | 'sessions';
	editorOpen: boolean;
}

export interface StoredProjectMetadata {
	id?: string;
	path: string;
	name: string;
	label?: string | null;
	hue?: number;
	colorMode?: ProjectColorMode;
	layout?: Partial<ProjectLayout>;
	autoDispatch?: boolean;
	taskDefaults?: Partial<TaskDefaults> | null;
	browserAllowedOrigins?: string[];
	lastOpened?: number;
}

export interface ResolvedProjectTabInfo {
	id?: string;
	name: string;
	label: string | null;
	hue: number;
	colorMode: ProjectColorMode;
	layout: ProjectLayout;
	autoDispatch: boolean;
	taskDefaults: Partial<TaskDefaults> | null;
	browserAllowedOrigins?: string[];
}

/**
 * Determina se un file e' contenuto in una cartella o coincide con un target.
 */
export function isPathUnder(filePath: string, targetPath: string, isDir: boolean): boolean {
	const normFile = filePath.replace(/\\/g, '/');
	const normTarget = targetPath.replace(/\\/g, '/').replace(/\/+$/, '');
	const fileMatch = normFile === normTarget || (isWindows && normFile.toLowerCase() === normTarget.toLowerCase());
	if (fileMatch) return true;
	if (isDir) {
		if (normFile.startsWith(normTarget + '/')) return true;
		if (isWindows) {
			const lowFile = normFile.toLowerCase();
			const lowTarget = normTarget.toLowerCase();
			return lowFile.startsWith(lowTarget + '/');
		}
	}
	return false;
}

/**
 * Ricalcola il percorso di un file aperto dopo la rinomina di un elemento o della sua cartella padre.
 */
export function remapPath(filePath: string, from: string, to: string, isDir: boolean): string | null {
	const normFile = filePath.replace(/\\/g, '/');
	const normFrom = from.replace(/\\/g, '/').replace(/\/+$/, '');
	const normTo = to.replace(/\\/g, '/').replace(/\/+$/, '');

	if (isDir) {
		if (normFile === normFrom || (isWindows && normFile.toLowerCase() === normFrom.toLowerCase())) {
			return to;
		}
		if (normFile.startsWith(normFrom + '/')) {
			const suffix = normFile.slice(normFrom.length);
			const joined = normTo + suffix;
			return (to.includes('\\') || filePath.includes('\\')) ? joined.replace(/\//g, '\\') : joined;
		}
		if (isWindows && normFile.toLowerCase().startsWith(normFrom.toLowerCase() + '/')) {
			const suffix = normFile.slice(normFrom.length);
			const joined = normTo + suffix;
			return (to.includes('\\') || filePath.includes('\\')) ? joined.replace(/\//g, '\\') : joined;
		}
	} else {
		if (normFile === normFrom || (isWindows && normFile.toLowerCase() === normFrom.toLowerCase())) {
			return to;
		}
	}
	return null;
}

/**
 * Applica la rinomina di un file o directory a un elenco di file aperti e all'eventuale activeFile.
 */
export function applyTabRename(
	openFiles: readonly string[],
	activeFile: string | null,
	from: string,
	to: string,
	isDir: boolean
): { openFiles: string[]; activeFile: string | null } {
	let activeChanged = false;
	let newActive = activeFile;
	const updated = openFiles.map((file) => {
		const remapped = remapPath(file, from, to, isDir);
		if (remapped) {
			if (activeFile === file) {
				newActive = remapped;
				activeChanged = true;
			}
			return remapped;
		}
		return file;
	});
	return { openFiles: updated, activeFile: activeChanged ? newActive : activeFile };
}

/**
 * Rimuove i file cestinati e determina il nuovo tab attivo adiacente.
 */
export function applyTabTrash(
	openFiles: readonly string[],
	activeFile: string | null,
	targetPath: string,
	isDir: boolean
): { openFiles: string[]; activeFile: string | null } {
	const isUnderTrash = (file: string) => isPathUnder(file, targetPath, isDir);
	const activeIsRemoved = activeFile !== null && isUnderTrash(activeFile);
	const activeIndex = activeFile !== null ? openFiles.indexOf(activeFile) : -1;

	const remaining: string[] = [];
	let nextActiveCandidate: string | null = null;
	let prevActiveCandidate: string | null = null;

	for (let i = 0; i < openFiles.length; i++) {
		const file = openFiles[i];
		if (!isUnderTrash(file)) {
			remaining.push(file);
			if (i > activeIndex && nextActiveCandidate === null) {
				nextActiveCandidate = file;
			}
			if (i < activeIndex) {
				prevActiveCandidate = file;
			}
		}
	}

	return {
		openFiles: remaining,
		activeFile: activeIsRemoved ? (nextActiveCandidate ?? prevActiveCandidate ?? null) : activeFile
	};
}

/**
 * Riordina un array di elementi spostando l'elemento con id `fromId` alla posizione di `targetId`.
 */
export function reorderItemsList<T extends { id: string }>(items: T[], fromId: string, targetId: string): T[] {
	if (fromId === targetId) return items;
	const from = items.findIndex((p) => p.id === fromId);
	const targetIdx = items.findIndex((p) => p.id === targetId);
	if (from === -1 || targetIdx === -1) return items;
	const [moved] = items.splice(from, 1);
	const to = items.findIndex((p) => p.id === targetId);
	items.splice(to, 0, moved);
	return items;
}

/**
 * Sposta un elemento di `delta` posizioni rispettando i limiti della lista.
 */
export function shiftItemList<T extends { id: string }>(items: T[], id: string, delta: number): T[] {
	const from = items.findIndex((p) => p.id === id);
	if (from === -1) return items;
	const to = Math.max(0, Math.min(items.length - 1, from + delta));
	if (to === from) return items;
	const [moved] = items.splice(from, 1);
	items.splice(to, 0, moved);
	return items;
}

/**
 * Costruisce l'oggetto di metadati persistibili per una scheda progetto.
 * Ritorna null se il progetto non ha un percorso canonico su disco (es. Scratchpad).
 */
export function buildProjectMetadata(p: {
	id?: string;
	name: string;
	label: string | null;
	canonicalProjectPath: string | null;
	hue: number;
	colorMode: ProjectColorMode;
	layout?: Partial<ProjectLayout>;
	lastOpened?: number;
	autoDispatch?: boolean;
	taskDefaults?: Partial<TaskDefaults> | null;
	browserAllowedOrigins?: string[];
}): StoredProjectMetadata | null {
	if (!p.canonicalProjectPath) return null;
	const normPath = normalizeProjectPath(p.canonicalProjectPath);
	if (!normPath) return null;

	return {
		id: p.id,
		path: normPath,
		name: p.name.trim(),
		label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : null,
		hue: p.hue,
		colorMode: p.colorMode,
		layout: p.layout
			? {
					left: typeof p.layout.left === 'number' ? p.layout.left : 260,
					center: typeof p.layout.center === 'number' ? p.layout.center : 0.5,
					leftSection: p.layout.leftSection === 'sessions' ? 'sessions' : 'files',
					editorOpen: p.layout.editorOpen !== false
				}
			: undefined,
		lastOpened: typeof p.lastOpened === 'number' ? p.lastOpened : Date.now(),
		autoDispatch: p.autoDispatch === true,
		taskDefaults: p.taskDefaults && typeof p.taskDefaults === 'object' ? p.taskDefaults : null,
		browserAllowedOrigins: Array.isArray(p.browserAllowedOrigins)
			? [...p.browserAllowedOrigins]
			: undefined
	};
}

/**
 * Risolve le informazioni da applicare alla tab quando un progetto viene aperto,
 * fondendo eventuali metadati salvati in precedenza con i valori predefiniti di fabbrica.
 */
export function resolveProjectTabInfo(
	path: string,
	meta: StoredProjectMetadata | undefined,
	defaultHue: number
): ResolvedProjectTabInfo {
	const norm = normalizeProjectPath(path);
	const defaultName = norm ? norm.split(/[\\/]/).pop() || 'Unknown' : 'Unknown';

	const name = meta?.name && meta.name.trim() ? meta.name.trim() : defaultName;
	const label = typeof meta?.label === 'string' && meta.label.trim() ? meta.label.trim() : null;
	const hue = typeof meta?.hue === 'number' ? meta.hue : defaultHue;
	const colorMode: ProjectColorMode = meta?.colorMode === 'custom' ? 'custom' : 'auto';

	return {
		id: meta?.id,
		name,
		label,
		hue,
		colorMode,
		layout: {
			left: typeof meta?.layout?.left === 'number' ? meta.layout.left : 260,
			center: typeof meta?.layout?.center === 'number' ? meta.layout.center : 0.5,
			leftSection: meta?.layout?.leftSection === 'sessions' ? 'sessions' : 'files',
			editorOpen: meta?.layout?.editorOpen !== false
		},
		autoDispatch: meta?.autoDispatch === true,
		taskDefaults:
			meta?.taskDefaults && typeof meta.taskDefaults === 'object' ? meta.taskDefaults : null,
		browserAllowedOrigins: Array.isArray(meta?.browserAllowedOrigins)
			? [...meta.browserAllowedOrigins]
			: undefined
	};
}

/**
 * Crea una mappa dei metadati indicizzata per chiave normalizzata (`pathKey(path)`).
 */
export function createProjectMetadataMap(
	items?: StoredProjectMetadata[] | null
): Map<string, StoredProjectMetadata> {
	const map = new Map<string, StoredProjectMetadata>();
	if (!Array.isArray(items)) return map;

	for (const item of items) {
		if (!item || typeof item.path !== 'string') continue;
		const norm = normalizeProjectPath(item.path);
		if (!norm) continue;
		const key = pathKey(norm);
		const existing = map.get(key);
		if (!existing || (item.lastOpened ?? 0) >= (existing.lastOpened ?? 0)) {
			map.set(key, { ...item, path: norm });
		}
	}
	return map;
}

/**
 * Ordina i metadati per apertura piu recente e limita il numero massimo di voci persistite.
 */
export function pruneProjectMetadata(
	items: StoredProjectMetadata[],
	maxEntries = 200
): StoredProjectMetadata[] {
	if (items.length <= maxEntries) return items;
	return [...items]
		.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
		.slice(0, maxEntries);
}
