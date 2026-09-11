/**
 * Parser e classificatore dei messaggi di sistema inviati dall'harness omp.
 * Modulo puro: nessun import da Svelte, nessun accesso a store, nessun side effect.
 */

import type { AsyncResultDetails, IrcAutoreplyDetails, IrcIncomingDetails } from './wire.ts';
import { m as msg } from '$lib/paraglide/messages.js';

export type JobType = 'bash' | 'task' | 'eval' | 'unknown';

export interface TaskResultEnvelope {
	id: string;
	agent?: string;
	/** Grezzo dal wire: "completed", "failed (exit 1)", "aborted", "cancelled". */
	status: string;
	statusKind: 'completed' | 'failed' | 'aborted' | 'unknown';
	duration?: string;
	lines?: number;
	size?: string;
	/** Presente solo quando l'output e' troncato: "agent://ID". */
	fullOutputUri?: string;
	/** Contenuto di <preview> oppure di <output>. */
	body: string;
	/** JSON.summary se il corpo e' JSON con quel campo, altrimenti prima riga non vuota, su una riga sola. */
	summaryLine: string;
	abortReason?: string;
	mergeSummary?: string;
}

export interface JobResult {
	jobId: string;
	jobType: JobType;
	label?: string;
	durationMs?: number;
	/** Presente solo su jobType 'task' con envelope valido. */
	envelope?: TaskResultEnvelope;
	/** Testo del segmento, per bash/eval o come fallback se l'envelope non parsa. */
	raw: string;
}

export type ClassifiedNotice =
	| { kind: 'hidden'; customType: string; title: string; body: string }
	| { kind: 'subagent-result'; jobs: JobResult[] }
	| { kind: 'irc'; direction: 'in' | 'out'; peer: string; body: string; replyTo?: string }
	| { kind: 'todo-reminder'; incomplete: number; attempt?: number; maxAttempts?: number }
	| { kind: 'chip'; customType: string; title: string; body: string };

/** Input normalizzato: il riduttore appiattisce `content` con il suo `textOf` prima di chiamare. */
export interface ClassifyInput {
	role: string;
	customType?: string;
	display?: boolean;
	details?: unknown;
	text: string;
}

/** Dizionario dei titoli italiani per i customType noti di omp. */
const KNOWN_TITLES: Record<string, string> = {
	'async-result': 'Risultato in background',
	get 'irc:incoming'() { return msg.ui_ts_notices_messaggio_da_un_agente_a97b(); },
	'irc:autoreply': 'Risposta automatica',
	advisor: "Consiglio dell'advisor",
	'skill-prompt': 'Skill invocata',
	'xdev-mount-notice': 'Dispositivi xd:// aggiornati',
	'launch-completion': 'Processo supervisionato terminato',
	'lsp-late-diagnostic': 'Diagnostica LSP tardiva',
	'interrupted-thinking': 'Ragionamento interrotto',
	'checkpoint-active-reminder': 'Checkpoint di esplorazione attivo',
	get 'plan-mode-context'() { return msg.ui_ts_notices_vincoli_della_modalita_piano_2eb5(); },
	'ttsr-injection': 'Regola di progetto applicata',
	get 'todo-error-reminder'() { return msg.ui_ts_notices_errore_sui_todo_6322(); },
	'resolve-reminder': 'Promemoria di risoluzione',
	get 'session-stop-continuation'() { return msg.ui_ts_notices_ripresa_della_sessione_8d48(); },
	'plan-approved': 'Piano approvato',
	'developer-note': 'Nota di sistema',
	'developer-reminder': 'Promemoria interno',
	get 'custom-message'() { return msg.ui_ts_notices_messaggio_di_un_estensione_a7fe(); }
};

/**
 * Restituisce il titolo in italiano per un avviso di sistema dato il suo customType.
 * Se non e' noto, ricava un titolo in Title Case separando su trattini, underscore e due punti.
 */
export function systemNoticeTitle(customType: string): string {
	if (!customType) {
		return '';
	}
	const known = KNOWN_TITLES[customType];
	if (known) {
		return known;
	}

	// Scomposizione in parole e formattazione Title Case
	const parts = customType
		.split(/[-_:]+/)
		.filter((p) => p.length > 0);

	if (parts.length === 0) {
		return '';
	}

	// Se l'ultima parola e' notice o reminder e ci sono altre parole, scartala
	const last = parts[parts.length - 1].toLowerCase();
	if (parts.length > 1 && (last === 'notice' || last === 'reminder')) {
		parts.pop();
	}

	return parts
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');
}

/**
 * Rimuove i wrapper XML esterni tipici degli avvisi omp (<system-notice>, <system-reminder>, <irc>, <critical>).
 * Non modifica il contenuto interno e restituisce la stringa trimmata.
 */
export function stripNoticeWrapper(text: string): string {
	let trimmed = text.trim();
	const tagNames = ['system-notice', 'system-reminder', 'irc', 'critical'];

	let changed = true;
	while (changed) {
		changed = false;
		for (const tag of tagNames) {
			const openRegex = new RegExp(`^<${tag}(?:\\s+[^>]*)?>`, 'i');
			const closeRegex = new RegExp(`</${tag}>$`, 'i');
			if (openRegex.test(trimmed) && closeRegex.test(trimmed)) {
				trimmed = trimmed.replace(openRegex, '').replace(closeRegex, '').trim();
				changed = true;
			}
		}
	}

	return trimmed;
}

/**
 * Genera una chiave di deduplica per avvisi di sistema.
 * Restituisce null se mancano customType o timestamp, poiche' senza entrambi non e' affidabile.
 */
export function noticeDedupKey(input: { role: string; customType?: string; timestamp?: number }): string | null {
	if (!input.customType || input.timestamp == null) {
		return null;
	}
	return `${input.role}:${input.customType}:${input.timestamp}`;
}

/** Righe che non dicono nulla: sono solo struttura del JSON. */
const PUNCTUATION_ONLY_RE = /^[{}\[\],:'"`\s]*$/;

/** Chiavi che, in un payload strutturato, portano la sintesi del lavoro. */
const SUMMARY_KEYS = ['summary', 'report', 'architecture', 'description', 'result'];

/** Sotto questa lunghezza un valore stringa e' quasi sempre un path o un id, non una sintesi. */
const PROSE_MIN_CHARS = 40;

/**
 * Ricava una riga di sintesi leggibile dal corpo di un risultato.
 *
 * Il caso difficile e' l'anteprima: `omp` la tronca a 4.000 caratteri, quindi
 * un payload JSON arriva spesso spezzato a meta' e `JSON.parse` fallisce. Senza
 * i passaggi successivi la sintesi degenererebbe nella graffa di apertura o nel
 * primo path incontrato. Nell'ordine: chiavi di sintesi del JSON valido, stesse
 * chiavi pescate col testo, primo valore stringa abbastanza lungo da essere
 * prosa, qualunque valore stringa, prima riga significativa.
 */
function extractSummary(body: string): string {
	const trimmed = body.trim();
	if (!trimmed) return '';

	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const record = parsed as Record<string, unknown>;
			for (const key of SUMMARY_KEYS) {
				const value = record[key];
				if (typeof value === 'string' && value.trim()) return value;
			}
		}
	} catch {
		// Payload troncato o non JSON: si prosegue coi fallback testuali.
	}

	const unescape = (value: string): string =>
		value.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

	for (const key of SUMMARY_KEYS) {
		const field = trimmed.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
		if (field && field[1].trim()) return unescape(field[1]);
	}

	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		const values = trimmed.matchAll(/:\s*"((?:[^"\\]|\\.)+)"/g);
		let firstValue = '';
		for (const match of values) {
			const value = unescape(match[1]).trim();
			if (!value) continue;
			if (!firstValue) firstValue = value;
			if (value.length >= PROSE_MIN_CHARS) return value;
		}
		if (firstValue) return firstValue;
	}

	for (const line of trimmed.split(/\r?\n/)) {
		const cleaned = line.trim();
		if (cleaned && !PUNCTUATION_ONLY_RE.test(cleaned)) return cleaned;
	}
	return '';
}

/**
 * Analizza l'envelope XML <task-result> generato da omp per i sub-agenti.
 * Estrae attributi, metadati, anteprima/output e sintetizza una summaryLine a riga singola.
 */
export function parseTaskResultEnvelope(text: string): TaskResultEnvelope | null {
	const openMatch = text.match(/<task-result\b([^>]*)>/);
	if (!openMatch) {
		return null;
	}

	const attrString = openMatch[1];
	const getAttr = (name: string): string | undefined => {
		const m = attrString.match(new RegExp(`\\b${name}="([^"]*)"`));
		return m ? m[1] : undefined;
	};

	const id = getAttr('id') ?? '';
	const agent = getAttr('agent');
	const rawStatus = getAttr('status') ?? '';
	const duration = getAttr('duration');

	// Classificazione euristica dello status
	const s = rawStatus.toLowerCase().trim();
	let statusKind: 'completed' | 'failed' | 'aborted' | 'unknown' = 'unknown';
	if (s.startsWith('completed')) {
		statusKind = 'completed';
	} else if (s.startsWith('failed') || s.startsWith('error')) {
		statusKind = 'failed';
	} else if (s.startsWith('aborted') || s.startsWith('cancelled')) {
		statusKind = 'aborted';
	}

	// Estrazione del blocco compreso tra <task-result> e </task-result>
	// Tolleriamo righe di coda aggiunte dopo la chiusura del tag
	const closeIdx = text.indexOf('</task-result>');
	const inner = closeIdx !== -1
		? text.slice(openMatch.index! + openMatch[0].length, closeIdx)
		: text.slice(openMatch.index! + openMatch[0].length);

	// <meta lines="N" size="S" />
	let lines: number | undefined;
	let size: string | undefined;
	const metaMatch = inner.match(/<meta\b([^>]*)\/?>/);
	if (metaMatch) {
		const metaAttrs = metaMatch[1];
		const linesM = metaAttrs.match(/\blines="(\d+)"/);
		if (linesM) {
			lines = parseInt(linesM[1], 10);
		}
		const sizeM = metaAttrs.match(/\bsize="([^"]*)"/);
		if (sizeM) {
			size = sizeM[1];
		}
	}

	// <abort-reason>...</abort-reason>
	let abortReason: string | undefined;
	const abortM = inner.match(/<abort-reason>([\s\S]*?)<\/abort-reason>/);
	if (abortM) {
		abortReason = abortM[1].trim();
	}

	// <merge-summary>...</merge-summary>
	let mergeSummary: string | undefined;
	const mergeM = inner.match(/<merge-summary>([\s\S]*?)<\/merge-summary>/);
	if (mergeM) {
		mergeSummary = mergeM[1].trim();
	}

	// <preview full-output="...">...</preview> oppure <output>...</output>.
	// Il tag di chiusura puo' mancare quando il frame arriva tagliato: in quel
	// caso si prende tutto cio' che resta, invece di restituire un corpo vuoto.
	let body = '';
	let fullOutputUri: string | undefined;
	const previewOpen = inner.match(/<preview(?:\s+full-output="([^"]*)")?[^>]*>/);
	if (previewOpen) {
		fullOutputUri = previewOpen[1];
		const from = previewOpen.index! + previewOpen[0].length;
		const closeAt = inner.indexOf('</preview>', from);
		body = (closeAt === -1 ? inner.slice(from) : inner.slice(from, closeAt)).trim();
	} else {
		const outputOpen = inner.match(/<output>/);
		if (outputOpen) {
			const from = outputOpen.index! + outputOpen[0].length;
			const closeAt = inner.indexOf('</output>', from);
			body = (closeAt === -1 ? inner.slice(from) : inner.slice(from, closeAt)).trim();
		}
	}

	const summaryCandidate = extractSummary(body);

	// Collassa gli spazi bianchi e tronca a 200 caratteri con ellissi
	let summaryLine = summaryCandidate.replace(/\s+/g, ' ').trim();
	if (summaryLine.length > 200) {
		summaryLine = summaryLine.slice(0, 200) + '…';
	}

	return {
		id,
		agent,
		status: rawStatus,
		statusKind,
		duration,
		lines,
		size,
		fullOutputUri,
		body,
		summaryLine,
		abortReason,
		mergeSummary
	};
}

/**
 * Normalizza details in modo difensivo in una lista di job dichiarati.
 */
function normalizeDetailsJobs(details: unknown): AsyncResultDetails['jobs'] {
	if (!details || typeof details !== 'object') {
		return [];
	}
	const maybe = details as Record<string, unknown>;
	if (!Array.isArray(maybe.jobs)) {
		return [];
	}
	const res: AsyncResultDetails['jobs'] = [];
	for (const item of maybe.jobs) {
		if (item && typeof item === 'object') {
			const j = item as Record<string, unknown>;
			res.push({
				jobId: typeof j.jobId === 'string' ? j.jobId : String(j.jobId ?? ''),
				// Un `type` fuori dai tre valori noti resta `undefined`: meglio
				// dedurlo dal contenuto che propagare una stringa inventata.
				type: j.type === 'bash' || j.type === 'task' || j.type === 'eval' ? j.type : undefined,
				label: typeof j.label === 'string' ? j.label : undefined,
				durationMs: typeof j.durationMs === 'number' ? j.durationMs : undefined
			});
		}
	}
	return res;
}

/**
 * Analizza il payload di un avviso `async-result`, estraendo i risultati dei singoli job.
 */
export function parseAsyncResult(content: string, details: unknown): JobResult[] {
	const declaredJobs = normalizeDetailsJobs(details);

	// Rimuovi wrapper esterno <system-notice>
	let bodyText = stripNoticeWrapper(content);

	// Rimuovi la prima riga di intestazione se presente
	bodyText = bodyText.replace(/^\s*(?:\d+\s+)?background\s+jobs?\s+(?:have|has)\s+completed[^\r\n]*(?:\r?\n)?/i, '');
	bodyText = bodyText.replace(/^\s*resume\s+your\s+work\s+using[^\r\n]*(?:\r?\n)?/i, '');
	bodyText = bodyText.trim();

	// Se il testo e' vuoto e non ci sono job dichiarati, ritorna array vuoto
	if (!bodyText && declaredJobs.length === 0) {
		return [];
	}

	// Divisione in segmenti sui separatori ── Job .+ ──
	const segments: string[] = [];
	const separatorRegex = /^── Job .+ ──$/m;

	if (declaredJobs.length > 1 && separatorRegex.test(bodyText)) {
		const rawParts = bodyText.split(/^── Job .+ ──$/m);
		// La prima parte prima del primo separatore e' l'eventuale spazio/preambolo
		if (rawParts.length > 0 && rawParts[0].trim() === '') {
			rawParts.shift();
		}
		for (const part of rawParts) {
			segments.push(part.trim());
		}
	} else if (bodyText.length > 0) {
		segments.push(bodyText);
	}

	const results: JobResult[] = [];
	const maxCount = Math.max(declaredJobs.length, segments.length);

	for (let i = 0; i < maxCount; i++) {
		const jobMeta = declaredJobs[i];
		const segmentText = segments[i] ?? '';

		let raw = segmentText;
		let envelope: TaskResultEnvelope | undefined;

		const isTask = jobMeta?.type === 'task' || (!jobMeta?.type && segmentText.includes('<task-result'));
		if (isTask) {
			const parsedEnv = parseTaskResultEnvelope(segmentText);
			if (parsedEnv) {
				envelope = parsedEnv;
			}
		}

		let jobType: JobType = 'unknown';
		if (jobMeta?.type) {
			jobType = jobMeta.type;
		} else if (envelope) {
			jobType = 'task';
		}

		const jobId = jobMeta?.jobId || envelope?.id || 'unknown';

		results.push({
			jobId,
			jobType,
			label: jobMeta?.label,
			durationMs: jobMeta?.durationMs,
			envelope,
			raw
		});
	}

	return results;
}

/**
 * Pulisce il corpo di un messaggio IRC rimuovendo wrapper e righe di boilerplate di omp.
 */
function cleanIrcBody(text: string): string {
	let body = stripNoticeWrapper(text);

	// Rimuove intestazione "Incoming IRC message from agent `NOME`" se presente nel corpo
	body = body.replace(/^\s*Incoming\s+IRC\s+message\s+from\s+agent\s+`?[^`\r\n]+`?[^\r\n]*(?:\r?\n)?/i, '');

	// Rimuove righe di boilerplate standard di omp
	const boilerplatePatterns = [
		/^\s*Sent\s+while\s+(?:waiting|working)[^\r\n]*(?:\r?\n)?/im,
		/^\s*Active\s+interruptible\s+wait[^\r\n]*(?:\r?\n)?/im,
		/^\s*If\s+response\s+expected,\s+reply\s+via[^\r\n]*(?:\r?\n)?/im,
		/^\s*No\s+one\s+replies\s+on\s+your\s+behalf\.[^\r\n]*(?:\r?\n)?/im
	];

	for (const pat of boilerplatePatterns) {
		body = body.replace(pat, '');
	}

	return body.trim();
}

/**
 * Classifica un messaggio di sistema per decidere come renderizzarlo nella timeline di chat.
 */
export function classifySystemMessage(input: ClassifyInput): ClassifiedNotice | null {
	const { role, customType, display, details, text } = input;

	// 1. Promemoria todo
	const hasTodoText = /You stopped with (\d+) incomplete todo item\(s\)/i.exec(text) ||
		/(\d+)\s+todo\s+items\s+still\s+open/i.exec(text);

	const isTodoRoleOrType = role === 'developer' ||
		(customType && (customType.includes('todo') || customType === 'session-stop-continuation'));

	if (hasTodoText && (isTodoRoleOrType || text.includes('<system-reminder>'))) {
		const incomplete = parseInt(hasTodoText[1], 10);
		const reminderMatch = /\(Reminder\s+(\d+)\/(\d+)\)/i.exec(text);
		const attempt = reminderMatch ? parseInt(reminderMatch[1], 10) : undefined;
		const maxAttempts = reminderMatch ? parseInt(reminderMatch[2], 10) : undefined;
		return {
			kind: 'todo-reminder',
			incomplete,
			attempt,
			maxAttempts
		};
	}

	// 2. Messaggi `developer`: nascosti solo quando sono un <system-reminder>,
	// cioe' un'istruzione che l'harness scrive per il modello. Un messaggio
	// developer senza quel wrapper porta informazione all'utente (il caso vero
	// e' "Plan approved." con il piano da eseguire) e nasconderlo la farebbe
	// sparire dalla cronologia.
	if (role === 'developer') {
		if (/<system-reminder\b/.test(text)) {
			const effectiveType = customType ?? 'developer-reminder';
			return {
				kind: 'hidden',
				customType: effectiveType,
				title: systemNoticeTitle(effectiveType),
				body: stripNoticeWrapper(text)
			};
		}
		const body = stripNoticeWrapper(text);
		if (!body) {
			return null;
		}
		const effectiveType =
			customType ?? (/^plan approved\b/i.test(body) ? 'plan-approved' : 'developer-note');
		return {
			kind: 'chip',
			customType: effectiveType,
			title: systemNoticeTitle(effectiveType),
			body
		};
	}

	// 3. Risultato di job asincroni
	if (customType === 'async-result') {
		const jobs = parseAsyncResult(text, details);
		if (jobs.length > 0) {
			return { kind: 'subagent-result', jobs };
		}
		// Se vuoto ricadi su chip per non perdere informazione
		const cleaned = stripNoticeWrapper(text);
		if (!cleaned) {
			return null;
		}
		return {
			kind: 'chip',
			customType,
			title: systemNoticeTitle(customType),
			body: cleaned
		};
	}

	// 4. Messaggio IRC in entrata
	if (customType === 'irc:incoming') {
		let peer = '';
		let body = '';
		let replyTo: string | undefined;

		const inc = details as IrcIncomingDetails | undefined;
		if (inc && typeof inc === 'object' && typeof inc.from === 'string' && typeof inc.message === 'string') {
			peer = inc.from;
			body = inc.message.trim();
			replyTo = inc.replyTo;
		} else {
			// Fallback sul parsing del testo
			const peerMatch = text.match(/Incoming\s+IRC\s+message\s+from\s+agent\s+`?([^`\s\r\n]+)`?/i);
			peer = peerMatch ? peerMatch[1] : 'agent';
			body = cleanIrcBody(text);
		}

		return {
			kind: 'irc',
			direction: 'in',
			peer,
			body,
			replyTo
		};
	}

	// 5. Risposta automatica IRC in uscita
	if (customType === 'irc:autoreply') {
		let peer = '';
		let body = '';
		let replyTo: string | undefined;

		const auto = details as IrcAutoreplyDetails | undefined;
		if (auto && typeof auto === 'object' && typeof auto.to === 'string' && typeof auto.body === 'string') {
			peer = auto.to;
			body = auto.body.trim();
			replyTo = auto.replyTo;
		} else {
			const peerMatch = text.match(/(?:to|reply\s+to)\s+agent\s+`?([^`\s\r\n]+)`?/i);
			peer = peerMatch ? peerMatch[1] : 'agent';
			body = cleanIrcBody(text);
		}

		return {
			kind: 'irc',
			direction: 'out',
			peer,
			body,
			replyTo
		};
	}

	// 6. Messaggi con display explicitamente false
	if (display === false) {
		const effectiveType = customType ?? 'internal-notice';
		return {
			kind: 'hidden',
			customType: effectiveType,
			title: systemNoticeTitle(effectiveType),
			body: stripNoticeWrapper(text)
		};
	}

	// 7. Avvisi standard come chip
	const cleanedBody = stripNoticeWrapper(text);
	if (!cleanedBody && !customType) {
		return null;
	}

	const effectiveType = customType ?? 'custom-message';
	return {
		kind: 'chip',
		customType: effectiveType,
		title: systemNoticeTitle(effectiveType),
		body: cleanedBody
	};
}
