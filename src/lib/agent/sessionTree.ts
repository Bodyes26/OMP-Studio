// Albero della sessione omp lato GUI: diramazioni, mappatura dei messaggi del
// transcript sulle entry durevoli e righe del pannello «Rami».
//
// Modulo puro: niente Svelte, niente Tauri. La sessione gli passa una funzione
// `send` e i dati che ha gia'; qui si decide *quale* entry usare e come
// interpretare le risposte di omp, cosi' tutta la logica e' testabile con le
// fixture.
//
// Contratto omp (docs/rpc.md, 18.8):
// - `get_entries { since? }` -> `{ entries, leafId }`: append-history completa
//   (tutti i rami, non solo quello attivo); con `since` solo le entry dopo
//   quella indicata; `since` sconosciuto fallisce con `code: "unknown_since"`.
// - `get_tree` -> `{ tree, leafId }`: lo stesso insieme come foresta grezza
//   (`{ entry, children, label? }`, figli in ordine di timestamp).
// - `fork { entryId? }` -> `{ cancelled }`: nuova sessione con la cronologia
//   (intera, o dalla radice fino a `entryId` incluso). Rifiuta con
//   `code: "session_busy"` se c'e' lavoro in corso.
// - `branch { entryId }` -> `{ text, cancelled }`: `entryId` deve essere un
//   messaggio utente; nuova sessione con la cronologia fino al suo genitore e
//   il testo del messaggio da rimettere nell'editor.
// Via RPC non esiste lo spostamento della foglia *nello stesso file* (il
// `navigateTree` del `/tree` della TUI): ogni diramazione apre un file nuovo.

import type { AgentMessage, ContentBlock } from './wire';

/** Entry durevole di omp: si usa solo il sottoinsieme strutturale comune. */
export interface OmpSessionEntry {
	type: string;
	id: string;
	parentId: string | null;
	/** ISO 8601 della scrittura dell'entry. */
	timestamp?: string;
	/** Presente sulle entry `type: "message"`. */
	message?: AgentMessage;
	/** Presente sulle entry `label`. */
	targetId?: string;
	label?: string;
	[key: string]: unknown;
}

export interface OmpTreeNode {
	entry: OmpSessionEntry;
	children: OmpTreeNode[];
	label?: string;
}

export interface OmpEntriesPage {
	entries: OmpSessionEntry[];
	leafId: string | null;
}

export interface OmpTreeSnapshot {
	tree: OmpTreeNode[];
	leafId: string | null;
}

/** Errore RPC con il `code` macchina di omp (stessa forma di `RpcError`). */
interface CodedError {
	code?: string;
	message?: string;
}

function errorCode(error: unknown): string | undefined {
	return error && typeof error === 'object' && 'code' in error
		? ((error as CodedError).code ?? undefined)
		: undefined;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object' && 'message' in error) return String((error as CodedError).message);
	return String(error);
}

/* ------------------------------------------------------------ messaggi */

export function isMessageEntry(entry: OmpSessionEntry | undefined): entry is OmpSessionEntry & { message: AgentMessage } {
	return Boolean(entry && entry.type === 'message' && entry.message && typeof entry.message === 'object');
}

export function isUserMessageEntry(entry: OmpSessionEntry | undefined): boolean {
	return isMessageEntry(entry) && entry.message.role === 'user';
}

/** Testo di un messaggio utente: stessa regola di `#extractUserMessageText` di omp. */
export function messageText(content: ContentBlock[] | string | undefined): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text ?? '')
		.join('');
}

/** Confronto tollerante: spazi e a capo non devono far fallire la mappatura. */
function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------- cache di get_entries */

/**
 * Copia locale dell'append-history, aggiornata in coda con `get_entries { since }`.
 *
 * Il `since` e' l'ultima entry ricevuta; quando omp non la riconosce piu'
 * (`unknown_since`: file riscritto, sessione cambiata) si riparte da zero. Se
 * la foglia annunciata non sta nella copia la copia e' incoerente (una
 * riscrittura che ha conservato l'ultima entry) e si ricarica tutto.
 */
export class OmpEntryCache {
	private entries: OmpSessionEntry[] = [];
	private byId = new Map<string, OmpSessionEntry>();
	private leaf: string | null = null;
	/** Sessione a cui appartiene la copia: un'altra sessione la invalida. */
	private owner: string | null = null;

	get leafId(): string | null {
		return this.leaf;
	}

	get size(): number {
		return this.entries.length;
	}

	get(id: string): OmpSessionEntry | undefined {
		return this.byId.get(id);
	}

	all(): readonly OmpSessionEntry[] {
		return this.entries;
	}

	invalidate(): void {
		this.entries = [];
		this.byId.clear();
		this.leaf = null;
		this.owner = null;
	}

	private replace(page: OmpEntriesPage): void {
		this.entries = Array.isArray(page.entries) ? [...page.entries] : [];
		this.byId = new Map(this.entries.map((entry) => [entry.id, entry]));
		this.leaf = page.leafId ?? null;
	}

	private append(page: OmpEntriesPage): void {
		for (const entry of Array.isArray(page.entries) ? page.entries : []) {
			if (this.byId.has(entry.id)) continue;
			this.entries.push(entry);
			this.byId.set(entry.id, entry);
		}
		this.leaf = page.leafId ?? null;
	}

	/**
	 * Allinea la copia. `owner` identifica la sessione (id o file): se cambia,
	 * la copia vecchia non vale piu'. Ritorna quante richieste sono servite,
	 * utile ai test per verificare che l'aggiornamento resti incrementale.
	 */
	async sync(fetch: (since?: string) => Promise<OmpEntriesPage>, owner: string | null): Promise<number> {
		if (owner !== this.owner) this.invalidate();
		const since = this.entries.at(-1)?.id;
		if (since === undefined) {
			this.replace(await fetch());
			this.owner = owner;
			return 1;
		}
		let page: OmpEntriesPage;
		try {
			page = await fetch(since);
		} catch (error) {
			if (errorCode(error) !== 'unknown_since') throw error;
			this.replace(await fetch());
			this.owner = owner;
			return 2;
		}
		this.append(page);
		if (this.leaf !== null && !this.byId.has(this.leaf)) {
			this.replace(await fetch());
			this.owner = owner;
			return 2;
		}
		this.owner = owner;
		return 1;
	}
}

/* ------------------------------------------------------ percorso attivo */

/**
 * Percorso dalla radice alla foglia. Si risale da `leafId` con `parentId`;
 * un ciclo o un genitore mancante chiudono la risalita (omp tratta allo
 * stesso modo i genitori mancanti: diventano radici).
 */
export function activePath(lookup: (id: string) => OmpSessionEntry | undefined, leafId: string | null): OmpSessionEntry[] {
	const path: OmpSessionEntry[] = [];
	const seen = new Set<string>();
	let current = leafId ? lookup(leafId) : undefined;
	while (current && !seen.has(current.id)) {
		seen.add(current.id);
		path.push(current);
		current = current.parentId ? lookup(current.parentId) : undefined;
	}
	return path.reverse();
}

/** Primo antenato (escluso l'entry stesso) che sia un messaggio: il punto da cui ripartire. */
export function previousMessageEntryId(
	lookup: (id: string) => OmpSessionEntry | undefined,
	entryId: string
): string | null {
	const seen = new Set<string>([entryId]);
	let current = lookup(entryId);
	let parentId = current?.parentId ?? null;
	while (parentId && !seen.has(parentId)) {
		seen.add(parentId);
		current = lookup(parentId);
		if (!current) return null;
		if (isMessageEntry(current)) return current.id;
		parentId = current.parentId;
	}
	return null;
}

/* ----------------------------------------- mappatura transcript -> entry */

/** Quel che serve del transcript di Studio: forma minima, nessuna dipendenza dalla sessione. */
export interface TranscriptRef {
	id: number;
	kind: string;
	/** Testo del messaggio utente. */
	content?: string;
	/** `message.timestamp` (ms) del messaggio omp da cui l'entry e' nata. */
	messageTs?: number;
}

/**
 * Entry omp del messaggio utente `transcriptId` sul ramo attivo.
 *
 * 1. Il timestamp del messaggio (`message.timestamp`, in ms) e' lo stesso
 *    oggetto che omp scrive nel file: e' la chiave esatta.
 * 2. Senza timestamp (entry ottimistica, versione vecchia) si allinea per
 *    posizione dalla coda: l'ultimo messaggio utente del transcript e'
 *    l'ultimo del ramo, anche dopo una compattazione che taglia la testa. Il
 *    testo deve coincidere; se no si cerca il piu' vicino con lo stesso testo.
 */
export function resolveUserEntryId(
	transcript: readonly TranscriptRef[],
	transcriptId: number,
	path: readonly OmpSessionEntry[]
): string | null {
	const target = transcript.find((entry) => entry.id === transcriptId);
	if (!target || target.kind !== 'user') return null;
	const pathUsers = path.filter(isUserMessageEntry) as Array<OmpSessionEntry & { message: AgentMessage }>;
	if (pathUsers.length === 0) return null;

	if (typeof target.messageTs === 'number') {
		const exact = pathUsers.filter((entry) => entry.message.timestamp === target.messageTs);
		if (exact.length === 1) return exact[0].id;
		if (exact.length > 1) {
			const wanted = normalizeText(target.content ?? '');
			const byText = exact.find((entry) => normalizeText(messageText(entry.message.content)) === wanted);
			return (byText ?? exact[exact.length - 1]).id;
		}
	}

	const transcriptUsers = transcript.filter((entry) => entry.kind === 'user');
	const fromEnd = transcriptUsers.length - 1 - transcriptUsers.indexOf(target);
	const guess = pathUsers.length - 1 - fromEnd;
	const wanted = normalizeText(target.content ?? '');
	const matches = (index: number) =>
		index >= 0 && index < pathUsers.length && normalizeText(messageText(pathUsers[index].message.content)) === wanted;
	if (matches(guess)) return pathUsers[guess].id;
	for (let distance = 1; distance < pathUsers.length; distance++) {
		if (matches(guess - distance)) return pathUsers[guess - distance].id;
		if (matches(guess + distance)) return pathUsers[guess + distance].id;
	}
	return null;
}

/** Ultimo messaggio del turno che parte da `startIndex` (escluso) sul percorso, prima del prossimo messaggio utente. */
function turnEndFrom(path: readonly OmpSessionEntry[], startIndex: number, includeStart: boolean): string | null {
	let last: string | null = includeStart && isMessageEntry(path[startIndex]) ? path[startIndex].id : null;
	for (let i = startIndex + 1; i < path.length; i++) {
		const entry = path[i];
		if (isUserMessageEntry(entry)) break;
		if (isMessageEntry(entry)) last = entry.id;
	}
	return last;
}

/**
 * Entry su cui diramare «dopo questa risposta»: l'ultimo messaggio del turno
 * (risposta finale o risultato tool), prima del messaggio utente successivo.
 * Si parte dall'ultimo messaggio assistente del turno quando il suo timestamp
 * e' noto, altrimenti dal messaggio utente che apre il turno.
 */
export function resolveTurnEndEntryId(
	transcript: readonly TranscriptRef[],
	turn: { userTranscriptId: number | null; assistantTs: number | null },
	path: readonly OmpSessionEntry[]
): string | null {
	if (typeof turn.assistantTs === 'number') {
		const index = path.findIndex(
			(entry) => isMessageEntry(entry) && entry.message.role === 'assistant' && entry.message.timestamp === turn.assistantTs
		);
		if (index >= 0) return turnEndFrom(path, index, true);
	}
	if (turn.userTranscriptId !== null) {
		const userId = resolveUserEntryId(transcript, turn.userTranscriptId, path);
		if (userId) {
			const index = path.findIndex((entry) => entry.id === userId);
			return turnEndFrom(path, index, false);
		}
	}
	return null;
}

/* ------------------------------------------------------ esiti di omp */

export type BranchOutcome =
	| { kind: 'done'; text?: string }
	| { kind: 'cancelled' }
	| { kind: 'busy' }
	| { kind: 'error'; message: string };

/**
 * Manda `fork` e traduce la risposta. `session_busy` non e' un guasto: omp ha
 * lasciato tutto com'era (sessione, transcript, coda) e l'utente deve solo
 * aspettare; `cancelled` vuol dire che un'estensione ha posto il veto o che la
 * sessione non e' persistita.
 */
export async function requestFork(
	send: (command: { type: 'fork'; entryId?: string }) => Promise<unknown>,
	entryId?: string
): Promise<BranchOutcome> {
	try {
		const data = (await send(entryId ? { type: 'fork', entryId } : { type: 'fork' })) as { cancelled?: boolean } | null;
		return data?.cancelled === true ? { kind: 'cancelled' } : { kind: 'done' };
	} catch (error) {
		if (errorCode(error) === 'session_busy') return { kind: 'busy' };
		return { kind: 'error', message: errorMessage(error) };
	}
}

/** Come `requestFork`, per `branch`: in piu' restituisce il testo da rimettere nell'editor. */
export async function requestBranch(
	send: (command: { type: 'branch'; entryId: string }) => Promise<unknown>,
	entryId: string
): Promise<BranchOutcome> {
	try {
		const data = (await send({ type: 'branch', entryId })) as { cancelled?: boolean; text?: string } | null;
		if (data?.cancelled === true) return { kind: 'cancelled' };
		return { kind: 'done', text: typeof data?.text === 'string' ? data.text : undefined };
	} catch (error) {
		if (errorCode(error) === 'session_busy') return { kind: 'busy' };
		return { kind: 'error', message: errorMessage(error) };
	}
}

/* ------------------------------------------------- righe del pannello Rami */

export interface BranchRow {
	entryId: string;
	/** Prima riga del messaggio, accorciata. */
	text: string;
	/** ms; `null` se l'entry non ha un orario leggibile. */
	time: number | null;
	/** Rientro visivo: 0 per il ramo principale, +1 per ogni ramo alternativo. */
	depth: number;
	/** Sta sul percorso radice -> foglia attiva. */
	active: boolean;
	/** Ultimo messaggio utente del ramo attivo: «sei qui». */
	current: boolean;
	/** Prima riga di un ramo alternativo che si stacca dal nodo sopra. */
	branchStart: boolean;
	/** Quanti rami nascono da questo nodo (figli utente diretti), se piu' di uno. */
	forks: number;
	label?: string;
}

export interface BranchTree {
	rows: BranchRow[];
	leafId: string | null;
	/** Numero di punti in cui la conversazione si divide. */
	branchPoints: number;
	/** Entry grezze per id, per risolvere punta e punto precedente al clic. */
	lookup: (id: string) => OmpSessionEntry | undefined;
	/** Nodo grezzo per id. */
	node: (id: string) => OmpTreeNode | undefined;
	activeIds: ReadonlySet<string>;
}

const PREVIEW_CHARS = 140;

function previewOf(text: string): string {
	const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? '';
	return firstLine.length > PREVIEW_CHARS ? `${firstLine.slice(0, PREVIEW_CHARS - 1)}…` : firstLine;
}

function timeOf(entry: OmpSessionEntry): number | null {
	if (typeof entry.message?.timestamp === 'number') return entry.message.timestamp;
	if (typeof entry.timestamp === 'string') {
		const parsed = Date.parse(entry.timestamp);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

/** Nodo utente intermedio: figli utente diretti, con il nodo grezzo di partenza. */
interface UserNode {
	raw: OmpTreeNode;
	children: UserNode[];
	/** Il sottoalbero contiene la foglia attiva. */
	active: boolean;
}

/**
 * Costruisce le righe del pannello Rami da `get_tree`.
 *
 * Solo i messaggi utente diventano nodi. Il ramo attivo resta a sinistra come
 * una linea dritta: a ogni biforcazione i rami alternativi si mostrano prima,
 * rientrati di un livello, e poi la conversazione attiva prosegue alla stessa
 * profondita'. Fuori dal ramo attivo prosegue il figlio piu' recente, come fa
 * la TUI di omp. Tutto iterativo: una sessione lunga e lineare ha migliaia di
 * livelli e la ricorsione sfonderebbe lo stack.
 */
export function buildBranchTree(snapshot: OmpTreeSnapshot): BranchTree {
	const forest = Array.isArray(snapshot.tree) ? snapshot.tree : [];
	const nodes = new Map<string, OmpTreeNode>();
	const stack = [...forest];
	while (stack.length > 0) {
		const node = stack.pop()!;
		if (!node?.entry?.id || nodes.has(node.entry.id)) continue;
		nodes.set(node.entry.id, node);
		for (const child of node.children ?? []) stack.push(child);
	}
	const lookup = (id: string) => nodes.get(id)?.entry;
	const leafId = snapshot.leafId ?? null;
	const activeIds = new Set(activePath(lookup, leafId).map((entry) => entry.id));

	// 1. Proiezione sui soli messaggi utente.
	const roots: UserNode[] = [];
	const walk: Array<{ node: OmpTreeNode; parent: UserNode | null }> = [];
	for (let i = forest.length - 1; i >= 0; i--) walk.push({ node: forest[i], parent: null });
	const visited = new Set<string>();
	while (walk.length > 0) {
		const { node, parent } = walk.pop()!;
		if (!node?.entry?.id || visited.has(node.entry.id)) continue;
		visited.add(node.entry.id);
		let owner = parent;
		if (isUserMessageEntry(node.entry)) {
			const userNode: UserNode = { raw: node, children: [], active: false };
			(parent ? parent.children : roots).push(userNode);
			owner = userNode;
		}
		const children = node.children ?? [];
		for (let i = children.length - 1; i >= 0; i--) walk.push({ node: children[i], parent: owner });
	}

	// 2. Quali nodi utente contengono la foglia attiva.
	const markStack: Array<{ node: UserNode; done: boolean }> = roots.map((node) => ({ node, done: false }));
	while (markStack.length > 0) {
		const top = markStack.pop()!;
		if (!top.done) {
			markStack.push({ node: top.node, done: true });
			for (const child of top.node.children) markStack.push({ node: child, done: false });
		} else {
			top.node.active = activeIds.has(top.node.raw.entry.id);
		}
	}

	// 3. Righe: alternativi prima (rientrati), poi la continuazione principale.
	const rows: BranchRow[] = [];
	let branchPoints = 0;
	let currentRow: BranchRow | null = null;
	const emit: Array<{ node: UserNode; depth: number; branchStart: boolean }> = [];
	const pushLevel = (level: UserNode[], depth: number, inheritedStart: boolean) => {
		if (level.length === 0) return;
		const main = level.find((node) => node.active) ?? level[level.length - 1];
		const alternatives = level.filter((node) => node !== main);
		// Lo stack e' LIFO: prima la continuazione, poi gli alternativi al contrario.
		emit.push({ node: main, depth, branchStart: inheritedStart });
		for (let i = alternatives.length - 1; i >= 0; i--) {
			emit.push({ node: alternatives[i], depth: depth + 1, branchStart: true });
		}
	};
	pushLevel(roots, 0, false);
	while (emit.length > 0) {
		const { node, depth, branchStart } = emit.pop()!;
		const entry = node.raw.entry;
		const forks = node.children.length > 1 ? node.children.length : 0;
		if (forks > 0) branchPoints++;
		const row: BranchRow = {
			entryId: entry.id,
			text: previewOf(messageText(entry.message?.content)),
			time: timeOf(entry),
			depth,
			active: node.active,
			current: false,
			branchStart,
			forks,
			label: typeof node.raw.label === 'string' && node.raw.label.length > 0 ? node.raw.label : undefined
		};
		rows.push(row);
		if (node.active) currentRow = row;
		pushLevel(node.children, depth, false);
	}
	if (roots.length > 1) branchPoints++;
	if (currentRow) currentRow.current = true;

	return { rows, leafId, branchPoints, lookup, node: (id) => nodes.get(id), activeIds };
}

/**
 * Punta del ramo che passa per `entryId`: si scende seguendo il ramo attivo se
 * ci si e' sopra, altrimenti il figlio piu' recente (i figli sono in ordine di
 * timestamp), e si tiene l'ultimo messaggio incontrato. E' l'entry su cui
 * `fork` ricrea quel ramo intero come sessione nuova.
 */
export function branchTipEntryId(tree: BranchTree, entryId: string): string | null {
	let node = tree.node(entryId);
	if (!node) return null;
	let tip: string | null = isMessageEntry(node.entry) ? node.entry.id : null;
	const seen = new Set<string>();
	while (node && !seen.has(node.entry.id)) {
		seen.add(node.entry.id);
		const children: OmpTreeNode[] = node.children ?? [];
		if (children.length === 0) break;
		node = children.find((child) => tree.activeIds.has(child.entry.id)) ?? children[children.length - 1];
		if (isMessageEntry(node.entry)) tip = node.entry.id;
	}
	return tip;
}
