// Motore puro di rivelazione del testo (Gate R32 - C05).
// Divide il markdown in blocchi e unita' (frasi nei paragrafi, titoli ed elenchi;
// blocchi interi per codice, tabelle e citazioni).
// Calcola la completezza dell'ultima unita' in base a fine stream o ritorno a capo
// fuori da un blocco di codice aperto.

import { lexMarkdown, type Token, type Tokens } from './markdown.ts';

export type BlockKind = 'p' | 'h' | 'li' | 'oli' | 'code' | 'table' | 'blockquote' | 'other';
export type UnitKind = 'sentence' | 'block';

export interface RevealUnit {
	index: number;
	kind: UnitKind;
	text: string;
	lift?: boolean;
	blockKind: BlockKind;
	num?: string;
	lang?: string;
}

export interface RevealBlock {
	kind: BlockKind;
	num?: string;
	lang?: string;
	closed?: boolean;
	depth?: number;
	units: RevealUnit[];
}

export interface RevealResult {
	blocks: RevealBlock[];
	units: RevealUnit[];
	totalUnits: number;
	completeUnits: number;
	tailComplete: boolean;
	hasOpenCodeFence: boolean;
	pendingChars: (revealedCount: number) => number;
}

/**
 * Controlla se la posizione index nel testo cade all'interno di codice inline
 * (aperto da backtick non chiuso) o di testo in grassetto (** non chiuso).
 * In questi intervalli non e' consentito spezzare le frasi.
 */
export function isInsideCodeOrBold(text: string, index: number): boolean {
	let inCode = false;
	let inBold = false;
	for (let i = 0; i < index; i++) {
		if (text[i] === '`' && text[i - 1] !== '\\') {
			inCode = !inCode;
		} else if (!inCode && text[i] === '*' && text[i + 1] === '*' && text[i - 1] !== '\\') {
			inBold = !inBold;
			i++;
		}
	}
	return inCode || inBold;
}

/**
 * Rileva se il testo termina all'interno di un blocco di codice aperto
 * (recinzione ``` senza recinzione di chiusura corrispondente).
 */
export function isOpenCodeFence(text: string): boolean {
	const lines = text.split('\n');
	let inFence = false;
	for (const line of lines) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith('```')) {
			inFence = !inFence;
		}
	}
	return inFence;
}

/**
 * Fine frase: . ! ? … (eventualmente seguiti da chiusura grassetto) + spazio + inizio plausibile di nuova frase.
 * Non spezza dentro codice inline ne' dentro marcatori di grassetto, ne' su abbreviazioni seguite da minuscola.
 */
const SENTENCE_END = /(?<=[.!?…](?:\*\*)?)\s+(?=[A-ZÀ-ÖØ-Þ0-9"«(`*])/g;

/**
 * Divide un blocco di testo nelle sue frasi componenti.
 */
export function splitSentences(text: string): string[] {
	if (!text) return [];
	const parts: string[] = [];
	let lastIndex = 0;
	SENTENCE_END.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = SENTENCE_END.exec(text)) !== null) {
		const splitPos = match.index;
		if (isInsideCodeOrBold(text, splitPos)) {
			continue;
		}
		parts.push(text.slice(lastIndex, splitPos));
		lastIndex = splitPos + match[0].length;
	}
	parts.push(text.slice(lastIndex));
	return parts.filter((p) => p.length > 0);
}

/**
 * Verifica se l'ultima unita' e' completa:
 * - sempre se lo stream e' terminato (done = true)
 * - altrimenti se termina con newline e NON ci troviamo in un blocco di codice aperto.
 */
export function isTailComplete(text: string, done: boolean): boolean {
	if (done) return true;
	if (isOpenCodeFence(text)) return false;
	return text.endsWith('\n');
}

/**
 * Esegue il parsing del testo in blocchi e unita' di rivelazione.
 * Utilizza `lexMarkdown` per l'albero di token principale, preservando la cache LRU.
 */
export function parseReveal(text: string, done: boolean, customTokens?: Token[]): RevealResult {
	if (!text) {
		return {
			blocks: [],
			units: [],
			totalUnits: 0,
			completeUnits: 0,
			tailComplete: true,
			hasOpenCodeFence: false,
			pendingChars: () => 0
		};
	}

	const tokens = customTokens ?? lexMarkdown(text);
	const openCode = isOpenCodeFence(text);
	const tailComplete = isTailComplete(text, done);

	const units: RevealUnit[] = [];
	const blocks: RevealBlock[] = [];

	function addSentenceUnits(blockKind: BlockKind, content: string, meta?: { depth?: number; num?: string }) {
		const sentences = splitSentences(content);
		if (sentences.length === 0) return;
		const blockUnits: RevealUnit[] = sentences.map((s) => {
			const u: RevealUnit = {
				index: units.length,
				kind: 'sentence',
				text: s,
				blockKind,
				num: meta?.num
			};
			units.push(u);
			return u;
		});
		blocks.push({
			kind: blockKind,
			depth: meta?.depth,
			num: meta?.num,
			units: blockUnits
		});
	}

	for (const token of tokens) {
		switch (token.type) {
			case 'paragraph': {
				addSentenceUnits('p', token.text);
				break;
			}
			case 'heading': {
				addSentenceUnits('h', token.text, { depth: token.depth });
				break;
			}
			case 'list': {
				const start = typeof token.start === 'number' ? token.start : 1;
				token.items.forEach((item: Tokens.ListItem, idx: number) => {
					if (token.ordered) {
						addSentenceUnits('oli', item.text, { num: String(start + idx) });
					} else {
						addSentenceUnits('li', item.text);
					}
				});
				break;
			}
			case 'code': {
				const closed = !openCode || token.raw.trimEnd().endsWith('```');
				const u: RevealUnit = {
					index: units.length,
					kind: 'block',
					lift: true,
					text: token.text,
					lang: token.lang,
					blockKind: 'code'
				};
				units.push(u);
				blocks.push({
					kind: 'code',
					lang: token.lang,
					closed,
					units: [u]
				});
				break;
			}
			case 'blockquote': {
				const u: RevealUnit = {
					index: units.length,
					kind: 'block',
					lift: true,
					text: token.raw,
					blockKind: 'blockquote'
				};
				units.push(u);
				blocks.push({
					kind: 'blockquote',
					units: [u]
				});
				break;
			}
			case 'table': {
				const u: RevealUnit = {
					index: units.length,
					kind: 'block',
					lift: true,
					text: token.raw,
					blockKind: 'table'
				};
				units.push(u);
				blocks.push({
					kind: 'table',
					units: [u]
				});
				break;
			}
			case 'space':
				break;
			default: {
				const textVal = 'text' in token && typeof token.text === 'string'
					? token.text
					: 'raw' in token && typeof token.raw === 'string'
						? token.raw
						: '';
				if (textVal) {
					const u: RevealUnit = {
						index: units.length,
						kind: 'block',
						text: textVal,
						blockKind: 'other'
					};
					units.push(u);
					blocks.push({
						kind: 'other',
						units: [u]
					});
				}
				break;
			}
		}
	}

	const totalUnits = units.length;
	const completeUnits = tailComplete ? totalUnits : Math.max(0, totalUnits - 1);

	const pendingChars = (revealedCount: number): number => {
		let chars = 0;
		for (let i = revealedCount; i < units.length; i++) {
			chars += units[i].text.length;
		}
		return chars;
	};

	return {
		blocks,
		units,
		totalUnits,
		completeUnits,
		tailComplete,
		hasOpenCodeFence: openCode,
		pendingChars
	};
}

/**
 * Calcola la configurazione delle righe ghost (max 3) in base ai caratteri ancora in attesa.
 */
export function computeGhostLines(pendingChars: number): Array<{ width: number }> {
	const per = 95;
	const count = Math.min(3, Math.max(1, Math.ceil(pendingChars / per)));
	const lines: Array<{ width: number }> = [];
	for (let i = 0; i < count; i++) {
		const rest = pendingChars - i * per;
		const width = i < count - 1 ? 100 : Math.max(5, Math.min(100, Math.round((rest / per) * 100)));
		lines.push({ width });
	}
	return lines;
}
