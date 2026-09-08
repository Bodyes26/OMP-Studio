// Revisioni locali del Laboratorio: apertura per richiesta di modifica,
// chiusura con esito, ripristino dentro lo stesso prototipo e duplicazione con
// provenienza registrata.
//
// Le revisioni non stanno in Git. Vivono nell'archivio locale di Studio
// (`lab/revisions/<scope>/<prototipo>`), accanto alla chat e alle cache: nel
// repository restano soltanto sorgenti, asset, brief e manifest del prototipo.
// Per questo il modulo riceve due host distinti: l'archivio locale, dove
// scrive la storia, e lo `LabStore` del prototipo, il solo posto dove tocca i
// file di lavoro.
//
// Invarianti garantiti qui, non affidati a istruzioni di prompt:
//
//  1. una revisione nasce da una richiesta di modifica (`requestId` e testo
//     della richiesta), non da ogni singola scrittura: apertura e chiusura
//     sono operazioni esplicite e una sola revisione per volta resta aperta;
//  2. una revisione aperta e non chiusa vale `interrupted`: se Studio si
//     chiude nel mezzo, il lavoro interrotto non diventa un completamento;
//  3. la fotografia dei file si prende alla chiusura, tutta insieme: mai
//     mezzi file nuovi e mezzi vecchi dentro la stessa revisione;
//  4. il ripristino aggiunge una revisione in coda con `parentId` sulla
//     revisione scelta: la storia successiva resta intera, non viene riscritta;
//  5. ripristino e duplicazione scrivono soltanto dentro il prototipo
//     bersaglio, attraverso le operazioni confinate dello Step 2;
//  6. la duplicazione registra la provenienza (archivio, prototipo e revisione
//     di origine) e non tocca il prototipo originale.
//
// I contenuti sono testo: la porta `LabStorageHost` legge e scrive stringhe.
// Un file che non sopravvive alla conversione (byte nulli o sequenze UTF-8 non
// valide) viene rifiutato con un errore esplicito invece di essere catturato
// corrotto.

import {
	isLabFingerprint,
	isLabPrototypeId,
	isRenderableRevisionState,
	isLabRevisionState,
	parseLabPrototypeLocation,
	parseLabPrototypeManifest,
	parseLabRevision,
	type LabPrototypeId,
	type LabPrototypeLocation,
	type LabPrototypeManifest,
	type LabRequestId,
	type LabRevision,
	type LabRevisionId,
	type LabRevisionState
} from './contracts.ts';
import {
	createLabPrototype,
	isConfinedPrototypePath,
	labPrototypeLocation,
	listLabPrototypeFiles,
	readLabPrototype,
	readLabPrototypeFile,
	removeLabPrototypeFile,
	saveLabPrototype,
	writeLabFileAtomic,
	writeLabPrototypeFile,
	type LabStorageHost,
	type LabStore,
	type LabStoredPrototype
} from './storage.ts';

/* ------------------------------------------------------------- struttura */

/**
 * Cartella delle revisioni dentro la cartella dati locale di Studio, sorella
 * di `lab/drafts`. Fuori dal repository: qui stanno storia e contenuti
 * recuperabili, non materiale da consegnare con Git.
 */
export const LAB_REVISION_ARCHIVE_DIRECTORY = 'lab/revisions';

/** Storia ordinata di un prototipo. */
export const LAB_REVISION_INDEX_FILE = 'index.json';

/** Provenienza di un prototipo nato da una duplicazione. */
export const LAB_PROVENANCE_FILE = 'provenance.json';

/** Contenuti indirizzati per impronta: due revisioni non duplicano lo stesso file. */
export const LAB_REVISION_BLOB_DIRECTORY = 'blobs';

/** Versione del formato di `index.json` e `provenance.json`. */
export const LAB_REVISION_SCHEMA_VERSION = 1;

/** Chiave dell'archivio bozze: le bozze senza progetto hanno una storia sola. */
export const LAB_DRAFT_REVISION_SCOPE = 'drafts';

/* ---------------------------------------------------------------- errori */

export const LAB_REVISION_ERROR_CODES = [
	'invalid-scope',
	'invalid-id',
	'invalid-request',
	'invalid-index',
	'not-found',
	'revision-open',
	'not-open',
	'no-snapshot',
	'unsupported-content',
	'host-failure'
] as const;

export type LabRevisionErrorCode = (typeof LAB_REVISION_ERROR_CODES)[number];

/** Errore con causa esplicita: chi chiama distingue un rifiuto da un guasto. */
export class LabRevisionError extends Error {
	readonly code: LabRevisionErrorCode;

	constructor(code: LabRevisionErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'LabRevisionError';
		this.code = code;
	}
}

/* --------------------------------------------------------------- archivio */

/**
 * Archivio locale delle revisioni. `scope` distingue gli archivi fra loro
 * (due progetti possono avere un prototipo con lo stesso id) e deve essere una
 * chiave stabile, non un percorso: in Studio e' `Project.id` dello store
 * progetti, oppure `LAB_DRAFT_REVISION_SCOPE` per le bozze. Cosi' spostare o
 * rinominare il repository non perde la storia locale.
 */
export interface LabRevisionArchive {
	readonly host: LabStorageHost;
	readonly scope: string;
}

const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Chiave d'archivio valida: un solo segmento, mai un percorso. */
export function isLabRevisionScope(value: unknown): value is string {
	return typeof value === 'string' && SCOPE_PATTERN.test(value) && !value.endsWith('.');
}

export function labRevisionArchive(host: LabStorageHost, scope: string): LabRevisionArchive {
	if (!isLabRevisionScope(scope)) {
		throw new LabRevisionError(
			'invalid-scope',
			`Chiave d'archivio non valida: ${JSON.stringify(scope)}. Serve un id stabile, non un percorso.`
		);
	}
	return { host, scope };
}

/** Cartella della storia di un prototipo, relativa alla radice dati locale. */
export function labRevisionDirectory(archive: LabRevisionArchive, prototypeId: LabPrototypeId): string {
	if (!isLabRevisionScope(archive.scope)) {
		throw new LabRevisionError('invalid-scope', `Chiave d'archivio non valida: ${JSON.stringify(archive.scope)}`);
	}
	if (!isLabPrototypeId(prototypeId)) {
		throw new LabRevisionError('invalid-id', `Id di prototipo non valido: ${JSON.stringify(prototypeId)}`);
	}
	return `${LAB_REVISION_ARCHIVE_DIRECTORY}/${archive.scope}/${prototypeId}`;
}

/**
 * Il prototipo e la sua storia. `store` e' l'unico posto dove il modulo
 * scrive file di lavoro; `archive` e' l'unico posto dove scrive la storia.
 */
export interface LabRevisionContext {
	archive: LabRevisionArchive;
	store: LabStore;
	prototypeId: LabPrototypeId;
}

/* ------------------------------------------------------------- revisioni */

/** File catturato in una revisione: percorso confinato, impronta e dimensione. */
export interface LabRevisionFile {
	path: string;
	fingerprint: string;
	bytes: number;
}

/**
 * Stato dei file del prototipo al momento della chiusura. Il manifest e'
 * validato (contiene anche il brief): il ripristino lo riscrive con
 * `saveLabPrototype`, non come file libero.
 */
export interface LabRevisionSnapshot {
	manifest: LabPrototypeManifest;
	files: LabRevisionFile[];
	/** Voci presenti nel prototipo ma fuori dal perimetro catturabile. */
	excluded: string[];
}

/** Perche' una revisione contiene questi file, quando non li ha prodotti l'agente. */
export type LabRevisionOrigin = 'restore' | 'duplicate';

/**
 * Voce di storia: la revisione secondo i contratti dello Step 1, il
 * riferimento alla richiesta di modifica e la fotografia dei file.
 */
export interface LabRevisionEntry {
	revision: LabRevision;
	/** Testo della richiesta di modifica che ha aperto la revisione. */
	summary: string;
	/** Istante di chiusura; assente finche' la revisione e' aperta. */
	closedAt?: number;
	origin?: LabRevisionOrigin;
	snapshot?: LabRevisionSnapshot;
	/** Perche' la fotografia manca, quando l'esito e' `failed` o `interrupted`. */
	snapshotIssue?: string;
}

export interface LabRevisionHistory {
	prototypeId: LabPrototypeId;
	/** Dalla piu' vecchia alla piu' recente. */
	entries: LabRevisionEntry[];
}

/** Provenienza di un prototipo duplicato: da dove arriva davvero. */
export interface LabPrototypeProvenance {
	sourceScope: string;
	sourcePrototypeId: LabPrototypeId;
	sourceRevisionId: LabRevisionId;
	sourceLocation: LabPrototypeLocation;
	duplicatedAt: number;
}

/** Una revisione aperta non ha ancora un esito ne' una fotografia. */
export function isOpenLabRevision(entry: LabRevisionEntry): boolean {
	return entry.closedAt === undefined;
}

/** Ultima voce della storia, aperta o chiusa. */
export function latestLabRevisionEntry(history: LabRevisionHistory): LabRevisionEntry | null {
	return history.entries.length === 0 ? null : history.entries[history.entries.length - 1];
}

/** Revisione aperta, se c'e': ne resta al massimo una per prototipo. */
export function openLabRevisionEntry(history: LabRevisionHistory): LabRevisionEntry | null {
	return history.entries.find(isOpenLabRevision) ?? null;
}

/** Revisioni ripristinabili: hanno una fotografia completa dei file. */
export function restorableLabRevisions(history: LabRevisionHistory): LabRevisionEntry[] {
	return history.entries.filter((entry) => entry.snapshot !== undefined);
}

export function findLabRevisionEntry(
	history: LabRevisionHistory,
	revisionId: LabRevisionId
): LabRevisionEntry | null {
	return history.entries.find((entry) => entry.revision.id === revisionId) ?? null;
}

/**
 * Esito che una revisione ereditata puo' dichiarare. `verified` non si eredita:
 * la verifica riguardava quel punto della storia, i file ripristinati sono
 * pronti al rendering ma non ri-verificati adesso.
 */
function carriedState(state: LabRevisionState): LabRevisionState {
	return state === 'verified' ? 'rendering-ready' : state;
}

/* --------------------------------------------------------------- impronte */

const encoder = new TextEncoder();

async function fingerprintOf(content: string): Promise<{ fingerprint: string; bytes: number }> {
	const bytes = encoder.encode(content);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return { fingerprint: `sha256:${hex}`, bytes: bytes.length };
}

function blobPath(archive: LabRevisionArchive, prototypeId: LabPrototypeId, fingerprint: string): string {
	if (!isLabFingerprint(fingerprint)) {
		throw new LabRevisionError('invalid-index', `Impronta non valida: ${JSON.stringify(fingerprint)}`);
	}
	const hex = fingerprint.slice('sha256:'.length);
	return `${labRevisionDirectory(archive, prototypeId)}/${LAB_REVISION_BLOB_DIRECTORY}/${hex}.blob`;
}

/**
 * Il contenuto sopravvive al giro stringa? Byte nulli e caratteri di
 * sostituzione indicano un file che non e' testo: catturarlo produrrebbe un
 * ripristino silenziosamente corrotto.
 */
function isCapturableText(content: string): boolean {
	return !content.includes('\u0000') && !content.includes('\ufffd');
}

/* ---------------------------------------------------------- serializzazione */

function serializeHistory(history: LabRevisionHistory): string {
	return `${JSON.stringify(
		{
			schemaVersion: LAB_REVISION_SCHEMA_VERSION,
			prototypeId: history.prototypeId,
			entries: history.entries.map((entry) => ({
				id: entry.revision.id,
				sequence: entry.revision.sequence,
				createdAt: entry.revision.createdAt,
				state: entry.revision.state,
				requestId: entry.revision.requestId,
				...(entry.revision.parentId ? { parentId: entry.revision.parentId } : {}),
				summary: entry.summary,
				...(entry.closedAt === undefined ? {} : { closedAt: entry.closedAt }),
				...(entry.origin ? { origin: entry.origin } : {}),
				...(entry.snapshotIssue ? { snapshotIssue: entry.snapshotIssue } : {}),
				...(entry.snapshot
					? {
							snapshot: {
								manifest: {
									id: entry.snapshot.manifest.id,
									title: entry.snapshot.manifest.title,
									brief: entry.snapshot.manifest.brief,
									templateVersion: entry.snapshot.manifest.templateVersion,
									dependencies: entry.snapshot.manifest.dependencies.map((dependency) => ({
										name: dependency.name,
										version: dependency.version
									}))
								},
								files: entry.snapshot.files.map((file) => ({
									path: file.path,
									fingerprint: file.fingerprint,
									bytes: file.bytes
								})),
								excluded: [...entry.snapshot.excluded]
							}
						}
					: {})
			}))
		},
		null,
		2
	)}\n`;
}

function invalidIndex(path: string, detail: string): LabRevisionError {
	return new LabRevisionError('invalid-index', `Storia delle revisioni illeggibile in ${path}: ${detail}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseSnapshot(value: unknown, path: string): LabRevisionSnapshot {
	const source = asRecord(value);
	if (!source) throw invalidIndex(path, 'fotografia non valida');
	const manifest = parseLabPrototypeManifest(source.manifest);
	if (!manifest) throw invalidIndex(path, 'manifest della fotografia fuori contratto');
	if (!Array.isArray(source.files)) throw invalidIndex(path, 'elenco dei file assente');

	const files: LabRevisionFile[] = source.files.map((raw) => {
		const file = asRecord(raw);
		if (!file) throw invalidIndex(path, 'voce di file non valida');
		if (!isConfinedPrototypePath(file.path)) {
			throw invalidIndex(path, `percorso fuori dal prototipo: ${JSON.stringify(file.path)}`);
		}
		if (!isLabFingerprint(file.fingerprint)) {
			throw invalidIndex(path, `impronta non valida per ${file.path}`);
		}
		if (typeof file.bytes !== 'number' || !Number.isInteger(file.bytes) || file.bytes < 0) {
			throw invalidIndex(path, `dimensione non valida per ${file.path}`);
		}
		return { path: file.path, fingerprint: file.fingerprint, bytes: file.bytes };
	});

	const excluded = Array.isArray(source.excluded)
		? source.excluded.filter((item): item is string => typeof item === 'string')
		: [];
	return { manifest, files, excluded };
}

function parseHistory(raw: string, prototypeId: LabPrototypeId, path: string): LabRevisionHistory {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new LabRevisionError('invalid-index', `JSON non valido in ${path}.`, { cause: error });
	}
	const source = asRecord(parsed);
	if (!source) throw invalidIndex(path, 'contenuto non oggetto');
	if (source.schemaVersion !== LAB_REVISION_SCHEMA_VERSION) {
		throw invalidIndex(path, `versione di formato non gestita: ${JSON.stringify(source.schemaVersion)}`);
	}
	if (source.prototypeId !== prototypeId) {
		throw invalidIndex(path, `storia del prototipo '${String(source.prototypeId)}', non di '${prototypeId}'`);
	}
	if (!Array.isArray(source.entries)) throw invalidIndex(path, 'elenco delle revisioni assente');

	const entries: LabRevisionEntry[] = source.entries.map((item) => {
		const record = asRecord(item);
		if (!record) throw invalidIndex(path, 'voce di revisione non valida');
		const revision = parseLabRevision({ ...record, prototypeId });
		if (!revision) throw invalidIndex(path, `revisione fuori contratto: ${JSON.stringify(record.id)}`);
		if (typeof record.summary !== 'string') {
			throw invalidIndex(path, `richiesta assente per la revisione '${revision.id}'`);
		}
		const closedAt = record.closedAt;
		if (closedAt !== undefined && (typeof closedAt !== 'number' || !Number.isFinite(closedAt))) {
			throw invalidIndex(path, `chiusura non valida per la revisione '${revision.id}'`);
		}
		const origin = record.origin;
		if (origin !== undefined && origin !== 'restore' && origin !== 'duplicate') {
			throw invalidIndex(path, `provenienza non valida per la revisione '${revision.id}'`);
		}
		// Una revisione aperta non puo' avere una fotografia: si scatta alla chiusura.
		if (closedAt === undefined && record.snapshot !== undefined) {
			throw invalidIndex(path, `la revisione aperta '${revision.id}' non puo' avere una fotografia`);
		}
		return {
			revision,
			summary: record.summary,
			...(closedAt === undefined ? {} : { closedAt }),
			...(origin ? { origin } : {}),
			...(record.snapshot === undefined ? {} : { snapshot: parseSnapshot(record.snapshot, path) }),
			...(typeof record.snapshotIssue === 'string' ? { snapshotIssue: record.snapshotIssue } : {})
		};
	});

	// L'ordine su disco e' l'ordine della storia: `sequence` lo rende verificabile.
	for (let index = 1; index < entries.length; index += 1) {
		if (entries[index].revision.sequence <= entries[index - 1].revision.sequence) {
			throw invalidIndex(path, `sequenza non monotona alla revisione '${entries[index].revision.id}'`);
		}
	}
	if (entries.filter(isOpenLabRevision).length > 1) {
		throw invalidIndex(path, 'piu di una revisione aperta');
	}

	return { prototypeId, entries };
}

/* ------------------------------------------------------------ storia I/O */

function historyPath(context: LabRevisionContext): string {
	return `${labRevisionDirectory(context.archive, context.prototypeId)}/${LAB_REVISION_INDEX_FILE}`;
}

/** Storia del prototipo; vuota se non e' mai stata aperta una revisione. */
export async function readLabRevisionHistory(context: LabRevisionContext): Promise<LabRevisionHistory> {
	const path = historyPath(context);
	const raw = await context.archive.host.readTextFile(path);
	if (raw === null) return { prototypeId: context.prototypeId, entries: [] };
	return parseHistory(raw, context.prototypeId, path);
}

/** Storia ordinata, dalla piu' vecchia alla piu' recente. */
export async function listLabRevisions(context: LabRevisionContext): Promise<LabRevisionEntry[]> {
	return (await readLabRevisionHistory(context)).entries;
}

async function writeHistory(context: LabRevisionContext, history: LabRevisionHistory): Promise<void> {
	const directory = labRevisionDirectory(context.archive, context.prototypeId);
	await context.archive.host.createDirectory(directory);
	await writeLabFileAtomic(context.archive.host, historyPath(context), serializeHistory(history));
}

function nextRevisionId(sequence: number): LabRevisionId {
	return `r${String(sequence).padStart(4, '0')}`;
}

function requireRequest(requestId: LabRequestId, summary: string): void {
	if (typeof requestId !== 'string' || requestId.length === 0) {
		throw new LabRevisionError('invalid-request', 'Una revisione nasce da una richiesta: `requestId` obbligatorio.');
	}
	if (typeof summary !== 'string' || summary.trim().length === 0) {
		throw new LabRevisionError(
			'invalid-request',
			`Richiesta '${requestId}' senza testo: la revisione non sarebbe riconducibile a nulla.`
		);
	}
}

/* -------------------------------------------------------------- apertura */

export interface LabRevisionOpening {
	requestId: LabRequestId;
	/** Testo della richiesta di modifica: e' cio' che rende la revisione riconoscibile. */
	summary: string;
	/** Istante di apertura; predefinito `Date.now()`. */
	now?: number;
}

/**
 * Apre una revisione per una richiesta di modifica. Nasce `interrupted` con
 * `parentId` sulla revisione precedente: se il lavoro non arriva alla
 * chiusura, la storia dice il vero invece di annunciare un completamento.
 *
 * Una sola revisione per volta resta aperta: due richieste contemporanee sugli
 * stessi file produrrebbero una fotografia mescolata.
 */
export async function openLabRevision(
	context: LabRevisionContext,
	opening: LabRevisionOpening
): Promise<LabRevisionEntry> {
	requireRequest(opening.requestId, opening.summary);
	if ((await readLabPrototype(context.store, context.prototypeId)) === null) {
		throw new LabRevisionError(
			'not-found',
			`Il prototipo '${context.prototypeId}' non esiste in ${context.store.host.label}.`
		);
	}

	const history = await readLabRevisionHistory(context);
	const open = openLabRevisionEntry(history);
	if (open) {
		throw new LabRevisionError(
			'revision-open',
			`La revisione '${open.revision.id}' e' ancora aperta: chiuderla con un esito prima di aprirne un'altra.`
		);
	}

	const previous = latestLabRevisionEntry(history);
	const sequence = (previous?.revision.sequence ?? 0) + 1;
	const entry: LabRevisionEntry = {
		revision: {
			id: nextRevisionId(sequence),
			prototypeId: context.prototypeId,
			sequence,
			createdAt: opening.now ?? Date.now(),
			state: 'interrupted',
			requestId: opening.requestId,
			...(previous ? { parentId: previous.revision.id } : {})
		},
		summary: opening.summary
	};

	await writeHistory(context, { prototypeId: context.prototypeId, entries: [...history.entries, entry] });
	return entry;
}

/* -------------------------------------------------------------- chiusura */

export interface LabRevisionClosing {
	/** Istante di chiusura; predefinito `Date.now()`. */
	now?: number;
}

/**
 * Chiude la revisione aperta con il suo esito e ne fotografa i file. La
 * fotografia si prende adesso, tutta insieme: e' cio' che rende una revisione
 * ripristinabile senza mescolare file di momenti diversi.
 *
 * Un esito mostrabile (`rendering-ready`, `verified`) richiede la fotografia:
 * se i file non sono catturabili la chiusura fallisce, perche' dichiarare
 * un'anteprima disponibile senza poterla riprodurre sarebbe falso. Con
 * `failed` o `interrupted` la revisione si chiude registrando il motivo.
 */
export async function closeLabRevision(
	context: LabRevisionContext,
	revisionId: LabRevisionId,
	state: LabRevisionState,
	closing: LabRevisionClosing = {}
): Promise<LabRevisionEntry> {
	if (!isLabRevisionState(state)) {
		throw new LabRevisionError('invalid-request', `Esito non valido: ${JSON.stringify(state)}`);
	}
	const history = await readLabRevisionHistory(context);
	const entry = findLabRevisionEntry(history, revisionId);
	if (!entry) {
		throw new LabRevisionError('not-found', `Revisione '${revisionId}' assente dalla storia di '${context.prototypeId}'.`);
	}
	if (!isOpenLabRevision(entry)) {
		throw new LabRevisionError('not-open', `La revisione '${revisionId}' e' gia' chiusa come '${entry.revision.state}'.`);
	}

	let snapshot: LabRevisionSnapshot | null = null;
	let issue: string | null = null;
	try {
		snapshot = await captureSnapshot(context);
	} catch (error) {
		if (isRenderableRevisionState(state)) throw error;
		issue = error instanceof Error ? error.message : String(error);
	}

	const closed: LabRevisionEntry = {
		...entry,
		revision: { ...entry.revision, state },
		closedAt: closing.now ?? Date.now(),
		...(snapshot ? { snapshot } : {}),
		...(issue ? { snapshotIssue: issue } : {})
	};

	await writeHistory(context, {
		prototypeId: context.prototypeId,
		entries: history.entries.map((item) => (item.revision.id === revisionId ? closed : item))
	});
	return closed;
}

/**
 * Aggiorna lo stato di una revisione gia' chiusa (es. da 'rendering-ready' a 'verified'
 * dopo il completamento della verifica mirata di UI e interazioni, oppure a 'failed').
 * Preserva la fotografia catturata alla chiusura.
 */
export async function updateLabRevisionState(
	context: LabRevisionContext,
	revisionId: LabRevisionId,
	state: LabRevisionState
): Promise<LabRevisionEntry> {
	if (!isLabRevisionState(state)) {
		throw new LabRevisionError('invalid-request', `Esito non valido: ${JSON.stringify(state)}`);
	}
	const history = await readLabRevisionHistory(context);
	const entry = findLabRevisionEntry(history, revisionId);
	if (!entry) {
		throw new LabRevisionError('not-found', `Revisione '${revisionId}' assente dalla storia di '${context.prototypeId}'.`);
	}
	if (isOpenLabRevision(entry)) {
		throw new LabRevisionError('not-open', `La revisione '${revisionId}' e' ancora aperta: usare closeLabRevision.`);
	}

	const updated: LabRevisionEntry = {
		...entry,
		revision: { ...entry.revision, state }
	};

	await writeHistory(context, {
		prototypeId: context.prototypeId,
		entries: history.entries.map((item) => (item.revision.id === revisionId ? updated : item))
	});
	return updated;
}

/**
 * Fotografa il prototipo: manifest validato piu' contenuti dei file
 * catturabili, scritti nell'archivio locale e indirizzati per impronta. Due
 * revisioni che condividono un file non ne conservano due copie.
 */
async function captureSnapshot(context: LabRevisionContext): Promise<LabRevisionSnapshot> {
	const prototype = await readLabPrototype(context.store, context.prototypeId);
	if (!prototype) {
		throw new LabRevisionError(
			'not-found',
			`Il prototipo '${context.prototypeId}' non esiste in ${context.store.host.label}.`
		);
	}

	const listing = await listLabPrototypeFiles(context.store, context.prototypeId);
	const files: LabRevisionFile[] = [];
	for (const path of listing.files) {
		const content = await readLabPrototypeFile(context.store, context.prototypeId, path);
		if (content === null) continue; // scomparso durante la cattura: non c'e' nulla da conservare
		if (!isCapturableText(content)) {
			throw new LabRevisionError(
				'unsupported-content',
				`'${path}' non e' testo: la revisione non lo conserverebbe senza corromperlo.`
			);
		}
		const { fingerprint, bytes } = await fingerprintOf(content);
		await storeBlob(context.archive, context.prototypeId, fingerprint, content);
		files.push({ path, fingerprint, bytes });
	}

	return {
		manifest: prototype.manifest,
		files,
		excluded: listing.skipped.map((entry) => entry.path)
	};
}

async function storeBlob(
	archive: LabRevisionArchive,
	prototypeId: LabPrototypeId,
	fingerprint: string,
	content: string
): Promise<void> {
	const path = blobPath(archive, prototypeId, fingerprint);
	if ((await archive.host.readTextFile(path)) !== null) return;
	const cut = path.lastIndexOf('/');
	await archive.host.createDirectory(path.slice(0, cut));
	await writeLabFileAtomic(archive.host, path, content);
}

async function loadBlob(
	archive: LabRevisionArchive,
	prototypeId: LabPrototypeId,
	file: LabRevisionFile
): Promise<string> {
	const path = blobPath(archive, prototypeId, file.fingerprint);
	const content = await archive.host.readTextFile(path);
	if (content === null) {
		throw new LabRevisionError('no-snapshot', `Contenuto di '${file.path}' assente nell'archivio locale (${path}).`);
	}
	return content;
}

/**
 * Legge tutti i contenuti prima di scrivere: un blob mancante ferma il
 * ripristino con il prototipo ancora intatto, invece di lasciarlo a meta'.
 */
async function loadSnapshotContents(
	archive: LabRevisionArchive,
	prototypeId: LabPrototypeId,
	snapshot: LabRevisionSnapshot
): Promise<Map<string, string>> {
	const contents = new Map<string, string>();
	for (const file of snapshot.files) {
		contents.set(file.path, await loadBlob(archive, prototypeId, file));
	}
	return contents;
}

/* ------------------------------------------------------------ ripristino */

export interface LabRestoreRequest {
	requestId: LabRequestId;
	/** Testo della richiesta che ha chiesto il ripristino. */
	summary: string;
	now?: number;
}

/**
 * Riporta i file del prototipo alla fotografia di una sua revisione e aggiunge
 * una revisione in coda: `parentId` indica da dove arrivano i file, `origin`
 * dice che sono stati ripristinati. La storia successiva resta intera — non si
 * riscrive il passato come se le iterazioni intermedie non fossero avvenute.
 *
 * Il ripristino riguarda soltanto questo prototipo: nessun altro prototipo e
 * nessun file del progetto vengono toccati.
 */
export async function restoreLabRevision(
	context: LabRevisionContext,
	revisionId: LabRevisionId,
	request: LabRestoreRequest
): Promise<LabRevisionEntry> {
	requireRequest(request.requestId, request.summary);
	const history = await readLabRevisionHistory(context);
	const source = findLabRevisionEntry(history, revisionId);
	if (!source) {
		throw new LabRevisionError('not-found', `Revisione '${revisionId}' assente dalla storia di '${context.prototypeId}'.`);
	}
	if (!source.snapshot) {
		throw new LabRevisionError(
			'no-snapshot',
			`La revisione '${revisionId}' non ha una fotografia (${source.revision.state}): non c'e' nulla da ripristinare.`
		);
	}
	const open = openLabRevisionEntry(history);
	if (open) {
		throw new LabRevisionError(
			'revision-open',
			`La revisione '${open.revision.id}' e' ancora aperta: chiuderla prima di ripristinare.`
		);
	}

	const snapshot = source.snapshot;
	const contents = await loadSnapshotContents(context.archive, context.prototypeId, snapshot);

	// Manifest e brief passano dalla validazione; il resto dai percorsi confinati.
	await saveLabPrototype(context.store, snapshot.manifest);

	const wanted = new Set(snapshot.files.map((file) => file.path));
	const present = await listLabPrototypeFiles(context.store, context.prototypeId);
	for (const path of present.files) {
		// I file comparsi dopo la revisione scelta non appartengono a quello
		// stato: restare produrrebbe un prototipo mai esistito. Le voci fuori
		// dal perimetro catturabile non si toccano.
		if (!wanted.has(path)) await removeLabPrototypeFile(context.store, context.prototypeId, path);
	}
	for (const file of snapshot.files) {
		await writeLabPrototypeFile(context.store, context.prototypeId, file.path, contents.get(file.path)!);
	}

	const previous = latestLabRevisionEntry(history);
	const sequence = (previous?.revision.sequence ?? 0) + 1;
	const now = request.now ?? Date.now();
	const entry: LabRevisionEntry = {
		revision: {
			id: nextRevisionId(sequence),
			prototypeId: context.prototypeId,
			sequence,
			createdAt: now,
			state: carriedState(source.revision.state),
			requestId: request.requestId,
			parentId: source.revision.id
		},
		summary: request.summary,
		closedAt: now,
		origin: 'restore',
		snapshot
	};

	await writeHistory(context, { prototypeId: context.prototypeId, entries: [...history.entries, entry] });
	return entry;
}

/* ----------------------------------------------------------- duplicazione */

export interface LabDuplicationRequest {
	/** Prototipo e storia di origine: vengono soltanto letti. */
	source: LabRevisionContext;
	/** Archivio e store del nuovo prototipo; possono coincidere con l'origine. */
	target: { archive: LabRevisionArchive; store: LabStore };
	requestId: LabRequestId;
	/** Revisione da duplicare; predefinita l'ultima con una fotografia. */
	revisionId?: LabRevisionId;
	/** Titolo del duplicato; predefinito quello dell'originale. */
	title?: string;
	summary?: string;
	now?: number;
}

export interface LabDuplicationResult {
	prototype: LabStoredPrototype;
	provenance: LabPrototypeProvenance;
	/** Prima revisione del duplicato: contiene la fotografia copiata. */
	revision: LabRevisionEntry;
}

/**
 * Crea un nuovo prototipo dalla fotografia di una revisione, registrando la
 * provenienza (archivio, prototipo e revisione di origine). L'originale non
 * viene modificato: da lui si legge soltanto.
 */
export async function duplicateLabPrototype(
	input: LabDuplicationRequest
): Promise<LabDuplicationResult> {
	const requestId = input.requestId;
	const history = await readLabRevisionHistory(input.source);
	const candidates = restorableLabRevisions(history);
	const source = input.revisionId
		? findLabRevisionEntry(history, input.revisionId)
		: (candidates[candidates.length - 1] ?? null);
	if (!source) {
		throw new LabRevisionError(
			'not-found',
			input.revisionId
				? `Revisione '${input.revisionId}' assente dalla storia di '${input.source.prototypeId}'.`
				: `Il prototipo '${input.source.prototypeId}' non ha revisioni con una fotografia da duplicare.`
		);
	}
	if (!source.snapshot) {
		throw new LabRevisionError(
			'no-snapshot',
			`La revisione '${source.revision.id}' non ha una fotografia: non c'e' nulla da duplicare.`
		);
	}
	const summary =
		input.summary ??
		`Duplicazione di ${input.source.archive.scope}/${input.source.prototypeId} alla revisione ${source.revision.id}.`;
	requireRequest(requestId, summary);

	const snapshot = source.snapshot;
	const contents = await loadSnapshotContents(input.source.archive, input.source.prototypeId, snapshot);

	const created = await createLabPrototype(input.target.store, {
		title: input.title ?? snapshot.manifest.title,
		brief: snapshot.manifest.brief,
		templateVersion: snapshot.manifest.templateVersion,
		dependencies: snapshot.manifest.dependencies
	});
	for (const file of snapshot.files) {
		await writeLabPrototypeFile(input.target.store, created.id, file.path, contents.get(file.path)!);
	}

	const targetContext: LabRevisionContext = {
		archive: input.target.archive,
		store: input.target.store,
		prototypeId: created.id
	};
	// I contenuti vanno anche nell'archivio del duplicato: la sua storia deve
	// restare ripristinabile se l'originale viene cancellato.
	for (const file of snapshot.files) {
		await storeBlob(input.target.archive, created.id, file.fingerprint, contents.get(file.path)!);
	}

	const now = input.now ?? Date.now();
	const provenance: LabPrototypeProvenance = {
		sourceScope: input.source.archive.scope,
		sourcePrototypeId: input.source.prototypeId,
		sourceRevisionId: source.revision.id,
		sourceLocation: labPrototypeLocation(input.source.store, input.source.prototypeId),
		duplicatedAt: now
	};
	await writeProvenance(targetContext, provenance);

	const entry: LabRevisionEntry = {
		revision: {
			id: nextRevisionId(1),
			prototypeId: created.id,
			sequence: 1,
			createdAt: now,
			state: carriedState(source.revision.state),
			requestId,
			parentId: source.revision.id
		},
		summary,
		closedAt: now,
		origin: 'duplicate',
		snapshot: { manifest: created.manifest, files: [...snapshot.files], excluded: [...snapshot.excluded] }
	};
	await writeHistory(targetContext, { prototypeId: created.id, entries: [entry] });

	return { prototype: created, provenance, revision: entry };
}

function provenancePath(context: LabRevisionContext): string {
	return `${labRevisionDirectory(context.archive, context.prototypeId)}/${LAB_PROVENANCE_FILE}`;
}

async function writeProvenance(
	context: LabRevisionContext,
	provenance: LabPrototypeProvenance
): Promise<void> {
	const directory = labRevisionDirectory(context.archive, context.prototypeId);
	await context.archive.host.createDirectory(directory);
	await writeLabFileAtomic(
		context.archive.host,
		provenancePath(context),
		`${JSON.stringify({ schemaVersion: LAB_REVISION_SCHEMA_VERSION, ...provenance }, null, 2)}\n`
	);
}

/** Provenienza registrata del prototipo; `null` se non nasce da una duplicazione. */
export async function readLabPrototypeProvenance(
	context: LabRevisionContext
): Promise<LabPrototypeProvenance | null> {
	const path = provenancePath(context);
	const raw = await context.archive.host.readTextFile(path);
	if (raw === null) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new LabRevisionError('invalid-index', `JSON non valido in ${path}.`, { cause: error });
	}
	const source = asRecord(parsed);
	if (!source) throw invalidIndex(path, 'contenuto non oggetto');
	if (source.schemaVersion !== LAB_REVISION_SCHEMA_VERSION) {
		throw invalidIndex(path, `versione di formato non gestita: ${JSON.stringify(source.schemaVersion)}`);
	}
	if (!isLabRevisionScope(source.sourceScope)) throw invalidIndex(path, 'archivio di origine non valido');
	if (!isLabPrototypeId(source.sourcePrototypeId)) throw invalidIndex(path, 'prototipo di origine non valido');
	if (typeof source.sourceRevisionId !== 'string' || source.sourceRevisionId.length === 0) {
		throw invalidIndex(path, 'revisione di origine non valida');
	}
	if (typeof source.duplicatedAt !== 'number' || !Number.isFinite(source.duplicatedAt)) {
		throw invalidIndex(path, 'istante di duplicazione non valido');
	}
	const location = parseLabPrototypeLocation(source.sourceLocation);
	if (!location) throw invalidIndex(path, 'collocazione di origine non valida');

	return {
		sourceScope: source.sourceScope,
		sourcePrototypeId: source.sourcePrototypeId,
		sourceRevisionId: source.sourceRevisionId,
		sourceLocation: location,
		duplicatedAt: source.duplicatedAt
	};
}
