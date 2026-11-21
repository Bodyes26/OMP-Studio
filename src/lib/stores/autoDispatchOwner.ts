/**
 * Auto-avvio esclusivo per progetto (R-MI-13, F20).
 *
 * Su un progetto presente su più macchine l'auto-avvio può stare acceso su
 * **una sola**: accenderlo lì lo spegne sulle altre, e i task partono in
 * locale su quella. La designazione non è un'impostazione separata, è
 * l'interruttore stesso.
 *
 * Perché una regola così rigida: le code si replicano, l'avvio no. Due
 * macchine con l'auto-avvio acceso sullo stesso progetto avvierebbero lo
 * stesso task due volte, con la latenza del collegamento a rendere la
 * finestra di collisione reale e non teorica.
 *
 * La logica è pura perché la usano il selettore della coda, la tessera del
 * progetto, il percorso di scrittura remota e l'arbitro dell'avvio: devono
 * dare la stessa risposta, e un errore qui costa un doppio lavoro.
 */

/** Una copia del progetto su una macchina, per la decisione sull'auto-avvio. */
export interface DispatchCopy {
	machineId: string;
	name: string;
	/** Il collegamento la raggiunge adesso. */
	online: boolean;
	/** Interruttore dello stato letto da quella macchina. */
	autoDispatch: boolean;
	/**
	 * Quando l'interruttore di quella copia è stato cambiato l'ultima volta
	 * (istante di `logicalClock`); `null` per le copie scritte prima che
	 * esistesse. Decide il conflitto: vince l'ultima accensione (F20).
	 */
	enabledAt: number | null;
	/** Ultima volta usata; `null` se mai. Solo ripiego senza `enabledAt`. */
	lastUsed: number | null;
}

export interface DispatchOwner {
	/** La macchina che avvia, se qualcuna ce l'ha acceso. */
	machineId: string | null;
	/** Nome da mostrare all'utente; `null` senza detentore. */
	name: string | null;
	/** Il detentore non è raggiungibile: la coda aspetta. */
	offline: boolean;
	/**
	 * Più copie con l'interruttore acceso: stato incoerente da correggere
	 * (capita accendendolo su una macchina mentre l'altra era spenta, perché
	 * il comando che la spegneva non è arrivato). Vince l'accensione più
	 * recente; ogni macchina spegne da sé la propria copia se è in `toDisable`.
	 */
	conflict: boolean;
	/** Macchine da spegnere per riportare l'invariante, in ordine stabile. */
	toDisable: string[];
}

/**
 * Chi avvia i task di questo progetto.
 *
 * Senza alcun interruttore acceso non c'è detentore e la coda resta ferma:
 * è la scelta approvata in F20 (nessuna macchina eredita il ruolo).
 */
export function dispatchOwner(copies: readonly DispatchCopy[]): DispatchOwner {
	const enabled = copies.filter((copy) => copy.autoDispatch);
	if (enabled.length === 0) {
		return { machineId: null, name: null, offline: false, conflict: false, toDisable: [] };
	}
	// In caso di conflitto vince l'accensione più recente: è l'ultima scelta
	// dell'utente (F20, «attivarlo su una macchina lo disattiva sulle altre»).
	// L'ordine deve essere lo stesso visto da tutte le macchine, perché
	// ognuna decide da sola se avviare: niente orologi locali, solo istanti
	// già confrontabili e, a parità, il nome.
	const ranked = [...enabled].sort(
		(a, b) =>
			(b.enabledAt ?? 0) - (a.enabledAt ?? 0) ||
			(b.lastUsed ?? 0) - (a.lastUsed ?? 0) ||
			a.name.localeCompare(b.name)
	);
	const owner = ranked[0];
	return {
		machineId: owner.machineId,
		name: owner.name,
		offline: !owner.online,
		conflict: enabled.length > 1,
		toDisable: ranked.slice(1).map((copy) => copy.machineId)
	};
}

/**
 * Questa macchina può avviare un task di questo progetto adesso? Falso quando
 * l'auto-avvio è spento ovunque, acceso altrove, o acceso qui ma la copia
 * locale non è quella del detentore.
 */
export function mayDispatchHere(
	copies: readonly DispatchCopy[],
	here: string,
	owner: DispatchOwner = dispatchOwner(copies)
): boolean {
	return owner.machineId === here;
}

/**
 * Accendere l'auto-avvio su `machineId`: cosa va scritto e dove.
 *
 * Restituisce le macchine le cui copie devono cambiare stato, così il
 * chiamante sa che una scrittura è remota e può riportarne l'esito. Accendere
 * su una macchina già accesa non scrive nulla.
 */
export function enableExclusive(
	copies: readonly DispatchCopy[],
	machineId: string
): { enable: string | null; disable: string[] } {
	if (!copies.some((copy) => copy.machineId === machineId)) {
		return { enable: null, disable: [] };
	}
	const disable = copies
		.filter((copy) => copy.autoDispatch && copy.machineId !== machineId)
		.map((copy) => copy.machineId);
	const target = copies.find((copy) => copy.machineId === machineId);
	return { enable: target?.autoDispatch ? null : machineId, disable };
}

/**
 * Etichetta da mostrare nella coda: chi avvia, e se la coda è ferma perché il
 * detentore non risponde. `null` quando non c'è nulla da dire (progetto su una
 * macchina sola: la domanda non si pone).
 */
export type OwnerLabel =
	| { kind: 'single-machine' }
	| { kind: 'none' }
	| { kind: 'here' }
	| { kind: 'elsewhere'; name: string; offline: boolean }
	| { kind: 'conflict'; name: string };

export function ownerLabel(
	owner: DispatchOwner,
	copies: readonly DispatchCopy[],
	here: string
): OwnerLabel {
	if (copies.length <= 1) return { kind: 'single-machine' };
	if (!owner.machineId) return { kind: 'none' };
	if (owner.machineId === here) return { kind: 'here' };
	if (owner.conflict) return { kind: 'conflict', name: owner.name ?? owner.machineId };
	return { kind: 'elsewhere', name: owner.name ?? owner.machineId, offline: owner.offline };
}
