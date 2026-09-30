/**
 * Titolo e corpo dei task in coda, condivisi da pannello Agente, cassetto
 * globale e titoli di corsia. Modulo puro: niente store, niente i18n.
 *
 * Il titolo non deve mai ripetere il testo che la card mostra sotto: o e'
 * un'etichetta generata (e allora sotto c'e' il prompt intero) o e' una prima
 * riga distinta (e allora sotto c'e' il resto), altrimenti non c'e'.
 */

import type { StudioTask } from './taskSerialization';

/** Oltre questa lunghezza una prima riga e' un paragrafo, non un titolo. */
const HEADLINE_MAX_CHARS = 80;

export type TaskHeadlineSource = 'generated' | 'heading' | null;

export interface TaskText {
	/** Titolo da mostrare; `null` quando il prompt parla da solo. */
	headline: string | null;
	headlineSource: TaskHeadlineSource;
	/** Testo sotto il titolo, a capo preservati; vuoto se non resta nulla. */
	body: string;
}

/**
 * Impronta FNV-1a a 32 bit del prompt con spazi normalizzati: lega il titolo
 * generato alla versione del testo da cui e' nato. Non serve resistenza alle
 * collisioni, solo accorgersi che il prompt e' cambiato.
 */
export function promptHash(prompt: string): string {
	const normalized = prompt.replace(/\s+/g, ' ').trim();
	let hash = 0x811c9dc5;
	for (let i = 0; i < normalized.length; i++) {
		hash ^= normalized.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Il titolo generato vale solo per il prompt da cui e' nato. */
export function freshGeneratedTitle(task: Pick<StudioTask, 'prompt' | 'title' | 'titleHash'>): string | null {
	const title = task.title?.trim();
	if (!title || !task.titleHash) return null;
	return task.titleHash === promptHash(task.prompt) ? title : null;
}

/**
 * Separa titolo e corpo. Priorita': etichetta generata valida, poi intestazione
 * markdown o prima riga breve seguita da altro testo, poi nessun titolo.
 */
export function splitTaskText(task: Pick<StudioTask, 'prompt' | 'title' | 'titleHash'>): TaskText {
	const prompt = task.prompt.trim();
	const generated = freshGeneratedTitle(task);
	if (generated) return { headline: generated, headlineSource: 'generated', body: prompt };

	const lines = prompt.split(/\r?\n/);
	const firstIndex = lines.findIndex((line) => line.trim());
	if (firstIndex < 0) return { headline: null, headlineSource: null, body: '' };

	const first = lines[firstIndex].trim();
	const rest = lines.slice(firstIndex + 1).join('\n').trim();
	const heading = /^#{1,6}\s+(.+)$/.exec(first);
	if (heading) {
		return { headline: heading[1].trim(), headlineSource: 'heading', body: rest };
	}
	if (rest && first.length <= HEADLINE_MAX_CHARS) {
		return { headline: first, headlineSource: 'heading', body: rest };
	}
	return { headline: null, headlineSource: null, body: prompt };
}

/**
 * Nome breve del task per aria-label, titoli di dialog e corsie: il titolo
 * se c'e', altrimenti la prima riga del prompt. `null` per prompt vuoto.
 */
export function taskLabel(task: Pick<StudioTask, 'prompt' | 'title' | 'titleHash'>): string | null {
	const { headline } = splitTaskText(task);
	if (headline) return headline;
	return task.prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || null;
}

/** Ruoli con un badge in coda; gli altri valori non si mostrano. */
const ROLE_BADGES: Record<string, true> = { smol: true, slow: true, plan: true, custom: true, default: true };

export function roleBadge(role?: string): string | null {
	return role && ROLE_BADGES[role] === true ? role : null;
}
