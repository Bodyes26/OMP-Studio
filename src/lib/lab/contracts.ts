// Contratti tipizzati del Laboratorio prototipi: identita', revisioni, eventi
// e messaggi del renderer.
//
// Questo modulo e' deliberatamente puro: nessuna API Tauri, nessun RPC,
// nessuna UI e nessun accesso al filesystem. Contiene soltanto tipi e funzioni
// totali, cosi' che le regole non negoziabili del Laboratorio siano
// verificabili con un test e non affidate a istruzioni di prompt:
//
//  1. un prototipo vive in `proto/<id>` del progetto oppure in una bozza
//     locale; l'id e' un nome di cartella sicuro, non un percorso assoluto;
//  2. le dipendenze dichiarate sono fissate a una versione esatta, mai
//     `latest` o un intervallo;
//  3. ogni evento identifica progetto, prototipo, sessione e richiesta, e per
//     rendering, selezione e verifica anche la revisione osservata;
//  4. ogni messaggio del renderer e' legato alla revisione a cui si riferisce,
//     cosi' che una selezione obsoleta non modifichi un elemento diverso.
//
// Le funzioni di parsing falliscono chiuse: un valore fuori contratto produce
// `null` (o un esito `ok: false`), mai un oggetto parzialmente valido.

/* ------------------------------------------------------------- identita' */

/** Identita' stabile di un prototipo: nome di cartella, non un percorso. */
export type LabPrototypeId = string;

/** Chiave del progetto ospite (o dell'archivio bozze) usata per instradare. */
export type LabProjectKey = string;

/** Sessione OMP dedicata al prototipo, distinta da quella del principale. */
export type LabSessionId = string;

/** Richiesta dell'utente o dell'orchestratore all'interno di una sessione. */
export type LabRequestId = string;

/** Revisione recuperabile: una fotografia per richiesta di modifica. */
export type LabRevisionId = string;

/** Cartella, dentro il progetto, che ospita i prototipi versionabili. */
export const LAB_PROTOTYPE_DIRECTORY = 'proto';

const PROTOTYPE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

// Nomi riservati da Windows a prescindere dall'estensione: un prototipo che si
// chiamasse cosi' non potrebbe avere la propria cartella su questa piattaforma.
const RESERVED_DIRECTORY_NAMES: Record<string, true> = {
	con: true,
	prn: true,
	aux: true,
	nul: true,
	com1: true,
	com2: true,
	com3: true,
	com4: true,
	com5: true,
	com6: true,
	com7: true,
	com8: true,
	com9: true,
	lpt1: true,
	lpt2: true,
	lpt3: true,
	lpt4: true,
	lpt5: true,
	lpt6: true,
	lpt7: true,
	lpt8: true,
	lpt9: true
};

/**
 * Nome riservato dal filesystem di Windows: `con`, `nul`, `com1`... La regola
 * vale a prescindere dall'estensione, quindi `con.tsx` e' inutilizzabile
 * esattamente come `con`. Serve sia agli id dei prototipi sia ai percorsi
 * scritti dentro un prototipo.
 */
export function isReservedFileSystemName(value: string): boolean {
	const base = value.split('.', 1)[0] ?? '';
	return RESERVED_DIRECTORY_NAMES[base.toLowerCase()] === true;
}

/**
 * Un id valido e' minuscolo, senza separatori di percorso e utilizzabile come
 * nome di cartella su tutte le piattaforme supportate. Rifiutare qui e' cio'
 * che impedisce a `proto/<id>` di diventare un traversal.
 */
export function isLabPrototypeId(value: unknown): value is LabPrototypeId {
	if (typeof value !== 'string') return false;
	if (!PROTOTYPE_ID_PATTERN.test(value)) return false;
	if (value.endsWith('-')) return false;
	return !isReservedFileSystemName(value);
}

/** Percorso del prototipo relativo alla radice del progetto: `proto/<id>`. */
export function labPrototypeRelativePath(id: LabPrototypeId): string | null {
	return isLabPrototypeId(id) ? `${LAB_PROTOTYPE_DIRECTORY}/${id}` : null;
}

/**
 * Collocazione del prototipo. Le bozze senza progetto vivono in un archivio
 * locale gestito da Studio e restano recuperabili dopo la chiusura dell'app.
 */
export type LabPrototypeLocation =
	| { kind: 'project'; projectKey: LabProjectKey; relativePath: string }
	| { kind: 'draft'; archiveKey: string };

/** Costruisce la collocazione dentro un progetto, derivando `proto/<id>`. */
export function projectPrototypeLocation(
	projectKey: LabProjectKey,
	id: LabPrototypeId
): LabPrototypeLocation | null {
	const relativePath = labPrototypeRelativePath(id);
	if (!relativePath) return null;
	if (typeof projectKey !== 'string' || projectKey.length === 0) return null;
	return { kind: 'project', projectKey, relativePath };
}

/** Costruisce la collocazione di una bozza locale, senza progetto ne' Git. */
export function draftPrototypeLocation(archiveKey: string): LabPrototypeLocation | null {
	if (typeof archiveKey !== 'string' || archiveKey.length === 0) return null;
	return { kind: 'draft', archiveKey };
}

export function parseLabPrototypeLocation(value: unknown): LabPrototypeLocation | null {
	const source = record(value);
	if (!source) return null;
	if (source.kind === 'project') {
		const projectKey = nonEmpty(source.projectKey);
		const relativePath = nonEmpty(source.relativePath);
		if (!projectKey || !relativePath) return null;
		// Il percorso non e' un campo libero: deve essere esattamente la
		// cartella derivata da un id valido, altrimenti la collocazione
		// potrebbe indicare la radice del progetto o un altro prototipo.
		const prefix = `${LAB_PROTOTYPE_DIRECTORY}/`;
		if (!relativePath.startsWith(prefix)) return null;
		const id = relativePath.slice(prefix.length);
		if (labPrototypeRelativePath(id) !== relativePath) return null;
		return { kind: 'project', projectKey, relativePath };
	}
	if (source.kind === 'draft') {
		const archiveKey = nonEmpty(source.archiveKey);
		return archiveKey ? { kind: 'draft', archiveKey } : null;
	}
	return null;
}

/** Id del prototipo dedotto dalla collocazione dentro un progetto. */
export function prototypeIdFromLocation(location: LabPrototypeLocation): LabPrototypeId | null {
	if (location.kind !== 'project') return null;
	const id = location.relativePath.slice(LAB_PROTOTYPE_DIRECTORY.length + 1);
	return isLabPrototypeId(id) ? id : null;
}

/* -------------------------------------------------------------- manifest */

/** Dipendenza dichiarata: nome npm e versione esatta, mai un intervallo. */
export interface LabDependency {
	name: string;
	version: string;
}

/**
 * Manifest portabile del prototipo. Titolo e brief servono a ricostruire il
 * lavoro su un'altra macchina anche senza la chat locale; `templateVersion`
 * lega il prototipo al template/runtime con cui e' stato prodotto.
 */
export interface LabPrototypeManifest {
	id: LabPrototypeId;
	title: string;
	brief: string;
	templateVersion: string;
	dependencies: readonly LabDependency[];
}

// Semver esatto: nessun prefisso di intervallo, nessun carattere jolly.
const EXACT_VERSION_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Versione fissata: `1.2.3`, non `^1.2.3`, `~1.2`, `latest` o `*`. */
export function isPinnedVersion(value: unknown): value is string {
	return typeof value === 'string' && EXACT_VERSION_PATTERN.test(value);
}

export function isPackageName(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 214 && PACKAGE_NAME_PATTERN.test(value);
}

export function parseLabDependency(value: unknown): LabDependency | null {
	const source = record(value);
	if (!source) return null;
	if (!isPackageName(source.name)) return null;
	if (!isPinnedVersion(source.version)) return null;
	return { name: source.name, version: source.version };
}

export function parseLabPrototypeManifest(value: unknown): LabPrototypeManifest | null {
	const source = record(value);
	if (!source) return null;
	if (!isLabPrototypeId(source.id)) return null;
	const title = nonEmpty(source.title);
	const brief = typeof source.brief === 'string' ? source.brief : null;
	if (!title || brief === null) return null;
	if (!isPinnedVersion(source.templateVersion)) return null;
	if (!Array.isArray(source.dependencies)) return null;

	const dependencies: LabDependency[] = [];
	const seen = new Set<string>();
	for (const entry of source.dependencies) {
		const dependency = parseLabDependency(entry);
		if (!dependency) return null;
		// Due versioni dello stesso pacchetto non sono una configurazione
		// riproducibile: e' un manifest da rifiutare, non da normalizzare.
		if (seen.has(dependency.name)) return null;
		seen.add(dependency.name);
		dependencies.push(dependency);
	}

	return { id: source.id, title, brief, templateVersion: source.templateVersion, dependencies };
}

/* ------------------------------------------------------------- revisioni */

export const LAB_REVISION_STATES = ['rendering-ready', 'verified', 'failed', 'interrupted'] as const;

export type LabRevisionState = (typeof LAB_REVISION_STATES)[number];

/**
 * Revisione locale: nasce da una richiesta di modifica, non da ogni scrittura.
 * `sequence` e' l'ordine autoritativo dentro un prototipo; `createdAt` e `id`
 * servono solo a rendere totale il confronto quando due record condividono la
 * stessa posizione.
 */
export interface LabRevision {
	id: LabRevisionId;
	prototypeId: LabPrototypeId;
	sequence: number;
	createdAt: number;
	state: LabRevisionState;
	requestId: LabRequestId;
	/** Revisione di origine per ripristini e duplicazioni. */
	parentId?: LabRevisionId;
}

export function isLabRevisionState(value: unknown): value is LabRevisionState {
	return typeof value === 'string' && (LAB_REVISION_STATES as readonly string[]).includes(value);
}

/** Solo questi stati hanno un'anteprima mostrabile all'utente. */
export function isRenderableRevisionState(state: LabRevisionState): boolean {
	return state === 'rendering-ready' || state === 'verified';
}

export function parseLabRevision(value: unknown): LabRevision | null {
	const source = record(value);
	if (!source) return null;
	const id = nonEmpty(source.id);
	const requestId = nonEmpty(source.requestId);
	if (!id || !requestId) return null;
	if (!isLabPrototypeId(source.prototypeId)) return null;
	if (!isLabRevisionState(source.state)) return null;
	if (!positiveInteger(source.sequence)) return null;
	if (!nonNegativeNumber(source.createdAt)) return null;
	const parentId = nonEmpty(source.parentId);
	return {
		id,
		prototypeId: source.prototypeId,
		sequence: source.sequence,
		createdAt: source.createdAt,
		state: source.state,
		requestId,
		...(parentId ? { parentId } : {})
	};
}

/**
 * Uguaglianza di revisioni: l'id da solo non basta, perche' due prototipi
 * distinti possono numerare le proprie revisioni in modo indipendente.
 */
export function sameLabRevision(a: LabRevision, b: LabRevision): boolean {
	return a.id === b.id && a.prototypeId === b.prototypeId;
}

/**
 * Ordine totale e deterministico: `sequence`, poi istante di creazione, poi id.
 * Un ordinamento parziale renderebbe ambiguo quale sia "l'ultima revisione".
 */
export function compareLabRevisions(a: LabRevision, b: LabRevision): number {
	if (a.sequence !== b.sequence) return a.sequence - b.sequence;
	if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

/** Copia ordinata dal piu' vecchio al piu' recente; l'array in ingresso resta intatto. */
export function sortLabRevisions(revisions: readonly LabRevision[]): LabRevision[] {
	return [...revisions].sort(compareLabRevisions);
}

export function isNewerLabRevision(candidate: LabRevision, reference: LabRevision): boolean {
	return compareLabRevisions(candidate, reference) > 0;
}

export function latestLabRevision(revisions: readonly LabRevision[]): LabRevision | null {
	let latest: LabRevision | null = null;
	for (const revision of revisions) {
		if (!latest || compareLabRevisions(revision, latest) > 0) latest = revision;
	}
	return latest;
}

/**
 * Ultima revisione con un'anteprima valida: e' cio' che resta visibile quando
 * la generazione successiva fallisce o viene interrotta.
 */
export function latestRenderableLabRevision(revisions: readonly LabRevision[]): LabRevision | null {
	return latestLabRevision(revisions.filter((revision) => isRenderableRevisionState(revision.state)));
}

/**
 * Un riferimento visuale (selezione, annotazione) e' obsoleto se non punta
 * alla revisione osservata adesso: va rivalidato, non applicato altrove.
 */
export function isStaleRevisionReference(
	referencedRevisionId: LabRevisionId | undefined,
	observedRevisionId: LabRevisionId | undefined
): boolean {
	if (!referencedRevisionId || !observedRevisionId) return true;
	return referencedRevisionId !== observedRevisionId;
}

/* ------------------------------------------------------ contesto acquisito */

/** Provenienza del materiale acquisito: da dove arriva davvero il contenuto. */
export const LAB_CONTEXT_ORIGINS = ['working-tree', 'git-head', 'attachment', 'reference-url'] as const;

export type LabContextOrigin = (typeof LAB_CONTEXT_ORIGINS)[number];

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Impronta del contenuto acquisito, nella forma `sha256:<64 esadecimali>`. */
export function isLabFingerprint(value: unknown): value is string {
	return typeof value === 'string' && FINGERPRINT_PATTERN.test(value);
}

export interface LabContextFile {
	/** Percorso relativo alla radice del progetto, oppure URL per i riferimenti. */
	path: string;
	fingerprint: string;
	origin: LabContextOrigin;
}

/**
 * Fotografia del contesto acquisito per l'indagine: file, impronte,
 * provenienza e istante. `coherent` a `false` dichiara che non e' stato
 * possibile ottenere un insieme coerente mentre il principale scriveva:
 * si segnala, non si finge un'acquisizione atomica.
 */
export interface LabContextSnapshot {
	id: string;
	prototypeId: LabPrototypeId;
	capturedAt: number;
	coherent: boolean;
	files: readonly LabContextFile[];
}

export function parseLabContextFile(value: unknown): LabContextFile | null {
	const source = record(value);
	if (!source) return null;
	const path = nonEmpty(source.path);
	if (!path) return null;
	if (!isLabFingerprint(source.fingerprint)) return null;
	const origin = member(source.origin, LAB_CONTEXT_ORIGINS);
	return origin ? { path, fingerprint: source.fingerprint, origin } : null;
}

export function parseLabContextSnapshot(value: unknown): LabContextSnapshot | null {
	const source = record(value);
	if (!source) return null;
	const id = nonEmpty(source.id);
	if (!id) return null;
	if (!isLabPrototypeId(source.prototypeId)) return null;
	if (!nonNegativeNumber(source.capturedAt)) return null;
	if (typeof source.coherent !== 'boolean') return null;
	if (!Array.isArray(source.files)) return null;

	const files: LabContextFile[] = [];
	const seen = new Set<string>();
	for (const entry of source.files) {
		const file = parseLabContextFile(entry);
		if (!file) return null;
		if (seen.has(file.path)) return null;
		seen.add(file.path);
		files.push(file);
	}

	return { id, prototypeId: source.prototypeId, capturedAt: source.capturedAt, coherent: source.coherent, files };
}

/**
 * Percorsi acquisiti la cui impronta non corrisponde piu' a quella attuale.
 * Il Laboratorio li segnala: l'aggiornamento del contesto resta una scelta
 * dell'utente, non una rigenerazione automatica.
 */
export function changedContextPaths(
	snapshot: LabContextSnapshot,
	currentFingerprints: ReadonlyMap<string, string>
): string[] {
	const changed: string[] = [];
	for (const file of snapshot.files) {
		const current = currentFingerprints.get(file.path);
		if (current !== undefined && current !== file.fingerprint) changed.push(file.path);
	}
	return changed;
}

/* ---------------------------------------------------------------- eventi */

export const LAB_EVENT_KINDS = [
	'prompt',
	'steering',
	'input_request',
	'abort',
	'transcript',
	'usage',
	'tool',
	'subagent',
	'async_result',
	'context',
	'rendering',
	'selection',
	'verification'
] as const;

export type LabEventKind = (typeof LAB_EVENT_KINDS)[number];

/**
 * Famiglie di eventi che parlano di cio' che l'utente sta guardando: senza
 * revisione non si sa a quale anteprima si riferiscono, quindi sono rifiutate.
 */
export const LAB_REVISION_BOUND_EVENT_KINDS = ['rendering', 'selection', 'verification'] as const;

export type LabRevisionBoundEventKind = (typeof LAB_REVISION_BOUND_EVENT_KINDS)[number];

export function isLabEventKind(value: unknown): value is LabEventKind {
	return typeof value === 'string' && (LAB_EVENT_KINDS as readonly string[]).includes(value);
}

export function requiresRevisionId(kind: LabEventKind): kind is LabRevisionBoundEventKind {
	return (LAB_REVISION_BOUND_EVENT_KINDS as readonly string[]).includes(kind);
}

/**
 * Involucro di ogni evento del Laboratorio. Il solo cwd non distingue due
 * attivita' nello stesso progetto: servono progetto, prototipo, sessione e
 * richiesta insieme, e la revisione dove il concetto di anteprima esiste.
 */
export interface LabEventEnvelope {
	kind: LabEventKind;
	projectKey: LabProjectKey;
	prototypeId: LabPrototypeId;
	sessionId: LabSessionId;
	requestId: LabRequestId;
	revisionId?: LabRevisionId;
}

export const LAB_CONTRACT_ERROR_CODES = [
	'invalid-shape',
	'unknown-kind',
	'missing-project',
	'invalid-prototype-id',
	'missing-session',
	'missing-request',
	'missing-revision',
	'invalid-revision'
] as const;

export type LabContractErrorCode = (typeof LAB_CONTRACT_ERROR_CODES)[number];

export type LabCheck<T> = { ok: true; value: T } | { ok: false; code: LabContractErrorCode; message: string };

function fail<T>(code: LabContractErrorCode, message: string): LabCheck<T> {
	return { ok: false, code, message };
}

/**
 * Validazione dell'involucro con motivo esplicito. Fallisce chiusa: un evento
 * di rendering, selezione o verifica senza `revisionId` viene scartato invece
 * di essere applicato all'anteprima corrente per approssimazione.
 */
export function checkLabEventEnvelope(value: unknown): LabCheck<LabEventEnvelope> {
	const source = record(value);
	if (!source) return fail('invalid-shape', 'Involucro assente o non oggetto.');
	if (!isLabEventKind(source.kind)) return fail('unknown-kind', `Tipo di evento non riconosciuto: ${String(source.kind)}`);

	const kind = source.kind;
	const projectKey = nonEmpty(source.projectKey);
	if (!projectKey) return fail('missing-project', 'projectKey mancante.');
	if (!isLabPrototypeId(source.prototypeId)) {
		return fail('invalid-prototype-id', `prototypeId non valido: ${String(source.prototypeId)}`);
	}
	const sessionId = nonEmpty(source.sessionId);
	if (!sessionId) return fail('missing-session', 'sessionId mancante.');
	const requestId = nonEmpty(source.requestId);
	if (!requestId) return fail('missing-request', 'requestId mancante.');

	const hasRevisionField = source.revisionId !== undefined && source.revisionId !== null;
	const revisionId = nonEmpty(source.revisionId);
	if (hasRevisionField && !revisionId) return fail('invalid-revision', 'revisionId presente ma non valido.');
	if (requiresRevisionId(kind) && !revisionId) {
		return fail('missing-revision', `Gli eventi '${kind}' devono indicare la revisione osservata.`);
	}

	return {
		ok: true,
		value: {
			kind,
			projectKey,
			prototypeId: source.prototypeId,
			sessionId,
			requestId,
			...(revisionId ? { revisionId } : {})
		}
	};
}

export function parseLabEventEnvelope(value: unknown): LabEventEnvelope | null {
	const checked = checkLabEventEnvelope(value);
	return checked.ok ? checked.value : null;
}

/** Due involucri parlano della stessa attivita': progetto, prototipo e sessione. */
export function sameLabTarget(a: LabEventEnvelope, b: LabEventEnvelope): boolean {
	return a.projectKey === b.projectKey && a.prototypeId === b.prototypeId && a.sessionId === b.sessionId;
}

/**
 * L'evento riguarda l'anteprima che l'utente sta guardando? Un evento legato a
 * una revisione superata arriva tardi e non deve aggiornare l'oggetto corrente.
 */
export function envelopeMatchesObservedRevision(
	envelope: LabEventEnvelope,
	observedRevisionId: LabRevisionId | undefined
): boolean {
	if (!requiresRevisionId(envelope.kind)) return true;
	return !isStaleRevisionReference(envelope.revisionId, observedRevisionId);
}

/* ------------------------------------------------------ messaggi renderer */

/**
 * Politica di rete del prototipo. Vive nel controller del renderer, non nel
 * documento generato: la sola CSP non impedisce una navigazione via
 * `location.href`. `blocked` e' il valore predefinito e non ammette origini.
 */
export interface LabNetworkPolicy {
	mode: 'blocked' | 'allowlist';
	allowedOrigins: readonly string[];
}

export const LAB_NETWORK_POLICY_BLOCKED: LabNetworkPolicy = { mode: 'blocked', allowedOrigins: [] };

export interface LabViewportPoint {
	x: number;
	y: number;
}

export interface LabElementRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Elemento selezionato nell'anteprima, riferito alla revisione osservata. */
export interface LabInspectedElement {
	selector: string;
	tagName: string;
	rect: LabElementRect;
	textSnippet?: string;
}

export type LabCaptureTarget = 'viewport' | 'full_page' | 'element';

/**
 * Comandi verso il renderer. Operazioni delimitate: navigazione interna al
 * prototipo, ricarica, politica di rete, cattura e ispezione. Nessun comando
 * generico di esecuzione di codice sul computer.
 */
export type LabRendererCommand =
	| { type: 'navigate'; revisionId: LabRevisionId; route: string }
	| { type: 'reload'; revisionId: LabRevisionId; hard: boolean }
	| { type: 'set_network_policy'; revisionId: LabRevisionId; policy: LabNetworkPolicy }
	| { type: 'set_viewport'; revisionId: LabRevisionId; width: number; height: number; deviceScaleFactor?: number }
	| { type: 'capture'; revisionId: LabRevisionId; target: LabCaptureTarget; selector?: string }
	| { type: 'inspect_point'; revisionId: LabRevisionId; x: number; y: number }
	| { type: 'inspect_element'; revisionId: LabRevisionId; selector?: string; point?: LabViewportPoint };
/** Notifiche dal renderer: contenuto non fidato, sempre legato a una revisione. */
export type LabRendererNotification =
	| { type: 'inspected_element'; revisionId: LabRevisionId; element: LabInspectedElement }
	| {
			type: 'navigation_state';
			revisionId: LabRevisionId;
			route: string;
			canGoBack: boolean;
			canGoForward: boolean;
			loading: boolean;
	  };

const CAPTURE_TARGETS: readonly LabCaptureTarget[] = ['viewport', 'full_page', 'element'];

export const LAB_VIEWPORT_PRESETS = {
	desktop: { width: 1280, height: 800, label: 'Desktop (1280x800)' },
	tablet: { width: 768, height: 1024, label: 'Tablet (768x1024)' },
	mobile: { width: 390, height: 844, label: 'Mobile (390x844)' }
} as const;

export type LabViewportPresetName = keyof typeof LAB_VIEWPORT_PRESETS;

/**
 * Annotazione visuale legata alla revisione osservata.
 * Include elemento selezionato, eventuale screenshot, commento e viewport.
 */
export interface LabVisualAnnotation {
	id: string;
	revisionId: LabRevisionId;
	element?: LabInspectedElement;
	screenshotBase64?: string;
	comment: string;
	viewport: { width: number; height: number };
	createdAt: number;
}

/**
 * Pacchetto di contesto visuale allegato a una richiesta per l'agente.
 * Se la revisione osservata e' cambiata rispetto alla revisione del riferimento,
 * `stale` e' true e il contesto non puo essere applicato alla cieca.
 */
export interface LabVisualContextAttachment {
	type: 'visual_context';
	revisionId: LabRevisionId;
	element?: LabInspectedElement;
	screenshotBase64?: string;
	comment?: string;
	viewport: { width: number; height: number };
	stale: boolean;
}

/** Le rotte del prototipo sono interne: percorsi assoluti, mai URL esterni. */
function internalRoute(value: unknown): string | null {
	if (typeof value !== 'string' || !value.startsWith('/')) return null;
	// `//host` viene interpretato come URL protocol-relative dal browser.
	return value.startsWith('//') ? null : value;
}

export function parseLabNetworkPolicy(value: unknown): LabNetworkPolicy | null {
	const source = record(value);
	if (!source) return null;
	if (source.mode !== 'blocked' && source.mode !== 'allowlist') return null;
	if (!Array.isArray(source.allowedOrigins)) return null;
	const allowedOrigins: string[] = [];
	for (const origin of source.allowedOrigins) {
		const value = nonEmpty(origin);
		if (!value) return null;
		allowedOrigins.push(value);
	}
	// Origini elencate con la rete chiusa: intenzione ambigua, si rifiuta.
	if (source.mode === 'blocked' && allowedOrigins.length > 0) return null;
	if (source.mode === 'allowlist' && allowedOrigins.length === 0) return null;
	return { mode: source.mode, allowedOrigins };
}

export function parseLabRendererCommand(value: unknown): LabRendererCommand | null {
	const source = record(value);
	if (!source) return null;
	const revisionId = nonEmpty(source.revisionId);
	if (!revisionId) return null;

	switch (source.type) {
		case 'navigate': {
			const route = internalRoute(source.route);
			return route ? { type: 'navigate', revisionId, route } : null;
		}
		case 'reload':
			return { type: 'reload', revisionId, hard: source.hard === true };
		case 'set_network_policy': {
			const policy = parseLabNetworkPolicy(source.policy);
			return policy ? { type: 'set_network_policy', revisionId, policy } : null;
		}
		case 'set_viewport': {
			if (!positiveInteger(source.width) || !positiveInteger(source.height)) return null;
			const deviceScaleFactor = source.deviceScaleFactor !== undefined ? source.deviceScaleFactor : 1;
			if (!finiteNumber(deviceScaleFactor) || deviceScaleFactor <= 0) return null;
			return {
				type: 'set_viewport',
				revisionId,
				width: source.width,
				height: source.height,
				deviceScaleFactor
			};
		}
		case 'capture': {
			const target = member(source.target, CAPTURE_TARGETS);
			if (!target) return null;
			const selector = nonEmpty(source.selector);
			// Catturare "l'elemento" senza dire quale non e' un'operazione delimitata.
			if (target === 'element' && !selector) return null;
			return { type: 'capture', revisionId, target, ...(selector ? { selector } : {}) };
		}
		case 'inspect_point': {
			if (!finiteNumber(source.x) || !finiteNumber(source.y)) return null;
			return { type: 'inspect_point', revisionId, x: source.x, y: source.y };
		}
		case 'inspect_element': {
			const selector = nonEmpty(source.selector);
			const point = parseViewportPoint(source.point);
			if (!selector && !point) return null;
			return {
				type: 'inspect_element',
				revisionId,
				...(selector ? { selector } : {}),
				...(point ? { point } : {})
			};
		}
		default:
			return null;
	}
}

export function parseLabRendererNotification(value: unknown): LabRendererNotification | null {
	const source = record(value);
	if (!source) return null;
	const revisionId = nonEmpty(source.revisionId);
	if (!revisionId) return null;

	switch (source.type) {
		case 'inspected_element': {
			const element = parseLabInspectedElement(source.element);
			return element ? { type: 'inspected_element', revisionId, element } : null;
		}
		case 'navigation_state': {
			const route = internalRoute(source.route);
			if (!route) return null;
			if (
				typeof source.canGoBack !== 'boolean' ||
				typeof source.canGoForward !== 'boolean' ||
				typeof source.loading !== 'boolean'
			) {
				return null;
			}
			return {
				type: 'navigation_state',
				revisionId,
				route,
				canGoBack: source.canGoBack,
				canGoForward: source.canGoForward,
				loading: source.loading
			};
		}
		default:
			return null;
	}
}

export function parseLabInspectedElement(value: unknown): LabInspectedElement | null {
	const source = record(value);
	if (!source) return null;
	const selector = nonEmpty(source.selector);
	const tagName = nonEmpty(source.tagName);
	if (!selector || !tagName) return null;
	const rect = record(source.rect);
	if (!rect) return null;
	if (!finiteNumber(rect.x) || !finiteNumber(rect.y)) return null;
	if (!finiteNumber(rect.width) || !finiteNumber(rect.height)) return null;
	if (rect.width < 0 || rect.height < 0) return null;
	const textSnippet = typeof source.textSnippet === 'string' ? source.textSnippet : null;
	return {
		selector,
		tagName,
		rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		...(textSnippet !== null ? { textSnippet } : {})
	};
}

function parseViewportPoint(value: unknown): LabViewportPoint | null {
	const source = record(value);
	if (!source) return null;
	if (!finiteNumber(source.x) || !finiteNumber(source.y)) return null;
	return { x: source.x, y: source.y };
}

/**
 * Un messaggio del renderer puo' essere applicato solo se parla della revisione
 * osservata: e' la stessa regola degli eventi, applicata al bridge.
 */
export function rendererMessageMatchesRevision(
	message: LabRendererCommand | LabRendererNotification,
	observedRevisionId: LabRevisionId | undefined
): boolean {
	return !isStaleRevisionReference(message.revisionId, observedRevisionId);
}

export function parseLabVisualAnnotation(value: unknown): LabVisualAnnotation | null {
	const source = record(value);
	if (!source) return null;
	const id = nonEmpty(source.id);
	const revisionId = nonEmpty(source.revisionId);
	const comment = typeof source.comment === 'string' ? source.comment : null;
	if (!id || !revisionId || comment === null) return null;
	if (!nonNegativeNumber(source.createdAt)) return null;

	const viewport = record(source.viewport);
	if (!viewport || !positiveInteger(viewport.width) || !positiveInteger(viewport.height)) return null;

	const element = source.element ? parseLabInspectedElement(source.element) : undefined;
	if (source.element && !element) return null;

	const screenshotBase64 =
		typeof source.screenshotBase64 === 'string' && source.screenshotBase64.length > 0
			? source.screenshotBase64
			: undefined;

	return {
		id,
		revisionId,
		...(element ? { element } : {}),
		...(screenshotBase64 ? { screenshotBase64 } : {}),
		comment,
		viewport: { width: viewport.width, height: viewport.height },
		createdAt: source.createdAt
	};
}

export function parseLabVisualContextAttachment(value: unknown): LabVisualContextAttachment | null {
	const source = record(value);
	if (!source || source.type !== 'visual_context') return null;
	const revisionId = nonEmpty(source.revisionId);
	if (!revisionId) return null;
	if (typeof source.stale !== 'boolean') return null;

	const viewport = record(source.viewport);
	if (!viewport || !positiveInteger(viewport.width) || !positiveInteger(viewport.height)) return null;

	const element = source.element ? parseLabInspectedElement(source.element) : undefined;
	if (source.element && !element) return null;

	const comment = typeof source.comment === 'string' ? source.comment : undefined;
	const screenshotBase64 =
		typeof source.screenshotBase64 === 'string' && source.screenshotBase64.length > 0
			? source.screenshotBase64
			: undefined;

	return {
		type: 'visual_context',
		revisionId,
		...(element ? { element } : {}),
		...(screenshotBase64 ? { screenshotBase64 } : {}),
		...(comment ? { comment } : {}),
		viewport: { width: viewport.width, height: viewport.height },
		stale: source.stale
	};
}

/**
 * Verifica se un riferimento visuale puo essere applicato alla revisione osservata.
 * Fallisce se la revisione osservata non coincide con quella del riferimento.
 */
export function validateVisualReferenceApplication(
	referenceRevisionId: LabRevisionId | undefined,
	currentObservedRevisionId: LabRevisionId | undefined
): { ok: true } | { ok: false; code: 'stale_revision' | 'missing_revision'; message: string } {
	if (!referenceRevisionId || !currentObservedRevisionId) {
		return {
			ok: false,
			code: 'missing_revision',
			message: 'Riferimento o revisione osservata mancante.'
		};
	}
	if (isStaleRevisionReference(referenceRevisionId, currentObservedRevisionId)) {
		return {
			ok: false,
			code: 'stale_revision',
			message: `Il riferimento visuale appartiene alla revisione '${referenceRevisionId}' ma l'anteprima e' alla revisione '${currentObservedRevisionId}'. Riconferma la selezione o rivalidala prima dell'invio.`
		};
	}
	return { ok: true };
}

/**
 * Formatta l'allegato visuale in testo chiaro e strutturato per il prompt dell'agente.
 */
export function formatVisualContextForPrompt(attachment: LabVisualContextAttachment): string {
	const lines: string[] = [];
	lines.push(`[Riferimento visuale alla revisione: ${attachment.revisionId}]`);
	lines.push(`Viewport: ${attachment.viewport.width}x${attachment.viewport.height}`);
	if (attachment.element) {
		lines.push(`Elemento selezionato: <${attachment.element.tagName}> ${attachment.element.selector}`);
		lines.push(
			`Rettangolo: ${attachment.element.rect.width}x${attachment.element.rect.height} px a (${attachment.element.rect.x}, ${attachment.element.rect.y})`
		);
		if (attachment.element.textSnippet) {
			lines.push(`Testo estratto: "${attachment.element.textSnippet}"`);
		}
	}
	if (attachment.comment) {
		lines.push(`Annotazione utente: ${attachment.comment}`);
	}
	if (attachment.stale) {
		lines.push(`[AVVISO: La revisione osservata e' cambiata; verificare compatibilita']`);
	}
	return lines.join('\n');
}

/**
 * Funzione pura per redigere dati sensibili da testi estratti dal DOM.
 * Impedisce perdite accidentali di password, token, bearer o credenziali.
 */
export function redactSensitiveText(text: string): string {
	if (!text || typeof text !== 'string') return text;
	return text
		.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
		.replace(
			/((?:token|secret|password|passwd|api[_-]?key)\s*[:=]\s*["']?)[A-Za-z0-9\-._~+/]{4,}(["']?)/gi,
			'$1[REDACTED]$2'
		)
		.replace(/:\/\/([^:@\s]+):([^@\s]+)@/g, '://[REDACTED]:[REDACTED]@');
}

/* ---------------------------------------------------- export e handoff (Step 14) */

export interface LabExportOptions {
	destinationPath: string;
	revisionId: LabRevisionId;
	overwrite?: boolean;
}

export type LabExportErrorCode =
	| 'destination-exists'
	| 'invalid-destination'
	| 'revision-not-found'
	| 'no-snapshot'
	| 'export-failed';

export interface LabExportResult {
	ok: boolean;
	destinationPath: string;
	revisionId: LabRevisionId;
	exportedFiles: readonly string[];
	manifest: LabPrototypeManifest;
	error?: string;
	errorCode?: LabExportErrorCode;
}

export const LAB_DEFAULT_SIMULATION_LIMITS: readonly string[] = Object.freeze([
	'Dati e azioni puramente simulati in memoria nel client; nessun database o backend operativo collegato.',
	'Nessuna autenticazione o credenziali reali: token, ruoli e permessi sono mockati o fittizi.',
	'Stack frontend in React + Tailwind v4: se il progetto target usa Svelte o un altro framework, adatta e riscrivi nello stack nativo senza forzare il runtime React del Laboratorio.',
	'Nessun auto-merge implicito: l\'incorporazione richiede valutazione e adattamento esplicito da parte del principale.',
	'I sorgenti del prototipo originale in proto/ e le revisioni del Laboratorio non devono essere modificati durante l\'incorporazione.'
]);

export interface LabHandoffReference {
	prototypeId: LabPrototypeId;
	prototypeTitle: string;
	revisionId: LabRevisionId;
	variant?: string;
	brief: string;
	dependencies: readonly LabDependency[];
	simulationLimits: readonly string[];
	files: ReadonlyMap<string, string>;
	createdAt: number;
}

export interface LabHandoffPackage extends LabHandoffReference {
	formattedPrompt: string;
}

export interface LabHandoffDeliveryResult {
	ok: boolean;
	targetSessionKey: string;
	deliveredPrompt: string;
	enqueued: boolean;
	error?: string;
}

/* --------------------------------------------------- migrazione preesistente */

/**
 * Prototipo HTML legacy generato dal vecchio comportamento di `studio_preview`
 * o salvato direttamente come singolo file in `proto/<slug>.html`.
 */
export interface LabLegacyPrototype {
	readonly id: string;
	readonly fileName: string;
	readonly relativePath: string;
	readonly title: string;
	readonly kind: 'legacy-html';
	/**
	 * Invariante vincolante (ricerca/laboratorio-prototipi-piano.md § 10.E):
	 * un prototipo legacy o la sua ricostruzione NON devono mai essere spacciati
	 * per una conversione fedele o 1:1 del codice sorgente originale.
	 */
	readonly isFaithfulConversion: false;
}

export interface LabLegacyPrototypeContent extends LabLegacyPrototype {
	readonly rawHtml: string;
}

export interface LabLegacyReconstruction {
	readonly legacyId: string;
	readonly legacyFileName: string;
	readonly suggestedPrototypeTitle: string;
	readonly suggestedPrototypeId: LabPrototypeId;
	readonly isFaithfulConversion: false;
	readonly notice: string;
	readonly brief: string;
}

/**
 * Stato della regola per `proto/` all'interno del file `.gitignore` del progetto.
 */
export type GitignorePrototypeRuleKind =
	| 'automated_legacy' // `# OMP Studio prototypes\nproto/`
	| 'migrated_versionable' // `# OMP Studio prototypes (legacy)\nproto/*.html`
	| 'user_defined' // regola scritta dall'utente senza il marcatore Studio
	| 'none'; // nessuna regola per `proto/`

export interface GitignoreInspectionResult {
	readonly hasGitignore: boolean;
	readonly status: GitignorePrototypeRuleKind;
	readonly matchedRule: string | null;
	readonly lineIndex: number;
	readonly userLinesCount: number;
	readonly explanation: string;
}

export interface GitignoreMigrationResult {
	readonly success: boolean;
	readonly migrated: boolean;
	readonly status: GitignorePrototypeRuleKind;
	readonly content: string;
	readonly diff: string;
	readonly error?: string;
}

export interface GitignoreRollbackResult {
	readonly success: boolean;
	readonly reverted: boolean;
	readonly content: string;
	readonly diff: string;
	readonly error?: string;
}

/* --------------------------------------------------------------- helper */

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nonEmpty(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T | null {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function finiteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function positiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function nonNegativeNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
