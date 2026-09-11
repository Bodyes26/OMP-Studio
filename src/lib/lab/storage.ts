// Persistenza dei prototipi del Laboratorio: manifest, brief e sorgenti su
// disco, dentro `<progetto>/proto/<id>` per i prototipi di progetto e dentro
// l'archivio bozze locale di Studio per le idee nate senza progetto.
//
// Il modulo non importa `node:fs` ne' le API Tauri: ogni operazione passa da
// `LabStorageHost`, la porta minima verso il filesystem. E' cio' che rende
// questa logica eseguibile su un filesystem reale in `npm test` e
// riutilizzabile dal broker di scrittura confinata, che ne fornira'
// l'implementazione dentro Studio (la superficie attuale di Tauri non basta:
// `file_write` non e' atomica e `path_rename` rifiuta una destinazione
// esistente, quindi non puo' sostituire un manifest).
//
// Invarianti garantiti qui, non affidati a istruzioni di prompt:
//
//  1. l'identita' del prototipo e' l'id nel manifest, uguale al nome della
//     cartella: su disco non viene scritto nessun percorso assoluto ne' la
//     chiave del progetto, quindi rinominare o spostare il repository non
//     perde il prototipo;
//  2. ogni scrittura e' atomica: temporaneo nella stessa cartella e
//     sostituzione della destinazione, cosi' un'interruzione lascia intatta la
//     revisione precedente invece di troncarla;
//  3. ogni percorso scritto e' confinato nella cartella del prototipo:
//     traversal, percorsi assoluti, separatori Windows, nomi riservati e
//     cartelle nascoste come `.git` sono rifiutati prima di toccare l'host;
//  4. due prototipi non si sovrascrivono: la cartella si crea in modo
//     esclusivo e l'allocazione dell'id cerca il primo nome libero;
//  5. un manifest fuori contratto e' un errore esplicito, non un oggetto
//     parzialmente valido: `prototype.json` viene riletto e validato dai
//     contratti dello Step 1.
//
// Questo modulo non esegue Git e non modifica nulla fuori dal prototipo:
// nessun commit, nessun `.gitignore`.

import {
	LAB_PROTOTYPE_DIRECTORY,
	draftPrototypeLocation,
	isLabPrototypeId,
	isReservedFileSystemName,
	parseLabPrototypeManifest,
	projectPrototypeLocation,
	type LabDependency,
	type LabProjectKey,
	type LabPrototypeId,
	type LabPrototypeLocation,
	type LabPrototypeManifest
} from './contracts.ts';
import { m as msg } from '$lib/paraglide/messages.js';

/* ------------------------------------------------------------- struttura */

/** Manifest portabile del prototipo, dentro la sua cartella. */
export const LAB_MANIFEST_FILE = 'prototype.json';

/** Brief leggibile: e' la sorgente autoritativa del testo del brief. */
export const LAB_BRIEF_FILE = 'brief.md';

/** Sorgenti React del prototipo. */
export const LAB_SOURCE_DIRECTORY = 'src';

/** Asset locali utilizzabili dal prototipo. */
export const LAB_ASSETS_DIRECTORY = 'assets';

/**
 * Cartella delle bozze dentro la cartella dati locale di Studio
 * (`%LOCALAPPDATA%/omp-studio` su Windows, `~/.omp-studio` altrove: la stessa
 * radice usata per le estensioni). L'host e' radicato sulla cartella dati, non
 * su questa sottocartella, per restare simmetrico al caso progetto.
 */
export const LAB_DRAFT_ARCHIVE_DIRECTORY = 'lab/drafts';

/**
 * Versione del formato di `prototype.json`. Un file scritto da una versione
 * futura viene rifiutato: aggiornare da soli un prototipo salvato ne
 * cambierebbe l'aspetto senza che l'utente lo abbia chiesto.
 */
export const LAB_MANIFEST_SCHEMA_VERSION = 1;

/* ---------------------------------------------------------------- errori */

export const LAB_STORAGE_ERROR_CODES = [
	'invalid-id',
	'invalid-path',
	'invalid-manifest',
	'already-exists',
	'not-found',
	'host-failure'
] as const;

export type LabStorageErrorCode = (typeof LAB_STORAGE_ERROR_CODES)[number];

/** Errore con causa esplicita: chi chiama distingue un rifiuto da un guasto. */
export class LabStorageError extends Error {
	readonly code: LabStorageErrorCode;

	constructor(code: LabStorageErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'LabStorageError';
		this.code = code;
	}
}

function invalidPath(message: string): LabStorageError {
	return new LabStorageError('invalid-path', message);
}

/* ------------------------------------------------------------------ host */

export interface LabDirectoryEntry {
	name: string;
	kind: 'file' | 'directory' | 'other';
}

/**
 * Porta verso il filesystem. Tutti i percorsi sono relativi alla radice
 * dell'host e usano `/`: l'host li unisce alla propria radice e non riceve mai
 * un percorso costruito dal modello.
 */
export interface LabStorageHost {
	/** Etichetta diagnostica della radice: compare nei messaggi d'errore. */
	readonly label: string;
	/** Contenuto del file, `null` se non esiste. */
	readTextFile(path: string): Promise<string | null>;
	/** Crea un file nuovo; deve fallire se esiste (serve per i temporanei). */
	createFile(path: string, content: string): Promise<void>;
	/** Sostituisce `target` con `temp` in un solo passo, anche se `target` esiste. */
	replaceFile(temp: string, target: string): Promise<void>;
	/** Rimozione idempotente: nessun errore se il file non esiste. */
	removeFile(path: string): Promise<void>;
	/**
	 * Crea la cartella e i genitori mancanti. Con `exclusive` ritorna `false`
	 * se la cartella esiste gia', senza toccarne il contenuto.
	 */
	createDirectory(path: string, options?: { exclusive?: boolean }): Promise<boolean>;
	/** Voci della cartella, `null` se la cartella non esiste. */
	listDirectory(path: string): Promise<LabDirectoryEntry[] | null>;
}

/* --------------------------------------------------------------- archivi */

/**
 * Archivio dei prototipi: un progetto (cartella `proto/`) oppure l'archivio
 * bozze locale. La chiave del progetto serve solo a instradare in memoria:
 * non viene mai scritta su disco.
 */
export type LabStore =
	| { kind: 'project'; projectKey: LabProjectKey; host: LabStorageHost }
	| { kind: 'draft'; host: LabStorageHost };

export function labProjectStore(projectKey: LabProjectKey, host: LabStorageHost): LabStore {
	if (typeof projectKey !== 'string' || projectKey.length === 0) {
		throw new LabStorageError('invalid-path', 'La chiave del progetto non puo essere vuota.');
	}
	return { kind: 'project', projectKey, host };
}

export function labDraftStore(host: LabStorageHost): LabStore {
	return { kind: 'draft', host };
}

/** Cartella che contiene i prototipi dell'archivio, relativa alla radice. */
export function labStoreContainer(store: LabStore): string {
	return store.kind === 'project' ? LAB_PROTOTYPE_DIRECTORY : LAB_DRAFT_ARCHIVE_DIRECTORY;
}

/** Cartella del prototipo: `proto/<id>` nel progetto, `lab/drafts/<id>` in archivio. */
export function labPrototypeDirectory(store: LabStore, id: LabPrototypeId): string {
	if (!isLabPrototypeId(id)) {
		throw new LabStorageError('invalid-id', `Id di prototipo non valido: ${JSON.stringify(id)}`);
	}
	return `${labStoreContainer(store)}/${id}`;
}

/** Collocazione secondo i contratti: id per le bozze, `proto/<id>` nel progetto. */
export function labPrototypeLocation(store: LabStore, id: LabPrototypeId): LabPrototypeLocation {
	if (!isLabPrototypeId(id)) {
		throw new LabStorageError('invalid-id', `Id di prototipo non valido: ${JSON.stringify(id)}`);
	}
	const location =
		store.kind === 'project'
			? projectPrototypeLocation(store.projectKey, id)
			: draftPrototypeLocation(id);
	if (!location) {
		throw new LabStorageError('invalid-id', `Collocazione non derivabile per '${id}'.`);
	}
	return location;
}

/**
 * Riassocia i prototipi a un progetto rinominato o spostato. Cambia solo la
 * chiave di instradamento: nessun file viene riscritto, perche' l'identita'
 * vive nel manifest e nel nome della cartella.
 */
export function rebindLabPrototypes(
	prototypes: readonly LabStoredPrototype[],
	projectKey: LabProjectKey
): LabStoredPrototype[] {
	if (typeof projectKey !== 'string' || projectKey.length === 0) {
		throw new LabStorageError('invalid-path', 'La chiave del progetto non puo essere vuota.');
	}
	return prototypes.map((prototype) => {
		const location = projectPrototypeLocation(projectKey, prototype.id);
		if (!location) {
			throw new LabStorageError('invalid-id', `Id di prototipo non valido: ${prototype.id}`);
		}
		return { ...prototype, location };
	});
}

/* ------------------------------------------------------------- percorsi */

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const MAX_SEGMENT_LENGTH = 96;
const MAX_RELATIVE_LENGTH = 240;

function isSafeSegment(segment: string): boolean {
	if (segment.length === 0 || segment.length > MAX_SEGMENT_LENGTH) return false;
	if (!PATH_SEGMENT_PATTERN.test(segment)) return false;
	// Windows tronca il punto finale: `src.` e `src` sarebbero la stessa cartella.
	if (segment.endsWith('.')) return false;
	return !isReservedFileSystemName(segment);
}

/**
 * Percorso relativo utilizzabile dentro un prototipo. Il primo carattere di
 * ogni segmento non puo' essere un punto: cosi' `..` e le cartelle nascoste
 * (`.git`, `.omp`) sono rifiutate dalla stessa regola.
 */
export function isConfinedPrototypePath(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	if (value.length === 0 || value.length > MAX_RELATIVE_LENGTH) return false;
	if (value.includes('\\')) return false;
	if (value.includes('\u0000')) return false;
	const segments = value.split('/');
	return segments.every(isSafeSegment);
}

/**
 * Percorso completo di un file del prototipo, relativo alla radice dell'host.
 * `prototype.json` non e' scrivibile da questa via: passa da
 * `saveLabPrototype`, che lo valida.
 */
export function labPrototypeFilePath(
	store: LabStore,
	id: LabPrototypeId,
	relativePath: string
): string {
	const directory = labPrototypeDirectory(store, id);
	if (!isConfinedPrototypePath(relativePath)) {
		throw invalidPath(
			`Percorso fuori dal prototipo '${id}': ${JSON.stringify(relativePath)}`
		);
	}
	return `${directory}/${relativePath}`;
}

/* -------------------------------------------------------- scrittura atomica */

let temporaryCounter = 0;

function temporaryToken(): string {
	const bytes = new Uint8Array(6);
	crypto.getRandomValues(bytes);
	const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	temporaryCounter = (temporaryCounter + 1) % 0xffff;
	return `${random}${temporaryCounter.toString(16)}`;
}

/**
 * Il temporaneo sta nella stessa cartella della destinazione: una
 * sostituzione tra filesystem diversi non sarebbe atomica. Il nome ricalca la
 * convenzione di `src-tauri/src/fs_atomic.rs`.
 */
function temporaryPathFor(path: string): string {
	const cut = path.lastIndexOf('/');
	const directory = cut < 0 ? '' : path.slice(0, cut + 1);
	const name = cut < 0 ? path : path.slice(cut + 1);
	return `${directory}.${name}.${temporaryToken()}.tmp`;
}

/** Riconosce i temporanei di questo modulo: servono a ignorarli negli elenchi. */
export function isLabTemporaryName(name: string): boolean {
	return name.startsWith('.') && name.endsWith('.tmp');
}

/**
 * Scrittura atomica: temporaneo nella stessa cartella e sostituzione in un
 * solo passo. Esportata perche' le revisioni locali scrivono nel proprio
 * archivio con la stessa garanzia, senza duplicare la procedura.
 */
export async function writeLabFileAtomic(
	host: LabStorageHost,
	path: string,
	content: string
): Promise<void> {
	const temporary = temporaryPathFor(path);
	try {
		await host.createFile(temporary, content);
	} catch (error) {
		throw new LabStorageError(
			'host-failure',
			msg.ui_ts_storage_scrittura_del_temporaneo_value1_in_value2_fallita_18eb({ value1: temporary, value2: host.label }),
			{ cause: error }
		);
	}
	try {
		await host.replaceFile(temporary, path);
	} catch (error) {
		// La destinazione resta quella di prima: si rimuove solo il temporaneo.
		try {
			await host.removeFile(temporary);
		} catch {
			// Un temporaneo residuo non giustifica di perdere l'errore vero.
		}
		throw new LabStorageError(
			'host-failure',
			msg.ui_ts_storage_sostituzione_di_value1_in_value2_fallita_db9a({ value1: path, value2: host.label }),
			{ cause: error }
		);
	}
}

/* -------------------------------------------------------------- manifest */

export interface LabStoredPrototype {
	id: LabPrototypeId;
	location: LabPrototypeLocation;
	manifest: LabPrototypeManifest;
}

/** Dati minimi per creare un prototipo; l'id si alloca dal titolo se assente. */
export interface LabPrototypeCreation {
	title: string;
	brief: string;
	templateVersion: string;
	dependencies?: readonly LabDependency[];
	id?: LabPrototypeId;
}

/**
 * `prototype.json` non contiene il brief: il testo vive in `brief.md`, cosi'
 * non esistono due copie che possono divergere quando l'utente modifica il
 * file dall'editor.
 */
function serializeManifest(manifest: LabPrototypeManifest): string {
	return `${JSON.stringify(
		{
			schemaVersion: LAB_MANIFEST_SCHEMA_VERSION,
			id: manifest.id,
			title: manifest.title,
			templateVersion: manifest.templateVersion,
			dependencies: manifest.dependencies.map((dependency) => ({
				name: dependency.name,
				version: dependency.version
			}))
		},
		null,
		2
	)}\n`;
}

function validateManifest(candidate: unknown, source: string): LabPrototypeManifest {
	const manifest = parseLabPrototypeManifest(candidate);
	if (!manifest) {
		throw new LabStorageError('invalid-manifest', `Manifest fuori contratto: ${source}`);
	}
	return manifest;
}

/**
 * Il brief e' testo, non byte: la newline finale del file e i ritorni carrello
 * di Windows non ne fanno parte, altrimenti scrivere e rileggere cambierebbe
 * il valore del manifest.
 */
function normalizeBrief(raw: string): string {
	return raw.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function briefDocument(brief: string): string {
	const trimmed = normalizeBrief(brief);
	return trimmed.length === 0 ? '' : `${trimmed}\n`;
}

/* --------------------------------------------------------------- lettura */

/**
 * Rilegge un prototipo dalla sua cartella. `null` se non esiste; un manifest
 * illeggibile o incoerente con il nome della cartella e' un errore esplicito.
 */
export async function readLabPrototype(
	store: LabStore,
	id: LabPrototypeId
): Promise<LabStoredPrototype | null> {
	const directory = labPrototypeDirectory(store, id);
	const manifestPath = `${directory}/${LAB_MANIFEST_FILE}`;
	const raw = await store.host.readTextFile(manifestPath);
	if (raw === null) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new LabStorageError('invalid-manifest', `JSON non valido in ${manifestPath}.`, {
			cause: error
		});
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new LabStorageError('invalid-manifest', `${manifestPath} non contiene un oggetto.`);
	}

	const record = parsed as Record<string, unknown>;
	if (record.schemaVersion !== LAB_MANIFEST_SCHEMA_VERSION) {
		throw new LabStorageError(
			'invalid-manifest',
			`Versione di formato non gestita in ${manifestPath}: ${JSON.stringify(record.schemaVersion)}.`
		);
	}

	const briefFile = await store.host.readTextFile(`${directory}/${LAB_BRIEF_FILE}`);
	const brief = briefFile === null ? '' : normalizeBrief(briefFile);
	const manifest = validateManifest(
		{
			id: record.id,
			title: record.title,
			brief,
			templateVersion: record.templateVersion,
			dependencies: record.dependencies
		},
		manifestPath
	);
	// Il nome della cartella e' autoritativo: un manifest con un altro id
	// renderebbe ambiguo quale prototipo si sta leggendo.
	if (manifest.id !== id) {
		throw new LabStorageError(
			'invalid-manifest',
			msg.ui_ts_storage_l_id_value1_in_value2_non_corrisponde_ea5c({ value1: manifest.id, value2: manifestPath, value3: id })
		);
	}

	return { id, location: labPrototypeLocation(store, id), manifest };
}

export interface LabPrototypeListing {
	prototypes: LabStoredPrototype[];
	/** Cartelle presenti ma non rilette: si segnalano, non si cancellano. */
	unreadable: { name: string; reason: string }[];
}

/** Elenco dei prototipi dell'archivio, ordinato per id. */
export async function listLabPrototypes(store: LabStore): Promise<LabPrototypeListing> {
	const container = labStoreContainer(store);
	const entries = (await store.host.listDirectory(container)) ?? [];
	const listing: LabPrototypeListing = { prototypes: [], unreadable: [] };

	const names = entries
		.filter((entry) => entry.kind === 'directory')
		.map((entry) => entry.name)
		.sort();

	for (const name of names) {
		// Valutato prima del type guard: dopo il rifiuto TypeScript restringe
		// `name` a `never`, perche' un id valido e' comunque una stringa.
		const hidden = name.startsWith('.');
		if (!isLabPrototypeId(name)) {
			// I temporanei e le cartelle nascoste non sono prototipi rotti.
			if (!hidden) {
				listing.unreadable.push({ name, reason: msg.ui_ts_storage_nome_di_cartella_non_valido_come_id_9b56() });
			}
			continue;
		}
		try {
			const prototype = await readLabPrototype(store, name);
			if (prototype) listing.prototypes.push(prototype);
			else listing.unreadable.push({ name, reason: `manca ${LAB_MANIFEST_FILE}` });
		} catch (error) {
			listing.unreadable.push({
				name,
				reason: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return listing;
}

/** Elenco delle bozze senza progetto conservate nell'archivio locale. */
export async function listLabDrafts(host: LabStorageHost): Promise<LabPrototypeListing> {
	return listLabPrototypes(labDraftStore(host));
}

/* ------------------------------------------------------------- id stabile */

const FALLBACK_ID_BASE = 'prototipo';
const MAX_ID_BASE_LENGTH = 48;
const MAX_ID_ATTEMPTS = 999;

/**
 * Id derivato dal titolo: minuscolo, senza accenti ne' separatori di percorso.
 * `null` se non resta nulla di utilizzabile.
 */
export function slugifyPrototypeTitle(title: string): LabPrototypeId | null {
	if (typeof title !== 'string') return null;
	const slug = title
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_ID_BASE_LENGTH)
		.replace(/-+$/g, '');
	return isLabPrototypeId(slug) ? slug : null;
}

/**
 * Primo id libero nell'archivio: `titolo`, poi `titolo-2`, `titolo-3`... Due
 * prototipi con lo stesso titolo ottengono cartelle distinte invece di
 * sovrascriversi.
 */
export async function allocateLabPrototypeId(store: LabStore, title: string): Promise<LabPrototypeId> {
	const base = slugifyPrototypeTitle(title) ?? FALLBACK_ID_BASE;
	const container = labStoreContainer(store);
	const entries = (await store.host.listDirectory(container)) ?? [];
	const taken = new Set(entries.map((entry) => entry.name));

	if (!taken.has(base)) return base;
	for (let attempt = 2; attempt <= MAX_ID_ATTEMPTS; attempt += 1) {
		const suffix = `-${attempt}`;
		const trimmed = base.slice(0, MAX_ID_BASE_LENGTH - suffix.length).replace(/-+$/g, '');
		const candidate = `${trimmed.length > 0 ? trimmed : FALLBACK_ID_BASE}${suffix}`;
		if (!taken.has(candidate) && isLabPrototypeId(candidate)) return candidate;
	}
	throw new LabStorageError(
		'already-exists',
		`Nessun id libero per '${title}' in ${store.host.label}/${container}.`
	);
}

/* ------------------------------------------------------------- scrittura */

/**
 * Crea il prototipo: cartella esclusiva, `prototype.json`, `brief.md`, `src/`
 * e `assets/`. Se la cartella esiste gia' l'operazione fallisce senza
 * toccarne il contenuto.
 */
export async function createLabPrototype(
	store: LabStore,
	input: LabPrototypeCreation
): Promise<LabStoredPrototype> {
	const id = input.id ?? (await allocateLabPrototypeId(store, input.title));
	const manifest = validateManifest(
		{
			id,
			title: input.title,
			brief: input.brief,
			templateVersion: input.templateVersion,
			dependencies: input.dependencies ?? []
		},
		`nuovo prototipo '${id}'`
	);

	const container = labStoreContainer(store);
	const directory = labPrototypeDirectory(store, id);
	await store.host.createDirectory(container);
	const created = await store.host.createDirectory(directory, { exclusive: true });
	if (!created) {
		throw new LabStorageError(
			'already-exists',
			`Il prototipo '${id}' esiste gia' in ${store.host.label}/${container}.`
		);
	}
	await store.host.createDirectory(`${directory}/${LAB_SOURCE_DIRECTORY}`);
	await store.host.createDirectory(`${directory}/${LAB_ASSETS_DIRECTORY}`);

	await writeLabFileAtomic(store.host, `${directory}/${LAB_MANIFEST_FILE}`, serializeManifest(manifest));
	await writeLabFileAtomic(store.host, `${directory}/${LAB_BRIEF_FILE}`, briefDocument(manifest.brief));

	return { id, location: labPrototypeLocation(store, id), manifest };
}

/**
 * Riscrive manifest e brief di un prototipo esistente. Il prototipo deve
 * esserci: creare da qui una cartella mancante nasconderebbe un archivio
 * spostato o cancellato.
 */
export async function saveLabPrototype(
	store: LabStore,
	candidate: LabPrototypeManifest
): Promise<LabStoredPrototype> {
	const manifest = validateManifest(candidate, `prototipo '${String(candidate?.id)}'`);
	const directory = labPrototypeDirectory(store, manifest.id);
	if ((await store.host.listDirectory(directory)) === null) {
		throw new LabStorageError(
			'not-found',
			`Il prototipo '${manifest.id}' non esiste in ${store.host.label}.`
		);
	}

	await writeLabFileAtomic(store.host, `${directory}/${LAB_MANIFEST_FILE}`, serializeManifest(manifest));
	await writeLabFileAtomic(store.host, `${directory}/${LAB_BRIEF_FILE}`, briefDocument(manifest.brief));

	return { id: manifest.id, location: labPrototypeLocation(store, manifest.id), manifest };
}

/**
 * Scrive un file dentro il prototipo (sorgente, asset, configurazione). Il
 * manifest e' escluso: passa da `saveLabPrototype`, che lo valida.
 */
export async function writeLabPrototypeFile(
	store: LabStore,
	id: LabPrototypeId,
	relativePath: string,
	content: string
): Promise<string> {
	const path = labPrototypeFilePath(store, id, relativePath);
	if (relativePath === LAB_MANIFEST_FILE) {
		throw invalidPath(`${LAB_MANIFEST_FILE} si aggiorna con saveLabPrototype, non come file libero.`);
	}
	const directory = labPrototypeDirectory(store, id);
	if ((await store.host.listDirectory(directory)) === null) {
		throw new LabStorageError('not-found', `Il prototipo '${id}' non esiste in ${store.host.label}.`);
	}

	const cut = path.lastIndexOf('/');
	if (cut > 0) await store.host.createDirectory(path.slice(0, cut));
	await writeLabFileAtomic(store.host, path, content);
	return path;
}

/** Legge un file del prototipo; `null` se non esiste. */
export async function readLabPrototypeFile(
	store: LabStore,
	id: LabPrototypeId,
	relativePath: string
): Promise<string | null> {
	return store.host.readTextFile(labPrototypeFilePath(store, id, relativePath));
}

/* ------------------------------------------------------- inventario file */

/** Profondita' massima esplorata: un albero piu' fondo e' un errore, non un ciclo da inseguire. */
const MAX_WALK_DEPTH = 12;

export interface LabPrototypeFileListing {
	/** Percorsi relativi al prototipo, ordinati, scrivibili da questo modulo. */
	files: string[];
	/**
	 * Voci presenti su disco ma fuori dal perimetro scrivibile (nomi nascosti,
	 * segmenti non sicuri, alberi troppo profondi). Si segnalano: una revisione
	 * non le cattura e un ripristino non le cancella.
	 */
	skipped: { path: string; reason: string }[];
}

/**
 * Inventario dei file del prototipo. Serve alle revisioni: senza l'elenco
 * effettivo un ripristino lascerebbe sul disco i file aggiunti dopo la
 * revisione scelta, producendo uno stato che non e' mai esistito.
 *
 * `prototype.json` e `brief.md` sono esclusi: appartengono al manifest, che si
 * riscrive con `saveLabPrototype` dopo la validazione.
 */
export async function listLabPrototypeFiles(
	store: LabStore,
	id: LabPrototypeId
): Promise<LabPrototypeFileListing> {
	const root = labPrototypeDirectory(store, id);
	if ((await store.host.listDirectory(root)) === null) {
		throw new LabStorageError('not-found', `Il prototipo '${id}' non esiste in ${store.host.label}.`);
	}

	const listing: LabPrototypeFileListing = { files: [], skipped: [] };
	const pending: { relative: string; depth: number }[] = [{ relative: '', depth: 0 }];

	while (pending.length > 0) {
		const current = pending.pop()!;
		const absolute = current.relative.length === 0 ? root : `${root}/${current.relative}`;
		const entries = (await store.host.listDirectory(absolute)) ?? [];
		for (const entry of entries) {
			const relative = current.relative.length === 0 ? entry.name : `${current.relative}/${entry.name}`;
			if (entry.kind === 'file' && isLabTemporaryName(entry.name)) continue;
			if (!isSafeSegment(entry.name)) {
				listing.skipped.push({ path: relative, reason: 'nome fuori dal perimetro scrivibile' });
				continue;
			}
			if (entry.kind === 'directory') {
				if (current.depth + 1 > MAX_WALK_DEPTH) {
					listing.skipped.push({ path: relative, reason: 'albero troppo profondo' });
					continue;
				}
				pending.push({ relative, depth: current.depth + 1 });
				continue;
			}
			if (entry.kind !== 'file') {
				listing.skipped.push({ path: relative, reason: `voce di tipo ${entry.kind}` });
				continue;
			}
			if (relative === LAB_MANIFEST_FILE || relative === LAB_BRIEF_FILE) continue;
			listing.files.push(relative);
		}
	}

	listing.files.sort();
	listing.skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return listing;
}

/**
 * Rimuove un file del prototipo. Idempotente. Manifest e brief non passano da
 * qui: sono l'identita' del prototipo e si riscrivono con `saveLabPrototype`.
 */
export async function removeLabPrototypeFile(
	store: LabStore,
	id: LabPrototypeId,
	relativePath: string
): Promise<void> {
	const path = labPrototypeFilePath(store, id, relativePath);
	if (relativePath === LAB_MANIFEST_FILE || relativePath === LAB_BRIEF_FILE) {
		throw invalidPath(`${relativePath} non si rimuove: fa parte dell'identita' del prototipo.`);
	}
	try {
		await store.host.removeFile(path);
	} catch (error) {
		throw new LabStorageError('host-failure', msg.ui_ts_storage_rimozione_di_value1_in_value2_fallita_b563({ value1: path, value2: store.host.label }), {
			cause: error
		});
	}
}
