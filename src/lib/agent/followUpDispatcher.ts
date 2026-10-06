// Macchina a stati della coda locale dei follow-up della chat.
//
// Modulo puro (niente rune, niente Tauri): la sessione gli presta lo stato
// che serve tramite `FollowUpHost`, cosi' la logica si prova nei test con un
// host finto e timer finti.
//
// Il punto delicato e' l'ordine dei frame di omp: la risposta al `prompt`
// arriva PRIMA di `agent_start` (vedi test/fixtures/chat-v2/tools-real.ndjson).
// Quando l'invio risolve `sent` la sessione non risulta ancora in streaming:
// rilanciare subito il follow-up successivo lo spedirebbe come prompt nuovo
// mentre omp sta gia' lavorando, omp lo rifiuterebbe e la coda si metterebbe
// in pausa. Il successivo parte quindi solo da `agent_end`; dopo un invio si
// aspetta `agent_start` e, se non arriva, la coda si ferma con un avviso.

import type { QueueMode, StreamingBehavior } from './wire';
import type { LocalFollowUp } from './localFollowUpQueue';

export type FollowUpDelivery = 'sent' | 'deferred' | 'failed' | 'empty';

/** Attesa massima di `agent_start` dopo un invio accettato. */
export const FOLLOW_UP_START_TIMEOUT_MS = 10_000;

export interface FollowUpHost {
	/** Coda corrente, in ordine di invio. */
	queue(): readonly LocalFollowUp[];
	mode(): QueueMode;
	paused(): boolean;
	/** Vero quando omp puo' ricevere un prompt nuovo (pronto, fermo, senza domande aperte). */
	idle(): boolean;
	/**
	 * Invia un elemento. `forced` impone `streamingBehavior` senza guardare lo
	 * stato di streaming: serve ai successivi della modalita' `all`, che omp
	 * deve accodare dietro al primo anche se `agent_start` non e' ancora arrivato.
	 */
	send(item: LocalFollowUp, forced?: StreamingBehavior): Promise<FollowUpDelivery>;
	remove(id: number): void;
	/** Mette in pausa la coda; `timeout` quando omp non ha confermato l'avvio. */
	pause(reason: 'failed' | 'timeout'): void;
	setTimer(callback: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
}

export class FollowUpDispatcher {
	private dispatching = false;
	private awaitingStart = false;
	private startTimer: unknown = null;
	private startsSeen = 0;
	private generation = 0;

	private readonly host: FollowUpHost;
	private readonly startTimeoutMs: number;

	constructor(host: FollowUpHost, startTimeoutMs = FOLLOW_UP_START_TIMEOUT_MS) {
		this.host = host;
		this.startTimeoutMs = startTimeoutMs;
	}

	/** Cresce a ogni invalidazione: un invio in volo di un'epoca vecchia non tocca piu' la coda. */
	get epoch(): number {
		return this.generation;
	}

	get isAwaitingStart(): boolean {
		return this.awaitingStart;
	}

	get isDispatching(): boolean {
		return this.dispatching;
	}

	/** Stop, nuova chat, processo morto: chi era in volo non deve piu' consegnare. */
	invalidate(): void {
		this.generation++;
		this.dispatching = false;
		this.stopWaiting();
	}

	onAgentStart(): void {
		this.startsSeen++;
		this.stopWaiting();
	}

	/** Fine di un'esecuzione: l'unico momento in cui parte il follow-up successivo. */
	onAgentEnd(): void {
		// Un `agent_end` dimostra che l'esecuzione c'e' stata anche se
		// `agent_start` e' andato perso (per esempio scartato durante uno Stop).
		this.stopWaiting();
		void this.dispatch();
	}

	async dispatch(): Promise<void> {
		const host = this.host;
		if (this.dispatching || this.awaitingStart || host.paused() || !host.idle()) return;
		const queue = host.queue();
		if (queue.length === 0) return;
		const all = host.mode() === 'all';
		const first = queue[0];
		const rest = all ? queue.slice(1) : [];
		const epoch = this.generation;
		const startsBefore = this.startsSeen;
		this.dispatching = true;
		try {
			const delivery = await this.safeSend(first);
			if (epoch !== this.generation) return;
			if (delivery !== 'sent') {
				// `deferred` non arriva da qui (la sessione e' pronta per
				// costruzione); trattarlo come inviato perderebbe l'ordine.
				host.pause('failed');
				return;
			}
			host.remove(first.id);
			if (this.startsSeen === startsBefore) this.waitForStart(epoch);
			for (const item of rest) {
				if (epoch !== this.generation || host.paused()) return;
				// Il follow-up puo' essere stato tolto o modificato nel frattempo.
				if (!host.queue().some((candidate) => candidate.id === item.id)) continue;
				const next = await this.safeSend(item, 'followUp');
				if (epoch !== this.generation) return;
				if (next !== 'sent') {
					host.pause('failed');
					return;
				}
				host.remove(item.id);
			}
		} finally {
			// Dopo un'invalidazione il flag appartiene gia' all'epoca nuova.
			if (epoch === this.generation) this.dispatching = false;
		}
	}

	private async safeSend(item: LocalFollowUp, forced?: StreamingBehavior): Promise<FollowUpDelivery> {
		try {
			return await this.host.send(item, forced);
		} catch {
			return 'failed';
		}
	}

	private waitForStart(epoch: number): void {
		this.awaitingStart = true;
		this.startTimer = this.host.setTimer(() => {
			this.startTimer = null;
			if (epoch !== this.generation || !this.awaitingStart) return;
			this.awaitingStart = false;
			this.host.pause('timeout');
		}, this.startTimeoutMs);
	}

	private stopWaiting(): void {
		this.awaitingStart = false;
		if (this.startTimer !== null) {
			this.host.clearTimer(this.startTimer);
			this.startTimer = null;
		}
	}
}
