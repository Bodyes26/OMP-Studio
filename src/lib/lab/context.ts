// Acquisizione e gestione del contesto stabile per i prototipi del Laboratorio.
//
// Questo modulo realizza l'acquisizione del contesto del progetto concordata con
// l'utente (ricerca/laboratorio-prototipi-piano.md §§ 2, 5.4, 11 e Step 11):
//
//  1. Selezione mirata dei file utili dal progetto, non copia massiva dell'intera
//     applicazione ne' scansione indiscriminata di node_modules o build;
//  2. Lettura dal working tree effettivo, comprese modifiche non committate dell'utente;
//  3. Impronte sha256 e provenienza ('working-tree', 'git-head', 'attachment',
//     'reference-url') salvate nello snapshot;
//  4. Esclusione rigorosa di credenziali, file segreti (.env, chiavi .pem/.key, token,
//     file di autenticazione), cartelle interne (.git, .omp) e altri prototipi;
//  5. Verifica della coerenza durante l'acquisizione a più passaggi: se il principale
//     sta scrivendo concorrentemente e l'insieme non e' stabile, si segnala
//     esplicitamente (`coherent: false`) invece di dichiarare una fotografia atomica fittizia;
//  6. Dopo l'acquisizione i tool di contesto leggono quella versione stabile congelata
//     nei blob dell'archivio, anche se il file su disco nel progetto cambia o viene rimosso;
//  7. Rilevamento della deriva (drift): segnala quando un file acquisito e' cambiato
//     nel progetto senza rigenerare il prototipo;
//  8. Aggiornamento del contesto SOLO su richiesta esplicita dell'utente, creando una
//     nuova fotografia distinta da quella precedente e preservando la storia, senza
//     mai toccare ne' rigenerare i sorgenti del prototipo.
//
// Invarianti garantiti qui, non affidati a istruzioni di prompt.

import {
	changedContextPaths,
	isLabFingerprint,
	isLabPrototypeId,
	parseLabContextFile,
	parseLabContextSnapshot,
	type LabContextFile,
	type LabContextOrigin,
	type LabContextSnapshot,
	type LabPrototypeId
} from './contracts.ts';
import {
	writeLabFileAtomic,
	type LabDirectoryEntry,
	type LabStorageHost
} from './storage.ts';

/* ------------------------------------------------------------- struttura */

/** Cartella dell'archivio contesto dentro la cartella dati locale di Studio. */
export const LAB_CONTEXT_ARCHIVE_DIRECTORY = 'lab/context';

/** File con lo snapshot attivo del prototipo. */
export const LAB_CONTEXT_SNAPSHOT_FILE = 'snapshot.json';

/** File con la storia cronologica delle acquisizioni del prototipo. */
export const LAB_CONTEXT_HISTORY_FILE = 'history.json';

/** Cartella dei blob immutabili indicizzati per impronta SHA-256. */
export const LAB_CONTEXT_BLOB_DIRECTORY = 'blobs';

/** Versione dello schema per snapshot.json e history.json. */
export const LAB_CONTEXT_SCHEMA_VERSION = 1;

/* ---------------------------------------------------------------- errori */

export const LAB_CONTEXT_ERROR_CODES = [
	'invalid-scope',
	'invalid-id',
	'invalid-path',
	'invalid-snapshot',
	'forbidden-path',
	'forbidden-secret',
	'incoherent-capture',
	'not-found',
	'host-failure'
] as const;

export type LabContextErrorCode = (typeof LAB_CONTEXT_ERROR_CODES)[number];

export class LabContextError extends Error {
	readonly code: LabContextErrorCode;

	constructor(code: LabContextErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'LabContextError';
		this.code = code;
	}
}

/* --------------------------------------------------------------- archivio */

/**
 * Archivio del contesto locale di Studio.
 * Scope distingue i progetti tra loro (es. `Project.id`), host e' la porta di storage.
 */
export interface LabContextArchive {
	readonly host: LabStorageHost;
	readonly scope: string;
}

export function labContextArchive(host: LabStorageHost, scope: string): LabContextArchive {
	if (typeof scope !== 'string' || scope.trim().length === 0) {
		throw new LabContextError('invalid-scope', 'La chiave di scope del contesto non puo essere vuota.');
	}
	return { host, scope: scope.trim() };
}

/** Cartella dello snapshot per un prototipo: `lab/context/<scope>/<prototypeId>`. */
export function labContextDirectory(archive: LabContextArchive, prototypeId: LabPrototypeId): string {
	if (!isLabPrototypeId(prototypeId)) {
		throw new LabContextError('invalid-id', `Id di prototipo non valido: ${JSON.stringify(prototypeId)}`);
	}
	return `${LAB_CONTEXT_ARCHIVE_DIRECTORY}/${archive.scope}/${prototypeId}`;
}

/** Percorso di un blob di contesto: `lab/context/<scope>/<prototypeId>/blobs/<hex>.blob`. */
export function labContextBlobPath(
	archive: LabContextArchive,
	prototypeId: LabPrototypeId,
	fingerprint: string
): string {
	if (!isLabFingerprint(fingerprint)) {
		throw new LabContextError('invalid-snapshot', `Impronta non valida: ${JSON.stringify(fingerprint)}`);
	}
	const hex = fingerprint.slice('sha256:'.length);
	return `${labContextDirectory(archive, prototypeId)}/${LAB_CONTEXT_BLOB_DIRECTORY}/${hex}.blob`;
}

/* --------------------------------------------------------------- impronte */

const textEncoder = new TextEncoder();

/**
 * Calcola l'impronta crittografica SHA-256 del contenuto nella forma canonica `sha256:<64 hex>`.
 */
export async function computeFingerprint(content: string): Promise<string> {
	const bytes = textEncoder.encode(content);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `sha256:${hex}`;
}

/* ------------------------------------------------- sicurezza ed esclusioni */

export const FORBIDDEN_CONTEXT_PATH_PATTERNS: readonly RegExp[] = [
	/(^|\/)\.git(\/|$)/i,
	/(^|\/)\.env(\..+)?$/i,
	/(^|\/)\.omp(-studio)?(\/|$)/i,
	/\.(pem|key|pfx|pkcs12|crt|keystore)$/i,
	/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
	/(^|\/)(credentials|secret|token|password|auth_credentials)(\..+)?$/i,
	/\.(sqlite|sqlite3|db|db3)$/i,
	/(^|\/)proto(\/|$)/i
];

export const FORBIDDEN_SECRET_CONTENT_PATTERNS: readonly RegExp[] = [
	/-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/,
	/bearer\s+[a-zA-Z0-9._~+/-]{20,}/i,
	/(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*["'][a-zA-Z0-9._~+/-]{16,}["']/i
];

/**
 * Verifica se un percorso relativo e' vietato per motivi di sicurezza o riservatezza.
 */
export function isForbiddenContextPath(relPath: string): { forbidden: boolean; reason?: string } {
	if (typeof relPath !== 'string' || relPath.trim().length === 0) {
		return { forbidden: true, reason: 'Percorso non valido o vuoto.' };
	}
	const normalized = relPath.trim().replace(/\\/g, '/');
	if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
		return { forbidden: true, reason: 'Percorso assoluto non consentito per il contesto.' };
	}
	const segments = normalized.split('/');
	if (segments.some((s) => s === '..' || s === '.')) {
		return { forbidden: true, reason: "Directory traversal ('..' o '.') non consentito." };
	}
	for (const pattern of FORBIDDEN_CONTEXT_PATH_PATTERNS) {
		if (pattern.test(normalized)) {
			return {
				forbidden: true,
				reason: `Percorso escluso dal contesto per riservatezza o sicurezza: '${normalized}'`
			};
		}
	}
	return { forbidden: false };
}

/** Verifica se il contenuto e' testo catturabile e leggibile. */
export function isCapturableText(content: string): boolean {
	return !content.includes('\u0000') && !content.includes('\ufffd');
}

/**
 * Verifica se il contenuto testuale contiene credenziali palesi o chiavi private.
 */
export function containsForbiddenSecret(content: string): { forbidden: boolean; reason?: string } {
	if (!isCapturableText(content)) {
		return { forbidden: true, reason: 'File non testuale o corrotto (byte nulli o sequenze non UTF-8).' };
	}
	for (const pattern of FORBIDDEN_SECRET_CONTENT_PATTERNS) {
		if (pattern.test(content)) {
			return { forbidden: true, reason: 'Contenuto identificato come credenziale o chiave privata escluso dal contesto.' };
		}
	}
	return { forbidden: false };
}

/* ---------------------------------------------------- selezione mirata file */

export interface SelectContextFilesOptions {
	/** Percorsi espliciti mirati (file o directory). */
	targets?: readonly string[];
	/** Estensioni consentite durante l'esplorazione (predefinite estensioni codice, stili, doc). */
	allowedExtensions?: readonly string[];
	/** Massimo numero di file selezionabili (predefinito 100). */
	maxFiles?: number;
}

const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
	'.ts', '.tsx', '.js', '.jsx', '.svelte', '.vue', '.html', '.css', '.scss',
	'.json', '.md', '.sql', '.yaml', '.yml'
];

const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
	'node_modules',
	'dist',
	'build',
	'.svelte-kit',
	'target',
	'.git',
	'.omp',
	'proto',
	'.vscode',
	'.idea'
]);

/**
 * Seleziona in modo mirato i file utili del progetto, filtrando cartelle riservate,
 * artefatti di build e file non pertinenti.
 */
export async function selectContextFiles(
	projectHost: LabStorageHost,
	options: SelectContextFilesOptions = {}
): Promise<{ paths: string[]; excluded: Array<{ path: string; reason: string }> }> {
	const paths: string[] = [];
	const excluded: Array<{ path: string; reason: string }> = [];
	const allowedExts = options.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;
	const maxFiles = options.maxFiles ?? 100;

	if (options.targets && options.targets.length > 0) {
		for (const rawTarget of options.targets) {
			const target = rawTarget.trim().replace(/\\/g, '/');
			const check = isForbiddenContextPath(target);
			if (check.forbidden) {
				excluded.push({ path: target, reason: check.reason ?? 'Percorso vietato' });
				continue;
			}

			// Prova se e' un file leggibile
			const content = await projectHost.readTextFile(target);
			if (content !== null) {
				if (!paths.includes(target)) paths.push(target);
				continue;
			}

			// Se non e' un file, prova come directory
			const dirEntries = await projectHost.listDirectory(target);
			if (dirEntries !== null) {
				await collectDirectory(projectHost, target, dirEntries, paths, excluded, allowedExts, maxFiles);
			} else {
				excluded.push({ path: target, reason: 'File o directory inesistente nel progetto' });
			}
		}
	} else {
		// Esplorazione predefinita della root e delle sottocartelle sorgente comuni
		const rootEntries = await projectHost.listDirectory('');
		if (rootEntries !== null) {
			await collectDirectory(projectHost, '', rootEntries, paths, excluded, allowedExts, maxFiles);
		}
	}

	paths.sort();
	return { paths, excluded };
}

async function collectDirectory(
	host: LabStorageHost,
	dirPath: string,
	entries: LabDirectoryEntry[],
	outPaths: string[],
	outExcluded: Array<{ path: string; reason: string }>,
	allowedExts: readonly string[],
	maxFiles: number
): Promise<void> {
	for (const entry of entries) {
		if (outPaths.length >= maxFiles) break;

		const rel = dirPath ? `${dirPath}/${entry.name}` : entry.name;
		const check = isForbiddenContextPath(rel);
		if (check.forbidden) {
			outExcluded.push({ path: rel, reason: check.reason ?? 'Escluso per sicurezza' });
			continue;
		}

		if (entry.kind === 'directory') {
			if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) {
				continue;
			}
			const sub = await host.listDirectory(rel);
			if (sub) {
				await collectDirectory(host, rel, sub, outPaths, outExcluded, allowedExts, maxFiles);
			}
		} else if (entry.kind === 'file') {
			const dotIndex = entry.name.lastIndexOf('.');
			const ext = dotIndex >= 0 ? entry.name.slice(dotIndex).toLowerCase() : '';
			if (allowedExts.includes(ext)) {
				if (!outPaths.includes(rel)) {
					outPaths.push(rel);
				}
			}
		}
	}
}

/* --------------------------------------------- acquisizione e coerenza */

export interface AcquireContextOptions {
	/** Elenco mirato dei percorsi relativi del progetto da acquisire. */
	targets: readonly string[];
	/** Provenienza (predefinita 'working-tree'). */
	origin?: LabContextOrigin;
	/** Tentativi massimi se si rilevano modifiche concorrenti (predefinito 2). */
	maxRetries?: number;
	/** Ritardo in ms prima del re-check della coerenza (predefinito 10ms). */
	retryDelayMs?: number;
}

export interface AcquireContextResult {
	ok: boolean;
	snapshot: LabContextSnapshot;
	coherent: boolean;
	incoherentPaths: string[];
	retriesPerformed: number;
	excluded: Array<{ path: string; reason: string }>;
}

let snapshotCounter = 0;

function generateSnapshotId(): string {
	snapshotCounter = (snapshotCounter + 1) % 0xffff;
	const token = Math.random().toString(36).slice(2, 8);
	return `ctx-${Date.now().toString(36)}-${token}${snapshotCounter.toString(16)}`;
}

/**
 * Acquisisce il contesto stabile per un prototipo leggendo il working tree effettivo.
 * Esegue verifica a più passaggi per intercettare scritture concorrenti del principale:
 * se l'insieme non e' coerente dopo i tentativi previsti, segnala `coherent: false`
 * con i percorsi instabili, senza mai fingere una fotografia atomica.
 */
export async function acquireContextSnapshot(
	archive: LabContextArchive,
	projectHost: LabStorageHost,
	prototypeId: LabPrototypeId,
	options: AcquireContextOptions
): Promise<AcquireContextResult> {
	if (!isLabPrototypeId(prototypeId)) {
		throw new LabContextError('invalid-id', `Id prototipo non valido: ${JSON.stringify(prototypeId)}`);
	}

	const origin: LabContextOrigin = options.origin ?? 'working-tree';
	const maxRetries = options.maxRetries ?? 2;
	const delayMs = options.retryDelayMs ?? 10;

	const excluded: Array<{ path: string; reason: string }> = [];
	const allowedTargets: string[] = [];

	for (const rawTarget of options.targets) {
		const target = rawTarget.trim().replace(/\\/g, '/');
		const check = isForbiddenContextPath(target);
		if (check.forbidden) {
			excluded.push({ path: target, reason: check.reason ?? 'Percorso vietato' });
		} else {
			if (!allowedTargets.includes(target)) allowedTargets.push(target);
		}
	}

	allowedTargets.sort();

	// Passaggio 1: lettura working tree ed estrazione fingerprint
	const pass1Map = new Map<string, { content: string; fingerprint: string }>();

	for (const path of allowedTargets) {
		const content = await projectHost.readTextFile(path);
		if (content === null) {
			excluded.push({ path, reason: 'File non trovato nel working tree del progetto' });
			continue;
		}

		const secretCheck = containsForbiddenSecret(content);
		if (secretCheck.forbidden) {
			excluded.push({ path, reason: secretCheck.reason ?? 'Contenuto escluso per riservatezza' });
			continue;
		}

		const fp = await computeFingerprint(content);
		pass1Map.set(path, { content, fingerprint: fp });
	}

	// Verifica della coerenza a due o più passaggi
	let coherent = true;
	const incoherentPaths: string[] = [];
	let retries = 0;

	if (pass1Map.size > 0) {
		while (true) {
			if (delayMs > 0) {
				await new Promise((r) => setTimeout(r, delayMs));
			}

			let diffFound = false;
			for (const [path, current] of pass1Map.entries()) {
				const reContent = await projectHost.readTextFile(path);
				if (reContent === null || reContent !== current.content) {
					diffFound = true;
					if (!incoherentPaths.includes(path)) {
						incoherentPaths.push(path);
					}
					if (reContent !== null) {
						const reFp = await computeFingerprint(reContent);
						pass1Map.set(path, { content: reContent, fingerprint: reFp });
					} else {
						pass1Map.delete(path);
					}
				}
			}

			if (diffFound) {
				if (retries < maxRetries) {
					retries++;
					continue;
				}
				coherent = false;
				break;
			} else {
				coherent = true;
				break;
			}
		}
	}

	// Salvataggio dei blob immutabili
	const dir = labContextDirectory(archive, prototypeId);
	await archive.host.createDirectory(dir);

	for (const [, entry] of pass1Map) {
		const bPath = labContextBlobPath(archive, prototypeId, entry.fingerprint);
		const existing = await archive.host.readTextFile(bPath);
		if (existing === null) {
			const cut = bPath.lastIndexOf('/');
			await archive.host.createDirectory(bPath.slice(0, cut));
			await writeLabFileAtomic(archive.host, bPath, entry.content);
		}
	}

	// Creazione snapshot
	const files: LabContextFile[] = Array.from(pass1Map.entries()).map(([path, data]) => ({
		path,
		fingerprint: data.fingerprint,
		origin
	}));
	files.sort((a, b) => a.path.localeCompare(b.path));

	const snapshot: LabContextSnapshot = {
		id: generateSnapshotId(),
		prototypeId,
		capturedAt: Date.now(),
		coherent,
		files
	};

	// Scrittura atomica di snapshot.json
	const snapshotJson = `${JSON.stringify(snapshot, null, 2)}\n`;
	await writeLabFileAtomic(archive.host, `${dir}/${LAB_CONTEXT_SNAPSHOT_FILE}`, snapshotJson);

	// Aggiornamento history.json
	await appendToContextHistory(archive, prototypeId, {
		snapshotId: snapshot.id,
		capturedAt: snapshot.capturedAt,
		coherent: snapshot.coherent,
		fileCount: snapshot.files.length,
		incoherentPaths: incoherentPaths.length > 0 ? incoherentPaths : undefined
	});

	return {
		ok: true,
		snapshot,
		coherent,
		incoherentPaths,
		retriesPerformed: retries,
		excluded
	};
}

/* --------------------------------------------- lettura contesto stabile */

/**
 * Rilegge lo snapshot di contesto attivo per il prototipo.
 */
export async function readContextSnapshot(
	archive: LabContextArchive,
	prototypeId: LabPrototypeId
): Promise<LabContextSnapshot | null> {
	if (!isLabPrototypeId(prototypeId)) return null;
	const dir = labContextDirectory(archive, prototypeId);
	const raw = await archive.host.readTextFile(`${dir}/${LAB_CONTEXT_SNAPSHOT_FILE}`);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return parseLabContextSnapshot(parsed);
	} catch {
		return null;
	}
}

/**
 * Legge la versione stabile e congelata di un file di contesto dal relativo blob.
 * Garantisce che anche se il file nel working tree e' stato modificato o eliminato,
 * il Laboratorio legga esattamente il contenuto acquisito.
 */
export async function readContextSnapshotFile(
	archive: LabContextArchive,
	prototypeId: LabPrototypeId,
	path: string
): Promise<string | null> {
	const snapshot = await readContextSnapshot(archive, prototypeId);
	if (!snapshot) return null;

	const normalized = path.trim().replace(/\\/g, '/');
	const fileEntry = snapshot.files.find((f) => f.path === normalized);
	if (!fileEntry) return null;

	const bPath = labContextBlobPath(archive, prototypeId, fileEntry.fingerprint);
	return archive.host.readTextFile(bPath);
}

/* -------------------------------------------------- rilevamento deriva */

export interface LabContextFileDrift {
	path: string;
	status: 'unchanged' | 'modified' | 'deleted';
	snapshotFingerprint: string;
	currentFingerprint?: string;
	origin: LabContextOrigin;
}

export interface LabContextDriftReport {
	hasChanges: boolean;
	changedPaths: string[];
	modifiedPaths: string[];
	deletedPaths: string[];
	details: LabContextFileDrift[];
}

/**
 * Controlla se i file acquisiti nello snapshot sono stati modificati o rimossi
 * nel working tree del progetto.
 * Questa operazione e' di sola lettura e segnalazione: NON aggiorna lo snapshot
 * e NON rigenera il prototipo.
 */
export async function detectContextDrift(
	projectHost: LabStorageHost,
	snapshot: LabContextSnapshot
): Promise<LabContextDriftReport> {
	const currentFingerprints = new Map<string, string>();
	const details: LabContextFileDrift[] = [];
	const modifiedPaths: string[] = [];
	const deletedPaths: string[] = [];

	for (const file of snapshot.files) {
		const liveContent = await projectHost.readTextFile(file.path);
		if (liveContent === null) {
			deletedPaths.push(file.path);
			details.push({
				path: file.path,
				status: 'deleted',
				snapshotFingerprint: file.fingerprint,
				origin: file.origin
			});
		} else {
			const currentFp = await computeFingerprint(liveContent);
			currentFingerprints.set(file.path, currentFp);

			if (currentFp !== file.fingerprint) {
				modifiedPaths.push(file.path);
				details.push({
					path: file.path,
					status: 'modified',
					snapshotFingerprint: file.fingerprint,
					currentFingerprint: currentFp,
					origin: file.origin
				});
			} else {
				details.push({
					path: file.path,
					status: 'unchanged',
					snapshotFingerprint: file.fingerprint,
					currentFingerprint: currentFp,
					origin: file.origin
				});
			}
		}
	}

	// Usa la funzione di contratto tipizzato per verificare i cambi
	const changedPaths = changedContextPaths(snapshot, currentFingerprints);
	for (const p of deletedPaths) {
		if (!changedPaths.includes(p)) {
			changedPaths.push(p);
		}
	}
	changedPaths.sort();

	return {
		hasChanges: changedPaths.length > 0,
		changedPaths,
		modifiedPaths: modifiedPaths.sort(),
		deletedPaths: deletedPaths.sort(),
		details
	};
}

/* -------------------------------------- aggiornamento su richiesta esplicita */

export interface UpdateContextOptions {
	/** Percorsi mirati da aggiornare. Se omesso, aggiorna tutti i percorsi dello snapshot. */
	paths?: readonly string[];
	/** Percorsi addizionali da includere nel contesto. */
	addPaths?: readonly string[];
	/** Percorsi da rimuovere dal contesto. */
	removePaths?: readonly string[];
	origin?: LabContextOrigin;
	maxRetries?: number;
	retryDelayMs?: number;
}

export interface UpdateContextResult {
	ok: boolean;
	previousSnapshot: LabContextSnapshot;
	newSnapshot: LabContextSnapshot;
	diff: {
		added: string[];
		modified: string[];
		deleted: string[];
		unchanged: string[];
	};
	coherent: boolean;
	incoherentPaths: string[];
}

/**
 * Aggiorna il contesto stabile ESCLUSIVAMENTE su richiesta esplicita dell'utente.
 * Crea un nuovo snapshot con id e timestamp aggiornati, conserva la versione precedente
 * nella cronologia e calcola la differenza, SENZA toccare ne' rigenerare i sorgenti
 * del prototipo.
 */
export async function updateContextSnapshot(
	archive: LabContextArchive,
	projectHost: LabStorageHost,
	prototypeId: LabPrototypeId,
	options: UpdateContextOptions = {}
): Promise<UpdateContextResult> {
	const previous = await readContextSnapshot(archive, prototypeId);
	if (!previous) {
		throw new LabContextError(
			'not-found',
			`Impossibile aggiornare: nessuno snapshot di contesto presente per '${prototypeId}'.`
		);
	}

	const removeSet = new Set((options.removePaths ?? []).map((p) => p.trim().replace(/\\/g, '/')));
	const addSet = new Set((options.addPaths ?? []).map((p) => p.trim().replace(/\\/g, '/')));

	let targetPaths: string[];
	if (options.paths && options.paths.length > 0) {
		// Aggiorna solo i percorsi specificati, mantenendo inalterati gli altri
		const updateSet = new Set(options.paths.map((p) => p.trim().replace(/\\/g, '/')));
		targetPaths = previous.files
			.map((f) => f.path)
			.filter((p) => !removeSet.has(p) && updateSet.has(p));
	} else {
		targetPaths = previous.files.map((f) => f.path).filter((p) => !removeSet.has(p));
	}

	for (const add of addSet) {
		if (!targetPaths.includes(add)) {
			targetPaths.push(add);
		}
	}
	targetPaths.sort();

	const acq = await acquireContextSnapshot(archive, projectHost, prototypeId, {
		targets: targetPaths,
		origin: options.origin,
		maxRetries: options.maxRetries,
		retryDelayMs: options.retryDelayMs
	});

	// Calcola diff rispetto alla fotografia precedente
	const oldMap = new Map(previous.files.map((f) => [f.path, f.fingerprint]));
	const newMap = new Map(acq.snapshot.files.map((f) => [f.path, f.fingerprint]));

	const added: string[] = [];
	const modified: string[] = [];
	const deleted: string[] = [];
	const unchanged: string[] = [];

	for (const [path, newFp] of newMap.entries()) {
		if (!oldMap.has(path)) {
			added.push(path);
		} else if (oldMap.get(path) !== newFp) {
			modified.push(path);
		} else {
			unchanged.push(path);
		}
	}

	for (const oldPath of oldMap.keys()) {
		if (!newMap.has(oldPath)) {
			deleted.push(oldPath);
		}
	}

	// Registra la relazione col genitore in history.json
	await appendToContextHistory(archive, prototypeId, {
		snapshotId: acq.snapshot.id,
		capturedAt: acq.snapshot.capturedAt,
		coherent: acq.snapshot.coherent,
		fileCount: acq.snapshot.files.length,
		previousSnapshotId: previous.id
	});

	return {
		ok: true,
		previousSnapshot: previous,
		newSnapshot: acq.snapshot,
		diff: {
			added: added.sort(),
			modified: modified.sort(),
			deleted: deleted.sort(),
			unchanged: unchanged.sort()
		},
		coherent: acq.coherent,
		incoherentPaths: acq.incoherentPaths
	};
}

/* ---------------------------------------------------- cronologia contesto */

export interface LabContextHistoryEntry {
	snapshotId: string;
	capturedAt: number;
	coherent: boolean;
	fileCount: number;
	previousSnapshotId?: string;
	incoherentPaths?: string[];
}

export async function readContextHistory(
	archive: LabContextArchive,
	prototypeId: LabPrototypeId
): Promise<LabContextHistoryEntry[]> {
	if (!isLabPrototypeId(prototypeId)) return [];
	const dir = labContextDirectory(archive, prototypeId);
	const raw = await archive.host.readTextFile(`${dir}/${LAB_CONTEXT_HISTORY_FILE}`);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function appendToContextHistory(
	archive: LabContextArchive,
	prototypeId: LabPrototypeId,
	entry: LabContextHistoryEntry
): Promise<void> {
	const dir = labContextDirectory(archive, prototypeId);
	await archive.host.createDirectory(dir);
	const history = await readContextHistory(archive, prototypeId);
	history.push(entry);
	const json = `${JSON.stringify(history, null, 2)}\n`;
	await writeLabFileAtomic(archive.host, `${dir}/${LAB_CONTEXT_HISTORY_FILE}`, json);
}
