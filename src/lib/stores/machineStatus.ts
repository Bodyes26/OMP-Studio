/**
 * Stato delle macchine abbinate visto dalla barra di stato (R-MI-49).
 *
 * Funzioni pure, senza store: il chip e il popover devono dare la stessa
 * risposta e i test la devono poter calcolare senza finestra. Quattro stati per
 * punto, come li distingue il collegamento: in linea, in attesa di risposta,
 * macchina spenta (relay raggiungibile ma il peer no) e relay non
 * raggiungibile. La versione incompatibile e' uno stato a se': la macchina
 * risponde ma non si capisce.
 */

export type MachineDotState = 'online' | 'waiting' | 'offline' | 'relay' | 'incompatible';

/** Quel che serve sapere di una macchina per disegnarne il punto. */
export interface MachineStatusInput {
	id: string;
	name: string;
	online: boolean;
	compatible: boolean;
	/**
	 * L'host ha gia' mandato il suo primo riepilogo (D8): `online` dice solo
	 * che il canale QUIC e' aperto, non che l'altra macchina abbia risposto.
	 */
	responded: boolean;
	/** `relay` quando e' il relay a non rispondere, `machine` quando e' spenta. */
	offlineReason: 'relay' | 'machine' | null;
}

export interface MachineDot {
	id: string;
	name: string;
	state: MachineDotState;
}

/**
 * Il punto di una macchina: spenta batte tutto, poi la versione incompatibile,
 * poi «in attesa di risposta» finché l'host non ha parlato (D8), infine in
 * linea.
 */
export function machineState(machine: Omit<MachineStatusInput, 'id' | 'name'>): MachineDotState {
	if (!machine.online) return machine.offlineReason === 'relay' ? 'relay' : 'offline';
	if (!machine.compatible) return 'incompatible';
	return machine.responded ? 'online' : 'waiting';
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
		anyOnline: dots.some((dot) => dot.state === 'online' || dot.state === 'waiting'),
		anyRelayDown: dots.some((dot) => dot.state === 'relay')
	};
}

/** Unita' del tempo trascorso, dal minuto in su: «adesso» non ha unita'. */
export function agoParts(sinceMs: number): { value: number; unit: 'minute' | 'hour' | 'day' } {
	const minutes = Math.max(0, Math.floor(sinceMs / 60_000));
	if (minutes < 60) return { value: minutes, unit: 'minute' };
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return { value: hours, unit: 'hour' };
	return { value: Math.floor(hours / 24), unit: 'day' };
}
