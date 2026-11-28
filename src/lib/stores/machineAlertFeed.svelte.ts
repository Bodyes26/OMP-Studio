/**
 * Avvisi brevi sugli eventi delle macchine (R-MI-51, IMP-008).
 *
 * Ponte fra la deduplica pura degli avvisi (R-MI-51, `machineAlerts.ts`) e la
 * finestra. Due spazi separati:
 * - `current` e' la coda normale, un avviso alla volta, si consuma da sola;
 * - `sticky` e' la caduta di una macchina su cui si sta lavorando: resta
 *   finche' non la si chiude, ma NON blocca la coda. Prima abitava la stessa
 *   coda e, essendo fisso, teneva invisibili commit arrivati e unioni
 *   (S3-link-front-12).
 *
 * Nessun avviso viene perso: la deduplica vive in `machineAlerts.ts`, qui
 * c'e' solo il passaggio a testo tradotto e la precedenza. Gli errori di
 * sincronizzazione portano `tone: 'error'` e la vista li annuncia con
 * `role="alert"` (S3-link-front-22).
 */

import { m } from '#lib/paraglide/messages.js';
import {
	emptyAlertsState,
	reduceMachineAlerts,
	type MachineAlert,
	type MachineAlertsState,
	type OutcomeSample,
	type PresenceSample
} from './machineAlerts.ts';

export type MachineNoticeTone = 'info' | 'error';

/** Un avviso pronto da mostrare. */
export interface MachineNotice {
	/** Cambia a ogni nuovo avviso: la vista riparte da qui. */
	id: number;
	text: string;
	tone: MachineNoticeTone;
}

interface QueuedNotice {
	text: string;
	tone: MachineNoticeTone;
}

/** Esportata per i test: la coda e lo spazio fisso si provano senza finestra. */
export class MachineAlertFeed {
	private state: MachineAlertsState = emptyAlertsState();
	private queue: QueuedNotice[] = [];
	private sequence = 0;
	/** Coda normale: si consuma da sola dopo pochi secondi. */
	current = $state<MachineNotice | null>(null);
	/** Caduta di una macchina al lavoro: spazio suo, resta finche' non la si chiude. */
	sticky = $state<MachineNotice | null>(null);
	private stickyMachine: string | null = null;

	/**
	 * Un campione: campioni di presenza ed esiti dei giri. `working` sono le
	 * macchine con una sessione al lavoro da questa finestra: la loro caduta
	 * va in testa e si legge come «mentre lavoravi».
	 */
	update(
		machines: readonly PresenceSample[],
		outcomes: readonly OutcomeSample[],
		working: ReadonlySet<string> = new Set()
	): void {
		const result = reduceMachineAlerts(this.state, { machines, outcomes });
		this.state = result.state;
		const urgent: QueuedNotice[] = [];
		const rest: QueuedNotice[] = [];
		for (const alert of result.alerts) {
			const workingHere = working.has(alert.machine);
			const text = noticeText(alert, workingHere);
			// La caduta di una macchina al lavoro non e' un avviso da coda: e'
			// uno stato, e resta finche' la macchina non torna (IMP-008).
			if (alert.kind === 'presence' && !alert.online && workingHere) {
				this.sticky = { id: ++this.sequence, text, tone: 'info' };
				this.stickyMachine = alert.machine;
				continue;
			}
			// La macchina e' tornata: la caduta fissa non e' piu' vera e va
			// tolta da sola, senza aspettare un clic su un avviso gia' superato.
			if (alert.kind === 'presence' && alert.online && alert.machine === this.stickyMachine) {
				this.sticky = null;
				this.stickyMachine = null;
			}
			// Un blocco vero (non «cartella occupata», non un conflitto da
			// risolvere) e' un errore e si annuncia come tale (S3-link-front-22).
			const error = alert.kind === 'blocked' && alert.reason !== 'busy' && !alert.reason.startsWith('conflict:');
			(alert.kind === 'presence' && !alert.online ? urgent : rest).push({ text, tone: error ? 'error' : 'info' });
		}
		// Gli altri avvisi si accodano sempre, anche quando una caduta urgente
		// li precede: prima restavano fuori e la deduplica li dava per emessi
		// (S3-link-front-11).
		if (urgent.length > 0) {
			const before = this.current ? [{ text: this.current.text, tone: this.current.tone }] : [];
			this.queue = [...urgent, ...before, ...this.queue, ...rest];
			this.current = null;
		} else {
			this.queue.push(...rest);
		}
		if (this.current === null) this.advance();
	}

	/**
	 * Un avviso gia' pronto, fuori dalla deduplica degli eventi delle macchine:
	 * lo usa il giro delle copie quando fallisce tre volte di fila (R-MI-57).
	 * Chi chiama ha gia' deciso che va detto una volta sola. Gli errori hanno
	 * la variante errore (S3-link-front-22).
	 */
	announce(text: string, tone: MachineNoticeTone = 'info'): void {
		this.queue.push({ text, tone });
		if (this.current === null) this.advance();
	}

	/** Passa all'avviso successivo, o chiude se la coda e' vuota. */
	advance(): void {
		const next = this.queue.shift();
		this.current = next === undefined ? null : { id: ++this.sequence, text: next.text, tone: next.tone };
	}

	dismiss(): void {
		this.advance();
	}

	/** Chiude la caduta fissa: da qui la macchina o e' tornata o l'utente ha letto. */
	dismissSticky(): void {
		this.sticky = null;
		this.stickyMachine = null;
	}
}


/** Una frase sola per avviso, come gli heads-up di fine turno. */
function noticeText(alert: MachineAlert, working: boolean): string {
	switch (alert.kind) {
		case 'presence':
			return alert.online
				? m.machines_alert_online({ name: alert.name })
				: working
					? m.machines_alert_offline_working({ name: alert.name })
					: m.machines_alert_offline({ name: alert.name });
		case 'advanced':
			return m.machines_alert_advanced({ count: alert.count, name: alert.name });
		case 'merged':
			return m.machines_alert_merged({ name: alert.name });
		case 'journal':
			return m.machines_alert_journal({ name: alert.name });
		case 'blocked':
			if (alert.reason === 'busy') return m.machines_alert_blocked_busy({ project: alert.project });
			if (alert.reason.startsWith('conflict:')) {
				const files = alert.reason.slice('conflict:'.length).split(',').filter(Boolean).join(', ');
				return m.machines_alert_blocked_conflict({ project: alert.project, files });
			}
			return m.machines_alert_blocked_other({ project: alert.project, reason: alert.reason });
	}
}

export const machineAlertFeed = new MachineAlertFeed();
