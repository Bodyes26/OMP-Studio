// Domande a margine (`/btw`): logica pura del riquadro «A margine».
//
// omp (dalla 18.6.3) risponde a una domanda veloce sul contesto della sessione
// con un turno del modello effimero e senza strumenti: non ferma l'agente
// principale e non entra nel transcript. Il protocollo RPC (docs/rpc.md,
// «Side questions») ha tre comandi (`btw`, `btw_cancel`, `get_btw_history`) e
// due frame: `btw_record` porta il record intero a ogni cambio di stato,
// `btw_delta` il testo in streaming dell'ultimo turno. Qui stanno le funzioni
// che non hanno bisogno di rune ne' di DOM, cosi' i test le coprono in Node.

export type BtwStatus = 'running' | 'complete' | 'cancelled' | 'error' | 'interrupted';

/** Un turno: la domanda iniziale o un approfondimento. */
export interface BtwTurn {
	question: string;
	answer: string;
	status: BtwStatus;
	createdAt: number;
	updatedAt: number;
	error?: string;
}

/**
 * Un argomento dello storico. Il record stesso e' il primo turno; gli
 * approfondimenti (`followUps`) sono i turni successivi, nell'ordine.
 */
export interface BtwRecord extends BtwTurn {
	id: string;
	leafId: string | null;
	followUps?: BtwTurn[];
}

const STATUSES: readonly BtwStatus[] = ['running', 'complete', 'cancelled', 'error', 'interrupted'];

function parseTurn(value: unknown): BtwTurn | null {
	if (!value || typeof value !== 'object') return null;
	const source = value as Record<string, unknown>;
	if (typeof source.question !== 'string') return null;
	const status = STATUSES.includes(source.status as BtwStatus) ? (source.status as BtwStatus) : null;
	if (!status) return null;
	const createdAt = typeof source.createdAt === 'number' && Number.isFinite(source.createdAt) ? source.createdAt : 0;
	const updatedAt =
		typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : createdAt;
	return {
		question: source.question,
		answer: typeof source.answer === 'string' ? source.answer : '',
		status,
		createdAt,
		updatedAt,
		...(typeof source.error === 'string' && source.error ? { error: source.error } : {})
	};
}

/** Record dal filo, tollerante: `null` se manca l'essenziale. */
export function parseBtwRecord(value: unknown): BtwRecord | null {
	const turn = parseTurn(value);
	if (!turn) return null;
	const source = value as Record<string, unknown>;
	if (typeof source.id !== 'string' || !source.id) return null;
	const followUps = Array.isArray(source.followUps)
		? source.followUps.map(parseTurn).filter((entry): entry is BtwTurn => entry !== null)
		: [];
	return {
		...turn,
		id: source.id,
		leafId: typeof source.leafId === 'string' ? source.leafId : null,
		...(followUps.length > 0 ? { followUps } : {})
	};
}

/** Elenco di `get_btw_history` (`{ records }`), scartando le voci illeggibili. */
export function parseBtwHistory(data: unknown): BtwRecord[] {
	const raw = data && typeof data === 'object' ? (data as { records?: unknown }).records : undefined;
	if (!Array.isArray(raw)) return [];
	return sortBtwRecords(raw.map(parseBtwRecord).filter((record): record is BtwRecord => record !== null));
}

/** I turni di un argomento in ordine: domanda iniziale, poi gli approfondimenti. */
export function btwTurns(record: BtwRecord): BtwTurn[] {
	const first: BtwTurn = {
		question: record.question,
		answer: record.answer,
		status: record.status,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		...(record.error ? { error: record.error } : {})
	};
	return [first, ...(record.followUps ?? [])];
}

/** L'ultimo turno: e' quello che riceve lo streaming e decide lo stato visibile. */
export function btwLatestTurn(record: BtwRecord): BtwTurn {
	const followUps = record.followUps ?? [];
	return followUps.length > 0 ? followUps[followUps.length - 1] : record;
}

export function isBtwRunning(record: BtwRecord | null | undefined): boolean {
	return !!record && btwLatestTurn(record).status === 'running';
}

/** Dal piu' recente, come `get_btw_history`; a parita' l'id decide. */
export function sortBtwRecords(records: BtwRecord[]): BtwRecord[] {
	return [...records].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

/**
 * Applica un `btw_record`: l'ultimo frame per un id vince. Una risposta gia'
 * piu' lunga arrivata dai delta non viene accorciata da un frame `running`
 * rimasto indietro (il `btw_record` di avvio puo' seguire un delta solo se il
 * trasporto riordina, ma non costa nulla essere tolleranti).
 */
export function upsertBtwRecord(records: readonly BtwRecord[], record: BtwRecord): BtwRecord[] {
	const index = records.findIndex((candidate) => candidate.id === record.id);
	if (index === -1) return sortBtwRecords([...records, record]);
	const previous = records[index];
	let next = record;
	if (record.status === 'running' || isBtwRunning(record)) {
		const before = btwLatestTurn(previous);
		const after = btwLatestTurn(record);
		if (
			btwTurns(previous).length === btwTurns(record).length &&
			before.answer.length > after.answer.length &&
			before.answer.startsWith(after.answer)
		) {
			next = withLatestAnswer(record, before.answer);
		}
	}
	const copy = [...records];
	copy[index] = next;
	return copy;
}

function withLatestAnswer(record: BtwRecord, answer: string): BtwRecord {
	const followUps = record.followUps ?? [];
	if (followUps.length === 0) return { ...record, answer };
	const last = followUps[followUps.length - 1];
	return { ...record, followUps: [...followUps.slice(0, -1), { ...last, answer }] };
}

/** Applica un `btw_delta` all'ultimo turno dell'argomento; ignoto = nessun cambio. */
export function applyBtwDelta(records: readonly BtwRecord[], recordId: string, delta: string): BtwRecord[] {
	if (!delta) return records as BtwRecord[];
	const index = records.findIndex((candidate) => candidate.id === recordId);
	if (index === -1) return records as BtwRecord[];
	const record = records[index];
	const copy = [...records];
	copy[index] = withLatestAnswer(record, btwLatestTurn(record).answer + delta);
	return copy;
}

/**
 * Il runtime non conosce le domande a margine: omp precedente alla 18.6.3
 * risponde `Unknown command: btw` (o, con uno schema piu' stretto, un errore
 * `parse` senza id che il client riporta come `uncorrelated`).
 */
export function isBtwUnsupportedError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const source = error as { message?: unknown; code?: unknown };
	const message = typeof source.message === 'string' ? source.message : '';
	if (/unknown command/i.test(message)) return true;
	if (source.code === 'uncorrelated') return true;
	return /unknown (rpc )?command type|invalid command type/i.test(message);
}

/**
 * Testo che «Usa nel messaggio» antepone al messaggio inviato: una citazione
 * markdown con la domanda e l'ultima risposta. Entra nel contesto solo se
 * l'utente invia.
 */
export function btwQuoteMarkdown(label: string, question: string, answer: string): string {
	const head = `> **${label}** — «${question.replace(/\s+/g, ' ').trim()}»`;
	const body = answer
		.trim()
		.split(/\r?\n/)
		.map((line) => (line ? `> ${line}` : '>'));
	return [head, '>', ...body].join('\n');
}

/** Il messaggio con la citazione in testa; senza testo resta solo la citazione. */
export function withBtwQuote(quote: string, message: string): string {
	return message.trim() ? `${quote}\n\n${message}` : quote;
}

/** Anteprima di una riga per il chip della citazione (senza markdown in linea). */
export function btwQuotePreview(answer: string, max = 70): string {
	const flat = answer.replace(/`/g, '').replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

/** Testo da copiare: la risposta dell'ultimo turno. */
export function btwCopyText(record: BtwRecord): string {
	return btwLatestTurn(record).answer;
}

/**
 * Quando, per lo Storico: «adesso» nel primo minuto, l'ora se e' oggi, giorno
 * e ora entro la settimana, altrimenti la data. `nowLabel` arriva tradotto.
 */
export function btwWhen(timestamp: number, now: number, locale: string, nowLabel: string): string {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
	if (now - timestamp < 60_000) return nowLabel;
	const date = new Date(timestamp);
	const today = new Date(now);
	const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
	if (date.toDateString() === today.toDateString()) return time;
	if (now - timestamp < 6 * 86_400_000) {
		const day = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
		return `${day} ${time}`;
	}
	return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
}
