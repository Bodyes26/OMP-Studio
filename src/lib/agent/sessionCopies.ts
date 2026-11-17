/**
 * Storico sessioni di un progetto presente su più macchine (R-MI-12, F19).
 *
 * L'elenco è **unificato** e ogni riga dice da quale macchina viene: a
 * differenza della coda, le sessioni vivono su una sola macchina e non si
 * replicano, quindi senza il badge l'utente non saprebbe dove riprenderle né
 * perché alcune non si aprono.
 *
 * Su un progetto presente su una sola macchina il badge non serve e non
 * compare: la domanda non si pone.
 */

/** Una copia del progetto su una macchina, da interrogare per lo storico. */
export interface SessionCopy {
	machineId: string;
	/** Nome mostrato nel badge. */
	name: string;
	/** Percorso del progetto su quella macchina. */
	projectPath: string;
	/** Il collegamento la raggiunge adesso: una copia spenta non si interroga. */
	online: boolean;
}

/** Una sessione dello storico, con la macchina che la possiede. */
export interface MachineSession<Entry> extends Record<string, unknown> {
	entry: Entry;
	machineId: string;
	machineName: string;
}

/** Esito della lettura di una copia: anche il fallimento, per non perderne traccia. */
export interface CopyResult<Entry> {
	copy: SessionCopy;
	entry: Entry;
}

/**
 * Unisce i risultati delle copie in un elenco unico, dal più recente.
 *
 * L'ordine è per `created_at` decrescente e, a parità, il nome della macchina:
 * così due sessioni create nello stesso secondo non ballano fra un aggiornamento
 * e l'altro. La chiave di deduplicazione include la macchina, perché lo stesso
 * id su due istanze sarebbe una coincidenza, non la stessa conversazione.
 */
export function mergeSessionCopies<Entry extends { id: string; created_at: number }>(
	results: readonly CopyResult<Entry>[]
): MachineSession<Entry>[] {
	const seen = new Set<string>();
	const merged: MachineSession<Entry>[] = [];
	for (const { copy, entry } of results) {
		const key = `${copy.machineId}\0${entry.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push({ entry, machineId: copy.machineId, machineName: copy.name });
	}
	return merged.sort(
		(a, b) =>
			b.entry.created_at - a.entry.created_at ||
			a.machineName.localeCompare(b.machineName) ||
			a.entry.id.localeCompare(b.entry.id)
	);
}

/**
 * Vale la pena mostrare il badge? Sì solo quando il progetto ha più di una
 * copia: su una macchina sola sarebbe rumore su ogni riga.
 */
export function needsMachineBadge(copies: readonly SessionCopy[]): boolean {
	return copies.length > 1;
}

/**
 * Copie da interrogare. Le macchine spente si **escludono**: la loro parte di
 * storico comparirebbe come «non raggiungibile» riga per riga, mentre l'utente
 * non può aprire nulla; meglio non elencarla e dirlo una volta, se serve.
 */
export function reachableCopies(copies: readonly SessionCopy[]): SessionCopy[] {
	return copies.filter((copy) => copy.online);
}
