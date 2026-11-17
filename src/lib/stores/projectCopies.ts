/**
 * Copie dello stesso progetto su più macchine (R-MI-12, R-MI-19, R-MI-22).
 *
 * Regole pure, condivise da tessera, popover, selettore e striscia sopra il
 * composer: devono dare la stessa risposta ovunque, quindi non leggono store.
 */

/** Stato di una copia nel glifo: in uso, in linea, spenta. */
export type CopyMark = 'use' | 'on' | 'off';

/**
 * La copia in uso è l'ultima usata (F18): è quella su cui nascono le nuove
 * chat e i task, e quella che la tessera rappresenta. A parità vince la prima,
 * così l'ordine della barra decide e la tessera non salta.
 */
export function inUseCopy<T extends { lastOpened: number }>(group: readonly T[]): T | undefined {
	let best: T | undefined;
	for (const copy of group) {
		if (!best || copy.lastOpened > best.lastOpened) best = copy;
	}
	return best;
}

/** Stato git di una copia, quanto basta per decidere se diverge. */
export interface CopyGitState {
	/** Branch corrente; `HEAD` se staccato. */
	branch: string;
	/** Commit corrente; `null` se non ancora letto o repository vuoto. */
	head: string | null;
	/** File con modifiche non committate (tracciati e non). */
	changedFiles: number;
}

export type DivergenceReason = 'branch' | 'commits' | 'uncommitted';

/**
 * Le copie divergono (Q5, 2026-11-17) se sono su branch diversi, se una ha
 * commit che l'altra non ha, oppure se entrambe hanno modifiche non
 * committate. Una sola copia con modifiche non basta: è il lavoro normale di
 * chi sta scrivendo lì. Il confronto è con la copia in uso, la prima.
 *
 * Due HEAD diversi sullo stesso branch vogliono dire che almeno una delle due
 * ha commit che l'altra non ha: da qui non si sa quale, perché i commit
 * dell'altra macchina non sono su questo disco.
 */
export function divergenceReasons(copies: readonly CopyGitState[]): DivergenceReason[] {
	if (copies.length < 2) return [];
	const [first, ...others] = copies;
	const reasons = new Set<DivergenceReason>();
	for (const other of others) {
		if (first.branch !== other.branch) {
			reasons.add('branch');
		} else if (first.head && other.head && first.head !== other.head) {
			reasons.add('commits');
		}
		if (first.changedFiles > 0 && other.changedFiles > 0) reasons.add('uncommitted');
	}
	return [...reasons];
}

/**
 * Impronta dello stato delle copie: «Più tardi» vale finché non cambia, poi
 * l'avviso torna (R-MI-22).
 */
export function divergenceSignature(copies: readonly CopyGitState[]): string {
	return copies.map((copy) => `${copy.branch}@${copy.head ?? '-'}+${copy.changedFiles}`).join('|');
}
