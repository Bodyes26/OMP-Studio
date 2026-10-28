import type { AssistantEntry, ToolEntry, TranscriptEntry, UserEntry } from '#lib/agent/session.svelte.ts';
import { categoryForTool } from '#lib/agent/tools/categories.ts';

export type AskContextItem =
	| { kind: 'user'; entry: UserEntry }
	| { kind: 'assistant'; entry: AssistantEntry }
	| { kind: 'ask'; entry: ToolEntry };

export interface AskContext {
	/** Conversazione fino all'ultimo intervento dell'utente compreso: si apre a richiesta. */
	prior: AskContextItem[];
	/** Testo scritto dall'agente dopo l'ultimo intervento dell'utente, cioe' il preambolo della domanda. */
	leadIn: AskContextItem[];
}

/**
 * Divide il transcript attorno alla domanda in attesa.
 *
 * Il preambolo comincia dopo l'ultimo intervento dell'utente: un messaggio o
 * una risposta a una domanda precedente. Prendere invece l'ultimo testo
 * dell'agente ovunque si trovi riportava in cima, dopo una serie di domande,
 * il messaggio lungo scritto prima della prima.
 * La domanda ancora aperta (`running`) e' quella mostrata sotto: non entra.
 */
export function splitAskContext(entries: readonly TranscriptEntry[]): AskContext {
	const items: AskContextItem[] = [];
	let boundary = -1;
	for (const entry of entries) {
		if (entry.kind === 'user') {
			items.push({ kind: 'user', entry });
			boundary = items.length - 1;
		} else if (entry.kind === 'assistant') {
			if (entry.blocks.some((b) => b.type === 'text' && /\S/.test(b.text))) {
				items.push({ kind: 'assistant', entry });
			}
		} else if (entry.kind === 'tool' && !entry.running && categoryForTool(entry.toolName) === 'ask') {
			items.push({ kind: 'ask', entry });
			boundary = items.length - 1;
		}
	}
	return { prior: items.slice(0, boundary + 1), leadIn: items.slice(boundary + 1) };
}
