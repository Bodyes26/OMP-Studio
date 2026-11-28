/**
 * Su quale macchina girano chat e task di un progetto (R-MI-13, F19).
 *
 * F18 (l'ultima copia usata, non quella locale) la applica `projectCopies.ts`
 * con `inUseCopy`/`tileCopy`: è da li' che tessera, ordine della barra e
 * provenienza prendono la copia su cui nascono chat e task. Qui resta l'elenco
 * che l'indicatore sotto il composer mostra, con la stessa regola d'ordine.
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
