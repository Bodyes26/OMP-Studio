/**
 * Indici incrementali del transcript.
 *
 * Due pre-passate del transcript leggono tutta la storia a ogni flush dello
 * streaming: le tracce dei todo (il `TodoTraceTracker` e' cumulativo, quindi
 * una lista creata fuori dalla finestra conta ancora) e le frasi `studio_headsup`
 * per turno. Con `entries` mai potato, il costo per frame cresce con la chat.
 *
 * Qui le entry si visitano **una volta sola** quando compaiono e si conservano
 * solo quelle che servono (chiamate `todo`, `studio_headsup`): il costo per
 * flush torna a dipendere dal numero di quelle, non dalla lunghezza della
 * storia. Le entry possono cambiare sul posto (`result` arriva a fine
 * chiamata), quindi la firma di ciascuna si ricontrolla a ogni giro e, solo se
 * e' cambiata, il tracker viene rigiocato: poche decine di chiamate, non
 * migliaia di entry.
 *
 * Se la storia torna indietro (diramazione, compattazione, annullo di un
 * invio) la scansione riparte da zero, cosi' l'indice non puo' restare
 * disallineato rispetto all'array.
 */

import type { ToolEntry, TranscriptEntry } from '../session.svelte';
import { TodoTraceTracker, type TodoTraceItem } from '../todoTrace';
import { agentHeadsUp, isHeadsUpToolEntry } from '../turnHeadsUp';

type HeadsUpLookup = Map<number, { text: string; entryId: number }>;

export class TranscriptIndex {
	/** Quante entry di `session.entries` sono gia' state visitate. */
	#cursor = 0;
	/** Estremi visti: se cambiano, l'array non e' piu' un'estensione del precedente. */
	#firstSeen: TranscriptEntry | null = null;
	#lastSeen: TranscriptEntry | null = null;
	/** Turno corrente: id del messaggio utente, `-1` prima del primo. */
	#turn = -1;

	/** Chiamate `todo` di tutta la storia, in ordine di comparsa. */
	#todo: ToolEntry[] = [];
	#todoSignature: unknown[][] = [];
	#todoTraces = new Map<number, TodoTraceItem[]>();

	/** Chiamate `studio_headsup` per turno (di solito zero o una). */
	#headsUpByTurn = new Map<number, ToolEntry[]>();

	#reset(): void {
		this.#cursor = 0;
		this.#firstSeen = null;
		this.#lastSeen = null;
		this.#turn = -1;
		this.#todo = [];
		this.#todoSignature = [];
		this.#todoTraces = new Map();
		this.#headsUpByTurn = new Map();
	}

	/** Visita le sole entry nuove; riparte da capo se la storia e' stata riscritta. */
	#scan(entries: readonly TranscriptEntry[]): void {
		// Il prefisso visitato deve essere lo stesso di prima: un array piu'
		// corto (potatura, compattazione) o un primo elemento diverso (storia
		// sostituita) invalidano tutto l'indice.
		if (
			entries.length < this.#cursor ||
			(this.#cursor > 0 && (entries[0] !== this.#firstSeen || entries[this.#cursor - 1] !== this.#lastSeen))
		) {
			this.#reset();
		}
		for (let i = this.#cursor; i < entries.length; i++) {
			const entry = entries[i];
			if (entry.kind === 'user') {
				this.#turn = entry.id;
			} else if (entry.kind === 'tool') {
				if (entry.toolName === 'todo') {
					this.#todo.push(entry);
				} else if (isHeadsUpToolEntry(entry)) {
					const list = this.#headsUpByTurn.get(this.#turn);
					if (list) list.push(entry);
					else this.#headsUpByTurn.set(this.#turn, [entry]);
				}
			}
		}
		this.#cursor = entries.length;
		this.#firstSeen = entries.length > 0 ? entries[0] : null;
		this.#lastSeen = entries.length > 0 ? entries[entries.length - 1] : null;
	}

	/**
	 * Tracce dei todo per id della chiamata che le ha prodotte, su tutta la
	 * storia: le righe visibili restano corrette anche quando la lista e'
	 * nata prima della finestra mostrata.
	 */
	todoTraces(entries: readonly TranscriptEntry[]): Map<number, TodoTraceItem[]> {
		this.#scan(entries);
		let changed = this.#todoTraces.size !== this.#todo.length;
		for (let i = 0; i < this.#todo.length && !changed; i++) {
			const entry = this.#todo[i];
			const previous = this.#todoSignature[i];
			if (
				!previous ||
				previous[0] !== entry.args ||
				previous[1] !== entry.result ||
				previous[2] !== entry.running
			) {
				changed = true;
			}
		}
		if (!changed) return this.#todoTraces;
		for (let i = 0; i < this.#todo.length; i++) {
			const entry = this.#todo[i];
			this.#todoSignature[i] = [entry.args, entry.result, entry.running];
		}

		// Rigioco del tracker: le tracce sono un accumulo, quindi una chiamata
		// cambiata riconfigura anche le successive. Il numero di chiamate `todo`
		// di una chat e' piccolo; il costo non dipende dalla lunghezza della storia.
		const tracker = new TodoTraceTracker();
		const traces = new Map<number, TodoTraceItem[]>();
		for (const entry of this.#todo) {
			traces.set(entry.id, tracker.process({ args: entry.args, result: entry.result }));
		}
		this.#todoTraces = traces;
		return traces;
	}

	/** Frasi `studio_headsup` per id del messaggio utente che apre il turno. */
	headsUpByTurn(entries: readonly TranscriptEntry[]): HeadsUpLookup {
		this.#scan(entries);
		const map: HeadsUpLookup = new Map();
		for (const [turn, calls] of this.#headsUpByTurn) {
			const found = agentHeadsUp(calls);
			if (found) map.set(turn, found);
		}
		return map;
	}
}
