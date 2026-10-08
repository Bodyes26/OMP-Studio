// Stato del riquadro «A margine» (`/btw`) di una sessione della chat GUI.
//
// Una istanza per `AgentSession`: il riduttore della sessione le passa i frame
// `btw_record`/`btw_delta`, il riquadro (BtwPopover), la riga nel vassoio e il
// composer leggono da qui. Le dipendenze arrivano dal costruttore, cosi' i test
// la esercitano in Node con un `send` finto (le rune sono lo shim identita').

import { m as messages } from '$lib/paraglide/messages.js';
import {
	applyBtwDelta,
	btwCopyText,
	btwLatestTurn,
	btwQuoteMarkdown,
	isBtwRunning,
	isBtwUnsupportedError,
	parseBtwHistory,
	parseBtwRecord,
	upsertBtwRecord,
	type BtwRecord
} from './btw';

type BtwCommand =
	| { type: 'btw'; question: string; recordId?: string }
	| { type: 'btw_cancel'; recordId?: string }
	| { type: 'get_btw_history' };

export interface SessionBtwDeps {
	send: (command: BtwCommand) => Promise<unknown>;
	/** Esito breve sopra il composer (sostituisce il precedente). */
	flash: (level: 'info' | 'warning' | 'error', message: string) => void;
	/** Avviso nel transcript: per cio' che deve restare (runtime senza supporto). */
	notice: (level: 'info' | 'warning' | 'error', message: string) => void;
	copy?: (text: string) => Promise<void>;
}

/** Citazione pronta per il composer: entra nel contesto solo se l'utente invia. */
export interface BtwQuote {
	question: string;
	answer: string;
	/** Markdown anteposto al messaggio all'invio. */
	markdown: string;
}

/** Domanda appena inviata, prima che arrivi il suo record. */
export interface BtwPending {
	question: string;
	recordId: string | null;
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class SessionBtw {
	/** `null` finche' non si sa; `false` con un omp senza le domande a margine (< 18.6.3). */
	supported = $state<boolean | null>(null);
	/** Storico della sessione, dal piu' recente (condiviso con il `/btw` della TUI). */
	records = $state<BtwRecord[]>([]);
	/** Argomento mostrato nel riquadro; `null` = domanda nuova. */
	selectedId = $state<string | null>(null);
	open = $state(false);
	historyOpen = $state(false);
	/** Bozza del campo del riquadro: sopravvive alla chiusura con Esc. */
	draft = $state('');
	pending = $state<BtwPending | null>(null);
	quote = $state<BtwQuote | null>(null);
	/** Richiede il fuoco sul campo del riquadro (incrementato a ogni apertura). */
	focusTick = $state(0);

	private readonly deps: SessionBtwDeps;
	private historyLoad: Promise<void> | null = null;
	/** Cresce a ogni cambio di sessione: una risposta in ritardo non tocca la sessione nuova. */
	private epoch = 0;

	constructor(deps: SessionBtwDeps) {
		this.deps = deps;
	}

	get selected(): BtwRecord | null {
		return this.records.find((record) => record.id === this.selectedId) ?? null;
	}

	/** Una domanda gira gia' (o sta partendo): omp ne accetta una per volta. */
	get busy(): boolean {
		return this.pending !== null || this.records.some((record) => isBtwRunning(record));
	}

	get selectedRunning(): boolean {
		return isBtwRunning(this.selected) || (this.pending !== null && this.pending.recordId === this.selectedId);
	}

	/**
	 * Riga nel vassoio a riquadro chiuso: l'argomento aperto resta raggiungibile
	 * con «Apri» (sta rispondendo / risposta pronta).
	 */
	get trayRecord(): BtwRecord | null {
		if (this.open) return null;
		return this.selected;
	}

	/* ------------------------------------------------------------ frame */

	applyRecordFrame(raw: unknown): void {
		const record = parseBtwRecord(raw);
		if (!record) return;
		this.supported = true;
		this.records = upsertBtwRecord(this.records, record);
		// Il primo `btw_record` arriva prima della risposta a `btw`: e' lui a
		// dire l'id di un argomento nuovo.
		if (this.pending && this.pending.recordId === null && record.question === this.pending.question) {
			this.selectedId = record.id;
			this.pending = null;
		} else if (this.pending && this.pending.recordId === record.id) {
			this.pending = null;
		}
	}

	applyDeltaFrame(recordId: unknown, delta: unknown): void {
		if (typeof recordId !== 'string' || typeof delta !== 'string') return;
		this.records = applyBtwDelta(this.records, recordId, delta);
	}

	/* ---------------------------------------------------------- comandi */

	/**
	 * Carica lo storico; fa anche da sonda: un omp che non conosce il comando
	 * spegne il pulsante invece di lasciare un controllo che fallisce.
	 */
	loadHistory(): Promise<void> {
		if (this.historyLoad) return this.historyLoad;
		const epoch = this.epoch;
		this.historyLoad = (async () => {
			try {
				const data = await this.deps.send({ type: 'get_btw_history' });
				if (epoch !== this.epoch) return;
				this.supported = true;
				let merged = parseBtwHistory(data);
				// Un record ricevuto via frame mentre la richiesta era in volo vince.
				for (const live of this.records) merged = upsertBtwRecord(merged, live);
				this.records = merged;
			} catch (error) {
				if (epoch !== this.epoch) return;
				if (isBtwUnsupportedError(error)) this.supported = false;
				else console.warn('Storico delle domande a margine non disponibile:', reason(error));
			} finally {
				this.historyLoad = null;
			}
		})();
		return this.historyLoad;
	}

	/** Messaggio unico per un runtime senza domande a margine: niente rimandi al terminale. */
	private reportUnsupported(): void {
		this.deps.notice('warning', messages.btw_unsupported());
	}

	setOpen(open: boolean): void {
		if (open && this.supported === false) {
			this.reportUnsupported();
			return;
		}
		this.open = open;
		if (open) {
			this.focusTick++;
			if (this.supported === null || this.records.length === 0) void this.loadHistory();
		} else {
			this.historyOpen = false;
		}
	}

	toggle(): void {
		this.setOpen(!this.open);
	}

	toggleHistory(): void {
		this.historyOpen = !this.historyOpen;
		if (this.historyOpen) void this.loadHistory();
	}

	selectTopic(id: string): void {
		this.selectedId = id;
		this.historyOpen = false;
		this.focusTick++;
	}

	newQuestion(): void {
		this.selectedId = null;
		this.draft = '';
		this.historyOpen = false;
		this.focusTick++;
	}

	/** Toglie la riga dal vassoio: la domanda resta nello storico (e continua se gira). */
	dismissTray(): void {
		this.selectedId = null;
	}

	/**
	 * Manda la domanda: nuova, o approfondimento dell'argomento aperto. La
	 * risposta scorre nel riquadro mentre l'agente principale continua.
	 */
	async ask(rawQuestion: string): Promise<boolean> {
		const question = rawQuestion.trim();
		if (!question) return false;
		if (this.supported === false) {
			this.reportUnsupported();
			return false;
		}
		if (this.busy) {
			this.deps.flash('warning', messages.btw_one_at_a_time());
			return false;
		}
		const recordId = this.selected ? this.selected.id : null;
		this.pending = { question, recordId };
		this.selectedId = recordId;
		this.draft = '';
		this.historyOpen = false;
		const epoch = this.epoch;
		try {
			const data = (await this.deps.send(
				recordId ? { type: 'btw', question, recordId } : { type: 'btw', question }
			)) as { record?: unknown } | null;
			if (epoch !== this.epoch) return false;
			this.supported = true;
			const record = parseBtwRecord(data?.record);
			if (record) {
				this.records = upsertBtwRecord(this.records, record);
				this.selectedId = record.id;
			}
			this.pending = null;
			return true;
		} catch (error) {
			if (epoch !== this.epoch) return false;
			this.pending = null;
			if (isBtwUnsupportedError(error)) {
				this.supported = false;
				this.open = false;
				this.reportUnsupported();
			} else {
				// La domanda torna nel campo: non si perde quello che si era scritto.
				if (!this.draft) this.draft = question;
				this.deps.flash('error', messages.btw_ask_failed({ error: reason(error) }));
			}
			return false;
		}
	}

	async cancel(): Promise<void> {
		const record = this.selected;
		if (!record || !isBtwRunning(record)) return;
		try {
			await this.deps.send({ type: 'btw_cancel', recordId: record.id });
		} catch (error) {
			this.deps.flash('error', messages.btw_cancel_failed({ error: reason(error) }));
		}
	}

	async copySelected(): Promise<void> {
		const record = this.selected;
		if (!record) return;
		const text = btwCopyText(record);
		if (!text) return;
		try {
			await (this.deps.copy ?? ((value: string) => navigator.clipboard.writeText(value)))(text);
			this.deps.flash('info', messages.btw_copied());
		} catch (error) {
			this.deps.flash('error', reason(error));
		}
	}

	/**
	 * «Usa nel messaggio»: domanda e ultima risposta diventano una citazione
	 * nel composer. Non entra nel contesto finche' l'utente non invia.
	 */
	useInMessage(): boolean {
		const record = this.selected;
		if (!record) return false;
		const answer = btwLatestTurn(record).answer.trim();
		if (!answer) return false;
		this.quote = {
			question: record.question,
			answer,
			markdown: btwQuoteMarkdown(messages.btw_title(), record.question, answer)
		};
		this.setOpen(false);
		this.deps.flash('info', messages.btw_quote_added());
		return true;
	}

	clearQuote(): void {
		this.quote = null;
	}

	/**
	 * Cambio di sessione (nuova chat, ripresa, fork, ramo): omp annulla la
	 * domanda in corso e lo storico e' quello della sessione nuova. La bozza e
	 * la citazione restano: sono testo dell'utente, non della sessione.
	 */
	resetForSession(): void {
		this.epoch++;
		this.records = [];
		this.selectedId = null;
		this.pending = null;
		this.historyOpen = false;
		this.historyLoad = null;
	}

	/** Processo nuovo: il supporto si risonda (un aggiornamento di omp lo accende). */
	resetForProcess(): void {
		this.resetForSession();
		this.supported = null;
		this.open = false;
	}
}
