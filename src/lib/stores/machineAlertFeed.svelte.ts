/**
 * Ponte fra la deduplica pura degli avvisi (R-MI-51, `machineAlerts.ts`) e la
 * finestra. Tiene lo stato della deduplica e una coda di un avviso alla volta:
 * la superficie che lo mostra e' quella gia' esistente nella barra di stato.
 *
 * La deduplica vive in `machineAlerts.ts` perche' i test la provano senza
 * finestra; qui non c'e' regola sull'*evento*, solo il passaggio a testo
 * tradotto e la precedenza (IMP-008): quando una macchina su cui si sta
 * lavorando cade, l'avviso passa davanti agli altri e lo dice, invece di
 * aspettare il proprio turno dietro un avanzamento di commit. Nessun avviso
 * viene spostato o rimosso: R-MI-51 resta attivo.
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

/** Un avviso pronto da mostrare. */
export interface MachineNotice {
	/** Cambia a ogni nuovo avviso: la vista riparte da qui. */
	id: number;
	text: string;
	/** Riguarda una macchina su cui si sta lavorando: non scade da solo. */
	sticky: boolean;
}

interface QueuedNotice {
	text: string;
	sticky: boolean;
}

class MachineAlertFeed {
	private state: MachineAlertsState = emptyAlertsState();
	private queue: QueuedNotice[] = [];
	private sequence = 0;
	current = $state<MachineNotice | null>(null);

	/**
	 * Un campione: campioni di presenza ed esiti dei giri. `working` sono le
	 * macchine con una sessione al lavoro da questa finestra: i loro avvisi
	 * vengono prima e la caduta si legge come «mentre lavoravi».
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
			const sticky = working.has(alert.machine);
			(alert.kind === 'presence' && !alert.online && sticky ? urgent : rest).push({
				text: noticeText(alert, sticky),
				sticky: sticky && alert.kind === 'presence' && !alert.online
			});
		}
		if (urgent.length > 0) {
			// La caduta di una macchina al lavoro non aspetta il turno: quello che
			// era in cima torna in coda, dopo (non sparisce).
			if (this.current) this.queue.unshift({ text: this.current.text, sticky: this.current.sticky });
			this.queue.unshift(...urgent);
			this.current = null;
		} else {
			this.queue.push(...rest);
		}
		if (this.current === null) this.advance();
	}

	/** Passa all'avviso successivo, o chiude se la coda e' vuota. */
	advance(): void {
		const next = this.queue.shift();
		this.current = next === undefined ? null : { id: ++this.sequence, text: next.text, sticky: next.sticky };
	}

	dismiss(): void {
		this.advance();
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
		case 'journal':
			return m.machines_alert_journal({ name: alert.name });
		case 'blocked':
			if (alert.reason === 'busy') return m.machines_alert_blocked_busy({ project: alert.project });
			if (alert.reason.startsWith('conflict:')) {
				const files = alert.reason.slice('conflict:'.length).split(',').filter(Boolean).join(', ');
				return m.machines_alert_blocked_conflict({ project: alert.project, files });
			}
			if (alert.reason === 'journalPeer') {
				return m.machines_alert_blocked_journal({ project: alert.project, name: alert.name });
			}
			return m.machines_alert_blocked_other({ project: alert.project, reason: alert.reason });
	}
}

export const machineAlertFeed = new MachineAlertFeed();
