/**
 * Paginazione e budget in byte UTF-8 reali per la chat remota (Gate R44 / Fleet).
 *
 * Modulo puro condiviso sia dallo storico delle corsie (chat.ts) sia dal recupero
 * storico (historicalCommands.ts), garantendo che nessuna pagina superi MAX_PAGE_BYTES
 * e che i singoli messaggi sovradimensionati vengano troncati in modo controllato.
 */

import type { RemoteChatMessage, RemoteChatPage } from '$remote-protocol';

const encoder = new TextEncoder();

/** Calcola la dimensione esatta in byte UTF-8 del messaggio serializzato in JSON. */
export function messageUtf8Bytes(m: RemoteChatMessage): number {
	return encoder.encode(JSON.stringify(m)).length + 2;
}

/**
 * Taglia una stringa evitando di spezzare una coppia surrogata UTF-16
 * (es. emoji a 4 byte) a meta', lasciando un surrogato orfano.
 */
export function sliceWithoutHalfSurrogate(s: string, len: number): string {
	if (len <= 0) return '';
	if (len >= s.length) return s;
	let sliced = s.slice(0, len);
	const lastCode = sliced.charCodeAt(sliced.length - 1);
	if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
		sliced = sliced.slice(0, -1);
	}
	return sliced;
}

const TRUNCATION_SUFFIX = '\n... [testo troncato per limite di frame]';

/**
 * Riduce i messaggi oltre il budget, marcando il testo troncato.
 * Se nemmeno l'identita' del messaggio entra nel frame, la lettura fallisce esplicitamente.
 */
export function boundMessageForBudget(msg: RemoteChatMessage, maxBytes: number): RemoteChatMessage {
	if (messageUtf8Bytes(msg) <= maxBytes) return msg;

	const bounded: RemoteChatMessage = { ...msg };

	// 1. Rimuovi le anteprime immagini (conserva il conteggio msg.images)
	if (bounded.imagePreviews && bounded.imagePreviews.length > 0) {
		delete bounded.imagePreviews;
		if (messageUtf8Bytes(bounded) <= maxBytes) return bounded;
	}

	// 2. Riduci i dettagli del tool
	if (bounded.tool) {
		const boundedTool = { ...bounded.tool };
		boundedTool.todos = null;
		boundedTool.diffStats = null;
		if (boundedTool.diff && boundedTool.diff.length > 500) {
			boundedTool.diff = boundedTool.diff.slice(0, 500) + '\n... [diff troncato per limite di frame]';
		}
		if (boundedTool.output && boundedTool.output.length > 500) {
			boundedTool.output = boundedTool.output.slice(-500) + '\n... [output troncato per limite di frame]';
		}
		bounded.tool = boundedTool;
		if (messageUtf8Bytes(bounded) <= maxBytes) return bounded;

		// Se ancora oltre il budget, ometti del tutto diff e output del tool
		boundedTool.diff = null;
		boundedTool.output = null;
		bounded.tool = boundedTool;
		if (messageUtf8Bytes(bounded) <= maxBytes) return bounded;
	}

	// 3. Tronca il testo principale e i blocchi tramite ricerca binaria
	const fullText = bounded.text || '';
	let low = 0;
	let high = fullText.length;
	let bestCandidateText = '';

	// Semplifica i blocchi a un blocco testo coerente per il bounding
	if (bounded.blocks && bounded.blocks.length > 0) {
		bounded.blocks = [{ type: 'text', text: '' }];
	}

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = sliceWithoutHalfSurrogate(fullText, mid) + (mid < fullText.length ? TRUNCATION_SUFFIX : '');
		bounded.text = candidate;
		if (bounded.blocks) {
			bounded.blocks[0].text = candidate;
		}

		if (messageUtf8Bytes(bounded) <= maxBytes) {
			bestCandidateText = candidate;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	if (bestCandidateText) {
		bounded.text = bestCandidateText;
		if (bounded.blocks) bounded.blocks[0].text = bestCandidateText;
		return bounded;
	}

	// 4. Se lo scheletro con testo minimo e' ancora troppo grande, spoglia i metadati opzionali
	bounded.blocks = undefined;
	bounded.tool = undefined;
	bounded.model = null;

	low = 0;
	high = fullText.length;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = sliceWithoutHalfSurrogate(fullText, mid) + (mid < fullText.length ? TRUNCATION_SUFFIX : '');
		bounded.text = candidate;
		if (messageUtf8Bytes(bounded) <= maxBytes) {
			bestCandidateText = candidate;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	if (bestCandidateText) {
		bounded.text = bestCandidateText;
		return bounded;
	}

	// Un budget inferiore all'identita' non consente una pagina valida.
	bounded.text = '[messaggio omesso per limite di frame]';
	if (messageUtf8Bytes(bounded) <= maxBytes) return bounded;
	throw new RangeError('Il messaggio supera il budget anche senza contenuto e metadati facoltativi.');
}

/**
 * Paginazione all'indietro conforme al protocollo con budget rigoroso di byte UTF-8.
 */
export function paginateRemoteMessages(
	allMessages: RemoteChatMessage[],
	before: string | null,
	limit: number,
	maxPageBytes: number = 200 * 1024
): RemoteChatPage {
	const clampedLimit = Math.max(1, Math.min(limit || 50, 100));

	let endIndex = allMessages.length;
	if (before !== null) {
		const targetIndex = allMessages.findIndex((m) => m.id === before);
		if (targetIndex <= 0) {
			return { messages: [], before: null };
		}
		endIndex = targetIndex;
	}

	let startIndex = endIndex;
	let currentBytes = 0;
	const pageMessages: RemoteChatMessage[] = [];

	while (startIndex > 0 && pageMessages.length < clampedLimit) {
		let candidate = allMessages[startIndex - 1];
		let candidateBytes = messageUtf8Bytes(candidate);

		if (candidateBytes > maxPageBytes) {
			candidate = boundMessageForBudget(candidate, maxPageBytes - 512);
			candidateBytes = messageUtf8Bytes(candidate);
		}

		if (currentBytes + candidateBytes > maxPageBytes && pageMessages.length > 0) {
			break;
		}

		pageMessages.unshift(candidate);
		currentBytes += candidateBytes;
		startIndex--;
	}

	const nextBefore = startIndex > 0 && pageMessages.length > 0 ? pageMessages[0].id : null;
	return { messages: pageMessages, before: nextBefore };
}
