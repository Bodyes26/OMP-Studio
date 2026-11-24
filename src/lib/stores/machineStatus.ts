/**
 * Stato delle macchine abbinate visto dalla barra di stato (R-MI-49).
 *
 * Funzioni pure, senza store: il chip e il popover devono dare la stessa
 * risposta e i test la devono poter calcolare senza finestra. Tre stati per
 * punto, come li distingue il collegamento: in linea, macchina spenta (relay
 * raggiungibile ma il peer no) e relay non raggiungibile. La versione
 * incompatibile e' uno stato a se': la macchina risponde ma non si capisce.
 */

export type MachineDotState = 'online' | 'offline' | 'relay' | 'incompatible';

/** Quel che serve sapere di una macchina per disegnarne il punto. */
export interface MachineStatusInput {
	id: string;
	name: string;
	online: boolean;
	compatible: boolean;
	/** `relay` quando e' il relay a non rispondere, `machine` quando e' spenta. */
	offlineReason: 'relay' | 'machine' | null;
}

export interface MachineDot {
	id: string;
	name: string;
	state: MachineDotState;
}

/**
 * Il punto di una macchina: in linea batte tutto, poi la versione
 * incompatibile, poi la ragione dell'assenza (relay o macchina spenta).
 */
export function machineState(machine: Omit<MachineStatusInput, 'id' | 'name'>): MachineDotState {
	if (machine.online) return machine.compatible ? 'online' : 'incompatible';
	return machine.offlineReason === 'relay' ? 'relay' : 'offline';
}

/** I punti del chip, nell'ordine dell'elenco; vuoto senza macchine abbinate. */
export function machineDots(machines: readonly MachineStatusInput[]): MachineDot[] {
	return machines.map(({ id, name, ...rest }) => ({ id, name, state: machineState(rest) }));
}

export interface MachinesChipSummary {
	/** Almeno una macchina abbinata: senza, il chip non compare affatto. */
	visible: boolean;
	dots: MachineDot[];
	/** Qualche macchina risponde: il chip non e' «tutto spento». */
	anyOnline: boolean;
	/** Qualche macchina non risponde per colpa del relay: si dice «relay». */
	anyRelayDown: boolean;
}

/** Il riassunto del chip «Macchine»: punti e i due casi che cambiano il testo. */
export function machinesChipSummary(machines: readonly MachineStatusInput[]): MachinesChipSummary {
	const dots = machineDots(machines);
	return {
		visible: dots.length > 0,
		dots,
		anyOnline: dots.some((dot) => dot.state === 'online'),
		anyRelayDown: dots.some((dot) => dot.state === 'relay')
	};
}

/**
 * Come risponde una macchina in linea (IMP-005).
 *
 * `online` del collegamento dice che il canale e' aperto, non che l'altra
 * macchina abbia risposto: all'avvio, e mentre un giro di copie aspetta, la
 * macchina e' raggiungibile ma non ha ancora confermato nulla. Una macchina
 * lenta resta `waiting`, mai `unreachable`: l'assenza di risposta non e'
 * un'assenza di rete.
 */
export type MachineResponse = 'responding' | 'waiting' | 'unreachable' | 'incompatible';

export interface MachineResponseInput {
	online: boolean;
	compatible: boolean;
	/** C'e' una richiesta partita e non ancora risolta (giro di copie, prompt, coda). */
	requested: boolean;
	/** L'altra macchina ha gia' risposto almeno una volta. */
	responded: boolean;
}

export function machineResponse(input: MachineResponseInput): MachineResponse {
	if (!input.online) return 'unreachable';
	if (!input.compatible) return 'incompatible';
	if (input.requested && !input.responded) return 'waiting';
	return 'responding';
}

/** Unita' del tempo trascorso, dal minuto in su: «adesso» non ha unita'. */
export function agoParts(sinceMs: number): { value: number; unit: 'minute' | 'hour' | 'day' } {
	const minutes = Math.max(0, Math.floor(sinceMs / 60_000));
	if (minutes < 60) return { value: minutes, unit: 'minute' };
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return { value: hours, unit: 'hour' };
	return { value: Math.floor(hours / 24), unit: 'day' };
}
