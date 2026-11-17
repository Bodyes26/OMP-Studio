/**
 * Su quale macchina girano chat e task di un progetto (R-MI-13, F19).
 *
 * F18 fissa la regola: la macchina proposta è **l'ultima usata** nel progetto,
 * non quella locale. Su un progetto presente su una sola macchina non c'è
 * scelta: parte lì. Questa logica è pura perché la usano l'indicatore sotto il
 * composer, il selettore dei task e la coda, e deve dare la stessa risposta in
 * tutti e tre.
 */

/** Una copia del progetto su una macchina. */
export interface MachineCopy {
	/** Identificativo della macchina (`local` per quella che si guarda). */
	machineId: string;
	/** Nome mostrato all'utente. */
	name: string;
	/** Il collegamento la raggiunge adesso. */
	online: boolean;
	/** Ultima volta che è stata usata, epoch ms; `null` se mai. */
	lastUsed: number | null;
}

/** Una voce dell'elenco che l'indicatore mostra. */
export interface MachineChoice {
	id: string;
	name: string;
	online: boolean;
}

/**
 * Elenco delle macchine su cui il progetto esiste, in ordine stabile: prima
 * quella corrente, poi le altre per ultimo uso decrescente e nome. La
 * deduplicazione serve perché una macchina può comparire con più copie della
 * stessa cartella (worktree) ma resta una sola scelta.
 */
export function machineChoices(copies: readonly MachineCopy[], current: string): MachineChoice[] {
	const seen = new Map<string, MachineCopy>();
	for (const copy of copies) {
		const existing = seen.get(copy.machineId);
		if (!existing || (copy.lastUsed ?? 0) > (existing.lastUsed ?? 0)) seen.set(copy.machineId, copy);
	}
	const all = [...seen.values()];
	const others = all
		.filter((copy) => copy.machineId !== current)
		.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0) || a.name.localeCompare(b.name));
	const currentCopy = all.find((copy) => copy.machineId === current);
	return [...(currentCopy ? [currentCopy] : []), ...others].map((copy) => ({
		id: copy.machineId,
		name: copy.name,
		online: copy.online
	}));
}

/**
 * Macchina proposta per un lavoro nuovo.
 *
 * - una sola copia → quella, sempre: non c'è nulla da decidere;
 * - più copie → l'ultima usata (F18), purché sia ancora raggiungibile: una
 *   macchina spenta farebbe fallire l'apertura e perderebbe il messaggio.
 *   Se nessuna è in linea si restituisce comunque l'ultima usata e il
 *   chiamante mostra «non raggiungibile» invece di inventare una scelta.
 */
export function proposedMachine(copies: readonly MachineCopy[]): string | null {
	if (copies.length === 0) return null;
	if (copies.length === 1) return copies[0].machineId;
	const ranked = [...copies].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
	const reachable = ranked.find((copy) => copy.online);
	return (reachable ?? ranked[0]).machineId;
}

/**
 * Si può cambiare macchina adesso? Solo a sessione ferma: spostare un lavoro a
 * metà turno richiederebbe il trasferimento di codice e sessione (R-MI-14,
 * fase 3). La macchina corrente resta sempre selezionabile, così il menu non
 * sembra rotto quando la sessione lavora.
 */
export function canChangeMachine(
	machineId: string,
	current: string,
	busy: boolean,
	choices: readonly MachineChoice[]
): boolean {
	if (machineId === current) return true;
	if (busy) return false;
	return choices.some((choice) => choice.id === machineId);
}
