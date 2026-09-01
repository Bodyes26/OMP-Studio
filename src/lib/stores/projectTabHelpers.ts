import { isWindows } from '../utils/paths.ts';

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
