/**
 * Avvisi brevi sugli eventi delle macchine (R-MI-51).
 *
 * La regola che conta e' la deduplica: lo stesso evento non si ripete finche'
 * lo stato non cambia, e all'avvio non si annunciano le macchine gia' in
 * linea. La decisione sta qui, pura, cosi' i test possono provarla senza
 * finestra e senza timer; chi la chiama mostra soltanto gli avvisi restituiti.
 */

export type MachineAlert =
	| { kind: 'presence'; machine: string; name: string; online: boolean }
	| { kind: 'advanced'; machine: string; name: string; project: string; count: number }
	| { kind: 'journal'; machine: string; name: string; project: string }
	| { kind: 'blocked'; machine: string; name: string; project: string; reason: string; count: number };

/** Una macchina con il suo stato di presenza, come lo vede il collegamento. */
export interface PresenceSample {
	id: string;
	name: string;
	online: boolean;
}

/** Esito del giro di una copia, gia' ridotto a cio' che genera un avviso. */
export interface OutcomeSample {
	machine: string;
	name: string;
	project: string;
	/** Commit arrivati e copia avanzata (`advanced` o `mergedJournal`). */
	advanced: number;
	mergedJournal: boolean;
	/** Avanzamenti rimasti indietro: branch, motivo e commit in attesa. */
	blocked: Array<{ branch: string; reason: string; behind: number }>;
	/** Cima locale dopo il giro: due lotti da 3 commit sono due eventi. */
	head: string | null;
}

export interface MachineAlertsState {
	/** Il primo campione registra lo stato senza annunciarlo. */
	initialized: boolean;
	presence: Record<string, boolean>;
	/** Ultima impronta emessa per chiave: finche' non cambia non si ripete. */
	emitted: Record<string, string>;
}

export function emptyAlertsState(): MachineAlertsState {
	return { initialized: false, presence: {}, emitted: {} };
}

export interface AlertsInput {
	machines: readonly PresenceSample[];
	outcomes: readonly OutcomeSample[];
}

export interface AlertsResult {
	state: MachineAlertsState;
	alerts: MachineAlert[];
}

/**
 * Presenza: una macchina che torna o cade. Al primo campione si registra e
 * basta (chi era gia' in linea all'avvio non si annuncia), come chiede
 * R-MI-51. Una macchina appena abbinata non e' un «ritorno».
 */
function presenceAlerts(state: MachineAlertsState, machines: readonly PresenceSample[]): MachineAlert[] {
	const alerts: MachineAlert[] = [];
	const known = new Set(Object.keys(state.presence));
	for (const machine of machines) {
		const previous = state.presence[machine.id];
		state.presence[machine.id] = machine.online;
		if (!state.initialized) continue;
		// Mai vista prima: l'abbinamento non e' un cambio di presenza.
		if (previous === undefined) continue;
		if (previous === machine.online) continue;
		alerts.push({ kind: 'presence', machine: machine.id, name: machine.name, online: machine.online });
	}
	// Le macchine revocate spariscono dallo stato: se tornassero sarebbero nuove.
	const current = new Set(machines.map((machine) => machine.id));
	for (const id of known) if (!current.has(id)) delete state.presence[id];
	return alerts;
}

/**
 * Esiti dei giri: commit arrivati, diario unito, avanzamento bloccato. La
 * chiave porta il conteggio, cosi' un nuovo commit produce un nuovo avviso e
 * lo stesso stato non si ripete a ogni giro.
 */
function outcomeAlerts(state: MachineAlertsState, outcomes: readonly OutcomeSample[]): MachineAlert[] {
	const alerts: MachineAlert[] = [];
	// Senza il primo campione non si conosce il passato: si registra e basta.
	if (!state.initialized) return alerts;
	for (const outcome of outcomes) {
		if (outcome.advanced > 0) {
			const key = `advanced|${outcome.project}|${outcome.machine}`;
			const signature = `${outcome.advanced}|${outcome.head ?? ''}`;
			if (state.emitted[key] !== signature) {
				state.emitted[key] = signature;
				alerts.push({
					kind: 'advanced', machine: outcome.machine, name: outcome.name,
					project: outcome.project, count: outcome.advanced
				});
			}
		}
		if (outcome.mergedJournal) {
			const key = `journal|${outcome.project}|${outcome.machine}`;
			const signature = `${outcome.advanced}|${outcome.head ?? ''}`;
			if (state.emitted[key] !== signature) {
				state.emitted[key] = signature;
				alerts.push({ kind: 'journal', machine: outcome.machine, name: outcome.name, project: outcome.project });
			}
		}
		for (const blocked of outcome.blocked) {
			const key = `blocked|${outcome.project}|${outcome.machine}|${blocked.branch}`;
			const signature = `${blocked.reason}|${blocked.behind}`;
			if (state.emitted[key] !== signature) {
				state.emitted[key] = signature;
				alerts.push({
					kind: 'blocked', machine: outcome.machine, name: outcome.name,
					project: outcome.project, reason: blocked.reason, count: blocked.behind
				});
			}
		}
		// Nessun blocco, nessun avanzamento: lo stato «a posto» azzera le chiavi,
		// cosi' lo stesso blocco che ritorna dopo essersi risolto si annuncia di nuovo.
		if (outcome.blocked.length === 0) {
			for (const key of Object.keys(state.emitted)) {
				if (key.startsWith(`blocked|${outcome.project}|${outcome.machine}|`)) delete state.emitted[key];
			}
		}
	}
	return alerts;
}

/**
 * Un passo della deduplica: dato lo stato precedente e il campione attuale,
 * restituisce i nuovi avvisi da mostrare e lo stato da conservare per il giro
 * dopo. Non ha effetti collaterali sul valore passato (lo copia).
 */
export function reduceMachineAlerts(previous: MachineAlertsState, input: AlertsInput): AlertsResult {
	const state: MachineAlertsState = {
		initialized: previous.initialized,
		presence: { ...previous.presence },
		emitted: { ...previous.emitted }
	};
	const alerts = [...presenceAlerts(state, input.machines), ...outcomeAlerts(state, input.outcomes)];
	state.initialized = true;
	return { state, alerts };
}
