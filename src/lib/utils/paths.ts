/**
 * Funzioni pure di normalizzazione e manipolazione dei percorsi di progetto.
 * Isolate da Tauri e dal DOM per essere eseguibili in modo deterministico
 * sia nel frontend Svelte che negli smoke test in ambiente Node/CI.
 */

function checkIsWindows(): boolean {
	const g: Record<string, unknown> = typeof globalThis !== 'undefined' ? (globalThis as unknown as Record<string, unknown>) : {};
	const proc = g['process'];
	if (proc && typeof proc === 'object' && 'platform' in proc) {
		const platform = (proc as { platform?: unknown }).platform;
		if (typeof platform === 'string') {
			return platform === 'win32';
		}
	}
	if (typeof navigator !== 'undefined') {
		return /win/i.test((navigator.userAgent || navigator.platform || '').toLowerCase());
	}
	return false;
}

export const isWindows = checkIsWindows();
/**
 * Normalizza il percorso di un progetto in base al sistema operativo.
 * Parametro opzionale `win` per forzare la semantica Windows/POSIX (utile nei test).
 */
export function normalizeProjectPath(p: string, win: boolean = isWindows): string {
	if (!p) return '';
	if (win) {
		let out = p.replace(/\//g, '\\').replace(/\\+$/, '');
		if (/^[A-Za-z]:$/.test(out)) out += '\\';
		return out;
	} else {
		let out = p.replace(/\\/g, '/').replace(/\/+$/, '');
		if (out === '') return '/';
		return out;
	}
}

/**
 * Chiave canonica per mappe e Set di progetti (case-insensitive su Windows).
 */
export function pathKey(p: string, win: boolean = isWindows): string {
	return normalizeProjectPath(p, win).toLowerCase();
}

/**
 * Unisce il percorso base del progetto con un percorso relativo.
 */
export function joinProjectPath(projectPath: string, rel: string, win: boolean = isWindows): string {
	if (!rel) return projectPath;
	if (win) {
		const base = projectPath.endsWith('\\') ? projectPath.slice(0, -1) : projectPath;
		const cleanRel = rel.replace(/\//g, '\\').replace(/^\\+/, '');
		return `${base}\\${cleanRel}`;
	} else {
		const base = projectPath.endsWith('/') ? projectPath.slice(0, -1) : projectPath;
		const child = rel.startsWith('/') ? rel.slice(1) : rel;
		return `${base}/${child.replace(/\\/g, '/')}`;
	}
}
