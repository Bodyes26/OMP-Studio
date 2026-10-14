/**
 * Progetti da remoto (Gate R44, R7): cartelle sotto la radice dei progetti,
 * apertura e creazione con il flusso della GUI.
 */

import type { RemoteFolder, RemoteFolderList } from '$remote-protocol';
import { RemoteCommandFailure } from './commands';
import { isWindows, joinProjectPath, pathKey, normalizeProjectPath } from '$lib/utils/paths';
import { invoke } from '@tauri-apps/api/core';
import { projectStore } from '$lib/stores/projects.svelte';
import { githubStore } from '$lib/stores/github.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';

export interface ProjectFolderEntry {
	name: string;
	isDir: boolean;
}

export interface ProjectGithubRemote {
	path: string;
	fullName: string;
}

export interface ProjectCreateArgs {
	parentDir: string;
	name: string;
	visibility: 'local' | 'public' | 'private';
	useSsh: boolean;
}

export interface ProjectCommandDeps {
	getProjectRoot: () => string | null;
	getOpenProjects: () => Array<{ id: string; canonicalProjectPath?: string | null }>;
	isGithubAuthenticated: () => boolean;
	readDir: (dirPath: string) => Promise<ProjectFolderEntry[]>;
	detectGithubRemotes: (root: string) => Promise<ProjectGithubRemote[]>;
	openProject: (path: string) => Promise<string | null> | (string | null);
	createProject: (args: ProjectCreateArgs) => Promise<string>;
	canonicalizeChildDir?: (root: string, candidate: string) => Promise<string> | string;
	getUseSsh?: () => boolean;
	isWin?: boolean;
}

/**
 * Segmenti canonici di un percorso, con rimozione di . e .. senza permettere
 * di risalire sopra la radice.
 */
export function splitCanonicalSegments(
	rawPath: string,
	isWin: boolean = isWindows
): { drive: string | null; segments: string[]; isAbsolute: boolean } {
	const normalized = rawPath.replace(/\\/g, '/');
	let drive: string | null = null;
	let rest = normalized;

	if (isWin) {
		const driveMatch = rest.match(/^([A-Za-z]:)(\/.*)?$/);
		if (driveMatch) {
			drive = driveMatch[1].toUpperCase();
			rest = driveMatch[2] || '';
		} else if (rest.startsWith('//')) {
			const uncMatch = rest.match(/^\/\/([^/]+)\/([^/]+)(\/.*)?$/);
			if (uncMatch) {
				drive = `//${uncMatch[1]}/${uncMatch[2]}`.toLowerCase();
				rest = uncMatch[3] || '';
			}
		}
	}

	const isAbsolute = rest.startsWith('/') || (drive !== null && !rest.startsWith('/'));
	const rawParts = rest.split('/').filter(Boolean);
	const segments: string[] = [];

	for (const part of rawParts) {
		if (part === '.') continue;
		if (part === '..') {
			if (segments.length > 0) {
				segments.pop();
			} else if (!isAbsolute) {
				segments.push('..');
			}
		} else {
			segments.push(part);
		}
	}

	return { drive, segments, isAbsolute };
}

/**
 * Valida che `rawPath` identifichi una cartella direttamente sotto `root`.
 * Risolve traversali e controlla drive (Windows) e prefisso esatto.
 */
export function validateDirectChildPath(
	rawPath: string,
	root: string,
	isWin: boolean = isWindows
): { valid: true; canonicalPath: string; folderName: string } | { valid: false; reason: string } {
	if (!root || !root.trim()) {
		return { valid: false, reason: 'Radice dei progetti non configurata su questa macchina' };
	}
	if (!rawPath || !rawPath.trim()) {
		return { valid: false, reason: 'Percorso non specificato' };
	}

	const rootParsed = splitCanonicalSegments(root, isWin);
	if (!rootParsed.isAbsolute) {
		return { valid: false, reason: 'Radice dei progetti non e\' un percorso assoluto' };
	}

	let targetPath = rawPath.trim();
	const targetParsedInitial = splitCanonicalSegments(targetPath, isWin);
	if (!targetParsedInitial.isAbsolute) {
		// Percorso relativo: si risolve rispetto alla radice
		targetPath = joinProjectPath(root, targetPath, isWin);
	}

	const targetParsed = splitCanonicalSegments(targetPath, isWin);

	if (isWin) {
		if (targetParsed.drive !== rootParsed.drive) {
			return { valid: false, reason: 'Unita\' disco differente dalla radice dei progetti' };
		}
	}

	// Deve essere esattamente un livello sotto la radice
	if (targetParsed.segments.length !== rootParsed.segments.length + 1) {
		return {
			valid: false,
			reason: 'Il percorso deve essere una cartella direttamente sotto la radice dei progetti'
		};
	}

	for (let i = 0; i < rootParsed.segments.length; i++) {
		const rootSeg = rootParsed.segments[i];
		const targetSeg = targetParsed.segments[i];
		const match = isWin ? rootSeg.toLowerCase() === targetSeg.toLowerCase() : rootSeg === targetSeg;
		if (!match) {
			return {
				valid: false,
				reason: 'Il percorso non si trova dentro la radice dei progetti'
			};
		}
	}

	const childName = targetParsed.segments[rootParsed.segments.length];
	if (!childName || childName === '.' || childName === '..') {
		return { valid: false, reason: 'Nome cartella non valido' };
	}

	if (childName.includes('/') || childName.includes('\\')) {
		return { valid: false, reason: 'Il nome della cartella contiene separatori' };
	}

	const canonicalPath = isWin
		? `${rootParsed.drive}\\${[...rootParsed.segments, childName].join('\\')}`
		: `/${[...rootParsed.segments, childName].join('/')}`;

	return { valid: true, canonicalPath, folderName: childName };
}

/**
 * Valida il nome di una cartella di progetto, compatibile con i vincoli del filesystem
 * e, facoltativamente, con le regole dei repository GitHub.
 */
export function validateProjectName(
	name: string,
	forGithub: boolean
): { valid: true; cleanName: string } | { valid: false; reason: string } {
	if (!name || typeof name !== 'string') {
		return { valid: false, reason: 'Il nome del progetto e\' obbligatorio' };
	}
	if (name.endsWith('.') || name.endsWith(' ')) {
		return { valid: false, reason: 'Il nome non puo\' finire con punto o spazio' };
	}
	const trimmed = name.trim();
	if (trimmed.length === 0) {
		return { valid: false, reason: 'Il nome del progetto e\' obbligatorio' };
	}
	if (trimmed.length > 100) {
		return { valid: false, reason: 'Il nome del progetto e\' troppo lungo (max 100 caratteri)' };
	}
	if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
		return { valid: false, reason: 'Il nome non puo\' iniziare con un punto' };
	}
	if (trimmed.includes('/') || trimmed.includes('\\')) {
		return { valid: false, reason: 'Il nome non puo\' contenere separatori di percorso' };
	}
	if (trimmed.includes('..')) {
		return { valid: false, reason: 'Il nome non puo\' contenere ".."' };
	}
	if (/[/\\:*?"<>|]/.test(trimmed) || /[\x00-\x1f\x7f]/.test(trimmed)) {
		return { valid: false, reason: 'Il nome contiene caratteri non validi per una cartella' };
	}
	// Nomi riservati su Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9) con qualsiasi estensione
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(trimmed)) {
		return { valid: false, reason: 'Nome riservato non consentito su Windows' };
	}
	if (forGithub) {
		if (trimmed.startsWith('-')) {
			return { valid: false, reason: 'Per GitHub il nome non puo\' iniziare con un trattino' };
		}
		if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
			return {
				valid: false,
				reason: 'Per GitHub il nome puo\' contenere solo lettere, numeri, trattino, underscore e punto'
			};
		}
	}
	return { valid: true, cleanName: trimmed };
}

let activeDeps: ProjectCommandDeps | null = null;

export function getDefaultProjectCommandDeps(): ProjectCommandDeps {
	if (!activeDeps) {
		return {
			getProjectRoot: () => (projectStore.projectRoot ? normalizeProjectPath(projectStore.projectRoot) : null),
			getOpenProjects: () =>
				projectStore.projects.map((p) => ({
					id: p.id,
					canonicalProjectPath: p.canonicalProjectPath
				})),
			isGithubAuthenticated: () => Boolean(githubStore.status.authenticated),
			readDir: async (dirPath: string) => {
				const entries = await invoke<Array<{ name: string; is_dir: boolean }>>('tree_read', {
					projectPath: dirPath,
					rel: ''
				});
				return entries.map((e) => ({ name: e.name, isDir: e.is_dir }));
			},
			detectGithubRemotes: async (root: string) => {
				const remotes = await githubStore.detectLocalRemotes(root);
				return remotes.map((r) => ({ path: r.path, fullName: r.fullName }));
			},
			openProject: (path: string) => projectStore.openProject(path),
			createProject: async (args: ProjectCreateArgs) => {
				return await invoke<string>('project_create_new', {
					parentDir: args.parentDir,
					name: args.name,
					visibility: args.visibility,
					useSsh: args.useSsh
				});
			},
			getUseSsh: () => settingsStore.github.cloneProtocol === 'ssh',
			canonicalizeChildDir: async (root: string, candidate: string) => {
				return await invoke<string>('project_canonicalize_child_dir', {
					root,
					candidate
				});
			},
			isWin: isWindows
		};
	}
	return activeDeps;
}

export function setProjectCommandDeps(deps: ProjectCommandDeps | null): void {
	activeDeps = deps;
}

export async function listRemoteProjectFolders(
	deps: ProjectCommandDeps = getDefaultProjectCommandDeps()
): Promise<RemoteFolderList> {
	const root = deps.getProjectRoot();
	const githubAvailable = deps.isGithubAuthenticated();

	if (!root) {
		return {
			root: null,
			folders: [],
			githubAvailable
		};
	}

	const win = deps.isWin ?? isWindows;
	const openProjects = deps.getOpenProjects();

	try {
		const [entries, remotes] = await Promise.all([
			deps.readDir(root),
			deps.detectGithubRemotes(root).catch(() => [])
		]);

		const remotesSet = new Set(remotes.map((r) => pathKey(r.path, win)));

		const folders: RemoteFolder[] = entries
			.filter((e) => e.isDir && !e.name.startsWith('.'))
			.map((e) => {
				const fullPath = joinProjectPath(root, e.name, win);
				const normalizedKey = pathKey(fullPath, win);
				const openMatch = openProjects.find(
					(p) => p.canonicalProjectPath && pathKey(p.canonicalProjectPath, win) === normalizedKey
				);

				return {
					name: e.name,
					path: fullPath,
					openProjectId: openMatch ? openMatch.id : null,
					git: remotesSet.has(normalizedKey)
				};
			});

		// Ordina per nome alfabetico
		folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

		return {
			root,
			folders,
			githubAvailable
		};
	} catch {
		return {
			root,
			folders: [],
			githubAvailable
		};
	}
}

export async function openRemoteProject(
	path: string,
	deps: ProjectCommandDeps = getDefaultProjectCommandDeps()
): Promise<{ projectId: string }> {
	const root = deps.getProjectRoot();
	if (!root) {
		throw new RemoteCommandFailure('rejected', 'Radice dei progetti non configurata su questa macchina');
	}

	const win = deps.isWin ?? isWindows;
	const check = validateDirectChildPath(path, root, win);
	if (!check.valid) {
		throw new RemoteCommandFailure('rejected', check.reason);
	}

	// Secondo controllo: verifica su filesystem reale dell'host
	// (canonicalizzazione, dereferenziazione symlink/junction, directory esistente)
	let canonicalPath: string;
	try {
		canonicalPath = deps.canonicalizeChildDir
			? await deps.canonicalizeChildDir(root, check.canonicalPath)
			: check.canonicalPath;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RemoteCommandFailure('rejected', `Verifica cartella fallita: ${msg}`);
	}

	const canonicalKey = pathKey(canonicalPath, win);
	const openProjects = deps.getOpenProjects();
	const existing = openProjects.find(
		(p) => p.canonicalProjectPath && pathKey(p.canonicalProjectPath, win) === canonicalKey
	);

	if (existing) {
		return { projectId: existing.id };
	}

	const projectId = await deps.openProject(canonicalPath);
	if (!projectId) {
		throw new RemoteCommandFailure('failed', `Impossibile aprire il progetto in "${canonicalPath}"`);
	}

	return { projectId };
}

export async function createRemoteProject(
	name: string,
	github: { visibility: 'private' | 'public' } | null,
	deps: ProjectCommandDeps = getDefaultProjectCommandDeps()
): Promise<{ projectId: string }> {
	const root = deps.getProjectRoot();
	if (!root) {
		throw new RemoteCommandFailure('rejected', 'Radice dei progetti non configurata su questa macchina');
	}

	const forGithub = Boolean(github);
	const check = validateProjectName(name, forGithub);
	if (!check.valid) {
		throw new RemoteCommandFailure('rejected', check.reason);
	}

	if (forGithub && !deps.isGithubAuthenticated()) {
		throw new RemoteCommandFailure(
			'rejected',
			'GitHub non e\' configurato o non e\' autenticato su questa macchina'
		);
	}

	const win = deps.isWin ?? isWindows;
	const cleanName = check.cleanName;

	// Verifica se la cartella esiste gia' nella radice dei progetti
	try {
		const existingEntries = await deps.readDir(root);
		const nameKey = win ? cleanName.toLowerCase() : cleanName;
		const alreadyExists = existingEntries.some((e) =>
			(win ? e.name.toLowerCase() : e.name) === nameKey
		);
		if (alreadyExists) {
			throw new RemoteCommandFailure(
				'rejected',
				`Esiste gia' una cartella con il nome "${cleanName}" nella radice dei progetti`
			);
		}
	} catch (err) {
		if (err instanceof RemoteCommandFailure) throw err;
	}

	const visibility = github ? github.visibility : 'local';
	const useSsh = deps.getUseSsh ? deps.getUseSsh() : false;

	let createdPath: string;
	try {
		createdPath = await deps.createProject({
			parentDir: root,
			name: cleanName,
			visibility,
			useSsh
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RemoteCommandFailure('failed', `Creazione progetto fallita: ${msg}`);
	}

	const projectId = await deps.openProject(createdPath);
	if (!projectId) {
		throw new RemoteCommandFailure('failed', 'Progetto creato ma impossibile aprirlo');
	}

	return { projectId };
}
